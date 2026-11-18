// POST /api/emitir — reserva o número, envia a NFC-e/NF-e para a Focus e grava a nota.
import { rota, Falha, usuario, papelDe, getDoc, putDoc, rpc, sb, focus, statusDe, resumoFocus, mensagemFocus, ambienteEmp, isoBR } from './_lib.js';

// campos que o sistema usa internamente e não vão para a Focus
export function limparPayload(p){
  const o = structuredClone(p);
  delete o.inscricao_estadual_emitente; delete o.regime_tributario_emitente;
  (o.items || []).forEach(it => { delete it._rtc; });
  return o;
}

// A correção de uma nota rejeitada sai SEMPRE com o mesmo número (decisão do Lucas), exceto quando a SEFAZ
// diz que o número já está usado: duplicidade de numeração (204, 539) — e também denegada (205, 301–303) ou
// inutilizada (206), em que o número ficou queimado e a SEFAZ recusaria de novo para sempre.
const NUMERO_PERDIDO = ['204','205','206','539','301','302','303'];
export const numeroPerdido = n => {
  const f = n.focus || {}, cod = String(f.status_sefaz || '').trim();
  if (cod) return NUMERO_PERDIDO.includes(cod);   // com código da SEFAZ, vale só o código (outras rejeições mantêm o número)
  return /duplicidade de (nf|nota)|uso denegado|est[aá] denegada|j[aá] (est[aá] )?inutilizad/i.test(String(f.mensagem_sefaz || ''));
};

export default rota(async (req, b) => {
  const u = await usuario(req);
  const { empresa_id, modelo, payload, nota, extras = {} } = b;
  if (!empresa_id || !['55','65'].includes(modelo) || !payload || !nota) throw new Falha('Requisição incompleta.');
  const papel = await papelDe(empresa_id, u.id);
  if (!papel) throw new Falha('Você não tem acesso a esta empresa.', 403);
  const devolucao = nota.op && nota.op !== 'venda';
  if (devolucao && papel === 'operador') throw new Falha('Devolução é só para gerente ou dono.', 403);
  if (modelo === '65' && devolucao) throw new Falha('Devolução sai em NF-e.');

  const emp = await getDoc('empresas/' + empresa_id);
  if (!emp) throw new Falha('Empresa não encontrada.', 404);
  const amb = ambienteEmp(emp), tipo = modelo === '65' ? 'nfce' : 'nfe';

  // correção de nota rejeitada: reenvia com o MESMO número e a mesma referência (a Focus aceita reenviar
  // uma referência rejeitada). Se a rejeição deixou o número usado (duplicidade/denegação), vai com número novo.
  // a mesma venda nunca vira duas notas: se a resposta se perdeu (internet caiu) e a tela tentar de novo,
  // devolve a nota que já foi feita para essa venda (venda_id gerado pela tela)
  const vid = typeof nota.venda_id === 'string' && /^[A-Za-z0-9_-]{6,60}$/.test(nota.venda_id) ? nota.venda_id : null;
  if (vid && !b.reenviar){
    const ja = await getDoc(`empresas/${empresa_id}/vendas_id/${vid}`);
    const feita = ja && ja.ref && await getDoc(`empresas/${empresa_id}/notas/${ja.ref}`);
    if (feita) return { nota:feita, mensagem:'Esta venda já tinha virado nota. Nada foi enviado de novo.', repetida:true };
  }
  let antiga = null;
  if (b.reenviar){
    antiga = await getDoc(`empresas/${empresa_id}/notas/${b.reenviar}`);
    if (!antiga || antiga.modelo !== modelo) throw new Falha('A nota que você está corrigindo não foi encontrada.');
    if (!['rejeitada','erro_envio'].includes(antiga.status)) throw new Falha('Essa nota não está rejeitada: não dá para reenviar. Abra a nota e confira a situação.');
    if ((antiga.ambiente || 'homologacao') !== amb) throw new Falha('Essa nota foi feita no outro ambiente (teste/produção). Emita uma nota nova.');
    if (antiga.corrigida_por) throw new Falha(`Essa nota já foi corrigida e reenviada como nº ${antiga.corrigida_por.numero}.`);
    // antes de reenviar, confere na Focus se a nota não chegou a ser autorizada (ex.: queda de internet no envio)
    const c = await focus('GET', `/v2/${tipo}/${encodeURIComponent(antiga.ref)}`, undefined, { amb });
    const cs = c.status === 200 ? statusDe(c.body || {}) : null;
    if (cs && cs !== 'rejeitada'){
      const atual = { ...antiga, status:cs, chave:c.body.chave_nfe ? String(c.body.chave_nfe).replace(/\D/g, '') : antiga.chave, focus:{ ...resumoFocus(c.body), http:c.status } };
      await putDoc(`empresas/${empresa_id}/notas/${antiga.ref}`, atual, u.id);
      if (cs === 'autorizada') await rpc('aplicar_estoque_nota', { e:empresa_id, p_ref:antiga.ref, desfazer:false });
      return { nota:atual, mensagem:'Essa nota já tinha chegado à SEFAZ e está ' + cs + '. Nada foi reenviado.' };
    }
  }
  const mesmoNumero = antiga && !numeroPerdido(antiga);
  const serie = mesmoNumero ? String(antiga.serie) : String((modelo === '65' ? emp.serie_nfce : emp.serie_nfe) || '1');
  const numero = mesmoNumero ? antiga.numero : await rpc('proximo_numero', { e:empresa_id, campo:modelo === '65' ? 'prox_nfce' : 'prox_nfe' });
  // a referência leva o ambiente para não colidir quando a numeração recomeça em produção
  const ref = mesmoNumero ? antiga.ref : `${empresa_id.slice(0, 8)}-${modelo}-${serie}-${numero}${amb === 'producao' ? '-p' : ''}`;
  const envio = limparPayload({ ...payload, cnpj_emitente:emp.cnpj, serie, numero });
  if (Array.isArray(envio.duplicatas) && envio.duplicatas.length && !envio.numero_fatura) envio.numero_fatura = String(numero); // fatura com o número real da nota

  if (vid) await putDoc(`empresas/${empresa_id}/vendas_id/${vid}`, { ref, em:isoBR() }, u.id);
  const resp = await focus('POST', `/v2/${tipo}?ref=${encodeURIComponent(ref)}`, envio, { amb });
  const r = resp.body || {};
  const status = (resp.status === 0 || resp.status >= 500) ? 'erro_envio' : statusDe(r);
  const tentativas = mesmoNumero ? [...(antiga.tentativas || []), { em:antiga.data, status:antiga.status, cod:(antiga.focus || {}).status_sefaz || '', motivo:(antiga.focus || {}).mensagem_sefaz || (antiga.focus || {}).mensagem || '' }].slice(-20) : undefined;
  const final = { ...nota, id:ref, ref, numero, serie, empresa_id, status, ambiente:amb, payload:envio,
    chave:r.chave_nfe ? String(r.chave_nfe).replace(/\D/g, '') : null, focus:{ ...resumoFocus(r), http:resp.status },
    emitida_por:u.id, data:payload.data_emissao || isoBR(), ...(tentativas ? { tentativas } : {}),
    ...(antiga && !mesmoNumero ? { corrige:{ ref:antiga.ref, numero:antiga.numero } } : {}) };
  await putDoc(`empresas/${empresa_id}/notas/${ref}`, final, u.id);
  if (antiga && !mesmoNumero) await putDoc(`empresas/${empresa_id}/notas/${antiga.ref}`, { ...antiga, corrigida_por:{ ref, numero, em:final.data } }, u.id);
  // estoque: venda autorizada tira do saldo; devolução de venda devolve (a função não aplica duas vezes)
  if (status === 'autorizada') await rpc('aplicar_estoque_nota', { e:empresa_id, p_ref:ref, desfazer:false });

  if (status === 'autorizada' || status === 'processando'){
    if (extras.difal_uf && /^[A-Z]{2}$/.test(extras.difal_uf.uf || ''))
      await rpc('gravar_campo_empresa', { e:empresa_id, caminho:['difal_uf', extras.difal_uf.uf], valor:extras.difal_uf.cfg });
    if (devolucao && extras.refChave){
      const rows = await sb(`/rest/v1/docs?select=path,data&col=eq.${encodeURIComponent(`empresas/${empresa_id}/notas`)}&data->>chave=eq.${encodeURIComponent(extras.refChave)}`);
      if (rows && rows[0]){
        const o = rows[0].data;
        o.devolucoes = [...(o.devolucoes || []), { ref, numero, total:final.total, em:final.data }];
        await putDoc(rows[0].path, o, u.id);
      }
    }
  }
  return { nota:final, mensagem:mensagemFocus(r) };
});
