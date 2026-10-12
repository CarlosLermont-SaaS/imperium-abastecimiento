# Vender IMPERIUM con cobro mensual automático

Cada plataforma avisa a IMPERIUM cuando alguien paga, renueva o cancela. IMPERIUM crea la cuenta del cliente, le envía la bienvenida y corta el acceso si deja de pagar. Usted no tiene que hacer nada a mano.

**Regla de oro:** el nombre del plan (`Esencial`, `Profesional` o `Imperial`) debe aparecer en el nombre del nivel, variante o producto. Así IMPERIUM sabe qué plan activar.

**URL de aviso (webhook):**
`https://iyalcialszfmjdyueqnp.supabase.co/functions/v1/ventas-webhook?plataforma=PLATAFORMA&clave=SU_CLAVE`
La clave se entrega por chat y no se publica aquí. Cambie `PLATAFORMA` por `gumroad`, `hotmart`, `polar`, `mercadopago` o `generica`.

## Páginas de venta listas
- Hotmart: https://carloslermont-saas.github.io/imperium-abastecimiento/venta-hotmart.html
- Gumroad: https://carloslermont-saas.github.io/imperium-abastecimiento/venta-gumroad.html
Cada página muestra solo los botones de su plataforma (los toma de `assets/config.js`).
Acceso del comprador después de pagar: https://carloslermont-saas.github.io/imperium-abastecimiento/app.html

## Gumroad
1. gumroad.com → New product → **Membership**. Nombre: `IMPERIUM`.
2. Tiers: `Esencial` USD 29, `Profesional` USD 79, `Imperial` USD 199, cobro mensual.
3. En el contenido, ponga el enlace `https://carloslermont-saas.github.io/imperium-abastecimiento/app.html` e indique: "Entre con el mismo correo de su compra".
4. Settings → Advanced → **Ping**: pegue la URL con `plataforma=gumroad`.
5. Publique y copie el enlace en `assets/config.js`.
6. Payouts: Gumroad paga a Colombia por PayPal o Payoneer.

## Hotmart
1. hotmart.com → Productos → Crear → **Suscripción**. Cree tres planes con esos nombres y precios.
2. Área de miembros externa: el mismo enlace de `app.html`.
3. Herramientas → **Webhook (API y notificaciones)** → nueva configuración, versión 2.0.0, URL con `plataforma=hotmart`, todos los eventos de compra y suscripción.
4. Copie el **Hottok** y guárdelo como secreto `HOTMART_HOTTOK`.
5. Copie cada link de pago en `config.js`.

## Polar (tarjeta internacional, paga a Colombia)
1. polar.sh → cree una organización → Products → tres productos mensuales con esos nombres.
2. Settings → Webhooks → Add endpoint, formato Raw, URL con `plataforma=polar`, eventos `subscription.*` y `order.paid`.
3. Copie el secreto y guárdelo como `POLAR_WEBHOOK_SECRET`.
4. Copie los Checkout Links en `config.js`.

## Mercado Pago Suscripciones (PSE, Efecty, tarjetas en Colombia)
1. mercadopago.com.co → Tu negocio → **Suscripciones** → crear tres planes; en el título incluya el nombre del plan.
2. Developers → Tus integraciones → Webhooks → URL con `plataforma=mercadopago`, evento **Planes y suscripciones**.
3. Credenciales de producción → Access Token → secreto `MP_ACCESS_TOKEN`.
4. Copie el enlace de cada plan en `config.js`.

## Otras plataformas (Whop, Paddle, Lemon Squeezy, Creem, Payhip)
Cree el producto mensual en la plataforma y conecte su aviso de venta a Make con un escenario que envíe a la URL con `plataforma=generica` un JSON como este:
`{"email":"cliente@correo.com","nombre":"Ana","plan":"profesional","estado":"activa","id_evento":"ID_UNICO","referencia":"ID_SUSCRIPCION"}`
Estados válidos: `activa`, `prueba`, `pausada`, `cancelada`, `vencida`.

## Después de cada venta
- El cliente recibe el correo de bienvenida y entra con su correo en `app.html` (código de 6 dígitos).
- Si la venta llega sin plan reconocible, se activa `Profesional` por defecto.
- Las cancelaciones y reembolsos cortan el acceso al final del periodo.
