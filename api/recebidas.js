// POST /api/recebidas — notas de compra emitidas contra o CNPJ da empresa (Manifestação do Destinatário).
//   acao 'buscar'      → baixa da Focus as notas novas/alteradas e grava em empresas/<id>/recebidas/<chave>
//   acao 'manifestar'  → ciência, confirmação, desconhecimento ou operação não realizada
//   acao 'xml'         → XML completo (liberado pela SEFAZ depois da ciência), para dar entrada na aba Compras
import { rota, Falha, usuario, papelDe, getDoc, putDoc, putDocs, rpc, focus, mensagemFocus, isoBR, ambienteMde } from './_lib.js';

const dig = s => String(s || '').replace(/\D/g, '');
export const TIPOS = { ciencia:'ciencia', confirmacao:'confirmacao', desconhecimento:'desconhecimento', nao_realizada:'nao_realizada' };
const ok = s => s >= 200 && s < 300;

export function resumoRecebida(x){
  return { chave:dig(x.chave_nfe), emitente_nome:x.nome_emitente || '', emitente_doc:dig(x.documento_emitente), valor:Number(x.valor_total) || 0,
    data_emissao:x.data_emissao || '', situacao:x.situacao || 'autorizada', manifestacao:x.manifestacao_destinatario || 'nulo',
    completa:!!x.nfe_completa, tipo_nfe:x.tipo_nfe ?? null, versao:Number(x.versao) || 0,
    data_cancelamento:x.data_cancelamento || null, carta_correcao:x.carta_correcao || null, sinc_em:isoBR() };
}

export default rota(async (req, b) => {
  const u = await usuario(req);
  const { empresa_id, acao } = b;
  if (!empresa_id || !acao) throw new Falha('Requisição incompleta.');
  const papel = await papelDe(empresa_id, u.id);
  if (!papel) throw new Falha('Você não tem acesso a esta empresa.', 403);
  if (papel === 'operador') throw new Falha('As notas recebidas são só para gerente ou dono.', 403);
  const emp = await getDoc('empresas/' + empresa_id);
  if (!emp) throw new Falha('Empresa não encontrada.', 404);
  const cnpj = dig(emp.cnpj), amb = ambienteMde(), base = `empresas/${empresa_id}/recebidas/`;

  if (acao === 'buscar'){
    let versao = Number(emp.mde_versao) || 0, gravadas = 0;
    for (let pag = 0; pag < 10; pag++){
      const r = await focus('GET', `/v2/nfes_recebidas?cnpj=${cnpj}&versao=${versao}`, undefined, { amb });
      if (!ok(r.status)){
        const m = mensagemFocus(r.body);
        if (r.status === 404 || r.status === 403 || /habilit|permiss|não encontrad/i.test(m))
          throw new Falha('A Focus NFe ainda não está liberada para buscar as notas recebidas desta empresa. ' +
            'No painel da Focus, edite a empresa e marque a opção de Manifestação/recebimento de NF-e (precisa do certificado digital cadastrado).' + (m ? ` (${m})` : ''));
        throw new Falha(m || `A Focus NFe não respondeu (HTTP ${r.status}).`, 502);
      }
      const lista = Array.isArray(r.body) ? r.body : [];
      const docs = lista.map(resumoRecebida).filter(x => x.chave.length === 44).map(data => ({ path:base + data.chave, data }));
      await putDocs(docs, u.id); gravadas += docs.length;
      const max = Math.max(versao, Number(r.headers.get('x-max-version')) || 0, ...lista.map(x => Number(x.versao) || 0));
      if (!lista.length || max <= versao){ versao = max; break; }
      versao = max;
      if (lista.length < 100) break;
    }
    await rpc('gravar_campo_empresa', { e:empresa_id, caminho:['mde'], valor:{ versao, sinc_em:isoBR(), ambiente:amb } });
    return { ok:true, gravadas, ambiente:amb };
  }

  const chave = dig(b.chave);
  if (chave.length !== 44) throw new Falha('Chave de acesso inválida.');
  const path = base + chave, atual = await getDoc(path);

  if (acao === 'manifestar'){
    const tipo = TIPOS[b.tipo];
    if (!tipo) throw new Falha('Tipo de manifestação inválido.');
    const just = String(b.justificativa || '').replace(/\s+/g, ' ').trim();
    if (tipo === 'nao_realizada' && (just.length < 15 || just.length > 255)) throw new Falha('Escreva o motivo com pelo menos 15 caracteres.');
    const r = await focus('POST', `/v2/nfes_recebidas/${chave}/manifesto`, { tipo, ...(tipo === 'nao_realizada' ? { justificativa:just } : {}) }, { amb });
    const m = mensagemFocus(r.body);
    if (!ok(r.status) || (r.body.status && !/registrado|autorizado|duplic/i.test(r.body.status + ' ' + m)))
      return { ok:false, mensagem:m || `A SEFAZ não registrou a manifestação (HTTP ${r.status}).` };
    const novo = { ...(atual || { chave }), manifestacao:tipo, manifestado_em:isoBR(), manifestado_por:u.id, ...(just ? { justificativa:just } : {}) };
    await putDoc(path, novo, u.id);
    return { ok:true, recebida:novo, mensagem:m };
  }

  if (acao === 'xml'){
    const r = await focus('GET', `/v2/nfes_recebidas/${chave}.xml`, undefined, { amb, texto:true });
    if (ok(r.status) && /<infNFe/.test(r.texto || '')) return { ok:true, xml:r.texto };
    return { ok:false, mensagem:'A nota completa ainda não foi liberada pela SEFAZ. Dê ciência e tente de novo em alguns minutos.' };
  }

  throw new Falha('Ação desconhecida.');
});
