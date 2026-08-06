-- ============================================================================
-- Libera a exclusão de casos para todos os usuários autenticados (quadro
-- compartilhado). Antes só o criador do card ou o admin podiam excluir.
-- A tela de "Excluir lote" no Histórico continua restrita ao admin apenas na
-- UI (o botão só aparece para o admin); no banco o delete fica liberado.
-- ============================================================================

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'aliancas_casos'
      and policyname = 'aliancas_casos_delete_owner_or_admin'
  ) then
    drop policy aliancas_casos_delete_owner_or_admin on public.aliancas_casos;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'aliancas_casos'
      and policyname = 'aliancas_casos_delete_authenticated'
  ) then
    create policy aliancas_casos_delete_authenticated
      on public.aliancas_casos for delete to authenticated
      using (true);
  end if;
end
$$;
