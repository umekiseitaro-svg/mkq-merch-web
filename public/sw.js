// 電波が完全にない状態からアプリを開いても画面が表示できるようにするための
// アプリの外側（HTML/JS）だけのキャッシュ。データ本体はキャッシュしない
// （/api/ 配下は常にネットワークへ通す。データのオフライン保持は
// mkq-app.js 側の localStorage 保存で別途行う）。
//
// 通信できる時は常にネットワークを優先し、取れた場合だけキャッシュを
// 更新する（network-first）。取れない時だけキャッシュから返す。
// これにより、以前修正したHTML/JSのバージョンずれ問題を再発させない。
"use strict";
var CACHE_NAME = "mkq-shell-v1";

self.addEventListener("install", function(event){
  self.skipWaiting();
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE_NAME; })
            .map(function(k){ return caches.delete(k); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(event){
  var req = event.request;
  if(req.method !== "GET") return;

  var url = new URL(req.url);
  if(url.origin !== self.location.origin) return;
  if(url.pathname.indexOf("/api/") === 0) return;

  event.respondWith(
    fetch(req).then(function(res){
      if(res && res.ok){
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copy); });
      }
      return res;
    }).catch(function(){
      return caches.match(req).then(function(cached){
        return cached || caches.match("/");
      });
    })
  );
});
