-- ============================================================================
-- Portal de Trocas — cria o acesso de uma cliente (ex.: Giovana)
--
-- 1. No Supabase: Authentication → Users → Add user → Create new user.
--    E-mail e senha da cliente, com "Auto Confirm User" marcado.
-- 2. Troque o e-mail e o nome abaixo e rode este arquivo no SQL Editor.
-- 3. Peça para a cliente entrar em https://medievaljoias.com.br/pedidos/
--
-- Faça primeiro com uma conta de teste e confira o fluxo inteiro.
-- Para tirar o acesso: update public.portal_clientes set ativo = false where ...
-- ============================================================================

do $$
declare
  v_email text := 'giovana@exemplo.com.br';   -- ← e-mail da cliente
  v_nome  text := 'Giovana';                  -- ← nome que aparece no Sentinela e no canhoto
  v_uid   uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(v_email);
  if v_uid is null then
    raise exception 'Não achei % em auth.users. Crie o usuário primeiro (passo 1).', v_email;
  end if;

  -- marca a conta como cliente: ela passa a ver só o portal
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"papel": "cliente"}'::jsonb
   where id = v_uid;

  insert into public.portal_clientes (user_id, nome)
  values (v_uid, v_nome)
  on conflict (user_id) do update set nome = excluded.nome, ativo = true;

  -- não aparecer como alguém da equipe no Hub/Pegador
  delete from public.hub_user_profiles where user_id = v_uid;

  raise notice 'Pronto: % é cliente do portal. Se ela já estava logada, precisa sair e entrar de novo.', v_email;
end
$$;
