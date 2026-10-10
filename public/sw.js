// Redline service worker: offline app shell plus cached map tiles.
const SHELL = 'redline-shell-v1'
const TILES = 'redline-tiles-v1'
const MAP_HOSTS = ['tiles.openfreemap.org', 'tile.opentopomap.org', 'elevation-tiles-prod']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/index.html', '/manifest.webmanifest', '/favicon.svg'])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('redline-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // Map tiles, styles, fonts and sprites: cache first, fill on the way.
  if (MAP_HOSTS.some((h) => url.hostname.includes(h) || url.pathname.includes(h))) {
    e.respondWith(
      caches.open(TILES).then(async (c) => {
        const hit = await c.match(req)
        if (hit) return hit
        try {
          const res = await fetch(req)
          if (res.ok) c.put(req, res.clone())
          return res
        } catch (err) {
          return hit || Response.error()
        }
      }),
    )
    return
  }

  if (url.origin !== location.origin) return

  // Navigations: network first so updates land, fall back to the cached shell.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(SHELL).then((c) => c.put('/index.html', res.clone()))
          return res
        })
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  // Hashed build assets and icons: cache first.
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && (url.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest)$/.test(url.pathname))) {
            const copy = res.clone()
            caches.open(SHELL).then((c) => c.put(req, copy))
          }
          return res
        }),
    ),
  )
})
