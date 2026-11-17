/**
 * sw.js — Service Worker lưu sẵn giao diện (app shell) trên máy.
 * Nhờ đó khi máy chủ tạm tắt / mất mạng, thu ngân vẫn mở được trang và làm việc
 * với dữ liệu ngoại tuyến (localStorage). Dữ liệu API KHÔNG được cache ở đây —
 * phần đó do api.js xử lý.
 *
 * Chiến lược: network-first (luôn lấy bản mới nhất khi có kết nối), lỗi mạng -> dùng bản đã lưu.
 */
const CACHE = 'vattu-shell-v1';
const SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/utils.js',
  '/js/app.js',
  '/js/api.js',
  '/js/invoice.js',
  '/js/products.js',
  '/js/history.js',
  '/js/dashboard.js',
  '/favicon.svg',
  '/vendor/fontawesome/css/fontawesome.min.css',
  '/vendor/fontawesome/css/solid.min.css',
  '/vendor/fontawesome/css/regular.min.css',
  '/vendor/fontawesome/webfonts/fa-solid-900.woff2',
  '/vendor/fontawesome/webfonts/fa-regular-400.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => {
          if (hit) return hit;
          if (req.mode === 'navigate') return caches.match('/index.html');
          return Response.error();
        })
      )
  );
});
