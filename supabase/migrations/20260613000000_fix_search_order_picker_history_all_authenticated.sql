-- Restaura a funcao de busca sem restricao de admin.
-- A versao anterior deployada no Supabase tinha um check de administrador
-- que bloqueava usuarios normais (Tiago, Victor etc.) de buscar historico.
-- Esta versao permite qualquer usuario autenticado buscar.

drop function if exists public.search_order_picker_history(text, text, integer);

create or replace function public.search_order_picker_history(
  p_login text default null,
  p_sale  text default null,
  p_limit integer default 40
)
returns table (
  id            uuid,
  user_id       uuid,
  owner_email   text,
  login_cliente text,
  numero_venda  text,
  url           text,
  selected_at   timestamptz,
  created_at    timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid    := auth.uid();
  v_login   text    := nullif(trim(coalesce(p_login, '')), '');
  v_sale    text    := nullif(regexp_replace(coalesce(p_sale, ''), '\D', '', 'g'), '');
  v_limit   integer := least(greatest(coalesce(p_limit, 40), 1), 100);
begin
  if v_user_id is null then
    raise exception 'Usuario nao autenticado.';
  end if;

  if v_login is null and v_sale is null then
    raise exception 'Informe login ou venda para buscar.';
  end if;

  return query
  select
    oph.id,
    oph.user_id,
    oph.owner_email,
    oph.login_cliente,
    oph.numero_venda,
    oph.url,
    oph.selected_at,
    oph.created_at
  from public.order_picker_history as oph
  where (v_login is null or lower(oph.login_cliente) like '%' || lower(v_login) || '%')
    and (v_sale  is null or oph.numero_venda         like '%' || v_sale          || '%')
  order by oph.selected_at desc
  limit v_limit;
end;
$$;

grant execute on function public.search_order_picker_history(text, text, integer) to authenticated;
