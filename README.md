# Emissor Fiscal

Sistema web de emissão de **NFC-e (cupom)** e **NF-e**, com caixa, relatórios, conferência fiscal de NCM, perfis de tributação e controle de usuários por empresa. Feito para o Piauí, pronto para atender várias empresas.

- **Site e telas:** `index.html` (um arquivo, sem etapa de build)
- **Servidor:** funções da Vercel em `api/` — falam com a Focus NFe e reservam a numeração
- **Banco e login:** Supabase — script em `supabase/schema.sql`

---

## Instalação (passo a passo)

### 1. Supabase — banco de dados e login
1. Abra seu projeto no Supabase → **SQL Editor** → **New query**.
2. Cole **todo** o conteúdo de `supabase/schema.sql` e clique em **Run**. (Pode rodar de novo sempre que o arquivo for atualizado.)
3. Em **Project Settings → API Keys**, anote:
   - **Project URL** (ex.: `https://abcd.supabase.co`)
   - **anon / publishable key** (pública)
   - **service_role / secret key** (secreta — nunca coloque no código nem mande por chat)
   > Se aparecerem duas abas de chaves, use as da aba **Legacy API keys** (`anon` e `service_role`). As novas também funcionam.
4. Em **Authentication → URL Configuration**, coloque em **Site URL** o endereço do site na Vercel (passo 2). Deixe a confirmação de e-mail **ligada**.

### 2. Vercel — colocar no ar
1. **Add New → Project** → importe o repositório `emissor-fiscal`.
2. Framework: **Other**. Não precisa de comando de build. Clique em **Deploy**.
3. Em **Settings → Environment Variables**, cadastre:

| Variável | Valor |
|---|---|
| `SUPABASE_URL` | Project URL do Supabase |
| `SUPABASE_ANON_KEY` | chave anon/publishable |
| `SUPABASE_SERVICE_ROLE_KEY` | chave service_role/secret |
| `FOCUS_TOKEN_HOMOLOGACAO` | token de homologação da Focus NFe |
| `FOCUS_AMBIENTE` | `homologacao` |

4. Vá em **Deployments** → no último deploy, **⋯ → Redeploy** (para as variáveis valerem).

### 3. Focus NFe — empresa e certificado
No painel da Focus (ambiente de homologação):
1. Cadastre a empresa emitente com o **mesmo CNPJ** que você vai usar no sistema.
2. Envie o **certificado A1** (.pfx) e a senha.
3. Habilite **NF-e** e **NFC-e** e informe o **CSC de homologação** (ID e código) gerado no portal da SEFAZ-PI.

### 4. Primeiro uso
1. Abra o site, clique em **Criar conta**, confirme pelo e-mail e entre.
2. Cadastre a empresa (mesmo CNPJ da Focus), um produto e um cliente.
3. Aba **Caixa** → abra o caixa → aba **Cupom** → venda e emita.
4. Para liberar a importação da tabela NCM oficial para você, rode no SQL Editor (trocando o e-mail):
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'seu@email.com';
   ```

---

## Como funciona a segurança
- Cada empresa só enxerga os próprios dados (regras **RLS** no banco).
- Papéis por empresa: **dono** (tudo, inclusive convidar), **gerente** (tudo menos convidar) e **operador** (emite, cadastra clientes, usa o caixa).
- Notas e inutilizações só são gravadas pelo **servidor**, depois da resposta da SEFAZ. Ninguém consegue “fabricar” uma nota pelo navegador.
- A numeração é reservada no banco de forma atômica: dois caixas nunca pegam o mesmo número.
- Token da Focus e chave service_role ficam só nas variáveis da Vercel.

## Testes
```bash
npm test
```
Testa as rotas do servidor com Supabase e Focus simulados (emissão, rejeição, permissões, cancelamento, CC-e e inutilização).

## Situação atual e próximos passos
- [x] Emissão real de NFC-e e NF-e em homologação via Focus (cancelamento, carta de correção, inutilização, consulta)
- [x] Login, várias empresas, convites e papéis com trava no banco
- [x] NFC-e e NF-e autorizadas na SEFAZ-PI em homologação (emissão, cancelamento, consulta)
- [ ] Validar em homologação: ICMS-ST, DIFAL, devolução, carta de correção e inutilização
- [ ] Mapear os campos de IBS/CBS no layout da Focus
- [ ] Pacote mensal com os XMLs autorizados (hoje leva os dados de envio)
- [ ] Contingência offline e impressão direta (programa local no caixa)
- [x] Estoque: compras por XML ou manual, baixa automática nas vendas, inventário e fornecedores
- [ ] Financeiro
