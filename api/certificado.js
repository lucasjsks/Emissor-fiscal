// POST /api/certificado — envia o certificado digital A1 da empresa para a Focus NFe.
// O arquivo e a senha passam direto para a Focus: NÃO são gravados no banco nem em log.
// Usa a API de empresas da Focus (só existe em produção, com o token principal da conta: FOCUS_TOKEN_PRINCIPAL).
import { rota, Falha, usuario, papelDe, getDoc, rpc, focus, mensagemFocus, isoBR } from './_lib.js';

const dig = s => String(s || '').replace(/\D/g, '');
const ok = s => s >= 200 && s < 300;

// procura a empresa na conta da Focus pelo CNPJ
async function acharNaFocus(cnpj){
  let r = await focus('GET', `/v2/empresas?cnpj=${cnpj}`, undefined, { amb:'principal' });
  if (r.status === 401 || r.status === 403) throw new Falha('O token principal da Focus foi recusado. Confira a variável FOCUS_TOKEN_PRINCIPAL na Vercel.', 502);
  for (let offset = 0, voltas = 0; voltas < 20; voltas++){
    if (!ok(r.status)) throw new Falha(mensagemFocus(r.body) || `A Focus NFe não respondeu (HTTP ${r.status}).`, 502);
    const lista = Array.isArray(r.body) ? r.body : [];
    const achou = lista.find(x => dig(x.cnpj) === cnpj);
    if (achou || lista.length < 50) return achou || null;
    offset += lista.length;
    r = await focus('GET', `/v2/empresas?offset=${offset}`, undefined, { amb:'principal' });
  }
  return null;
}

export function dadosFocus(e){
  return { nome:e.razao, nome_fantasia:e.fantasia || e.razao, cnpj:dig(e.cnpj), inscricao_estadual:dig(e.ie), regime_tributario:String(e.regime || '1'),
    logradouro:e.logradouro, numero:e.numero, bairro:e.bairro, cep:dig(e.cep), municipio:e.municipio, uf:e.uf, telefone:dig(e.telefone), email:e.email || undefined,
    habilita_nfe:true, habilita_nfce:true };
}

export default rota(async (req, b) => {
  const u = await usuario(req);
  const { empresa_id } = b;
  if (!empresa_id) throw new Falha('Requisição incompleta.');
  const papel = await papelDe(empresa_id, u.id);
  if (papel !== 'dono') throw new Falha('Só o dono da empresa pode enviar o certificado digital.', 403);
  if (!process.env.FOCUS_TOKEN_PRINCIPAL) throw new Falha('Falta cadastrar na Vercel a variável FOCUS_TOKEN_PRINCIPAL (token principal da conta Focus, em Painel API → Tokens).', 500);
  const e = await getDoc('empresas/' + empresa_id);
  if (!e) throw new Falha('Empresa não encontrada.', 404);
  const cnpj = dig(e.cnpj);

  const arquivo = String(b.arquivo_base64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  const senha = String(b.senha || '');
  if (arquivo.length < 500 || arquivo.length > 300000 || !/^[A-Za-z0-9+/=]+$/.test(arquivo)) throw new Falha('Arquivo de certificado inválido. Use o certificado A1 (.pfx ou .p12).');
  if (!senha) throw new Falha('Informe a senha do certificado.');

  const extra = {};
  if (dig(b.csc_id) && String(b.csc || '').trim()){ extra.id_token_nfce_producao = dig(b.csc_id); extra.csc_nfce_producao = String(b.csc).trim(); }
  if (b.manifestacao) extra.habilita_manifestacao = true;

  const existente = await acharNaFocus(cnpj);
  const corpo = { arquivo_certificado_base64:arquivo, senha_certificado:senha, ...extra };
  const r = existente
    ? await focus('PUT', `/v2/empresas/${existente.id}`, corpo, { amb:'principal' })
    : await focus('POST', '/v2/empresas', { ...dadosFocus(e), ...corpo }, { amb:'principal' });
  if (!ok(r.status)){
    const m = mensagemFocus(r.body);
    return { ok:false, mensagem:/senha/i.test(m) ? 'A senha do certificado está errada.' : /vencid/i.test(m) ? 'Este certificado está vencido.' : /cnpj/i.test(m) ? `Este certificado não é do CNPJ da empresa. ${m}` : (m || `A Focus recusou o certificado (HTTP ${r.status}).`) };
  }
  const f = r.body || {};
  const info = { valido_ate:f.certificado_valido_ate || null, valido_de:f.certificado_valido_de || null, cnpj:dig(f.certificado_cnpj) || cnpj,
    enviado_em:isoBR(), enviado_por:u.id, focus_id:f.id || (existente && existente.id) || null, criada_na_focus:!existente,
    ...(extra.habilita_manifestacao ? { manifestacao:true } : {}), ...(extra.csc_nfce_producao ? { csc_producao:true } : {}) };
  await rpc('gravar_campo_empresa', { e:empresa_id, caminho:['certificado'], valor:info });
  return { ok:true, certificado:info };
});
