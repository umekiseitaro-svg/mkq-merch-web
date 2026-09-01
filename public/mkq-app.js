(function(){
  "use strict";
  var SIG_SEP = "␟";

  // 最新公演（MKQ2026 鹿島・武雄）の品目構成。最初の公演を作るときの初期値としてのみ使う。
  var DEFAULT_ITEMS = (function(){
    var rows = [
      ["Tシャツ","馬　半袖","白","S",3800],
      ["Tシャツ","馬　半袖","白","M",3800],
      ["Tシャツ","馬　半袖","白","L",3800],
      ["Tシャツ","馬　半袖","白","XL",3800],
      ["Tシャツ","馬　長袖","黒","S",4500],
      ["Tシャツ","馬　長袖","黒","M",4500],
      ["Tシャツ","馬　長袖","黒","L",4500],
      ["Tシャツ","馬　長袖","黒","XL",4500],
      ["CD","ロマンスカー","","",2000],
      ["CD","さみしいだけ","","",2000],
      ["CD","ファックミー","","",2000],
      ["CD","ワイチャイ","","",2500],
      ["CD","営業中","","",2700]
    ];
    return rows.map(function(r, i){
      return {id:"i"+(i+1), category:r[0], name:r[1], color:r[2], size:r[3], price:r[4]};
    });
  })();

  function uid(prefix){ return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  function cloneItems(items){
    return items.map(function(it){
      return { id: uid("i"), category: it.category, name: it.name, color: it.color, size: it.size, price: it.price };
    });
  }


  var state = { events: [], activeEventId: null, series: [] };

  // ---------- オフライン対応: アプリの外側（HTML/JS）はService Workerが、
  // データ本体はここでのlocalStorage保存が受け持つ。 ----------
  // mkq-app.jsはnext/scriptのafterInteractiveで読み込まれ、その時点で
  // ブラウザのloadイベントは既に発火済みのことが多いため、loadイベント
  // 待ちにはせず、この場ですぐ登録する。
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("/sw.js").catch(function(){});
  }

  var LOCAL_STATE_KEY = "mkqMerchState_v1";

  function saveLocalState(){
    try{
      localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state));
    }catch(e){
      // 保存容量超過などは無視（サーバー保存が本体、ローカルはあくまで保険）
    }
  }

  function loadLocalState(){
    try{
      var raw = localStorage.getItem(LOCAL_STATE_KEY);
      if(!raw) return null;
      var parsed = JSON.parse(raw);
      if(parsed && Array.isArray(parsed.events)) return parsed;
    }catch(e){}
    return null;
  }

  var usingLocalFallback = false;
  var syncPending = false;
  var browserOffline = (typeof navigator !== "undefined" && "onLine" in navigator) ? !navigator.onLine : false;

  function updateSyncBadge(){
    var el = document.getElementById("sync-status");
    if(!el) return;
    if(syncPending){
      el.textContent = "⚠ 未保存の変更があります（通信復旧時に自動保存されます）";
      el.className = "sync-badge warn";
      el.style.display = "block";
    }else if(usingLocalFallback){
      el.textContent = "オフラインの保存データを表示中です（通信復旧で同期します）";
      el.className = "sync-badge info";
      el.style.display = "block";
    }else if(browserOffline){
      el.textContent = "オフラインです（操作は続けられ、復旧時に自動保存されます）";
      el.className = "sync-badge info";
      el.style.display = "block";
    }else{
      el.style.display = "none";
    }
  }

  window.addEventListener("online", function(){
    browserOffline = false;
    updateSyncBadge();
    if(syncPending) doSave();
  });
  window.addEventListener("offline", function(){
    browserOffline = true;
    updateSyncBadge();
  });

  function loadStateFromServer(){
    return fetch("/api/state")
      .then(function(res){
        if(res.status === 401){ window.location.href = "/login"; return null; }
        if(!res.ok) throw new Error("load failed: " + res.status);
        return res.json();
      })
      .then(function(data){
        if(data && data.state && Array.isArray(data.state.events)){
          state = data.state;
          if(!Array.isArray(state.series)) state.series = [];
          usingLocalFallback = false;
          updateSyncBadge();
        }
      })
      .catch(function(){
        var cached = loadLocalState();
        if(cached){
          state = cached;
          if(!Array.isArray(state.series)) state.series = [];
          usingLocalFallback = true;
          updateSyncBadge();
          return;
        }
        openModal({
          message: "データの読み込みに失敗しました。通信状況を確認して、ページを再読み込みしてください。",
          showInput: false,
          confirmLabel: "再読み込み",
          danger: false,
          onConfirm: function(){ window.location.reload(); }
        });
      });
  }

  var saveTimer = null;
  var SAVE_DEBOUNCE_MS = 800;
  var saveInFlight = false;
  var savePending = false;

  function save(){
    saveLocalState();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, SAVE_DEBOUNCE_MS);
  }

  function doSave(){
    if(saveInFlight){ savePending = true; return; }
    saveInFlight = true;
    fetch("/api/state", {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({state: state})
    }).then(function(res){
      if(res.status === 401){ window.location.href = "/login"; return; }
      if(!res.ok) throw new Error("save failed: " + res.status);
      syncPending = false;
      usingLocalFallback = false;
      updateSyncBadge();
    }).catch(function(){
      // 通信エラー: onlineイベントか次の保存タイミングで再試行される
      syncPending = true;
      updateSyncBadge();
    }).then(function(){
      saveInFlight = false;
      if(savePending){ savePending = false; doSave(); }
    });
  }


  function formatJPY(n){
    n = Math.round(n || 0);
    var sign = n < 0 ? "-" : "";
    return sign + "¥" + Math.abs(n).toLocaleString("ja-JP");
  }

  function getEvent(id){
    for(var i=0;i<state.events.length;i++){ if(state.events[i].id===id) return state.events[i]; }
    return null;
  }
  function getActiveEvent(){ return state.activeEventId ? getEvent(state.activeEventId) : null; }

  function getItemInEvent(ev, itemId){
    if(!ev) return null;
    for(var i=0;i<ev.items.length;i++){ if(ev.items[i].id===itemId) return ev.items[i]; }
    return null;
  }

  function getStock(ev, itemId){
    if(!ev) return {before:null, after:null, gifted:0};
    if(!ev.stock) ev.stock = {};
    if(!ev.stock[itemId]) ev.stock[itemId] = {before:null, after:null, gifted:0};
    if(ev.stock[itemId].gifted == null) ev.stock[itemId].gifted = 0; // 旧データ（進呈数を持たない）を補う
    return ev.stock[itemId];
  }

  // 在庫の減少（前-後）のうち、進呈数を差し引いた分だけを「販売」として売上に計上する。
  // 現物の在庫チェック（前-後）自体は進呈があっても変わらない。
  // getStock()は呼ばない（読むだけのはずの集計処理で、触れていない全品目分の
  // stockエントリを作ってしまう副作用を避けるため）。
  function computeItem(ev, itemId){
    var item = getItemInEvent(ev, itemId);
    if(!item) return {sold:0, amount:0, gifted:0, consumed:0};
    var stock = (ev.stock && ev.stock[itemId]) ? ev.stock[itemId] : {before:null, after:null, gifted:0};
    var before = stock.before == null ? 0 : Number(stock.before);
    var after = stock.after == null ? 0 : Number(stock.after);
    var gifted = Number(stock.gifted) || 0;
    var consumed = before - after;
    var sold = consumed - gifted;
    return {sold: sold, amount: sold * (Number(item.price) || 0), gifted: gifted, consumed: consumed};
  }

  function eventTotal(ev){
    var total = 0, count = 0, giftedCount = 0;
    if(ev){
      ev.items.forEach(function(it){
        var r = computeItem(ev, it.id);
        total += r.amount; count += r.sold; giftedCount += r.gifted;
      });
    }
    return {total:total, count:count, giftedCount:giftedCount};
  }

  // ---------- cash float (おつり) ----------
  var CASH_DENOMS = [10000,5000,2000,1000,500,100,50,10,5,1];
  var CASH_DENOM_LABELS = {
    10000:"1万円", 5000:"5千円", 2000:"2千円", 1000:"千円",
    500:"500円", 100:"100円", 50:"50円", 10:"10円", 5:"5円", 1:"1円"
  };

  function getCashFloat(ev){
    if(!ev) return {before:{}, after:{}};
    if(!ev.cashFloat) ev.cashFloat = {before:{}, after:{}};
    if(!ev.cashFloat.before) ev.cashFloat.before = {};
    if(!ev.cashFloat.after) ev.cashFloat.after = {};
    return ev.cashFloat;
  }

  function cashTotal(counts){
    if(!counts) return 0;
    var total = 0;
    CASH_DENOMS.forEach(function(d){
      var n = Number(counts[d]);
      if(n) total += n * d;
    });
    return total;
  }

  // 現金過不足 = 公演後のおつり合計 - 公演前のおつり合計 - 売上（レジ・集計タブでの実売上、進呈は除く）。
  // レジは決済方法（現金／それ以外）を区別していないため、現金以外の決済が混ざっていると
  // この差額は正確な過不足を示さない点に注意（既知の制約）。
  function computeCashDiff(ev){
    var cf = getCashFloat(ev);
    var beforeTotal = cashTotal(cf.before);
    var afterTotal = cashTotal(cf.after);
    var sales = eventTotal(ev).total;
    return afterTotal - beforeTotal - sales;
  }

  function itemLabel(item){
    var parts = [];
    if(item.name) parts.push(item.name);
    if(item.color) parts.push(item.color);
    if(item.size) parts.push(item.size);
    return parts.join(" / ");
  }

  function itemSignature(item){
    return [item.category, item.name, item.color, item.size].join(SIG_SEP);
  }

  function groupByCategory(items){
    var order = [], map = {};
    items.forEach(function(it){
      var cat = it.category || "その他";
      if(!map[cat]){ map[cat] = []; order.push(cat); }
      map[cat].push(it);
    });
    return order.map(function(cat){ return {category:cat, items:map[cat]}; });
  }

  // ---------- tabs ----------
  var tabButtons = document.querySelectorAll(".tab-btn");
  var tabPanels = { tally: document.getElementById("tab-tally"), summary: document.getElementById("tab-summary"), events: document.getElementById("tab-events"), items: document.getElementById("tab-items"), register: document.getElementById("tab-register") };

  function showTab(name){
    tabButtons.forEach(function(b){ b.classList.toggle("active", b.dataset.tab===name); });
    Object.keys(tabPanels).forEach(function(k){ tabPanels[k].classList.toggle("active", k===name); });
    if(name==="tally") renderTally();
    if(name==="summary") renderSummary();
    if(name==="events") renderEvents();
    if(name==="items") renderItemsTab();
    if(name==="register") renderRegister();
  }
  tabButtons.forEach(function(b){ b.addEventListener("click", function(){ showTab(b.dataset.tab); }); });

  // ---------- header ----------
  function renderHeader(){
    var pill = document.getElementById("event-pill");
    var ev = getActiveEvent();
    if(!ev){
      pill.className = "event-pill none";
      pill.innerHTML = '<span>公演が選択されていません</span><span class="arrow">＋公演を追加 ▸</span>';
    }else{
      var t = eventTotal(ev);
      pill.className = "event-pill";
      pill.innerHTML = '<span>' + escapeHTML(ev.label) + (ev.date ? "（" + ev.date + "）" : "") + '</span><span class="arrow">' + formatJPY(t.total) + ' ▸</span>';
    }
  }
  document.getElementById("event-pill").addEventListener("click", openEventSwitcher);

  // ---------- event switcher (quick-switch from the header pill, without leaving the current tab) ----------
  function openEventSwitcher(){
    var list = document.getElementById("event-switcher-list");
    if(state.events.length === 0){
      list.innerHTML = '<p class="note">まだ公演がありません。「公演管理を開く」から追加してください。</p>';
    }else{
      list.innerHTML = state.events.map(function(ev){
        var t = eventTotal(ev);
        var active = ev.id === state.activeEventId;
        return '' +
          '<div class="event-card' + (active?' active':'') + '" data-switch-event="' + ev.id + '">' +
            '<div class="info">' +
              '<div class="name">' + escapeHTML(ev.label) + (active ? '（選択中）' : '') + '</div>' +
              '<div class="meta">' + (ev.date ? ev.date + " ・ " : "") + t.count + "点 ・ " + formatJPY(t.total) + '</div>' +
            '</div>' +
          '</div>';
      }).join("");
    }
    document.getElementById("event-switcher-overlay").style.display = "flex";
  }

  function closeEventSwitcher(){
    document.getElementById("event-switcher-overlay").style.display = "none";
  }

  document.getElementById("event-switcher-list").addEventListener("click", function(e){
    var card = e.target.closest("[data-switch-event]");
    if(!card) return;
    state.activeEventId = card.dataset.switchEvent;
    save();
    closeEventSwitcher();
    renderHeader();
    var activeBtn = document.querySelector(".tab-btn.active");
    showTab(activeBtn ? activeBtn.dataset.tab : "tally");
  });

  document.getElementById("event-switcher-close").addEventListener("click", closeEventSwitcher);
  document.getElementById("event-switcher-manage").addEventListener("click", function(){
    closeEventSwitcher();
    showTab("events");
  });
  document.getElementById("event-switcher-overlay").addEventListener("click", function(e){
    if(e.target === document.getElementById("event-switcher-overlay")) closeEventSwitcher();
  });

  function escapeHTML(s){
    return String(s==null?"":s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  // ---------- modal (replaces native confirm()/prompt(), which some embedded browsers block or ignore) ----------
  var modalOnConfirm = null;
  var modalOverlay = document.getElementById("modal-overlay");
  var modalMessage = document.getElementById("modal-message");
  var modalInput = document.getElementById("modal-input");
  var modalConfirmBtn = document.getElementById("modal-confirm");
  var modalCancelBtn = document.getElementById("modal-cancel");

  function openModal(opts){
    modalMessage.textContent = opts.message;
    if(opts.showInput){
      modalInput.style.display = "block";
      modalInput.value = opts.inputValue || "";
    }else{
      modalInput.style.display = "none";
    }
    modalConfirmBtn.textContent = opts.confirmLabel || "OK";
    modalConfirmBtn.className = "btn " + (opts.danger ? "danger" : "primary");
    modalOnConfirm = opts.onConfirm || null;
    modalOverlay.style.display = "flex";
    if(opts.showInput){
      setTimeout(function(){ modalInput.focus(); modalInput.select(); }, 0);
    }
  }

  function closeModal(){
    modalOverlay.style.display = "none";
    modalOnConfirm = null;
  }

  function showConfirm(message, onConfirm, opts){
    openModal({
      message: message,
      showInput: false,
      confirmLabel: (opts && opts.confirmLabel) || "削除",
      danger: !opts || opts.danger !== false,
      onConfirm: function(){ onConfirm(); }
    });
  }

  function showPrompt(message, defaultValue, onSubmit){
    openModal({
      message: message,
      showInput: true,
      inputValue: defaultValue,
      confirmLabel: "保存",
      danger: false,
      onConfirm: function(){ onSubmit(modalInput.value); }
    });
  }

  modalCancelBtn.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", function(e){
    if(e.target === modalOverlay) closeModal();
  });
  modalConfirmBtn.addEventListener("click", function(){
    var cb = modalOnConfirm;
    closeModal();
    if(cb) cb();
  });
  modalInput.addEventListener("keydown", function(e){
    if(e.key === "Enter"){ e.preventDefault(); modalConfirmBtn.click(); }
  });

  // ---------- tally tab ----------
  function renderTally(){
    var ev = getActiveEvent();
    var container = document.getElementById("tally-groups");
    var empty = document.getElementById("tally-empty");
    if(!ev){
      container.innerHTML = "";
      empty.style.display = "block";
      document.getElementById("tally-total").textContent = formatJPY(0);
      document.getElementById("tally-count").textContent = "0点";
      return;
    }
    empty.style.display = "none";
    var groups = groupByCategory(ev.items);
    container.innerHTML = groups.map(function(g){
      var rows = g.items.map(function(it){
        var stock = getStock(ev, it.id);
        var r = computeItem(ev, it.id);
        var sub = itemLabel(it);
        return '' +
          '<div class="item-card">' +
            '<div class="item-info">' +
              '<span class="item-name">' + escapeHTML(sub || it.category) + '</span>' +
              '<span class="item-price">' + formatJPY(it.price) + '</span>' +
            '</div>' +
            '<div class="item-inputs">' +
              '<div class="field"><label>前</label><input type="number" inputmode="numeric" min="0" data-role="before" data-item="' + it.id + '" value="' + (stock.before==null?"":stock.before) + '"></div>' +
              '<div class="field"><label>後</label><input type="number" inputmode="numeric" min="0" data-role="after" data-item="' + it.id + '" value="' + (stock.after==null?"":stock.after) + '"></div>' +
              '<div class="field"><label>進呈</label><input type="number" inputmode="numeric" min="0" data-role="gifted" data-item="' + it.id + '" value="' + (stock.gifted?stock.gifted:"") + '"></div>' +
              '<div class="item-result' + (r.sold<0?' negative':'') + '" data-result="' + it.id + '">' +
                '<div class="sold" data-sold="' + it.id + '">' + r.sold + '点' + (r.gifted ? '<span class="gifted-tag">進呈' + r.gifted + '</span>' : '') + '</div>' +
                '<div class="amount" data-amount="' + it.id + '">' + formatJPY(r.amount) + '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
      }).join("");
      var catTotal = g.items.reduce(function(sum, it){ return sum + computeItem(ev, it.id).amount; }, 0);
      return '' +
        '<details class="category" open>' +
          '<summary><span>' + escapeHTML(g.category) + '</span><span class="cat-total" data-cat-total="' + escapeHTML(g.category) + '">' + formatJPY(catTotal) + '</span></summary>' +
          rows +
        '</details>';
    }).join("");
    updateTotals();
  }

  document.getElementById("tally-groups").addEventListener("input", function(e){
    var t = e.target;
    if(!t.matches("input[data-item]")) return;
    var ev = getActiveEvent();
    if(!ev) return;
    var itemId = t.dataset.item;
    var role = t.dataset.role;
    var stock = getStock(ev, itemId);
    var val = t.value === "" ? null : Number(t.value);
    stock[role] = val;
    save();
    updateComputedForItem(itemId);
  });

  function updateComputedForItem(itemId){
    var ev = getActiveEvent();
    if(!ev) return;
    var r = computeItem(ev, itemId);
    var soldEl = document.querySelector('[data-sold="' + itemId + '"]');
    var amtEl = document.querySelector('[data-amount="' + itemId + '"]');
    var resultEl = document.querySelector('[data-result="' + itemId + '"]');
    if(soldEl) soldEl.innerHTML = r.sold + "点" + (r.gifted ? '<span class="gifted-tag">進呈' + r.gifted + '</span>' : "");
    if(amtEl) amtEl.textContent = formatJPY(r.amount);
    if(resultEl) resultEl.classList.toggle("negative", r.sold < 0);
    updateTotals();
  }

  function updateTotals(){
    var ev = getActiveEvent();
    if(!ev) return;
    var t = eventTotal(ev);
    document.getElementById("tally-total").textContent = formatJPY(t.total);
    document.getElementById("tally-count").textContent = t.count + "点";
    var giftedNote = document.getElementById("tally-gifted-note");
    if(t.giftedCount > 0){
      giftedNote.textContent = "うち進呈: " + t.giftedCount + "点（売上には含まれません）";
      giftedNote.style.display = "block";
    }else{
      giftedNote.style.display = "none";
    }
    var catTotals = {};
    ev.items.forEach(function(it){
      var cat = it.category || "その他";
      catTotals[cat] = (catTotals[cat]||0) + computeItem(ev, it.id).amount;
    });
    Object.keys(catTotals).forEach(function(cat){
      var el = document.querySelector('[data-cat-total="' + cssEscape(cat) + '"]');
      if(el) el.textContent = formatJPY(catTotals[cat]);
    });
    renderHeader();
  }

  function cssEscape(s){
    return String(s).replace(/["\\]/g, "\\$&");
  }

  // ---------- register tab (quick order entry: enter quantity, see live total, checkout applies to stock.after) ----------
  var registerOrder = {}; // itemId -> qty, this order only (cleared on checkout or leaving the tab)

  function renderRegister(){
    var ev = getActiveEvent();
    var container = document.getElementById("register-groups");
    var empty = document.getElementById("register-empty");
    closeRegisterCheckout();
    document.getElementById("register-confirm").style.display = "none";
    document.getElementById("register-gift-toggle").checked = false;
    registerOrder = {};
    if(!ev){
      container.innerHTML = "";
      empty.style.display = "block";
      document.getElementById("register-total").textContent = formatJPY(0);
      document.getElementById("register-count").textContent = "0点";
      return;
    }
    empty.style.display = "none";
    var groups = groupByCategory(ev.items);
    container.innerHTML = groups.map(function(g){
      var rows = g.items.map(function(it){
        var sub = itemLabel(it);
        return '' +
          '<div class="item-card">' +
            '<div class="item-info">' +
              '<span class="item-name">' + escapeHTML(sub || it.category) + '</span>' +
              '<span class="item-price">' + formatJPY(it.price) + '</span>' +
            '</div>' +
            '<div class="register-inputs">' +
              '<button type="button" class="qty-btn" data-act="qty-dec" data-item="' + it.id + '">−</button>' +
              '<input type="number" inputmode="numeric" min="0" class="qty-input" data-item="' + it.id + '" value="0">' +
              '<button type="button" class="qty-btn" data-act="qty-inc" data-item="' + it.id + '">＋</button>' +
              '<span class="register-item-amount" data-reg-amount="' + it.id + '">' + formatJPY(0) + '</span>' +
            '</div>' +
          '</div>';
      }).join("");
      return '' +
        '<details class="category" open>' +
          '<summary><span>' + escapeHTML(g.category) + '</span></summary>' +
          rows +
        '</details>';
    }).join("");
    updateRegisterTotals();
    renderRegisterHistory(ev);
  }

  function formatTime(iso){
    try{
      var d = new Date(iso);
      var hh = String(d.getHours()).padStart(2, "0");
      var mm = String(d.getMinutes()).padStart(2, "0");
      return hh + ":" + mm;
    }catch(e){ return ""; }
  }

  function renderRegisterHistory(ev){
    var container = document.getElementById("register-history");
    var log = (ev && ev.registerLog) ? ev.registerLog : [];
    if(log.length === 0){
      container.innerHTML = '<p class="note">まだ会計履歴がありません。</p>';
      return;
    }
    var sorted = log.slice().reverse();
    container.innerHTML = sorted.map(function(entry){
      var linesHtml = entry.lines.map(function(l){
        return '<div>' + escapeHTML(l.label) + ' ×' + l.qty + '</div>';
      }).join("");
      return '' +
        '<div class="history-card">' +
          '<div>' +
            '<div class="time">' + formatTime(entry.at) + (entry.gifted ? '<span class="gifted-tag">プレゼント</span>' : '') + '</div>' +
            '<div class="lines">' + linesHtml + '</div>' +
            '<div class="amount">' + (entry.gifted ? formatJPY(entry.total) + '相当（計上なし）' : formatJPY(entry.total)) + '</div>' +
          '</div>' +
          '<button type="button" class="btn small danger" data-act="undo-sale" data-entry="' + entry.id + '">取り消す</button>' +
        '</div>';
    }).join("");
  }

  document.getElementById("register-history").addEventListener("click", function(e){
    var btn = e.target.closest('button[data-act="undo-sale"]');
    if(!btn) return;
    var ev = getActiveEvent();
    if(!ev || !ev.registerLog) return;
    var entryId = btn.dataset.entry;
    var entry = ev.registerLog.find(function(x){ return x.id === entryId; });
    if(!entry) return;
    var msg = entry.gifted
      ? "このプレゼント（" + formatJPY(entry.total) + "相当）を取り消しますか？在庫（後の数）が元に戻ります。"
      : "この会計（" + formatJPY(entry.total) + "）を取り消しますか？在庫（後の数）が元に戻ります。";
    showConfirm(msg, function(){
      entry.lines.forEach(function(l){
        var stock = getStock(ev, l.itemId);
        stock.after = (stock.after == null ? 0 : stock.after) + l.qty;
        if(entry.gifted){
          stock.gifted = Math.max(0, (Number(stock.gifted) || 0) - l.qty);
        }
      });
      ev.registerLog = ev.registerLog.filter(function(x){ return x.id !== entryId; });
      save();
      renderRegisterHistory(ev);
      renderHeader();
    }, {confirmLabel:"取り消す"});
  });

  function updateRegisterTotals(){
    var ev = getActiveEvent();
    if(!ev) return;
    var total = 0, count = 0;
    ev.items.forEach(function(it){
      var qty = registerOrder[it.id] || 0;
      total += qty * (Number(it.price) || 0);
      count += qty;
    });
    document.getElementById("register-total").textContent = formatJPY(total);
    document.getElementById("register-count").textContent = count + "点";
    document.getElementById("register-popup-total").textContent = formatJPY(total);
    document.getElementById("register-popup-count").textContent = count + "点";
  }

  function setRegisterQty(itemId, qty){
    qty = Math.max(0, Math.floor(Number(qty) || 0));
    if(qty === 0){ delete registerOrder[itemId]; } else { registerOrder[itemId] = qty; }
    var input = document.querySelector('.qty-input[data-item="' + itemId + '"]');
    if(input && Number(input.value) !== qty) input.value = qty;
    var ev = getActiveEvent();
    var item = ev ? getItemInEvent(ev, itemId) : null;
    var amountEl = document.querySelector('[data-reg-amount="' + itemId + '"]');
    if(amountEl && item) amountEl.textContent = formatJPY(qty * (Number(item.price) || 0));
    updateRegisterTotals();
  }

  document.getElementById("register-groups").addEventListener("click", function(e){
    var btn = e.target.closest("button[data-act]");
    if(!btn) return;
    var itemId = btn.dataset.item;
    var current = registerOrder[itemId] || 0;
    if(btn.dataset.act === "qty-inc") setRegisterQty(itemId, current + 1);
    if(btn.dataset.act === "qty-dec") setRegisterQty(itemId, current - 1);
  });

  document.getElementById("register-groups").addEventListener("input", function(e){
    var t = e.target;
    if(!t.matches(".qty-input")) return;
    setRegisterQty(t.dataset.item, t.value);
  });

  function clearRegisterOrder(){
    registerOrder = {};
    document.querySelectorAll(".qty-input").forEach(function(input){ input.value = 0; });
    document.querySelectorAll("[data-reg-amount]").forEach(function(el){ el.textContent = formatJPY(0); });
    document.getElementById("register-gift-toggle").checked = false;
    updateRegisterTotals();
  }

  // ---------- レジ: 「今回の注文合計」をタップして開く会計ポップアップ ----------
  function openRegisterCheckout(){
    if(!getActiveEvent()) return;
    document.getElementById("register-checkout-overlay").style.display = "flex";
  }
  function closeRegisterCheckout(){
    document.getElementById("register-checkout-overlay").style.display = "none";
  }

  document.getElementById("register-total-bar").addEventListener("click", openRegisterCheckout);
  document.getElementById("register-total-bar").addEventListener("keydown", function(e){
    if(e.key === "Enter" || e.key === " "){ e.preventDefault(); openRegisterCheckout(); }
  });
  document.getElementById("register-checkout-close").addEventListener("click", closeRegisterCheckout);
  document.getElementById("register-checkout-overlay").addEventListener("click", function(e){
    if(e.target === document.getElementById("register-checkout-overlay")) closeRegisterCheckout();
  });

  document.getElementById("register-clear").addEventListener("click", function(){
    clearRegisterOrder();
    document.getElementById("register-confirm").style.display = "none";
    closeRegisterCheckout();
  });

  document.getElementById("register-checkout").addEventListener("click", function(){
    var ev = getActiveEvent();
    if(!ev) return;
    var itemIds = Object.keys(registerOrder).filter(function(id){ return registerOrder[id] > 0; });
    if(itemIds.length === 0) return;
    var isGift = document.getElementById("register-gift-toggle").checked;
    var total = 0, count = 0;
    var lines = [];
    itemIds.forEach(function(id){
      var qty = registerOrder[id];
      var item = getItemInEvent(ev, id);
      if(!item) return;
      var stock = getStock(ev, id);
      var currentAfter = stock.after != null ? stock.after : (stock.before != null ? stock.before : 0);
      stock.after = currentAfter - qty;
      if(isGift){
        stock.gifted = (Number(stock.gifted) || 0) + qty;
      }
      var amount = qty * (Number(item.price) || 0);
      total += amount;
      count += qty;
      lines.push({ itemId: id, label: itemLabel(item) || item.category, qty: qty, price: item.price, amount: amount });
    });
    if(!ev.registerLog) ev.registerLog = [];
    ev.registerLog.push({ id: uid("r"), at: new Date().toISOString(), lines: lines, total: total, count: count, gifted: isGift });
    save();
    var confirmMsg = document.getElementById("register-confirm");
    confirmMsg.textContent = isGift
      ? "プレゼントとして記録しました：" + count + "点 ・ " + formatJPY(total) + "相当（売上には計上されません）"
      : "会計しました：" + count + "点 ・ " + formatJPY(total);
    confirmMsg.style.display = "block";
    clearRegisterOrder();
    closeRegisterCheckout();
    renderRegisterHistory(ev);
    renderHeader();
  });

  // ---------- summary tab (aggregate across events by item signature, since each event has its own item list) ----------
  function currentSummaryFilter(){
    var sel = document.getElementById("summary-series-filter");
    return sel && sel.value ? sel.value : null;
  }

  function eventsForSummary(seriesId){
    return seriesId ? state.events.filter(function(ev){ return ev.seriesId === seriesId; }) : state.events;
  }

  function buildSummary(seriesId){
    var order = [], map = {};
    eventsForSummary(seriesId).forEach(function(ev){
      ev.items.forEach(function(it){
        var sig = itemSignature(it);
        var r = computeItem(ev, it.id);
        if(!map[sig]){
          map[sig] = { category: it.category, name: it.name, color: it.color, size: it.size, price: it.price, count: 0, amount: 0, giftedCount: 0 };
          order.push(sig);
        }
        map[sig].price = it.price;
        map[sig].count += r.sold;
        map[sig].amount += r.amount;
        map[sig].giftedCount += r.gifted;
      });
    });
    return order.map(function(sig){ return map[sig]; });
  }

  function renderSummary(){
    var seriesId = currentSummaryFilter();
    var tbody = document.getElementById("summary-tbody");
    var rows = buildSummary(seriesId);
    var grandCount = 0, grandAmount = 0, grandGifted = 0;
    if(rows.length === 0){
      tbody.innerHTML = '<tr><td colspan="5" class="note">まだデータがありません。</td></tr>';
    }else{
      tbody.innerHTML = rows.map(function(r){
        grandCount += r.count; grandAmount += r.amount; grandGifted += r.giftedCount;
        return '<tr><td>' + escapeHTML((r.category?r.category+" ":"") + itemLabel(r)) + '</td>' +
          '<td class="num">' + formatJPY(r.price) + '</td>' +
          '<td class="num">' + r.count + '</td>' +
          '<td class="num">' + (r.giftedCount || "") + '</td>' +
          '<td class="num">' + formatJPY(r.amount) + '</td></tr>';
      }).join("");
    }
    document.getElementById("summary-grand-count").textContent = grandCount;
    document.getElementById("summary-grand-gifted").textContent = grandGifted;
    document.getElementById("summary-grand-amount").textContent = formatJPY(grandAmount);

    var list = document.getElementById("event-summary-list");
    var evs = eventsForSummary(seriesId);
    if(evs.length === 0){
      list.innerHTML = '<p class="note">' + (seriesId ? "このシリーズにはまだ公演がありません。" : "まだ公演がありません。") + '</p>';
    }else{
      list.innerHTML = evs.map(function(ev){
        var t = eventTotal(ev);
        return '<div class="event-card"><div class="info"><div class="name">' + escapeHTML(ev.label) + '</div>' +
          '<div class="meta">' + (ev.date ? ev.date + " ・ " : "") + t.count + "点 ・ " + formatJPY(t.total) + (t.giftedCount ? " ・ 進呈" + t.giftedCount + "点" : "") + '</div></div></div>';
      }).join("");
    }
  }

  document.getElementById("summary-series-filter").addEventListener("change", renderSummary);

  document.getElementById("export-summary-csv").addEventListener("click", function(){
    var seriesId = currentSummaryFilter();
    var rows = buildSummary(seriesId);
    var lines = ["カテゴリ,デザイン,カラー,サイズ,単価,合計販売数,進呈数,合計売上"];
    var grandCount = 0, grandAmount = 0, grandGifted = 0;
    rows.forEach(function(r){
      grandCount += r.count; grandAmount += r.amount; grandGifted += r.giftedCount;
      lines.push([r.category, r.name, r.color, r.size, r.price, r.count, r.giftedCount, r.amount].map(csvField).join(","));
    });
    lines.push(["合計","","","","",grandCount,grandGifted,grandAmount].map(csvField).join(","));
    var filenamePart = seriesId ? seriesName(seriesId) : "全体";
    downloadCSV(lines.join("\n"), "MKQ物販_品目集計_" + filenamePart + ".csv");
  });

  document.getElementById("export-events-csv").addEventListener("click", function(){
    var seriesId = currentSummaryFilter();
    var lines = ["公演名,日付,販売点数,進呈数,売上"];
    var grandCount = 0, grandAmount = 0, grandGifted = 0;
    eventsForSummary(seriesId).forEach(function(ev){
      var t = eventTotal(ev);
      grandCount += t.count; grandAmount += t.total; grandGifted += t.giftedCount;
      lines.push([ev.label, ev.date, t.count, t.giftedCount, t.total].map(csvField).join(","));
    });
    lines.push(["合計","",grandCount,grandGifted,grandAmount].map(csvField).join(","));
    var filenamePart = seriesId ? seriesName(seriesId) : "全体";
    downloadCSV(lines.join("\n"), "MKQ物販_公演別売上_" + filenamePart + ".csv");
  });

  function csvField(v){
    v = v==null ? "" : String(v);
    if(/[",\n]/.test(v)) v = '"' + v.replace(/"/g,'""') + '"';
    return v;
  }
  function downloadCSV(content, filename){
    var data = "\uFEFF" + content;
    var blob = new Blob([data], {type:"text/csv;charset=utf-8;"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  // ---------- series (groups of events, e.g. one tour) ----------
  function getSeriesById(id){
    if(!id) return null;
    for(var i=0;i<state.series.length;i++){ if(state.series[i].id === id) return state.series[i]; }
    return null;
  }
  function seriesName(id){
    var s = getSeriesById(id);
    return s ? s.name : "";
  }
  function seriesEventTotal(seriesId){
    var total = 0, count = 0;
    state.events.forEach(function(ev){
      if(ev.seriesId !== seriesId) return;
      var t = eventTotal(ev);
      total += t.total; count += t.count;
    });
    return {total:total, count:count};
  }

  function renderSeriesList(){
    var list = document.getElementById("series-list");
    if(state.series.length === 0){
      list.innerHTML = '<p class="note">まだシリーズがありません。下のフォームから追加してください。</p>';
    }else{
      list.innerHTML = state.series.map(function(s){
        var evCount = state.events.filter(function(ev){ return ev.seriesId === s.id; }).length;
        var t = seriesEventTotal(s.id);
        return '' +
          '<div class="series-card">' +
            '<div class="info">' +
              '<div class="name">' + escapeHTML(s.name) + '</div>' +
              '<div class="meta">' + evCount + '公演 ・ ' + t.count + '点 ・ ' + formatJPY(t.total) + '</div>' +
            '</div>' +
            '<div class="actions">' +
              '<button class="btn small" data-series-act="rename" data-series="' + s.id + '">名称</button>' +
              '<button class="btn small danger" data-series-act="delete" data-series="' + s.id + '">削除</button>' +
            '</div>' +
          '</div>';
      }).join("");
    }
  }

  document.getElementById("series-list").addEventListener("click", function(e){
    var btn = e.target.closest("button[data-series-act]");
    if(!btn) return;
    var id = btn.dataset.series;
    var act = btn.dataset.seriesAct;
    var s = getSeriesById(id);
    if(!s) return;
    if(act === "rename"){
      showPrompt("シリーズ名を編集", s.name, function(name){
        if(name != null && name.trim() !== ""){
          s.name = name.trim();
          save();
          renderEvents();
        }
      });
    }else if(act === "delete"){
      showConfirm('「' + s.name + '」を削除します。所属する公演のシリーズ指定が解除されます。よろしいですか？', function(){
        state.series = state.series.filter(function(x){ return x.id !== id; });
        state.events.forEach(function(ev){ if(ev.seriesId === id) ev.seriesId = null; });
        save();
        renderEvents();
      }, {confirmLabel:"削除"});
    }
  });

  document.getElementById("new-series-label").addEventListener("input", function(){
    document.getElementById("new-series-error").style.display = "none";
  });

  document.getElementById("new-series-form").addEventListener("submit", function(e){
    e.preventDefault();
    var labelInput = document.getElementById("new-series-label");
    var label = labelInput.value.trim();
    var errorEl = document.getElementById("new-series-error");
    if(!label){
      errorEl.style.display = "block";
      labelInput.focus();
      return;
    }
    errorEl.style.display = "none";
    state.series.push({ id: uid("s"), name: label });
    save();
    labelInput.value = "";
    renderEvents();
  });

  function seriesOptionsHTML(selectedId){
    return state.series.map(function(s){
      return '<option value="' + s.id + '"' + (s.id === selectedId ? ' selected' : '') + '>' + escapeHTML(s.name) + '</option>';
    }).join("");
  }

  function refreshSeriesSelects(){
    var newEventSelect = document.getElementById("new-event-series");
    var activeEv = getActiveEvent();
    var defaultSeriesId = activeEv ? activeEv.seriesId : null;
    newEventSelect.innerHTML = '<option value="">（シリーズ未設定）</option>' + seriesOptionsHTML(defaultSeriesId || "");

    var filterSelect = document.getElementById("summary-series-filter");
    var currentFilter = filterSelect.value;
    filterSelect.innerHTML = '<option value="">すべての公演（シリーズ絞り込みなし）</option>' + seriesOptionsHTML(currentFilter);
  }

  // ---------- events tab ----------
  function formatCashDiff(diff){
    if(diff === 0) return "±¥0（過不足なし）";
    return (diff > 0 ? "+" : "") + formatJPY(diff) + (diff > 0 ? "（過剰）" : "（不足）");
  }

  function cashFieldsHTML(ev, phase){
    var cf = getCashFloat(ev);
    var counts = cf[phase];
    return CASH_DENOMS.map(function(d){
      var val = counts[d];
      return '<div class="field">' +
        '<label>' + CASH_DENOM_LABELS[d] + '</label>' +
        '<input type="number" inputmode="numeric" min="0" ' +
          'data-cash-event="' + ev.id + '" data-cash-phase="' + phase + '" data-cash-denom="' + d + '" ' +
          'value="' + (val==null ? "" : val) + '">' +
      '</div>';
    }).join("");
  }

  function cashSectionHTML(ev){
    var diff = computeCashDiff(ev);
    return '' +
      '<details class="category cash-details">' +
        '<summary><span>おつり管理</span><span class="cat-total" data-cash-diff="' + ev.id + '">' + formatCashDiff(diff) + '</span></summary>' +
        '<div class="item-card">' +
          '<div class="cash-section-title">公演前</div>' +
          '<div class="cash-grid">' + cashFieldsHTML(ev, "before") + '</div>' +
          '<div class="cash-subtotal">前 合計: <span data-cash-subtotal="' + ev.id + ':before">' + formatJPY(cashTotal(getCashFloat(ev).before)) + '</span></div>' +
        '</div>' +
        '<div class="item-card">' +
          '<div class="cash-section-title">公演後</div>' +
          '<div class="cash-grid">' + cashFieldsHTML(ev, "after") + '</div>' +
          '<div class="cash-subtotal">後 合計: <span data-cash-subtotal="' + ev.id + ':after">' + formatJPY(cashTotal(getCashFloat(ev).after)) + '</span></div>' +
        '</div>' +
        '<div class="item-card cash-diff-card' + (diff !== 0 ? ' cash-diff-warn' : '') + '" data-cash-diff-card="' + ev.id + '">' +
          '<div class="cash-diff-line">現金過不足（後の合計 − 前の合計 − 売上）</div>' +
          '<div class="cash-diff-amount" data-cash-diff-detail="' + ev.id + '">' + formatCashDiff(diff) + '</div>' +
        '</div>' +
      '</details>';
  }

  function updateCashDisplays(ev){
    var cf = getCashFloat(ev);
    var beforeTotal = cashTotal(cf.before);
    var afterTotal = cashTotal(cf.after);
    var diff = computeCashDiff(ev);
    var beforeEl = document.querySelector('[data-cash-subtotal="' + ev.id + ':before"]');
    var afterEl = document.querySelector('[data-cash-subtotal="' + ev.id + ':after"]');
    var diffBadge = document.querySelector('[data-cash-diff="' + ev.id + '"]');
    var diffDetail = document.querySelector('[data-cash-diff-detail="' + ev.id + '"]');
    var diffCard = document.querySelector('[data-cash-diff-card="' + ev.id + '"]');
    if(beforeEl) beforeEl.textContent = formatJPY(beforeTotal);
    if(afterEl) afterEl.textContent = formatJPY(afterTotal);
    if(diffBadge) diffBadge.textContent = formatCashDiff(diff);
    if(diffDetail) diffDetail.textContent = formatCashDiff(diff);
    if(diffCard) diffCard.classList.toggle("cash-diff-warn", diff !== 0);
  }

  function renderEvents(){
    renderSeriesList();
    refreshSeriesSelects();
    var list = document.getElementById("event-list");
    if(state.events.length === 0){
      list.innerHTML = '<p class="note">まだ公演がありません。下のフォームから最初の公演を追加してください。</p>';
    }else{
      list.innerHTML = state.events.map(function(ev){
        var t = eventTotal(ev);
        var active = ev.id === state.activeEventId;
        return '' +
          '<div class="event-card has-cash' + (active?' active':'') + '">' +
            '<div class="event-card-row">' +
              '<div class="info">' +
                '<div class="name">' + escapeHTML(ev.label) + (active ? '（選択中）' : '') + '</div>' +
                '<div class="meta">' + (ev.date ? ev.date + " ・ " : "") + t.count + "点 ・ " + formatJPY(t.total) + '</div>' +
                (ev.seriesId ? '<div><span class="series-tag">' + escapeHTML(seriesName(ev.seriesId)) + '</span></div>' : '') +
                '<select class="series-assign" data-event="' + ev.id + '">' +
                  '<option value="">（シリーズ未設定）</option>' + seriesOptionsHTML(ev.seriesId || "") +
                '</select>' +
              '</div>' +
              '<div class="actions">' +
                (active ? '' : '<button class="btn small" data-act="select" data-event="' + ev.id + '">選択</button>') +
                '<button class="btn small" data-act="rename" data-event="' + ev.id + '">名称</button>' +
                '<button class="btn small danger" data-act="delete" data-event="' + ev.id + '">削除</button>' +
              '</div>' +
            '</div>' +
            cashSectionHTML(ev) +
          '</div>';
      }).join("");
    }
  }

  document.getElementById("event-list").addEventListener("click", function(e){
    var btn = e.target.closest("button[data-act]");
    if(!btn) return;
    var id = btn.dataset.event;
    var act = btn.dataset.act;
    if(act === "select"){
      state.activeEventId = id;
      save();
      renderEvents(); renderHeader();
      showTab("tally");
    }else if(act === "rename"){
      var ev = getEvent(id);
      showPrompt("公演名を編集", ev.label, function(name){
        if(name != null && name.trim() !== ""){
          ev.label = name.trim();
          save();
          renderEvents(); renderHeader();
        }
      });
    }else if(act === "delete"){
      var ev2 = getEvent(id);
      showConfirm('「' + ev2.label + '」を削除します。よろしいですか？', function(){
        state.events = state.events.filter(function(e2){ return e2.id !== id; });
        if(state.activeEventId === id){
          state.activeEventId = state.events.length ? state.events[state.events.length-1].id : null;
        }
        save();
        renderEvents(); renderHeader();
      }, {confirmLabel:"削除"});
    }
  });

  document.getElementById("event-list").addEventListener("change", function(e){
    var sel = e.target.closest(".series-assign");
    if(!sel) return;
    var ev = getEvent(sel.dataset.event);
    if(!ev) return;
    ev.seriesId = sel.value || null;
    save();
    renderSeriesList();
  });

  document.getElementById("event-list").addEventListener("input", function(e){
    var input = e.target.closest("[data-cash-denom]");
    if(!input) return;
    var ev = getEvent(input.dataset.cashEvent);
    if(!ev) return;
    var cf = getCashFloat(ev);
    var val = input.value === "" ? null : Math.max(0, parseInt(input.value, 10) || 0);
    cf[input.dataset.cashPhase][input.dataset.cashDenom] = val;
    save();
    updateCashDisplays(ev);
  });

  document.getElementById("new-event-label").addEventListener("input", function(){
    document.getElementById("new-event-error").style.display = "none";
  });

  document.getElementById("new-event-form").addEventListener("submit", function(e){
    e.preventDefault();
    var labelInput = document.getElementById("new-event-label");
    var dateInput = document.getElementById("new-event-date");
    var seriesSelect = document.getElementById("new-event-series");
    var carryOver = document.getElementById("carry-over").checked;
    var label = labelInput.value.trim();
    var errorEl = document.getElementById("new-event-error");
    if(!label){
      errorEl.style.display = "block";
      labelInput.focus();
      return;
    }
    errorEl.style.display = "none";

    var prevEvent = getActiveEvent() || (state.events.length ? state.events[state.events.length - 1] : null);
    var sourceItems = prevEvent ? prevEvent.items : DEFAULT_ITEMS;
    var newItems = cloneItems(sourceItems);
    var newEvent = { id: uid("e"), label: label, date: dateInput.value || "", items: newItems, stock: {}, seriesId: seriesSelect.value || null };

    var afterBySignature = {};
    if(prevEvent){
      prevEvent.items.forEach(function(it){
        afterBySignature[itemSignature(it)] = getStock(prevEvent, it.id).after;
      });
    }
    newItems.forEach(function(it){
      var carried = carryOver ? afterBySignature[itemSignature(it)] : null;
      newEvent.stock[it.id] = { before: carried == null ? null : carried, after: null };
    });

    state.events.push(newEvent);
    state.activeEventId = newEvent.id;
    save();

    labelInput.value = "";
    dateInput.value = "";
    renderEvents(); renderHeader();
    showTab("tally");
  });

  // ---------- items tab (scoped to the active event) ----------
  function renderItemsTab(){
    var tbody = document.getElementById("items-tbody");
    var empty = document.getElementById("items-empty");
    var addBtn = document.getElementById("add-item");
    var ev = getActiveEvent();
    if(!ev){
      tbody.innerHTML = "";
      empty.style.display = "block";
      addBtn.disabled = true;
      return;
    }
    empty.style.display = "none";
    addBtn.disabled = false;

    var categories = [];
    ev.items.forEach(function(it){
      if(it.category && categories.indexOf(it.category) === -1) categories.push(it.category);
    });
    document.getElementById("category-options").innerHTML = categories.map(function(c){
      return '<option value="' + escapeHTML(c) + '">';
    }).join("");

    tbody.innerHTML = ev.items.map(function(it, idx){
      return '<tr data-item="' + it.id + '">' +
        '<td><input type="text" data-field="category" list="category-options" value="' + escapeHTML(it.category) + '"></td>' +
        '<td><input type="text" data-field="name" value="' + escapeHTML(it.name) + '"></td>' +
        '<td><input type="text" data-field="color" value="' + escapeHTML(it.color) + '"></td>' +
        '<td><input type="text" data-field="size" value="' + escapeHTML(it.size) + '"></td>' +
        '<td class="num"><input type="number" data-field="price" value="' + it.price + '"></td>' +
        '<td class="row-actions">' +
          '<button class="btn small" data-act="move-up"' + (idx===0 ? ' disabled' : '') + '>▲</button>' +
          '<button class="btn small" data-act="move-down"' + (idx===ev.items.length-1 ? ' disabled' : '') + '>▼</button>' +
        '</td>' +
        '<td class="row-actions">' +
          '<button class="btn small" data-act="duplicate-item">複製</button>' +
          '<button class="btn small danger" data-act="delete-item">削除</button>' +
        '</td>' +
      '</tr>';
    }).join("");
  }

  document.getElementById("items-tbody").addEventListener("input", function(e){
    var t = e.target;
    if(!t.matches("input[data-field]")) return;
    var ev = getActiveEvent();
    if(!ev) return;
    var tr = t.closest("tr");
    var id = tr.dataset.item;
    var item = getItemInEvent(ev, id);
    if(!item) return;
    var field = t.dataset.field;
    item[field] = field === "price" ? (Number(t.value) || 0) : t.value;
    save();
  });

  document.getElementById("items-tbody").addEventListener("click", function(e){
    var btn = e.target.closest("button[data-act]");
    if(!btn || btn.disabled) return;
    var ev = getActiveEvent();
    if(!ev) return;
    var tr = btn.closest("tr");
    var id = tr.dataset.item;
    var idx = ev.items.findIndex(function(i){ return i.id === id; });
    if(idx === -1) return;
    var act = btn.dataset.act;

    if(act === "delete-item"){
      var item = ev.items[idx];
      showConfirm('「' + (itemLabel(item) || item.category) + '」を削除しますか？（選択中の公演のみ）', function(){
        ev.items = ev.items.filter(function(i){ return i.id !== id; });
        if(ev.stock) delete ev.stock[id];
        save();
        renderItemsTab();
      }, {confirmLabel:"削除"});
    }else if(act === "move-up" && idx > 0){
      ev.items.splice(idx - 1, 0, ev.items.splice(idx, 1)[0]);
      save();
      renderItemsTab();
    }else if(act === "move-down" && idx < ev.items.length - 1){
      ev.items.splice(idx + 1, 0, ev.items.splice(idx, 1)[0]);
      save();
      renderItemsTab();
    }else if(act === "duplicate-item"){
      var original = ev.items[idx];
      var copy = { id: uid("i"), category: original.category, name: original.name, color: original.color, size: original.size, price: original.price };
      ev.items.splice(idx + 1, 0, copy);
      if(!ev.stock) ev.stock = {};
      ev.stock[copy.id] = {before:null, after:null};
      save();
      renderItemsTab();
      var newRow = document.querySelector('tr[data-item="' + copy.id + '"] input[data-field="size"]');
      if(newRow) newRow.focus();
    }
  });

  document.getElementById("add-item").addEventListener("click", function(){
    var ev = getActiveEvent();
    if(!ev) return;
    var newItem = { id: uid("i"), category:"", name:"", color:"", size:"", price:0 };
    ev.items.push(newItem);
    if(!ev.stock) ev.stock = {};
    ev.stock[newItem.id] = {before:null, after:null};
    save();
    renderItemsTab();
  });

  // ---------- init ----------
  updateSyncBadge();
  loadStateFromServer().then(function(){
    if(state.events.length && !state.activeEventId){
      state.activeEventId = state.events[state.events.length-1].id;
      save();
    }
    renderHeader();
    var activeBtn = document.querySelector(".tab-btn.active");
    showTab(activeBtn ? activeBtn.dataset.tab : "events");
  });
})();
