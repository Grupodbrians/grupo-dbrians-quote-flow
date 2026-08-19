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

drop policy if exists "cotizaciones: leer y crear si hay sesión" on public.cotizaciones;
create policy "cotizaciones: leer y crear si hay sesión" on public.cotizaciones
  for select using (auth.role() = 'authenticated');

drop policy if exists "cotizaciones: insertar si hay sesión" on public.cotizaciones;
create policy "cotizaciones: insertar si hay sesión" on public.cotizaciones
  for insert with check (auth.role() = 'authenticated');

drop policy if exists "auditoria: leer si hay sesión" on public.auditoria;
create policy "auditoria: leer si hay sesión" on public.auditoria
  for select using (auth.role() = 'authenticated');

drop policy if exists "auditoria: insertar si hay sesión" on public.auditoria;
create policy "auditoria: insertar si hay sesión" on public.auditoria
  for insert with check (auth.role() = 'authenticated');

-- ============================================================
-- 6) Crear el PRIMER usuario administrador (hazlo tú, una sola vez)
-- ============================================================
-- a) Ve a Supabase → Authentication → Users → Add user → crea tu correo y
--    contraseña de administrador ahí (esto SÍ hashea y guarda la contraseña
--    de forma segura, Supabase lo maneja solo).
-- b) Copia el "User UID" que te muestra, y corre esto reemplazando los valores:
--
-- insert into public.perfiles (id, email, rol, activo)
-- values ('PEGA-AQUI-EL-UID', 'tu-correo@grupodbrians.com', 'admin', true);
