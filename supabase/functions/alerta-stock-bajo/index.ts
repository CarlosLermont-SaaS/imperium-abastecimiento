/**
 * =====================================================================================
 * EDGE FUNCTION · alerta-stock-bajo
 * Webhook receptor de alertas de bajo stock (Fase 1 · bloque 2)
 *
 * Qué hace:
 *   1. Recibe el inventario actual de uno o varios productos (desde Make, un POS, un ERP…).
 *   2. Si se pide sincronizar, registra la diferencia como movimiento de ajuste (libro mayor).
 *   3. Evalúa cada producto contra stock_critico y stock_minimo.
 *   4. Registra/recupera la alerta en control_abastecimiento (idempotente, ventana de 7 días).
 *   5. Devuelve un payload JSON estandarizado por producto, listo para el motor de
 *      automatización o la API del proveedor. Ese payload SIEMPRE sale marcado como
 *      bloqueado hasta autorización humana: la orden real solo nace en el día 7 si un
 *      encargado firmó.
 *
 * Seguridad: cabecera x-webhook-secret (comparación en tiempo constante), validación
 * estricta de entrada, consultas parametrizadas (sin SQL dinámico). Desplegar con verify_jwt = false.
 *
 * Ejemplo de cuerpo:
 * {
 *   "empresa_id": "aaaaaaaa-0000-0000-0000-000000000001",
 *   "sincronizar_stock": true,
 *   "items": [
 *     { "sku": "LECHE-1", "stock_actual": 12, "referencia": "POS-cierre-2026-10-12" },
 *     { "producto_id": "cccccccc-0000-0000-0000-000000000002" }
 *   ]
 * }
 * =====================================================================================
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAX_ITEMS = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SKU_RE = /^[A-Za-z0-9._-]{1,64}$/;

// ---------------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------------
interface ItemEntrada {
  producto_id?: string;
  sku?: string;
  stock_actual?: number;
  referencia?: string;
}

interface Solicitud {
  empresa_id: string;
  sincronizar_stock: boolean;
  items: ItemEntrada[];
}

type Nivel = "critico" | "minimo" | "ok";

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

const num = (v: unknown): number => Number(v ?? 0);
const redondear = (v: number, d = 3): number => Math.round(v * 10 ** d) / 10 ** d;

function validarSolicitud(c: unknown): Solicitud {
  if (!c || typeof c !== "object") throw new ErrorHttp(400, "CUERPO_INVALIDO", "El cuerpo debe ser un objeto JSON.");
  const s = c as Record<string, unknown>;
  if (typeof s.empresa_id !== "string" || !UUID_RE.test(s.empresa_id)) {
    throw new ErrorHttp(400, "EMPRESA_INVALIDA", "empresa_id debe ser un UUID.");
  }
  if (!Array.isArray(s.items) || s.items.length === 0 || s.items.length > MAX_ITEMS) {
    throw new ErrorHttp(400, "ITEMS_INVALIDOS", `items debe tener entre 1 y ${MAX_ITEMS} elementos.`);
  }
  const items: ItemEntrada[] = s.items.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new ErrorHttp(400, "ITEM_INVALIDO", `items[${i}] no es un objeto.`);
    const it = raw as Record<string, unknown>;
    const out: ItemEntrada = {};
    if (it.producto_id !== undefined) {
      if (typeof it.producto_id !== "string" || !UUID_RE.test(it.producto_id)) {
        throw new ErrorHttp(400, "ITEM_INVALIDO", `items[${i}].producto_id debe ser UUID.`);
      }
      out.producto_id = it.producto_id;
    }
    if (it.sku !== undefined) {
      if (typeof it.sku !== "string" || !SKU_RE.test(it.sku)) {
        throw new ErrorHttp(400, "ITEM_INVALIDO", `items[${i}].sku tiene caracteres no permitidos.`);
      }
      out.sku = it.sku;
    }
    if (!out.producto_id && !out.sku) throw new ErrorHttp(400, "ITEM_INVALIDO", `items[${i}] requiere producto_id o sku.`);
    if (it.stock_actual !== undefined) {
      if (typeof it.stock_actual !== "number" || !Number.isFinite(it.stock_actual) || it.stock_actual < 0 || it.stock_actual > 1e10) {
        throw new ErrorHttp(400, "ITEM_INVALIDO", `items[${i}].stock_actual debe ser un número ≥ 0.`);
      }
      out.stock_actual = redondear(it.stock_actual);
    }
    if (it.referencia !== undefined) out.referencia = String(it.referencia).replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 120);
    return out;
  });
  return { empresa_id: s.empresa_id, sincronizar_stock: s.sincronizar_stock === true, items };
}

// ---------------------------------------------------------------------------------
// Consulta de producto con su contexto (nicho, proveedor) – aislada por empresa_id
// ---------------------------------------------------------------------------------
const SELECT_PRODUCTO = `
  id, empresa_id, nicho_id, sku, nombre, unidad_medida, stock_actual, stock_critico, stock_minimo,
  stock_maximo, lote_minimo_compra, costo_unitario, atributos, activo,
  nicho:nichos!inventario_nicho_de_empresa(id, codigo, nombre, lead_time_dias),
  proveedor:proveedores!inventario_proveedor_de_empresa(id, nombre, email, whatsapp_e164, api_endpoint, lead_time_dias)
`;

// deno-lint-ignore no-explicit-any
type Fila = Record<string, any>;

async function buscarProducto(db: SupabaseClient, empresaId: string, item: ItemEntrada): Promise<Fila | null> {
  let q = db.from("inventario").select(SELECT_PRODUCTO).eq("empresa_id", empresaId);
  q = item.producto_id ? q.eq("id", item.producto_id) : q.eq("sku", item.sku!);
  const { data, error } = await q.maybeSingle();
  if (error) throw new ErrorHttp(500, "DB_ERROR", error.message);
  return data as Fila | null;
}

const unir = (x: unknown) => (Array.isArray(x) ? x[0] ?? null : x ?? null);

// ---------------------------------------------------------------------------------
// Payload estandarizado de alerta
// ---------------------------------------------------------------------------------
function construirPayload(p: Fila, control: Fila | null, nivel: Nivel, moneda: string) {
  const nicho = unir(p.nicho);
  const proveedor = unir(p.proveedor);
  const actual = num(p.stock_actual);
  const minimo = num(p.stock_minimo);
  const maximo = p.stock_maximo === null ? null : num(p.stock_maximo);
  const cantidad = control ? num(control.cantidad_sugerida) : 0;
  const costo = num(p.costo_unitario);
  const leadTime = proveedor?.lead_time_dias ?? nicho?.lead_time_dias ?? null;

  return {
    alerta_id: control?.id ?? null,
    tipo: "stock_bajo",
    nivel,
    empresa_id: p.empresa_id,
    nicho: { id: nicho?.id, codigo: nicho?.codigo, nombre: nicho?.nombre },
    producto: {
      id: p.id,
      sku: p.sku,
      nombre: p.nombre,
      unidad_medida: p.unidad_medida,
      atributos_nicho: p.atributos ?? {},
    },
    stock: {
      actual,
      critico: num(p.stock_critico),
      minimo,
      maximo,
      faltante_para_minimo: redondear(Math.max(minimo - actual, 0)),
      faltante_para_maximo: maximo === null ? null : redondear(Math.max(maximo - actual, 0)),
    },
    reposicion: {
      cantidad_sugerida: cantidad,
      fuente_cantidad: control?.metadatos?.fuente_cantidad ?? "regla_base",
      lote_minimo_compra: num(p.lote_minimo_compra),
      costo_unitario: costo,
      costo_estimado: Math.round(cantidad * costo * 100) / 100,
      moneda,
      lead_time_dias: leadTime,
    },
    proveedor: proveedor
      ? {
        id: proveedor.id,
        nombre: proveedor.nombre,
        email: proveedor.email,
        whatsapp_e164: proveedor.whatsapp_e164,
        api_endpoint: proveedor.api_endpoint,
      }
      : null,
    control: control
      ? {
        id: control.id,
        estado: control.estado,
        fecha_deteccion: control.fecha_deteccion,
        fecha_ejecucion_programada: control.fecha_ejecucion_programada,
      }
      : null,
    seguridad: {
      requiere_autorizacion_humana: true,
      compra_bloqueada: control?.estado !== "autorizado",
      motivo: control?.estado === "autorizado"
        ? "autorizado_por_encargado_se_ejecuta_en_fecha_programada"
        : "pendiente_aprobacion_del_encargado",
    },
    // Borrador en formato de API de proveedor. NO debe enviarse: la orden real la crea la base
    // de datos en fecha_ejecucion_programada únicamente si un encargado autorizó.
    orden_proveedor_borrador: control && proveedor
      ? {
        enviar: false,
        no_enviar_antes_de: control.fecha_ejecucion_programada,
        referencia_interna: control.id,
        sku: p.sku,
        descripcion: p.nombre,
        cantidad,
        unidad: p.unidad_medida,
        precio_unitario_referencia: costo,
        moneda,
        atributos: p.atributos ?? {},
      }
      : null,
  };
}

// ---------------------------------------------------------------------------------
// Proceso
// ---------------------------------------------------------------------------------
async function procesar(db: SupabaseClient, s: Solicitud) {
  const { data: empresa, error: eEmp } = await db.from("empresas").select("id, moneda, activo").eq("id", s.empresa_id).maybeSingle();
  if (eEmp) throw new ErrorHttp(500, "DB_ERROR", eEmp.message);
  if (!empresa || !empresa.activo) throw new ErrorHttp(404, "EMPRESA_NO_ENCONTRADA", "La empresa no existe o está inactiva.");

  const alertas: unknown[] = [];
  const errores: Array<{ indice: number; codigo: string; mensaje: string }> = [];
  let sinCambios = 0, enMinimo = 0, enCritico = 0, sincronizados = 0;

  for (let i = 0; i < s.items.length; i++) {
    const item = s.items[i];
    try {
      let p = await buscarProducto(db, s.empresa_id, item);
      if (!p) { errores.push({ indice: i, codigo: "PRODUCTO_NO_ENCONTRADO", mensaje: `No existe ${item.sku ?? item.producto_id} en la empresa.` }); continue; }
      if (!p.activo) { errores.push({ indice: i, codigo: "PRODUCTO_INACTIVO", mensaje: `${p.sku} está inactivo.` }); continue; }

      // Sincronización como ajuste contable (no se pisa el stock sin rastro)
      if (s.sincronizar_stock && item.stock_actual !== undefined) {
        const delta = redondear(item.stock_actual - num(p.stock_actual));
        if (delta !== 0) {
          const { error } = await db.from("movimientos_inventario").insert({
            empresa_id: p.empresa_id,
            nicho_id: p.nicho_id,
            producto_id: p.id,
            tipo: delta > 0 ? "ajuste_positivo" : "ajuste_negativo",
            cantidad: Math.abs(delta),
            referencia: item.referencia ?? "sincronizacion_webhook",
            atributos: { origen: "alerta-stock-bajo" },
            registrado_por: null,
          });
          if (error) throw new ErrorHttp(500, "DB_ERROR", error.message);
          sincronizados++;
          p = (await buscarProducto(db, s.empresa_id, { producto_id: p.id }))!;
        }
      }

      const actual = num(p.stock_actual);
      const nivel: Nivel = actual <= num(p.stock_critico) ? "critico" : actual <= num(p.stock_minimo) ? "minimo" : "ok";
      if (nivel === "ok") { sinCambios++; continue; }
      if (nivel === "critico") enCritico++; else enMinimo++;

      const { data: control, error: eRpc } = await db.rpc("registrar_alerta_stock", {
        p_producto_id: p.id,
        p_origen: "webhook_alerta",
        p_metadatos: { referencia: item.referencia ?? null },
      });
      if (eRpc) throw new ErrorHttp(500, "DB_ERROR", eRpc.message);

      alertas.push(construirPayload(p, (control as Fila | null)?.id ? control as Fila : null, nivel, empresa.moneda));
    } catch (e) {
      errores.push({ indice: i, codigo: e instanceof ErrorHttp ? e.codigo : "ERROR_ITEM", mensaje: (e as Error).message.slice(0, 300) });
    }
  }

  return {
    ok: errores.length === 0,
    evento: "inventario.evaluacion_stock",
    version: "1.0",
    empresa_id: s.empresa_id,
    evaluado_en: new Date().toISOString(),
    resumen: {
      evaluados: s.items.length,
      en_minimo: enMinimo,
      en_critico: enCritico,
      sin_alerta: sinCambios,
      stock_sincronizado: sincronizados,
      errores: errores.length,
    },
    alertas,
    errores,
  };
}

// ---------------------------------------------------------------------------------
// Servidor
// ---------------------------------------------------------------------------------
Deno.serve(async (req) => {
  const idSolicitud = crypto.randomUUID();
  try {
    if (req.method !== "POST") throw new ErrorHttp(405, "METODO_NO_PERMITIDO", "Use POST.");
    if (!SERVICE_KEY || !SUPABASE_URL) {
      throw new ErrorHttp(500, "CONFIGURACION_INCOMPLETA", "Faltan secretos de la función.");
    }
    const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const cfg = await obtenerConfig(db);
    if (!cfg.secreto_webhook_interno || !compararSeguro(req.headers.get("x-webhook-secret") ?? "", cfg.secreto_webhook_interno)) {
      throw new ErrorHttp(401, "NO_AUTORIZADO", "Credencial de webhook inválida.");
    }
    if (Number(req.headers.get("content-length") ?? "0") > 256_000) {
      throw new ErrorHttp(413, "CUERPO_DEMASIADO_GRANDE", "Máximo 256 KB por llamada.");
    }
    const solicitud = validarSolicitud(await req.json().catch(() => null));
    const resultado = await procesar(db, solicitud);
    return respuesta(resultado.errores.length && !resultado.alertas.length && resultado.resumen.sin_alerta === 0 ? 422 : 200,
      { ...resultado, id_solicitud: idSolicitud });
  } catch (e) {
    const err = e instanceof ErrorHttp ? e : new ErrorHttp(500, "ERROR_INTERNO", "Error inesperado.");
    if (!(e instanceof ErrorHttp)) console.error(idSolicitud, e);
    return respuesta(err.status, {
      ok: false,
      error: { codigo: err.codigo, mensaje: err.message, http_status: err.status, id_solicitud: idSolicitud, fecha: new Date().toISOString() },
    });
  }
});
