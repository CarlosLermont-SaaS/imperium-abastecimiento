/**
 * EDGE FUNCTION · notificar-abastecimiento — IMPERIUM by Lermont Signature
 * Pre-aviso de 7 días: refina la cantidad con IA, firma el enlace de aprobación (HMAC) y avisa a
 * cada encargado del nicho por WhatsApp y correo.
 * Envío: A) Make (MAKE_WEBHOOK_URL + MAKE_API_KEY) o B) directo (RESEND_API_KEY, WHATSAPP_TOKEN + WHATSAPP_PHONE_ID).
 * Secretos internos (webhook, firma, URL de la app) en Supabase Vault. verify_jwt = false.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAKE_WEBHOOK_URL = Deno.env.get("MAKE_WEBHOOK_URL") ?? "";
const MAKE_API_KEY = Deno.env.get("MAKE_API_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const WHATSAPP_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_ID") ?? "";
const WHATSAPP_API_VERSION = Deno.env.get("WHATSAPP_API_VERSION") ?? "v21.0";
const EMAIL_REMITENTE = Deno.env.get("EMAIL_REMITENTE") ?? "IMPERIUM <onboarding@resend.dev>";
const WHATSAPP_PLANTILLA = Deno.env.get("WHATSAPP_PLANTILLA") ?? "alerta_abastecimiento_aprobacion";
const WHATSAPP_IDIOMA = Deno.env.get("WHATSAPP_IDIOMA") ?? "es";
const IA_REFINAR = (Deno.env.get("IA_REFINAR_CANTIDAD") ?? "true") === "true";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Texto obligatorio en ambos canales (no modificar). */
export const TEXTO_OBLIGATORIO =
  "La IA ha detectado baja disponibilidad de mercancía. Se requiere su total atención y ejecución con eficiencia para verificar que lo solicitado sea lo que realmente falta. La ejecución automática se realizará en 7 días si cuenta con su autorización manual.";

class ErrorHttp extends Error {
  constructor(public status: number, public codigo: string, mensaje: string) {
    super(mensaje);
  }
}

// deno-lint-ignore no-explicit-any
type Fila = Record<string, any>;

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

function respuesta(status: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function compararSeguro(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/** base64url(HMAC-SHA256(token, secreto)) — idéntico a privado.firma_aprobacion() en SQL. */
export async function firmarToken(token: string, secreto: string): Promise<string> {
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(token.toLowerCase())));
  let bin = "";
  for (const b of firma) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function escaparHtml(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Reglas de Meta: sin saltos, tabs ni más de 4 espacios seguidos. También evita inyección en asuntos de correo. */
export function paramWhatsApp(v: unknown, max = 60): string {
  const limpio = String(v ?? "").replace(/[\r\n\t\u0000-\u001F\u007F]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return (limpio || "-").slice(0, max);
}

function formatearFecha(iso: string, zona: string): string {
  return new Intl.DateTimeFormat("es-CO", { timeZone: zona, weekday: "long", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(iso));
}
const formatearNumero = (v: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 }).format(v);
const formatearMoneda = (v: number, moneda: string) => new Intl.NumberFormat("es-CO", { style: "currency", currency: moneda, maximumFractionDigits: 0 }).format(v);

interface DatosMensaje {
  nombreEncargado: string; producto: string; sku: string; nicho: string; cantidad: number; unidad: string;
  stockActual: number; stockMinimo: number; nivel: string; costoEstimado: number; moneda: string;
  fechaLimite: string; urlAprobacion: string; parametroBoton: string; justificacionIa: string | null; controlId: string;
}

export function construirWhatsAppPayload(telefonoE164: string, d: DatosMensaje) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: telefonoE164.replace(/^\+/, ""),
    type: "template",
    template: {
      name: WHATSAPP_PLANTILLA,
      language: { code: WHATSAPP_IDIOMA },
      components: [
        { type: "body", parameters: [
          { type: "text", text: paramWhatsApp(d.nombreEncargado, 40) },
          { type: "text", text: paramWhatsApp(`${d.producto} (${d.sku})`, 80) },
          { type: "text", text: paramWhatsApp(d.nicho, 40) },
          { type: "text", text: paramWhatsApp(`${formatearNumero(d.cantidad)} ${d.unidad}`, 30) },
        ] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: d.parametroBoton }] },
      ],
    },
  };
}

export function construirEmailPayload(email: string, d: DatosMensaje) {
  const e = escaparHtml;
  const critico = d.nivel === "critico";
  const filas: Array<[string, string]> = [
    ["Producto", d.producto], ["SKU", d.sku], ["Nicho", d.nicho],
    ["Stock actual / mínimo", `${formatearNumero(d.stockActual)} / ${formatearNumero(d.stockMinimo)} ${d.unidad}`],
    ["Cantidad sugerida", `${formatearNumero(d.cantidad)} ${d.unidad}`],
    ["Costo estimado", formatearMoneda(d.costoEstimado, d.moneda)],
    ["Ejecución programada", d.fechaLimite],
  ];
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Autorización de abastecimiento</title></head>
<body style="margin:0;padding:0;background:#07070A;font-family:Georgia,'Times New Roman',serif;color:#F4EFE3;">
<div style="display:none;max-height:0;overflow:hidden;">Se requiere su autorización: ${e(d.producto)} · ${e(formatearNumero(d.cantidad))} ${e(d.unidad)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#07070A;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#111118;border-radius:16px;overflow:hidden;border:1px solid #3A2F12;">
  <tr><td style="background:#0B0B12;background-image:linear-gradient(135deg,#0B0B12 0%,#14205A 55%,#3A2A08 100%);padding:24px;">
    <p style="margin:0;font-size:11px;letter-spacing:4px;color:#D9B66A;">LERMONT SIGNATURE</p>
    <p style="margin:6px 0 0;font-size:24px;letter-spacing:3px;color:#F4EFE3;font-weight:bold;">IMPERIUM</p>
    <p style="margin:4px 0 0;font-size:14px;color:#D9B66A;">Autorización de abastecimiento requerida</p>
  </td></tr>
  <tr><td style="padding:22px 24px 0;">
    <span style="display:inline-block;padding:4px 12px;border-radius:999px;background:${critico ? "#7A1C1C" : "#6B4E0E"};color:#FFF6DD;font-size:12px;font-family:Arial,sans-serif;font-weight:bold;letter-spacing:1px;">${critico ? "STOCK CRÍTICO" : "STOCK MÍNIMO"}</span>
    <p style="margin:16px 0 0;font-size:17px;">Hola ${e(d.nombreEncargado)},</p>
    <p style="margin:12px 0 0;font-size:15px;line-height:1.6;padding:14px 16px;background:#1B1709;border-left:4px solid #C9A227;border-radius:6px;color:#F4EFE3;">${e(TEXTO_OBLIGATORIO)}</p>
  </td></tr>
  <tr><td style="padding:16px 24px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:14px;font-family:Arial,sans-serif;">
      ${filas.map(([k, v]) => `<tr><td style="padding:10px 0;border-bottom:1px solid #2A2618;color:#B8AE95;width:44%;">${e(k)}</td><td style="padding:10px 0;border-bottom:1px solid #2A2618;font-weight:bold;text-align:right;color:#F4EFE3;">${e(v)}</td></tr>`).join("")}
    </table>
    ${d.justificacionIa ? `<p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:#B8AE95;font-family:Arial,sans-serif;"><strong style="color:#D9B66A;">Análisis de la IA:</strong> ${e(d.justificacionIa)}</p>` : ""}
  </td></tr>
  <tr><td align="center" style="padding:26px 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:380px;"><tr>
      <td align="center" bgcolor="#C9A227" style="border-radius:12px;background:#C9A227;background-image:linear-gradient(135deg,#F1D27A 0%,#C9A227 50%,#9C7A14 100%);">
        <a href="${e(d.urlAprobacion)}" target="_blank" rel="noopener" style="display:block;padding:16px 20px;font-size:17px;font-weight:bold;color:#0B0B0F;text-decoration:none;border-radius:12px;font-family:Arial,sans-serif;">Revisar y autorizar de forma segura</a>
      </td></tr></table>
    <p style="margin:12px 0 0;font-size:12px;color:#8C8577;line-height:1.5;font-family:Arial,sans-serif;">Deberá iniciar sesión con su cuenta. Si no autoriza antes de la fecha programada, la compra quedará bloqueada automáticamente.</p>
  </td></tr>
  <tr><td style="padding:0 24px 22px;">
    <p style="margin:0;font-size:11px;color:#6F6A5E;line-height:1.5;word-break:break-all;font-family:Arial,sans-serif;">Si el botón no funciona copie este enlace:<br>${e(d.urlAprobacion)}</p>
    <p style="margin:10px 0 0;font-size:11px;color:#6F6A5E;font-family:Arial,sans-serif;">Referencia ${e(d.controlId)} · Enlace personal e intransferible · La Firma de la Herencia</p>
  </td></tr>
</table></td></tr></table></body></html>`;
  const texto = [`Hola ${d.nombreEncargado},`, "", TEXTO_OBLIGATORIO, "", ...filas.map(([k, v]) => `${k}: ${v}`),
    d.justificacionIa ? `Análisis de la IA: ${d.justificacionIa}` : "", "", `Revisar y autorizar: ${d.urlAprobacion}`, `Referencia: ${d.controlId}`].join("\n");
  return {
    from: EMAIL_REMITENTE,
    to: [email],
    subject: paramWhatsApp(`[Autorización requerida] ${d.producto.slice(0, 60)} · ${formatearNumero(d.cantidad)} ${d.unidad}`, 140),
    html,
    text: texto,
    headers: { "X-Entity-Ref-ID": d.controlId },
    tags: [{ name: "tipo", value: "abastecimiento" }, { name: "nivel", value: critico ? "critico" : "minimo" }],
  };
}

async function cargarControl(db: SupabaseClient, controlId: string): Promise<Fila | null> {
  const { data, error } = await db.from("control_abastecimiento")
    .select(`id, empresa_id, nicho_id, producto_id, cantidad_sugerida, estado, token_verificacion,
             fecha_deteccion, fecha_ejecucion_programada, nivel_alerta, stock_en_deteccion, notificado_en, metadatos,
             producto:inventario!control_producto_tenant(sku, nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario),
             empresa:empresas(nombre, moneda, zona_horaria)`)
    .eq("id", controlId).maybeSingle();
  if (error) throw new ErrorHttp(500, "DB_ERROR", error.message);
  return data as Fila | null;
}

async function refinarConIA(c: Fila, secretoWebhook: string): Promise<void> {
  if (!IA_REFINAR || !secretoWebhook) return;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/prediccion-demanda`, {
      method: "POST",
      signal: AbortSignal.timeout(55_000),
      headers: { "Content-Type": "application/json", "x-webhook-secret": secretoWebhook },
      body: JSON.stringify({ empresa_id: c.empresa_id, nicho_id: c.nicho_id, producto_ids: [c.producto_id], aplicar_a_controles: true }),
    });
  } catch (e) {
    console.warn("IA no disponible, se conserva la cantidad base:", (e as Error).message);
  }
}

async function enviarDirecto(payload: { whatsapp_payload: unknown; email_payload: unknown; idempotency_key: string }): Promise<number> {
  let exito = false;
  if (payload.email_payload && RESEND_API_KEY) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": payload.idempotency_key },
        body: JSON.stringify(payload.email_payload),
        signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) exito = true; else console.error("Resend", r.status, await r.text());
    } catch (e) { console.error("Resend no respondió:", (e as Error).message); }
  }
  if (payload.whatsapp_payload && WHATSAPP_TOKEN && WHATSAPP_PHONE_ID) {
    try {
      const r = await fetch(`https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_ID}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload.whatsapp_payload),
        signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) exito = true; else console.error("WhatsApp", r.status, await r.text());
    } catch (e) { console.error("WhatsApp no respondió:", (e as Error).message); }
  }
  return exito ? 200 : 0;
}

async function procesar(db: SupabaseClient, controlId: string, cfg: ConfigInterna) {
  if (!cfg.secreto_firma_aprobacion || cfg.secreto_firma_aprobacion.length < 32 || !cfg.url_app?.startsWith("https://")) {
    throw new ErrorHttp(500, "CONFIGURACION_INCOMPLETA", "Faltan la firma o la URL de la app en Vault.");
  }
  const urlPagina = `${cfg.url_app.replace(/\/+$/, "")}/aprobar.html`;

  let c = await cargarControl(db, controlId);
  if (!c) throw new ErrorHttp(404, "CONTROL_NO_ENCONTRADO", "La alerta no existe.");
  if (c.estado !== "pendiente_aprobacion") return { ok: true, omitido: true, motivo: `estado_${c.estado}` };
  if (c.notificado_en) return { ok: true, omitido: true, motivo: "ya_notificado" };
  if (new Date(c.fecha_ejecucion_programada).getTime() <= Date.now()) return { ok: true, omitido: true, motivo: "ventana_expirada" };

  const { data: sus } = await db.from("suscripciones").select("planes(whatsapp)").eq("empresa_id", c.empresa_id).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const planRow: any = sus ? (Array.isArray(sus.planes) ? sus.planes[0] : sus.planes) : null;
  const whatsappPermitido = Boolean(planRow?.whatsapp);

  await refinarConIA(c, cfg.secreto_webhook_interno ?? "");
  c = (await cargarControl(db, controlId))!;

  const { data: nicho, error: eN } = await db.from("nichos").select("nombre").eq("id", c.nicho_id).single();
  if (eN) throw new ErrorHttp(500, "DB_ERROR", eN.message);

  const { data: encargados, error: eE } = await db.from("asignaciones_usuario")
    .select("id, usuario_id, nombre_mostrar, email, whatsapp_e164, nicho_id, rol")
    .eq("empresa_id", c.empresa_id).eq("activo", true).eq("recibe_alertas", true)
    .in("rol", ["encargado", "admin_empresa"])
    .or(`nicho_id.eq.${c.nicho_id},nicho_id.is.null`);
  if (eE) throw new ErrorHttp(500, "DB_ERROR", eE.message);
  const destinatarios = ((encargados ?? []) as Fila[]).filter((a) => a.email || a.whatsapp_e164);
  if (destinatarios.length === 0) throw new ErrorHttp(422, "SIN_DESTINATARIOS", "No hay encargados activos con correo o WhatsApp para este nicho.");

  const producto = Array.isArray(c.producto) ? c.producto[0] : c.producto;
  const empresa = Array.isArray(c.empresa) ? c.empresa[0] : c.empresa;
  const token = String(c.token_verificacion).toLowerCase();
  const firma = await firmarToken(token, cfg.secreto_firma_aprobacion);
  const parametroBoton = `${token}.${firma}`;
  const urlAprobacion = `${urlPagina}?a=${encodeURIComponent(parametroBoton)}`;
  const cantidad = Number(c.cantidad_sugerida);
  const enviados: Array<{ asignacion_id: string; whatsapp: boolean; email: boolean; http_status: number }> = [];

  for (const dest of destinatarios) {
    const datos: DatosMensaje = {
      nombreEncargado: dest.nombre_mostrar, producto: producto.nombre, sku: producto.sku, nicho: nicho.nombre, cantidad,
      unidad: producto.unidad_medida, stockActual: Number(producto.stock_actual), stockMinimo: Number(producto.stock_minimo),
      nivel: c.nivel_alerta, costoEstimado: Math.round(cantidad * Number(producto.costo_unitario)), moneda: empresa.moneda,
      fechaLimite: formatearFecha(c.fecha_ejecucion_programada, empresa.zona_horaria), urlAprobacion, parametroBoton,
      justificacionIa: c.metadatos?.ia_justificacion ?? null, controlId: c.id,
    };
    const canalWhatsapp = Boolean(dest.whatsapp_e164) && whatsappPermitido;
    const payload = {
      evento: "abastecimiento.pendiente_aprobacion",
      version: "1.0",
      id_evento: crypto.randomUUID(),
      idempotency_key: `${c.id}:${dest.id}`,
      emitido_en: new Date().toISOString(),
      texto_obligatorio: TEXTO_OBLIGATORIO,
      alerta: {
        control_id: c.id, empresa: { id: c.empresa_id, nombre: empresa.nombre }, nicho: { id: c.nicho_id, nombre: nicho.nombre },
        producto: { id: c.producto_id, sku: producto.sku, nombre: producto.nombre, unidad: producto.unidad_medida },
        nivel: c.nivel_alerta, cantidad_sugerida: cantidad, fuente_cantidad: c.metadatos?.fuente_cantidad ?? "regla_base",
        fecha_deteccion: c.fecha_deteccion, fecha_ejecucion_programada: c.fecha_ejecucion_programada, url_aprobacion: urlAprobacion,
      },
      destinatario: { asignacion_id: dest.id, nombre: dest.nombre_mostrar, rol: dest.rol, email: dest.email, whatsapp_e164: dest.whatsapp_e164 },
      canales: { whatsapp: canalWhatsapp, email: Boolean(dest.email) },
      whatsapp_payload: canalWhatsapp ? construirWhatsAppPayload(dest.whatsapp_e164, datos) : null,
      email_payload: dest.email ? construirEmailPayload(dest.email, datos) : null,
    };

    let status = 0;
    if (MAKE_WEBHOOK_URL) {
      try {
        const r = await fetch(MAKE_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-make-apikey": MAKE_API_KEY, "Idempotency-Key": payload.idempotency_key },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15_000),
        });
        status = r.status;
        await r.body?.cancel();
      } catch (e) { console.error("Make no respondió:", (e as Error).message); }
    } else {
      status = await enviarDirecto(payload);
    }
    enviados.push({ asignacion_id: dest.id, whatsapp: payload.canales.whatsapp, email: payload.canales.email, http_status: status });
  }

  const aceptados = enviados.filter((x) => x.http_status >= 200 && x.http_status < 300).length;
  if (aceptados > 0) {
    const { error } = await db.from("control_abastecimiento").update({ notificado_en: new Date().toISOString() }).eq("id", c.id).is("notificado_en", null);
    if (error) console.error("No se pudo marcar notificado_en:", error.message);
  }
  return { ok: aceptados > 0, control_id: c.id, canal: MAKE_WEBHOOK_URL ? "make" : "directo", destinatarios: enviados.length, envios_aceptados: aceptados, envios: enviados };
}

Deno.serve(async (req) => {
  const idSolicitud = crypto.randomUUID();
  try {
    if (req.method !== "POST") throw new ErrorHttp(405, "METODO_NO_PERMITIDO", "Use POST.");
    if (!SERVICE_KEY || !SUPABASE_URL) throw new ErrorHttp(500, "CONFIGURACION_INCOMPLETA", "Faltan secretos de la función.");
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const cfg = await obtenerConfig(db);
    if (!cfg.secreto_webhook_interno || !compararSeguro(req.headers.get("x-webhook-secret") ?? "", cfg.secreto_webhook_interno)) {
      throw new ErrorHttp(401, "NO_AUTORIZADO", "Credencial de webhook inválida.");
    }
    const cuerpo = await req.json().catch(() => null) as { control_id?: unknown } | null;
    if (!cuerpo || typeof cuerpo.control_id !== "string" || !UUID_RE.test(cuerpo.control_id)) {
      throw new ErrorHttp(400, "CONTROL_INVALIDO", "control_id debe ser un UUID.");
    }
    const controlId = cuerpo.control_id;
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
    if (runtime && new URL(req.url).searchParams.get("modo") !== "sincrono") {
      runtime.waitUntil(procesar(db, controlId, cfg).then((r) => console.log(idSolicitud, JSON.stringify(r))).catch((e) => console.error(idSolicitud, (e as Error).message)));
      return respuesta(202, { ok: true, aceptado: true, control_id: controlId, id_solicitud: idSolicitud });
    }
    const r = await procesar(db, controlId, cfg);
    return respuesta(r.ok ? 200 : 502, { ...r, id_solicitud: idSolicitud });
  } catch (e) {
    const err = e instanceof ErrorHttp ? e : new ErrorHttp(500, "ERROR_INTERNO", "Error inesperado.");
    if (!(e instanceof ErrorHttp)) console.error(idSolicitud, e);
    return respuesta(err.status, { ok: false, error: { codigo: err.codigo, mensaje: err.message, http_status: err.status, id_solicitud: idSolicitud, fecha: new Date().toISOString() } });
  }
});
