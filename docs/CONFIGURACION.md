# Configuración final (todo desde el celular)

El backend ya está instalado y probado. Estos ajustes activan el correo, WhatsApp y la IA. Todo se hace en el navegador del celular, en https://supabase.com/dashboard/project/iyalcialszfmjdyueqnp

## 1. Correo de acceso con código (obligatorio)

Los clientes entran con un código de 6 dígitos que llega al correo.

1. Supabase → **Authentication** → **Emails** → plantilla **Magic Link**.
2. Asunto: `Tu código de acceso a IMPERIUM`
3. En el cuerpo, asegúrese de que aparezca `{{ .Token }}`. Ejemplo:
   `Tu código para entrar a IMPERIUM es: {{ .Token }} — vence en 1 hora.`
4. **Authentication** → **URL Configuration** → Site URL: `https://carloslermont-saas.github.io/imperium-abastecimiento/app.html`

## 2. Resend (correo real, recomendado)

El correo gratuito de Supabase solo envía unos pocos mensajes por hora.

1. Cree cuenta en https://resend.com con su Gmail.
2. **API Keys** → Create → copie la llave (empieza por `re_`).
3. Supabase → **Authentication** → **Emails** → **SMTP Settings** → activar:
   host `smtp.resend.com`, puerto `465`, usuario `resend`, contraseña = la llave.
4. Si aún no tiene dominio propio, Resend solo deja enviar a su propio correo. Para vender, compre un dominio barato (por ejemplo en Namecheap o Hostinger) y verifíquelo en Resend → Domains.

## 3. Secretos de las Edge Functions

Supabase → **Edge Functions** → **Secrets** → Add new secret. Agregue solo los que use:

| Nombre | Para qué | Dónde se consigue |
|---|---|---|
| `RESEND_API_KEY` | Alertas y bienvenida por correo | Resend → API Keys |
| `EMAIL_REMITENTE` | Remitente, ej. `IMPERIUM <alertas@sudominio.com>` | Su dominio verificado |
| `ANTHROPIC_API_KEY` | IA de predicción (planes Profesional e Imperial) | console.anthropic.com → API Keys |
| `WHATSAPP_TOKEN` | Alertas por WhatsApp | Meta for Developers → WhatsApp → token permanente |
| `WHATSAPP_PHONE_ID` | Número emisor de WhatsApp | Meta → WhatsApp → API Setup |
| `HOTMART_HOTTOK` | Verificar ventas de Hotmart | Hotmart → Herramientas → Webhook |
| `POLAR_WEBHOOK_SECRET` | Verificar ventas de Polar | Polar → Settings → Webhooks |
| `GUMROAD_ACCESS_TOKEN` | Verificar ventas de Gumroad | Gumroad → Settings → Advanced → Application |
| `MP_ACCESS_TOKEN` | Verificar suscripciones de Mercado Pago | Mercado Pago Developers → Credenciales de producción |
| `MAKE_WEBHOOK_URL` (opcional) | Enviar alertas por Make en vez de directo | Make → escenario con webhook |

Sin `ANTHROPIC_API_KEY` el sistema sigue funcionando con la regla base (promedio de ventas × días de cobertura).

## 4. Plantilla de WhatsApp en Meta

1. Meta Business → WhatsApp Manager → **Plantillas** → Crear.
2. Use el contenido de `whatsapp/plantilla_meta_alerta_abastecimiento.json` (nombre `alerta_abastecimiento`, categoría Utilidad, idioma español).
3. Espere la aprobación (minutos a 24 h).

## 5. Enlaces de pago en la página

Cuando tenga los enlaces de cada plataforma, edite `assets/config.js` en GitHub (ícono del lápiz) y péguelos en `PAGOS`. Al guardar, la página se actualiza sola en 1–2 minutos. Mientras estén vacíos, los botones abren su WhatsApp de ventas.
