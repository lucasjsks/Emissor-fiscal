// /api/asaas — mensalidade do NotaOne cobrada pelo Asaas.
// POST com login (dono ou gerente):
//   acao 'assinar'  {empresa_id}                → cria o cliente e a assinatura mensal no Asaas (1ª vence 30 dias depois, depois todo mês no mesmo dia)
//   (também é chamada sozinha por api/plano.js quando o dono escolhe o plano: cobrança automática, pedido do Lucas 26/11/2026)
//   acao 'situacao' {empresa_id}                → busca no Asaas as mensalidades e grava em empresa.assinatura
//   acao 'pix'      {empresa_id, pagamento_id}  → QR Code e "copia e cola" do PIX de uma mensalidade
//   acao 'boleto'   {empresa_id, pagamento_id}  → linha digitável, código de barras e PDF do boleto de uma mensalidade
// POST do Asaas (webhook, cabeçalho asaas-access-token = ASAAS_WEBHOOK_TOKEN) → atualiza a empresa dona da assinatura.
// Variáveis na Vercel: ASAAS_ATIVO ('sim' liga a mensalidade na tela; sem ele fica desligada), ASAAS_API_KEY, ASAAS_AMBIENTE ('producao' ou vazio = sandbox), ASAAS_WEBHOOK_TOKEN, ASAAS_VALOR (opcional, padrão 89,99).
// empresa.assinatura só é gravada aqui no servidor (a tela não consegue mudar: gatilho proteger_assinatura).
import { planoDaEmpresa } from './_planos.js';
import { timingSafeEqual } from 'node:crypto';
import { rota, Falha, env, usuario, papelDe, getDoc, rpc, sb, isoBR } from './_lib.js';

const dig = s => String(s || '').replace(/\D/g, '');
export const ambienteAsaas = () => process.env.ASAAS_AMBIENTE === 'producao' ? 'producao' : 'sandbox';
const base = () => ambienteAsaas() === 'producao' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3';
export const asaasLigado = () => !!process.env.ASAAS_API_KEY && process.env.ASAAS_ATIVO === 'sim';
export const valorMensal = () => { const v = Number(String(process.env.ASAAS_VALOR || '').replace(',', '.')); return v > 0 ? Math.round(v * 100) / 100 : 89.99; };
const PAGO = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED'];
const ABERTO = ['PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS'];

export async function asaas(method, path, body){
  let r;
  try {
    r = await fetch(base() + path, { method, headers:{ access_token:env('ASAAS_API_KEY'), 'Content-Type':'application/json', 'User-Agent':'NotaOne' },
      body:body === undefined ? undefined : JSON.stringify(body) });
  } catch(e){ throw new Falha('Não foi possível conectar ao Asaas: ' + e.message, 502); }
  const t = await r.text(); let j;
  try { j = t ? JSON.parse(t) : {}; } catch { j = { errors:[{ description:t.slice(0, 300) }] }; }
  if (!r.ok){
    const m = Array.isArray(j.errors) && j.errors.length ? j.errors.map(e => e.description || e.code).join('; ') : `HTTP ${r.status}`;
    throw new Falha('Asaas: ' + m, r.status === 401 ? 500 : 502);
  }
  return j;
}

// data de hoje em Brasília (AAAA-MM-DD)
const hojeBR = () => isoBR().slice(0, 10);
// primeira mensalidade: 30 dias depois de assinar
export const DIAS_PRIMEIRA = 30;
export const primeiroVenc = (hoje = hojeBR()) => new Date(Date.parse(hoje + 'T12:00:00Z') + DIAS_PRIMEIRA * 864e5).toISOString().slice(0, 10);
export function resumoMensalidade(p){
  return { id:p.id, valor:Number(p.value) || 0, venc:p.dueDate || '', status:p.status || '', pago_em:p.clientPaymentDate || p.paymentDate || p.confirmedDate || null,
    forma:p.billingType || '', link:p.invoiceUrl || '', boleto:p.bankSlipUrl || '' };
}
// junta assinatura + cobranças num resumo para a tela
export function montarSituacao(sub, pagamentos, antes = {}){
  const L = pagamentos.map(resumoMensalidade).filter(p => p.status !== 'REFUNDED' || p.pago_em).sort((a, b) => b.venc.localeCompare(a.venc));
  const abertas = L.filter(p => ABERTO.includes(p.status)).sort((a, b) => a.venc.localeCompare(b.venc));
  const ativa = sub.status === 'ACTIVE' && !sub.deleted;
  const atrasada = abertas.some(p => p.status === 'OVERDUE' || p.venc < hojeBR());
  const pagas = L.filter(p => PAGO.includes(p.status));
  return { ...antes, id:sub.id, cliente:sub.customer, ambiente:ambienteAsaas(), valor:Number(sub.value) || 0, dia:+(String(sub.nextDueDate || '').slice(8, 10)) || antes.dia || null,
    status:sub.status || '', situacao:!ativa ? 'cancelada' : atrasada ? 'atrasada' : 'em_dia', proximo_venc:sub.nextDueDate || null,
    aberta:abertas[0] || null, ultimo_pagamento:pagas[0] ? { venc:pagas[0].venc, pago_em:pagas[0].pago_em, valor:pagas[0].valor } : null,
    mensalidades:L.slice(0, 12), atualizado_em:isoBR() };
}

export async function atualizar(empresa_id, e){
  const a = (e || {}).assinatura || {};
  if (!a.id || (a.ambiente || 'sandbox') !== ambienteAsaas()) return null;
  const sub = await asaas('GET', `/subscriptions/${encodeURIComponent(a.id)}`);
  const pg = await asaas('GET', `/payments?subscription=${encodeURIComponent(a.id)}&limit=24`);
  const s = montarSituacao(sub, Array.isArray(pg.data) ? pg.data : [], a);
  await rpc('gravar_campo_empresa', { e:empresa_id, caminho:['assinatura'], valor:s });
  return s;
}

export async function assinar(empresa_id, e, u){
  const a = e.assinatura || {};
  if (a.id && (a.ambiente || 'sandbox') === ambienteAsaas() && a.situacao !== 'cancelada') throw new Falha('Esta empresa já tem a assinatura ativa.');
  const cnpj = dig(e.cnpj || e.cpf); if (cnpj.length !== 14 && cnpj.length !== 11) throw new Falha('Cadastre o CNPJ (ou CPF) da empresa antes de assinar.');
  // aproveita o cliente se já existir no Asaas (mesmo CNPJ)
  const achados = await asaas('GET', `/customers?cpfCnpj=${cnpj}&limit=1`);
  let cli = Array.isArray(achados.data) && achados.data.find(c => !c.deleted);
  if (!cli){
    const fone = dig(e.telefone);
    cli = await asaas('POST', '/customers', { name:e.razao || e.fantasia || 'Empresa', cpfCnpj:cnpj, email:u.email || undefined,
      mobilePhone:fone.length >= 10 ? fone : undefined, externalReference:empresa_id, company:e.fantasia || undefined });
  }
  const sub = await asaas('POST', '/subscriptions', { customer:cli.id, billingType:'UNDEFINED', value:(planoDaEmpresa(e) || {}).valor || valorMensal(), cycle:'MONTHLY',
    nextDueDate:primeiroVenc(), description:'Mensalidade NotaOne — Emissão Inteligente', externalReference:empresa_id });
  const novo = { id:sub.id, cliente:cli.id, ambiente:ambienteAsaas(), criada_em:isoBR(), criada_por:u.id };
  await rpc('gravar_campo_empresa', { e:empresa_id, caminho:['assinatura'], valor:novo });
  return atualizar(empresa_id, { ...e, assinatura:novo });
}

// empresa que já escolheu o plano mas ainda não tem assinatura no ambiente atual do Asaas (pedido do Lucas, 26/11/2026:
// quando a cobrança for ligada, as empresas que escolheram plano antes ganham a mensalidade sozinhas, 1ª cobrança em 30 dias).
// Assinatura cancelada não é recriada; empresa marcada pelo suporte com sem_mensalidade (teste, cortesia) fica de fora.
export function precisaAssinar(e){
  if (!e || !(e.plano && e.plano.id) || e.sem_mensalidade) return false;
  const a = e.assinatura || {};
  return !(a.id && (a.ambiente || 'sandbox') === ambienteAsaas());
}
async function emailDoDono(empresa_id){
  try {
    const m = await sb(`/rest/v1/membros?select=user_id&empresa_id=eq.${encodeURIComponent(empresa_id)}&papel=eq.dono&limit=1`);
    const uid = Array.isArray(m) && m[0] && m[0].user_id; if (!uid) return { id:'automatico' };
    const r = await fetch(env('SUPABASE_URL') + '/auth/v1/admin/users/' + uid, { headers:{ apikey:env('SUPABASE_SERVICE_ROLE_KEY'), Authorization:'Bearer ' + env('SUPABASE_SERVICE_ROLE_KEY') } });
    const j = r.ok ? await r.json() : {};
    return { id:uid, email:j.email && !/@funcionarios\.notaone\.example\.com$/.test(j.email) ? j.email : undefined };
  } catch { return { id:'automatico' }; }
}
// chamada todo dia pelo Vercel Cron (junto com o do contador): cria as assinaturas que faltam
export async function regularizarAssinaturas(max = 50){
  if (!asaasLigado()) return { ok:true, desligado:true, criadas:0 };
  const rows = await sb('/rest/v1/docs?select=path,data&col=eq.empresas&data->plano->>id=not.is.null&limit=5000') || [];
  const fila = rows.filter(r => r.path.split('/').length === 2 && precisaAssinar(r.data)).slice(0, max), out = [];
  for (const r of fila){
    const id = r.path.split('/')[1];
    try { await assinar(id, r.data, await emailDoDono(id)); out.push({ id, ok:true }); }
    catch(err){ out.push({ id, ok:false, erro:err.message }); }
  }
  return { ok:true, criadas:out.filter(o => o.ok).length, total:fila.length, resultado:out };
}

const rotaTela = rota(async (req, b) => {
  const u = await usuario(req);
  const { empresa_id, acao } = b;
  if (!empresa_id) throw new Falha('Requisição incompleta.');
  // Painel NotaOne: o administrador da plataforma dá baixa na mensalidade aberta do Asaas (recebida por fora: PIX direto, dinheiro…)
  if (acao === 'admin_baixa'){
    const adm = await sb('/rest/v1/admins?select=user_id&user_id=eq.' + encodeURIComponent(u.id));
    if (!(Array.isArray(adm) && adm.length)) throw new Falha('Só o administrador do NotaOne pode fazer isso.', 403);
    if (!asaasLigado()) throw new Falha('A cobrança pelo Asaas está desligada.', 503);
    const e = await getDoc('empresas/' + empresa_id); if (!e) throw new Falha('Empresa não encontrada.', 404);
    const a = e.assinatura || {}, pid = (a.aberta || {}).id;
    if (!a.id || !pid) throw new Falha('Esta empresa não tem mensalidade em aberto no Asaas.');
    const p = await asaas('GET', `/payments/${encodeURIComponent(pid)}`);
    if (p.subscription !== a.id) throw new Falha('Mensalidade não encontrada.', 404);
    if (!PAGO.includes(p.status)) await asaas('POST', `/payments/${encodeURIComponent(pid)}/receiveInCash`, { paymentDate:/^\d{4}-\d{2}-\d{2}$/.test(b.data || '') ? b.data : hojeBR(), value:Number(b.valor) > 0 ? Number(b.valor) : Number(p.value), notifyCustomer:false });
    return { ok:true, assinatura:await atualizar(empresa_id, e) };
  }
  if (!['dono', 'gerente'].includes(await papelDe(empresa_id, u.id))) throw new Falha('Só o dono da empresa cuida da mensalidade.', 403);
  if (!asaasLigado()) throw new Falha('A cobrança da mensalidade ainda não foi ligada. Fale com o suporte.', 503);
  const e = await getDoc('empresas/' + empresa_id);
  if (!e) throw new Falha('Empresa não encontrada.', 404);

  if (acao === 'assinar') return { ok:true, assinatura:await assinar(empresa_id, e, u) };
  if (acao === 'situacao'){
    // empresa com plano escolhido e sem assinatura (ex.: escolheu antes da cobrança ser ligada): cria agora, sozinha
    if (precisaAssinar(e)) return { ok:true, criada:true, assinatura:await assinar(empresa_id, e, u) };
    return { ok:true, assinatura:await atualizar(empresa_id, e) };
  }
  if (acao === 'pix' || acao === 'boleto'){
    const a = e.assinatura || {}, pid = String(b.pagamento_id || '');
    if (!a.id) throw new Falha('Esta empresa ainda não tem assinatura.');
    const p = await asaas('GET', `/payments/${encodeURIComponent(pid)}`);
    if (p.subscription !== a.id) throw new Falha('Mensalidade não encontrada.', 404); // só cobranças da própria assinatura
    if (PAGO.includes(p.status)) return { ok:true, paga:true };
    if (acao === 'boleto'){
      let f;
      try { f = await asaas('GET', `/payments/${encodeURIComponent(pid)}/identificationField`); }
      catch(err){ return { ok:true, semBoleto:true, link:p.invoiceUrl || '', erro:err.message }; }
      return { ok:true, linha:f.identificationField || '', barras:dig(f.barCode), nosso_numero:f.nossoNumero || '', pdf:p.bankSlipUrl || '',
        valor:Number(p.value) || 0, venc:p.dueDate || '', link:p.invoiceUrl || '' };
    }
    let q;
    try { q = await asaas('GET', `/payments/${encodeURIComponent(pid)}/pixQrCode`); }
    catch(err){ return { ok:true, semPix:true, link:p.invoiceUrl || '', erro:err.message }; }
    return { ok:true, imagem:q.encodedImage || '', copia:q.payload || '', expira:q.expirationDate || null, valor:Number(p.value) || 0, venc:p.dueDate || '', link:p.invoiceUrl || '' };
  }
  throw new Falha('Ação desconhecida.');
});

function tokenConfere(recebido){
  const certo = process.env.ASAAS_WEBHOOK_TOKEN || '';
  const a = Buffer.from(String(recebido || '')), c = Buffer.from(certo);
  return certo.length > 0 && a.length === c.length && timingSafeEqual(a, c);
}

// aviso automático do Asaas (cobrança criada, paga, vencida, assinatura alterada…)
async function webhook(req, res){
  if (!tokenConfere(req.headers['asaas-access-token'])) return res.status(401).json({ erro:'Token inválido.' });
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const subId = (b.payment && b.payment.subscription) || (b.subscription && b.subscription.id) || '';
    if (!subId) return res.status(200).json({ ok:true, ignorado:'sem assinatura' });
    const rows = await sb('/rest/v1/docs?select=path,data&col=eq.empresas&data->assinatura->>id=eq.' + encodeURIComponent(subId));
    const alvo = Array.isArray(rows) && rows[0];
    if (!alvo) return res.status(200).json({ ok:true, ignorado:'assinatura de outra conta' });
    await atualizar(alvo.path.split('/')[1], alvo.data);
    return res.status(200).json({ ok:true });
  } catch(e){
    console.error(e);
    return res.status(500).json({ erro:e.message || 'Erro inesperado.' }); // o Asaas tenta de novo
  }
}

export default function handler(req, res){
  if (req.headers['asaas-access-token'] !== undefined) return webhook(req, res);
  return rotaTela(req, res);
}
