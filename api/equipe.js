// POST /api/equipe — funcionários da empresa (só o dono). O funcionário entra com o próprio e-mail e senha e tem papel
// 'operador': vende (Cupom/PDV/Caixa) e cadastra produtos e clientes; não vê custo, financeiro, relatórios nem cancela.
//   acao 'listar'  {empresa_id}
//   acao 'criar'   {empresa_id, nome, email, senha}   → cria o login (já confirmado) e dá o acesso
//   acao 'senha'   {empresa_id, user_id, senha}       → troca a senha do funcionário
//   acao 'remover' {empresa_id, user_id}              → tira o acesso (e apaga o login, se ele não tiver outro acesso)
// Limite do plano: empresa.limite_funcionarios (padrão 2; só o suporte muda — definir_limite_funcionarios no banco).
import { rota, Falha, env, usuario, papelDe, getDoc, sb, rpc } from './_lib.js';

export const LIMITE_PADRAO = 2;
const emailOk = s => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

async function authAdmin(method, path, body){
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(env('SUPABASE_URL') + '/auth/v1/admin' + path, { method,
    headers:{ apikey:key, ...(key.startsWith('eyJ') ? { Authorization:'Bearer ' + key } : {}), 'Content-Type':'application/json' },
    body:body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null;
  try { j = t ? JSON.parse(t) : null; } catch { j = { msg:t }; }
  return { status:r.status, ok:r.ok, body:j || {} };
}

// lista pública dos funcionários (nome e e-mail de login) para os quadros da tela "Quem vai usar o sistema?"
async function gravarLista(empresa_id, lista){
  await rpc('gravar_campo_empresa', { e:empresa_id, caminho:['funcionarios'], valor:lista.map(x => ({ user_id:x.user_id, nome:x.nome || x.email, email:x.email })) });
}
const operadores = empresa_id => sb(`/rest/v1/membros?select=user_id,criado_em&empresa_id=eq.${encodeURIComponent(empresa_id)}&papel=eq.operador`);
async function confereFuncionario(empresa_id, uid){
  if (!/^[0-9a-f-]{36}$/i.test(String(uid || ''))) throw new Falha('Funcionário não encontrado.', 404);
  if (await papelDe(empresa_id, uid) !== 'operador') throw new Falha('Funcionário não encontrado.', 404);
}

export default rota(async (req, b) => {
  const u = await usuario(req);
  const { empresa_id, acao } = b;
  if (!empresa_id) throw new Falha('Requisição incompleta.');
  if (await papelDe(empresa_id, u.id) !== 'dono') throw new Falha('Só o dono da empresa cuida dos funcionários.', 403);
  const e = await getDoc('empresas/' + empresa_id);
  if (!e) throw new Falha('Empresa não encontrada.', 404);
  const limite = Number.isInteger(e.limite_funcionarios) ? e.limite_funcionarios : LIMITE_PADRAO;

  if (acao === 'listar'){
    const lista = await Promise.all((await operadores(empresa_id) || []).map(async m => {
      const r = await authAdmin('GET', '/users/' + m.user_id), us = r.body || {};
      return { user_id:m.user_id, email:us.email || '', nome:(us.user_metadata || {}).nome || '', criado_em:m.criado_em, ultimo_acesso:us.last_sign_in_at || null };
    }));
    await gravarLista(empresa_id, lista);
    return { ok:true, funcionarios:lista, limite, senha_gerente:!!e.senha_gerente };
  }

  if (acao === 'criar'){
    const nome = String(b.nome || '').replace(/\s+/g, ' ').trim().slice(0, 80), email = String(b.email || '').trim().toLowerCase(), senha = String(b.senha || '');
    if (nome.length < 2) throw new Falha('Informe o nome do funcionário.');
    if (!emailOk(email)) throw new Falha('E-mail inválido.');
    if (senha.length < 8) throw new Falha('A senha precisa ter pelo menos 8 caracteres.');
    if (!e.senha_gerente) throw new Falha('Antes de cadastrar funcionários, crie a senha do gerente (logo acima, no quadro Funcionários).');
    const atuais = await operadores(empresa_id) || [];
    if (atuais.length >= limite) throw new Falha(limite ? `Seu plano permite ${limite} funcionário(s). Para liberar mais, fale com o suporte.` : 'Seu plano não inclui funcionários. Fale com o suporte.');
    const r = await authAdmin('POST', '/users', { email, password:senha, email_confirm:true, user_metadata:{ nome, funcionario:true } });
    if (!r.ok){
      const m = String(r.body.msg || r.body.message || r.body.error_description || r.body.error || '');
      if (r.status === 422 || /already|registered|exists/i.test(m)) throw new Falha('Este e-mail já tem uma conta no NotaOne. Use outro e-mail para o funcionário.');
      if (/password/i.test(m)) throw new Falha('Senha fraca: use pelo menos 8 caracteres, misturando letras e números.');
      throw new Falha('Não foi possível criar o acesso: ' + (m || 'HTTP ' + r.status), 502);
    }
    const novo = r.body.id || (r.body.user || {}).id;
    try { await sb('/rest/v1/membros', { method:'POST', prefer:'return=minimal', body:{ empresa_id, user_id:novo, papel:'operador' } }); }
    catch(err){ await authAdmin('DELETE', '/users/' + novo); throw err; } // não deixa login solto sem acesso
    await gravarLista(empresa_id, [...(e.funcionarios || []).filter(x => x.user_id !== novo), { user_id:novo, nome, email }]);
    return { ok:true, funcionario:{ user_id:novo, email, nome } };
  }

  if (acao === 'senha'){
    await confereFuncionario(empresa_id, b.user_id);
    const senha = String(b.senha || '');
    if (senha.length < 8) throw new Falha('A senha precisa ter pelo menos 8 caracteres.');
    const r = await authAdmin('PUT', '/users/' + b.user_id, { password:senha });
    if (!r.ok) throw new Falha('Não foi possível trocar a senha: ' + (r.body.msg || r.body.message || 'HTTP ' + r.status), 502);
    return { ok:true };
  }

  if (acao === 'remover'){
    await confereFuncionario(empresa_id, b.user_id);
    await sb(`/rest/v1/membros?empresa_id=eq.${encodeURIComponent(empresa_id)}&user_id=eq.${b.user_id}`, { method:'DELETE', prefer:'return=minimal' });
    const outros = await sb(`/rest/v1/membros?select=empresa_id&user_id=eq.${b.user_id}`);
    if (!outros || !outros.length) await authAdmin('DELETE', '/users/' + b.user_id); // libera o e-mail para outro cadastro
    await gravarLista(empresa_id, (e.funcionarios || []).filter(x => x.user_id !== b.user_id));
    return { ok:true };
  }
  throw new Falha('Ação desconhecida.');
});
