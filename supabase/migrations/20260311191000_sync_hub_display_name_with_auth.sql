create or replace function public.set_hub_display_name(p_display_name text)
returns public.hub_user_profiles
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_display_name text := trim(coalesce(p_display_name, ''));
  v_profile public.hub_user_profiles;
begin
  if v_user_id is null then
    raise exception 'Usuário não autenticado.';
  end if;

  if v_display_name = '' then
    raise exception 'Informe um nome de exibição.';
  end if;

  insert into public.hub_user_profiles (user_id, display_name, updated_at)
  values (v_user_id, v_display_name, now())
  on conflict (user_id) do update
    set display_name = excluded.display_name,
        updated_at = excluded.updated_at;

  update auth.users
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
       || jsonb_build_object(
         'display_name', v_display_name,
         'full_name', v_display_name,
         'name', v_display_name
       )
   where id = v_user_id;

  select *
    into v_profile
    from public.hub_user_profiles
   where user_id = v_user_id;

  return v_profile;
end;
$$;

grant execute on function public.set_hub_display_name(text) to authenticated;

insert into public.hub_user_profiles (user_id, display_name, updated_at)
select
  u.id,
  seed.display_name,
  now()
from auth.users u
join (
  values
    ('alcsolha@gmail.com', 'André Solha'),
    ('8chanfrado@gmail.com', 'Victor'),
    ('medieval.chi@gmail.com', 'Tiago Bertho')
) as seed(email, display_name)
  on lower(u.email) = lower(seed.email)
on conflict (user_id) do update
  set display_name = excluded.display_name,
      updated_at = excluded.updated_at;

update auth.users u
   set raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb)
     || jsonb_build_object(
       'display_name', seed.display_name,
       'full_name', seed.display_name,
       'name', seed.display_name
     )
from (
  values
    ('alcsolha@gmail.com', 'André Solha'),
    ('8chanfrado@gmail.com', 'Victor'),
    ('medieval.chi@gmail.com', 'Tiago Bertho')
) as seed(email, display_name)
where lower(u.email) = lower(seed.email);
