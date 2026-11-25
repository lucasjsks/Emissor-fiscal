// POST /api/recebidas — notas de compra emitidas contra o CNPJ da empresa (Manifestação do Destinatário).
//   acao 'buscar'      → baixa da Focus as notas novas/alteradas e grava em empresas/<id>/recebidas/<chave>
//   acao 'manifestar'  → ciência, confirmação, desconhecimento ou operação não realizada
//   acao 'xml'         → XML completo (liberado pela SEFAZ depois da ciência), para dar entrada na aba Compras
// GET /api/recebidas (Vercel Cron, com o CRON_SECRET) → busca sozinha as notas novas de todas as empresas com Manifestação
import { rota, Falha, usuario, papelDe, getDoc, putDoc, putDocs, rpc, sb, focus, mensagemFocus, isoBR, ambienteMde } from './_lib.js';

const dig = s => String(s || '').replace(/\D/g, '');
export const TIPOS = { ciencia:'ciencia', confirmacao:'confirmacao', desconhecimento:'desconhecimento', nao_realizada:'nao_realizada' };
const ok = s => s >= 200 && s < 300;

export function resumoRecebida(x){
  return { chave:dig(x.chave_nfe), emitente_nome:x.nome_emitente || '', emitente_doc:dig(x.documento_emitente), valor:Number(x.valor_total) || 0,
    data_emissao:x.data_emissao || '', situacao:x.situacao || 'autorizada', manifestacao:x.manifestacao_destinatario || 'nulo',
    completa:!!x.nfe_completa, tipo_nfe:x.tipo_nfe ?? null, versao:Number(x.versao) || 0,
    data_cancelamento:x.data_cancelamento || null, carta_correcao:x.carta_correcao || null, sinc_em:isoBR() };
}

// baixa da Focus as notas novas/alteradas de uma empresa e grava em empresas/<id>/recebidas/<chave>
export async function buscarNotas(empresa_id, emp, userId){
  const cnpj = dig(emp.cnpj), amb = ambienteMde(), base = `empresas/${empresa_id}/recebidas/`, m0 = emp.mde || {};
  // continua de onde parou (mde.versao); se o ambiente mudou, recomeça do zero
  let versao = (m0.ambiente && m0.ambiente !== amb) ? 0 : Number(m0.versao ?? emp.mde_versao) || 0, gravadas = 0;
  for (let pag = 0; pag < 10; pag++){
    const r = await focus('GET', `/v2/nfes_recebidas?cnpj=${cnpj}&versao=${versao}`, undefined, { amb });
    if (!ok(r.status)){
      const m = mensagemFocus(r.body);
      if (r.status === 404 || r.status === 403 || /habilit|permiss|não encontrad/i.test(m))
        throw new Falha('A Focus NFe ainda não está liberada para buscar as notas recebidas desta empresa. ' +
          'No painel da Focus, edite a empresa e marque a opção de Manifestação/recebimento de NF-e (precisa do certificado digital cadastrado).' + (m ? ` (${m})` : ''));
      throw new Falha(m || `A Focus NFe não respondeu (HTTP ${r.status}).`, 502);
    }
    const lista = Array.isArray(r.body) ? r.body : [];
    // a Focus pode mandar a mesma nota mais de uma vez na lista (resumo e completa, eventos): fica a versão mais nova
    const porChave = new Map();
    lista.map(resumoRecebida).filter(x => x.chave.length === 44).forEach(x => { const y = porChave.get(x.chave); if (!y || x.versao >= y.versao) porChave.set(x.chave, x); });
    // preserva o que o sistema já anotou na nota (manifestação feita aqui, justificativa, XML baixado, compra lançada)
    const chaves = [...porChave.keys()], atuais = {};
    for (let i = 0; i < chaves.length; i += 40){ // em pedaços, para o endereço não ficar grande demais
      const rows = await sb('/rest/v1/docs?select=path,data&path=in.(' + chaves.slice(i, i + 40).map(c => encodeURIComponent('"' + base + c + '"')).join(',') + ')');
      (rows || []).forEach(r => { atuais[r.path] = r.data; });
    }
    const docs = chaves.map(c => { const novo = porChave.get(c), velho = atuais[base + c] || {};
      const data = { ...velho, ...novo };
      // manifestação feita pelo sistema vale até a Focus confirmar outra
      if (velho.manifestado_em && (!novo.manifestacao || novo.manifestacao === 'nulo')) data.manifestacao = velho.manifestacao;
      if (!velho.chave) data.chegou_em = novo.sinc_em; // primeira vez que o sistema viu a nota
      return { path:base + c, data }; });
    await putDocs(docs, userId); gravadas += docs.length;
    const max = Math.max(versao, Number(r.headers.get('x-max-version')) || 0, ...lista.map(x => Number(x.versao) || 0));
    if (!lista.length || max <= versao){ versao = max; break; }
    versao = max;
    if (lista.length < 100) break;
  }
  await rpc('gravar_campo_empresa', { e:empresa_id, caminho:['mde'], valor:{ versao, sinc_em:isoBR(), ambiente:amb } });
  const ciencias = await cienciaAutomatica(empresa_id, emp, amb);
  return { ok:true, gravadas, ambiente:amb, ciencias };
}

// Ciência automática (pedido do Lucas): assim que a nota do fornecedor aparece, o sistema avisa a SEFAZ (ciência),
// para a nota completa já estar liberada quando o cliente clicar em Aceitar. A ciência não é resposta final:
// depois dá para confirmar (ao lançar a compra) ou recusar. Desliga em Empresa → "Notas de fornecedores" (ciencia_auto = false).
export const CIENCIA_MAX = 20, CIENCIA_DIAS = 30;
export const precisaCiencia = (r, agora = Date.now()) => !!r && r.chave && (r.manifestacao || 'nulo') === 'nulo' && !r.manifestado_em
  && r.situacao !== 'cancelada' && !r.compra_id
  && !(r.data_emissao && agora - new Date(r.data_emissao) > CIENCIA_DIAS * 864e5) // nota antiga: deixa para o cliente decidir
  && !(r.ciencia_erro_em && agora - new Date(r.ciencia_erro_em) < 6 * 3600e3);   // deu erro: tenta de novo em 6 h
export async function cienciaAutomatica(empresa_id, emp, amb){
  if (emp.ciencia_auto === false) return 0;
  const rows = await sb(`/rest/v1/docs?select=path,data&empresa_id=eq.${encodeURIComponent(empresa_id)}&col=eq.${encodeURIComponent('empresas/' + empresa_id + '/recebidas')}&data->>manifestacao=eq.nulo&limit=300`) || [];
  const fila = rows.filter(r => precisaCiencia(r.data)).slice(0, CIENCIA_MAX); let feitas = 0;
  for (const row of fila){
    const r = await focus('POST', `/v2/nfes_recebidas/${row.data.chave}/manifesto`, { tipo:'ciencia' }, { amb }), m = mensagemFocus(r.body);
    const certo = ok(r.status) && !(r.body && r.body.status && !/registrado|autorizado|duplic/i.test(r.body.status + ' ' + m));
    await putDoc(row.path, certo ? { ...row.data, manifestacao:'ciencia', manifestado_em:isoBR(), ciencia_auto:true }
      : { ...row.data, ciencia_erro_em:isoBR(), ciencia_erro:m || `HTTP ${r.status}` }, null);
    if (certo) feitas++;
  }
  return feitas;
}

// empresas que já buscaram notas alguma vez ou ligaram a Manifestação pelo sistema
export const temMde = e => !!(e && ((e.mde && e.mde.sinc_em) || (e.certificado && e.certificado.manifestacao)));
const cronOk = req => !!process.env.CRON_SECRET && (req.headers.authorization || '') === 'Bearer ' + process.env.CRON_SECRET;

async function cron(req, res){
  if (!cronOk(req)) return res.status(401).json({ erro:'Acesso negado.' });
  const rows = await sb('/rest/v1/docs?select=path,data&col=eq.empresas&limit=5000') || [];
  const agora = Date.now(), fila = rows.filter(r => temMde(r.data) && dig((r.data || {}).cnpj).length === 14
    && !(r.data.mde && r.data.mde.sinc_em && agora - new Date(r.data.mde.sinc_em) < 30 * 60e3));
  const out = []; let i = 0;
  await Promise.all(Array.from({ length:4 }, async () => { while (i < fila.length){ const row = fila[i++], id = row.path.split('/')[1];
    try { out.push({ id, ...(await buscarNotas(id, row.data, null)) }); }
    catch(err){ out.push({ id, ok:false, erro:err.message }); }
  } }));
  return res.status(200).json({ ok:true, total:fila.length, novas:out.reduce((a, o) => a + (o.gravadas || 0), 0), resultado:out });
}

export default async function handler(req, res){
  if (req.method === 'GET'){
    try { return await cron(req, res); }
    catch(err){ console.error(err); return res.status(500).json({ erro:err.message || 'Erro inesperado.' }); }
  }
  return pedido(req, res);
}

const pedido = rota(async (req, b) => {
  const u = await usuario(req);
  const { empresa_id, acao } = b;
  if (!empresa_id || !acao) throw new Falha('Requisição incompleta.');
  const papel = await papelDe(empresa_id, u.id);
  if (!papel) throw new Falha('Você não tem acesso a esta empresa.', 403);
  if (papel === 'operador') throw new Falha('As notas recebidas são só para gerente ou dono.', 403);
  const emp = await getDoc('empresas/' + empresa_id);
  if (!emp) throw new Falha('Empresa não encontrada.', 404);
  const amb = ambienteMde(), base = `empresas/${empresa_id}/recebidas/`;

  if (acao === 'buscar') return buscarNotas(empresa_id, emp, u.id);

  const chave = dig(b.chave);
  if (chave.length !== 44) throw new Falha('Chave de acesso inválida.');
  const path = base + chave, atual = await getDoc(path);

  if (acao === 'manifestar'){
    const tipo = TIPOS[b.tipo];
    if (!tipo) throw new Falha('Tipo de manifestação inválido.');
    const just = String(b.justificativa || '').replace(/\s+/g, ' ').trim();
    if (tipo === 'nao_realizada' && (just.length < 15 || just.length > 255)) throw new Falha('Escreva o motivo com pelo menos 15 caracteres.');
    const r = await focus('POST', `/v2/nfes_recebidas/${chave}/manifesto`, { tipo, ...(tipo === 'nao_realizada' ? { justificativa:just } : {}) }, { amb });
    const m = mensagemFocus(r.body);
    if (!ok(r.status) || (r.body.status && !/registrado|autorizado|duplic/i.test(r.body.status + ' ' + m)))
      return { ok:false, mensagem:m || `A SEFAZ não registrou a manifestação (HTTP ${r.status}).` };
    const novo = { ...(atual || { chave }), manifestacao:tipo, manifestado_em:isoBR(), manifestado_por:u.id, ...(just ? { justificativa:just } : {}) };
    await putDoc(path, novo, u.id);
    return { ok:true, recebida:novo, mensagem:m };
  }

  if (acao === 'xml'){
    const r = await focus('GET', `/v2/nfes_recebidas/${chave}.xml`, undefined, { amb, texto:true });
    if (ok(r.status) && /<infNFe/.test(r.texto || '')) return { ok:true, xml:r.texto };
    // depois da ciência a SEFAZ leva alguns minutos (às vezes mais) para liberar a nota completa: a tela espera e tenta de novo
    return { ok:false, pendente:true, mensagem:'A SEFAZ ainda não liberou a nota completa.' };
  }

  throw new Falha('Ação desconhecida.');
});
