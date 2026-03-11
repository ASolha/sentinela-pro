create table if not exists public.hub_user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists hub_user_profiles_display_name_idx
  on public.hub_user_profiles (lower(display_name));

alter table public.hub_user_profiles enable row level security;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_picker_history'
      and column_name = 'owner_email'
  ) then
    alter table public.order_picker_history
      add column owner_email text;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'order_picker_history'
      and policyname = 'order_picker_history_select_own'
  ) then
    drop policy order_picker_history_select_own on public.order_picker_history;
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'order_picker_history'
      and policyname = 'order_picker_history_select_authenticated'
  ) then
    create policy order_picker_history_select_authenticated
      on public.order_picker_history
      for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'hub_user_profiles'
      and policyname = 'hub_user_profiles_select_authenticated'
  ) then
    create policy hub_user_profiles_select_authenticated
      on public.hub_user_profiles
      for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'hub_user_profiles'
      and policyname = 'hub_user_profiles_insert_own'
  ) then
    create policy hub_user_profiles_insert_own
      on public.hub_user_profiles
      for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'hub_user_profiles'
      and policyname = 'hub_user_profiles_update_own'
  ) then
    create policy hub_user_profiles_update_own
      on public.hub_user_profiles
      for update
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end
$$;
