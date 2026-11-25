// POST /api/perfil — tela "Quem vai usar o sistema?" (loja com funcionários).
// A loja entra com o e-mail e a senha da conta (a do dono). Depois cada pessoa escolhe o seu quadro e digita a SUA senha:
//   - Gerente: "senha do gerente" (diferente da senha da loja), guardada só aqui no servidor (hash scrypt) em
//     empresas/<id>/segredos/gerente — a tela não lê nem grava essa coleção (RLS).
//   - Funcionário: a senha do login dele (a tela entra direto com signInWithPassword; papel 'operador').
//   acao 'definir' {empresa_id, senha, atual?}  → só o dono (na tela de gerente) cria ou troca a senha do gerente
//   acao 'gerente' {empresa_id, senha}          → confere a senha do gerente. Se quem chamou não é o dono (ex.: a funcionária
//                                                 está logada no computador), devolve um token para entrar na conta do dono.
// 5 senhas erradas seguidas bloqueiam por 10 minutos.
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { rota, Falha, env, usuario, papelDe, getDoc, putDoc, rpc, sb, isoBR } from './_lib.js';

const hashSenha = (senha, sal = randomBytes(16).toString('hex')) => ({ sal, hash:scryptSync(String(senha), sal, 32).toString('hex') });
const confere = (senha, s) => { const h = Buffer.from(hashSenha(senha, s.sal).hash, 'hex'), c = Buffer.from(String(s.hash || ''), 'hex'); return h.length === c.length && timingSafeEqual(h, c); };
export const MAX_ERROS = 5, BLOQUEIO_MIN = 10;

async function authAdmin(method, path, body){
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(env('SUPABASE_URL') + '/auth/v1/admin' + path, { method,
    headers:{ apikey:key, ...(key.startsWith('eyJ') ? { Authorization:'Bearer ' + key } : {}), 'Content-Type':'application/json' },
    body:body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = null; }
  return { ok:r.ok, status:r.status, body:j || {} };
}

export default rota(async (req, b) => {
  const u = await usuario(req);
  const { empresa_id, acao } = b, senha = String(b.senha || '');
  if (!empresa_id) throw new Falha('Requisição incompleta.');
  const papel = await papelDe(empresa_id, u.id);
  if (!papel) throw new Falha('Você não tem acesso a esta empresa.', 403);
  const caminho = `empresas/${empresa_id}/segredos/gerente`, seg = await getDoc(caminho);

  if (acao === 'definir'){
    if (papel !== 'dono') throw new Falha('Só o dono define a senha do gerente.', 403);
    if (seg && seg.hash && !confere(String(b.atual || ''), seg)) throw new Falha('A senha atual do gerente não confere.');
    if (senha.length < 4) throw new Falha('A senha do gerente precisa ter pelo menos 4 caracteres.');
    await putDoc(caminho, { ...hashSenha(senha), em:isoBR(), erros:0, bloqueado_ate:null }, u.id);
    await rpc('gravar_campo_empresa', { e:empresa_id, caminho:['senha_gerente'], valor:true });
    return { ok:true };
  }

  if (acao === 'gerente'){
    if (!seg || !seg.hash) throw new Falha('A senha do gerente ainda não foi criada. Entre como gerente pela senha da loja e crie em Empresa → Funcionários.');
    if (seg.bloqueado_ate && Date.parse(seg.bloqueado_ate) > Date.now()) throw new Falha(`Muitas senhas erradas. Tente de novo em alguns minutos.`, 429);
    if (!confere(senha, seg)){
      const erros = (seg.erros || 0) + 1, bloq = erros >= MAX_ERROS;
      await putDoc(caminho, { ...seg, erros:bloq ? 0 : erros, bloqueado_ate:bloq ? new Date(Date.now() + BLOQUEIO_MIN * 60e3).toISOString() : null }, u.id);
      throw new Falha(bloq ? `Senha errada. Por segurança, o quadro do gerente ficou bloqueado por ${BLOQUEIO_MIN} minutos.` : 'Senha do gerente incorreta.');
    }
    if (seg.erros) await putDoc(caminho, { ...seg, erros:0, bloqueado_ate:null }, u.id);
    if (papel === 'dono') return { ok:true };
    // quem está no computador é outra conta (ex.: funcionária): gera um acesso de uso único para a conta do dono
    const donos = await sb(`/rest/v1/membros?select=user_id&empresa_id=eq.${encodeURIComponent(empresa_id)}&papel=eq.dono`);
    if (!donos || !donos[0]) throw new Falha('Dono da empresa não encontrado.', 404);
    const us = await authAdmin('GET', '/users/' + donos[0].user_id);
    if (!us.ok || !us.body.email) throw new Falha('Não foi possível achar a conta do gerente.', 502);
    const l = await authAdmin('POST', '/generate_link', { type:'magiclink', email:us.body.email });
    const token = (l.body.properties || {}).hashed_token || l.body.hashed_token;
    if (!l.ok || !token) throw new Falha('Não foi possível entrar como gerente agora. Tente de novo.', 502);
    return { ok:true, token_hash:token, email:us.body.email };
  }
  throw new Falha('Ação desconhecida.');
});
