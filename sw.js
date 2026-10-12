// IMPERIUM · Service worker: guarda la interfaz para abrir rápido; los datos siempre van en vivo.
const VERSION = "imperium-v3";
const ARCHIVOS = ["./", "./index.html", "./app.html", "./aprobar.html", "./assets/estilos.css", "./assets/inicio.css",
  "./assets/app.js", "./assets/comun.js", "./assets/config.js", "./assets/aprobar.js", "./assets/inicio.js", "./assets/pwa.js",
  "./assets/icono.svg", "./manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== VERSION).map((x) => caches.delete(x)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // Supabase y CDNs: siempre en vivo
  e.respondWith(
    fetch(e.request).then((r) => {
      const copia = r.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copia));
      return r;
    }).catch(() => caches.match(e.request)),
  );
});
