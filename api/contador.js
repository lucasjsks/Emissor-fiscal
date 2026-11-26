// /api/contador — pacote do mês para a contabilidade (XMLs das notas e das compras + resumos em planilha CSV).
//  GET  (Vercel Cron, todo dia de manhã): envia o mês anterior por e-mail às empresas cujo dia de envio chegou.
//  POST { empresa_id, acao:'enviar'|'baixar', mes? }  (dono/gerente): envia agora ou baixa o ZIP.
//  POST { empresa_id, cron:true }  com o CRON_SECRET: envio automático de uma empresa (chamado pelo GET).
import { regularizarAssinaturas } from './asaas.js';
import { Falha, usuario, papelDe, getDoc, sb, rpc, focus, focusBase, isoBR, ambienteEmp } from './_lib.js';
import { zipar } from './_zip.js';
import { enviarEmail, emailConfigurado } from './_email.js';

const hojeBR = () => isoBR().slice(0, 10);
export function mesAnterior(dia = hojeBR()){
  const [y, m] = dia.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const nomeMes = m => `${MESES[+m.slice(5, 7) - 1]}/${m.slice(0, 4)}`;
const dig = s => String(s || '').replace(/\D/g, '');
const brl = v => 'R$ ' + (Math.round((+v || 0) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const dec = v => (Math.round((+v || 0) * 100) / 100).toFixed(2).replace('.', ',');
const emails = s => [...new Set(String(s || '').split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))].slice(0, 5);
const csv = linhas => '﻿' + linhas.map(l => l.map(c => { const t = String(c ?? ''); return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }).join(';')).join('\r\n');

// a empresa está no dia de envio? (dia 1–28; se o envio falhar, tenta de novo nos dias seguintes, até 3 vezes)
export function devido(e, hoje = hojeBR()){
  const c = e.contador || {}, st = e.contador_envio || {};
  if (!c.ativo || !emails(c.email).length) return false;
  const dia = Math.min(Math.max(+c.dia || 1, 1), 28), mes = mesAnterior(hoje);
  if (+hoje.slice(8, 10) < dia) return false;
  if (c.pular && c.pular >= mes) return false;       // configurado depois do dia: começa no mês seguinte
  if (st.mes === mes && (st.ok || (st.tentativas || 0) >= 3)) return false;
  return true;
}

// todas as linhas de uma coleção (o Supabase entrega no máximo 1.000 por vez)
async function colecao(col, filtro = ''){
  const out = [];
  for (let off = 0; ; off += 1000){
    const r = await sb(`/rest/v1/docs?select=path,data&col=eq.${encodeURIComponent(col)}${filtro}&order=path&limit=1000&offset=${off}`) || [];
    out.push(...r); if (r.length < 1000) return out;
  }
}
// baixa arquivos (XML) em paralelo, 12 por vez
async function baixarTodos(tarefas){
  const res = new Array(tarefas.length); let i = 0;
  await Promise.all(Array.from({ length:12 }, async () => { while (i < tarefas.length){ const k = i++;
    try { res[k] = await tarefas[k](); } catch(_){ res[k] = null; } } }));
  return res;
}
async function baixarXml(caminho, amb){
  if (!caminho) return null;
  const r = await fetch(/^https?:/.test(caminho) ? caminho : focusBase(amb) + caminho);
  if (!r.ok) return null;
  const t = await r.text();
  return t.includes('<') ? t : null;
}

export async function montarPacote(empresaId, e, mes){
  const amb = ambienteEmp(e), teste = amb !== 'producao';
  const doAmb = n => (n.ambiente === 'producao' ? 'producao' : 'homologacao') === amb;
  const notas = (await colecao(`empresas/${empresaId}/notas`, `&data->>data=like.${mes}*`)).map(r => r.data)
    .filter(n => n && n.modelo !== '99' && doAmb(n) && !n.corrigida_por).sort((a, b) => String(a.data).localeCompare(String(b.data)));
  const inut = (await colecao(`empresas/${empresaId}/inutilizacoes`, `&data->>em=like.${mes}*`)).map(r => r.data).filter(i => i && doAmb(i));
  const compras = (await colecao(`empresas/${empresaId}/compras`, `&data->>data_emissao=like.${mes}*`)).map(r => ({ id:r.path.split('/').pop(), ...r.data }))
    .filter(c => c.status !== 'estornada');

  const arq = [], falt = [];
  const nomeNota = n => `${n.modelo === '65' ? 'nfce' : 'nfe'}-${n.serie}-${String(n.numero).padStart(9, '0')}${n.chave ? '-' + n.chave : ''}`;
  const validas = notas.filter(n => ['autorizada', 'cancelada', 'denegada'].includes(n.status));

  // XML de cada nota (+ cancelamento e cartas de correção)
  const tarefas = [];
  for (const n of validas){
    const pasta = n.status === 'cancelada' ? 'canceladas' : n.status === 'denegada' ? 'denegadas' : 'autorizadas';
    const base = `/v2/${n.modelo === '65' ? 'nfce' : 'nfe'}/${encodeURIComponent(n.ref)}`;
    tarefas.push(async () => {
      let f = n.focus || {}, canc = (n.eventos || []).filter(x => x.tipo === 'cancelamento').map(x => (x.focus || {}).caminho_xml_cancelamento).find(Boolean);
      if (!f.caminho_xml_nota_fiscal || (n.status === 'cancelada' && !canc)){
        const r = await focus('GET', base, undefined, { amb });
        if (r.status === 200){ f = { ...f, ...r.body }; canc = canc || r.body.caminho_xml_cancelamento; }
      }
      const xml = await baixarXml(f.caminho_xml_nota_fiscal, amb);
      if (xml) arq.push({ nome:`notas/${pasta}/${nomeNota(n)}.xml`, dados:xml }); else falt.push(`${n.modelo === '65' ? 'Cupom' : 'NF-e'} ${n.numero}`);
      if (canc){ const x = await baixarXml(canc, amb); if (x) arq.push({ nome:`notas/canceladas/${nomeNota(n)}-cancelamento.xml`, dados:x }); }
    });
    (n.eventos || []).filter(x => x.tipo === 'cce' && (x.focus || {}).caminho_xml_carta_correcao).forEach(ev => tarefas.push(async () => {
      const x = await baixarXml(ev.focus.caminho_xml_carta_correcao, amb);
      if (x) arq.push({ nome:`notas/cartas-de-correcao/${nomeNota(n)}-cce${ev.seq || ''}.xml`, dados:x });
    }));
  }
  for (const i of inut) if ((i.focus || {}).caminho_xml) tarefas.push(async () => {
    const x = await baixarXml(i.focus.caminho_xml, amb);
    if (x) arq.push({ nome:`notas/inutilizacoes/inut-${i.modelo}-${i.serie}-${i.ini}-${i.fim}.xml`, dados:x });
  });
  // XML original das compras (guardado quando a nota foi importada)
  const comXml = compras.filter(c => c.tem_xml);
  for (const c of comXml) tarefas.push(async () => {
    const d = await getDoc(`empresas/${empresaId}/compras_xml/${c.xml_id || c.id}`);
    if (d && d.xml) arq.push({ nome:`compras/${dig(c.fornecedor_cnpj || c.emit_cnpj) || 'fornecedor'}-nf${c.numero || ''}${c.chave ? '-' + dig(c.chave) : ''}.xml`, dados:d.xml });
  });
  await baixarTodos(tarefas);
  arq.sort((a, b) => a.nome.localeCompare(b.nome));

  // planilhas de resumo (CSV abre no Excel)
  const tipo = n => n.modelo === '65' ? 'NFC-e' : 'NF-e';
  arq.unshift({ nome:`resumo-notas-${mes}.csv`, dados:csv([['Data', 'Modelo', 'Série', 'Número', 'Chave', 'Operação', 'Destinatário', 'CPF/CNPJ', 'Total', 'Situação'],
    ...notas.map(n => [String(n.data || '').slice(0, 16).replace('T', ' '), tipo(n), n.serie, n.numero, n.chave || '', n.op || 'venda', n.destNome || 'Consumidor', n.destDoc || '', dec(n.total), n.status])]) });
  const cf = {};
  notas.filter(n => n.status === 'autorizada' && n.payload).forEach(n => (n.payload.items || []).forEach(it => {
    const k = `${tipo(n)}|${it.cfop}|${it.icms_situacao_tributaria}`;
    const o = cf[k] = cf[k] || [tipo(n), it.cfop, it.icms_situacao_tributaria, 0, 0, 0, 0, 0];
    o[3] += (+it.valor_bruto || 0) - (+it.valor_desconto || 0) + (+it.valor_frete || 0) + (+it.valor_seguro || 0) + (+it.valor_outras_despesas || 0) + (+it.icms_valor_st || 0) + (+it.fcp_valor_st || 0);
    o[4] += +it.icms_base_calculo || 0; o[5] += +it.icms_valor || 0; o[6] += +it.icms_base_calculo_st || 0; o[7] += +it.icms_valor_st || 0;
  }));
  arq.splice(1, 0, { nome:`resumo-cfop-${mes}.csv`, dados:csv([['Modelo', 'CFOP', 'CST/CSOSN', 'Valor contábil', 'Base ICMS', 'ICMS', 'Base ST', 'ICMS ST'],
    ...Object.values(cf).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1])).map(o => [...o.slice(0, 3), ...o.slice(3).map(dec)])]) });
  if (compras.length) arq.splice(2, 0, { nome:`resumo-compras-${mes}.csv`, dados:csv([['Emissão', 'Fornecedor', 'CNPJ', 'Número', 'Série', 'Chave', 'Total', 'Origem'],
    ...compras.map(c => [String(c.data_emissao || '').slice(0, 10), c.fornecedor_nome || '', c.fornecedor_cnpj || '', c.numero || '', c.serie || '', c.chave || '', dec(c.total_nota), c.tem_xml ? 'XML' : 'manual'])]) });

  const aut = notas.filter(n => n.status === 'autorizada'), canc = notas.filter(n => n.status === 'cancelada');
  const soma = l => l.reduce((s, n) => s + (+n.total || 0), 0);
  const resumo = { mes, notas:aut.length, canceladas:canc.length, total:soma(aut), nfce:aut.filter(n => n.modelo === '65').length, nfe:aut.filter(n => n.modelo === '55').length,
    compras:compras.length, total_compras:compras.reduce((s, c) => s + (+c.total_nota || 0), 0), inutilizacoes:inut.length, faltando:falt, teste };
  const texto = [
    `Pacote fiscal de ${nomeMes(mes)} — ${e.razao || ''} (CNPJ ${e.cnpj || ''})`, teste ? '\nATENÇÃO: empresa em ambiente de HOMOLOGAÇÃO (teste). Estas notas NÃO têm valor fiscal.\n' : '',
    `Vendas autorizadas: ${resumo.notas} (${resumo.nfce} cupons NFC-e e ${resumo.nfe} NF-e) — ${brl(resumo.total)}`,
    `Canceladas: ${resumo.canceladas}`, `Inutilizações: ${resumo.inutilizacoes}`,
    `Notas de compra (entradas): ${resumo.compras} — ${brl(resumo.total_compras)}`,
    falt.length ? `\nNão foi possível baixar o XML de: ${falt.slice(0, 30).join(', ')}${falt.length > 30 ? '…' : ''}. Peça ao cliente para conferir no sistema.` : '',
    '\nNo ZIP: pasta "notas" (autorizadas, canceladas, cartas de correção, inutilizações), pasta "compras" (XML das notas de entrada) e planilhas de resumo (.csv, abrem no Excel).',
    `\nGerado em ${isoBR().slice(0, 16).replace('T', ' ').split(' ').map((x, i) => i ? x : x.split('-').reverse().join('/')).join(' ')} pelo NotaOne.`
  ].filter(Boolean).join('\n');
  arq.push({ nome:'LEIA-ME.txt', dados:texto.replace(/\n/g, '\r\n') });
  return { zip:zipar(arq), nome:`contabilidade-${dig(e.cnpj)}-${mes}.zip`, resumo, texto };
}

// monta e envia; grava o resultado em empresa.contador_envio (só o servidor grava esse campo)
export async function enviarPacote(empresaId, e, mes, { para, auto = false, por = null } = {}){
  const c = e.contador || {}, destino = para && para.length ? para : emails(c.email);
  if (!destino.length) throw new Falha('Informe o e-mail do contador.');
  const ant = e.contador_envio || {}, reg = { mes, em:isoBR(), para:destino, auto, por, tentativas:ant.mes === mes ? (ant.tentativas || 0) + 1 : 1 };
  try {
    const p = await montarPacote(empresaId, e, mes);
    if (p.zip.length > 18 * 1024 * 1024) throw new Falha('O pacote passou de 18 MB, acima do limite dos e-mails. Baixe o pacote e envie por outro meio.');
    await enviarEmail({ para:destino, responderPara:emails(e.email)[0], anexos:[{ nome:p.nome, tipo:'application/zip', dados:p.zip }],
      assunto:`${p.resumo.teste ? '[TESTE] ' : ''}XMLs de ${nomeMes(mes)} — ${e.fantasia || e.razao || ''} (CNPJ ${e.cnpj || ''})`,
      texto:`Olá,\n\nSegue em anexo o pacote fiscal de ${nomeMes(mes)}.\n\n${p.texto}\n\nE-mail enviado automaticamente. Para responder, use o e-mail da empresa.` });
    Object.assign(reg, { ok:true, notas:p.resumo.notas, canceladas:p.resumo.canceladas, compras:p.resumo.compras, total:p.resumo.total, tamanho:p.zip.length, faltando:p.resumo.faltando.length });
  } catch(err){ reg.ok = false; reg.erro = String(err.message || err).slice(0, 300); }
  const hist = [reg, ...((e.contador_hist || []).filter(h => !(h.mes === mes && !h.ok)))].slice(0, 12);
  // envio de teste para outro e-mail não conta como o envio do mês ao contador
  if (!(para && para.length)) await rpc('gravar_campo_empresa', { e:empresaId, caminho:['contador_envio'], valor:reg });
  else reg.teste_para = true;
  await rpc('gravar_campo_empresa', { e:empresaId, caminho:['contador_hist'], valor:hist });
  return reg;
}

const cronOk = req => !!process.env.CRON_SECRET && (req.headers.authorization || '') === 'Bearer ' + process.env.CRON_SECRET;
const responder = (res, http, o) => res.status(http).json(o);

export default async function handler(req, res){
  try {
    // ---- Vercel Cron (GET): procura as empresas no dia de envio ----
    if (req.method === 'GET'){
      if (!cronOk(req)) return responder(res, 401, { erro:'Acesso negado.' });
      // mensalidades do NotaOne que faltam (empresas que escolheram plano antes da cobrança ser ligada) — mesmo cron diário
      const mensalidades = await regularizarAssinaturas().catch(err => ({ ok:false, erro:err.message }));
      if (!emailConfigurado()) return responder(res, 200, { ok:false, erro:'SMTP não configurado.', mensalidades });
      const hoje = hojeBR();
      const rows = await sb('/rest/v1/docs?select=path,data&col=eq.empresas&data->contador->>ativo=eq.true&limit=5000') || [];
      const fila = rows.filter(r => devido(r.data, hoje)).map(r => r.path.split('/')[1]);
      const host = req.headers['x-forwarded-host'] || req.headers.host, proto = req.headers['x-forwarded-proto'] || 'https';
      const out = []; let i = 0;
      // cada empresa roda numa chamada separada (cada uma tem o seu tempo limite)
      await Promise.all(Array.from({ length:4 }, async () => { while (i < fila.length){ const id = fila[i++];
        try {
          const r = await fetch(`${proto}://${host}/api/contador`, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + process.env.CRON_SECRET },
            body:JSON.stringify({ cron:true, empresa_id:id }) });
          out.push({ id, ...(await r.json().catch(() => ({ ok:false }))) });
        } catch(err){ out.push({ id, ok:false, erro:err.message }); }
      } }));
      return responder(res, 200, { ok:true, hoje, mensalidades, enviadas:out.filter(o => o.ok).length, total:fila.length, resultado:out });
    }
    if (req.method !== 'POST') throw new Falha('Use POST.', 405);
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { empresa_id } = b;
    if (!empresa_id) throw new Falha('Requisição incompleta.');

    // ---- envio automático de uma empresa (chamado pelo cron) ----
    if (b.cron){
      if (!cronOk(req)) throw new Falha('Acesso negado.', 401);
      const e = await getDoc('empresas/' + empresa_id);
      if (!e || !devido(e)) return responder(res, 200, { ok:false, pulado:true });
      return responder(res, 200, await enviarPacote(empresa_id, e, mesAnterior(), { auto:true }));
    }

    // ---- pedido do usuário: enviar agora ou baixar ----
    const u = await usuario(req), papel = await papelDe(empresa_id, u.id);
    if (!['dono', 'gerente'].includes(papel)) throw new Falha('Só o dono ou o gerente podem fazer isso.', 403);
    const e = await getDoc('empresas/' + empresa_id);
    if (!e) throw new Falha('Empresa não encontrada.', 404);
    const mes = /^\d{4}-\d{2}$/.test(b.mes || '') ? b.mes : mesAnterior();
    if (b.acao === 'baixar'){
      const p = await montarPacote(empresa_id, e, mes);
      if (p.zip.length > 3.2 * 1024 * 1024) throw new Falha('O pacote ficou grande demais para baixar pela tela. Use "Enviar por e-mail".');
      return responder(res, 200, { ok:true, nome:p.nome, arquivo:p.zip.toString('base64'), resumo:p.resumo });
    }
    if (b.acao === 'enviar'){
      const para = b.email ? emails(b.email) : null;
      if (b.email && !para.length) throw new Falha('E-mail inválido.');
      const reg = await enviarPacote(empresa_id, e, mes, { para, por:u.id });
      if (!reg.ok) throw new Falha(reg.erro, 502);
      return responder(res, 200, reg);
    }
    throw new Falha('Ação desconhecida.');
  } catch(err){
    const http = err instanceof Falha ? err.http : 500;
    if (http >= 500) console.error(err);
    return responder(res, http, { erro:err.message || 'Erro inesperado.' });
  }
}
