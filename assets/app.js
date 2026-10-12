// =====================================================================
// IMPERIUM · Aplicación (SPA sin compilación, segura por RLS)
// Vistas: Panel · Inventario · Alertas · Órdenes · Más
// =====================================================================
import { CONFIG } from "./config.js";
import { supabase, h, icono, num, dinero, fecha, restante, toast, mensajeError, formularioAcceso, monograma } from "./comun.js";

const estado = { sesion: null, cuentas: [], cuenta: null, nichos: [], proveedores: [], pendientes: 0 };
const raiz = document.getElementById("app");

const esAdmin = () => estado.cuenta?.rol === "admin_empresa";
const puedeEditar = () => ["admin_empresa", "encargado"].includes(estado.cuenta?.rol);
const moneda = () => estado.cuenta?.moneda ?? "COP";
const empresaId = () => estado.cuenta?.empresa_id;
const nombreNicho = (id) => estado.nichos.find((n) => n.id === id)?.nombre ?? "—";
const nivelDe = (p) => Number(p.stock_actual) <= Number(p.stock_critico) ? "critico" : Number(p.stock_actual) <= Number(p.stock_minimo) ? "minimo" : "ok";

function guardarPreferencia(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }
function leerPreferencia(k) { try { return localStorage.getItem(k); } catch { return null; } }

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
async function iniciar() {
  const { data } = await supabase.auth.getSession();
  estado.sesion = data.session;
  if (!estado.sesion) return pantallaAcceso();
  await cargarCuenta();
}

supabase.auth.onAuthStateChange((evento, sesion) => {
  if (evento === "SIGNED_OUT") { estado.sesion = null; pantallaAcceso(); }
  if (evento === "SIGNED_IN" && !estado.sesion) { estado.sesion = sesion; cargarCuenta(); }
});

function pantallaAcceso() {
  document.body.classList.remove("con-app");
  const zona = h("div");
  raiz.replaceChildren(
    h("div", { class: "acceso" },
      h("div", { class: "panel" },
        h("div", { class: "encabezado" }, monograma("monograma-grande"), h("div", { class: "marca dorado" }, "IMPERIUM"),
          h("p", {}, "Abastecimiento inteligente con autorización humana")),
        zona,
        h("p", { class: "tenue", style: "margin-top:18px;font-size:.95rem;text-align:center" }, "¿Aún no tiene cuenta? ", h("a", { href: "./#planes" }, "Vea los planes")))));
  formularioAcceso(zona, () => cargarCuenta());
}

async function cargarCuenta() {
  const { data, error } = await supabase.rpc("estado_cuenta");
  if (error) { toast(mensajeError(error)); return pantallaAcceso(); }
  estado.cuentas = data ?? [];
  if (estado.cuentas.length === 0) return pantallaSinCuenta();
  const preferida = leerPreferencia("imperium_empresa");
  estado.cuenta = estado.cuentas.find((c) => c.empresa_id === preferida) ?? estado.cuentas[0];
  await cargarCatalogos();
  armarMarco();
  enrutar();
}

async function cargarCatalogos() {
  const [n, p, c] = await Promise.all([
    supabase.from("nichos").select("*").eq("empresa_id", empresaId()).eq("activo", true).order("nombre"),
    supabase.from("proveedores").select("*").eq("empresa_id", empresaId()).eq("activo", true).order("nombre"),
    supabase.from("control_abastecimiento").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId()).eq("estado", "pendiente_aprobacion"),
  ]);
  estado.nichos = n.data ?? [];
  estado.proveedores = p.data ?? [];
  estado.pendientes = c.count ?? 0;
}

function pantallaSinCuenta() {
  document.body.classList.remove("con-app");
  raiz.replaceChildren(h("div", { class: "acceso" }, h("div", { class: "panel pila" },
    h("div", { class: "encabezado" }, monograma("monograma-grande"), h("div", { class: "marca dorado" }, "IMPERIUM")),
    h("p", {}, "Su correo no tiene una empresa activa en IMPERIUM."),
    h("p", { class: "suave" }, "Si acaba de comprar, espere un minuto y vuelva a entrar. Si fue invitado, pida a su administrador que revise el correo con el que lo agregó."),
    h("a", { class: "boton oro ancho", href: "./#planes" }, "Ver planes"),
    h("button", { class: "boton ancho", onclick: () => supabase.auth.signOut() }, "Cerrar sesión"))));
}

// ---------------------------------------------------------------------
// Marco: cabecera + navegación
// ---------------------------------------------------------------------
const RUTAS = [
  { id: "panel", nombre: "Panel" },
  { id: "inventario", nombre: "Inventario" },
  { id: "alertas", nombre: "Alertas" },
  { id: "ordenes", nombre: "Órdenes" },
  { id: "mas", nombre: "Más" },
];

function armarMarco() {
  document.body.classList.add("con-app");
  const c = estado.cuenta;
  const selector = estado.cuentas.length > 1
    ? h("select", { "aria-label": "Empresa", style: "width:auto;padding:6px 10px;font-size:.95rem", onchange: async (e) => {
        estado.cuenta = estado.cuentas.find((x) => x.empresa_id === e.target.value);
        guardarPreferencia("imperium_empresa", estado.cuenta.empresa_id);
        await cargarCatalogos(); armarMarco(); enrutar();
      } }, ...estado.cuentas.map((x) => h("option", { value: x.empresa_id, selected: x.empresa_id === c.empresa_id }, x.empresa)))
    : h("span", { class: "empresa" }, c.empresa);
  const rol = { admin_empresa: "Administrador", encargado: "Encargado", lector: "Lector" }[c.rol];
  raiz.replaceChildren(
    h("header", { class: "cabecera" }, h("div", { class: "contenedor entre" },
      h("div", { style: "display:flex;align-items:center;gap:10px" }, monograma(), h("div", {}, h("div", { class: "marca dorado" }, "IMPERIUM"), selector)),
      h("span", { class: "chip" }, rol))),
    h("nav", { class: "tabs", "aria-label": "Secciones" }, ...RUTAS.map((r) => h("a", { href: `#/${r.id}`, "data-ruta": r.id },
      icono(r.id), r.nombre, r.id === "alertas" && estado.pendientes > 0 ? h("span", { class: "punto" }, String(estado.pendientes)) : null))),
    h("main", { class: "vista contenedor", id: "vista", tabindex: "-1" }));
}

window.addEventListener("hashchange", () => estado.cuenta && enrutar());
document.addEventListener("visibilitychange", () => { if (!document.hidden && estado.cuenta) enrutar(); });

async function enrutar() {
  cerrarHoja();
  const ruta = (location.hash.replace(/^#\/?/, "") || "panel").split("/")[0];
  document.querySelectorAll(".tabs a").forEach((a) => { if (a.dataset.ruta === ruta) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  const vista = document.getElementById("vista");
  if (!vista) return;
  vista.replaceChildren(h("p", { class: "tenue" }, "Cargando…"));
  const pintar = { panel: vistaPanel, inventario: vistaInventario, alertas: vistaAlertas, ordenes: vistaOrdenes, mas: vistaMas }[ruta] ?? vistaPanel;
  try { await pintar(vista); } catch (e) { vista.replaceChildren(h("div", { class: "mensaje error" }, mensajeError(e))); }
}

function bannerSuscripcion() {
  const c = estado.cuenta;
  if (c.vigente) return null;
  return h("div", { class: "mensaje error" }, "Su suscripción no está activa. Renueve el plan para volver a registrar productos, ventas y autorizaciones. ",
    h("a", { href: "./#planes" }, "Renovar plan"));
}

// ---------------------------------------------------------------------
// Hoja inferior (detalle y formularios)
// ---------------------------------------------------------------------
function abrirHoja(titulo, ...contenido) {
  cerrarHoja();
  const velo = h("div", { class: "velo", role: "dialog", "aria-modal": "true", "aria-label": titulo, onclick: (e) => { if (e.target === velo) cerrarHoja(); } },
    h("div", { class: "hoja" },
      h("div", { class: "entre" }, h("h2", {}, titulo), h("button", { class: "cerrar", "aria-label": "Cerrar", onclick: cerrarHoja }, "×")),
      ...contenido));
  document.body.append(velo);
  document.addEventListener("keydown", escape);
  velo.querySelector("input,select,textarea,button.sello,button.boton")?.focus();
}
function cerrarHoja() { document.querySelector(".velo")?.remove(); document.removeEventListener("keydown", escape); }
function escape(e) { if (e.key === "Escape") cerrarHoja(); }

const campo = (etiqueta, control) => h("div", {}, h("label", { for: control.id }, etiqueta), control);
const caja = (id, tipo = "text", valor = "", extra = {}) => h("input", { id, type: tipo, value: valor ?? "", ...extra });

// ---------------------------------------------------------------------
// PANEL
// ---------------------------------------------------------------------
async function vistaPanel(vista) {
  const [{ data: r, error }, { data: pend }] = await Promise.all([
    supabase.rpc("resumen_panel", { p_empresa_id: empresaId() }),
    supabase.from("control_abastecimiento")
      .select("id, estado, cantidad_sugerida, nivel_alerta, fecha_ejecucion_programada, producto:inventario!control_producto_tenant(nombre, sku, unidad_medida, nicho_id)")
      .eq("empresa_id", empresaId()).eq("estado", "pendiente_aprobacion").order("fecha_ejecucion_programada").limit(6),
  ]);
  if (error) throw error;
  const cifra = (valor, rotulo, destacada = false) => h("div", { class: destacada ? "alerta-cifra" : "" }, h("div", { class: "valor num" }, valor), h("div", { class: "rotulo" }, rotulo));

  const primerosPasos = estado.nichos.length === 0 && esAdmin()
    ? h("div", { class: "panel pila" }, h("h2", {}, "Empecemos"),
        h("p", { class: "suave" }, "Cree el primer nicho de su negocio. Trae listos los datos que necesita cada tipo de producto y las reglas que usa la IA."),
        h("a", { class: "boton oro", href: "#/mas", onclick: () => setTimeout(hojaNuevoNicho, 50) }, "Crear mi primer nicho"))
    : null;

  vista.replaceChildren(h("div", { class: "pila" },
    bannerSuscripcion(),
    h("div", {}, h("h1", { class: "dorado" }, `Hola, ${estado.cuenta.nombre}`), h("p", { class: "tenue" }, "Esto es lo que necesita su atención hoy.")),
    primerosPasos,
    h("div", { class: "libro" },
      cifra(num(r.pendientes, 0), "por autorizar", r.pendientes > 0),
      cifra(num(r.bajo_minimo, 0), "productos bajo el mínimo", r.bajo_minimo > 0),
      cifra(num(r.criticos, 0), "en nivel crítico", r.criticos > 0),
      cifra(num(r.productos, 0), "productos activos"),
      cifra(dinero(r.valor_inventario, moneda()), "valor del inventario"),
      cifra(dinero(r.ventas_30d, moneda()), "ventas de 30 días"),
      cifra(num(r.unidades_vendidas_30d, 0), "unidades vendidas en 30 días"),
      cifra(dinero(r.compras_mes, moneda()), `compras del mes (${num(r.ordenes_mes, 0)} órdenes)`)),
    h("section", { class: "panel" },
      h("div", { class: "entre" }, h("h2", {}, "Por autorizar"), h("a", { href: "#/alertas" }, "Ver todas")),
      (pend ?? []).length === 0
        ? h("p", { class: "vacio" }, "No hay compras esperando su firma.")
        : h("ul", { class: "lista" }, ...(pend ?? []).map(filaAlerta))),
    h("section", { class: "panel grafico" }, h("h2", {}, "Unidades vendidas, últimos 14 días"), graficoVentas(r.ventas_por_dia ?? []))));
}

function graficoVentas(dias) {
  const mapa = new Map(dias.map((d) => [d.dia, Number(d.unidades)]));
  const serie = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    const clave = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(d);
    serie.push({ clave, valor: mapa.get(clave) ?? 0, etiqueta: clave.slice(8) });
  }
  const max = Math.max(1, ...serie.map((s) => s.valor));
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 560 140");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Ventas diarias: máximo ${max} unidades`);
  const defs = document.createElementNS(ns, "defs");
  const grad = document.createElementNS(ns, "linearGradient");
  grad.setAttribute("id", "barraOro"); grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0"); grad.setAttribute("x2", "0"); grad.setAttribute("y2", "1");
  for (const [o, c] of [["0", "#E8C66A"], ["1", "#2A4BD7"]]) { const s = document.createElementNS(ns, "stop"); s.setAttribute("offset", o); s.setAttribute("stop-color", c); grad.append(s); }
  defs.append(grad); svg.append(defs);
  const ancho = 560 / 14;
  serie.forEach((s, i) => {
    const alto = (s.valor / max) * 100;
    const r = document.createElementNS(ns, "rect");
    r.setAttribute("x", String(i * ancho + 6)); r.setAttribute("y", String(112 - alto));
    r.setAttribute("width", String(ancho - 12)); r.setAttribute("height", String(Math.max(alto, 1.5)));
    r.setAttribute("rx", "3"); r.setAttribute("fill", s.valor ? "url(#barraOro)" : "rgba(243,236,221,.12)");
    const t = document.createElementNS(ns, "title"); t.textContent = `${s.clave}: ${s.valor} unidades`; r.append(t);
    const e = document.createElementNS(ns, "text");
    e.setAttribute("x", String(i * ancho + ancho / 2)); e.setAttribute("y", "132"); e.setAttribute("text-anchor", "middle"); e.setAttribute("class", "eje");
    e.textContent = s.etiqueta;
    svg.append(r, e);
  });
  return svg;
}

// ---------------------------------------------------------------------
// INVENTARIO
// ---------------------------------------------------------------------
let filtroNicho = "todos";
let busqueda = "";

async function vistaInventario(vista) {
  const { data, error } = await supabase.from("inventario")
    .select("*, proveedor:proveedores!inventario_proveedor_de_empresa(nombre)")
    .eq("empresa_id", empresaId()).eq("activo", true).order("nombre").limit(2000);
  if (error) throw error;
  const productos = data ?? [];
  const lista = h("ul", { class: "lista" });
  const pintarLista = () => {
    const q = busqueda.toLowerCase();
    const visibles = productos.filter((p) => (filtroNicho === "todos" || filtroNicho === "bajo" ? true : p.nicho_id === filtroNicho)
      && (filtroNicho !== "bajo" || nivelDe(p) !== "ok")
      && (!q || p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)));
    lista.replaceChildren(...(visibles.length ? visibles.map((p) => h("li", { class: "tocable", "data-nivel": nivelDe(p), tabindex: "0", onclick: () => hojaProducto(p), onkeydown: (e) => e.key === "Enter" && hojaProducto(p) },
      h("div", {}, h("div", { class: "titulo" }, p.nombre), h("div", { class: "detalle" }, `${p.sku} · ${nombreNicho(p.nicho_id)}`)),
      h("div", { class: "der" }, h("div", { class: "num titulo" }, `${num(p.stock_actual)} ${p.unidad_medida}`), h("div", { class: "detalle num" }, `mínimo ${num(p.stock_minimo)}`))))
      : [h("li", { class: "vacio", style: "display:block" }, productos.length ? "Ningún producto coincide con el filtro." : "Aún no hay productos. Cree el primero con el botón de arriba.")]));
  };
  const segmentos = h("div", { class: "segmentos", role: "group", "aria-label": "Filtrar por nicho" },
    ...[{ id: "todos", nombre: "Todos" }, { id: "bajo", nombre: "Bajo el mínimo" }, ...estado.nichos].map((n) => h("button", { "aria-pressed": String(filtroNicho === n.id), onclick: (e) => {
      filtroNicho = n.id; segmentos.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false")); e.target.setAttribute("aria-pressed", "true"); pintarLista();
    } }, n.nombre)));
  const buscador = h("input", { type: "search", placeholder: "Buscar por nombre o SKU", value: busqueda, "aria-label": "Buscar producto", oninput: (e) => { busqueda = e.target.value; pintarLista(); } });
  pintarLista();
  vista.replaceChildren(h("div", { class: "pila" },
    bannerSuscripcion(),
    h("div", { class: "entre" }, h("h1", {}, "Inventario"),
      puedeEditar() ? h("button", { class: "boton oro", onclick: () => estado.nichos.length ? hojaFormularioProducto() : toast("Primero cree un nicho en Más → Nichos.") }, "Nuevo producto") : null),
    segmentos, buscador, h("div", { class: "panel", style: "padding:6px 8px" }, lista)));
}

function hojaProducto(p) {
  const atributos = Object.entries(p.atributos ?? {});
  abrirHoja(p.nombre,
    h("span", { class: `chip ${nivelDe(p) === "critico" ? "rubi" : nivelDe(p) === "minimo" ? "oro" : "verde"}` },
      { critico: "Nivel crítico", minimo: "Bajo el mínimo", ok: "Stock suficiente" }[nivelDe(p)]),
    h("dl", { class: "datos num" },
      h("dt", {}, "SKU"), h("dd", {}, p.sku),
      h("dt", {}, "Nicho"), h("dd", {}, nombreNicho(p.nicho_id)),
      h("dt", {}, "Stock actual"), h("dd", {}, `${num(p.stock_actual)} ${p.unidad_medida}`),
      h("dt", {}, "Crítico / mínimo / máximo"), h("dd", {}, `${num(p.stock_critico)} / ${num(p.stock_minimo)} / ${p.stock_maximo === null ? "—" : num(p.stock_maximo)}`),
      h("dt", {}, "Lote de compra"), h("dd", {}, num(p.lote_minimo_compra)),
      h("dt", {}, "Costo unitario"), h("dd", {}, dinero(p.costo_unitario, moneda())),
      h("dt", {}, "Proveedor"), h("dd", {}, p.proveedor?.nombre ?? "—"),
      ...atributos.flatMap(([k, v]) => [h("dt", {}, k.replace(/_/g, " ")), h("dd", {}, typeof v === "boolean" ? (v ? "Sí" : "No") : String(v))])),
    puedeEditar() && estado.cuenta.vigente ? h("div", { class: "fila-botones" },
      h("button", { class: "boton oro", onclick: () => hojaMovimiento(p) }, "Registrar movimiento"),
      h("button", { class: "boton", onclick: () => hojaFormularioProducto(p) }, "Editar"),
      h("button", { class: "boton", onclick: () => hojaOrdenManual(p) }, "Orden manual"),
      esAdmin() ? h("button", { class: "boton peligro", onclick: async () => {
        if (!confirm(`¿Desactivar ${p.nombre}? Dejará de generar alertas.`)) return;
        const { error } = await supabase.from("inventario").update({ activo: false }).eq("id", p.id);
        if (error) return toast(mensajeError(error));
        cerrarHoja(); toast("Producto desactivado."); enrutar();
      } }, "Desactivar") : null) : null);
}

function controlesAtributos(nicho, actuales = {}) {
  const esquema = nicho?.esquema_atributos ?? { requeridos: [], tipos: {} };
  const requeridos = new Set(esquema.requeridos ?? []);
  const claves = [...new Set([...(esquema.requeridos ?? []), ...Object.keys(esquema.tipos ?? {})])];
  return claves.map((k) => {
    const tipo = esquema.tipos?.[k] ?? "string";
    const id = `attr_${k}`;
    const etiqueta = `${k.replace(/_/g, " ")}${requeridos.has(k) ? " (obligatorio)" : ""}`;
    let control;
    if (tipo === "boolean") control = h("select", { id, "data-clave": k, "data-tipo": tipo }, h("option", { value: "" }, "—"), h("option", { value: "true", selected: actuales[k] === true }, "Sí"), h("option", { value: "false", selected: actuales[k] === false }, "No"));
    else control = caja(id, tipo === "date" ? "date" : tipo === "number" ? "number" : "text", actuales[k] ?? "", { "data-clave": k, "data-tipo": tipo, step: tipo === "number" ? "any" : null });
    return campo(etiqueta, control);
  });
}

function leerAtributos(contenedor) {
  const salida = {};
  contenedor.querySelectorAll("[data-clave]").forEach((el) => {
    const v = el.value.trim();
    if (v === "") return;
    const t = el.dataset.tipo;
    salida[el.dataset.clave] = t === "number" ? Number(v) : t === "boolean" ? v === "true" : v;
  });
  return salida;
}

function hojaFormularioProducto(p = null) {
  const nuevo = !p;
  const nicho = h("select", { id: "f_nicho", disabled: !nuevo }, ...estado.nichos.map((n) => h("option", { value: n.id, selected: p?.nicho_id === n.id }, n.nombre)));
  const zonaAtributos = h("div");
  const pintarAtributos = () => zonaAtributos.replaceChildren(...controlesAtributos(estado.nichos.find((n) => n.id === nicho.value), p?.atributos ?? {}));
  nicho.addEventListener("change", pintarAtributos);
  pintarAtributos();
  const proveedor = h("select", { id: "f_proveedor" }, h("option", { value: "" }, "Sin proveedor"), ...estado.proveedores.map((x) => h("option", { value: x.id, selected: p?.proveedor_id === x.id }, x.nombre)));
  const msg = h("div", { role: "status" });
  const f = {
    sku: caja("f_sku", "text", p?.sku, { maxlength: "64", disabled: !nuevo, autocapitalize: "characters" }),
    nombre: caja("f_nombre", "text", p?.nombre, { maxlength: "200" }),
    unidad: caja("f_unidad", "text", p?.unidad_medida ?? "unidad", { maxlength: "20" }),
    stock: caja("f_stock", "number", p?.stock_actual ?? 0, { min: "0", step: "any", disabled: !nuevo }),
    critico: caja("f_critico", "number", p?.stock_critico ?? 0, { min: "0", step: "any" }),
    minimo: caja("f_minimo", "number", p?.stock_minimo ?? 0, { min: "0", step: "any" }),
    maximo: caja("f_maximo", "number", p?.stock_maximo ?? "", { min: "0", step: "any" }),
    lote: caja("f_lote", "number", p?.lote_minimo_compra ?? 1, { min: "0.001", step: "any" }),
    costo: caja("f_costo", "number", p?.costo_unitario ?? 0, { min: "0", step: "any" }),
  };
  abrirHoja(nuevo ? "Nuevo producto" : "Editar producto",
    campo("Nicho", nicho), campo("SKU (código único)", f.sku), campo("Nombre", f.nombre),
    h("div", { class: "rejilla-2" }, campo("Unidad", f.unidad), campo(nuevo ? "Stock inicial" : "Stock actual", f.stock)),
    h("div", { class: "rejilla-2" }, campo("Stock crítico", f.critico), campo("Stock mínimo", f.minimo)),
    h("div", { class: "rejilla-2" }, campo("Stock máximo", f.maximo), campo("Lote de compra", f.lote)),
    campo(`Costo unitario (${moneda()})`, f.costo), campo("Proveedor", proveedor),
    h("h3", { style: "margin-top:18px" }, "Datos del nicho"), zonaAtributos,
    h("button", { class: "boton oro ancho", style: "margin-top:18px", onclick: async (ev) => {
      const fila = {
        nombre: f.nombre.value.trim(), unidad_medida: f.unidad.value.trim() || "unidad",
        stock_critico: Number(f.critico.value || 0), stock_minimo: Number(f.minimo.value || 0),
        stock_maximo: f.maximo.value === "" ? null : Number(f.maximo.value), lote_minimo_compra: Number(f.lote.value || 1),
        costo_unitario: Number(f.costo.value || 0), proveedor_id: proveedor.value || null, atributos: leerAtributos(zonaAtributos),
      };
      if (fila.nombre.length < 2) { msg.className = "mensaje error"; msg.textContent = "Escriba el nombre del producto."; return; }
      ev.target.disabled = true;
      const { error } = nuevo
        ? await supabase.from("inventario").insert({ ...fila, empresa_id: empresaId(), nicho_id: nicho.value, sku: f.sku.value.trim(), stock_actual: Number(f.stock.value || 0) })
        : await supabase.from("inventario").update(fila).eq("id", p.id);
      ev.target.disabled = false;
      if (error) { msg.className = "mensaje error"; msg.textContent = mensajeError(error); return; }
      cerrarHoja(); toast(nuevo ? "Producto creado." : "Cambios guardados."); await cargarCatalogos(); enrutar();
    } }, nuevo ? "Crear producto" : "Guardar cambios"), msg);
}

function hojaMovimiento(p) {
  const tipo = h("select", { id: "m_tipo" },
    ...[["venta", "Venta"], ["compra", "Compra recibida"], ["merma", "Merma o daño"], ["ajuste_positivo", "Ajuste de inventario (suma)"], ["ajuste_negativo", "Ajuste de inventario (resta)"], ["devolucion_cliente", "Devolución de cliente"], ["devolucion_proveedor", "Devolución a proveedor"]]
      .map(([v, t]) => h("option", { value: v }, t)));
  const cantidad = caja("m_cantidad", "number", "", { min: "0.001", step: "any", inputmode: "decimal" });
  const precio = caja("m_precio", "number", "", { min: "0", step: "any", inputmode: "decimal" });
  const ref = caja("m_ref", "text", "", { maxlength: "120", placeholder: "Factura, pedido o nota" });
  const msg = h("div", { role: "status" });
  abrirHoja(`Movimiento · ${p.nombre}`,
    h("p", { class: "tenue" }, `Stock actual: ${num(p.stock_actual)} ${p.unidad_medida}`),
    campo("Tipo", tipo), campo(`Cantidad (${p.unidad_medida})`, cantidad), campo(`Precio unitario (${moneda()}, opcional)`, precio), campo("Referencia", ref),
    h("button", { class: "boton oro ancho", style: "margin-top:18px", onclick: async (ev) => {
      const c = Number(cantidad.value);
      if (!(c > 0)) { msg.className = "mensaje error"; msg.textContent = "Escriba una cantidad mayor que cero."; return; }
      ev.target.disabled = true;
      const { error } = await supabase.from("movimientos_inventario").insert({
        empresa_id: p.empresa_id, nicho_id: p.nicho_id, producto_id: p.id, tipo: tipo.value, cantidad: c,
        precio_unitario: precio.value === "" ? null : Number(precio.value), referencia: ref.value.trim() || null,
      });
      ev.target.disabled = false;
      if (error) { msg.className = "mensaje error"; msg.textContent = mensajeError(error); return; }
      cerrarHoja(); toast("Movimiento registrado."); await cargarCatalogos(); armarMarco(); enrutar();
    } }, "Registrar"), msg);
}

function hojaOrdenManual(p) {
  const cantidad = caja("o_cantidad", "number", p.lote_minimo_compra, { min: "0.001", step: "any" });
  const msg = h("div", { role: "status" });
  abrirHoja(`Orden manual · ${p.nombre}`,
    h("p", { class: "suave" }, "Una orden manual la crea usted directamente, sin esperar el pre-aviso de 7 días."),
    campo(`Cantidad (${p.unidad_medida})`, cantidad),
    h("button", { class: "boton oro ancho", style: "margin-top:18px", onclick: async (ev) => {
      const c = Number(cantidad.value);
      if (!(c > 0)) { msg.className = "mensaje error"; msg.textContent = "Escriba una cantidad mayor que cero."; return; }
      ev.target.disabled = true;
      const subtotal = Math.round(c * Number(p.costo_unitario) * 100) / 100;
      const { error } = await supabase.from("ordenes_compra").insert({
        empresa_id: p.empresa_id, nicho_id: p.nicho_id, proveedor_id: p.proveedor_id, origen: "manual", estado: "emitida", moneda: moneda(), subtotal,
        lineas: [{ producto_id: p.id, sku: p.sku, nombre: p.nombre, cantidad: c, unidad: p.unidad_medida, costo_unitario: Number(p.costo_unitario), subtotal }],
      });
      ev.target.disabled = false;
      if (error) { msg.className = "mensaje error"; msg.textContent = mensajeError(error); return; }
      cerrarHoja(); toast("Orden creada."); location.hash = "#/ordenes";
    } }, "Crear orden"), msg);
}

// ---------------------------------------------------------------------
// ALERTAS
// ---------------------------------------------------------------------
let filtroAlertas = "pendiente_aprobacion";
const SELECT_ALERTA = "id, estado, cantidad_sugerida, nivel_alerta, fecha_deteccion, fecha_ejecucion_programada, fecha_autorizacion, cancelado_motivo, metadatos, orden_compra_id, empresa_id, nicho_id, producto:inventario!control_producto_tenant(nombre, sku, unidad_medida, stock_actual, stock_minimo, costo_unitario)";

function filaAlerta(c) {
  const p = c.producto ?? {};
  const derecha = c.estado === "pendiente_aprobacion" ? restante(c.fecha_ejecucion_programada)
    : c.estado === "autorizado" ? `se ejecuta ${fecha(c.fecha_ejecucion_programada, false)}`
    : c.estado === "ejecutado" ? "orden emitida" : "cancelada";
  return h("li", { class: "tocable", "data-nivel": c.nivel_alerta, tabindex: "0", onclick: () => hojaAlerta(c), onkeydown: (e) => e.key === "Enter" && hojaAlerta(c) },
    h("div", {}, h("div", { class: "titulo" }, p.nombre ?? "Producto"), h("div", { class: "detalle num" }, `${num(c.cantidad_sugerida)} ${p.unidad_medida ?? ""} · ${nombreNicho(c.nicho_id)}`)),
    h("div", { class: "der" }, h("span", { class: `chip ${c.estado === "pendiente_aprobacion" ? "oro" : c.estado === "autorizado" ? "cobalto" : c.estado === "ejecutado" ? "verde" : ""}` }, derecha)));
}

async function vistaAlertas(vista) {
  const consulta = supabase.from("control_abastecimiento").select(SELECT_ALERTA).eq("empresa_id", empresaId());
  const { data, error } = filtroAlertas === "historial"
    ? await consulta.in("estado", ["ejecutado", "cancelado"]).order("actualizado_en", { ascending: false }).limit(100)
    : await consulta.eq("estado", filtroAlertas).order("fecha_ejecucion_programada").limit(200);
  if (error) throw error;
  const seg = h("div", { class: "segmentos", role: "group", "aria-label": "Estado" },
    ...[["pendiente_aprobacion", "Por autorizar"], ["autorizado", "Autorizadas"], ["historial", "Historial"]].map(([v, t]) =>
      h("button", { "aria-pressed": String(filtroAlertas === v), onclick: () => { filtroAlertas = v; enrutar(); } }, t)));
  vista.replaceChildren(h("div", { class: "pila" },
    bannerSuscripcion(),
    h("div", {}, h("h1", {}, "Alertas de abastecimiento"),
      h("p", { class: "tenue" }, "Cada alerta espera 7 días su firma. Sin firma, la compra queda bloqueada.")),
    seg,
    h("div", { class: "panel", style: "padding:6px 8px" }, (data ?? []).length
      ? h("ul", { class: "lista" }, ...(data ?? []).map(filaAlerta))
      : h("p", { class: "vacio" }, filtroAlertas === "pendiente_aprobacion" ? "No hay compras esperando su firma." : "Nada por aquí todavía."))));
}

function hojaAlerta(c) {
  const p = c.producto ?? {};
  const vigente = c.estado === "pendiente_aprobacion" && new Date(c.fecha_ejecucion_programada).getTime() > Date.now();
  const decide = puedeEditar() && estado.cuenta.vigente;
  const msg = h("div", { role: "status" });
  const verificado = h("input", { type: "checkbox", id: "verif" });
  const sello = h("button", { class: "sello", disabled: true, onclick: async () => {
    if (!confirm("¿Confirma la autorización? La compra se ejecutará automáticamente en la fecha programada.")) return;
    sello.disabled = true;
    const { data, error } = await supabase.rpc("autorizar_en_app", { p_control_id: c.id });
    if (error || !data?.ok) { msg.className = "mensaje error"; msg.textContent = error ? mensajeError(error) : (data?.mensaje ?? "No se pudo autorizar."); sello.disabled = false; return; }
    cerrarHoja(); toast(data.mensaje ?? "Compra autorizada."); await cargarCatalogos(); armarMarco(); enrutar();
  } }, "Firmar y autorizar");
  verificado.addEventListener("change", () => { sello.disabled = !verificado.checked; });
  const motivo = h("textarea", { id: "motivo", maxlength: "300", placeholder: "Ej: hay mercancía en bodega 2" });

  abrirHoja(p.nombre ?? "Alerta",
    h("p", { class: "aviso-oro" }, "La IA ha detectado baja disponibilidad de mercancía. Se requiere su total atención y ejecución con eficiencia para verificar que lo solicitado sea lo que realmente falta. La ejecución automática se realizará en 7 días si cuenta con su autorización manual."),
    h("dl", { class: "datos num" },
      h("dt", {}, "Cantidad sugerida"), h("dd", {}, `${num(c.cantidad_sugerida)} ${p.unidad_medida ?? ""}`),
      h("dt", {}, "Stock actual / mínimo"), h("dd", {}, `${num(p.stock_actual)} / ${num(p.stock_minimo)}`),
      h("dt", {}, "Costo estimado"), h("dd", {}, dinero(Number(c.cantidad_sugerida) * Number(p.costo_unitario ?? 0), moneda())),
      h("dt", {}, "Detectada"), h("dd", {}, fecha(c.fecha_deteccion)),
      h("dt", {}, "Ejecución programada"), h("dd", {}, fecha(c.fecha_ejecucion_programada)),
      c.fecha_autorizacion ? [h("dt", {}, "Autorizada"), h("dd", {}, fecha(c.fecha_autorizacion))] : null,
      c.cancelado_motivo ? [h("dt", {}, "Motivo"), h("dd", {}, c.cancelado_motivo.replace(/_/g, " "))] : null),
    c.metadatos?.ia_justificacion ? h("p", { class: "suave", style: "margin-top:12px" }, h("strong", { class: "dorado" }, "Análisis de la IA: "), c.metadatos.ia_justificacion) : null,
    vigente && decide ? h("div", {},
      h("label", { class: "check" }, verificado, "Verifiqué que lo solicitado es lo que realmente falta."),
      h("div", { style: "margin-top:14px" }, sello),
      h("p", { class: "tenue", style: "text-align:center;margin-top:8px" }, restante(c.fecha_ejecucion_programada)),
      h("label", { for: "motivo" }, "¿No corresponde? Indique el motivo (opcional)"), motivo,
      h("button", { class: "boton peligro ancho", style: "margin-top:12px", onclick: async (ev) => rechazar(c, motivo.value, ev.target, msg) }, "Rechazar solicitud")) : null,
    c.estado === "autorizado" && decide ? h("button", { class: "boton peligro ancho", style: "margin-top:16px", onclick: async (ev) => rechazar(c, "autorizacion_revocada", ev.target, msg) }, "Revocar autorización") : null,
    !decide && vigente ? h("p", { class: "mensaje info" }, "Su rol permite consultar, pero no firmar compras.") : null,
    msg);
}

async function rechazar(c, motivo, boton, msg) {
  if (!confirm("La compra quedará cancelada. ¿Continuar?")) return;
  boton.disabled = true;
  const { data, error } = await supabase.rpc("rechazar_en_app", { p_control_id: c.id, p_motivo: motivo?.trim() || null });
  boton.disabled = false;
  if (error || !data?.ok) { msg.className = "mensaje error"; msg.textContent = error ? mensajeError(error) : "No se pudo cancelar."; return; }
  cerrarHoja(); toast("Solicitud cancelada."); await cargarCatalogos(); armarMarco(); enrutar();
}

// ---------------------------------------------------------------------
// ÓRDENES
// ---------------------------------------------------------------------
const ETIQUETA_ORDEN = { borrador: "Borrador", emitida: "Emitida", enviada_proveedor: "Enviada al proveedor", confirmada: "Confirmada", recibida_parcial: "Recibida en parte", recibida: "Recibida", cancelada: "Cancelada" };
const SIGUIENTE = { emitida: "enviada_proveedor", enviada_proveedor: "confirmada", confirmada: "recibida", recibida_parcial: "recibida" };

async function vistaOrdenes(vista) {
  const { data, error } = await supabase.from("ordenes_compra")
    .select("*, proveedor:proveedores!orden_proveedor_de_empresa(nombre, email, whatsapp_e164)")
    .eq("empresa_id", empresaId()).order("creado_en", { ascending: false }).limit(200);
  if (error) throw error;
  vista.replaceChildren(h("div", { class: "pila" },
    bannerSuscripcion(),
    h("div", {}, h("h1", {}, "Órdenes de compra"), h("p", { class: "tenue" }, "Nacen de una alerta firmada al día 7, o de una orden manual.")),
    h("div", { class: "panel", style: "padding:6px 8px" }, (data ?? []).length
      ? h("ul", { class: "lista" }, ...(data ?? []).map((o) => h("li", { class: "tocable", tabindex: "0", onclick: () => hojaOrden(o), onkeydown: (e) => e.key === "Enter" && hojaOrden(o) },
          h("div", {}, h("div", { class: "titulo num" }, o.numero), h("div", { class: "detalle" }, `${o.lineas?.[0]?.nombre ?? ""}${o.lineas?.length > 1 ? ` y ${o.lineas.length - 1} más` : ""} · ${fecha(o.creado_en, false)}`)),
          h("div", { class: "der" }, h("div", { class: "num titulo" }, dinero(o.subtotal, o.moneda)), h("span", { class: `chip ${o.estado === "recibida" ? "verde" : o.estado === "cancelada" ? "rubi" : "oro"}` }, ETIQUETA_ORDEN[o.estado])))))
      : h("p", { class: "vacio" }, "Todavía no hay órdenes."))));
}

function hojaOrden(o) {
  const msg = h("div", { role: "status" });
  const sig = SIGUIENTE[o.estado];
  const texto = (o.lineas ?? []).map((l) => `• ${l.nombre} (${l.sku}): ${num(l.cantidad)} ${l.unidad}`).join("\n");
  const mensajeProveedor = `Orden ${o.numero}\n${texto}\nTotal estimado: ${dinero(o.subtotal, o.moneda)}`;
  const wa = o.proveedor?.whatsapp_e164 ? `https://wa.me/${o.proveedor.whatsapp_e164.replace("+", "")}?text=${encodeURIComponent(mensajeProveedor)}` : null;
  const mail = o.proveedor?.email ? `mailto:${o.proveedor.email}?subject=${encodeURIComponent(`Orden de compra ${o.numero}`)}&body=${encodeURIComponent(mensajeProveedor)}` : null;
  abrirHoja(`Orden ${o.numero}`,
    h("span", { class: "chip oro" }, ETIQUETA_ORDEN[o.estado]),
    h("dl", { class: "datos num" },
      h("dt", {}, "Origen"), h("dd", {}, o.origen === "manual" ? "Manual" : "Alerta autorizada"),
      h("dt", {}, "Proveedor"), h("dd", {}, o.proveedor?.nombre ?? "Sin proveedor"),
      h("dt", {}, "Entrega estimada"), h("dd", {}, o.fecha_entrega_estimada ?? "—"),
      ...(o.lineas ?? []).flatMap((l) => [h("dt", {}, l.nombre), h("dd", {}, `${num(l.cantidad)} ${l.unidad} · ${dinero(l.subtotal, o.moneda)}`)]),
      h("dt", {}, "Total"), h("dd", {}, dinero(o.subtotal, o.moneda))),
    h("div", { class: "fila-botones" },
      wa ? h("a", { class: "boton", href: wa, target: "_blank", rel: "noopener" }, "Enviar por WhatsApp") : null,
      mail ? h("a", { class: "boton", href: mail }, "Enviar por correo") : null),
    puedeEditar() && estado.cuenta.vigente && sig ? h("button", { class: "boton oro ancho", style: "margin-top:16px", onclick: async (ev) => {
      ev.target.disabled = true;
      if (sig === "recibida") {
        if (!confirm("Se sumará la mercancía al inventario. ¿Confirma que llegó completa?")) { ev.target.disabled = false; return; }
        for (const l of o.lineas ?? []) {
          const { error } = await supabase.from("movimientos_inventario").insert({ empresa_id: o.empresa_id, nicho_id: o.nicho_id, producto_id: l.producto_id, tipo: "compra", cantidad: l.cantidad, precio_unitario: l.costo_unitario, referencia: o.numero });
          if (error) { msg.className = "mensaje error"; msg.textContent = mensajeError(error); ev.target.disabled = false; return; }
        }
      }
      const { error } = await supabase.from("ordenes_compra").update({ estado: sig }).eq("id", o.id);
      ev.target.disabled = false;
      if (error) { msg.className = "mensaje error"; msg.textContent = mensajeError(error); return; }
      cerrarHoja(); toast(sig === "recibida" ? "Orden recibida y stock actualizado." : `Orden marcada como ${ETIQUETA_ORDEN[sig].toLowerCase()}.`); enrutar();
    } }, sig === "recibida" ? "Marcar como recibida" : `Marcar como ${ETIQUETA_ORDEN[sig].toLowerCase()}`) : null,
    puedeEditar() && estado.cuenta.vigente && !["recibida", "cancelada"].includes(o.estado) ? h("button", { class: "boton peligro ancho", style: "margin-top:10px", onclick: async () => {
      if (!confirm("¿Cancelar esta orden?")) return;
      const { error } = await supabase.from("ordenes_compra").update({ estado: "cancelada" }).eq("id", o.id);
      if (error) { msg.className = "mensaje error"; msg.textContent = mensajeError(error); return; }
      cerrarHoja(); toast("Orden cancelada."); enrutar();
    } }, "Cancelar orden") : null,
    msg);
}

// ---------------------------------------------------------------------
// MÁS: cuenta, nichos, proveedores, equipo, IA, soporte
// ---------------------------------------------------------------------
async function vistaMas(vista) {
  const c = estado.cuenta;
  const plan = c.plan ?? {};
  const uso = (actual, maximo, nombre) => h("div", { style: "margin-top:10px" },
    h("div", { class: "entre" }, h("span", {}, nombre), h("span", { class: "num tenue" }, maximo ? `${actual} de ${maximo}` : `${actual} · ilimitado`)),
    h("div", { class: "barra-uso" }, h("span", { style: `width:${maximo ? Math.min(100, (actual / maximo) * 100) : 12}%` })));
  const estadoSus = { prueba: "En prueba", activa: "Activa", cancelada_fin_periodo: "Cancelada al final del periodo", vencida: "Vencida", reembolsada: "Reembolsada", suspendida: "Suspendida" }[c.suscripcion?.estado] ?? "—";
  const enlace = (texto, accion, solo = true) => solo ? h("li", { class: "tocable", tabindex: "0", onclick: accion, onkeydown: (e) => e.key === "Enter" && accion() }, h("div", { class: "titulo" }, texto), h("span", { class: "tenue" }, "›")) : null;

  vista.replaceChildren(h("div", { class: "pila" },
    h("h1", {}, "Más"),
    h("section", { class: "panel" },
      h("div", { class: "entre" }, h("h2", { class: "dorado" }, `Plan ${plan.nombre ?? ""}`), h("span", { class: `chip ${c.vigente ? "verde" : "rubi"}` }, estadoSus)),
      c.suscripcion?.vence_en ? h("p", { class: "tenue", style: "margin-top:6px" }, `Próxima renovación: ${fecha(c.suscripcion.vence_en, false)}`) : null,
      uso(c.uso?.nichos ?? 0, plan.max_nichos, "Nichos"), uso(c.uso?.productos ?? 0, plan.max_productos, "Productos"), uso(c.uso?.usuarios ?? 0, plan.max_usuarios, "Usuarios"),
      h("p", { class: "tenue", style: "margin-top:10px" }, `IA de demanda: ${plan.ia_habilitada ? "incluida" : "no incluida"} · Alertas por WhatsApp: ${plan.whatsapp ? "incluidas" : "no incluidas"}`),
      plan.codigo !== "imperial" ? h("a", { class: "boton oro", href: "./#planes", style: "margin-top:10px" }, "Mejorar plan") : null),
    h("section", { class: "panel", style: "padding:6px 8px" }, h("ul", { class: "lista" },
      enlace("Nichos del negocio", hojaNichos),
      enlace("Proveedores", hojaProveedores),
      enlace("Equipo y permisos", hojaEquipo, esAdmin()),
      enlace("Predicciones de la IA", hojaPredicciones),
      enlace("Datos de la empresa", hojaEmpresa, esAdmin()),
      h("li", {}, h("a", { href: `https://wa.me/${CONFIG.SOPORTE_WHATSAPP}?text=${encodeURIComponent("Hola, necesito ayuda con IMPERIUM")}`, target: "_blank", rel: "noopener", class: "titulo" }, "Soporte por WhatsApp"), h("span", { class: "tenue" }, "›")))),
    h("button", { class: "boton ancho", onclick: () => supabase.auth.signOut() }, "Cerrar sesión"),
    h("p", { class: "lema", style: "text-align:center" }, "La Firma de la Herencia")));
}

async function hojaNichos() {
  abrirHoja("Nichos del negocio",
    h("p", { class: "suave" }, "Cada nicho define qué datos pide un producto y qué reglas sigue la IA al sugerir compras."),
    h("ul", { class: "lista" }, ...(estado.nichos.length ? estado.nichos.map((n) => h("li", {},
      h("div", {}, h("div", { class: "titulo" }, n.nombre), h("div", { class: "detalle" }, `Entrega en ${n.lead_time_dias} días · cobertura de ${n.dias_cobertura_objetivo} días`)))) : [h("li", { class: "vacio", style: "display:block" }, "Aún no hay nichos.")])),
    esAdmin() && estado.cuenta.vigente ? h("button", { class: "boton oro ancho", style: "margin-top:16px", onclick: hojaNuevoNicho }, "Agregar nicho") : null);
}

async function hojaNuevoNicho() {
  const { data: plantillas } = await supabase.from("plantillas_nicho").select("*").order("orden");
  const sel = h("select", { id: "n_plantilla" }, ...(plantillas ?? []).map((p) => h("option", { value: p.codigo }, `${p.nombre} — ${p.descripcion}`)));
  const nombre = caja("n_nombre", "text", "", { maxlength: "100", placeholder: "Opcional: nombre propio del nicho" });
  const msg = h("div", { role: "status" });
  abrirHoja("Agregar nicho",
    campo("Tipo de negocio", sel), campo("Nombre a mostrar", nombre),
    h("button", { class: "boton oro ancho", style: "margin-top:18px", onclick: async (ev) => {
      const p = (plantillas ?? []).find((x) => x.codigo === sel.value);
      ev.target.disabled = true;
      const codigoBase = p.codigo;
      const existentes = new Set(estado.nichos.map((n) => n.codigo));
      let codigo = codigoBase, i = 2;
      while (existentes.has(codigo)) codigo = `${codigoBase}_${i++}`;
      const { error } = await supabase.from("nichos").insert({
        empresa_id: empresaId(), codigo, nombre: nombre.value.trim() || p.nombre, esquema_atributos: p.esquema_atributos,
        reglas_ia: p.reglas_ia, lead_time_dias: p.lead_time_dias, dias_cobertura_objetivo: p.dias_cobertura_objetivo,
      });
      ev.target.disabled = false;
      if (error) { msg.className = "mensaje error"; msg.textContent = mensajeError(error); return; }
      cerrarHoja(); await cargarCuenta(); toast("Nicho creado.");
    } }, "Crear nicho"), msg);
}

function hojaProveedores() {
  abrirHoja("Proveedores",
    h("ul", { class: "lista" }, ...(estado.proveedores.length ? estado.proveedores.map((x) => h("li", { class: esAdmin() ? "tocable" : "", onclick: () => esAdmin() && hojaProveedor(x) },
      h("div", {}, h("div", { class: "titulo" }, x.nombre), h("div", { class: "detalle" }, [x.email, x.whatsapp_e164].filter(Boolean).join(" · ") || "Sin contacto")),
      h("span", { class: "tenue num" }, `${x.lead_time_dias} d`))) : [h("li", { class: "vacio", style: "display:block" }, "Aún no hay proveedores.")])),
    esAdmin() && estado.cuenta.vigente ? h("button", { class: "boton oro ancho", style: "margin-top:16px", onclick: () => hojaProveedor(null) }, "Agregar proveedor") : null);
}

function hojaProveedor(x) {
  const f = {
    nombre: caja("p_nombre", "text", x?.nombre, { maxlength: "150" }),
    email: caja("p_email", "email", x?.email, { maxlength: "160" }),
    wa: caja("p_wa", "tel", x?.whatsapp_e164, { placeholder: "+573001234567" }),
    lead: caja("p_lead", "number", x?.lead_time_dias ?? 3, { min: "0", max: "365" }),
  };
  const msg = h("div", { role: "status" });
  abrirHoja(x ? "Editar proveedor" : "Nuevo proveedor",
    campo("Nombre", f.nombre), campo("Correo", f.email), campo("WhatsApp", f.wa), campo("Días de entrega", f.lead),
    h("button", { class: "boton oro ancho", style: "margin-top:18px", onclick: async (ev) => {
      const fila = { nombre: f.nombre.value.trim(), email: f.email.value.trim() || null, whatsapp_e164: f.wa.value.replace(/[\s-]/g, "") || null, lead_time_dias: Number(f.lead.value || 3) };
      ev.target.disabled = true;
      const { error } = x ? await supabase.from("proveedores").update(fila).eq("id", x.id) : await supabase.from("proveedores").insert({ ...fila, empresa_id: empresaId() });
      ev.target.disabled = false;
      if (error) { msg.className = "mensaje error"; msg.textContent = mensajeError(error); return; }
      await cargarCatalogos(); toast("Proveedor guardado."); hojaProveedores();
    } }, "Guardar"), msg);
}

async function hojaEquipo() {
  const { data } = await supabase.from("asignaciones_usuario").select("*").eq("empresa_id", empresaId()).order("creado_en");
  const rolTexto = { admin_empresa: "Administrador", encargado: "Encargado", lector: "Lector" };
  abrirHoja("Equipo y permisos",
    h("p", { class: "suave" }, "Los encargados reciben las alertas de su nicho y firman las compras. Los lectores solo consultan."),
    h("ul", { class: "lista" }, ...(data ?? []).map((a) => h("li", { "data-nivel": a.activo ? "ok" : "critico" },
      h("div", {}, h("div", { class: "titulo" }, a.nombre_mostrar), h("div", { class: "detalle" }, `${rolTexto[a.rol]} · ${a.nicho_id ? nombreNicho(a.nicho_id) : "todos los nichos"}${a.activo ? "" : " · inactivo"}`)),
      a.usuario_id !== estado.sesion?.user?.id ? h("button", { class: "boton chico", onclick: async () => {
        const { error } = await supabase.from("asignaciones_usuario").update({ activo: !a.activo }).eq("id", a.id);
        if (error) return toast(mensajeError(error));
        toast(a.activo ? "Acceso retirado." : "Acceso restaurado."); hojaEquipo();
      } }, a.activo ? "Retirar" : "Restaurar") : h("span", { class: "tenue" }, "usted")))),
    estado.cuenta.vigente ? h("button", { class: "boton oro ancho", style: "margin-top:16px", onclick: hojaInvitar }, "Invitar a alguien") : null);
}

function hojaInvitar() {
  const f = {
    nombre: caja("i_nombre", "text", "", { maxlength: "120" }),
    email: caja("i_email", "email", "", { maxlength: "160" }),
    wa: caja("i_wa", "tel", "", { placeholder: "+573001234567 (para alertas por WhatsApp)" }),
  };
  const rol = h("select", { id: "i_rol" }, h("option", { value: "encargado" }, "Encargado: recibe alertas y firma compras"), h("option", { value: "lector" }, "Lector: solo consulta"), h("option", { value: "admin_empresa" }, "Administrador: control total"));
  const nicho = h("select", { id: "i_nicho" }, ...estado.nichos.map((n) => h("option", { value: n.id }, n.nombre)));
  const zonaNicho = campo("Nicho", nicho);
  rol.addEventListener("change", () => zonaNicho.classList.toggle("oculto", rol.value === "admin_empresa"));
  const msg = h("div", { role: "status" });
  abrirHoja("Invitar a alguien",
    campo("Nombre", f.nombre), campo("Correo", f.email), campo("Rol", rol), zonaNicho, campo("WhatsApp (opcional)", f.wa),
    h("button", { class: "boton oro ancho", style: "margin-top:18px", onclick: async (ev) => {
      ev.target.disabled = true;
      const { data: s } = await supabase.auth.getSession();
      const r = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/gestion-equipo`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token}`, apikey: CONFIG.SUPABASE_KEY },
        body: JSON.stringify({ empresa_id: empresaId(), email: f.email.value, nombre: f.nombre.value, rol: rol.value, nicho_id: rol.value === "admin_empresa" ? null : nicho.value, whatsapp_e164: f.wa.value || null }),
      }).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : {};
      ev.target.disabled = false;
      if (!j.ok) { msg.className = "mensaje error"; msg.textContent = j.error?.mensaje ?? "No se pudo invitar. Revise su conexión."; return; }
      toast("Invitación lista. Ya puede entrar con su correo."); await cargarCuenta(); hojaEquipo();
    } }, "Invitar"), msg);
}

async function hojaPredicciones() {
  const { data } = await supabase.from("predicciones_ia")
    .select("cantidad_a_reordenar, fecha_sugerida_pedido, factor_justificacion_nicho, modelo, creado_en, producto:inventario!prediccion_producto_tenant(nombre, unidad_medida)")
    .eq("empresa_id", empresaId()).order("creado_en", { ascending: false }).limit(30);
  abrirHoja("Predicciones de la IA",
    h("p", { class: "suave" }, "La IA solo sugiere cantidades. Ninguna compra ocurre sin la firma de un encargado."),
    h("ul", { class: "lista" }, ...((data ?? []).length ? (data ?? []).map((x) => h("li", {},
      h("div", {}, h("div", { class: "titulo" }, `${x.producto?.nombre ?? ""}: ${num(x.cantidad_a_reordenar)} ${x.producto?.unidad_medida ?? ""}`),
        h("div", { class: "detalle" }, x.factor_justificacion_nicho), h("div", { class: "detalle" }, `Pedir el ${x.fecha_sugerida_pedido} · ${x.modelo === "regla_base" ? "cálculo base" : "IA"}`)))) : [h("li", { class: "vacio", style: "display:block" }, "Las predicciones aparecen cuando se genera una alerta.")])));
}

async function hojaEmpresa() {
  const { data: e } = await supabase.from("empresas").select("*").eq("id", empresaId()).single();
  const f = {
    nombre: caja("e_nombre", "text", e?.nombre, { maxlength: "150" }),
    nit: caja("e_nit", "text", e?.identificacion_fiscal, { maxlength: "30" }),
  };
  const monedaSel = h("select", { id: "e_moneda" }, ...["COP", "USD", "MXN", "PEN", "CLP", "EUR"].map((m) => h("option", { value: m, selected: e?.moneda === m }, m)));
  const msg = h("div", { role: "status" });
  abrirHoja("Datos de la empresa",
    campo("Nombre comercial", f.nombre), campo("NIT o identificación fiscal", f.nit), campo("Moneda", monedaSel),
    h("button", { class: "boton oro ancho", style: "margin-top:18px", onclick: async (ev) => {
      ev.target.disabled = true;
      const { error } = await supabase.from("empresas").update({ nombre: f.nombre.value.trim(), identificacion_fiscal: f.nit.value.trim() || null, moneda: monedaSel.value }).eq("id", empresaId());
      ev.target.disabled = false;
      if (error) { msg.className = "mensaje error"; msg.textContent = mensajeError(error); return; }
      cerrarHoja(); toast("Datos guardados."); await cargarCuenta();
    } }, "Guardar"), msg);
}

iniciar();
