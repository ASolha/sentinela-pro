create table if not exists public.order_picker_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  login_cliente text not null default '',
  numero_venda text not null,
  url text,
  selected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists order_picker_history_user_selected_idx
  on public.order_picker_history (user_id, selected_at desc);

create index if not exists order_picker_history_user_login_idx
  on public.order_picker_history (user_id, lower(login_cliente));

create index if not exists order_picker_history_user_venda_idx
  on public.order_picker_history (user_id, numero_venda);

alter table public.order_picker_history enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'order_picker_history'
      and policyname = 'order_picker_history_select_own'
  ) then
    create policy order_picker_history_select_own
      on public.order_picker_history
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'order_picker_history'
      and policyname = 'order_picker_history_insert_own'
  ) then
    create policy order_picker_history_insert_own
      on public.order_picker_history
      for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'order_picker_history'
      and policyname = 'order_picker_history_delete_own'
  ) then
    create policy order_picker_history_delete_own
      on public.order_picker_history
      for delete
      to authenticated
      using (auth.uid() = user_id);
  end if;
end
$$;
