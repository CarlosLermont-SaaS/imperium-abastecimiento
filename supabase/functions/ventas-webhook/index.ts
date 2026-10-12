/**
 * =====================================================================================
 * EDGE FUNCTION · ventas-webhook
 * IMPERIUM · Activación automática de clientes al comprar o renovar
 *
 * URL que se pega en cada plataforma (la clave vive en Vault: secreto_ventas):
 *   https://<ref>.supabase.co/functions/v1/ventas-webhook?plataforma=gumroad&clave=<secreto_ventas>
 *   plataforma = gumroad | hotmart | polar | mercadopago | generica
 *
 * Qué hace:
 *   1. Verifica la clave de la URL (tiempo constante) y, si existe, la firma propia de la plataforma.
 *   2. Traduce el evento a un formato único (email, plan, estado, referencia, vencimiento).
 *   3. Registra el evento una sola vez (idempotente).
 *   4. Crea el usuario si es una compra nueva y aprovisiona empresa + suscripción + rol admin.
 *   5. Cancelaciones, reembolsos y vencimientos actualizan el estado; el acceso se bloquea solo.
 *   6. Envía el correo de bienvenida si RESEND_API_KEY está configurada.
 *
 * Secretos opcionales: HOTMART_HOTTOK, POLAR_WEBHOOK_SECRET, GUMROAD_ACCESS_TOKEN,
 *                      MP_ACCESS_TOKEN (obligatorio para Mercado Pago), RESEND_API_KEY, EMAIL_REMITENTE
 * Despliegue: verify_jwt = false (las plataformas no envían JWT de Supabase).
 * =====================================================================================
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HOTMART_HOTTOK = Deno.env.get("HOTMART_HOTTOK") ?? "";
const POLAR_WEBHOOK_SECRET = Deno.env.get("POLAR_WEBHOOK_SECRET") ?? "";
const GUMROAD_ACCESS_TOKEN = Deno.env.get("GUMROAD_ACCESS_TOKEN") ?? "";
const MP_ACCESS_TOKEN = Deno.env.get("MP_ACCESS_TOKEN") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_REMITENTE = Deno.env.get("EMAIL_REMITENTE") ?? "IMPERIUM <onboarding@resend.dev>";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PLATAFORMAS = new Set(["gumroad", "hotmart", "polar", "mercadopago", "generica"]);
const ESTADOS = new Set(["prueba", "activa", "cancelada_fin_periodo", "vencida", "reembolsada", "suspendida"]);

type Estado = "prueba" | "activa" | "cancelada_fin_periodo" | "vencida" | "reembolsada" | "suspendida";

interface Evento {
  plataforma: string;
  id_evento: string;
  tipo: string;
  email: string;
  nombre: string | null;
  empresa: string | null;
  plan: string;
  estado: Estado | null;          // null = evento que no cambia nada
  referencia: string;
  vence_en: string | null;
}

class ErrorHttp extends Error {
  constructor(public status: number, public codigo: string, mensaje: string) {
    super(mensaje);
  }
}

// ---------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------
function respuesta(status: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function compararSeguro(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

const limpiar = (v: unknown, max = 150): string => String(v ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);

function detectarPlan(...textos: unknown[]): string {
  const t = textos.map((x) => String(x ?? "").toLowerCase()).join(" ");
  if (t.includes("imperial")) return "imperial";
  if (t.includes("esencial") || t.includes("essential") || t.includes("basic") || t.includes("básico")) return "esencial";
  return "profesional";
}

function sumarDias(dias: number, desde = new Date()): string {
  const d = new Date(desde.getTime());
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString();
}

function diasPorRecurrencia(rec: string): number | null {
  switch (rec.toLowerCase()) {
    case "monthly": case "mensual": return 32;
    case "quarterly": case "trimestral": return 93;
    case "biannually": case "semestral": return 184;
    case "yearly": case "anual": case "annually": return 367;
    case "every_two_years": return 732;
    default: return null;
  }
}

async function hmacBase64(clave: Uint8Array<ArrayBuffer>, mensaje: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", clave, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(mensaje)));
  let bin = "";
  for (const b of firma) bin += String.fromCharCode(b);
  return btoa(bin);
}

// ---------------------------------------------------------------------------------
// Traductores por plataforma
// ---------------------------------------------------------------------------------
async function traducirGumroad(campos: Record<string, string>): Promise<Evento> {
  const recurso = (campos.resource_name || "sale").toLowerCase();
  const venta = campos.sale_id || "";
  const suscripcion = campos.subscription_id || "";
  if (GUMROAD_ACCESS_TOKEN && venta) {
    const r = await fetch(`https://api.gumroad.com/v2/sales/${encodeURIComponent(venta)}`, {
      headers: { Authorization: `Bearer ${GUMROAD_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(10_000),
    });
    const j = await r.json().catch(() => ({})) as { success?: boolean; sale?: { email?: string } };
    if (!j.success || (j.sale?.email && j.sale.email.toLowerCase() !== (campos.email || "").toLowerCase())) {
      throw new ErrorHttp(401, "VENTA_NO_VERIFICADA", "Gumroad no confirmó esta venta.");
    }
  }
  const variantes = Object.entries(campos).filter(([k]) => k.startsWith("variants")).map(([, v]) => v).join(" ");
  const empresaCampo = Object.entries(campos).find(([k]) => /empresa|company|negocio/i.test(k))?.[1] ?? null;
  const dias = diasPorRecurrencia(campos.recurrence || "");
  let estado: Estado | null = "activa";
  if (campos.refunded === "true" || recurso === "refund" || recurso === "dispute") estado = "reembolsada";
  else if (recurso === "cancellation" || campos.cancelled === "true") estado = "cancelada_fin_periodo";
  else if (recurso === "subscription_ended" || campos.ended === "true") estado = "vencida";
  else if (recurso === "dispute_won") estado = "activa";
  return {
    plataforma: "gumroad",
    id_evento: `${recurso}:${venta || suscripcion}:${campos.sale_timestamp || campos.ended_at || campos.cancelled_at || ""}`,
    tipo: recurso,
    email: (campos.email || campos.purchaser_email || "").toLowerCase(),
    nombre: limpiar(campos.full_name || campos.purchaser_name) || null,
    empresa: empresaCampo ? limpiar(empresaCampo) : null,
    plan: detectarPlan(variantes, campos.product_name, campos.permalink),
    estado,
    referencia: suscripcion || venta,
    vence_en: estado === "activa" && dias ? sumarDias(dias) : null,
  };
}

function traducirHotmart(cuerpo: Record<string, unknown>, cabeceras: Headers): Evento {
  if (HOTMART_HOTTOK) {
    const recibido = cabeceras.get("x-hotmart-hottok") ?? String((cuerpo as { hottok?: string }).hottok ?? "");
    if (!compararSeguro(recibido, HOTMART_HOTTOK)) throw new ErrorHttp(401, "HOTTOK_INVALIDO", "Hottok de Hotmart inválido.");
  }
  // deno-lint-ignore no-explicit-any
  const d = (cuerpo.data ?? {}) as any;
  const evento = String(cuerpo.event ?? "").toUpperCase();
  const mapa: Record<string, Estado | null> = {
    PURCHASE_APPROVED: "activa", PURCHASE_COMPLETE: "activa", SWITCH_PLAN: "activa",
    PURCHASE_REFUNDED: "reembolsada", PURCHASE_CHARGEBACK: "reembolsada",
    PURCHASE_CANCELED: "suspendida", PURCHASE_EXPIRED: "suspendida", PURCHASE_PROTEST: "suspendida", PURCHASE_DELAYED: "suspendida",
    SUBSCRIPTION_CANCELLATION: "cancelada_fin_periodo",
  };
  const estado = evento in mapa ? mapa[evento] : null;
  return {
    plataforma: "hotmart",
    id_evento: String(cuerpo.id ?? `${evento}:${d?.purchase?.transaction ?? ""}`),
    tipo: evento,
    email: String(d?.buyer?.email ?? d?.subscriber?.email ?? "").toLowerCase(),
    nombre: limpiar(d?.buyer?.name ?? d?.subscriber?.name) || null,
    empresa: null,
    plan: detectarPlan(d?.subscription?.plan?.name, d?.product?.name, d?.plan?.name),
    estado,
    referencia: String(d?.subscription?.subscriber?.code ?? d?.subscriber?.code ?? d?.purchase?.transaction ?? ""),
    vence_en: estado === "activa" ? sumarDias(32) : null,
  };
}

async function traducirPolar(texto: string, cabeceras: Headers): Promise<Evento> {
  if (POLAR_WEBHOOK_SECRET) {
    const id = cabeceras.get("webhook-id") ?? "";
    const ts = cabeceras.get("webhook-timestamp") ?? "";
    const firmas = (cabeceras.get("webhook-signature") ?? "").split(" ").map((f) => f.split(",")[1] ?? "");
    if (!id || !ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) throw new ErrorHttp(401, "FIRMA_POLAR_INVALIDA", "Evento de Polar vencido o incompleto.");
    const clave = POLAR_WEBHOOK_SECRET.startsWith("whsec_")
      ? Uint8Array.from(atob(POLAR_WEBHOOK_SECRET.slice(6)), (c) => c.charCodeAt(0))
      : new Uint8Array(new TextEncoder().encode(POLAR_WEBHOOK_SECRET));
    const esperada = await hmacBase64(clave, `${id}.${ts}.${texto}`);
    if (!firmas.some((f) => compararSeguro(f, esperada))) throw new ErrorHttp(401, "FIRMA_POLAR_INVALIDA", "Firma de Polar inválida.");
  }
  // deno-lint-ignore no-explicit-any
  const cuerpo = JSON.parse(texto) as any;
  const tipo = String(cuerpo.type ?? "");
  const d = cuerpo.data ?? {};
  let estado: Estado | null = null;
  if (tipo === "order.refunded") estado = "reembolsada";
  else if (tipo === "subscription.revoked") estado = "vencida";
  else if (tipo.startsWith("subscription.")) {
    const st = String(d.status ?? "");
    if (st === "trialing") estado = "prueba";
    else if (st === "active") estado = d.cancel_at_period_end ? "cancelada_fin_periodo" : "activa";
    else if (st === "canceled") estado = "cancelada_fin_periodo";
    else if (st === "past_due" || st === "unpaid") estado = "suspendida";
  }
  const fin = d.current_period_end ? new Date(new Date(d.current_period_end).getTime() + 3 * 864e5).toISOString() : null;
  return {
    plataforma: "polar",
    id_evento: cabeceras.get("webhook-id") ?? `${tipo}:${d.id ?? ""}:${d.modified_at ?? ""}`,
    tipo,
    email: String(d.customer?.email ?? d.user?.email ?? "").toLowerCase(),
    nombre: limpiar(d.customer?.name) || null,
    empresa: d.metadata?.empresa ? limpiar(d.metadata.empresa) : null,
    plan: detectarPlan(d.product?.name, d.metadata?.plan),
    estado,
    referencia: String(tipo === "order.refunded" ? (d.subscription_id ?? d.id) : d.id ?? ""),
    vence_en: fin,
  };
}

async function traducirMercadoPago(cuerpo: Record<string, unknown>, url: URL): Promise<Evento> {
  if (!MP_ACCESS_TOKEN) throw new ErrorHttp(500, "CONFIGURACION_INCOMPLETA", "Falta MP_ACCESS_TOKEN.");
  // deno-lint-ignore no-explicit-any
  const c = cuerpo as any;
  const tipo = String(c.type ?? c.topic ?? url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "");
  const id = String(c.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "");
  if (!/preapproval/.test(tipo) || !/^[A-Za-z0-9-]{4,80}$/.test(id)) {
    return { plataforma: "mercadopago", id_evento: `ignorado:${tipo}:${id}`, tipo, email: "", nombre: null, empresa: null, plan: "profesional", estado: null, referencia: id, vence_en: null };
  }
  const r = await fetch(`https://api.mercadopago.com/preapproval/${id}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new ErrorHttp(502, "MP_NO_DISPONIBLE", `Mercado Pago respondió ${r.status}.`);
  // deno-lint-ignore no-explicit-any
  const p = await r.json() as any;
  const st = String(p.status ?? "");
  const estado: Estado | null = st === "authorized" ? "activa" : st === "paused" ? "suspendida" : st === "cancelled" ? "cancelada_fin_periodo" : null;
  const proximo = p.next_payment_date ? new Date(new Date(p.next_payment_date).getTime() + 3 * 864e5).toISOString() : null;
  return {
    plataforma: "mercadopago",
    id_evento: `preapproval:${id}:${st}:${p.last_modified ?? ""}`,
    tipo: `preapproval.${st}`,
    email: String(p.payer_email ?? "").toLowerCase(),
    nombre: null,
    empresa: null,
    plan: detectarPlan(p.reason, p.external_reference),
    estado,
    referencia: id,
    vence_en: estado === "activa" ? proximo : null,
  };
}

function traducirGenerica(c: Record<string, unknown>): Evento {
  const estado = String(c.estado ?? "activa");
  if (!ESTADOS.has(estado)) throw new ErrorHttp(400, "ESTADO_INVALIDO", "estado no reconocido.");
  return {
    plataforma: "generica",
    id_evento: limpiar(c.id_evento, 120) || crypto.randomUUID(),
    tipo: limpiar(c.tipo ?? "generica", 60),
    email: String(c.email ?? "").toLowerCase(),
    nombre: limpiar(c.nombre) || null,
    empresa: limpiar(c.empresa) || null,
    plan: detectarPlan(c.plan),
    estado: estado as Estado,
    referencia: limpiar(c.referencia, 120) || String(c.email ?? ""),
    vence_en: typeof c.vence_en === "string" && !Number.isNaN(Date.parse(c.vence_en)) ? new Date(c.vence_en).toISOString() : null,
  };
}

// ---------------------------------------------------------------------------------
// Correo de bienvenida
// ---------------------------------------------------------------------------------
async function enviarBienvenida(ev: Evento, urlApp: string | null) {
  if (!RESEND_API_KEY || !urlApp) return;
  const e = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const plan = ev.plan.charAt(0).toUpperCase() + ev.plan.slice(1);
  const html = `<!DOCTYPE html><html lang="es"><body style="margin:0;background:#0B0B0F;font-family:Georgia,'Times New Roman',serif;color:#F4EFE3">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" style="max-width:540px;background:#14141B;border:1px solid #C9A227;border-radius:14px">
<tr><td style="padding:28px 26px;text-align:center">
<p style="margin:0;letter-spacing:4px;font-size:12px;color:#C9A227">LERMONT SIGNATURE</p>
<h1 style="margin:10px 0 0;font-size:26px;letter-spacing:3px;color:#F4EFE3">IMPERIUM</h1>
<p style="margin:6px 0 0;font-size:14px;color:#D9B66A">Abastecimiento Inteligente</p>
<p style="margin:22px 0 0;font-size:16px;line-height:1.6">Bienvenido${ev.nombre ? `, ${e(ev.nombre)}` : ""}. Tu plan <strong>${e(plan)}</strong> ya está activo.</p>
<p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:#CFC8B8">Entra con este mismo correo (${e(ev.email)}). Te enviaremos un código de acceso; no necesitas contraseña.</p>
<a href="${e(urlApp)}" style="display:inline-block;margin-top:22px;padding:15px 26px;border-radius:10px;background:#C9A227;color:#0B0B0F;font-weight:bold;text-decoration:none;font-family:Arial,sans-serif">Entrar a IMPERIUM</a>
<p style="margin:22px 0 0;font-size:12px;color:#8C8577">La Firma de la Herencia · Soporte: lermontsignature.oficial@gmail.com</p>
</td></tr></table></td></tr></table></body></html>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `bienvenida:${ev.plataforma}:${ev.referencia}` },
    body: JSON.stringify({ from: EMAIL_REMITENTE, to: [ev.email], subject: "Tu acceso a IMPERIUM está listo", html }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err) => console.error("Bienvenida no enviada:", (err as Error).message));
}

// ---------------------------------------------------------------------------------
// Proceso principal
// ---------------------------------------------------------------------------------
async function procesar(db: SupabaseClient, ev: Evento, cruda: unknown, urlApp: string | null) {
  const { error: eDup } = await db.from("eventos_pago").insert({
    plataforma: ev.plataforma, id_evento: ev.id_evento.slice(0, 200), tipo_evento: ev.tipo.slice(0, 80),
    email: ev.email || null, referencia: ev.referencia || null, payload: cruda,
  });
  if (eDup) {
    if (eDup.code === "23505") return { ok: true, resultado: "duplicado" };
    throw new ErrorHttp(500, "DB_ERROR", eDup.message);
  }
  const marcar = (resultado: string, error: string | null = null) =>
    db.from("eventos_pago").update({ resultado, error }).eq("plataforma", ev.plataforma).eq("id_evento", ev.id_evento.slice(0, 200));

  if (!ev.estado) { await marcar("ignorado_sin_cambio"); return { ok: true, resultado: "ignorado" }; }
  if (!EMAIL_RE.test(ev.email) || !ev.referencia) { await marcar("ignorado", "sin email o referencia"); return { ok: true, resultado: "ignorado" }; }

  const { data: existente, error: eU } = await db.rpc("usuario_por_email", { p_email: ev.email });
  if (eU) throw new ErrorHttp(500, "DB_ERROR", eU.message);
  let usuarioId = existente as string | null;

  if (!usuarioId) {
    if (ev.estado !== "activa" && ev.estado !== "prueba") { await marcar("ignorado", "usuario inexistente"); return { ok: true, resultado: "ignorado" }; }
    const { data: creado, error: eC } = await db.auth.admin.createUser({
      email: ev.email, email_confirm: true, user_metadata: { nombre: ev.nombre, origen: ev.plataforma },
    });
    if (eC || !creado?.user) throw new ErrorHttp(500, "USUARIO_NO_CREADO", eC?.message ?? "No se pudo crear el usuario.");
    usuarioId = creado.user.id;
  }

  const { data: r, error: eP } = await db.rpc("provisionar_cliente", {
    p_usuario_id: usuarioId, p_email: ev.email, p_nombre: ev.nombre, p_empresa: ev.empresa, p_plan: ev.plan,
    p_plataforma: ev.plataforma, p_referencia: ev.referencia, p_estado: ev.estado, p_vence_en: ev.vence_en,
  });
  if (eP) { await marcar("error", eP.message); throw new ErrorHttp(500, "APROVISIONAMIENTO", eP.message); }
  const res = r as { accion: string; empresa_id?: string };
  await marcar(res.accion);
  if (res.accion === "creada") await enviarBienvenida(ev, urlApp);
  return { ok: true, resultado: res.accion, empresa_id: res.empresa_id ?? null };
}

// ---------------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------------
Deno.serve(async (req) => {
  const idSolicitud = crypto.randomUUID();
  try {
    if (req.method !== "POST") throw new ErrorHttp(405, "METODO_NO_PERMITIDO", "Use POST.");
    if (!SUPABASE_URL || !SERVICE_KEY) throw new ErrorHttp(500, "CONFIGURACION_INCOMPLETA", "Faltan secretos de la función.");
    const url = new URL(req.url);
    const plataforma = (url.searchParams.get("plataforma") ?? "").toLowerCase();
    if (!PLATAFORMAS.has(plataforma)) throw new ErrorHttp(400, "PLATAFORMA_INVALIDA", "Use plataforma=gumroad|hotmart|polar|mercadopago|generica.");

    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: cfg, error: eCfg } = await db.rpc("config_interna");
    if (eCfg || !cfg?.secreto_ventas) throw new ErrorHttp(500, "CONFIGURACION_INCOMPLETA", "Falta secreto_ventas en Vault.");
    if (!compararSeguro(url.searchParams.get("clave") ?? "", cfg.secreto_ventas)) throw new ErrorHttp(401, "NO_AUTORIZADO", "Clave de webhook inválida.");

    if (Number(req.headers.get("content-length") ?? "0") > 256_000) throw new ErrorHttp(413, "CUERPO_DEMASIADO_GRANDE", "Máximo 256 KB.");
    const texto = await req.text();
    const tipoContenido = req.headers.get("content-type") ?? "";
    let cruda: Record<string, unknown> = {};
    if (tipoContenido.includes("application/x-www-form-urlencoded")) {
      cruda = Object.fromEntries(new URLSearchParams(texto));
    } else if (texto.trim()) {
      try { cruda = JSON.parse(texto); } catch { throw new ErrorHttp(400, "CUERPO_INVALIDO", "JSON inválido."); }
    }

    let ev: Evento;
    switch (plataforma) {
      case "gumroad": ev = await traducirGumroad(cruda as Record<string, string>); break;
      case "hotmart": ev = traducirHotmart(cruda, req.headers); break;
      case "polar": ev = await traducirPolar(texto, req.headers); break;
      case "mercadopago": ev = await traducirMercadoPago(cruda, url); break;
      default: ev = traducirGenerica(cruda);
    }
    // Nunca se guarda un token de verificación de la plataforma dentro del evento
    const segura = { ...cruda };
    delete (segura as { hottok?: unknown }).hottok;
    const r = await procesar(db, ev, segura, cfg.url_app ?? null);
    return respuesta(200, { ...r, id_solicitud: idSolicitud });
  } catch (e) {
    const err = e instanceof ErrorHttp ? e : new ErrorHttp(500, "ERROR_INTERNO", "Error inesperado.");
    if (!(e instanceof ErrorHttp)) console.error(idSolicitud, e);
    return respuesta(err.status, { ok: false, error: { codigo: err.codigo, mensaje: err.message, id_solicitud: idSolicitud } });
  }
});
