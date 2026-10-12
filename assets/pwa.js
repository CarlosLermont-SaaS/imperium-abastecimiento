// Registro del service worker para instalar IMPERIUM como app en el celular.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
