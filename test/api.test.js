// Testes das rotas /api com Supabase e Focus simulados (rode: npm test).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.FOCUS_TOKEN_HOMOLOGACAO = 'tok';

const { default: emitir, limparPayload } = await import('../api/emitir.js');
const { default: evento } = await import('../api/evento.js');

let docs, membros, chamadas, focusResp;
beforeEach(() => {
  docs = { 'empresas/E1': { cnpj:'11222333000181', serie_nfce:'1', prox_nfce:7, serie_nfe:'2', prox_nfe:3 } };
  membros = { 'E1|U1':'operador', 'E1|U2':'gerente' };
  chamadas = []; focusResp = { status:201, body:{ status:'autorizado', chave_nfe:'NFe22261111222333000181650010000000071000000017', caminho_danfe:'/d.html' } };
  globalThis.fetch = async (url, opt = {}) => {
    const u = new URL(url), body = opt.body ? JSON.parse(opt.body) : undefined;
    chamadas.push({ url:u.pathname + u.search, method:opt.method || 'GET', body });
    const json = (o, s = 200) => ({ ok:s < 400, status:s, text:async () => JSON.stringify(o), json:async () => o });
    if (u.host === 'sb.test'){
      if (u.pathname === '/auth/v1/user') return opt.headers.Authorization === 'Bearer t1' ? json({ id:'U1' }) : opt.headers.Authorization === 'Bearer t2' ? json({ id:'U2' }) : json({}, 401);
      if (u.pathname === '/rest/v1/membros'){ const e = u.searchParams.get('empresa_id').slice(3), id = u.searchParams.get('user_id').slice(3); const p = membros[e + '|' + id]; return json(p ? [{ papel:p }] : []); }
      if (u.pathname === '/rest/v1/rpc/proximo_numero'){ const d = docs['empresas/' + body.e]; const n = d[body.campo]; d[body.campo] = n + 1; return json(n); }
      if (u.pathname.startsWith('/rest/v1/rpc/')) return json(null);
      if (u.pathname === '/rest/v1/docs' && (opt.method || 'GET') === 'GET'){
        const p = u.searchParams.get('path'); if (p) { const d = docs[p.slice(3)]; return json(d ? [{ data:d }] : []); }
        const ch = u.searchParams.get('data->>chave'); const hit = Object.entries(docs).find(([, v]) => v.chave === (ch || '').slice(3));
        return json(hit ? [{ path:hit[0], data:hit[1] }] : []);
      }
      if (u.pathname === '/rest/v1/docs' && opt.method === 'POST'){ docs[body.path] = body.data; return json(null, 201); }
    }
    if (u.host === 'homologacao.focusnfe.com.br'){ const fr = typeof focusResp === 'function' ? focusResp(opt.method || 'GET') : focusResp; return json(fr.body, fr.status); }
    throw new Error('URL inesperada ' + url);
  };
});

function chamar(handler, token, body){
  return new Promise(resolve => {
    const res = { code:0, status(c){ this.code = c; return this; }, json(o){ resolve({ code:this.code, body:o }); }, setHeader(){} };
    handler({ method:'POST', headers:{ authorization:token ? 'Bearer ' + token : '' }, body }, res);
  });
}
const payload = { data_emissao:'2026-11-12T10:00:00-03:00', inscricao_estadual_emitente:'x', items:[{ cfop:'5102', _rtc:{} }] };

test('emite NFC-e: reserva número no servidor, limpa campos internos e grava autorizada', async () => {
  const r = await chamar(emitir, 't1', { empresa_id:'E1', modelo:'65', payload, nota:{ total:10, numero:999 } });
  assert.equal(r.code, 200);
  assert.equal(r.body.nota.numero, 7);
  assert.equal(r.body.nota.status, 'autorizada');
  assert.equal(r.body.nota.chave, '22261111222333000181650010000000071000000017');
  assert.equal(docs['empresas/E1'].prox_nfce, 8);
  const envio = chamadas.find(c => c.url.startsWith('/v2/nfce')).body;
  assert.equal(envio.numero, 7); assert.equal(envio.serie, '1'); assert.equal(envio.cnpj_emitente, '11222333000181');
  assert.equal(envio.inscricao_estadual_emitente, undefined); assert.equal(envio.items[0]._rtc, undefined);
  assert.ok(docs['empresas/E1/notas/' + r.body.nota.ref]);
  const est = chamadas.find(c => c.url === '/rest/v1/rpc/aplicar_estoque_nota');
  assert.deepEqual(est.body, { e:'E1', p_ref:r.body.nota.ref, desfazer:false });
});

test('rejeição da SEFAZ grava a nota como rejeitada com a mensagem', async () => {
  focusResp = { status:422, body:{ status:'erro_autorizacao', status_sefaz:'225', mensagem_sefaz:'Falha no Schema XML' } };
  const r = await chamar(emitir, 't1', { empresa_id:'E1', modelo:'65', payload, nota:{} });
  assert.equal(r.body.nota.status, 'rejeitada');
  assert.match(r.body.mensagem, /225 — Falha no Schema/);
  assert.ok(!chamadas.some(c => c.url === '/rest/v1/rpc/aplicar_estoque_nota'), 'nota rejeitada não mexe no estoque');
});

test('sem login → 401; sem acesso à empresa → 403; operador não faz devolução', async () => {
  assert.equal((await chamar(emitir, '', { empresa_id:'E1', modelo:'65', payload, nota:{} })).code, 401);
  assert.equal((await chamar(emitir, 't1', { empresa_id:'E9', modelo:'65', payload, nota:{} })).code, 403);
  assert.equal((await chamar(emitir, 't1', { empresa_id:'E1', modelo:'55', payload, nota:{ op:'dev_venda' } })).code, 403);
});

test('NF-e em processamento e devolução marcam a nota original', async () => {
  docs['empresas/E1/notas/orig'] = { chave:'1234', total:50 };
  focusResp = { status:202, body:{ status:'processando_autorizacao' } };
  const r = await chamar(emitir, 't2', { empresa_id:'E1', modelo:'55', payload, nota:{ op:'dev_venda', total:50 }, extras:{ refChave:'1234' } });
  assert.equal(r.body.nota.status, 'processando'); assert.equal(r.body.nota.serie, '2'); assert.equal(r.body.nota.numero, 3);
  assert.equal(docs['empresas/E1/notas/orig'].devolucoes.length, 1);
});

test('cancelamento: operador barrado; gerente cancela nota autorizada', async () => {
  docs['empresas/E1/notas/R1'] = { ref:'R1', modelo:'65', status:'autorizada' };
  assert.equal((await chamar(evento, 't1', { empresa_id:'E1', tipo:'cancelar', ref:'R1', justificativa:'erro de digitação no item' })).code, 403);
  focusResp = { status:200, body:{ status:'cancelado' } };
  const r = await chamar(evento, 't2', { empresa_id:'E1', tipo:'cancelar', ref:'R1', justificativa:'erro de digitação no item' });
  assert.equal(r.body.ok, true); assert.equal(docs['empresas/E1/notas/R1'].status, 'cancelada');
  assert.ok(chamadas.some(c => c.method === 'DELETE'));
  assert.deepEqual(chamadas.find(c => c.url === '/rest/v1/rpc/aplicar_estoque_nota').body, { e:'E1', p_ref:'R1', desfazer:true });
});

test('carta de correção e inutilização', async () => {
  docs['empresas/E1/notas/R2'] = { ref:'R2', modelo:'55', status:'autorizada' };
  focusResp = { status:200, body:{ status:'autorizado' } };
  const c = await chamar(evento, 't2', { empresa_id:'E1', tipo:'cce', ref:'R2', texto:'Endereço de entrega correto: Rua C, 200' });
  assert.equal(c.body.ok, true); assert.equal(docs['empresas/E1/notas/R2'].eventos[0].seq, 1);
  const i = await chamar(evento, 't2', { empresa_id:'E1', tipo:'inutilizar', modelo:'65', serie:'1', ini:3, fim:4, justificativa:'numeração pulada por falha' });
  assert.equal(i.body.ok, true); assert.ok(docs['empresas/E1/inutilizacoes/65-1-3-4']);
  assert.ok(chamadas.some(x => x.url === '/rest/v1/rpc/ajustar_proximo'));
});

test('limparPayload não altera o original', () => {
  const p = { inscricao_estadual_emitente:'1', items:[{ _rtc:1, a:1 }] }, o = limparPayload(p);
  assert.equal(p.items[0]._rtc, 1); assert.deepEqual(o.items[0], { a:1 });
});

// ---------- notas recebidas (Manifestação do Destinatário) ----------
const { default: recebidas } = await import('../api/recebidas.js');
const rec = (n, v, extra = {}) => ({ chave_nfe:'2226111122233300018155001000000' + String(n).padStart(3, '0') + '1000000017', nome_emitente:'FORNECEDOR ' + n,
  documento_emitente:'08635703000602', valor_total:'100.50', data_emissao:'2026-11-10T10:00:00-03:00', situacao:'autorizada', manifestacao_destinatario:'nulo', nfe_completa:false, versao:v, ...extra });

test('notas recebidas: operador não acessa', async () => {
  const r = await chamar(recebidas, 't1', { empresa_id:'E1', acao:'buscar' });
  assert.equal(r.code, 403);
});

test('notas recebidas: busca a partir da última versão, grava todas de uma vez e guarda a versão', async () => {
  docs['empresas/E1'].mde = undefined; docs['empresas/E1'].mde_versao = 5;
  focusResp = { status:200, body:[rec(1, 6), rec(2, 9, { situacao:'cancelada' })] };
  const lotes = []; const fetchOrig = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => { if (String(url).includes('/rest/v1/docs?on_conflict') && opt.body) lotes.push(JSON.parse(opt.body)); return fetchOrig(url, opt); };
  const r = await chamar(recebidas, 't2', { empresa_id:'E1', acao:'buscar' });
  assert.equal(r.code, 200); assert.equal(r.body.gravadas, 2);
  const busca = chamadas.find(c => c.url.startsWith('/v2/nfes_recebidas'));
  assert.equal(busca.url, '/v2/nfes_recebidas?cnpj=11222333000181&versao=5');
  assert.equal(lotes.length, 1); assert.equal(lotes[0].length, 2);
  assert.equal(lotes[0][1].data.situacao, 'cancelada'); assert.equal(lotes[0][0].col, 'empresas/E1/recebidas');
  const v = chamadas.find(c => c.url === '/rest/v1/rpc/gravar_campo_empresa');
  assert.deepEqual(v.body.caminho, ['mde']); assert.equal(v.body.valor.versao, 9);
});

test('notas recebidas: operação não realizada exige motivo; ciência grava a manifestação', async () => {
  const chave = rec(1, 1).chave_nfe;
  let r = await chamar(recebidas, 't2', { empresa_id:'E1', acao:'manifestar', chave, tipo:'nao_realizada', justificativa:'curto' });
  assert.equal(r.code, 400);
  focusResp = { status:200, body:{ status:'evento_registrado', status_sefaz:'135', mensagem_sefaz:'Evento registrado e vinculado a NF-e' } };
  r = await chamar(recebidas, 't2', { empresa_id:'E1', acao:'manifestar', chave, tipo:'ciencia' });
  assert.equal(r.code, 200); assert.equal(r.body.ok, true);
  const env = chamadas.find(c => c.url.endsWith('/manifesto'));
  assert.equal(env.url, `/v2/nfes_recebidas/${chave}/manifesto`); assert.deepEqual(env.body, { tipo:'ciencia' });
  assert.equal(docs[`empresas/E1/recebidas/${chave}`].manifestacao, 'ciencia');
});

test('envia a nota por e-mail pela Focus (operador pode)', async () => {
  docs['empresas/E1/notas/R1'] = { ref:'R1', modelo:'65', status:'autorizada' };
  let r = await chamar(evento, 't1', { empresa_id:'E1', tipo:'email', ref:'R1', emails:['x'] });
  assert.equal(r.code, 400);
  focusResp = { status:200, body:{} };
  r = await chamar(evento, 't1', { empresa_id:'E1', tipo:'email', ref:'R1', emails:['cliente@ex.com'] });
  assert.equal(r.code, 200); assert.equal(r.body.ok, true);
  const env = chamadas.find(c => c.url === '/v2/nfce/R1/email');
  assert.deepEqual(env.body, { emails:['cliente@ex.com'] });
  assert.deepEqual(docs['empresas/E1/notas/R1'].enviada_para, ['cliente@ex.com']);
});

// ---------- certificado digital pelo sistema ----------
const { default: certificado } = await import('../api/certificado.js');
test('certificado: só o dono envia; senha e arquivo vão para a Focus e não são gravados', async () => {
  membros['E1|U3'] = 'dono'; process.env.FOCUS_TOKEN_PRINCIPAL = 'princ';
  const fetchOrig = globalThis.fetch, focusCalls = [];
  globalThis.fetch = async (url, opt = {}) => {
    const u = new URL(url);
    if (u.pathname === '/auth/v1/user' && opt.headers.Authorization === 'Bearer t3') return { ok:true, status:200, text:async () => '{"id":"U3"}', json:async () => ({ id:'U3' }) };
    if (u.host === 'api.focusnfe.com.br'){
      focusCalls.push({ url:u.pathname + u.search, method:opt.method, body:opt.body ? JSON.parse(opt.body) : null, auth:opt.headers.Authorization });
      const body = u.pathname === '/v2/empresas' && (opt.method || 'GET') === 'GET' ? [{ id:77, cnpj:'11222333000181' }] : { id:77, certificado_valido_ate:'2027-10-01T10:00:00-03:00', certificado_cnpj:'11222333000181' };
      return { ok:true, status:200, text:async () => JSON.stringify(body) };
    }
    return fetchOrig(url, opt);
  };
  let r = await chamar(certificado, 't2', { empresa_id:'E1', arquivo_base64:'A'.repeat(800), senha:'x' });
  assert.equal(r.code, 403);
  r = await chamar(certificado, 't3', { empresa_id:'E1', arquivo_base64:'A'.repeat(800), senha:'segredo', manifestacao:true });
  assert.equal(r.code, 200); assert.equal(r.body.ok, true);
  const put = focusCalls.find(c => c.method === 'PUT');
  assert.equal(put.url, '/v2/empresas/77'); assert.equal(put.body.senha_certificado, 'segredo'); assert.equal(put.body.habilita_manifestacao, true);
  assert.equal(put.auth, 'Basic ' + Buffer.from('princ:').toString('base64'));
  const grav = chamadas.find(c => c.url === '/rest/v1/rpc/gravar_campo_empresa');
  assert.equal(grav.body.valor.valido_ate, '2027-10-01T10:00:00-03:00');
  assert.ok(!JSON.stringify(grav.body).includes('segredo') && !JSON.stringify(grav.body).includes('AAAA'));
  globalThis.fetch = fetchOrig; delete process.env.FOCUS_TOKEN_PRINCIPAL;
});

// ---------- ambiente escolhido no sistema ----------
const { default: ambienteRota } = await import('../api/ambiente.js');
test('ambiente: só o dono troca; produção exige certificado válido e troca a numeração', async () => {
  membros['E1|U3'] = 'dono'; process.env.FOCUS_TOKEN_PRINCIPAL = 'princ';
  const fetchOrig = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => {
    const u = new URL(url);
    if (u.pathname === '/auth/v1/user' && opt.headers.Authorization === 'Bearer t3') return { ok:true, status:200, text:async () => '{"id":"U3"}', json:async () => ({ id:'U3' }) };
    if (u.pathname === '/rest/v1/rpc/gravar_campo_empresa'){ const b = JSON.parse(opt.body); docs['empresas/' + b.e][b.caminho[0]] = b.valor; return { ok:true, status:200, text:async () => 'null' }; }
    return fetchOrig(url, opt);
  };
  let r = await chamar(ambienteRota, 't2', { empresa_id:'E1', ambiente:'producao', confirmo:true });
  assert.equal(r.code, 403);
  r = await chamar(ambienteRota, 't3', { empresa_id:'E1', ambiente:'producao', confirmo:true });
  assert.equal(r.code, 400); assert.match(r.body.erro, /certificado/);
  docs['empresas/E1'].certificado = { valido_ate:'2099-01-01T00:00:00-03:00' };
  r = await chamar(ambienteRota, 't3', { empresa_id:'E1', ambiente:'producao', confirmo:true, prox_nfce:'150' });
  assert.equal(r.code, 200);
  const d = docs['empresas/E1'];
  assert.equal(d.ambiente, 'producao'); assert.equal(d.prox_nfce, 150); assert.equal(d.prox_nfe, 1);
  assert.deepEqual(d.numeracao.homologacao, { serie_nfce:'1', prox_nfce:7, serie_nfe:'2', prox_nfe:3 });
  // emissão vai para a Focus de produção com o token de produção (aqui, o principal)
  const fetch2 = globalThis.fetch; let host = '', auth = '';
  globalThis.fetch = async (url, opt = {}) => { const u = new URL(url); if (u.host === 'api.focusnfe.com.br'){ host = u.host; auth = opt.headers.Authorization; return { ok:true, status:201, text:async () => JSON.stringify({ status:'autorizado' }) }; } return fetch2(url, opt); };
  r = await chamar(emitir, 't1', { empresa_id:'E1', modelo:'65', payload, nota:{ total:10 } });
  assert.equal(r.body.nota.ambiente, 'producao'); assert.equal(host, 'api.focusnfe.com.br'); assert.match(r.body.nota.ref, /-p$/);
  assert.equal(auth, 'Basic ' + Buffer.from('princ:').toString('base64'));
  // volta para homologação e recupera a numeração de teste
  globalThis.fetch = fetch2;
  r = await chamar(ambienteRota, 't3', { empresa_id:'E1', ambiente:'homologacao' });
  assert.equal(r.code, 200); assert.equal(d.prox_nfce, 7); assert.equal(d.numeracao.producao.prox_nfce, 151);
  globalThis.fetch = fetchOrig; delete process.env.FOCUS_TOKEN_PRINCIPAL;
});

// ---------- corrigir nota rejeitada e reenviar ----------
test('reenvio de nota rejeitada usa o mesmo número e a mesma referência', async () => {
  docs['empresas/E1/notas/R1'] = { id:'R1', ref:'R1', modelo:'55', numero:3, serie:'2', status:'rejeitada', ambiente:'homologacao', data:'2026-11-17T10:00:00-03:00', focus:{ status_sefaz:'225', mensagem_sefaz:'Falha no Schema' } };
  docs['empresas/E1'].prox_nfe = 4;
  focusResp = m => m === 'GET' ? { status:200, body:{ status:'erro_autorizacao' } } : { status:201, body:{ status:'autorizado', chave_nfe:'NFe1' } };
  const r = await chamar(emitir, 't2', { empresa_id:'E1', modelo:'55', payload, nota:{ total:10 }, reenviar:'R1' });
  assert.equal(r.body.nota.status, 'autorizada'); assert.equal(r.body.nota.numero, 3); assert.equal(r.body.nota.ref, 'R1');
  assert.equal(docs['empresas/E1'].prox_nfe, 4, 'não gasta número novo');
  assert.ok(chamadas.some(c => c.method === 'POST' && c.url === '/v2/nfe?ref=R1'));
  assert.equal(docs['empresas/E1/notas/R1'].tentativas[0].cod, '225');
});

test('reenvio após duplicidade (539) sai com número novo e marca a antiga', async () => {
  docs['empresas/E1/notas/R2'] = { id:'R2', ref:'R2', modelo:'55', numero:1, serie:'2', status:'rejeitada', ambiente:'homologacao', focus:{ status_sefaz:'539', mensagem_sefaz:'Duplicidade de NF-e' } };
  focusResp = m => m === 'GET' ? { status:200, body:{ status:'erro_autorizacao' } } : { status:201, body:{ status:'autorizado' } };
  const r = await chamar(emitir, 't2', { empresa_id:'E1', modelo:'55', payload, nota:{}, reenviar:'R2' });
  assert.equal(r.body.nota.numero, 3); assert.notEqual(r.body.nota.ref, 'R2');
  assert.equal(docs['empresas/E1/notas/R2'].corrigida_por.numero, 3);
  const r2 = await chamar(emitir, 't2', { empresa_id:'E1', modelo:'55', payload, nota:{}, reenviar:'R2' });
  assert.equal(r2.code, 400, 'não deixa corrigir duas vezes');
});

test('reenvio não manda de novo se a nota já estava autorizada na Focus', async () => {
  docs['empresas/E1/notas/R3'] = { id:'R3', ref:'R3', modelo:'65', numero:5, serie:'1', status:'erro_envio', ambiente:'homologacao' };
  focusResp = m => m === 'GET' ? { status:200, body:{ status:'autorizado', chave_nfe:'NFe99' } } : { status:500, body:{} };
  const r = await chamar(emitir, 't1', { empresa_id:'E1', modelo:'65', payload, nota:{}, reenviar:'R3' });
  assert.equal(r.body.nota.status, 'autorizada'); assert.equal(r.body.nota.chave, '99');
  assert.ok(!chamadas.some(c => c.method === 'POST' && c.url.startsWith('/v2/nfce')));
  docs['empresas/E1/notas/R4'] = { id:'R4', ref:'R4', modelo:'65', numero:6, status:'autorizada', ambiente:'homologacao' };
  assert.equal((await chamar(emitir, 't1', { empresa_id:'E1', modelo:'65', payload, nota:{}, reenviar:'R4' })).code, 400);
});

test('carta de correção guarda os caminhos da Focus e o protocolo lido do XML', async () => {
  docs['empresas/E1/notas/R5'] = { ref:'R5', modelo:'55', status:'autorizada' };
  focusResp = m => m === 'GET' ? { status:200, body:'<retEvento><infEvento><nProt>222260000123456</nProt><dhRegEvento>2026-11-17T16:20:00-03:00</dhRegEvento></infEvento></retEvento>' }
    : { status:200, body:{ status:'autorizado', caminho_xml_carta_correcao:'/arquivos/cce.xml', caminho_pdf_carta_correcao:'/arquivos/cce.pdf' } };
  const c = await chamar(evento, 't2', { empresa_id:'E1', tipo:'cce', ref:'R5', texto:'Endereço de entrega correto: Rua C, 200' });
  const ev = docs['empresas/E1/notas/R5'].eventos[0];
  assert.equal(c.body.ok, true); assert.equal(ev.protocolo, '222260000123456'); assert.equal(ev.registro, '2026-11-17T16:20:00-03:00');
  assert.equal(ev.focus.caminho_pdf_carta_correcao, '/arquivos/cce.pdf');
});
