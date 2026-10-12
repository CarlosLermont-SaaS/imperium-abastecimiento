/**
 * =====================================================================================
 * EDGE FUNCTION · gestion-equipo
 * IMPERIUM · Invitar encargados y lectores a la empresa (solo administradores)
 *
 * Cuerpo: { empresa_id, email, nombre, rol: "encargado"|"lector"|"admin_empresa", nicho_id?, whatsapp_e164? }
 * - Verifica la sesión real del usuario y que sea admin_empresa vigente de esa empresa (RLS).
 * - Crea la cuenta del invitado si no existe (entrará con código al correo, sin contraseña).
 * - Inserta la asignación: los límites del plan los aplica la base de datos.
 * - Envía el correo de invitación si RESEND_API_KEY está configurada.
 * Despliegue: verify_jwt = true.
 * =====================================================================================
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_REMITENTE = Deno.env.get("EMAIL_REMITENTE") ?? "IMPERIUM <onboarding@resend.dev>";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ROLES = new Set(["encargado", "lector", "admin_empresa"]);

class ErrorHttp extends Error {
  constructor(public status: number, public codigo: string, mensaje: string) {
    super(mensaje);
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

function respuesta(status: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const limpiar = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const idSolicitud = crypto.randomUUID();
  try {
    if (req.method !== "POST") throw new ErrorHttp(405, "METODO_NO_PERMITIDO", "Use POST.");
    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) throw new ErrorHttp(500, "CONFIGURACION_INCOMPLETA", "Faltan secretos.");

    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const usuarioDb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth } = await usuarioDb.auth.getUser(jwt);
    if (!auth?.user) throw new ErrorHttp(401, "NO_AUTENTICADO", "Sesión inválida o expirada.");

    // deno-lint-ignore no-explicit-any
    const c = (await req.json().catch(() => null)) as any;
    if (!c || !UUID_RE.test(String(c.empresa_id ?? ""))) throw new ErrorHttp(400, "EMPRESA_INVALIDA", "empresa_id inválido.");
    const email = String(c.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 160) throw new ErrorHttp(400, "EMAIL_INVALIDO", "Correo inválido.");
    const rol = String(c.rol ?? "encargado");
    if (!ROLES.has(rol)) throw new ErrorHttp(400, "ROL_INVALIDO", "Rol no permitido.");
    const nichoId = c.nicho_id ? String(c.nicho_id) : null;
    if (rol !== "admin_empresa" && (!nichoId || !UUID_RE.test(nichoId))) throw new ErrorHttp(400, "NICHO_REQUERIDO", "Elija el nicho del encargado o lector.");
    const whatsapp = c.whatsapp_e164 ? String(c.whatsapp_e164).replace(/[\s-]/g, "") : null;
    if (whatsapp && !/^\+[1-9][0-9]{7,14}$/.test(whatsapp)) throw new ErrorHttp(400, "WHATSAPP_INVALIDO", "Use formato internacional, ej: +573001234567.");
    const nombre = limpiar(c.nombre, 120) || email.split("@")[0];

    // ¿Es admin vigente de esa empresa? (estado_cuenta respeta RLS y vigencia)
    const { data: cuentas } = await usuarioDb.rpc("estado_cuenta");
    // deno-lint-ignore no-explicit-any
    const cuenta = ((cuentas ?? []) as any[]).find((x) => x.empresa_id === c.empresa_id && x.rol === "admin_empresa");
    if (!cuenta) throw new ErrorHttp(403, "SIN_PERMISO", "Solo el administrador de la empresa puede invitar.");
    if (!cuenta.vigente) throw new ErrorHttp(402, "SUSCRIPCION_INACTIVA", "Renueve su plan para invitar usuarios.");

    const servicio = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    if (nichoId) {
      const { data: n } = await servicio.from("nichos").select("id").eq("id", nichoId).eq("empresa_id", c.empresa_id).maybeSingle();
      if (!n) throw new ErrorHttp(400, "NICHO_INVALIDO", "El nicho no pertenece a su empresa.");
    }

    const { data: existente } = await servicio.rpc("usuario_por_email", { p_email: email });
    let usuarioId = existente as string | null;
    if (!usuarioId) {
      const { data: creado, error } = await servicio.auth.admin.createUser({ email, email_confirm: true, user_metadata: { nombre } });
      if (error || !creado?.user) throw new ErrorHttp(500, "USUARIO_NO_CREADO", error?.message ?? "No se pudo crear la cuenta.");
      usuarioId = creado.user.id;
    }

    const { error: eA } = await servicio.from("asignaciones_usuario").insert({
      usuario_id: usuarioId, empresa_id: c.empresa_id, nicho_id: rol === "admin_empresa" ? null : nichoId,
      rol, nombre_mostrar: nombre, email, whatsapp_e164: whatsapp,
    });
    if (eA) {
      if (eA.code === "23505") throw new ErrorHttp(409, "YA_ASIGNADO", "Esa persona ya tiene acceso a ese nicho.");
      const msg = eA.message.startsWith("LIMITE_PLAN") ? eA.message.replace(/^LIMITE_PLAN:\s*/, "") : eA.message;
      throw new ErrorHttp(eA.message.startsWith("LIMITE_PLAN") ? 402 : 400, eA.message.startsWith("LIMITE_PLAN") ? "LIMITE_PLAN" : "DB_ERROR", msg);
    }

    if (RESEND_API_KEY) {
      const { data: cfg } = await servicio.rpc("config_interna");
      const urlApp = cfg?.url_app ?? "";
      const e = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: EMAIL_REMITENTE, to: [email], subject: `${cuenta.empresa} te invitó a IMPERIUM`,
          html: `<div style="font-family:Georgia,serif;background:#0B0B0F;color:#F4EFE3;padding:28px;text-align:center"><p style="letter-spacing:4px;color:#C9A227;font-size:12px">IMPERIUM · LERMONT SIGNATURE</p><p style="font-size:16px">Hola ${e(nombre)}, ${e(cuenta.empresa)} te dio acceso como <strong>${e(rol.replace("_", " "))}</strong>.</p><p style="color:#CFC8B8">Entra con ${e(email)}; recibirás un código de acceso.</p><a href="${e(urlApp)}" style="display:inline-block;margin-top:14px;padding:14px 24px;background:#C9A227;color:#0B0B0F;border-radius:10px;text-decoration:none;font-family:Arial;font-weight:bold">Entrar</a></div>`,
        }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {});
    }
    return respuesta(200, { ok: true, codigo: "INVITADO", usuario_id: usuarioId, id_solicitud: idSolicitud });
  } catch (e) {
    const err = e instanceof ErrorHttp ? e : new ErrorHttp(500, "ERROR_INTERNO", "Error inesperado.");
    if (!(e instanceof ErrorHttp)) console.error(idSolicitud, e);
    return respuesta(err.status, { ok: false, error: { codigo: err.codigo, mensaje: err.message, id_solicitud: idSolicitud } });
  }
});
