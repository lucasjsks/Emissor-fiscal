// Testes do pacote do contador: ZIP, regras de data, envio por SMTP (servidor falso local) e cron.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
process.env.FOCUS_TOKEN_HOMOLOGACAO = 'tok';
process.env.FOCUS_TOKEN_PRODUCAO = 'tokp';
process.env.CRON_SECRET = 'segredo';

const { zipar, crc32 } = await import('../api/_zip.js');
const { default: contador, devido, mesAnterior, montarPacote } = await import('../api/contador.js');

// lê o ZIP gerado (confere estrutura e conteúdo)
function lerZip(buf){
  const out = {}; let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50){
    const crc = buf.readUInt32LE(p + 14), tam = buf.readUInt32LE(p + 18), n = buf.readUInt16LE(p + 26), x = buf.readUInt16LE(p + 28);
    const nome = buf.slice(p + 30, p + 30 + n).toString('utf8'), dados = inflateRawSync(buf.slice(p + 30 + n + x, p + 30 + n + x + tam));
    assert.equal(crc32(dados), crc, 'crc de ' + nome); out[nome] = dados.toString('utf8'); p += 30 + n + x + tam;
  }
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50);
  return out;
}

test('zip: crc32 conhecido e arquivos legíveis', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926);
  const z = lerZip(zipar([{ nome:'a.txt', dados:'olá' }, { nome:'p/b.xml', dados:'<x/>'.repeat(100) }, { nome:'a.txt', dados:'outro' }]));
  assert.deepEqual(Object.keys(z), ['a.txt', 'p/b.xml', 'a-2.txt']);
  assert.equal(z['a.txt'], 'olá');
});

test('dia de envio: mês anterior, dia escolhido, já enviado, pular e tentativas', () => {
  assert.equal(mesAnterior('2026-01-05'), '2025-12');
  const e = { contador:{ ativo:true, email:'c@x.com', dia:5 } };
  assert.equal(devido(e, '2026-11-04'), false);
  assert.equal(devido(e, '2026-11-05'), true);
  assert.equal(devido(e, '2026-11-09'), true); // atrasou (cron falhou): ainda manda
  assert.equal(devido({ ...e, contador_envio:{ mes:'2026-10', ok:true } }, '2026-11-09'), false);
  assert.equal(devido({ ...e, contador_envio:{ mes:'2026-10', ok:false, tentativas:1 } }, '2026-11-09'), true);
  assert.equal(devido({ ...e, contador_envio:{ mes:'2026-10', ok:false, tentativas:3 } }, '2026-11-09'), false);
  assert.equal(devido({ contador:{ ...e.contador, pular:'2026-10' } }, '2026-11-09'), false);
  assert.equal(devido({ contador:{ ...e.contador, pular:'2026-10' } }, '2026-12-05'), true);
  assert.equal(devido({ contador:{ ...e.contador, ativo:false } }, '2026-11-09'), false);
  assert.equal(devido({ contador:{ ...e.contador, email:'invalido' } }, '2026-11-09'), false);
});

// ---------- banco, Focus e servidor de e-mail simulados ----------
let docs, recebidos = [], servidor, rpcs;
function base(){
  docs = {
    'empresas/E1': { razao:'LOJA TESTE LTDA', fantasia:'LOJA', cnpj:'11222333000181', email:'loja@x.com', ambiente:'producao',
      contador:{ ativo:true, email:'contador@escritorio.com', dia:1 } },
    'empresas/E1/notas/n1': { ref:'n1', modelo:'65', serie:'1', numero:10, data:'2026-10-03T10:00:00-03:00', total:50, status:'autorizada', ambiente:'producao', chave:'2226', focus:{ caminho_xml_nota_fiscal:'/x/n1.xml' },
      payload:{ items:[{ cfop:'5102', icms_situacao_tributaria:'102', valor_bruto:50 }] } },
    'empresas/E1/notas/n2': { ref:'n2', modelo:'55', serie:'1', numero:3, data:'2026-10-04T10:00:00-03:00', total:200, status:'cancelada', ambiente:'producao', focus:{ caminho_xml_nota_fiscal:'/x/n2.xml' },
      eventos:[{ tipo:'cancelamento', focus:{} }] },
    'empresas/E1/notas/n3': { ref:'n3', modelo:'65', serie:'1', numero:11, data:'2026-10-05T10:00:00-03:00', total:30, status:'autorizada', ambiente:'homologacao', focus:{ caminho_xml_nota_fiscal:'/x/n3.xml' } },
    'empresas/E1/notas/n4': { ref:'n4', modelo:'65', serie:'1', numero:12, data:'2026-11-01T10:00:00-03:00', total:30, status:'autorizada', ambiente:'producao', focus:{ caminho_xml_nota_fiscal:'/x/n4.xml' } },
    'empresas/E1/compras/c1': { numero:'99', fornecedor_nome:'ATACADO', fornecedor_cnpj:'99888777000166', data_emissao:'2026-10-10', total_nota:500, tem_xml:true, status:'lancada' },
    'empresas/E1/compras_xml/c1': { xml:'<nfeProc>compra</nfeProc>' },
    'empresas/E2': { razao:'OUTRA', cnpj:'1', contador:{ ativo:true, email:'c2@x.com', dia:28 } }
  };
}
const chamarH = (req) => new Promise(resolve => {
  const res = { code:0, status(c){ this.code = c; return this; }, json(o){ resolve({ code:this.code, body:o }); } };
  contador(req, res);
});
before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'smtp-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k'), '-out', join(dir, 'c'), '-days', '2', '-subj', '/CN=localhost'], { stdio:'ignore' });
  servidor = tls.createServer({ key:readFileSync(join(dir, 'k')), cert:readFileSync(join(dir, 'c')) }, s => {
    let modo = 'cmd', dados = '', buf = '', auth = 0; s.write('220 ok\r\n');
    s.on('data', d => { buf += d.toString();
      let i; while ((i = buf.indexOf('\r\n')) >= 0){ const l = buf.slice(0, i); buf = buf.slice(i + 2);
        if (modo === 'data'){ if (l === '.'){ modo = 'cmd'; recebidos.push(dados); dados = ''; s.write('250 queued\r\n'); } else dados += l + '\r\n'; continue; }
        if (auth === 1){ auth = 2; s.write('334 UGFzc3dvcmQ6\r\n'); continue; }
        if (auth === 2){ auth = 0; s.write(Buffer.from(l, 'base64').toString() === 'senha' ? '235 ok\r\n' : '535 bad\r\n'); continue; }
        if (l.startsWith('EHLO')) s.write('250-oi\r\n250 AUTH LOGIN\r\n');
        else if (l === 'AUTH LOGIN'){ auth = 1; s.write('334 VXNlcm5hbWU6\r\n'); }
        else if (l === 'DATA'){ modo = 'data'; s.write('354 go\r\n'); }
        else if (l === 'QUIT'){ s.write('221 bye\r\n'); s.end(); }
        else s.write('250 ok\r\n');
      } });
  });
  await new Promise(r => servidor.listen(0, '127.0.0.1', r));
  Object.assign(process.env, { SMTP_HOST:'127.0.0.1', SMTP_PORT:'465', SMTP_USUARIO:'robo@notaone.com', SMTP_SENHA:'senha', NODE_TLS_REJECT_UNAUTHORIZED:'0' });
  const porta = servidor.address().port;
  const tlsConnect = tls.connect; tls.connect = (o, ...r) => tlsConnect({ ...o, port:o.port === 465 ? porta : o.port }, ...r);
  rpcs = [];
  globalThis.fetch = async (url, opt = {}) => {
    const u = new URL(url), body = opt.body ? JSON.parse(opt.body) : undefined;
    const json = (o, s = 200) => ({ ok:s < 400, status:s, text:async () => JSON.stringify(o), json:async () => o });
    if (u.host === 'sb.test'){
      if (u.pathname === '/auth/v1/user') return opt.headers.Authorization === 'Bearer t1' ? json({ id:'U1' }) : json({}, 401);
      if (u.pathname === '/rest/v1/membros') return json([{ papel:'dono' }]);
      if (u.pathname === '/rest/v1/rpc/gravar_campo_empresa'){ rpcs.push(body); docs['empresas/' + body.e][body.caminho[0]] = body.valor; return json(null); }
      if (u.pathname === '/rest/v1/docs'){
        const p = u.searchParams.get('path');
        if (p) { const d = docs[p.slice(3)]; return json(d ? [{ data:d }] : []); }
        const col = u.searchParams.get('col').slice(3), off = +u.searchParams.get('offset') || 0;
        let L = Object.entries(docs).filter(([k]) => k.replace(/\/[^/]+$/, '') === col).map(([path, data]) => ({ path, data }));
        for (const [k, v] of u.searchParams) if (k.startsWith('data->')){
          const campo = k.split('>').pop(), op = v.split('.')[0], alvo = v.slice(op.length + 1);
          const get = d => k.includes('contador') ? String((d.contador || {})[campo]) : String(d[campo] ?? '');
          L = L.filter(r => op === 'like' ? get(r.data).startsWith(alvo.replace('*', '')) : get(r.data) === alvo);
        }
        return json(L.slice(off, off + 1000));
      }
    }
    if (u.host === 'api.focusnfe.com.br'){
      if (u.pathname.startsWith('/x/')) return { ok:true, status:200, text:async () => `<nfeProc>${u.pathname}</nfeProc>` };
      if (u.pathname === '/v2/nfe/n2') return json({ status:'cancelado', caminho_xml_cancelamento:'/x/n2-canc.xml' });
    }
    if (u.host === 'app.test' && u.pathname === '/api/contador'){
      const r = await chamarH({ method:'POST', headers:{ authorization:opt.headers.Authorization }, body });
      return json(r.body, r.code);
    }
    throw new Error('URL inesperada ' + url);
  };
});
after(() => servidor.close());

test('pacote: só o mês e o ambiente da empresa, XML de nota, cancelamento e compra, resumos', async () => {
  base();
  const p = await montarPacote('E1', docs['empresas/E1'], '2026-10');
  const z = lerZip(p.zip), nomes = Object.keys(z);
  assert.ok(nomes.includes('notas/autorizadas/nfce-1-000000010-2226.xml'));
  assert.ok(nomes.includes('notas/canceladas/nfe-1-000000003.xml'));
  assert.ok(nomes.includes('notas/canceladas/nfe-1-000000003-cancelamento.xml'));
  assert.ok(nomes.includes('compras/99888777000166-nf99.xml'));
  assert.ok(!nomes.some(n => n.includes('000000011') || n.includes('000000012')), 'nota de teste e de outro mês ficam fora');
  assert.match(z['resumo-notas-2026-10.csv'], /NFC-e;1;10;2226;venda;Consumidor;;50,00;autorizada/);
  assert.match(z['resumo-cfop-2026-10.csv'], /NFC-e;5102;102;50,00/);
  assert.match(z['resumo-compras-2026-10.csv'], /ATACADO/);
  assert.equal(p.resumo.notas, 1); assert.equal(p.resumo.canceladas, 1); assert.equal(p.resumo.compras, 1);
});

test('enviar agora: manda por SMTP com o ZIP anexado e grava o envio', async () => {
  base(); recebidos = [];
  const r = await chamarH({ method:'POST', headers:{ authorization:'Bearer t1' }, body:{ empresa_id:'E1', acao:'enviar', mes:'2026-10' } });
  assert.equal(r.code, 200, JSON.stringify(r.body)); assert.equal(r.body.ok, true);
  assert.equal(recebidos.length, 1);
  const m = recebidos[0];
  assert.match(m, /To: contador@escritorio.com/); assert.match(m, /Reply-To: loja@x.com/);
  assert.match(m, /filename="contabilidade-11222333000181-2026-10.zip"/);
  const anexo = Buffer.from(m.split('Content-Disposition: attachment; filename="contabilidade-11222333000181-2026-10.zip"\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64');
  assert.ok(Object.keys(lerZip(anexo)).includes('LEIA-ME.txt'));
  assert.equal(docs['empresas/E1'].contador_envio.mes, '2026-10'); assert.equal(docs['empresas/E1'].contador_envio.ok, true);
});

test('envio de teste para outro e-mail não marca o mês como enviado', async () => {
  base(); recebidos = [];
  const r = await chamarH({ method:'POST', headers:{ authorization:'Bearer t1' }, body:{ empresa_id:'E1', acao:'enviar', mes:'2026-10', email:'eu@loja.com' } });
  assert.equal(r.body.ok, true); assert.match(recebidos[0], /To: eu@loja.com/);
  assert.equal(docs['empresas/E1'].contador_envio, undefined);
});

test('senha errada: erro claro e falha registrada', async () => {
  base(); process.env.SMTP_SENHA = 'errada';
  const r = await chamarH({ method:'POST', headers:{ authorization:'Bearer t1' }, body:{ empresa_id:'E1', acao:'enviar' } });
  process.env.SMTP_SENHA = 'senha';
  assert.equal(r.code, 502); assert.match(r.body.erro, /senha de app/);
  assert.equal(docs['empresas/E1'].contador_envio.ok, false); assert.equal(docs['empresas/E1'].contador_envio.tentativas, 1);
});

test('cron: exige o segredo, manda só para quem chegou o dia', async () => {
  base(); recebidos = [];
  const neg = await chamarH({ method:'GET', headers:{} });
  assert.equal(neg.code, 401);
  const r = await chamarH({ method:'GET', headers:{ authorization:'Bearer segredo', host:'app.test' } });
  assert.equal(r.code, 200);
  const dia = +new Date(Date.now() - 3 * 3600e3).toISOString().slice(8, 10);
  // E1 (dia 1) sempre devida; E2 (dia 28) só a partir do dia 28
  assert.equal(r.body.total, dia >= 28 ? 2 : 1);
  assert.ok(recebidos.some(m => /To: contador@escritorio.com/.test(m)));
  const r2 = await chamarH({ method:'GET', headers:{ authorization:'Bearer segredo', host:'app.test' } });
  assert.equal(r2.body.total, dia >= 28 ? 1 : 0, 'não manda de novo o mesmo mês');
});

test('baixar: devolve o ZIP em base64', async () => {
  base();
  const r = await chamarH({ method:'POST', headers:{ authorization:'Bearer t1' }, body:{ empresa_id:'E1', acao:'baixar', mes:'2026-10' } });
  assert.equal(r.code, 200);
  assert.ok(Object.keys(lerZip(Buffer.from(r.body.arquivo, 'base64'))).includes('resumo-notas-2026-10.csv'));
});
