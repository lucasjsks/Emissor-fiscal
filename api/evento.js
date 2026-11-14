// POST /api/evento — consultar, cancelar, carta de correção e inutilização.
import { rota, Falha, usuario, papelDe, getDoc, putDoc, rpc, focus, statusDe, resumoFocus, mensagemFocus, isoBR } from './_lib.js';

const SO_GERENTE = ['cancelar','cce','inutilizar'];

export default rota(async (req, b) => {
  const u = await usuario(req);
  const { empresa_id, tipo } = b;
  if (!empresa_id || !tipo) throw new Falha('Requisição incompleta.');
  const papel = await papelDe(empresa_id, u.id);
  if (!papel) throw new Falha('Você não tem acesso a esta empresa.', 403);
  if (SO_GERENTE.includes(tipo) && papel === 'operador') throw new Falha('Essa ação é só para gerente ou dono.', 403);

  if (tipo === 'inutilizar'){
    const emp = await getDoc('empresas/' + empresa_id);
    const modelo = b.modelo === '55' ? '55' : '65', serie = String(parseInt(b.serie)), ini = parseInt(b.ini), fim = parseInt(b.fim);
    const just = String(b.justificativa || '').replace(/\s+/g, ' ').trim();
    if (!(ini > 0) || !(fim >= ini) || fim - ini >= 10000) throw new Falha('Faixa de numeração inválida.');
    if (just.length < 15) throw new Falha('A justificativa precisa ter pelo menos 15 caracteres.');
    const r = await focus('POST', `/v2/${modelo === '65' ? 'nfce' : 'nfe'}/inutilizacao`,
      { cnpj:emp.cnpj, serie, numero_inicial:String(ini), numero_final:String(fim), justificativa:just });
    if (!(r.status >= 200 && r.status < 300) || (r.body.status && r.body.status !== 'autorizado'))
      return { ok:false, mensagem:mensagemFocus(r.body) || `A SEFAZ não confirmou (HTTP ${r.status}).` };
    const doc = { modelo, serie, ini, fim, justificativa:just, em:isoBR(), por:u.id, focus:resumoFocus(r.body) };
    await putDoc(`empresas/${empresa_id}/inutilizacoes/${modelo}-${serie}-${ini}-${fim}`, doc, u.id);
    const sc = modelo === '65' ? 'serie_nfce' : 'serie_nfe';
    if (String(emp[sc]) === serie) await rpc('ajustar_proximo', { e:empresa_id, campo:modelo === '65' ? 'prox_nfce' : 'prox_nfe', minimo:fim + 1 });
    return { ok:true, inutilizacao:doc };
  }

  const path = `empresas/${empresa_id}/notas/${b.ref}`;
  const n = b.ref ? await getDoc(path) : null;
  if (!n) throw new Falha('Nota não encontrada.', 404);
  const base = `/v2/${n.modelo === '65' ? 'nfce' : 'nfe'}/${encodeURIComponent(n.ref)}`;

  if (tipo === 'consultar'){
    const r = await focus('GET', base);
    if (r.status === 200){
      n.status = statusDe(r.body); n.focus = { ...resumoFocus(r.body), http:r.status };
      if (r.body.chave_nfe) n.chave = String(r.body.chave_nfe).replace(/\D/g, '');
      await putDoc(path, n, u.id);
      if (n.status === 'autorizada') await rpc('aplicar_estoque_nota', { e:empresa_id, p_ref:n.ref, desfazer:false });
      if (n.status === 'cancelada') await rpc('aplicar_estoque_nota', { e:empresa_id, p_ref:n.ref, desfazer:true });
    }
    return { ok:r.status === 200, nota:n, mensagem:mensagemFocus(r.body) };
  }

  if (n.status !== 'autorizada') throw new Falha('Só é possível fazer isso com nota autorizada.');

  if (tipo === 'cancelar'){
    const just = String(b.justificativa || '').replace(/\s+/g, ' ').trim();
    if (just.length < 15) throw new Falha('A justificativa precisa ter pelo menos 15 caracteres.');
    const r = await focus('DELETE', base, { justificativa:just });
    if (r.body.status !== 'cancelado') return { ok:false, nota:n, mensagem:mensagemFocus(r.body) || `A SEFAZ não confirmou o cancelamento (HTTP ${r.status}).` };
    n.status = 'cancelada'; n.justificativa = just; n.cancelada_em = isoBR();
    n.eventos = [...(n.eventos || []), { tipo:'cancelamento', texto:just, em:n.cancelada_em, focus:resumoFocus(r.body) }];
    await putDoc(path, n, u.id);
    await rpc('aplicar_estoque_nota', { e:empresa_id, p_ref:n.ref, desfazer:true });
    return { ok:true, nota:n };
  }

  if (tipo === 'email'){
    const emails = (Array.isArray(b.emails) ? b.emails : []).map(m => String(m).trim()).filter(m => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)).slice(0, 10);
    if (!emails.length) throw new Falha('Informe um e-mail válido.');
    const r = await focus('POST', base + '/email', { emails });
    if (!(r.status >= 200 && r.status < 300)) return { ok:false, mensagem:mensagemFocus(r.body) || `A Focus não enviou o e-mail (HTTP ${r.status}).` };
    n.enviada_para = [...new Set([...(n.enviada_para || []), ...emails])];
    await putDoc(path, n, u.id);
    return { ok:true, nota:n };
  }

  if (tipo === 'cce'){
    if (n.modelo !== '55') throw new Falha('Carta de correção só existe para NF-e.');
    const texto = String(b.texto || '').replace(/\s+/g, ' ').trim();
    if (texto.length < 15 || texto.length > 1000) throw new Falha('O texto precisa ter entre 15 e 1.000 caracteres.');
    const seq = (n.eventos || []).filter(e => e.tipo === 'cce').length + 1;
    if (seq > 20) throw new Falha('Esta nota já tem 20 cartas de correção.');
    const r = await focus('POST', base + '/carta_correcao', { correcao:texto });
    if (r.body.status !== 'autorizado') return { ok:false, nota:n, mensagem:mensagemFocus(r.body) || `A SEFAZ não confirmou a carta (HTTP ${r.status}).` };
    n.eventos = [...(n.eventos || []), { tipo:'cce', seq, texto, em:isoBR(), focus:resumoFocus(r.body) }];
    await putDoc(path, n, u.id);
    return { ok:true, nota:n };
  }

  throw new Falha('Tipo de evento desconhecido.');
});
