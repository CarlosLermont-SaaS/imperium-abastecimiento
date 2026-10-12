// IMPERIUM · Instalación como app en el celular (service worker + aviso de instalación).
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

let avisoInstalacion = null;
const oyentes = new Set();

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  avisoInstalacion = e;
  oyentes.forEach((f) => f());
});
window.addEventListener("appinstalled", () => { avisoInstalacion = null; oyentes.forEach((f) => f()); });

/** ¿IMPERIUM ya está abierta como app instalada? */
export const instalada = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
/** ¿El navegador ofrece el botón de instalación directa? (Chrome en Android) */
export const puedeInstalar = () => Boolean(avisoInstalacion);
/** Sistema del celular, para mostrar las instrucciones correctas. */
export const sistema = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ? "ios" : /android/i.test(navigator.userAgent) ? "android" : "otro";
/** Avisa cuando cambia la posibilidad de instalar. */
export const alCambiarInstalacion = (f) => { oyentes.add(f); return () => oyentes.delete(f); };
/** Abre el cuadro de instalación del navegador. Devuelve true si la persona aceptó. */
export async function instalar() {
  if (!avisoInstalacion) return false;
  avisoInstalacion.prompt();
  const { outcome } = await avisoInstalacion.userChoice.catch(() => ({ outcome: "dismissed" }));
  avisoInstalacion = null;
  oyentes.forEach((f) => f());
  return outcome === "accepted";
}
