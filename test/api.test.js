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
    if (u.host === 'homologacao.focusnfe.com.br') return json(focusResp.body, focusResp.status);
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
