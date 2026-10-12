// =====================================================================
// IMPERIUM · Configuración pública (no contiene secretos)
// La clave "publishable" de Supabase es pública por diseño: la seguridad
// la dan el inicio de sesión, las políticas RLS y la firma de los enlaces.
// =====================================================================
export const CONFIG = {
  SUPABASE_URL: "https://iyalcialszfmjdyueqnp.supabase.co",
  SUPABASE_KEY: "sb_publishable_6mrWIAQ4YP8HfWRq-Ckp7w_90meGYWO",

  // Enlaces de pago por plan. Pegue aquí el enlace de su producto en cada plataforma.
  // El botón "Comprar" de la página de inicio usa el primero que tenga valor.
  PAGOS: {
    esencial:    { gumroad: "", hotmart: "", polar: "", mercadopago: "" },
    profesional: { gumroad: "", hotmart: "", polar: "", mercadopago: "" },
    imperial:    { gumroad: "", hotmart: "", polar: "", mercadopago: "" },
  },

  SOPORTE_EMAIL: "lermontsignature.oficial@gmail.com",
  SOPORTE_WHATSAPP: "573026915491",
};
