/* ================================================================
   Service Worker — 刷题助手离线缓存
   ================================================================ */
const CACHE_NAME = 'quiz-app-v37';

const questionImageUrls = [
  './assets/question-images/JXSJ-02-006.webp',
  './assets/question-images/JXSJ-02-007.webp',
  './assets/question-images/JXSJ-02-010.webp',
  './assets/question-images/JXSJ-02-021.webp',
  './assets/question-images/JXSJ-03-005.webp',
  './assets/question-images/JXSJ-03-016.webp',
  './assets/question-images/JXSJ-04-019.webp',
  './assets/question-images/JXSJ-09-018.webp',
  './assets/question-images/JXSJ-10-004.webp',
  './assets/question-images/JXSJ-10-013.webp',
  './assets/question-images/JXSJ-10-014.webp',
  './assets/question-images/JXSJ-10-015.webp',
  './assets/question-images/JXSJ-11-020.webp',
  './assets/question-images/JXSJ-12-005.webp',
  './assets/question-images/MD-FILL-02-007.webp',
  './assets/question-images/MD-FILL-04-016.webp',
  './assets/question-images/MD-FILL-11-017.webp',
  './assets/question-images/MD-FILL-11-018.webp',
  './assets/question-images/MD-FILL-12-005.webp',
  './assets/question-images/JX-PM-021.webp',
  './assets/question-images/JX-LG-028.webp',
  './assets/question-images/JX-LG-029.webp',
  './assets/question-images/JX-TL-014.webp',
  './assets/question-images/JX-LX-015.webp',
  './assets/question-images/JX-LX-016.webp',
  './assets/question-images/JX-TK-LG-019.webp',
  './assets/question-images/JX-TK-LG-021.webp',
  './assets/question-images/JX-TK-LG-038.webp',
  './assets/question-images/JX-TK-LG-041.webp',
  './assets/question-images/JX-TK-CL-044.webp',
  './assets/question-images/JX-TK-CL-045.webp',
  './assets/question-images/JX-TK-LX-017.webp'
];

// 需要预缓存的核心资源
const coreUrls = [
  './',
  './index.html',
  './styles.css',
  './stitch-ui.css',
  './study-engine.js',
  './app.js',
  './data/default-questions.js',
  ...questionImageUrls
];

const externalUrls = [
  'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,400,0,0&display=swap'
];

// 安装：预缓存核心资源
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(coreUrls).then(function() {
        return Promise.all(externalUrls.map(function(url) {
          return cache.add(url).catch(function() {
            // 某些 CDN 资源可能缓存失败，不阻塞本地核心资源安装
          });
        }));
      });
    })
  );
  // 跳过等待，立即激活
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE_NAME; })
          .map(function(n) { return caches.delete(n); })
      );
    })
  );
  // 立即接管所有页面
  self.clients.claim();
});

// 请求拦截：缓存优先，网络回退
self.addEventListener('fetch', function(e) {
  // 只处理 GET 请求
  if (e.request.method !== 'GET') return;

  // 对 Google Fonts 的 CSS 请求做特殊处理（需要 CORS）
  if (e.request.url.includes('fonts.googleapis.com')) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        return cached || fetch(e.request).then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(e.request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // 对其他请求：缓存优先
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        // 只缓存成功的同源响应
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(e.request, clone);
          });
        }
        return response;
      }).catch(function() {
        // 离线时返回一个简单的离线提示页（仅对导航请求）
        if (e.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
