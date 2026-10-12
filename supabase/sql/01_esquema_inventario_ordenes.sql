-- =====================================================================================
-- ABASTECIMIENTO AUTOMÁTICO MULTINICHO · FASE 1
-- Archivo 01 de 03 · Esquema multi-tenant, inventario, movimientos, órdenes de compra y RLS
--
-- DÓNDE SE EJECUTA: Supabase > SQL Editor > New query > pegar TODO > Run.
-- ORDEN OBLIGATORIO: 01 → 02 → 03. Es idempotente en tipos/extensiones; las tablas se
-- crean con IF NOT EXISTS, así que puede re-ejecutarse sin destruir datos.
--
-- MODELO DE AISLAMIENTO (multi-tenant):
--   empresa (tenant)  ──<  nicho (alimentos, moda, farmacia…)  ──<  producto (inventario)
--   Cada fila operativa lleva empresa_id + nicho_id. Las llaves foráneas COMPUESTAS
--   (id, empresa_id) impiden que un producto de la empresa A apunte a un nicho de la B.
--   Las políticas RLS consultan la tabla asignaciones_usuario: un usuario solo ve/edita
--   lo que coincide con su empresa_id y nicho_id (el admin_empresa ve todos sus nichos).
-- =====================================================================================

begin;

-- ---------------------------------------------------------------------------------
-- 0. Extensiones y esquema privado (no expuesto por la API REST de Supabase)
-- ---------------------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

create schema if not exists privado;
revoke all on schema privado from public;
grant usage on schema privado to authenticated, service_role;

-- ---------------------------------------------------------------------------------
-- 1. Tipos enumerados
-- ---------------------------------------------------------------------------------
do $$ begin
  create type public.rol_usuario as enum ('admin_empresa', 'encargado', 'lector');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tipo_movimiento as enum (
    'venta', 'compra', 'ajuste_positivo', 'ajuste_negativo',
    'merma', 'devolucion_cliente', 'devolucion_proveedor'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_orden_compra as enum (
    'borrador', 'emitida', 'enviada_proveedor', 'confirmada',
    'recibida_parcial', 'recibida', 'cancelada'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------------
-- 2. Utilidad: marca de tiempo de actualización
-- ---------------------------------------------------------------------------------
create or replace function privado.tg_actualizado_en()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------
-- 3. Tablas maestras del tenant
-- ---------------------------------------------------------------------------------
create table if not exists public.empresas (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null check (char_length(nombre) between 2 and 150),
  identificacion_fiscal text check (identificacion_fiscal ~ '^[A-Za-z0-9.\-]{3,30}$'),
  pais            char(2) not null default 'CO' check (pais ~ '^[A-Z]{2}$'),
  moneda          char(3) not null default 'COP' check (moneda ~ '^[A-Z]{3}$'),
  zona_horaria    text not null default 'America/Bogota',
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

create table if not exists public.nichos (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas(id) on delete cascade,
  codigo          text not null check (codigo ~ '^[a-z0-9_]{2,40}$'),
  nombre          text not null check (char_length(nombre) between 2 and 100),
  -- Contrato de atributos dinámicos del nicho. Formato:
  -- {"requeridos": ["fecha_vencimiento","lote"],
  --  "tipos": {"fecha_vencimiento":"date","lote":"string","temperatura_c":"number"}}
  -- Tipos admitidos: string | number | boolean | date | array | object
  esquema_atributos jsonb not null default '{"requeridos": [], "tipos": {}}'::jsonb
                    check (jsonb_typeof(esquema_atributos) = 'object'),
  lead_time_dias          integer not null default 3  check (lead_time_dias between 0 and 365),
  dias_cobertura_objetivo integer not null default 30 check (dias_cobertura_objetivo between 1 and 365),
  -- Reglas que la IA debe respetar por nicho (ej: {"vida_util_max_dias": 10, "estacionalidad": "alta_diciembre"})
  reglas_ia       jsonb not null default '{}'::jsonb check (jsonb_typeof(reglas_ia) = 'object'),
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  unique (empresa_id, codigo),
  unique (id, empresa_id)
);

create table if not exists public.asignaciones_usuario (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid not null references auth.users(id) on delete cascade,
  empresa_id      uuid not null references public.empresas(id) on delete cascade,
  nicho_id        uuid,                       -- NULL solo permitido para admin_empresa (todos los nichos)
  rol             public.rol_usuario not null default 'encargado',
  nombre_mostrar  text not null check (char_length(nombre_mostrar) between 2 and 120),
  email           text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  whatsapp_e164   text check (whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),  -- ej: +573001234567
  recibe_alertas  boolean not null default true,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint asignacion_nicho_requerido check (rol = 'admin_empresa' or nicho_id is not null),
  constraint asignacion_nicho_de_empresa foreign key (nicho_id, empresa_id)
    references public.nichos(id, empresa_id) on delete cascade,
  unique nulls not distinct (usuario_id, empresa_id, nicho_id)
);

create table if not exists public.proveedores (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references public.empresas(id) on delete cascade,
  nombre          text not null check (char_length(nombre) between 2 and 150),
  email           text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  whatsapp_e164   text check (whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  api_endpoint    text check (api_endpoint ~ '^https://'),            -- solo HTTPS
  lead_time_dias  integer not null default 3 check (lead_time_dias between 0 and 365),
  condiciones     jsonb not null default '{}'::jsonb check (jsonb_typeof(condiciones) = 'object'),
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  unique (id, empresa_id)
);

-- ---------------------------------------------------------------------------------
-- 4. INVENTARIO (tabla principal) con atributos JSONB por nicho
-- ---------------------------------------------------------------------------------
create table if not exists public.inventario (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references public.empresas(id) on delete cascade,
  nicho_id           uuid not null,
  proveedor_id       uuid,
  sku                text not null check (sku ~ '^[A-Za-z0-9._\-]{1,64}$'),
  nombre             text not null check (char_length(nombre) between 2 and 200),
  unidad_medida      text not null default 'unidad' check (char_length(unidad_medida) between 1 and 20),
  stock_actual       numeric(14,3) not null default 0 check (stock_actual >= 0),
  stock_critico      numeric(14,3) not null default 0 check (stock_critico >= 0),
  stock_minimo       numeric(14,3) not null default 0,
  stock_maximo       numeric(14,3),
  lote_minimo_compra numeric(14,3) not null default 1 check (lote_minimo_compra > 0),
  costo_unitario     numeric(14,2) not null default 0 check (costo_unitario >= 0),
  -- Atributos propios del nicho: alimentos → {"fecha_vencimiento":"2026-12-01","lote":"L-88"}
  --                              moda      → {"talla":"M","color":"negro","temporada":"verano"}
  atributos          jsonb not null default '{}'::jsonb check (jsonb_typeof(atributos) = 'object'),
  activo             boolean not null default true,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  constraint inventario_minimo_vs_critico check (stock_minimo >= stock_critico),
  constraint inventario_maximo_vs_minimo  check (stock_maximo is null or stock_maximo >= stock_minimo),
  constraint inventario_nicho_de_empresa foreign key (nicho_id, empresa_id)
    references public.nichos(id, empresa_id) on delete restrict,
  constraint inventario_proveedor_de_empresa foreign key (proveedor_id, empresa_id)
    references public.proveedores(id, empresa_id) on delete restrict,
  unique (empresa_id, sku),
  unique (id, empresa_id, nicho_id)
);

create index if not exists idx_inventario_tenant      on public.inventario (empresa_id, nicho_id) where activo;
create index if not exists idx_inventario_bajo_minimo on public.inventario (empresa_id, nicho_id)
  where activo and stock_actual <= stock_minimo;
create index if not exists idx_inventario_atributos   on public.inventario using gin (atributos jsonb_path_ops);

-- ---------------------------------------------------------------------------------
-- 5. MOVIMIENTOS (libro mayor inmutable: ventas históricas para la IA)
-- ---------------------------------------------------------------------------------
create table if not exists public.movimientos_inventario (
  id              bigint generated always as identity primary key,
  empresa_id      uuid not null,
  nicho_id        uuid not null,
  producto_id     uuid not null,
  tipo            public.tipo_movimiento not null,
  cantidad        numeric(14,3) not null check (cantidad > 0),
  precio_unitario numeric(14,2) check (precio_unitario >= 0),
  referencia      text check (char_length(referencia) <= 120),
  atributos       jsonb not null default '{}'::jsonb check (jsonb_typeof(atributos) = 'object'),
  ocurrido_en     timestamptz not null default now(),
  registrado_por  uuid default auth.uid(),
  constraint movimiento_producto_tenant foreign key (producto_id, empresa_id, nicho_id)
    references public.inventario(id, empresa_id, nicho_id) on delete restrict
);

create index if not exists idx_mov_producto_fecha on public.movimientos_inventario (producto_id, ocurrido_en desc);
create index if not exists idx_mov_tenant_tipo    on public.movimientos_inventario (empresa_id, nicho_id, tipo, ocurrido_en desc);

-- ---------------------------------------------------------------------------------
-- 6. ÓRDENES DE COMPRA
-- ---------------------------------------------------------------------------------
create sequence if not exists public.ordenes_compra_consecutivo;

create table if not exists public.ordenes_compra (
  id                         uuid primary key default gen_random_uuid(),
  numero                     text not null unique default
                               ('OC-' || to_char(now(), 'YYYYMM') || '-' ||
                                lpad(nextval('public.ordenes_compra_consecutivo')::text, 6, '0')),
  empresa_id                 uuid not null references public.empresas(id) on delete cascade,
  nicho_id                   uuid not null,
  proveedor_id               uuid,
  control_abastecimiento_id  uuid unique,     -- FK se agrega en el archivo 02
  origen                     text not null default 'manual'
                               check (origen in ('manual', 'abastecimiento_autorizado')),
  estado                     public.estado_orden_compra not null default 'borrador',
  -- [{"producto_id":"…","sku":"…","nombre":"…","cantidad":10,"unidad":"kg","costo_unitario":1200,"subtotal":12000}]
  lineas                     jsonb not null default '[]'::jsonb check (jsonb_typeof(lineas) = 'array'),
  subtotal                   numeric(16,2) not null default 0 check (subtotal >= 0),
  moneda                     char(3) not null default 'COP' check (moneda ~ '^[A-Z]{3}$'),
  atributos                  jsonb not null default '{}'::jsonb check (jsonb_typeof(atributos) = 'object'),
  fecha_entrega_estimada     date,
  creado_por                 uuid default auth.uid(),
  creado_en                  timestamptz not null default now(),
  actualizado_en             timestamptz not null default now(),
  constraint orden_nicho_de_empresa foreign key (nicho_id, empresa_id)
    references public.nichos(id, empresa_id) on delete restrict,
  constraint orden_proveedor_de_empresa foreign key (proveedor_id, empresa_id)
    references public.proveedores(id, empresa_id) on delete restrict
);

create index if not exists idx_ordenes_tenant_estado on public.ordenes_compra (empresa_id, nicho_id, estado, creado_en desc);

-- ---------------------------------------------------------------------------------
-- 7. Triggers de actualizado_en
-- ---------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['empresas','nichos','asignaciones_usuario','proveedores','inventario','ordenes_compra'] loop
    execute format('drop trigger if exists tg_%1$s_actualizado on public.%1$I', t);
    execute format('create trigger tg_%1$s_actualizado before update on public.%1$I
                    for each row execute function privado.tg_actualizado_en()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------
-- 8. Validación de atributos JSONB contra el contrato del nicho
-- ---------------------------------------------------------------------------------
create or replace function privado.tg_validar_atributos_nicho()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_esquema jsonb;
  v_clave   text;
  v_tipo    text;
  v_valor   jsonb;
begin
  select n.esquema_atributos into v_esquema
  from public.nichos n
  where n.id = new.nicho_id and n.empresa_id = new.empresa_id;

  if v_esquema is null then
    raise exception 'NICHO_INVALIDO: el nicho % no pertenece a la empresa %', new.nicho_id, new.empresa_id
      using errcode = '23503';
  end if;

  -- 8.1 Claves requeridas
  for v_clave in select jsonb_array_elements_text(coalesce(v_esquema->'requeridos', '[]'::jsonb)) loop
    if not (new.atributos ? v_clave) or new.atributos->v_clave = 'null'::jsonb then
      raise exception 'ATRIBUTO_REQUERIDO: falta "%" para este nicho', v_clave using errcode = '23514';
    end if;
  end loop;

  -- 8.2 Tipos declarados
  for v_clave, v_tipo in select key, value #>> '{}' from jsonb_each(coalesce(v_esquema->'tipos', '{}'::jsonb)) loop
    v_valor := new.atributos->v_clave;
    continue when v_valor is null or v_valor = 'null'::jsonb;
    if v_tipo = 'date' then
      if jsonb_typeof(v_valor) <> 'string' or (v_valor #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'ATRIBUTO_TIPO: "%" debe ser fecha AAAA-MM-DD', v_clave using errcode = '23514';
      end if;
      perform (v_valor #>> '{}')::date;  -- falla si la fecha no existe (ej: 2026-02-31)
    elsif jsonb_typeof(v_valor) <> v_tipo then
      raise exception 'ATRIBUTO_TIPO: "%" debe ser de tipo %', v_clave, v_tipo using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists tg_inventario_validar_atributos on public.inventario;
create trigger tg_inventario_validar_atributos
  before insert or update of atributos, nicho_id on public.inventario
  for each row execute function privado.tg_validar_atributos_nicho();

-- ---------------------------------------------------------------------------------
-- 9. Aplicación automática de movimientos al stock
-- ---------------------------------------------------------------------------------
create or replace function privado.tg_aplicar_movimiento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta numeric(14,3);
  v_nuevo numeric(14,3);
begin
  v_delta := case new.tipo
               when 'compra'               then  new.cantidad
               when 'ajuste_positivo'      then  new.cantidad
               when 'devolucion_cliente'   then  new.cantidad
               else                              -new.cantidad   -- venta, merma, ajuste_negativo, devolucion_proveedor
             end;

  update public.inventario i
     set stock_actual = i.stock_actual + v_delta
   where i.id = new.producto_id
     and i.empresa_id = new.empresa_id
     and i.nicho_id = new.nicho_id
     and i.stock_actual + v_delta >= 0
  returning i.stock_actual into v_nuevo;

  if v_nuevo is null then
    raise exception 'STOCK_INSUFICIENTE: el movimiento dejaría el producto % en negativo', new.producto_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists tg_movimiento_aplicar on public.movimientos_inventario;
create trigger tg_movimiento_aplicar
  after insert on public.movimientos_inventario
  for each row execute function privado.tg_aplicar_movimiento();

-- ---------------------------------------------------------------------------------
-- 10. Funciones de autorización usadas por RLS (SECURITY DEFINER, sin recursión)
-- ---------------------------------------------------------------------------------
create or replace function privado.tiene_acceso(
  p_empresa_id uuid,
  p_nicho_id   uuid,
  p_roles      public.rol_usuario[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.asignaciones_usuario a
    where a.usuario_id = (select auth.uid())
      and a.activo
      and a.empresa_id = p_empresa_id
      and (a.nicho_id = p_nicho_id or (a.nicho_id is null and a.rol = 'admin_empresa'))
      and (p_roles is null or a.rol = any (p_roles))
  );
$$;

create or replace function privado.es_miembro(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.asignaciones_usuario a
    where a.usuario_id = (select auth.uid()) and a.activo and a.empresa_id = p_empresa_id
  );
$$;

create or replace function privado.es_admin(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.asignaciones_usuario a
    where a.usuario_id = (select auth.uid()) and a.activo
      and a.empresa_id = p_empresa_id and a.rol = 'admin_empresa'
  );
$$;

revoke all on function privado.tiene_acceso(uuid, uuid, public.rol_usuario[]) from public;
revoke all on function privado.es_miembro(uuid) from public;
revoke all on function privado.es_admin(uuid) from public;
grant execute on function privado.tiene_acceso(uuid, uuid, public.rol_usuario[]) to authenticated, service_role;
grant execute on function privado.es_miembro(uuid) to authenticated, service_role;
grant execute on function privado.es_admin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------
-- 11. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------------
alter table public.empresas               enable row level security;
alter table public.nichos                 enable row level security;
alter table public.asignaciones_usuario   enable row level security;
alter table public.proveedores            enable row level security;
alter table public.inventario             enable row level security;
alter table public.movimientos_inventario enable row level security;
alter table public.ordenes_compra         enable row level security;

-- El rol anónimo no toca ninguna tabla operativa
revoke all on public.empresas, public.nichos, public.asignaciones_usuario, public.proveedores,
              public.inventario, public.movimientos_inventario, public.ordenes_compra from anon;

-- Libro mayor inmutable y numeración controlada
revoke update, delete on public.movimientos_inventario from authenticated;
revoke delete on public.ordenes_compra from authenticated;

-- EMPRESAS
drop policy if exists empresas_select on public.empresas;
create policy empresas_select on public.empresas for select to authenticated
  using (privado.es_miembro(id));
drop policy if exists empresas_update on public.empresas;
create policy empresas_update on public.empresas for update to authenticated
  using (privado.es_admin(id)) with check (privado.es_admin(id));

-- NICHOS
drop policy if exists nichos_select on public.nichos;
create policy nichos_select on public.nichos for select to authenticated
  using (privado.tiene_acceso(empresa_id, id));
drop policy if exists nichos_admin_write on public.nichos;
create policy nichos_admin_write on public.nichos for all to authenticated
  using (privado.es_admin(empresa_id)) with check (privado.es_admin(empresa_id));

-- ASIGNACIONES (cada quien ve las suyas; el admin gestiona las de su empresa)
drop policy if exists asignaciones_select on public.asignaciones_usuario;
create policy asignaciones_select on public.asignaciones_usuario for select to authenticated
  using (usuario_id = (select auth.uid()) or privado.es_admin(empresa_id));
drop policy if exists asignaciones_admin_write on public.asignaciones_usuario;
create policy asignaciones_admin_write on public.asignaciones_usuario for all to authenticated
  using (privado.es_admin(empresa_id)) with check (privado.es_admin(empresa_id));

-- PROVEEDORES
drop policy if exists proveedores_select on public.proveedores;
create policy proveedores_select on public.proveedores for select to authenticated
  using (privado.es_miembro(empresa_id));
drop policy if exists proveedores_admin_write on public.proveedores;
create policy proveedores_admin_write on public.proveedores for all to authenticated
  using (privado.es_admin(empresa_id)) with check (privado.es_admin(empresa_id));

-- INVENTARIO
drop policy if exists inventario_select on public.inventario;
create policy inventario_select on public.inventario for select to authenticated
  using (privado.tiene_acceso(empresa_id, nicho_id));
drop policy if exists inventario_insert on public.inventario;
create policy inventario_insert on public.inventario for insert to authenticated
  with check (privado.tiene_acceso(empresa_id, nicho_id, array['admin_empresa','encargado']::public.rol_usuario[]));
drop policy if exists inventario_update on public.inventario;
create policy inventario_update on public.inventario for update to authenticated
  using      (privado.tiene_acceso(empresa_id, nicho_id, array['admin_empresa','encargado']::public.rol_usuario[]))
  with check (privado.tiene_acceso(empresa_id, nicho_id, array['admin_empresa','encargado']::public.rol_usuario[]));
drop policy if exists inventario_delete on public.inventario;
create policy inventario_delete on public.inventario for delete to authenticated
  using (privado.es_admin(empresa_id));

-- MOVIMIENTOS
drop policy if exists movimientos_select on public.movimientos_inventario;
create policy movimientos_select on public.movimientos_inventario for select to authenticated
  using (privado.tiene_acceso(empresa_id, nicho_id));
drop policy if exists movimientos_insert on public.movimientos_inventario;
create policy movimientos_insert on public.movimientos_inventario for insert to authenticated
  with check (
    privado.tiene_acceso(empresa_id, nicho_id, array['admin_empresa','encargado']::public.rol_usuario[])
    and registrado_por = (select auth.uid())
  );

-- ÓRDENES DE COMPRA
drop policy if exists ordenes_select on public.ordenes_compra;
create policy ordenes_select on public.ordenes_compra for select to authenticated
  using (privado.tiene_acceso(empresa_id, nicho_id));
drop policy if exists ordenes_insert on public.ordenes_compra;
create policy ordenes_insert on public.ordenes_compra for insert to authenticated
  with check (
    origen = 'manual'
    and privado.tiene_acceso(empresa_id, nicho_id, array['admin_empresa','encargado']::public.rol_usuario[])
  );
drop policy if exists ordenes_update on public.ordenes_compra;
create policy ordenes_update on public.ordenes_compra for update to authenticated
  using      (privado.tiene_acceso(empresa_id, nicho_id, array['admin_empresa','encargado']::public.rol_usuario[]))
  with check (privado.tiene_acceso(empresa_id, nicho_id, array['admin_empresa','encargado']::public.rol_usuario[]));

commit;
