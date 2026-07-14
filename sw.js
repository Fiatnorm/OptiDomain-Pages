const CACHE_NAME = 'optidomain-v36-ip-data';
const STATIC_ASSETS = ['/', '/index.html', '/styles.css', '/script.js', '/manifest.json', '/Tcptest.webp'];
const DATA_CACHE_KEY = 'optidomain-ip-data-snapshot';

self.addEventListener('install', event => event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
    if (url.pathname.endsWith('optimized_cf_ips.txt')) { event.respondWith(networkFirstData(event.request)); return; }
    if (url.pathname.endsWith('.html') || url.pathname === '/') { event.respondWith(networkFirst(event.request)); return; }
    event.respondWith(staleWhileRevalidate(event.request, event));
});
async function networkFirstData(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response.ok) {
            await cache.put(DATA_CACHE_KEY, response.clone());
            return response;
        }
        return (await cache.match(DATA_CACHE_KEY)) || response;
    } catch {
        return (await cache.match(DATA_CACHE_KEY)) || new Response('', { status: 503, statusText: 'Node data unavailable' });
    }
}
async function networkFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const response = await fetch(request);
        if (response.ok) {
            await cache.put(request, response.clone());
            return response;
        }
        return (await cache.match(request)) || response;
    } catch {
        return (await cache.match(request)) || new Response('Offline', { status: 503 });
    }
}
async function staleWhileRevalidate(request, event) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const network = fetch(request)
        .then(async response => {
            if (response.ok) await cache.put(request, response.clone());
            return response;
        })
        .catch(() => cached || new Response('Offline', { status: 503 }));
    event.waitUntil(network.then(() => undefined));
    return cached || network;
}
