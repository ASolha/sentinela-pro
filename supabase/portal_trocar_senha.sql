-- ============================================================================
-- Portal de Trocas — define uma senha nova para a cliente
--
-- Use quando ela esquecer a senha. O portal não manda e-mail de recuperação
-- (as Redirect URLs do Supabase não estão liberadas para edição).
-- Troque o e-mail e a senha abaixo e rode no SQL Editor. Depois mande a senha
-- para ela pelo WhatsApp e peça para trocar em "Trocar senha" no portal.
-- ============================================================================

do $$
declare
  v_email text := 'giovana@exemplo.com.br';   -- ← e-mail da cliente
  v_senha text := 'TroqueEsta123';            -- ← senha nova (mínimo 8 caracteres)
  v_n int;
begin
  if length(v_senha) < 8 then
    raise exception 'Use uma senha com pelo menos 8 caracteres.';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(v_senha, extensions.gen_salt('bf')),
         updated_at = now()
   where lower(email) = lower(v_email);
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Não achei % em auth.users.', v_email;
  end if;
  raise notice 'Senha de % trocada.', v_email;
end
$$;
