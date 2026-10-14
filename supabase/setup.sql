-- =========================================================================
-- Mis Finanzas — configuración de Supabase (ejecutar una sola vez).
-- Supabase → tu proyecto → SQL Editor → New query → pega todo → Run.
--
-- Crea una tabla con UNA fila por usuario que guarda tus datos CIFRADOS
-- (la app los cifra en tu dispositivo antes de enviarlos). Las reglas RLS
-- impiden que una cuenta lea o modifique la fila de otra.
-- =========================================================================

create table if not exists public.vaults (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  salt       text        not null,               -- sal para derivar la clave (no es secreta)
  iv         text        not null,               -- vector de inicialización del cifrado
  data       text        not null,               -- tus datos cifrados (AES-GCM 256)
  version    integer     not null default 1,     -- control de versiones entre dispositivos
  updated_at timestamptz not null default now()
);

alter table public.vaults enable row level security;

drop policy if exists "vaults: leer la propia"      on public.vaults;
drop policy if exists "vaults: crear la propia"     on public.vaults;
drop policy if exists "vaults: actualizar la propia" on public.vaults;
drop policy if exists "vaults: borrar la propia"    on public.vaults;

create policy "vaults: leer la propia"       on public.vaults for select using (auth.uid() = user_id);
create policy "vaults: crear la propia"      on public.vaults for insert with check (auth.uid() = user_id);
create policy "vaults: actualizar la propia" on public.vaults for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "vaults: borrar la propia"     on public.vaults for delete using (auth.uid() = user_id);

-- Nadie sin sesión puede tocar la tabla
revoke all on public.vaults from anon;
grant select, insert, update, delete on public.vaults to authenticated;

-- Versiones de los datos (añadido el 2026-10-14; también disponible por separado en supabase/versions.sql)
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
