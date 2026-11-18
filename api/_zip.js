// Monta um arquivo ZIP simples (sem dependências): deflate do próprio Node.
import { deflateRawSync } from 'node:zlib';

const TAB = (() => { const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t; })();
export function crc32(buf){
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = TAB[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// arquivos: [{ nome, dados (string ou Buffer) }] → Buffer do .zip
export function zipar(arquivos, data = new Date()){
  const dosT = (data.getHours() << 11) | (data.getMinutes() << 5) | (data.getSeconds() >> 1);
  const dosD = ((data.getFullYear() - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate();
  const locais = [], centrais = []; let off = 0;
  const usados = new Set();
  for (const a of arquivos){
    let nome = a.nome;
    for (let i = 2; usados.has(nome); i++) nome = a.nome.replace(/(\.[^./]+)?$/, `-${i}$1`);
    usados.add(nome);
    const nm = Buffer.from(nome, 'utf8'), bruto = Buffer.isBuffer(a.dados) ? a.dados : Buffer.from(String(a.dados), 'utf8');
    const comp = deflateRawSync(bruto, { level:9 }), crc = crc32(bruto);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x0800, 6); l.writeUInt16LE(8, 8);
    l.writeUInt16LE(dosT, 10); l.writeUInt16LE(dosD, 12); l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(bruto.length, 22); l.writeUInt16LE(nm.length, 26); l.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(dosT, 12); c.writeUInt16LE(dosD, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(bruto.length, 24);
    c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    locais.push(l, nm, comp); centrais.push(c, nm);
    off += 30 + nm.length + comp.length;
  }
  const cen = Buffer.concat(centrais), fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(cen.length, 12); fim.writeUInt32LE(off, 16);
  return Buffer.concat([...locais, cen, fim]);
}
