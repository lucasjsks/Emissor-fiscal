// POST /api/emitir — reserva o número, envia a NFC-e/NF-e para a Focus e grava a nota.
import { rota, Falha, usuario, papelDe, getDoc, putDoc, rpc, sb, focus, statusDe, resumoFocus, mensagemFocus, ambiente, isoBR } from './_lib.js';

// campos que o sistema usa internamente e não vão para a Focus
export function limparPayload(p){
  const o = structuredClone(p);
  delete o.inscricao_estadual_emitente; delete o.regime_tributario_emitente;
  (o.items || []).forEach(it => { delete it._rtc; });
  return o;
}

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
  const serie = String((modelo === '65' ? emp.serie_nfce : emp.serie_nfe) || '1');
  const numero = await rpc('proximo_numero', { e:empresa_id, campo:modelo === '65' ? 'prox_nfce' : 'prox_nfe' });
  const ref = `${empresa_id.slice(0, 8)}-${modelo}-${serie}-${numero}`;
  const envio = limparPayload({ ...payload, cnpj_emitente:emp.cnpj, serie, numero });

  const resp = await focus('POST', `/v2/${modelo === '65' ? 'nfce' : 'nfe'}?ref=${encodeURIComponent(ref)}`, envio);
  const r = resp.body || {};
  const status = (resp.status === 0 || resp.status >= 500) ? 'erro_envio' : statusDe(r);
  const final = { ...nota, id:ref, ref, numero, serie, empresa_id, status, ambiente:ambiente(), payload:envio,
    chave:r.chave_nfe ? String(r.chave_nfe).replace(/\D/g, '') : null, focus:{ ...resumoFocus(r), http:resp.status },
    emitida_por:u.id, data:payload.data_emissao || isoBR() };
  await putDoc(`empresas/${empresa_id}/notas/${ref}`, final, u.id);
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
