// Testes da mensalidade pelo Asaas (rode: npm test). Supabase e Asaas simulados.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.ASAAS_API_KEY = 'chave-teste';
process.env.ASAAS_ATIVO = 'sim';
process.env.ASAAS_WEBHOOK_TOKEN = 'segredo-webhook';
delete process.env.ASAAS_AMBIENTE;

const { default: handler, montarSituacao, primeiroVenc } = await import('../api/asaas.js');

let docs, membros, chamadas, pagamentos, assinaturas, clientes;
beforeEach(() => {
  docs = { 'empresas/E1': { cnpj:'11.222.333/0001-81', razao:'CARNE DE SOL LTDA', fantasia:'Carne de Sol', telefone:'(86) 98193-1921' } };
  membros = { 'E1|U1':'dono', 'E1|U3':'operador' };
  chamadas = []; pagamentos = []; assinaturas = {}; clientes = [];
  globalThis.fetch = async (url, opt = {}) => {
    const u = new URL(url), method = opt.method || 'GET', body = opt.body ? JSON.parse(opt.body) : undefined;
    chamadas.push({ host:u.host, url:u.pathname + u.search, method, body, headers:opt.headers });
    const json = (o, s = 200) => ({ ok:s < 400, status:s, text:async () => JSON.stringify(o), json:async () => o });
    if (u.host === 'sb.test'){
      if (u.pathname === '/auth/v1/user') return opt.headers.Authorization === 'Bearer t1' ? json({ id:'U1', email:'dono@x.com' }) : opt.headers.Authorization === 'Bearer t3' ? json({ id:'U3' }) : json({}, 401);
      if (u.pathname === '/rest/v1/membros'){ const e = u.searchParams.get('empresa_id').slice(3), id = u.searchParams.get('user_id').slice(3); const p = membros[e + '|' + id]; return json(p ? [{ papel:p }] : []); }
      if (u.pathname === '/rest/v1/rpc/gravar_campo_empresa'){ docs['empresas/' + body.e][body.caminho[0]] = body.valor; return json(null); }
      if (u.pathname === '/rest/v1/docs'){
        const p = u.searchParams.get('path'); if (p){ const d = docs[p.slice(3)]; return json(d ? [{ data:d }] : []); }
        const sid = (u.searchParams.get('data->assinatura->>id') || '').slice(3);
        return json(Object.entries(docs).filter(([k, v]) => k.split('/').length === 2 && (v.assinatura || {}).id === sid).map(([path, data]) => ({ path, data })));
      }
    }
    if (u.host === 'api-sandbox.asaas.com'){
      if (opt.headers.access_token !== 'chave-teste') return json({ errors:[{ description:'chave inválida' }] }, 401);
      const p = u.pathname.replace('/v3', '');
      if (p === '/customers' && method === 'GET') return json({ data:clientes.filter(c => c.cpfCnpj === u.searchParams.get('cpfCnpj')) });
      if (p === '/customers' && method === 'POST'){ const c = { id:'cus_1', ...body }; clientes.push(c); return json(c); }
      if (p === '/subscriptions' && method === 'POST'){
        const s = { id:'sub_1', status:'ACTIVE', ...body }; assinaturas[s.id] = s;
        pagamentos.push({ id:'pay_1', subscription:s.id, value:body.value, dueDate:body.nextDueDate, status:'PENDING', invoiceUrl:'https://asaas/i/1' });
        return json(s);
      }
      if (p.startsWith('/subscriptions/')) return json(assinaturas[p.split('/')[2]] || {}, assinaturas[p.split('/')[2]] ? 200 : 404);
      if (p === '/payments') return json({ data:pagamentos.filter(x => x.subscription === u.searchParams.get('subscription')) });
      if (p.endsWith('/identificationField')) return json({ identificationField:'00190000090123456789012345678901234567890123456', barCode:'00191234500000089990000001234567890123456789', nossoNumero:'123' });
      if (p.endsWith('/pixQrCode')) return json({ encodedImage:'QUJD', payload:'00020126pix', expirationDate:'2026-12-01 23:59:59' });
      if (p.startsWith('/payments/')){ const x = pagamentos.find(y => y.id === p.split('/')[2]); return x ? json(x) : json({ errors:[{ description:'não encontrado' }] }, 404); }
    }
    throw new Error('URL inesperada ' + url);
  };
});

function chamar(req){
  return new Promise(resolve => {
    const res = { code:0, status(c){ this.code = c; return this; }, json(o){ resolve({ code:this.code, body:o }); }, setHeader(){} };
    handler({ method:'POST', headers:{}, ...req }, res);
  });
}
const tela = (token, body) => chamar({ headers:{ authorization:'Bearer ' + token }, body });

test('assinar: cria cliente e assinatura mensal no Asaas e grava a situação na empresa', async () => {
  const r = await tela('t1', { empresa_id:'E1', acao:'assinar' });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const cli = chamadas.find(c => c.url === '/v3/customers' && c.method === 'POST').body;
  assert.equal(cli.cpfCnpj, '11222333000181'); assert.equal(cli.email, 'dono@x.com'); assert.equal(cli.externalReference, 'E1'); assert.equal(cli.mobilePhone, '86981931921');
  const sub = chamadas.find(c => c.url === '/v3/subscriptions' && c.method === 'POST').body;
  assert.equal(sub.value, 89.99); assert.equal(sub.nextDueDate, primeiroVenc());
  assert.equal(primeiroVenc('2026-11-24'), '2026-12-24'); assert.equal(primeiroVenc('2026-01-31'), '2026-03-02'); assert.equal(sub.cycle, 'MONTHLY'); assert.equal(sub.billingType, 'UNDEFINED');
  const a = docs['empresas/E1'].assinatura;
  assert.equal(a.id, 'sub_1'); assert.equal(a.ambiente, 'sandbox'); assert.equal(a.situacao, 'em_dia');
  assert.equal(a.aberta.id, 'pay_1'); assert.equal(a.aberta.link, 'https://asaas/i/1');
  assert.ok(chamadas.every(c => c.host !== 'api-sandbox.asaas.com' || c.headers['User-Agent']));
});

test('assinar de novo é recusado e operador não mexe na mensalidade', async () => {
  await tela('t1', { empresa_id:'E1', acao:'assinar' });
  const r = await tela('t1', { empresa_id:'E1', acao:'assinar' });
  assert.equal(r.code, 400); assert.match(r.body.erro, /já tem/);
  const o = await tela('t3', { empresa_id:'E1', acao:'situacao' });
  assert.equal(o.code, 403);
});

test('interruptor: sem ASAAS_ATIVO=sim a mensalidade fica desligada', async () => {
  delete process.env.ASAAS_ATIVO;
  try { const r = await tela('t1', { empresa_id:'E1', acao:'assinar' }); assert.equal(r.code, 503); assert.ok(!chamadas.some(c => c.host === 'api-sandbox.asaas.com')); }
  finally { process.env.ASAAS_ATIVO = 'sim'; }
});

test('pix: devolve QR Code só de mensalidade da própria assinatura', async () => {
  await tela('t1', { empresa_id:'E1', acao:'assinar' });
  const r = await tela('t1', { empresa_id:'E1', acao:'pix', pagamento_id:'pay_1' });
  assert.equal(r.code, 200); assert.equal(r.body.imagem, 'QUJD'); assert.equal(r.body.copia, '00020126pix');
  pagamentos.push({ id:'pay_X', subscription:'sub_outra', value:10, dueDate:'2026-11-01', status:'PENDING' });
  const x = await tela('t1', { empresa_id:'E1', acao:'pix', pagamento_id:'pay_X' });
  assert.equal(x.code, 404);
});

test('boleto: devolve linha digitável e código de barras só da própria assinatura', async () => {
  await tela('t1', { empresa_id:'E1', acao:'assinar' });
  pagamentos[0].bankSlipUrl = 'https://asaas/b/1';
  const r = await tela('t1', { empresa_id:'E1', acao:'boleto', pagamento_id:'pay_1' });
  assert.equal(r.code, 200); assert.equal(r.body.barras.length, 44); assert.ok(r.body.linha.length >= 47); assert.equal(r.body.pdf, 'https://asaas/b/1');
  pagamentos.push({ id:'pay_Y', subscription:'sub_outra', value:10, dueDate:'2026-11-01', status:'PENDING' });
  assert.equal((await tela('t1', { empresa_id:'E1', acao:'boleto', pagamento_id:'pay_Y' })).code, 404);
});

test('webhook: confere o token e marca a mensalidade como paga', async () => {
  await tela('t1', { empresa_id:'E1', acao:'assinar' });
  const falso = await chamar({ headers:{ 'asaas-access-token':'errado' }, body:{ event:'PAYMENT_RECEIVED', payment:{ id:'pay_1', subscription:'sub_1' } } });
  assert.equal(falso.code, 401);
  pagamentos[0].status = 'RECEIVED'; pagamentos[0].paymentDate = '2026-11-24';
  const r = await chamar({ headers:{ 'asaas-access-token':'segredo-webhook' }, body:{ event:'PAYMENT_RECEIVED', payment:{ id:'pay_1', subscription:'sub_1' } } });
  assert.equal(r.code, 200);
  const a = docs['empresas/E1'].assinatura;
  assert.equal(a.aberta, null); assert.equal(a.situacao, 'em_dia'); assert.equal(a.ultimo_pagamento.pago_em, '2026-11-24');
  const outro = await chamar({ headers:{ 'asaas-access-token':'segredo-webhook' }, body:{ event:'PAYMENT_CREATED', payment:{ id:'p9', subscription:'sub_desconhecida' } } });
  assert.equal(outro.code, 200); assert.ok(outro.body.ignorado);
});

test('situação: cobrança vencida deixa a assinatura atrasada; assinatura inativa = cancelada', () => {
  const s = montarSituacao({ id:'sub_1', status:'ACTIVE', value:89.99, nextDueDate:'2026-12-10' },
    [{ id:'a', value:89.99, dueDate:'2026-10-10', status:'RECEIVED', paymentDate:'2026-10-09' }, { id:'b', value:89.99, dueDate:'2026-11-10', status:'OVERDUE' }]);
  assert.equal(s.situacao, 'atrasada'); assert.equal(s.aberta.id, 'b'); assert.equal(s.dia, 10); assert.equal(s.mensalidades[0].id, 'b');
  assert.equal(montarSituacao({ id:'sub_1', status:'INACTIVE' }, []).situacao, 'cancelada');
});
