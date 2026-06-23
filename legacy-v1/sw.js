const CACHE_NAME = "academic-spad-v17";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./styles.css?v=10",
  "./script.js",
  "./script.js?v=14",
  "./manifest.webmanifest",
  "./data/courses.json",
  "./data/syllabus.json",
  "./data/assessment-rules.json",
  "./data/course-assessments.json",
  "./assets/icons/icon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-192.svg",
  "./assets/icons/icon-512.svg",
  "./assets/screenshots/dashboard-placeholder.svg",
  "./assets/screenshots/mobile-placeholder.svg",
  "./assets/screenshots/social-preview.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchAndCache = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => {
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
          return cached;
        });

      return cached || fetchAndCache;
    })
  );
});
