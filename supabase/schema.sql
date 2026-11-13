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
    when split_part(p_col, '/', 3) in ('produtos','perfis') then coalesce(public.meu_papel(p_empresa) in ('dono','gerente'), false)
    when split_part(p_col, '/', 3) in ('clientes','caixas') then public.meu_papel(p_empresa) is not null
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
    when split_part(p_col, '/', 3) in ('produtos','perfis','clientes','caixas') then coalesce(public.meu_papel(p_empresa) in ('dono','gerente'), false)
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
  using (col = 'ncm' or public.meu_papel(empresa_id) is not null);

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

create or replace function public.convidar(e text, p_email text, p_papel text) returns text
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; em text := lower(trim(p_email));
begin
  if coalesce(public.meu_papel(e), '') <> 'dono' then raise exception 'Só o dono da empresa pode convidar pessoas.'; end if;
  if p_papel not in ('gerente','operador') then raise exception 'Papel inválido.'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.'; end if;
  select id into uid from auth.users where lower(email) = em;
  if uid is not null then
    if exists (select 1 from public.membros where empresa_id = e and user_id = uid and papel = 'dono') then
      raise exception 'Essa pessoa já é a dona da empresa.';
    end if;
    insert into public.membros (empresa_id, user_id, papel) values (e, uid, p_papel)
      on conflict (empresa_id, user_id) do update set papel = excluded.papel;
    return 'adicionado';
  end if;
  insert into public.convites (empresa_id, email, papel, convidado_por) values (e, em, p_papel, auth.uid())
    on conflict (empresa_id, email) do update set papel = excluded.papel;
  return 'convidado';
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
declare n int; em text := lower(auth.email());
begin
  if auth.uid() is null or em is null then return 0; end if;
  insert into public.membros (empresa_id, user_id, papel)
    select empresa_id, auth.uid(), papel from public.convites where email = em
    on conflict do nothing;
  get diagnostics n = row_count;
  delete from public.convites where email = em;
  return n;
end $$;

-- ---------- funções do servidor (só a chave service_role chama) ----------
-- reserva o próximo número de NFC-e/NF-e sem risco de dois caixas pegarem o mesmo
create or replace function public.proximo_numero(e text, campo text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if campo not in ('prox_nfce','prox_nfe') then raise exception 'Campo inválido.'; end if;
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

-- ---------- permissões de execução ----------
revoke execute on function public.proximo_numero(text, text) from public, anon, authenticated;
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
