// IMPERIUM · Botones de compra de las páginas de venta (una plataforma por página)
import { CONFIG } from "./config.js";

const plataforma = document.body.dataset.plataforma;
const NOMBRE = { hotmart: "Hotmart", gumroad: "Gumroad" }[plataforma] ?? plataforma;

for (const zona of document.querySelectorAll(".comprar")) {
  const plan = zona.dataset.plan;
  const url = CONFIG.PAGOS?.[plan]?.[plataforma] ?? "";
  const a = document.createElement("a");
  a.className = "boton oro";
  a.rel = "noopener";
  if (/^https:\/\//.test(url)) {
    a.href = url;
    a.textContent = `Comprar con ${NOMBRE}`;
  } else {
    a.href = `https://wa.me/${CONFIG.SOPORTE_WHATSAPP}?text=${encodeURIComponent(`Hola, quiero el plan ${plan} de IMPERIUM`)}`;
    a.target = "_blank";
    a.textContent = "Quiero este plan";
  }
  zona.append(a);
}

const soporte = document.getElementById("soporte");
if (soporte) soporte.href = `mailto:${CONFIG.SOPORTE_EMAIL}`;
