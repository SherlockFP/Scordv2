(function () {
  "use strict";
  console.log("[Fixes] LOADED - v2.5");
  
  var _API = typeof API_BASE !== "undefined" ? API_BASE : "/api";

  /* ── Safe localStorage helpers ──────────────────────── */
  function safeGet(key, def) {
    try { return localStorage.getItem(key); } catch (e) { return def !== undefined ? def : null; }
  }
  function safeSet(key, val) {
    try { localStorage.setItem(key, val); return true; } catch (e) { return false; }
  }
  function safeRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }
  function safeJSON(key, def) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function safeJSONset(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }

  /* ── Global safe localStorage wrapper ─────────────── */
  (function () {
    var _origGet = Storage.prototype.getItem;
    var _origSet = Storage.prototype.setItem;
    var _origRemove = Storage.prototype.removeItem;
    if (!_origGet._patched) {
      Storage.prototype.getItem = function (key) {
        try { return _origGet.call(this, key); } catch (e) { return null; }
      };
      Storage.prototype.getItem._patched = true;
      Storage.prototype.setItem = function (key, val) {
        try { _origSet.call(this, key, val); } catch (e) {}
      };
      Storage.prototype.removeItem = function (key) {
        try { _origRemove.call(this, key); } catch (e) {}
      };
    }
  })();

  /* ── Global safeFetch wrapper ──────────────────────── */
  var _origFetch = window.fetch;
  window.fetch = function (url, opts) {
    return _origFetch.call(window, url, opts).catch(function (err) {
      console.warn("[fetch] Failed:", url, err);
      return new Response(JSON.stringify({ error: err.message, success: false }), {
        status: 503, headers: { "Content-Type": "application/json" }
      });
    });
  };

  /* ══════════════════════════════════════════════════════════
     PERFORMANS İYİLEŞTİRMELERİ — Genel Site Kasması Fix
  ══════════════════════════════════════════════════════════ */

  (function _perfOptimizations() {
    // Debounce utility
    window._debounce = function (fn, ms) {
      var tm = null;
      return function () {
        if (tm) clearTimeout(tm);
        tm = setTimeout(function () { fn.apply(this, arguments); }, ms || 16);
      };
    };

    // Throttle utility - for scroll, resize, mousemove
    var _scrollThrottle = null;
    var _resizeThrottle = null;
    var _mousemoveThrottle = null;

    // Patch scroll handler
    var _origScroll = null;
    document.addEventListener("scroll", function(e) {
      if (_scrollThrottle) return;
      _scrollThrottle = setTimeout(function() { _scrollThrottle = null; }, 50);
      if (typeof window.updateLastActive === "function") window.updateLastActive(e);
    }, { passive: true });

    // Patch resize handler
    window.addEventListener("resize", function(e) {
      if (_resizeThrottle) return;
      _resizeThrottle = setTimeout(function() { _resizeThrottle = null; }, 100);
    }, { passive: true });

    // Cache frequently accessed DOM elements
    window._domCache = {};
    window._getCachedEl = function (id) {
      var el = document.getElementById(id);
      if (el) window._domCache[id] = el;
      return el;
    };
    
    // HTML escape helper - özel karakterleri temizle
    window._escapeHtml = function (str) {
      if (!str && str !== 0) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };

    // CSS will-change optimization - GPU acceleration
    var perfStyle = document.createElement("style");
    perfStyle.id = "scord-perf-gpu";
    perfStyle.textContent = `
      /* GPU Acceleration for animations */
      .rail-icon, .server-rail-icon, .channel-icon, .member-avatar,
      .msg-row, .member-item, .channel-item, .vpc-card {
        will-change: transform;
        transform: translateZ(0);
        backface-visibility: hidden;
      }
      
      /* Smooth scrolling */
      .messages-area, .channel-list, .members-list, .dm-body {
        scroll-behavior: smooth;
        -webkit-overflow-scrolling: touch;
      }
      
      /* Optimize scrollbars */
      *::-webkit-scrollbar { width: 6px; height: 6px; }
      *::-webkit-scrollbar-track { background: transparent; }
      *::-webkit-scrollbar-thumb { 
        background: rgba(255,255,255,0.15); 
        border-radius: 3px; 
      }
      *::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
      
      /* Reduced motion support */
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation-duration: 0.01ms !important;
          transition-duration: 0.01ms !important;
        }
      }
      
      /* CSS contain - render performansı */
      .messages-area, .channel-list, .members-list {
        contain: content;
      }
      .server-rail {
        contain: strict;
      }
    `;
    document.head.appendChild(perfStyle);

    console.log("[Fixes] Performans iyileştirmeleri yüklendi (v2.4)");
  })();

  /* ══════════════════════════════════════════════════════════
     1. DISCORD TARZI SES EFEKTLERİ
  ══════════════════════════════════════════════════════════ */

  const SFX_CTX = { ac: null };

  function gctx() {
    if (!SFX_CTX.ac || SFX_CTX.ac.state === "closed") {
      SFX_CTX.ac = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (SFX_CTX.ac.state === "suspended") SFX_CTX.ac.resume();
    return SFX_CTX.ac;
  }

  function sfxVol() {
    var v = parseFloat(safeGet("scord_sfx_volume") ?? "0.35");
    return isNaN(v) ? 0.35 : Math.max(0, Math.min(1, v));
  }

  function sfxEn() { return safeGet("scord_sfx_enabled") !== "false"; }

  window.playDiscordSFX = function playDiscordSFX(name) {
    if (!sfxEn()) return;
    try {
      var ac = gctx();
      var vol = sfxVol();
      var t = ac.currentTime;
      var master = ac.createGain();
      master.connect(ac.destination);
      master.gain.setValueAtTime(vol, t);

      function osc(type, freq, start, dur, gv, freqEnd) {
        var o = ac.createOscillator();
        var g = ac.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t + start);
        if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + start + dur);
        o.connect(g);
        g.connect(master);
        g.gain.setValueAtTime(gv, t + start);
        g.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
        o.start(t + start);
        o.stop(t + start + dur + 0.01);
      }

      function noise(dur, gv) {
        var buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        var src = ac.createBufferSource();
        src.buffer = buf;
        var g = ac.createGain();
        src.connect(g);
        g.connect(master);
        g.gain.setValueAtTime(gv, t);
        src.start(t);
      }

      var s = {
        join: function () { osc("sine", 523, 0, 0.15, 0.5); osc("sine", 659, 0.08, 0.2, 0.45); osc("sine", 784, 0.16, 0.25, 0.3); noise(0.1, 0.06); },
        leave: function () { osc("sine", 659, 0, 0.18, 0.45); osc("sine", 494, 0.1, 0.2, 0.4); osc("sine", 392, 0.2, 0.22, 0.2); noise(0.08, 0.05); },
        message: function () { osc("sine", 880, 0, 0.06, 0.25); osc("sine", 1100, 0.04, 0.08, 0.15); },
        dm: function () { osc("sine", 880, 0, 0.1, 0.3); osc("sine", 1100, 0.07, 0.12, 0.25); },
        mute: function () { osc("square", 200, 0, 0.12, 0.12, 100); noise(0.05, 0.04); },
        unmute: function () { osc("square", 100, 0, 0.1, 0.12, 200); noise(0.04, 0.04); },
        mention: function () { osc("sine", 660, 0, 0.1, 0.35); osc("sine", 880, 0.07, 0.1, 0.3); osc("sine", 1100, 0.14, 0.15, 0.28); noise(0.06, 0.05); },
        error: function () { osc("sawtooth", 220, 0, 0.2, 0.15, 110); noise(0.12, 0.06); },
        click: function () { noise(0.03, 0.06); },
        connect: function () { osc("sine", 440, 0, 0.08, 0.15); osc("sine", 550, 0.06, 0.1, 0.12); },
        disconnect: function () { osc("sine", 440, 0, 0.1, 0.12, 330); },
        // Yeni Discord tarzı efektler
        incoming_call: function () {
          // Çalan telefon - 3 vuruş
          osc("sine", 440, 0, 0.15, 0.4); osc("sine", 440, 0.3, 0.15, 0.4);
          osc("sine", 440, 0.6, 0.15, 0.4); osc("sine", 440, 0.9, 0.15, 0.4);
        },
        call_join: function () {
          // Aramaya katılma - hızlı yükselen ton
          osc("sine", 400, 0, 0.1, 0.3, 600);
          osc("sine", 600, 0.05, 0.12, 0.25, 800);
        },
        call_leave: function () {
          // Aramadan ayrılma - alçalan ton
          osc("sine", 600, 0, 0.1, 0.3, 400);
          osc("sine", 400, 0.05, 0.12, 0.25, 300);
        },
        friend_request: function () {
          // Arkadaşlık isteği - 3 kısa not
          osc("sine", 660, 0, 0.05, 0.3); osc("sine", 880, 0.08, 0.05, 0.25);
          osc("sine", 1100, 0.16, 0.08, 0.2);
        },
        friend_accept: function () {
          // Arkadaş kabul - yükselen mutlu ses
          osc("sine", 523, 0, 0.1, 0.4); osc("sine", 659, 0.08, 0.1, 0.35);
          osc("sine", 784, 0.16, 0.15, 0.3);
        },
        server_join: function () {
          // Sunucuya katılma
          osc("sine", 440, 0, 0.08, 0.35); osc("sine", 554, 0.06, 0.08, 0.3);
          osc("sine", 659, 0.12, 0.1, 0.25);
        },
        server_leave: function () {
          // Sunucudan ayrılma
          osc("sine", 659, 0, 0.08, 0.3); osc("sine", 554, 0.06, 0.08, 0.25);
          osc("sine", 440, 0.12, 0.1, 0.2);
        },
        screen_share: function () {
          // Ekran paylaşımı başlatma
          osc("square", 330, 0, 0.05, 0.2, 220);
          osc("sine", 440, 0.05, 0.08, 0.15);
        },
        screen_stop: function () {
          // Ekran paylaşımı durdurma
          osc("sine", 440, 0, 0.05, 0.15); osc("square", 220, 0.05, 0.06, 0.12, 110);
        },
        deafen: function () {
          // Sağır et - düşük vuruş
          osc("sawtooth", 150, 0, 0.1, 0.15, 75); noise(0.08, 0.05);
        },
        undeafen: function () {
          // Sağırlığı kaldır
          osc("sawtooth", 75, 0, 0.08, 0.12, 150); noise(0.06, 0.04);
        },
      };
      var fn = s[name];
      if (fn) fn();
    } catch (e) {}
  };

  var _origPS = window.playSound;
  window.playSound = function (freq, duration, type) {
    if (freq === 523) return window.playDiscordSFX("join");
    if (freq === 330) return window.playDiscordSFX("leave");
    if (freq === 660 || freq === 880) return window.playDiscordSFX("message");
    if (_origPS) _origPS(freq, duration, type);
  };

  /* ══════════════════════════════════════════════════════════
     2. MESAJ SİLME FİXİ
  ══════════════════════════════════════════════════════════ */

  window.deleteChatMessage = function deleteChatMessage(msg) {
    var server = window.state?.servers?.find(function (s) { return s.id === window.state.activeServerId; });
    if (!server) return;
    var channelId = msg.channelId || window.state.activeChannelId;
    if (!channelId) return;
    if (!server.messages) server.messages = {};
    if (!server.messages[channelId]) server.messages[channelId] = [];
    server.messages[channelId] = server.messages[channelId].filter(function (m) { return m.id !== msg.id; });
    server.pinned_messages = (server.pinned_messages || []).filter(function (m) { return m.id !== msg.id; });
    if (typeof meshBroadcastReliable === "function") {
      meshBroadcastReliable({ type: "msg_delete", payload: { channelId: channelId, msgId: msg.id } });
    } else if (window.state?.mesh) {
      window.state.mesh.broadcast({ type: "msg_delete", payload: { channelId: channelId, msgId: msg.id } });
    }
    if (_API && window.state.activeServerId) {
      fetch(_API + "/rooms/" + window.state.activeServerId + "/messages/" + msg.id + "?channel_id=" + encodeURIComponent(channelId), { method: "DELETE" }).catch(function () {});
    }
    if (typeof renderMessages === "function") renderMessages(window.state.activeServerId, window.state.activeChannelId);
    if (typeof toast === "function") toast("Mesaj silindi.", "info");
  };

  /* ══════════════════════════════════════════════════════════
     3. SESLİ ODADAN AYRILMA BUĞU
  ══════════════════════════════════════════════════════════ */

  window.leaveServer = function leaveServer(serverId) {
    if (!window.state) return;
    var idx = window.state.servers.findIndex(function (s) { return s.id === serverId; });
    if (idx === -1) { if (typeof toast === "function") toast("Sunucu bulunamadı.", "error"); return; }
    if (window.state.voiceChannelId) {
      try { if (window.leaveVoiceChannel) window.leaveVoiceChannel(); } catch (e) {}
    }
    window.state.activeChannelId = null;
    window.state.activeServerId = null;
    window.state.voiceChannelId = null;
    window.state.servers.splice(idx, 1);
    try { if (window.state.mesh) { window.state.mesh.disconnect(); window.state.mesh = null; } } catch (e) {}
    // Tüm persistence katmanlarını temizle
    if (typeof removeServerFromStorage === "function") removeServerFromStorage(serverId); // scord_saved_servers
    try { localStorage.removeItem("scord_server_" + serverId); } catch (e) {} // V20 per-server key
    // Left servers listesine ekle (reload'da tekrar gelmesin)
    try {
      var leftList = JSON.parse(localStorage.getItem("scord_left_servers") || "[]");
      if (leftList.indexOf(serverId) === -1) {
        leftList.push(serverId);
        localStorage.setItem("scord_left_servers", JSON.stringify(leftList));
      }
    } catch (e) {}
    // Identity'deki servers listesini güncelle
    if (typeof renderServerRail === "function") renderServerRail();
    if (typeof showHomeView === "function") showHomeView();
    if (typeof toast === "function") toast("Sunucudan ayrıldın.", "info");
  };

  /* ══════════════════════════════════════════════════════════
     4. SUNUCU LOGOSU FİXİ
  ══════════════════════════════════════════════════════════ */

  window.updateServerIcon = function updateServerIcon(serverId, url) {
    var trimmed = (url || "").trim();
    if (!trimmed) { if (typeof toast === "function") toast("Geçerli bir URL girin.", "error"); return; }
    fetch(_API + "/rooms/" + serverId + "/icon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: trimmed }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.success) {
        var server = window.state?.servers?.find(function (s) { return s.id === serverId; });
        if (server) server.icon_url = trimmed;
        if (typeof renderServerRail === "function") renderServerRail();
        if (typeof toast === "function") toast("Sunucu ikonu güncellendi.", "success");
      } else {
        if (typeof toast === "function") toast("İkon güncellenemedi: " + (data.error || "hata"), "error");
      }
    }).catch(function () { if (typeof toast === "function") toast("Bağlantı hatası.", "error"); });
  };

  /* ══════════════════════════════════════════════════════════
     5. KANAL SİLME FİXİ
  ══════════════════════════════════════════════════════════ */

  window.deleteChannel = async function deleteChannel(serverId, channelId) {
    var server = window.state?.servers?.find(function (s) { return s.id === serverId; });
    if (!server) return;
    var channel = server.channels?.find(function (c) { return c.id === channelId; });
    if (!channel) return;
    if (!confirm('"' + channel.name + '" kanalını silmek istediğine emin misin?')) return;
    try {
      var res = await fetch(_API + "/rooms/" + serverId + "/channels/" + channelId, { method: "DELETE" });
      var data = await res.json();
      if (data.success) {
        server.channels = server.channels.filter(function (c) { return c.id !== channelId; });
        delete (server.messages || {})[channelId];
        delete (server.channel_backgrounds || {})[channelId];
        if (window.state?.mesh) window.state.mesh.broadcast({ type: "channel_delete", payload: { serverId: serverId, channelId: channelId } });
        if (window.state?.activeChannelId === channelId) {
          var firstText = server.channels.find(function (c) { return c.type === "text"; });
          if (firstText && typeof showChatView === "function") showChatView(serverId, firstText.id);
          else if (typeof showHomeView === "function") showHomeView();
        } else {
          if (typeof updateChannelSidebar === "function") updateChannelSidebar(serverId);
        }
        if (typeof toast === "function") toast("Kanal silindi.", "success");
      } else {
        if (typeof toast === "function") toast("Kanal silinemedi: " + (data.error || "Hata"), "error");
      }
    } catch (e) {
      if (typeof toast === "function") toast("Bağlantı hatası.", "error");
    }
  };

  /* ══════════════════════════════════════════════════════════
     6. KANAL ARKA PLANI
  ══════════════════════════════════════════════════════════ */

  function _applyChannelBgImg(channelId, url) {
    if (window.state?.activeChannelId !== channelId) return;
    var target = document.getElementById("messages-area") || document.getElementById("chat-view");
    if (!target) return;
    if (url) {
      target.style.backgroundImage = "linear-gradient(rgba(6,6,16,0.88),rgba(6,6,16,0.94)), url(" + JSON.stringify(url) + ")";
      target.style.backgroundSize = "cover";
      target.style.backgroundPosition = "center";
      target.style.backgroundAttachment = "local";
    } else {
      target.style.backgroundImage = "";
      target.style.backgroundSize = "";
      target.style.backgroundPosition = "";
      target.style.backgroundAttachment = "";
    }
  }

  window.setChannelBackground = async function setChannelBackground(serverId, channelId, url) {
    try {
      var res = await fetch(_API + "/rooms/" + serverId + "/channel_background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channelId, url: url || null }),
      });
      var data = await res.json();
      if (data.success) {
        var server = window.state?.servers?.find(function (s) { return s.id === serverId; });
        if (server) {
          if (!server.channel_backgrounds) server.channel_backgrounds = {};
          if (url) server.channel_backgrounds[channelId] = url;
          else delete server.channel_backgrounds[channelId];
        }
        _applyChannelBgImg(channelId, url || null);
        if (typeof toast === "function") toast("Kanal arka planı güncellendi.", "success");
      }
    } catch (e) {
      if (typeof toast === "function") toast("Bağlantı hatası.", "error");
    }
  };

  var _origSCV = window.showChatView;
  if (_origSCV) {
    window.showChatView = function showChatView(serverId, channelId) {
      var result = _origSCV(serverId, channelId);
      try {
        var server = window.state?.servers?.find(function (s) { return s.id === serverId; });
        var bg = server?.channel_backgrounds?.[channelId];
        _applyChannelBgImg(channelId, bg || null);
      } catch (e) {}
      return result;
    };
  }

  /* ══════════════════════════════════════════════════════════
     7. DM KAPATMA / SİLME / ARKADAŞ SİLME
  ══════════════════════════════════════════════════════════ */

  window.closeDMConversation = function closeDMConversation(peerId) {
    if (!window.state) return;
    // Overlay'i kapat
    var overlay = document.getElementById("dm-overlay");
    if (overlay) overlay.classList.add("hidden");
    // DM'i recent listesinden kaldır
    if (window.state.recentDMs) {
      window.state.recentDMs = window.state.recentDMs.filter(function (d) { return d.peerId !== peerId; });
      localStorage.setItem("scord_recent_dms", JSON.stringify(window.state.recentDMs));
    }
    // Mesaj geçmişini temizle
    if (window.state.dms) delete window.state.dms[peerId];
    try {
      var stored = JSON.parse(localStorage.getItem("scord_dms") || "{}");
      delete stored[peerId];
      localStorage.setItem("scord_dms", JSON.stringify(stored));
    } catch (e) {}
    if (window.state.activeDM === peerId) window.state.activeDM = null;
    // Sidebar'ı yenile
    if (!window.state.activeServerId && typeof renderHomeSidebar === "function") renderHomeSidebar();
    if (typeof toast === "function") toast("DM kapatıldı.", "info");
  };

  window.deleteDMConversation = function deleteDMConversation(peerId, username) {
    if (!confirm("@" + username + " ile olan DM geçmişini silmek istediğine emin misin?")) return;
    if (!window.state) return;
    if (!window.state.dms) window.state.dms = {};
    delete window.state.dms[peerId];
    try {
      var stored = JSON.parse(localStorage.getItem("scord_dms") || "{}");
      delete stored[peerId];
      localStorage.setItem("scord_dms", JSON.stringify(stored));
    } catch (e) {}
    // Recent listesinden de kaldır
    if (window.state.recentDMs) {
      window.state.recentDMs = window.state.recentDMs.filter(function (d) { return d.peerId !== peerId; });
      localStorage.setItem("scord_recent_dms", JSON.stringify(window.state.recentDMs));
    }
    window.closeDMConversation(peerId);
    if (typeof toast === "function") toast("DM sohbeti silindi.", "info");
  };

  window.removeFriend = function removeFriend(peerId) {
    if (!window.state) return;
    window.state.friends = (window.state.friends || []).filter(function (f) { return f.peerId !== peerId; });
    localStorage.setItem("scord_friends", JSON.stringify(window.state.friends));
    if (!window.state.activeServerId && typeof renderHomeSidebar === "function") renderHomeSidebar();
    if (typeof toast === "function") toast("Arkadaş silindi.", "info");
  };

  function enhanceDMOverlay() {
    var header = document.querySelector(".dm-header");
    if (!header || header.querySelector(".dm-delete-btn")) return;
    var deleteBtn = document.createElement("button");
    deleteBtn.className = "dm-close-btn dm-delete-btn";
    deleteBtn.title = "Sohbeti sil";
    deleteBtn.style.cssText = "margin-right:4px;color:var(--red,#ed4245);opacity:0.7;font-size:14px;padding:4px 8px;border-radius:4px;border:none;background:rgba(255,255,255,0.05);cursor:pointer;";
    deleteBtn.textContent = "\uD83D\uDDD1";
    deleteBtn.addEventListener("click", function () {
      var peerId = window.state?.activeDM;
      if (!peerId) return;
      window.deleteDMConversation(peerId, peerId);
    });
    var closeBtn = document.getElementById("dm-close-btn");
    if (closeBtn) header.insertBefore(deleteBtn, closeBtn);
    else header.appendChild(deleteBtn);
  }

  function enhanceDMSidebar() {
    document.querySelectorAll(".dm-sidebar-item").forEach(function (item) {
      if (item.querySelector(".dm-item-actions")) return;
      var peerId = item.dataset.peerId;
      if (!peerId) return;
      var actions = document.createElement("div");
      actions.className = "dm-item-actions";
      actions.style.cssText = "display:none;gap:4px;margin-left:auto;flex-shrink:0;";
      var closeBtn = document.createElement("button");
      closeBtn.textContent = "\u2715";
      closeBtn.title = "DM'yi kapat";
      closeBtn.style.cssText = "width:20px;height:20px;border-radius:4px;border:none;background:rgba(255,255,255,0.08);color:var(--text-muted);cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;";
      closeBtn.addEventListener("click", function (e) { e.stopPropagation(); window.closeDMConversation(peerId); });
      var delBtn = document.createElement("button");
      delBtn.textContent = "\uD83D\uDDD1";
      delBtn.title = "DM'yi sil";
      delBtn.style.cssText = "width:20px;height:20px;border-radius:4px;border:none;background:rgba(255,255,255,0.08);color:var(--red);cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;";
      delBtn.addEventListener("click", function (e) { e.stopPropagation(); window.deleteDMConversation(peerId, peerId); });
      var rmFriendBtn = document.createElement("button");
      rmFriendBtn.textContent = "\u2715";
      rmFriendBtn.title = "Arkadaştan çıkar";
      rmFriendBtn.style.cssText = "width:20px;height:20px;border-radius:4px;border:none;background:rgba(237,66,69,0.15);color:var(--red);cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;";
      rmFriendBtn.addEventListener("click", function (e) { e.stopPropagation(); window.removeFriend(peerId); });
      actions.appendChild(closeBtn);
      actions.appendChild(delBtn);
      actions.appendChild(rmFriendBtn);
      item.appendChild(actions);
      item.addEventListener("mouseenter", function () { actions.style.display = "flex"; });
      item.addEventListener("mouseleave", function () { actions.style.display = "none"; });
    });
  }

  /* ══════════════════════════════════════════════════════════
     8. SUNUCU İZİNLERİ KAYIT
  ══════════════════════════════════════════════════════════ */

  function patchSaveServerSettings() {
    var _orig = window.saveServerSettings;
    if (!_orig) return;
    window.saveServerSettings = function saveServerSettings() {
      var result = _orig.apply(this, arguments);
      var server = window.state?.servers?.find(function (s) { return s.id === window.state.activeServerId; });
      if (server) {
        if (typeof sendServerEvent === "function") {
          sendServerEvent({ type: "role_update", roles: server.roles || {}, peer_roles: server.peer_roles || {} });
          sendServerEvent({ type: "permission_update", channel_permissions: server.channel_permissions || {} });
        }
        if (window.state?.mesh) {
          window.state.mesh.broadcast({
            type: "server_update",
            payload: { id: server.id, name: server.name, roles: server.roles, peer_roles: server.peer_roles, channel_permissions: server.channel_permissions || {}, icon_url: server.icon_url, inviteCode: server.inviteCode },
          });
        }
      }
      return result;
    };
  }

  /* ══════════════════════════════════════════════════════════
     9. WS MESAJ HANDLER
  ══════════════════════════════════════════════════════════ */

  function patchWSHandler() {
    var _orig = window.handleServerMessage;
    if (!_orig) return;
    window.handleServerMessage = function handleServerMessage(data) {
      if (data?.type === "channel_background_update") {
        var server = window.state?.servers?.find(function (s) { return s.id === window.state.activeServerId; });
        if (server) {
          if (!server.channel_backgrounds) server.channel_backgrounds = {};
          if (data.url) server.channel_backgrounds[data.channelId] = data.url;
          else delete server.channel_backgrounds[data.channelId];
          if (data.channel_backgrounds) server.channel_backgrounds = data.channel_backgrounds;
          _applyChannelBgImg(data.channelId, data.url || null);
        }
        return;
      }
      return _orig.apply(this, arguments);
    };
  }

  /* ══════════════════════════════════════════════════════════
     10. PERFORMANS + GPU + 60FPS
  ══════════════════════════════════════════════════════════ */

  function applyPerf() {
    if (document.getElementById("scord-perf-fixes")) return;
    var style = document.createElement("style");
    style.id = "scord-perf-fixes";
    style.textContent = [
      "html{scroll-behavior:smooth}",
      ".messages-area,.channel-list,.members-list,#members-list,.dm-body{scroll-behavior:smooth;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}",
      "*::-webkit-scrollbar{width:4px;height:4px}*::-webkit-scrollbar-track{background:transparent}*::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.12);border-radius:4px}",
      ".toast,.ctx-menu,.modal-backdrop,.dm-overlay{transition:opacity 0.1s ease,transform 0.1s ease}",
      "body{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}",
    ].join("");
    document.head.appendChild(style);
  }

  /* ══════════════════════════════════════════════════════════
     11. CHAT STİL CSS
  ══════════════════════════════════════════════════════════ */

  function applyChatStyle() {
    if (document.getElementById("scord-chat-style-fix")) return;
    var s = document.createElement("style");
    s.id = "scord-chat-style-fix";
    s.textContent = [
      'html[data-scord-chat-style="comfortable"] .msg-row{margin-bottom:12px!important}',
      'html[data-scord-chat-style="comfortable"] .msg-bubble{padding:14px 18px!important;border-radius:18px!important}',
      'html[data-scord-chat-style="cozy"] .msg-row{margin-bottom:6px!important}',
      'html[data-scord-chat-style="cozy"] .msg-bubble{padding:10px 14px!important;border-radius:12px!important}',
      'html[data-scord-chat-style="compact"] .msg-row{margin-bottom:1px!important}',
      'html[data-scord-chat-style="compact"] .msg-bubble{padding:4px 10px!important;border-radius:6px!important}',
      'html[data-scord-chat-style="compact"] .msg-avatar{width:24px!important;height:24px!important}',
      'html[data-scord-chat-style="compact"] .msg-author{font-size:11px!important}',
    ].join("");
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════
     12. VOICE LOOP PERFORMANCE — 150ms poll
  ══════════════════════════════════════════════════════════ */

  function patchVoiceLoop() {
    // Voice detection interval'ı 150ms'e çıkar (performans)
    if (window.SCORD_T && typeof window.SCORD_T === "function") {
      try {
        var t = window.SCORD_T();
        if (t) t.VOICE_SPEAKING_POLL_MS = 150;
      } catch (e) {}
    }
  }

  /* ══════════════════════════════════════════════════════════
     13. SES TETİKLEYİCİLERİ
  ══════════════════════════════════════════════════════════ */

  function hookSounds() {
    // Ses kanalı katılma/ayrılma
    var _oj = window.joinVoiceChannel;
    if (_oj) {
      window.joinVoiceChannel = function () {
        var r = _oj.apply(this, arguments);
        setTimeout(function () { window.playDiscordSFX("join"); }, 300);
        return r;
      };
    }
    var _ol = window.leaveVoiceChannel;
    if (_ol) {
      window.leaveVoiceChannel = function () {
        window.playDiscordSFX("leave");
        return _ol.apply(this, arguments);
      };
    }
    
    // DM araması sesleri
    if (typeof window.startDirectCall === "function") {
      var _origSDC = window.startDirectCall;
      window.startDirectCall = function () {
        window.playDiscordSFX("incoming_call");
        return _origSDC.apply(this, arguments);
      };
    }
    if (typeof window.acceptCall === "function") {
      var _origAC = window.acceptCall;
      window.acceptCall = function () {
        window.playDiscordSFX("call_join");
        return _origAC.apply(this, arguments);
      };
    }
    if (typeof window.endCall === "function") {
      var _origEC = window.endCall;
      window.endCall = function () {
        window.playDiscordSFX("call_leave");
        return _origEC.apply(this, arguments);
      };
    }
    
    // Sunucu katılma/ayrılma
    if (typeof window.joinServer === "function") {
      var _origJS = window.joinServer;
      window.joinServer = function () {
        var r = _origJS.apply(this, arguments);
        setTimeout(function () { window.playDiscordSFX("server_join"); }, 200);
        return r;
      };
    }
    if (typeof window.leaveServer === "function") {
      var _origLS = window.leaveServer;
      window.leaveServer = function () {
        window.playDiscordSFX("server_leave");
        return _origLS.apply(this, arguments);
      };
    }
    
    // Ekran paylaşımı
    if (typeof window.startScreenShare === "function") {
      var _origSSS = window.startScreenShare;
      window.startScreenShare = function () {
        var r = _origSSS.apply(this, arguments);
        setTimeout(function () { window.playDiscordSFX("screen_share"); }, 200);
        return r;
      };
    }
    if (typeof window.stopScreenShare === "function") {
      var _origStSS = window.stopScreenShare;
      window.stopScreenShare = function () {
        window.playDiscordSFX("screen_stop");
        return _origStSS.apply(this, arguments);
      };
    }
    
    // DM/chat butonları
    var check = setInterval(function () {
      var micBtn = document.getElementById("mic-toggle-btn");
      var sendBtn = document.getElementById("send-btn");
      var chatInput = document.getElementById("chat-input");
      var dmSendBtn = document.getElementById("dm-send-btn");
      var dmInput = document.getElementById("dm-input");
      if (micBtn && sendBtn && chatInput && dmSendBtn && dmInput) {
        clearInterval(check);
        micBtn.addEventListener("click", function () {
          setTimeout(function () { window.playDiscordSFX(window.state?.muted ? "mute" : "unmute"); }, 50);
        });
        // Sağır et butonu
        var deafBtn = document.getElementById("deafen-btn");
        if (deafBtn) {
          deafBtn.addEventListener("click", function () {
            window.playDiscordSFX(window.state?.deafened ? "deafen" : "undeafen");
          });
        }
        sendBtn.addEventListener("click", function () { window.playDiscordSFX("message"); });
        chatInput.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) window.playDiscordSFX("message"); });
        dmSendBtn.addEventListener("click", function () { window.playDiscordSFX("dm"); });
        dmInput.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) window.playDiscordSFX("dm"); });
      }
    }, 500);
    
    // Friend request sesleri - handleIncomingP2P patch
    var _origFRP2 = window.handleIncomingP2P;
    if (_origFRP2) {
      window.handleIncomingP2P = function (fromPeerId, data, roomId) {
        if (data?.type === "friend_request") {
          setTimeout(function () { window.playDiscordSFX("friend_request"); }, 100);
        }
        if (data?.type === "friend_request_accepted") {
          window.playDiscordSFX("friend_accept");
        }
        return _origFRP2.apply(this, arguments);
      };
    }
    
    console.log("[Fixes] Discord sound effects hooked");
  }

  /* ══════════════════════════════════════════════════════════
     14. MÜZİK BOTU — YT.Player + özel dock
  ══════════════════════════════════════════════════════════ */

  var _musicExpanded = false;

  function _createMusicDock(videoId) {
    // Varolan dock'u temizle
    var old = document.getElementById("music-player-dock");
    if (old) old.remove();
    _musicExpanded = false;

    var container = document.createElement("div");
    container.id = "music-player-dock";
    container.style.cssText = "position:fixed;bottom:80px;right:20px;width:360px;z-index:99999;border-radius:12px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.6);background:#18181b;font-family:Inter,sans-serif;border:1px solid #333;";

    // Mini bar
    var bar = document.createElement("div");
    bar.id = "music-mini-bar";
    bar.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;height:48px;box-sizing:border-box;background:linear-gradient(90deg,#1a1a2e,#16213e);";
    bar.onclick = function () { _toggleMusicPlayer(); };

    var icon = document.createElement("span");
    icon.textContent = "🎵";
    icon.style.cssText = "font-size:20px;flex-shrink:0;";

    var info = document.createElement("div");
    info.style.cssText = "flex:1;min-width:0;";
    var title = document.createElement("div");
    title.style.cssText = "color:#fff;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    title.textContent = "Müzik";
    var subtitle = document.createElement("div");
    subtitle.id = "music-subtitle";
    subtitle.style.cssText = "color:#a1a1aa;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    subtitle.textContent = videoId || "Yükleniyor...";
    info.appendChild(title);
    info.appendChild(subtitle);

    var barControls = document.createElement("div");
    barControls.style.cssText = "display:flex;gap:4px;align-items:center;flex-shrink:0;";

    var expandBtn = document.createElement("button");
    expandBtn.innerHTML = "⏏";
    expandBtn.title = "Genişlet";
    expandBtn.style.cssText = "width:28px;height:28px;border:none;border-radius:6px;background:rgba(255,255,255,0.1);color:#fff;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;";
    expandBtn.onclick = function (e) { e.stopPropagation(); _toggleMusicPlayer(); };

    var closeBtn = document.createElement("button");
    closeBtn.innerHTML = "✕";
    closeBtn.title = "Kapat";
    closeBtn.style.cssText = "width:28px;height:28px;border:none;border-radius:6px;background:rgba(255,255,255,0.1);color:#a1a1aa;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;";
    closeBtn.onclick = function (e) { e.stopPropagation(); _stopMusicFix(); };

    barControls.appendChild(expandBtn);
    barControls.appendChild(closeBtn);

    bar.appendChild(icon);
    bar.appendChild(info);
    bar.appendChild(barControls);
    container.appendChild(bar);

    // Player wrap - içinde #yt-player olacak
    var playerWrap = document.createElement("div");
    playerWrap.id = "music-player-wrap";
    playerWrap.style.cssText = "display:none;background:#000;";

    // #yt-player buraya taşınacak
    var ytDiv = document.createElement("div");
    ytDiv.id = "music-yt-container";
    ytDiv.style.cssText = "width:100%;height:240px;";

    // Volume + unmute bar
    var ctrlBar = document.createElement("div");
    ctrlBar.id = "music-ctrl-bar";
    ctrlBar.style.cssText = "display:flex;align-items:center;gap:8px;padding:8px 14px;background:rgba(99,102,241,0.15);border-top:1px solid #333;";

    var unmuteBtn = document.createElement("button");
    unmuteBtn.id = "music-unmute-btn";
    unmuteBtn.innerHTML = "🔇 Sesi Aç";
    unmuteBtn.style.cssText = "padding:6px 12px;border:none;border-radius:6px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;cursor:pointer;font-size:11px;font-weight:600;white-space:nowrap;";
    unmuteBtn.onclick = function (e) {
      e.stopPropagation();
      if (typeof window.unlockMusicAudio === "function") {
        window.unlockMusicAudio();
      }
      // YT.Player'ı dene
      var mb = window.state?.musicBot;
      if (mb?.player && typeof mb.player.unMute === "function") {
        try { mb.player.unMute(); } catch (ex) {}
        try { mb.player.setVolume(mb.volume || 50); } catch (ex) {}
        try { mb.player.playVideo(); } catch (ex) {}
      }
      unmuteBtn.innerHTML = "✅ Ses Açık";
      unmuteBtn.style.background = "linear-gradient(135deg,#22c55e,#16a34a)";
      unmuteBtn.disabled = true;
      volSlider.disabled = false;
      volSlider.style.opacity = "1";
    };
    ctrlBar.appendChild(unmuteBtn);

    var volLabel = document.createElement("span");
    volLabel.textContent = "🔊";
    volLabel.style.cssText = "font-size:14px;flex-shrink:0;";
    var volSlider = document.createElement("input");
    volSlider.type = "range";
    volSlider.min = "0";
    volSlider.max = "100";
    volSlider.value = "50";
    volSlider.disabled = true;
    volSlider.style.cssText = "flex:1;min-width:60px;height:4px;accent-color:#6366f1;opacity:0.5;cursor:pointer;";
    volSlider.oninput = function () {
      var val = parseInt(this.value);
      var mb = window.state?.musicBot;
      if (mb?.player && typeof mb.player.setVolume === "function") {
        try { mb.player.setVolume(val); } catch (ex) {}
        if (mb.volume !== undefined) mb.volume = val;
      }
    };
    ctrlBar.appendChild(volLabel);
    ctrlBar.appendChild(volSlider);

    playerWrap.appendChild(ytDiv);
    playerWrap.appendChild(ctrlBar);
    container.appendChild(playerWrap);

    document.body.appendChild(container);
    return { ytDiv: ytDiv, container: container };
  }

  function _toggleMusicPlayer() {
    var pw = document.getElementById("music-player-wrap");
    var container = document.getElementById("music-player-dock");
    if (!pw || !container) return;

    if (_musicExpanded) {
      pw.style.display = "none";
      container.style.width = "360px";
      _musicExpanded = false;
    } else {
      pw.style.display = "block";
      container.style.width = "480px";
      _musicExpanded = true;

      // #yt-player'ı container'a taşı (app.js onu body'e koymuş olabilir)
      var ytPlayer = document.getElementById("yt-player");
      var ytContainer = document.getElementById("music-yt-container");
      if (ytPlayer && ytContainer && ytPlayer.parentNode !== ytContainer) {
        ytContainer.appendChild(ytPlayer);
        ytPlayer.style.width = "100%";
        ytPlayer.style.height = "100%";
      }
    }
  }

  function _stopMusicFix() {
    var dock = document.getElementById("music-player-dock");
    if (dock) dock.remove();
    _musicExpanded = false;
  }

  function patchMusicBot() {
    // startMusicBot'u patch'le
    if (typeof window.startMusicBot === "function" && !window._musicBotPatched) {
      window._musicBotPatched = true;
      var _origSMB = window.startMusicBot;
      window.startMusicBot = function (videoId, startAt) {
        // ÖNCE: YT.Player'ı taşıyacak dock'u oluştur
        var dock = _createMusicDock(videoId);
        
        // SONRA: orijinal startMusicBot'u çağır (YT.Player'ı oluşturur)
        try {
          _origSMB(videoId, startAt);
        } catch (e) {
          console.error("[Fixes] startMusicBot error:", e);
        }
        
        // YT.Player oluştuktan sonra #yt-player'ı dock'a taşı
        setTimeout(function () {
          var ytPlayer = document.getElementById("yt-player");
          var ytContainer = document.getElementById("music-yt-container");
          if (ytPlayer && ytContainer) {
            ytContainer.innerHTML = "";
            ytContainer.appendChild(ytPlayer);
            ytPlayer.style.width = "100%";
            ytPlayer.style.height = "100%";
          }
          
          var sub = document.getElementById("music-subtitle");
          if (sub) sub.textContent = videoId || "Çalıyor...";
        }, 500);
      };
    }

    // P2P music_play dinle
    var _origP2P = window.handleIncomingP2P;
    if (_origP2P) {
      window.handleIncomingP2P = function (fromPeerId, data, roomId) {
        if (data?.type === "music_play" && data.videoId) {
          if (window.state?.voiceChannelId && typeof window.startMusicBot === "function") {
            window.startMusicBot(data.videoId, data.startAt || 0);
          }
          return;
        }
        if (data?.type === "music_stop") { _stopMusicFix(); return; }
        return _origP2P.apply(this, arguments);
      };
    }

    // handleServerMessage'dan music_play dinle
    if (typeof window.handleServerMessage === "function") {
      var _origHSM = window.handleServerMessage;
      window.handleServerMessage = function (data) {
        if (data?.type === "music_play" && data.videoId) {
          if (window.state?.voiceChannelId && typeof window.startMusicBot === "function") {
            window.startMusicBot(data.videoId, data.startAt || 0);
          }
          return;
        }
        if (data?.type === "music_stop") { _stopMusicFix(); return; }
        return _origHSM.apply(this, arguments);
      };
    }

    // leaveVoiceChannel'da müziği durdur
    var _origLVC = window.leaveVoiceChannel;
    if (_origLVC) {
      window.leaveVoiceChannel = function () {
        _stopMusicFix();
        return _origLVC.apply(this, arguments);
      };
    }

    console.log("[Fixes] Music bot patches applied");
  }

  /* ══════════════════════════════════════════════════════════
     15. MESAJ SİLME İZNİ
  ══════════════════════════════════════════════════════════ */

  function patchMessageDeletePermission() {
    var _origSMC = window.showMsgContextMenu;
    if (!_origSMC) return;
    window.showMsgContextMenu = function (msg, x, y) {
      var server = window.state?.servers?.find(function (s) { return s.id === window.state.activeServerId; });
      if (!server) return _origSMC(msg, x, y);
      var isAuthor = msg.authorId === window.state.peerId;
      var myRole = server.ownerId === window.state.peerId ? "owner" : server.peer_roles?.[window.state.peerId] === "admin" ? "admin" : server.peer_roles?.[window.state.peerId] === "mod" ? "mod" : "member";
      var canMod = myRole === "owner" || myRole === "admin" || myRole === "mod";
      if (!isAuthor && !canMod) return _origSMC(msg, x, y);
      _origSMC(msg, x, y);
      var menu = document.getElementById("ctx-menu");
      if (!menu || menu.querySelector('[data-action="delete-msg"]')) return;
      var delItem = document.createElement("div");
      delItem.className = "ctx-item danger";
      delItem.dataset.action = "delete-msg";
      delItem.innerHTML = '<span class="ctx-icon">\uD83D\uDDD1\uFE0F</span>Mesaj\u0131 Sil';
      delItem.onclick = function () {
        var m = document.getElementById("ctx-menu");
        if (m) m.remove();
        if (typeof window.deleteChatMessage === "function") window.deleteChatMessage(msg);
      };
      menu.appendChild(delItem);
    };
  }

  /* ══════════════════════════════════════════════════════════
     15b. DM KAPAT BUTONU — Gerçekten kapatma
  ══════════════════════════════════════════════════════════ */

  function patchDMCloseButton() {
    var check = setInterval(function () {
      var btn = document.getElementById("dm-close-btn");
      if (btn) {
        clearInterval(check);
        btn.onclick = function (e) {
          var ov = document.getElementById("dm-overlay");
          if (ov) { ov.classList.add("hidden"); ov.setAttribute("aria-hidden", "true"); }
          if (typeof hideDMMainView === "function") hideDMMainView(true);
          var peerId = window.state?.activeDM;
          if (peerId) {
            if (window.state?.recentDMs) {
              window.state.recentDMs = window.state.recentDMs.filter(function (d) { return d.peerId !== peerId; });
              localStorage.setItem("scord_recent_dms", JSON.stringify(window.state.recentDMs));
            }
            if (window.state?.dms) delete window.state.dms[peerId];
            try {
              var stored = JSON.parse(localStorage.getItem("scord_dms") || "{}");
              delete stored[peerId];
              localStorage.setItem("scord_dms", JSON.stringify(stored));
            } catch (e) {}
            window.state.activeDM = null;
            if (!window.state.activeServerId && typeof renderHomeSidebar === "function") renderHomeSidebar();
            if (typeof renderDMMainView === "function") renderDMMainView();
          }
        };
      }
    }, 500);
  }

  function patchDMClickReposition() {
    var check2 = setInterval(function () {
      var dmMain = document.getElementById("dm-main-view");
      if (dmMain) {
        clearInterval(check2);
        dmMain.addEventListener("click", function (e) {
          var peerId = window.state?.activeDM;
          if (!peerId) return;
          var item = e.target.closest(".dm-main-item");
          if (item) return;
          var msgArea = document.getElementById("dm-messages");
          if (msgArea && e.target.closest(msgArea)) return;
        });
      }
    }, 500);
  }

  function patchOpenDM() {
    var _origODM = window.openDM;
    if (!_origODM) return;
    window.openDM = function (peerId, name, avatarColor, avatarImage) {
      var oldRecent = window.state?.recentDMs || [];
      var wasAlreadyRecent = oldRecent.some(function (d) { return d.peerId === peerId; });
      _origODM.call(this, peerId, name, avatarColor, avatarImage);
      if (wasAlreadyRecent && window.state?.recentDMs) {
        window.state.recentDMs = oldRecent;
        localStorage.setItem("scord_recent_dms", JSON.stringify(window.state.recentDMs));
      }
    };
  }

  /* ══════════════════════════════════════════════════════════
     16. SAĞ CLICK MENÜ ENTEGRASYONLARI
  ══════════════════════════════════════════════════════════ */

  function patchContextMenu() {
    var _origCMC = window.showContextMenu;
    if (!_origCMC) return;
    window.showContextMenu = function (peerId, username, x, y) {
      _origCMC.apply(this, arguments);
      var menu = document.getElementById("ctx-menu");
      if (!menu) return;

      // Direkt ara
      if (!menu.querySelector('[data-action="direct-call"]')) {
        var callItem = document.createElement("div");
        callItem.className = "ctx-item";
        callItem.dataset.action = "direct-call";
        callItem.innerHTML = '<span class="ctx-icon">📞</span>Direkt Ara (P2P)';
        callItem.onclick = function () { var m = document.getElementById("ctx-menu"); if (m) m.remove(); if (typeof window.startDirectCall === "function") window.startDirectCall(peerId); else if (typeof toast === "function") toast("@" + username + " aranıyor...", "info"); };
        var firstItem = menu.querySelector(".ctx-item");
        if (firstItem && firstItem.parentNode) firstItem.parentNode.insertBefore(callItem, firstItem.nextSibling);
        else menu.insertBefore(callItem, menu.firstChild);
      }

      // Not ekle / notu göster
      if (!menu.querySelector('[data-action="user-note"]')) {
        var noteItem = document.createElement("div");
        noteItem.className = "ctx-item";
        noteItem.dataset.action = "user-note";
        noteItem.innerHTML = '<span class="ctx-icon">📝</span>Not Ekle / Gör';
        noteItem.onclick = function () {
          var m = document.getElementById("ctx-menu"); if (m) m.remove();
          var existing = localStorage.getItem("scord_note_" + peerId);
          var note = prompt("@" + username + " için not:", existing || "");
          if (note !== null) { localStorage.setItem("scord_note_" + peerId, note); if (typeof toast === "function") toast("Not kaydedildi.", "info"); }
        };
        menu.appendChild(noteItem);
      }

      // Kullanıcı ID'sini kopyala
      if (!menu.querySelector('[data-action="copy-id"]')) {
        var idItem = document.createElement("div");
        idItem.className = "ctx-item";
        idItem.dataset.action = "copy-id";
        idItem.innerHTML = '<span class="ctx-icon">🆔</span>Kullanıcı ID Kopyala';
        idItem.onclick = function () {
          var m = document.getElementById("ctx-menu"); if (m) m.remove();
          if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(peerId).then(function () { if (typeof toast === "function") toast("ID kopyalandı: " + peerId, "info"); }).catch(function () {}); }
        };
        menu.appendChild(idItem);
      }
    };

    // Mesaj context menu - daha fazla seçenek
    var _origMSGC = window.showMsgContextMenu;
    if (_origMSGC) {
      window.showMsgContextMenu = function (msg, x, y) {
        _origMSGC.apply(this, arguments);
        var menu = document.getElementById("ctx-menu");
        if (!menu) return;

        // Mesaj ID kopyala (yoksa ekle)
        if (!menu.querySelector('[data-action="copy-msg-id"]')) {
          var idItem = document.createElement("div");
          idItem.className = "ctx-item";
          idItem.dataset.action = "copy-msg-id";
          idItem.innerHTML = '<span class="ctx-icon">🆔</span>Mesaj ID Kopyala';
          idItem.onclick = function () {
            var m = document.getElementById("ctx-menu"); if (m) m.remove();
            if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(msg.id || "").then(function () { if (typeof toast === "function") toast("Mesaj ID kopyalandı.", "info"); }).catch(function () {}); }
          };
          menu.appendChild(idItem);
        }
      };
    }
  }

  function patchThreadBug() {
    var _origCT = window.createThread;
    if (!_origCT) return;
    window.createThread = function (serverId, channelId, parentMessageId) {
      var ctxMenu = document.getElementById("ctx-menu");
      if (ctxMenu) ctxMenu.remove();
      var otherMenus = document.querySelectorAll("[id*='ctx'], .ctx-menu, .dropdown-menu");
      otherMenus.forEach(function (el) { if (el.id !== "ctx-menu") el.remove(); });
      return _origCT.apply(this, arguments);
    };

    var _origOTV = window.openThreadView;
    if (_origOTV) {
      window.openThreadView = function (serverId, threadId) {
        document.querySelectorAll(".ctx-menu, [id*='ctx-menu'], .dropdown").forEach(function (el) { el.remove(); });
        return _origOTV.apply(this, arguments);
      };
    }
  }

  function patchDMContextMenu() {
    var _origRDM = window.renderDMMessages;
    if (!_origRDM) return;
    window.renderDMMessages = function (peerId) {
      var result = _origRDM.apply(this, arguments);
      setTimeout(function () {
        var rows = document.querySelectorAll(".dm-msg-row");
        rows.forEach(function (row) {
          if (row.dataset.dmCtxAdded) return;
          row.dataset.dmCtxAdded = "1";
          row.addEventListener("contextmenu", function (e) {
            e.preventDefault();
            var messages = window.state?.dms?.[peerId] || [];
            var idx = Array.from(row.parentElement.children).indexOf(row);
            var msg = messages[idx];
            if (!msg) return;
            showDMContextMenu(e.clientX, e.clientY, msg, peerId);
          });
        });
      }, 100);
      return result;
    };
  }

  function showDMContextMenu(x, y, msg, peerId) {
    document.querySelectorAll(".ctx-menu, .dm-ctx-menu").forEach(function (el) { el.remove(); });
    var isOwn = msg.authorId === window.state?.peerId;
    var username = msg.author || "Kullanici";
    var isBlocked = window.state?.blockedPeers?.includes(peerId);
    var dmMuted = JSON.parse(localStorage.getItem("scord_dm_muted") || "[]").includes(peerId);

    var menu = document.createElement("div");
    menu.className = "ctx-menu dm-ctx-menu";
    menu.id = "dm-ctx-menu";
    menu.style.cssText = "position:fixed;left:" + Math.min(x, window.innerWidth - 220) + "px;top:" + Math.min(y, window.innerHeight - 300) + "px;z-index:100000;min-width:180px;background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:6px 0;box-shadow:0 4px 20px rgba(0,0,0,0.4);";

    function addItem(icon, label, action, danger) {
      var item = document.createElement("div");
      item.style.cssText = "padding:8px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text-normal);" + (danger ? "color:#ed4245;" : "");
      item.innerHTML = '<span style="font-size:14px;">' + icon + '</span><span>' + label + '</span>';
      item.onclick = function () { menu.remove(); action(); };
      menu.appendChild(item);
    }

    addItem("✂️", "Metni Kopyala", function () {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(msg.text || "");
    });

    if (isOwn) {
      addItem("🗑️", "Mesajı Sil", function () {
        var msgs = window.state.dms?.[peerId] || [];
        var idx = msgs.findIndex(function (m) { return m.id === msg.id; });
        if (idx !== -1) { msgs.splice(idx, 1); window.renderDMMessages(peerId); }
        var stored = JSON.parse(localStorage.getItem("scord_dms") || "{}");
        if (stored[peerId]) {
          stored[peerId] = stored[peerId].filter(function (m) { return m.id !== msg.id; });
          localStorage.setItem("scord_dms", JSON.stringify(stored));
        }
      }, true);
    }

    addItem(isBlocked ? "✅" : "🚫", isBlocked ? "Engeli Kaldır" : "Kişiyi Engelle", function () {
      if (!window.state.blockedPeers) window.state.blockedPeers = [];
      var idx = window.state.blockedPeers.indexOf(peerId);
      if (idx !== -1) { window.state.blockedPeers.splice(idx, 1); toast("@" + username + " engeli kaldırıldı.", "success"); }
      else { window.state.blockedPeers.push(peerId); toast("@" + username + " engellendi.", "info"); }
      localStorage.setItem("scord_blocked_peers", JSON.stringify(window.state.blockedPeers));
    }, !isBlocked);

    addItem(dmMuted ? "🔔" : "🔇", dmMuted ? "Bildirimleri Aç" : "Sessize Al", function () {
      var muted = JSON.parse(localStorage.getItem("scord_dm_muted") || "[]");
      var idx = muted.indexOf(peerId);
      if (idx !== -1) { muted.splice(idx, 1); toast("DM bildirimleri açıldı.", "success"); }
      else { muted.push(peerId); toast("DM sessize alındı.", "info"); }
      localStorage.setItem("scord_dm_muted", JSON.stringify(muted));
    });

    addItem("❌", "Konuşmayı Sil", function () {
      if (!confirm("@" + username + " ile olan tüm mesajları silmek istediğine emin misin?")) return;
      if (window.state?.dms) delete window.state.dms[peerId];
      var stored = JSON.parse(localStorage.getItem("scord_dms") || "{}");
      delete stored[peerId];
      localStorage.setItem("scord_dms", JSON.stringify(stored));
      if (window.state?.recentDMs) {
        window.state.recentDMs = window.state.recentDMs.filter(function (d) { return d.peerId !== peerId; });
        localStorage.setItem("scord_recent_dms", JSON.stringify(window.state.recentDMs));
      }
      window.state.activeDM = null;
      var ov = document.getElementById("dm-overlay");
      if (ov) ov.classList.add("hidden");
      var main = document.getElementById("dm-main-view");
      if (main) main.classList.add("hidden");
      if (typeof window.renderHomeSidebar === "function") window.renderHomeSidebar();
      toast("Konuşma silindi.", "info");
    }, true);

    document.body.appendChild(menu);
    setTimeout(function () {
      document.addEventListener("click", function handler(e) {
        menu.remove();
        document.removeEventListener("click", handler);
      });
    }, 0);
  }

  function fixChatDesign() {
    var style = document.createElement("style");
    style.id = "scord-chat-design-fix";
    style.textContent = `
      #chat-channel-name { display: none !important; }
      .chat-header .header-right { display: none !important; }
      #active-channel-name { font-size: 16px !important; font-weight: 600 !important; color: var(--text-normal) !important; }
      .channel-hash { color: var(--text-muted) !important; font-size: 18px !important; margin-right: 4px !important; }
      .chat-header { background: var(--bg-elevated) !important; border-bottom: 1px solid var(--border) !important; padding: 12px 16px !important; }
      .chat-header .header-left { display: flex !important; align-items: center !important; gap: 8px !important; }
    `;
    document.head.appendChild(style);
  }

  /* ══════════════════════════════════════════════════════════
     17. OYUN AKTİVİTESİ BÖLÜMÜ
  ══════════════════════════════════════════════════════════ */

  function patchGameActivity() {
    if (!window.state) return;
    if (!window.state.gameActivity) window.state.gameActivity = null;

    // Oyun aktivitesi modalı
    window.openGameActivityModal = function () {
      var current = window.state?.gameActivity;
      var name = current?.name || "";
      var details = current?.details || "";
      if (typeof showModal === "function") {
        var html = '<div class="form-group"><label class="modal-label">Oyun Adı</label><input class="modal-input" id="ga-name" value="' + name.replace(/"/g, "&quot;") + '" placeholder="Örn: Valorant, LoL, CS2..." maxlength="64" /></div><div class="form-group"><label class="modal-label">Durum (opsiyonel)</label><input class="modal-input" id="ga-details" value="' + details.replace(/"/g, "&quot;") + '" placeholder="Örn: Sıralı, Custom..." maxlength="64" /></div><p class="modal-info">Oyundayken profilinde ve üye listesinde görünür. Boş bırakıp kaydedersen sıfırlanır.</p>';
        showModal("Oyun Aktivitesi", html, '<button class="btn-secondary" onclick="hideModal()">İptal</button><button class="btn-primary" onclick="window.saveGameActivity()">Kaydet</button>');
      }
    };

    window.saveGameActivity = function () {
      var name = document.getElementById("ga-name")?.value?.trim() || "";
      var details = document.getElementById("ga-details")?.value?.trim() || "";
      if (!window.state) return;
      if (name) {
        window.state.gameActivity = { name: name, details: details, startTime: Date.now() };
        localStorage.setItem("scord_game_activity", JSON.stringify(window.state.gameActivity));
        if (typeof toast === "function") toast("Oyun aktivitesi: " + name, "success");
        // Broadcast to peers
        if (window.state?.mesh) {
          window.state.mesh.broadcast({ type: "game_activity", payload: window.state.gameActivity });
        }
        if (typeof sendServerEvent === "function") {
          sendServerEvent({ type: "game_activity", activity: window.state.gameActivity });
        }
      } else {
        window.state.gameActivity = null;
        localStorage.removeItem("scord_game_activity");
        if (typeof toast === "function") toast("Oyun aktivitesi kaldırıldı.", "info");
        if (window.state?.mesh) {
          window.state.mesh.broadcast({ type: "game_activity", payload: null });
        }
      }
      if (typeof hideModal === "function") hideModal();
      if (typeof updateMembersPanel === "function" && window.state.activeServerId) updateMembersPanel(window.state.activeServerId);
    };

    // Aktivite bildirimini işle
    var _origHSP = window.handleServerMessage;
    if (_origHSP) {
      var _prevHSP = window.handleServerMessage;
      window.handleServerMessage = function (data) {
        if (data?.type === "game_activity") {
          if (window.state) {
            var pid = data.from || data.peerId;
            if (pid && window.state._gameActivities) {
              window.state._gameActivities[pid] = data.activity;
              if (window.state.activeServerId && typeof updateMembersPanel === "function") updateMembersPanel(window.state.activeServerId);
            }
          }
          return;
        }
        return _prevHSP.apply(this, arguments);
      };
    }

    // P2P mesajları için oyun aktivitesi handler
    var _origP2P = window.handleIncomingP2P;
    if (_origP2P) {
      var _prevP2P = window.handleIncomingP2P;
      window.handleIncomingP2P = function (fromPeerId, data, roomId) {
        if (data?.type === "game_activity") {
          if (window.state) {
            if (!window.state._gameActivities) window.state._gameActivities = {};
            window.state._gameActivities[fromPeerId] = data.payload;
            if (window.state.activeServerId && typeof updateMembersPanel === "function") updateMembersPanel(window.state.activeServerId);
          }
          return;
        }
        return _prevP2P.apply(this, arguments);
      };
    }

    // Profil modalına oyun aktivitesi ekle
    var _origOUP = window.openUserProfile;
    if (_origOUP) {
      window.openUserProfile = function (peerId, username, avatarImage, avatarColor) {
        _origOUP.apply(this, arguments);
        // Oyun aktivitesini profile ekle
        var game = window.state?.gameActivity;
        if (game && peerId === window.state?.peerId) {
          var profileContent = document.querySelector(".modal-content");
          if (profileContent && !profileContent.querySelector(".user-game-activity")) {
            var el = document.createElement("div");
            el.className = "user-game-activity";
            el.style.cssText = "margin-top:12px;padding:10px;background:rgba(255,255,255,0.05);border-radius:8px;";
            el.innerHTML = '<div style="font-size:11px;opacity:0.6;margin-bottom:4px;">🎮 OYNUYOR</div><div style="font-weight:600;font-size:14px;">' + game.name + '</div>' + (game.details ? '<div style="font-size:12px;opacity:0.7;">' + game.details + '</div>' : '');
            profileContent.appendChild(el);
          }
        }
      };
    }

    // Ana sayfaya "Oyun Aktivitesi" butonu ekle
    function addGameBtn() {
      var homeView = document.getElementById("home-view");
      if (!homeView || homeView.querySelector(".ga-set-btn")) return;
      var btn = document.createElement("button");
      btn.className = "ga-set-btn hero-btn";
      btn.style.cssText = "margin-top:10px;padding:8px 18px;font-size:13px;";
      btn.innerHTML = "🎮 Oyun Aktivitesi Ayarla";
      btn.onclick = function () { if (typeof window.openGameActivityModal === "function") window.openGameActivityModal(); };
      var hero = homeView.querySelector(".home-hero");
      if (hero) hero.appendChild(btn);
    }

    var _gaObsTimer = null;
    var homeObs = new MutationObserver(function () {
      if (_gaObsTimer) return;
      _gaObsTimer = setTimeout(function () { _gaObsTimer = null; addGameBtn(); }, 300);
    });
    // Optimize: Sadece home-view'ı izle, tüm body'yi değil
    setTimeout(function () {
      var homeView = document.getElementById("home-view") || document.querySelector(".home-view");
      if (homeView) homeObs.observe(homeView, { childList: true, subtree: true });
      else homeObs.observe(document.body, { childList: true, subtree: true });
    }, 1000);

    // localStorage'dan geri yükle
    try {
      var saved = JSON.parse(localStorage.getItem("scord_game_activity"));
      if (saved && saved.name) window.state.gameActivity = saved;
    } catch (e) {}
  }

  /* ══════════════════════════════════════════════════════════
     18. CHAT ARKA PLANI DAHA AYDINLIK
  ══════════════════════════════════════════════════════════ */

  function patchThemeColors() {
    if (document.getElementById("scord-theme-fix")) return;
    var style = document.createElement("style");
    style.id = "scord-theme-fix";
    style.textContent = [
      ":root{",
      "--bg-deep:#12121e;",        // #0a0a14 → daha aydınlık
      "--bg-base:#19192b;",        // #11111f → daha aydınlık
      "--bg-elevated:#22223a;",    // #1a1a2e → daha aydınlık
      "--bg-active:#2c2c4a;",
      "--bg-hover:#343454;",
      "--border:#3d3d60;",
      "}",
      'html[data-scord-palette="paper"]{--bg-deep:#1e2330;--bg-base:#28303f;--bg-elevated:#2f3849;}',
      'html[data-scord-palette="forest"]{--bg-deep:#0c2018;--bg-base:#122a20;--bg-elevated:#183528;}',
      'html[data-scord-palette="midnight"]{--bg-deep:#0a0a12;--bg-base:#10101c;--bg-elevated:#161624;}',
      'html[data-scord-palette="oberon"]{--bg-deep:#141428;--bg-base:#1c1c34;--bg-elevated:#242444;--accent:#c084fc;--accent-light:#d8b4fe;}',
    ].join("");
    document.head.appendChild(style);
  }

  /* ══════════════════════════════════════════════════════════
     19. PERFORMANS DEBOUNCE
  ══════════════════════════════════════════════════════════ */

  /* ══════════════════════════════════════════════════════════
     17. PERFORMANS DEBOUNCE
  ══════════════════════════════════════════════════════════ */

  function patchPerformance() {
    var _timers = {};

    function debounce(key, fn, ms) {
      if (_timers[key]) clearTimeout(_timers[key]);
      _timers[key] = setTimeout(function () { delete _timers[key]; fn(); }, ms || 16);
    }

    var _origRM = window.renderMessages;
    if (_origRM) {
      window.renderMessages = function (serverId, channelId) {
        debounce("rm_" + serverId + "_" + channelId, function () { _origRM(serverId, channelId); }, 16);
      };
    }

    var _origUCS = window.updateChannelSidebar;
    if (_origUCS) {
      window.updateChannelSidebar = function (serverId) {
        debounce("ucs_" + serverId, function () { _origUCS(serverId); }, 16);
      };
    }

    var _origUMP = window.updateMembersPanel;
    if (_origUMP) {
      window.updateMembersPanel = function (serverId) {
        debounce("ump_" + serverId, function () { _origUMP(serverId); }, 16);
      };
    }

    // All scrollable areas passive touch
    document.addEventListener("touchstart", function () {}, { passive: true });
    document.addEventListener("touchmove", function () {}, { passive: true });
    document.addEventListener("wheel", function () {}, { passive: true });
  }

  /* ══════════════════════════════════════════════════════════
     20. BASİT ŞİFRE SİSTEMİ - nick + şifre → kalıcı ID
  ══════════════════════════════════════════════════════════ */

  function patchPasswordSystem() {
    if (!window.state) return;

    // Şifreden unique ID oluştur
    window._makeIdFromPass = function (nick, pass) {
      var h = 0;
      var str = (nick || "").toLowerCase().trim() + ":" + (pass || "");
      for (var i = 0; i < str.length; i++) {
        h = ((h << 5) - h) + str.charCodeAt(i);
        h |= 0;
      }
      return "id_" + Math.abs(h).toString(36);
    };

    // Kayıtlı kimliği yükle
    var savedNick = localStorage.getItem("scord_username");
    var savedPass = localStorage.getItem("scord_pass");
    var savedId = localStorage.getItem("scord_identity_id");

    if (savedNick && savedPass && savedId) {
      window.state.peerId = savedId;
      window.state.username = savedNick;
      if (!window.state._savedNick) window.state._savedNick = savedNick;
      console.log("[Fixes] Identity restored:", savedNick, savedId);
    }

    // OTOMATİK GİRİŞ - kayıtlı kimlik varsa setup'ı beklemeden direkt startApp
    if (savedNick && savedPass && savedId && typeof window.startApp === "function" && !window._autoLoginDone) {
      window._autoLoginDone = true;
      // setup overlay'i gizle, app'i göster
      var ov = document.getElementById("setup-overlay");
      if (ov) { ov.classList.remove("active"); ov.style.display = "none"; }
      var appEl = document.getElementById("app");
      if (appEl) appEl.classList.remove("hidden");
      // startApp'i çağır
      try { window.startApp(); } catch (e) { console.warn("[Fixes] auto-startApp:", e); }
    }

    // Setup ekranına şifre alanı ekle (sadece YENİ kullanıcılar için)
    if (!savedNick || !savedPass || !savedId) {
      var setupCheck = setInterval(function () {
        var setupOverlay = document.getElementById("setup-overlay");
        var setupCard = setupOverlay ? setupOverlay.querySelector(".setup-card") : null;
        if (!setupCard) return;
        if (setupCard.querySelector(".scord-pass-field")) {
          clearInterval(setupCheck);
          return;
        }
        clearInterval(setupCheck);

      var nickInput = document.getElementById("username-input");
      var enterBtn = setupCard.querySelector("#enter-btn");
      if (!nickInput || !enterBtn) return;

      // Şifre alanını ekle
      var formGroup = setupCard.querySelector(".form-group");
      if (!formGroup) return;
      
      var passHtml = '<div class="form-group scord-pass-field" style="margin-top:12px;"><label for="scord-pass-input">Şifre</label><input id="scord-pass-input" type="password" placeholder="Şifreni gir (her girişte aynı)" maxlength="64" autocomplete="off" style="width:100%;padding:10px 14px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,0.06);color:#fff;font-size:14px;outline:none;box-sizing:border-box;" /></div>';
      formGroup.insertAdjacentHTML("afterend", passHtml);

      // Butonu güncelle
      enterBtn.textContent = "Giriş Yap";

      // Orijinal handler'ı kaldırmak için butonu klonla
      var newBtn = enterBtn.cloneNode(true);
      if (enterBtn.parentNode) enterBtn.parentNode.replaceChild(newBtn, enterBtn);

      var passInput = document.getElementById("scord-pass-input");

      // Disabled state
      function updDisabled() {
        var n = document.getElementById("username-input")?.value?.trim();
        var p = document.getElementById("scord-pass-input")?.value || "";
        newBtn.disabled = !n || !p;
      }
      if (savedNick) newBtn.disabled = false;
      else newBtn.disabled = true;

      if (nickInput) nickInput.addEventListener("input", updDisabled);
      if (passInput) passInput.addEventListener("input", updDisabled);
      
      // Capture phase ile Enter'ı yakala
      if (nickInput) {
        nickInput.addEventListener("keydown", function(e) {
          if (e.key === "Enter") {
            e.stopPropagation();
            e.preventDefault();
            if (!newBtn.disabled) newBtn.click();
          }
        }, true);
      }
      if (passInput) {
        passInput.addEventListener("keydown", function(e) {
          if (e.key === "Enter" && !newBtn.disabled) newBtn.click();
        });
      }

      // Buton click
      newBtn.onclick = function () {
        var nick = nickInput?.value?.trim();
        var pass = passInput?.value || "";
        if (!nick || !pass) {
          if (typeof toast === "function") toast("Nick ve şifre gerekli.", "error");
          return;
        }
        
        // Identity oluştur
        var identityId = window._makeIdFromPass(nick, pass);
        window.state.peerId = identityId;
        window.state.username = nick;
        window.state._savedNick = nick;
        window.state._savedPass = pass;
        
        localStorage.setItem("scord_username", nick);
        localStorage.setItem("scord_pass", pass);
        localStorage.setItem("scord_identity_id", identityId);
        localStorage.setItem("scord_peer_id", identityId);
        
        console.log("[Fixes] Identity created:", nick, identityId);
        
        // startApp
        if (typeof startApp === "function" && !window._startAppRunning) {
          try { startApp(); } catch (e) { console.error("[Fixes] startApp error:", e); }
        }
      };
    }, 200);

    // startApp patch - "Anonim" fix
    var _origSA = window.startApp;
    if (_origSA && !window._scordSafix) {
      window._scordSafix = true;
      window.startApp = function () {
        var savedNick = localStorage.getItem("scord_username");
        if (savedNick && window.state) {
          window.state.username = savedNick;
        }
        
        var result;
        try { result = _origSA.apply(this, arguments); } catch (e) {}
        
        var nameEl = document.getElementById("user-bar-name");
        if (savedNick && nameEl && (nameEl.textContent === "Anonim" || !nameEl.textContent)) {
          nameEl.textContent = savedNick;
        }
        
        return result;
      };
    }
    
    // Watchdog - her ihtimale karşı "Anonim"i düzelt
    setInterval(function () {
      var nameEl = document.getElementById("user-bar-name");
      if (!nameEl) return;
      if (nameEl.textContent === "Anonim" || !nameEl.textContent) {
        var nick = localStorage.getItem("scord_username");
        if (nick) {
          nameEl.textContent = nick;
          if (window.state) window.state.username = nick;
        }
      }
    }, 1500);

    console.log("[Fixes] Password system ready");
  }

  /* ══════════════════════════════════════════════════════════
     20b. SUNUCU + ARKADAŞ + DM KALICILIĞI
  ══════════════════════════════════════════════════════════ */

  function patchPersistence() {
    // App.js'in loadSavedServers'ını patch'le - ghost server'ları temizle
    if (typeof window.loadSavedServers === "function") {
      var _origLSS = window.loadSavedServers;
      window.loadSavedServers = function () {
        var result = _origLSS.apply(this, arguments);
        
        // Left servers listesini temizle
        try {
          var leftServers = JSON.parse(localStorage.getItem("scord_left_servers") || "[]");
          if (leftServers.length > 0 && window.state?.servers) {
            window.state.servers = window.state.servers.filter(function (s) {
              return leftServers.indexOf(s.id) === -1;
            });
          }
        } catch (e) {}
        
        // Her sunucuya ownerID ekle (yoksa)
        var identityId = localStorage.getItem("scord_identity_id") || window.state?.peerId;
        if (identityId && window.state?.servers) {
          window.state.servers.forEach(function (s) {
            if (!s.ownerId) s.ownerId = identityId;
          });
        }
        
        return result;
      };
    }

    // saveServerSettings'i patch'le - her değişiklikte identity'ye kaydet
    if (typeof window.saveServerSettings === "function") {
      var _origSSS = window.saveServerSettings;
      window.saveServerSettings = function () {
        var result = _origSSS.apply(this, arguments);
        // Tüm veriyi identity altına kaydet
        var nick = localStorage.getItem("scord_username");
        var pass = localStorage.getItem("scord_pass");
        if (nick && pass && window.state) {
          var key = "scord_identity_" + window._makeIdFromPass(nick, pass);
          var data = {
            servers: window.state.servers || [],
            friends: window.state.friends || [],
            dms: window.state.dms || {},
            recentDMs: window.state.recentDMs || [],
            peerId: window.state.peerId,
            username: window.state.username,
            avatarColor: window.state.avatarColor,
            avatarImage: window.state.avatarImage
          };
          try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
        }
        return result;
      };
    }

    // Identity'den tüm veriyi yükle (startApp'ten önce)
    var loadedNick = localStorage.getItem("scord_username");
    var loadedPass = localStorage.getItem("scord_pass");
    if (loadedNick && loadedPass) {
      var loadKey = "scord_identity_" + window._makeIdFromPass(loadedNick, loadedPass);
      try {
        var savedData = JSON.parse(localStorage.getItem(loadKey));
        if (savedData && window.state) {
          if (savedData.servers) window.state.servers = savedData.servers;
          if (savedData.friends) window.state.friends = savedData.friends;
          if (savedData.dms) window.state.dms = savedData.dms;
          if (savedData.recentDMs) window.state.recentDMs = savedData.recentDMs;
          if (savedData.avatarColor) window.state.avatarColor = savedData.avatarColor;
          if (savedData.avatarImage) window.state.avatarImage = savedData.avatarImage;
        }
      } catch (e) {}
    }
    
    console.log("[Fixes] Persistence system ready");
  }

  /* ══════════════════════════════════════════════════════════
     20c. CHAT HEADER FİX + ODA BULUNAMADI HATASI
  ══════════════════════════════════════════════════════════ */

  function patchChatHeader() {
    // showChatView'i patch'le - duplicate channel name fix
    if (typeof window.showChatView === "function") {
      var _origSCV = window.showChatView;
      window.showChatView = function (serverId, channelId) {
        var result = _origSCV.apply(this, arguments);
        
        // Çift "#genel" sorununu düzelt
        var chatName = document.getElementById("chat-channel-name");
        if (chatName) {
          chatName.style.display = "none";
          chatName.textContent = "";
        }
        
        // "Oda bulunamadı" hatasını önlemek için channel'ı kontrol et
        setTimeout(function () {
          var activeName = document.getElementById("active-channel-name");
          if (activeName) {
            var channel = null;
            if (window.state?.activeServerId && window.state?.activeChannelId) {
              var server = window.state.servers.find(function (s) { return s.id === window.state.activeServerId; });
              if (server) {
                channel = server.channels.find(function (c) { return c.id === window.state.activeChannelId; });
              }
            }
            // Eğer kanal bulunamadıysa veya isim boşsa, düzelt
            if (!channel && window.state?.activeChannelId) {
              // Fallback: channelId'yi isim olarak göster
              activeName.textContent = window.state.activeChannelId;
            }
          }
        }, 50);
        
        return result;
      };
    }

    // CSS ile kalıcı fix
    var style = document.getElementById("scord-chat-design-fix");
    if (!style) {
      var s = document.createElement("style");
      s.id = "scord-chat-design-fix";
      s.textContent = "#chat-channel-name { display: none !important; }";
      document.head.appendChild(s);
    } else {
      style.textContent += "#chat-channel-name { display: none !important; }";
    }
    
    console.log("[Fixes] Chat header fixed");
  }

  /* ══════════════════════════════════════════════════════════
     21. MESAJ GEÇMİŞİNİ TEMİZLE
  ══════════════════════════════════════════════════════════ */

  function patchClearMessages() {
    window.clearServerMessages = function (serverId) {
      if (!confirm("Tüm mesaj geçmişini silmek istediğine emin misin? Bu geri alınamaz.")) return;
      var server = window.state?.servers?.find(function (s) { return s.id === serverId; });
      if (!server) return;
      server.messages = {};
      server.pinned_messages = [];
      if (typeof toast === "function") toast("Mesaj geçmişi temizlendi.", "success");
      if (typeof renderMessages === "function" && window.state.activeServerId === serverId) renderMessages(serverId, window.state.activeChannelId);
    };

    // Sunucu ayarlarına "Mesaj Geçmişini Temizle" butonu ekle - debounced
    var _cmObsTimer = null;
    var obs = new MutationObserver(function () {
      if (_cmObsTimer) return;
      _cmObsTimer = setTimeout(function () {
        _cmObsTimer = null;
        var advancedTab = document.getElementById("s-tab-advanced");
        if (advancedTab && !advancedTab.querySelector(".clear-msgs-btn")) {
          var btn = document.createElement("button");
          btn.className = "clear-msgs-btn btn-secondary";
          btn.style.cssText = "margin-top:12px;background:var(--yellow,#f59e0b);border:none;color:#000;";
          btn.textContent = "🗑 Tüm Mesaj Geçmişini Sil";
          btn.onclick = function () {
            if (window.state?.activeServerId) window.clearServerMessages(window.state.activeServerId);
          };
          advancedTab.appendChild(btn);
        }
      }, 300);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  /* ══════════════════════════════════════════════════════════
     22. SUNUCU LİSTESİ İYİLEŞTİRME
  ══════════════════════════════════════════════════════════ */

  function patchServerRail() {
    var style = document.createElement("style");
    style.id = "scord-rail-fix";
    style.textContent = [
      ".server-rail{overflow-y:auto;overflow-x:hidden;scrollbar-width:thin}",
      ".server-rail::-webkit-scrollbar{width:3px}",
      ".server-rail::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:3px}",
      ".rail-icon{transition:border-radius 0.15s ease,transform 0.1s ease}",
      ".rail-icon:hover{border-radius:14px;transform:scale(1.05)}",
      ".rail-icon.active{border-radius:14px}",
      ".rail-icon img{width:100%;height:100%;object-fit:cover;border-radius:inherit}",
      ".screen-overlay-tools{display:flex;align-items:center;gap:12px;padding:10px 16px;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);border-radius:12px;margin-top:8px}",
      ".screen-overlay-tool{background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);color:#fff;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;transition:all 0.15s ease}",
      ".screen-overlay-tool:hover{background:rgba(255,255,255,0.2);border-color:rgba(255,255,255,0.3);transform:scale(1.03)}",
      ".screen-overlay-tools label{display:flex;align-items:center;gap:6px;font-size:12px;color:rgba(255,255,255,0.7)}",
      ".screen-overlay-tools input[type=range]{width:80px;accent-color:var(--accent,#6366f1)}",
    ].join("");
    document.head.appendChild(style);
  }

  /* ══════════════════════════════════════════════════════════
     23. ARKADAŞ İSTEĞİ SİSTEMİ (P2P)
  ══════════════════════════════════════════════════════════ */

  function patchFriendRequestSystem() {
    // Arkadaş isteklerini yükle
    if (!window.state._friendRequests) {
      try { window.state._friendRequests = JSON.parse(localStorage.getItem("scord_friend_requests") || "[]"); } catch (e) { window.state._friendRequests = []; }
    }
    if (!window.state._pendingRequests) {
      try { window.state._pendingRequests = JSON.parse(localStorage.getItem("scord_pending_requests") || "[]"); } catch (e) { window.state._pendingRequests = []; }
    }

    // + butonu ekle (ARKADAŞLAR kategorisinin yanına)
    function addPlusButton() {
      var cats = document.querySelectorAll(".channel-category");
      cats.forEach(function (cat) {
        if (cat.textContent.trim() === "ARKADAŞLAR" && !cat.querySelector(".fr-add-btn")) {
          var btn = document.createElement("button");
          btn.className = "fr-add-btn";
          btn.textContent = "+";
          btn.title = "Arkadaş Ekle";
          btn.style.cssText = "float:right;background:var(--accent);color:#fff;border:none;width:22px;height:22px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0;line-height:1;transition:all 0.15s ease;";
          btn.onmouseover = function () { this.style.transform = "scale(1.15)"; };
          btn.onmouseout = function () { this.style.transform = "scale(1)"; };
          btn.onclick = function (e) { e.stopPropagation(); window.showAddFriendByTagModal(); };
          cat.style.position = "relative";
          cat.appendChild(btn);
        }
      });
    }

    var plusObs = new MutationObserver(addPlusButton);
    // Sadece sidebar'ı izle, tüm body'yi değil
    setTimeout(function () {
      var sidebar = document.getElementById("channel-list") || document.getElementById("channel-sidebar");
      if (sidebar) { plusObs.observe(sidebar, { childList: true, subtree: true }); }
      else { plusObs.observe(document.body, { childList: true, subtree: true }); }
    }, 1000);

    // Arkadaş isteği gönder
    window.sendFriendRequest = function (targetPeerId, targetTag) {
      if (!window.state?.mesh) { if (typeof toast === "function") toast("Bağlantı yok, istek gönderilemedi.", "error"); return; }
      var req = {
        type: "friend_request",
        from: window.state.peerId,
        username: window.state.username || "Anonim",
        tag: window.state._discriminator || "0000",
        targetTag: targetTag,
        timestamp: Date.now(),
      };
      window.state.mesh.broadcast(req);
      // Bekleyen istekleri kaydet
      if (!window.state._friendRequests) window.state._friendRequests = [];
      window.state._friendRequests.push({ peerId: targetPeerId, tag: targetTag, timestamp: Date.now() });
      localStorage.setItem("scord_friend_requests", JSON.stringify(window.state._friendRequests));
      if (typeof toast === "function") toast("Arkadaş isteği gönderildi!", "success");
    };

    // Gelen istekleri işle
    var _origP2P = window.handleIncomingP2P;
    if (_origP2P) {
      window.handleIncomingP2P = function (fromPeerId, data, roomId) {
        if (data?.type === "friend_request") {
          if (!window.state._pendingRequests) window.state._pendingRequests = [];
          // Aynı istek daha önce gelmiş mi?
          var exists = window.state._pendingRequests.some(function (r) { return r.from === data.from && r.username === data.username; });
          if (!exists) {
            window.state._pendingRequests.push({ from: data.from, username: data.username, tag: data.tag, timestamp: data.timestamp });
            localStorage.setItem("scord_pending_requests", JSON.stringify(window.state._pendingRequests));
            if (typeof toast === "function") toast("📩 Arkadaşlık isteği: @" + data.username + "#" + data.tag, "info");
            // Kabul/reddet butonlarıyla bildirim göster
            window._showFriendRequestNotification(data.from, data.username, data.tag);
          }
          return;
        }
        if (data?.type === "friend_request_accepted") {
          // Arkadaş eklendi
          var acceptedBy = data.from || data.peerId;
          var acceptedName = data.username || "Birisi";
          if (window.state) {
            if (!window.state.friends) window.state.friends = [];
            if (!window.state.friends.some(function (f) { return f.peerId === acceptedBy; })) {
              window.state.friends.push({ peerId: acceptedBy, name: acceptedName, avatarColor: data.avatarColor || "#5865f2", avatarImage: data.avatarImage || null, tag: data.tag || "" });
              localStorage.setItem("scord_friends", JSON.stringify(window.state.friends));
              // Bekleyen istekten kaldır
              if (window.state._friendRequests) {
                window.state._friendRequests = window.state._friendRequests.filter(function (r) { return r.peerId !== acceptedBy; });
                localStorage.setItem("scord_friend_requests", JSON.stringify(window.state._friendRequests));
              }
              if (typeof toast === "function") toast("✅ " + acceptedName + " arkadaşlık isteğini kabul etti!", "success");
              if (!window.state.activeServerId && typeof renderHomeSidebar === "function") renderHomeSidebar();
            }
          }
          return;
        }
        if (data?.type === "friend_request_rejected") {
          var rejectedBy = data.from || data.peerId;
          if (window.state._friendRequests) {
            window.state._friendRequests = window.state._friendRequests.filter(function (r) { return r.peerId !== rejectedBy; });
            localStorage.setItem("scord_friend_requests", JSON.stringify(window.state._friendRequests));
          }
          if (typeof toast === "function") toast("❌ Arkadaşlık isteği reddedildi.", "info");
          return;
        }
        return _origP2P.apply(this, arguments);
      };
    }

    // Bildirim göster
    window._showFriendRequestNotification = function (fromPeerId, username, tag) {
      var html = '<div style="text-align:center;padding:8px;"><div style="font-size:24px;margin-bottom:8px;">📩</div><div style="font-weight:600;margin-bottom:4px;">@' + username + '#' + tag + '</div><div style="font-size:13px;opacity:0.7;margin-bottom:12px;">size arkadaşlık isteği gönderdi</div><div style="display:flex;gap:8px;justify-content:center;"><button class="btn-primary" onclick="window._acceptFriendRequest(\'' + fromPeerId + '\',\'' + username.replace(/'/g, "\\'") + '\',\'' + (tag || "") + '\')">✅ Kabul Et</button><button class="btn-secondary" onclick="window._rejectFriendRequest(\'' + fromPeerId + '\')">❌ Reddet</button></div></div>';
      if (typeof showModal === "function") showModal("Arkadaşlık İsteği", html, '<button class="btn-secondary" onclick="hideModal()">Kapat</button>');
    };

    window._acceptFriendRequest = function (fromPeerId, username, tag) {
      if (window.state) {
        if (!window.state.friends) window.state.friends = [];
        if (!window.state.friends.some(function (f) { return f.peerId === fromPeerId; })) {
          window.state.friends.push({ peerId: fromPeerId, name: username, avatarColor: "#5865f2", avatarImage: null, tag: tag || "" });
          localStorage.setItem("scord_friends", JSON.stringify(window.state.friends));
        }
        // Bekleyen istekten kaldır
        if (window.state._pendingRequests) {
          window.state._pendingRequests = window.state._pendingRequests.filter(function (r) { return r.from !== fromPeerId; });
          localStorage.setItem("scord_pending_requests", JSON.stringify(window.state._pendingRequests));
        }
        // Kabul bildirimi gönder
        if (window.state.mesh) {
          window.state.mesh.broadcast({ type: "friend_request_accepted", from: window.state.peerId, username: window.state.username, avatarColor: window.state.avatarColor, avatarImage: window.state.avatarImage, tag: window.state._discriminator || "0000" });
        }
        if (typeof hideModal === "function") hideModal();
        if (typeof toast === "function") toast(username + " ile arkadaş oldunuz!", "success");
        if (!window.state.activeServerId && typeof renderHomeSidebar === "function") renderHomeSidebar();
      }
    };

    window._rejectFriendRequest = function (fromPeerId) {
      if (window.state._pendingRequests) {
        window.state._pendingRequests = window.state._pendingRequests.filter(function (r) { return r.from !== fromPeerId; });
        localStorage.setItem("scord_pending_requests", JSON.stringify(window.state._pendingRequests));
      }
      if (window.state?.mesh) {
        window.state.mesh.broadcast({ type: "friend_request_rejected", from: window.state.peerId });
      }
      if (typeof hideModal === "function") hideModal();
      if (typeof toast === "function") toast("İstek reddedildi.", "info");
    };

    // Bekleyen istek varsa otomatik bildirim göster
    if (window.state._pendingRequests && window.state._pendingRequests.length > 0) {
      var lastReq = window.state._pendingRequests[window.state._pendingRequests.length - 1];
      setTimeout(function () {
        window._showFriendRequestNotification(lastReq.from, lastReq.username, lastReq.tag);
      }, 2000);
    }
  }

  /* ══════════════════════════════════════════════════════════
     25. STATUS BAR FİX — innerHTML koruma
  ══════════════════════════════════════════════════════════ */

  function patchMemberStatus() {
    if (!window.state) window.state = {};
    if (!window.state.peerStatuses) window.state.peerStatuses = {};

    window.getMemberStatus = function (peerId) {
      if (peerId === window.state?.peerId) return window.state?.status || "online";
      return window.state?.peerStatuses?.[peerId]?.status || "offline";
    };

    window.getMemberStatusText = function (peerId) {
      var s = window.getMemberStatus(peerId);
      var icons = { online: "🟢", idle: "🟡", dnd: "🔴", offline: "⚫" };
      var labels = { online: "Çevrimiçi", idle: "Boşta", dnd: "Rahatsız Etmeyin", offline: "Çevrimdışı" };
      return (icons[s] || "⚫") + " " + (labels[s] || "Çevrimdışı");
    };

    var _origUpdateMembersPanel = window.updateMembersPanel;
    if (_origUpdateMembersPanel) {
      window.updateMembersPanel = function (serverId) {
        var r = _origUpdateMembersPanel.apply(this, arguments);
        var list = document.getElementById("members-list") || document.querySelector(".members-list");
        if (list) {
          list.querySelectorAll(".member-item").forEach(function (item) {
            var pid = item.dataset.peerId || item.dataset.memberId;
            if (!pid) return;
            var dot = item.querySelector(".member-status-dot, .status-dot");
            var txt = item.querySelector(".member-status-text, .status-text");
            if (dot) {
              var s = window.getMemberStatus(pid);
              var colors = { online: "#3ba55c", idle: "#faa61a", dnd: "#ed4245", offline: "#747f8d" };
              dot.style.background = colors[s] || "#747f8d";
            }
            if (txt) txt.textContent = window.getMemberStatusText(pid).slice(2);
          });
        }
        return r;
      };
    }

    var _origP2P = window.handleIncomingP2P;
    if (_origP2P) {
      window.handleIncomingP2P = function (fromPeerId, data, roomId) {
        if (data?.type === "status_update" || data?.type === "user_status") {
          if (!window.state.peerStatuses) window.state.peerStatuses = {};
          window.state.peerStatuses[fromPeerId] = {
            status: data.status || data.payload?.status || "online",
            customStatus: data.customStatus || data.payload?.customStatus || "",
            lastSeen: Date.now()
          };
          var list = document.getElementById("members-list") || document.querySelector(".members-list");
          if (list) {
            list.querySelectorAll(".member-item").forEach(function (item) {
              var pid = item.dataset.peerId || item.dataset.memberId;
              if (pid === fromPeerId) {
                var dot = item.querySelector(".member-status-dot, .status-dot");
                if (dot) {
                  var colors = { online: "#3ba55c", idle: "#faa61a", dnd: "#ed4245", offline: "#747f8d" };
                  dot.style.background = colors[window.state.peerStatuses[fromPeerId].status] || "#747f8d";
                }
              }
            });
          }
          return;
        }
        return _origP2P.apply(this, arguments);
      };
    }

    var _origHSP = window.handleServerMessage;
    if (_origHSP) {
      window.handleServerMessage = function (data) {
        if (data?.type === "status_update" || data?.type === "user_status") {
          var pid = data.from || data.peerId || data.userId;
          if (pid) {
            if (!window.state.peerStatuses) window.state.peerStatuses = {};
            window.state.peerStatuses[pid] = {
              status: data.status || data.payload?.status || "online",
              customStatus: data.customStatus || data.payload?.customStatus || "",
              lastSeen: Date.now()
            };
          }
          return;
        }
        return _origHSP.apply(this, arguments);
      };
    }

    // Kendi status'ümüzü periyodik olarak broadcast et
    function _broadcastMyStatus() {
      var mesh = window.state?.mesh;
      if (!mesh) return;
      var st = window.state?.status || "online";
      var cs = window.state?.customStatus || "";
      mesh.broadcast({ type: "user_status", status: st, customStatus: cs });
    }
    setInterval(_broadcastMyStatus, 30000);
    setTimeout(_broadcastMyStatus, 2000);
  }

  /* ══════════════════════════════════════════════════════════
     26. GENEL BUG FİXLERİ
  ══════════════════════════════════════════════════════════ */

  function patchGlobalBugs() {
    // 1) initSetup() double call fix
    var _origInitSetup = window.initSetup;
    if (typeof window.initSetup === "function") {
      var _setupCalled = false;
      window.initSetup = function () {
        if (_setupCalled) { console.warn("[fixes] initSetup blocked (double call)"); return; }
        _setupCalled = true;
        return _origInitSetup.apply(this, arguments);
      };
    }

    // 2) DM payload null check
    var _origSrvMsg = window.handleServerMessage;
    if (_origSrvMsg) {
      window.handleServerMessage = function (data) {
        if (data?.type === "dm" || data?.type === "text") {
          if (!data.payload) { console.warn("[fixes] DM with no payload, dropping"); return; }
        }
        return _origSrvMsg.apply(this, arguments);
      };
    }

    // 3) chatInput null check güvencesi
    var _safeChatInterval = setInterval(function () {
      var ci = document.getElementById("chat-input");
      if (!ci) return;
      clearInterval(_safeChatInterval);
      if (!ci.dataset._fixChecked) {
        ci.dataset._fixChecked = "1";
        ci.addEventListener("keydown", function (e) {
          if (e.key === "Enter" && !e.shiftKey) {
            var sendBtn = document.getElementById("send-btn");
            if (sendBtn) sendBtn.click();
          }
        });
      }
    }, 1000);

    // 4) handleIncomingP2P wrapper chain - app.js'deki local değişken fix
    // app.js'de onMessage callback'i bir local handleIncomingP2P değişkenini kullanır,
    // window.handleIncomingP2P'yi DEĞİL. fixes.js'deki wrapper'lar window sürümünü değiştirir
    // ama local değişken eski kalır. Bu nedenle en son window sürümünün 
    // local değişkene de atandığından emin olalım.
    // patchMusicBot ve patchMemberStatus zaten doğru chain yapıyor.
    // Burada sadece status handler'ların peerStatuses'e yazıldığını doğruluyoruz.
    if (window._p2pChainFixed) return; // sadece bir kere çalışsın
    window._p2pChainFixed = true;

    // 5) Ghost server temizliği - startApp'tan ÖNCE scord_left_servers'ı temizle
    // loadSavedServers() tüm scord_server_* anahtarlarını state.servers'a ekler.
    // Kullanıcının terk ettiği server'ları tekrar eklememek için "left list" kullan.
    if (!window._ghostCleanFixed) {
      window._ghostCleanFixed = true;
      try {
        var leftServers = JSON.parse(localStorage.getItem("scord_left_servers") || "[]");
        if (leftServers.length > 0) {
          leftServers.forEach(function (sid) {
            try { localStorage.removeItem("scord_server_" + sid); } catch (e) {}
          });
          // Ayrıca scord_saved_servers'dan da temizle
          try {
            var saved = JSON.parse(localStorage.getItem("scord_saved_servers") || "[]");
            var filtered = saved.filter(function (s) { return leftServers.indexOf(s.id) === -1; });
            if (saved.length !== filtered.length) {
              localStorage.setItem("scord_saved_servers", JSON.stringify(filtered));
            }
          } catch (e) {}
        }
      } catch (e) { console.warn("[fixes] Ghost pre-clean failed:", e); }
    }

    // 6) setStatus wrapper - çökme koruması + debounce
    if (typeof window.setStatus === "function" && !window._statusWrapFixed) {
      window._statusWrapFixed = true;
      var _origSetStatus = window.setStatus;
      var _statusTimer = null;
      window.setStatus = function (newStatus, customStatus, statusEmoji) {
        // Orijinal setStatus ZATEN updateMemberList() çağırıyor, ekstra çağırma
        try {
          _origSetStatus.apply(this, arguments);
        } catch (e) {
          console.error("[Fixes] setStatus error:", e);
          // Hata olursa state'i düzelt
          if (window.state) {
            window.state.status = newStatus || window.state.status || "online";
          }
        }
      };
    }
  }

  function patchStatusBar() {
    // Direkt showModal ile açılan status picker bazen çalışmıyor
    // Bunun yerine, kendi basit status picker'ımızı yapalım
    window._openStatusMenu = function () {
      var statusTypes = {
        online: { text: "Çevrimiçi", icon: "🟢", color: "#3ba55c" },
        idle: { text: "Boşta", icon: "🟡", color: "#faa61a" },
        dnd: { text: "Rahatsız Etmeyin", icon: "🔴", color: "#ed4245" },
        offline: { text: "Görünmez", icon: "⚫", color: "#747f8d" }
      };
      
      var menu = document.createElement("div");
      menu.id = "scord-status-menu";
      menu.style.cssText = "position:fixed;bottom:60px;left:10px;z-index:100000;background:#18181b;border:1px solid #333;border-radius:12px;padding:8px;box-shadow:0 8px 32px rgba(0,0,0,0.6);min-width:200px;";
      
      for (var key in statusTypes) {
        if (!statusTypes.hasOwnProperty(key)) continue;
        var s = statusTypes[key];
        var item = document.createElement("div");
        item.style.cssText = "padding:10px 14px;cursor:pointer;border-radius:8px;display:flex;align-items:center;gap:10px;font-size:14px;color:#ddd;transition:background 0.15s;";
        item.innerHTML = '<span style="font-size:18px;">' + s.icon + '</span><span>' + s.text + '</span>';
        item.onmouseover = function () { this.style.background = "rgba(255,255,255,0.08)"; };
        item.onmouseout = function () { this.style.background = "transparent"; };
        (function (k) {
          item.onclick = function () {
            if (typeof window.setStatus === "function") {
              window.setStatus(k, window.state?.customStatus || "", window.state?.statusEmoji || "");
            }
            var m = document.getElementById("scord-status-menu");
            if (m) m.remove();
          };
        })(key);
        menu.appendChild(item);
      }
      
      // Click outside to close
      document.addEventListener("click", function handler() {
        var m = document.getElementById("scord-status-menu");
        if (m) m.remove();
        document.removeEventListener("click", handler);
      }, { once: true });
      
      document.body.appendChild(menu);
    };
    
    // Status bar'a tıklanınca menüyü aç
    function setupStatusBar() {
      var bar = document.getElementById("status-bar");
      if (bar && !bar._scordStatusFixed) {
        bar._scordStatusFixed = true;
        bar.onclick = function (e) {
          e.stopPropagation();
          // Eğer showStatusPicker çalışıyorsa onu da dene, yoksa kendi menümüzü aç
          if (typeof window.showStatusPicker === "function") {
            window._openStatusMenu();
          } else {
            window._openStatusMenu();
          }
        };
        bar.style.cursor = "pointer";
      }
    }
    
    // setupStatusBar'ı sürekli kontrol et (DOM yeniden yüklenebilir)
    setInterval(setupStatusBar, 2000);
    setTimeout(setupStatusBar, 500);
    
    // updateStatusBar'ı HTML-güvenli patch'le - custom status özel karakterlerini escape et
    if (typeof window.STATUS_TYPES !== "undefined") {
      window.updateStatusBar = function () {
        var bar = document.getElementById("status-bar");
        if (!bar) return;

        var statusInfo = window.STATUS_TYPES[window.state?.status] || window.STATUS_TYPES?.online || { text: "Çevrimiçi", color: "#3ba55c" };
        var customStatus = window._escapeHtml(window.state?.customStatus || "");
        var statusEmoji = window.state?.statusEmoji || "";
        var gameActivity = window.state?.gameActivity;
        var activityHtml = "";
        
        if (gameActivity) {
          activityHtml = '<div class="status-activities">' + window._escapeHtml(gameActivity.name) + '</div>';
        }
        
        bar.innerHTML = 
          '<div class="status-indicator" style="--status-color:' + statusInfo.color + '" title="Durumu değiştirmek için tıkla">' +
            '<span class="status-dot"></span>' +
            '<span class="status-text">' + window._escapeHtml(statusInfo.text) + '</span>' +
          '</div>' +
          '<div class="status-custom">' +
            (statusEmoji ? '<span class="status-emoji">' + window._escapeHtml(statusEmoji) + '</span>' : "") +
            (customStatus ? '<span class="custom-status-text">' + customStatus + '</span>' : "") +
          '</div>' +
          activityHtml;
          
        setupStatusBar();
      };
    } else {
      // Fallback: eski patch
      var _origUSB = window.updateStatusBar;
      if (_origUSB) {
        window.updateStatusBar = function () {
          _origUSB.apply(this, arguments);
          setupStatusBar();
        };
      }
    }
    
    console.log("[Fixes] Status bar patched");
  }

  /* ══════════════════════════════════════════════════════════
     26. PROFİL — Nick tıklayınca kendi profil + avatar önizleme
  ══════════════════════════════════════════════════════════ */

  function patchProfileSystem() {
    // Nick'e tıklayınca kendi profili
    var _profileCheck = setInterval(function () {
      var nameEl = document.getElementById("user-bar-name");
      if (nameEl) {
        if (!nameEl.dataset.profilePatched) {
          nameEl.dataset.profilePatched = "1";
          nameEl.style.cursor = "pointer";
          nameEl.title = "Profilini Görüntüle (tıkla)";
          nameEl.onclick = function () {
            if (typeof openUserProfile === "function") {
              openUserProfile(window.state?.peerId, window.state?.username || window.state?.name, window.state?.avatarImage, window.state?.avatarColor);
            }
          };
        }
        clearInterval(_profileCheck);
      }
    }, 500);

    // Profil modalında avatar önizleme + değiştirme
    var _origOUP = window.openUserProfile;
    if (_origOUP) {
      window.openUserProfile = function (peerId, username, avatarImage, avatarColor) {
        var isSelf = peerId === window.state?.peerId;
        _origOUP.apply(this, arguments);

        if (!isSelf) return;
        var mc = document.querySelector(".modal-content");
        if (!mc || mc.querySelector(".pro-self-avatar")) return;

        // Profil kartını bul
        var proMain = mc.querySelector(".profile-pro-main");
        if (!proMain) return;

        // Avatar önizleme kısmı
        var selfSection = document.createElement("div");
        selfSection.className = "pro-self-avatar";
        selfSection.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:10px;padding:16px;background:rgba(255,255,255,0.03);border-radius:12px;margin:12px 0;";

        var preview = document.createElement("div");
        preview.style.cssText = "width:100px;height:100px;border-radius:50%;background-color:" + (avatarColor || "#5865f2") + ";background-image:url(" + (avatarImage || "") + ");background-size:cover;background-position:center;border:3px solid var(--accent);box-shadow:0 4px 16px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:40px;color:#fff;font-weight:700;transition:transform 0.2s ease;";
        if (!avatarImage) preview.textContent = (username ? username.charAt(0).toUpperCase() : "?");
        preview.onmouseover = function () { this.style.transform = "scale(1.05)"; };
        preview.onmouseout = function () { this.style.transform = "scale(1)"; };

        var btnRow = document.createElement("div");
        btnRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;justify-content:center;";

        var uploadBtn = document.createElement("button");
        uploadBtn.textContent = "📷 Fotoğraf Yükle";
        uploadBtn.style.cssText = "background:var(--accent);color:#fff;border:none;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500;transition:all 0.15s ease;";
        uploadBtn.onmouseover = function () { this.style.opacity = "0.85"; };
        uploadBtn.onmouseout = function () { this.style.opacity = "1"; };
        uploadBtn.onclick = function () {
          var input = document.createElement("input");
          input.type = "file";
          input.accept = "image/*";
          input.onchange = function (e) {
            var file = e.target.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function (ev) {
              var b64 = ev.target.result;
              if (window.state) {
                window.state.avatarImage = b64;
                localStorage.setItem("scord_avatar_image", b64);
                preview.style.backgroundImage = "url(" + b64 + ")";
                preview.textContent = "";
                var ua = document.getElementById("user-bar-avatar");
                if (ua && typeof applyAvatarToElement === "function") applyAvatarToElement(ua, window.state.avatarColor, b64, window.state.username);
                if (window.state.mesh) window.state.mesh.broadcast({ type: "broadcast", payload: { type: "profile_update", username: window.state.username, avatarImage: b64 } });
                if (typeof toast === "function") toast("Profil fotoğrafı güncellendi!", "success");
              }
            };
            reader.readAsDataURL(file);
          };
          input.click();
        };

        var urlBtn = document.createElement("button");
        urlBtn.textContent = "🔗 URL ile";
        urlBtn.style.cssText = "background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.15);padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;transition:all 0.15s ease;";
        urlBtn.onclick = function () {
          var url = prompt("Avatar URL'sini girin (https://...):");
          if (url && url.trim()) {
            var trimmed = url.trim();
            if (window.state) {
              window.state.avatarImage = trimmed;
              localStorage.setItem("scord_avatar_image", trimmed);
              preview.style.backgroundImage = "url(" + trimmed + ")";
              preview.textContent = "";
              var ua = document.getElementById("user-bar-avatar");
              if (ua && typeof applyAvatarToElement === "function") applyAvatarToElement(ua, window.state.avatarColor, trimmed, window.state.username);
              if (window.state.mesh) window.state.mesh.broadcast({ type: "broadcast", payload: { type: "profile_update", username: window.state.username, avatarImage: trimmed } });
              if (typeof toast === "function") toast("Profil fotoğrafı güncellendi!", "success");
            }
          }
        };

        btnRow.appendChild(uploadBtn);
        btnRow.appendChild(urlBtn);
        selfSection.appendChild(preview);
        selfSection.appendChild(btnRow);

        // Profil kartının üstüne ekle
        proMain.parentNode.insertBefore(selfSection, proMain);

        // Profil kartı tasarım iyileştirme
        var ps = document.createElement("style");
        ps.textContent = ".modal-content{border-radius:16px!important;overflow:hidden!important;max-width:440px!important}.profile-pro-card{border:none!important}.profile-pro-banner{height:120px!important}";
        document.head.appendChild(ps);
      };
    }
  }

  /* ══════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════ */

function init() {
    console.log("[Fixes] v2.4 - Starting...");
    applyPerf();
    applyChatStyle();
    patchThemeColors();

    function ready() {
      console.log("[Fixes] Ready, applying patches...");
      patchSaveServerSettings();
      patchWSHandler();
      hookSounds();
      enhanceDMOverlay();
      patchMusicBot();
      patchMessageDeletePermission();
      patchDMCloseButton();
      patchOpenDM();
      patchContextMenu();
      patchThreadBug();
      fixChatDesign();
      patchDMContextMenu();
      patchGameActivity();
      patchClearMessages();
      patchServerRail();
      patchMemberStatus();
      patchPasswordSystem();
      patchPersistence();
      patchChatHeader();
      patchGlobalBugs();
      patchFriendRequestSystem();
      patchProfileSystem();
      patchStatusBar();
      patchPerformance();
      patchAnimatedEmojis();
      patchDiscordAnimations();
      patchServerIcons();
      patchScreenShare();
      patchScreenOverlay();
      
      var _obsTimer = null;
      var obs = new MutationObserver(function () {
        if (_obsTimer) return;
        _obsTimer = setTimeout(function () {
          _obsTimer = null;
          enhanceDMOverlay();
          enhanceDMSidebar();
        }, 300);
      });
      obs.observe(document.body, { childList: true, subtree: true });

      if (typeof window.applyChatCustomization === "function") window.applyChatCustomization();
      console.log("[Shercord Fixes] Tum duzeltmeler yuklendi.");
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
    else ready();
  }

  /* ══════════════════════════════════════════════════════════
     ANİMASYONLU EMOJİ DESTEĞİ - GIF/APNG
  ══════════════════════════════════════════════════════════ */

  function patchAnimatedEmojis() {
    // Animated emoji CSS
    var animStyle = document.createElement("style");
    animStyle.id = "scord-anim-emoji";
    animStyle.textContent = `
      /* Animated emoji support */
      .custom-emoji {
        image-rendering: auto;
        display: inline-block;
        vertical-align: middle;
      }
      .custom-emoji.animated {
        animation: emoji-bounce 0.3s ease;
      }
      .custom-emoji:hover {
        transform: scale(1.15);
      }
      @keyframes emoji-bounce {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.2); }
      }
      
      /* Reaction hover animation */
      .reaction-pill:hover {
        transform: scale(1.05);
        background: var(--bg-hover);
      }
      .reaction-pill {
        transition: transform 0.15s ease, background 0.15s ease;
      }
    `;
    document.head.appendChild(animStyle);

    // Intersection Observer for animated emojis (only animate when visible)
    if (typeof IntersectionObserver !== "undefined") {
      var emojiObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            entry.target.play?.();
          } else {
            entry.target.pause?.();
          }
        });
      }, { threshold: 0.1 });
      window._emojiObserver = emojiObserver;
    }

    console.log("[Fixes] Animated emoji support enabled");
  }

  /* ══════════════════════════════════════════════════════════
     DISCORD TARZI UI ANİMASYONLARI
  ══════════════════════════════════════════════════════════ */

  function patchDiscordAnimations() {
    var animStyle = document.createElement("style");
    animStyle.id = "scord-discord-anim";
    animStyle.textContent = `
      /* Discord-style panel transitions */
      .panel, .modal, .ctx-menu {
        transition: opacity 0.2s ease, transform 0.2s ease;
      }
      
      /* Server icon hover animation - Discord style */
      .rail-icon, .server-rail-icon {
        transition: border-radius 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease;
      }
      .rail-icon:hover, .server-rail-icon:hover {
        border-radius: 16px !important;
        transform: scale(1.08);
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      }
      .rail-icon.active {
        border-radius: 16px !important;
      }
      
      /* Channel hover animation */
      .channel-item {
        transition: background 0.15s ease, transform 0.1s ease;
      }
      .channel-item:hover {
        background: var(--bg-hover);
        transform: translateX(2px);
      }
      
      /* Message hover */
      .msg-row {
        transition: background 0.1s ease;
      }
      .msg-row:hover {
        background: rgba(255,255,255,0.02);
      }
      
      /* Button hover effects */
      .btn, button {
        transition: all 0.15s ease;
      }
      .btn:hover, button:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      }
      .btn:active, button:active {
        transform: translateY(0);
        box-shadow: 0 2px 6px rgba(0,0,0,0.2);
      }
      
      /* Voice speaking animation */
      .voice-speaking {
        animation: voice-pulse 1.5s ease-in-out infinite;
      }
      @keyframes voice-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(88, 166, 255, 0.4); }
        50% { box-shadow: 0 0 0 8px rgba(88, 166, 255, 0); }
      }
      
      /* Loading spinner */
      .loading-spinner {
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      
      /* Toast animations */
      .toast {
        animation: toastSlideIn 0.3s ease;
      }
      @keyframes toastSlideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      
      /* Modal fade in */
      .modal-overlay {
        animation: modalFadeIn 0.2s ease;
      }
      @keyframes modalFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      /* User mention highlight animation */
      .mention {
        animation: mention-flash 0.5s ease;
      }
      @keyframes mention-flash {
        0%, 100% { background: transparent; }
        50% { background: rgba(88, 166, 255, 0.3); }
      }
      
      /* Typing indicator bounce */
      .typing-dot {
        animation: typing-bounce 1.4s ease-in-out infinite;
      }
      .typing-dot:nth-child(2) { animation-delay: 0.2s; }
      .typing-dot:nth-child(3) { animation-delay: 0.4s; }
      @keyframes typing-bounce {
        0%, 60%, 100% { transform: translateY(0); }
        30% { transform: translateY(-4px); }
      }
    `;
    document.head.appendChild(animStyle);

    // Add hover effects to server rail icons via JS (for dynamic elements)
    var serverRailObserver = new MutationObserver(function() {
      document.querySelectorAll(".rail-icon:not(.anim-patched), .server-rail-icon:not(.anim-patched)").forEach(function(icon) {
        icon.classList.add("anim-patched");
        icon.style.transition = "border-radius 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease";
      });
    });
    // Scope: sadece server-rail container'ını izle
    setTimeout(function () {
      var rail = document.getElementById("server-rail") || document.querySelector(".server-rail");
      if (rail) serverRailObserver.observe(rail, { childList: true, subtree: true });
      else serverRailObserver.observe(document.body, { childList: true, subtree: true });
    }, 1000);

    console.log("[Fixes] Discord-style animations enabled");

    // Discord-style reaction burst effect (on reaction add)
    var burstStyle = document.createElement("style");
    burstStyle.id = "scord-burst-effect";
    burstStyle.textContent = `
      /* Reaction burst animation - Discord style */
      .reaction-pill.burst {
        animation: reaction-burst 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }
      @keyframes reaction-burst {
        0% { transform: scale(1); }
        30% { transform: scale(1.3); }
        50% { transform: scale(0.95); }
        70% { transform: scale(1.1); }
        100% { transform: scale(1); }
      }
      
      /* Message appear animation */
      .msg-row {
        animation: msg-appear 0.15s ease-out;
      }
      @keyframes msg-appear {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      
      /* Status dot pulse animation */
      .status-dot.online {
        animation: status-pulse 2s ease-in-out infinite;
      }
      @keyframes status-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(59, 165, 92, 0.4); }
        50% { box-shadow: 0 0 0 4px rgba(59, 165, 92, 0); }
      }
      
      /* Channel unread indicator */
      .channel-unread {
        animation: unread-glow 2s ease-in-out infinite;
      }
      @keyframes unread-glow {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      
      /* Voice channel speaking ring */
      .voice-user.speaking .voice-user-avatar {
        animation: speak-ring 1.5s ease-in-out infinite;
      }
      @keyframes speak-ring {
        0%, 100% { box-shadow: 0 0 0 0 rgba(88, 166, 255, 0.5); }
        50% { box-shadow: 0 0 0 6px rgba(88, 166, 255, 0); }
      }
      
      /* Friend request badge pulse */
      .badge.friend-request {
        animation: bad-pulse 1s ease-in-out infinite;
      }
      @keyframes bad-pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.15); }
      }
    `;
    document.head.appendChild(burstStyle);
  }
  }

  /* ══════════════════════════════════════════════════════════
     SERVER İCON MODERNİZE ET
  ══════════════════════════════════════════════════════════ */

  function patchServerIcons() {
    var iconStyle = document.createElement("style");
    iconStyle.id = "scord-server-icons";
    iconStyle.textContent = `
      /* Modern server icons */
      .rail-icon, .server-rail-icon {
        border-radius: 50% !important;
        overflow: hidden;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      }
      .rail-icon img, .server-rail-icon img {
        object-fit: cover;
        width: 100%;
        height: 100%;
      }
      .rail-icon:hover, .server-rail-icon:hover {
        box-shadow: 0 4px 16px rgba(0,0,0,0.5), 0 0 0 2px var(--accent);
      }
      .rail-icon.active {
        box-shadow: 0 4px 16px rgba(99, 102, 241, 0.5), 0 0 0 2px var(--accent);
      }
      /* Add button style */
      .add-server-btn, .rail-add-icon {
        border-radius: 50%;
        background: linear-gradient(135deg, #2c2c3a, #1e1e28);
        border: 2px dashed rgba(255,255,255,0.2);
      }
      .add-server-btn:hover, .rail-add-icon:hover {
        border-color: var(--accent);
        background: linear-gradient(135deg, #3c3c4a, #2e2e38);
      }
    `;
    document.head.appendChild(iconStyle);
  }

  /* ══════════════════════════════════════════════════════════
     EKRAN PAYLAŞIMI FİX - Remote video gösterimi
  ══════════════════════════════════════════════════════════ */

  function patchScreenShare() {
    // ============================================================
    // FIX 1: Screen share audio koruma - sadece video track'ini ekle
    // ============================================================
    if (typeof window.startScreenShare === "function" && !window._screenShareFixed) {
      window._screenShareFixed = true;
      var _origSSS = window.startScreenShare;
      window.startScreenShare = async function () {
        try {
          // Orijinal fonksiyonu çağır
          var result = await _origSSS.apply(this, arguments);
          
          // ŞİMDİ: audio track'lerini düzelt - screen share sesi MİKROFONUN yerine geçmesin
          if (window.state?.mesh && window.state?.screenStream) {
            var stream = window.state.screenStream;
            var peers = window.state.mesh.peers || {};
            
            Object.values(peers).forEach(function (peerObj) {
              var pc = peerObj.pc;
              if (!pc || pc.connectionState === "closed") return;
              
              // Audio sender'ı bul - screen share audio'su ile replace edilmiş olabilir
              var audioSender = pc.getSenders().find(function (s) { return s.track && s.track.kind === "audio"; });
              
              // Eğer audio sender varsa ve track'i screen share stream'inden geliyorsa
              // (yani replace edilmişse), orijinal mic track'ini geri yükle
              if (audioSender && stream.getAudioTracks().indexOf(audioSender.track) !== -1) {
                // Screen share'ın audio track'ini sender'dan çıkar
                // NOT: replaceTrack(null) göndermeyi durdurur
                // En iyisi: screen share sesini KALDIR, sadece video bırak
                try {
                  // replaceTrack(null) ile audio'yu durdur (mic kesintisiz devam eder)
                  // Çünkü mic track'i ayrı bir stream'de
                  audioSender.replaceTrack(null).catch(function () {});
                } catch (e) {}
              }
            });
          }
          
          return result;
        } catch (e) {
          console.error("[Fixes] startScreenShare error:", e);
          throw e;
        }
      };
    }
    
    // ============================================================
    // FIX 2: Screen share bittiğinde mic'i kurtar + UI temizle
    // ============================================================
    if (typeof window.stopScreenShare === "function" && !window._screenStopFixed) {
      window._screenStopFixed = true;
      var _origStopSS = window.stopScreenShare;
      window.stopScreenShare = function () {
        try {
          // ÖNCE: state.screenStream'den audio track'lerini durdurma
          // (orijinal stopScreenShare stream.getTracks().forEach(t => t.stop()) yapar)
          // Ama mic track'i replace edilmiş olabilir - onu koru
          
          // Screen share kalktı mesajını broadcast et (orijinal fonksiyon öncesi)
          if (window.state?.mesh) {
            window.state.mesh.broadcast({
              type: "screen_status",
              sharing: false,
              channelId: window.state.voiceChannelId || window.state.activeChannelId
            });
          }
          
          _origStopSS.apply(this, arguments);
          
          // UI'ı force refresh
          if (window.state?.activeServerId && window.state?.voiceChannelId) {
            setTimeout(function () {
              if (typeof window.renderVoiceParticipants === "function") {
                window.renderVoiceParticipants(window.state.activeServerId, window.state.voiceChannelId);
              }
            }, 200);
          }
        } catch (e) {
          console.error("[Fixes] stopScreenShare error:", e);
        }
      };
    }
    
    // ============================================================
    // FIX 3: handleVoiceStream - video elementini DOM'a ekle
    // ============================================================
    if (typeof window.handleVoiceStream === "function") {
      var _origHVS = window.handleVoiceStream;
      window.handleVoiceStream = function (peerId, stream) {
        _origHVS(peerId, stream);
        var video = window.state?.remoteMedia?.[peerId];
        if (video && !video.parentNode) {
          video.style.cssText = "position:absolute;width:1px;height:1px;opacity:0.01;pointer-events:none;";
          document.body.appendChild(video);
        }
      };
    }
    
    // ============================================================
    // FIX 4: handleTrackAdded - screen share track'lerini de işle
    // ============================================================
    if (typeof window.handleTrackAdded === "function") {
      var _origHTA = window.handleTrackAdded;
      window.handleTrackAdded = function (peerId, track, stream) {
        if (!window.state) window.state = {};
        if (!window.state.remoteMedia) window.state.remoteMedia = {};
        if (!window.state.remoteMedia[peerId]) {
          var video = document.createElement("video");
          video.autoplay = true;
          video.playsInline = true;
          video.muted = true;
          video.className = "voice-video";
          video.style.cssText = "position:absolute;width:1px;height:1px;opacity:0.01;pointer-events:none;";
          document.body.appendChild(video);
          window.state.remoteMedia[peerId] = video;
        }
        
        _origHTA(peerId, track, stream);
        
        if (track.kind === "video") {
          setTimeout(function () {
            if (window.state?.activeServerId && window.state?.voiceChannelId) {
              if (typeof window.renderVoiceParticipants === "function") {
                window.renderVoiceParticipants(window.state.activeServerId, window.state.voiceChannelId);
              }
            }
          }, 500);
        }
      };
    }
    
    // ============================================================
    // FIX 5: screen_status mesajlarını dinle - force re-render
    // ============================================================
    if (typeof window.handleServerMessage === "function") {
      var _origHSM2 = window.handleServerMessage;
      window.handleServerMessage = function (data) {
        var result = _origHSM2.apply(this, arguments);
        
        if (data?.type === "screen_status") {
          setTimeout(function () {
            if (window.state?.activeServerId && (window.state?.voiceChannelId || data.channelId)) {
              if (typeof window.renderVoiceParticipants === "function") {
                window.renderVoiceParticipants(window.state.activeServerId, data.channelId || window.state.voiceChannelId);
              }
            }
          }, 300);
          
          // Screen share kapandıysa (sharing=false), video elementlerini temizle
          if (!data.sharing && data.from) {
            if (window.state?.remoteMedia?.[data.from]) {
              try {
                window.state.remoteMedia[data.from].srcObject = null;
                window.state.remoteMedia[data.from].remove();
                delete window.state.remoteMedia[data.from];
              } catch (e) {}
            }
          }
        }
        
        return result;
      };
    }
    
    // ============================================================
    // FIX 6: Watch button + CSS tasarım fix
    // ============================================================
    // CSS stili ekle
    var watchStyle = document.getElementById("scord-watch-style");
    if (!watchStyle) {
      var ws = document.createElement("style");
      ws.id = "scord-watch-style";
      ws.textContent = `
        .scord-watch-btn {
          padding: 8px 16px !important;
          border: none !important;
          border-radius: 8px !important;
          background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
          color: #fff !important;
          cursor: pointer !important;
          font-size: 13px !important;
          font-weight: 600 !important;
          margin-top: 8px !important;
          display: block !important;
          width: 100% !important;
          transition: all 0.2s ease !important;
          box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3) !important;
        }
        .scord-watch-btn:hover {
          transform: translateY(-1px) !important;
          box-shadow: 0 4px 16px rgba(99, 102, 241, 0.5) !important;
        }
        .scord-watch-btn:active {
          transform: translateY(0) !important;
        }
        /* Screen overlay video container */
        .screen-overlay-video {
          width: 100% !important;
          height: 100% !important;
          object-fit: contain !important;
          background: #000 !important;
        }
        .screen-overlay {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          height: 100% !important;
          background: rgba(0,0,0,0.9) !important;
          z-index: 999999 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
        .screen-overlay-close {
          position: absolute !important;
          top: 16px !important;
          right: 16px !important;
          padding: 8px 20px !important;
          border: none !important;
          border-radius: 8px !important;
          background: rgba(255,255,255,0.1) !important;
          color: #fff !important;
          cursor: pointer !important;
          font-size: 14px !important;
          font-weight: 600 !important;
          backdrop-filter: blur(8px) !important;
          z-index: 10 !important;
        }
        .screen-overlay-close:hover {
          background: rgba(255,255,255,0.2) !important;
        }
        .screen-overlay-label {
          position: absolute !important;
          bottom: 16px !important;
          left: 50% !important;
          transform: translateX(-50%) !important;
          padding: 6px 16px !important;
          border-radius: 8px !important;
          background: rgba(0,0,0,0.6) !important;
          color: #fff !important;
          font-size: 13px !important;
          backdrop-filter: blur(4px) !important;
          z-index: 10 !important;
        }
      `;
      document.head.appendChild(ws);
    }
    
    // Watch butonunu ekle
    if (typeof window.renderVoiceParticipants === "function") {
      var _origRVP = window.renderVoiceParticipants;
      window.renderVoiceParticipants = function (serverId, channelId) {
        var result = _origRVP.apply(this, arguments);
        
        setTimeout(function () {
          var cards = document.querySelectorAll(".vpc-card");
          cards.forEach(function (card) {
            if (card.querySelector(".scord-watch-btn")) return;
            var hasVideo = card.classList.contains("has-video");
            if (!hasVideo) return;
            
            var watchBtn = document.createElement("button");
            watchBtn.className = "scord-watch-btn";
            watchBtn.textContent = "🔍 İzle";
            
            var peerId = card.dataset.peerId || card.dataset.memberId;
            if (!peerId) {
              var nameEl = card.querySelector(".vpc-name");
              if (nameEl) peerId = nameEl.textContent;
            }
            
            watchBtn.onclick = function (e) {
              e.stopPropagation();
              if (typeof window.openScreenOverlay === "function") {
                window.openScreenOverlay(peerId, peerId);
              }
            };
            
            card.appendChild(watchBtn);
          });
        }, 100);
        
        return result;
      };
    }
    
    console.log("[Fixes] Screen share patch applied (audio fix + UI)");
  }

  /* ══════════════════════════════════════════════════════════
     SCREEN OVERLAY TAM EKRAN BUTONU
  ══════════════════════════════════════════════════════════ */

  function patchScreenOverlay() {
    if (typeof window.openScreenOverlay === "function") {
      var _origOSO = window.openScreenOverlay;
      window.openScreenOverlay = function (peerId, username) {
        var result = _origOSO.apply(this, arguments);
        
        // Overlay'e fullscreen butonu ekle
        setTimeout(function () {
          var overlay = document.getElementById("screen-overlay");
          if (!overlay || overlay.querySelector(".scord-fs-btn")) return;
          
          var video = overlay.querySelector(".screen-overlay-video");
          if (!video) return;
          
          var fsBtn = document.createElement("button");
          fsBtn.className = "scord-fs-btn";
          fsBtn.innerHTML = "⛶ Tam Ekran";
          fsBtn.title = "Tam ekran yap";
          fsBtn.style.cssText = "position:absolute;bottom:60px;right:20px;padding:8px 18px;border:none;border-radius:8px;background:linear-gradient(135deg,rgba(99,102,241,0.9),rgba(139,92,246,0.9));color:#fff;cursor:pointer;font-size:13px;font-weight:600;z-index:20;backdrop-filter:blur(8px);box-shadow:0 4px 16px rgba(99,102,241,0.4);transition:all 0.2s ease;";
          
          fsBtn.onmouseover = function () { this.style.transform = "scale(1.05)"; this.style.boxShadow = "0 6px 20px rgba(99,102,241,0.6)"; };
          fsBtn.onmouseout = function () { this.style.transform = "scale(1)"; this.style.boxShadow = "0 4px 16px rgba(99,102,241,0.4)"; };
          
          fsBtn.onclick = function (e) {
            e.stopPropagation();
            if (video.requestFullscreen) {
              video.requestFullscreen();
            } else if (video.webkitRequestFullscreen) {
              video.webkitRequestFullscreen();
            } else if (video.msRequestFullscreen) {
              video.msRequestFullscreen();
            }
          };
          
          overlay.appendChild(fsBtn);
          
          // Kapat butonunu da güncelle
          var closeBtn = overlay.querySelector(".screen-overlay-close");
          if (closeBtn) {
            closeBtn.style.cssText = "position:absolute;top:16px;right:16px;padding:10px 24px;border:none;border-radius:10px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;cursor:pointer;font-size:14px;font-weight:600;z-index:20;box-shadow:0 4px 16px rgba(239,68,68,0.4);transition:all 0.2s ease;";
            closeBtn.onmouseover = function () { this.style.transform = "scale(1.05)"; };
            closeBtn.onmouseout = function () { this.style.transform = "scale(1)"; };
          }
          
          // Label'ı güncelle
          var label = overlay.querySelector(".screen-overlay-label");
          if (label) {
            label.style.cssText = "position:absolute;bottom:16px;left:50%;transform:translateX(-50%);padding:8px 20px;border-radius:10px;background:rgba(0,0,0,0.7);color:#fff;font-size:13px;backdrop-filter:blur(4px);z-index:10;";
          }
        }, 100);
        
        return result;
      };
    }
    console.log("[Fixes] Screen overlay fullscreen button added");
  }

  init();
})();
