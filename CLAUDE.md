# Emissor Fiscal — instruções para o Claude

Sistema SaaS de emissão de NF-e/NFC-e (Piauí) do Lucas, que trabalha em escritório de contabilidade e pretende vender o sistema para empresas. Ele **não programa**: explique tudo em português simples, sem jargão, e diga exatamente onde clicar quando ele precisar agir.

## Arquitetura
- `index.html` — app inteiro (HTML+CSS+JS puro, mobile first). **Sem build e sem dependências npm.** supabase-js é carregado por `import()` do jsDelivr.
  - Camada de dados `criarShim()` imita a API doc/collection/onSnapshot sobre a tabela `docs` (path, col, empresa_id, data jsonb) com Realtime.
  - Caminhos: `empresas/<id>`, `empresas/<id>/{produtos,clientes,notas,caixas,perfis,inutilizacoes}/<doc>`, `ncm/<doc>`.
- `api/` — funções Vercel (Node 18+, ESM, só `fetch`). `_lib.js` (auth, Supabase service role, Focus), `config.js`, `emitir.js`, `evento.js` (consultar/cancelar/cce/inutilizar).
- `supabase/schema.sql` — tabelas, RLS, RPCs. **Idempotente**: altere sempre de forma que possa rodar de novo.

## Regras
- Notas e inutilizações só podem ser gravadas pelo servidor (RLS bloqueia o cliente). Numeração via RPC `proximo_numero`.
- Segredos (token Focus, service_role) só em variáveis da Vercel. Nunca no código, nunca pedir no chat.
- **Uma empresa por conta** (o sistema é vendido por empresa): `criar_empresa` recusa se o usuário já é dono de alguma; a tela não oferece "nova empresa". Empresa com notas não pode ser apagada.
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
3. Estoque (entrada por XML, baixa na venda, inventário).
4. Financeiro (contas a pagar/receber, conciliação PIX/cartão, DRE).
5. Venda: site, planos, cobrança, contrato, LGPD.
