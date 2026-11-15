// Cache the interface only. API requests, keys and media never enter this cache.
const CACHE='booru-pocket-shell-v2';
const SHELL=['/','/index.html','/app.mjs','/core.mjs','/library.mjs','/viewing.mjs','/style.css','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/icons/icon-180.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('message',event=>{if(event.data==='APPLY_UPDATE')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith('booru-pocket-shell-')&&name!==CACHE)await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!SHELL.includes(url.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const cached=await cache.match(url.pathname);if(cached)return cached;
    try{const response=await fetch(event.request);return response;}
    catch{return new Response('Интерфейс недоступен без сети. Откройте приложение онлайн.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}

  })());
});
