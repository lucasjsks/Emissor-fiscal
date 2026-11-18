// Envio de e-mail por SMTP, sem dependências (node:tls / node:net).
// Configuração só nas variáveis da Vercel: SMTP_HOST, SMTP_PORT (465 ou 587), SMTP_USUARIO, SMTP_SENHA e, se quiser, SMTP_REMETENTE.
// Funciona com Gmail (senha de app), Outlook, Hostinger, Zoho, Resend (SMTP) etc.
import tls from 'node:tls';
import net from 'node:net';
import { Falha } from './_lib.js';

export const emailConfigurado = () => !!(process.env.SMTP_HOST && process.env.SMTP_USUARIO && process.env.SMTP_SENHA);

const b64linhas = buf => (Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'utf8')).toString('base64').replace(/.{1,76}/g, '$&\r\n');
const cab = t => /^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${Buffer.from(t, 'utf8').toString('base64')}?=`;
const endereco = s => (String(s).match(/<([^>]+)>/) || [, s])[1].trim();

// monta a mensagem MIME (texto + anexos)
export function montarMensagem({ de, para, responderPara, assunto, texto, anexos = [] }){
  const fronteira = 'notaone' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const nomeDe = String(de).includes('<') ? `${cab(String(de).split('<')[0].trim().replace(/^"|"$/g, ''))} <${endereco(de)}>` : de;
  const L = [
    `From: ${nomeDe}`, `To: ${para.join(', ')}`, ...(responderPara ? [`Reply-To: ${responderPara}`] : []),
    `Subject: ${cab(assunto)}`, `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${fronteira}@notaone>`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${fronteira}"`, '',
    `--${fronteira}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64linhas(texto)
  ];
  for (const a of anexos)
    L.push(`--${fronteira}`, `Content-Type: ${a.tipo || 'application/octet-stream'}; name="${a.nome}"`, 'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${a.nome}"`, '', b64linhas(a.dados));
  L.push(`--${fronteira}--`, '');
  return L.join('\r\n');
}

// conversa SMTP: cada comando espera a resposta com o código certo
function sessao(socket){
  let buf = '', espera = null;
  const tentar = () => {
    if (!espera) return;
    const linhas = buf.split('\r\n'); // resposta completa = linha "NNN texto" (sem hífen depois do código)
    for (let i = 0; i < linhas.length - 1; i++) if (/^\d{3} /.test(linhas[i])){
      const resp = linhas.slice(0, i + 1).join('\n'); buf = linhas.slice(i + 1).join('\r\n');
      const e = espera; espera = null; e.ok(resp); return;
    }
  };
  const onData = d => { buf += d.toString('utf8'); tentar(); };
  const onErr = err => { if (espera){ const e = espera; espera = null; e.erro(err); } };
  socket.on('data', onData); socket.on('error', onErr); socket.on('close', () => onErr(new Error('A conexão com o servidor de e-mail caiu.')));
  return {
    ler(codigos){ return new Promise((ok, erro) => { espera = { ok:r => codigos.includes(+r.slice(0, 3)) ? ok(r) : erro(new Error(r.split('\n').pop())), erro }; tentar(); }); },
    async cmd(t, codigos){ socket.write(t + '\r\n'); return this.ler(codigos); },
    soltar(){ socket.off('data', onData); socket.off('error', onErr); socket.removeAllListeners('close'); }
  };
}

export async function enviarEmail({ para, assunto, texto, anexos, responderPara, timeout = 45000 }){
  if (!emailConfigurado()) throw new Falha('O envio de e-mail ainda não foi configurado no servidor (variáveis SMTP_ na Vercel).', 500);
  const host = process.env.SMTP_HOST, porta = +(process.env.SMTP_PORT || 465), usuario = process.env.SMTP_USUARIO;
  const de = process.env.SMTP_REMETENTE || `NotaOne <${usuario}>`;
  const mensagem = montarMensagem({ de, para, responderPara, assunto, texto, anexos });
  let socket = porta === 465 ? tls.connect({ host, port:porta, servername:host }) : net.connect({ host, port:porta });
  const relogio = setTimeout(() => socket.destroy(new Error('O servidor de e-mail demorou demais para responder.')), timeout);
  try {
    let s = sessao(socket);
    await s.ler([220]);
    await s.cmd('EHLO notaone', [250]);
    if (porta !== 465){
      await s.cmd('STARTTLS', [220]); s.soltar();
      socket = tls.connect({ socket, servername:host });
      await new Promise((ok, erro) => { socket.once('secureConnect', ok); socket.once('error', erro); });
      s = sessao(socket);
      await s.cmd('EHLO notaone', [250]);
    }
    await s.cmd('AUTH LOGIN', [334]);
    await s.cmd(Buffer.from(usuario).toString('base64'), [334]);
    try { await s.cmd(Buffer.from(process.env.SMTP_SENHA).toString('base64'), [235]); }
    catch(e){ throw new Error('O servidor de e-mail recusou o usuário/senha (confira SMTP_USUARIO e SMTP_SENHA; no Gmail use uma "senha de app"). ' + e.message); }
    await s.cmd(`MAIL FROM:<${endereco(de)}>`, [250]);
    for (const p of para) await s.cmd(`RCPT TO:<${endereco(p)}>`, [250, 251]);
    await s.cmd('DATA', [354]);
    await s.cmd(mensagem.replace(/\r\n\./g, '\r\n..') + '\r\n.', [250]);
    await s.cmd('QUIT', [221]).catch(() => {});
  } catch(e){
    throw new Falha('Não foi possível enviar o e-mail: ' + (e.message || e), 502);
  } finally { clearTimeout(relogio); socket.destroy(); }
}
