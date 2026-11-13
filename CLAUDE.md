# Emissor Fiscal — instruções para o Claude

Sistema SaaS de emissão de NF-e/NFC-e (Piauí) do Lucas, que trabalha em escritório de contabilidade e pretende vender o sistema para empresas. Ele **não programa**: explique tudo em português simples, sem jargão, e diga exatamente onde clicar quando ele precisar agir.

## Arquitetura
- `index.html` — app inteiro (HTML+CSS+JS puro, mobile first). **Sem build e sem dependências npm.** supabase-js é carregado por `import()` do jsDelivr.
  - Camada de dados `criarShim()` imita a API doc/collection/onSnapshot sobre a tabela `docs` (path, col, empresa_id, data jsonb) com Realtime.
  - Caminhos: `empresas/<id>`, `empresas/<id>/{produtos,clientes,notas,caixas,perfis,inutilizacoes,fornecedores,compras,compras_xml,vinculos,movimentos}/<doc>`, `ncm/<doc>`.
- `api/` — funções Vercel (Node 18+, ESM, só `fetch`). `_lib.js` (auth, Supabase service role, Focus), `config.js`, `emitir.js`, `evento.js` (consultar/cancelar/cce/inutilizar).
- `supabase/schema.sql` — tabelas, RLS, RPCs. **Idempotente**: altere sempre de forma que possa rodar de novo.

## Regras
- Notas e inutilizações só podem ser gravadas pelo servidor (RLS bloqueia o cliente). Numeração via RPC `proximo_numero`.
- Segredos (token Focus, service_role) só em variáveis da Vercel. Nunca no código, nunca pedir no chat.
- **Uma empresa por conta** (o sistema é vendido por empresa): `criar_empresa` recusa se o usuário já é dono de alguma; a tela não oferece "nova empresa". Empresa com notas não pode ser apagada.
- **Estoque:** o saldo (`estoque`) e o `custo_medio` do produto só mudam por movimentos, via funções do banco: `lancar_compra`, `estornar_compra`, `ajustar_estoque` (gerente/dono) e `aplicar_estoque_nota` (servidor: venda autorizada baixa, cancelamento devolve; não aplica duas vezes). O gatilho `proteger_estoque` ignora qualquer saldo enviado pela tela. `compras`, `vinculos` e `movimentos` só são gravados por essas funções. Vínculo fornecedor+código → produto e fator de conversão (ex.: 1 CX = 12 UN) ficam em `vinculos` e são lembrados na próxima compra. Compra **não altera preço de venda** (decisão do Lucas). Venda sem estoque é permitida, com aviso.
- **Abas:** Compras (notas de compra + fornecedores; importação de vários XMLs, lançamento manual completo com impostos/frete/parcelas, visualização e PDF no modelo oficial do DANFE (`danfeOficialHtml`, código de barras CODE-128C da chave; lido do XML guardado ou montado do lançamento manual), baixar XML, corrigir = estornar e relançar), Produtos e estoque numa aba só (lista com preço e saldo, filtros estoque baixo/negativos/sem entrada/atalhos/erro fiscal, busca, cadastro, ficha de estoque com inventário e movimentações, perfis; tabela NCM num quadro recolhível). Não existe mais aba Estoque separada. O XML original fica em `compras_xml/<id da compra>` (gerente/dono).
- **Início** (aba padrão, `vInicio`): vendas de hoje × ontem, gráfico de 7 dias, mês × mesmo período do mês anterior, recebido por forma, mais vendidos do mês, ações rápidas e alertas clicáveis (`alertasInicio`: notas com problema, contingência, números pulados, caixa, estoque negativo/baixo, erro fiscal, sem preço, parcelas de compra em 7 dias).
- **Visual:** bloco CSS "visual moderno" no fim do `<style>` (tokens em `:root`). Celular: barra inferior; computador (≥1000px): menu lateral com seções (`NAV_SEC`) e título da aba no cabeçalho.
- **Cupom rápido:** Enter na busca adiciona por código interno/GTIN exato (leitor), `3*código` multiplica, etiqueta de balança (13 dígitos começando com 2; config em `empresa.balanca` {ativo, digitos 4|5, tipo preco|peso}; produto achado pelo código interno), atalhos (`produto.favorito`), teclas F2/F4/F6/F7/F8/F9 e Del. Quantidades com até 4 casas (`rq`).
- Testar o banco: `npm run test:banco` (precisa de Postgres local; `test/banco/prelude.sql` imita o Supabase).
- Papéis: dono > gerente > operador. Checar no servidor (`papelDe`) e no RLS (`pode_gravar`/`pode_apagar`), não só na tela.
- Rodar `npm test` antes de enviar. Testes usam fetch simulado (`test/api.test.js`).
- Validado em homologação (12/11/2026, empresa piloto em Campo Maior/PI, Simples): emissão de NFC-e, cupom oficial e XML, cancelamento, pagamento dividido/troco, NF-e com consulta de situação e fechamento de caixa — tudo autorizado pela SEFAZ-PI.
- Ainda **não validados** em envio real: campos de ICMS-ST, DIFAL, devolução, carta de correção, inutilização e IBS/CBS. Ao receber rejeições, ajustar e registrar aqui.
- Datas no formato `YYYY-MM-DDTHH:MM:SS-03:00` (`isoNow()`/`isoBR()`).

## Fluxo de trabalho
- Trabalhar em branch e abrir PR; o Lucas faz o merge (a Vercel publica a `main`).
- Variáveis da Vercel: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, FOCUS_TOKEN_HOMOLOGACAO, FOCUS_AMBIENTE (e FOCUS_TOKEN_PRODUCAO quando for para produção).

## Roteiro
1. Fundação (feito e validado em homologação): login, multiempresa, emissão real de NFC-e e NF-e.
2. Validar em homologação com o primeiro cliente piloto; mapear IBS/CBS.
3. Estoque e Compras (feito): aba Compras completa, compras por XML ou manual, vínculo automático, conversão de unidade, baixa na venda, inventário, fornecedores.
4. Financeiro (contas a pagar/receber, conciliação PIX/cartão, DRE).
5. Venda: site, planos, cobrança, contrato, LGPD.
