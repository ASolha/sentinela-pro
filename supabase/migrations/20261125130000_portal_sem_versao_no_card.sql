-- ============================================================================
-- Portal de Trocas — tira o número de versão ("(v2)") da observação do card
-- que a conferência cria nos Casos da semana. Só recria portal_receber_item.
-- Rode no SQL Editor (pode rodar mais de uma vez).
-- ============================================================================

create or replace function public.portal_receber_item(p_item uuid, p_seletores text[], p_quantidade int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.portal_itens;
  v_nome text := public.portal_nome_atual();
  v_titulo text;
  v_obs text;
  v_caso uuid;
begin
  if public.is_portal_cliente() or auth.uid() is null then
    raise exception 'Só a equipe confere trocas.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_item from public.portal_itens where id = p_item for update;
  if v_item.id is null then
    raise exception 'Troca não encontrada.';
  end if;
  if v_item.status not in ('enviada', 'recebida') then
    raise exception 'A troca % está como "%" e não pode ser conferida agora.', v_item.codigo, v_item.status;
  end if;

  v_titulo := left(v_item.codigo || case when v_item.referencia <> '' then ' · ' || v_item.referencia else '' end, 120);
  select 'Portal ' || v_item.codigo || ' · '
         || case v_item.peca when 'par' then 'Par' else 'Avulsa' end
         || coalesce(' · ' || string_agg(
              initcap(a ->> 'identificacao')
              || case when (a ->> 'pedra')::boolean then ' com pedra' else '' end
              || ' aro ' || coalesce(a ->> 'aro_atual', '?')
              || case when a ->> 'aro_novo' is not null and a ->> 'aro_novo' <> a ->> 'aro_atual'
                      then ' → ' || (a ->> 'aro_novo') else '' end,
              ' · '), '')
    into v_obs
    from jsonb_array_elements(v_item.aneis) a;

  select id into v_caso from public.aliancas_casos where id = v_item.caso_id;
  if v_caso is null then
    insert into public.aliancas_casos (titulo, seletores, observacao, quantidade, status, created_by, created_by_name)
    values (v_titulo, coalesce(p_seletores, '{}'), v_obs, greatest(1, coalesce(p_quantidade, 1)), 'aberto', auth.uid(), v_nome)
    returning id into v_caso;
  else
    update public.aliancas_casos
       set titulo = v_titulo, seletores = coalesce(p_seletores, '{}'), observacao = v_obs,
           quantidade = greatest(1, coalesce(p_quantidade, 1)), updated_at = now()
     where id = v_caso;
  end if;

  update public.portal_itens
     set status = 'recebida', seletores_confirmados = p_seletores, caso_id = v_caso
   where id = p_item;

  update public.portal_lotes set recebido_em = now() where id = v_item.lote_id and recebido_em is null;
  return v_caso;
end;
$$;

-- cards já criados: tira o "(v2)" da observação
update public.aliancas_casos
   set observacao = regexp_replace(observacao, '^(Portal TR-[0-9-]+) \(v[0-9]+\)', '\1')
 where observacao ~ '^Portal TR-[0-9-]+ \(v[0-9]+\)';
