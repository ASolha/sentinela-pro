-- ============================================================================
-- Portal de Trocas (medievaljoias.com.br/pedidos)
--
-- A cliente (Giovana) cadastra as trocas num portal próprio. Cada troca ganha
-- código (TR-0042-03) e versão ao ser salva e pode ser impressa sozinha. A
-- equipe confere e trata pelo módulo Trocas do Sentinela.
--
-- 1. Isola a conta da cliente: ela só enxerga as tabelas e RPCs portal_*.
--    Para a equipe nada muda.
-- 2. Cria as tabelas portal_*, triggers de código/versão/eventos e as RPCs.
-- 3. Cria o bucket privado portal-anexos (desenhos para vetorizar).
--
-- A conta da cliente é marcada com app_metadata.papel = 'cliente'
-- (ver supabase/portal_criar_cliente.sql). Só o admin consegue gravar isso.
-- ============================================================================

-- ── 1. Quem é a cliente ─────────────────────────────────────────────────────
create or replace function public.is_portal_cliente()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'papel') = 'cliente', false);
$$;

-- Nome de quem está logado (equipe): o mesmo do Hub/Sentinela.
create or replace function public.portal_nome_atual()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_nome text;
begin
  begin
    select nullif(trim(display_name), '') into v_nome from public.hub_user_profiles where user_id = auth.uid();
  exception when undefined_table then
    v_nome := null;
  end;
  return coalesce(
    v_nome,
    nullif(trim(auth.jwt() -> 'user_metadata' ->> 'display_name'), ''),
    nullif(split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1), ''),
    'Equipe'
  );
end;
$$;

-- Bloqueio no PostgREST: para a cliente, qualquer caminho fora de portal_* é negado.
-- Cobre as tabelas e as RPCs que já existem (inclusive as security definer).
create or replace function public.portal_pre_request()
returns void
language plpgsql
stable
as $$
declare
  v_caminho text := coalesce(current_setting('request.path', true), '');
begin
  if public.is_portal_cliente() and v_caminho !~ '^/(portal_[a-z_]+|rpc/portal_[a-z_]+)/?$' then
    raise insufficient_privilege using message = 'Acesso restrito ao portal de trocas.';
  end if;
end;
$$;

do $$
declare
  v_atual text;
begin
  select split_part(cfg, '=', 2) into v_atual
    from pg_roles r, unnest(r.rolconfig) cfg
   where r.rolname = 'authenticator' and cfg like 'pgrst.db_pre_request=%';
  if v_atual is not null and v_atual not in ('public.portal_pre_request', 'portal_pre_request') then
    raise exception 'O authenticator já usa pgrst.db_pre_request = %. Junte as duas funções antes de rodar esta migration.', v_atual;
  end if;
end
$$;

alter role authenticator set pgrst.db_pre_request to 'public.portal_pre_request';
notify pgrst, 'reload config';

-- Defesa extra (também vale para o Realtime): toda tabela public com RLS que
-- não seja do portal ganha uma policy restritiva que barra a cliente.
-- Tabelas criadas depois desta migration precisam ganhar a mesma policy.
do $$
declare
  r record;
begin
  for r in
    select c.relname, c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relname not like 'portal\_%'
  loop
    if r.relrowsecurity then
      if not exists (
        select 1 from pg_policies
         where schemaname = 'public' and tablename = r.relname and policyname = 'bloqueia_cliente_portal'
      ) then
        execute format(
          'create policy bloqueia_cliente_portal on public.%I as restrictive for all to authenticated
             using (not public.is_portal_cliente()) with check (not public.is_portal_cliente())',
          r.relname);
      end if;
    else
      raise notice 'public.% está sem RLS: a cliente só fica barrada nela pelo bloqueio do PostgREST.', r.relname;
    end if;
  end loop;
end
$$;

-- ── 2. Tabelas ──────────────────────────────────────────────────────────────
create table if not exists public.portal_clientes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users (id) on delete cascade,
  nome        text not null,
  prefixo     text not null default 'TR',
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

create or replace function public.portal_cliente_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.portal_clientes where user_id = auth.uid() and ativo;
$$;

create sequence if not exists public.portal_lote_numero_seq;

create table if not exists public.portal_lotes (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references public.portal_clientes (id) on delete cascade,
  tipo          text not null default 'troca' check (tipo in ('troca', 'pedido')),
  numero        bigint not null unique default nextval('public.portal_lote_numero_seq'),
  codigo        text unique,
  status        text not null default 'aberto' check (status in ('aberto', 'enviado', 'devolvido', 'cancelado')),
  seq           int not null default 0,          -- último número de troca usado no pacote
  criado_em     timestamptz not null default now(),
  fechado_em    timestamptz,
  recebido_em   timestamptz,
  devolvido_em  timestamptz,
  atualizado_em timestamptz not null default now()
);

create unique index if not exists portal_lotes_um_aberto
  on public.portal_lotes (cliente_id, tipo) where status = 'aberto';

create table if not exists public.portal_itens (
  id                    uuid primary key default gen_random_uuid(),
  lote_id               uuid not null references public.portal_lotes (id) on delete cascade,
  cliente_id            uuid not null references public.portal_clientes (id) on delete cascade,
  seq                   int not null,
  codigo                text not null unique,
  -- o que a cliente pediu
  referencia            text not null default '' check (char_length(referencia) <= 60),
  peca                  text not null default 'par' check (peca in ('par', 'avulsa')),
  tipos                 text[] not null default '{}'
                          check (tipos <@ array['troca_aro', 'troca_modelo', 'defeito', 'nova_gravacao', 'regravacao']),
  modelo_atual          text not null default '' check (char_length(modelo_atual) <= 60),
  modelo_novo           text not null default '' check (char_length(modelo_novo) <= 60),
  defeito_descricao     text not null default '' check (char_length(defeito_descricao) <= 300),
  observacao            text not null default '' check (char_length(observacao) <= 300),
  -- [{identificacao:'feminina'|'masculina', pedra, aro_atual, aro_novo,
  --   gravacoes:[{local:'interna'|'externa', texto, fonte, anexos:[{path,nome,tipo,tamanho}]}]}]
  aneis                 jsonb not null default '[]' check (jsonb_typeof(aneis) = 'array'),
  -- versão do papel
  versao                int not null default 1,
  versao_em             timestamptz not null default now(),
  impressa_versao       int,
  status                text not null default 'rascunho'
                          check (status in ('rascunho', 'enviada', 'recebida', 'concluida', 'devolvida', 'cancelada')),
  -- tratativa da equipe (os nomes ficam em portal_eventos, que só a equipe lê)
  seletores_confirmados text[],
  caso_id               uuid references public.aliancas_casos (id) on delete set null,
  resultado_aneis       jsonb,
  nota_equipe           text not null default '',
  divergencia           boolean not null default false,
  divergencia_nota      text not null default '',
  conferido_em          timestamptz,
  concluido_em          timestamptz,
  devolvido_em          timestamptz,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);

create index if not exists portal_itens_lote_idx on public.portal_itens (lote_id, seq);
create index if not exists portal_itens_status_idx on public.portal_itens (status);

-- Cópia de cada versão impressa: é a prova do que estava em cada papel.
create table if not exists public.portal_itens_versoes (
  id        bigint generated always as identity primary key,
  item_id   uuid not null,
  codigo    text not null,
  versao    int not null,
  dados     jsonb not null,
  criado_em timestamptz not null default now(),
  unique (item_id, versao)
);

-- Log só de inclusão, gravado pelos triggers. Só a equipe lê.
create table if not exists public.portal_eventos (
  id         bigint generated always as identity primary key,
  lote_id    uuid,
  item_id    uuid,
  codigo     text,
  acao       text not null,
  detalhes   jsonb not null default '{}',
  autor_id   uuid,
  autor_nome text,
  da_cliente boolean not null default false,
  criado_em  timestamptz not null default now()
);

create index if not exists portal_eventos_item_idx on public.portal_eventos (item_id, criado_em);
create index if not exists portal_eventos_lote_idx on public.portal_eventos (lote_id, criado_em);

-- ── Triggers ────────────────────────────────────────────────────────────────
-- Funções internas (RPCs) avisam os triggers com esta flag, só na transação.
create or replace function public.portal_sistema()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('portal.sistema', true), '') = '1';
$$;

create or replace function public.portal_formatar_numero(p_n bigint, p_casas int)
returns text
language sql
immutable
as $$
  select case when length(p_n::text) >= p_casas then p_n::text else lpad(p_n::text, p_casas, '0') end;
$$;

-- Pacote: código a partir do prefixo da cliente + número.
create or replace function public.portal_lotes_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.codigo := (select prefixo from public.portal_clientes where id = new.cliente_id)
                  || '-' || public.portal_formatar_numero(new.numero, 4);
    new.seq := 0;
  else
    new.id := old.id;
    new.cliente_id := old.cliente_id;
    new.numero := old.numero;
    new.codigo := old.codigo;
    if not public.portal_sistema() then
      new.seq := old.seq;
    end if;
  end if;
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists portal_lotes_antes on public.portal_lotes;
create trigger portal_lotes_antes
  before insert or update on public.portal_lotes
  for each row execute function public.portal_lotes_antes();

-- Troca: código no insert (nunca reaproveitado), versão e proteção dos campos.
create or replace function public.portal_itens_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote public.portal_lotes;
  v_mudou boolean;
  v_antes text := coalesce(current_setting('portal.sistema', true), '');
begin
  if tg_op = 'INSERT' then
    perform set_config('portal.sistema', '1', true);
    update public.portal_lotes
       set seq = seq + 1
     where id = new.lote_id
    returning * into v_lote;
    perform set_config('portal.sistema', v_antes, true);
    if v_lote.id is null then
      raise exception 'Pacote não encontrado.';
    end if;
    if v_lote.status <> 'aberto' then
      raise exception 'Este pacote já foi fechado. A troca nova entra no próximo pacote.';
    end if;
    new.cliente_id := v_lote.cliente_id;
    new.seq := v_lote.seq;
    new.codigo := v_lote.codigo || '-' || public.portal_formatar_numero(v_lote.seq, 2);
    new.versao := 1;
    new.versao_em := now();
    new.impressa_versao := null;
    new.status := 'rascunho';
    new.seletores_confirmados := null;
    new.caso_id := null;
    new.resultado_aneis := null;
    new.nota_equipe := '';
    new.divergencia := false;
    new.divergencia_nota := '';
    new.conferido_em := null;
    new.concluido_em := null;
    new.devolvido_em := null;
    new.criado_em := now();
    new.atualizado_em := now();
    return new;
  end if;

  -- UPDATE: identidade nunca muda
  new.id := old.id;
  new.lote_id := old.lote_id;
  new.cliente_id := old.cliente_id;
  new.seq := old.seq;
  new.codigo := old.codigo;
  new.criado_em := old.criado_em;
  new.atualizado_em := now();

  if public.portal_sistema() then
    return new;
  end if;

  v_mudou := (new.referencia, new.peca, new.tipos, new.modelo_atual, new.modelo_novo,
              new.defeito_descricao, new.observacao, new.aneis)
             is distinct from
             (old.referencia, old.peca, old.tipos, old.modelo_atual, old.modelo_novo,
              old.defeito_descricao, old.observacao, old.aneis);

  if public.is_portal_cliente() then
    if old.status not in ('rascunho', 'enviada') then
      raise exception 'A Medieval já recebeu esta troca. Ela não pode mais ser alterada.'
        using errcode = 'insufficient_privilege';
    end if;
    -- a cliente só mexe no que ela pediu
    new.status := old.status;
    new.impressa_versao := old.impressa_versao;
    new.seletores_confirmados := old.seletores_confirmados;
    new.caso_id := old.caso_id;
    new.resultado_aneis := old.resultado_aneis;
    new.nota_equipe := old.nota_equipe;
    new.divergencia := old.divergencia;
    new.divergencia_nota := old.divergencia_nota;
    new.conferido_em := old.conferido_em;
    new.concluido_em := old.concluido_em;
    new.devolvido_em := old.devolvido_em;
    new.versao := old.versao;
    new.versao_em := old.versao_em;
    if v_mudou then
      -- alterou depois de imprimir: o papel antigo deixa de valer
      if old.impressa_versao is not null and old.impressa_versao = old.versao then
        new.versao := old.versao + 1;
      end if;
      new.versao_em := now();
    end if;
  else
    -- equipe: não altera o que a cliente pediu nem a versão do papel
    new.referencia := old.referencia;
    new.peca := old.peca;
    new.tipos := old.tipos;
    new.modelo_atual := old.modelo_atual;
    new.modelo_novo := old.modelo_novo;
    new.defeito_descricao := old.defeito_descricao;
    new.observacao := old.observacao;
    new.aneis := old.aneis;
    new.versao := old.versao;
    new.versao_em := old.versao_em;
    new.impressa_versao := old.impressa_versao;
    if new.status is distinct from old.status then
      if new.status = 'recebida' and new.conferido_em is null then new.conferido_em := now(); end if;
      if new.status = 'concluida' and new.concluido_em is null then new.concluido_em := now(); end if;
      if new.status = 'devolvida' then
        if new.concluido_em is null then new.concluido_em := now(); end if;
        if new.devolvido_em is null then new.devolvido_em := now(); end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists portal_itens_antes on public.portal_itens;
create trigger portal_itens_antes
  before insert or update on public.portal_itens
  for each row execute function public.portal_itens_antes();

-- Pacote vira "devolvido" quando não sobra troca pendente.
create or replace function public.portal_itens_depois()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes text := coalesce(current_setting('portal.sistema', true), '');
begin
  if new.status in ('devolvida', 'cancelada') and old.status is distinct from new.status then
    if not exists (
      select 1 from public.portal_itens
       where lote_id = new.lote_id and status not in ('devolvida', 'cancelada')
    ) then
      perform set_config('portal.sistema', '1', true);
      update public.portal_lotes
         set status = 'devolvido', devolvido_em = now()
       where id = new.lote_id and status = 'enviado';
      perform set_config('portal.sistema', v_antes, true);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists portal_itens_depois on public.portal_itens;
create trigger portal_itens_depois
  after update of status on public.portal_itens
  for each row execute function public.portal_itens_depois();

-- Eventos: quem fez o quê e quando.
create or replace function public.portal_registrar_evento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_novo jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_velho jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_linha jsonb := coalesce(v_novo, v_velho);
  v_det jsonb := '{}';
  v_acao text;
  v_cliente boolean := public.is_portal_cliente();
begin
  if tg_op = 'INSERT' then
    v_acao := 'criada';
  elsif tg_op = 'DELETE' then
    v_acao := 'excluida';
  else
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('de', o.value, 'para', n.value)), '{}')
      into v_det
      from jsonb_each(v_novo) n
      join jsonb_each(v_velho) o on o.key = n.key
     where n.value is distinct from o.value
       and n.key not in ('atualizado_em', 'seq');
    if v_det = '{}'::jsonb then
      return null;
    end if;
    v_acao := case
      when v_det ? 'status' then 'status:' || (v_novo ->> 'status')
      when v_det ? 'versao' then 'versao:' || (v_novo ->> 'versao')
      when v_det ? 'impressa_versao' then 'impressa:' || (v_novo ->> 'impressa_versao')
      when v_det ? 'recebido_em' then 'pacote_recebido'
      else 'alterada'
    end;
  end if;

  insert into public.portal_eventos (lote_id, item_id, codigo, acao, detalhes, autor_id, autor_nome, da_cliente)
  values (
    case when tg_table_name = 'portal_lotes' then (v_linha ->> 'id')::uuid else (v_linha ->> 'lote_id')::uuid end,
    case when tg_table_name = 'portal_itens' then (v_linha ->> 'id')::uuid end,
    v_linha ->> 'codigo',
    case when tg_table_name = 'portal_lotes' then 'pacote_' || v_acao else v_acao end,
    v_det,
    auth.uid(),
    case when v_cliente then (select nome from public.portal_clientes where user_id = auth.uid()) else public.portal_nome_atual() end,
    v_cliente
  );
  return null;
end;
$$;

drop trigger if exists portal_itens_evento on public.portal_itens;
create trigger portal_itens_evento
  after insert or update or delete on public.portal_itens
  for each row execute function public.portal_registrar_evento();

drop trigger if exists portal_lotes_evento on public.portal_lotes;
create trigger portal_lotes_evento
  after insert or update on public.portal_lotes
  for each row execute function public.portal_registrar_evento();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.portal_clientes      enable row level security;
alter table public.portal_lotes         enable row level security;
alter table public.portal_itens         enable row level security;
alter table public.portal_itens_versoes enable row level security;
alter table public.portal_eventos       enable row level security;

revoke all on public.portal_clientes, public.portal_lotes, public.portal_itens,
              public.portal_itens_versoes, public.portal_eventos from anon;
grant select on public.portal_clientes, public.portal_itens_versoes, public.portal_eventos to authenticated;
grant select, update on public.portal_lotes to authenticated;
grant select, insert, update, delete on public.portal_itens to authenticated;

drop policy if exists portal_clientes_ler on public.portal_clientes;
create policy portal_clientes_ler on public.portal_clientes for select to authenticated
  using (user_id = auth.uid() or not public.is_portal_cliente());

drop policy if exists portal_lotes_ler on public.portal_lotes;
create policy portal_lotes_ler on public.portal_lotes for select to authenticated
  using (cliente_id = public.portal_cliente_id() or not public.is_portal_cliente());

-- A cliente cria e fecha pacotes só pelas RPCs. A equipe marca recebido.
drop policy if exists portal_lotes_equipe on public.portal_lotes;
create policy portal_lotes_equipe on public.portal_lotes for update to authenticated
  using (not public.is_portal_cliente() and status <> 'aberto')
  with check (not public.is_portal_cliente());

drop policy if exists portal_itens_ler on public.portal_itens;
create policy portal_itens_ler on public.portal_itens for select to authenticated
  using (cliente_id = public.portal_cliente_id() or not public.is_portal_cliente());

drop policy if exists portal_itens_criar on public.portal_itens;
create policy portal_itens_criar on public.portal_itens for insert to authenticated
  with check (
    public.is_portal_cliente()
    and exists (
      select 1 from public.portal_lotes l
       where l.id = lote_id and l.cliente_id = public.portal_cliente_id() and l.status = 'aberto'
    )
  );

drop policy if exists portal_itens_alterar on public.portal_itens;
create policy portal_itens_alterar on public.portal_itens for update to authenticated
  using (
    (public.is_portal_cliente() and cliente_id = public.portal_cliente_id() and status in ('rascunho', 'enviada'))
    or (not public.is_portal_cliente() and status <> 'rascunho')
  )
  with check (
    (public.is_portal_cliente() and cliente_id = public.portal_cliente_id())
    or not public.is_portal_cliente()
  );

drop policy if exists portal_itens_excluir on public.portal_itens;
create policy portal_itens_excluir on public.portal_itens for delete to authenticated
  using (public.is_portal_cliente() and cliente_id = public.portal_cliente_id() and status = 'rascunho');

drop policy if exists portal_versoes_ler on public.portal_itens_versoes;
create policy portal_versoes_ler on public.portal_itens_versoes for select to authenticated
  using (not public.is_portal_cliente());

drop policy if exists portal_eventos_ler on public.portal_eventos;
create policy portal_eventos_ler on public.portal_eventos for select to authenticated
  using (not public.is_portal_cliente());

-- ── RPCs ────────────────────────────────────────────────────────────────────
-- Pacote aberto da cliente; com p_criar, cria se ainda não existir.
create or replace function public.portal_pacote_aberto(p_criar boolean default false)
returns setof public.portal_lotes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente uuid := public.portal_cliente_id();
begin
  if v_cliente is null then
    raise exception 'Esta conta não é de cliente do portal.' using errcode = 'insufficient_privilege';
  end if;
  if p_criar and not exists (
    select 1 from public.portal_lotes where cliente_id = v_cliente and tipo = 'troca' and status = 'aberto'
  ) then
    insert into public.portal_lotes (cliente_id) values (v_cliente) on conflict do nothing;
  end if;
  return query
    select * from public.portal_lotes where cliente_id = v_cliente and tipo = 'troca' and status = 'aberto';
end;
$$;

-- Marca como impressas (versão atual) e guarda a cópia de cada versão.
create or replace function public.portal_marcar_impresso(p_itens uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente uuid := public.portal_cliente_id();
  v_n int;
begin
  perform set_config('portal.sistema', '1', true);

  insert into public.portal_itens_versoes (item_id, codigo, versao, dados)
  select i.id, i.codigo, i.versao,
         jsonb_build_object(
           'referencia', i.referencia, 'peca', i.peca, 'tipos', i.tipos,
           'modelo_atual', i.modelo_atual, 'modelo_novo', i.modelo_novo,
           'defeito_descricao', i.defeito_descricao, 'observacao', i.observacao,
           'aneis', i.aneis, 'versao_em', i.versao_em)
    from public.portal_itens i
   where i.id = any (p_itens)
     and (i.cliente_id = v_cliente or not public.is_portal_cliente())
  on conflict (item_id, versao) do nothing;

  update public.portal_itens i
     set impressa_versao = i.versao
   where i.id = any (p_itens)
     and (i.cliente_id = v_cliente or not public.is_portal_cliente())
     and i.impressa_versao is distinct from i.versao;
  get diagnostics v_n = row_count;

  perform set_config('portal.sistema', '', true);
  return v_n;
end;
$$;

-- Fecha o pacote: vai para a Medieval.
create or replace function public.portal_fechar_lote(p_lote uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote public.portal_lotes;
  v_falta text;
begin
  select * into v_lote from public.portal_lotes where id = p_lote for update;
  if v_lote.id is null or v_lote.cliente_id is distinct from public.portal_cliente_id() then
    raise exception 'Pacote não encontrado.' using errcode = 'insufficient_privilege';
  end if;
  if v_lote.status <> 'aberto' then
    raise exception 'O pacote % já foi fechado.', v_lote.codigo;
  end if;
  if not exists (select 1 from public.portal_itens where lote_id = p_lote) then
    raise exception 'O pacote está vazio.';
  end if;
  select string_agg(codigo, ', ' order by seq) into v_falta
    from public.portal_itens
   where lote_id = p_lote
     and (referencia = '' or modelo_atual = '' or cardinality(tipos) = 0 or jsonb_array_length(aneis) = 0);
  if v_falta is not null then
    raise exception 'Faltam dados nas trocas %.', v_falta;
  end if;

  perform set_config('portal.sistema', '1', true);
  update public.portal_lotes set status = 'enviado', fechado_em = now() where id = p_lote;
  update public.portal_itens set status = 'enviada' where lote_id = p_lote and status = 'rascunho';
  perform set_config('portal.sistema', '', true);
  return v_lote.codigo;
end;
$$;

-- Equipe: confere a troca. Cria (ou atualiza) o card nos Casos da semana.
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
  select 'Portal ' || v_item.codigo || ' (v' || v_item.versao || ') · '
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

revoke all on function public.portal_pacote_aberto(boolean) from public, anon;
revoke all on function public.portal_marcar_impresso(uuid[]) from public, anon;
revoke all on function public.portal_fechar_lote(uuid) from public, anon;
revoke all on function public.portal_receber_item(uuid, text[], int) from public, anon;
grant execute on function public.portal_pacote_aberto(boolean) to authenticated;
grant execute on function public.portal_marcar_impresso(uuid[]) to authenticated;
grant execute on function public.portal_fechar_lote(uuid) to authenticated;
grant execute on function public.portal_receber_item(uuid, text[], int) to authenticated;

-- ── Realtime ────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'portal_lotes') then
      alter publication supabase_realtime add table public.portal_lotes;
    end if;
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'portal_itens') then
      alter publication supabase_realtime add table public.portal_itens;
    end if;
  end if;
end
$$;

alter table public.portal_lotes replica identity full;
alter table public.portal_itens replica identity full;

-- ── 3. Anexos (desenhos para vetorizar) ─────────────────────────────────────
-- Caminho: {cliente_id}/{item_id}/{arquivo}. Sobe no tamanho original.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal-anexos', 'portal-anexos', false, 10485760, array['image/*', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists portal_anexos_cliente_ler on storage.objects;
create policy portal_anexos_cliente_ler on storage.objects for select to authenticated
  using (
    bucket_id = 'portal-anexos'
    and public.is_portal_cliente()
    and (storage.foldername(name))[1] = public.portal_cliente_id()::text
  );

drop policy if exists portal_anexos_cliente_enviar on storage.objects;
create policy portal_anexos_cliente_enviar on storage.objects for insert to authenticated
  with check (
    bucket_id = 'portal-anexos'
    and public.is_portal_cliente()
    and (storage.foldername(name))[1] = public.portal_cliente_id()::text
    and not exists (
      select 1 from public.portal_itens i
       where i.id::text = (storage.foldername(name))[2] and i.status not in ('rascunho', 'enviada')
    )
  );

drop policy if exists portal_anexos_cliente_apagar on storage.objects;
create policy portal_anexos_cliente_apagar on storage.objects for delete to authenticated
  using (
    bucket_id = 'portal-anexos'
    and public.is_portal_cliente()
    and (storage.foldername(name))[1] = public.portal_cliente_id()::text
    and not exists (
      select 1 from public.portal_itens i
       where i.id::text = (storage.foldername(name))[2] and i.status not in ('rascunho', 'enviada')
    )
  );

drop policy if exists portal_anexos_equipe_ler on storage.objects;
create policy portal_anexos_equipe_ler on storage.objects for select to authenticated
  using (bucket_id = 'portal-anexos' and not public.is_portal_cliente());
