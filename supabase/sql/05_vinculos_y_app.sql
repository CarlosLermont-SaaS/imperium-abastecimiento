-- IMPERIUM · Archivo 06 · Vínculos directos con empresas y búsqueda de usuario por correo (solo backend)
alter table public.control_abastecimiento add constraint control_empresa_fk foreign key (empresa_id) references public.empresas(id) on delete cascade;
alter table public.auditoria_abastecimiento add constraint auditoria_empresa_fk foreign key (empresa_id) references public.empresas(id) on delete cascade;
alter table public.predicciones_ia add constraint predicciones_empresa_fk foreign key (empresa_id) references public.empresas(id) on delete cascade;
alter table public.movimientos_inventario add constraint movimientos_empresa_fk foreign key (empresa_id) references public.empresas(id) on delete cascade;

create or replace function public.usuario_por_email(p_email text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'SOLO_SERVICIO' using errcode = '42501'; end if;
  select u.id into v from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
  return v;
end; $$;
revoke all on function public.usuario_por_email(text) from public, anon, authenticated;
grant execute on function public.usuario_por_email(text) to service_role;

-- Firma para autorizar dentro de la app (sesión del encargado + RLS; mismo arnés que el enlace)
create or replace function privado.firma_para_encargado(p_control_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_c public.control_abastecimiento;
begin
  select * into v_c from public.control_abastecimiento where id = p_control_id;
  if not found or not privado.tiene_acceso(v_c.empresa_id, v_c.nicho_id, array['admin_empresa','encargado']::public.rol_usuario[]) then return null; end if;
  return privado.firma_aprobacion(v_c.token_verificacion);
end; $$;
revoke all on function privado.firma_para_encargado(uuid) from public, anon;
grant execute on function privado.firma_para_encargado(uuid) to authenticated;

create or replace function public.autorizar_en_app(p_control_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_token uuid; v_firma text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'codigo', 'NO_AUTENTICADO'); end if;
  select token_verificacion into v_token from public.control_abastecimiento where id = p_control_id;
  v_firma := privado.firma_para_encargado(p_control_id);
  if v_token is null or v_firma is null then
    return jsonb_build_object('ok', false, 'codigo', 'TOKEN_INVALIDO_O_SIN_PERMISO', 'mensaje', 'No tiene permiso para autorizar esta solicitud.');
  end if;
  return public.autorizar_abastecimiento(v_token, v_firma);
end; $$;
revoke all on function public.autorizar_en_app(uuid) from public, anon;
grant execute on function public.autorizar_en_app(uuid) to authenticated;

create or replace function public.rechazar_en_app(p_control_id uuid, p_motivo text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_token uuid;
begin
  select token_verificacion into v_token from public.control_abastecimiento where id = p_control_id;
  if v_token is null then return jsonb_build_object('ok', false, 'codigo', 'TOKEN_INVALIDO_O_SIN_PERMISO'); end if;
  return public.cancelar_abastecimiento(v_token, coalesce(p_motivo, 'rechazado_por_encargado'));
end; $$;
revoke all on function public.rechazar_en_app(uuid, text) from public, anon;
grant execute on function public.rechazar_en_app(uuid, text) to authenticated;
