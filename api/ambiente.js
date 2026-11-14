// POST /api/ambiente — o dono escolhe dentro do sistema se a empresa emite em homologação (testes) ou produção (valendo).
// Cada ambiente tem a sua numeração: ao trocar, a numeração atual fica guardada e entra a do outro ambiente.
import { rota, Falha, usuario, papelDe, getDoc, rpc, isoBR, ambienteEmp, temTokenProducao } from './_lib.js';

const dig = s => String(s || '').replace(/\D/g, '');
const pos = (v, padrao) => { const n = parseInt(dig(v)); return n > 0 ? n : padrao; };

export default rota(async (req, b) => {
  const u = await usuario(req);
  const { empresa_id } = b, novo = b.ambiente === 'producao' ? 'producao' : 'homologacao';
  if (!empresa_id) throw new Falha('Requisição incompleta.');
  if (await papelDe(empresa_id, u.id) !== 'dono') throw new Falha('Só o dono da empresa pode trocar o ambiente.', 403);
  const e = await getDoc('empresas/' + empresa_id);
  if (!e) throw new Falha('Empresa não encontrada.', 404);
  const atual = ambienteEmp(e);
  if (atual === novo) throw new Falha(`A empresa já está em ${novo === 'producao' ? 'produção' : 'homologação'}.`);

  if (novo === 'producao'){
    if (!temTokenProducao()) throw new Falha('Falta o token de produção da Focus na Vercel (FOCUS_TOKEN_PRODUCAO ou FOCUS_TOKEN_PRINCIPAL).', 500);
    const c = e.certificado || {};
    if (!c.valido_ate) throw new Falha('Envie primeiro o certificado digital A1 (quadro "Certificado digital" na aba Empresa).');
    if (new Date(c.valido_ate) < new Date()) throw new Falha('O certificado digital está vencido. Envie o certificado novo antes de ir para produção.');
    if (!b.confirmo) throw new Falha('Confirme que entende que as notas passam a ter valor fiscal.');
  }

  const guardada = (e.numeracao || {})[novo] || {};
  const nova = {
    serie_nfce:String(pos(b.serie_nfce, pos(guardada.serie_nfce, 1))), prox_nfce:pos(b.prox_nfce, pos(guardada.prox_nfce, 1)),
    serie_nfe:String(pos(b.serie_nfe, pos(guardada.serie_nfe, 1))), prox_nfe:pos(b.prox_nfe, pos(guardada.prox_nfe, 1))
  };
  const numeracao = { ...(e.numeracao || {}), [atual]:{ serie_nfce:e.serie_nfce, prox_nfce:e.prox_nfce, serie_nfe:e.serie_nfe, prox_nfe:e.prox_nfe } };
  const hist = [...(e.ambiente_hist || []), { de:atual, para:novo, em:isoBR(), por:u.id }].slice(-20);
  for (const [campo, valor] of Object.entries({ ...nova, numeracao, ambiente_hist:hist, ambiente:novo }))
    await rpc('gravar_campo_empresa', { e:empresa_id, caminho:[campo], valor });
  return { ok:true, ambiente:novo, numeracao:nova, aviso:novo === 'producao' && !(e.certificado || {}).csc_producao
    ? 'Falta o CSC de produção do cupom (NFC-e). Sem ele, o cupom em produção é recusado. Informe no quadro "Certificado digital".' : '' };
});
