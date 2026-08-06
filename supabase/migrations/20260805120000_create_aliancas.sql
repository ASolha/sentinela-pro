-- ============================================================================
-- Central de Alianças — casos de troca/gravação enviados pelo cliente
-- Quadro COMPARTILHADO entre os usuários autenticados (todos veem tudo).
-- Admin (alcsolha@gmail.com) gerencia os seletores/classificações.
-- ============================================================================

-- ── Tabela de seletores (classificações) ────────────────────────────────────
create table if not exists public.aliancas_seletores (
  id          bigint generated always as identity primary key,
  label       text not null,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create unique index if not exists aliancas_seletores_label_idx
  on public.aliancas_seletores (lower(label));

create index if not exists aliancas_seletores_order_idx
  on public.aliancas_seletores (is_active, sort_order, label);

alter table public.aliancas_seletores enable row level security;

-- Seed inicial (só insere se ainda não existir o label)
insert into public.aliancas_seletores (label, sort_order)
select v.label, v.ord
from (values
  ('Troca', 10),
  ('Defeito', 20),
  ('Sem defeito', 30),
  ('Nova gravação', 40),
  ('Regravação', 50)
) as v(label, ord)
where not exists (
  select 1 from public.aliancas_seletores s
  where lower(s.label) = lower(v.label)
);

-- ── Tabela de casos (cards) ─────────────────────────────────────────────────
create table if not exists public.aliancas_casos (
  id               uuid primary key default gen_random_uuid(),
  titulo           text not null default '',
  seletores        text[] not null default '{}',   -- labels denormalizados (relatório estável no tempo)
  observacao       text not null default '',
  quantidade       int not null default 1,          -- nº de alianças que o caso representa (par = 2)
  status           text not null default 'aberto',  -- 'aberto' | 'finalizado'
  is_archived      boolean not null default false,
  archived_at      timestamptz,
  batch_label      text,                            -- rótulo da semana/lote quando arquivado
  created_by       uuid not null references auth.users (id) on delete cascade,
  created_by_name  text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  finalized_at     timestamptz
);

create index if not exists aliancas_casos_active_idx
  on public.aliancas_casos (is_archived, created_at desc);

create index if not exists aliancas_casos_batch_idx
  on public.aliancas_casos (batch_label);

alter table public.aliancas_casos enable row level security;

-- ── Políticas RLS ───────────────────────────────────────────────────────────
do $$
begin
  -- SELETORES: todos autenticados leem; só o admin escreve.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='aliancas_seletores' and policyname='aliancas_seletores_select_authenticated') then
    create policy aliancas_seletores_select_authenticated
      on public.aliancas_seletores for select to authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='aliancas_seletores' and policyname='aliancas_seletores_admin_insert') then
    create policy aliancas_seletores_admin_insert
      on public.aliancas_seletores for insert to authenticated
      with check ((auth.jwt() ->> 'email') = 'alcsolha@gmail.com');
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='aliancas_seletores' and policyname='aliancas_seletores_admin_update') then
    create policy aliancas_seletores_admin_update
      on public.aliancas_seletores for update to authenticated
      using ((auth.jwt() ->> 'email') = 'alcsolha@gmail.com')
      with check ((auth.jwt() ->> 'email') = 'alcsolha@gmail.com');
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='aliancas_seletores' and policyname='aliancas_seletores_admin_delete') then
    create policy aliancas_seletores_admin_delete
      on public.aliancas_seletores for delete to authenticated
      using ((auth.jwt() ->> 'email') = 'alcsolha@gmail.com');
  end if;

  -- CASOS: quadro compartilhado. Todos autenticados leem/criam/editam.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='aliancas_casos' and policyname='aliancas_casos_select_authenticated') then
    create policy aliancas_casos_select_authenticated
      on public.aliancas_casos for select to authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='aliancas_casos' and policyname='aliancas_casos_insert_authenticated') then
    create policy aliancas_casos_insert_authenticated
      on public.aliancas_casos for insert to authenticated
      with check (auth.uid() = created_by);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='aliancas_casos' and policyname='aliancas_casos_update_authenticated') then
    create policy aliancas_casos_update_authenticated
      on public.aliancas_casos for update to authenticated
      using (true) with check (true);
  end if;

  -- DELETE: apenas quem criou o caso OU o admin.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='aliancas_casos' and policyname='aliancas_casos_delete_owner_or_admin') then
    create policy aliancas_casos_delete_owner_or_admin
      on public.aliancas_casos for delete to authenticated
      using (auth.uid() = created_by or (auth.jwt() ->> 'email') = 'alcsolha@gmail.com');
  end if;
end
$$;
