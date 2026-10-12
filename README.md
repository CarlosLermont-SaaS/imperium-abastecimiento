# IMPERIUM · Abastecimiento inteligente con autorización humana

Producto de **Lermont Signature**. Software como servicio (SaaS) multiempresa y multinicho que vigila el inventario, usa IA para sugerir cuánto comprar y **exige la firma de un encargado humano** antes de crear cualquier orden de compra.

- Sitio y app: https://carloslermont-saas.github.io/imperium-abastecimiento/
- App (panel): `app.html` · Página de firma: `aprobar.html?a=<token>`
- Backend: Supabase (proyecto `iyalcialszfmjdyueqnp`)

## Cómo funciona

1. Cada venta descuenta stock. Al llegar al mínimo se abre un **control de abastecimiento** con ventana fija de 7 días.
2. La IA (o una regla base si el plan no incluye IA) sugiere la cantidad.
3. El encargado recibe WhatsApp y correo con el texto obligatorio y un enlace firmado (UUID + HMAC).
4. Solo una firma humana válida autoriza. Al día 7 se crea la orden; sin firma, se cancela sola.

La regla "la IA nunca compra sola" está dentro de la base de datos (disparadores y funciones `security definer`), no solo en la interfaz.

## Estructura

| Carpeta | Contenido |
|---|---|
| `/` | Página de venta (`index.html`), app (`app.html`), firma (`aprobar.html`), PWA |
| `assets/` | Estilos Lermont Signature (aurora), lógica de la app, `config.js` con enlaces de pago |
| `supabase/sql/` | Esquema, arneses de autorización, cron, planes y suscripciones (en orden 01→05) |
| `supabase/functions/` | 6 Edge Functions: alerta, notificar, autorizar, predicción, ventas, equipo |
| `ia/` | Prompt de sistema y esquema JSON de salida de la IA |
| `make/`, `whatsapp/` | Payload multicanal y plantilla de Meta |
| `docs/` | Guía de configuración y guía de venta por plataforma |

## Planes

| Plan | Precio | Incluye |
|---|---|---|
| Esencial | USD 29/mes | 1 nicho, 150 productos, 3 usuarios, correo |
| Profesional | USD 79/mes | 5 nichos, 2.000 productos, 15 usuarios, IA, WhatsApp |
| Imperial | USD 199/mes | Todo ilimitado, IA, WhatsApp, acompañamiento |

## Documentación

- [docs/CONFIGURACION.md](docs/CONFIGURACION.md): llaves y ajustes que faltan para activar correo, WhatsApp e IA.
- [docs/VENDER.md](docs/VENDER.md): paso a paso para vender en Gumroad, Hotmart, Polar, Mercado Pago y otras.

Los secretos (llaves de API, clave de ventas) **nunca** se guardan en este repositorio: viven en Supabase Vault y en los secretos de las Edge Functions.
