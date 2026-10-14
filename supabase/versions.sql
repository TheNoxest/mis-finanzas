-- =========================================================================
-- Mis Finanzas — versiones de tus datos en la nube (Sprint 0, 2026-10-14).
-- Supabase → SQL Editor → New query → pega todo → Run. Se puede ejecutar más de una vez.
--
-- Guarda copias CIFRADAS de tus datos (igual que la bóveda): la app conserva las 20 más
-- recientes y una por día del último mes, y permite volver a cualquiera.
-- =========================================================================

create table if not exists public.vault_versions (
  id         bigint generated always as identity primary key,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  reason     text,                                -- «automática», «manual», «antes de restaurar»…
  iv         text        not null,
  data       text        not null                 -- datos cifrados (AES-GCM 256)
);

create index if not exists vault_versions_user_fecha on public.vault_versions (user_id, created_at desc);

alter table public.vault_versions enable row level security;

drop policy if exists "versiones: leer las propias"  on public.vault_versions;
drop policy if exists "versiones: crear las propias" on public.vault_versions;
drop policy if exists "versiones: borrar las propias" on public.vault_versions;

create policy "versiones: leer las propias"   on public.vault_versions for select using (auth.uid() = user_id);
create policy "versiones: crear las propias"  on public.vault_versions for insert with check (auth.uid() = user_id);
create policy "versiones: borrar las propias" on public.vault_versions for delete using (auth.uid() = user_id);
-- Sin política de actualización: una versión guardada no se modifica.

revoke all on public.vault_versions from anon;
grant select, insert, delete on public.vault_versions to authenticated;
