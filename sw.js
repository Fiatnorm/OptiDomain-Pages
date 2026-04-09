/**
 * OptiDomain Service Worker v1.0
 *
 * Strategy:
 *  - Static assets  → Cache-first  (fast repeat visits)
 *  - CSV data file  → Network-first + stale fallback  (always fresh, never blank)
 *  - External URLs  → Network-only  (fonts / iframes / itdog)
 */

const CACHE_NAME    = 'optidomain-v32-FINAL';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/script.js',
    '/manifest.json',
    '/ITDOGTcping.webp',
];
const CSV_CACHE_KEY = 'optidomain-csv-snapshot';

// ── Install: pre-cache static shell ──────────────────────────────────────────
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())   // activate immediately
    );
});

// ── Activate: purge old cache versions ───────────────────────────────────────
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// ── Fetch: route-based strategy ───────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
    const { request } = e;
    const url = new URL(request.url);

    // Skip non-GET and cross-origin (fonts, iframe, itdog)
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;

    // HTML pages: Network-first — always fetch latest DOM; cache is only a fallback
    // This prevents the 'permanent HTML lock' when index.html is updated
    if (url.pathname === '/' || url.pathname.endsWith('.html')) {
        e.respondWith(networkFirstHTML(request));
        return;
    }

    // CSV: Network-first → stale snapshot fallback
    if (url.pathname.endsWith('.csv')) {
        e.respondWith(networkFirstCSV(request));
        return;
    }

    // CSS/JS: Stale-While-Revalidate — instant from cache, silent background refresh
    // Solves version staleness for assets without content-hash filenames
    if (url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
        e.respondWith(staleWhileRevalidate(request));
        return;
    }

    // PNG image: Network-first → cache fallback
    if (url.pathname.endsWith('.png') || url.pathname.endsWith('.jpg') || url.pathname.endsWith('.webp')) {
        e.respondWith(networkFirstImage(request));
        return;
    }

    // Static assets: Cache-first → network fallback
    e.respondWith(cacheFirst(request));
});

async function networkFirstHTML(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
    } catch {
        const cached = await cache.match(request);
        return cached ?? new Response('<h1>Offline</h1>', {
            headers: { 'Content-Type': 'text/html' },
            status: 503,
        });
    }
}

async function networkFirstCSV(request) {
    try {
        const res = await fetch(request, { cache: 'no-store' });
        if (res.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(CSV_CACHE_KEY, res.clone());
        }
        return res;
    } catch {
        // Network failed: serve last known good snapshot
        const cached = await caches.match(CSV_CACHE_KEY);
        if (cached) return cached;
        // Return a valid offline placeholder with one data row so the parser doesn't error
        return new Response(
            '## ExecutionTime: Offline\nLine,IP,Latency(ms),Packet Loss(%)\nAllAvg,0.0.0.0,999,100\n',
            { headers: { 'Content-Type': 'text/plain' } }
        );
    }
}

async function staleWhileRevalidate(request) {
    const cache  = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    
    if (cached) {
        // 已有缓存，立即返回缓存资源，后台静默刷新
        fetch(request).then(res => {
            if (res.ok) cache.put(request, res.clone());
        }).catch(() => {}); // 后台刷新失败静默处理
        return cached;
    } else {
        // 无缓存，必须等待网络请求。如果断网直接抛出正常错误给浏览器。
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
    }
}

async function networkFirstImage(request) {
    try {
        const res = await fetch(request);
        if (res.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, res.clone());
        }
        return res;
    } catch {
        // Try cache fallback for images
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response('', { status: 503 });
    }
}

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
        const res = await fetch(request);
        if (res.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, res.clone());
        }
        return res;
    } catch {
        return new Response('Offline', { status: 503 });
    }
}
