// =====================================================================
// IMPERIUM · Página de aprobación desde WhatsApp o correo
// El enlace trae ?a=<token>.<firma>. El encargado inicia sesión con un código
// al correo; la función autorizar-abastecimiento valida sesión, firma, RLS y plazo.
// =====================================================================
import { CONFIG } from "./config.js";
import { supabase, h, num, dinero, fecha, restante, formularioAcceso, monograma } from "./comun.js";

const FUNCION = `${CONFIG.SUPABASE_URL}/functions/v1/autorizar-abastecimiento`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIRMA_RE = /^[A-Za-z0-9_-]{43}$/;

const zona = document.getElementById("zona");
const estadoEl = document.getElementById("estado");
document.getElementById("encabezado").prepend(monograma("monograma-grande"));
const avisar = (tipo, t) => { estadoEl.className = `mensaje ${tipo}`; estadoEl.textContent = t; };

const [token, firma] = (new URLSearchParams(location.search).get("a") ?? "").split(".");
if (!UUID_RE.test(token ?? "") || !FIRMA_RE.test(firma ?? "")) {
  avisar("error", "El enlace está incompleto o fue alterado. Ábralo directamente desde el WhatsApp o el correo que recibió.");
} else {
  iniciar();
}

async function iniciar() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return cargar();
  formularioAcceso(zona, cargar, "Ingrese el correo con el que está registrado como encargado");
}

async function llamar(accion, extra = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { formularioAcceso(zona, cargar); throw new Error("sin_sesion"); }
  const r = await fetch(FUNCION, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, apikey: CONFIG.SUPABASE_KEY },
    body: JSON.stringify({ accion, token_verificacion: token, firma, id_usuario: session.user.id, ...extra }),
  });
  const cuerpo = await r.json().catch(() => ({ ok: false, error: { mensaje: "Respuesta inválida del servidor." } }));
  if (r.status === 401) { await supabase.auth.signOut(); formularioAcceso(zona, cargar); }
  return cuerpo;
}

async function cargar() {
  estadoEl.className = "oculto";
  zona.replaceChildren(h("p", { class: "tenue" }, "Cargando la solicitud…"));
  const r = await llamar("consultar").catch(() => null);
  if (!r?.ok) { zona.replaceChildren(); return avisar("error", r?.error?.mensaje ?? "No fue posible cargar la solicitud."); }
  const s = r.solicitud;
  const p = Array.isArray(s.producto) ? s.producto[0] : s.producto;
  const nicho = Array.isArray(p?.nicho) ? p.nicho[0] : p?.nicho;
  const verificado = h("input", { type: "checkbox", id: "verificado" });
  const motivo = h("textarea", { id: "motivo", maxlength: "300", placeholder: "Ej: hay mercancía en bodega 2" });
  const sello = h("button", { class: "sello", disabled: true, onclick: async () => {
    if (!confirm("¿Confirma la autorización? La compra se ejecutará en la fecha programada.")) return;
    sello.disabled = true;
    const x = await llamar("autorizar").catch(() => null);
    if (x?.ok) { decision.classList.add("oculto"); avisar("ok", x.mensaje ?? "Autorización registrada."); }
    else { sello.disabled = false; avisar("error", x?.error?.mensaje ?? "No se pudo autorizar."); }
  } }, "Firmar y autorizar");
  verificado.addEventListener("change", () => { sello.disabled = !verificado.checked; });

  const decision = h("div", {},
    h("label", { class: "check" }, verificado, "Verifiqué que lo solicitado es lo que realmente falta."),
    h("div", { style: "margin-top:14px" }, sello),
    h("p", { class: "tenue", style: "text-align:center;margin-top:8px" }, restante(s.fecha_ejecucion_programada)),
    h("label", { for: "motivo" }, "¿No corresponde? Indique el motivo (opcional)"), motivo,
    h("button", { class: "boton peligro ancho", style: "margin-top:12px", onclick: async (ev) => {
      if (!confirm("¿Rechazar esta solicitud? La compra quedará cancelada.")) return;
      ev.target.disabled = true;
      const x = await llamar("rechazar", { motivo: motivo.value.trim().slice(0, 300) }).catch(() => null);
      ev.target.disabled = false;
      if (x?.ok) { decision.classList.add("oculto"); avisar("ok", "Solicitud rechazada. No se realizará la compra."); }
      else avisar("error", x?.error?.mensaje ?? "No se pudo rechazar.");
    } }, "Rechazar solicitud"));

  zona.replaceChildren(
    h("span", { class: `chip ${s.nivel_alerta === "critico" ? "rubi" : "oro"}` }, s.nivel_alerta === "critico" ? "Stock crítico" : "Stock mínimo"),
    h("dl", { class: "datos num" },
      h("dt", {}, "Producto"), h("dd", {}, p?.nombre ?? "—"),
      h("dt", {}, "SKU"), h("dd", {}, p?.sku ?? "—"),
      h("dt", {}, "Nicho"), h("dd", {}, nicho?.nombre ?? "—"),
      h("dt", {}, "Stock actual / mínimo"), h("dd", {}, `${num(p?.stock_actual)} / ${num(p?.stock_minimo)} ${p?.unidad_medida ?? ""}`),
      h("dt", {}, "Cantidad sugerida"), h("dd", {}, `${num(s.cantidad_sugerida)} ${p?.unidad_medida ?? ""}`),
      h("dt", {}, "Costo estimado"), h("dd", {}, dinero(Number(s.cantidad_sugerida) * Number(p?.costo_unitario ?? 0))),
      h("dt", {}, "Ejecución programada"), h("dd", {}, fecha(s.fecha_ejecucion_programada))),
    s.ia_justificacion ? h("p", { class: "suave" }, h("strong", { class: "dorado" }, "Análisis de la IA: "), s.ia_justificacion) : null,
    s.vigente && s.puede_decidir ? decision : null);

  if (!s.puede_decidir) avisar("info", "Su rol permite consultar, pero no firmar esta compra.");
  else if (s.estado === "autorizado") avisar("ok", `Ya fue autorizada. Se ejecutará el ${fecha(s.fecha_ejecucion_programada)}.`);
  else if (!s.vigente) avisar("error", `Esta solicitud ya no admite cambios (estado: ${String(s.estado).replace("_", " ")}).`);
}
