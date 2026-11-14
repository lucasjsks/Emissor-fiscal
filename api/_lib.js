// Funções compartilhadas pelas rotas /api (rodam na Vercel, Node 18+, sem dependências).
// Segredos ficam nas variáveis de ambiente da Vercel — nunca no código.

export class Falha extends Error {
  constructor(msg, http = 400){ super(msg); this.http = http; }
}

export function env(k){
  const v = process.env[k];
  if (!v) throw new Falha(`Configuração incompleta: a variável ${k} não foi cadastrada na Vercel.`, 500);
  return v;
}

export const ambiente = () => process.env.FOCUS_AMBIENTE === 'producao' ? 'producao' : 'homologacao';
// notas recebidas (MD-e) só existem de verdade em produção: usa produção assim que o token de produção existir
export const ambienteMde = () => process.env.FOCUS_TOKEN_PRODUCAO ? 'producao' : ambiente();
export const focusBase = (amb = ambiente()) => amb === 'producao' ? 'https://api.focusnfe.com.br' : 'https://homologacao.focusnfe.com.br';
const focusToken = (amb = ambiente()) => amb === 'producao' ? env('FOCUS_TOKEN_PRODUCAO') : env('FOCUS_TOKEN_HOMOLOGACAO');

// data/hora de Brasília no formato usado pelo sistema
export function isoBR(){ return new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 19) + '-03:00'; }

// ---------- Focus NFe ----------
// opcoes.amb: força o ambiente; opcoes.texto: devolve o corpo como texto (ex.: XML) e os cabeçalhos
export async function focus(method, path, body, opcoes = {}){
  const amb = opcoes.amb || ambiente();
  let r;
  try {
    r = await fetch(focusBase(amb) + path, {
      method,
      headers:{ Authorization:'Basic ' + Buffer.from(focusToken(amb) + ':').toString('base64'), 'Content-Type':'application/json' },
      body:body === undefined ? undefined : JSON.stringify(body)
    });
  } catch(e){ return { status:0, body:{ mensagem:'Não foi possível conectar à Focus NFe: ' + e.message }, headers:{ get:() => null } }; }
  const t = await r.text(); let j;
  if (opcoes.texto) return { status:r.status, texto:t, headers:r.headers || { get:() => null } };
  try { j = t ? JSON.parse(t) : {}; } catch { j = { mensagem:t.slice(0, 500) }; }
  return { status:r.status, body:j, headers:r.headers || { get:() => null } };
}

export function mensagemFocus(r = {}){
  if (r.mensagem_sefaz) return `${r.status_sefaz ? r.status_sefaz + ' — ' : ''}${r.mensagem_sefaz}`;
  if (Array.isArray(r.erros) && r.erros.length) return r.erros.map(e => e.mensagem || JSON.stringify(e)).join('; ');
  return r.mensagem || '';
}

// status da Focus → status do sistema
export function statusDe(r = {}){
  switch (r.status){
    case 'autorizado': return 'autorizada';
    case 'processando_autorizacao': return 'processando';
    case 'cancelado': return 'cancelada';
    case 'denegado': return 'denegada';
    default: return 'rejeitada';
  }
}

export function resumoFocus(r = {}){
  const o = {};
  ['status','status_sefaz','mensagem_sefaz','chave_nfe','numero','serie','protocolo','caminho_xml_nota_fiscal','caminho_danfe',
   'qrcode_url','url_consulta_nf','mensagem','codigo','erros'].forEach(k => { if (r[k] !== undefined) o[k] = r[k]; });
  return o;
}

// ---------- Supabase (chave de serviço: ignora RLS, por isso só roda aqui no servidor) ----------
export async function sb(path, { method = 'GET', body, prefer = 'return=representation' } = {}){
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(env('SUPABASE_URL') + path, {
    // chaves antigas (JWT "eyJ...") vão também no Authorization; as novas (sb_secret_...) só no apikey
    method, headers:{ apikey:key, ...(key.startsWith('eyJ') ? { Authorization:'Bearer ' + key } : {}), 'Content-Type':'application/json', Prefer:prefer },
    body:body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await r.text(); let j = null;
  try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  if (!r.ok) throw new Falha('Erro no banco de dados: ' + ((j && (j.message || j.hint)) || r.status), 500);
  return j;
}
export const rpc = (fn, args) => sb('/rest/v1/rpc/' + fn, { method:'POST', body:args });

export async function getDoc(path){
  const rows = await sb('/rest/v1/docs?select=data&path=eq.' + encodeURIComponent(path));
  return rows && rows[0] ? rows[0].data : null;
}
// grava vários documentos numa chamada só
export async function putDocs(lista, userId){
  if (!lista.length) return;
  await sb('/rest/v1/docs?on_conflict=path', { method:'POST', prefer:'resolution=merge-duplicates,return=minimal',
    body:lista.map(({ path, data }) => ({ path, col:path.replace(/\/[^/]+$/, ''), empresa_id:path.split('/')[1], data, atualizado_por:userId || null })) });
}
export async function putDoc(path, data, userId){
  const col = path.replace(/\/[^/]+$/, ''), empresa_id = path.startsWith('empresas/') ? path.split('/')[1] : null;
  await sb('/rest/v1/docs?on_conflict=path', { method:'POST', prefer:'resolution=merge-duplicates,return=minimal',
    body:{ path, col, empresa_id, data, atualizado_por:userId || null } });
}

// ---------- autenticação ----------
export async function usuario(req){
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) throw new Falha('Faça login novamente.', 401);
  const r = await fetch(env('SUPABASE_URL') + '/auth/v1/user', { headers:{ apikey:env('SUPABASE_ANON_KEY'), Authorization:h } });
  if (!r.ok) throw new Falha('Sua sessão expirou. Faça login novamente.', 401);
  return r.json();
}
export async function papelDe(empresaId, userId){
  const rows = await sb(`/rest/v1/membros?select=papel&empresa_id=eq.${encodeURIComponent(empresaId)}&user_id=eq.${encodeURIComponent(userId)}`);
  return rows && rows[0] ? rows[0].papel : null;
}

// ---------- casca das rotas ----------
export function rota(fn){
  return async (req, res) => {
    try {
      if (req.method !== 'POST') throw new Falha('Use POST.', 405);
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      res.status(200).json(await fn(req, body));
    } catch(e){
      const http = e instanceof Falha ? e.http : 500;
      if (http >= 500) console.error(e);
      res.status(http).json({ erro:e.message || 'Erro inesperado.' });
    }
  };
}
