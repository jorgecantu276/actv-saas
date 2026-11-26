-- Synthetic schema for a new local ACTV staging database.
do $$ begin
  if current_database() <> 'actv_payment_staging' then
    raise exception 'Staging schema requires actv_payment_staging';
  end if;
end $$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
grant usage on schema auth to authenticated, service_role;
create table public.perfiles(id uuid primary key, email text not null, rol text, eventos_asignados uuid[]);
create table public.atletas(
  id uuid primary key default gen_random_uuid(), nombre text not null, apellido text not null,
  telefono text not null, telefono_emergencia text not null, talla_playera text not null, email text unique
);
create table public.eventos(
  id uuid primary key default gen_random_uuid(), nombre_carrera text not null, fecha date not null,
  organizador text not null, distancia text not null, descripcion text, activo boolean default true,
  nombre_precio_1 text, precio_1 numeric, nombre_precio_2 text, precio_2 numeric,
  cupo_maximo integer, folio_inicial integer
);
create table public.inscripciones(
  id uuid primary key default gen_random_uuid(), created_at timestamptz default now(),
  atleta_id uuid references public.atletas, evento_id uuid references public.eventos,
  folio_asignado text, monto_pagado numeric(10,2) not null,
  metodo_pago text check(metodo_pago in ('efectivo','tarjeta','transferencia')),
  paquete_comprado text, usuario_id uuid references public.perfiles on delete set null,
  kit_entregado boolean default false, foto_evidencia text,
  unique(evento_id,folio_asignado)
);
grant select,insert,update,delete on all tables in schema public to anon,authenticated,service_role;
