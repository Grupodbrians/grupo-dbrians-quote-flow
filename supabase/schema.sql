-- ============================================================
-- Quote Flow — Esquema de base de datos (Supabase / Postgres)
-- Ejecuta TODO este archivo en:
-- Supabase → tu proyecto → SQL Editor → New query → pega esto → Run
-- Es seguro volver a correrlo si algo falló a mitad de camino: cada paso
-- verifica primero si ya existe antes de crearlo.
-- ============================================================

-- 1) Perfiles de usuario (complementa la tabla auth.users que ya trae Supabase)
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  rol text not null default 'usuario' check (rol in ('admin', 'usuario')),
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
alter table public.perfiles add column if not exists nombre text;

-- 2) Contador consecutivo para el número de cotización (COT-YYYYMMDD-0001, 0002, ...)
--    Es una secuencia global: la fecha cambia sola cada día, pero el número
--    sigue subiendo sin reiniciarse, tal como se pidió.
create sequence if not exists public.cotizacion_seq start 1;

create or replace function public.siguiente_numero_cotizacion()
returns text
language sql
security definer
as $$
  select 'COT-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.cotizacion_seq')::text, 4, '0');
$$;

-- 3) Cotizaciones (el historial compartido entre todos los usuarios)
create table if not exists public.cotizaciones (
  id uuid primary key default gen_random_uuid(),
  numero_cotizacion text unique not null,
  fecha date not null,
  creado_en timestamptz not null default now(),
  creado_por uuid references public.perfiles(id),
  creado_por_email text,
  proveedor jsonb not null,
  items jsonb not null,
  tasas jsonb not null,
  logistica jsonb not null,
  margen_usd numeric not null default 0,
  impuestos jsonb not null,
  cliente jsonb not null,
  total numeric not null default 0
);
create index if not exists cotizaciones_creado_en_idx on public.cotizaciones (creado_en asc);

-- 4) Auditoría (hora, minutos, fecha y usuario de cada acción relevante)
create table if not exists public.auditoria (
  id uuid primary key default gen_random_uuid(),
  usuario_email text not null,
  accion text not null,
  detalle text,
  creado_en timestamptz not null default now()
);
create index if not exists auditoria_creado_en_idx on public.auditoria (creado_en desc);

-- 5) Seguridad a nivel de fila: solo usuarios con sesión iniciada pueden leer/escribir
alter table public.perfiles enable row level security;
alter table public.cotizaciones enable row level security;
alter table public.auditoria enable row level security;

drop policy if exists "perfiles: cualquier usuario autenticado puede leer" on public.perfiles;
create policy "perfiles: cualquier usuario autenticado puede leer" on public.perfiles
  for select using (auth.role() = 'authenticated');

-- Un admin activo puede actualizar cualquier perfil (activar/desactivar/cambiar rol).
-- El trigger "proteger_admin_trigger" (más abajo) bloquea que el admin se
-- desactive o cambie de rol a sí mismo o a otro admin, incluso si esta
-- política lo permitiera.
drop policy if exists "perfiles: admin activo puede actualizar" on public.perfiles;
create policy "perfiles: admin activo puede actualizar" on public.perfiles
  for update
  using (exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.rol = 'admin' and p.activo = true
  ))
  with check (exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.rol = 'admin' and p.activo = true
  ));

drop policy if exists "cotizaciones: leer y crear si hay sesión" on public.cotizaciones;
create policy "cotizaciones: leer y crear si hay sesión" on public.cotizaciones
  for select using (auth.role() = 'authenticated');

drop policy if exists "cotizaciones: insertar si hay sesión" on public.cotizaciones;
create policy "cotizaciones: insertar si hay sesión" on public.cotizaciones
  for insert with check (auth.role() = 'authenticated');

-- Sub-paso 4: eliminar una cotización solo puede hacerlo quien la generó
-- originalmente (creado_por = auth.uid()) o un administrador activo.
drop policy if exists "cotizaciones: eliminar admin o creador" on public.cotizaciones;
create policy "cotizaciones: eliminar admin o creador" on public.cotizaciones
  for delete
  using (
    creado_por = auth.uid()
    or exists (
      select 1 from public.perfiles p
      where p.id = auth.uid() and p.rol = 'admin' and p.activo = true
    )
  );

-- Auditoría: CUALQUIER usuario autenticado puede insertar (así queda registro
-- de lo que hace cada quien), pero solo el administrador activo puede LEER
-- el registro completo — esto se exige aquí, a nivel de base de datos, no
-- solo ocultando el botón en la interfaz.
drop policy if exists "auditoria: leer si hay sesión" on public.auditoria;
drop policy if exists "auditoria: solo admin puede leer" on public.auditoria;
create policy "auditoria: solo admin puede leer" on public.auditoria
  for select using (exists (
    select 1 from public.perfiles p
    where p.id = auth.uid() and p.rol = 'admin' and p.activo = true
  ));

drop policy if exists "auditoria: insertar si hay sesión" on public.auditoria;
create policy "auditoria: insertar si hay sesión" on public.auditoria
  for insert with check (auth.role() = 'authenticated');

-- 6) Auto-registro: cuando alguien crea su cuenta desde la pantalla
--    "Registrarse", esta función crea automáticamente su fila en "perfiles"
--    (siempre INACTIVA hasta que el administrador la active) y deja
--    constancia en la auditoría. Corre con permisos elevados (security
--    definer) para que funcione sin importar si el correo ya quedó
--    confirmado o no.
create or replace function public.crear_perfil_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (id, email, nombre, rol, activo)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'nombre', ''),
    'usuario',
    false
  )
  on conflict (id) do nothing;

  insert into public.auditoria (usuario_email, accion, detalle)
  values (new.email, 'usuario_registrado', 'Se registró desde la pantalla de acceso; queda pendiente de activación');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.crear_perfil_nuevo_usuario();

-- 7) Protección del administrador: ni el propio admin ni otro admin pueden
--    desactivarlo o quitarle el rol, ni por la interfaz ni editando la base
--    de datos directamente.
create or replace function public.proteger_admin()
returns trigger
language plpgsql
as $$
begin
  if old.rol = 'admin' and (new.activo = false or new.rol <> 'admin') then
    raise exception 'No se puede desactivar ni cambiar el rol del administrador';
  end if;
  return new;
end;
$$;

drop trigger if exists proteger_admin_trigger on public.perfiles;
create trigger proteger_admin_trigger
  before update on public.perfiles
  for each row execute function public.proteger_admin();

-- ============================================================
-- 8) Crear el PRIMER usuario administrador (hazlo tú, una sola vez)
-- ============================================================
-- a) Ve a Supabase → Authentication → Users → Add user → crea tu correo y
--    contraseña de administrador ahí (esto SÍ hashea y guarda la contraseña
--    de forma segura, Supabase lo maneja solo). El trigger de arriba le crea
--    automáticamente una fila en "perfiles" con rol "usuario" e inactiva.
-- b) Sube su rol a admin y actívalo con esto (busca su id por correo, no
--    hace falta copiar el UID a mano):
--
-- insert into public.perfiles (id, email, rol, activo)
-- select id, email, 'admin', true
-- from auth.users
-- where email = 'tu-correo@grupodbrians.com'
-- on conflict (id) do update set rol = 'admin', activo = true;
