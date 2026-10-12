// =====================================================================
// IMPERIUM · Utilidades compartidas (cliente Supabase, acceso, DOM seguro)
// Todo el texto dinámico se inserta con textContent: no hay innerHTML con datos.
// =====================================================================
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { CONFIG } from "./config.js";

let almacen;
try { localStorage.setItem("_p", "1"); localStorage.removeItem("_p"); almacen = localStorage; } catch { almacen = undefined; }

export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, {
  auth: { persistSession: Boolean(almacen), storage: almacen, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Crea un elemento: h("div", { class: "x", onclick: fn }, "texto", hijo) */
export function h(etiqueta, atributos = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(atributos ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return el;
}

/** SVG seguro desde una plantilla fija (sin datos del usuario). */
export function icono(nombre) {
  const trazos = {
    panel: "M4 13h6V4H4v9Zm10 7h6V11h-6v9ZM4 20h6v-5H4v5Zm10-11h6V4h-6v5Z",
    inventario: "M3 7l9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4",
    alertas: "M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6Zm-2 16a2 2 0 0 0 4 0",
    ordenes: "M6 3h9l4 4v14H6V3Zm9 0v4h4M9 12h7M9 16h7",
    mas: "M5 12h.01M12 12h.01M19 12h.01",
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", nombre === "mas" ? "3" : "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", trazos[nombre] ?? "");
  svg.append(p);
  return svg;
}

export const num = (v, dec = 3) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: dec }).format(Number(v ?? 0));
export const dinero = (v, moneda = "COP") =>
  new Intl.NumberFormat("es-CO", { style: "currency", currency: moneda, maximumFractionDigits: 0 }).format(Number(v ?? 0));
export const fecha = (iso, conHora = true) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", ...(conHora ? { timeStyle: "short" } : {}) }).format(new Date(iso));

export function restante(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "plazo vencido";
  const d = Math.floor(ms / 864e5), hh = Math.floor(ms / 36e5) % 24;
  return d > 0 ? `${d} d ${hh} h para decidir` : `${hh} h para decidir`;
}

export function toast(texto) {
  document.querySelector(".toast")?.remove();
  const t = h("div", { class: "toast", role: "status" }, texto);
  document.body.append(t);
  setTimeout(() => t.remove(), 3800);
}

/** Traduce errores de PostgreSQL a mensajes legibles. */
export function mensajeError(e) {
  const m = String(e?.message ?? e ?? "Error desconocido");
  if (m.includes("LIMITE_PLAN")) return m.replace(/^.*LIMITE_PLAN:\s*/, "");
  if (m.includes("ATRIBUTO_REQUERIDO")) return m.replace(/^.*ATRIBUTO_REQUERIDO:\s*/, "Falta un dato del nicho: ");
  if (m.includes("ATRIBUTO_TIPO")) return m.replace(/^.*ATRIBUTO_TIPO:\s*/, "Dato con formato incorrecto: ");
  if (m.includes("STOCK_INSUFICIENTE")) return "No hay stock suficiente para registrar esa salida.";
  if (m.includes("duplicate key") && m.includes("sku")) return "Ya existe un producto con ese SKU.";
  if (m.includes("duplicate key")) return "Ese registro ya existe.";
  if (m.includes("row-level security")) return "Su rol no permite esta acción o su plan no está activo.";
  if (m.includes("inventario_minimo_vs_critico")) return "El stock mínimo debe ser mayor o igual al crítico.";
  if (m.includes("inventario_maximo_vs_minimo")) return "El stock máximo debe ser mayor o igual al mínimo.";
  if (m.includes("sku")) return "El SKU solo admite letras, números, punto, guion y guion bajo.";
  if (m.includes("whatsapp_e164")) return "Escriba el WhatsApp en formato internacional, ej: +573001234567.";
  return m.replace(/^[A-Z_]+:\s*/, "");
}

// ---------------- Acceso por código al correo ----------------
export async function enviarCodigo(correo) {
  const { error } = await supabase.auth.signInWithOtp({ email: correo, options: { shouldCreateUser: false, emailRedirectTo: new URL("app.html", location.href).href } });
  if (error) throw new Error(error.status === 429 ? "Demasiados intentos. Espere un minuto e intente de nuevo." : "No se pudo enviar el código. Verifique que su correo tenga una cuenta activa.");
}

export async function verificarCodigo(correo, codigo) {
  const { error } = await supabase.auth.verifyOtp({ email: correo, token: codigo, type: "email" });
  if (error) throw new Error("Código incorrecto o vencido. Pida uno nuevo.");
}

/** Pinta el formulario de acceso dentro de `contenedor` y llama a `alEntrar` al iniciar sesión. */
export function formularioAcceso(contenedor, alEntrar, subtitulo = "Ingrese el correo con el que compró o fue invitado") {
  const estado = h("div", { class: "oculto", role: "status", "aria-live": "polite" });
  const avisar = (tipo, t) => { estado.className = `mensaje ${tipo}`; estado.textContent = t; };
  const correo = h("input", { type: "email", id: "correo", autocomplete: "email", inputmode: "email", maxlength: "160", placeholder: "nombre@empresa.com" });
  const codigo = h("input", { id: "codigo", inputmode: "numeric", autocomplete: "one-time-code", maxlength: "10", placeholder: "Código de 6 dígitos" });
  const pasoCodigo = h("div", { class: "oculto" },
    h("label", { for: "codigo" }, "Escriba el código que llegó a su correo"), codigo,
    h("button", { class: "boton oro ancho", style: "margin-top:14px", onclick: async (ev) => {
      const c = codigo.value.replace(/\D/g, "");
      if (c.length < 6) return avisar("error", "El código tiene al menos 6 dígitos.");
      ev.target.disabled = true;
      try { await verificarCodigo(correo.value.trim().toLowerCase(), c); alEntrar(); }
      catch (e) { avisar("error", e.message); }
      finally { ev.target.disabled = false; }
    } }, "Entrar"),
    h("button", { class: "boton ancho", style: "margin-top:10px", onclick: () => { pasoCodigo.classList.add("oculto"); pasoCorreo.classList.remove("oculto"); } }, "Usar otro correo"),
  );
  const pasoCorreo = h("div", {},
    h("label", { for: "correo" }, subtitulo), correo,
    h("button", { class: "boton oro ancho", style: "margin-top:14px", onclick: async (ev) => {
      const v = correo.value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return avisar("error", "Escriba un correo válido.");
      ev.target.disabled = true;
      try { await enviarCodigo(v); avisar("info", "Le enviamos un código. Revise también la carpeta de spam."); pasoCorreo.classList.add("oculto"); pasoCodigo.classList.remove("oculto"); codigo.focus(); }
      catch (e) { avisar("error", e.message); }
      finally { ev.target.disabled = false; }
    } }, "Enviarme un código"),
  );
  contenedor.replaceChildren(pasoCorreo, pasoCodigo, estado);
}

/** Monograma imperial (marca original de IMPERIUM). */
export function monograma(clase = "monograma") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 64 64");
  svg.setAttribute("class", clase);
  svg.setAttribute("aria-hidden", "true");
  const ns = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(ns, "defs");
  const g = document.createElementNS(ns, "linearGradient");
  g.setAttribute("id", "oroMono"); g.setAttribute("x1", "0"); g.setAttribute("y1", "0"); g.setAttribute("x2", "1"); g.setAttribute("y2", "1");
  for (const [o, c] of [["0", "#F6E3A6"], ["0.5", "#C9A227"], ["1", "#7A5A0C"]]) {
    const s = document.createElementNS(ns, "stop"); s.setAttribute("offset", o); s.setAttribute("stop-color", c); g.append(s);
  }
  defs.append(g); svg.append(defs);
  const circulo = document.createElementNS(ns, "circle");
  circulo.setAttribute("cx", "32"); circulo.setAttribute("cy", "32"); circulo.setAttribute("r", "29");
  circulo.setAttribute("fill", "none"); circulo.setAttribute("stroke", "url(#oroMono)"); circulo.setAttribute("stroke-width", "2.5");
  const interior = document.createElementNS(ns, "circle");
  interior.setAttribute("cx", "32"); interior.setAttribute("cy", "32"); interior.setAttribute("r", "23");
  interior.setAttribute("fill", "none"); interior.setAttribute("stroke", "url(#oroMono)"); interior.setAttribute("stroke-width", "0.8"); interior.setAttribute("stroke-dasharray", "1.5 3");
  const letra = document.createElementNS(ns, "path");
  letra.setAttribute("d", "M24 19h16M24 45h16M32 19v26M27 19l-3-4M37 19l3-4M32 13v3");
  letra.setAttribute("stroke", "url(#oroMono)"); letra.setAttribute("stroke-width", "3"); letra.setAttribute("stroke-linecap", "round"); letra.setAttribute("fill", "none");
  svg.append(circulo, interior, letra);
  return svg;
}
