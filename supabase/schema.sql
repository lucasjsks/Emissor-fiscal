-- =====================================================================
-- Emissor Fiscal — estrutura do banco de dados (Supabase / Postgres)
-- Como usar: Supabase → SQL Editor → New query → cole TUDO → Run.
-- Pode rodar de novo quando houver atualização: o script é idempotente.
-- =====================================================================

-- ---------- tabelas ----------
create table if not exists public.membros (
  empresa_id text not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  papel      text not null check (papel in ('dono','gerente','operador')),
  criado_em  timestamptz not null default now(),
  primary key (empresa_id, user_id)
);

create table if not exists public.convites (
  empresa_id    text not null,
  email         text not null,
  papel         text not null check (papel in ('gerente','operador')),
  convidado_por uuid references auth.users(id) on delete set null,
  criado_em     timestamptz not null default now(),
  primary key (empresa_id, email)
);

-- administradores da plataforma (você): podem atualizar a tabela NCM global
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- documentos do sistema (empresas, produtos, clientes, notas, caixas...)
-- path = 'empresas/<id>' ou 'empresas/<id>/<colecao>/<doc>' ou 'ncm/<doc>'
create table if not exists public.docs (
  path           text primary key,
  col            text not null,
  empresa_id     text,
  data           jsonb not null,
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid default auth.uid(),
  constraint docs_caminho_coerente check (
    col = regexp_replace(path, '/[^/]+$', '')
    and (
      (path like 'empresas/%' and empresa_id = split_part(path, '/', 2))
      or (path not like 'empresas/%' and empresa_id is null)
    )
  )
);
create index if not exists docs_col_idx on public.docs (col);
create index if not exists docs_empresa_idx on public.docs (empresa_id);
create index if not exists docs_chave_idx on public.docs ((data->>'chave')) where col like '%/notas';
alter table public.docs replica identity full;

-- ---------- funções auxiliares ----------
create or replace function public.meu_papel(e text) returns text
language sql stable security definer set search_path = public as $$
  select papel from public.membros where empresa_id = e and user_id = auth.uid()
$$;

create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

-- quem pode gravar em cada coleção (notas e inutilizações: só o servidor)
create or replace function public.pode_gravar(p_col text, p_empresa text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_col = 'ncm' then public.eh_admin()
    when p_empresa is null then false
    when p_col = 'empresas' then coalesce(public.meu_papel(p_empresa) in ('dono','gerente'), false)
    when split_part(p_col, '/', 3) in ('perfis','fornecedores','compras_xml','financeiro') then coalesce(public.meu_papel(p_empresa) in ('dono','gerente'), false)
    -- produtos: o funcionário (operador) também cadastra e edita (não apaga; custo protegido pelo gatilho proteger_custo_operador)
    when split_part(p_col, '/', 3) in ('produtos','clientes','caixas') then public.meu_papel(p_empresa) is not null
    else false
  end
$$;

create or replace function public.pode_apagar(p_col text, p_empresa text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_col = 'ncm' then public.eh_admin()
    when p_empresa is null then false
    -- empresa com notas não pode ser apagada (guarda fiscal obrigatória)
    when p_col = 'empresas' then coalesce(public.meu_papel(p_empresa) = 'dono', false)
      and not exists (select 1 from public.docs d where d.col = 'empresas/' || p_empresa || '/notas')
    when split_part(p_col, '/', 3) in ('produtos','perfis','clientes','caixas','fornecedores','compras_xml','financeiro') then coalesce(public.meu_papel(p_empresa) in ('dono','gerente'), false)
    else false
  end
$$;

create or replace function public.docs_carimbo() returns trigger
language plpgsql as $$
begin
  new.atualizado_em := now();
  new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
  return new;
end $$;
drop trigger if exists docs_carimbo on public.docs;
create trigger docs_carimbo before insert or update on public.docs
  for each row execute function public.docs_carimbo();

-- ao apagar uma empresa, remove os acessos dela (assim o dono pode cadastrar outra)
create or replace function public.empresa_apagada() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.membros where empresa_id = old.empresa_id;
  delete from public.convites where empresa_id = old.empresa_id;
  return old;
end $$;
drop trigger if exists empresa_apagada on public.docs;
create trigger empresa_apagada after delete on public.docs
  for each row when (old.col = 'empresas') execute function public.empresa_apagada();

-- ---------- segurança por linha (RLS) ----------
alter table public.docs enable row level security;
alter table public.membros enable row level security;
alter table public.convites enable row level security;
alter table public.admins enable row level security;

drop policy if exists docs_ler on public.docs;
create policy docs_ler on public.docs for select to authenticated
  -- empresas/<id>/segredos (senha do gerente, em hash) só o servidor lê
  using (col = 'ncm' or (public.meu_papel(empresa_id) is not null and split_part(col, '/', 3) <> 'segredos'));

drop policy if exists docs_inserir on public.docs;
create policy docs_inserir on public.docs for insert to authenticated
  with check (col <> 'empresas' and public.pode_gravar(col, empresa_id));

drop policy if exists docs_alterar on public.docs;
create policy docs_alterar on public.docs for update to authenticated
  using (public.pode_gravar(col, empresa_id))
  with check (public.pode_gravar(col, empresa_id));

drop policy if exists docs_apagar on public.docs;
create policy docs_apagar on public.docs for delete to authenticated
  using (public.pode_apagar(col, empresa_id));

drop policy if exists membros_ler_proprio on public.membros;
create policy membros_ler_proprio on public.membros for select to authenticated
  using (user_id = auth.uid());

-- ---------- ações (chamadas pelo sistema) ----------
create or replace function public.criar_empresa(dados jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare novo text := gen_random_uuid()::text;
begin
  if auth.uid() is null then raise exception 'Faça login para cadastrar a empresa.'; end if;
  -- cada conta pode ser dona de UMA empresa (o sistema é vendido por empresa)
  perform pg_advisory_xact_lock(hashtext('criar_empresa:' || auth.uid()::text));
  if exists (select 1 from public.membros where user_id = auth.uid() and papel = 'dono') then
    raise exception 'Sua conta já tem uma empresa cadastrada. Cada conta pode ter apenas uma empresa.';
  end if;
  insert into public.docs (path, col, empresa_id, data)
    values ('empresas/' || novo, 'empresas', novo, coalesce(dados, '{}'::jsonb) || jsonb_build_object('id', novo));
  insert into public.membros (empresa_id, user_id, papel) values (novo, auth.uid(), 'dono');
  return novo;
end $$;

-- documento da empresa: o CNPJ ou, na empresa cadastrada com CPF (sem nota fiscal), o CPF do dono
create or replace function public.doc_empresa(d jsonb) returns text
language sql immutable as $$
  select coalesce(nullif(regexp_replace(coalesce(d->>'cnpj', ''), '\D', '', 'g'), ''), regexp_replace(coalesce(d->>'cpf', ''), '\D', '', 'g'))
$$;

-- um CNPJ (ou CPF) só pode estar em UMA empresa do sistema (contas diferentes não podem cadastrar a mesma empresa).
-- Confere ao criar e quando o CNPJ é trocado; empresas antigas repetidas continuam podendo salvar outros dados.
create index if not exists docs_empresas_cnpj on public.docs ((regexp_replace(coalesce(data->>'cnpj', ''), '\D', '', 'g'))) where col = 'empresas';
create or replace function public.cnpj_unico() returns trigger
language plpgsql security definer set search_path = public as $$
declare d text := public.doc_empresa(new.data);
begin
  if new.col <> 'empresas' or d = '' then return new; end if;
  if tg_op = 'UPDATE' and d = public.doc_empresa(old.data) then return new; end if;
  perform pg_advisory_xact_lock(hashtext('cnpj_unico:' || d));
  if exists (select 1 from public.docs x where x.col = 'empresas' and x.path <> new.path and public.doc_empresa(x.data) = d) then
    raise exception 'Este % já está cadastrado no NotaOne em outra conta. Se a empresa é sua, entre com a conta dela ou fale com o suporte.', case when length(d) = 11 then 'CPF' else 'CNPJ' end;
  end if;
  return new;
end $$;
drop trigger if exists cnpj_unico on public.docs;
create trigger cnpj_unico before insert or update on public.docs
  for each row execute function public.cnpj_unico();

-- CAIXAS (pontos de venda) da empresa: lista em empresas/<id>.pdvs. O plano permite limite_caixas (padrão 2).
-- A tela não consegue mudar limite_caixas nem passar do limite; só o suporte (SQL abaixo / admin) aumenta.
create or replace function public.limite_caixas() returns trigger
language plpgsql as $$
declare lim int; qtd int; antes int := 0;
begin
  -- ao criar (inclusive por criar_empresa) nunca vem limite; ao alterar, só a tela (authenticated) é conferida
  if new.col <> 'empresas' or (tg_op = 'UPDATE' and current_user not in ('authenticated', 'anon')) then return new; end if;
  if tg_op = 'UPDATE' then
    new.data := (new.data - 'limite_caixas') || jsonb_strip_nulls(jsonb_build_object('limite_caixas', old.data->'limite_caixas'));
    antes := coalesce(jsonb_array_length(case when jsonb_typeof(old.data->'pdvs') = 'array' then old.data->'pdvs' end), 0);
  else
    new.data := new.data - 'limite_caixas';
  end if;
  lim := coalesce((new.data->>'limite_caixas')::int, 2);
  qtd := coalesce(jsonb_array_length(case when jsonb_typeof(new.data->'pdvs') = 'array' then new.data->'pdvs' end), 0);
  if qtd > lim and qtd > antes then
    raise exception 'Seu plano permite % caixa(s). Para usar mais caixas, fale com o suporte.', lim;
  end if;
  return new;
end $$;
drop trigger if exists limite_caixas on public.docs;
create trigger limite_caixas before insert or update on public.docs
  for each row execute function public.limite_caixas();

-- MENSALIDADE (Asaas): empresas/<id>.assinatura só é gravada pelo servidor (api/asaas.js, service_role).
-- A tela não consegue criar nem mudar (nem "marcar como paga"): o valor antigo é mantido.
create or replace function public.proteger_assinatura() returns trigger
language plpgsql as $$
begin
  if new.col <> 'empresas' or current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'UPDATE' then
    new.data := (new.data - 'assinatura') || jsonb_strip_nulls(jsonb_build_object('assinatura', old.data->'assinatura'));
  else
    new.data := new.data - 'assinatura';
  end if;
  return new;
end $$;
drop trigger if exists proteger_assinatura on public.docs;
create trigger proteger_assinatura before insert or update on public.docs
  for each row execute function public.proteger_assinatura();

-- suporte: libera mais caixas para uma empresa. No SQL Editor do Supabase: select public.definir_limite_caixas('CNPJ', 3);
create or replace function public.definir_limite_caixas(p_cnpj text, p_limite int) returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if current_user in ('authenticated', 'anon') and not public.eh_admin() then raise exception 'Sem permissão.'; end if;
  if p_limite < 1 or p_limite > 50 then raise exception 'Limite inválido.'; end if;
  update public.docs set data = jsonb_set(data, '{limite_caixas}', to_jsonb(p_limite), true)
   where col = 'empresas' and public.doc_empresa(data) = regexp_replace(p_cnpj, '\D', '', 'g');
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Nenhuma empresa com esse CNPJ/CPF.'; end if;
  return 'Limite de caixas atualizado para ' || p_limite;
end $$;
revoke execute on function public.definir_limite_caixas(text, int) from public, anon;

-- FUNCIONÁRIOS: o dono cria o acesso pelo sistema (api/equipe.js). Limite do plano em limite_funcionarios (padrão 2).
-- A tela não muda o limite (gatilho abaixo); o suporte libera mais: select public.definir_limite_funcionarios('CNPJ ou CPF', 3);
create or replace function public.proteger_limite_funcionarios() returns trigger
language plpgsql as $$
begin
  if new.col <> 'empresas' or current_user not in ('authenticated', 'anon') then return new; end if;
  -- campos que só o servidor grava: limite do plano, lista de funcionários (quadros da tela de escolha) e aviso de senha do gerente criada
  if tg_op = 'UPDATE' then
    new.data := (new.data - 'limite_funcionarios' - 'funcionarios' - 'senha_gerente') || jsonb_strip_nulls(jsonb_build_object(
      'limite_funcionarios', old.data->'limite_funcionarios', 'funcionarios', old.data->'funcionarios', 'senha_gerente', old.data->'senha_gerente'));
  else
    new.data := new.data - 'limite_funcionarios' - 'funcionarios' - 'senha_gerente';
  end if;
  return new;
end $$;
drop trigger if exists proteger_limite_funcionarios on public.docs;
create trigger proteger_limite_funcionarios before insert or update on public.docs
  for each row execute function public.proteger_limite_funcionarios();
create or replace function public.definir_limite_funcionarios(p_doc text, p_limite int) returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if current_user in ('authenticated', 'anon') and not public.eh_admin() then raise exception 'Sem permissão.'; end if;
  if p_limite < 0 or p_limite > 50 then raise exception 'Limite inválido.'; end if;
  update public.docs set data = jsonb_set(data, '{limite_funcionarios}', to_jsonb(p_limite), true)
   where col = 'empresas' and public.doc_empresa(data) = regexp_replace(p_doc, '\D', '', 'g');
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Nenhuma empresa com esse CNPJ/CPF.'; end if;
  return 'Limite de funcionários atualizado para ' || p_limite;
end $$;
revoke execute on function public.definir_limite_funcionarios(text, int) from public, anon;

-- o funcionário (operador) cadastra e edita produtos, mas não mexe no custo (fica o que estava)
create or replace function public.proteger_custo_operador() returns trigger
language plpgsql set search_path = public as $$
begin
  if split_part(new.col, '/', 3) <> 'produtos' or current_user not in ('authenticated', 'anon')
     or coalesce(public.meu_papel(new.empresa_id), '') <> 'operador' then return new; end if;
  if tg_op = 'UPDATE' then
    new.data := (new.data - 'custo' - 'custo_medio' - 'cod_forn')
      || jsonb_strip_nulls(jsonb_build_object('custo', old.data->'custo', 'custo_medio', old.data->'custo_medio', 'cod_forn', old.data->'cod_forn'));
  else
    new.data := new.data - 'custo' - 'custo_medio' - 'cod_forn';
  end if;
  return new;
end $$;
drop trigger if exists proteger_custo_operador on public.docs;
create trigger proteger_custo_operador before insert or update on public.docs
  for each row execute function public.proteger_custo_operador();

create or replace function public.listar_membros(e text)
returns table (user_id uuid, email text, papel text, criado_em timestamptz, pendente boolean)
language sql stable security definer set search_path = public, auth as $$
  select m.user_id, u.email::text, m.papel, m.criado_em, false
    from public.membros m join auth.users u on u.id = m.user_id
   where m.empresa_id = e and public.meu_papel(e) in ('dono','gerente')
  union all
  select null::uuid, c.email, c.papel, c.criado_em, true
    from public.convites c
   where c.empresa_id = e and public.meu_papel(e) in ('dono','gerente')
$$;

-- cada empresa tem um único usuário (o dono): convites desativados
create or replace function public.convidar(e text, p_email text, p_papel text) returns text
language plpgsql security definer set search_path = public, auth as $$
begin
  raise exception 'Cada empresa tem apenas um usuário (o dono). Não é possível convidar outras pessoas.';
end $$;

create or replace function public.alterar_papel(e text, uid uuid, p_papel text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.meu_papel(e), '') <> 'dono' then raise exception 'Só o dono pode mudar papéis.'; end if;
  if p_papel not in ('gerente','operador') then raise exception 'Papel inválido.'; end if;
  update public.membros set papel = p_papel where empresa_id = e and user_id = uid and papel <> 'dono';
end $$;

create or replace function public.remover_membro(e text, uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.meu_papel(e), '') <> 'dono' then raise exception 'Só o dono pode remover pessoas.'; end if;
  delete from public.membros where empresa_id = e and user_id = uid and papel <> 'dono';
end $$;

create or replace function public.cancelar_convite(e text, p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.meu_papel(e), '') <> 'dono' then raise exception 'Só o dono pode cancelar convites.'; end if;
  delete from public.convites where empresa_id = e and email = lower(trim(p_email));
end $$;

-- chamada no login: transforma convites do seu e-mail em acesso
create or replace function public.aceitar_convites() returns int
language plpgsql security definer set search_path = public as $$
begin
  -- convites desativados (um usuário por empresa): só limpa algum convite antigo do seu e-mail
  if auth.uid() is not null and auth.email() is not null then delete from public.convites where email = lower(auth.email()); end if;
  return 0;
end $$;

-- convites antigos que ainda estavam pendentes deixam de valer
delete from public.convites;

-- ---------- funções do servidor (só a chave service_role chama) ----------
-- reserva o próximo número de NFC-e/NF-e sem risco de dois caixas pegarem o mesmo
create or replace function public.proximo_numero(e text, campo text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if campo not in ('prox_nfce','prox_nfe','prox_venda') then raise exception 'Campo inválido.'; end if;
  update public.docs
     set data = jsonb_set(data, array[campo], to_jsonb(coalesce((data->>campo)::int, 1) + 1))
   where path = 'empresas/' || e
   returning (data->>campo)::int - 1 into n;
  if n is null then raise exception 'Empresa não encontrada.'; end if;
  return n;
end $$;

-- grava um campo do cadastro da empresa sem sobrescrever o resto (ex.: DIFAL por UF)
create or replace function public.gravar_campo_empresa(e text, caminho text[], valor jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.docs set data = jsonb_set(data, caminho, valor, true) where path = 'empresas/' || e;
end $$;

-- garante que o próximo número fique acima de uma faixa inutilizada
create or replace function public.ajustar_proximo(e text, campo text, minimo int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if campo not in ('prox_nfce','prox_nfe') then raise exception 'Campo inválido.'; end if;
  update public.docs
     set data = jsonb_set(data, array[campo], to_jsonb(greatest(coalesce((data->>campo)::int, 1), minimo)))
   where path = 'empresas/' || e;
end $$;

-- =====================================================================
-- ESTOQUE E COMPRAS
-- O saldo (estoque) e o custo médio dos produtos só mudam por movimentos:
-- compra, venda, cancelamento, devolução e ajuste. Nem a tela consegue
-- alterar o saldo diretamente (gatilho proteger_estoque).
-- =====================================================================
create or replace function public._agora() returns text
language sql stable as $$
  select to_char(now() at time zone 'America/Fortaleza', 'YYYY-MM-DD"T"HH24:MI:SS') || '-03:00'
$$;

create or replace function public.proteger_estoque() returns trigger
language plpgsql as $$
begin
  if new.col like 'empresas/%/produtos' and coalesce(current_setting('app.estoque', true), '') <> '1' then
    if tg_op = 'INSERT' then
      new.data := new.data - 'estoque' - 'custo_medio';
    else
      new.data := (new.data - 'estoque' - 'custo_medio' - 'custo')
        || jsonb_strip_nulls(jsonb_build_object('estoque', old.data->'estoque', 'custo_medio', old.data->'custo_medio', 'custo', old.data->'custo'));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists proteger_estoque on public.docs;
create trigger proteger_estoque before insert or update on public.docs
  for each row execute function public.proteger_estoque();

-- movimento interno: soma "delta" ao saldo e registra o histórico
create or replace function public._mover(e text, pid text, delta numeric, tipo text, ref text, docnum text, custo numeric, uid uuid) returns numeric
language plpgsql security definer set search_path = public as $$
declare p jsonb; novo numeric; caminho text := 'empresas/' || e || '/produtos/' || pid;
begin
  perform set_config('app.estoque', '1', true);
  select data into p from public.docs where path = caminho for update;
  if p is null then return null; end if;
  novo := coalesce((p->>'estoque')::numeric, 0) + delta;
  update public.docs set data = data || jsonb_build_object('estoque', novo) where path = caminho;
  insert into public.docs (path, col, empresa_id, data) values (
    'empresas/' || e || '/movimentos/' || gen_random_uuid(), 'empresas/' || e || '/movimentos', e,
    jsonb_build_object('produto_id', pid, 'descricao', p->>'descricao', 'tipo', tipo, 'qtd', delta, 'saldo', novo,
      'custo_unit', custo, 'ref', ref, 'doc', docnum, 'em', public._agora(), 'por', uid));
  return novo;
end $$;

-- lança uma compra (XML ou manual): entra no estoque, atualiza custo e custo médio e guarda o vínculo fornecedor → produto
create or replace function public.lancar_compra(e text, compra jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare cid text := gen_random_uuid()::text; it jsonb; pid text; q numeric; cu numeric; p jsonb; est numeric; cm numeric;
        caminho text; chave text := nullif(compra->>'chave', ''); vk text;
begin
  if coalesce(public.meu_papel(e), '') not in ('dono','gerente') then raise exception 'Só gerente ou dono pode lançar compras.'; end if;
  if jsonb_array_length(coalesce(compra->'itens', '[]'::jsonb)) = 0 then raise exception 'A compra não tem itens.'; end if;
  if chave is not null and exists (select 1 from public.docs where col = 'empresas/' || e || '/compras'
       and data->>'chave' = chave and coalesce(data->>'status', '') <> 'estornada') then
    raise exception 'Esta nota de compra já foi lançada.';
  end if;
  perform set_config('app.estoque', '1', true);
  for it in select value from jsonb_array_elements(compra->'itens') loop
    pid := nullif(it->>'produto_id', ''); q := (it->>'qtd_estoque')::numeric; cu := coalesce((it->>'custo_unit')::numeric, 0);
    if pid is null then raise exception 'Item sem produto vinculado: %', it->>'xProd'; end if;
    if q is null or q <= 0 then raise exception 'Quantidade inválida em: %', it->>'xProd'; end if;
    caminho := 'empresas/' || e || '/produtos/' || pid;
    select data into p from public.docs where path = caminho for update;
    if p is null then raise exception 'Produto não encontrado: %', it->>'xProd'; end if;
    est := coalesce((p->>'estoque')::numeric, 0);
    cm := case when est > 0 and coalesce((p->>'custo_medio')::numeric, 0) > 0
               then round((est * (p->>'custo_medio')::numeric + q * cu) / (est + q), 4) else round(cu, 4) end;
    update public.docs set data = data || jsonb_build_object('custo', round(cu, 4), 'custo_medio', cm) where path = caminho;
    perform public._mover(e, pid, q, 'compra', cid, compra->>'numero', cu, auth.uid());
    vk := nullif(it->>'vinc_chave', '');
    if vk is not null then
      if vk !~ '^[A-Za-z0-9_.-]+$' then raise exception 'Vínculo inválido.'; end if;
      insert into public.docs (path, col, empresa_id, data) values (
        'empresas/' || e || '/vinculos/' || vk, 'empresas/' || e || '/vinculos', e,
        jsonb_build_object('fornecedor_cnpj', compra->>'fornecedor_cnpj', 'cProd', it->>'cProd', 'produto_id', pid,
          'fator', coalesce((it->>'fator')::numeric, 1), 'unidade_forn', it->>'uCom'))
      on conflict (path) do update set data = excluded.data;
    end if;
  end loop;
  insert into public.docs (path, col, empresa_id, data) values (
    'empresas/' || e || '/compras/' || cid, 'empresas/' || e || '/compras', e,
    compra || jsonb_build_object('id', cid, 'status', 'lancada', 'lancado_em', public._agora(), 'lancado_por', auth.uid()));
  return cid;
end $$;

-- desfaz uma compra lançada por engano (tira do estoque)
create or replace function public.estornar_compra(e text, cid text, motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare c jsonb; it jsonb; caminho text := 'empresas/' || e || '/compras/' || cid;
begin
  if coalesce(public.meu_papel(e), '') not in ('dono','gerente') then raise exception 'Só gerente ou dono pode estornar compras.'; end if;
  select data into c from public.docs where path = caminho for update;
  if c is null then raise exception 'Compra não encontrada.'; end if;
  if c->>'status' = 'estornada' then raise exception 'Esta compra já foi estornada.'; end if;
  for it in select value from jsonb_array_elements(c->'itens') loop
    perform public._mover(e, it->>'produto_id', -((it->>'qtd_estoque')::numeric), 'estorno_compra', cid, c->>'numero', null, auth.uid());
  end loop;
  update public.docs set data = data || jsonb_build_object('status', 'estornada', 'estornado_em', public._agora(),
    'estornado_por', auth.uid(), 'motivo_estorno', motivo) where path = caminho;
end $$;

-- inventário: acerta o saldo para a quantidade contada
create or replace function public.ajustar_estoque(e text, pid text, novo_saldo numeric, motivo text) returns numeric
language plpgsql security definer set search_path = public as $$
declare atual numeric;
begin
  if coalesce(public.meu_papel(e), '') not in ('dono','gerente') then raise exception 'Só gerente ou dono pode ajustar o estoque.'; end if;
  select coalesce((data->>'estoque')::numeric, 0) into atual from public.docs where path = 'empresas/' || e || '/produtos/' || pid for update;
  if not found then raise exception 'Produto não encontrado.'; end if;
  if novo_saldo = atual then return atual; end if;
  return public._mover(e, pid, novo_saldo - atual, 'ajuste', null, nullif(trim(motivo), ''), null, auth.uid());
end $$;

-- preço de compra informado à mão no cadastro do produto (opcional): vira o custo e o custo médio.
-- As próximas compras lançadas recalculam o custo médio a partir dele.
create or replace function public.definir_custo(e text, pid text, p_custo numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.meu_papel(e), '') not in ('dono','gerente') then raise exception 'Só gerente ou dono pode informar o preço de compra.'; end if;
  if p_custo is null or p_custo < 0 then raise exception 'Preço de compra inválido.'; end if;
  perform set_config('app.estoque', '1', true);
  update public.docs set data = data || jsonb_build_object('custo', round(p_custo, 4), 'custo_medio', round(p_custo, 4))
   where path = 'empresas/' || e || '/produtos/' || pid;
  if not found then raise exception 'Produto não encontrado.'; end if;
end $$;
revoke execute on function public.definir_custo(text, text, numeric) from public, anon;
grant execute on function public.definir_custo(text, text, numeric) to authenticated;

-- chamada pelo servidor: venda autorizada tira do estoque; cancelamento devolve. Não aplica duas vezes.
create or replace function public.aplicar_estoque_nota(e text, p_ref text, desfazer boolean) returns void
language plpgsql security definer set search_path = public as $$
declare n jsonb; caminho text := 'empresas/' || e || '/notas/' || p_ref; it jsonb; dir int; tipo text; op text;
begin
  select data into n from public.docs where path = caminho for update;
  if n is null then return; end if;
  if desfazer <> coalesce((n->>'estoque_aplicado')::boolean, false) then return; end if;
  op := coalesce(n->>'op', 'venda');
  dir := case op when 'dev_venda' then 1 else -1 end;
  if desfazer then dir := -dir; end if;
  tipo := case when desfazer then 'cancelamento' when op = 'dev_venda' then 'devolucao_venda' when op = 'dev_compra' then 'devolucao_compra' else 'venda' end;
  for it in select value from jsonb_array_elements(coalesce(n->'itens', '[]'::jsonb)) loop
    if nullif(it->>'pid', '') is null or (it->>'q') is null then continue; end if;
    perform public._mover(e, it->>'pid', dir * (it->>'q')::numeric, tipo, p_ref,
      (case n->>'modelo' when '65' then 'NFC-e ' when '99' then 'Venda ' else 'NF-e ' end) || (n->>'numero'), null, null);
  end loop;
  update public.docs set data = data || jsonb_build_object('estoque_aplicado', not desfazer) where path = caminho;
end $$;

-- ---------- permissões de execução ----------
revoke execute on function public.proximo_numero(text, text) from public, anon, authenticated;
revoke execute on function public._mover(text, text, numeric, text, text, text, numeric, uuid) from public, anon, authenticated;
revoke execute on function public.aplicar_estoque_nota(text, text, boolean) from public, anon, authenticated;
grant execute on function public.aplicar_estoque_nota(text, text, boolean) to service_role;
revoke execute on function public.lancar_compra(text, jsonb) from public, anon;
revoke execute on function public.estornar_compra(text, text, text) from public, anon;
revoke execute on function public.ajustar_estoque(text, text, numeric, text) from public, anon;
grant execute on function public.lancar_compra(text, jsonb) to authenticated;
grant execute on function public.estornar_compra(text, text, text) to authenticated;
grant execute on function public.ajustar_estoque(text, text, numeric, text) to authenticated;
revoke execute on function public.gravar_campo_empresa(text, text[], jsonb) from public, anon, authenticated;
revoke execute on function public.ajustar_proximo(text, text, int) from public, anon, authenticated;
grant execute on function public.proximo_numero(text, text) to service_role;
grant execute on function public.gravar_campo_empresa(text, text[], jsonb) to service_role;
grant execute on function public.ajustar_proximo(text, text, int) to service_role;

revoke execute on function public.criar_empresa(jsonb) from public, anon;
revoke execute on function public.listar_membros(text) from public, anon;
revoke execute on function public.convidar(text, text, text) from public, anon;
revoke execute on function public.alterar_papel(text, uuid, text) from public, anon;
revoke execute on function public.remover_membro(text, uuid) from public, anon;
revoke execute on function public.cancelar_convite(text, text) from public, anon;
revoke execute on function public.aceitar_convites() from public, anon;
grant execute on function public.criar_empresa(jsonb) to authenticated;
grant execute on function public.listar_membros(text) to authenticated;
grant execute on function public.convidar(text, text, text) to authenticated;
grant execute on function public.alterar_papel(text, uuid, text) to authenticated;
grant execute on function public.remover_membro(text, uuid) to authenticated;
grant execute on function public.cancelar_convite(text, text) to authenticated;
grant execute on function public.aceitar_convites() to authenticated;
grant execute on function public.meu_papel(text) to authenticated;
grant execute on function public.eh_admin() to authenticated;

-- ---------- tempo real (as telas atualizam sozinhas) ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;
