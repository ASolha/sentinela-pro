alter table public.pendencias
  add column if not exists is_archived boolean not null default false,
  add column if not exists archived_at timestamptz;

create index if not exists pendencias_user_archive_idx
  on public.pendencias (user_id, is_archived, created_at desc);
