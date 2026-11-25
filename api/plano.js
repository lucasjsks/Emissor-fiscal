// POST /api/plano — o dono escolhe (ou troca) o plano da empresa: grava empresa.plano e o limite de caixas.
// A tela não consegue gravar esses campos (gatilhos no banco); só este servidor.
import { rota, Falha, usuario, papelDe, getDoc, rpc, isoBR } from './_lib.js';
import { planoPorId, docDaEmpresa } from './_planos.js';
import { asaas, ambienteAsaas } from './asaas.js';

export default rota(async (req, b) => {
  const u = await usuario(req);
  const { empresa_id } = b;
  if (!empresa_id) throw new Falha('Requisição incompleta.');
  if (await papelDe(empresa_id, u.id) !== 'dono') throw new Falha('Só o dono da empresa escolhe o plano.', 403);
  const e = await getDoc('empresas/' + empresa_id);
  if (!e) throw new Falha('Empresa não encontrada.', 404);
  const p = planoPorId(b.plano);
  if (!p) throw new Falha('Plano inválido.');
  if (p.doc !== docDaEmpresa(e)) throw new Falha(p.doc === 'cpf' ? 'O plano Pessoa Física é só para quem não tem CNPJ.' : 'Empresa sem CNPJ usa o plano Pessoa Física.');
  const caixas = Array.isArray(e.pdvs) ? e.pdvs.length : 0;
  if (caixas > p.caixas) throw new Falha(`Este plano permite ${p.caixas} caixa(s) e a empresa tem ${caixas} cadastrados. Exclua o caixa a mais em Empresa → Caixas da empresa e tente de novo.`);
  const plano = { id:p.id, nome:p.nome, valor:p.valor, caixas:p.caixas, escolhido_em:isoBR(), escolhido_por:u.id };
  await rpc('gravar_campo_empresa', { e:empresa_id, caminho:['plano'], valor:plano });
  await rpc('gravar_campo_empresa', { e:empresa_id, caminho:['limite_caixas'], valor:p.caixas });
  // mensalidade já assinada no Asaas: o valor acompanha o plano (inclusive as mensalidades em aberto)
  let aviso = '';
  const a = e.assinatura || {};
  if (a.id && a.situacao !== 'cancelada' && process.env.ASAAS_API_KEY && (a.ambiente || 'sandbox') === ambienteAsaas()){
    try { await asaas('POST', `/subscriptions/${encodeURIComponent(a.id)}`, { value:p.valor, updatePendingPayments:true }); }
    catch(err){ aviso = 'O plano mudou, mas não foi possível atualizar o valor da mensalidade. Fale com o suporte.'; }
  }
  return { ok:true, plano, aviso };
});
