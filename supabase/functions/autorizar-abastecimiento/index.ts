/**
 * =====================================================================================
 * EDGE FUNCTION · autorizar-abastecimiento
 * Arnés de seguridad humano · procesamiento de la autorización manual (Fase 2 · bloque 2)
 *
 * Lo llama la página móvil de aprobación cuando el encargado pulsa el botón recibido por
 * WhatsApp o correo. Acciones:
 *   - "consultar": muestra los datos de la solicitud (solo si el usuario tiene acceso por RLS)
 *   - "autorizar": pendiente_aprobacion → autorizado
 *   - "rechazar":  pendiente_aprobacion | autorizado → cancelado
 *
 * Validaciones en capas (todas obligatorias):
 *   1. Formato estricto de entrada (UUID, firma base64url de 43 caracteres, acción en lista blanca).
 *   2. Sesión real de Supabase Auth: el JWT se valida contra el servidor de Auth y su usuario
 *      debe coincidir con id_usuario.
 *   3. Firma HMAC-SHA256 del token en tiempo constante. 5 firmas fallidas bloquean el token.
 *   4. La RPC se ejecuta CON EL JWT DEL USUARIO (no service_role): RLS por empresa_id + nicho_id,
 *      rol encargado/admin, ventana < 7 días y firma se vuelven a verificar en PostgreSQL.
 *
 * Respuestas de error: { ok:false, error:{ codigo, mensaje, http_status, id_solicitud, fecha } }
 * Despliegue: verify_jwt = true (por defecto).
 * Secretos: la firma vive en Supabase Vault (config_interna). ORIGENES_PERMITIDOS opcional (ej: "https://usuario.github.io")
 * =====================================================================================
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ORIGENES = (Deno.env.get("ORIGENES_PERMITIDOS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_INTENTOS_FIRMA = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIRMA_RE = /^[A-Za-z0-9_-]{43}$/;
const ACCIONES = new Set(["consultar", "autorizar", "rechazar"]);

const HTTP_POR_CODIGO: Record<string, number> = {
  AUTORIZADO: 200,
  CANCELADO: 200,
  NO_AUTENTICADO: 401,
  FIRMA_INVALIDA: 403,
  FIRMA_REQUERIDA: 403,
  SIN_PERMISO: 403,
  AUTORIZACION_HUMANA_REQUERIDA: 403,
  USUARIO_NO_COINCIDE: 403,
  TOKEN_INVALIDO_O_SIN_PERMISO: 404,
  ESTADO_NO_AUTORIZABLE: 409,
  ESTADO_TERMINAL: 409,
  VENTANA_EXPIRADA: 410,
  BLOQUEADO_POR_INTENTOS: 423,
};

// deno-lint-ignore no-explicit-any
type Fila = Record<string, any>;

class ErrorHttp extends Error {
  constructor(public status: number, public codigo: string, mensaje: string) {
    super(mensaje);
  }
}

// ---------------------------------------------------------------------------------
// Configuración interna: los secretos viven cifrados en Supabase Vault (config_interna)
// ---------------------------------------------------------------------------------
type ConfigInterna = { secreto_webhook_interno: string | null; secreto_firma_aprobacion: string | null; secreto_ventas: string | null; url_app: string | null };
let cacheConfig: ConfigInterna | null = null;
// deno-lint-ignore no-explicit-any
async function obtenerConfig(db: any): Promise<ConfigInterna> {
  if (cacheConfig) return cacheConfig;
  const { data, error } = await db.rpc("config_interna");
  if (error || !data) throw new ErrorHttp(500, "CONFIGURACION_INCOMPLETA", "No se pudo leer la configuración interna.");
  cacheConfig = data as ConfigInterna;
  return cacheConfig;
}

// ---------------------------------------------------------------------------------
// CORS y respuestas
// ---------------------------------------------------------------------------------
function cabecerasCors(origen: string | null): Record<string, string> {
  const permitido = ORIGENES.length === 0 ? "*" : origen && ORIGENES.includes(origen) ? origen : ORIGENES[0];
  return {
    "Access-Control-Allow-Origin": permitido,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}

function respuesta(status: number, cuerpo: unknown, origen: string | null): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: {
      ...cabecerasCors(origen),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// ---------------------------------------------------------------------------------
// Firma HMAC (idéntica a privado.firma_aprobacion en SQL)
// ---------------------------------------------------------------------------------
async function firmarToken(token: string, secreto: string): Promise<string> {
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(token.toLowerCase())));
  let bin = "";
  for (const b of firma) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function compararSeguro(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

// ---------------------------------------------------------------------------------
// Validación de entrada
// ---------------------------------------------------------------------------------
interface Solicitud {
  accion: "consultar" | "autorizar" | "rechazar";
  token_verificacion: string;
  firma: string;
  id_usuario: string;
  motivo?: string;
}

function validar(c: unknown): Solicitud {
  if (!c || typeof c !== "object") throw new ErrorHttp(400, "CUERPO_INVALIDO", "El cuerpo debe ser un objeto JSON.");
  const s = c as Record<string, unknown>;
  const accion = (s.accion ?? "autorizar") as string;
  if (typeof accion !== "string" || !ACCIONES.has(accion)) throw new ErrorHttp(400, "ACCION_INVALIDA", "Acción no permitida.");
  if (typeof s.token_verificacion !== "string" || !UUID_RE.test(s.token_verificacion)) {
    throw new ErrorHttp(400, "TOKEN_FORMATO_INVALIDO", "token_verificacion debe ser un UUID.");
  }
  if (typeof s.firma !== "string" || !FIRMA_RE.test(s.firma)) {
    throw new ErrorHttp(403, "FIRMA_INVALIDA", "La firma digital del enlace no es válida.");
  }
  if (typeof s.id_usuario !== "string" || !UUID_RE.test(s.id_usuario)) {
    throw new ErrorHttp(400, "USUARIO_FORMATO_INVALIDO", "id_usuario debe ser un UUID.");
  }
  const motivo = s.motivo === undefined ? undefined
    : String(s.motivo).replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 300);
  return {
    accion: accion as Solicitud["accion"],
    token_verificacion: s.token_verificacion.toLowerCase(),
    firma: s.firma,
    id_usuario: s.id_usuario.toLowerCase(),
    motivo,
  };
}

// ---------------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------------
Deno.serve(async (req) => {
  const origen = req.headers.get("origin");
  const idSolicitud = crypto.randomUUID();

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cabecerasCors(origen) });

  try {
    if (req.method !== "POST") throw new ErrorHttp(405, "METODO_NO_PERMITIDO", "Use POST.");
    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
      throw new ErrorHttp(500, "CONFIGURACION_INCOMPLETA", "Faltan secretos de la función.");
    }
    if (Number(req.headers.get("content-length") ?? "0") > 4_096) {
      throw new ErrorHttp(413, "CUERPO_DEMASIADO_GRANDE", "Solicitud demasiado grande.");
    }

    // 1. Entrada
    const s = validar(await req.json().catch(() => null));

    // 2. Identidad real del usuario (JWT validado contra Supabase Auth)
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) throw new ErrorHttp(401, "NO_AUTENTICADO", "Debe iniciar sesión.");
    const usuarioDb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: eAuth } = await usuarioDb.auth.getUser(jwt);
    if (eAuth || !auth?.user) throw new ErrorHttp(401, "NO_AUTENTICADO", "Sesión inválida o expirada.");
    if (auth.user.id.toLowerCase() !== s.id_usuario) {
      throw new ErrorHttp(403, "USUARIO_NO_COINCIDE", "El usuario de la sesión no coincide con id_usuario.");
    }

    // 3. Firma digital + bloqueo por intentos (consulta de servicio solo sobre el contador)
    const servicio = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: registro } = await servicio.from("control_abastecimiento")
      .select("id, intentos_fallidos_firma")
      .eq("token_verificacion", s.token_verificacion)
      .maybeSingle();
    if (registro && registro.intentos_fallidos_firma >= MAX_INTENTOS_FIRMA) {
      throw new ErrorHttp(423, "BLOQUEADO_POR_INTENTOS", "El enlace se bloqueó por intentos fallidos. Solicite una nueva alerta.");
    }
    const cfg = await obtenerConfig(servicio);
    if (!cfg.secreto_firma_aprobacion || cfg.secreto_firma_aprobacion.length < 32) {
      throw new ErrorHttp(500, "CONFIGURACION_INCOMPLETA", "Falta la firma en Vault.");
    }
    const firmaEsperada = await firmarToken(s.token_verificacion, cfg.secreto_firma_aprobacion);
    if (!compararSeguro(firmaEsperada, s.firma)) {
      if (registro) {
        await servicio.from("control_abastecimiento")
          .update({ intentos_fallidos_firma: registro.intentos_fallidos_firma + 1 })
          .eq("id", registro.id);
      }
      throw new ErrorHttp(403, "FIRMA_INVALIDA", "La firma digital del enlace no es válida.");
    }

    // 4. Operación con el JWT del usuario → RLS + máquina de estados en PostgreSQL
    if (s.accion === "consultar") {
      const { data, error } = await usuarioDb.from("control_abastecimiento")
        .select(`id, empresa_id, nicho_id, estado, cantidad_sugerida, nivel_alerta, fecha_deteccion,
                 fecha_ejecucion_programada, fecha_autorizacion, metadatos,
                 producto:inventario!control_producto_tenant(sku, nombre, unidad_medida, stock_actual, stock_minimo,
                   costo_unitario, atributos, nicho:nichos!inventario_nicho_de_empresa(nombre))`)
        .eq("token_verificacion", s.token_verificacion)
        .maybeSingle();
      if (error) throw new ErrorHttp(500, "DB_ERROR", error.message);
      if (!data) throw new ErrorHttp(404, "TOKEN_INVALIDO_O_SIN_PERMISO", "El enlace no existe o no corresponde a su empresa y nicho.");
      const { data: roles } = await usuarioDb.from("asignaciones_usuario")
        .select("rol, nicho_id")
        .eq("usuario_id", s.id_usuario)
        .eq("empresa_id", data.empresa_id)
        .eq("activo", true);
      const puedeDecidir = ((roles ?? []) as Fila[]).some((r) =>
        (r.rol === "encargado" && r.nicho_id === data.nicho_id) || (r.rol === "admin_empresa" && (r.nicho_id === null || r.nicho_id === data.nicho_id))
      );
      return respuesta(200, {
        ok: true,
        codigo: "CONSULTA",
        solicitud: {
          ...data,
          ia_justificacion: data.metadatos?.ia_justificacion ?? null,
          metadatos: undefined,
          empresa_id: undefined,
          nicho_id: undefined,
          vigente: data.estado === "pendiente_aprobacion" && new Date(data.fecha_ejecucion_programada).getTime() > Date.now(),
          puede_decidir: puedeDecidir,
        },
        id_solicitud: idSolicitud,
      }, origen);
    }

    const { data: resultado, error: eRpc } = s.accion === "autorizar"
      ? await usuarioDb.rpc("autorizar_abastecimiento", { p_token: s.token_verificacion, p_firma: s.firma })
      : await usuarioDb.rpc("cancelar_abastecimiento", { p_token: s.token_verificacion, p_motivo: s.motivo ?? "rechazado_por_encargado" });
    if (eRpc) throw new ErrorHttp(500, "DB_ERROR", eRpc.message);

    const r = resultado as { ok: boolean; codigo: string; mensaje?: string; [k: string]: unknown };
    if (!r?.ok) {
      const codigo = r?.codigo ?? "ERROR_DESCONOCIDO";
      throw new ErrorHttp(HTTP_POR_CODIGO[codigo] ?? 400, codigo, r?.mensaje ?? "La operación fue rechazada.");
    }
    return respuesta(200, { ...r, id_solicitud: idSolicitud }, origen);
  } catch (e) {
    const err = e instanceof ErrorHttp ? e : new ErrorHttp(500, "ERROR_INTERNO", "Error inesperado.");
    if (!(e instanceof ErrorHttp)) console.error(idSolicitud, e);
    return respuesta(err.status, {
      ok: false,
      error: { codigo: err.codigo, mensaje: err.message, http_status: err.status, id_solicitud: idSolicitud, fecha: new Date().toISOString() },
    }, origen);
  }
});
