// IMPERIUM · Botones de compra de la página de inicio (sin dependencias externas)
import { CONFIG } from "./config.js";

const NOMBRES = { gumroad: "Gumroad", hotmart: "Hotmart", polar: "tarjeta internacional (Polar)", mercadopago: "Mercado Pago (PSE, Efecty, tarjeta)" };

for (const zona of document.querySelectorAll(".comprar")) {
  const plan = zona.dataset.plan;
  const enlaces = Object.entries(CONFIG.PAGOS?.[plan] ?? {}).filter(([, url]) => /^https:\/\//.test(url));
  if (enlaces.length === 0) {
    const a = document.createElement("a");
    a.className = "boton oro";
    a.href = `https://wa.me/${CONFIG.SOPORTE_WHATSAPP}?text=${encodeURIComponent(`Hola, quiero el plan ${plan} de IMPERIUM`)}`;
    a.target = "_blank"; a.rel = "noopener";
    a.textContent = "Quiero este plan";
    zona.append(a);
    continue;
  }
  enlaces.forEach(([plataforma, url], i) => {
    const a = document.createElement("a");
    a.className = i === 0 ? "boton oro" : "boton";
    a.href = url; a.target = "_blank"; a.rel = "noopener";
    a.textContent = `Pagar con ${NOMBRES[plataforma] ?? plataforma}`;
    zona.append(a);
  });
}

const soporte = document.getElementById("soporte");
if (soporte) soporte.href = `mailto:${CONFIG.SOPORTE_EMAIL}`;
