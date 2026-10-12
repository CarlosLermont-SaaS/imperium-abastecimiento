-- =====================================================================================
-- IMPERIUM · Abastecimiento Inteligente by Lermont Signature
-- Archivo 05 · Capa SaaS: planes, suscripciones, eventos de pago, límites, plantillas de
-- nicho, configuración interna en Vault y paneles. Requiere 01 y 02.
-- =====================================================================================

begin;

-- ---------------------------------------------------------------------------------
-- 1. Planes comerciales
-- ---------------------------------------------------------------------------------
create table if not exists public.planes (
  codigo           text primary key check (codigo ~ '^[a-z_]{3,30}$'),
  nombre           text not null,
  precio_usd_mes   numeric(10,2) not null,
  max_nichos       integer,          -- NULL = ilimitado
  max_productos    integer,
  max_usuarios     integer,
  ia_habilitada    boolean not null default false,
  whatsapp         boolean not null default false,
  orden            integer not null default 0,
  activo           boolean not null default true
);

insert into public.planes (codigo, nombre, precio_usd_mes, max_nichos, max_productos, max_usuarios, ia_habilitada, whatsapp, orden) values
  ('esencial',    'Esencial',    29,  1,    150,  3,    false, false, 1),
  ('profesional', 'Profesional', 79,  5,    2000, 15,   true,  true,  2),
  ('imperial',    'Imperial',    199, null, null, null, true,  true,  3)
on conflict (codigo) do update set
  nombre = excluded.nombre, precio_usd_mes = excluded.precio_usd_mes, max_nichos = excluded.max_nichos,
  max_productos = excluded.max_productos, max_usuarios = excluded.max_usuarios,
  ia_habilitada = excluded.ia_habilitada, whatsapp = excluded.whatsapp, orden = excluded.orden;

-- ---------------------------------------------------------------------------------
-- 2. Suscripciones (una por empresa) y eventos de pago (idempotentes)
-- ---------------------------------------------------------------------------------
do $$ begin
  create type public.estado_suscripcion as enum
    ('prueba', 'activa', 'cancelada_fin_periodo', 'vencida', 'reembolsada', 'suspendida');
exception when duplicate_object then null; end $$;

create table if not exists public.suscripciones (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null unique references public.empresas(id) on delete cascade,
  plan_codigo         text not null references public.planes(codigo),
  estado              public.estado_suscripcion not null default 'prueba',
  plataforma          text not null check (plataforma in ('gumroad','hotmart','polar','mercadopago','generica','manual')),
  referencia_externa  text,                       -- id de suscripción / venta en la plataforma
  email_comprador     text not null check (email_comprador ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  vence_en            timestamptz,                -- fin del periodo pagado (NULL = sin vencimiento)
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  unique (plataforma, referencia_externa)
);
create index if not exists idx_suscripciones_email on public.suscripciones (lower(email_comprador));

drop trigger if exists tg_suscripciones_actualizado on public.suscripciones;
create trigger tg_suscripciones_actualizado before update on public.suscripciones
  for each row execute function privado.tg_actualizado_en();

create table if not exists public.eventos_pago (
  id              bigint generated always as identity primary key,
  plataforma      text not null,
  id_evento       text not null,
  tipo_evento     text not null,
  email           text,
  referencia      text,
  payload         jsonb not null,
  resultado       text,
  error           text,
  recibido_en     timestamptz not null default now(),
  unique (plataforma, id_evento)
);

-- ---------------------------------------------------------------------------------
-- 3. Plantillas de nicho listas para usar (punto de venta: multinicho real)
-- ---------------------------------------------------------------------------------
create table if not exists public.plantillas_nicho (
  codigo                  text primary key,
  nombre                  text not null,
  descripcion             text not null,
  esquema_atributos       jsonb not null,
  reglas_ia               jsonb not null default '{}'::jsonb,
  lead_time_dias          integer not null default 3,
  dias_cobertura_objetivo integer not null default 30,
  orden                   integer not null default 0
);

insert into public.plantillas_nicho (codigo, nombre, descripcion, esquema_atributos, reglas_ia, lead_time_dias, dias_cobertura_objetivo, orden) values
 ('alimentos', 'Alimentos y bebidas', 'Perecederos con fecha de vencimiento y lote',
  '{"requeridos":["fecha_vencimiento","lote"],"tipos":{"fecha_vencimiento":"date","lote":"string","vida_util_dias":"number","refrigerado":"boolean"}}',
  '{"vida_util_max_dias":21,"prioridad":"evitar_merma","estacionalidad":"alta en diciembre"}', 3, 21, 1),
 ('moda', 'Moda y calzado', 'Tallas, colores y temporadas',
  '{"requeridos":["talla","color"],"tipos":{"talla":"string","color":"string","temporada":"string","coleccion":"string"}}',
  '{"temporadas":{"verano":"dic-feb","escolar":"ene-feb y jul-ago"},"no_reordenar_coleccion_saliente":true}', 10, 45, 2),
 ('farmacia', 'Farmacia y droguería', 'Medicamentos con lote, vencimiento e invima',
  '{"requeridos":["lote","fecha_vencimiento","registro_invima"],"tipos":{"lote":"string","fecha_vencimiento":"date","registro_invima":"string","cadena_frio":"boolean"}}',
  '{"vida_util_minima_al_recibir_dias":180,"nunca_quiebre_de_stock":true}', 2, 30, 3),
 ('ferreteria', 'Ferretería y construcción', 'Referencias técnicas y medidas',
  '{"requeridos":["referencia_fabricante"],"tipos":{"referencia_fabricante":"string","medida":"string","material":"string"}}',
  '{"estacionalidad":"alta en temporada seca y fin de año"}', 5, 45, 4),
 ('tecnologia', 'Tecnología y electrónica', 'Modelos, garantía y obsolescencia',
  '{"requeridos":["modelo"],"tipos":{"modelo":"string","marca":"string","garantia_meses":"number","serial_requerido":"boolean"}}',
  '{"max_semanas_cobertura":6,"riesgo":"obsolescencia","picos":"black friday y navidad"}', 7, 30, 5),
 ('cosmetica', 'Cosmética y belleza', 'Tonos, vencimiento y registro sanitario',
  '{"requeridos":["fecha_vencimiento"],"tipos":{"fecha_vencimiento":"date","tono":"string","registro_sanitario":"string"}}',
  '{"picos":"día de la madre, amor y amistad, navidad"}', 5, 30, 6),
 ('restaurante', 'Restaurantes y cocinas', 'Insumos de cocina con rotación diaria',
  '{"requeridos":["fecha_vencimiento"],"tipos":{"fecha_vencimiento":"date","refrigerado":"boolean","proveedor_local":"boolean"}}',
  '{"vida_util_max_dias":7,"prioridad":"frescura","picos":"fines de semana y festivos"}', 1, 7, 7),
 ('hogar', 'Hogar y decoración', 'Colecciones, materiales y acabados',
  '{"requeridos":[],"tipos":{"material":"string","color":"string","coleccion":"string","dimensiones":"string"}}',
  '{"picos":"día de la madre, prima de diciembre y navidad"}', 10, 45, 8),
 ('mascotas', 'Mascotas', 'Alimento y accesorios por especie y etapa',
  '{"requeridos":["especie"],"tipos":{"especie":"string","etapa":"string","fecha_vencimiento":"date","peso_kg":"number"}}',
  '{"recompra_ciclica":true}', 4, 30, 9),
 ('autopartes', 'Autopartes y repuestos', 'Compatibilidad por marca, modelo y año',
  '{"requeridos":["referencia_oem"],"tipos":{"referencia_oem":"string","marca_vehiculo":"string","modelo_vehiculo":"string","anio":"number"}}',
  '{"demanda":"intermitente","priorizar_alta_rotacion":true}', 7, 60, 10),
 ('general', 'Comercio general', 'Plantilla libre para cualquier tipo de negocio',
  '{"requeridos":[],"tipos":{}}', '{}', 3, 30, 99)
on conflict (codigo) do update set
  nombre = excluded.nombre, descripcion = excluded.descripcion, esquema_atributos = excluded.esquema_atributos,
  reglas_ia = excluded.reglas_ia, lead_time_dias = excluded.lead_time_dias,
  dias_cobertura_objetivo = excluded.dias_cobertura_objetivo, orden = excluded.orden;

-- ---------------------------------------------------------------------------------
-- 4. Vigencia de la suscripción y acceso (reemplaza tiene_acceso de la Fase 1)
-- ---------------------------------------------------------------------------------
create or replace function privado.empresa_vigente(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.suscripciones s
    join public.empresas e on e.id = s.empresa_id
    where s.empresa_id = p_empresa_id
      and e.activo
      and s.estado in ('prueba', 'activa', 'cancelada_fin_periodo')
      and (s.vence_en is null or s.vence_en > now() - interval '3 days')   -- 3 días de gracia
  );
$$;
revoke all on function privado.empresa_vigente(uuid) from public;
grant execute on function privado.empresa_vigente(uuid) to authenticated, service_role;

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
  select privado.empresa_vigente(p_empresa_id)
     and exists (
       select 1
       from public.asignaciones_usuario a
       where a.usuario_id = (select auth.uid())
         and a.activo
         and a.empresa_id = p_empresa_id
         and (a.nicho_id = p_nicho_id or (a.nicho_id is null and a.rol = 'admin_empresa'))
         and (p_roles is null or a.rol = any (p_roles))
     );
$$;

-- La administración (nichos, equipo, proveedores) también exige suscripción vigente
create or replace function privado.es_admin(p_empresa_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select privado.empresa_vigente(p_empresa_id)
     and exists (
       select 1 from public.asignaciones_usuario a
       where a.usuario_id = (select auth.uid()) and a.activo
         and a.empresa_id = p_empresa_id and a.rol = 'admin_empresa'
     );
$$;

-- Las alertas solo se generan para empresas con suscripción vigente
create or replace function privado.tg_inventario_detectar_minimo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.activo and new.stock_actual <= new.stock_minimo and privado.empresa_vigente(new.empresa_id) then
    perform privado.registrar_alerta(new.id, 'trigger_stock');
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------------
-- 5. Límites por plan (nichos, productos, usuarios)
-- ---------------------------------------------------------------------------------
create or replace function privado.tg_limite_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan  public.planes;
  v_uso   integer;
  v_max   integer;
  v_que   text;
begin
  select p.* into v_plan
  from public.suscripciones s join public.planes p on p.codigo = s.plan_codigo
  where s.empresa_id = new.empresa_id;

  if v_plan.codigo is null then
    raise exception 'SIN_SUSCRIPCION: la empresa no tiene un plan activo' using errcode = '42501';
  end if;

  if tg_table_name = 'nichos' then
    v_max := v_plan.max_nichos; v_que := 'nichos';
    select count(*) into v_uso from public.nichos where empresa_id = new.empresa_id and activo;
  elsif tg_table_name = 'inventario' then
    v_max := v_plan.max_productos; v_que := 'productos';
    select count(*) into v_uso from public.inventario where empresa_id = new.empresa_id and activo;
  else
    v_max := v_plan.max_usuarios; v_que := 'usuarios';
    select count(distinct usuario_id) into v_uso from public.asignaciones_usuario
     where empresa_id = new.empresa_id and activo and usuario_id <> new.usuario_id;
  end if;

  if v_max is not null and v_uso >= v_max then
    raise exception 'LIMITE_PLAN: el plan % permite máximo % %. Mejore su plan para continuar.', v_plan.nombre, v_max, v_que
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists tg_nichos_limite on public.nichos;
create trigger tg_nichos_limite before insert on public.nichos
  for each row execute function privado.tg_limite_plan();
drop trigger if exists tg_inventario_limite on public.inventario;
create trigger tg_inventario_limite before insert on public.inventario
  for each row execute function privado.tg_limite_plan();
drop trigger if exists tg_asignaciones_limite on public.asignaciones_usuario;
create trigger tg_asignaciones_limite before insert on public.asignaciones_usuario
  for each row execute function privado.tg_limite_plan();

-- ---------------------------------------------------------------------------------
-- 6. Aprovisionamiento automático de clientes (lo usa la función de ventas)
-- ---------------------------------------------------------------------------------
create or replace function public.provisionar_cliente(
  p_usuario_id    uuid,
  p_email         text,
  p_nombre        text,
  p_empresa       text,
  p_plan          text,
  p_plataforma    text,
  p_referencia    text,
  p_estado        public.estado_suscripcion,
  p_vence_en      timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s        public.suscripciones;
  v_empresa  uuid;
  v_plan     text := coalesce((select codigo from public.planes where codigo = lower(p_plan)), 'profesional');
  v_nueva    boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SOLO_SERVICIO' using errcode = '42501';
  end if;

  -- 6.1 Renovación / cambio de estado de una suscripción existente
  select * into v_s from public.suscripciones
   where (plataforma = p_plataforma and referencia_externa = p_referencia)
   limit 1;
  -- Solo una compra nueva/reactivación se asocia por usuario; eventos negativos exigen la referencia exacta
  if v_s.id is null and p_estado in ('prueba', 'activa') then
    select s.* into v_s from public.suscripciones s
      join public.asignaciones_usuario a on a.empresa_id = s.empresa_id and a.rol = 'admin_empresa'
     where a.usuario_id = p_usuario_id
     order by s.creado_en desc limit 1;
  end if;

  if v_s.id is not null then
    update public.suscripciones
       set estado = p_estado,
           plan_codigo = v_plan,
           vence_en = coalesce(p_vence_en, vence_en),
           plataforma = p_plataforma,
           referencia_externa = coalesce(p_referencia, referencia_externa)
     where id = v_s.id
    returning * into v_s;
    return jsonb_build_object('accion', 'actualizada', 'empresa_id', v_s.empresa_id, 'estado', v_s.estado, 'plan', v_s.plan_codigo);
  end if;

  -- 6.2 Cliente nuevo (solo si el evento otorga acceso)
  if p_estado not in ('prueba', 'activa') then
    return jsonb_build_object('accion', 'ignorada', 'motivo', 'sin_suscripcion_previa');
  end if;

  insert into public.empresas (nombre)
  values (left(coalesce(nullif(btrim(p_empresa), ''), 'Empresa de ' || split_part(p_email, '@', 1)), 150))
  returning id into v_empresa;

  insert into public.suscripciones (empresa_id, plan_codigo, estado, plataforma, referencia_externa, email_comprador, vence_en)
  values (v_empresa, v_plan, p_estado, p_plataforma, p_referencia, lower(p_email), p_vence_en)
  returning * into v_s;

  insert into public.asignaciones_usuario (usuario_id, empresa_id, nicho_id, rol, nombre_mostrar, email)
  values (p_usuario_id, v_empresa, null, 'admin_empresa',
          left(coalesce(nullif(btrim(p_nombre), ''), split_part(p_email, '@', 1)), 120), lower(p_email));
  v_nueva := true;

  return jsonb_build_object('accion', 'creada', 'empresa_id', v_empresa, 'estado', v_s.estado, 'plan', v_s.plan_codigo, 'nueva', v_nueva);
end;
$$;
revoke all on function public.provisionar_cliente(uuid, text, text, text, text, text, text, public.estado_suscripcion, timestamptz) from public, anon, authenticated;
grant execute on function public.provisionar_cliente(uuid, text, text, text, text, text, text, public.estado_suscripcion, timestamptz) to service_role;

-- ---------------------------------------------------------------------------------
-- 7. Configuración interna (Vault) leída por las Edge Functions con service_role
-- ---------------------------------------------------------------------------------
create or replace function public.config_interna()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SOLO_SERVICIO' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'secreto_webhook_interno',  privado.secreto('secreto_webhook_interno'),
    'secreto_firma_aprobacion', privado.secreto('secreto_firma_aprobacion'),
    'secreto_ventas',           privado.secreto('secreto_ventas'),
    'url_app',                  privado.secreto('url_app')
  );
end;
$$;
revoke all on function public.config_interna() from public, anon, authenticated;
grant execute on function public.config_interna() to service_role;

-- ---------------------------------------------------------------------------------
-- 8. Paneles para la app (security invoker → respetan RLS)
-- ---------------------------------------------------------------------------------
create or replace function public.estado_cuenta()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'empresa_id', e.id,
    'empresa', e.nombre,
    'moneda', e.moneda,
    'rol', a.rol,
    'nicho_id', a.nicho_id,
    'nombre', a.nombre_mostrar,
    'vigente', privado.empresa_vigente(e.id),
    'suscripcion', (select jsonb_build_object('estado', s.estado, 'plan', s.plan_codigo, 'plataforma', s.plataforma, 'vence_en', s.vence_en)
                      from public.suscripciones s where s.empresa_id = e.id),
    'plan', (select to_jsonb(p) from public.suscripciones s join public.planes p on p.codigo = s.plan_codigo where s.empresa_id = e.id),
    'uso', jsonb_build_object(
      'nichos',    (select count(*) from public.nichos n where n.empresa_id = e.id and n.activo),
      'productos', (select count(*) from public.inventario i where i.empresa_id = e.id and i.activo),
      'usuarios',  (select count(distinct x.usuario_id) from public.asignaciones_usuario x where x.empresa_id = e.id and x.activo))
  ) order by a.creado_en), '[]'::jsonb)
  from public.asignaciones_usuario a
  join public.empresas e on e.id = a.empresa_id
  where a.usuario_id = (select auth.uid()) and a.activo;
$$;
grant execute on function public.estado_cuenta() to authenticated;

create or replace function public.resumen_panel(p_empresa_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'productos',            (select count(*) from public.inventario where empresa_id = p_empresa_id and activo),
    'bajo_minimo',          (select count(*) from public.inventario where empresa_id = p_empresa_id and activo and stock_actual <= stock_minimo),
    'criticos',             (select count(*) from public.inventario where empresa_id = p_empresa_id and activo and stock_actual <= stock_critico),
    'valor_inventario',     (select coalesce(sum(stock_actual * costo_unitario), 0) from public.inventario where empresa_id = p_empresa_id and activo),
    'pendientes',           (select count(*) from public.control_abastecimiento where empresa_id = p_empresa_id and estado = 'pendiente_aprobacion'),
    'autorizadas',          (select count(*) from public.control_abastecimiento where empresa_id = p_empresa_id and estado = 'autorizado'),
    'ordenes_mes',          (select count(*) from public.ordenes_compra where empresa_id = p_empresa_id and creado_en >= date_trunc('month', now())),
    'compras_mes',          (select coalesce(sum(subtotal), 0) from public.ordenes_compra where empresa_id = p_empresa_id and creado_en >= date_trunc('month', now()) and estado <> 'cancelada'),
    'ventas_30d',           (select coalesce(sum(cantidad * coalesce(precio_unitario, 0)), 0) from public.movimientos_inventario where empresa_id = p_empresa_id and tipo = 'venta' and ocurrido_en >= now() - interval '30 days'),
    'unidades_vendidas_30d',(select coalesce(sum(cantidad), 0) from public.movimientos_inventario where empresa_id = p_empresa_id and tipo = 'venta' and ocurrido_en >= now() - interval '30 days'),
    'ventas_por_dia',       (select coalesce(jsonb_agg(jsonb_build_object('dia', d.dia, 'unidades', d.u) order by d.dia), '[]'::jsonb)
                               from (select (ocurrido_en at time zone 'America/Bogota')::date dia, sum(cantidad) u
                                       from public.movimientos_inventario
                                      where empresa_id = p_empresa_id and tipo = 'venta' and ocurrido_en >= now() - interval '14 days'
                                      group by 1) d)
  );
$$;
grant execute on function public.resumen_panel(uuid) to authenticated;

-- ---------------------------------------------------------------------------------
-- 9. RLS de la capa SaaS
-- ---------------------------------------------------------------------------------
alter table public.planes            enable row level security;
alter table public.suscripciones     enable row level security;
alter table public.eventos_pago      enable row level security;
alter table public.plantillas_nicho  enable row level security;

revoke all on public.planes, public.suscripciones, public.eventos_pago, public.plantillas_nicho from anon;
revoke insert, update, delete on public.planes, public.suscripciones, public.plantillas_nicho from authenticated;
revoke all on public.eventos_pago from authenticated;

drop policy if exists planes_lectura on public.planes;
create policy planes_lectura on public.planes for select to authenticated using (activo);

drop policy if exists plantillas_lectura on public.plantillas_nicho;
create policy plantillas_lectura on public.plantillas_nicho for select to authenticated using (true);

drop policy if exists suscripciones_lectura on public.suscripciones;
create policy suscripciones_lectura on public.suscripciones for select to authenticated
  using (privado.es_miembro(empresa_id));
-- eventos_pago: sin políticas → solo el backend (service_role) lo usa.

-- ---------------------------------------------------------------------------------
-- 10. Mantenimiento diario: suscripciones vencidas
-- ---------------------------------------------------------------------------------
create or replace function privado.vencer_suscripciones()
returns integer
language sql
security definer
set search_path = ''
as $$
  with v as (
    update public.suscripciones
       set estado = 'vencida'
     where estado in ('activa', 'cancelada_fin_periodo', 'prueba')
       and vence_en is not null
       and vence_en < now() - interval '3 days'
    returning 1
  )
  select count(*)::integer from v;
$$;
revoke all on function privado.vencer_suscripciones() from public, anon, authenticated;

commit;
