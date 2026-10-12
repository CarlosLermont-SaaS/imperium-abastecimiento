-- =====================================================================================
-- ABASTECIMIENTO AUTOMÁTICO MULTINICHO · FASE 2
-- Archivo 02 de 03 · Cola de pre-aviso de 7 días + arneses de seguridad + autorización humana
--
-- REGLAS QUE ESTE ARCHIVO HACE CUMPLIR DENTRO DE LA BASE DE DATOS (no solo en el código):
--   R1. Al tocar stock mínimo se crea UN registro 'pendiente_aprobacion' por producto, con
--       fecha_ejecucion_programada = fecha_deteccion + 7 días exactos (el cliente no la elige).
--   R2. Solo un HUMANO autenticado (auth.uid() no nulo), con rol encargado/admin de esa misma
--       empresa_id + nicho_id, con la FIRMA HMAC del enlace y ANTES del día 7 puede pasar a 'autorizado'.
--       La IA, Make, las Edge Functions con service_role y el cron NO pueden autorizar.
--   R3. Solo el sistema puede pasar 'autorizado' → 'ejecutado', y nunca antes del día 7.
--   R4. Ninguna orden de compra puede nacer sin humano: o la crea un usuario autenticado
--       (origen 'manual') o proviene de un control 'autorizado' con firma humana.
--   R5. Sin autorización al día 7 → 'cancelado' con motivo 'expirado_sin_autorizacion_manual'.
--   R6. Todo cambio queda en auditoria_abastecimiento (inmutable).
-- =====================================================================================

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------------
-- 1. Tipos
-- ---------------------------------------------------------------------------------
do $$ begin
  create type public.estado_abastecimiento as enum
    ('pendiente_aprobacion', 'autorizado', 'ejecutado', 'cancelado');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------------
-- 2. Tabla de control (cola de espera de 7 días)
-- ---------------------------------------------------------------------------------
create table if not exists public.control_abastecimiento (
  id                          uuid primary key default gen_random_uuid(),
  nicho_id                    uuid not null,
  empresa_id                  uuid not null,
  producto_id                 uuid not null,
  cantidad_sugerida           numeric(14,3) not null check (cantidad_sugerida > 0),
  estado                      public.estado_abastecimiento not null default 'pendiente_aprobacion',
  token_verificacion          uuid not null unique default gen_random_uuid(),
  fecha_deteccion             timestamptz not null default now(),
  fecha_ejecucion_programada  timestamptz not null default (now() + interval '7 days'),
  -- Contexto y trazabilidad
  nivel_alerta                text not null default 'minimo' check (nivel_alerta in ('minimo', 'critico')),
  stock_en_deteccion          numeric(14,3),
  origen                      text not null default 'trigger_stock'
                                check (origen in ('trigger_stock', 'webhook_alerta', 'manual')),
  autorizado_por              uuid references auth.users(id),
  fecha_autorizacion          timestamptz,
  cancelado_por               uuid references auth.users(id),
  cancelado_en                timestamptz,
  cancelado_motivo            text check (char_length(cancelado_motivo) <= 300),
  ejecutado_en                timestamptz,
  orden_compra_id             uuid unique references public.ordenes_compra(id),
  notificado_en               timestamptz,
  intentos_notificacion       integer not null default 0,
  intentos_fallidos_firma     integer not null default 0,
  metadatos                   jsonb not null default '{}'::jsonb check (jsonb_typeof(metadatos) = 'object'),
  creado_en                   timestamptz not null default now(),
  actualizado_en              timestamptz not null default now(),
  constraint control_producto_tenant foreign key (producto_id, empresa_id, nicho_id)
    references public.inventario(id, empresa_id, nicho_id) on delete restrict,
  -- La ventana de 7 días la fija el trigger tg_control_normalizar y la máquina de estados la vuelve inmutable.
  constraint control_autorizacion_coherente check (
    (estado not in ('autorizado', 'ejecutado') or (autorizado_por is not null and fecha_autorizacion is not null))
    and (estado <> 'pendiente_aprobacion' or autorizado_por is null)
  ),
  constraint control_ejecucion_coherente check ((estado = 'ejecutado') = (orden_compra_id is not null and ejecutado_en is not null))
);

-- Un solo ciclo activo por producto (evita alertas duplicadas)
create unique index if not exists ux_control_activo_por_producto
  on public.control_abastecimiento (producto_id)
  where estado in ('pendiente_aprobacion', 'autorizado');

create index if not exists idx_control_tenant_estado on public.control_abastecimiento (empresa_id, nicho_id, estado, fecha_ejecucion_programada);
create index if not exists idx_control_vencimiento   on public.control_abastecimiento (fecha_ejecucion_programada)
  where estado in ('pendiente_aprobacion', 'autorizado');
create index if not exists idx_control_sin_notificar on public.control_abastecimiento (fecha_deteccion)
  where estado = 'pendiente_aprobacion' and notificado_en is null;

drop trigger if exists tg_control_abastecimiento_actualizado on public.control_abastecimiento;
create trigger tg_control_abastecimiento_actualizado before update on public.control_abastecimiento
  for each row execute function privado.tg_actualizado_en();

-- FK diferida desde Fase 1
do $$ begin
  alter table public.ordenes_compra
    add constraint orden_control_fk foreign key (control_abastecimiento_id)
    references public.control_abastecimiento(id) on delete restrict;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------------
-- 3. Auditoría inmutable y predicciones de IA
-- ---------------------------------------------------------------------------------
create table if not exists public.auditoria_abastecimiento (
  id            bigint generated always as identity primary key,
  control_id    uuid not null references public.control_abastecimiento(id) on delete cascade,
  empresa_id    uuid not null,
  nicho_id      uuid not null,
  evento        text not null,
  estado_previo public.estado_abastecimiento,
  estado_nuevo  public.estado_abastecimiento,
  actor         uuid,                          -- NULL = sistema (cron / service_role)
  detalle       jsonb not null default '{}'::jsonb,
  ocurrido_en   timestamptz not null default now()
);
create index if not exists idx_auditoria_control on public.auditoria_abastecimiento (control_id, ocurrido_en);

create table if not exists public.predicciones_ia (
  id                         uuid primary key default gen_random_uuid(),
  empresa_id                 uuid not null,
  nicho_id                   uuid not null,
  producto_id                uuid not null,
  control_id                 uuid references public.control_abastecimiento(id) on delete set null,
  cantidad_a_reordenar       numeric(14,3) not null check (cantidad_a_reordenar >= 0),
  fecha_sugerida_pedido      date not null,
  factor_justificacion_nicho text not null check (char_length(factor_justificacion_nicho) <= 600),
  modelo                     text not null,
  entrada                    jsonb not null default '{}'::jsonb,
  respuesta_cruda            jsonb not null default '{}'::jsonb,
  creado_en                  timestamptz not null default now(),
  constraint prediccion_producto_tenant foreign key (producto_id, empresa_id, nicho_id)
    references public.inventario(id, empresa_id, nicho_id) on delete cascade
);
create index if not exists idx_predicciones_producto on public.predicciones_ia (producto_id, creado_en desc);

-- ---------------------------------------------------------------------------------
-- 4. Secretos (Supabase Vault) y firma HMAC del enlace de aprobación
-- ---------------------------------------------------------------------------------
create or replace function privado.secreto(p_nombre text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v text;
begin
  select ds.decrypted_secret into v
  from vault.decrypted_secrets ds
  where ds.name = p_nombre
  limit 1;
  return v;
exception when others then
  return null;
end;
$$;
revoke all on function privado.secreto(text) from public, anon, authenticated;

-- Firma = base64url( HMAC-SHA256( token_verificacion , secreto_firma_aprobacion ) )
-- La Edge Function calcula exactamente lo mismo con SECRETO_FIRMA_APROBACION.
create or replace function privado.firma_aprobacion(p_token uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_secreto text := privado.secreto('secreto_firma_aprobacion');
begin
  if v_secreto is null or char_length(v_secreto) < 32 then
    raise exception 'CONFIGURACION: falta el secreto secreto_firma_aprobacion (mínimo 32 caracteres) en Vault'
      using errcode = 'P0001';
  end if;
  return translate(
    encode(extensions.hmac(lower(p_token::text), v_secreto, 'sha256'), 'base64'),
    '+/=', '-_'
  );
end;
$$;
revoke all on function privado.firma_aprobacion(uuid) from public, anon, authenticated;

-- Verificación booleana (no revela la firma). Única vía expuesta a usuarios autenticados.
create or replace function privado.firma_valida(p_token uuid, p_firma text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_esperada text;
begin
  if p_token is null or p_firma is null or p_firma !~ '^[A-Za-z0-9_\-]{43}$' then
    return false;
  end if;
  v_esperada := privado.firma_aprobacion(p_token);
  -- Comparación de digests: tiempo constante frente a ataques de temporización
  return extensions.digest(v_esperada, 'sha256') = extensions.digest(p_firma, 'sha256');
end;
$$;
revoke all on function privado.firma_valida(uuid, text) from public, anon;
grant execute on function privado.firma_valida(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------
-- 5. ARNÉS R1: normalización obligatoria al insertar (7 días exactos, token del servidor)
-- ---------------------------------------------------------------------------------
create or replace function privado.tg_control_antes_insertar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.estado                     := 'pendiente_aprobacion';
  new.token_verificacion         := gen_random_uuid();   -- nunca se acepta un token enviado por el cliente
  new.fecha_deteccion            := now();
  new.fecha_ejecucion_programada := new.fecha_deteccion + interval '7 days';
  new.autorizado_por             := null;
  new.fecha_autorizacion         := null;
  new.cancelado_por              := null;
  new.cancelado_en               := null;
  new.ejecutado_en               := null;
  new.orden_compra_id            := null;
  new.notificado_en              := null;
  new.intentos_notificacion      := 0;
  new.intentos_fallidos_firma    := 0;
  return new;
end;
$$;

drop trigger if exists tg_control_normalizar on public.control_abastecimiento;
create trigger tg_control_normalizar
  before insert on public.control_abastecimiento
  for each row execute function privado.tg_control_antes_insertar();

-- ---------------------------------------------------------------------------------
-- 6. ARNESES R2 · R3 · R5: máquina de estados con autorización humana obligatoria
-- ---------------------------------------------------------------------------------
create or replace function privado.tg_control_maquina_estados()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid    := auth.uid();     -- NULL = sistema (cron, service_role, IA, Make)
  v_firmada boolean := coalesce(current_setting('app.autorizacion_firmada', true), '') = old.token_verificacion::text;
  v_roles   public.rol_usuario[] := array['admin_empresa', 'encargado']::public.rol_usuario[];
begin
  -- 6.1 Campos inmutables
  if new.id                         is distinct from old.id
  or new.empresa_id                 is distinct from old.empresa_id
  or new.nicho_id                   is distinct from old.nicho_id
  or new.producto_id                is distinct from old.producto_id
  or new.token_verificacion         is distinct from old.token_verificacion
  or new.fecha_deteccion            is distinct from old.fecha_deteccion
  or new.fecha_ejecucion_programada is distinct from old.fecha_ejecucion_programada
  or new.origen                     is distinct from old.origen then
    raise exception 'CAMPO_INMUTABLE: tenant, producto, token y ventana de 7 días no se pueden modificar'
      using errcode = '42501';
  end if;

  -- 6.2 La cantidad solo se ajusta mientras espera aprobación
  if new.cantidad_sugerida is distinct from old.cantidad_sugerida and old.estado <> 'pendiente_aprobacion' then
    raise exception 'CANTIDAD_BLOQUEADA: la cantidad solo cambia en pendiente_aprobacion' using errcode = '42501';
  end if;

  -- 6.3 Sin cambio de estado: se protegen los campos de firma humana
  if new.estado = old.estado then
    if new.autorizado_por     is distinct from old.autorizado_por
    or new.fecha_autorizacion is distinct from old.fecha_autorizacion
    or new.orden_compra_id    is distinct from old.orden_compra_id
    or new.ejecutado_en       is distinct from old.ejecutado_en
    or new.cancelado_por      is distinct from old.cancelado_por then
      raise exception 'CAMPO_PROTEGIDO: estos campos solo cambian con una transición válida' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.estado in ('ejecutado', 'cancelado') then
    raise exception 'ESTADO_TERMINAL: el registro está % y no admite cambios', old.estado using errcode = '42501';
  end if;

  -- 6.4 Transiciones permitidas
  if old.estado = 'pendiente_aprobacion' and new.estado = 'autorizado' then
    if v_uid is null then
      raise exception 'AUTORIZACION_HUMANA_REQUERIDA: ninguna IA, servicio o proceso automático puede autorizar compras'
        using errcode = '42501';
    end if;
    if not v_firmada then
      raise exception 'FIRMA_REQUERIDA: la autorización solo se acepta con el enlace firmado' using errcode = '42501';
    end if;
    if now() >= old.fecha_ejecucion_programada then
      raise exception 'VENTANA_EXPIRADA: pasaron los 7 días del pre-aviso' using errcode = '42501';
    end if;
    if not privado.tiene_acceso(old.empresa_id, old.nicho_id, v_roles) then
      raise exception 'SIN_PERMISO: el usuario no es encargado de esta empresa y nicho' using errcode = '42501';
    end if;
    new.autorizado_por     := v_uid;
    new.fecha_autorizacion := now();

  elsif new.estado = 'cancelado' then
    if v_uid is null then
      -- El sistema solo cancela por expiración sin firma humana
      if not (old.estado = 'pendiente_aprobacion' and now() >= old.fecha_ejecucion_programada) then
        raise exception 'CANCELACION_SISTEMA_NO_PERMITIDA' using errcode = '42501';
      end if;
      new.cancelado_motivo := coalesce(new.cancelado_motivo, 'expirado_sin_autorizacion_manual');
    else
      if not privado.tiene_acceso(old.empresa_id, old.nicho_id, v_roles) then
        raise exception 'SIN_PERMISO: el usuario no es encargado de esta empresa y nicho' using errcode = '42501';
      end if;
      new.cancelado_por    := v_uid;
      new.cancelado_motivo := coalesce(nullif(btrim(new.cancelado_motivo), ''), 'cancelado_por_encargado');
    end if;
    new.cancelado_en := now();

  elsif old.estado = 'autorizado' and new.estado = 'ejecutado' then
    if v_uid is not null then
      raise exception 'EJECUCION_SOLO_SISTEMA: la ejecución la hace el programador al cumplirse el día 7' using errcode = '42501';
    end if;
    if old.autorizado_por is null then
      raise exception 'AUTORIZACION_HUMANA_REQUERIDA' using errcode = '42501';
    end if;
    if now() < old.fecha_ejecucion_programada then
      raise exception 'EJECUCION_PREMATURA: aún no se cumplen los 7 días' using errcode = '42501';
    end if;
    if new.orden_compra_id is null then
      raise exception 'ORDEN_REQUERIDA: la ejecución debe referenciar la orden de compra generada' using errcode = '23514';
    end if;
    new.ejecutado_en := now();

  else
    raise exception 'TRANSICION_INVALIDA: % → %', old.estado, new.estado using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists tg_control_estados on public.control_abastecimiento;
create trigger tg_control_estados
  before update on public.control_abastecimiento
  for each row execute function privado.tg_control_maquina_estados();

-- ---------------------------------------------------------------------------------
-- 7. ARNÉS R6: auditoría automática
-- ---------------------------------------------------------------------------------
create or replace function privado.tg_control_auditar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.auditoria_abastecimiento (control_id, empresa_id, nicho_id, evento, estado_nuevo, actor, detalle)
    values (new.id, new.empresa_id, new.nicho_id, 'alerta_creada', new.estado, auth.uid(),
            jsonb_build_object('cantidad_sugerida', new.cantidad_sugerida, 'nivel_alerta', new.nivel_alerta,
                               'stock_en_deteccion', new.stock_en_deteccion, 'origen', new.origen,
                               'fecha_ejecucion_programada', new.fecha_ejecucion_programada));
  elsif new.estado is distinct from old.estado then
    insert into public.auditoria_abastecimiento (control_id, empresa_id, nicho_id, evento, estado_previo, estado_nuevo, actor, detalle)
    values (new.id, new.empresa_id, new.nicho_id, 'transicion', old.estado, new.estado, auth.uid(),
            jsonb_build_object('cancelado_motivo', new.cancelado_motivo, 'orden_compra_id', new.orden_compra_id));
  elsif new.cantidad_sugerida is distinct from old.cantidad_sugerida then
    insert into public.auditoria_abastecimiento (control_id, empresa_id, nicho_id, evento, actor, detalle)
    values (new.id, new.empresa_id, new.nicho_id, 'cantidad_ajustada', auth.uid(),
            jsonb_build_object('anterior', old.cantidad_sugerida, 'nueva', new.cantidad_sugerida,
                               'fuente', coalesce(new.metadatos->>'fuente_cantidad', 'desconocida')));
  end if;
  return null;
end;
$$;

drop trigger if exists tg_control_auditoria on public.control_abastecimiento;
create trigger tg_control_auditoria
  after insert or update on public.control_abastecimiento
  for each row execute function privado.tg_control_auditar();

-- ---------------------------------------------------------------------------------
-- 8. Registro de alerta (idempotente) y disparo automático desde el inventario
-- ---------------------------------------------------------------------------------
create or replace function privado.registrar_alerta(
  p_producto_id uuid,
  p_origen      text    default 'trigger_stock',
  p_cantidad    numeric default null,
  p_metadatos   jsonb   default '{}'::jsonb
)
returns public.control_abastecimiento
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p        public.inventario;
  v_c        public.control_abastecimiento;
  v_objetivo numeric;
  v_cantidad numeric;
begin
  select * into v_p from public.inventario where id = p_producto_id;
  if not found or not v_p.activo or v_p.stock_actual > v_p.stock_minimo then
    return null;
  end if;

  select * into v_c from public.control_abastecimiento
   where producto_id = p_producto_id and estado in ('pendiente_aprobacion', 'autorizado')
   limit 1;
  if found then
    return v_c;   -- ya hay un ciclo activo: no se duplica
  end if;

  -- Cantidad base determinística (la IA puede refinarla después, solo en pendiente_aprobacion)
  v_objetivo := coalesce(v_p.stock_maximo, greatest(v_p.stock_minimo * 2, v_p.stock_minimo + v_p.lote_minimo_compra));
  v_cantidad := coalesce(p_cantidad, v_objetivo - v_p.stock_actual);
  v_cantidad := greatest(ceil(v_cantidad / v_p.lote_minimo_compra) * v_p.lote_minimo_compra, v_p.lote_minimo_compra);

  insert into public.control_abastecimiento
    (empresa_id, nicho_id, producto_id, cantidad_sugerida, nivel_alerta, stock_en_deteccion, origen, metadatos)
  values
    (v_p.empresa_id, v_p.nicho_id, v_p.id, v_cantidad,
     case when v_p.stock_actual <= v_p.stock_critico then 'critico' else 'minimo' end,
     v_p.stock_actual, p_origen,
     coalesce(p_metadatos, '{}'::jsonb) || jsonb_build_object('fuente_cantidad', 'regla_base'))
  on conflict do nothing
  returning * into v_c;

  if v_c.id is null then
    select * into v_c from public.control_abastecimiento
     where producto_id = p_producto_id and estado in ('pendiente_aprobacion', 'autorizado')
     limit 1;
  end if;
  return v_c;
end;
$$;
revoke all on function privado.registrar_alerta(uuid, text, numeric, jsonb) from public, anon, authenticated;

create or replace function privado.tg_inventario_detectar_minimo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.activo and new.stock_actual <= new.stock_minimo then
    perform privado.registrar_alerta(new.id, 'trigger_stock');
  end if;
  return null;
end;
$$;

drop trigger if exists tg_inventario_stock_minimo on public.inventario;
create trigger tg_inventario_stock_minimo
  after insert or update of stock_actual, stock_minimo, stock_critico, activo on public.inventario
  for each row execute function privado.tg_inventario_detectar_minimo();

-- RPC para la Edge Function "alerta-stock-bajo" (solo service_role)
create or replace function public.registrar_alerta_stock(
  p_producto_id uuid,
  p_origen      text    default 'webhook_alerta',
  p_cantidad    numeric default null,
  p_metadatos   jsonb   default '{}'::jsonb
)
returns public.control_abastecimiento
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SOLO_SERVICIO: función reservada al backend' using errcode = '42501';
  end if;
  if p_origen not in ('webhook_alerta', 'trigger_stock') then
    raise exception 'ORIGEN_INVALIDO' using errcode = '22023';
  end if;
  return privado.registrar_alerta(p_producto_id, p_origen, p_cantidad, p_metadatos);
end;
$$;
revoke all on function public.registrar_alerta_stock(uuid, text, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_alerta_stock(uuid, text, numeric, jsonb) to service_role;

-- ---------------------------------------------------------------------------------
-- 9. Disparo del webhook de notificación (pg_net → Edge Function notificar-abastecimiento)
--    Nunca bloquea el inventario: si falla, el cron de reintentos lo vuelve a enviar.
-- ---------------------------------------------------------------------------------
create or replace function privado.enviar_notificacion(p_control_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url     text := privado.secreto('url_funcion_notificar');
  v_secreto text := privado.secreto('secreto_webhook_interno');
begin
  if v_url is null or v_secreto is null then
    raise warning 'NOTIFICACION_OMITIDA: faltan url_funcion_notificar o secreto_webhook_interno en Vault';
    return;
  end if;

  perform net.http_post(
    url                  := v_url,
    body                 := jsonb_build_object('control_id', p_control_id),
    headers              := jsonb_build_object('Content-Type', 'application/json',
                                               'x-webhook-secret', v_secreto),
    timeout_milliseconds := 15000
  );

  update public.control_abastecimiento
     set intentos_notificacion = intentos_notificacion + 1
   where id = p_control_id;
exception when others then
  raise warning 'NOTIFICACION_ERROR control %: %', p_control_id, sqlerrm;
end;
$$;
revoke all on function privado.enviar_notificacion(uuid) from public, anon, authenticated;

create or replace function privado.tg_control_notificar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform privado.enviar_notificacion(new.id);
  return null;
end;
$$;

drop trigger if exists tg_control_notificar_insert on public.control_abastecimiento;
create trigger tg_control_notificar_insert
  after insert on public.control_abastecimiento
  for each row execute function privado.tg_control_notificar();

-- ---------------------------------------------------------------------------------
-- 10. RPC de AUTORIZACIÓN MANUAL (security invoker → RLS + máquina de estados aplican)
-- ---------------------------------------------------------------------------------
create or replace function public.autorizar_abastecimiento(p_token uuid, p_firma text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_c public.control_abastecimiento;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTENTICADO', 'mensaje', 'Debe iniciar sesión.');
  end if;
  if p_token is null or p_firma is null or p_firma !~ '^[A-Za-z0-9_\-]{43}$' then
    return jsonb_build_object('ok', false, 'codigo', 'FIRMA_INVALIDA', 'mensaje', 'Enlace incompleto o alterado.');
  end if;

  -- RLS: solo devuelve filas de la empresa_id + nicho_id del usuario
  select * into v_c from public.control_abastecimiento where token_verificacion = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'codigo', 'TOKEN_INVALIDO_O_SIN_PERMISO',
                              'mensaje', 'El enlace no existe o no corresponde a su empresa y nicho.');
  end if;

  -- Verificación de la firma digital en la base (antes de revelar cualquier estado)
  if not privado.firma_valida(p_token, p_firma) then
    return jsonb_build_object('ok', false, 'codigo', 'FIRMA_INVALIDA', 'mensaje', 'La firma del enlace no es válida.');
  end if;

  if v_c.estado <> 'pendiente_aprobacion' then
    return jsonb_build_object('ok', false, 'codigo', 'ESTADO_NO_AUTORIZABLE', 'estado', v_c.estado,
                              'mensaje', 'Esta solicitud ya está en estado ' || v_c.estado::text || '.');
  end if;
  if now() >= v_c.fecha_ejecucion_programada then
    return jsonb_build_object('ok', false, 'codigo', 'VENTANA_EXPIRADA',
                              'mensaje', 'Pasaron los 7 días del pre-aviso; la compra quedó bloqueada.');
  end if;

  perform set_config('app.autorizacion_firmada', p_token::text, true);

  update public.control_abastecimiento
     set estado = 'autorizado'
   where id = v_c.id
  returning * into v_c;

  perform set_config('app.autorizacion_firmada', '', true);

  return jsonb_build_object(
    'ok', true,
    'codigo', 'AUTORIZADO',
    'control_id', v_c.id,
    'estado', v_c.estado,
    'autorizado_por', v_c.autorizado_por,
    'fecha_autorizacion', v_c.fecha_autorizacion,
    'fecha_ejecucion_programada', v_c.fecha_ejecucion_programada,
    'mensaje', 'Autorización registrada. La compra se ejecutará el ' ||
               to_char(v_c.fecha_ejecucion_programada at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') || ' (hora Colombia).'
  );
exception
  when insufficient_privilege then
    return jsonb_build_object('ok', false, 'codigo', split_part(sqlerrm, ':', 1), 'mensaje', sqlerrm);
end;
$$;
revoke all on function public.autorizar_abastecimiento(uuid, text) from public, anon;
grant execute on function public.autorizar_abastecimiento(uuid, text) to authenticated;

create or replace function public.cancelar_abastecimiento(p_token uuid, p_motivo text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_c public.control_abastecimiento;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'codigo', 'NO_AUTENTICADO');
  end if;
  update public.control_abastecimiento
     set estado = 'cancelado',
         cancelado_motivo = left(nullif(btrim(p_motivo), ''), 300)
   where token_verificacion = p_token
     and estado in ('pendiente_aprobacion', 'autorizado')
  returning * into v_c;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'codigo', 'TOKEN_INVALIDO_O_SIN_PERMISO');
  end if;
  return jsonb_build_object('ok', true, 'codigo', 'CANCELADO', 'control_id', v_c.id, 'estado', v_c.estado);
exception
  when insufficient_privilege then
    return jsonb_build_object('ok', false, 'codigo', split_part(sqlerrm, ':', 1), 'mensaje', sqlerrm);
end;
$$;
revoke all on function public.cancelar_abastecimiento(uuid, text) from public, anon;
grant execute on function public.cancelar_abastecimiento(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------
-- 11. ARNÉS R4: ninguna orden de compra sin humano
-- ---------------------------------------------------------------------------------
create or replace function privado.tg_orden_guardia()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.control_abastecimiento;
begin
  if tg_op = 'UPDATE' then
    if new.origen is distinct from old.origen
    or new.control_abastecimiento_id is distinct from old.control_abastecimiento_id
    or new.empresa_id is distinct from old.empresa_id
    or new.nicho_id is distinct from old.nicho_id then
      raise exception 'CAMPO_INMUTABLE: origen, control y tenant de la orden no se modifican' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.origen = 'abastecimiento_autorizado' then
    select * into v_c from public.control_abastecimiento where id = new.control_abastecimiento_id;
    if not found
       or v_c.estado <> 'autorizado'
       or v_c.autorizado_por is null
       or now() < v_c.fecha_ejecucion_programada
       or v_c.empresa_id <> new.empresa_id
       or v_c.nicho_id <> new.nicho_id then
      raise exception 'ORDEN_SIN_AUTORIZACION_HUMANA: la compra automática exige un control autorizado y vencido'
        using errcode = '42501';
    end if;
  else
    if auth.uid() is null then
      raise exception 'ORDEN_MANUAL_REQUIERE_HUMANO: ninguna IA ni proceso automático puede crear órdenes'
        using errcode = '42501';
    end if;
    if new.control_abastecimiento_id is not null then
      raise exception 'ORDEN_MANUAL_SIN_CONTROL: una orden manual no puede reclamar un control' using errcode = '42501';
    end if;
    new.creado_por := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists tg_ordenes_guardia on public.ordenes_compra;
create trigger tg_ordenes_guardia
  before insert or update on public.ordenes_compra
  for each row execute function privado.tg_orden_guardia();

-- Aviso a Make cuando nace una orden automática autorizada (opcional: requiere secretos)
create or replace function privado.tg_orden_notificar_make()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := privado.secreto('url_webhook_make_ordenes');
  v_key text := privado.secreto('make_api_key');
begin
  if v_url is null then
    return null;
  end if;
  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object(
                 'evento', 'orden_compra.emitida',
                 'version', '1.0',
                 'orden', to_jsonb(new) - 'atributos',
                 'requiere_envio_a_proveedor', true),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-make-apikey', coalesce(v_key, '')),
    timeout_milliseconds := 15000
  );
  return null;
exception when others then
  raise warning 'ORDEN_NOTIFICACION_ERROR %: %', new.id, sqlerrm;
  return null;
end;
$$;

drop trigger if exists tg_ordenes_notificar_make on public.ordenes_compra;
create trigger tg_ordenes_notificar_make
  after insert on public.ordenes_compra
  for each row when (new.origen = 'abastecimiento_autorizado')
  execute function privado.tg_orden_notificar_make();

-- ---------------------------------------------------------------------------------
-- 12. Programador: ejecuta autorizados vencidos y bloquea/cancela los no autorizados
-- ---------------------------------------------------------------------------------
create or replace function privado.ejecutar_abastecimientos_vencidos()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          record;
  v_orden_id uuid;
  v_ejec     integer := 0;
  v_exp      integer := 0;
  v_err      integer := 0;
begin
  -- 12.1 Autorizados por humano y con día 7 cumplido → orden de compra
  for r in
    select c.id, c.empresa_id, c.nicho_id, c.producto_id, c.cantidad_sugerida,
           c.autorizado_por, c.fecha_autorizacion,
           i.sku, i.nombre, i.unidad_medida, i.costo_unitario, i.proveedor_id, i.atributos,
           coalesce(pr.lead_time_dias, n.lead_time_dias) as lead_time, e.moneda
      from public.control_abastecimiento c
      join public.inventario i on i.id = c.producto_id
      join public.nichos     n on n.id = c.nicho_id
      join public.empresas   e on e.id = c.empresa_id
      left join public.proveedores pr on pr.id = i.proveedor_id
     where c.estado = 'autorizado'
       and c.fecha_ejecucion_programada <= now()
     order by c.fecha_ejecucion_programada
     for update of c skip locked
  loop
    begin
      insert into public.ordenes_compra
        (empresa_id, nicho_id, proveedor_id, control_abastecimiento_id, origen, estado,
         lineas, subtotal, moneda, fecha_entrega_estimada, creado_por, atributos)
      values
        (r.empresa_id, r.nicho_id, r.proveedor_id, r.id, 'abastecimiento_autorizado', 'emitida',
         jsonb_build_array(jsonb_build_object(
           'producto_id', r.producto_id, 'sku', r.sku, 'nombre', r.nombre,
           'cantidad', r.cantidad_sugerida, 'unidad', r.unidad_medida,
           'costo_unitario', r.costo_unitario,
           'subtotal', round(r.cantidad_sugerida * r.costo_unitario, 2),
           'atributos_nicho', r.atributos)),
         round(r.cantidad_sugerida * r.costo_unitario, 2), r.moneda,
         current_date + r.lead_time, r.autorizado_por,
         jsonb_build_object('autorizado_por', r.autorizado_por, 'fecha_autorizacion', r.fecha_autorizacion))
      returning id into v_orden_id;

      update public.control_abastecimiento
         set estado = 'ejecutado', orden_compra_id = v_orden_id
       where id = r.id;

      v_ejec := v_ejec + 1;
    exception when others then
      v_err := v_err + 1;
      raise warning 'EJECUCION_FALLIDA control %: %', r.id, sqlerrm;
    end;
  end loop;

  -- 12.2 Sin firma humana al día 7 → compra bloqueada (cancelado)
  with expirados as (
    update public.control_abastecimiento
       set estado = 'cancelado', cancelado_motivo = 'expirado_sin_autorizacion_manual'
     where estado = 'pendiente_aprobacion'
       and fecha_ejecucion_programada <= now()
    returning 1
  )
  select count(*) into v_exp from expirados;

  return jsonb_build_object('ejecutados', v_ejec, 'bloqueados_sin_autorizacion', v_exp,
                            'errores', v_err, 'corrido_en', now());
end;
$$;
revoke all on function privado.ejecutar_abastecimientos_vencidos() from public, anon, authenticated;

-- Reintento de notificaciones no confirmadas (máximo 5 intentos)
create or replace function privado.reintentar_notificaciones()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id from public.control_abastecimiento
     where estado = 'pendiente_aprobacion'
       and notificado_en is null
       and intentos_notificacion < 5
       and fecha_deteccion < now() - interval '10 minutes'
     order by fecha_deteccion
     limit 50
  loop
    perform privado.enviar_notificacion(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function privado.reintentar_notificaciones() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------
-- 12-bis. Historial agregado para el motor de IA (solo backend)
-- ---------------------------------------------------------------------------------
create or replace function public.ventas_semanales(
  p_empresa_id   uuid,
  p_producto_ids uuid[],
  p_semanas      integer default 26
)
returns table (producto_id uuid, semana date, unidades_vendidas numeric, unidades_devueltas numeric, unidades_merma numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'SOLO_SERVICIO: función reservada al backend' using errcode = '42501';
  end if;
  return query
    select m.producto_id,
           (date_trunc('week', m.ocurrido_en at time zone 'America/Bogota'))::date as semana,
           coalesce(sum(m.cantidad) filter (where m.tipo = 'venta'), 0),
           coalesce(sum(m.cantidad) filter (where m.tipo = 'devolucion_cliente'), 0),
           coalesce(sum(m.cantidad) filter (where m.tipo = 'merma'), 0)
      from public.movimientos_inventario m
     where m.empresa_id = p_empresa_id
       and m.producto_id = any (p_producto_ids)
       and m.tipo in ('venta', 'devolucion_cliente', 'merma')
       and m.ocurrido_en >= now() - make_interval(weeks => least(greatest(p_semanas, 4), 104))
     group by 1, 2
     order by 1, 2;
end;
$$;
revoke all on function public.ventas_semanales(uuid, uuid[], integer) from public, anon, authenticated;
grant execute on function public.ventas_semanales(uuid, uuid[], integer) to service_role;

-- ---------------------------------------------------------------------------------
-- 13. RLS estricto de la Fase 2
-- ---------------------------------------------------------------------------------
alter table public.control_abastecimiento   enable row level security;
alter table public.auditoria_abastecimiento enable row level security;
alter table public.predicciones_ia          enable row level security;

revoke all on public.control_abastecimiento, public.auditoria_abastecimiento, public.predicciones_ia from anon;
revoke insert, update, delete on public.control_abastecimiento from authenticated;
grant  select on public.control_abastecimiento to authenticated;
grant  update (estado, cancelado_motivo) on public.control_abastecimiento to authenticated;  -- solo vía máquina de estados
revoke insert, update, delete on public.auditoria_abastecimiento from authenticated;
revoke insert, update, delete on public.predicciones_ia from authenticated;

drop policy if exists control_select on public.control_abastecimiento;
create policy control_select on public.control_abastecimiento for select to authenticated
  using (privado.tiene_acceso(empresa_id, nicho_id));

drop policy if exists control_update_encargado on public.control_abastecimiento;
create policy control_update_encargado on public.control_abastecimiento for update to authenticated
  using      (privado.tiene_acceso(empresa_id, nicho_id, array['admin_empresa','encargado']::public.rol_usuario[]))
  with check (privado.tiene_acceso(empresa_id, nicho_id, array['admin_empresa','encargado']::public.rol_usuario[]));

drop policy if exists auditoria_select on public.auditoria_abastecimiento;
create policy auditoria_select on public.auditoria_abastecimiento for select to authenticated
  using (privado.tiene_acceso(empresa_id, nicho_id));

drop policy if exists predicciones_select on public.predicciones_ia;
create policy predicciones_select on public.predicciones_ia for select to authenticated
  using (privado.tiene_acceso(empresa_id, nicho_id));

commit;
