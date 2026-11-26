// Planos do NotaOne (decisão do Lucas, 25/11/2026). Fonte única: o servidor usa daqui e a tela recebe por /api/config.
//   doc: para que tipo de empresa o plano vale ('cnpj' emite nota; 'cpf' vende sem nota; 'academia' = módulo Academia, com CPF ou CNPJ)
export const PLANOS = [
  { id:'cpf',     nome:'Pessoa Física', valor:49.99,  caixas:1, doc:'cpf',  resumo:'Sem CNPJ: vendas com comprovante, estoque, financeiro e relatórios' },
  { id:'1caixa',  nome:'1 Caixa',       valor:89.99,  caixas:1, doc:'cnpj', resumo:'NF-e e NFC-e, 1 caixa (PDV), estoque, compras e financeiro' },
  { id:'2caixas', nome:'2 Caixas',      valor:129.99, caixas:2, doc:'cnpj', resumo:'NF-e e NFC-e, 2 caixas (PDV), estoque, compras e financeiro' },
  // academia (pedido do Lucas, 26/11/2026): preço único, com CPF ou CNPJ
  { id:'academia', nome:'Academia',     valor:89.99,  caixas:1, doc:'academia', resumo:'Alunos, check-in, mensalidades, avisos no WhatsApp, financeiro e relatórios' },
];
export const planoPorId = id => PLANOS.find(p => p.id === id) || null;
// grupo de planos da empresa: academia (qualquer documento) ou, nos outros ramos, CPF / CNPJ
export const docDaEmpresa = e => (e && e.modulo === 'servico' && e.servico === 'academia') ? 'academia' : (e && e.doc_tipo === 'cpf') ? 'cpf' : 'cnpj';
// plano que vale para a empresa (o gravado, se combinar com o tipo da empresa)
export const planoDaEmpresa = e => { const p = planoPorId(((e || {}).plano || {}).id); return p && p.doc === docDaEmpresa(e) ? p : null; };
// valor especial combinado com o cliente (Painel NotaOne) vence o valor do plano
export const valorEspecial = e => { const v = Number((((e || {}).mensalidade_especial) || {}).valor); return v > 0 ? Math.round(v * 100) / 100 : null; };
export const valorDaEmpresa = e => valorEspecial(e) || (planoDaEmpresa(e) || {}).valor || null;
