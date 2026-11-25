// Testes da loja cadastrada com CPF (venda sem nota) e dos funcionários (rode: npm test). Supabase simulado.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';

const { default: emitir } = await import('../api/emitir.js');
const { default: evento } = await import('../api/evento.js');
const { default: equipe } = await import('../api/equipe.js');
const { default: perfil } = await import('../api/perfil.js');

let docs, membros, chamadas, usuarios;
beforeEach(() => {
  docs = { 'empresas/E1': { doc_tipo:'cpf', cpf:'52998224725', fantasia:'Loja do Zé', prox_venda:1, serie_nfce:'1', prox_nfce:1, senha_gerente:true },
           'empresas/E2': { cnpj:'11222333000181', serie_nfce:'1', prox_nfce:5 } };
  membros = { 'E1|U1':'dono', 'E1|U3':'operador', 'E2|U1':'dono' };
  chamadas = []; usuarios = { U3:{ id:'U3', email:'ana@loja.com', user_metadata:{ nome:'Ana' } } };
  globalThis.fetch = async (url, opt = {}) => {
    const u = new URL(url), method = opt.method || 'GET', body = opt.body ? JSON.parse(opt.body) : undefined;
    chamadas.push({ host:u.host, url:u.pathname + u.search, method, body });
    const json = (o, s = 200) => ({ ok:s < 400, status:s, text:async () => JSON.stringify(o), json:async () => o });
    if (u.host !== 'sb.test') throw new Error('não devia chamar ' + url); // venda sem nota nunca vai para a Focus
    if (u.pathname === '/auth/v1/user') return { t1:json({ id:'U1' }), t3:json({ id:'U3' }) }[(opt.headers.Authorization || '').slice(7)] || json({}, 401);
    if (u.pathname === '/rest/v1/membros'){
      const e = (u.searchParams.get('empresa_id') || '').slice(3), id = (u.searchParams.get('user_id') || '').slice(3), papel = (u.searchParams.get('papel') || '').slice(3);
      if (method === 'POST'){ membros[body.empresa_id + '|' + body.user_id] = body.papel; return json(null, 201); }
      if (method === 'DELETE'){ delete membros[e + '|' + id]; return json(null, 204); }
      const rows = Object.entries(membros).map(([k, p]) => ({ empresa_id:k.split('|')[0], user_id:k.split('|')[1], papel:p, criado_em:'2026-11-25' }))
        .filter(m => (!e || m.empresa_id === e) && (!id || m.user_id === id) && (!papel || m.papel === papel));
      return json(rows);
    }
    if (u.pathname === '/rest/v1/rpc/proximo_numero'){ const d = docs['empresas/' + body.e]; const n = d[body.campo] || 1; d[body.campo] = n + 1; return json(n); }
    if (u.pathname === '/rest/v1/rpc/gravar_campo_empresa'){ docs['empresas/' + body.e][body.caminho[0]] = body.valor; return json(null); }
    if (u.pathname.startsWith('/rest/v1/rpc/')) return json(null);
    if (u.pathname === '/rest/v1/docs' && method === 'GET'){ const p = u.searchParams.get('path'); const d = p && docs[p.slice(3)]; return json(d ? [{ data:d }] : []); }
    if (u.pathname === '/rest/v1/docs' && method === 'POST'){ [].concat(body).forEach(b => { docs[b.path] = b.data; }); return json(null, 201); }
    if (u.pathname.startsWith('/auth/v1/admin/users')){
      if (u.pathname === '/auth/v1/admin/users/U1') return json({ id:'U1', email:'dono@loja.com' });
      const id = u.pathname.split('/')[5];
      if (method === 'POST'){ if (Object.values(usuarios).some(x => x.email === body.email)) return json({ msg:'A user with this email address has already been registered' }, 422);
        const n = { id:'00000000-0000-0000-0000-00000000000' + (Object.keys(usuarios).length + 4), email:body.email, user_metadata:body.user_metadata }; usuarios[n.id] = n; return json(n); }
      if (method === 'GET') return usuarios[id] ? json(usuarios[id]) : json({}, 404);
      if (method === 'PUT'){ usuarios[id].senha = body.password; return json(usuarios[id]); }
      if (method === 'DELETE'){ delete usuarios[id]; return json({}); }
    }
    if (u.pathname === '/auth/v1/admin/generate_link'){ return json({ properties:{ hashed_token:'tok-' + body.email } }); }
    if (u.pathname.startsWith('/auth/v1/admin/users/')){
    }
    throw new Error('URL inesperada ' + url);
  };
});
function chamar(handler, token, body){
  return new Promise(resolve => {
    const res = { code:0, status(c){ this.code = c; return this; }, json(o){ resolve({ code:this.code, body:o }); }, setHeader(){} };
    handler({ method:'POST', headers:{ authorization:token ? 'Bearer ' + token : '' }, body }, res);
  });
}
const venda = { total:30, itens:[{ pid:'p1', q:1, t:30 }], venda_id:'venda123abc' };

test('venda sem nota (empresa com CPF): número próprio, sem SEFAZ, registrada e baixa o estoque', async () => {
  const r = await chamar(emitir, 't3', { empresa_id:'E1', modelo:'99', payload:{ data_emissao:'2026-11-25T10:00:00-03:00' }, nota:venda });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.nota.numero, 1); assert.equal(r.body.nota.status, 'autorizada'); assert.equal(r.body.nota.modelo, '99'); assert.equal(r.body.nota.payload, null);
  assert.equal(docs['empresas/E1'].prox_venda, 2);
  assert.ok(chamadas.some(c => c.url === '/rest/v1/rpc/aplicar_estoque_nota' && c.body.desfazer === false));
  // a mesma venda mandada de novo não vira duas
  const r2 = await chamar(emitir, 't3', { empresa_id:'E1', modelo:'99', payload:{}, nota:venda });
  assert.equal(r2.body.repetida, true); assert.equal(docs['empresas/E1'].prox_venda, 2);
});

test('empresa com CPF não emite cupom fiscal; empresa com CNPJ não faz venda sem nota', async () => {
  assert.match((await chamar(emitir, 't1', { empresa_id:'E1', modelo:'65', payload:{}, nota:{} })).body.erro, /CPF não emite/);
  assert.match((await chamar(emitir, 't1', { empresa_id:'E2', modelo:'99', payload:{}, nota:{} })).body.erro, /emite nota fiscal/);
});

test('cancelar venda sem nota: funcionário não cancela; dono cancela e o estoque volta', async () => {
  const r = await chamar(emitir, 't1', { empresa_id:'E1', modelo:'99', payload:{}, nota:{ ...venda, venda_id:'outravenda1' } });
  const ref = r.body.nota.ref;
  assert.equal((await chamar(evento, 't3', { empresa_id:'E1', tipo:'cancelar', ref, justificativa:'cliente desistiu' })).code, 403);
  const c = await chamar(evento, 't1', { empresa_id:'E1', tipo:'cancelar', ref, justificativa:'cliente desistiu' });
  assert.equal(c.code, 200); assert.equal(docs['empresas/E1/notas/' + ref].status, 'cancelada');
  assert.ok(chamadas.some(x => x.url === '/rest/v1/rpc/aplicar_estoque_nota' && x.body.desfazer === true));
  assert.equal((await chamar(evento, 't1', { empresa_id:'E1', tipo:'cce', ref, texto:'x'.repeat(20) })).code, 400);
});

test('funcionários: só o dono lista, cria, troca senha e remove; respeita o limite', async () => {
  assert.equal((await chamar(equipe, 't3', { empresa_id:'E1', acao:'listar' })).code, 403);
  const l = await chamar(equipe, 't1', { empresa_id:'E1', acao:'listar' });
  assert.equal(l.body.funcionarios.length, 1); assert.equal(l.body.funcionarios[0].nome, 'Ana'); assert.equal(l.body.limite, 2);
  assert.match((await chamar(equipe, 't1', { empresa_id:'E1', acao:'criar', nome:'Bia', email:'bia@loja.com', senha:'123' })).body.erro, /8 caracteres/);
  const c = await chamar(equipe, 't1', { empresa_id:'E1', acao:'criar', nome:'Bia', senha:'12345678' });
  assert.equal(c.code, 200, JSON.stringify(c.body)); const uid = c.body.funcionario.user_id;
  assert.equal(membros['E1|' + uid], 'operador'); assert.match(usuarios[uid].email, /^func-e1-[0-9a-f]{10}@funcionarios\.notaone\.example\.com$/, 'e-mail interno gerado pelo servidor');
  assert.match((await chamar(equipe, 't1', { empresa_id:'E1', acao:'criar', nome:'bia', senha:'12345678' })).body.erro, /mesmo nome|com este nome/);
  assert.match((await chamar(equipe, 't1', { empresa_id:'E1', acao:'criar', nome:'Caio', email:'caio@loja.com', senha:'12345678' })).body.erro, /permite 2/);
  assert.equal((await chamar(equipe, 't1', { empresa_id:'E1', acao:'senha', user_id:uid, senha:'novasenha1' })).code, 200);
  assert.equal(usuarios[uid].senha, 'novasenha1');
  assert.equal((await chamar(equipe, 't1', { empresa_id:'E1', acao:'senha', user_id:'U1', senha:'novasenha1' })).code, 404, 'não troca a senha de quem não é funcionário');
  assert.equal((await chamar(equipe, 't1', { empresa_id:'E1', acao:'remover', user_id:uid })).code, 200);
  assert.equal(membros['E1|' + uid], undefined); assert.equal(usuarios[uid], undefined);
});

test('funcionários: sem senha do gerente não cadastra; a lista dos quadros fica na empresa', async () => {
  delete docs['empresas/E1'].senha_gerente;
  assert.match((await chamar(equipe, 't1', { empresa_id:'E1', acao:'criar', nome:'Bia', email:'bia@loja.com', senha:'12345678' })).body.erro, /senha do gerente/);
  docs['empresas/E1'].senha_gerente = true;
  const c = await chamar(equipe, 't1', { empresa_id:'E1', acao:'criar', nome:'Bia', email:'bia@loja.com', senha:'12345678' });
  assert.equal(c.code, 200);
  assert.deepEqual(docs['empresas/E1'].funcionarios.map(x => x.nome), ['Bia']);
});

test('senha do gerente: só o dono cria; confere; funcionária entra como gerente com a senha; bloqueia após 5 erros', async () => {
  assert.equal((await chamar(perfil, 't3', { empresa_id:'E1', acao:'definir', senha:'1234' })).code, 403);
  assert.equal((await chamar(perfil, 't1', { empresa_id:'E1', acao:'definir', senha:'4321' })).code, 200);
  const seg = docs['empresas/E1/segredos/gerente'];
  assert.ok(seg.hash && seg.sal && !JSON.stringify(seg).includes('4321'), 'a senha não fica guardada em texto');
  assert.equal(docs['empresas/E1'].senha_gerente, true);
  // trocar exige a senha atual
  assert.match((await chamar(perfil, 't1', { empresa_id:'E1', acao:'definir', senha:'9999', atual:'0000' })).body.erro, /atual/);
  // dono confere (sem token); funcionária recebe um acesso de uso único para a conta do dono
  assert.deepEqual((await chamar(perfil, 't1', { empresa_id:'E1', acao:'gerente', senha:'4321' })).body, { ok:true });
  const f = await chamar(perfil, 't3', { empresa_id:'E1', acao:'gerente', senha:'4321' });
  assert.equal(f.code, 200); assert.equal(f.body.token_hash, 'tok-dono@loja.com');
  for (let k = 0; k < 4; k++) assert.match((await chamar(perfil, 't3', { empresa_id:'E1', acao:'gerente', senha:'errada' })).body.erro, /incorreta/);
  assert.match((await chamar(perfil, 't3', { empresa_id:'E1', acao:'gerente', senha:'errada' })).body.erro, /bloqueado/);
  assert.equal((await chamar(perfil, 't3', { empresa_id:'E1', acao:'gerente', senha:'4321' })).code, 429, 'bloqueado mesmo com a senha certa');
});
