-- ============================================================================
-- Regras do resumo da Central de Alianças
-- Cada regra casa com um conjunto EXATO de seletores e define um rótulo próprio
-- + a ordem em que a combinação aparece no topo do resumo consolidado.
-- Gerenciadas pelo admin (alcsolha@gmail.com) na tela "Regras do resumo".
-- ============================================================================

create table if not exists public.aliancas_resumo_regras (
  id          bigint generated always as identity primary key,
  seletores   text[] not null default '{}',   -- conjunto de labels que dispara a regra
  label       text not null,                  -- rótulo exibido (ex.: "Troca com Defeito")
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists aliancas_resumo_regras_order_idx
  on public.aliancas_resumo_regras (sort_order, id);

alter table public.aliancas_resumo_regras enable row level security;

do $$
begin
  -- Todos autenticados leem (o resumo é compartilhado); só o admin escreve.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='aliancas_resumo_regras' and policyname='aliancas_resumo_regras_select_authenticated') then
    create policy aliancas_resumo_regras_select_authenticated
      on public.aliancas_resumo_regras for select to authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='aliancas_resumo_regras' and policyname='aliancas_resumo_regras_admin_insert') then
    create policy aliancas_resumo_regras_admin_insert
      on public.aliancas_resumo_regras for insert to authenticated
      with check ((auth.jwt() ->> 'email') = 'alcsolha@gmail.com');
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='aliancas_resumo_regras' and policyname='aliancas_resumo_regras_admin_update') then
    create policy aliancas_resumo_regras_admin_update
      on public.aliancas_resumo_regras for update to authenticated
      using ((auth.jwt() ->> 'email') = 'alcsolha@gmail.com')
      with check ((auth.jwt() ->> 'email') = 'alcsolha@gmail.com');
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='aliancas_resumo_regras' and policyname='aliancas_resumo_regras_admin_delete') then
    create policy aliancas_resumo_regras_admin_delete
      on public.aliancas_resumo_regras for delete to authenticated
      using ((auth.jwt() ->> 'email') = 'alcsolha@gmail.com');
  end if;
end
$$;
