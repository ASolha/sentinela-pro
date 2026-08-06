-- ============================================================================
-- Habilita Supabase Realtime para a Central de Alianças.
-- Sem adicionar as tabelas à publication supabase_realtime, o servidor não
-- emite eventos de INSERT/UPDATE/DELETE e a atualização ao vivo não funciona.
-- REPLICA IDENTITY FULL garante que eventos de UPDATE/DELETE tragam a linha
-- inteira (necessário para o Realtime avaliar RLS em linhas removidas).
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'aliancas_casos'
  ) then
    alter publication supabase_realtime add table public.aliancas_casos;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'aliancas_seletores'
  ) then
    alter publication supabase_realtime add table public.aliancas_seletores;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'aliancas_resumo_regras'
  ) then
    alter publication supabase_realtime add table public.aliancas_resumo_regras;
  end if;
end
$$;

alter table public.aliancas_casos         replica identity full;
alter table public.aliancas_seletores     replica identity full;
alter table public.aliancas_resumo_regras replica identity full;
