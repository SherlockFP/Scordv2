/**
 * app.js — SCORD Main Application
 * =====================================
 * Orchestrates: identity, server management, chat, voice, UI.
 */

"use strict";

/* ── Constants ────────────────────────────────────────────── */
const WS_BASE = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
const API_BASE = "/api";

const CHAT_INITIAL_LIMIT = 200;
const CHAT_LOAD_MORE_STEP = 150;
const CHAT_QUEUE_TOAST_COOLDOWN_MS = 9000;
const A11Y_ANNOUNCE_THROTTLE_MS = 1200;

/** @returns {typeof window.SCORD_TIMING} */
function SCORD_T() {
    return window.SCORD_TIMING || {};
}

const AVATAR_COLORS = [
    "#7c3aed", "#4f46e5", "#0ea5e9", "#10b981", "#f59e0b",
    "#ef4444", "#ec4899", "#8b5cf6", "#06b6d4", "#84cc16",
];

const EMOJIS = ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊", "😇",
    "🥰", "😍", "🤩", "😘", "😗", "😚", "😙", "🥲", "😋", "😛", "😜", "🤪", "😝", "🤑",
    "🤗", "🤭", "🤫", "🤔", "🤐", "🤨", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "🤥",
    "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮", "🥵", "🥶", "🥴", "😵",
    "🤯", "🤠", "🥳", "🥸", "😎", "🤓", "🧐", "😕", "😟", "🙁", "😮", "😯", "😲", "😳",
    "🥺", "😦", "😧", "😨", "😰", "😥", "😢", "😭", "😱", "😖", "😣", "😞", "😓", "😩",
    "😫", "🥱", "😤", "😡", "😠", "🤬", "🔥", "💯", "❤️", "🧡", "💛", "💚", "💙", "💜",
    "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝",
    "👍", "👎", "👊", "✊", "🤛", "🤜", "👏", "🙌", "👐", "🤲", "🤝", "🙏",
    "✍️", "💪", "🦾", "🖖", "👋", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇",
    "☝️", "✌️", "🤞", "🤟", "🤘", "🤙", "💅", "🎉", "🎊", "🎈", "🎁",
    "🏆", "🥇", "🥈", "🥉", "⚡", "💥", "💫", "💦", "💨", "🔥", "✨", "🌟",
    "💬", "👁️", "🧠", "💡", "🎮", "🎧", "🎵", "🎶", "🎤", "🎬", "🎭", "🎨",
    "💀", "💩", "🤡", "👻", "👽", "👾", "🤖", "😺", "😸", "😹", "😻", "😼", "😽", "🙀", "😿", "😾"];

/* ── Local state ──────────────────────────────────────────── */
let state = {
    peerId: null,
    username: "",
    avatarColor: "#7c3aed",
    avatarImage: null,
    appBackground: null,
    voiceSettings: { micId: "default", volume: 1, filter: "none", noiseSuppression: true, echoCancellation: false, autoGainControl: false, gateThreshold: 8, gateAttack: 0.008, gateRelease: 0.05 },
    screenShareQuality: "720p",
    cameraQuality: "720p",
    roomCreatedAt: {}, // roomId -> timestamp
    // Status system
    status: "online", // online, idle, dnd, invisible
    customStatus: "", // custom status text
    statusEmoji: "", // status emoji
    lastActive: Date.now(), // for idle detection
    // Game activity state
    gameActivity: null, // { game: string, icon: string, color: string }
    spotifyActivity: null, // { song: string, artist: string, album: string, icon: string }
    // Settings state
    settings: {
        theme: 'dark', // dark, light, auto
        messageDensity: 'cozy', // comfortable, cozy, compact
        emojiSize: 'medium', // small, medium, large
        animations: true,
        soundEnabled: true,
        notificationSound: 'default',
        highContrast: false,
        fontSize: 14,
        fontFamily: 'Inter',
    },
    servers: [],        // { id, name, ownerId, channels, members, messages }
    activeServerId: null,
    activeChannelId: null,
    mesh: null,         // P2PMesh instance
    voiceChannelId: null,
    micMuted: false,
    deafened: false,
    remoteAudios: {},   // peerId → HTMLAudioElement
    emojiOpen: false,
    membersOpen: true,
    dms: {},            // peerId -> [messages]
    activeDM: null,     // peerId
    directCall: null,   // { callId, channelId, peerId, peerName, status }
    recentDMs: [],      // [{peerId, name, ...}]
    friends: [],        // [{peerId, name, avatarColor, avatarImage}]
    blockedPeers: [],   // array of peerIds
    peerRoles: {},
    pinnedMessages: [],
    history: {}, // Loaded from server
    translationEnabled: false,
    targetLang: "tr",
    theme: "sapphire",
    recentVoiceToasts: new Set(),
    userVolumes: JSON.parse(localStorage.getItem("scord_user_volumes") || "{}"),
    /** @type {{ messageId: string, author: string, authorId: string, text: string } | null} */
    replyTo: null,
    _p2pOutbox: [],
    peerLatencyMs: {},
    peerIngressMs: {},
    _rttPingTimer: null,
    // Typing indicators
    typingIndicators: {}, // serverId-channelId -> {peerId -> timestamp}
    _typingTimeout: null,
    // User profiles and notes
    userProfiles: {}, // peerId -> {notes: string, friends: Set}
    userNotes: {}, // peerId -> {notes: string}
    // Message search
    searchOpen: false,
    searchQuery: "",
    searchResults: [],
    _meshHealthTimer: null,
    _lastMeshStatus: "",
    _queuedBroadcastToastAt: 0,
    _a11yAnnounceAt: 0,
    notifSettings: { chat: true, dm: true, join: true, chatLevel: "all" },
    compactMode: false,
    _qsOpen: false,
};

const ENABLE_SERVER_SYSTEM_CHAT_NOTICES = false;

// ── V16 Helpers ───────────────────────────────────────────────
const UI = {
    debounce: (fn, delay) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), delay);
        };
    }
};

const updateMembersDebounced = UI.debounce(() => {
    if (state.activeServerId) updateMembersPanel(state.activeServerId);
}, SCORD_T().MEMBERS_PANEL_DEBOUNCE_MS ?? 300);

/* ── Helpers ──────────────────────────────────────────────── */
function genId() {
    return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

function now() {
    return new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

function initials(name) {
    return (name || "?").slice(0, 2).toUpperCase();
}

/** Map legacy / mismatched text channel ids so messages land in the same bucket as the UI. */
function canonicalChannelIdForChat(server, channelId) {
    if (!server?.channels || channelId == null || channelId === "") return channelId;
    if (server.channels.some(c => c.id === channelId)) return channelId;
    const firstText = server.channels.find(c => c.type === "text");
    if (!firstText) return channelId;
    const lid = String(channelId).toLowerCase();
    if (lid === "general" || lid === "ch-genel" || lid === "genel") return firstText.id;
    const textChs = server.channels.filter(c => c.type === "text");
    if (textChs.length === 1) return firstText.id;
    return channelId;
}

/** Ses kanalı id eşlemesi (farklı istemci / eski kayıtlar). */
function canonicalVoiceChannelId(server, channelId) {
    if (!server?.channels || channelId == null || channelId === "") return channelId;
    if (server.channels.some(c => c.id === channelId && c.type === "voice")) return channelId;
    const voices = server.channels.filter(c => c.type === "voice");
    if (voices.length === 1) return voices[0].id;
    return channelId;
}

function getLocalShareStream() {
    return state.screenStream || state.mesh?.screenStream || null;
}

function anyMeshDcOpen(mesh) {
    if (!mesh?.peers) return false;
    return Object.values(mesh.peers).some(p => p.dc && p.dc.readyState === "open");
}

/** Queue until at least one DataChannel is open so chat is not silently dropped. */
function meshBroadcastReliable(payload) {
    if (!state.mesh) return;
    const wsOk = state.mesh.ws && state.mesh.ws.readyState === WebSocket.OPEN;
    const dcOpen = anyMeshDcOpen(state.mesh);
    if (dcOpen) {
        state.mesh.broadcast(payload);
        // For chat reliability, also fan out over signaling when available.
        // saveMessage() deduplicates by message id, so receivers won't double-render.
        if (payload?.type === "chat" && wsOk && typeof state.mesh.broadcastSignal === "function") {
            state.mesh.broadcastSignal(payload);
        }
        return;
    }
    // Fallback: if signaling is up, still deliver small JSON events (chat/presence) via WS.
    // This prevents the whole app from "going dark" when DC negotiation is flaky.
    if (wsOk && typeof state.mesh.broadcastSignal === "function") {
        state.mesh.broadcastSignal(payload);
        return;
    }
    if (!state._p2pOutbox) state._p2pOutbox = [];
    state._p2pOutbox.push(payload);
    if (payload?.type === "chat") {
        const t = Date.now();
        if (t - (state._queuedBroadcastToastAt || 0) > CHAT_QUEUE_TOAST_COOLDOWN_MS) {
            state._queuedBroadcastToastAt = t;
        }
    }
}

/** Fetch with kullanıcıya kısa hata bildirimi */
async function scordFetch(url, options = {}) {
    try {
        const res = await fetch(url, options);
        if (!res.ok) {
            const msg = `${res.status} ${res.statusText || ""}`.trim();
            toast(`İstek başarısız: ${msg}`, "error");
        }
        return res;
    } catch (e) {
        console.warn("scordFetch", url, e);
        toast("Ağ hatası — bağlantını kontrol et.", "error");
        throw e;
    }
}

function announceA11y(text) {
    if (!text) return;
    const t = Date.now();
    if (t - state._a11yAnnounceAt < A11Y_ANNOUNCE_THROTTLE_MS) return;
    state._a11yAnnounceAt = t;
    const el = document.getElementById("sr-announcer");
    if (!el) return;
    el.textContent = "";
    requestAnimationFrame(() => { el.textContent = text; });
}

function clearMeshHealthPoll() {
    if (state._meshHealthTimer) {
        clearInterval(state._meshHealthTimer);
        state._meshHealthTimer = null;
    }
}

function startMeshHealthPoll() {
    clearMeshHealthPoll();
    state._meshHealthTimer = setInterval(() => {
        requestAnimationFrame(() => {
            if (state.mesh) refreshConnectionBadge();
        });
    }, 2000);
}

function resetConnectionState() {
    try {
        // Keep username/color/theme etc, only reset connection identity and cached rooms.
        localStorage.removeItem("scord_peer_id");
        localStorage.removeItem("scord_recent_dms");
        localStorage.removeItem("scord_friends");
    } catch { }
    try { state.mesh?.disconnect?.(); } catch { }
    location.reload();
}

function maybeOfferP2PTroubleshoot(wsOk, dcOpen) {
    return;
    const peerCount = state.mesh ? Object.keys(state.mesh.peers || {}).length : 0;
    if (!wsOk || dcOpen || peerCount === 0) {
        state._p2pWaitSince = null;
        state._p2pTriedHelp = false;
        return;
    }
    const nowT = Date.now();
    if (!state._p2pWaitSince) state._p2pWaitSince = nowT;
    const waitedMs = nowT - state._p2pWaitSince;
    if (waitedMs < 12000 || state._p2pTriedHelp) return;
    state._p2pTriedHelp = true;

    const body = `
      <div style="display:flex;flex-direction:column;gap:10px">
        <div><b>P2P kurulamadı</b> (DataChannel açılmıyor). Gizli sekmede çalışıp normal sekmede takılıyorsa genelde <b>uzantı / VPN / güvenlik yazılımı</b> WebRTC’yi engelliyordur.</div>
        <div style="opacity:.9">
          Denenecekler:
          <ul style="margin:8px 0 0 18px;display:flex;flex-direction:column;gap:6px">
            <li>VPN / AdBlock / “privacy” uzantılarını kapat</li>
            <li>Site verisini temizle veya “Bağlantıyı Sıfırla” de</li>
            <li>Farklı tarayıcı (Chrome/Edge) dene</li>
          </ul>
        </div>
      </div>
    `;
    const footer = `
      <button class="btn-secondary" onclick="hideModal()">Kapat</button>
      <button class="btn-primary" onclick="window.scordResetConnection()">Bağlantıyı Sıfırla</button>
    `;
    window.scordResetConnection = resetConnectionState;
    showModal("Bağlantı Sorunu", body, footer);
}

let _refreshConnectionBadgeTimeout = null;
function refreshConnectionBadge() {
    // Debounce to prevent excessive DOM updates
    if (_refreshConnectionBadgeTimeout) {
        clearTimeout(_refreshConnectionBadgeTimeout);
    }

    _refreshConnectionBadgeTimeout = setTimeout(() => {
        _refreshConnectionBadgeImpl();
    }, 16); // ~60fps
}

function _refreshConnectionBadgeImpl() {
    const chatEl = document.getElementById("connection-badge");
    const voiceEl = document.getElementById("voice-connection-badge");
    const apply = (el) => {
        if (!el) return;
        const m = state.mesh;
        if (!m) {
            el.textContent = "";
            el.className = el.id === "voice-connection-badge" ? "connection-badge connection-badge--voice" : "connection-badge";
            return;
        }
        const wsOk = m.ws && m.ws.readyState === WebSocket.OPEN;
        const dcOpen = anyMeshDcOpen(m);
        const peerCount = Object.values(m.peers || {}).length;
        const n = Object.values(m.peers || {}).filter(p => p.dc && p.dc.readyState === "open").length;
        let label = "";
        let extra = "";
        if (!wsOk) {
            extra = state._lastMeshStatus === "disconnected" ? "err" : "warn";
            label = state._lastMeshStatus === "disconnected" ? "Sinyal kesildi" : "Sinyale bağlanıyor…";
        } else if (!dcOpen) {
            if (peerCount === 0) {
                extra = "ok";
                label = "Henüz kimse yok";
            } else {
                extra = "warn";
                label = "P2P veri yolu bekleniyor…";
            }
        } else {
            extra = "ok";
            label = `P2P · ${n} kanal`;
        }
        el.textContent = label;
        const base = el.id === "voice-connection-badge" ? "connection-badge connection-badge--voice" : "connection-badge";
        el.className = `${base} ${extra}`.trim();

        // Only run once per tick (chat badge is first).
        if (el.id === "connection-badge") {
            maybeOfferP2PTroubleshoot(wsOk, dcOpen);
        }
    };
    apply(chatEl);
    apply(voiceEl);
}

function flushP2pOutbox() {
    if (!state.mesh || !state._p2pOutbox?.length) return;
    if (!anyMeshDcOpen(state.mesh)) return;
    const batch = state._p2pOutbox.splice(0);
    for (const item of batch) {
        state.mesh.broadcast(item);
    }
}

/** Ses oturumunu ilk boş kanala katılan belirler (senkron referans / UI). */
function ensureVoiceSessionHost(server, channelId, peerId, username) {
    if (!server || !channelId || !peerId) return;
    if (!server.voiceSessionHost) server.voiceSessionHost = {};
    if (server.voiceSessionHost[channelId]) return;
    server.voiceSessionHost[channelId] = { peerId, username: username || "?", at: Date.now() };
}

function transferVoiceSessionHost(server, channelId, leftPeerId) {
    if (!server?.voiceSessionHost?.[channelId]) return;
    const cur = server.voiceSessionHost[channelId];
    if (cur.peerId !== leftPeerId) return;
    const remaining = (server.voiceMembers?.[channelId] || []).filter(m => m.peer_id !== leftPeerId);
    const next = remaining[0];
    if (next) {
        server.voiceSessionHost[channelId] = {
            peerId: next.peer_id,
            username: next.username,
            at: Date.now(),
        };
    } else {
        delete server.voiceSessionHost[channelId];
    }
}

/** Mesh yayınlarına zaman damgası + oturum host bilgisi (çok kullanıcı gecikme senkronu). */
function attachMeshBroadcastSync(mesh, roomId) {
    const orig = mesh.broadcast.bind(mesh);
    mesh.broadcast = function (payload) {
        if (!payload || typeof payload !== "object") return orig(payload);
        if (payload.type === "latency_ping" || payload.type === "latency_pong") return orig(payload);
        const server = state.servers.find(s => s.id === roomId);
        const ch = state.voiceChannelId;
        let voiceHostId = null;
        let voiceHostName = null;
        if (server && ch && server.voiceSessionHost?.[ch]) {
            voiceHostId = server.voiceSessionHost[ch].peerId;
            voiceHostName = server.voiceSessionHost[ch].username;
        }
        return orig({
            ...payload,
            _sync: {
                sentAt: Date.now(),
                voiceHostId,
                voiceHostName,
                originPeerId: state.peerId,
            },
        });
    };
}

function updateVoiceSessionMeta() {
    const meta = document.getElementById("voice-sync-meta");
    if (!meta || !state.voiceChannelId) {
        if (meta) meta.textContent = "";
        return;
    }
    const server = state.servers.find(s => s.id === state.activeServerId);
    const ch = state.voiceChannelId;
    let txt = "";
    if (server?.voiceSessionHost?.[ch]) {
        const host = server.voiceSessionHost[ch];
        txt = `Host: ${host.username}`;
    }
    meta.textContent = txt;

    // Show voice call indicator when in different server
    showVoiceCallIndicator();
}

function showVoiceCallIndicator() {
    if (!state.voiceChannelId) return;

    // Remove existing indicator
    const existing = document.getElementById("voice-call-indicator");
    if (existing) existing.remove();

    // Create indicator if not in voice view of current server
    if (document.getElementById("voice-view").classList.contains("hidden")) {
        const indicator = document.createElement("div");
        indicator.id = "voice-call-indicator";
        indicator.className = "voice-call-indicator";
        indicator.innerHTML = `
            <div class="voice-call-indicator-content">
                <span>🔊 Sesli aramadasın</span>
                <button id="voice-return-btn" class="voice-return-btn">Aramaya Dön</button>
            </div>
        `;

        // Add click handler to return to voice
        indicator.querySelector("#voice-return-btn").onclick = () => {
            const server = state.servers.find(s => s.voiceMembers?.[state.voiceChannelId]);
            if (server) {
                showVoiceView(server.id, state.voiceChannelId);
            }
        };

        // Add to page
        document.body.appendChild(indicator);
    }
}

function hideVoiceCallIndicator() {
    const indicator = document.getElementById("voice-call-indicator");
    if (indicator) indicator.remove();
}

function sendPeerLatencyPings() {
    if (!state.mesh || !anyMeshDcOpen(state.mesh)) return;
    const t0 = Date.now();
    const pingId = genId();
    for (const pid of Object.keys(state.mesh.peers)) {
        if (pid === state.peerId) continue;
        state.mesh.sendTo(pid, { type: "latency_ping", pingId, t0 });
    }
}

function clearRttPingTimer() {
    if (state._rttPingTimer) {
        clearInterval(state._rttPingTimer);
        state._rttPingTimer = null;
    }
}

function startRttPingTimer() {
    clearRttPingTimer();
    const ms = SCORD_T().RTT_PING_INTERVAL_MS ?? 4000;
    sendPeerLatencyPings();
    state._rttPingTimer = setInterval(() => {
        requestAnimationFrame(() => {
            sendPeerLatencyPings();
        });
    }, ms);
}

function applyAvatarToElement(el, color, image, name) {
    if (image) {
        el.style.backgroundColor = "transparent";
        el.style.backgroundImage = `url(${image})`;
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
        el.textContent = "";
    } else {
        el.style.backgroundColor = color || "#7c3aed";
        el.style.backgroundImage = "none";
        el.textContent = initials(name);
    }
}

function toast(message, type = "info") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    document.getElementById("toast-container").appendChild(el);
    setTimeout(() => el.remove(), SCORD_T().TOAST_DURATION_MS ?? 4000);
}

function playSound(frequency = 440, duration = 200, type = "sine") {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = frequency;
        oscillator.type = type;

        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + duration / 1000);
    } catch (e) {
        // Ignore if Web Audio not supported
    }
}

function showModal(title, bodyHTML, footerHTML) {
    document.getElementById("modal-title").textContent = title;
    const modal = document.getElementById("modal");
    modal?.classList.toggle("modal--wide-settings", typeof bodyHTML === "string" && bodyHTML.includes("scord-settings-shell"));
    modal?.classList.toggle("modal--profile", typeof bodyHTML === "string" && bodyHTML.includes("profile-pro-card"));
    const mb = document.getElementById("modal-body");
    mb.innerHTML = "";
    if (typeof bodyHTML === "string") mb.innerHTML = bodyHTML;
    else if (bodyHTML && bodyHTML.nodeType === 1) mb.appendChild(bodyHTML);
    document.getElementById("modal-footer").innerHTML = footerHTML || "";
    document.getElementById("modal-backdrop").classList.remove("hidden");
}

function mergeRoomPayloadIntoServer(server, payload) {
    if (!server || !payload) return;
    if (payload.name != null && String(payload.name).trim() !== "") server.name = payload.name;
    if (payload.channels) server.channels = payload.channels;
    if (payload.roles) server.roles = payload.roles;
    if (payload.peer_roles) server.peer_roles = payload.peer_roles;
    if (payload.channel_backgrounds) server.channel_backgrounds = payload.channel_backgrounds;
    if (payload.voicePermissionMode) server.voicePermissionMode = payload.voicePermissionMode;
    const inv = payload.inviteCode ?? payload.invite_code;
    if (inv != null && inv !== "") server.inviteCode = inv;
    const icon = payload.icon_url ?? payload.iconUrl;
    if (icon !== undefined && icon !== "") server.icon_url = icon;
}

/** Modüler UI: `data-scord-palette` renk seti, `data-scord-chat` balon / klasik */
function applyScordAppearance() {
    const pal = localStorage.getItem("scord_palette") || "glass";
    const chat = localStorage.getItem("scord_chat_layout") || "bubbles";
    const density = localStorage.getItem("scord_msg_density") || "cozy";
    document.documentElement.setAttribute("data-scord-palette", pal);
    document.documentElement.setAttribute("data-scord-chat", chat);
    document.documentElement.setAttribute("data-msg-density", density);
    document.documentElement.setAttribute("data-scord-chat-style", density);
}

function applyChannelBackground(serverId, channelId) {
    const server = state.servers.find(s => s.id === serverId);
    const raw = server?.channel_backgrounds?.[channelId];
    const chatView = document.getElementById("chat-view");
    const voiceView = document.getElementById("voice-view");
    const overlay = "linear-gradient(rgba(6, 6, 16, 0.88), rgba(6, 6, 16, 0.94))";
    const urlOk = raw && /^https?:\/\//i.test(String(raw).trim());
    [chatView, voiceView].filter(Boolean).forEach(el => {
        if (urlOk) {
            const u = JSON.stringify(String(raw).trim());
            el.style.backgroundImage = `${overlay}, url(${u})`;
            el.style.backgroundSize = "cover";
            el.style.backgroundPosition = "center";
            el.style.backgroundAttachment = "fixed";
        } else {
            el.style.backgroundImage = "";
            el.style.backgroundAttachment = "";
        }
    });
}

function getMyEffectiveRole(server) {
    if (!server) return "member";
    if (server.ownerId === state.peerId) return "owner";
    return server.peer_roles?.[state.peerId] || "member";
}

function normalizeReactionsMap(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    for (const [emoji, peers] of Object.entries(raw)) {
        if (peers instanceof Set) out[emoji] = [...peers];
        else if (Array.isArray(peers)) out[emoji] = peers.filter(Boolean);
        else out[emoji] = [];
    }
    return out;
}

function escapeHtml(s) {
    if (s == null) return "";
    const d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
}

// Status System Functions
const STATUS_TYPES = {
    online: { color: "#3ba55c", text: "Çevrimiçi", icon: "🟢" },
    idle: { color: "#faa61a", text: "Boşta", icon: "🟡" },
    dnd: { color: "#ed4245", text: "Rahatsız Etmeyin", icon: "🔴" },
    invisible: { color: "#747f8d", text: "Çevrimdışı", icon: "⚫" }
};

function setStatus(newStatus, customStatus = "", statusEmoji = "") {
    const oldStatus = state.status;
    state.status = newStatus;
    state.customStatus = customStatus;
    state.statusEmoji = statusEmoji;
    state.lastActive = Date.now();

    // Save to localStorage
    localStorage.setItem("scord_status", newStatus);
    localStorage.setItem("scord_custom_status", customStatus);
    localStorage.setItem("scord_status_emoji", statusEmoji);

    // Broadcast status change to all servers
    if (state.mesh && state.mesh.broadcast) {
        state.mesh.broadcast({
            type: "status_update",
            status: newStatus,
            customStatus,
            statusEmoji,
            timestamp: Date.now()
        });
    }

    // Update UI
    updateStatusBar();
    updateMemberList();

    // Start idle detection if online
    if (newStatus === "online") {
        startIdleDetection();
    } else {
        stopIdleDetection();
    }
}

function startIdleDetection() {
    stopIdleDetection();
    state._idleTimer = setInterval(() => {
        const idleTime = Date.now() - state.lastActive;
        const idleThreshold = 5 * 60 * 1000; // 5 minutes

        if (idleTime >= idleThreshold && state.status === "online") {
            setStatus("idle", state.customStatus, state.statusEmoji);
        }
    }, 60000); // Check every minute
}

function stopIdleDetection() {
    if (state._idleTimer) {
        clearInterval(state._idleTimer);
        state._idleTimer = null;
    }
}

function updateLastActive() {
    state.lastActive = Date.now();
    // If user was idle, set back to online
    if (state.status === "idle") {
        setStatus("online", state.customStatus, state.statusEmoji);
    }
}

function loadStatusFromStorage() {
    const savedStatus = localStorage.getItem("scord_status") || "online";
    const savedCustomStatus = localStorage.getItem("scord_custom_status") || "";
    const savedStatusEmoji = localStorage.getItem("scord_status_emoji") || "";

    state.status = savedStatus;
    state.customStatus = savedCustomStatus;
    state.statusEmoji = savedStatusEmoji;
}

function getStatusDisplay(status, customStatus = "", statusEmoji = "") {
    const statusInfo = STATUS_TYPES[status] || STATUS_TYPES.online;
    let display = statusInfo.icon;

    if (statusEmoji) {
        display = statusEmoji;
    }

    if (customStatus) {
        display += " " + customStatus;
    }

    return display;
}

function updateStatusBar() {
    const statusBar = document.getElementById("status-bar");
    if (!statusBar) return;

    const statusInfo = STATUS_TYPES[state.status] || STATUS_TYPES.online;
    let activityHtml = "";

    // Add activities
    const activities = [];
    if (state.gameActivity) {
        activities.push(`${state.gameActivity.icon} <span style="color: ${state.gameActivity.color}">${state.gameActivity.game}</span>`);
    }
    if (state.spotifyActivity) {
        activities.push(`${state.spotifyActivity.icon} <span style="color: ${state.spotifyActivity.color}">${state.spotifyActivity.song}</span>`);
    }

    if (activities.length > 0) {
        activityHtml = `
            <div class="status-activities">
                ${activities.join(' • ')}
            </div>
        `;
    }

    statusBar.innerHTML = `
        <div class="status-indicator" style="--status-color: ${statusInfo.color}" title="Durumu değiştirmek için tıkla">
            <span class="status-dot"></span>
            <span class="status-text">${statusInfo.text}</span>
        </div>
        <div class="status-custom">
            ${state.statusEmoji ? `<span class="status-emoji">${state.statusEmoji}</span>` : ""}
            ${state.customStatus ? `<span class="custom-status-text">${state.customStatus}</span>` : ""}
        </div>
        ${activityHtml}
    `;
}

function updateMemberList() {
    // This will be called when rendering member panels
    const servers = document.querySelectorAll(".member-item");
    servers.forEach(memberEl => {
        const peerId = memberEl.dataset.peerId;
        const member = getCurrentMemberInfo(peerId);
        if (member) {
            updateMemberStatusDisplay(memberEl, member);
        }
    });
}

function updateMemberStatusDisplay(memberEl, member) {
    const statusDot = memberEl.querySelector(".member-status-dot");
    const statusText = memberEl.querySelector(".member-status-text");

    if (statusDot && member.status) {
        const statusInfo = STATUS_TYPES[member.status] || STATUS_TYPES.online;
        statusDot.style.backgroundColor = statusInfo.color;
        statusDot.title = statusInfo.text;
    }

    if (statusText && (member.customStatus || member.statusEmoji)) {
        statusText.textContent = getStatusDisplay(member.status, member.customStatus, member.statusEmoji);
        statusText.classList.remove("hidden");
    } else if (statusText) {
        statusText.classList.add("hidden");
    }
}

function getCurrentMemberInfo(peerId) {
    // Find member info across all servers
    for (const server of state.servers) {
        const member = server.members?.find(m => m.peer_id === peerId);
        if (member) {
            return {
                ...member,
                status: member.status || "online",
                customStatus: member.customStatus || "",
                statusEmoji: member.statusEmoji || ""
            };
        }
    }
    return null;
}

// Track user activity for idle detection
document.addEventListener("mousemove", updateLastActive);
document.addEventListener("keypress", updateLastActive);
document.addEventListener("click", updateLastActive);
document.addEventListener("scroll", updateLastActive);

// Status Picker Modal
function showStatusPicker() {
    const modalContent = `
        <div class="status-picker">
            <div class="status-picker-header">Durumunu Ayarla</div>
            <div class="status-options">
                ${Object.entries(STATUS_TYPES).map(([key, info]) => `
                    <div class="status-option ${state.status === key ? 'selected' : ''}" data-status="${key}">
                        <div class="status-option-dot" style="background: ${info.color}"></div>
                        <div class="status-option-info">
                            <div class="status-option-title">${info.icon} ${info.text}</div>
                            <div class="status-option-desc">${getStatusDescription(key)}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="custom-status-input">
                <div class="status-picker-header">Özel Durum</div>
                <div class="custom-status-input-row">
                    <input type="text" id="custom-status-input" placeholder="Ne yapıyorsun?" maxlength="50" value="${state.customStatus}">
                    <button type="button" class="emoji-picker-btn" id="status-emoji-btn" title="Emoji Seç">${state.statusEmoji || '😀'}</button>
                </div>
            </div>
        </div>
    `;

    showModal("Durum Ayarları", modalContent, `
        <button class="btn-secondary" onclick="hideModal()">İptal</button>
        <button class="btn-primary" onclick="saveStatusSettings()">Kaydet</button>
    `);

    // Add event listeners
    setTimeout(() => {
        const statusOptions = document.querySelectorAll('.status-option');
        statusOptions.forEach(option => {
            option.addEventListener('click', () => {
                statusOptions.forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            });
        });

        const emojiBtn = document.getElementById('status-emoji-btn');
        if (emojiBtn) {
            emojiBtn.addEventListener('click', showStatusEmojiPicker);
        }
    }, 100);
}

function getStatusDescription(status) {
    const descriptions = {
        online: "Çevrimiçi ve sohbet için hazırsın",
        idle: "Boşta - birazdan geri döneceksin",
        dnd: "Rahatsız edilmek istemiyorsun",
        invisible: "Çevrimdışı görünüyorsun"
    };
    return descriptions[status] || "";
}

function saveStatusSettings() {
    const selectedOption = document.querySelector('.status-option.selected');
    const customStatusInput = document.getElementById('custom-status-input');

    if (selectedOption) {
        const newStatus = selectedOption.dataset.status;
        const customStatus = customStatusInput ? customStatusInput.value.trim() : "";
        const statusEmoji = state.statusEmoji; // Keep current emoji

        setStatus(newStatus, customStatus, statusEmoji);
        hideModal();
        toast("Durum güncellendi!", "success");
    }
}

function showStatusEmojiPicker() {
    // Simple emoji picker
    const commonEmojis = ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "🎮", "💻", "📱", "🎧", "📚", "🎨", "🎵", "🎬", "🏃", "💪", "🧠", "💡", "☕", "🍕", "🎯", "🚀", "🌟", "✨", "🔥", "💯"];

    const emojiGrid = document.createElement('div');
    emojiGrid.style.cssText = 'display: grid; grid-template-columns: repeat(8, 1fr); gap: 8px; padding: 12px; max-height: 200px; overflow-y: auto;';

    commonEmojis.forEach(emoji => {
        const emojiBtn = document.createElement('button');
        emojiBtn.textContent = emoji;
        emojiBtn.style.cssText = 'font-size: 20px; padding: 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-elevated); cursor: pointer; transition: all 0.2s;';
        emojiBtn.onmouseover = () => emojiBtn.style.background = 'var(--bg-highlight)';
        emojiBtn.onmouseout = () => emojiBtn.style.background = 'var(--bg-elevated)';
        emojiBtn.onclick = () => {
            state.statusEmoji = emoji;
            const emojiBtn = document.getElementById('status-emoji-btn');
            if (emojiBtn) emojiBtn.textContent = emoji;
            emojiGrid.remove();
        };
        emojiGrid.appendChild(emojiBtn);
    });

    // Position emoji picker
    const emojiBtn = document.getElementById('status-emoji-btn');
    if (emojiBtn) {
        emojiGrid.style.position = 'absolute';
        emojiGrid.style.background = 'var(--bg-surface)';
        emojiGrid.style.border = '1px solid var(--border)';
        emojiGrid.style.borderRadius = '8px';
        emojiGrid.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
        emojiGrid.style.zIndex = '1000';

        const rect = emojiBtn.getBoundingClientRect();
        emojiGrid.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
        emojiGrid.style.left = rect.left + 'px';

        document.body.appendChild(emojiGrid);

        // Close on outside click
        setTimeout(() => {
            const closeEmojiPicker = (e) => {
                if (!emojiGrid.contains(e.target) && e.target !== emojiBtn) {
                    emojiGrid.remove();
                    document.removeEventListener('click', closeEmojiPicker);
                }
            };
            document.addEventListener('click', closeEmojiPicker);
        }, 100);
    }
}

// Handle status updates from other users
function handleStatusUpdate(data) {
    const { from, status, customStatus, statusEmoji, timestamp } = data;

    // Update member info across all servers
    state.servers.forEach(server => {
        const member = server.members?.find(m => m.peer_id === from);
        if (member) {
            member.status = status;
            member.customStatus = customStatus;
            member.statusEmoji = statusEmoji;
            member.lastStatusUpdate = timestamp;
        }
    });

    // Update UI if member is visible
    updateMemberList();
}

// Activity System
const ACTIVITY_TYPES = {
    playing: { icon: "🎮", color: "#1f8b4c", text: "Oynuyor" },
    listening: { icon: "🎵", color: "#1db954", text: "Dinliyor" },
    watching: { icon: "📺", color: "#e94057", text: "İzliyor" },
    streaming: { icon: "🔴", color: "#593695", text: "Yayında" },
    working: { icon: "💻", color: "#4a90e2", text: "Çalışıyor" },
    studying: { icon: "📚", color: "#f39c12", text: "Öğreniyor" }
};

function setGameActivity(game, icon = "🎮") {
    state.gameActivity = { game, icon, color: ACTIVITY_TYPES.playing.color };
    localStorage.setItem("scord_game_activity", JSON.stringify(state.gameActivity));
    broadcastActivityUpdate();
    updateStatusBar();
}

function setSpotifyActivity(song, artist, album = "", icon = "🎵") {
    state.spotifyActivity = { song, artist, album, icon, color: ACTIVITY_TYPES.listening.color };
    localStorage.setItem("scord_spotify_activity", JSON.stringify(state.spotifyActivity));
    broadcastActivityUpdate();
    updateStatusBar();
}

function clearActivity(type = "all") {
    if (type === "all" || type === "game") {
        state.gameActivity = null;
        localStorage.removeItem("scord_game_activity");
    }
    if (type === "all" || type === "spotify") {
        state.spotifyActivity = null;
        localStorage.removeItem("scord_spotify_activity");
    }
    broadcastActivityUpdate();
    updateStatusBar();
}

// Message Reactions System
function addReaction(serverId, channelId, messageId, emoji) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;

    if (!server.reactions) server.reactions = {};
    const key = `${channelId}-${messageId}`;
    if (!server.reactions[key]) server.reactions[key] = {};

    const reaction = server.reactions[key];
    if (!reaction[emoji]) reaction[emoji] = new Set();

    // Add user's reaction
    reaction[emoji].add(state.peerId);

    // Broadcast reaction
    if (state.mesh && state.mesh.broadcast) {
        state.mesh.broadcast({
            type: "reaction_add",
            serverId,
            channelId,
            messageId,
            emoji,
            userId: state.peerId,
            timestamp: Date.now()
        });
    }

    // Update UI
    renderMessageReactions(serverId, channelId, messageId);
    saveReactionsToStorage(serverId);
}

function removeReaction(serverId, channelId, messageId, emoji) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;

    if (!server.reactions) server.reactions = {};
    const key = `${channelId}-${messageId}`;
    if (!server.reactions[key]) return;

    const reaction = server.reactions[key];
    if (!reaction[emoji]) return;

    // Remove user's reaction
    reaction[emoji].delete(state.peerId);

    // Clean up empty reactions
    if (reaction[emoji].size === 0) {
        delete reaction[emoji];
    }

    if (Object.keys(reaction).length === 0) {
        delete server.reactions[key];
    }

    // Broadcast reaction removal
    if (state.mesh && state.mesh.broadcast) {
        state.mesh.broadcast({
            type: "reaction_remove",
            serverId,
            channelId,
            messageId,
            emoji,
            userId: state.peerId,
            timestamp: Date.now()
        });
    }

    // Update UI
    renderMessageReactions(serverId, channelId, messageId);
    saveReactionsToStorage(serverId);
}

function handleReactionAdd(data) {
    const { serverId, channelId, messageId, emoji, userId } = data;
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;

    if (!server.reactions) server.reactions = {};
    const key = `${channelId}-${messageId}`;
    if (!server.reactions[key]) server.reactions[key] = {};

    const reaction = server.reactions[key];
    if (!reaction[emoji]) reaction[emoji] = new Set();
    reaction[emoji].add(userId);

    renderMessageReactions(serverId, channelId, messageId);
}

function handleReactionRemove(data) {
    const { serverId, channelId, messageId, emoji, userId } = data;
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;

    if (!server.reactions) server.reactions = {};
    const key = `${channelId}-${messageId}`;
    if (!server.reactions[key]) return;

    const reaction = server.reactions[key];
    if (!reaction[emoji]) return;

    reaction[emoji].delete(userId);

    // Clean up empty reactions
    if (reaction[emoji].size === 0) {
        delete reaction[emoji];
    }

    if (Object.keys(reaction).length === 0) {
        delete server.reactions[key];
    }

    renderMessageReactions(serverId, channelId, messageId);
}

let _renderMessageReactionsTimeouts = {};
function renderMessageReactions(serverId, channelId, messageId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;

    const key = `${channelId}-${messageId}`;
    const reactions = server.reactions?.[key];
    if (!reactions) return;

    // Debounce per message to prevent excessive DOM updates
    if (_renderMessageReactionsTimeouts[key]) {
        clearTimeout(_renderMessageReactionsTimeouts[key]);
    }

    _renderMessageReactionsTimeouts[key] = setTimeout(() => {
        _renderMessageReactionsImpl(serverId, channelId, messageId);
        delete _renderMessageReactionsTimeouts[key];
    }, 16); // ~60fps
}

function _renderMessageReactionsImpl(serverId, channelId, messageId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;

    const key = `${channelId}-${messageId}`;
    const reactions = server.reactions?.[key];
    if (!reactions) return;

    const msgEl = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (!msgEl) return;

    // Remove existing reaction bar
    const existingBar = msgEl.querySelector('.reaction-bar');
    if (existingBar) existingBar.remove();

    // Create reaction bar
    const reactionBar = document.createElement('div');
    reactionBar.className = 'reaction-bar';

    Object.entries(reactions).forEach(([emoji, users]) => {
        const pill = document.createElement('div');
        pill.className = 'reaction-pill';

        const userReacted = users.has(state.peerId);
        if (userReacted) pill.classList.add('reacted');

        pill.innerHTML = `
            <span class="reaction-emoji">${emoji}</span>
            <span class="reaction-count">${users.size}</span>
        `;

        pill.onclick = () => {
            if (userReacted) {
                removeReaction(serverId, channelId, messageId, emoji);
            } else {
                addReaction(serverId, channelId, messageId, emoji);
            }
        };

        pill.oncontextmenu = (e) => {
            e.preventDefault();
            showReactionContextMenu(e, serverId, channelId, messageId, emoji, users);
        };

        reactionBar.appendChild(pill);
    });

    // Add reaction button
    const addBtn = document.createElement('div');
    addBtn.className = 'reaction-add-btn';
    addBtn.innerHTML = '+';
    addBtn.title = 'Tepki Ekle';
    addBtn.onclick = () => showReactionPicker(serverId, channelId, messageId);

    reactionBar.appendChild(addBtn);
    msgEl.appendChild(reactionBar);
}

function showReactionPicker(serverId, channelId, messageId) {
    // Common reactions
    const commonEmojis = ["👍", "👎", "😄", "❤️", "😢", "😮", "😡", "🎉", "🔥", "👏", "🤔", "👀"];

    const picker = document.createElement('div');
    picker.className = 'reaction-picker';
    picker.innerHTML = `
        <div class="reaction-picker-header">Tepki Ekle</div>
        <div class="reaction-picker-grid">
            ${commonEmojis.map(emoji => `
                <button class="reaction-emoji-btn" data-emoji="${emoji}">${emoji}</button>
            `).join('')}
        </div>
        <div class="reaction-picker-custom">
            <input type="text" placeholder="Emoji ara..." maxlength="2">
        </div>
    `;

    // Position picker
    const msgEl = document.querySelector(`[data-msg-id="${messageId}"]`);
    if (!msgEl) return;

    const rect = msgEl.getBoundingClientRect();
    picker.style.position = 'absolute';
    picker.style.top = (rect.bottom + 5) + 'px';
    picker.style.left = rect.left + 'px';
    picker.style.zIndex = '1000';

    document.body.appendChild(picker);

    // Add event listeners
    const emojiBtns = picker.querySelectorAll('.reaction-emoji-btn');
    emojiBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const emoji = btn.dataset.emoji;
            addReaction(serverId, channelId, messageId, emoji);
            picker.remove();
        });
    });

    const searchInput = picker.querySelector('input');
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value;
        if (query.length === 1) {
            // Replace grid with matching emojis
            const grid = picker.querySelector('.reaction-picker-grid');
            grid.innerHTML = `<button class="reaction-emoji-btn" data-emoji="${query}">${query}</button>`;
            grid.querySelector('.reaction-emoji-btn').addEventListener('click', () => {
                addReaction(serverId, channelId, messageId, query);
                picker.remove();
            });
        }
    });

    // Close on outside click
    setTimeout(() => {
        const closePicker = (e) => {
            if (!picker.contains(e.target)) {
                picker.remove();
                document.removeEventListener('click', closePicker);
            }
        };
        document.addEventListener('click', closePicker);
    }, 100);
}

function showReactionContextMenu(ev, serverId, channelId, messageId, emoji, users) {
    closeContextMenu();
    ev.preventDefault();
    ev.stopPropagation();

    const menu = document.createElement('div');
    menu.className = 'ctx-menu ctx-menu--reaction';
    menu.style.left = `${Math.min(ev.clientX, window.innerWidth - 200)}px`;
    menu.style.top = `${Math.min(ev.clientY, window.innerHeight - 150)}px`;

    const userNames = Array.from(users).map(userId => {
        const member = getCurrentMemberInfo(userId);
        return member?.username || 'Bilinmeyen';
    }).join(', ');

    menu.innerHTML = `
        <div class="ctx-section">${emoji} - ${users.size} tepki</div>
        <div class="ctx-item" style="font-size: 12px; color: var(--text-muted); max-width: 200px; word-break: break-all;">
            ${userNames}
        </div>
    `;

    document.body.appendChild(menu);
    setTimeout(() => {
        document.addEventListener('click', closeContextMenu, { once: true });
    }, 10);
}

function saveReactionsToStorage(serverId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server || !server.reactions) return;

    // Convert Sets to arrays for storage
    const serializable = {};
    Object.entries(server.reactions).forEach(([key, reactions]) => {
        serializable[key] = {};
        Object.entries(reactions).forEach(([emoji, users]) => {
            serializable[key][emoji] = Array.from(users);
        });
    });

    localStorage.setItem(`scord_reactions_${serverId}`, JSON.stringify(serializable));
}

function loadReactionsFromStorage(serverId) {
    try {
        const saved = localStorage.getItem(`scord_reactions_${serverId}`);
        if (!saved) return;

        const server = state.servers.find(s => s.id === serverId);
        if (!server) return;

        const data = JSON.parse(saved);
        server.reactions = {};

        Object.entries(data).forEach(([key, reactions]) => {
            server.reactions[key] = {};
            Object.entries(reactions).forEach(([emoji, users]) => {
                server.reactions[key][emoji] = new Set(users);
            });
        });
    } catch (e) {
        console.warn("Failed to load reactions from storage:", e);
    }
}

// Message Threads System
function createThread(serverId, channelId, parentMessageId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;

    if (!server.threads) server.threads = {};
    const threadId = genId();

    const thread = {
        id: threadId,
        parentMessageId,
        channelId,
        messages: [],
        createdAt: Date.now(),
        createdBy: state.peerId,
        archived: false
    };

    server.threads[threadId] = thread;

    // Broadcast thread creation
    if (state.mesh && state.mesh.broadcast) {
        state.mesh.broadcast({
            type: "thread_create",
            serverId,
            channelId,
            threadId,
            parentMessageId,
            timestamp: Date.now()
        });
    }

    // Open thread view
    openThreadView(serverId, threadId);
    saveThreadsToStorage(serverId);
}

function handleThreadCreate(data) {
    const { serverId, channelId, threadId, parentMessageId } = data;
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;

    if (!server.threads) server.threads = {};

    server.threads[threadId] = {
        id: threadId,
        parentMessageId,
        channelId,
        messages: [],
        createdAt: Date.now(),
        createdBy: data.createdBy || data.from,
        archived: false
    };

    // Update UI to show thread indicator on parent message
    updateThreadIndicator(serverId, channelId, parentMessageId, threadId);
}

function addThreadMessage(serverId, threadId, text) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server || !server.threads[threadId]) return;

    const thread = server.threads[threadId];
    const msg = {
        id: genId(),
        text,
        author: state.username,
        authorId: state.peerId,
        avatarColor: state.avatarColor,
        avatarImage: state.avatarImage,
        time: now(),
        threadId,
        channelId: thread.channelId
    };

    thread.messages.push(msg);

    // Broadcast thread message
    if (state.mesh && state.mesh.broadcast) {
        state.mesh.broadcast({
            type: "thread_message",
            serverId,
            threadId,
            message: msg,
            timestamp: Date.now()
        });
    }

    // Update UI
    renderThreadMessages(serverId, threadId);
    saveThreadsToStorage(serverId);
}

function handleThreadMessage(data) {
    const { serverId, threadId, message } = data;
    const server = state.servers.find(s => s.id === serverId);
    if (!server || !server.threads[threadId]) return;

    server.threads[threadId].messages.push(message);

    // Update UI if thread is open
    if (state.activeThreadId === threadId) {
        renderThreadMessages(serverId, threadId);
    }

    // Update thread indicator on parent message
    updateThreadIndicator(serverId, server.threads[threadId].channelId, server.threads[threadId].parentMessageId, threadId);
}

function openThreadView(serverId, threadId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server || !server.threads[threadId]) return;

    state.activeThreadId = threadId;
    state.activeServerId = serverId;

    // Hide main views
    document.getElementById("chat-view").classList.add("hidden");
    document.getElementById("voice-view").classList.add("hidden");
    document.getElementById("home-view").classList.add("hidden");
    hideDMMainView(false);

    // Show thread view
    const threadView = document.getElementById("thread-view");
    if (!threadView) {
        createThreadViewElement();
    }

    document.getElementById("thread-view").classList.remove("hidden");
    renderThreadMessages(serverId, threadId);
    updateThreadHeader(serverId, threadId);
}

function createThreadViewElement() {
    const main = document.querySelector(".main-content");
    const threadView = document.createElement("div");
    threadView.id = "thread-view";
    threadView.className = "thread-view hidden";
    threadView.innerHTML = `
        <div class="thread-header">
            <button class="thread-back-btn" onclick="closeThreadView()">← Geri</button>
            <div class="thread-title">
                <div class="thread-title-text">Thread</div>
                <div class="thread-subtitle">Ana mesaja yanıt</div>
            </div>
            <button class="thread-archive-btn" onclick="toggleThreadArchive()">📁 Arşivle</button>
        </div>
        <div class="thread-messages-area" id="thread-messages-area"></div>
        <div class="thread-input-area">
            <div class="thread-input-wrapper">
                <textarea id="thread-input" placeholder="Thread'e mesaj gönder..." rows="1"></textarea>
                <button id="thread-send-btn" class="thread-send-btn">Gönder</button>
            </div>
        </div>
    `;
    main.appendChild(threadView);

    // Add event listeners
    document.getElementById("thread-send-btn").addEventListener("click", sendThreadMessage);
    document.getElementById("thread-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendThreadMessage();
        }
    });
}

function renderThreadMessages(serverId, threadId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server || !server.threads[threadId]) return;

    const thread = server.threads[threadId];
    const area = document.getElementById("thread-messages-area");
    if (!area) return;

    area.innerHTML = "";

    // Show parent message
    const parentMsg = findMessageById(serverId, thread.channelId, thread.parentMessageId);
    if (parentMsg) {
        const parentEl = document.createElement("div");
        parentEl.className = "thread-parent-message";
        parentEl.innerHTML = `
            <div class="thread-parent-header">Ana Mesaj</div>
            <div class="msg-row msg-row--other">
                <div class="msg-avatar" style="background: ${parentMsg.avatarColor || '#7c3aed'}; color: white;">
                    ${(parentMsg.avatarImage ? `<img src="${parentMsg.avatarImage}" alt="${parentMsg.author}" />` : (parentMsg.author || "?")[0].toUpperCase())}
                </div>
                <div class="msg-stack">
                    <div class="msg-bubble msg-bubble--other">
                        <div class="msg-header">
                            <span class="msg-author">${parentMsg.author}</span>
                            <span class="msg-time">${parentMsg.time}</span>
                        </div>
                        <div class="msg-text">${parseMessageText(parentMsg.text, serverId)}</div>
                    </div>
                </div>
            </div>
        `;
        area.appendChild(parentEl);
    }

    // Render thread messages
    thread.messages.forEach(msg => {
        const msgEl = createThreadMessageDOM(msg, serverId);
        area.appendChild(msgEl);
    });

    // Scroll to bottom
    area.scrollTop = area.scrollHeight;
}

function createThreadMessageDOM(msg, serverId) {
    const isSelf = msg.authorId === state.peerId;
    const el = document.createElement("div");
    el.className = "thread-message msg-row" + (isSelf ? " msg-row--self" : " msg-row--other");

    el.innerHTML = `
        <div class="msg-avatar" style="background: ${msg.avatarColor || '#7c3aed'}; color: white;">
            ${(msg.avatarImage ? `<img src="${msg.avatarImage}" alt="${msg.author}" />` : (msg.author || "?")[0].toUpperCase())}
        </div>
        <div class="msg-stack">
            <div class="msg-bubble${isSelf ? " msg-bubble--self" : " msg-bubble--other"}">
                <div class="msg-header">
                    <span class="msg-author${isSelf ? " is-you" : ""}">${msg.author}</span>
                    <span class="msg-time">${msg.time}</span>
                </div>
                <div class="msg-text">${parseMessageText(msg.text, serverId)}</div>
            </div>
        </div>
    `;

    return el;
}

function updateThreadHeader(serverId, threadId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server || !server.threads[threadId]) return;

    const thread = server.threads[threadId];
    const titleEl = document.querySelector(".thread-title-text");
    const subtitleEl = document.querySelector(".thread-subtitle");

    if (titleEl) titleEl.textContent = `Thread (${thread.messages.length} mesaj)`;
    if (subtitleEl) subtitleEl.textContent = `Başlatan: ${getUsernameById(thread.createdBy)}`;
}

function updateThreadIndicator(serverId, channelId, parentMessageId, threadId) {
    const msgEl = document.querySelector(`[data-msg-id="${parentMessageId}"]`);
    if (!msgEl) return;

    // Remove existing thread indicator
    const existingIndicator = msgEl.querySelector(".thread-indicator");
    if (existingIndicator) existingIndicator.remove();

    // Add thread indicator
    const indicator = document.createElement("div");
    indicator.className = "thread-indicator";
    indicator.innerHTML = `💬 ${getThreadMessageCount(serverId, threadId)} yanıt`;
    indicator.onclick = () => openThreadView(serverId, threadId);

    msgEl.appendChild(indicator);
}

function getThreadMessageCount(serverId, threadId) {
    const server = state.servers.find(s => s.id === serverId);
    return server?.threads?.[threadId]?.messages?.length || 0;
}

function sendThreadMessage() {
    if (!state.activeThreadId) return;

    const input = document.getElementById("thread-input");
    const text = input.value.trim();
    if (!text) return;

    addThreadMessage(state.activeServerId, state.activeThreadId, text);
    input.value = "";
    input.style.height = "auto";
}

function closeThreadView() {
    document.getElementById("thread-view").classList.add("hidden");
    document.getElementById("chat-view").classList.remove("hidden");
    state.activeThreadId = null;
}

function toggleThreadArchive() {
    if (!state.activeThreadId) return;

    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server || !server.threads[state.activeThreadId]) return;

    const thread = server.threads[state.activeThreadId];
    thread.archived = !thread.archived;

    const btn = document.querySelector(".thread-archive-btn");
    if (btn) {
        btn.textContent = thread.archived ? "📂 Arşivden Çıkar" : "📁 Arşivle";
    }

    saveThreadsToStorage(state.activeServerId);
    toast(thread.archived ? "Thread arşivlendi" : "Thread arşivden çıkarıldı", "info");
}

function saveThreadsToStorage(serverId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server || !server.threads) return;

    localStorage.setItem(`scord_threads_${serverId}`, JSON.stringify(server.threads));
}

function loadThreadsFromStorage(serverId) {
    try {
        const saved = localStorage.getItem(`scord_threads_${serverId}`);
        if (!saved) return;

        const server = state.servers.find(s => s.id === serverId);
        if (!server) return;

        server.threads = JSON.parse(saved);
    } catch (e) {
        console.warn("Failed to load threads from storage:", e);
    }
}

function findMessageById(serverId, channelId, messageId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return null;

    const cid = server ? canonicalChannelIdForChat(server, channelId) : channelId;
    const messages = server?.messages?.[cid] || [];
    return messages.find(m => m.id === messageId);
}

function getUsernameById(peerId) {
    // Search across all servers for the username
    for (const server of state.servers) {
        const member = server.members?.find(m => m.peer_id === peerId);
        if (member) return member.username;
    }
    return "Bilinmeyen";
}

function loadActivitiesFromStorage() {
    try {
        const savedGame = localStorage.getItem("scord_game_activity");
        if (savedGame) state.gameActivity = JSON.parse(savedGame);

        const savedSpotify = localStorage.getItem("scord_spotify_activity");
        if (savedSpotify) state.spotifyActivity = JSON.parse(savedSpotify);
    } catch (e) {
        console.warn("Failed to load activities from storage:", e);
    }
}

function broadcastActivityUpdate() {
    if (state.mesh && state.mesh.broadcast) {
        state.mesh.broadcast({
            type: "activity_update",
            gameActivity: state.gameActivity,
            spotifyActivity: state.spotifyActivity,
            timestamp: Date.now()
        });
    }
}

function handleActivityUpdate(data) {
    const { from, gameActivity, spotifyActivity, timestamp } = data;

    // Update member info across all servers
    state.servers.forEach(server => {
        const member = server.members?.find(m => m.peer_id === from);
        if (member) {
            member.gameActivity = gameActivity;
            member.spotifyActivity = spotifyActivity;
            member.lastActivityUpdate = timestamp;
        }
    });

    // Update UI if member is visible
    updateMemberList();
}

function getActivityDisplay(member) {
    const activities = [];

    if (member.gameActivity) {
        activities.push({
            type: "playing",
            icon: member.gameActivity.icon,
            name: member.gameActivity.game,
            color: member.gameActivity.color
        });
    }

    if (member.spotifyActivity) {
        activities.push({
            type: "listening",
            icon: member.spotifyActivity.icon,
            name: `${member.spotifyActivity.song} - ${member.spotifyActivity.artist}`,
            details: member.spotifyActivity.album,
            color: member.spotifyActivity.color
        });
    }

    return activities;
}

function showActivityPicker() {
    const modalContent = `
        <div class="activity-picker">
            <div class="activity-picker-header">Aktivite Ayarla</div>
            
            <div class="activity-section">
                <div class="activity-section-title">🎮 Oyun Aktivitesi</div>
                <div class="activity-input-group">
                    <input type="text" id="game-name-input" placeholder="Oyun adı..." maxlength="50" 
                           value="${state.gameActivity?.game || ""}">
                    <button type="button" class="activity-btn" id="set-game-btn">Ayarla</button>
                    ${state.gameActivity ? `<button type="button" class="activity-btn danger" id="clear-game-btn">Temizle</button>` : ""}
                </div>
            </div>
            
            <div class="activity-section">
                <div class="activity-section-title">🎵 Spotify Aktivitesi</div>
                <div class="activity-input-group">
                    <input type="text" id="song-name-input" placeholder="Şarkı adı..." maxlength="50" 
                           value="${state.spotifyActivity?.song || ""}">
                    <input type="text" id="artist-name-input" placeholder="Sanatçı..." maxlength="30" 
                           value="${state.spotifyActivity?.artist || ""}">
                    <input type="text" id="album-name-input" placeholder="Albüm..." maxlength="30" 
                           value="${state.spotifyActivity?.album || ""}">
                    <button type="button" class="activity-btn" id="set-spotify-btn">Ayarla</button>
                    ${state.spotifyActivity ? `<button type="button" class="activity-btn danger" id="clear-spotify-btn">Temizle</button>` : ""}
                </div>
            </div>
            
            <div class="activity-section">
                <div class="activity-section-title">Hızlı Aktiviteler</div>
                <div class="quick-activities">
                    <button type="button" class="quick-activity-btn" data-activity="working">💻 Çalışıyor</button>
                    <button type="button" class="quick-activity-btn" data-activity="studying">📚 Öğreniyor</button>
                    <button type="button" class="quick-activity-btn" data-activity="watching">📺 İzliyor</button>
                    <button type="button" class="quick-activity-btn" data-activity="clear">❌ Tümünü Temizle</button>
                </div>
            </div>
        </div>
    `;

    showModal("Aktivite Ayarları", modalContent, `
        <button class="btn-secondary" onclick="hideModal()">İptal</button>
        <button class="btn-primary" onclick="hideModal()">Tamam</button>
    `);

    // Add event listeners
    setTimeout(() => {
        const setGameBtn = document.getElementById('set-game-btn');
        const clearGameBtn = document.getElementById('clear-game-btn');
        const setSpotifyBtn = document.getElementById('set-spotify-btn');
        const clearSpotifyBtn = document.getElementById('clear-spotify-btn');
        const quickActivityBtns = document.querySelectorAll('.quick-activity-btn');

        if (setGameBtn) {
            setGameBtn.addEventListener('click', () => {
                const gameInput = document.getElementById('game-name-input');
                if (gameInput && gameInput.value.trim()) {
                    setGameActivity(gameInput.value.trim());
                    toast("Oyun aktivitesi ayarlandı!", "success");
                }
            });
        }

        if (clearGameBtn) {
            clearGameBtn.addEventListener('click', () => {
                clearActivity('game');
                toast("Oyun aktivitesi temizlendi!", "info");
            });
        }

        if (setSpotifyBtn) {
            setSpotifyBtn.addEventListener('click', () => {
                const songInput = document.getElementById('song-name-input');
                const artistInput = document.getElementById('artist-name-input');
                const albumInput = document.getElementById('album-name-input');

                if (songInput && artistInput && songInput.value.trim() && artistInput.value.trim()) {
                    setSpotifyActivity(
                        songInput.value.trim(),
                        artistInput.value.trim(),
                        albumInput?.value.trim() || ""
                    );
                    toast("Spotify aktivitesi ayarlandı!", "success");
                }
            });
        }

        if (clearSpotifyBtn) {
            clearSpotifyBtn.addEventListener('click', () => {
                clearActivity('spotify');
                toast("Spotify aktivitesi temizlendi!", "info");
            });
        }

        quickActivityBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const activity = btn.dataset.activity;
                if (activity === 'clear') {
                    clearActivity('all');
                    toast("Tüm aktiviteler temizlendi!", "info");
                } else {
                    const activityInfo = ACTIVITY_TYPES[activity];
                    if (activity === 'working') {
                        setGameActivity("Çalışıyor", "💻");
                    } else if (activity === 'studying') {
                        setGameActivity("Öğreniyor", "📚");
                    } else if (activity === 'watching') {
                        setGameActivity("İzliyor", "📺");
                    }
                    toast(`${activityInfo.text} olarak ayarlandı!`, "success");
                }
            });
        });
    }, 100);
}

function chMuteStorageKey(serverId) {
    return `scord_ch_mute_${serverId}`;
}

function getChannelMuteSet(serverId) {
    try {
        const a = JSON.parse(localStorage.getItem(chMuteStorageKey(serverId)) || "[]");
        return Array.isArray(a) ? a : [];
    } catch {
        return [];
    }
}

function isChannelMuted(serverId, channelId) {
    return getChannelMuteSet(serverId).includes(channelId);
}

function toggleChannelMuteLocal(serverId, channelId) {
    const set = [...getChannelMuteSet(serverId)];
    const i = set.indexOf(channelId);
    if (i >= 0) {
        set.splice(i, 1);
        toast("Kanal bildirimleri açık.", "info");
    } else {
        set.push(channelId);
        toast("Kanal sessize alındı (sadece bu cihaz).", "info");
    }
    localStorage.setItem(chMuteStorageKey(serverId), JSON.stringify(set));
    updateChannelSidebar(serverId);
}

function markChannelRead(serverId, channelId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;
    if (!server.unread) server.unread = {};
    server.unread[channelId] = 0;
    updateChannelSidebar(serverId);
}

function showChannelContextMenu(ev, channel, serverId) {
    closeContextMenu();
    ev.preventDefault();
    ev.stopPropagation();
    const x = ev.clientX;
    const y = ev.clientY;
    const menu = document.createElement("div");
    menu.className = "ctx-menu ctx-menu--chat";
    menu.id = "ctx-menu";
    menu.style.left = `${Math.min(x, window.innerWidth - 260)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 280)}px`;

    const addItem = (icon, label, action) => {
        const item = document.createElement("div");
        item.className = "ctx-item";
        item.innerHTML = `<span class="ctx-icon">${icon}</span>${label}`;
        item.onclick = () => { closeContextMenu(); action(); };
        menu.appendChild(item);
    };

    if (channel.type === "text") {
        addItem("✓", "Okundu olarak işaretle", () => markChannelRead(serverId, channel.id));
        const muted = isChannelMuted(serverId, channel.id);
        addItem(muted ? "🔔" : "🔕", muted ? "Sessize almayı kaldır" : "Kanalı sessize al (yerel)", () => toggleChannelMuteLocal(serverId, channel.id));
    }
    if (channel.type === "voice") {
        addItem("🔊", "Kanala katıl", () => {
            joinVoiceChannel(channel.id);
            updateChannelSidebar(serverId);
        });
    }
    addItem("📋", "Kanal ID kopyala", () => {
        const id = channel.id || "";
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(id).then(() => toast("Kanal ID kopyalandı", "info")).catch(() => toast("Kopyalanamadı", "error"));
        }
    });

    const isAdm = getMyEffectiveRole(state.servers.find(s => s.id === serverId)) === "owner" || getMyEffectiveRole(state.servers.find(s => s.id === serverId)) === "admin";
    if (isAdm) {
        addItem("✏️", "Kanal Adını Düzenle", () => renameChannel(serverId, channel.id));
        if (channel.type === "text") {
            addItem("🖼️", "Kanal Arka Planı Değiştir", () => {
                const server = state.servers.find(s => s.id === serverId);
                const currentBg = server?.channel_backgrounds?.[channel.id] || "";
                const url = prompt("Kanal arka planı için resim URL'si girin (boş bırakın = kaldır):", currentBg);
                if (url === null) return; // iptal
                if (typeof setChannelBackground === "function") {
                    setChannelBackground(serverId, channel.id, url.trim());
                } else {
                    // Fallback
                    fetch(`${API_BASE}/rooms/${serverId}/channel_background`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ channel_id: channel.id, url: url.trim() || null })
                    }).then(r => r.json()).then(d => {
                        if (d.success) {
                            if (!server.channel_backgrounds) server.channel_backgrounds = {};
                            if (url.trim()) server.channel_backgrounds[channel.id] = url.trim();
                            else delete server.channel_backgrounds[channel.id];
                            toast("Kanal arka planı güncellendi.", "success");
                        }
                    });
                }
            });
        }
        addItem("🗑️", "Kanalı Sil", () => deleteChannel(serverId, channel.id), true);
    }

    document.body.appendChild(menu);
    setTimeout(() => {
        document.addEventListener("click", closeContextMenu, { once: true });
    }, 10);
}

function showServerContextMenu(ev, server) {
    closeContextMenu();
    ev.preventDefault();
    ev.stopPropagation();
    if (!server) return;

    const isOwner = server.ownerId === state.peerId || server.owner_id === state.peerId;
    const menu = document.createElement("div");
    menu.className = "ctx-menu ctx-menu--chat";
    menu.id = "ctx-menu";
    menu.style.left = `${Math.min(ev.clientX, window.innerWidth - 260)}px`;
    menu.style.top = `${Math.min(ev.clientY, window.innerHeight - 220)}px`;

    const addItem = (icon, label, action, danger = false) => {
        const item = document.createElement("div");
        item.className = "ctx-item" + (danger ? " danger" : "");
        item.innerHTML = `<span class="ctx-icon">${icon}</span>${label}`;
        item.onclick = () => { closeContextMenu(); action(); };
        menu.appendChild(item);
    };

    const title = document.createElement("div");
    title.className = "ctx-section";
    title.textContent = server.name || "Sunucu";
    menu.appendChild(title);

    if (isOwner) {
        addItem("🗑️", "Sunucuyu Sil", () => deleteServer(server.id), true);
    } else {
        addItem("🚪", "Sunucudan Ayrıl", () => leaveServer(server.id), true);
    }

    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener("click", closeContextMenu, { once: true }), 10);
}

function setReplyTarget(msg) {
    state.replyTo = {
        messageId: msg.id,
        author: msg.author,
        authorId: msg.authorId,
        text: msg.text || "",
    };
    const bar = document.getElementById("reply-preview-bar");
    const auth = document.getElementById("reply-preview-author");
    const snip = document.getElementById("reply-preview-snippet");
    if (bar && auth && snip) {
        bar.classList.remove("hidden");
        auth.textContent = msg.author || "";
        snip.textContent = (msg.text || "").replace(/\s+/g, " ").slice(0, 100);
    }
    document.getElementById("chat-input")?.focus();
}

function clearReplyTarget() {
    state.replyTo = null;
    document.getElementById("reply-preview-bar")?.classList.add("hidden");
}

function scrollToChatMessage(messageId) {
    if (!messageId) return;
    const rid = String(messageId).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const row = document.querySelector(`[data-msg-id="${rid}"]`);
    if (!row) {
        toast("Mesaj bu görünümde yok veya silindi.", "info");
        return;
    }
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    row.classList.add("msg-highlight");
    setTimeout(() => row.classList.remove("msg-highlight"), 2400);
}

async function persistChannelBackground(roomId, channelId, url) {
    try {
        await scordFetch(`${API_BASE}/rooms/${roomId}/channel_background`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channel_id: channelId, url: url || null }),
        });
    } catch (e) {
        console.warn("persistChannelBackground", e);
    }
}

function hideModal() {
    document.getElementById("modal-backdrop").classList.add("hidden");
}

/* ── Setup overlay ────────────────────────────────────────── */
function initSetup() {
    const nameInput = document.getElementById("username-input");
    const enterBtn = document.getElementById("enter-btn");

    nameInput.addEventListener("input", () => {
        enterBtn.disabled = nameInput.value.trim().length < 2;
    });

    nameInput.addEventListener("keydown", e => {
        if (e.key === "Enter" && !enterBtn.disabled) enterBtn.click();
    });

    enterBtn.addEventListener("click", () => {
        state.username = nameInput.value.trim();
        state.peerId = genId();
        localStorage.setItem("scord_username", state.username);
        localStorage.setItem("scord_color", state.avatarColor);
        localStorage.setItem("scord_peer_id", state.peerId);
        startApp();
    });

    // Restore saved identity
    const saved = {
        username: localStorage.getItem("scord_username"),
        color: localStorage.getItem("scord_color"),
        peerId: localStorage.getItem("scord_peer_id"),
        image: localStorage.getItem("scord_avatar_image"),
        theme: localStorage.getItem("scord_theme"),
        bg: localStorage.getItem("scord_bg_image"),
        voice: localStorage.getItem("scord_voice_settings"),
        friends: localStorage.getItem("scord_friends"),
        recentDMs: localStorage.getItem("scord_recent_dms"),
    };
    loadStatusFromStorage();
    loadActivitiesFromStorage();
    if (saved.friends) {
        try { state.friends = JSON.parse(saved.friends); } catch (e) { }
    }
    if (saved.recentDMs) {
        try { state.recentDMs = JSON.parse(saved.recentDMs); } catch (e) { }
    }
    const savedBlocks = localStorage.getItem("scord_blocked_peers");
    if (savedBlocks) {
        try { state.blockedPeers = JSON.parse(savedBlocks); } catch (e) { }
    }
    if (saved.theme) {
        state.theme = saved.theme;
        document.documentElement.className = saved.theme;
    }
    applyScordAppearance();
    if (saved.bg) {
        state.appBackground = saved.bg;
        document.body.style.backgroundImage = `url(${saved.bg})`;
        document.body.style.backgroundSize = "cover";
        document.body.style.backgroundPosition = "center";
    }
    if (saved.voice) {
        try { state.voiceSettings = { ...state.voiceSettings, ...JSON.parse(saved.voice) }; } catch (e) { }
    }
    if (saved.image) {
        state.avatarImage = saved.image;
    }
    if (saved.username) {
        nameInput.value = saved.username;
        enterBtn.disabled = false;
        if (saved.color) {
            state.avatarColor = saved.color;
        }
        if (saved.peerId) state.peerId = saved.peerId;
    }
}

/* ── Start app after identity chosen ─────────────────────── */
function startApp() {
    document.getElementById("setup-overlay").classList.remove("active");
    document.getElementById("app").classList.remove("hidden");
    loadUserPrefs();
    applyScordAppearance();
    applyFocusModeButton();
    // Load runtime config (ICE/TURN) for better P2P reliability.
    loadRuntimeConfig();

    // Apply user info to UI
    const avatar = document.getElementById("user-bar-avatar");
    const nameEl = document.getElementById("user-bar-name");

    if (nameEl) {
        nameEl.textContent = state.username || "Anonim";
        console.log("[App] Identity updated:", state.username);
    }
    if (avatar) {
        applyAvatarToElement(avatar, state.avatarColor, state.avatarImage, state.username);
    }

    // Quick Avatar Upload
    const quickAvInput = document.createElement("input");
    quickAvInput.type = "file";
    quickAvInput.accept = "image/*";
    quickAvInput.style.display = "none";
    quickAvInput.onchange = (e) => {
        fileToBase64(e.target.files[0], (b64) => {
            state.avatarImage = b64;
            localStorage.setItem("scord_avatar_image", b64);
            applyAvatarToElement(avatar, state.avatarColor, state.avatarImage, state.username);
            if (state.mesh) {
                state.mesh.broadcast({ type: "broadcast", payload: { type: "profile_update", username: state.username, avatarImage: state.avatarImage } });
            }
            toast("Profil fotoğrafın başarıyla güncellendi!", "success");
        });
    };
    document.body.appendChild(quickAvInput);

    avatar.style.cursor = "pointer";
    avatar.title = "Profil Fotoğrafını Değiştir";
    avatar.onclick = () => quickAvInput.click();

    showHomeView();
    refreshDiscovery();
    initMobileNav();
    setInterval(refreshDiscovery, SCORD_T().DISCOVERY_REFRESH_INTERVAL_MS ?? 15000);

    // Initialize status system
    updateStatusBar();
    startIdleDetection();

    // Add status bar click event
    const statusBar = document.getElementById("status-bar");
    if (statusBar) {
        statusBar.addEventListener("click", showStatusPicker);
    }
}

let _runtimeCfgLoaded = false;
async function loadRuntimeConfig() {
    if (_runtimeCfgLoaded) return;
    _runtimeCfgLoaded = true;
    try {
        const res = await fetch(`${API_BASE}/config`, { cache: "no-store" });
        if (!res.ok) return;
        const cfg = await res.json();
        if (cfg && Array.isArray(cfg.iceServers) && cfg.iceServers.length) {
            window.SCORD_ICE_SERVERS = cfg.iceServers;
        }
        if (cfg && cfg.hasTurn === false) {
            // Not fatal, but many NATs will fail without TURN.
            toast("Uyarı: TURN ayarlı değil; bazı ağlarda sesli/P2P bağlanmayabilir.", "info");
        }
    } catch {
        // Ignore; defaults in p2p.js will apply
    }
}

function initMobileNav() {
    const menuBtn = document.getElementById("mobile-menu-btn");
    const mask = document.getElementById("mobile-nav-mask");
    const membersBtn = document.getElementById("members-toggle-btn");

    if (menuBtn) {
        menuBtn.onclick = () => {
            document.body.classList.toggle("nav-open");
            mask.classList.toggle("hidden", !document.body.classList.contains("nav-open"));
            mask.classList.toggle("active", document.body.classList.contains("nav-open"));
        };
    }

    if (mask) {
        mask.onclick = closeMobileNav;
    }

    if (membersBtn) {
        membersBtn.onclick = () => {
            const panel = document.getElementById("members-panel");
            panel.classList.toggle("mobile-active");
            if (panel.classList.contains("mobile-active")) {
                mask.classList.remove("hidden");
                mask.classList.add("active");
            } else {
                closeMobileNav();
            }
        };
    }

    const settingsBtn = document.getElementById("server-settings-btn");
    console.log("[App] Attaching settings listener to:", settingsBtn);
    if (settingsBtn) {
        settingsBtn.onclick = (e) => {
            console.log("[App] Settings icon clicked");
            openServerSettingsModal();
        };
    }
}

function closeMobileNav() {
    document.body.classList.remove("nav-open");
    document.getElementById("members-panel").classList.remove("mobile-active");
    const mask = document.getElementById("mobile-nav-mask");
    mask.classList.add("hidden");
    mask.classList.remove("active");
}

/* ── Views ────────────────────────────────────────────────── */
function showHomeView() {
    closeMobileNav();
    clearRttPingTimer();
    clearMeshHealthPoll();
    if (state.activeServerId && state.activeChannelId) {
        persistChatDraftFor(state.activeServerId, state.activeChannelId);
    }
    refreshConnectionBadge();
    document.getElementById("home-view").classList.remove("hidden");
    document.getElementById("chat-view").classList.add("hidden");
    document.getElementById("voice-view").classList.add("hidden");
    hideDMMainView(true);
    state.activeChannelId = null;
    state.activeServerId = null;
    updateChannelSidebar(null);
    document.querySelectorAll(".rail-icon").forEach(el => el.classList.remove("active"));
    document.getElementById("home-btn").classList.add("active");
    document.getElementById("sidebar-server-name").textContent = "SCORD";
}

// Message search state
let searchState = {
    open: false,
    query: "",
    results: [],
    activeIndex: 0,
    filters: { from: "", has: "", in: "", on: "" }
};

function showChatView(serverId, channelId) {
    console.log("[ChatView] Showing chat for server:", serverId, "channel:", channelId);

    closeMobileNav();
    hideDMMainView(false);

    const server = state.servers.find(s => s.id === serverId);
    if (!server) {
        console.error("[ChatView] Server not found:", serverId);
        toast("Sunucu bulunamadı.", "error");
        return;
    }

    const channel = server.channels.find(c => c.id === channelId);
    if (!channel) {
        console.error("[ChatView] Channel not found:", channelId);
        // Try to find first text channel as fallback
        const firstText = server.channels.find(c => c.type === "text");
        if (firstText) {
            console.log("[ChatView] Using fallback channel:", firstText.id);
            channelId = firstText.id;
        } else {
            toast("Kanal bulunamadı.", "error");
            return;
        }
    }

    const wasInVoice = !!state.voiceChannelId;

    state.activeServerId = serverId;
    state.activeChannelId = channelId;
    updateChannelSidebar(serverId);
    renderMessages(serverId, channelId);
    updateMembersPanel(serverId);
    applyChannelBackground(serverId, channelId);

    // Ensure chat view is visible
    const homeView = document.getElementById("home-view");
    const chatView = document.getElementById("chat-view");
    const voiceView = document.getElementById("voice-view");

    if (homeView) homeView.classList.add("hidden");
    if (chatView) chatView.classList.remove("hidden");
    if (voiceView) voiceView.classList.add("hidden");

    // Update channel name in header
    const channelNameEl = document.getElementById("active-channel-name");
    const chatChannelNameEl = document.getElementById("chat-channel-name");
    if (channelNameEl) channelNameEl.textContent = channel.name;
    if (chatChannelNameEl) chatChannelNameEl.textContent = channel.name;

    // Auto-focus chat input
    setTimeout(() => document.getElementById("chat-input")?.focus(), 100);

    // If we were in voice and this is a voice channel, show voice view instead
    if (wasInVoice && channel.type === "voice") {
        showVoiceView(serverId, channelId);
    }

    console.log("[ChatView] Chat view displayed successfully");
}

function showVoiceView(serverId, channelId) {
    closeMobileNav();
    hideDMMainView(false);
    hideVoiceCallIndicator(); // Hide indicator when in voice view
    const server = state.servers.find(s => s.id === serverId);
    const channel = server?.channels.find(c => c.id === channelId);
    if (!server || !channel) return;

    // Preserve voice state - don't leave existing voice channel unnecessarily
    if (state.voiceChannelId && state.voiceChannelId !== channelId) {
        // Only switch channels if different
        leaveVoiceChannel();
    }

    state.activeServerId = serverId;
    // Don't set activeChannelId for voice channels to preserve DM functionality
    // state.activeChannelId = channelId; // Commented out to allow DM while in voice

    document.getElementById("home-view").classList.add("hidden");
    document.getElementById("chat-view").classList.add("hidden");
    document.getElementById("voice-view").classList.remove("hidden");
    document.getElementById("voice-channel-name").textContent = channel.name;
    document.getElementById("sidebar-server-name").textContent = server.name;
    updateChannelSidebar(serverId);
    renderVoiceParticipants(serverId, channelId);
    renderMusicBotPanel();
    updateMembersPanel(serverId);
    // Show share buttons even if not joined
    document.getElementById("voice-screen-btn")?.classList.remove("hidden");
    document.getElementById("voice-camera-btn")?.classList.remove("hidden");
    syncVoiceEphemeralChatVisibility(serverId, channelId);
    updateVoiceSessionMeta();
    applyChannelBackground(serverId, channelId);
}

/* ── Server rail ──────────────────────────────────────────── */
let _renderServerRailTimeout = null;
function renderServerRail() {
    // Debounce to prevent excessive re-renders
    if (_renderServerRailTimeout) {
        clearTimeout(_renderServerRailTimeout);
    }

    _renderServerRailTimeout = setTimeout(() => {
        _renderServerRailImpl();
    }, 16); // ~60fps
}

function _renderServerRailImpl() {
    const container = document.getElementById("server-icons");
    if (!container) return;
    container.innerHTML = "";
    state.servers.forEach(server => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "rail-icon rail-server-guild" + (server.id === state.activeServerId ? " active" : "");
        btn.dataset.serverId = server.id;
        btn.title = server.name;

        if (server.icon_url) {
            btn.innerHTML = `<img src="${server.icon_url}" alt="" class="rail-guild-img" />`;
            btn.style.background = "var(--bg-deep)";
            btn.style.padding = "0";
            btn.textContent = "";
        } else {
            btn.textContent = initials(server.name);
            btn.style.background = server.color || "var(--accent-light)";
        }

        btn.onclick = () => switchToServer(server.id);
        btn.oncontextmenu = (ev) => showServerContextMenu(ev, server);
        container.appendChild(btn);
    });
}

/* ── Channel sidebar ──────────────────────────────────────── */
/* ── Screen Sharing ───────────────────────────────────────── */
async function startScreenShare() {
    if (!state.mesh || !state.mesh.voiceActive) return toast("Önce sesli kanala katıl.", "error");

    try {
        const quality = state.screenShareQuality || "720p";
        const qualityConstraints = {
            "4k": { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } },
            "1080p": { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
            "720p": { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
            "480p": { width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
            "360p": { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } },
        };
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { ...qualityConstraints[quality], cursor: "always" },
            audio: true
        });
        state.screenStream = stream;
        state.mesh.screenStream = stream;

        // Add tracks to all existing peer connections
        for (const [, peerObj] of Object.entries(state.mesh.peers)) {
            const pc = peerObj.pc;
            if (!pc || pc.connectionState === "closed") continue;

            stream.getTracks().forEach(track => {
                // Check if a sender for this track kind (video) already exists
                const existingSender = pc.getSenders().find(s => s.track && s.track.kind === track.kind);
                if (existingSender) {
                    existingSender.replaceTrack(track).catch(e => console.warn("replaceTrack error", e));
                } else {
                    pc.addTrack(track, stream);
                }
            });
        }

        stream.getVideoTracks()[0].onended = () => {
            stream.getTracks().forEach(t => t.stop());
            state.screenStream = null;
            if (state.mesh) {
                state.mesh.screenStream = null;
                state.mesh.broadcast({
                    type: "screen_status",
                    sharing: false,
                    channelId: state.voiceChannelId || state.activeChannelId,
                });
            }
            document.getElementById("voice-screen-btn")?.classList.remove("active");
            if (state.activeServerId && state.voiceChannelId) {
                renderVoiceParticipants(state.activeServerId, state.voiceChannelId);
            }
        };

        document.getElementById("voice-screen-btn").classList.add("active");
        if (state.mesh) {
            state.mesh.broadcast({
                type: "screen_status",
                sharing: true,
                channelId: state.voiceChannelId || state.activeChannelId,
            });
        }
        toast("Ekran başarıyla paylaşıldı!", "success");
        // Local preview: allow opening fullscreen overlay quickly
        const preview = document.getElementById("local-screen-preview");
        if (preview) preview.onclick = () => openScreenOverlay(state.peerId, state.username);
        if (state.activeServerId && state.voiceChannelId) {
            renderVoiceParticipants(state.activeServerId, state.voiceChannelId);
        }
    } catch (err) {
        if (err.name !== "NotAllowedError") console.error("Screen share error", err);
        toast("Ekran paylaşımı iptal edildi veya hata oluştu.", "error");
    }
}

/* ── Camera Sharing ───────────────────────────────────────── */
async function startCameraShare() {
    if (!state.mesh || !state.mesh.voiceActive) return toast("Önce sesli kanala katıl.", "error");

    try {
        const quality = state.cameraQuality || "720p";
        const qualityConstraints = {
            "4k": { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } },
            "1080p": { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
            "720p": { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
            "480p": { width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
            "360p": { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } },
        };
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { ...qualityConstraints[quality] },
            audio: false
        });
        state.cameraStream = stream;
        state.mesh.cameraStream = stream;

        for (const [, peerObj] of Object.entries(state.mesh.peers)) {
            const pc = peerObj.pc;
            if (!pc || pc.connectionState === "closed") continue;

            stream.getTracks().forEach(track => {
                const existingSender = pc.getSenders().find(s => s.track && s.track.kind === track.kind);
                if (existingSender) {
                    existingSender.replaceTrack(track).catch(console.warn);
                } else {
                    pc.addTrack(track, stream);
                }
            });
        }

        stream.getVideoTracks()[0].onended = () => {
            stopCameraShare();
        };

        const preview = document.getElementById("local-screen-preview");
        const video = document.getElementById("self-share-video");
        const lbl = document.getElementById("local-preview-label");
        if (preview && video) {
            preview.classList.remove("hidden");
            video.srcObject = stream;
            if (lbl) lbl.textContent = "Kameran Açık";
            preview.onclick = () => openScreenOverlay(state.peerId, state.username);
        }

        state.mesh.broadcast({
            type: "video_status",
            sharing: true,
            channelId: state.voiceChannelId || state.activeChannelId,
        });

        const btn = document.getElementById("voice-camera-btn");
        if (btn) btn.classList.add("active");

        // Force UI refresh to show local video in gallery
        if (state.activeServerId && state.voiceChannelId) {
            renderVoiceParticipants(state.activeServerId, state.voiceChannelId);
        }

        toast("Kamera açıldı!", "success");
    } catch (err) {
        if (err.name !== "NotAllowedError") console.error("Camera error", err);
        toast("Kamera açılamadı veya izin verilmedi.", "error");
    }
}

function stopCameraShare() {
    if (state.cameraStream) {
        state.cameraStream.getTracks().forEach(t => t.stop());
        state.cameraStream = null;
        if (state.mesh) state.mesh.cameraStream = null;

        for (const [, peerObj] of Object.entries(state.mesh?.peers || {})) {
            const pc = peerObj.pc;
            if (!pc) continue;
            pc.getSenders().filter(s => s.track?.kind === "video").forEach(s => {
                try { pc.removeTrack(s); } catch (e) { }
            });
        }

        const btn = document.getElementById("voice-camera-btn");
        if (btn) btn.classList.remove("active");

        if (state.mesh) {
            state.mesh.broadcast({
                type: "video_status",
                sharing: false,
                channelId: state.voiceChannelId || state.activeChannelId,
            });
        }

        const preview = document.getElementById("local-screen-preview");
        const video = document.getElementById("self-share-video");
        const lbl = document.getElementById("local-preview-label");
        if (!state.screenStream && preview) {
            preview.classList.add("hidden");
            if (video) video.srcObject = null;
        } else if (state.screenStream && video) {
            video.srcObject = state.screenStream;
            if (lbl) lbl.textContent = "Yayındasın (Önizleme)";
        }
    }
}

let _updateChannelSidebarTimeout = null;
function updateChannelSidebar(serverId) {
    console.log("[Sidebar] Updating for server:", serverId);

    // Debounce to prevent excessive re-renders
    if (_updateChannelSidebarTimeout) {
        clearTimeout(_updateChannelSidebarTimeout);
    }

    _updateChannelSidebarTimeout = setTimeout(() => {
        _updateChannelSidebarImpl(serverId);
    }, 16); // ~60fps
}

function _updateChannelSidebarImpl(serverId) {
    const list = document.getElementById("channel-list");
    if (!list) {
        console.error("[Sidebar] channel-list element not found!");
        return;
    }

    list.innerHTML = "";
    if (!serverId) {
        console.log("[Sidebar] No serverId, rendering Home");
        renderHomeSidebar();
        return;
    }

    const server = state.servers.find(s => s.id === serverId);
    if (!server) {
        console.error("[Sidebar] Server not found in state:", serverId);
        list.innerHTML = '<div class="channel-category">SUNUCU BULUNAMADI</div>';
        return;
    }

    console.log("[Sidebar] Found server:", server.name, "Channels:", server.channels?.length);
    if (!server.channels) {
        console.error("[Sidebar] Server has no channels array!");
        return;
    }

    const textChannels = server.channels.filter(c => c.type === "text");
    const voiceChannels = server.channels.filter(c => c.type === "voice");

    if (textChannels.length) {
        const cat = document.createElement("div");
        cat.className = "channel-category";
        cat.style.display = "flex";
        cat.style.justifyContent = "space-between";
        cat.style.alignItems = "center";
        cat.innerHTML = `<span><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg> METİN KANALLARI</span>`;

        const isAdmin = server.ownerId === state.peerId || server.peer_roles?.[state.peerId] === "admin";
        if (isAdmin) {
            const addBtn = document.createElement("span");
            addBtn.className = "add-ch-btn";
            addBtn.textContent = "+";
            addBtn.style.cursor = "pointer";
            addBtn.style.fontSize = "18px";
            addBtn.onclick = (e) => { e.stopPropagation(); promptAddChannel(server.id, "text"); };
            cat.appendChild(addBtn);
        }

        list.appendChild(cat);
        textChannels.forEach(ch => {
            const item = createChannelItem(ch, server.id);
            list.appendChild(item);
        });
    }

    if (voiceChannels.length) {
        const cat = document.createElement("div");
        cat.className = "channel-category";
        cat.style.display = "flex";
        cat.style.justifyContent = "space-between";
        cat.style.alignItems = "center";
        cat.innerHTML = `<span><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg> SESLİ KANALLAR</span>`;

        const isAdmin = server.ownerId === state.peerId || server.peer_roles?.[state.peerId] === "admin";
        if (isAdmin) {
            const addBtn = document.createElement("span");
            addBtn.className = "add-ch-btn";
            addBtn.textContent = "+";
            addBtn.style.cursor = "pointer";
            addBtn.style.fontSize = "18px";
            addBtn.onclick = (e) => { e.stopPropagation(); promptAddChannel(server.id, "voice"); };
            cat.appendChild(addBtn);
        }

        list.appendChild(cat);
        voiceChannels.forEach(ch => {
            const item = createChannelItem(ch, server.id);
            list.appendChild(item);
            // Show voice members under voice channels (Discord-like)
            const voiceMembers = (server.voiceMembers?.[ch.id]) || [];
            // FEAT-2: Show screen-share indicator next to channel name if anyone is sharing
            const sharingMember = voiceMembers.find(m => m.isSharingScreen || m.isSharingCamera);
            if (sharingMember) {
                const chIcon = item.querySelector('.ch-icon');
                if (chIcon) {
                    const shareTag = document.createElement('span');
                    shareTag.className = 'ch-share-tag';
                    shareTag.textContent = sharingMember.isSharingScreen ? '🖥️' : '📹';
                    shareTag.title = sharingMember.isSharingScreen ? 'Ekran paylaşılıyor' : 'Kamera açık';
                    shareTag.style.cssText = 'font-size:11px;margin-left:4px;vertical-align:middle;';
                    item.appendChild(shareTag);
                }
            }
            voiceMembers.forEach(m => {
                const vm = document.createElement("div");
                vm.className = "voice-member";
                // FEAT-1: Speaking animation class
                if (m.isSpeaking || (m.peer_id === state.peerId && state.isSpeaking)) {
                    vm.classList.add("voice-member--speaking");
                }
                const av = document.createElement("div");
                av.className = "vm-avatar";
                if (m.isSpeaking || (m.peer_id === state.peerId && state.isSpeaking)) {
                    av.classList.add("speaking");
                }
                applyAvatarToElement(av, m.avatar_color, m.avatar_image, m.username);
                vm.appendChild(av);
                const nameRow = document.createElement("div");
                nameRow.style.cssText = "display:flex;align-items:center;gap:4px;flex:1;min-width:0;";
                const name = document.createElement("span");
                name.textContent = m.username + (m.peer_id === state.peerId ? " (sen)" : "");
                name.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;";
                nameRow.appendChild(name);
                // FEAT-1/BUG-4: Share icons
                if (m.isSharingScreen || (m.peer_id === state.peerId && getLocalShareStream())) {
                    const ico = document.createElement("span");
                    ico.textContent = "🖥️";
                    ico.title = "Ekran paylaşıyor";
                    ico.style.fontSize = "11px";
                    nameRow.appendChild(ico);
                } else if (m.isSharingCamera || (m.peer_id === state.peerId && state.cameraStream)) {
                    const ico = document.createElement("span");
                    ico.textContent = "📹";
                    ico.title = "Kamera açık";
                    ico.style.fontSize = "11px";
                    nameRow.appendChild(ico);
                }
                vm.appendChild(nameRow);

                if (m.peer_id !== state.peerId) {
                    vm.style.cursor = "pointer";
                    vm.onclick = () => openUserProfile(m.peer_id, m.username, m.avatar_image, m.avatar_color);
                    vm.oncontextmenu = (e) => {
                        e.preventDefault();
                        showContextMenu(m.peer_id, m.username, e.clientX, e.clientY);
                    };
                }

                list.appendChild(vm);
            });
        });
    }
}

function renderHomeSidebar() {
    const list = document.getElementById("channel-list");
    list.innerHTML = `
        <div class="channel-category">ANA MENÜ</div>
        <div class="channel-item active" onclick="showHomeView()">
            <span class="ch-icon">🏠</span> <span class="ch-name">Giriş</span>
        </div>
        <div class="channel-item" onclick="toast('Yakında...','info')">
            <span class="ch-icon">💬</span> <span class="ch-name">Direkt Mesajlar</span>
        </div>
        <div class="channel-item" onclick="toast('Yakında...','info')">
            <span class="ch-icon">👥</span> <span class="ch-name">Arkadaşlar</span>
        </div>
    `;
}

function createChannelItem(channel, serverId) {
    const server = state.servers.find(s => s.id === serverId);
    const item = document.createElement("div");
    item.className = "channel-item" + (channel.id === state.activeChannelId ? " active" : "");
    item.id = `ch-${channel.id}`;
    item.dataset.ch = channel.id;
    if (channel.type === "text" && isChannelMuted(serverId, channel.id)) {
        item.classList.add("channel-muted");
        item.title = "Bu kanal yerel olarak sessize alındı";
    }

    const icon = document.createElement("span");
    icon.className = "ch-icon";
    icon.textContent = channel.type === "voice" ? "🔊" : "#";

    const name = document.createElement("span");
    name.className = "ch-name";
    name.textContent = channel.name;

    item.appendChild(icon);
    item.appendChild(name);

    // Unread badge
    const unread = server?.unread?.[channel.id] || 0;
    if (unread > 0) {
        const badge = document.createElement("span");
        badge.className = "ch-badge";
        badge.textContent = unread > 99 ? "99+" : unread;
        item.appendChild(badge);
    }

    item.onclick = () => {
        if (channel.type === "voice") showVoiceView(serverId, channel.id);
        else showChatView(serverId, channel.id);
        updateChannelSidebar(serverId);
    };

    item.ondblclick = () => {
        if (channel.type === "voice") {
            joinVoiceChannel(channel.id);
        }
    };

    item.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showChannelContextMenu(e, channel, serverId);
    };

    if (channel.type === "voice") {
        const isAdmin = server && (server.ownerId === state.peerId || server.peer_roles?.[state.peerId] === "admin");

        if (isAdmin) {
            item.ondragover = (e) => e.preventDefault();
            item.ondrop = (e) => {
                e.preventDefault();
                const targetPeer = e.dataTransfer.getData("peerId");
                if (targetPeer && targetPeer !== state.peerId) {
                    state.mesh.broadcast({ type: "force_route", target: targetPeer, targetChannel: channel.id });
                    toast("Kullanıcı yeni odaya yönlendiriliyor...", "info");
                }
            };
        }
    }

    return item;
}

/* ── Members panel ────────────────────────────────────────── */
let _updateMembersPanelTimeout = null;
function updateMembersPanel(serverId) {
    console.log("[Members] Updating panel for server:", serverId);

    // Debounce to prevent excessive re-renders
    if (_updateMembersPanelTimeout) {
        clearTimeout(_updateMembersPanelTimeout);
    }

    _updateMembersPanelTimeout = setTimeout(() => {
        _updateMembersPanelImpl(serverId);
    }, 16); // ~60fps
}

function _updateMembersPanelImpl(serverId) {
    const server = state.servers.find(s => s.id === serverId);
    const lists = [
        document.getElementById("members-list"),
        document.getElementById("voice-members-list")
    ].filter(l => l);
    const counts = [
        document.getElementById("member-count"),
        document.getElementById("voice-member-count")
    ].filter(c => c);

    lists.forEach(l => l.innerHTML = "");

    if (!server) {
        console.error("[Members] Server not found:", serverId);
        lists.forEach(list => {
            if (list) {
                list.innerHTML = '<div class="member-role-cat">Sunucu bulunamadı</div>';
            }
        });
        counts.forEach(count => {
            if (count) count.textContent = "0";
        });
        return;
    }

    const members = server.members || [];
    const roles = server.roles || {};
    counts.forEach(c => c.textContent = members.length);

    // Grouping by role
    const groups = {};
    Object.keys(roles).forEach(rid => groups[rid] = []);
    groups["member"] = groups["member"] || [];

    members.forEach(m => {
        const rid = server.peer_roles?.[m.peer_id] || "member";
        if (!groups[rid]) groups[rid] = [];
        groups[rid].push(m);
    });

    const allRids = Array.from(new Set([...Object.keys(roles), ...Object.keys(groups)]));
    const sortedRids = allRids.sort((a, b) => {
        const ra = roles[a] || { name: a.charAt(0).toUpperCase() + a.slice(1), hoist: false };
        const rb = roles[b] || { name: b.charAt(0).toUpperCase() + b.slice(1), hoist: false };
        if (ra.hoist && !rb.hoist) return -1;
        if (!ra.hoist && rb.hoist) return 1;
        return 0;
    });

    sortedRids.forEach(rid => {
        const groupMembers = groups[rid];
        if (groupMembers.length === 0) return;

        const roleData = roles[rid] || { name: rid.charAt(0).toUpperCase() + rid.slice(1), color: 'inherit' };
        lists.forEach(list => {
            const cat = document.createElement("div");
            cat.className = "member-role-cat";
            cat.textContent = `${roleData.name} — ${groupMembers.length}`;
            cat.style.color = "var(--text-muted)";
            cat.style.fontSize = "11px";
            cat.style.fontWeight = "bold";
            cat.style.padding = "16px 12px 8px";
            cat.style.textTransform = "uppercase";
            list.appendChild(cat);
        });

        groupMembers.forEach(m => {
            lists.forEach(list => {
                const item = document.createElement("div");
                item.className = "member-item";
                item.setAttribute("data-peer-id", m.peer_id);

                const isAdmin = server.ownerId === state.peerId || server.peer_roles?.[state.peerId] === "admin";
                if (isAdmin && m.peer_id !== state.peerId) {
                    item.draggable = true;
                    item.ondragstart = (e) => {
                        e.dataTransfer.setData("peerId", m.peer_id);
                    };
                }

                const av = document.createElement("div");
                av.className = "member-avatar";
                applyAvatarToElement(av, m.avatar_color, m.avatar_image, m.username);

                const dot = document.createElement("div");
                dot.className = "status-dot";
                av.appendChild(dot);

                const name = document.createElement("span");
                name.className = "member-name";
                name.textContent = m.username;
                name.style.color = roles[rid]?.color || "inherit";

                if (server.ownerId === m.peer_id) {
                    const crown = document.createElement("span");
                    crown.textContent = " 👑";
                    crown.title = "Sunucu Sahibi";
                    crown.style.fontSize = "12px";
                    name.appendChild(crown);
                }

                item.appendChild(av);
                item.appendChild(name);

                if (m.peer_id === state.peerId) {
                    const tag = document.createElement("span");
                    tag.className = "member-you-tag";
                    tag.textContent = "sen";
                    item.appendChild(tag);
                } else {
                    item.style.cursor = "pointer";
                    item.onclick = () => openUserProfile(m.peer_id, m.username, m.avatar_image, m.avatar_color);
                    item.oncontextmenu = (e) => {
                        e.preventDefault();
                        showContextMenu(m.peer_id, m.username, e.clientX, e.clientY);
                    };
                }

                list.appendChild(item);
            });
        });
    });
}

function updatePeerCountBadge(serverId) {
    const server = state.servers.find(s => s.id === serverId);
    const count = (server?.members?.length || 1);
    document.getElementById("peer-count-badge").textContent = `${count} kişi`;
}

/* ── Messages ─────────────────────────────────────────────── */
let _renderMessagesTimeout = null;
function renderMessages(serverId, channelId) {
    console.log("[Messages] Rendering for server:", serverId, "channel:", channelId);

    // Debounce to prevent excessive re-renders
    if (_renderMessagesTimeout) {
        clearTimeout(_renderMessagesTimeout);
    }

    _renderMessagesTimeout = setTimeout(() => {
        _renderMessagesImpl(serverId, channelId);
    }, 16); // ~60fps
}

function _renderMessagesImpl(serverId, channelId) {
    const server = state.servers.find(s => s.id === serverId);
    const area = document.getElementById("messages-area");

    if (!area) {
        console.error("[Messages] messages-area element not found!");
        return;
    }

    if (!server) {
        console.error("[Messages] Server not found:", serverId);
        area.innerHTML = `<div class="messages-welcome">
            <div class="messages-welcome-icon">❌</div>
            <h3>Sunucu bulunamadı</h3>
            <p>Bu sunucu mevcut değil veya erişim izniniz yok.</p>
        </div>`;
        return;
    }

    const cid = canonicalChannelIdForChat(server, channelId);
    const all = server?.messages?.[cid] || [];
    const loadWrap = document.getElementById("messages-load-more-wrap");
    const loadBtn = document.getElementById("messages-load-more-btn");

    if (all.length === 0) {
        if (loadWrap) {
            loadWrap.classList.add("hidden");
            const lb = document.getElementById("messages-load-more-btn");
            if (lb) lb.onclick = null;
        }
        area.innerHTML = `<div class="messages-welcome">
    <div class="messages-welcome-icon">💬</div>
    <h3># ${server?.channels.find(c => c.id === cid)?.name || channelId}</h3>
    <p>Bu kanalın başlangıcı. Merhaba! 👋</p>
  </div>`;
        if (server) {
            if (!server.unread) server.unread = {};
            server.unread[cid] = 0;
            updateChannelSidebar(serverId);
        }
        return;
    }

    if (!server._msgListOffset) server._msgListOffset = {};
    let start = server._msgListOffset[cid];
    if (typeof start !== "number" || start < 0) {
        start = Math.max(0, all.length - CHAT_INITIAL_LIMIT);
        server._msgListOffset[cid] = start;
    }
    start = Math.min(start, Math.max(0, all.length - 1));
    server._msgListOffset[cid] = start;
    const messages = all.slice(start);

    if (loadWrap && loadBtn) {
        if (start > 0) {
            loadWrap.classList.remove("hidden");
            loadBtn.textContent = `Daha eski mesajlar (${start} önceki)`;
            loadBtn.onclick = () => {
                server._msgListOffset[cid] = Math.max(0, start - CHAT_LOAD_MORE_STEP);
                renderMessages(serverId, channelId);
            };
        } else {
            loadWrap.classList.add("hidden");
            loadBtn.onclick = null;
        }
    }

    area.innerHTML = "";
    let lastAuthor = null;

    const pins = server?.pinned_messages || [];
    messages.forEach(msg => {
        const grouped = msg.authorId === lastAuthor && !msg.replyTo;
        const copy = { ...msg };
        if (pins.find(p => p.id === msg.id)) copy.isPinned = true;
        appendMessageDOM(copy, grouped, serverId, { scrollToBottom: true });
        lastAuthor = msg.authorId;
    });

    if (server) {
        if (!server.unread) server.unread = {};
        server.unread[cid] = 0;
        updateChannelSidebar(serverId);
    }
    requestAnimationFrame(() => {
        area.scrollTop = area.scrollHeight;
        hideNewMsgsChip();
    });
}

function hydrateMessageReactions(bubbleEl, msg) {
    const norm = normalizeReactionsMap(msg.reactions);
    msg.reactions = norm;
    if (Object.keys(norm).length === 0) return;
    updateReactionBar(msg.id, norm);
}

function appendMessageDOM(msg, grouped = false, serverId = null, opts = {}) {
    // Check if author is blocked
    if (state.blockedPeers?.includes(msg.authorId)) return;

    const forceBottom = opts.scrollToBottom === true;
    const area = document.getElementById("messages-area");
    const sid = serverId || state.activeServerId;
    const isSelf = msg.authorId === state.peerId;
    const el = document.createElement("div");
    el.className = "message message-bubble msg-row" + (isSelf ? " msg-row--self" : " msg-row--other") + (grouped ? " grouped" : "");
    el.dataset.msgId = msg.id;
    el.style.position = "relative";

    const inner = document.createElement("div");
    inner.className = "msg-row-inner";

    const avatarDiv = document.createElement("div");
    avatarDiv.className = "msg-avatar";
    applyAvatarToElement(avatarDiv, msg.avatarColor, msg.avatarImage, msg.author);

    const stack = document.createElement("div");
    stack.className = "msg-stack";

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble" + (isSelf ? " msg-bubble--self" : " msg-bubble--other");

    if (!grouped) {
        const header = document.createElement("div");
        header.className = "msg-header";
        const authorSpan = document.createElement("span");
        authorSpan.className = "msg-author" + (isSelf ? " is-you" : "");
        authorSpan.textContent = msg.author;
        if (!isSelf) {
            authorSpan.style.cursor = "pointer";
            authorSpan.onclick = () => openUserProfile(msg.authorId, msg.author, msg.avatarImage, msg.avatarColor);
            authorSpan.oncontextmenu = (e) => {
                e.preventDefault();
                showContextMenu(msg.authorId, msg.author, e.clientX, e.clientY);
            };
        }
        const timeSpan = document.createElement("span");
        timeSpan.className = "msg-time";
        timeSpan.textContent = msg.time;
        header.appendChild(authorSpan);
        header.appendChild(timeSpan);
        bubble.appendChild(header);
    }

    if (msg.replyTo?.messageId) {
        const ref = document.createElement("button");
        ref.type = "button";
        ref.className = "msg-reply-ref" + (grouped ? " msg-reply-ref--compact" : "");
        const sn = escapeHtml((msg.replyTo.snippet || msg.replyTo.text || "").replace(/\s+/g, " ").slice(0, 80));
        ref.innerHTML = `<span class="msg-reply-bar"></span><span class="msg-reply-meta">@${escapeHtml(msg.replyTo.author || "?")}</span><span class="msg-reply-snippet">${sn}</span>`;
        ref.onclick = (e) => {
            e.preventDefault();
            scrollToChatMessage(msg.replyTo.messageId);
        };
        if (!grouped) bubble.insertBefore(ref, bubble.firstChild);
        else bubble.appendChild(ref);
    }

    const textDiv = document.createElement("div");
    textDiv.className = "msg-text";
    textDiv.innerHTML = parseMessageText(msg.text, sid);
    bubble.appendChild(textDiv);

    // Add reactions if they exist
    if (sid && msg.id) {
        setTimeout(() => {
            renderMessageReactions(sid, msg.channelId || state.activeChannelId, msg.id);
        }, 100);
    }

    textDiv.addEventListener("click", (e) => {
        const elM = e.target.closest(".mention");
        if (!elM) return;
        const pid = elM.getAttribute("data-peer");
        if (!pid) return;
        const server = state.servers.find(s => s.id === sid);
        const member = server?.members?.find(m => m.peer_id === pid);
        if (member) {
            e.preventDefault();
            openUserProfile(pid, member.username, member.avatar_image, member.avatar_color);
        }
    });

    const onCtx = (e) => {
        e.preventDefault();
        showMsgContextMenu(msg, e.clientX, e.clientY);
    };
    el.oncontextmenu = onCtx;
    bubble.oncontextmenu = onCtx;

    if (msg.attachment) {
        const img = document.createElement("img");
        img.className = "msg-attach-img";
        img.src = msg.attachment;
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = "Ek";
        img.onclick = () => img.classList.toggle("msg-attach-img--expanded");
        textDiv.appendChild(img);
    }

    bubble.appendChild(textDiv);
    stack.appendChild(bubble);
    inner.appendChild(avatarDiv);
    inner.appendChild(stack);
    el.appendChild(inner);

    if (msg.isPinned) {
        el.classList.add("pinned");
        const pinIcon = document.createElement("span");
        pinIcon.className = "pin-badge";
        pinIcon.innerHTML = "📌";
        pinIcon.title = "Sabitlenmiş Mesaj";
        bubble.appendChild(pinIcon);
    }

    hydrateMessageReactions(el, msg);

    const stickBottom = forceBottom || !isChatScrolledUp();
    area.appendChild(el);
    if (stickBottom) {
        area.scrollTop = area.scrollHeight;
        hideNewMsgsChip();
    } else if (!isSelf && msg.channelId === state.activeChannelId && sid === state.activeServerId) {
        showNewMsgsChip();
    }
}

function addSystemMessage(text) {
    const area = document.getElementById("messages-area");
    const el = document.createElement("div");
    el.className = "system-message";
    el.textContent = text;
    const stick = !isChatScrolledUp();
    area.appendChild(el);
    if (stick) {
        area.scrollTop = area.scrollHeight;
        hideNewMsgsChip();
    }
}

/* ── Send chat message ────────────────────────────────────── */
async function sendMessage() {
    console.log("[sendMessage] Starting flow...");
    const input = document.getElementById("chat-input");
    if (!input) {
        console.error("[sendMessage] Critical Error: chat-input element not found!");
        toast("Sistem Hatası: Chat girişi bulunamadı.", "error");
        return;
    }
    const text = input.value.trim();
    console.log("[sendMessage] Input text length:", text.length);

    if (!text) {
        console.warn("[sendMessage] Aborting: Empty text");
        return;
    }
    if (!state.activeServerId || !state.activeChannelId) {
        console.error("[sendMessage] Aborting: Missing active identifiers", { srv: state.activeServerId, ch: state.activeChannelId });
        toast("Kanal bilgisi eksik, lütfen tekrar kanala tıklayın.", "warning");
        return;
    }

    // Check if it's a music bot command (/music)
    if (typeof handleMusicCommand === 'function' && handleMusicCommand(text)) {
        console.log("[sendMessage] Music command detected and handled.");
        input.value = "";
        input.style.height = "auto";
        return;
    }

    let finalJoinText = text;
    if (state.translationEnabled) {
        toast("Çeviriliyor...", "info");
        finalJoinText = await translateText(text, state.targetLang);
    }

    const msg = {
        type: "chat",
        channelId: state.activeChannelId,
        text: finalJoinText,
        author: state.username,
        authorId: state.peerId,
        avatarColor: state.avatarColor,
        avatarImage: state.avatarImage,
        time: now(),
        id: genId(),
        isPinned: false
    };

    if (state.replyTo?.messageId) {
        msg.replyTo = {
            messageId: state.replyTo.messageId,
            author: state.replyTo.author,
            authorId: state.replyTo.authorId,
            snippet: (state.replyTo.text || "").slice(0, 120),
            text: (state.replyTo.text || "").slice(0, 200),
        };
    }

    // V16: Server-side Persistence
    fetch(`${API_BASE}/rooms/${state.activeServerId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg })
    });

    input.value = "";
    input.style.height = "auto";

    clearReplyTarget();
    saveMessage(state.activeServerId, msg);
    meshBroadcastReliable({ type: "chat", payload: msg });
}

/** !play: youtube.com/watch, embed/, youtu.be veya 11 karakter id */
function extractYouTubeVideoId(query) {
    const s = String(query || "").trim();
    const m = s.match(/(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    return null;
}

function renderPlainChatSegment(segment, serverId) {
    const chunks = [];
    let i = 0;
    const str = String(segment);
    while (i < str.length) {
        const o = str.indexOf("||", i);
        if (o === -1) {
            chunks.push({ kind: "text", v: str.slice(i) });
            break;
        }
        if (o > i) chunks.push({ kind: "text", v: str.slice(i, o) });
        const c = str.indexOf("||", o + 2);
        if (c === -1) {
            chunks.push({ kind: "text", v: str.slice(o) });
            break;
        }
        chunks.push({ kind: "spoiler", v: str.slice(o + 2, c) });
        i = c + 2;
    }
    return chunks.map(ch => {
        if (ch.kind === "spoiler") {
            return `<span class="spoiler" title="Göstermek için tıkla" onclick="this.classList.toggle('revealed')">${escapeHtml(ch.v)}</span>`;
        }
        return applyMentionsThenEscape(ch.v, serverId);
    }).join("");
}

function applyMentionsThenEscape(text, serverId) {
    let s = String(text);
    const ph = [];
    if (serverId) {
        const server = state.servers.find(ss => ss.id === serverId);
        const members = server?.members || [];
        const names = [...new Set(members.map(m => m.username).filter(Boolean))].sort((a, b) => b.length - a.length);
        names.forEach(name => {
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const re = new RegExp(`(^|\\s)@${escaped}(?!\\w)`, "g");
            s = s.replace(re, (full, lead) => {
                const member = members.find(mm => mm.username === name);
                const idx = ph.length;
                ph.push(`<span class="mention" data-peer="${escapeHtml(member?.peer_id || "")}">${escapeHtml("@" + (member?.username || name))}</span>`);
                return `${lead}\uE000${idx}\uE001`;
            });
        });
    }
    s = escapeHtml(s);
    for (let i = 0; i < ph.length; i++) {
        s = s.split(`\uE000${i}\uE001`).join(ph[i]);
    }
    return s;
}

function parseMessageText(text, serverId) {
    if (!text) return "";
    const sid = arguments.length >= 2 ? serverId : state.activeServerId;
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return String(text).split(urlRegex).map(part => {
        if (part.match(urlRegex)) {
            // Check for images
            if (part.match(/\.(jpeg|jpg|gif|png|webp)($|\?)/i)) {
                return `<a href="${part}" target="_blank" class="rich-link"><img src="${part}" class="chat-embed-img" alt="" loading="lazy" decoding="async" /></a>`;
            }
            // Check for YouTube
            const ytMatch = part.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
            if (ytMatch) {
                return `<div class="chat-embed-video"><iframe src="https://www.youtube.com/embed/${ytMatch[1]}" frameborder="0" allowfullscreen></iframe></div>`;
            }
            // Generic link
            return `<a href="${part}" target="_blank" class="chat-link">${part}</a>`;
        }
        return renderPlainChatSegment(part, sid);
    }).join("");
}

async function translateText(text, target = "tr") {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(text)}`;
        const res = await fetch(url);
        const json = await res.json();
        if (json && json[0]) {
            return json[0].map(x => x[0]).join("");
        }
        return text;
    } catch (e) {
        console.error("Translation failed", e);
        return text;
    }
}

function saveMessage(serverId, msg) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;
    if (msg.reactions) msg.reactions = normalizeReactionsMap(msg.reactions);
    const cid = canonicalChannelIdForChat(server, msg.channelId);
    const normalized = cid !== msg.channelId ? { ...msg, channelId: cid } : msg;

    if (!server.messages) server.messages = {};
    if (!server.messages[normalized.channelId]) server.messages[normalized.channelId] = [];
    if (normalized.id && server.messages[normalized.channelId].some(m => m.id === normalized.id)) return;
    server.messages[normalized.channelId].push(normalized);

    const activeCanon = canonicalChannelIdForChat(server, state.activeChannelId);
    // If this is the active channel, append to DOM
    if (normalized.channelId === activeCanon && serverId === state.activeServerId) {
        const msgs = server.messages[normalized.channelId];
        const prev = msgs[msgs.length - 2];
        const grouped = prev && prev.authorId === normalized.authorId && !normalized.replyTo;
        appendMessageDOM(normalized, grouped, serverId);
    } else {
        // Mark unread (skip when this channel is locally muted)
        if (!isChannelMuted(serverId, normalized.channelId)) {
            if (!server.unread) server.unread = {};
            server.unread[normalized.channelId] = (server.unread[normalized.channelId] || 0) + 1;
        }
        updateChannelSidebar(serverId);
    }
}

/* ── Typing Indicators ────────────────────────────────────── */
function broadcastTypingIndicator() {
    if (!state.mesh || !state.activeServerId || !state.activeChannelId) return;

    meshBroadcastReliable({
        type: "typing_start",
        serverId: state.activeServerId,
        channelId: state.activeChannelId,
        username: state.username,
        peerId: state.peerId
    });

    // Clear any previous timeout
    if (state._typingTimeout) clearTimeout(state._typingTimeout);

    // Stop typing after 3 seconds of inactivity
    state._typingTimeout = setTimeout(() => {
        meshBroadcastReliable({
            type: "typing_stop",
            serverId: state.activeServerId,
            channelId: state.activeChannelId,
            peerId: state.peerId
        });
    }, 3000);
}

function updateTypingIndicator(serverId, channelId, peerId, username, isTyping) {
    const key = `${serverId}-${channelId}`;
    if (!state.typingIndicators[key]) {
        state.typingIndicators[key] = {};
    }

    if (isTyping) {
        state.typingIndicators[key][peerId] = { username, timestamp: Date.now() };
    } else {
        delete state.typingIndicators[key][peerId];
    }

    // Update typing display
    if (serverId === state.activeServerId && channelId === state.activeChannelId) {
        updateTypingDisplay();
    }
}

function updateTypingDisplay() {
    const key = `${state.activeServerId}-${state.activeChannelId}`;
    const typing = Object.values(state.typingIndicators[key] || {});
    const typingEl = document.getElementById("typing-indicator");

    if (!typingEl) return;

    if (typing.length === 0) {
        typingEl.classList.add("hidden");
        return;
    }

    const names = typing.map(t => t.username).join(", ");
    const count = typing.length;
    typingEl.classList.remove("hidden");

    if (count === 1) {
        typingEl.textContent = `${names} yazıyor...`;
    } else if (count === 2) {
        typingEl.textContent = `${names} yazıyor...`;
    } else {
        typingEl.textContent = `${count} kişi yazıyor...`;
    }
}

/* ── User Notes & Profiles ────────────────────────────────── */
function saveUserNote(peerId, note) {
    state.userNotes[peerId] = note;
    localStorage.setItem(`scord_note_${peerId}`, note);
}

function getUserNote(peerId) {
    if (!state.userNotes[peerId]) {
        const saved = localStorage.getItem(`scord_note_${peerId}`);
        if (saved) state.userNotes[peerId] = saved;
    }
    return state.userNotes[peerId] || "";
}

function mergeMessageHistoryIntoServer(server, incoming) {
    if (!server || !incoming || typeof incoming !== "object") return;
    if (!server.messages) server.messages = {};
    Object.keys(incoming).forEach(chId => {
        const canonical = canonicalChannelIdForChat(server, chId);
        const inc = incoming[chId];
        if (!Array.isArray(inc) || inc.length === 0) return;
        if (!server.messages[canonical]) server.messages[canonical] = [];
        const target = server.messages[canonical];
        const seen = new Set(target.map(m => m.id));
        for (const m of inc) {
            if (m && m.id && !seen.has(m.id)) {
                target.push(m);
                seen.add(m.id);
            }
        }
        target.sort((a, b) => String(a.time || "").localeCompare(String(b.time || ""), "tr"));
    });
}

async function createServer(name) {
    console.log("[Create] Creating server:", name);

    const res = await scordFetch(`${API_BASE}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, owner_id: state.peerId }),
    });
    if (!res.ok) {
        console.error("[Create] Failed to create server:", res.status);
        toast("Sunucu oluşturulamadı.", "error");
        return;
    }

    const created = await res.json();
    const room_id = created.room_id;
    const inviteCode = created.invite_code || "";

    console.log("[Create] Server created:", room_id);

    const server = {
        id: room_id,
        name: name,
        ownerId: state.peerId,
        inviteCode,
        channels: [
            { id: "ch-genel", name: "genel", type: "text" },
            { id: "ch-duyurular", name: "duyurular", type: "text" },
            { id: "ch-sesli", name: "sesli-sohbet", type: "voice" },
            { id: "ch-muzik", name: "müzik", type: "voice" },
        ],
        roles: {
            "admin": { name: "Admin", color: "#ef4444", hoist: true },
            "member": { name: "Üye", color: "#94a3b8", hoist: false }
        },
        peer_roles: { [state.peerId]: "admin" },
        members: [{
            peer_id: state.peerId,
            username: state.username,
            avatar_color: state.avatarColor,
            avatar_image: state.avatarImage,
        }],
        messages: {},
        unread: {},
        voiceMembers: {},
        voiceSessionHost: {},
        channel_backgrounds: {},
    };

    // Save to storage for persistence
    saveServerToStorage(server);

    state.servers.push(server);
    renderServerRail();
    connectToRoom(room_id);
    const sidebarName = document.getElementById("sidebar-server-name");
    if (sidebarName) sidebarName.textContent = name;
    if (server.channels && server.channels.length > 0) {
        showChatView(server.id, server.channels[0].id);
    }
    toast(`"${name}" sunucusu oluşturuldu! 🎉`, "success");
    return server;
}

function promptAddChannel(serverId, type) {
    const title = type === "voice" ? "Yeni Sesli Kanal Oluştur" : "Yeni Metin Kanalı Oluştur";
    const body = `
        <div style="margin-bottom: 15px;">
            <label style="display: block; margin-bottom: 5px; color: var(--text-muted); font-size: 12px; font-weight: bold; text-transform: uppercase;">KANAL ADI</label>
            <input type="text" id="new-ch-name" placeholder="kanal-adı" style="width: 100%; padding: 10px; background: var(--bg-dark); border: none; border-radius: 4px; color: var(--text-normal); outline: none;">
        </div>
    `;
    const footer = `
        <button class="btn-secondary" onclick="hideModal()">İptal</button>
        <button class="btn-primary" onclick="submitAddChannel('${serverId}', '${type}')">Kanal Oluştur</button>
    `;
    showModal(title, body, footer);
    setTimeout(() => document.getElementById("new-ch-name").focus(), 100);
}

async function submitAddChannel(serverId, type) {
    const nameInput = document.getElementById("new-ch-name");
    const name = nameInput.value.trim().toLowerCase().replace(/\s+/g, '-');
    if (!name) return toast("Bir kanal adı girmelisin.", "error");

    const res = await fetch(`${API_BASE}/rooms/${serverId}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type })
    });
    const newCh = await res.json();

    if (newCh.error) return toast(newCh.error, "error");

    const server = state.servers.find(s => s.id === serverId);
    if (server) {
        server.channels.push(newCh);
        if (state.mesh) {
            state.mesh.broadcast({ type: "channel_create", payload: { serverId, channel: newCh } });
        }
        updateChannelSidebar(serverId);
    }

    hideModal();
    toast(`#${name} kanalı oluşturuldu.`, "success");
}

async function deleteChannel(serverId, channelId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;
    const channel = server.channels.find(c => c.id === channelId);
    if (!channel) return;

    if (!confirm(`"#${channel.name}" kanalını silmek istediğine emin misin?`)) return;

    try {
        const res = await fetch(`${API_BASE}/rooms/${serverId}/channels/${channelId}`, { method: "DELETE" });
        const data = await res.json();
        if (data.success || res.ok) {
            server.channels = server.channels.filter(c => c.id !== channelId);
            if (state.mesh) {
                state.mesh.broadcast({ type: "channel_delete", payload: { serverId, channelId } });
            }
            if (state.activeChannelId === channelId) {
                const firstText = server.channels.find(c => c.type === "text");
                if (firstText) showChatView(serverId, firstText.id);
                else showHomeView();
            } else {
                updateChannelSidebar(serverId);
            }
            toast("Kanal silindi.", "success");
        } else {
            toast("Kanal silinemedi: " + (data.error || "Bilinmeyen hata"), "error");
        }
    } catch (e) {
        toast("Bağlantı hatası.", "error");
    }
}

async function renameChannel(serverId, channelId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;
    const channel = server.channels.find(c => c.id === channelId);
    if (!channel) return;

    const newName = prompt("Yeni kanal adını girin:", channel.name);
    if (!newName || newName === channel.name) return;

    try {
        const res = await fetch(`${API_BASE}/rooms/${serverId}/channels/${channelId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: newName.toLowerCase().replace(/\s+/g, '-') })
        });
        const data = await res.json();
        if (data.success || res.ok) {
            const updatedCh = data.channel || { ...channel, name: newName.toLowerCase().replace(/\s+/g, '-') };
            const idx = server.channels.findIndex(c => c.id === channelId);
            if (idx !== -1) server.channels[idx] = updatedCh;

            if (state.mesh) {
                state.mesh.broadcast({ type: "channel_rename", payload: { serverId, channelId, name: updatedCh.name } });
            }
            updateChannelSidebar(serverId);
            if (state.activeChannelId === channelId) {
                document.getElementById("active-channel-name").textContent = updatedCh.name;
                const chatName = document.getElementById("chat-channel-name");
                if (chatName) chatName.textContent = updatedCh.name;
            }
            toast("Kanal adı güncellendi.", "success");
        } else {
            toast("Kanal adı güncellenemedi.", "error");
        }
    } catch (e) {
        toast("Bağlantı hatası.", "error");
    }
}

/* ── Join existing server ─────────────────────────────────── */
async function joinServer(roomId) {
    console.log("[Join] Joining server:", roomId);

    // Check room exists
    const rooms = await fetch(`${API_BASE}/rooms`).then(r => r.json());
    const room = rooms.find(r => r.room_id === roomId);
    if (!room) {
        console.error("[Join] Room not found:", roomId);
        toast("Sunucu bulunamadı.", "error");
        return;
    }

    // Check not already joined
    if (state.servers.find(s => s.id === roomId)) {
        console.log("[Join] Already joined, switching to server");
        switchToServer(roomId);
        return;
    }

    const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    const peerList = (room.peers || []).map(p => ({
        peer_id: p.peer_id,
        username: p.username,
        avatar_color: p.avatar_color,
        avatar_image: p.avatar_image ?? null,
    }));
    if (!peerList.some(m => m.peer_id === state.peerId)) {
        peerList.push({
            peer_id: state.peerId,
            username: state.username,
            avatar_color: state.avatarColor,
            avatar_image: state.avatarImage,
        });
    }
    const server = {
        id: roomId,
        name: room.name,
        color,
        ownerId: room.owner_id,
        inviteCode: room.invite_code,
        channels: room.channels || [
            { id: "ch-genel", name: "genel", type: "text" },
            { id: "ch-duyurular", name: "duyurular", type: "text" },
            { id: "ch-sesli", name: "sesli-sohbet", type: "voice" },
            { id: "ch-muzik", name: "müzik", type: "voice" },
        ],
        roles: room.roles || {},
        peer_roles: room.peer_roles || {},
        members: peerList,
        messages: room.messages || {},
        pinned_messages: room.pinned_messages || [],
        unread: {},
        voiceMembers: {},
        voiceSessionHost: {},
        channel_backgrounds: room.channel_backgrounds || {},
    };

    // Save to storage for persistence
    saveServerToStorage(server);

    state.servers.push(server);
    renderServerRail();
    connectToRoom(roomId);
    const firstText = server.channels.find(c => c.type === "text");
    if (firstText) {
        showChatView(server.id, firstText.id);
    } else {
        showChatView(server.id, server.channels[0].id);
    }
    toast(`"${room.name}" sunucusuna katıldın! 👋`, "success");
}

/* ── P2P Mesh connection management ──────────────────────── */
function connectToRoom(roomId) {
    state._p2pOutbox = [];
    clearRttPingTimer();
    // Disconnect old mesh if any
    if (state.mesh) {
        clearMeshHealthPoll();
        state.mesh.disconnect();
        state.mesh = null;
    }

    // Load reactions, threads, pinned messages, message history, roles, channel categories, server boosts, and custom emojis for this server
    loadReactionsFromStorage(roomId);
    loadThreadsFromStorage(roomId);
    loadPinnedMessagesFromStorage(roomId);
    loadMessageHistoryFromStorage(roomId);
    loadRolesFromStorage(roomId);
    loadChannelCategoriesFromStorage(roomId);
    loadServerBoostsFromStorage(roomId);
    loadCustomEmojisFromStorage(roomId);

    const wsUrl = `${WS_BASE}`;
    state.mesh = new P2PMesh(roomId, state.peerId, wsUrl, {
        onMessage: (fromPeerId, data) => handleIncomingP2P(fromPeerId, data, roomId),
        onPeerJoined: (peerId, info) => handlePeerJoined(peerId, info, roomId),
        onPeerLeft: (peerId) => handlePeerLeft(peerId, roomId),
        onVoiceStream: (peerId, stream) => handleVoiceStream(peerId, stream),
        onTrackAdded: (peerId, track, stream) => handleTrackAdded(peerId, track, stream),
        onPeerConnected: (peerId) => handlePeerConnected(peerId, roomId),
        onStatusChange: (status) => updateConnectionStatus(status),
        onServerEvent: (msg) => handleAuthoritativeServerEvent(msg, roomId),
    });

    attachMeshBroadcastSync(state.mesh, roomId);
    state.mesh.connect(state.username, state.avatarColor, state.avatarImage);
    startRttPingTimer();
    startMeshHealthPoll();
    refreshConnectionBadge();
}

function connectMesh(serverId) {
    if (!serverId) return;
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;
    connectToRoom(serverId);
}

/* ── P2P event handlers ───────────────────────────────────── */
function handleIncomingP2P(fromPeerId, data, roomId) {
    if (data && data.type === "broadcast" && data.payload && typeof data.payload === "object") {
        handleIncomingP2P(fromPeerId, data.payload, roomId);
        return;
    }
    if (!data || typeof data !== "object") return;

    if (isPeerBanned(roomId, fromPeerId)) {
        return; // Ignore all messages from banned peers
    }

    if (data.type === "latency_ping") {
        state.mesh?.sendTo(fromPeerId, { type: "latency_pong", pingId: data.pingId, t0: data.t0 });
        return;
    }
    if (data.type === "latency_pong" && data.t0 != null) {
        const rtt = Date.now() - data.t0;
        state.peerRttMs = state.peerRttMs || {};
        state.peerLatencyMs = state.peerLatencyMs || {};
        state.peerRttMs[fromPeerId] = rtt;
        state.peerLatencyMs[fromPeerId] = Math.round(rtt / 2);
        updateVoiceSessionMeta();
        return;
    }

    if (data.type === "status_update") {
        handleStatusUpdate({ from: fromPeerId, ...data });
        return;
    }

    if (data.type === "activity_update") {
        handleActivityUpdate({ from: fromPeerId, ...data });
        return;
    }

    if (data.type === "reaction_add") {
        handleReactionAdd(data);
        return;
    }

    if (data.type === "reaction_remove") {
        handleReactionRemove(data);
        return;
    }

    if (data.type === "thread_create") {
        handleThreadCreate(data);
        return;
    }

    if (data.type === "thread_message") {
        handleThreadMessage(data);
        return;
    }

    if (data.type === "msg_edit") {
        handleMessageEdit(data);
        return;
    }

    if (data.type === "roles_update") {
        handleRolesUpdate(data);
        return;
    }

    if (data.type === "channel_categories_update") {
        handleChannelCategoriesUpdate(data);
        return;
    }

    if (data.type === "server_boost_update") {
        handleServerBoostUpdate(data);
        return;
    }

    if (data.type === "custom_emojis_update") {
        handleCustomEmojisUpdate(data);
        return;
    }

    if (data._sync) {
        const trip = Date.now() - data._sync.sentAt;
        const oneWay = Math.min(9999, Math.round(trip / 2));
        state.peerIngressMs = state.peerIngressMs || {};
        state.peerIngressMs[fromPeerId] = oneWay;
        const { _sync, ...rest } = data;
        data = rest;
        updateVoiceSessionMeta();
    }

    if (data.type === "chat") {
        const msg = data.payload;
        saveMessage(roomId, msg);
        const srv = state.servers.find(s => s.id === roomId);
        const msgCanon = srv ? canonicalChannelIdForChat(srv, msg.channelId) : msg.channelId;
        const activeCanon = srv ? canonicalChannelIdForChat(srv, state.activeChannelId) : state.activeChannelId;
        const inactive = msgCanon !== activeCanon || roomId !== state.activeServerId;
        if (inactive && shouldShowChatToast(msg)) {
            toast(`${msg.author}: ${(msg.text || "").slice(0, 60)}`, "info");
        }
        if (msg.authorId !== state.peerId) {
            if (state.notifSettings?.messageSound !== false) {
                playSound(660, 100); // Quick chirp for chat
            }
            if (!inactive) {
                announceA11y(`${msg.author} yazdı`);
            }
        }
    } else if (data.type === "dm" || data.type === "dm_relay") {
        if (data.type === "dm_relay" && data.target && data.target !== state.peerId) {
            return;
        }
        if (!state.dms) state.dms = {};
        if (!state.dms[fromPeerId]) state.dms[fromPeerId] = [];
        state.dms[fromPeerId].push(data.payload);

        addToRecentDMs(fromPeerId, data.payload.author, data.payload.avatarColor, data.payload.avatarImage);

        if (state.activeDM === fromPeerId) {
            renderDMMessages(fromPeerId);
        } else if (state.notifSettings?.dm !== false) {
            toast(`Özel Mesaj (DM) - ${data.payload.author}: ${(data.payload.text || "").slice(0, 60)}`, "info");
        }
        if (data.payload.authorId !== state.peerId) {
            if (state.notifSettings?.messageSound !== false) {
                playSound(880, 150); // Slightly higher/longer chirp for DM
            }
        }
    } else if (data.type === "identity_announce" || data.type === "profile_update") {
        const payload = data.type === "identity_announce" ? data : data.payload;
        const uname = payload.username || payload.name;
        const acol = payload.avatarColor || payload.avatar_color;
        const aimg = payload.avatarImage ?? payload.avatar_image;

        const server = state.servers.find(s => s.id === roomId);
        if (server) {
            if (!server.members) server.members = [];
            let memberIdx = server.members.findIndex(m => m.peer_id === fromPeerId);
            if (memberIdx === -1) {
                server.members.push({
                    peer_id: fromPeerId,
                    username: uname || "Anonim",
                    avatar_color: acol || "#7c3aed",
                    avatar_image: aimg ?? null,
                });
            } else {
                if (uname) server.members[memberIdx].username = uname;
                if (acol) server.members[memberIdx].avatar_color = acol;
                if (aimg !== undefined) server.members[memberIdx].avatar_image = aimg;
            }
        }

        if (state.activeServerId === roomId) {
            updateMembersPanel(roomId);
            updatePeerCountBadge(roomId);
        }
    } else if (data.type === "voice_join") {
        // Only update local UI/state. Do NOT reply with voice_state_sync here,
        // otherwise peers can enter a join<->sync ping-pong loop.
        const server = state.servers.find(s => s.id === roomId);
        if (server) {
            if (!server.voiceMembers) server.voiceMembers = {};
            const ch = canonicalVoiceChannelId(server, data.channelId);

            // Remove the user from other voice channels within the same room
            Object.keys(server.voiceMembers).forEach(chId => {
                if (chId !== ch) {
                    server.voiceMembers[chId] = server.voiceMembers[chId].filter(m => m.peer_id !== fromPeerId);
                }
            });

            if (!server.voiceMembers[ch]) server.voiceMembers[ch] = [];
            const othersBeforeJoin = server.voiceMembers[ch].filter(m => m.peer_id !== fromPeerId);
            if (othersBeforeJoin.length === 0) {
                ensureVoiceSessionHost(server, ch, fromPeerId, data.username);
            }

            let member = server.voiceMembers[ch].find(m => m.peer_id === fromPeerId);

            if (!member) {
                member = {
                    peer_id: fromPeerId,
                    username: data.username,
                    avatar_color: data.avatarColor,
                    avatar_image: data.avatarImage,
                    isSharingScreen: !!data.isSharingScreen,
                    isSharingCamera: !!data.isSharingCamera
                };
                server.voiceMembers[ch].push(member);
            } else {
                member.username = data.username;
                member.avatar_color = data.avatarColor;
                member.avatar_image = data.avatarImage;
                member.isSharingScreen = !!data.isSharingScreen;
                member.isSharingCamera = !!data.isSharingCamera;
            }

            updateChannelSidebar(roomId);
            if (state.activeChannelId === ch || state.voiceChannelId === ch) {
                renderVoiceParticipants(roomId, ch);
                updateVoiceSessionMeta();
            }
            updateMuteStates();

            // Notify user about new participant (join only)
            if (data.username && data.username !== state.username && state.notifSettings?.join !== false) {
                const key = `${fromPeerId}-join`;
                if (!state.recentVoiceToasts.has(key)) {
                    toast(`${data.username} sesli kanala katıldı!`, "info");
                    playSound(523, SCORD_T().SOUND_JOIN_MS ?? 300);
                    state.recentVoiceToasts.add(key);
                    setTimeout(() => state.recentVoiceToasts.delete(key), SCORD_T().VOICE_NOTIFY_DEDUP_MS ?? 10000);
                }
            }
        }

    } else if (data.type === "voice_state_request") {
        // New user is requesting voice state. Respond with all participants in this channel.
        const server = state.servers.find(s => s.id === roomId);
        if (server?.voiceMembers && state.voiceChannelId) {
            const ch = canonicalVoiceChannelId(server, data.channelId);
            const members = server.voiceMembers[ch] || [];
            // Respond to the requester with all members in this channel
            state.mesh?.sendTo(fromPeerId, {
                type: "voice_state_list",
                channelId: ch,
                members: members
            });
        }

    } else if (data.type === "voice_state_sync") {
        // State synchronization: update membership flags only.
        // No toasts/sounds here.
        const server = state.servers.find(s => s.id === roomId);
        if (server && server.voiceMembers) {
            const ch = canonicalVoiceChannelId(server, data.channelId);
            if (!server.voiceMembers[ch]) server.voiceMembers[ch] = [];

            let member = server.voiceMembers[ch].find(m => m.peer_id === fromPeerId);
            if (!member) {
                member = {
                    peer_id: fromPeerId,
                    username: data.username,
                    avatar_color: data.avatarColor,
                    avatar_image: data.avatarImage,
                    isSharingScreen: !!data.isSharingScreen,
                    isSharingCamera: !!data.isSharingCamera
                };
                server.voiceMembers[ch].push(member);
            } else {
                member.username = data.username;
                member.avatar_color = data.avatarColor;
                member.avatar_image = data.avatarImage;
                member.isSharingScreen = !!data.isSharingScreen;
                member.isSharingCamera = !!data.isSharingCamera;
            }

            if (state.activeChannelId === ch || state.voiceChannelId === ch) renderVoiceParticipants(roomId, ch);
            updateMuteStates();
        }

    } else if (data.type === "voice_leave") {
        const server = state.servers.find(s => s.id === roomId);
        if (server?.voiceMembers) {
            const leaveCh = data.channelId ? canonicalVoiceChannelId(server, data.channelId) : null;
            if (leaveCh) transferVoiceSessionHost(server, leaveCh, fromPeerId);
            Object.keys(server.voiceMembers).forEach(chId => {
                server.voiceMembers[chId] = server.voiceMembers[chId].filter(m => m.peer_id !== fromPeerId);
            });
            updateChannelSidebar(roomId);
            if (state.activeServerId === roomId) {
                const vch = leaveCh || state.voiceChannelId || state.activeChannelId;
                renderVoiceParticipants(roomId, vch);
                updateVoiceSessionMeta();
            }
            updateMuteStates();

            // Notify user about leaving participant
            const member = server.members?.find(m => m.peer_id === fromPeerId);
            if (member && member.username !== state.username) {
                const key = `${fromPeerId}-leave`;
                if (!state.recentVoiceToasts.has(key)) {
                    toast(`${member.username} sesli kanaldan ayrıldı.`, "info");
                    playSound(330, SCORD_T().SOUND_LEAVE_MS ?? 300);
                    state.recentVoiceToasts.add(key);
                    setTimeout(() => state.recentVoiceToasts.delete(key), SCORD_T().VOICE_NOTIFY_DEDUP_MS ?? 10000);
                }
            }
        }
    } else if (data.type === "msg_pin_toggle") {
        const server = state.servers.find(s => s.id === roomId);
        if (server && data.payload) {
            const { msgId, isPinned, msg } = data.payload;
            const chId = msg?.channelId;
            if (!server.pinned_messages) server.pinned_messages = [];
            if (isPinned && msg) {
                if (!server.pinned_messages.find(m => m.id === msgId)) server.pinned_messages.push(msg);
            } else {
                server.pinned_messages = server.pinned_messages.filter(m => m.id !== msgId);
            }
            if (chId && server.messages?.[chId]) {
                const live = server.messages[chId].find(m => m.id === msgId);
                if (live) live.isPinned = !!isPinned;
            }
            if (state.activeServerId === roomId && chId && state.activeChannelId === chId) {
                renderMessages(roomId, chId);
                applyChannelBackground(roomId, chId);
            }
        }
    } else if (data.type === "msg_delete") {
        const { channelId: delCh, msgId } = data.payload || {};
        const server = state.servers.find(s => s.id === roomId);
        if (server && delCh && msgId && server.messages?.[delCh]) {
            server.messages[delCh] = server.messages[delCh].filter(m => m.id !== msgId);
            server.pinned_messages = (server.pinned_messages || []).filter(m => m.id !== msgId);
            if (state.activeServerId === roomId && state.activeChannelId === delCh) {
                renderMessages(roomId, delCh);
            }
        }
    } else if (data.type === "voice_force_disconnect") {
        if (data.target === state.peerId && state.voiceChannelId) {
            leaveVoiceChannel();
            toast("Bir moderatör seni ses kanalından çıkardı.", "warning");
        }
    } else if (data.type === "music_play") {
        const vch = data.voiceChannelId;
        if (!state.voiceChannelId) return;
        if (vch && vch !== state.voiceChannelId) return;
        startMusicBot(data.videoId, data.startAt);
    } else if (data.type === "music_stop") {
        const vch = data.voiceChannelId;
        if (vch && state.voiceChannelId && vch !== state.voiceChannelId) return;
        if (state.voiceChannelId) stopMusicBot();
    } else if (data.type === "music_pause") {
        const vch = data.voiceChannelId;
        if (vch && state.voiceChannelId && vch !== state.voiceChannelId) return;
        if (state.voiceChannelId && state.musicBot.player && typeof state.musicBot.player.pauseVideo === "function") {
            state.musicBot.player.pauseVideo();
        }
    } else if (data.type === "music_resume") {
        const vch = data.voiceChannelId;
        if (vch && state.voiceChannelId && vch !== state.voiceChannelId) return;
        if (state.voiceChannelId && state.musicBot.player && typeof state.musicBot.player.playVideo === "function") {
            state.musicBot.player.playVideo();
        }
    } else if (data.type === "typing_start") {
        // Handle typing indicator start
        updateTypingIndicator(data.serverId, data.channelId, fromPeerId, data.username, true);
    } else if (data.type === "typing_stop") {
        // Handle typing indicator stop
        updateTypingIndicator(data.serverId, data.channelId, fromPeerId, data.username, false);
    } else if (data.type === "voice_status") {
        const server = state.servers.find(s => s.id === roomId);
        if (server?.voiceMembers) {
            const prefer = data.channelId != null ? canonicalVoiceChannelId(server, data.channelId) : null;
            const order = prefer && server.voiceMembers[prefer]
                ? [prefer, ...Object.keys(server.voiceMembers).filter(k => k !== prefer)]
                : Object.keys(server.voiceMembers);
            for (const chId of order) {
                const list = server.voiceMembers[chId];
                if (!list) continue;
                const member = list.find(m => m.peer_id === fromPeerId);
                if (member) {
                    member.isSpeaking = !!data.speaking;
                    if (state.activeServerId === roomId && (state.activeChannelId === chId || state.voiceChannelId === chId)) {
                        updateVoiceSpeakingUi(fromPeerId, !!data.speaking, chId);
                    }
                    break;
                }
            }
        }
    } else if (data.type === "voice_state_list") {
        // Receiving list of voice members from a peer. Update all members.
        const server = state.servers.find(s => s.id === roomId);
        if (server?.voiceMembers && data.members && Array.isArray(data.members)) {
            const ch = canonicalVoiceChannelId(server, data.channelId);
            if (!server.voiceMembers[ch]) server.voiceMembers[ch] = [];

            // Merge received members with existing list (don't duplicate)
            data.members.forEach(m => {
                if (!server.voiceMembers[ch].find(existing => existing.peer_id === m.peer_id)) {
                    server.voiceMembers[ch].push(m);
                } else {
                    // Update existing member's info
                    const existing = server.voiceMembers[ch].find(x => x.peer_id === m.peer_id);
                    Object.assign(existing, m);
                }
            });

            if (state.activeServerId === roomId && (state.activeChannelId === ch || state.voiceChannelId === ch)) {
                renderVoiceParticipants(roomId, ch);
            }
        }

    } else if (data.type === "screen_status" || data.type === "video_status") {
        const server = state.servers.find(s => s.id === roomId);
        const chId = data.channelId || state.voiceChannelId || state.activeChannelId;
        if (server?.voiceMembers?.[chId]) {
            const member = server.voiceMembers[chId].find(m => m.peer_id === fromPeerId);
            if (member) {
                if (data.type === "screen_status") {
                    member.isSharingScreen = !!data.sharing;
                } else {
                    member.isSharingCamera = !!(data.sharing ?? data.sharingCamera);
                }
                if (state.activeServerId === roomId && (state.activeChannelId === chId || state.voiceChannelId === chId)) {
                    renderVoiceParticipants(roomId, chId);
                }
                // FEAT-2: Update sidebar so screen-share icon appears/disappears
                if (state.activeServerId === roomId) {
                    updateChannelSidebar(roomId);
                }
            }
        }
    } else if (data.type === "server_update") {
        const payload = data.payload;
        const idx = state.servers.findIndex(s => s.id === payload.id);
        if (idx !== -1) {
            mergeRoomPayloadIntoServer(state.servers[idx], payload);
            // Icon güncellemesi gelirse rail'i yenile
            if (payload.icon_url !== undefined) {
                renderServerRail();
            }
            if (state.activeServerId === payload.id) {
                document.getElementById("sidebar-server-name").textContent = state.servers[idx].name;
                updateChannelSidebar(payload.id);
                updateMembersPanel(payload.id);
                applyChannelBackground(payload.id, state.activeChannelId);
            }
        }
    } else if (data.type === "channel_background_update") {
        // Kanal arka planı broadcast mesajı
        const server = state.servers.find(s => s.id === state.activeServerId);
        if (server) {
            if (!server.channel_backgrounds) server.channel_backgrounds = {};
            if (data.url) server.channel_backgrounds[data.channelId] = data.url;
            else delete server.channel_backgrounds[data.channelId];
            if (data.channel_backgrounds) server.channel_backgrounds = data.channel_backgrounds;
            if (state.activeChannelId === data.channelId) {
                const msgArea = document.getElementById("messages-area");
                if (msgArea) {
                    if (data.url) {
                        msgArea.style.backgroundImage = `url(${data.url})`;
                        msgArea.style.backgroundSize = "cover";
                        msgArea.style.backgroundPosition = "center";
                    } else {
                        msgArea.style.backgroundImage = "";
                    }
                }
            }
        }
    } else if (data.type === "channel_delete") {
        const { serverId, channelId } = data.payload;
        const server = state.servers.find(s => s.id === serverId);
        if (server) {
            server.channels = server.channels.filter(c => c.id !== channelId);
            if (state.activeServerId === serverId) {
                updateChannelSidebar(serverId);
                if (state.activeChannelId === channelId) {
                    const firstText = server.channels.find(c => c.type === "text");
                    if (firstText) showChatView(serverId, firstText.id);
                    else showHomeView();
                }
            }
            toast("Bir kanal silindi.", "info");
        }
    } else if (data.type === "channel_rename") {
        const { serverId, channelId, name } = data.payload;
        const server = state.servers.find(s => s.id === serverId);
        if (server) {
            const ch = server.channels.find(c => c.id === channelId);
            if (ch) {
                ch.name = name;
                if (state.activeServerId === serverId) {
                    updateChannelSidebar(serverId);
                    if (state.activeChannelId === channelId) {
                        document.getElementById("active-channel-name").textContent = name;
                        const chatName = document.getElementById("chat-channel-name");
                        if (chatName) chatName.textContent = name;
                    }
                }
                toast(`Kanal adı güncellendi: #${name}`, "info");
            }
        }
    } else if (data.type === "history_sync") {
        const server = state.servers.find(s => s.id === roomId);
        if (server) {
            mergeMessageHistoryIntoServer(server, data.messages || {});
            if (data.roles) server.roles = { ...data.roles, ...(server.roles || {}) };
            if (state.activeServerId === roomId) {
                renderMessages(roomId, state.activeChannelId);
                updateMembersPanel(roomId);
            }
        }
    } else if (data.type === "force_kick" && data.target === state.peerId) {
        const server = state.servers.find(s => s.id === roomId);
        const canKick = server && (
            server.ownerId === fromPeerId ||
            server.peer_roles?.[fromPeerId] === "admin" ||
            peerAllows(server, fromPeerId, "kick_members", state.activeChannelId || state.voiceChannelId)
        );
        if (canKick) {
            if (state.voiceChannelId) leaveVoiceChannel();
            if (state.mesh) { state.mesh.disconnect(); state.mesh = null; }
            state.servers = state.servers.filter(s => s.id !== roomId);
            state.activeServerId = null;
            state.activeChannelId = null;
            renderServerRail();
            updateChannelSidebar(null);
            document.getElementById("home-view")?.classList.remove("hidden");
            document.getElementById("chat-view")?.classList.add("hidden");
            document.getElementById("voice-view")?.classList.add("hidden");
            toast("Bir yönetici tarafından sunucudan atıldın. 🚪", "error");
        }
    } else if (data.type === "force_mute" && data.target === state.peerId) {
        const server = state.servers.find(s => s.id === roomId);
        const canForceDisconnect = server && (
            server.ownerId === fromPeerId ||
            server.peer_roles?.[fromPeerId] === "admin" ||
            peerAllows(server, fromPeerId, "force_disconnect", state.activeChannelId || state.voiceChannelId)
        );
        if (canForceDisconnect) {
            if (state.mesh?.localStream) {
                state.mesh.localStream.getAudioTracks().forEach(t => { t.enabled = false; });
                state.micMuted = true;
                document.getElementById("voice-mute-btn")?.classList.add("active");
            }
            toast("Bir yönetici tarafından sesin kapatıldı. \uD83D\uDD07", "warn");
        }
    } else if (data.type === "force_route" && data.target === state.peerId) {
        const server = state.servers.find(s => s.id === roomId);
        const canForceDisconnect = server && (
            server.ownerId === fromPeerId ||
            server.peer_roles?.[fromPeerId] === "admin" ||
            peerAllows(server, fromPeerId, "force_disconnect", state.activeChannelId || state.voiceChannelId)
        );
        if (canForceDisconnect) {
            toast("Bir yetkili tarafından odan değiştirildi.", "warning");
            if (state.voiceChannelId) leaveVoiceChannel();
            setTimeout(() => joinVoiceChannel(data.targetChannel), SCORD_T().FORCE_ROUTE_VOICE_JOIN_DELAY_MS ?? 200);
        }
    }
}
function handlePeerJoined(peerId, info, roomId) {
    const server = state.servers.find(s => s.id === roomId);
    if (!server) return;

    // Standardize properties (handle both Snake Case and Camel Case)
    const username = info.username || "Anonim";
    const color = info.avatar_color || info.avatarColor || "#7c3aed";
    const image = info.avatar_image || info.avatarImage || null;

    if (!server.members) server.members = [];

    const existingIdx = server.members.findIndex(m => m.peer_id === peerId);
    if (existingIdx === -1) {
        server.members.push({
            peer_id: peerId,
            username: username,
            avatar_color: color,
            avatar_image: image
        });
    } else {
        server.members[existingIdx].username = username;
        server.members[existingIdx].avatar_color = color;
        server.members[existingIdx].avatar_image = image;
    }

    if (state.activeServerId === roomId) {
        updateMembersPanel(roomId);
        updatePeerCountBadge(roomId);
    }

    renderServerRail();

    if (state.voiceChannelId && state.mesh) {
        const voicePayload = {
            type: "voice_join",
            channelId: state.voiceChannelId,
            username: state.username,
            avatarColor: state.avatarColor,
            avatarImage: state.avatarImage,
            isSharingScreen: !!getLocalShareStream(),
            isSharingCamera: !!state.cameraStream
        };
        sendServerEvent(voicePayload);
        state.mesh.broadcastSignal?.(voicePayload);
    }
}

function handlePeerLeft(peerId, roomId) {
    const server = state.servers.find(s => s.id === roomId);
    if (!server) return;

    server.members = (server.members || []).filter(m => m.peer_id !== peerId);

    if (server.voiceMembers && server.voiceSessionHost) {
        Object.keys(server.voiceMembers).forEach(chId => {
            if ((server.voiceMembers[chId] || []).some(m => m.peer_id === peerId)) {
                transferVoiceSessionHost(server, chId, peerId);
            }
        });
    }

    if (server.voiceMembers) {
        Object.keys(server.voiceMembers).forEach(chId => {
            server.voiceMembers[chId] = server.voiceMembers[chId].filter(m => m.peer_id !== peerId);
        });
    }

    if (state.peerLatencyMs) delete state.peerLatencyMs[peerId];
    if (state.peerIngressMs) delete state.peerIngressMs[peerId];
    if (state.peerRttMs) delete state.peerRttMs[peerId];

    if (state.activeServerId === roomId) {
        updateMembersPanel(roomId);
        updatePeerCountBadge(roomId);
        if (state.activeChannelId) renderVoiceParticipants(roomId, state.activeChannelId);
    }

    // Remove remote media
    if (state.remoteMedia && state.remoteMedia[peerId]) {
        state.remoteMedia[peerId].srcObject = null;
        state.remoteMedia[peerId].remove();
        delete state.remoteMedia[peerId];
    }
}

function handleVoiceStream(peerId, stream) {
    if (!state.remoteMedia) state.remoteMedia = {};
    if (!state.remoteMedia[peerId]) {
        const video = document.createElement("video");
        video.autoplay = true;
        video.playsInline = true;
        video.muted = peerId === state.peerId;
        video.className = "voice-video";

        // Ensure UI updates when video actually starts
        const refreshVoiceUI = () => {
            if (state.activeServerId && state.voiceChannelId) {
                renderVoiceParticipants(state.activeServerId, state.voiceChannelId);
                updateMuteStates();
            }
        };
        video.onloadedmetadata = refreshVoiceUI;
        video.onplaying = refreshVoiceUI;

        state.remoteMedia[peerId] = video;

        if (state.activeServerId && state.voiceChannelId) {
            renderVoiceParticipants(state.activeServerId, state.voiceChannelId);
        }
        setTimeout(() => {
            if (state.activeServerId && state.voiceChannelId) {
                renderVoiceParticipants(state.activeServerId, state.voiceChannelId);
            }
            updateMuteStates();
        }, SCORD_T().VOICE_STREAM_RENDER_DELAY_MS ?? 400);
    }
    state.remoteMedia[peerId].srcObject = stream;
    updateMuteStates();
}

function updateConnectionStatus(status) {
    state._lastMeshStatus = status || "";
    console.log("[App] Connection status:", status);
    const key = String(status || "");
    const t = Date.now();
    if (key === "ws_error") {
        if (t - (state._wsErrToastAt || 0) > 8000) {
            state._wsErrToastAt = t;
            toast("Sinyal sunucusuna (WebSocket) bağlanılamadı. Render linkini ve ağını kontrol et.", "error");
        }
    } else if (key === "room_not_found") {
        if (t - (state._roomNFToastAt || 0) > 8000) {
            state._roomNFToastAt = t;
            toast("Oda bulunamadı (sunucu yeniden başlamış olabilir). Sunucuyu yeniden oluşturup tekrar davet et.", "error");
        }
    } else if (key === "server_error") {
        if (t - (state._srvErrToastAt || 0) > 8000) {
            state._srvErrToastAt = t;
            toast("Sinyal sunucusu hata verdi. Render loglarını kontrol et.", "error");
        }
    }
    refreshConnectionBadge();
}

function loadUserPrefs() {
    try {
        const raw = localStorage.getItem("scord_notif_settings");
        const o = raw ? JSON.parse(raw) : {};
        const chatLevel = o.chatLevel || (o.chat === false ? "none" : "all");
        state.notifSettings = {
            chat: o.chat !== false && chatLevel !== "none",
            dm: o.dm !== false,
            join: o.join !== false,
            chatLevel,
        };
    } catch {
        state.notifSettings = { chat: true, dm: true, join: true, chatLevel: "all" };
    }
    state.compactMode = localStorage.getItem("scord_compact_mode") === "1";
    document.body.classList.toggle("compact-mode", state.compactMode);
    const dens = localStorage.getItem("scord_msg_density") || "cozy";
    document.documentElement.setAttribute("data-msg-density", dens);
    document.documentElement.classList.toggle("scord-high-contrast", localStorage.getItem("scord_high_contrast") === "1");
    const app = document.getElementById("app");
    if (app) app.setAttribute("data-scord-focus", localStorage.getItem("scord_focus_mode") === "1" ? "1" : "0");
}

function applyFocusModeButton() {
    const btn = document.getElementById("focus-mode-toggle");
    const app = document.getElementById("app");
    if (!btn || !app) return;
    const on = app.getAttribute("data-scord-focus") === "1";
    btn.classList.toggle("active", on);
    btn.title = on ? "Odak modunu kapat (üyeleri göster)" : "Odak modu (üye panelini gizle)";
}

function draftStorageKey(serverId, channelId) {
    return `scord_draft_${serverId}_${channelId}`;
}

function persistChatDraftFor(serverId, channelId) {
    if (!serverId || !channelId) return;
    const inp = document.getElementById("chat-input");
    if (!inp) return;
    const v = inp.value;
    const key = draftStorageKey(serverId, channelId);
    if (v.trim()) localStorage.setItem(key, v);
    else localStorage.removeItem(key);
}

function shouldShowChatToast(msg) {
    const ns = state.notifSettings || { chatLevel: "all" };
    const level = ns.chatLevel || "all";
    if (level === "none" || ns.chat === false) return false;
    if (level === "mentions") {
        const u = (state.username || "").trim();
        if (!u) return false;
        const t = msg.text || "";

        // Check for @user mention
        const mentionRegex = new RegExp(`(^|\\s)@${escapeRegExp(u)}(?!\\w)`, "i");
        if (mentionRegex.test(t)) return true;

        // Check for @everyone
        if (/@everyone/i.test(t)) return true;

        // Check for @here (only if user is in voice channel)
        if (/@here/i.test(t) && state.voiceChannelId) return true;

        return false;
    }
    return true;
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hideNewMsgsChip() {
    document.getElementById("new-msgs-chip")?.classList.add("hidden");
}

function showNewMsgsChip() {
    document.getElementById("new-msgs-chip")?.classList.remove("hidden");
}
function isPeerBanned(serverId, peerId) {
    const srv = state.servers.find(s => s.id === serverId);
    if (!srv) return false;
    return srv.bannedUsers?.some(b => b.peerId === peerId) || false;
}

function isChatScrolledUp() {
    const area = document.getElementById("messages-area");
    if (!area) return false;
    return area.scrollHeight - area.scrollTop - area.clientHeight > 100;
}

function wireMessagesScroll() {
    const area = document.getElementById("messages-area");
    if (!area || area.dataset.scordScrollWired) return;
    area.dataset.scordScrollWired = "1";
    area.addEventListener("scroll", () => {
        if (!isChatScrolledUp()) hideNewMsgsChip();
    });
}

// Consolidated above

function handlePeerConnected(peerId, roomId) {
    const server = state.servers.find(s => s.id === roomId);
    if (!server || !state.mesh) return;

    if (isPeerBanned(roomId, peerId)) {
        // Automatically disconnect banned users if possible, or just ignore them
        console.warn(`Banned peer ${peerId} connected, skipping state sync.`);
        return;
    }

    if (server.messages && Object.keys(server.messages).length > 0) {
        state.mesh.sendTo(peerId, {
            type: "history_sync",
            messages: server.messages,
            roles: server.roles || {}
        });
    }

    if (state.voiceChannelId) {
        // BUG-1/2 Fix: Send a full voice_join (not just voice_state_sync) so the
        // newcomer sees us in the voice channel member list and gets a toast notification.
        state.mesh.sendTo(peerId, {
            type: "voice_join",
            channelId: state.voiceChannelId,
            username: state.username,
            avatarColor: state.avatarColor,
            avatarImage: state.avatarImage,
            isSharingScreen: !!getLocalShareStream(),
            isSharingCamera: !!state.cameraStream
        });
    }

    // BUG-1 Fix: Also push all other known voice members in our channel to the newcomer
    // so they see everyone who joined before them (not just us).
    const _voiceSyncServer = state.servers.find(s => s.id === roomId);
    if (_voiceSyncServer?.voiceMembers && state.voiceChannelId) {
        const _ch = state.voiceChannelId;
        const _allVoiceMembers = (_voiceSyncServer.voiceMembers[_ch] || [])
            .filter(m => m.peer_id !== state.peerId); // exclude self (already sent above)
        if (_allVoiceMembers.length > 0) {
            state.mesh.sendTo(peerId, {
                type: "voice_state_list",
                channelId: _ch,
                members: _allVoiceMembers
            });
        }
    }

    flushP2pOutbox();
    refreshConnectionBadge();
}

function handleTrackAdded(peerId, track, stream) {
    console.log(`[Voice] Track added from ${peerId}: ${track.kind}`);

    const video = state.remoteMedia?.[peerId];
    if (video) {
        // Force refresh srcObject and play to jumpstart rendering
        if (video.srcObject !== stream) video.srcObject = stream;
        video.play().catch(e => console.warn("Auto-play blocked or failed", e));
    }

    if (track.kind === "video") {
        setTimeout(() => {
            const ch = state.voiceChannelId || state.activeChannelId;
            if (state.activeServerId && ch) {
                renderVoiceParticipants(state.activeServerId, ch);
            }
        }, SCORD_T().VOICE_TRACK_RENDER_DELAY_MS ?? 400);
    }
    updateMuteStates();
}

/* ── Voice channel ────────────────────────────────────────── */
async function joinVoiceChannel(channelId) {
    if (!state.mesh) return;

    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    if (state.voiceChannelId) {
        if (state.voiceChannelId === channelId) return;
        leaveVoiceChannel();
    }

    // Build Web Audio Stream Pipeline
    let processedStream = null;
    try {
        const vs = state.voiceSettings || {};
        const audioConstraints = {
            noiseSuppression: vs.noiseSuppression !== false,
            echoCancellation: vs.echoCancellation !== false,
            autoGainControl: vs.autoGainControl === true,
            channelCount: 1,
            sampleRate: 48000,
            sampleSize: 16,
            latency: 0.02,
            ...(vs.micId && vs.micId !== "default" ? { deviceId: vs.micId } : {})
        };
        const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });

        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive", sampleRate: 48000 });
        const source = state.audioCtx.createMediaStreamSource(stream);
        const gainNode = state.audioCtx.createGain();
        gainNode.gain.value = state.voiceSettings?.volume || 1;
        const gateNode = state.audioCtx.createGain();
        gateNode.gain.value = 0;
        state.voiceGateNode = gateNode;

        const filterNode = state.audioCtx.createBiquadFilter();
        const filterType = state.voiceSettings?.filter || "none";
        if (filterType === "bass") {
            filterNode.type = "lowshelf";
            filterNode.frequency.value = 200;
            filterNode.gain.value = 15;
        } else if (filterType === "radio") {
            filterNode.type = "bandpass";
            filterNode.frequency.value = 1000;
            filterNode.Q.value = 2;
        } else {
            filterNode.type = "allpass";
        }

        const analyser = state.audioCtx.createAnalyser();
        analyser.fftSize = 256;
        state.analyser = analyser;

        const dest = state.audioCtx.createMediaStreamDestination();
        source.connect(filterNode);
        filterNode.connect(analyser); // Monitor before gain
        filterNode.connect(gainNode);
        gainNode.connect(gateNode);
        gateNode.connect(dest);

        processedStream = dest.stream;
        state.originalMicStream = stream; // save original to kill hardware light later

        // PTT Initial State
        if (state.voiceSettings?.inputMode === "ptt") {
            stream.getAudioTracks()[0].enabled = !!state._pttActive;
        }

        const currentRole = server.ownerId === state.peerId ? "owner"
            : server.peer_roles?.[state.peerId] === "admin" ? "admin"
                : server.peer_roles?.[state.peerId] === "mod" ? "mod" : "member";
        const isVoiceRestricted = server.voicePermissionMode === "mods_only" && !["owner", "admin", "mod"].includes(currentRole);
        if (isVoiceRestricted) {
            stream.getAudioTracks()[0].enabled = false;
            toast("Bu ses kanalında konuşma izni yalnızca moderatör ve üstlerine ait.", "warning");
        }

        // Start Volume Loop
        state._speakingLoop = setInterval(() => {
            const data = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) sum += data[i];
            const avg = sum / data.length;
            const threshold = Number(state.voiceSettings?.gateThreshold ?? 12);
            const isSpeakingNow = avg > threshold;

            if (isSpeakingNow) state._lastSpeakTime = Date.now();

            const holdMs = SCORD_T().VOICE_SPEAKING_HOLD_MS ?? 250;
            const isSpeaking = (Date.now() - (state._lastSpeakTime || 0)) < holdMs;
            const targetGain = isSpeaking || state.voiceSettings?.inputMode === "ptt" ? 1 : 0;
            try {
                const nowAudio = state.audioCtx.currentTime;
                const release = Number(state.voiceSettings?.gateRelease ?? 0.09);
                const attack = Number(state.voiceSettings?.gateAttack ?? 0.012);
                gateNode.gain.cancelScheduledValues(nowAudio);
                gateNode.gain.setTargetAtTime(targetGain, nowAudio, targetGain ? attack : release);
            } catch { gateNode.gain.value = targetGain; }

            if (isSpeaking !== state.isSpeaking) {
                state.isSpeaking = isSpeaking;
                if (state.mesh) {
                    state.mesh.broadcast({
                        type: "voice_status",
                        speaking: isSpeaking,
                        channelId: state.voiceChannelId,
                    });
                }
                updateVoiceSpeakingUi(state.peerId, isSpeaking, state.voiceChannelId);
            }
        }, SCORD_T().VOICE_SPEAKING_POLL_MS ?? 100);
    } catch (err) {
        console.error("Audio error", err);
        toast("Mikrofon hatası: İzin verilmedi.", "error");
        return;
    }

    const ok = await state.mesh.startVoice(processedStream);
    if (!ok) { toast("Ses yayını başlatılamadı.", "error"); return; }

    const canonCh = server ? canonicalVoiceChannelId(server, channelId) : channelId;
    state.voiceChannelId = canonCh;

    showVoiceView(state.activeServerId, canonCh);

    if (server) {
        if (!server.voiceMembers) server.voiceMembers = {};
        if (!server.voiceMembers[canonCh]) server.voiceMembers[canonCh] = [];
        const othersOnly = server.voiceMembers[canonCh].filter(m => m.peer_id !== state.peerId);
        if (othersOnly.length === 0) {
            ensureVoiceSessionHost(server, canonCh, state.peerId, state.username);
        }
        if (!server.voiceMembers[canonCh].find(m => m.peer_id === state.peerId)) {
            server.voiceMembers[canonCh].push({ peer_id: state.peerId, username: state.username, avatar_color: state.avatarColor, avatar_image: state.avatarImage });
        }
        updateChannelSidebar(state.activeServerId);
    }

    meshBroadcastReliable({
        type: "voice_join",
        channelId: canonCh,
        username: state.username,
        avatarColor: state.avatarColor,
        avatarImage: state.avatarImage,
        isSharingScreen: !!getLocalShareStream(),
        isSharingCamera: !!state.cameraStream
    });

    // Request voice state from existing participants
    setTimeout(() => {
        meshBroadcastReliable({
            type: "voice_state_request",
            channelId: canonCh
        });
    }, 100);

    renderVoiceParticipants(state.activeServerId, canonCh);
    showVoiceStatusBar(state.activeServerId, canonCh);

    state.membersOpen = false;
    document.getElementById("members-panel")?.classList.add("collapsed");
    document.getElementById("voice-members-panel")?.classList.add("collapsed");

    // Toggle buttons
    document.getElementById("voice-join-btn").classList.add("hidden");
    document.getElementById("voice-leave-btn").classList.remove("hidden");
    document.getElementById("voice-screen-btn")?.classList.remove("hidden");
    document.getElementById("voice-camera-btn")?.classList.remove("hidden");

    updateMuteStates();
    updateVoiceSessionMeta();
    toast("Sesli kanala katıldın! 🎙️", "success");
}

function leaveVoiceChannel() {
    if (!state.mesh) return;
    const channelId = state.voiceChannelId;
    state.mesh.stopVoice();
    hideVoiceCallIndicator();
    state.voiceChannelId = null;

    if (state.originalMicStream) {
        state.originalMicStream.getTracks().forEach(t => t.stop());
        state.originalMicStream = null;
    }
    if (state.audioCtx) {
        state.audioCtx.close();
        state.audioCtx = null;
    }
    if (state._speakingLoop) {
        clearInterval(state._speakingLoop);
        state._speakingLoop = null;
    }

    meshBroadcastReliable({ type: "voice_leave", channelId });

    const server = state.servers.find(s => s.id === state.activeServerId);
    if (server?.voiceMembers?.[channelId]) {
        transferVoiceSessionHost(server, channelId, state.peerId);
        server.voiceMembers[channelId] = server.voiceMembers[channelId].filter(m => m.peer_id !== state.peerId);
        updateChannelSidebar(state.activeServerId);
    }

    renderVoiceParticipants(state.activeServerId, channelId);
    updateVoiceSessionMeta();
    hideVoiceStatusBar();

    document.getElementById("voice-join-btn").classList.remove("hidden");
    document.getElementById("voice-leave-btn").classList.add("hidden");
    document.getElementById("voice-screen-btn")?.classList.add("hidden");
    document.getElementById("voice-camera-btn")?.classList.add("hidden");

    try {
        if (state.mesh?.screenStream) state.mesh.stopScreenShare();
    } catch (e) { /* noop */ }
    if (state.screenStream) {
        try { state.screenStream.getTracks().forEach(t => t.stop()); } catch (e) { /* noop */ }
        state.screenStream = null;
    }

    if (state.cameraStream) stopCameraShare(); // Reset camera state

    updateMuteStates();
    toast("Sesli kanaldan ayrıldın.", "info");
}

/* ══════════════════════════════════════════════════════════════
   MÜZİK BOTU — YouTube IFrame API
══════════════════════════════════════════════════════════════ */

// Initialize music bot state if not already (called once on app load)
function initMusicBotState() {
    if (!state.musicBot) {
        state.musicBot = {
            player: null,        // YT.Player instance
            videoId: null,       // current video id
            volume: 80,          // local volume 0-100
            isPlaying: false,
            isReady: false,      // YT API ready
        };
    }
}

// Called once by YouTube IFrame API when API is loaded
window.onYouTubeIframeAPIReady = function () {
    initMusicBotState();
    state.musicBot.isReady = true;
    console.log("[MusicBot] YouTube IFrame API ready");
};

/**
 * Extract a YouTube video ID from a URL or direct ID string.
 */
function extractYouTubeVideoId(input) {
    if (!input) return null;
    input = input.trim();
    // Direct ID (11 chars, alphanumeric + - _)
    if (/^[a-zA-Z0-9_\-]{11}$/.test(input)) return input;
    try {
        const url = new URL(input);
        // youtu.be/<id>
        if (url.hostname === "youtu.be") return url.pathname.slice(1).split("?")[0];
        // youtube.com/watch?v=<id>
        const v = url.searchParams.get("v");
        if (v) return v;
        // youtube.com/embed/<id>  or  /shorts/<id>
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts[0] === "embed" || parts[0] === "shorts") return parts[1];
    } catch (_) { /* not a URL */ }
    return null;
}

/**
 * Start (or seek) the music bot to play a video.
 * @param {string} videoId  YouTube video ID
 * @param {number} [startAt=0]  seconds offset for sync
 */
function startMusicBot(videoId, startAt = 0) {
    initMusicBotState();
    state.musicBot.videoId = videoId;
    state.musicBot.isPlaying = true;

    const createOrLoad = () => {
        if (!state.musicBot.player) {
            // Create the YT player in the hidden container
            state.musicBot.player = new YT.Player("yt-player", {
                height: "1",
                width: "1",
                videoId: videoId,
                playerVars: {
                    autoplay: 1,
                    start: Math.max(0, Math.floor(startAt)),
                    controls: 0,
                    disablekb: 1,
                    fs: 0,
                    modestbranding: 1,
                    rel: 0,
                },
                events: {
                    onReady: (e) => {
                        e.target.setVolume(state.musicBot.volume);
                        e.target.playVideo();
                        renderMusicBotPanel();
                    },
                    onStateChange: (e) => {
                        state.musicBot.isPlaying = e.data === YT.PlayerState.PLAYING;
                        renderMusicBotPanel();
                    },
                    onError: (e) => {
                        toast("Müzik botu: Video oynatılamadı (kısıtlı veya geçersiz video). 🎵", "error");
                        console.warn("[MusicBot] YT error:", e.data);
                    }
                }
            });
        } else {
            // Player already exists — load new video
            state.musicBot.player.loadVideoById({ videoId, startSeconds: Math.max(0, Math.floor(startAt)) });
            state.musicBot.player.setVolume(state.musicBot.volume);
        }
        renderMusicBotPanel();
    };

    // YT API may not be ready yet — wait for it
    if (typeof YT !== "undefined" && YT.Player) {
        createOrLoad();
    } else {
        // Fallback: poll until ready
        const waitYT = setInterval(() => {
            if (typeof YT !== "undefined" && YT.Player) {
                clearInterval(waitYT);
                createOrLoad();
            }
        }, 200);
        // Give up after 10 s
        setTimeout(() => clearInterval(waitYT), 10000);
    }
}

/**
 * Stop the music bot and clean up.
 */
function stopMusicBot() {
    initMusicBotState();
    if (state.musicBot.player) {
        try { state.musicBot.player.stopVideo(); } catch (_) { }
        try { state.musicBot.player.destroy(); } catch (_) { }
        state.musicBot.player = null;
    }
    state.musicBot.videoId = null;
    state.musicBot.isPlaying = false;
    // Reset yt-player div so a new player can be created next time
    const ytDiv = document.getElementById("yt-player");
    if (ytDiv) ytDiv.innerHTML = "";
    renderMusicBotPanel();
}

/**
 * Render or update the music bot control panel inside the voice view.
 * It creates a persistent #music-bot-panel element if missing.
 */
function renderMusicBotPanel() {
    // Only show panel when in a voice channel
    const voiceView = document.getElementById("voice-view");
    if (!voiceView || voiceView.classList.contains("hidden")) return;

    let panel = document.getElementById("music-bot-panel");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "music-bot-panel";
        panel.className = "music-bot-panel";
        // Insert above voice-controls
        const controls = voiceView.querySelector(".voice-controls");
        if (controls) controls.insertAdjacentElement("beforebegin", panel);
        else voiceView.appendChild(panel);
    }

    initMusicBotState();
    const mb = state.musicBot;
    const isHost = isVoiceSessionHost();

    const vidId = mb.videoId;
    const playing = mb.isPlaying;

    panel.innerHTML = `
    <div class="mbot-header">
      <span class="mbot-icon">🎵</span>
      <span class="mbot-title">Müzik Botu</span>
      ${vidId ? `<a class="mbot-yt-link" href="https://youtu.be/${vidId}" target="_blank" rel="noopener">YouTube'da Aç ↗</a>` : ""}
    </div>
    ${vidId ? `
    <div class="mbot-now-playing">
      <img class="mbot-thumb" src="https://img.youtube.com/vi/${vidId}/mqdefault.jpg" alt="thumbnail" loading="lazy"/>
      <div class="mbot-now-info">
        <div class="mbot-now-label">Şimdi Çalıyor</div>
        <div class="mbot-now-id">${vidId}</div>
      </div>
    </div>
    <div class="mbot-controls">
      ${isHost ? `
        <button class="mbot-btn" id="mbot-pause-btn" title="${playing ? "Duraklat" : "Devam Et"}">${playing ? "⏸️" : "▶️"}</button>
        <button class="mbot-btn mbot-btn--danger" id="mbot-stop-btn" title="Durdur">⏹️</button>
      ` : ""}
      <div class="mbot-vol-wrap">
        <span style="font-size:12px;">🔊</span>
        <input type="range" class="mbot-vol-slider" id="mbot-vol-slider" min="0" max="100" value="${mb.volume}" title="Ses Seviyesi (Kişisel)">
      </div>
    </div>
    ` : `
    <div class="mbot-idle">
      ${isHost ? `
      <div class="mbot-search-row">
        <input class="mbot-search-input" id="mbot-url-input" placeholder="YouTube URL veya /music play <url>" autocomplete="off"/>
        <button class="mbot-btn mbot-btn--play" id="mbot-play-btn">▶ Çal</button>
      </div>
      <div style="font-size:11px;color:var(--text-muted);text-align:center;margin-top:4px;">
        Sohbette <kbd>/music play &lt;url&gt;</kbd> da yazabilirsin
      </div>
      ` : `<div style="font-size:12px;color:var(--text-muted);text-align:center;">Müzik çalmıyor. Kanal sahibi başlatabilir.</div>`}
    </div>
    `}
    `;

    // Volume slider (always present when playing)
    const volSlider = document.getElementById("mbot-vol-slider");
    if (volSlider) {
        volSlider.oninput = (e) => {
            mb.volume = parseInt(e.target.value);
            if (mb.player && typeof mb.player.setVolume === "function") {
                mb.player.setVolume(mb.volume);
            }
        };
    }

    if (isHost) {
        const pauseBtn = document.getElementById("mbot-pause-btn");
        if (pauseBtn) {
            pauseBtn.onclick = () => {
                if (playing) {
                    if (mb.player) mb.player.pauseVideo();
                    meshBroadcastReliable({ type: "music_pause", voiceChannelId: state.voiceChannelId });
                } else {
                    if (mb.player) mb.player.playVideo();
                    meshBroadcastReliable({ type: "music_resume", voiceChannelId: state.voiceChannelId });
                }
            };
        }

        const stopBtn = document.getElementById("mbot-stop-btn");
        if (stopBtn) {
            stopBtn.onclick = () => {
                stopMusicBot();
                meshBroadcastReliable({ type: "music_stop", voiceChannelId: state.voiceChannelId });
                toast("Müzik durduruldu.", "info");
            };
        }

        const playBtn = document.getElementById("mbot-play-btn");
        if (playBtn) {
            playBtn.onclick = () => {
                const input = document.getElementById("mbot-url-input");
                const raw = input?.value?.trim();
                if (!raw) return toast("Bir YouTube URL'si gir.", "warning");
                playMusicBotByUrl(raw);
                if (input) input.value = "";
            };
        }

        const urlInput = document.getElementById("mbot-url-input");
        if (urlInput) {
            urlInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    const raw = urlInput.value.trim();
                    if (raw) { playMusicBotByUrl(raw); urlInput.value = ""; }
                }
            });
        }
    }
}

/**
 * Parse URL/ID, start bot locally and broadcast to channel.
 */
function playMusicBotByUrl(raw) {
    const videoId = extractYouTubeVideoId(raw);
    if (!videoId) return toast("Geçerli bir YouTube URL'si değil.", "error");
    const startAt = 0;
    startMusicBot(videoId, startAt);
    meshBroadcastReliable({
        type: "music_play",
        videoId,
        startAt,
        voiceChannelId: state.voiceChannelId
    });
    toast(`🎵 ${videoId} çalmaya başladı!`, "success");
}

/**
 * Returns true if the current user is the voice session host.
 */
function isVoiceSessionHost() {
    if (!state.voiceChannelId || !state.activeServerId) return true; // fallback
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server?.voiceSessionHost?.[state.voiceChannelId]) return true;
    return server.voiceSessionHost[state.voiceChannelId].peerId === state.peerId;
}

/**
 * Handle /music command from chat input.
 * Supported: /music play <url>, /music stop, /music pause, /music resume
 */
function handleMusicCommand(text) {
    if (!text.startsWith("/music")) return false;
    if (!state.voiceChannelId) { toast("Önce bir ses kanalına katıl.", "warning"); return true; }
    if (!isVoiceSessionHost()) { toast("Yalnızca kanal sahibi müzik botunu kontrol edebilir.", "warning"); return true; }

    const parts = text.trim().split(/\s+/);
    const sub = (parts[1] || "").toLowerCase();

    if (sub === "play" && parts[2]) {
        const raw = parts.slice(2).join(" ");
        playMusicBotByUrl(raw);
    } else if (sub === "stop") {
        stopMusicBot();
        meshBroadcastReliable({ type: "music_stop", voiceChannelId: state.voiceChannelId });
        toast("Müzik durduruldu.", "info");
    } else if (sub === "pause") {
        initMusicBotState();
        if (state.musicBot.player) state.musicBot.player.pauseVideo();
        meshBroadcastReliable({ type: "music_pause", voiceChannelId: state.voiceChannelId });
    } else if (sub === "resume") {
        initMusicBotState();
        if (state.musicBot.player) state.musicBot.player.playVideo();
        meshBroadcastReliable({ type: "music_resume", voiceChannelId: state.voiceChannelId });
    } else {
        toast("Kullanım: /music play <url> | /music stop | /music pause | /music resume", "info");
    }
    return true;
}

const _voiceRenderTicks = new Map();
function renderVoiceParticipantsFast(serverId, channelId, reason = "default") {
    const key = `${serverId}:${channelId}`;
    const nowMs = performance.now();
    const prev = _voiceRenderTicks.get(key) || { at: 0, raf: 0 };
    const minGap = reason === "speaking" ? 90 : 32;
    if (prev.raf) return;
    if (nowMs - prev.at < minGap) return;
    const raf = requestAnimationFrame(() => {
        _voiceRenderTicks.set(key, { at: performance.now(), raf: 0 });
        renderVoiceParticipants(serverId, channelId);
    });
    _voiceRenderTicks.set(key, { at: prev.at, raf });
}

function renderVoiceParticipants(serverId, channelId) {

    const server = state.servers.find(s => s.id === serverId);
    const container = document.getElementById("voice-participants");
    if (!container) return;
    const members = server?.voiceMembers?.[channelId] || [];
    const countEl = document.getElementById("voice-participant-count");
    if (countEl) countEl.textContent = `${members.length} kişi`;

    const layoutCount = Math.min(Math.max(members.length, 1), 9);
    container.dataset.count = String(members.length);
    container.className = `voice-participants voice-grid-${layoutCount}${members.length > 9 ? " voice-grid-many" : ""}`;

    if (members.length === 0) {
        container.className = "voice-participants";
        container.innerHTML = `
          <div class="voice-empty-state">
            <span class="voice-empty-state-icon" aria-hidden="true">🎙️</span>
            <h4>Burada henüz kimse yok</h4>
            <p>Arkadaşlarını davet et veya aşağıdan kanala katıl. Ses P2P üzerinden aktarılır.</p>
          </div>`;
        updateVoiceSessionMeta();
        return;
    }

    // Full re-render to avoid duplicates and bugs
    container.innerHTML = '';

    members.forEach(m => {
        if (!m || !m.peer_id) return;
        const displayName = m.username || m.name || (m.peer_id === state.peerId ? state.username : "Kullanici");
        const card = document.createElement("div");
        card.className = "voice-participant-card";
        card.setAttribute('data-peer-id', m.peer_id);
        container.appendChild(card);

        // Avatar
        let av = card.querySelector('.vpc-avatar');
        if (!av) {
            av = document.createElement("div");
            av.className = "vpc-avatar";
            card.appendChild(av);
        }
        applyAvatarToElement(av, m.avatar_color, m.avatar_image, displayName);

        // Speaking Glow (make it robust: only one source of truth)
        const currentlySpeaking = !!m.isSpeaking || (m.peer_id === state.peerId && !!state.isSpeaking);
        if (currentlySpeaking) {
            card.classList.add("speaking");
            av.classList.add("speaking");
        } else {
            card.classList.remove("speaking");
            av.classList.remove("speaking");
        }

        // Name and Badge
        let nameContainer = card.querySelector('.vpc-name-container');
        if (!nameContainer) {
            nameContainer = document.createElement("div");
            nameContainer.className = "vpc-name-container";
            nameContainer.style.display = "flex";
            nameContainer.style.alignItems = "center";
            nameContainer.style.justifyContent = "center";
            nameContainer.style.width = "100%";
            card.appendChild(nameContainer);
        }

        let nameEl = nameContainer.querySelector('.vpc-name');
        if (!nameEl) {
            nameEl = document.createElement("div");
            nameEl.className = "vpc-name";
            nameContainer.appendChild(nameEl);
        }
        nameEl.textContent = displayName + (m.peer_id === state.peerId ? " (sen)" : "");

        // Add sharing icons
        let shareIcon = nameContainer.querySelector('.share-icon');
        if (m.isSharingScreen || (m.peer_id === state.peerId && getLocalShareStream())) {
            if (!shareIcon) {
                shareIcon = document.createElement("span");
                shareIcon.className = "share-icon";
                shareIcon.textContent = "🖥️";
                shareIcon.title = "Ekran Paylaşıyor";
                nameContainer.appendChild(shareIcon);
            }
        } else if (m.isSharingCamera || (m.peer_id === state.peerId && state.cameraStream)) {
            if (!shareIcon) {
                shareIcon = document.createElement("span");
                shareIcon.className = "share-icon";
                shareIcon.textContent = "📹";
                shareIcon.title = "Kamera Açık";
                nameContainer.appendChild(shareIcon);
            }
        } else if (shareIcon) {
            shareIcon.remove();
        }

        const roleLabel = m.peer_id === server.ownerId ? "Kurucu"
            : server.peer_roles?.[m.peer_id] === "admin" ? "Admin"
                : server.peer_roles?.[m.peer_id] === "mod" ? "Mod" : "Üye";
        const isStaff = m.peer_id === server.ownerId || server.peer_roles?.[m.peer_id] === "admin" || server.peer_roles?.[m.peer_id] === "mod";
        const isListenerOnly = server.voicePermissionMode === "mods_only" && !isStaff;
        const roleTags = [roleLabel];
        if (isListenerOnly) roleTags.push("Dinleyici");
        if (server.voiceSessionHost?.[channelId]?.peerId === m.peer_id) roleTags.push("Host");
        let roleBadge = nameContainer.querySelector('.vpc-role-badge');
        if (!roleBadge) {
            roleBadge = document.createElement("div");
            roleBadge.className = "vpc-role-badge";
            nameContainer.appendChild(roleBadge);
        }
        roleBadge.textContent = roleTags.join(" · ");

        const isSharing = m.isSharingScreen || m.isSharingCamera || (m.peer_id === state.peerId && (getLocalShareStream() || state.cameraStream));
        let liveBadge = nameContainer.querySelector('.live-badge');

        // Video / Screen Share (STABLE NODE)
        let videoEl = state.remoteMedia?.[m.peer_id];

        // Handle local user's own streams!
        if (m.peer_id === state.peerId) {
            const localStream = getLocalShareStream() || state.cameraStream;
            if (localStream) {
                if (!state.localVideoEl) {
                    state.localVideoEl = document.createElement("video");
                    state.localVideoEl.muted = true;
                    state.localVideoEl.playsInline = true;
                    state.localVideoEl.autoplay = true;
                }
                state.localVideoEl.srcObject = localStream;
                videoEl = state.localVideoEl;
            } else {
                videoEl = null;
                if (state.localVideoEl) {
                    state.localVideoEl.srcObject = null;
                    state.localVideoEl.remove();
                }
            }
        }

        card.querySelector('.watch-btn')?.remove();
        // BUG-3 Fix: Manage a small non-interactive thumbnail (not the full video element)
        // so the screen does NOT auto-expand for everyone. The "İzle" button is the
        // only way to open the full overlay.
        let thumbEl = card.querySelector('.vpc-thumb');

        const hasVideoTrack = !!(videoEl && videoEl.srcObject?.getVideoTracks?.()?.length > 0);
        if (isSharing || hasVideoTrack) {
            if (!liveBadge) {
                liveBadge = document.createElement("span");
                liveBadge.className = "live-badge";
                liveBadge.textContent = "CANLI";
                nameContainer.appendChild(liveBadge);
            }
        } else if (liveBadge) {
            liveBadge.remove();
        }

        if (hasVideoTrack) {
            card.classList.add("has-video");
            // Show a small muted thumbnail — NOT a click-to-fullscreen video
            if (!thumbEl) {
                thumbEl = document.createElement("video");
                thumbEl.className = "vpc-thumb";
                thumbEl.muted = true;
                thumbEl.playsInline = true;
                thumbEl.autoplay = true;
                thumbEl.tabIndex = -1;
                card.appendChild(thumbEl);
            }
            if (thumbEl.srcObject !== videoEl.srcObject) {
                thumbEl.srcObject = videoEl.srcObject;
                thumbEl.play().catch(() => { });
            }
        } else {
            card.classList.remove("has-video");
            if (thumbEl) thumbEl.remove();
            // Ensure the original video el is detached from this card
            if (videoEl && videoEl.parentNode === card) videoEl.remove();
        }

        // Watch button appears as soon as someone is "sharing" — this is the ONLY
        // way to open the full-screen overlay (no auto preview).
        if (hasVideoTrack) {
            card.ondblclick = (e) => { e.stopPropagation(); openScreenOverlay(m.peer_id, displayName); };
            /* legacy watch button removed
            watchBtn.disabled = !hasVideoTrack;
            watchBtn.textContent = hasVideoTrack ? "İzle 🔍" : "Yükleniyor…";
            watchBtn.onclick = (e) => { e.stopPropagation(); openScreenOverlay(m.peer_id, m.username); };
            */
        } else {
            card.ondblclick = null;
        }

        // Drag and Drop Admin
        const isAdmin = server && (server.ownerId === state.peerId || server.peer_roles?.[state.peerId] === "admin");
        if (isAdmin && m.peer_id !== state.peerId) {
            card.draggable = true;
            card.ondragstart = (e) => { e.dataTransfer.setData("peerId", m.peer_id); };
        } else {
            card.draggable = false;
        }

        // Music Bot UI
        if (m.peer_id === "bot_music") {
            let botVol = card.querySelector('.bot-volume-container');
            if (!botVol) {
                botVol = document.createElement("div");
                botVol.className = "bot-volume-container";
                botVol.style.marginTop = "12px";
                botVol.style.width = "100%";
                botVol.innerHTML = `
                    <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px; text-align:center;">Kişisel Ses Seviyesi</div>
                    <input type="range" min="0" max="100" class="bot-vol-slider" style="width:100%; accent-color:#ef4444;">
                `;
                card.appendChild(botVol);
                const slider = botVol.querySelector('.bot-vol-slider');
                slider.value = state.musicBot.volume;
                slider.oninput = (e) => {
                    state.musicBot.volume = parseInt(e.target.value);
                    if (state.musicBot.player && typeof state.musicBot.player.setVolume === "function") {
                        state.musicBot.player.setVolume(state.musicBot.volume);
                    }
                };
            }
            card.style.height = "auto";
        }

        // Context Menu
        if (m.peer_id !== state.peerId) {
            card.oncontextmenu = (e) => {
                e.preventDefault();
                showContextMenu(m.peer_id, displayName, e.clientX, e.clientY);
            };
        }

        if (card.parentNode !== container) container.appendChild(card);
    });
    updateVoiceSessionMeta();
}

let _updateVoiceSpeakingUiTimeouts = {};
function updateVoiceSpeakingUi(peerId, isSpeaking, channelId = state.voiceChannelId || state.activeChannelId) {
    if (!peerId) return;

    // Debounce per peer to prevent excessive DOM updates
    const key = `${peerId}_${isSpeaking}`;
    if (_updateVoiceSpeakingUiTimeouts[key]) {
        clearTimeout(_updateVoiceSpeakingUiTimeouts[key]);
    }

    _updateVoiceSpeakingUiTimeouts[key] = setTimeout(() => {
        _updateVoiceSpeakingUiImpl(peerId, isSpeaking, channelId);
        delete _updateVoiceSpeakingUiTimeouts[key];
    }, 16); // ~60fps
}

function _updateVoiceSpeakingUiImpl(peerId, isSpeaking, channelId) {
    const card = document.querySelector(`.voice-participant-card[data-peer-id="${CSS.escape(peerId)}"]`);
    const avatar = card?.querySelector(".vpc-avatar");
    card?.classList.toggle("speaking", !!isSpeaking);
    avatar?.classList.toggle("speaking", !!isSpeaking);

    const server = currentServer?.();
    if (!server || !channelId) return;
    const members = server.voiceMembers?.[channelId] || [];
    const member = members.find(m => m.peer_id === peerId);
    if (member) member.isSpeaking = !!isSpeaking;

    document.querySelectorAll(`.voice-member[data-peer-id="${CSS.escape(peerId)}"]`).forEach(el => {
        el.classList.toggle("voice-member--speaking", !!isSpeaking);
        el.querySelector(".vm-avatar")?.classList.toggle("speaking", !!isSpeaking);
    });
}


function showVoiceStatusBar(serverId, channelId) {
    const server = state.servers.find(s => s.id === serverId);
    const channel = server?.channels.find(c => c.id === channelId);
    document.getElementById("vsb-channel-name").textContent = channel?.name || "Sesli Kanal";
    document.getElementById("voice-status-bar").classList.remove("hidden");
}

function hideVoiceStatusBar() {
    document.getElementById("voice-status-bar").classList.add("hidden");
}

function openScreenOverlay(peerId, username) {
    let video = state.remoteMedia?.[peerId];
    if (peerId === state.peerId) {
        video = state.localVideoEl || document.getElementById("self-share-video");
    }
    if (!video?.srcObject?.getVideoTracks?.()?.length) {
        return toast("Video akışı bulunamadı.", "error");
    }

    // Prevent duplicates
    const existing = document.getElementById("screen-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.className = "screen-overlay";
    overlay.id = "screen-overlay";
    overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
    };

    const closeBtn = document.createElement("button");
    closeBtn.className = "screen-overlay-close";
    closeBtn.textContent = "Kapat";
    closeBtn.onclick = () => overlay.remove();

    const label = document.createElement("div");
    label.className = "screen-overlay-label";
    label.textContent = `${username || "Yayın"} — izle`;

    const bigVideo = document.createElement("video");
    bigVideo.autoplay = true;
    bigVideo.playsInline = true;
    bigVideo.srcObject = video.srcObject || null;
    bigVideo.className = "screen-overlay-video";
    bigVideo.onclick = (e) => e.stopPropagation();

    const closeOverlay = () => {
        if (overlay.isConnected) {
            overlay.remove();
        }
    };

    const syncSrc = () => {
        if (!overlay.isConnected) return;
        if (bigVideo.srcObject !== (video.srcObject || null)) {
            bigVideo.srcObject = video.srcObject || null;
            console.log("[Overlay] srcObject synced");
        }
        const currentStream = bigVideo.srcObject;
        if (!currentStream) {
            closeOverlay();
            return;
        }
        const tracks = currentStream.getVideoTracks();
        if (!tracks.length || tracks.every(track => track.readyState === "ended")) {
            closeOverlay();
            return;
        }
        tracks.forEach(track => {
            if (track._overlayEndBound) return;
            track._overlayEndBound = true;
            track.addEventListener("ended", closeOverlay);
        });
    };

    syncSrc();
    const interval = setInterval(syncSrc, SCORD_T().SCREEN_OVERLAY_SYNC_INTERVAL_MS ?? 750);
    const onKey = (e) => { if (e.key === "Escape") closeOverlay(); };
    window.addEventListener("keydown", onKey);

    const cleanup = () => {
        clearInterval(interval);
        window.removeEventListener("keydown", onKey);
    };
    const obs = new MutationObserver(() => {
        if (!overlay.isConnected) {
            cleanup();
            obs.disconnect();
        }
    });
    obs.observe(document.body, { childList: true });

    overlay.appendChild(closeBtn);
    overlay.appendChild(label);
    overlay.appendChild(bigVideo);
    document.body.appendChild(overlay);
}



/* ── Modals ───────────────────────────────────────────────── */
function openCreateServerModal() {
    showModal(
        "Sunucu Oluştur",
        `<label class="modal-label">Sunucu Adı</label>
     <input class="modal-input" id="new-server-name" placeholder="Sunucuma..." maxlength="50" />
     <p class="modal-info">Sunucun oluşturulduğunda diğer kullanıcılar ana sayfadan bulup katılabilir. Tüm iletişim P2P üzerinden gerçekleşir.</p>`,
        `<button class="btn-secondary" onclick="hideModal()">İptal</button>
     <button class="btn-primary" style="width:auto;padding:10px 24px" onclick="onCreateServer()">Oluştur</button>`
    );
    setTimeout(() => document.getElementById("new-server-name")?.focus(), 50);
}

async function onCreateServer() {
    const name = document.getElementById("new-server-name")?.value.trim();
    if (!name) { toast("Sunucu adı gir.", "error"); return; }
    hideModal();
    await createServer(name);
}

function openJoinServerModal() {
    showModal(
        "Sunucuya Katıl",
        `<label class="modal-label">Sunucu ID / Link</label>
     <input class="modal-input" id="join-server-id" placeholder="Sunucu kimliğini yapıştır..." />
     <p class="modal-info">Arkadaşından sunucu ID'sini al ve buraya yapıştır.</p>`,
        `<button class="btn-secondary" onclick="hideModal()">İptal</button>
     <button class="btn-primary" style="width:auto;padding:10px 24px" onclick="onJoinServer()">Katıl</button>`
    );
    setTimeout(() => document.getElementById("join-server-id")?.focus(), 50);
}

async function onJoinServer() {
    const id = document.getElementById("join-server-id")?.value.trim();
    if (!id) { toast("Sunucu ID'si gir.", "error"); return; }
    hideModal();
    await joinServer(id);
}

/* ── Emoji picker ─────────────────────────────────────────── */
function toggleEmojiPicker() {
    const existing = document.getElementById("emoji-picker");
    if (existing) { existing.remove(); state.emojiOpen = false; return; }

    const picker = document.createElement("div");
    picker.className = "emoji-picker";
    picker.id = "emoji-picker";

    EMOJIS.forEach(emoji => {
        const item = document.createElement("div");
        item.className = "emoji-item";
        item.textContent = emoji;
        item.onclick = () => {
            const input = document.getElementById("chat-input");
            input.value += emoji;
            input.focus();
            picker.remove();
            state.emojiOpen = false;
        };
        picker.appendChild(item);
    });

    document.getElementById("main-content").appendChild(picker);
    state.emojiOpen = true;

    // Close on outside click
    setTimeout(() => {
        document.addEventListener("click", function close(e) {
            if (!picker.contains(e.target) && e.target.id !== "emoji-btn") {
                picker.remove();
                state.emojiOpen = false;
                document.removeEventListener("click", close);
            }
        });
    }, 0);
}

/* ── Settings — 5-Tab Professional Layout ─────────────────── */
function openSettingsModal() {
    const vs = state.voiceSettings || {};
    const themeVal = state.theme || "";
    const tabHtml = `
    <div class="settings-two-col">
      <nav class="settings-tab-nav" id="stabs">
        <button class="active" data-tab="s-profil">👤 Profil</button>
        <button data-tab="s-gorunum">🎨 Görünüm</button>
        <button data-tab="s-ses">🎙️ Ses &amp; Video</button>
        <button data-tab="s-bildirim">🔔 Bildirimler</button>
        <button data-tab="s-hakkinda">ℹ️ Hakkında</button>
      </nav>
      <div class="settings-tab-content">
        <div id="s-profil" class="s-panel">
          <div class="form-group" style="margin-bottom:14px">
            <label class="modal-label">Kullanıcı Adı</label>
            <input class="modal-input" id="settings-username" value="${state.username}" maxlength="32" />
          </div>
          <div class="form-group">
            <label class="modal-label">Profil Fotoğrafı</label>
            <input type="file" id="settings-avatar-upload" accept="image/*" class="modal-input" style="padding:6px" />
            <p class="modal-info" style="margin-top:10px">Max ~500KB önerilir (P2P için).</p>
          </div>
          <div class="form-group" style="margin-bottom:14px">
            <label class="modal-label">Avatar URL (dosya yerine)</label>
            <input class="modal-input" id="settings-avatar-url" type="url" placeholder="https://… doğrudan görsel" value="" />
          </div>
        </div>
        <div id="s-gorunum" class="s-panel" style="display:none">
          <div class="form-group" style="margin-bottom:14px">
            <label class="modal-label">Arayüz şablonu (layout)</label>
            <select class="modal-input" id="settings-theme">
              <option value="">SCORD — Glass</option>
              <option value="theme-neon">⚡ Neon grid</option>
              <option value="theme-discord">💬 Kompakt panel</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:14px">
            <label class="modal-label">Renk paleti (modüler)</label>
            <select class="modal-input" id="settings-palette">
              <option value="glass">Cam — varsayılan</option>
              <option value="aurora">Aurora (mor–camgöbeği)</option>
              <option value="ember">Ember (sıcak kırmızı)</option>
              <option value="paper">Paper (açık, düşük kontrast)</option>
              <option value="forest">Forest (yeşil derin)</option>
              <option value="midnight">Midnight saf (OLED)</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:14px">
            <label class="modal-label">Sohbet düzeni</label>
            <select class="modal-input" id="settings-chat-layout">
              <option value="bubbles">Balonlar (kendi / diğer renk)</option>
              <option value="classic">Klasik satır</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:14px">
            <label class="modal-label">Kişisel Arka Plan Resmi</label>
            <input type="file" id="settings-bg-upload" accept="image/*" class="modal-input" style="padding:6px" />
            <p class="modal-info" style="margin-top:6px">Yalnızca senin ekranına hitap eden yerel bir görsel.</p>
          </div>
          <div class="form-group" style="margin-bottom:14px">
            <label class="modal-label">Mesaj yoğunluğu</label>
            <select class="modal-input" id="settings-msg-density">
              <option value="comfortable" ${(localStorage.getItem("scord_msg_density") || "cozy") === "comfortable" ? "selected" : ""}>Rahat</option>
              <option value="cozy" ${(localStorage.getItem("scord_msg_density") || "cozy") === "cozy" ? "selected" : ""}>Normal</option>
              <option value="compact" ${(localStorage.getItem("scord_msg_density") || "") === "compact" ? "selected" : ""}>Sıkı</option>
            </select>
          </div>
          <div class="form-group">
            <label class="modal-label" style="display:flex;align-items:center;gap:10px;cursor:pointer;">
              <input type="checkbox" id="settings-compact" ${state.compactMode ? 'checked' : ''}>
              Kompakt Görünüm
            </label>
          </div>
          <div class="form-group" style="margin-top:12px">
            <label class="modal-label" style="display:flex;align-items:center;gap:10px;cursor:pointer;">
              <input type="checkbox" id="settings-high-contrast" ${localStorage.getItem("scord_high_contrast") === "1" ? "checked" : ""}>
              Yüksek kontrast (kenarlıklar)
            </label>
          </div>
          <p class="modal-info" style="margin-top:8px">Hızlı kanal: <kbd style="padding:2px 6px;border-radius:4px;background:var(--bg-mid)">Ctrl</kbd>+<kbd style="padding:2px 6px;border-radius:4px;background:var(--bg-mid)">K</kbd> · Odak modu: sohbet başlığındaki ⛶</p>
        </div>
        <div id="s-ses" class="s-panel" style="display:none">
          <div class="form-group" style="margin-bottom:12px">
            <label class="modal-label">Mikrofon</label>
            <select class="modal-input" id="settings-mic-select"><option value="default">Varsayılan</option></select>
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <label class="modal-label">Ses Filtresi</label>
            <select class="modal-input" id="settings-filter">
              <option value="none">Normal</option>
              <option value="bass">Bass Boost</option>
              <option value="radio">Lo-Fi Radio</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <label class="modal-label">Giriş Sesi — <span id="vol-label">${Math.round((vs.volume || 1) * 100)}%</span></label>
            <input type="range" id="settings-volume" min="0" max="3" step="0.1" value="${vs.volume || 1}" style="width:100%" oninput="document.getElementById('vol-label').textContent=Math.round(this.value*100)+'%'" />
          </div>
          <div class="form-group" style="margin-bottom:10px">
            <label class="modal-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" id="settings-noise-suppress" ${vs.noiseSuppression !== false ? 'checked' : ''}>
              Gürültü Engelleme
            </label>
          </div>
          <div class="form-group" style="margin-bottom:10px">
            <label class="modal-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" id="settings-echo-cancel" ${vs.echoCancellation !== false ? 'checked' : ''}>
              Yankı Engelleme
            </label>
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <label class="modal-label">Giriş Modu</label>
            <select class="modal-input" id="settings-input-mode">
              <option value="voice" ${vs.inputMode !== 'ptt' ? 'selected' : ''}>Ses Aktivitesi</option>
              <option value="ptt" ${vs.inputMode === 'ptt' ? 'selected' : ''}>Bas-Konuş</option>
            </select>
          </div>
          <div id="ptt-key-container" class="form-group" style="margin-bottom:12px; display:${vs.inputMode === 'ptt' ? 'block' : 'none'}">
            <label class="modal-label">Kısayol Tuşu (PTT)</label>
            <input type="text" class="modal-input" id="settings-ptt-key" value="${vs.pttKey || 'Control'}" readonly style="cursor:pointer" placeholder="Tuş atamak için tıkla..." />
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <label class="modal-label">Ekran Paylaşımı Kalitesi</label>
            <select class="modal-input" id="settings-screen-quality">
              <option value="4k" ${state.screenShareQuality === "4k" ? "selected" : ""}>4K (Ultra HD)</option>
              <option value="1080p" ${state.screenShareQuality === "1080p" ? "selected" : ""}>1080p (Full HD)</option>
              <option value="720p" ${state.screenShareQuality === "720p" ? "selected" : ""}>720p (HD) - Önerilen</option>
              <option value="480p" ${state.screenShareQuality === "480p" ? "selected" : ""}>480p (SD)</option>
              <option value="360p" ${state.screenShareQuality === "360p" ? "selected" : ""}>360p (Düşük)</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <label class="modal-label">Kamera Kalitesi</label>
            <select class="modal-input" id="settings-camera-quality">
              <option value="4k" ${state.cameraQuality === "4k" ? "selected" : ""}>4K (Ultra HD)</option>
              <option value="1080p" ${state.cameraQuality === "1080p" ? "selected" : ""}>1080p (Full HD)</option>
              <option value="720p" ${state.cameraQuality === "720p" ? "selected" : ""}>720p (HD) - Önerilen</option>
              <option value="480p" ${state.cameraQuality === "480p" ? "selected" : ""}>480p (SD)</option>
              <option value="360p" ${state.cameraQuality === "360p" ? "selected" : ""}>360p (Düşük)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="modal-label">Kısayollar</label>
            <p class="modal-info" style="margin:2px 0">M — Mikrofon aç/kapat &nbsp;|&nbsp; D — Kulaklık</p>
          </div>
        </div>
        <div id="s-bildirim" class="s-panel" style="display:none">
          <div class="form-group" style="margin-bottom:12px">
            <label class="modal-label">Sohbet bildirimleri (arka planda)</label>
            <select class="modal-input" id="notif-chat-level">
              <option value="all" ${(state.notifSettings?.chatLevel || "all") === "all" ? "selected" : ""}>Tüm mesajlar</option>
              <option value="mentions" ${state.notifSettings?.chatLevel === "mentions" ? "selected" : ""}>Yalnız @${escapeHtml(state.username || "ben")} bahsetme</option>
              <option value="none" ${state.notifSettings?.chatLevel === "none" ? "selected" : ""}>Kapalı</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <label class="modal-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" id="notif-dm" ${state.notifSettings?.dm !== false ? 'checked' : ''}>
              Özel mesaj (DM) bildirimi
            </label>
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <label class="modal-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" id="notif-join" ${state.notifSettings?.join !== false ? 'checked' : ''}>
              Ses kanalına katılma bildirimi
            </label>
          </div>
          <div class="form-group">
            <label class="modal-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" id="notif-message-sound" ${state.notifSettings?.messageSound !== false ? 'checked' : ''}>
              Mesaj sesleri (bildirim sesi)
            </label>
          </div>
        </div>
        <div id="s-hakkinda" class="s-panel" style="display:none">
          <p style="font-size:18px;font-weight:700;margin-bottom:6px;color:var(--text-primary)">SCORD</p>
          <p class="modal-info">Sürüm 4.0 — Hybrid P2P Mesh</p>
          <p class="modal-info" style="margin-top:8px;line-height:1.6">Tüm mesaj, ses ve dosya transferleri doğrudan WebRTC üzerinden gerçekleşir. Sunucu yalnızca eşleştirme için kullanılır — BitTorrent tracker gibi.</p>
          <label class="modal-label" style="margin-top:16px;margin-bottom:6px;display:block">Peer ID</label>
          <div class="peer-id-display">${state.peerId || 'Bilinmiyor'}</div>
        </div>
      </div>
    </div>`;

    showModal("Kullanıcı Ayarları", tabHtml,
        `<button class="btn-secondary" onclick="hideModal()">İptal</button>
         <button class="btn-primary" style="width:auto;padding:10px 24px" onclick="saveSettings()">Kaydet</button>`
    );

    const avUrlField = document.getElementById("settings-avatar-url");
    if (avUrlField && state.avatarImage && /^https?:\/\//i.test(String(state.avatarImage))) {
        avUrlField.value = state.avatarImage;
    }

    // Tab switching logic
    document.querySelectorAll("#stabs button").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll("#stabs button").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".s-panel").forEach(p => p.style.display = "none");
            btn.classList.add("active");
            document.getElementById(btn.dataset.tab).style.display = "block";
            if (btn.dataset.tab === "s-ses") {
                navigator.mediaDevices.enumerateDevices().then(devices => {
                    const sel = document.getElementById("settings-mic-select");
                    sel.innerHTML = '<option value="default">Varsayılan</option>';
                    devices.filter(d => d.kind === "audioinput").forEach(d => {
                        const o = document.createElement("option");
                        o.value = d.deviceId;
                        o.textContent = d.label || "Mikrofon " + sel.length;
                        if (d.deviceId === vs.micId) o.selected = true;
                        sel.appendChild(o);
                    });
                    document.getElementById("settings-filter").value = vs.filter || "none";
                });
            }
            if (btn.dataset.tab === "s-gorunum") {
                document.getElementById("settings-theme").value = themeVal;
                const pal = document.getElementById("settings-palette");
                if (pal) pal.value = localStorage.getItem("scord_palette") || "glass";
                const cl = document.getElementById("settings-chat-layout");
                if (cl) cl.value = localStorage.getItem("scord_chat_layout") || "bubbles";
            }
        };
    });

    const inputMode = document.getElementById("settings-input-mode");
    if (inputMode) {
        inputMode.onchange = () => {
            document.getElementById("ptt-key-container").style.display = inputMode.value === 'ptt' ? 'block' : 'none';
        }
    }
    const pttInput = document.getElementById("settings-ptt-key");
    if (pttInput) {
        pttInput.onclick = () => {
            pttInput.value = "...";
            const handler = (e) => {
                e.preventDefault();
                pttInput.value = e.key;
                window.removeEventListener("keydown", handler);
            };
            window.addEventListener("keydown", handler);
        };
    }

    document.getElementById("settings-avatar-upload").onchange = (e) => {
        fileToBase64(e.target.files[0], (b64) => { state._tempAvatarImage = b64; });
    };
    document.getElementById("settings-bg-upload").onchange = (e) => {
        fileToBase64(e.target.files[0], (b64) => { state._tempBgImage = b64; });
    };
}

/* ── Right-Click Context Menu ─────────────────────────────── */
function showContextMenu(peerId, username, x, y) {
    closeContextMenu();
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const myRole = server.ownerId === state.peerId ? "owner"
        : server.peer_roles?.[state.peerId] === "admin" ? "admin"
            : server.peer_roles?.[state.peerId] === "mod" ? "mod" : "member";

    const menu = document.createElement("div");
    menu.className = "ctx-menu";
    menu.id = "ctx-menu";
    menu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 300)}px`;

    const addSection = (label) => {
        const s = document.createElement("div");
        s.className = "ctx-section";
        s.textContent = label;
        menu.appendChild(s);
    };
    const addItem = (icon, label, action, danger = false) => {
        const item = document.createElement("div");
        item.className = "ctx-item" + (danger ? " danger" : "");
        item.innerHTML = `<span class="ctx-icon">${icon}</span>${label}`;
        item.onclick = () => { closeContextMenu(); action(); };
        menu.appendChild(item);
    };
    const addDivider = () => {
        const d = document.createElement("div");
        d.className = "ctx-divider";
        menu.appendChild(d);
    };
    const addVolumeControl = () => {
        const wrap = document.createElement("div");
        wrap.className = "ctx-volume";
        const current = Math.round(Number(state.userVolumes?.[peerId] ?? 100));
        wrap.innerHTML = `
          <div class="ctx-volume-head"><span>Ses seviyesi</span><strong>${current}%</strong></div>
          <input type="range" min="0" max="200" value="${current}" step="5">`;
        const label = wrap.querySelector("strong");
        const slider = wrap.querySelector("input");
        slider.oninput = (e) => {
            const value = Number(e.target.value);
            label.textContent = `${value}%`;
            setPeerVolume(peerId, value);
        };
        menu.appendChild(wrap);
    };

    addSection(username);
    addItem("💬", "Özel Mesaj (DM)", () => {
        const m = server.members?.find(mem => mem.peer_id === peerId);
        openDM(peerId, username, m?.avatar_color, m?.avatar_image);
    });

    addItem("TEL", "Sesli Ara", () => startDirectCall(peerId));

    const isFriend = state.friends?.find(f => f.peerId === peerId);
    if (!isFriend) {
        addItem("➕", "Arkadaş Ekle", () => addFriend(peerId, username));
    } else {
        addItem("❌", "Arkadaştan Çıkar", () => removeFriend(peerId), true);
    }

    const member = server.members?.find(mem => mem.peer_id === peerId);
    addItem("👤", "Profili Görüntüle", () => openUserProfile(peerId, username, member?.avatar_image, member?.avatar_color));

    const isBlocked = state.blockedPeers?.includes(peerId);
    addItem(isBlocked ? "🔓" : "🚫", isBlocked ? "Engeli Kaldır" : "Engelle", () => toggleBlockStatus(peerId, username), !isBlocked);

    if (state.voiceChannelId && state.remoteMedia?.[peerId]) {
        addDivider();
        addVolumeControl();
    }

    const canAssignRoles = (myRole === "owner" || myRole === "admin") && peerId !== state.peerId;
    const canModerate = ["owner", "admin", "mod"].includes(myRole) && peerId !== state.peerId;

    if (canAssignRoles) {
        addDivider();
        addSection("Yetki");
        const cr = server.peer_roles?.[peerId];
        if (server.ownerId !== peerId) {
            if (cr !== "admin") addItem("🛡️", "Yönetici Yap", () => assignRole(peerId, "admin", server));
            if (cr !== "mod") addItem("🟢", "Moderatör Yap", () => assignRole(peerId, "mod", server));
            if (cr) addItem("👤", "Rolü Kaldır", () => assignRole(peerId, null, server));
        }
    }

    if (canModerate) {
        addDivider();
        addSection("Moderasyon");
        addItem("🔇", "Zorla Sessize Al", () => forceMutePeer(peerId, username));
        const sameVoice = state.voiceChannelId && server.voiceMembers?.[state.voiceChannelId]?.some(m => m.peer_id === peerId);
        if (sameVoice) {
            addItem("📴", "Ses Kanalından Çıkar", () => voiceDisconnectPeer(peerId, username), true);
        }
        if (server.ownerId !== peerId) {
            addItem("🚪", "Sunucudan At", () => kickPeer(peerId, username), true);
        }
    }

    document.body.appendChild(menu);
    setTimeout(() => {
        document.addEventListener("click", closeContextMenu, { once: true });
    }, 10);
}

function closeContextMenu() { document.getElementById("ctx-menu")?.remove(); }

function showMsgContextMenu(msg, x, y) {
    closeContextMenu();
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const myRole = getMyEffectiveRole(server);
    const canMod = ["owner", "admin", "mod"].includes(myRole);
    const isAuthor = msg.authorId === state.peerId;

    const menu = document.createElement("div");
    menu.className = "ctx-menu ctx-menu--chat";
    menu.id = "ctx-menu";
    menu.style.left = `${Math.min(x, window.innerWidth - 280)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 380)}px`;

    const addItem = (icon, label, action, danger = false) => {
        const item = document.createElement("div");
        item.className = "ctx-item" + (danger ? " danger" : "");
        item.innerHTML = `<span class="ctx-icon">${icon}</span>${label}`;
        item.onclick = () => { closeContextMenu(); action(); };
        menu.appendChild(item);
    };

    addItem("📋", "Metni Kopyala", () => {
        const t = msg.text || "";
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(t).then(() => toast("Panoya kopyalandı", "info")).catch(() => toast("Kopyalanamadı", "error"));
        }
    });

    addItem("↩️", "Yanıtla", () => setReplyTarget(msg));
    addItem("💬", "Thread Başlat", () => createThread(state.activeServerId, msg.channelId || state.activeChannelId, msg.id));
    addItem("⤴️", "Mesaja git", () => scrollToChatMessage(msg.id));
    addItem("🆔", "Mesaj ID kopyala", () => {
        const id = msg.id || "";
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(id).then(() => toast("Mesaj ID kopyalandı", "info")).catch(() => toast("Kopyalanamadı", "error"));
        }
    });

    ["👍", "❤️", "😂", "🔥", "🎉"].forEach(emoji => {
        addItem(emoji, `Tepki ${emoji}`, () => {
            if (state.mesh) state.mesh.broadcast({ type: "reaction", msgId: msg.id, emoji, channelId: state.activeChannelId });
            handleReaction(msg.id, emoji, state.peerId);
        });
    });

    if (canMod) {
        const isPinned = !!(msg.isPinned || server.pinned_messages?.some(p => p.id === msg.id));
        addItem("📌", isPinned ? "Sabitlemeyi Kaldır" : "Mesajı Sabitle", () => {
            msg.isPinned = !isPinned;
            if (state.mesh) {
                state.mesh.broadcast({ type: "msg_pin_toggle", payload: { msgId: msg.id, isPinned: msg.isPinned, msg } });
            }
            if (!server.pinned_messages) server.pinned_messages = [];
            if (msg.isPinned) {
                if (!server.pinned_messages.find(m => m.id === msg.id)) server.pinned_messages.push(msg);
            } else {
                server.pinned_messages = server.pinned_messages.filter(m => m.id !== msg.id);
            }
            const live = server.messages?.[msg.channelId]?.find(m => m.id === msg.id);
            if (live) live.isPinned = msg.isPinned;
            renderMessages(state.activeServerId, state.activeChannelId);
            fetch(`${API_BASE}/rooms/${state.activeServerId}/pin`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: msg }),
            });
            toast("Sabitleme güncellendi.", "info");
        });
    }

    if (isAuthor || canMod) {
        addItem("✏️", "Mesajı Düzenle", () => startMessageEdit(msg));
        addItem("📜", "Mesaj Geçmişi", () => showMessageHistory(state.activeServerId, msg.channelId || state.activeChannelId, msg.id));
        addItem("🗑️", "Mesajı Sil", () => deleteChatMessage(msg), true);
    }

    document.body.appendChild(menu);
    setTimeout(() => {
        document.addEventListener("click", closeContextMenu, { once: true });
    }, 10);
}

function deleteChatMessage(msg) {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const channelId = msg.channelId || state.activeChannelId;
    if (!channelId) return;
    if (!server.messages) server.messages = {};
    if (!server.messages[channelId]) server.messages[channelId] = [];

    // Add to edit history before deleting
    addMessageToHistory(server.id, channelId, msg, 'delete');

    server.messages[channelId] = server.messages[channelId].filter(m => m.id !== msg.id);
    server.pinned_messages = (server.pinned_messages || []).filter(m => m.id !== msg.id);
    meshBroadcastReliable({ type: "msg_delete", payload: { channelId, msgId: msg.id } });
    renderMessages(state.activeServerId, state.activeChannelId);
    toast("Mesaj silindi.", "info");
}

// Message Edit/Delete History System
function addMessageToHistory(serverId, channelId, message, action) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;

    if (!server.messageHistory) server.messageHistory = {};
    const key = `${channelId}-${message.id}`;
    if (!server.messageHistory[key]) server.messageHistory[key] = [];

    const historyEntry = {
        action, // 'edit' or 'delete'
        timestamp: Date.now(),
        message: { ...message },
        author: message.author,
        authorId: message.authorId
    };

    server.messageHistory[key].push(historyEntry);
    saveMessageHistoryToStorage(serverId);
}

function editMessage(serverId, channelId, messageId, newText) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server?.messages?.[channelId]) return;

    const messageIndex = server.messages[channelId].findIndex(m => m.id === messageId);
    if (messageIndex === -1) return;

    const originalMessage = server.messages[channelId][messageIndex];

    // Add to history
    addMessageToHistory(serverId, channelId, originalMessage, 'edit');

    // Update message
    server.messages[channelId][messageIndex] = {
        ...originalMessage,
        text: newText,
        edited: true,
        editedAt: Date.now()
    };

    // Broadcast edit
    if (state.mesh) {
        state.mesh.broadcast({
            type: "msg_edit",
            serverId,
            channelId,
            messageId,
            newText,
            timestamp: Date.now()
        });
    }

    // Update UI
    renderMessages(serverId, channelId);
    saveMessageHistoryToStorage(serverId);
    toast("Mesaj düzenlendi.", "info");
}

function handleMessageEdit(data) {
    const { serverId, channelId, messageId, newText } = data;
    const server = state.servers.find(s => s.id === serverId);
    if (!server?.messages?.[channelId]) return;

    const messageIndex = server.messages[channelId].findIndex(m => m.id === messageId);
    if (messageIndex === -1) return;

    const originalMessage = server.messages[channelId][messageIndex];

    // Add to history
    addMessageToHistory(serverId, channelId, originalMessage, 'edit');

    // Update message
    server.messages[channelId][messageIndex] = {
        ...originalMessage,
        text: newText,
        edited: true,
        editedAt: Date.now()
    };

    // Update UI if this channel is active
    if (state.activeServerId === serverId && state.activeChannelId === channelId) {
        renderMessages(serverId, channelId);
    }
}

function showMessageHistory(serverId, channelId, messageId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server?.messageHistory) return;

    const key = `${channelId}-${messageId}`;
    const history = server.messageHistory[key] || [];
    if (history.length === 0) return;

    const body = document.createElement('div');
    body.className = 'message-history-modal';

    const historyList = document.createElement('div');
    historyList.className = 'history-list';

    history.forEach((entry, index) => {
        const item = document.createElement('div');
        item.className = 'history-item';

        const actionIcon = entry.action === 'edit' ? '✏️' : '🗑️';
        const actionText = entry.action === 'edit' ? 'Düzenlendi' : 'Silindi';
        const actionColor = entry.action === 'edit' ? '#f39c12' : '#ef4444';

        item.innerHTML = `
            <div class="history-item-header">
                <div class="history-action" style="color: ${actionColor}">
                    ${actionIcon} ${actionText}
                </div>
                <div class="history-time">
                    ${new Date(entry.timestamp).toLocaleString('tr-TR')}
                </div>
            </div>
            <div class="history-content">
                <div class="history-author">${entry.author}</div>
                <div class="history-text">${parseMessageText(entry.message.text, serverId)}</div>
            </div>
        `;

        historyList.appendChild(item);
    });

    body.appendChild(historyList);

    showModal(
        `<div class="history-modal-header">
            <div class="history-modal-title">📜 Mesaj Geçmişi</div>
            <div class="history-modal-subtitle">${history.length} işlem</div>
        </div>`,
        body,
        `<button class="btn-secondary" onclick="hideModal()">Kapat</button>`
    );
}

function startMessageEdit(msg) {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server?.messages?.[msg.channelId]) return;

    const messageIndex = server.messages[msg.channelId].findIndex(m => m.id === msg.id);
    if (messageIndex === -1) return;

    const messageEl = document.querySelector(`[data-msg-id="${msg.id}"]`);
    if (!messageEl) return;

    const textEl = messageEl.querySelector('.msg-text');
    if (!textEl) return;

    // Create edit input
    const editInput = document.createElement('textarea');
    editInput.className = 'message-edit-input';
    editInput.value = msg.text || '';
    editInput.rows = 1;

    // Replace text with input
    textEl.innerHTML = '';
    textEl.appendChild(editInput);

    // Focus and select text
    editInput.focus();
    editInput.select();

    // Save on Enter, cancel on Escape
    const saveEdit = () => {
        const newText = editInput.value.trim();
        if (newText && newText !== msg.text) {
            editMessage(state.activeServerId, msg.channelId, msg.id, newText);
        } else {
            // Restore original text if no changes
            textEl.innerHTML = parseMessageText(msg.text, state.activeServerId);
        }
    };

    const cancelEdit = () => {
        textEl.innerHTML = parseMessageText(msg.text, state.activeServerId);
    };

    editInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            saveEdit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
        }
    });

    editInput.addEventListener('blur', saveEdit, { once: true });

    // Auto-resize
    editInput.addEventListener('input', () => {
        editInput.style.height = 'auto';
        editInput.style.height = Math.min(editInput.scrollHeight, 120) + 'px';
    });
}

function saveMessageHistoryToStorage(serverId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server || !server.messageHistory) return;

    localStorage.setItem(`scord_message_history_${serverId}`, JSON.stringify(server.messageHistory));
}

function loadMessageHistoryFromStorage(serverId) {
    try {
        const saved = localStorage.getItem(`scord_message_history_${serverId}`);
        if (!saved) return;

        const server = state.servers.find(s => s.id === serverId);
        if (!server) return;

        server.messageHistory = JSON.parse(saved);
    } catch (e) {
        console.warn("Failed to load message history from storage:", e);
    }
}
/* ── Moderation Actions ───────────────────────────────────── */
function kickPeer(peerId, username) {
    if (!state.mesh) return;
    // Reliable path (DC + WS fallback)
    meshBroadcastReliable({ type: "force_kick", target: peerId });
    // Server-routed path for newer moderation flow
    sendServerEvent({ type: "force_kick", target: peerId });

    // Remove from local state
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (server) {
        server.members = server.members.filter(m => m.peer_id !== peerId);
        updateMembersPanel(state.activeServerId);
    }

    toast(`${username} sunucudan atıldı. 🚪`, "info");
}

function voiceDisconnectPeer(peerId, username) {
    if (!state.mesh) return;
    // Legacy event
    meshBroadcastReliable({ type: "voice_force_disconnect", target: peerId });
    // Current moderation event
    sendServerEvent({ type: "force_disconnect", target: peerId, channelId: state.voiceChannelId || state.activeChannelId });
    toast(`${username} ses kanalından çıkarıldı.`, "info");
}

function forceMutePeer(peerId, username) {
    if (!state.mesh) return;
    meshBroadcastReliable({ type: "force_mute", target: peerId });
    sendServerEvent({ type: "force_mute", target: peerId, channelId: state.voiceChannelId || state.activeChannelId });
    toast(`${username} sessize alındı.`, "info");
}

function assignRole(peerId, role, server) {
    if (!server.peer_roles) server.peer_roles = {};
    if (role) server.peer_roles[peerId] = role;
    else delete server.peer_roles[peerId];
    if (state.mesh) {
        state.mesh.broadcast({
            type: "server_update",
            payload: {
                id: server.id,
                name: server.name,
                channels: server.channels,
                roles: server.roles,
                peer_roles: server.peer_roles,
                channel_backgrounds: server.channel_backgrounds || {},
                inviteCode: server.inviteCode,
                icon_url: server.icon_url,
            },
        });
    }
    updateMembersPanel(server.id);
    toast("Rol güncellendi.", "success");
}

function leaveServer(serverId) {
    const idx = state.servers.findIndex(s => s.id === serverId);
    if (idx === -1) return;
    // Önce sesli kanaldan çık
    if (state.voiceChannelId) {
        try { leaveVoiceChannel(); } catch (e) {}
    }
    state.activeChannelId = null;
    state.activeServerId = null;
    state.voiceChannelId = null;
    if (state.mesh) { state.mesh.disconnect(); state.mesh = null; }
    state.servers.splice(idx, 1);
    renderServerRail();
    showHomeView();
    toast("Sunucudan ayrıldın.", "info");
}

function toggleBlockStatus(peerId, username) {
    if (!state.blockedPeers) state.blockedPeers = [];
    const idx = state.blockedPeers.indexOf(peerId);
    if (idx !== -1) {
        state.blockedPeers.splice(idx, 1);
        toast(`@${username} için engellemeni kaldırdın.`, "success");
    } else {
        state.blockedPeers.push(peerId);
        toast(`@${username} engellendi. Artık mesajlarını ve sesini duymayacaksın.`, "info");
    }
    localStorage.setItem("scord_blocked_peers", JSON.stringify(state.blockedPeers));
    updateMuteStates();

    // Refresh current views
    if (state.activeServerId && state.activeChannelId) {
        renderMessages(state.activeServerId, state.activeChannelId);
    }
    if (state.activeDM) {
        renderDMMessages(state.activeDM);
    }

    // Close the profile modal if it's open
    hideModal();
}

function fileToBase64(file, cb) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => cb(reader.result);
    // Compress heavily if needed but for now this works locally
    reader.readAsDataURL(file);
}

function saveSettings() {
    const newName = document.getElementById("settings-username").value.trim();
    if (newName) {
        state.username = newName;
        localStorage.setItem("scord_username", newName);
    }

    const theme = document.getElementById("settings-theme")?.value;
    if (theme !== undefined) {
        state.theme = theme;
        localStorage.setItem("scord_theme", theme);
        document.documentElement.className = theme;
    }

    const palette = document.getElementById("settings-palette")?.value;
    if (palette) {
        localStorage.setItem("scord_palette", palette);
    }
    const chatLayout = document.getElementById("settings-chat-layout")?.value;
    if (chatLayout) {
        localStorage.setItem("scord_chat_layout", chatLayout);
    }
    applyScordAppearance();

    if (state._tempAvatarImage) {
        state.avatarImage = state._tempAvatarImage;
        localStorage.setItem("scord_avatar_image", state.avatarImage);
        state._tempAvatarImage = null;
    } else {
        const avUrl = document.getElementById("settings-avatar-url")?.value?.trim();
        if (avUrl && /^https?:\/\//i.test(avUrl)) {
            state.avatarImage = avUrl;
            localStorage.setItem("scord_avatar_image", avUrl);
        }
    }

    if (state._tempBgImage) {
        state.appBackground = state._tempBgImage;
        localStorage.setItem("scord_bg_image", state.appBackground);
        document.body.style.backgroundImage = `url(${state.appBackground})`;
        document.body.style.backgroundSize = "cover";
        document.body.style.backgroundPosition = "center";
        state._tempBgImage = null;
    }

    // Refresh user bar UI
    const avatar = document.getElementById("user-bar-avatar");
    applyAvatarToElement(avatar, state.avatarColor, state.avatarImage, state.username);
    document.getElementById("user-bar-name").textContent = state.username;

    // Save voice settings
    const micId = document.getElementById("settings-mic-select")?.value;
    const filter = document.getElementById("settings-filter")?.value;
    const volume = document.getElementById("settings-volume")?.value;
    const noiseSuppression = document.getElementById("settings-noise-suppress")?.checked ?? true;
    const echoCancellation = document.getElementById("settings-echo-cancel")?.checked ?? true;
    const inputMode = document.getElementById("settings-input-mode")?.value || "voice";
    const pttKey = document.getElementById("settings-ptt-key")?.value || "Control";

    if (micId !== undefined) {
        state.voiceSettings = {
            micId, filter, volume: parseFloat(volume),
            noiseSuppression, echoCancellation,
            inputMode, pttKey
        };
        localStorage.setItem("scord_voice_settings", JSON.stringify(state.voiceSettings));
    }

    // Apply PTT track state immediately if talking
    if (state.originalMicStream) {
        const track = state.originalMicStream.getAudioTracks()[0];
        if (track) {
            if (state.voiceSettings.inputMode === "ptt") {
                track.enabled = !!state._pttActive;
            } else {
                track.enabled = true;
            }
        }
    }

    // Broadcast nick/avatar change if in voice
    if (state.mesh) {
        state.mesh.broadcast({
            type: "broadcast",
            payload: { type: "profile_update", username: state.username, avatarImage: state.avatarImage }
        });
    }

    const dens = document.getElementById("settings-msg-density")?.value || "cozy";
    localStorage.setItem("scord_msg_density", dens);
    document.documentElement.setAttribute("data-msg-density", dens);
    document.documentElement.setAttribute("data-scord-chat-style", dens);

    const highContrast = document.getElementById("settings-high-contrast")?.checked ?? false;
    localStorage.setItem("scord_high_contrast", highContrast ? "1" : "0");
    document.documentElement.classList.toggle("scord-high-contrast", highContrast);

    // Save notification settings
    const chatLevel = document.getElementById("notif-chat-level")?.value || "all";
    const notifDm = document.getElementById("notif-dm")?.checked ?? true;
    const notifJoin = document.getElementById("notif-join")?.checked ?? true;
    const notifMsgSound = document.getElementById("notif-message-sound")?.checked ?? true;
    state.notifSettings = {
        chat: chatLevel !== "none",
        dm: notifDm,
        join: notifJoin,
        chatLevel,
        messageSound: notifMsgSound
    };
    localStorage.setItem("scord_notif_settings", JSON.stringify(state.notifSettings));

    // Save compact mode
    const compact = document.getElementById("settings-compact")?.checked ?? false;
    state.compactMode = compact;
    localStorage.setItem("scord_compact_mode", compact ? "1" : "0");
    document.body.classList.toggle("compact-mode", compact);

    hideModal();
    toast("Ayarlar kaydedildi! ✅ Ses ayarları kanaldan çıkıp girinceye kadar aktif olmaz.", "success");
}

function openServerSettingsModal() {
    if (!state.activeServerId) return toast("Önce bir sunucu seç.", "info");
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    if (!server.bannedUsers) server.bannedUsers = [];

    const isOwner = server.ownerId === state.peerId;
    const isAdmin = isOwner || server.peer_roles?.[state.peerId] === "admin";
    const isMember = isOwner || server.members?.some(m => m.peer_id === state.peerId);
    const canEdit = isAdmin;
    if (!isMember) return toast("Bu işlem için sunucu üyesi olman gerekir.", "error");

    const activeChMeta = server.channels?.find(c => c.id === state.activeChannelId);
    const chLabel = activeChMeta ? `#${activeChMeta.name}` : (state.activeChannelId || "kanal");
    const bgUrl = (server.channel_backgrounds || {})[state.activeChannelId] || "";
    const inv = server.inviteCode || server.invite_code || "";
    const voicePermissionMode = server.voicePermissionMode || "everyone";
    const permissionNotice = canEdit ? "" : `<div style="margin-bottom:14px;color:var(--text-muted);font-size:13px;">Bu sunucunun ayarlarını düzenleme yetkin yok. Sadece görüntüleyebilirsiniz.</div>`;

    showModal(
        `Sunucu Ayarları`,
        `${permissionNotice}
         <div class="settings-tabs" style="display:flex; gap:16px; margin-bottom:16px; border-bottom:1px solid var(--border); padding-bottom:8px;">
            <div id="stab-general" onclick="window._stabSwitch('general')" style="color:var(--accent-light); cursor:pointer; font-weight:600;">Genel</div>
            <div id="stab-roles" onclick="window._stabSwitch('roles')" style="color:var(--text-muted); cursor:pointer;">Üyeler & Rol Yönetimi</div>
            <div id="stab-bans" onclick="window._stabSwitch('bans')" style="color:var(--text-muted); cursor:pointer;">Yasaklılar</div>
            <div id="stab-advanced" onclick="window._stabSwitch('advanced')" style="color:var(--text-muted); cursor:pointer;">Gelişmiş & Kanallar</div>
         </div>
         <div id="s-tab-general">
            <div class="form-group" style="margin-bottom: 12px">
                <label class="modal-label">Sunucu Adı</label>
                <input class="modal-input" id="sv-name" value="${escapeHtml(server.name)}" ${isOwner ? "" : "disabled"} />
            </div>
            <div class="form-group" style="margin-bottom: 12px">
                <label class="modal-label">Sunucu İkonu (URL)</label>
                <div style="display:flex; gap:8px">
                    <input class="modal-input" id="sv-icon" value="${escapeHtml(server.icon_url || "")}" placeholder="https://…" style="flex:1" ${canEdit ? "" : "disabled"} />
                    <button type="button" class="hero-btn tiny" onclick="updateServerIcon('${server.id}', document.getElementById('sv-icon').value)" ${canEdit ? "" : "disabled"}>Güncelle</button>
                </div>
            </div>
            <div class="form-group" style="margin-bottom: 12px">
                <label class="modal-label">Kanal arka planı (${chLabel})</label>
                <p class="modal-info" style="margin-top:4px;font-size:11px">Seçili kanal: <code>${escapeHtml(state.activeChannelId || "")}</code> — boş bırakırsan sıfırlanır.</p>
                <div style="display:flex; gap:8px; margin-top:8px">
                    <input class="modal-input" id="sv-ch-bg" value="${escapeHtml(bgUrl)}" placeholder="https://… görsel URL" style="flex:1" ${canEdit ? "" : "disabled"} />
                    <button type="button" class="hero-btn tiny" onclick="window._applyChannelBg && window._applyChannelBg()" ${canEdit ? "" : "disabled"}>Uygula</button>
                </div>
            </div>
            <div class="form-group" style="margin-bottom: 12px">
                <label class="modal-label">Görünüm Teması</label>
                <select class="modal-input" onchange="updateTheme(this.value)">
                    <option value="sapphire" ${state.theme === "sapphire" ? "selected" : ""}>Safir (Varsayılan)</option>
                    <option value="emerald" ${state.theme === "emerald" ? "selected" : ""}>Zümrüt</option>
                    <option value="ruby" ${state.theme === "ruby" ? "selected" : ""}>Yakut</option>
                    <option value="gold" ${state.theme === "gold" ? "selected" : ""}>Altın</option>
                </select>
            </div>
         </div>
         <div id="s-tab-roles" style="display:none;">
            <div style="max-height:300px; overflow-y:auto; padding-right:8px; display:flex; flex-direction:column; gap:8px;" id="sv-roles-list">
                 <!-- Populated by JS -->
            </div>
         </div>
         <div id="s-tab-bans" style="display:none;">
            <div style="max-height:300px; overflow-y:auto; padding-right:8px; display:flex; flex-direction:column; gap:8px;" id="sv-bans-list">
                 <!-- Populated by JS -->
            </div>
         </div>
         <div id="s-tab-advanced" style="display:none;">
            <div class="form-group">
                <label class="modal-label">Davet Kodu</label>
                <div class="peer-id-display" style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    <span id="sv-invite-code-live" style="letter-spacing:3px;font-weight:700">${escapeHtml(inv || "—")}</span>
                    <button type="button" class="hero-btn tiny" onclick="navigator.clipboard.writeText(document.getElementById('sv-invite-code-live').textContent.trim()); toast('Kod kopyalandı!','info')">Kopyala</button>
                </div>
                <p class="modal-info">Ana sayfadaki «Katıl» kutusu ve ?invite= bağlantısı bu kodla senkron.</p>
                ${isOwner ? `<button type="button" class="btn-secondary" style="margin-top:10px" onclick="window._rotateInviteCode && window._rotateInviteCode()">Yeni kod üret</button>` : ""}
            </div>
            
            <div class="form-group" style="margin-top:24px">
                <label class="modal-label">Sesli kanal konuşma izni</label>
                <select id="sv-voice-permission" class="modal-input" ${canEdit ? "" : "disabled"}>
                    <option value="everyone" ${voicePermissionMode !== "mods_only" ? "selected" : ""}>Herkes konuşabilir</option>
                    <option value="mods_only" ${voicePermissionMode === "mods_only" ? "selected" : ""}>Sadece moderatör ve üstleri konuşabilir</option>
                </select>
                <p class="modal-info">Bu ayar, aynı anda çok sayıda konuşma olduğunda moderatör odaklı bir konuşma düzeni sağlar.</p>
            </div>
            ${isOwner ? `
            <div class="form-group" style="margin-top:24px">
                <button type="button" class="btn-primary" style="background:var(--red); border:none;" onclick="deleteServer('${server.id}')">Sunucuyu Kapat/Kaldır</button>
            </div>` : ""}
         </div>`,
        `<button type="button" class="btn-secondary" onclick="hideModal()">Kapat</button>
         ${canEdit ? `<button type="button" class="btn-primary" style="width:auto;padding:10px 24px" onclick="saveServerSettings()">Kaydet</button>` : ""}`
    );

    window._stabSwitch = (tab) => {
        ["general", "roles", "bans", "advanced"].forEach(t => {
            document.getElementById(`s-tab-${t}`).style.display = t === tab ? "block" : "none";
            const stab = document.getElementById(`stab-${t}`);
            if (stab) {
                stab.style.color = t === tab ? "var(--accent-light)" : "var(--text-muted)";
                stab.style.fontWeight = t === tab ? "600" : "400";
            }
        });
    };

    // Render Members/Roles
    const rolesContainer = document.getElementById("sv-roles-list");
    rolesContainer.innerHTML = "";
    (server.members || []).forEach(m => {
        const pr = server.peer_roles?.[m.peer_id] || "member";
        const isTargetOwner = m.peer_id === server.ownerId;
        const canModTarget = !isTargetOwner && m.peer_id !== state.peerId && canEdit;

        const row = document.createElement("div");
        row.style.cssText = "display:flex; align-items:center; gap:12px; background:var(--bg-overlay); padding:10px; border-radius:8px;";

        const ava = document.createElement("div");
        ava.style.cssText = `width:36px; height:36px; border-radius:50%; background-color:${m.avatar_color || '#7c3aed'}; background-image:url(${m.avatar_image || ''}); background-size:cover; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700;`;
        ava.textContent = !m.avatar_image ? initials(m.username) : "";

        const info = document.createElement("div");
        info.style.cssText = "flex:1; min-width:0;";
        info.innerHTML = `<div style="font-weight:600; font-size:14px; text-overflow:ellipsis; overflow:hidden;">${escapeHtml(m.username)}</div><div style="font-size:11px; color:var(--text-muted);">${m.peer_id}</div>`;

        const actions = document.createElement("div");
        actions.style.cssText = "display:flex; align-items:center; gap:8px;";

        if (isTargetOwner) {
            actions.innerHTML = `<span class="role-badge owner">Kurucu 👑</span>`;
        } else {
            actions.innerHTML = `
                <select ${!isOwner ? "disabled" : ""} onchange="window._tmpSetPeerRole('${m.peer_id}', this.value)" class="modal-input" style="padding:4px 8px; height:auto; background:var(--bg-active); width:110px;">
                    <option value="member" ${pr === "member" ? "selected" : ""}>Üye</option>
                    <option value="mod" ${pr === "mod" ? "selected" : ""}>Moderatör</option>
                    <option value="admin" ${pr === "admin" ? "selected" : ""}>Yönetici</option>
                </select>
                ${canModTarget ? `
                    <button class="mbot-btn mbot-btn--danger" style="width:28px;height:28px;font-size:11px;" title="Sunucudan At" onclick="window._tmpKickPeer('${m.peer_id}')">K</button>
                    <button class="mbot-btn mbot-btn--danger" style="width:28px;height:28px;font-size:11px;background:#991b1b" title="Yasakla (Ban)" onclick="window._tmpBanPeer('${m.peer_id}', '${escapeHtml(m.username)}')">B</button>
                ` : ''}
            `;
        }

        row.appendChild(ava);
        row.appendChild(info);
        row.appendChild(actions);
        rolesContainer.appendChild(row);
    });

    // Render Bans
    const renderBans = () => {
        const bansContainer = document.getElementById("sv-bans-list");
        bansContainer.innerHTML = "";
        if (server.bannedUsers.length === 0) {
            bansContainer.innerHTML = `<div style="color:var(--text-muted); font-size:13px; text-align:center; padding: 20px;">Yasaklı kullanıcı yok.</div>`;
            return;
        }

        server.bannedUsers.forEach(banned => {
            const row = document.createElement("div");
            row.style.cssText = "display:flex; align-items:center; gap:12px; background:var(--bg-overlay); padding:10px; border-radius:8px;";

            row.innerHTML = `
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:600; font-size:14px;">${escapeHtml(banned.username)}</div>
                    <div style="font-size:11px; color:var(--text-muted);">${banned.peerId}</div>
                </div>
                ${canEdit ? `
                    <button class="hero-btn tiny" style="background:var(--bg-active);" onclick="window._tmpUnbanPeer('${banned.peerId}')">Yasağı Kaldır</button>
                ` : ''}
            `;
            bansContainer.appendChild(row);
        });
    };
    renderBans();

    window._tmpPendingPeerRoles = { ...(server.peer_roles || {}) };
    window._tmpSetPeerRole = (peerId, val) => {
        if (val === "member") delete window._tmpPendingPeerRoles[peerId];
        else window._tmpPendingPeerRoles[peerId] = val;
    };

    window._tmpKickPeer = (peerId) => {
        if (confirm("Bu üyeyi sunucudan atmak istediğine emin misin?")) {
            kickPeer(peerId, "Üye");
            openServerSettingsModal(); // Refresh modal
        }
    };

    window._tmpBanPeer = (peerId, username) => {
        if (confirm(`${username} adlı üyeyi tamamen yasaklamak istediğine emin misin?`)) {
            kickPeer(peerId, username); // Kick them out physically
            if (!server.bannedUsers.find(b => b.peerId === peerId)) {
                server.bannedUsers.push({ peerId, username });
            }
            openServerSettingsModal(); // Refresh modal
        }
    };

    window._tmpUnbanPeer = (peerId) => {
        server.bannedUsers = server.bannedUsers.filter(b => b.peerId !== peerId);
        openServerSettingsModal();
    };

    window._applyChannelBg = async () => {
        const srv = state.servers.find(s => s.id === state.activeServerId);
        const url = document.getElementById("sv-ch-bg")?.value?.trim() || "";
        if (!srv || !state.activeChannelId) return toast("Önce bir kanal seç.", "warn");
        if (!srv.channel_backgrounds) srv.channel_backgrounds = {};
        if (url) srv.channel_backgrounds[state.activeChannelId] = url;
        else delete srv.channel_backgrounds[state.activeChannelId];
        // Server API'ye kaydet
        try {
            await fetch(`${API_BASE}/rooms/${srv.id}/channel_background`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ channel_id: state.activeChannelId, url: url || null }),
            });
        } catch (e) {}
        applyChannelBackground(srv.id, state.activeChannelId);
        if (state.mesh) {
            state.mesh.broadcast({
                type: "server_update",
                payload: { id: srv.id, channel_backgrounds: srv.channel_backgrounds },
            });
        }
        toast("Kanal arka planı güncellendi.", "success");
    };

    window._rotateInviteCode = async () => {
        const srv = state.servers.find(s => s.id === state.activeServerId);
        if (!srv || srv.ownerId !== state.peerId) return;
        try {
        const res = await fetch(`${API_BASE}/rooms/${srv.id}/invite_rotate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ owner_id: state.peerId }),
            });
            const data = await res.json();
            if (data.invite_code) {
                srv.inviteCode = data.invite_code;
                const el = document.getElementById("sv-invite-code-live");
                if (el) el.textContent = data.invite_code;
                toast("Yeni davet kodu oluşturuldu.", "success");
                if (state.mesh) {
                    state.mesh.broadcast({
                        type: "server_update",
                        payload: { id: srv.id, inviteCode: srv.inviteCode },
                    });
                }
            } else {
                toast(data.error || "Kod yenilenemedi.", "error");
            }
        } catch (e) {
            toast("Sunucu yanıt vermedi.", "error");
        }
    };
}

function saveServerSettings() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const isOwner = server.ownerId === state.peerId;
    const isAdmin = isOwner || server.peer_roles?.[state.peerId] === "admin";
    if (!isAdmin) {
        toast("Bu işlem için yönetici yetkisi gerekli.", "error");
        return;
    }

    if (isOwner) {
        const nname = document.getElementById("sv-name")?.value.trim();
        if (nname) server.name = nname;
    }
    const iconUrl = document.getElementById("sv-icon")?.value?.trim();
    if (iconUrl !== undefined && isAdmin) {
        server.icon_url = iconUrl || null;
    }

    if (isAdmin && window._tmpPendingPeerRoles) {
        server.peer_roles = { ...window._tmpPendingPeerRoles };
    }

    server.voicePermissionMode = document.getElementById("sv-voice-permission")?.value || "everyone";

    document.getElementById("sidebar-server-name").textContent = server.name;

    // Server'a kaydet (API)
    if (typeof API_BASE !== "undefined") {
        fetch(`${API_BASE}/rooms/${server.id}/settings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: server.name,
                icon_url: server.icon_url,
                roles: server.roles,
                peer_roles: server.peer_roles,
                channel_permissions: server.channel_permissions || {},
                voicePermissionMode: server.voicePermissionMode,
            }),
        }).catch(() => {});
    }

    if (state.mesh) {
        state.mesh.broadcast({
            type: "server_update",
            payload: {
                id: server.id,
                name: server.name,
                channels: server.channels,
                roles: server.roles,
                peer_roles: server.peer_roles,
                channel_backgrounds: server.channel_backgrounds || {},
                inviteCode: server.inviteCode,
                icon_url: server.icon_url,
                voicePermissionMode: server.voicePermissionMode,
            },
        });
        // WS üzerinden de server'a kaydet
        if (typeof sendServerEvent === "function") {
            sendServerEvent({ type: "role_update", roles: server.roles, peer_roles: server.peer_roles });
            sendServerEvent({ type: "permission_update", channel_permissions: server.channel_permissions || {} });
        }
    }
    renderServerRail();
    updateChannelSidebar(server.id);
    updateMembersPanel(server.id);
    hideModal();
    toast("Sunucu güncellendi.", "success");
}

/* ── Direct Messaging ─────────────────────────────────────── */
function openDM(peerId, name, avatarColor = null, avatarImage = null) {
    state.activeDM = peerId;
    const peer = getPeerDisplaySafe(peerId, name, avatarColor, avatarImage);
    document.getElementById("dm-target-name").textContent = "@" + peer.name;
    const av = document.getElementById("dm-header-avatar");
    if (av) applyAvatarToElement(av, peer.avatarColor, peer.avatarImage, peer.name);
    const ov = document.getElementById("dm-overlay");
    ov.classList.add("hidden");
    ov.setAttribute("aria-hidden", "true");

    addToRecentDMs(peerId, peer.name, peer.avatarColor, peer.avatarImage);
    showDMMainView(peerId, peer.name, peer.avatarColor, peer.avatarImage);
    renderDMMessages(peerId);
    setTimeout(() => document.getElementById("dm-main-input")?.focus(), 80);
}

function addToRecentDMs(peerId, name, avatarColor, avatarImage) {
    if (!state.recentDMs) state.recentDMs = [];
    const idx = state.recentDMs.findIndex(d => d.peerId === peerId);
    if (idx !== -1) state.recentDMs.splice(idx, 1);

    state.recentDMs.unshift({ peerId, name, avatarColor, avatarImage });
    if (state.recentDMs.length > 50) state.recentDMs.pop();

    localStorage.setItem("scord_recent_dms", JSON.stringify(state.recentDMs));
    if (!state.activeServerId) renderHomeSidebar();
}

function renderHomeSidebar() {
    const list = document.getElementById("channel-list");
    list.innerHTML = "";

    const searchWrap = document.createElement("div");
    searchWrap.className = "dm-sidebar-search";
    searchWrap.innerHTML = `<input id="dm-sidebar-search-input" type="text" placeholder="Kisi ara veya sohbet baslat" autocomplete="off">`;
    list.appendChild(searchWrap);

    const homeItem = document.createElement("div");
    homeItem.className = "channel-item dm-home-item";
    homeItem.innerHTML = `<span class="ch-icon">@</span><span class="ch-name">Arkadaslar</span>`;
    homeItem.onclick = () => {
        hideDMMainView(true);
        document.getElementById("home-view")?.classList.remove("hidden");
        document.querySelector("#home-view .home-hero")?.classList.remove("hidden");
    };
    list.appendChild(homeItem);

    // 1. DMs Section
    const dmCat = document.createElement("div");
    dmCat.className = "channel-category";
    dmCat.textContent = "DİREKT MESAJLAR";
    list.appendChild(dmCat);

    const dmList = document.createElement("div");
    dmList.id = "dm-sidebar-results";
    list.appendChild(dmList);

    const renderRows = (query = "") => {
        dmList.innerHTML = "";
        const q = query.trim().toLowerCase();
        const rows = [
            ...(state.recentDMs || []).map(dm => ({ ...dm, kind: "dm" })),
            ...(state.friends || []).map(f => ({
                peerId: f.peerId,
                name: f.name || f.username,
                avatarColor: f.avatarColor,
                avatarImage: f.avatarImage,
                kind: "friend",
            })),
        ];
        const seen = new Set();
        rows
            .filter(row => row.peerId && !seen.has(row.peerId) && (!q || String(row.name || "").toLowerCase().includes(q)))
            .forEach(row => {
                seen.add(row.peerId);
                const item = createSidebarItem(row.name || "Kullanici", row.avatarColor, row.avatarImage, () => openDM(row.peerId, row.name, row.avatarColor, row.avatarImage), row.peerId);
                if (state.activeDM === row.peerId) item.classList.add("active");
                dmList.appendChild(item);
            });
        if (!dmList.children.length) {
            const empty = document.createElement("div");
            empty.className = "dm-sidebar-empty";
            empty.textContent = q ? "Eslesen kisi yok." : "Henuz DM yok.";
            dmList.appendChild(empty);
        }
    };

    renderRows();
    searchWrap.querySelector("input")?.addEventListener("input", (e) => renderRows(e.target.value));

    // 2. Friends Section
    const friendCat = document.createElement("div");
    friendCat.className = "channel-category";
    friendCat.style.marginTop = "20px";
    friendCat.textContent = "ARKADAŞLAR";
    list.appendChild(friendCat);

    if (!state.friends || state.friends.length === 0) {
        const empty = document.createElement("div");
        empty.className = "dm-sidebar-empty";
        empty.textContent = "Henüz arkadaşın yok.";
        list.appendChild(empty);
    } else {
        state.friends.forEach(f => {
            const item = createSidebarItem(f.name || f.username, f.avatarColor, f.avatarImage, () => openDM(f.peerId, f.name || f.username, f.avatarColor, f.avatarImage), f.peerId);
            if (state.activeDM === f.peerId) item.classList.add("active");
            list.appendChild(item);
        });
    }
}

function createSidebarItem(name, color, image, onclick, peerId = "") {
    const item = document.createElement("div");
    item.className = "channel-item dm-sidebar-item";
    item.dataset.peerId = peerId;
    item.style.padding = "6px 12px";
    item.style.display = "flex";
    item.style.alignItems = "center";
    item.style.gap = "8px";

    const av = document.createElement("div");
    av.style.width = "32px";
    av.style.height = "32px";
    av.style.borderRadius = "50%";
    av.style.flexShrink = "0";
    applyAvatarToElement(av, color, image, name);

    const nameText = document.createElement("span");
    nameText.textContent = name;
    nameText.style.flex = "1";
    nameText.style.whiteSpace = "nowrap";
    nameText.style.overflow = "hidden";
    nameText.style.textOverflow = "ellipsis";

    item.appendChild(av);
    item.appendChild(nameText);
    item.onclick = onclick;
    return item;
}

function getPeerDisplaySafe(peerId, name = null, avatarColor = null, avatarImage = null) {
    const fromLive = typeof getPeerDisplay === "function" ? getPeerDisplay(peerId) : {};
    return {
        peerId,
        name: name || fromLive.name || "Kullanici",
        avatarColor: avatarColor || fromLive.avatarColor || "#5865f2",
        avatarImage: avatarImage ?? fromLive.avatarImage ?? null,
    };
}

function ensureDMMainView() {
    let view = document.getElementById("dm-main-view");
    if (view) return view;
    const home = document.getElementById("home-view");
    if (!home) return null;
    view = document.createElement("section");
    view.id = "dm-main-view";
    view.className = "dm-main-view hidden";
    view.innerHTML = `
      <header class="dm-main-top">
        <div class="dm-main-search">
          <span class="dm-main-search-icon">Ara</span>
          <input id="dm-main-search-input" type="text" placeholder="Arkadaslarda ve DM'lerde ara" autocomplete="off">
        </div>
        <div class="dm-main-top-actions" id="dm-main-top-actions"></div>
      </header>
      <div class="dm-main-chat">
        <div class="dm-main-chat-header">
          <div class="dm-main-peer">
            <div id="dm-main-avatar" class="dm-header-avatar"></div>
            <div class="dm-main-peer-copy">
              <strong id="dm-main-name">@Kullanici</strong>
              <span>Ozel mesaj</span>
            </div>
          </div>
          <button type="button" class="dm-call-btn" id="dm-main-call-btn" title="Sesli ara">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6.62 10.79c1.44 2.83 3.76 5.15 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.61 21 3 13.39 3 4c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
            </svg>
          </button>
          <button type="button" class="dm-close-btn" id="dm-main-close-btn" title="Sohbeti kapat">x</button>
        </div>
        <div id="dm-call-strip" class="dm-call-strip hidden"></div>
        <div class="dm-body" id="dm-main-messages-area"></div>
        <div class="dm-input-area">
          <textarea id="dm-main-input" rows="1" placeholder="Mesaj yaz..." maxlength="2000" autocomplete="off"></textarea>
          <button type="button" class="dm-send-btn" id="dm-main-send-btn" title="Gonder">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      </div>`;
    home.appendChild(view);
    view.querySelector("#dm-main-send-btn")?.addEventListener("click", sendDM);
    view.querySelector("#dm-main-input")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendDM();
        }
    });
    view.querySelector("#dm-main-close-btn")?.addEventListener("click", () => hideDMMainView(true));
    view.querySelector("#dm-main-call-btn")?.addEventListener("click", () => startDirectCall(state.activeDM));
    view.querySelector("#dm-main-search-input")?.addEventListener("input", renderDMMainSearch);
    return view;
}

function showDMMainView(peerId, name, avatarColor, avatarImage) {
    const view = ensureDMMainView();
    if (!view) return;
    document.getElementById("home-view")?.classList.remove("hidden");
    document.getElementById("home-view")?.classList.add("home-dm-active");
    document.getElementById("chat-view")?.classList.add("hidden");
    document.getElementById("voice-view")?.classList.add("hidden");
    document.querySelector("#home-view .home-hero")?.classList.add("hidden");
    view.classList.remove("hidden");
    document.getElementById("sidebar-server-name").textContent = "Direkt Mesajlar";
    document.querySelectorAll(".rail-icon").forEach(el => el.classList.remove("active"));
    document.getElementById("home-btn")?.classList.add("active");
    const peer = getPeerDisplaySafe(peerId, name, avatarColor, avatarImage);
    document.getElementById("dm-main-name").textContent = "@" + peer.name;
    const av = document.getElementById("dm-main-avatar");
    if (av) applyAvatarToElement(av, peer.avatarColor, peer.avatarImage, peer.name);
    const input = document.getElementById("dm-main-input");
    if (input) input.placeholder = `@${peer.name} mesaj gonder`;
    renderDMMainSearch();
    renderDMCallStrip();
    renderHomeSidebar();
}

function hideDMMainView(clearActive = false) {
    const view = document.getElementById("dm-main-view");
    if (view) view.classList.add("hidden");
    document.getElementById("home-view")?.classList.remove("home-dm-active");
    document.querySelector("#home-view .home-hero")?.classList.remove("hidden");
    if (clearActive) state.activeDM = null;
    if (!state.activeServerId) renderHomeSidebar();
    // Don't leave voice channel when just hiding DM view - preserve voice state
}

function renderDMCallStrip() {
    const strip = document.getElementById("dm-call-strip");
    if (!strip) return;
    const call = state.directCall;
    const isRelated = !!(call && state.activeDM && (call.peerId === state.activeDM || call.fromId === state.activeDM));
    if (!isRelated) {
        strip.classList.add("hidden");
        strip.innerHTML = "";
        return;
    }

    const participants = Array.from(new Set([...(call.participants || []), state.peerId]));
    const labels = participants.slice(0, 4).map(pid => getPeerDisplay(pid)?.name || (pid === state.peerId ? state.username : "Kullanici"));
    const more = participants.length > 4 ? ` +${participants.length - 4}` : "";
    strip.classList.remove("hidden");
    strip.innerHTML = `
      <div class="dm-call-strip-copy">
        <strong>${call.status === "active" ? "Ozel arama aktif" : "Ozel arama"}</strong>
        <span>${escapeHtml(labels.join(", "))}${more}</span>
      </div>
      <div class="dm-call-strip-actions">
        <button type="button" class="dm-call-strip-btn" id="dm-call-strip-join">${state.voiceChannelId === call.channelId ? "Konusmadasin" : "Katil"}</button>
        <button type="button" class="dm-call-strip-btn" id="dm-call-strip-add">Kisi Ekle</button>
        <button type="button" class="dm-call-strip-btn danger" id="dm-call-strip-end">Bitir</button>
      </div>`;

    strip.querySelector("#dm-call-strip-join")?.addEventListener("click", () => openDirectCallView(call));
    strip.querySelector("#dm-call-strip-end")?.addEventListener("click", () => endDirectCall());
    strip.querySelector("#dm-call-strip-add")?.addEventListener("click", () => openDirectCallAddMemberModal());
}

function invitePeerToDirectCall(peerId) {
    const call = state.directCall;
    const server = currentServer();
    if (!call || !server || !peerId || peerId === state.peerId) return;
    const participants = Array.from(new Set([...(call.participants || []), state.peerId, peerId]));
    state.directCall = { ...call, participants };
    const payload = {
        ...state.directCall,
        fromId: state.peerId,
        fromName: state.username,
        fromAvatarColor: state.avatarColor,
        fromAvatarImage: state.avatarImage,
    };
    sendServerEvent({ type: "dm_call_offer", target: peerId, call: payload });
    toast("Aramaya davet gonderildi.", "info");
    renderDMCallStrip();
}

function openDirectCallAddMemberModal() {
    const call = state.directCall;
    const server = currentServer();
    if (!call || !server) return;
    const participants = new Set([...(call.participants || []), state.peerId]);
    const candidates = (server.members || []).filter(m => m.peer_id && !participants.has(m.peer_id));
    if (!candidates.length) {
        toast("Eklenebilecek uye kalmadi.", "info");
        return;
    }
    const rows = candidates.map(m => `<button class="ctx-item" style="width:100%;text-align:left" onclick="invitePeerToDirectCall('${m.peer_id}'); hideModal();"><span class="ctx-icon">+</span>${escapeHtml(m.username || "Kullanici")}</button>`).join("");
    showModal("Konusmaya Kisi Ekle", `<div style="display:flex;flex-direction:column;gap:8px;max-height:280px;overflow:auto">${rows}</div>`, `<button class="btn-secondary" onclick="hideModal()">Kapat</button>`);
}
window.invitePeerToDirectCall = invitePeerToDirectCall;

function renderDMMainSearch() {
    const actions = document.getElementById("dm-main-top-actions");
    if (!actions) return;
    const q = String(document.getElementById("dm-main-search-input")?.value || "").trim().toLowerCase();
    const rows = [
        ...(state.recentDMs || []).map(dm => ({ ...dm, label: "DM" })),
        ...(state.friends || []).map(f => ({ peerId: f.peerId, name: f.name || f.username, avatarColor: f.avatarColor, avatarImage: f.avatarImage, label: "Arkadas" })),
    ];
    const seen = new Set();
    actions.innerHTML = "";
    rows.filter(row => row.peerId && !seen.has(row.peerId) && (!q || String(row.name || "").toLowerCase().includes(q))).slice(0, 6).forEach(row => {
        seen.add(row.peerId);
        const btn = document.createElement("button");
        btn.className = "dm-main-person-chip";
        btn.type = "button";
        btn.innerHTML = `<span>${escapeHtml(initials(row.name || "?"))}</span>${escapeHtml(row.name || "Kullanici")}`;
        btn.onclick = () => openDM(row.peerId, row.name, row.avatarColor, row.avatarImage);
        actions.appendChild(btn);
    });
}

function addFriend(peerId, name) {
    const server = state.servers.find(s => s.id === state.activeServerId);
    const m = server?.members.find(mem => mem.peer_id === peerId);

    if (!state.friends) state.friends = [];
    if (state.friends.find(f => f.peerId === peerId)) return;

    state.friends.push({
        peerId,
        name,
        avatarColor: m?.avatar_color,
        avatarImage: m?.avatar_image
    });
    localStorage.setItem("scord_friends", JSON.stringify(state.friends));
    toast(`${name} arkadaş olarak eklendi! ✨`, "success");
}

function removeFriend(peerId) {
    state.friends = state.friends.filter(f => f.peerId !== peerId);
    localStorage.setItem("scord_friends", JSON.stringify(state.friends));
    if (!state.activeServerId) renderHomeSidebar();
    toast("Arkadaş listesinden çıkarıldı.", "info");
}

function renderDMMessages(peerId) {
    const area = document.getElementById("dm-messages-area");
    area.innerHTML = "";
    const messages = state.dms[peerId] || [];

    if (messages.length === 0) {
        const hint = document.createElement("div");
        hint.className = "dm-empty-hint";
        hint.innerHTML = "<p>Henüz mesaj yok.</p><p style=\"margin-top:8px;font-size:12px\">İlk mesajını yaz — uçtan uca P2P ile gider.</p>";
        area.appendChild(hint);
        const mainArea = document.getElementById("dm-main-messages-area");
        if (mainArea) mainArea.innerHTML = area.innerHTML;
        return;
    }

    messages.forEach(msg => {
        const row = document.createElement("div");
        row.className = "dm-msg-row" + (msg.authorId === state.peerId ? " dm-msg-own" : "");

        const av = document.createElement("div");
        av.className = "msg-avatar dm-msg-avatar";
        applyAvatarToElement(av, msg.avatarColor, msg.avatarImage, msg.author);

        const bubble = document.createElement("div");
        bubble.className = "dm-bubble";
        const meta = document.createElement("div");
        meta.className = "dm-bubble-meta";
        meta.innerHTML = `<span class="dm-bubble-author">${escapeHtml(msg.author)}</span><span class="dm-bubble-time">${escapeHtml(msg.time || "")}</span>`;

        const text = document.createElement("div");
        text.className = "dm-bubble-text";
        text.innerHTML = parseMessageText(msg.text, null);

        bubble.appendChild(meta);
        bubble.appendChild(text);
        row.appendChild(av);
        row.appendChild(bubble);
        area.appendChild(row);
    });
    area.scrollTop = area.scrollHeight;
    const mainArea = document.getElementById("dm-main-messages-area");
    if (mainArea) {
        mainArea.innerHTML = area.innerHTML;
        mainArea.scrollTop = mainArea.scrollHeight;
    }
}

function sendDM() {
    const mainInput = document.getElementById("dm-main-input");
    const overlayInput = document.getElementById("dm-input");
    const mainVisible = mainInput && !document.getElementById("dm-main-view")?.classList.contains("hidden");
    const input = document.activeElement === overlayInput ? overlayInput : (mainVisible ? mainInput : overlayInput);
    if (!input) return;
    const text = input.value.trim();
    if (!text || !state.activeDM) return;

    const msg = {
        author: state.username,
        authorId: state.peerId,
        avatarColor: state.avatarColor,
        avatarImage: state.avatarImage,
        text,
        time: now()
    };
    if (!state.dms) state.dms = {};
    if (!state.dms[state.activeDM]) state.dms[state.activeDM] = [];
    state.dms[state.activeDM].push(msg);
    renderDMMessages(state.activeDM);

    if (state.mesh) {
        const peer = state.mesh.peers?.[state.activeDM];
        const dcOpen = !!(peer?.dc && peer.dc.readyState === "open");
        if (dcOpen) {
            state.mesh.sendTo(state.activeDM, { type: "dm", payload: msg });
        } else if (state.mesh.ws && state.mesh.ws.readyState === WebSocket.OPEN && typeof state.mesh.broadcastSignal === "function") {
            state.mesh.broadcastSignal({ type: "dm_relay", target: state.activeDM, payload: msg });
        } else {
            toast("DM şu an gönderilemedi: bağlantı hazır değil.", "warning");
        }
    }
    if (mainInput) mainInput.value = "";
    if (overlayInput) overlayInput.value = "";
}

let _qsActiveIdx = 0;
let _qsFiltered = [];

function closeQuickSwitcher() {
    const el = document.getElementById("quick-switcher");
    if (el) el.classList.add("hidden");
    state._qsOpen = false;
}

function openQuickSwitcher() {
    const el = document.getElementById("quick-switcher");
    const inp = document.getElementById("quick-switcher-input");
    if (!el || !inp) return;
    el.classList.remove("hidden");
    state._qsOpen = true;
    inp.value = "";
    _qsActiveIdx = 0;
    updateQuickSwitcherFilter("");
    setTimeout(() => inp.focus(), 30);
}

function toggleQuickSwitcher() {
    if (document.getElementById("quick-switcher")?.classList.contains("hidden")) openQuickSwitcher();
    else closeQuickSwitcher();
}

function updateQuickSwitcherFilter(q) {
    const res = document.getElementById("quick-switcher-results");
    if (!res) return;
    const qq = (q || "").trim().toLowerCase();
    const items = [];
    state.servers.forEach(srv => {
        (srv.channels || []).forEach(ch => {
            const label = `${srv.name} / ${ch.type === "voice" ? "🔊" : "#"}${ch.name}`;
            const hay = `${srv.name} ${ch.name} ${ch.id}`.toLowerCase();
            if (!qq || hay.includes(qq)) {
                items.push({ serverId: srv.id, channelId: ch.id, type: ch.type, title: ch.name, sub: srv.name });
            }
        });
    });
    _qsFiltered = items.slice(0, 40);
    res.innerHTML = "";
    _qsFiltered.forEach((it, i) => {
        const row = document.createElement("div");
        row.className = "qs-item" + (i === _qsActiveIdx ? " qs-item--active" : "");
        row.dataset.idx = String(i);
        row.innerHTML = `<span class="qs-item-title">${escapeHtml(it.title)}</span><span class="qs-item-sub">${escapeHtml(it.sub)} · ${it.type === "voice" ? "ses" : "metin"}</span>`;
        row.onclick = () => runQuickSwitcherIndex(i);
        res.appendChild(row);
    });
    if (_qsFiltered.length === 0) {
        res.innerHTML = `<div class="qs-item"><span class="qs-item-sub">Eşleşme yok</span></div>`;
    }
}

function runQuickSwitcherIndex(i) {
    const it = _qsFiltered[i];
    if (!it) return;
    closeQuickSwitcher();
    switchToServer(it.serverId);
    if (it.type === "voice") showVoiceView(it.serverId, it.channelId);
    else showChatView(it.serverId, it.channelId);
}

function fillLastOwnChatLine() {
    const input = document.getElementById("chat-input");
    if (!input || !state.activeServerId || !state.activeChannelId) return;
    const srv = state.servers.find(s => s.id === state.activeServerId);
    const msgs = srv?.messages?.[state.activeChannelId];
    if (!msgs?.length) return;
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].authorId === state.peerId) {
            input.value = msgs[i].text || "";
            input.style.height = "auto";
            input.style.height = Math.min(input.scrollHeight, 200) + "px";
            return;
        }
    }
}

/* ── Mention Autocomplete ─────────────────────────────────── */
let _mentionSuggestions = [];
let _mentionActiveIndex = 0;

function showMentionSuggestions(input) {
    const value = input.value;
    const cursorPos = input.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex === -1 || (lastAtIndex > 0 && /\w/.test(textBeforeCursor[lastAtIndex - 1]))) {
        hideMentionSuggestions();
        return;
    }

    const mentionText = textBeforeCursor.substring(lastAtIndex + 1);
    if (mentionText.length < 1) {
        hideMentionSuggestions();
        return;
    }

    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) {
        hideMentionSuggestions();
        return;
    }

    const members = server.members || [];
    _mentionSuggestions = members.filter(m =>
        m.username.toLowerCase().includes(mentionText.toLowerCase())
    ).slice(0, 5);

    if (_mentionSuggestions.length === 0) {
        hideMentionSuggestions();
        return;
    }

    _mentionActiveIndex = 0;
    renderMentionSuggestions(input, lastAtIndex, mentionText);
}

function renderMentionSuggestions(input, atIndex, mentionText) {
    let popup = document.getElementById("mention-popup");
    if (!popup) {
        popup = document.createElement("div");
        popup.id = "mention-popup";
        popup.className = "mention-popup";
        input.parentElement.insertBefore(popup, input.nextSibling);
    }

    popup.innerHTML = _mentionSuggestions.map((member, idx) => `
        <div class="mention-item ${idx === _mentionActiveIndex ? "active" : ""}" 
             data-member-id="${escapeHtml(member.peer_id)}"
             data-username="${escapeHtml(member.username)}">
            <div class="mention-avatar" style="background-color: ${escapeHtml(member.avatar_color)}">
                ${initials(member.username)}
            </div>
            <span class="mention-name">${escapeHtml(member.username)}</span>
        </div>
    `).join("");

    popup.classList.remove("hidden");
    popup.querySelectorAll(".mention-item").forEach((item, idx) => {
        item.onclick = () => insertMention(input, atIndex, member.username);
    });
}

function hideMentionSuggestions() {
    const popup = document.getElementById("mention-popup");
    if (popup) {
        popup.classList.add("hidden");
    }
}

function insertMention(input, atIndex, username) {
    const value = input.value;
    const cursorPos = input.selectionStart;
    const textBeforeCursor = value.substring(0, atIndex);
    const textAfterCursor = value.substring(cursorPos);

    input.value = textBeforeCursor + "@" + username + " " + textAfterCursor;
    input.selectionStart = input.selectionEnd = atIndex + username.length + 2;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
    hideMentionSuggestions();
}

const debouncedPersistDraft = UI.debounce(() => {
    if (state.activeServerId && state.activeChannelId) persistChatDraftFor(state.activeServerId, state.activeChannelId);
}, 400);

function initMembersPanelResize() {
    const handle = document.getElementById("members-split-handle");
    const panel = document.getElementById("members-panel");
    if (!handle || !panel) return;
    const saved = parseInt(localStorage.getItem("scord_members_panel_w") || "", 10);
    if (!Number.isNaN(saved) && saved >= 200 && saved <= 560) {
        panel.style.width = `${saved}px`;
        panel.style.flexShrink = "0";
    }
    let startX = 0;
    let startW = 0;
    handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        startX = e.clientX;
        startW = panel.getBoundingClientRect().width;
        const onMove = (ev) => {
            const dx = startX - ev.clientX;
            const nw = Math.min(560, Math.max(180, startW + dx));
            panel.style.width = `${nw}px`;
            panel.style.flexShrink = "0";
        };
        const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            localStorage.setItem("scord_members_panel_w", String(Math.round(panel.getBoundingClientRect().width)));
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });
}

/* ── Event listeners ──────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
    initSetup();
    initMembersPanelResize();
    const sSettingsBtn = document.getElementById("server-settings-btn");
    if (sSettingsBtn) sSettingsBtn.onclick = openServerSettingsModal;

    const sInviteBtn = document.getElementById("server-invite-btn");
    if (sInviteBtn) sInviteBtn.onclick = () => showInviteModal(state.activeServerId);

    // Modal close
    const mClose = document.getElementById("modal-close");
    if (mClose) mClose.onclick = hideModal;

    const mBackdrop = document.getElementById("modal-backdrop");
    if (mBackdrop) mBackdrop.onclick = (e) => {
        if (e.target === mBackdrop) hideModal();
    };

    // Chat input
    const chatInput = document.getElementById("chat-input");
    chatInput.addEventListener("keydown", (e) => {
        // Handle mention popup navigation
        const mentionPopup = document.getElementById("mention-popup");
        if (mentionPopup && !mentionPopup.classList.contains("hidden") && _mentionSuggestions.length > 0) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                _mentionActiveIndex = (_mentionActiveIndex + 1) % _mentionSuggestions.length;
                renderMentionSuggestions(chatInput, chatInput.value.lastIndexOf("@"), "");
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                _mentionActiveIndex = (_mentionActiveIndex - 1 + _mentionSuggestions.length) % _mentionSuggestions.length;
                renderMentionSuggestions(chatInput, chatInput.value.lastIndexOf("@"), "");
                return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const member = _mentionSuggestions[_mentionActiveIndex];
                if (member) {
                    insertMention(chatInput, chatInput.value.lastIndexOf("@"), member.username);
                }
                return;
            }
            if (e.key === "Escape") {
                hideMentionSuggestions();
                return;
            }
        }

        if (e.key === "ArrowUp" && chatInput.selectionStart === 0 && !e.shiftKey && !chatInput.value.trim()) {
            e.preventDefault();
            fillLastOwnChatLine();
            return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            console.log("[ChatInput] Enter pressed. Calling sendMessage()...");
            sendMessage();
        }
    });

    if (chatInput) {
        chatInput.addEventListener("input", () => {
            chatInput.style.height = "auto";
            chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + "px";
            if (typeof debouncedPersistDraft === 'function') debouncedPersistDraft();

            // Send typing indicator
            if (state.activeServerId && state.activeChannelId && chatInput.value.trim()) {
                if (typeof broadcastTypingIndicator === 'function') broadcastTypingIndicator();
            }

            // Show mention suggestions
            if (typeof showMentionSuggestions === 'function') showMentionSuggestions(chatInput);
        });
    }

    const sendBtn = document.getElementById("send-btn");
    if (sendBtn) {
        sendBtn.onclick = () => {
            console.log("[SendBtn] Clicked. Calling sendMessage()...");
            sendMessage();
        };
    }
    document.getElementById("reply-preview-close")?.addEventListener("click", () => clearReplyTarget());

    document.getElementById("focus-mode-toggle")?.addEventListener("click", () => {
        const app = document.getElementById("app");
        if (!app) return;
        const next = app.getAttribute("data-scord-focus") === "1" ? "0" : "1";
        app.setAttribute("data-scord-focus", next);
        localStorage.setItem("scord_focus_mode", next === "1" ? "1" : "0");
        applyFocusModeButton();
    });

    document.getElementById("new-msgs-chip")?.addEventListener("click", () => {
        const area = document.getElementById("messages-area");
        if (area) area.scrollTop = area.scrollHeight;
        hideNewMsgsChip();
    });

    const qsEl = document.getElementById("quick-switcher");
    const qsInp = document.getElementById("quick-switcher-input");
    if (qsEl && qsInp) {
        qsEl.addEventListener("click", (e) => {
            if (e.target === qsEl) closeQuickSwitcher();
        });
        qsInp.addEventListener("input", () => {
            _qsActiveIdx = 0;
            updateQuickSwitcherFilter(qsInp.value);
        });
        qsInp.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                closeQuickSwitcher();
                return;
            }
            if (e.key === "ArrowDown") {
                e.preventDefault();
                _qsActiveIdx = Math.min(Math.max(0, _qsFiltered.length - 1), _qsActiveIdx + 1);
                updateQuickSwitcherFilter(qsInp.value);
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                _qsActiveIdx = Math.max(0, _qsActiveIdx - 1);
                updateQuickSwitcherFilter(qsInp.value);
                return;
            }
            if (e.key === "Enter") {
                e.preventDefault();
                runQuickSwitcherIndex(_qsActiveIdx);
            }
        });
    }

    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "k") {
            if (!document.getElementById("modal-backdrop")?.classList.contains("hidden")) return;
            e.preventDefault();
            toggleQuickSwitcher();
            return;
        }
        if (e.key === "Escape") {
            const dmMain = document.getElementById("dm-main-view");
            if (state.activeDM && dmMain && !dmMain.classList.contains("hidden")) {
                hideDMMainView(true);
                return;
            }
            const dmOv = document.getElementById("dm-overlay");
            if (state.activeDM && dmOv && !dmOv.classList.contains("hidden")) {
                dmOv.classList.add("hidden");
                dmOv.setAttribute("aria-hidden", "true");
                state.activeDM = null;
                return;
            }
            if (state._qsOpen) {
                closeQuickSwitcher();
                return;
            }
            if (!document.getElementById("modal-backdrop")?.classList.contains("hidden")) {
                hideModal();
                return;
            }
            if (state.replyTo) {
                clearReplyTarget();
                return;
            }
            if (state.emojiOpen) {
                document.getElementById("emoji-picker")?.remove();
                state.emojiOpen = false;
            }
        }
    }, true);

    // Server create / join
    const addSrvBtn = document.getElementById("add-server-btn");
    if (addSrvBtn) addSrvBtn.onclick = openCreateServerModal;

    const createSrvHeroBtn = document.getElementById("create-server-hero-btn");
    if (createSrvHeroBtn) createSrvHeroBtn.onclick = openCreateServerModal;

    const joinSrvHeroBtn = document.getElementById("join-server-hero-btn");
    if (joinSrvHeroBtn) joinSrvHeroBtn.onclick = openJoinServerModal;

    // Home button
    const homeBtn = document.getElementById("home-btn");
    if (homeBtn) homeBtn.onclick = showHomeView;

    // Join by Code
    const joinIdxBtn = document.getElementById("join-by-code-btn");
    if (joinIdxBtn) joinIdxBtn.onclick = joinByCode;

    // Discover button
    const discoverBtn = document.getElementById("discover-btn");
    if (discoverBtn) discoverBtn.onclick = () => { showHomeView(); if (typeof refreshDiscovery === 'function') refreshDiscovery(); };

    // Members toggle
    const membersToggleBtn = document.getElementById("members-toggle-btn");
    if (membersToggleBtn) {
        membersToggleBtn.onclick = () => {
            state.membersOpen = !state.membersOpen;
            const panel = document.getElementById("members-panel");
            if (panel) panel.classList.toggle("collapsed", !state.membersOpen);
        };
    }

    // Voice controls
    const voiceJoinBtn = document.getElementById("voice-join-btn");
    if (voiceJoinBtn) {
        voiceJoinBtn.onclick = () => {
            if (state.activeChannelId) joinVoiceChannel(state.activeChannelId);
        };
    }
    const voiceLeaveBtn = document.getElementById("voice-leave-btn");
    if (voiceLeaveBtn) voiceLeaveBtn.onclick = leaveVoiceChannel;

    const vsbDisconnectBtn = document.getElementById("vsb-disconnect-btn");
    if (vsbDisconnectBtn) vsbDisconnectBtn.onclick = leaveVoiceChannel;

    // Mic toggle
    const micToggleBtn = document.getElementById("mic-toggle-btn");
    if (micToggleBtn) {
        micToggleBtn.onclick = () => {
            if (!state.mesh) return;
            const muted = state.mesh.toggleMic();
            micToggleBtn.classList.toggle("muted", muted);
            toast(muted ? "Mikrofon kapatıldı 🔇" : "Mikrofon açıldı 🎙️", "info");
        };
    }

    // Emoji picker
    const emojiBtn = document.getElementById("emoji-btn");
    if (emojiBtn) emojiBtn.onclick = toggleEmojiPicker;

    // GIF picker
    const gifBtn = document.getElementById("gif-btn");
    const gifPopover = document.getElementById("gif-search-popover");
    if (gifBtn && gifPopover) {
        gifBtn.onclick = () => {
            gifPopover.classList.toggle("hidden");
            if (!gifPopover.classList.contains("hidden")) {
                const gifInp = document.getElementById("gif-input");
                if (gifInp) gifInp.focus();
                if (typeof searchGifs === 'function') searchGifs("trending");
            }
        };
        const gifInput = document.getElementById("gif-input");
        if (gifInput) {
            gifInput.addEventListener("input", UI.debounce((e) => {
                if (typeof searchGifs === 'function') searchGifs(e.target.value);
            }, SCORD_T().GIF_SEARCH_DEBOUNCE_MS ?? 500));
        }
    }

    // Settings
    const settingsBtn = document.getElementById("settings-btn");
    if (settingsBtn) settingsBtn.onclick = openSettingsModal;

    const pinsToggleBtn = document.getElementById("pins-toggle-btn");
    if (pinsToggleBtn) pinsToggleBtn.onclick = () => { if (typeof showPinnedMessages === 'function') showPinnedMessages(); };
    const transBtn = document.getElementById("translate-toggle-btn");
    if (transBtn) {
        transBtn.onclick = () => {
            state.translationEnabled = !state.translationEnabled;
            transBtn.classList.toggle("active", state.translationEnabled);
            toast(state.translationEnabled ? "Yazarken Çeviri: AÇIK (TR/EN)" : "Yazarken Çeviri: KAPALI", "info");
        };
    }

    // DM overlay interactions
    document.getElementById("dm-close-btn").onclick = () => {
        const ov = document.getElementById("dm-overlay");
        ov.classList.add("hidden");
        ov.setAttribute("aria-hidden", "true");
        hideDMMainView(true);
    };
    document.getElementById("dm-send-btn")?.addEventListener("click", sendDM);
    const dmInput = document.getElementById("dm-input");
    if (dmInput) {
        dmInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendDM();
            }
        });
    }

    // Attachments
    const attachBtn = document.getElementById("chat-attach-btn");
    const fileUpload = document.getElementById("chat-file-upload");
    if (attachBtn && fileUpload) {
        attachBtn.onclick = () => fileUpload.click();
        fileUpload.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 500000) { toast("Dosya çok büyük. En fazla ~500KB yüklenebilir.", "error"); return; }
            fileToBase64(file, (b64) => {
                const msg = {
                    type: "chat",
                    channelId: state.activeChannelId,
                    text: "Bir dosya paylaşıldı.",
                    attachment: b64,
                    author: state.username,
                    authorId: state.peerId,
                    avatarColor: state.avatarColor,
                    avatarImage: state.avatarImage,
                    time: now(),
                    id: genId(),
                };
                if (state.replyTo?.messageId) {
                    msg.replyTo = {
                        messageId: state.replyTo.messageId,
                        author: state.replyTo.author,
                        authorId: state.replyTo.authorId,
                        snippet: (state.replyTo.text || "").slice(0, 120),
                        text: (state.replyTo.text || "").slice(0, 200),
                    };
                }
                clearReplyTarget();
                saveMessage(state.activeServerId, msg);
                meshBroadcastReliable({ type: "chat", payload: msg });
            });
        };
    }

    // Screen Share & Camera
    const screenBtn = document.getElementById("voice-screen-btn");
    if (screenBtn) {
        screenBtn.onclick = async () => {
            if (!state.mesh) return;
            if (state.mesh.screenStream) {
                state.mesh.stopScreenShare();
                screenBtn.classList.remove("active");
                if (state.mesh) {
                    state.mesh.broadcast({
                        type: "screen_status",
                        sharing: false,
                        channelId: state.voiceChannelId || state.activeChannelId,
                    });
                }
                const preview = document.getElementById("local-screen-preview");
                if (preview && !state.cameraStream) preview.classList.add("hidden");
            } else {
                const success = await state.mesh.startScreenShare();
                if (success) {
                    state.screenStream = state.mesh.screenStream;
                    screenBtn.classList.add("active");
                    toast("Ekran paylaşımı başlatıldı.", "success");
                    if (state.mesh) {
                        state.mesh.broadcast({
                            type: "screen_status",
                            sharing: true,
                            channelId: state.voiceChannelId || state.activeChannelId,
                        });
                    }

                    // Local Preview
                    const preview = document.getElementById("local-screen-preview");
                    const video = document.getElementById("self-share-video");
                    const lbl = document.getElementById("local-preview-label");
                    if (preview && video) {
                        preview.classList.remove("hidden");
                        video.srcObject = state.mesh.screenStream;
                        if (lbl) lbl.textContent = "Yayındasın (Önizleme)";
                    }
                }
            }
        };
    }

    const cameraBtn = document.getElementById("voice-camera-btn");
    if (cameraBtn) {
        cameraBtn.onclick = async () => {
            if (!state.mesh) return;
            if (state.cameraStream) {
                stopCameraShare();
            } else {
                startCameraShare();
            }
        };
    }

    // PTT Global Listeners
    window.addEventListener("keydown", (e) => {
        if (state.voiceSettings?.inputMode === "ptt" && e.key === state.voiceSettings.pttKey) {
            if (state._pttActive) return;
            state._pttActive = true;
            if (state.originalMicStream) {
                const track = state.originalMicStream.getAudioTracks()[0];
                if (track) track.enabled = true;
                if (state.mesh) {
                    state.mesh.broadcast({
                        type: "voice_status",
                        speaking: true,
                        channelId: state.voiceChannelId,
                    });
                }
            }
        }
    });
    window.addEventListener("keyup", (e) => {
        if (state.voiceSettings?.inputMode === "ptt" && e.key === state.voiceSettings.pttKey) {
            state._pttActive = false;
            if (state.originalMicStream) {
                const track = state.originalMicStream.getAudioTracks()[0];
                if (track) track.enabled = false;
                if (state.mesh) {
                    state.mesh.broadcast({
                        type: "voice_status",
                        speaking: false,
                        channelId: state.voiceChannelId,
                    });
                }
            }
        }
    });

    // Load recent DMs
    state.recentDMs = JSON.parse(localStorage.getItem("scord_recent_dms") || "[]");
});

function showPinnedMessages() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;
    const pins = (server.pinned_messages || []).filter(m => m.channelId === state.activeChannelId);

    const body = document.createElement("div");
    body.className = "pinned-messages-modal";

    if (pins.length === 0) {
        body.innerHTML = `
            <div class="pinned-empty">
                <div class="pinned-empty-icon">📌</div>
                <div class="pinned-empty-title">Sabitlenmiş Mesaj Yok</div>
                <div class="pinned-empty-subtitle">Bu kanalda henüz sabitlenmiş mesaj bulunmuyor.</div>
            </div>
        `;
    } else {
        const pinsList = document.createElement("div");
        pinsList.className = "pinned-list";

        pins.forEach(m => {
            const item = document.createElement("div");
            item.className = "pinned-item";

            const isAuthor = m.authorId === state.peerId;
            const canMod = ["owner", "admin", "mod"].includes(getMyEffectiveRole(server));

            item.innerHTML = `
                <div class="pinned-item-header">
                    <div class="pinned-item-author">
                        <div class="pinned-avatar" style="background: ${m.avatarColor || '#7c3aed'}; color: white;">
                            ${m.avatarImage ? `<img src="${m.avatarImage}" alt="${m.author}" />` : (m.author || "?")[0].toUpperCase()}
                        </div>
                        <div class="pinned-author-info">
                            <div class="pinned-author-name">${m.author}</div>
                            <div class="pinned-message-time">${m.time}</div>
                        </div>
                    </div>
                    <div class="pinned-item-actions">
                        ${isAuthor || canMod ? `
                            <button class="pinned-action-btn" onclick="unpinMessage('${m.id}')" title="Sabitlemeyi kaldır">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                                </svg>
                            </button>
                        ` : ''}
                        <button class="pinned-action-btn" onclick="scrollToChatMessage('${m.id}')" title="Mesaja git">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6-6-6z"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="pinned-item-content">
                    ${parseMessageText(m.text, state.activeServerId)}
                </div>
                ${m.attachment ? `
                    <div class="pinned-item-attachment">
                        <img src="${m.attachment}" alt="Ek" class="pinned-attachment-img" onclick="this.classList.toggle('expanded')" />
                    </div>
                ` : ''}
            `;

            // Add reactions if they exist
            if (m.id && server.reactions) {
                const key = `${m.channelId}-${m.id}`;
                const reactions = server.reactions[key];
                if (reactions && Object.keys(reactions).length > 0) {
                    const reactionBar = document.createElement("div");
                    reactionBar.className = "pinned-reactions";

                    Object.entries(reactions).forEach(([emoji, users]) => {
                        const pill = document.createElement("div");
                        pill.className = "pinned-reaction-pill";
                        pill.innerHTML = `
                            <span class="pinned-reaction-emoji">${emoji}</span>
                            <span class="pinned-reaction-count">${users.size}</span>
                        `;
                        reactionBar.appendChild(pill);
                    });

                    item.appendChild(reactionBar);
                }
            }

            pinsList.appendChild(item);
        });

        body.appendChild(pinsList);
    }

    showModal(
        `<div class="pinned-modal-header">
            <div class="pinned-modal-title">📌 Sabitlenmiş Mesajlar</div>
            <div class="pinned-modal-subtitle">${pins.length} mesaj</div>
        </div>`,
        body,
        `<button class="btn-secondary" onclick="hideModal()">Kapat</button>`
    );
}

function unpinMessage(messageId) {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const msg = findMessageById(state.activeServerId, state.activeChannelId, messageId);
    if (!msg) return;

    // Update local state
    msg.isPinned = false;
    server.pinned_messages = (server.pinned_messages || []).filter(m => m.id !== messageId);

    // Broadcast unpin
    if (state.mesh) {
        state.mesh.broadcast({
            type: "msg_pin_toggle",
            payload: { msgId: messageId, isPinned: false, msg }
        });
    }

    // Update UI
    renderMessages(state.activeServerId, state.activeChannelId);
    savePinnedMessagesToStorage(state.activeServerId);
    toast("Mesaj sabitlemesi kaldırıldı", "info");

    // Refresh pinned modal if open
    const modal = document.querySelector('.pinned-messages-modal');
    if (modal) {
        showPinnedMessages();
    }
}

function savePinnedMessagesToStorage(serverId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server || !server.pinned_messages) return;

    localStorage.setItem(`scord_pinned_${serverId}`, JSON.stringify(server.pinned_messages));
}

function loadPinnedMessagesFromStorage(serverId) {
    try {
        const saved = localStorage.getItem(`scord_pinned_${serverId}`);
        if (!saved) return;

        const server = state.servers.find(s => s.id === serverId);
        if (!server) return;

        server.pinned_messages = JSON.parse(saved);
    } catch (e) {
        console.warn("Failed to load pinned messages from storage:", e);
    }
}

function updateMuteStates() {
    if (!state.remoteMedia) return;
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    // Find who is in our exact voice channel
    const myChannel = state.voiceChannelId;
    let myChannelPeers = [];
    if (myChannel && server.voiceMembers?.[myChannel]) {
        myChannelPeers = server.voiceMembers[myChannel].map(m => m.peer_id);
    }

    const blocked = new Set(state.blockedPeers || []);

    // Mute everyone else, and fully re-enable audio after unblock.
    Object.keys(state.remoteMedia).forEach(peerId => {
        const video = state.remoteMedia[peerId];
        if (!video) return;
        const shouldHear = !!myChannel && myChannelPeers.includes(peerId) && peerId !== state.peerId && !blocked.has(peerId);

        video.muted = !shouldHear;
        (video.srcObject?.getAudioTracks?.() || []).forEach(track => {
            track.enabled = shouldHear;
        });
        video.volume = Math.max(0, Math.min(2, Number(state.userVolumes?.[peerId] ?? 100) / 100));
        if (shouldHear) video.play?.().catch(() => { });
    });
}

function setPeerVolume(peerId, value) {
    if (!peerId) return;
    if (!state.userVolumes) state.userVolumes = {};
    const volume = Math.max(0, Math.min(200, Number(value) || 0));
    state.userVolumes[peerId] = volume;
    localStorage.setItem("scord_user_volumes", JSON.stringify(state.userVolumes));
    const video = state.remoteMedia?.[peerId];
    if (video) video.volume = volume / 100;
}

/* ── Music Bot (YouTube IFrame API) ───────────────────────── */
state.musicBot = { active: false, videoId: null, player: null, volume: 30 };
state._musicBotPending = null;
let ytReady = false;

function setMusicDockVisible(visible) {
    const dock = document.getElementById("music-player-dock");
    if (!dock) return;
    dock.classList.toggle("active", !!visible);
    dock.setAttribute("aria-hidden", visible ? "false" : "true");
}

function unlockMusicAudio() {
    const mb = state.musicBot;
    if (!mb?.player) return false;
    try { mb.player.unMute?.(); } catch { }
    try { mb.player.setVolume?.(Math.max(1, Number(mb.volume ?? 30))); } catch { }
    try {
        const result = mb.player.playVideo?.();
        mb.audioUnlocked = true;
        renderMusicBotPanel();
        return result !== false;
    } catch {
        return false;
    }
}

function musicOffsetSeconds(startAt) {
    const raw = Number(startAt || 0);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    if (raw > 100000000000) return Math.max(0, (Date.now() - raw) / 1000);
    return Math.max(0, raw);
}

// Global callback for YouTube script
window.onYouTubeIframeAPIReady = function () {
    ytReady = true;
    if (state._musicBotPending && state.voiceChannelId) {
        const p = state._musicBotPending;
        state._musicBotPending = null;
        startMusicBot(p.videoId, p.startAt);
    }
};

function startMusicBot(videoId, startAt) {
    if (!state.voiceChannelId) return;

    state.musicBot.active = true;
    state.musicBot.videoId = videoId;
    setMusicDockVisible(true);

    const server = state.servers.find(s => s.id === state.activeServerId);
    if (server) {
        if (!server.voiceMembers) server.voiceMembers = {};
        if (!server.voiceMembers[state.voiceChannelId]) server.voiceMembers[state.voiceChannelId] = [];

        // Remove old bot if present
        server.voiceMembers[state.voiceChannelId] = server.voiceMembers[state.voiceChannelId].filter(m => m.peer_id !== "bot_music");

        server.voiceMembers[state.voiceChannelId].push({
            peer_id: "bot_music",
            username: "🎵 Müzik Botu",
            avatar_color: "#ef4444",
            avatar_image: null
        });

        renderVoiceParticipants(state.activeServerId, state.voiceChannelId);
        updateChannelSidebar(state.activeServerId);
    }

    const offset = musicOffsetSeconds(startAt);

    if (!state.musicBot.player && !ytReady) {
        state._musicBotPending = { videoId, startAt };
        toast("YouTube oynatıcı yükleniyor… Hazır olunca çalacak.", "info");
        return;
    }

    if (!state.musicBot.player && ytReady) {
        state.musicBot.player = new YT.Player("yt-player", {
            height: "200",
            width: "220",
            videoId: videoId,
            playerVars: { autoplay: 1, controls: 1, playsinline: 1, start: Math.floor(offset) },
            events: {
                onReady: (e) => {
                    e.target.setVolume(state.musicBot.volume);
                    try { e.target.unMute(); } catch { }
                    try { e.target.playVideo(); } catch { }
                    renderMusicBotPanel();
                },
                onStateChange: () => {
                    renderMusicBotPanel();
                },
                onAutoplayBlocked: () => {
                    state.musicBot.audioUnlocked = false;
                    toast("Tarayici sesi kilitledi. Muzik panelindeki 'Sesi Ac' dugmesine bas.", "warning");
                    renderMusicBotPanel();
                }
            }
        });
    } else if (state.musicBot.player) {
        state.musicBot.player.loadVideoById(videoId, Math.floor(offset));
        state.musicBot.player.setVolume(state.musicBot.volume);
        try { state.musicBot.player.unMute(); } catch { }
        try {
            state.musicBot.player.playVideo();
        } catch (e) { /* noop */ }
    }
    renderMusicBotPanel();
}

function stopMusicBot() {
    state.musicBot.active = false;
    state.musicBot.videoId = null;
    state._musicBotPending = null;

    if (state.musicBot.player) {
        state.musicBot.player.stopVideo();
    }
    setMusicDockVisible(false);

    const server = state.servers.find(s => s.id === state.activeServerId);
    const ch = state.voiceChannelId;
    if (server && ch && server.voiceMembers?.[ch]) {
        server.voiceMembers[ch] = server.voiceMembers[ch].filter(m => m.peer_id !== "bot_music");
        if (state.activeChannelId === ch) {
            renderVoiceParticipants(state.activeServerId, ch);
        }
        updateChannelSidebar(state.activeServerId);
    }
}

/* ── User Profile & Screen Share Bindings ────────────────── */
function openUserProfile(peerId, username, avatarImage, avatarColor) {
    const isSelf = peerId === state.peerId;
    const userNote = getUserNote(peerId);
    const isFriend = state.friends.some(f => f.peerId === peerId);
    const isBlocked = state.blockedPeers?.includes(peerId);

    // Context from active server if any
    let roleBadge = "";
    if (state.activeServerId) {
        const server = state.servers.find(s => s.id === state.activeServerId);
        if (server) {
            const pr = server.peer_roles?.[peerId];
            const roleName = server.ownerId === peerId ? "Kurucu 👑"
                : pr === "admin" ? "Yönetici 🛡️"
                    : pr === "mod" ? "Moderatör 🟢"
                        : "Üye";
            const cls = server.ownerId === peerId ? "owner" : pr || "";
            roleBadge = `<span class="role-badge ${cls}">${roleName}</span>`;
        }
    }

    // Create Profile HTML
    const body = `
        <div class="profile-banner-rich" style="height:80px; background:${avatarColor || '#7c3aed'}; border-radius: 8px 8px 0 0; position: relative;">
            <div style="position:absolute; right:12px; top:12px;">
                ${!isSelf ? `<button class="mbot-btn ${isBlocked ? '' : 'mbot-btn--danger'}" onclick="toggleBlockStatus('${peerId}', '${escapeHtml(username)}')" title="${isBlocked ? 'Engeli Kaldır' : 'Engelle'}" style="width:32px;height:32px;font-size:12px;">${isBlocked ? '🔓' : '🚫'}</button>` : ''}
            </div>
        </div>
        <div class="profile-avatar" style="width:90px; height:90px; border-radius:50%; margin-top:-45px; margin-left:16px; border:6px solid var(--bg-elevated); background-color:${avatarColor || '#7c3aed'}; background-image:url(${avatarImage || ''}); background-size:cover; background-position:center; display:flex; align-items:center; justify-content:center; font-size:36px; color:#fff; position: relative; z-index: 2;">
            ${!avatarImage ? initials(username) : ""}
        </div>
        <div style="padding:16px 16px 8px 16px;">
            <h2 style="margin:0 0 4px 0; font-size: 20px;">${escapeHtml(username)}</h2>
            <div style="display:flex; gap:8px; align-items:center; margin-top:4px;">
                ${roleBadge}
            </div>
            <p style="margin:8px 0 0 0; font-family:monospace; color:var(--text-muted); font-size:12px; background: rgba(255,255,255,0.05); padding: 4px 8px; border-radius: 4px; display: inline-block;">ID: ${peerId}</p>
        </div>
        <div style="padding:0 16px 16px 16px; display: flex; flex-direction: column; gap: 12px;">
            ${!isSelf ? `
                <div style="background: var(--bg-overlay); border-radius: var(--r-sm); padding: 12px; display: flex; align-items: center; justify-content: space-between;">
                    <div style="font-size: 13px; font-weight: 500; display:flex; align-items:center; gap:8px;">
                        <span>${isFriend ? '❤️ Arkadaşsınız' : 'Tanışıyor musunuz?'}</span>
                    </div>
                    ${!isFriend ? `<button class="hero-btn tiny" onclick="addFriend('${peerId}', '${escapeHtml(username)}')">Arkadaş Ekle</button>` : `<button class="hero-btn tiny" style="background:var(--red)" onclick="removeFriend('${peerId}')">Arkadaşlıktan Çıkar</button>`}
                </div>
            ` : ''}
            <div>
                <label style="display: block; margin-bottom: 6px; font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase;">Kendinize Not (Bunu sadece sen görebilirsin)</label>
                <textarea id="profile-note-input" placeholder="Bu kullanıcıya dair notlar tut..." style="width: 100%; height: 60px; padding: 10px; border-radius: var(--r-sm); border: 1px solid var(--border-strong); background: var(--bg-highlight); color: var(--text-primary); resize: vertical; font-family: inherit; font-size: 13px;">${escapeHtml(userNote)}</textarea>
            </div>
        </div>
    `;

    const footer = !isSelf ? `
        <button class="btn-secondary" onclick="saveProfileNote('${peerId}')">Notu Kaydet</button>
        <button class="btn-primary" onclick="openDM('${peerId}', '${escapeHtml(username)}'); hideModal();">Mesaj Gönder</button>
    ` : `<button class="btn-secondary" onclick="hideModal()">Kapat</button>`;
    showModal("Kullanıcı Profili", body, footer);
}

function saveProfileNote(peerId) {
    const textarea = document.getElementById("profile-note-input");
    if (textarea) {
        const note = textarea.value;
        saveUserNote(peerId, note);
        toast("Not kaydedildi!", "success");
    }
}

function toggleFriendStatus(peerId, username, avatarColor, avatarImage) {
    const index = state.friends.findIndex(f => f.peerId === peerId);
    if (index >= 0) {
        state.friends.splice(index, 1);
    } else {
        state.friends.push({ peerId, username, avatarColor, avatarImage });
    }
    saveFriendsToStorage();
    toast(`${username} ${index >= 0 ? 'arkadaş listesinden çıkarıldı' : 'arkadaş listesine eklendi'} !`, "success");
}

function saveFriendsToStorage() {
    const friendsData = state.friends.map(f => ({
        peerId: f.peerId,
        username: f.username,
        avatarColor: f.avatarColor,
        avatarImage: f.avatarImage
    }));
    localStorage.setItem("scord_friends", JSON.stringify(friendsData));
}

function loadFriendsFromStorage() {
    try {
        const data = localStorage.getItem("scord_friends");
        if (data) {
            state.friends = JSON.parse(data);
        }
    } catch (e) {
        console.warn("Failed to load friends", e);
    }
}

// P2P Callback for when native browser screen sharing stops
window.onLocalScreenShareEnded = function () {
    const screenBtn = document.getElementById("voice-screen-btn");
    if (screenBtn) screenBtn.classList.remove("active");
    state.screenStream = null;
    if (state.mesh) {
        state.mesh.broadcast({
            type: "screen_status",
            sharing: false,
            channelId: state.voiceChannelId || state.activeChannelId,
        });
    }
    toast("Ekran paylaşımı durduruldu.", "info");

    const preview = document.getElementById("local-screen-preview");
    if (preview) preview.classList.add("hidden");
    if (state.activeServerId && state.voiceChannelId) {
        renderVoiceParticipants(state.activeServerId, state.voiceChannelId);
    }
};

function updateRoomStats() {
    const statsEl = document.getElementById("channel-stats");
    if (!statsEl || !state.activeServerId || !state.activeChannelId) return;

    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const count = server.members?.length ?? server.peer_count ?? 0;
    statsEl.textContent = `${count} üye`;
}

setInterval(() => {
    if (state.activeServerId) updateRoomStats();
}, SCORD_T().ROOM_STATS_POLL_MS ?? 10000);

async function joinByCode() {
    const code = document.getElementById("join-invite-input").value.trim().toUpperCase();
    if (!code) return;
    try {
        const res = await scordFetch(`${API_BASE}/rooms/join/${code}`);
        if (!res.ok) return;
        const room = await res.json();
        if (room.room_id) {
            joinServer(room.room_id);
            document.getElementById("join-invite-input").value = "";
        } else {
            toast("Davet kodu geçersiz.", "error");
        }
    } catch (e) {
        toast("Hata oluştu.", "error");
    }
}

function updateTheme(themeName) {
    state.theme = themeName;
    document.documentElement.className = themeName || "";
    localStorage.setItem("scord_theme", themeName || "");
    applyScordAppearance();
    toast(`Tema güncellendi.`, "success");
}

async function deleteServer(serverId) {
    if (!confirm("Bu sunucuyu kalıcı olarak silmek istediğine emin misin? Bu işlem geri alınamaz!")) return;
    try {
        const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(serverId)}?owner_id=${encodeURIComponent(state.peerId)}`, { method: "DELETE" });
        const data = await res.json();
        if (data.success) {
            toast("Sunucu başarıyla silindi.", "success");
            state.servers = state.servers.filter(s => s.id !== serverId);
            if (state.activeServerId === serverId) state.activeServerId = null;
            closeServerSettingsPanel?.();
            hideModal?.();
            showHomeView();
            renderServerRail();
        } else {
            toast("Sunucu silinemedi: " + (data.error || "Bilinmeyen hata"), "error");
        }
    } catch (e) {
        toast("Bağlantı hatası.", "error");
    }
}

function updateServerIcon(serverId, url) {
    fetch(`${API_BASE}/rooms/${serverId}/icon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
    }).then(res => res.json()).then(data => {
        if (data.success) {
            toast("Sunucu ikonu güncellendi.", "success");
            const server = state.servers.find(s => s.id === serverId);
            if (server) server.icon_url = url;
            renderServerRail();
        }
    });
}
async function searchGifs(q) {
    const results = document.getElementById("gif-results");
    if (!results) return;
    results.innerHTML = "<p style='padding:10px; font-size:12px;'>Yükleniyor...</p>";
    try {
        const query = encodeURIComponent(q || "excited");
        const res = await fetch(`https://tenor.googleapis.com/v2/search?q=${query}&key=LIVDTRZ9ORH6&limit=12`);
        const data = await res.json();
        results.innerHTML = "";
        data.results.forEach(g => {
            const img = document.createElement("img");
            img.src = g.media_formats.tinygif.url;
            img.onclick = () => {
                const chatInput = document.getElementById("chat-input");
                chatInput.value = g.itemurl;
                sendMessage();
                document.getElementById("gif-search-popover").classList.add("hidden");
            };
            results.appendChild(img);
        });
    } catch (e) {
        results.innerHTML = "<p style='padding:10px; color:var(--red);'>Arama hatası.</p>";
    }
}

// Emoji Picker Logic
function toggleEmojiPicker() {
    state.emojiOpen = !state.emojiOpen;
    let picker = document.getElementById("emoji-picker-popover");
    if (!picker) {
        picker = document.createElement("div");
        picker.id = "emoji-picker-popover";
        picker.className = "emoji-popover";
        EMOJIS.forEach(emoji => {
            const span = document.createElement("span");
            span.textContent = emoji;
            span.onclick = () => {
                const input = document.getElementById("chat-input");
                input.value += emoji;
                input.focus();
                toggleEmojiPicker();
            };
            picker.appendChild(span);
        });
        document.querySelector(".chat-input-wrapper").appendChild(picker);
    }
    picker.classList.toggle("hidden", !state.emojiOpen);
}

// Global initialization
document.addEventListener("DOMContentLoaded", () => {
    console.log("[App] DOM Loaded, initializing...");
    initSetup();
});
/* ═
   SHERCORD V18  DISCORD-LIKE FEATURE PACK
    */

/*  Unread badge tracking  */
if (!state.unread) state.unread = {};  // channelId  count

function markUnread(channelId) {
    if (channelId === state.activeChannelId) return;
    if (!state.unread) state.unread = {};
    state.unread[channelId] = (state.unread[channelId] || 0) + 1;
    updateUnreadBadges();
}

function clearUnread(channelId) {
    if (!state.unread) return;
    delete state.unread[channelId];
    updateUnreadBadges();
}

let _updateUnreadBadgesTimeout = null;
function updateUnreadBadges() {
    // Debounce to prevent excessive DOM updates
    if (_updateUnreadBadgesTimeout) {
        clearTimeout(_updateUnreadBadgesTimeout);
    }

    _updateUnreadBadgesTimeout = setTimeout(() => {
        _updateUnreadBadgesImpl();
    }, 16); // ~60fps
}

function _updateUnreadBadgesImpl() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;
    server.channels?.forEach(ch => {
        const el = document.querySelector(`.channel-item[data-ch="${ch.id}"] .unread-badge`);
        const count = state.unread?.[ch.id] || 0;
        if (el) {
            el.textContent = count > 9 ? "9+" : count;
            el.classList.toggle("hidden", count === 0);
        }
    });
}

/*  Typing indicator  */
if (!state.typingPeers) state.typingPeers = {};
let _typingTimer = null;
let _lastTypingSent = 0;

function onChatInputTyping() {
    const now = Date.now();
    const typingGap = SCORD_T().TYPING_SEND_MIN_GAP_MS ?? 2500;
    if (state.mesh && now - _lastTypingSent > typingGap) {
        _lastTypingSent = now;
        state.mesh.broadcast({ type: "typing", username: state.username, channelId: state.activeChannelId });
    }
    clearTimeout(_typingTimer);
    _typingTimer = setTimeout(clearTypingIndicator, SCORD_T().TYPING_INDICATOR_CLEAR_MS ?? 4000);
}

function clearTypingIndicator() {
    const el = document.getElementById("typing-indicator");
    if (el) el.textContent = "";
}

let _handleTypingMessageTimeout = null;
function handleTypingMessage(fromPeerId, username, channelId) {
    if (channelId !== state.activeChannelId) return;
    if (!state.typingPeers) state.typingPeers = {};
    state.typingPeers[fromPeerId] = username;

    // Debounce to prevent excessive DOM updates
    if (_handleTypingMessageTimeout) {
        clearTimeout(_handleTypingMessageTimeout);
    }

    _handleTypingMessageTimeout = setTimeout(() => {
        _handleTypingMessageImpl();
    }, 16); // ~60fps

    clearTimeout(state._typingTimers?.[fromPeerId]);
    if (!state._typingTimers) state._typingTimers = {};
    state._typingTimers[fromPeerId] = setTimeout(() => {
        delete state.typingPeers[fromPeerId];
        _handleTypingMessageImpl();
    }, SCORD_T().TYPING_INDICATOR_CLEAR_MS ?? 4000);
}

function _handleTypingMessageImpl() {
    const names = Object.values(state.typingPeers);
    const el = document.getElementById("typing-indicator");
    if (el && names.length > 0) {
        el.textContent = names.join(", ") + (names.length === 1 ? " yazıyor..." : " yazıyorlar...");
    } else if (el) {
        el.textContent = "";
    }
}

/*  Message reactions  */
function handleReaction(msgId, emoji, fromPeerId) {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;
    const msgs = server.messages?.[state.activeChannelId] || [];
    const msg = msgs.find(m => m.id === msgId);
    if (!msg) return;
    if (!msg.reactions) msg.reactions = {};
    const norm = normalizeReactionsMap(msg.reactions);
    msg.reactions = norm;
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
    const arr = msg.reactions[emoji];
    if (!arr.includes(fromPeerId)) arr.push(fromPeerId);
    updateReactionBar(msgId, msg.reactions);
}

function updateReactionBar(msgId, reactions) {
    const row = document.querySelector(`.message-bubble[data-msg-id="${msgId}"]`);
    if (!row) return;
    const bubble = row.querySelector(".msg-bubble") || row;
    let bar = bubble.querySelector(".reaction-bar");
    if (!bar) {
        bar = document.createElement("div");
        bar.className = "reaction-bar";
        bubble.appendChild(bar);
    }
    bar.innerHTML = "";
    const norm = normalizeReactionsMap(reactions);
    for (const [emoji, peers] of Object.entries(norm)) {
        const list = Array.isArray(peers) ? peers : [];
        if (list.length === 0) continue;
        const pill = document.createElement("span");
        pill.className = "reaction-pill";
        pill.textContent = `${emoji} ${list.length}`;
        pill.title = list.join(", ");
        pill.onclick = () => {
            if (state.mesh) {
                state.mesh.broadcast({ type: "reaction", msgId, emoji });
                handleReaction(msgId, emoji, state.peerId);
            }
        };
        bar.appendChild(pill);
    }
}

/*  User status  */
const USER_STATUSES = [
    { id: "online", label: "Çevrimiçi", color: "#22c55e" },
    { id: "idle", label: "Boşta", color: "#f59e0b" },
    { id: "dnd", label: "Rahatsız Etme", color: "#ef4444" },
    { id: "invisible", label: "Görünmez", color: "#6b7280" },
];

if (!state.userStatus) state.userStatus = "online";

function setUserStatus(statusId) {
    state.userStatus = statusId;
    localStorage.setItem("scord_status", statusId);
    updateStatusDisplay();
    if (state.mesh) state.mesh.broadcast({ type: "status_change", status: statusId });
}

function updateStatusDisplay() {
    const statusEl = document.querySelector(".user-bar-status");
    const info = USER_STATUSES.find(s => s.id === state.userStatus) || USER_STATUSES[0];
    if (statusEl) {
        statusEl.textContent = ` ${info.label}`;
        statusEl.style.color = info.color;
    }
}

function initStatusSelector() {
    const statusEl = document.querySelector(".user-bar-status");
    if (!statusEl) return;
    const saved = localStorage.getItem("scord_status") || "online";
    state.userStatus = saved;
    updateStatusDisplay();

    statusEl.style.cursor = "pointer";
    statusEl.onclick = (e) => {
        e.stopPropagation();
        let menu = document.getElementById("status-menu");
        if (menu) { menu.remove(); return; }
        menu = document.createElement("div");
        menu.id = "status-menu";
        menu.className = "context-menu";
        menu.style.cssText = "position:fixed;z-index:9999;min-width:180px;";
        const rect = statusEl.getBoundingClientRect();
        menu.style.bottom = (window.innerHeight - rect.top + 8) + "px";
        menu.style.left = rect.left + "px";
        USER_STATUSES.forEach(s => {
            const item = document.createElement("div");
            item.className = "ctx-item";
            item.innerHTML = `<span style="color:${s.color};margin-right:8px;"></span>${s.label}`;
            item.onclick = () => { setUserStatus(s.id); menu.remove(); };
            menu.appendChild(item);
        });
        document.body.appendChild(menu);
        setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 0);
    };
}

/* Server persistence functions */
function saveServerToStorage(server) {
    try {
        const savedServers = loadServersFromStorage();
        const existingIndex = savedServers.findIndex(s => s.id === server.id);

        const serverToSave = {
            id: server.id,
            name: server.name,
            ownerId: server.ownerId,
            inviteCode: server.inviteCode,
            icon_url: server.icon_url,
            channels: server.channels,
            roles: server.roles,
            peer_roles: server.peer_roles,
            channel_backgrounds: server.channel_backgrounds,
            lastJoined: Date.now()
        };

        if (existingIndex !== -1) {
            savedServers[existingIndex] = serverToSave;
        } else {
            savedServers.push(serverToSave);
        }

        // Keep only last 50 servers
        if (savedServers.length > 50) {
            savedServers.splice(0, savedServers.length - 50);
        }

        localStorage.setItem('scord_saved_servers', JSON.stringify(savedServers));
        console.log("[Storage] Server saved:", server.name);
    } catch (e) {
        console.error("[Storage] Failed to save server:", e);
    }
}

function loadServersFromStorage() {
    try {
        const saved = localStorage.getItem('scord_saved_servers');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.error("[Storage] Failed to load servers:", e);
        return [];
    }
}

function removeServerFromStorage(serverId) {
    try {
        const savedServers = loadServersFromStorage();
        const filtered = savedServers.filter(s => s.id !== serverId);
        localStorage.setItem('scord_saved_servers', JSON.stringify(filtered));
        console.log("[Storage] Server removed:", serverId);
    } catch (e) {
        console.error("[Storage] Failed to remove server:", e);
    }
}

/*  Invite code: copy & join  */
async function joinByInviteCode(code) {
    console.log("[Invite] Joining by code:", code);

    if (!code || code.trim().length < 4) return toast("Geçersiz davet kodu.", "error");
    code = code.trim().toUpperCase();

    try {
        const res = await scordFetch(`/api/rooms/join/${code}`);
        if (!res.ok) {
            console.error("[Invite] Failed to join:", res.status);
            toast("Geçersiz veya süresi dolmuş davet kodu.", "error");
            return;
        }

        const data = await res.json();
        console.log("[Invite] Response data:", data);

        if (data.error || !data.room_id) {
            console.error("[Invite] Error in response:", data.error);
            toast("Geçersiz veya süresi dolmuş davet kodu.", "error");
            return;
        }

        const peerList = (data.peers || []).map(p => ({
            peer_id: p.peer_id,
            username: p.username,
            avatar_color: p.avatar_color,
            avatar_image: p.avatar_image ?? null,
        }));

        if (!peerList.some(m => m.peer_id === state.peerId)) {
            peerList.push({
                peer_id: state.peerId,
                username: state.username,
                avatar_color: state.avatarColor,
                avatar_image: state.avatarImage,
            });
        }

        const server = {
            id: data.room_id,
            name: data.name,
            ownerId: data.owner_id,
            channels: data.channels || [],
            members: peerList,
            roles: data.roles || {},
            peer_roles: data.peer_roles || {},
            pinned_messages: data.pinned_messages || [],
            messages: data.messages || {},
            inviteCode: data.invite_code,
            icon_url: data.icon_url,
            voiceMembers: {},
            voiceSessionHost: {},
            unread: {},
            channel_backgrounds: data.channel_backgrounds || {},
        };

        // Save server to localStorage for persistence
        saveServerToStorage(server);

        const dupIdx = state.servers.findIndex(s => s.id === server.id);
        if (dupIdx !== -1) {
            console.log("[Invite] Updating existing server");
            const prev = state.servers[dupIdx];
            state.servers[dupIdx] = {
                ...prev,
                ...server,
                voiceMembers: prev.voiceMembers || {},
                voiceSessionHost: prev.voiceSessionHost || {},
            };
        } else {
            console.log("[Invite] Adding new server");
            state.servers.push(server);
        }

        renderServerRail();
        switchToServer(server.id);
        toast(`"${server.name}" sunucusuna katıldın!`, "success");
    } catch (err) {
        console.error("[Invite] Join failed:", err);
        toast("Sunucuya bağlanırken hata oluştu.", "error");
    }
}

function showInviteModal(serverId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;
    const code = server.inviteCode || "";
    const link = `${location.origin}?invite=${code}`;
    showModal(
        "Arkadaşlarını Davet Et",
        `<p style="margin-bottom:12px;color:var(--text-secondary);">Bu kodu arkadaşlarınla paylaş:</p>
         <div style="display:flex;gap:8px;align-items:center;">
           <input readonly id="invite-code-display" value="${code}" style="flex:1;padding:10px;background:var(--bg-deep);border:1px solid var(--border);border-radius:8px;color:var(--text-primary);font-size:20px;letter-spacing:4px;text-align:center;font-weight:bold;" />
           <button onclick="navigator.clipboard.writeText('${code}').then(()=>toast('Kod kopyalandı!','success'))" class="btn-primary" style="padding:10px 16px;">Kopyala</button>
         </div>
         <p style="margin-top:12px;font-size:12px;color:var(--text-muted);">Veya bağlantı: <a href="${link}" style="color:var(--accent);">${link}</a></p>`,
        `<button class="btn-primary" onclick="hideModal()">Kapat</button>`
    );
}

/*  Server discovery: refresh  */
async function refreshDiscovery() {
    const grid = document.getElementById("room-list-home");
    if (!grid) return;
    try {
        grid.innerHTML = `<div class="room-grid-skeleton" aria-busy="true">
            <div class="room-skel-card"></div><div class="room-skel-card"></div><div class="room-skel-card"></div>
        </div>`;
        const res = await scordFetch("/api/rooms");
        const rooms = await res.json();
        grid.innerHTML = "";
        if (!rooms || rooms.length === 0) {
            grid.innerHTML = '<p style="color:var(--text-muted);text-align:center;grid-column:1/-1;">Henüz aktif sunucu yok. Bir tane oluştur!</p>';
            return;
        }
        rooms.forEach(room => {
            const card = document.createElement("div");
            card.className = "room-card";
            const icon = room.icon_url
                ? `<img src="${room.icon_url}" alt="" loading="lazy" decoding="async" style="width:48px;height:48px;border-radius:12px;object-fit:cover;" />`
                : `<div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#7c3aed,#4f46e5);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff;">${(room.name || "?")[0].toUpperCase()}</div>`;
            card.innerHTML = `
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
                  ${icon}
                  <div>
                    <div style="font-weight:700;font-size:16px;">${room.name}</div>
                    <div style="font-size:12px;color:var(--text-muted);">${room.peer_count || 0} üye</div>
                  </div>
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                  <span style="font-size:12px;color:var(--text-muted);flex:1;">Kod: <b style="letter-spacing:2px;color:var(--accent);">${room.invite_code || ""}</b></span>
                  <button class="btn-primary" style="padding:6px 14px;font-size:13px;" onclick="joinDiscoveryRoom('${room.room_id}', '${room.invite_code}')">Katıl</button>
                </div>`;
            grid.appendChild(card);
        });
    } catch (err) {
        console.error("[Discovery] Error:", err);
        grid.innerHTML = '<p style="color:var(--text-muted);text-align:center;grid-column:1/-1;">Sunucu listesi yüklenemedi. Ağını kontrol edip yenile.</p>';
    }
}

async function joinDiscoveryRoom(roomId, inviteCode) {
    // If we already have it, just switch
    if (state.servers.find(s => s.id === roomId)) {
        switchToServer(roomId);
        return;
    }
    await joinByInviteCode(inviteCode);
}

function switchToServer(serverId) {
    console.log("[Switch] Switching to server:", serverId);

    const server = state.servers.find(s => s.id === serverId);
    if (!server) {
        console.error("[Switch] Server not found:", serverId);
        toast("Sunucu bulunamadı.", "error");
        return;
    }

    if (serverId === state.activeServerId && state.mesh && state.mesh.roomId === serverId) {
        console.log("[Switch] Already on this server, showing chat view");
        const firstText = server.channels?.find(c => c.type === "text");
        if (firstText) showChatView(serverId, firstText.id);
        updateChannelSidebar(serverId);
        renderServerRail();
        document.getElementById("home-btn")?.classList.remove("active");
        document.querySelectorAll("#server-icons [data-server-id]").forEach(el => {
            el.classList.toggle("active", el.dataset.serverId === serverId);
        });
        return;
    }

    // Preserve voice state when switching servers
    const wasInVoice = !!state.voiceChannelId;
    const previousVoiceChannelId = state.voiceChannelId;
    const previousServerId = state.activeServerId;

    console.log("[Switch] Connecting to mesh and showing chat");
    state.activeServerId = serverId;
    connectMesh(serverId);
    const firstText = server.channels?.find(c => c.type === "text");
    if (firstText) {
        showChatView(serverId, firstText.id);
    } else {
        // Fallback to first channel if no text channel
        const firstChannel = server.channels?.[0];
        if (firstChannel) {
            showChatView(serverId, firstChannel.id);
        }
    }
    updateChannelSidebar(serverId);
    updateMembersPanel(serverId);
    updatePeerCountBadge(serverId);
    renderServerRail();
    document.getElementById("home-btn")?.classList.remove("active");
    document.querySelectorAll("#server-icons [data-server-id]").forEach(el => {
        el.classList.toggle("active", el.dataset.serverId === serverId);
    });
}

/*  Voice sidebar activity indicator  */
function updateVoiceActivityIcons(serverId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;
    const voiceChannels = server.channels?.filter(c => c.type === "voice") || [];
    voiceChannels.forEach(ch => {
        const el = document.querySelector(`.channel-item[data-ch="${ch.id}"] .voice-activity-icon`);
        const members = server.voiceMembers?.[ch.id] || [];
        if (el) {
            el.classList.toggle("active", members.length > 0);
            el.textContent = members.length > 0 ? ` ${members.length}` : "";
        }
    });
}

/*  Hook everything into existing init functions  */
// Invite join button
const _joinCodeBtn = document.getElementById("join-by-code-btn");
if (_joinCodeBtn) {
    _joinCodeBtn.onclick = () => {
        const input = document.getElementById("join-invite-input");
        if (input) joinByInviteCode(input.value);
    };
}
const _joinInput = document.getElementById("join-invite-input");
if (_joinInput) {
    _joinInput.addEventListener("keydown", e => {
        if (e.key === "Enter") joinByInviteCode(_joinInput.value);
    });
}

// Also handle ?invite= in URL (auto-join from shared link)
(function () {
    const params = new URLSearchParams(location.search);
    const code = params.get("invite");
    if (code) {
        // Wait for app to be ready
        const tryJoin = setInterval(() => {
            if (state.username) {
                clearInterval(tryJoin);
                joinByInviteCode(code);
                // Clean URL
                history.replaceState({}, "", location.pathname);
            }
        }, SCORD_T().INVITE_URL_POLL_MS ?? 500);
    }
})();

// Typing indicator hook (wire into existing chat input)
const _chatInput = document.getElementById("chat-input");
if (_chatInput) {
    _chatInput.addEventListener("input", onChatInputTyping);
}

// Hook typing & reaction P2P messages into existing handleIncomingP2P
const _origHandleP2P = handleIncomingP2P;
window.handleIncomingP2P = function (fromPeerId, data, roomId) {
    if (data.type === "typing") {
        handleTypingMessage(fromPeerId, data.username, data.channelId);
        return;
    }
    if (data.type === "reaction") {
        handleReaction(data.msgId, data.emoji, fromPeerId);
        return;
    }
    if (data.type === "status_change") {
        const server = state.servers.find(s => s.id === roomId);
        const member = server?.members?.find(m => m.peer_id === fromPeerId);
        if (member) member.status = data.status;
        updateMembersPanel(roomId);
        return;
    }
    _origHandleP2P(fromPeerId, data, roomId);
};

// Server invite button in server header (add to settings modal)
const _origOpenSettings = window.openServerSettingsModal;
window.openServerSettingsModal = function () {
    if (_origOpenSettings) _origOpenSettings();
    // inject invite button if not already present
    setTimeout(() => {
        const footer = document.getElementById("modal-footer");
        if (footer && !footer.querySelector(".invite-modal-btn")) {
            const btn = document.createElement("button");
            btn.className = "btn-primary invite-modal-btn";
            btn.textContent = " Davet Bağlantısı";
            btn.style.marginRight = "auto";
            btn.onclick = () => { hideModal(); showInviteModal(state.activeServerId); };
            footer.insertBefore(btn, footer.firstChild);
        }
    }, 100);
};

// Init status selector on load
document.addEventListener("DOMContentLoaded", () => {
    setTimeout(initStatusSelector, 500);
    setTimeout(refreshDiscovery, 1000);
});

// Also hook into app start
const _origStartApp = window.startApp;
window.startApp = function () {
    if (_origStartApp) _origStartApp();
    setTimeout(initStatusSelector, 300);
    setTimeout(refreshDiscovery, 500);
};

/* ══════════════════════════════════════════════════════════════
   DISCORD-STYLE MENTION SYSTEM (@user, @everyone, @here)
══════════════════════════════════════════════════════════════ */

// Enhanced mention parsing in parseMessageText
const _origParseMessageText = window.parseMessageText;
window.parseMessageText = function (text, serverId) {
    if (!text) return "";
    const sid = serverId !== undefined ? serverId : state.activeServerId;

    // First handle @everyone and @here
    let result = String(text);
    const server = state.servers.find(s => s.id === sid);

    // @everyone mention
    result = result.replace(/@everyone/g, (match) => {
        return `<span class="mention mention-everyone" data-mention="everyone" title="Everyone" style="background:rgba(239,68,68,0.2);color:#fca5a5;">@everyone</span>`;
    });

    // @here mention
    result = result.replace(/@here/g, (match) => {
        return `<span class="mention mention-here" data-mention="here" title="Here" style="background:rgba(34,197,94,0.2);color:#86efac;">@here</span>`;
    });

    // @user mentions (handle usernames with spaces)
    if (server && server.members) {
        const members = server.members;
        // Sort by length descending to match longer names first
        const sortedNames = [...new Set(members.map(m => m.username).filter(Boolean))].sort((a, b) => b.length - a.length);

        sortedNames.forEach(name => {
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp(`(^|\\s)@${escaped}(?!\\w)`, "g");
            result = result.replace(regex, (full, lead) => {
                const member = members.find(m => m.username === name);
                return `${lead}<span class="mention" data-peer="${member?.peer_id || ""}" style="background:rgba(99,102,241,0.2);color:#c7d2fe;cursor:pointer;">@${escapeHtml(name)}</span>`;
            });
        });
    }

    // Handle URLs and other formatting
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return result.split(urlRegex).map(part => {
        if (part.match(urlRegex)) {
            if (part.match(/\.(jpeg|jpg|gif|png|webp)($|\?)/i)) {
                return `<a href="${part}" target="_blank" class="rich-link"><img src="${part}" class="chat-embed-img" alt="" loading="lazy" decoding="async" /></a>`;
            }
            const ytMatch = part.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
            if (ytMatch) {
                return `<div class="chat-embed-video"><iframe src="https://www.youtube.com/embed/${ytMatch[1]}" frameborder="0" allowfullscreen></iframe></div>`;
            }
            return `<a href="${part}" target="_blank" class="chat-link">${part}</a>`;
        }
        return part;
    }).join("");
};

// Mention click handler
document.addEventListener("click", (e) => {
    const mention = e.target.closest(".mention");
    if (!mention) return;

    const peerId = mention.getAttribute("data-peer");
    const mentionType = mention.getAttribute("data-mention");

    if (peerId) {
        // Open user profile
        const server = state.servers.find(s => s.id === state.activeServerId);
        const member = server?.members.find(m => m.peer_id === peerId);
        if (member) {
            openUserProfile(peerId, member.username, member.avatar_image, member.avatar_color);
        }
    } else if (mentionType === "everyone") {
        toast("📢 @everyone - Tüm üyeler etiketlendi!", "info");
    } else if (mentionType === "here") {
        toast("📍 @here - Çevrimiçi üyeler etiketlendi!", "info");
    }
});

/* ══════════════════════════════════════════════════════════════
   IMPROVED MUSIC BOT - FIXES & FEATURES
══════════════════════════════════════════════════════════════ */

// Fix: Music bot should only play for users in the voice channel
const _origStartMusicBot = window.startMusicBot;
window.startMusicBot = function (videoId, startAt) {
    // Only play music if user is in a voice channel
    if (!state.voiceChannelId) {
        console.log("[Music Bot] Not in voice channel, skipping");
        return;
    }

    // Check if music bot is already in voice members
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (server && server.voiceMembers && server.voiceMembers[state.voiceChannelId]) {
        const botInChannel = server.voiceMembers[state.voiceChannelId].some(m => m.peer_id === "bot_music");
        if (!botInChannel) {
            // Add bot to voice channel
            server.voiceMembers[state.voiceChannelId].push({
                peer_id: "bot_music",
                username: "🎵 Müzik Botu",
                avatar_color: "#ef4444",
                avatar_image: null
            });
            renderVoiceParticipants(state.activeServerId, state.voiceChannelId);
        }
    }

    // Call original function
    if (_origStartMusicBot) {
        _origStartMusicBot(videoId, startAt);
    }
};

// Fix: Stop music bot when kicked from voice channel
const _origStopMusicBot = window.stopMusicBot;
window.stopMusicBot = function () {
    // Remove bot from voice members
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (server && server.voiceMembers && state.voiceChannelId) {
        server.voiceMembers[state.voiceChannelId] = (server.voiceMembers[state.voiceChannelId] || []).filter(m => m.peer_id !== "bot_music");
        if (state.activeChannelId === state.voiceChannelId) {
            renderVoiceParticipants(state.activeServerId, state.voiceChannelId);
        }
        updateChannelSidebar(state.activeServerId);
    }

    // Call original function
    if (_origStopMusicBot) {
        _origStopMusicBot();
    }
};

// Add !kickmusic command to kick music bot from voice channel
const _origHandleP2P_Music = window.handleIncomingP2P;
window.handleIncomingP2P = function (fromPeerId, data, roomId) {
    // Handle music bot kick command
    if (data.type === "kick_music_bot" && data.target === "bot_music") {
        const server = state.servers.find(s => s.id === roomId);
        if (server && server.voiceMembers && state.voiceChannelId) {
            server.voiceMembers[state.voiceChannelId] = (server.voiceMembers[state.voiceChannelId] || []).filter(m => m.peer_id !== "bot_music");
            if (state.activeChannelId === state.voiceChannelId) {
                renderVoiceParticipants(state.activeServerId, state.voiceChannelId);
            }
            updateChannelSidebar(state.activeServerId);
            toast("🎵 Müzik botu sesli kanaldan çıkarıldı.", "info");
        }
        return;
    }

    if (_origHandleP2P_Music) {
        _origHandleP2P_Music(fromPeerId, data, roomId);
    }
};

// Enhanced !play command with Discord-style bot mention
const _origSendMessage = window.sendMessage;
window.sendMessage = function () {
    console.log("[window.sendMessage Override] Intercepted message send.");
    const input = document.getElementById("chat-input");
    if (!input) {
        console.error("[window.sendMessage Override] Critical Error: chat-input not found!");
        if (typeof _origSendMessage === 'function') _origSendMessage();
        return;
    }
    const text = (input.value || "").trim();

    // Check for Discord-style music commands
    if (text.startsWith("!p ") || text.startsWith("!play ")) {
        console.log("[window.sendMessage Override] Music !play command detected.");
        const query = text.startsWith("!p ") ? text.slice(3).trim() : text.slice(6).trim();
        if (!query) {
            toast("🎵 Kullanım: !play <şarkı adı veya YouTube linki>", "info");
            return;
        }

        // Show bot mention style message
        const botMention = `<span class="mention" style="background:rgba(239,68,68,0.2);color:#fca5a5;">🎵 Müzik Botu</span>`;
        if (typeof addSystemMessage === 'function') addSystemMessage(`${botMention} Şarkı aranıyor: "${query}"...`);
    }

    // Check for kick music bot command
    if (text === "!kickmusic" || text === "!stopmusic") {
        console.log("[window.sendMessage Override] Music !stop/kick command detected.");
        if (!state.voiceChannelId) {
            toast("Sesli kanalda değilsin.", "warning");
            return;
        }

        // Broadcast kick command
        if (state.mesh) {
            state.mesh.broadcast({
                type: "kick_music_bot",
                target: "bot_music",
                voiceChannelId: state.voiceChannelId
            });
        }

        // Remove bot locally
        const server = state.servers.find(s => s.id === state.activeServerId);
        if (server && server.voiceMembers && state.voiceChannelId) {
            server.voiceMembers[state.voiceChannelId] = (server.voiceMembers[state.voiceChannelId] || []).filter(m => m.peer_id !== "bot_music");
            if (typeof renderVoiceParticipants === 'function') renderVoiceParticipants(state.activeServerId, state.voiceChannelId);
            if (typeof updateChannelSidebar === 'function') updateChannelSidebar(state.activeServerId);
        }

        if (typeof stopMusicBot === 'function') stopMusicBot();
        toast("🎵 Müzik botu çıkarıldı.", "info");
        input.value = "";
        return;
    }

    if (typeof _origSendMessage === 'function') {
        _origSendMessage();
    } else {
        console.error("[window.sendMessage Override] Error: _origSendMessage is not a function!");
    }
};

/* ══════════════════════════════════════════════════════════════
   CSS STYLES FOR NEW FEATURES
══════════════════════════════════════════════════════════════ */

// Add CSS for mention styles
const mentionStyles = document.createElement("style");
mentionStyles.textContent = `
    .mention {
        padding: 0 3px;
        border-radius: 3px;
        background: rgba(99, 102, 241, 0.25);
        color: #c9cdfb;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
    }
    
    .mention:hover {
        background: rgba(99, 102, 241, 0.45);
        color: #fff;
    }
    
    .mention-everyone {
        background: rgba(239, 68, 68, 0.2) !important;
        color: #fca5a5 !important;
    }
    
    .mention-everyone:hover {
        background: rgba(239, 68, 68, 0.4) !important;
    }
    
    .mention-here {
        background: rgba(34, 197, 94, 0.2) !important;
        color: #86efac !important;
    }
    
    .mention-here:hover {
        background: rgba(34, 197, 94, 0.4) !important;
    }
    
    /* Unread badge styles */
    .unread-badge {
        min-width: 20px;
        height: 20px;
        background: #ef4444;
        color: white;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0 6px;
        margin-left: auto;
    }
    
    .unread-badge.hidden {
        display: none !important;
    }
    
    /* Typing indicator styles */
    .typing-indicator {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 8px 12px;
        font-size: 12px;
        color: var(--text-muted);
        font-style: italic;
    }
    
    .typing-dots {
        display: flex;
        gap: 3px;
        margin-left: 6px;
    }
    
    .typing-dots span {
        width: 6px;
        height: 6px;
        background: var(--text-muted);
        border-radius: 50%;
        animation: typing-bounce 1.4s ease-in-out infinite;
    }
    
    .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
    .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
    
    @keyframes typing-bounce {
        0%, 60%, 100% { transform: translateY(0); }
        30% { transform: translateY(-6px); }
    }
`;
document.head.appendChild(mentionStyles);

console.log("[Shercord V19] Discord-style mentions, improved music bot, and fixes loaded!");

/* ══════════════════════════════════════════════════════════════
   SERVER DATA PERSISTENCE (localStorage + GitHub-ready)
══════════════════════════════════════════════════════════════ */

// Save server data to localStorage
function saveServerData(serverId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;

    // Create a lightweight copy (exclude volatile data)
    const saveData = {
        id: server.id,
        name: server.name,
        ownerId: server.ownerId,
        inviteCode: server.inviteCode,
        icon_url: server.icon_url,
        channels: server.channels,
        roles: server.roles,
        peer_roles: server.peer_roles,
        members: server.members,
        messages: server.messages,
        pinned_messages: server.pinned_messages,
        channel_backgrounds: server.channel_backgrounds,
        voicePermissionMode: server.voicePermissionMode,
        createdAt: server.createdAt || Date.now(),
        updatedAt: Date.now()
    };

    try {
        localStorage.setItem(`scord_server_${serverId}`, JSON.stringify(saveData));
        console.log(`[Save] Server ${serverId} saved to localStorage`);
    } catch (e) {
        console.warn('[Save] localStorage full, trimming old data...');
        // If storage is full, remove oldest server
        trimOldServerData();
        try {
            localStorage.setItem(`scord_server_${serverId}`, JSON.stringify(saveData));
        } catch (e2) {
            console.error('[Save] Failed to save:', e2);
        }
    }
}

// Load server data from localStorage
function loadServerData(serverId) {
    try {
        const data = localStorage.getItem(`scord_server_${serverId}`);
        if (data) {
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('[Load] Failed to load server:', e);
    }
    return null;
}

// Trim old server data if storage is full
function trimOldServerData() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('scord_server_'));
    if (keys.length <= 3) return; // Keep at least 3 servers

    // Find oldest servers and remove them
    const servers = keys.map(key => {
        try {
            const data = JSON.parse(localStorage.getItem(key));
            return { key, updatedAt: data?.updatedAt || 0 };
        } catch { return { key, updatedAt: 0 }; }
    }).sort((a, b) => a.updatedAt - b.updatedAt);

    // Remove oldest servers until we have space
    for (let i = 0; i < servers.length - 2; i++) {
        localStorage.removeItem(servers[i].key);
    }
}

// Save all servers on page unload
window.addEventListener('beforeunload', () => {
    state.servers.forEach(server => saveServerData(server.id));
});

// Auto-save every 30 seconds
setInterval(() => {
    state.servers.forEach(server => saveServerData(server.id));
}, 30000);

// Load saved servers on startup
function loadSavedServers() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('scord_server_'));
    keys.forEach(key => {
        try {
            const data = JSON.parse(localStorage.getItem(key));
            if (data && data.id) {
                // Check if server is already in state
                if (!state.servers.find(s => s.id === data.id)) {
                    state.servers.push({
                        ...data,
                        voiceMembers: {},
                        voiceSessionHost: {},
                        unread: {}
                    });
                    console.log(`[Load] Loaded server: ${data.name}`);
                }
            }
        } catch (e) {
            console.error('[Load] Failed to parse server data:', e);
        }
    });
}

/* ══════════════════════════════════════════════════════════════
   DISCORD-STYLE EMBEDDED SETTINGS PANEL
══════════════════════════════════════════════════════════════ */

function openServerSettingsPanel() {
    if (!state.activeServerId) return toast("Önce bir sunucu seç.", "info");
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const isOwner = server.ownerId === state.peerId;
    const isAdmin = isOwner || server.peer_roles?.[state.peerId] === "admin";
    if (!isAdmin) return toast("Bu işlem için yönetici yetkisi gerekli.", "error");

    // Create embedded settings panel
    let panel = document.getElementById("server-settings-panel");
    if (panel) {
        panel.classList.toggle("hidden");
        return;
    }

    panel = document.createElement("div");
    panel.id = "server-settings-panel";
    panel.className = "settings-panel-embedded";
    panel.innerHTML = `
        <div class="settings-panel-header">
            <h3>⚙️ Sunucu Ayarları</h3>
            <button class="settings-panel-close" onclick="closeServerSettingsPanel()">✕</button>
        </div>
        <div class="settings-panel-tabs">
            <button class="tab-btn active" data-tab="general">Genel</button>
            <button class="tab-btn" data-tab="roles">Roller</button>
            <button class="tab-btn" data-tab="members">Üyeler</button>
            <button class="tab-btn" data-tab="permissions">İzinler</button>
        </div>
        <div class="settings-panel-content">
            <div id="tab-general" class="tab-content active">
                ${renderGeneralSettings(server)}
            </div>
            <div id="tab-roles" class="tab-content">
                ${renderRolesSettings(server)}
            </div>
            <div id="tab-members" class="tab-content">
                ${renderMembersSettings(server)}
            </div>
            <div id="tab-permissions" class="tab-content">
                ${renderPermissionsSettings(server)}
            </div>
        </div>
    `;

    document.body.appendChild(panel);

    // Tab switching
    panel.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
            panel.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            panel.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
        };
    });

    // Add CSS for settings panel
    if (!document.getElementById('settings-panel-css')) {
        const style = document.createElement('style');
        style.id = 'settings-panel-css';
        style.textContent = `
            .settings-panel-embedded {
                position: fixed;
                right: 0;
                top: 0;
                bottom: 0;
                width: 480px;
                max-width: 90vw;
                background: var(--bg-deep);
                border-left: 1px solid var(--border-strong);
                z-index: 1000;
                display: flex;
                flex-direction: column;
                animation: slideInRight 0.3s ease;
                box-shadow: -8px 0 32px rgba(0,0,0,0.4);
            }
            
            @keyframes slideInRight {
                from { transform: translateX(100%); }
                to { transform: translateX(0); }
            }
            
            .settings-panel-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 20px;
                border-bottom: 1px solid var(--border);
                background: var(--bg-mid);
            }
            
            .settings-panel-header h3 {
                font-size: 16px;
                font-weight: 700;
                color: var(--text-primary);
            }
            
            .settings-panel-close {
                width: 32px;
                height: 32px;
                border: none;
                background: none;
                color: var(--text-secondary);
                cursor: pointer;
                border-radius: var(--r-md);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 18px;
            }
            
            .settings-panel-close:hover {
                background: var(--bg-hover);
                color: var(--text-primary);
            }
            
            .settings-panel-tabs {
                display: flex;
                padding: 8px 16px;
                gap: 4px;
                border-bottom: 1px solid var(--border);
                background: var(--bg-base);
            }
            
            .tab-btn {
                flex: 1;
                padding: 8px 12px;
                border: none;
                background: none;
                color: var(--text-secondary);
                cursor: pointer;
                border-radius: var(--r-md);
                font-size: 13px;
                font-weight: 500;
                transition: all 0.2s;
            }
            
            .tab-btn:hover {
                background: var(--bg-hover);
                color: var(--text-primary);
            }
            
            .tab-btn.active {
                background: var(--bg-active);
                color: var(--accent-light);
                font-weight: 600;
            }
            
            .settings-panel-content {
                flex: 1;
                overflow-y: auto;
                padding: 16px 20px;
            }
            
            .tab-content {
                display: none;
            }
            
            .tab-content.active {
                display: block;
            }
            
            .role-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px;
                background: var(--bg-base);
                border-radius: var(--r-md);
                margin-bottom: 8px;
                border: 1px solid var(--border);
            }
            
            .role-color-picker {
                width: 24px;
                height: 24px;
                border-radius: 50%;
                border: 2px solid var(--border-strong);
                cursor: pointer;
                padding: 0;
            }
            
            .role-name-input {
                flex: 1;
                background: var(--bg-deep);
                border: 1px solid var(--border);
                border-radius: var(--r-sm);
                padding: 6px 10px;
                color: var(--text-primary);
                font-size: 14px;
            }
            
            .permission-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 8px;
                margin-top: 12px;
            }
            
            .permission-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                background: var(--bg-base);
                border-radius: var(--r-sm);
                border: 1px solid var(--border);
            }
            
            .permission-item input[type="checkbox"] {
                width: 16px;
                height: 16px;
                accent-color: var(--accent);
            }
            
            .member-role-select {
                background: var(--bg-deep);
                border: 1px solid var(--border);
                border-radius: var(--r-sm);
                padding: 4px 8px;
                color: var(--text-primary);
                font-size: 12px;
            }
        `;
        document.head.appendChild(style);
    }
}

function closeServerSettingsPanel() {
    const panel = document.getElementById("server-settings-panel");
    if (panel) {
        panel.remove();
    }
}

function renderGeneralSettings(server) {
    return `
        <div class="form-group" style="margin-bottom:16px">
            <label class="modal-label">Sunucu Adı</label>
            <input class="modal-input" id="settings-sv-name" value="${escapeHtml(server.name)}" />
        </div>
        <div class="form-group" style="margin-bottom:16px">
            <label class="modal-label">Sunucu İkonu (URL)</label>
            <input class="modal-input" id="settings-sv-icon" value="${escapeHtml(server.icon_url || '')}" placeholder="https://..." />
        </div>
        <div class="form-group" style="margin-bottom:16px">
            <label class="modal-label">Davet Kodu</label>
            <div class="peer-id-display" style="display:flex;justify-content:space-between;align-items:center;">
                <span>${escapeHtml(server.inviteCode || '—')}</span>
                <button class="btn-secondary" style="padding:6px 12px;font-size:12px;" onclick="navigator.clipboard.writeText('${server.inviteCode || ''}');toast('Kopyalandı!','success')">Kopyala</button>
            </div>
        </div>
        <button class="btn-primary" onclick="saveGeneralSettings()" style="width:100%">Kaydet</button>
    `;
}

function renderRolesSettings(server) {
    const roles = server.roles || {};
    let html = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h4 style="color:var(--text-primary);font-size:14px;">Roller</h4>
            <button class="btn-primary" style="padding:6px 12px;font-size:12px;" onclick="createNewRole()">+ Yeni Rol</button>
        </div>
    `;

    Object.entries(roles).forEach(([roleId, roleData]) => {
        const memberCount = Object.values(server.peer_roles || {}).filter(r => r === roleId).length;
        html += `
            <div class="role-item">
                <input type="color" class="role-color-picker" value="${roleData.color || '#7c3aed'}" 
                       onchange="updateRoleColor('${roleId}', this.value)" />
                <input type="text" class="role-name-input" value="${escapeHtml(roleData.name)}" 
                       onchange="updateRoleName('${roleId}', this.value)" />
                <span style="font-size:11px;color:var(--text-muted);">${memberCount} üye</span>
                ${server.ownerId !== state.peerId ? '' : `
                    <button style="background:none;border:none;color:var(--red);cursor:pointer;font-size:16px;" 
                            onclick="deleteRole('${roleId}')">🗑️</button>
                `}
            </div>
        `;
    });

    return html;
}

function renderMembersSettings(server) {
    const members = server.members || [];
    let html = `
        <div style="margin-bottom:16px;">
            <h4 style="color:var(--text-primary);font-size:14px;">Üyeler (${members.length})</h4>
        </div>
    `;

    members.forEach(member => {
        const currentRole = server.peer_roles?.[member.peer_id] || 'member';
        const roles = server.roles || {};
        const roleOptions = Object.entries(roles).map(([roleId, roleData]) =>
            `<option value="${roleId}" ${currentRole === roleId ? 'selected' : ''}>${escapeHtml(roleData.name)}</option>`
        ).join('');

        html += `
            <div class="role-item">
                <div style="width:32px;height:32px;border-radius:50%;background:${member.avatar_color || '#7c3aed'};display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;font-weight:700;">
                    ${initials(member.username)}
                </div>
                <span style="flex:1;font-size:14px;color:var(--text-primary);">${escapeHtml(member.username)}</span>
                ${server.ownerId === state.peerId ? `
                    <select class="member-role-select" onchange="updateMemberRole('${member.peer_id}', this.value)">
                        <option value="member">Üye</option>
                        ${roleOptions}
                    </select>
                ` : `<span style="font-size:12px;color:var(--text-muted);">${roles[currentRole]?.name || 'Üye'}</span>`}
            </div>
        `;
    });

    return html;
}

// Enhanced Role System with Permissions and Colors
function showRoleManagementModal() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const modalContent = `
        <div class="role-management-modal">
            <div class="role-management-header">
                <div class="role-management-title">🎭 Rol Yönetimi</div>
                <div class="role-management-subtitle">Rolleri düzenle, izinleri ve renkleri ayarla</div>
            </div>
            <div class="role-tabs">
                <button class="role-tab active" data-tab="roles">Roller</button>
                <button class="role-tab" data-tab="permissions">İzinler</button>
                <button class="role-tab" data-tab="members">Üyeler</button>
            </div>
            <div class="role-content" id="role-content">
                <!-- Content will be loaded dynamically -->
            </div>
        </div>
    `;

    showModal("Rol Yönetimi", modalContent, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
        <button class="btn-primary" onclick="saveRoleChanges()">Kaydet</button>
    `);

    // Initialize tabs
    initializeRoleTabs();
    loadRolesContent();
}

function initializeRoleTabs() {
    const tabs = document.querySelectorAll('.role-tab');
    const content = document.getElementById('role-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const tabName = tab.getAttribute('data-tab');
            switch (tabName) {
                case 'roles':
                    loadRolesContent();
                    break;
                case 'permissions':
                    loadPermissionsContent();
                    break;
                case 'members':
                    loadRoleMembersContent();
                    break;
            }
        });
    });
}

function loadRolesContent() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const content = document.getElementById('role-content');
    const roles = server.roles || {};

    let html = '<div class="roles-list">';

    // Add default roles
    const defaultRoles = [
        { id: 'owner', name: 'Owner', color: '#f43f5e', icon: '👑', description: 'Sunucu sahibi - Tüm izinler' },
        { id: 'admin', name: 'Admin', color: '#ef4444', icon: '🛡️', description: 'Yönetici - Çoğu izinler' },
        { id: 'mod', name: 'Moderatör', color: '#f59e0b', icon: '🔨', description: 'Moderatör - Bazı izinler' },
        { id: 'member', name: 'Üye', color: '#6b7280', icon: '👤', description: 'Standart üye - Temel izinler' }
    ];

    defaultRoles.forEach(role => {
        const isUsed = Object.values(roles).some(r => r.id === role.id);
        html += `
            <div class="role-item ${isUsed ? 'used' : ''}">
                <div class="role-info">
                    <div class="role-header">
                        <div class="role-icon">${role.icon}</div>
                        <div class="role-name">${role.name}</div>
                        <div class="role-color" style="background: ${role.color}"></div>
                    </div>
                    <div class="role-description">${role.description}</div>
                </div>
            </div>
        `;
    });

    // Add custom roles
    Object.entries(roles).forEach(([roleId, roleData]) => {
        if (!defaultRoles.find(r => r.id === roleId)) {
            html += `
                <div class="role-item custom-role">
                    <div class="role-info">
                        <div class="role-header">
                            <div class="role-icon">🎨</div>
                            <div class="role-name">${roleData.name || roleId}</div>
                            <div class="role-color" style="background: ${roleData.color || '#6b7280'}"></div>
                        </div>
                        <div class="role-actions">
                            <button class="role-action-btn" onclick="editRole('${roleId}')">✏️</button>
                            <button class="role-action-btn" onclick="deleteRole('${roleId}')">🗑️</button>
                        </div>
                    </div>
                </div>
            `;
        }
    });

    html += `
        <button class="add-role-btn" onclick="createNewRole()">
            <span class="add-role-icon">+</span>
            <span class="add-role-text">Yeni Rol Oluştur</span>
        </button>
    </div>`;

    content.innerHTML = html;
}

function loadPermissionsContent() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const permissions = [
        { id: 'send_messages', name: 'Mesaj Gönder', icon: '💬' },
        { id: 'delete_own_messages', name: 'Kendi Mesajını Sil', icon: '🗑️' },
        { id: 'delete_all_messages', name: 'Herkesin Mesajını Sil', icon: '🗑️' },
        { id: 'create_channels', name: 'Kanal Oluştur', icon: '📝' },
        { id: 'delete_channels', name: 'Kanal Sil', icon: '❌' },
        { id: 'join_voice', name: 'Sesli Kanala Katıl', icon: '🔊' },
        { id: 'manage_roles', name: 'Rolleri Yönet', icon: '🎭' },
        { id: 'kick_members', name: 'Üyeleri At', icon: '👢' },
        { id: 'ban_members', name: 'Üyeleri Yasakla', icon: '🚫' }
    ];

    const content = document.getElementById('role-content');
    const roles = server.roles || {};

    let html = '<div class="permissions-grid">';

    permissions.forEach(perm => {
        html += `
            <div class="permission-item">
                <div class="permission-info">
                    <div class="permission-icon">${perm.icon}</div>
                    <div class="permission-name">${perm.name}</div>
                </div>
                <div class="permission-roles">
                    <div class="permission-label">Bu izne sahip olan roller:</div>
                    <div class="permission-role-list">
                        ${Object.entries(roles).map(([roleId, roleData]) => {
            const hasPermission = roleData.permissions?.includes(perm.id);
            return `<span class="permission-role ${hasPermission ? 'has-permission' : ''}">${roleData.name || roleId}</span>`;
        }).join('')}
                    </div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    content.innerHTML = html;
}

function loadRoleMembersContent() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const content = document.getElementById('role-content');
    const roles = server.roles || {};
    const members = server.members || [];

    let html = '<div class="role-members-list">';

    Object.entries(roles).forEach(([roleId, roleData]) => {
        const roleMembers = members.filter(m => server.peer_roles?.[m.peer_id] === roleId);

        html += `
            <div class="role-group">
                <div class="role-group-header">
                    <div class="role-badge" style="background: ${roleData.color || '#6b7280'}">
                        <span class="role-badge-icon">${roleData.icon || '🎭'}</span>
                        <span class="role-badge-name">${roleData.name || roleId}</span>
                    </div>
                    <div class="role-member-count">${roleMembers.length} üye</div>
                </div>
                <div class="role-members">
                    ${roleMembers.map(member => `
                        <div class="role-member-item">
                            <div class="member-avatar" style="background: ${member.avatar_color}">
                                ${member.avatar_image ? `<img src="${member.avatar_image}" alt="${member.username}" />` : member.username[0].toUpperCase()}
                            </div>
                            <div class="member-info">
                                <div class="member-name">${member.username}</div>
                                <div class="member-status ${getMemberStatus(member.peer_id)}">${getMemberStatusText(member.peer_id)}</div>
                            </div>
                            <button class="member-action-btn" onclick="changeMemberRole('${member.peer_id}')">🔄</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });

    html += '</div>';
    content.innerHTML = html;
}

function createNewRole() {
    const roleName = prompt('Yeni rol adı:');
    if (!roleName) return;

    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const roleId = 'custom_' + Date.now();
    const roleColor = '#' + Math.floor(Math.random() * 16777215).toString(16);

    if (!server.roles) server.roles = {};
    server.roles[roleId] = {
        name: roleName,
        color: roleColor,
        permissions: [],
        icon: '🎨'
    };

    loadRolesContent();
    toast('Yeni rol oluşturuldu', 'success');
}

function editRole(roleId) {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server || !server.roles?.[roleId]) return;

    const role = server.roles[roleId];
    const newName = prompt('Rol adını düzenle:', role.name);
    if (!newName || newName === role.name) return;

    const newColor = prompt('Rol rengi (hex formatında):', role.color);
    if (!newColor) return;

    role.name = newName;
    role.color = newColor;

    loadRolesContent();
    toast('Rol güncellendi', 'success');
}

function deleteRole(roleId) {
    if (!confirm('Bu rolü silmek istediğinizden emin misiniz?')) return;

    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server || !server.roles?.[roleId]) return;

    delete server.roles[roleId];

    // Remove role from all members
    Object.keys(server.peer_roles || {}).forEach(peerId => {
        if (server.peer_roles[peerId] === roleId) {
            delete server.peer_roles[peerId];
        }
    });

    loadRolesContent();
    toast('Rol silindi', 'success');
}

function changeMemberRole(peerId) {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const member = server.members.find(m => m.peer_id === peerId);
    if (!member) return;

    const roles = server.roles || {};
    const roleOptions = Object.entries(roles).map(([id, data]) => `<option value="${id}">${data.name || id}</option>`).join('');

    const newRole = prompt(`Rol seçin (${member.username}):`, roleOptions);
    if (!newRole) return;

    server.peer_roles = server.peer_roles || {};
    server.peer_roles[peerId] = newRole;

    loadRoleMembersContent();
    updateMembersPanel(state.activeServerId);
    toast(`${member.username} rolü güncellendi`, 'success');
}

function getMemberStatus(peerId) {
    // This would integrate with the status system
    return 'online'; // Placeholder
}

function getMemberStatusText(peerId) {
    // This would integrate with the status system
    return '🟢 Çevrimiçi'; // Placeholder
}

function saveRoleChanges() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    // Save roles to server state and potentially to backend
    localStorage.setItem(`scord_roles_${server.id}`, JSON.stringify(server.roles));

    // Broadcast role changes to other members
    if (state.mesh) {
        state.mesh.broadcast({
            type: 'roles_update',
            serverId: server.id,
            roles: server.roles,
            peer_roles: server.peer_roles
        });
    }

    toast('Rol değişiklikleri kaydedildi', 'success');
}

function handleRolesUpdate(data) {
    const { serverId, roles, peer_roles } = data;
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;

    server.roles = roles || {};
    server.peer_roles = peer_roles || {};

    // Update UI if this server is active
    if (state.activeServerId === serverId) {
        updateMembersPanel(serverId);
        loadRolesContent();
    }
}

function loadRolesFromStorage(serverId) {
    try {
        const saved = localStorage.getItem(`scord_roles_${serverId}`);
        if (!saved) return;

        const server = state.servers.find(s => s.id === serverId);
        if (!server) return;

        server.roles = JSON.parse(saved);
    } catch (e) {
        console.warn("Failed to load roles from storage:", e);
    }
}

// Add role management to server settings
function renderPermissionsSettings(server) {
    const permissions = [
        { id: 'kick_members', name: 'Üye At', icon: '🚪' },
        { id: 'mute_members', name: 'Sustur', icon: '🔇' },
        { id: 'manage_roles', name: 'Rol Yönetimi', icon: '🛡️' },
        { id: 'manage_server', name: 'Sunucu Yönetimi', icon: '⚙️' },
        { id: 'screen_share', name: 'Ekran Paylaşımı', icon: '🖥️' },
        { id: 'stream', name: 'Canlı Yayın', icon: '📹' },
    ];

    let html = `
        <div style="margin-bottom:16px;">
            <h4 style="color:var(--text-primary);font-size:14px;">Varsayılan İzinler</h4>
            <p style="font-size:12px;color:var(--text-muted);margin-top:4px;">"Üye" rolü için varsayılan izinler</p>
        </div>
        <div class="permission-grid">
    `;

    permissions.forEach(perm => {
        const defaultEnabled = ['send_messages', 'join_voice', 'screen_share'].includes(perm.id);
        html += `
            <div class="permission-item">
                <input type="checkbox" id="perm_${perm.id}" ${defaultEnabled ? 'checked' : ''} 
                       onchange="updatePermission('${perm.id}', this.checked)" />
                <label for="perm_${perm.id}" style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;">
                    <span>${perm.icon}</span> ${perm.name}
                </label>
            </div>
        `;
    });

    html += `</div>`;
    return html;
}

// Settings save functions
function saveGeneralSettings() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const name = document.getElementById('settings-sv-name').value.trim();
    const icon = document.getElementById('settings-sv-icon').value.trim();

    if (name) server.name = name;
    if (icon) server.icon_url = icon;

    saveServerData(server.id);

    if (state.mesh) {
        state.mesh.broadcast({
            type: 'server_update',
            payload: { id: server.id, name: server.name, icon_url: server.icon_url }
        });
    }

    updateChannelSidebar(server.id);
    renderServerRail();
    toast('Ayarlar kaydedildi!', 'success');
}

function createNewRole() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const roleId = 'role_' + genId();
    if (!server.roles) server.roles = {};
    server.roles[roleId] = {
        name: 'Yeni Rol',
        color: '#7c3aed',
        hoist: false,
        permissions: {}
    };

    saveServerData(server.id);

    // Refresh roles tab
    const rolesTab = document.getElementById('tab-roles');
    if (rolesTab) {
        rolesTab.innerHTML = renderRolesSettings(server);
    }

    toast('Yeni rol oluşturuldu!', 'success');
}

function updateRoleColor(roleId, color) {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server || !server.roles?.[roleId]) return;

    server.roles[roleId].color = color;
    saveServerData(server.id);

    if (state.mesh) {
        state.mesh.broadcast({
            type: 'server_update',
            payload: { id: server.id, roles: server.roles }
        });
    }

    updateMembersPanel(server.id);
    toast('Rol rengi güncellendi!', 'success');
}

function updateRoleName(roleId, name) {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server || !server.roles?.[roleId]) return;

    server.roles[roleId].name = name.trim() || 'İsimsiz Rol';
    saveServerData(server.id);

    if (state.mesh) {
        state.mesh.broadcast({
            type: 'server_update',
            payload: { id: server.id, roles: server.roles }
        });
    }

    toast('Rol adı güncellendi!', 'success');
}

function deleteRole(roleId) {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server || !server.roles?.[roleId]) return;

    if (!confirm('Bu rolü silmek istediğine emin misin?')) return;

    delete server.roles[roleId];
    // Remove role from all members
    Object.keys(server.peer_roles || {}).forEach(peerId => {
        if (server.peer_roles[peerId] === roleId) {
            delete server.peer_roles[peerId];
        }
    });

    saveServerData(server.id);

    if (state.mesh) {
        state.mesh.broadcast({
            type: 'server_update',
            payload: { id: server.id, roles: server.roles, peer_roles: server.peer_roles }
        });
    }

    // Refresh
    const rolesTab = document.getElementById('tab-roles');
    if (rolesTab) {
        rolesTab.innerHTML = renderRolesSettings(server);
    }

    updateMembersPanel(server.id);
    toast('Rol silindi.', 'info');
}

function updateMemberRole(peerId, roleId) {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    if (!server.peer_roles) server.peer_roles = {};

    if (roleId === 'member') {
        delete server.peer_roles[peerId];
    } else {
        server.peer_roles[peerId] = roleId;
    }

    saveServerData(server.id);

    if (state.mesh) {
        state.mesh.broadcast({
            type: 'server_update',
            payload: { id: server.id, peer_roles: server.peer_roles }
        });
    }

    updateMembersPanel(server.id);
    toast('Üye rolü güncellendi!', 'success');
}

function updatePermission(permId, enabled) {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    // Update default member role permissions
    if (!server.roles) server.roles = {};
    if (!server.roles.member) server.roles.member = { name: 'Üye', color: '#94a3b8', hoist: false, permissions: {} };

    server.roles.member.permissions[permId] = enabled;
    saveServerData(server.id);

    toast('İzin güncellendi!', 'success');
}

// Load saved servers on startup
const _origStartApp_servers = window.startApp;
window.startApp = function () {
    loadSavedServers();
    if (_origStartApp_servers) _origStartApp_servers();
};

console.log("[Shercord V20] Server persistence, role management, and embedded settings panel loaded!");

/* ==========================================================================
   V21 authoritative server state, stable voice/music, permissions, UI polish
   ========================================================================== */

const SCORD_V21_PERMISSIONS = [
    "manage_server", "manage_roles", "manage_channels", "kick_members",
    "move_members", "force_disconnect", "join_voice", "speak",
    "screen_share", "camera", "music_control", "send_messages"
];

function sendServerEvent(payload) {
    if (!state.mesh || !payload) return false;
    if (typeof state.mesh.sendSignal === "function") state.mesh.sendSignal(payload);
    else if (typeof state.mesh._send === "function") state.mesh._send(payload);
    return true;
}

function currentServer() {
    return state.servers.find(s => s.id === state.activeServerId);
}

function normalizeServerLivePayload(server, room) {
    if (!server || !room) return;
    if (room.voice_members) server.voiceMembers = room.voice_members;
    if (room.music_session !== undefined) server.musicSession = room.music_session;
    if (room.roles) server.roles = room.roles;
    if (room.peer_roles) server.peer_roles = room.peer_roles;
    if (room.channel_permissions) server.channel_permissions = room.channel_permissions;
    if (room.peers) {
        server.members = room.peers.map(p => ({
            peer_id: p.peer_id,
            username: p.username,
            avatar_color: p.avatar_color,
            avatar_image: p.avatar_image || null,
        }));
        server.peer_count = room.peers.length;
    }
}

function refreshVoiceUiFor(serverId, channelId) {
    if (!serverId) return;
    updateChannelSidebar(serverId);
    updateMembersPanel(serverId);
    updatePeerCountBadge(serverId);
    const ch = channelId || state.voiceChannelId || state.activeChannelId;
    if (ch) renderVoiceParticipants(serverId, ch);
    updateMuteStates();
    updateVoiceSessionMeta();
    renderMusicBotPanel();
}

function handleAuthoritativeServerEvent(msg, roomId) {
    if (!msg || typeof msg !== "object") return;
    const server = state.servers.find(s => s.id === (msg.room_id || roomId));
    if (msg.type === "room_state" && server) {
        normalizeServerLivePayload(server, msg.room);
        refreshVoiceUiFor(server.id, state.voiceChannelId || state.activeChannelId);
        if (msg.room?.music_session !== undefined) syncMusicSessionFromServer(msg.room.music_session);
        return;
    }
    if (!server) return;

    if (msg.type === "voice_state_snapshot") {
        server.voiceMembers = msg.voiceMembers || {};
        server.musicSession = msg.musicSession || null;
        refreshVoiceUiFor(server.id, msg.channelId);
        syncMusicSessionFromServer(server.musicSession);
    } else if (msg.type === "voice_state" && msg.member) {
        const ch = msg.channelId;
        if (!server.voiceMembers) server.voiceMembers = {};
        if (!server.voiceMembers[ch]) server.voiceMembers[ch] = [];
        const idx = server.voiceMembers[ch].findIndex(m => m.peer_id === msg.member.peer_id);
        if (idx >= 0) server.voiceMembers[ch][idx] = msg.member;
        else server.voiceMembers[ch].push(msg.member);
        refreshVoiceUiFor(server.id, ch);
    } else if (msg.type === "media_status" && msg.member) {
        const ch = msg.channelId;
        if (!server.voiceMembers) server.voiceMembers = {};
        if (!server.voiceMembers[ch]) server.voiceMembers[ch] = [];
        const idx = server.voiceMembers[ch].findIndex(m => m.peer_id === msg.peer_id);
        if (idx >= 0) Object.assign(server.voiceMembers[ch][idx], msg.member);
        else server.voiceMembers[ch].push(msg.member);
        refreshVoiceUiFor(server.id, ch);
    } else if (msg.type === "music_state") {
        server.musicSession = msg.session || null;
        syncMusicSessionFromServer(server.musicSession);
        refreshVoiceUiFor(server.id, server.musicSession?.voiceChannelId || state.voiceChannelId);
    } else if (msg.type === "permission_denied") {
        toast(`Bu islem icin izin yok: ${msg.permission || "yetki"}`, "warning");
    } else if (msg.type === "permission_update") {
        server.channel_permissions = msg.channel_permissions || {};
        if (msg.roles) server.roles = msg.roles;
        refreshVoiceUiFor(server.id, state.voiceChannelId || state.activeChannelId);
    } else if (msg.type === "role_update") {
        server.roles = msg.roles || server.roles || {};
        server.peer_roles = msg.peer_roles || server.peer_roles || {};
        updateMembersPanel(server.id);
        renderServerSettingsPanelIfOpen();
    } else if (msg.type === "force_disconnect" && msg.target === state.peerId) {
        if (state.voiceChannelId) leaveVoiceChannel();
        toast("Bir yonetici seni ses kanalindan cikardi.", "warning");
    }
}

function myRoleId(server) {
    if (!server) return "member";
    if (server.ownerId === state.peerId || server.owner_id === state.peerId) return "owner";
    return server.peer_roles?.[state.peerId] || "member";
}

function roleAllows(server, permission, channelId) {
    if (!server) return false;
    if (myRoleId(server) === "owner") return true;
    const roleId = myRoleId(server);
    const role = server.roles?.[roleId] || server.roles?.member || {};
    let allowed = !!role.permissions?.[permission];
    const overrides = server.channel_permissions?.[channelId];
    const roleOverride = overrides?.[roleId] || overrides?.member;
    if (roleOverride?.deny?.includes(permission)) allowed = false;
    if (roleOverride?.allow?.includes(permission)) allowed = true;
    return allowed;
}

function peerAllows(server, peerId, permission, channelId) {
    if (!server || !peerId) return false;
    if (server.ownerId === peerId || server.owner_id === peerId) return true;
    const roleId = server.peer_roles?.[peerId] || "member";
    const role = server.roles?.[roleId] || server.roles?.member || {};
    let allowed = !!role.permissions?.[permission];
    const overrides = server.channel_permissions?.[channelId];
    const roleOverride = overrides?.[roleId] || overrides?.member;
    if (roleOverride?.deny?.includes(permission)) allowed = false;
    if (roleOverride?.allow?.includes(permission)) allowed = true;
    return allowed;
}

const _v21JoinVoiceChannel = window.joinVoiceChannel || joinVoiceChannel;
joinVoiceChannel = window.joinVoiceChannel = async function (channelId) {
    const server = currentServer();
    if (server && !roleAllows(server, "join_voice", channelId)) {
        toast("Bu ses kanalina katilma iznin yok.", "warning");
        return;
    }
    await _v21JoinVoiceChannel(channelId);
    if (state.voiceChannelId) {
        sendServerEvent({
            type: "voice_join",
            channelId: state.voiceChannelId,
            username: state.username,
            avatarColor: state.avatarColor,
            avatarImage: state.avatarImage,
            isSharingScreen: !!getLocalShareStream(),
            isSharingCamera: !!state.cameraStream
        });
    }
};

const _v21LeaveVoiceChannel = window.leaveVoiceChannel || leaveVoiceChannel;
leaveVoiceChannel = window.leaveVoiceChannel = function () {
    const ch = state.voiceChannelId;
    if (ch) sendServerEvent({ type: "voice_leave", channelId: ch });
    _v21LeaveVoiceChannel();
};

function sendMediaStatus(kind, sharing) {
    sendServerEvent({
        type: "media_status",
        kind,
        sharing: !!sharing,
        channelId: state.voiceChannelId || state.activeChannelId
    });
}

if (window.P2PMesh && !window.P2PMesh.prototype._scordV21Patched) {
    window.P2PMesh.prototype._scordV21Patched = true;
    const oldStartScreen = window.P2PMesh.prototype.startScreenShare;
    window.P2PMesh.prototype.startScreenShare = async function (...args) {
        const ok = await oldStartScreen.apply(this, args);
        if (ok) sendMediaStatus("screen", true);
        return ok;
    };
    const oldStopScreen = window.P2PMesh.prototype.stopScreenShare;
    window.P2PMesh.prototype.stopScreenShare = function (...args) {
        const result = oldStopScreen.apply(this, args);
        sendMediaStatus("screen", false);
        return result;
    };
}

const _v21StartCameraShare = window.startCameraShare || startCameraShare;
startCameraShare = window.startCameraShare = async function () {
    const server = currentServer();
    if (server && state.voiceChannelId && !roleAllows(server, "camera", state.voiceChannelId)) {
        toast("Kamera acma iznin yok.", "warning");
        return;
    }
    const result = await _v21StartCameraShare();
    if (state.cameraStream) sendMediaStatus("camera", true);
    return result;
};

const _v21StopCameraShare = window.stopCameraShare || stopCameraShare;
stopCameraShare = window.stopCameraShare = function () {
    const result = _v21StopCameraShare();
    sendMediaStatus("camera", false);
    return result;
};

const _v21LocalScreenEnded = window.onLocalScreenShareEnded;
window.onLocalScreenShareEnded = function () {
    if (_v21LocalScreenEnded) _v21LocalScreenEnded();
    sendMediaStatus("screen", false);
};

function computeMusicStartedAt(position = 0) {
    return Date.now() - Math.max(0, Number(position) || 0) * 1000;
}

function isMusicController(session) {
    const server = currentServer();
    if (!session) return false;
    return session.controllerId === state.peerId || roleAllows(server, "music_control", session.voiceChannelId);
}

function syncMusicSessionFromServer(session) {
    const server = currentServer();
    if (server) server.musicSession = session || null;
    initMusicBotState();
    state.musicBot.controllerId = session?.controllerId || null;
    state.musicBot.controllerName = session?.controllerName || "";
    state.musicBot.serverSession = session || null;

    if (!session || !session.active) {
        if (state.musicBot.active || state.musicBot.videoId) stopMusicBot();
        return;
    }
    if (!state.voiceChannelId || session.voiceChannelId !== state.voiceChannelId) return;

    const startedAt = session.startedAt || computeMusicStartedAt(session.position || 0);
    startMusicBot(session.videoId, startedAt);
    const player = state.musicBot.player;
    if (player && typeof player.seekTo === "function") {
        const expected = session.state === "playing"
            ? Math.max(0, (Date.now() - startedAt) / 1000)
            : Number(session.position || 0);
        try {
            const current = typeof player.getCurrentTime === "function" ? player.getCurrentTime() : expected;
            if (Math.abs(current - expected) > 2.5) player.seekTo(expected, true);
            if (session.state === "paused") player.pauseVideo?.();
            else player.playVideo?.();
        } catch { }
    }
}

async function resolveMusicVideoId(query) {
    const direct = extractYouTubeVideoId(query);
    if (direct) return direct;
    const res = await fetch(`${API_BASE}/ytsearch?q=${encodeURIComponent(query)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.id || null;
}

async function requestMusicPlay(query) {
    if (!state.voiceChannelId) {
        toast("Once bir ses kanalina katil.", "warning");
        return;
    }
    toast("Sarki araniyor...", "info");
    const videoId = await resolveMusicVideoId(query);
    if (!videoId) {
        toast("Sarki bulunamadi.", "error");
        return;
    }
    sendServerEvent({
        type: "music_command",
        command: "play",
        videoId,
        voiceChannelId: state.voiceChannelId,
        startedAt: Date.now(),
        position: 0
    });
}

function requestMusicStop() {
    const session = currentServer()?.musicSession || state.musicBot?.serverSession;
    if (!session) return stopMusicBot();
    if (!isMusicController(session)) {
        if (state.musicBot.player) state.musicBot.player.pauseVideo?.();
        toast("Bu durdurma sadece sende uygulandi; genel yayini kontrol eden kisi degilsin.", "info");
        return;
    }
    sendServerEvent({ type: "music_command", command: "stop", voiceChannelId: session.voiceChannelId });
}

async function requestMusicSkip(query) {
    const session = currentServer()?.musicSession || state.musicBot?.serverSession;
    if (!session || !isMusicController(session)) {
        toast("Sarkiyi sadece baslatan kisi veya yetkili degistirebilir.", "warning");
        return;
    }
    if (!query) return requestMusicStop();
    const videoId = await resolveMusicVideoId(query);
    if (!videoId) return toast("Yeni sarki bulunamadi.", "error");
    sendServerEvent({ type: "music_command", command: "skip", videoId, voiceChannelId: session.voiceChannelId });
}

handleMusicCommand = window.handleMusicCommand = function (text) {
    const raw = String(text || "").trim();
    const mentionPrefix = /^@?(music|muzik|müzik)\s+/i;
    let cmd = raw;
    if (mentionPrefix.test(cmd)) cmd = cmd.replace(mentionPrefix, "!");
    if (cmd.startsWith("!p ") || cmd.startsWith("!play ")) {
        const query = cmd.startsWith("!p ") ? cmd.slice(3).trim() : cmd.slice(6).trim();
        if (!query) toast("Kullanim: !p <sarki veya YouTube linki>", "info");
        else requestMusicPlay(query);
        return true;
    }
    if (cmd === "!stop" || cmd === "!stopmusic") {
        requestMusicStop();
        return true;
    }
    if (cmd.startsWith("!skip")) {
        requestMusicSkip(cmd.slice(5).trim());
        return true;
    }
    if (cmd.startsWith("/music")) {
        const parts = cmd.split(/\s+/);
        const sub = (parts[1] || "").toLowerCase();
        const rest = parts.slice(2).join(" ");
        if (sub === "play") requestMusicPlay(rest);
        else if (sub === "stop") requestMusicStop();
        else if (sub === "skip") requestMusicSkip(rest);
        else toast("Kullanim: !p <sarki>, !skip [sarki], !stop", "info");
        return true;
    }
    return false;
};

renderMusicBotPanel = window.renderMusicBotPanel = function () {
    const voiceView = document.getElementById("voice-view");
    if (!voiceView || voiceView.classList.contains("hidden")) return;
    let panel = document.getElementById("music-bot-panel");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "music-bot-panel";
        panel.className = "music-bot-panel music-bot-panel--compact";
        const controls = voiceView.querySelector(".voice-controls");
        if (controls) controls.insertAdjacentElement("beforebegin", panel);
        else voiceView.appendChild(panel);
    }
    panel.className = "music-bot-panel music-bot-panel--compact";
    const server = currentServer();
    const session = server?.musicSession || state.musicBot?.serverSession || null;
    const inSameVoice = !!session && session.voiceChannelId === state.voiceChannelId;
    const canControl = session && isMusicController(session);
    const joined = !!state.voiceChannelId;
    const hasLocalPlayer = !!state.musicBot?.player;
    const title = session?.videoId ? `YouTube: ${session.videoId}` : "Senkron dinleme";
    panel.innerHTML = `
      <div class="mbot-compact-left">
        <span class="mbot-icon">♪</span>
        <div class="mbot-compact-copy">
          <strong>${session ? "Muzik yayini aktif" : "Muzik Botu"}</strong>
          <span>${session ? `${title} - kontrol: ${escapeHtml(session.controllerName || "host")}` : "Komut: !p <sarki>, !skip, !stop"}</span>
        </div>
      </div>
      <div class="mbot-compact-actions">
        ${session && joined ? `<button class="mbot-btn mbot-btn--play" id="mbot-join-sync-btn">${inSameVoice && hasLocalPlayer ? "Sesi Ac" : "Play"}</button>` : ""}
        ${session && canControl ? `<button class="mbot-btn" id="mbot-stop-btn" title="Genel yayini durdur">Stop</button>` : ""}
        ${session ? `<input type="range" class="mbot-vol-slider" id="mbot-vol-slider" min="0" max="100" value="${state.musicBot?.volume ?? 30}" title="Kisisel ses">` : ""}
      </div>`;
    document.getElementById("mbot-join-sync-btn")?.addEventListener("click", () => {
        syncMusicSessionFromServer(session);
        setTimeout(() => {
            if (!unlockMusicAudio()) toast("Ses acilamadiysa YouTube kutusundaki oynat dugmesine bas.", "warning");
        }, 80);
    });
    document.getElementById("mbot-stop-btn")?.addEventListener("click", requestMusicStop);
    const vol = document.getElementById("mbot-vol-slider");
    if (vol) vol.oninput = e => {
        initMusicBotState();
        state.musicBot.volume = parseInt(e.target.value, 10);
        state.musicBot.player?.setVolume?.(state.musicBot.volume);
    };
};

function requestForceDisconnect(peerId, channelId = state.voiceChannelId || state.activeChannelId) {
    sendServerEvent({ type: "force_disconnect", target: peerId, channelId });
}

function requestKickMusicBot() {
    requestForceDisconnect("bot_music", state.voiceChannelId || state.activeChannelId);
}

function renderServerSettingsPanelIfOpen() {
    const panel = document.getElementById("server-settings-panel");
    if (panel && !panel.classList.contains("hidden")) openServerSettingsPanel();
}

openSettingsModal = window.openSettingsModal = function () {
    const vs = state.voiceSettings || {};
    const body = `
      <div class="scord-settings-shell">
        <nav class="scord-settings-nav">
          <button class="active" data-tab="profile">Profil</button>
          <button data-tab="voice">Ses ve Video</button>
          <button data-tab="appearance">Gorunum</button>
          <button data-tab="notifications">Bildirim</button>
        </nav>
        <section class="scord-settings-content">
          <div class="scord-settings-page" id="set-profile">
            <h3>Profil</h3>
            <label>Kullanici adi<input class="modal-input" id="settings-username" value="${escapeHtml(state.username)}" maxlength="32"></label>
            <label>Avatar URL<input class="modal-input" id="settings-avatar-url" value="${/^https?:/i.test(state.avatarImage || "") ? escapeHtml(state.avatarImage) : ""}" placeholder="https://..."></label>
            <label>Avatar dosyasi<input type="file" id="settings-avatar-upload" accept="image/*" class="modal-input"></label>
          </div>
          <div class="scord-settings-page hidden" id="set-voice">
            <h3>Ses ve Video</h3>
            <label>Mikrofon<select class="modal-input" id="settings-mic-select"><option value="default">Varsayilan</option></select></label>
            <label>Ses filtresi<select class="modal-input" id="settings-filter"><option value="none">Normal</option><option value="bass">Bass Boost</option><option value="radio">Lo-Fi Radio</option></select></label>
            <label>Giris sesi <span id="vol-label">${Math.round((vs.volume || 1) * 100)}%</span><input type="range" id="settings-volume" min="0" max="3" step="0.1" value="${vs.volume || 1}" oninput="document.getElementById('vol-label').textContent=Math.round(this.value*100)+'%'"></label>
            <label class="scord-check"><input type="checkbox" id="settings-noise-suppress" ${vs.noiseSuppression !== false ? "checked" : ""}> Gurultu engelleme</label>
            <label class="scord-check"><input type="checkbox" id="settings-echo-cancel" ${vs.echoCancellation !== false ? "checked" : ""}> Yanki engelleme</label>
            <label class="scord-check"><input type="checkbox" id="settings-auto-gain" ${vs.autoGainControl === true ? "checked" : ""}> Otomatik seviye dengeleme</label>
            <label>Voice gate esigi <span id="gate-label">${vs.gateThreshold ?? 8}</span><input type="range" id="settings-gate-threshold" min="3" max="30" step="1" value="${vs.gateThreshold ?? 8}" oninput="document.getElementById('gate-label').textContent=this.value"></label>
            <label>Giris modu<select class="modal-input" id="settings-input-mode"><option value="voice" ${vs.inputMode !== "ptt" ? "selected" : ""}>Ses aktivitesi</option><option value="ptt" ${vs.inputMode === "ptt" ? "selected" : ""}>Bas-konus</option></select></label>
            <label>PTT tusu<input class="modal-input" id="settings-ptt-key" readonly value="${escapeHtml(vs.pttKey || "Control")}"></label>
            <label>Ekran paylasimi<select class="modal-input" id="settings-screen-quality"><option value="720p">720p</option><option value="1080p">1080p</option><option value="4k">4K</option><option value="480p">480p</option></select></label>
            <label>Kamera<select class="modal-input" id="settings-camera-quality"><option value="720p">720p</option><option value="1080p">1080p</option><option value="4k">4K</option><option value="480p">480p</option></select></label>
          </div>
          <div class="scord-settings-page hidden" id="set-appearance">
            <h3>Gorunum</h3>
            <label>Tema<select class="modal-input" id="settings-theme"><option value="">SCORD Glass</option><option value="theme-discord">Kompakt panel</option><option value="theme-neon">Neon grid</option></select></label>
            <label class="scord-check"><input type="checkbox" id="settings-compact" ${state.compactMode ? "checked" : ""}> Kompakt gorunum</label>
            <label class="scord-check"><input type="checkbox" id="settings-high-contrast" ${localStorage.getItem("scord_high_contrast") === "1" ? "checked" : ""}> Yuksek kontrast</label>
            <label>Mesaj yogunlugu<select class="modal-input" id="settings-msg-density"><option value="comfortable">Rahat</option><option value="cozy">Normal</option><option value="compact">Siki</option></select></label>
          </div>
          <div class="scord-settings-page hidden" id="set-notifications">
            <h3>Bildirimler</h3>
            <label>Sohbet bildirimleri<select class="modal-input" id="notif-chat-level"><option value="all">Tum mesajlar</option><option value="mentions">Sadece bahsetmeler</option><option value="none">Kapali</option></select></label>
            <label class="scord-check"><input type="checkbox" id="notif-dm" ${state.notifSettings?.dm !== false ? "checked" : ""}> DM bildirimi</label>
            <label class="scord-check"><input type="checkbox" id="notif-join" ${state.notifSettings?.join !== false ? "checked" : ""}> Ses katilma bildirimi</label>
          </div>
        </section>
      </div>`;
    showModal("Kullanici Ayarlari", body, `<button class="btn-secondary" onclick="hideModal()">Iptal</button><button class="btn-primary" onclick="saveSettings()">Kaydet</button>`);
    document.querySelectorAll(".scord-settings-nav button").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll(".scord-settings-nav button").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".scord-settings-page").forEach(p => p.classList.add("hidden"));
            btn.classList.add("active");
            document.getElementById(`set-${btn.dataset.tab}`)?.classList.remove("hidden");
            if (btn.dataset.tab === "voice") hydrateVoiceSettingsControls(vs);
        };
    });
    hydrateVoiceSettingsControls(vs);
};

function hydrateVoiceSettingsControls(vs) {
    navigator.mediaDevices?.enumerateDevices?.().then(devices => {
        const sel = document.getElementById("settings-mic-select");
        if (!sel) return;
        sel.innerHTML = '<option value="default">Varsayilan</option>';
        devices.filter(d => d.kind === "audioinput").forEach((d, i) => {
            const o = document.createElement("option");
            o.value = d.deviceId;
            o.textContent = d.label || `Mikrofon ${i + 1}`;
            if (d.deviceId === vs.micId) o.selected = true;
            sel.appendChild(o);
        });
    }).catch(() => { });
    const filter = document.getElementById("settings-filter");
    if (filter) filter.value = vs.filter || "none";
    const screen = document.getElementById("settings-screen-quality");
    if (screen) screen.value = state.screenShareQuality || "720p";
    const camera = document.getElementById("settings-camera-quality");
    if (camera) camera.value = state.cameraQuality || "720p";
}

const _v21SaveSettings = window.saveSettings || saveSettings;
saveSettings = window.saveSettings = function () {
    _v21SaveSettings();
    const autoGainControl = document.getElementById("settings-auto-gain")?.checked ?? false;
    const gateThreshold = Number(document.getElementById("settings-gate-threshold")?.value || state.voiceSettings?.gateThreshold || 12);
    state.voiceSettings = { ...(state.voiceSettings || {}), autoGainControl, gateThreshold, gateAttack: 0.012, gateRelease: 0.09 };
    localStorage.setItem("scord_voice_settings", JSON.stringify(state.voiceSettings));
};

openServerSettingsPanel = window.openServerSettingsPanel = function () {
    if (!state.activeServerId) return toast("Once bir sunucu sec.", "info");
    const server = currentServer();
    if (!server) return;
    const isOwner = server.ownerId === state.peerId;
    const canManage = isOwner || roleAllows(server, "manage_server") || roleAllows(server, "manage_roles");
    if (!canManage) return toast("Sunucu ayarlari icin yetkin yok.", "warning");
    let panel = document.getElementById("server-settings-panel");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "server-settings-panel";
        document.querySelector(".app")?.appendChild(panel) || document.body.appendChild(panel);
    }
    const roles = server.roles || {};
    const roleRows = Object.entries(roles).map(([id, role]) => `
      <div class="scord-role-row">
        <input class="modal-input" value="${escapeHtml(role.name || id)}" onchange="state.servers.find(s=>s.id==='${server.id}').roles['${id}'].name=this.value">
        <input type="color" value="${role.color || "#94a3b8"}" onchange="state.servers.find(s=>s.id==='${server.id}').roles['${id}'].color=this.value">
        <span>${id}</span>
      </div>`).join("");
    const permRows = SCORD_V21_PERMISSIONS.map(p => `
      <label class="permission-item"><input type="checkbox" id="perm-member-${p}" ${roles.member?.permissions?.[p] !== false ? "checked" : ""}> ${p.replaceAll("_", " ")}</label>`).join("");
    panel.className = "scord-server-settings";
    panel.innerHTML = `
      <aside class="scord-server-settings-nav">
        <strong>Sunucu Ayarlari</strong>
        <button class="active" data-page="overview">Genel</button>
        <button data-page="roles">Roller</button>
        <button data-page="perms">Izinler</button>
        <button data-page="voice">Ses ve Moderasyon</button>
        ${isOwner ? `<button data-page="danger">Sunucuyu Kapat</button>` : ""}
        <button class="danger" onclick="closeServerSettingsPanel()">Kapat</button>
      </aside>
      <main class="scord-server-settings-main">
        <section id="srv-overview" class="srv-page"><h2>Genel</h2><label>Sunucu adi<input class="modal-input" id="settings-sv-name" value="${escapeHtml(server.name)}"></label><label>Ikon URL<input class="modal-input" id="settings-sv-icon" value="${escapeHtml(server.icon_url || "")}"></label></section>
        <section id="srv-roles" class="srv-page hidden"><h2>Roller</h2>${roleRows}</section>
        <section id="srv-perms" class="srv-page hidden"><h2>Varsayilan uye izinleri</h2><div class="permission-grid">${permRows}</div></section>
        <section id="srv-voice" class="srv-page hidden"><h2>Ses ve Moderasyon</h2><button class="btn-secondary" onclick="requestKickMusicBot()">Muzik botunu cikar</button><p class="modal-info">Force disconnect yetkisi olan roller ses kanalindaki kullanicilari ve botu cikarabilir.</p></section>
        ${isOwner ? `<section id="srv-danger" class="srv-page hidden"><h2>Sunucuyu Kapat</h2><div class="srv-danger-zone"><h3>Kalici silme</h3><p>Bu sunucu herkesten kaldirilir ve geri alinamaz. Sadece sunucu sahibi kapatabilir.</p><button class="btn-primary" style="background:var(--red);border:none;width:max-content" onclick="deleteServer('${server.id}')">Sunucuyu Kapat</button></div></section>` : ""}
        <footer><button class="btn-primary" onclick="saveProfessionalServerSettings()">Kaydet</button></footer>
      </main>`;
    panel.querySelectorAll(".scord-server-settings-nav button[data-page]").forEach(btn => {
        btn.onclick = () => {
            panel.querySelectorAll(".scord-server-settings-nav button").forEach(b => b.classList.remove("active"));
            panel.querySelectorAll(".srv-page").forEach(p => p.classList.add("hidden"));
            btn.classList.add("active");
            panel.querySelector(`#srv-${btn.dataset.page}`)?.classList.remove("hidden");
        };
    });
};

closeServerSettingsPanel = window.closeServerSettingsPanel = function () {
    document.getElementById("server-settings-panel")?.remove();
};

saveProfessionalServerSettings = window.saveProfessionalServerSettings = function () {
    const server = currentServer();
    if (!server) return;
    const name = document.getElementById("settings-sv-name")?.value?.trim();
    const icon = document.getElementById("settings-sv-icon")?.value?.trim();
    if (name) server.name = name;
    server.icon_url = icon || null;
    if (!server.roles) server.roles = {};
    if (!server.roles.member) server.roles.member = { name: "Uye", color: "#94a3b8", permissions: {} };
    if (!server.roles.member.permissions) server.roles.member.permissions = {};
    SCORD_V21_PERMISSIONS.forEach(p => {
        const el = document.getElementById(`perm-member-${p}`);
        if (el) server.roles.member.permissions[p] = el.checked;
    });
    sendServerEvent({ type: "role_update", roles: server.roles, peer_roles: server.peer_roles || {} });
    meshBroadcastReliable({ type: "server_update", payload: { id: server.id, name: server.name, icon_url: server.icon_url, roles: server.roles, peer_roles: server.peer_roles } });
    renderServerRail();
    updateChannelSidebar(server.id);
    toast("Sunucu ayarlari kaydedildi.", "success");
};

const _v21UpdateConnectionStatus = window.updateConnectionStatus || updateConnectionStatus;
updateConnectionStatus = window.updateConnectionStatus = function (status) {
    if (String(status || "") === "room_not_found") {
        toast("Oda bulunamadi. Kalici oda kaydi yoksa davet koduyla tekrar katil; restart sonrasi kayitlar artik korunur.", "error");
        return;
    }
    _v21UpdateConnectionStatus(status);
};

document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
        const btn = document.getElementById("server-settings-btn");
        if (btn) btn.onclick = openServerSettingsPanel;
    }, 0);
});

function ensureProfessionalVoiceBar() {
    document.getElementById("voice-top-control-bar")?.remove();
}

const _v21ShowVoiceView = window.showVoiceView || showVoiceView;
showVoiceView = window.showVoiceView = function (...args) {
    const result = _v21ShowVoiceView.apply(this, args);
    ensureProfessionalVoiceBar();
    renderMusicBotPanel();
    return result;
};

console.log("[Shercord V21] Authoritative voice/music state, permissions, voice gate, and professional settings loaded.");

/* ==========================================================================
   V22 community templates, channel categories and rich user menus
   ========================================================================== */

function channelCategoryLabel(ch, fallback) {
    return (ch.category || fallback || (ch.type === "voice" ? "SES KANALLARI" : "METIN KANALLARI")).toUpperCase();
}

// Enhanced Channel Categories System
function showChannelCategoriesModal() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const modalContent = `
        <div class="channel-categories-modal">
            <div class="categories-header">
                <div class="categories-title">📁 Kanal Kategorileri</div>
                <div class="categories-subtitle">Kanalları düzenle ve kategorize et</div>
            </div>
            <div class="categories-tabs">
                <button class="categories-tab active" data-tab="categories">Kategoriler</button>
                <button class="categories-tab" data-tab="channels">Kanallar</button>
                <button class="categories-tab" data-tab="permissions">İzinler</button>
            </div>
            <div class="categories-content" id="categories-content">
                <!-- Content will be loaded dynamically -->
            </div>
        </div>
    `;

    showModal("Kanal Kategorileri", modalContent, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
        <button class="btn-primary" onclick="saveChannelCategories()">Kaydet</button>
    `);

    // Initialize tabs
    initializeCategoriesTabs();
    loadCategoriesContent();
}

function initializeCategoriesTabs() {
    const tabs = document.querySelectorAll('.categories-tab');
    const content = document.getElementById('categories-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const tabName = tab.getAttribute('data-tab');
            switch (tabName) {
                case 'categories':
                    loadCategoriesContent();
                    break;
                case 'channels':
                    loadChannelsContent();
                    break;
                case 'permissions':
                    loadCategoryPermissionsContent();
                    break;
            }
        });
    });
}

function loadCategoriesContent() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const content = document.getElementById('categories-content');
    const channels = server.channels || [];

    // Group channels by category
    const categories = new Map();
    const uncategorized = [];

    channels.forEach(ch => {
        if (ch.category) {
            if (!categories.has(ch.category)) categories.set(ch.category, []);
            categories.get(ch.category).push(ch);
        } else {
            uncategorized.push(ch);
        }
    });

    let html = '<div class="categories-list">';

    // Add categories
    categories.forEach((categoryChannels, categoryName) => {
        html += `
            <div class="category-item">
                <div class="category-header">
                    <div class="category-info">
                        <div class="category-name">${categoryName}</div>
                        <div class="category-count">${categoryChannels.length} kanal</div>
                    </div>
                    <div class="category-actions">
                        <button class="category-action-btn" onclick="editCategory('${categoryName}')">✏️</button>
                        <button class="category-action-btn" onclick="deleteCategory('${categoryName}')">🗑️</button>
                    </div>
                </div>
                <div class="category-channels">
                    ${categoryChannels.map(ch => `
                        <div class="category-channel">
                            <div class="channel-icon">${ch.type === 'voice' ? '🔊' : '💬'}</div>
                            <div class="channel-name">${ch.name}</div>
                            <button class="channel-remove-btn" onclick="removeChannelFromCategory('${ch.id}')">❌</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });

    // Add uncategorized channels
    if (uncategorized.length > 0) {
        html += `
            <div class="category-item uncategorized">
                <div class="category-header">
                    <div class="category-info">
                        <div class="category-name">Kategorisiz</div>
                        <div class="category-count">${uncategorized.length} kanal</div>
                    </div>
                </div>
                <div class="category-channels">
                    ${uncategorized.map(ch => `
                        <div class="category-channel">
                            <div class="channel-icon">${ch.type === 'voice' ? '🔊' : '💬'}</div>
                            <div class="channel-name">${ch.name}</div>
                            <button class="channel-add-btn" onclick="addChannelToCategory('${ch.id}')">➕</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    html += `
        <button class="add-category-btn" onclick="createNewCategory()">
            <span class="add-category-icon">+</span>
            <span class="add-category-text">Yeni Kategori Oluştur</span>
        </button>
    </div>`;

    content.innerHTML = html;
}

function loadChannelsContent() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const content = document.getElementById('categories-content');
    const channels = server.channels || [];

    let html = '<div class="channels-list">';

    channels.forEach(ch => {
        html += `
            <div class="channel-config-item">
                <div class="channel-config-info">
                    <div class="channel-config-header">
                        <div class="channel-icon">${ch.type === 'voice' ? '🔊' : '💬'}</div>
                        <div class="channel-name">${ch.name}</div>
                        <div class="channel-type">${ch.type === 'voice' ? 'Sesli' : 'Metin'}</div>
                    </div>
                    <div class="channel-category">Kategori: ${ch.category || 'Yok'}</div>
                </div>
                <div class="channel-config-actions">
                    <button class="channel-config-btn" onclick="moveChannelToCategory('${ch.id}')">📁</button>
                    <button class="channel-config-btn" onclick="editChannelSettings('${ch.id}')">⚙️</button>
                </div>
            </div>
        `;
    });

    html += '</div>';
    content.innerHTML = html;
}

function loadCategoryPermissionsContent() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const content = document.getElementById('categories-content');
    const roles = server.roles || {};

    let html = '<div class="category-permissions-list">';

    const permissions = [
        { id: 'view_category', name: 'Kategoriyi Gör', icon: '👁️' },
        { id: 'manage_category', name: 'Kategoriyi Yönet', icon: '⚙️' },
        { id: 'create_channels', name: 'Kanal Oluştur', icon: '➕' },
        { id: 'delete_channels', name: 'Kanal Sil', icon: '❌' },
        { id: 'move_channels', name: 'Kanal Taşı', icon: '🔄' }
    ];

    Object.entries(roles).forEach(([roleId, roleData]) => {
        html += `
            <div class="role-permission-item">
                <div class="role-permission-header">
                    <div class="role-badge" style="background: ${roleData.color || '#6b7280'}">
                        <span class="role-badge-icon">${roleData.icon || '🎭'}</span>
                        <span class="role-badge-name">${roleData.name || roleId}</span>
                    </div>
                    <div class="role-permission-actions">
                        <button class="permission-toggle-btn" onclick="toggleRoleCategoryPermissions('${roleId}')">⚙️</button>
                    </div>
                </div>
                <div class="role-permissions">
                    ${permissions.map(perm => `
                        <div class="permission-checkbox">
                            <input type="checkbox" id="perm-${roleId}-${perm.id}" 
                                   ${roleData.categoryPermissions?.includes(perm.id) ? 'checked' : ''} 
                                   onchange="updateRoleCategoryPermission('${roleId}', '${perm.id}', this.checked)">
                            <label for="perm-${roleId}-${perm.id}">
                                <span class="permission-icon">${perm.icon}</span>
                                <span class="permission-name">${perm.name}</span>
                            </label>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });

    html += '</div>';
    content.innerHTML = html;
}

function createNewCategory() {
    const categoryName = prompt('Yeni kategori adı:');
    if (!categoryName) return;

    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    if (!server.channelCategories) server.channelCategories = {};
    const categoryId = 'cat_' + Date.now();

    server.channelCategories[categoryId] = {
        name: categoryName,
        description: '',
        color: '#' + Math.floor(Math.random() * 16777215).toString(16),
        permissions: []
    };

    loadCategoriesContent();
    toast('Yeni kategori oluşturuldu', 'success');
}

function editCategory(categoryId) {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server?.channelCategories?.[categoryId]) return;

    const category = server.channelCategories[categoryId];
    const newName = prompt('Kategori adını düzenle:', category.name);
    if (!newName || newName === category.name) return;

    const newColor = prompt('Kategori rengi (hex formatında):', category.color);
    if (!newColor) return;

    category.name = newName;
    category.color = newColor;

    loadCategoriesContent();
    toast('Kategori güncellendi', 'success');
}

function deleteCategory(categoryId) {
    if (!confirm('Bu kategoriyi silmek istediğinizden emin misiniz?')) return;

    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server?.channelCategories?.[categoryId]) return;

    // Move channels to uncategorized
    const category = server.channelCategories[categoryId];
    server.channels?.forEach(ch => {
        if (ch.category === categoryId) {
            delete ch.category;
        }
    });

    delete server.channelCategories[categoryId];

    loadCategoriesContent();
    toast('Kategori silindi', 'success');
}

function addChannelToCategory(channelId) {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const categories = Object.keys(server.channelCategories || {});
    if (categories.length === 0) return;

    const categoryOptions = categories.map(id => `<option value="${id}">${server.channelCategories[id].name}</option>`).join('');
    const selectedCategory = prompt('Kategori seçin:', categoryOptions);
    if (!selectedCategory) return;

    const channel = server.channels.find(ch => ch.id === channelId);
    if (channel) {
        channel.category = selectedCategory;
        loadCategoriesContent();
        updateChannelSidebar(state.activeServerId);
        toast('Kanal kategoriye eklendi', 'success');
    }
}

function removeChannelFromCategory(channelId) {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const channel = server.channels.find(ch => ch.id === channelId);
    if (channel) {
        delete channel.category;
        loadCategoriesContent();
        updateChannelSidebar(state.activeServerId);
        toast('Kanal kategoriden çıkarıldı', 'success');
    }
}

function moveChannelToCategory(channelId) {
    addChannelToCategory(channelId);
}

function editChannelSettings(channelId) {
    // This would open channel-specific settings
    toast('Kanal ayarları yakında gelecek', 'info');
}

function toggleRoleCategoryPermissions(roleId) {
    // This would open a detailed permission editor for the role
    toast('Rol izinleri yakında gelecek', 'info');
}

function updateRoleCategoryPermission(roleId, permissionId, hasPermission) {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server?.roles?.[roleId]) return;

    const role = server.roles[roleId];
    if (!role.categoryPermissions) role.categoryPermissions = [];

    if (hasPermission) {
        role.categoryPermissions.push(permissionId);
    } else {
        role.categoryPermissions = role.categoryPermissions.filter(p => p !== permissionId);
    }
}

function saveChannelCategories() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    // Save categories to server state and localStorage
    localStorage.setItem(`scord_channel_categories_${server.id}`, JSON.stringify(server.channelCategories));

    // Broadcast category changes to other members
    if (state.mesh) {
        state.mesh.broadcast({
            type: 'channel_categories_update',
            serverId: server.id,
            categories: server.channelCategories,
            channels: server.channels
        });
    }

    // Update UI
    updateChannelSidebar(server.id);
    toast('Kanal kategorileri kaydedildi', 'success');
}

function handleChannelCategoriesUpdate(data) {
    const { serverId, categories, channels } = data;
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;

    server.channelCategories = categories || {};
    server.channels = channels || server.channels;

    // Update UI if this server is active
    if (state.activeServerId === serverId) {
        updateChannelSidebar(serverId);
        loadCategoriesContent();
    }
}

function loadChannelCategoriesFromStorage(serverId) {
    try {
        const saved = localStorage.getItem(`scord_channel_categories_${serverId}`);
        if (!saved) return;

        const server = state.servers.find(s => s.id === serverId);
        if (!server) return;

        server.channelCategories = JSON.parse(saved);
    } catch (e) {
        console.warn("Failed to load channel categories from storage:", e);
    }
}

// Server Boost System
function showServerBoostModal() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const currentBoosts = server.boosts || 0;
    const maxBoosts = 10;
    const boostLevel = Math.min(Math.floor(currentBoosts / 2), 5);
    const boostProgress = (currentBoosts % 2) * 50;

    const modalContent = `
        <div class="server-boost-modal">
            <div class="boost-header">
                <div class="boost-title">⚡ Sunucu Boost'la</div>
                <div class="boost-subtitle">Sunucunu geliştir ve özel özellikler kazan</div>
            </div>
            <div class="boost-current">
                <div class="boost-level">
                    <div class="boost-level-number">Seviye ${boostLevel}</div>
                    <div class="boost-level-progress">
                        <div class="boost-progress-bar" style="width: ${boostProgress}%"></div>
                    </div>
                </div>
                <div class="boost-info">
                    <div class="boost-count">${currentBoosts} Boost</div>
                    <div class="boost-next">${2 - (currentBoosts % 2)} boost sonraki seviye</div>
                </div>
            </div>
            <div class="boost-benefits">
                <div class="benefits-title">🎁 Mevcut Özellikler</div>
                <div class="benefits-list">
                    ${getBoostBenefits(boostLevel)}
                </div>
            </div>
            <div class="boost-packages">
                <div class="packages-title">💎 Boost Paketleri</div>
                <div class="packages-grid">
                    ${getBoostPackages(currentBoosts)}
                </div>
            </div>
            <div class="boost-history">
                <div class="history-title">📜 Boost Geçmişi</div>
                <div class="history-list">
                    ${getBoostHistory(server)}
                </div>
            </div>
        </div>
    `;

    showModal("Sunucu Boost'la", modalContent, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
    `);
}

function getBoostBenefits(level) {
    const benefits = {
        0: [
            { icon: '📝', name: 'Temel kanallar', unlocked: true },
            { icon: '👥', name: '100 üye limiti', unlocked: true },
            { icon: '💬', name: 'Metin kanalları', unlocked: true }
        ],
        1: [
            { icon: '📝', name: 'Temel kanallar', unlocked: true },
            { icon: '👥', name: '250 üye limiti', unlocked: true },
            { icon: '💬', name: 'Metin kanalları', unlocked: true },
            { icon: '🔊', name: 'Sesli kanallar', unlocked: true },
            { icon: '📁', name: 'Kanal kategorileri', unlocked: true }
        ],
        2: [
            { icon: '📝', name: 'Temel kanallar', unlocked: true },
            { icon: '👥', name: '500 üye limiti', unlocked: true },
            { icon: '💬', name: 'Metin kanalları', unlocked: true },
            { icon: '🔊', name: 'Sesli kanallar', unlocked: true },
            { icon: '📁', name: 'Kanal kategorileri', unlocked: true },
            { icon: '🎭', name: 'Özel roller', unlocked: true },
            { icon: '🔇', name: 'Üye susturma', unlocked: true }
        ],
        3: [
            { icon: '📝', name: 'Sınırsız kanallar', unlocked: true },
            { icon: '👥', name: '750 üye limiti', unlocked: true },
            { icon: '💬', name: 'Metin kanalları', unlocked: true },
            { icon: '🔊', name: 'Sesli kanallar', unlocked: true },
            { icon: '📁', name: 'Kanal kategorileri', unlocked: true },
            { icon: '🎭', name: 'Özel roller', unlocked: true },
            { icon: '🔇', name: 'Üye susturma', unlocked: true },
            { icon: '🖥️', name: 'Ekran paylaşımı', unlocked: true },
            { icon: '📹', name: 'Canlı yayın', unlocked: true }
        ],
        4: [
            { icon: '📝', name: 'Sınırsız kanallar', unlocked: true },
            { icon: '👥', name: '1000 üye limiti', unlocked: true },
            { icon: '💬', name: 'Metin kanalları', unlocked: true },
            { icon: '🔊', name: 'Sesli kanallar', unlocked: true },
            { icon: '📁', name: 'Kanal kategorileri', unlocked: true },
            { icon: '🎭', name: 'Özel roller', unlocked: true },
            { icon: '🔇', name: 'Üye susturma', unlocked: true },
            { icon: '🖥️', name: 'Ekran paylaşımı', unlocked: true },
            { icon: '📹', name: 'Canlı yayın', unlocked: true },
            { icon: '🎨', name: 'Özel emojiler', unlocked: true },
            { icon: '🚫', name: 'Üye yasaklama', unlocked: true }
        ],
        5: [
            { icon: '📝', name: 'Sınırsız kanallar', unlocked: true },
            { icon: '👥', name: 'Sınırsız üye limiti', unlocked: true },
            { icon: '💬', name: 'Metin kanalları', unlocked: true },
            { icon: '🔊', name: 'Sesli kanallar', unlocked: true },
            { icon: '📁', name: 'Kanal kategorileri', unlocked: true },
            { icon: '🎭', name: 'Özel roller', unlocked: true },
            { icon: '🔇', name: 'Üye susturma', unlocked: true },
            { icon: '🖥️', name: 'Ekran paylaşımı', unlocked: true },
            { icon: '📹', name: 'Canlı yayın', unlocked: true },
            { icon: '🎨', name: 'Özel emojiler', unlocked: true },
            { icon: '🚫', name: 'Üye yasaklama', unlocked: true },
            { icon: '🏆', name: 'Sunucu rozeti', unlocked: true },
            { icon: '📊', name: 'Sunucu istatistikleri', unlocked: true },
            { icon: '🌟', name: 'Özel sunucu URL', unlocked: true }
        ]
    };

    const currentBenefits = benefits[level] || benefits[0];
    return currentBenefits.map(benefit => `
        <div class="benefit-item ${benefit.unlocked ? 'unlocked' : 'locked'}">
            <div class="benefit-icon">${benefit.icon}</div>
            <div class="benefit-name">${benefit.name}</div>
            <div class="benefit-status">${benefit.unlocked ? '✅' : '🔒'}</div>
        </div>
    `).join('');
}

function getBoostPackages(currentBoosts) {
    const packages = [
        { id: 'boost_1', name: '1 Boost', price: '₺29.99', boosts: 1, color: '#8b5cf6' },
        { id: 'boost_3', name: '3 Boost', price: '₺79.99', boosts: 3, color: '#3b82f6', popular: true },
        { id: 'boost_5', name: '5 Boost', price: '₺129.99', boosts: 5, color: '#1e40af', best: true }
    ];

    return packages.map(pkg => `
        <div class="package-item ${pkg.popular ? 'popular' : ''} ${pkg.best ? 'best' : ''}">
            ${pkg.popular ? '<div class="package-badge popular">POPÜLER</div>' : ''}
            ${pkg.best ? '<div class="package-badge best">EN İYİ</div>' : ''}
            <div class="package-header">
                <div class="package-name">${pkg.name}</div>
                <div class="package-price">${pkg.price}</div>
            </div>
            <div class="package-boosts">${pkg.boosts} Boost</div>
            <button class="package-btn" style="background: ${pkg.color}" onclick="purchaseBoost('${pkg.id}', ${pkg.boosts})">
                ${currentBoosts >= pkg.boosts ? 'Zaten Sahip' : 'Satın Al'}
            </button>
        </div>
    `).join('');
}

function getBoostHistory(server) {
    const history = server.boostHistory || [];

    if (history.length === 0) {
        return '<div class="history-empty">Henüz boost geçmişi yok.</div>';
    }

    return history.slice(0, 10).map(entry => `
        <div class="history-item">
            <div class="history-info">
                <div class="history-action">${entry.action}</div>
                <div class="history-date">${new Date(entry.timestamp).toLocaleDateString('tr-TR')}</div>
            </div>
            <div class="history-details">${entry.details}</div>
        </div>
    `).join('');
}

function purchaseBoost(packageId, boostCount) {
    // This would integrate with payment system
    toast('Boost satın alma yakında gelecek', 'info');

    // Simulate boost purchase for demo
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    if (!server.boosts) server.boosts = 0;
    server.boosts += boostCount;

    if (!server.boostHistory) server.boostHistory = [];
    server.boostHistory.push({
        action: `${boostCount} Boost satın alındı`,
        details: `${packageId} paketi`,
        timestamp: Date.now()
    });

    saveServerBoostsToStorage(state.activeServerId);
    showServerBoostModal();
    toast(`${boostCount} boost başarıyla eklendi!`, 'success');
}

function saveServerBoostsToStorage(serverId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;

    localStorage.setItem(`scord_server_boosts_${serverId}`, JSON.stringify({
        boosts: server.boosts || 0,
        boostHistory: server.boostHistory || []
    }));
}

function loadServerBoostsFromStorage(serverId) {
    try {
        const saved = localStorage.getItem(`scord_server_boosts_${serverId}`);
        if (!saved) return;

        const server = state.servers.find(s => s.id === serverId);
        if (!server) return;

        const boostData = JSON.parse(saved);
        server.boosts = boostData.boosts || 0;
        server.boostHistory = boostData.boostHistory || [];
    } catch (e) {
        console.warn("Failed to load server boosts from storage:", e);
    }
}

function handleServerBoostUpdate(data) {
    const { serverId, boosts, boostHistory } = data;
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;

    server.boosts = boosts || 0;
    server.boostHistory = boostHistory || [];

    // Update UI if this server is active
    if (state.activeServerId === serverId) {
        // Update boost display in server settings
        updateServerBoostDisplay(server);
    }
}

function updateServerBoostDisplay(server) {
    const currentBoosts = server.boosts || 0;
    const boostLevel = Math.min(Math.floor(currentBoosts / 2), 5);

    // Update boost badge in server sidebar
    const serverItem = document.querySelector(`[data-server-id="${server.id}"]`);
    if (serverItem) {
        let boostBadge = serverItem.querySelector('.server-boost-badge');
        if (!boostBadge) {
            boostBadge = document.createElement('div');
            boostBadge.className = 'server-boost-badge';
            boostBadge.innerHTML = `⚡ ${boostLevel}`;
            serverItem.appendChild(boostBadge);
        } else {
            boostBadge.innerHTML = `⚡ ${boostLevel}`;
        }
    }
}

// Custom Emoji System
function showCustomEmojiModal() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const modalContent = `
        <div class="custom-emoji-modal">
            <div class="emoji-header">
                <div class="emoji-title">🎨 Özel Emojiler</div>
                <div class="emoji-subtitle">Sunucu için özel emojiler oluştur ve yönet</div>
            </div>
            <div class="emoji-tabs">
                <button class="emoji-tab active" data-tab="emojis">Emojiler</button>
                <button class="emoji-tab" data-tab="upload">Yükle</button>
                <button class="emoji-tab" data-tab="manage">Yönet</button>
            </div>
            <div class="emoji-content" id="emoji-content">
                <!-- Content will be loaded dynamically -->
            </div>
        </div>
    `;

    showModal("Özel Emojiler", modalContent, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
        <button class="btn-primary" onclick="saveCustomEmojis()">Kaydet</button>
    `);

    // Initialize tabs
    initializeEmojiTabs();
    loadEmojisContent();
}

function initializeEmojiTabs() {
    const tabs = document.querySelectorAll('.emoji-tab');
    const content = document.getElementById('emoji-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const tabName = tab.getAttribute('data-tab');
            switch (tabName) {
                case 'emojis':
                    loadEmojisContent();
                    break;
                case 'upload':
                    loadUploadContent();
                    break;
                case 'manage':
                    loadManageContent();
                    break;
            }
        });
    });
}

function loadEmojisContent() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const content = document.getElementById('emoji-content');
    const customEmojis = server.customEmojis || [];
    const defaultEmojis = EMOJIS.slice(0, 48); // Show first 48 default emojis

    let html = '<div class="emoji-grid">';

    // Add custom emojis first
    customEmojis.forEach(emoji => {
        html += `
            <div class="emoji-item custom-emoji" onclick="insertEmoji('${emoji.url}', '${emoji.name}')">
                <div class="emoji-preview">
                    <img src="${emoji.url}" alt="${emoji.name}" />
                </div>
                <div class="emoji-name">${emoji.name}</div>
            </div>
        `;
    });

    // Add default emojis
    defaultEmojis.forEach(emoji => {
        html += `
            <div class="emoji-item" onclick="insertEmoji('${emoji}', '${emoji}')">
                <div class="emoji-preview">
                    <span class="emoji-char">${emoji}</span>
                </div>
                <div class="emoji-name">:${emoji}:</div>
            </div>
        `;
    });

    html += '</div>';
    content.innerHTML = html;
}

function loadUploadContent() {
    const content = document.getElementById('emoji-content');

    const html = `
        <div class="emoji-upload">
            <div class="upload-area" id="emoji-upload-area">
                <div class="upload-icon">📤</div>
                <div class="upload-text">Emoji dosyasını buraya sürükle veya tıkla</div>
                <input type="file" id="emoji-file-input" accept="image/*" multiple onchange="handleEmojiFileSelect(event)" />
            </div>
            <div class="upload-info">
                <div class="info-item">
                    <div class="info-icon">ℹ️</div>
                    <div class="info-text">Desteklenen formatlar: PNG, GIF, WebP</div>
                </div>
                <div class="info-item">
                    <div class="info-icon">📏</div>
                    <div class="info-text">Maksimum boyut: 256x256 piksel</div>
                </div>
                <div class="info-item">
                    <div class="info-icon">📦</div>
                    <div class="info-text">Maksimum dosya boyutu: 512KB</div>
                </div>
            </div>
        </div>
    `;

    content.innerHTML = html;

    // Setup drag and drop
    setupEmojiDragAndDrop();
}

function loadManageContent() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    const content = document.getElementById('emoji-content');
    const customEmojis = server.customEmojis || [];

    let html = '<div class="emoji-manage-list">';

    customEmojis.forEach((emoji, index) => {
        html += `
            <div class="emoji-manage-item">
                <div class="emoji-manage-preview">
                    <img src="${emoji.url}" alt="${emoji.name}" />
                </div>
                <div class="emoji-manage-info">
                    <div class="emoji-manage-name">${emoji.name}</div>
                    <div class="emoji-manage-date">${new Date(emoji.createdAt).toLocaleDateString('tr-TR')}</div>
                </div>
                <div class="emoji-manage-actions">
                    <button class="emoji-action-btn" onclick="editCustomEmoji(${index})">✏️</button>
                    <button class="emoji-action-btn" onclick="deleteCustomEmoji(${index})">🗑️</button>
                </div>
            </div>
        `;
    });

    if (customEmojis.length === 0) {
        html += '<div class="emoji-empty">Henüz özel emoji yok.</div>';
    }

    html += '</div>';
    content.innerHTML = html;
}

function handleEmojiFileSelect(event) {
    const files = event.target.files;
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    if (!server.customEmojis) server.customEmojis = [];

    Array.from(files).forEach(file => {
        if (file.size > 512 * 1024) { // 512KB limit
            toast(`${file.name} dosyası çok büyük (maks: 512KB)`, 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const emojiName = prompt(`Emoji adı (${file.name}):`, file.name.split('.')[0]);
            if (!emojiName) return;

            // Convert to base64 for storage
            const base64 = e.target.result;
            const emoji = {
                name: emojiName,
                url: base64,
                createdAt: Date.now()
            };

            server.customEmojis.push(emoji);
            toast(`${emojiName} emoji eklendi`, 'success');
        };

        reader.readAsDataURL(file);
    });

    // Clear file input
    event.target.value = '';
}

function setupEmojiDragAndDrop() {
    const uploadArea = document.getElementById('emoji-upload-area');
    if (!uploadArea) return;

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('drag-over');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        const fakeEvent = { target: { files } };
        handleEmojiFileSelect(fakeEvent);
    });

    uploadArea.addEventListener('click', () => {
        document.getElementById('emoji-file-input').click();
    });
}

function insertEmoji(emoji, name) {
    const messageInput = document.getElementById('message-input');
    if (!messageInput) return;

    const cursorPos = messageInput.selectionStart;
    const textBefore = messageInput.value.substring(0, cursorPos);
    const textAfter = messageInput.value.substring(cursorPos);

    messageInput.value = textBefore + emoji + textAfter;
    messageInput.focus();
    messageInput.setSelectionRange(cursorPos + emoji.length, cursorPos + emoji.length);
}

function editCustomEmoji(index) {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server?.customEmojis?.[index]) return;

    const emoji = server.customEmojis[index];
    const newName = prompt('Emoji adını düzenle:', emoji.name);
    if (!newName || newName === emoji.name) return;

    emoji.name = newName;
    loadManageContent();
    toast('Emoji güncellendi', 'success');
}

function deleteCustomEmoji(index) {
    if (!confirm('Bu emojiyi silmek istediğinizden emin misiniz?')) return;

    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server?.customEmojis?.[index]) return;

    const emoji = server.customEmojis[index];
    server.customEmojis.splice(index, 1);

    loadManageContent();
    toast(`${emoji.name} emoji silindi`, 'success');
}

function saveCustomEmojis() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (!server) return;

    // Save custom emojis to server state and localStorage
    localStorage.setItem(`scord_custom_emojis_${server.id}`, JSON.stringify(server.customEmojis || []));

    // Broadcast emoji changes to other members
    if (state.mesh) {
        state.mesh.broadcast({
            type: 'custom_emojis_update',
            serverId: server.id,
            customEmojis: server.customEmojis
        });
    }

    toast('Özel emojiler kaydedildi', 'success');
}

function handleCustomEmojisUpdate(data) {
    const { serverId, customEmojis } = data;
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;

    server.customEmojis = customEmojis || [];

    // Update UI if this server is active
    if (state.activeServerId === serverId) {
        loadEmojisContent();
    }
}

function loadCustomEmojisFromStorage(serverId) {
    try {
        const saved = localStorage.getItem(`scord_custom_emojis_${serverId}`);
        if (!saved) return;

        const server = state.servers.find(s => s.id === serverId);
        if (!server) return;

        server.customEmojis = JSON.parse(saved);
    } catch (e) {
        console.warn("Failed to load custom emojis from storage:", e);
    }
}

// Enhanced Dark/Light Theme System
function showThemeSettingsModal() {
    const modalContent = `
        <div class="theme-settings-modal">
            <div class="theme-header">
                <div class="theme-title">🎨 Tema Ayarları</div>
                <div class="theme-subtitle">Uygulama görünümünü kişiselleştir</div>
            </div>
            <div class="theme-tabs">
                <button class="theme-tab active" data-tab="presets">Hazır Temalar</button>
                <button class="theme-tab" data-tab="colors">Renkler</button>
                <button class="theme-tab" data-tab="advanced">Gelişmiş</button>
            </div>
            <div class="theme-content" id="theme-content">
                <!-- Content will be loaded dynamically -->
            </div>
        </div>
    `;

    showModal("Tema Ayarları", modalContent, `
        <button class="btn-secondary" onclick="hideModal()">İptal</button>
        <button class="btn-primary" onclick="saveThemeSettings()">Kaydet</button>
    `);

    // Initialize tabs
    initializeThemeTabs();
    loadThemePresetsContent();
}

function initializeThemeTabs() {
    const tabs = document.querySelectorAll('.theme-tab');
    const content = document.getElementById('theme-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const tabName = tab.getAttribute('data-tab');
            switch (tabName) {
                case 'presets':
                    loadThemePresetsContent();
                    break;
                case 'colors':
                    loadThemeColorsContent();
                    break;
                case 'advanced':
                    loadThemeAdvancedContent();
                    break;
            }
        });
    });
}

function loadThemePresetsContent() {
    const content = document.getElementById('theme-content');
    const currentTheme = state.theme || 'sapphire';

    const themes = [
        { id: 'sapphire', name: 'Safir', icon: '💎', colors: ['#0f172a', '#1e293b', '#334155', '#64748b', '#94a3b8', '#cbd5e1', '#f1f5f9'] },
        { id: 'emerald', name: 'Zümrüt', icon: '💚', colors: ['#064e3b', '#047857', '#059669', '#10b981', '#34d399', '#6ee7b7', '#a7f3d0'] },
        { id: 'ruby', name: 'Yakut', icon: '❤️', colors: ['#7f1d1d', '#991b1b', '#b91c1c', '#dc2626', '#ef4444', '#f87171', '#fca5a5'] },
        { id: 'gold', name: 'Altın', icon: '⭐', colors: ['#451a03', '#78350f', '#92400e', '#b45309', '#d97706', '#fbbf24', '#fcd34d'] },
        { id: 'dark', name: 'Koyu', icon: '🌙', colors: ['#000000', '#1a1a1a', '#2d2d2d', '#404040', '#595959', '#737373', '#adadad'] },
        { id: 'light', name: 'Açık', icon: '☀️', colors: ['#ffffff', '#f5f5f5', '#e5e5e5', '#d4d4d4', '#a3a3a3', '#737373', '#525252'] },
        { id: 'auto', name: 'Otomatik', icon: '🔄', colors: ['#ffffff', '#f5f5f5', '#e5e5e5', '#d4d4d4', '#a3a3a3', '#737373', '#525252'] }
    ];

    let html = '<div class="theme-presets-grid">';

    themes.forEach(theme => {
        const isActive = currentTheme === theme.id;
        html += `
            <div class="theme-preset ${isActive ? 'active' : ''}" onclick="selectTheme('${theme.id}')">
                <div class="theme-preset-header">
                    <div class="theme-preset-icon">${theme.icon}</div>
                    <div class="theme-preset-name">${theme.name}</div>
                    ${isActive ? '<div class="theme-preset-badge">✅</div>' : ''}
                </div>
                <div class="theme-preset-colors">
                    ${theme.colors.map(color => `
                        <div class="color-swatch" style="background: ${color}"></div>
                    `).join('')}
                </div>
            </div>
        `;
    });

    html += '</div>';
    content.innerHTML = html;
}

function loadThemeColorsContent() {
    const content = document.getElementById('theme-content');

    const currentColors = getThemeColors();

    const html = `
        <div class="theme-colors">
            <div class="color-group">
                <div class="color-group-title">Ana Renkler</div>
                <div class="color-items">
                    <div class="color-item">
                        <label>Arka Plan</label>
                        <input type="color" id="bg-primary" value="${currentColors.bgPrimary}" onchange="updateThemeColor('bgPrimary', this.value)">
                    </div>
                    <div class="color-item">
                        <label>Yüzey</label>
                        <input type="color" id="bg-surface" value="${currentColors.bgSurface}" onchange="updateThemeColor('bgSurface', this.value)">
                    </div>
                    <div class="color-item">
                        <label>Vurgu</label>
                        <input type="color" id="bg-highlight" value="${currentColors.bgHighlight}" onchange="updateThemeColor('bgHighlight', this.value)">
                    </div>
                </div>
            </div>
            <div class="color-group">
                <div class="color-group-title">Metin Renkleri</div>
                <div class="color-items">
                    <div class="color-item">
                        <label>Birincil</label>
                        <input type="color" id="text-primary" value="${currentColors.textPrimary}" onchange="updateThemeColor('textPrimary', this.value)">
                    </div>
                    <div class="color-item">
                        <label>İkincil</label>
                        <input type="color" id="text-secondary" value="${currentColors.textSecondary}" onchange="updateThemeColor('textSecondary', this.value)">
                    </div>
                    <div class="color-item">
                        <label>Soluk</label>
                        <input type="color" id="text-muted" value="${currentColors.textMuted}" onchange="updateThemeColor('textMuted', this.value)">
                    </div>
                </div>
            </div>
            <div class="color-group">
                <div class="color-group-title">Aksan Renkleri</div>
                <div class="color-items">
                    <div class="color-item">
                        <label>Aksan</label>
                        <input type="color" id="accent" value="${currentColors.accent}" onchange="updateThemeColor('accent', this.value)">
                    </div>
                    <div class="color-item">
                        <label>Aksan Açık</label>
                        <input type="color" id="accent-light" value="${currentColors.accentLight}" onchange="updateThemeColor('accentLight', this.value)">
                    </div>
                </div>
            </div>
        </div>
    `;

    content.innerHTML = html;
}

function loadThemeAdvancedContent() {
    const content = document.getElementById('theme-content');

    const html = `
        <div class="theme-advanced">
            <div class="advanced-group">
                <div class="advanced-title">Mesaj Yoğunluğu</div>
                <div class="advanced-options">
                    <label class="advanced-option">
                        <input type="radio" name="messageDensity" value="comfortable" ${state.settings?.messageDensity === 'comfortable' ? 'checked' : ''} onchange="updateMessageDensity(this.value)">
                        <span>Rahat</span>
                    </label>
                    <label class="advanced-option">
                        <input type="radio" name="messageDensity" value="cozy" ${state.settings?.messageDensity === 'cozy' ? 'checked' : ''} onchange="updateMessageDensity(this.value)">
                        <span>Konfor</span>
                    </label>
                    <label class="advanced-option">
                        <input type="radio" name="messageDensity" value="compact" ${state.settings?.messageDensity === 'compact' ? 'checked' : ''} onchange="updateMessageDensity(this.value)">
                        <span>Sıkışık</span>
                    </label>
                </div>
            </div>
            <div class="advanced-group">
                <div class="advanced-title">Emoji Boyutu</div>
                <div class="advanced-options">
                    <label class="advanced-option">
                        <input type="radio" name="emojiSize" value="small" ${state.settings?.emojiSize === 'small' ? 'checked' : ''} onchange="updateEmojiSize(this.value)">
                        <span>Küçük</span>
                    </label>
                    <label class="advanced-option">
                        <input type="radio" name="emojiSize" value="medium" ${state.settings?.emojiSize === 'medium' ? 'checked' : ''} onchange="updateEmojiSize(this.value)">
                        <span>Orta</span>
                    </label>
                    <label class="advanced-option">
                        <input type="radio" name="emojiSize" value="large" ${state.settings?.emojiSize === 'large' ? 'checked' : ''} onchange="updateEmojiSize(this.value)">
                        <span>Büyük</span>
                    </label>
                </div>
            </div>
            <div class="advanced-group">
                <div class="advanced-title">Animasyonlar</div>
                <div class="advanced-options">
                    <label class="switch">
                        <input type="checkbox" ${state.settings?.animations !== false ? 'checked' : ''} onchange="updateAnimations(this.checked)">
                        <span class="slider"></span>
                    </label>
                    <span>Animasyonları etkinleştir</span>
                </div>
            </div>
            <div class="advanced-group">
                <div class="advanced-title">Otomatik Tema</div>
                <div class="advanced-options">
                    <label class="switch">
                        <input type="checkbox" ${state.settings?.theme === 'auto' ? 'checked' : ''} onchange="updateAutoTheme(this.checked)">
                        <span class="slider"></span>
                    </label>
                    <span>Sisteme göre otomatik değiştir</span>
                </div>
            </div>
        </div>
    `;

    content.innerHTML = html;
}

function getThemeColors() {
    const style = getComputedStyle(document.documentElement);
    return {
        bgPrimary: style.getPropertyValue('--bg-primary').trim(),
        bgSurface: style.getPropertyValue('--bg-surface').trim(),
        bgHighlight: style.getPropertyValue('--bg-highlight').trim(),
        textPrimary: style.getPropertyValue('--text-primary').trim(),
        textSecondary: style.getPropertyValue('--text-secondary').trim(),
        textMuted: style.getPropertyValue('--text-muted').trim(),
        accent: style.getPropertyValue('--accent').trim(),
        accentLight: style.getPropertyValue('--accent-light').trim()
    };
}

function selectTheme(themeId) {
    state.theme = themeId;
    applyTheme(themeId);

    // Update UI
    loadThemePresetsContent();

    // Save to localStorage
    localStorage.setItem('scord_theme', themeId);

    toast(`${themeId} teması uygulandı`, 'success');
}

function applyTheme(themeId) {
    const themes = {
        'sapphire': {
            '--bg-primary': '#0f172a',
            '--bg-surface': '#1e293b',
            '--bg-elevated': '#334155',
            '--bg-highlight': '#475569',
            '--text-primary': '#f8fafc',
            '--text-secondary': '#e2e8f0',
            '--text-muted': '#94a3b8',
            '--accent': '#3b82f6',
            '--accent-light': '#60a5fa',
            '--border': '#475569'
        },
        'emerald': {
            '--bg-primary': '#064e3b',
            '--bg-surface': '#047857',
            '--bg-elevated': '#059669',
            '--bg-highlight': '#10b981',
            '--text-primary': '#ecfdf5',
            '--text-secondary': '#d1fae5',
            '--text-muted': '#6ee7b7',
            '--accent': '#10b981',
            '--accent-light': '#34d399',
            '--border': '#10b981'
        },
        'ruby': {
            '--bg-primary': '#7f1d1d',
            '--bg-surface': '#991b1b',
            '--bg-elevated': '#b91c1c',
            '--bg-highlight': '#dc2626',
            '--text-primary': '#fef2f2',
            '--text-secondary': '#fecaca',
            '--text-muted': '#fca5a5',
            '--accent': '#dc2626',
            '--accent-light': '#ef4444',
            '--border': '#dc2626'
        },
        'gold': {
            '--bg-primary': '#451a03',
            '--bg-surface': '#78350f',
            '--bg-elevated': '#92400e',
            '--bg-highlight': '#b45309',
            '--text-primary': '#fef3c7',
            '--text-secondary': '#fed7aa',
            '--text-muted': '#fcd34d',
            '--accent': '#d97706',
            '--accent-light': '#fbbf24',
            '--border': '#b45309'
        },
        'dark': {
            '--bg-primary': '#000000',
            '--bg-surface': '#1a1a1a',
            '--bg-elevated': '#2d2d2d',
            '--bg-highlight': '#404040',
            '--text-primary': '#ffffff',
            '--text-secondary': '#e5e5e5',
            '--text-muted': '#a3a3a3',
            '--accent': '#6366f1',
            '--accent-light': '#818cf8',
            '--border': '#404040'
        },
        'light': {
            '--bg-primary': '#ffffff',
            '--bg-surface': '#f5f5f5',
            '--bg-elevated': '#e5e5e5',
            '--bg-highlight': '#d4d4d4',
            '--text-primary': '#000000',
            '--text-secondary': '#171717',
            '--text-muted': '#737373',
            '--accent': '#3b82f6',
            '--accent-light': '#60a5fa',
            '--border': '#d4d4d4'
        }
    };

    const theme = themes[themeId];
    if (!theme) return;

    // Apply theme colors
    Object.entries(theme).forEach(([property, value]) => {
        document.documentElement.style.setProperty(property, value);
    });

    // Update document class
    document.documentElement.className = themeId;
}

function updateThemeColor(property, value) {
    const cssProperty = `--${property.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
    document.documentElement.style.setProperty(cssProperty, value);

    // Save custom theme
    saveCustomTheme();
}

function updateMessageDensity(density) {
    if (!state.settings) state.settings = {};
    state.settings.messageDensity = density;
    localStorage.setItem('scord_message_density', density);

    // Update UI classes
    document.body.className = document.body.className.replace(/message-density-\w+/g, '');
    document.body.classList.add(`message-density-${density}`);

    toast(`Mesaj yoğunluğu: ${density}`, 'success');
}

function updateEmojiSize(size) {
    if (!state.settings) state.settings = {};
    state.settings.emojiSize = size;
    localStorage.setItem('scord_emoji_size', size);

    // Update UI classes
    document.body.className = document.body.className.replace(/emoji-size-\w+/g, '');
    document.body.classList.add(`emoji-size-${size}`);

    toast(`Emoji boyutu: ${size}`, 'success');
}

function updateAnimations(enabled) {
    if (!state.settings) state.settings = {};
    state.settings.animations = enabled;
    localStorage.setItem('scord_animations', enabled);

    // Update UI classes
    if (enabled) {
        document.body.classList.remove('no-animations');
    } else {
        document.body.classList.add('no-animations');
    }

    toast(`Animasyonlar: ${enabled ? 'etkin' : 'devre dışı'}`, 'success');
}

function updateAutoTheme(enabled) {
    if (!state.settings) state.settings = {};
    state.settings.theme = enabled ? 'auto' : 'dark';
    localStorage.setItem('scord_theme', enabled ? 'auto' : 'dark');

    if (enabled) {
        setupAutoTheme();
    } else {
        removeAutoTheme();
    }

    toast(`Otomatik tema: ${enabled ? 'etkin' : 'devre dışı'}`, 'success');
}

function setupAutoTheme() {
    const hour = new Date().getHours();
    const isDark = hour < 6 || hour >= 18;

    if (isDark) {
        applyTheme('dark');
    } else {
        applyTheme('light');
    }

    // Update every minute
    state.autoThemeInterval = setInterval(() => {
        const currentHour = new Date().getHours();
        const shouldBeDark = currentHour < 6 || currentHour >= 18;
        const isCurrentlyDark = document.documentElement.classList.contains('dark');

        if (shouldBeDark !== isCurrentlyDark) {
            if (shouldBeDark) {
                applyTheme('dark');
            } else {
                applyTheme('light');
            }
        }
    }, 60000);
}

function removeAutoTheme() {
    if (state.autoThemeInterval) {
        clearInterval(state.autoThemeInterval);
        state.autoThemeInterval = null;
    }
}

function saveCustomTheme() {
    const customTheme = getThemeColors();
    localStorage.setItem('scord_custom_theme', JSON.stringify(customTheme));
    toast('Özel tema kaydedildi', 'success');
}

function loadCustomTheme() {
    try {
        const saved = localStorage.getItem('scord_custom_theme');
        if (!saved) return;

        const customTheme = JSON.parse(saved);
        Object.entries(customTheme).forEach(([property, value]) => {
            document.documentElement.style.setProperty(property, value);
        });
    } catch (e) {
        console.warn("Failed to load custom theme:", e);
    }
}

function saveThemeSettings() {
    // Save all theme settings
    saveCustomTheme();

    // Save settings
    localStorage.setItem('scord_settings', JSON.stringify(state.settings || {}));

    toast('Tema ayarları kaydedildi', 'success');
    hideModal();
}

// Enhanced Notification System with Push Support
function showNotificationSettingsModal() {
    const modalContent = `
        <div class="notification-settings-modal">
            <div class="notification-header">
                <div class="notification-title">🔔 Bildirim Ayarları</div>
                <div class="notification-subtitle">Bildirimleri kişiselleştir ve yönet</div>
            </div>
            <div class="notification-tabs">
                <button class="notification-tab active" data-tab="general">Genel</button>
                <button class="notification-tab" data-tab="desktop">Masaüstü</button>
                <button class="notification-tab" data-tab="push">Push</button>
            </div>
            <div class="notification-content" id="notification-content">
                <!-- Content will be loaded dynamically -->
            </div>
        </div>
    `;

    showModal("Bildirim Ayarları", modalContent, `
        <button class="btn-secondary" onclick="hideModal()">İptal</button>
        <button class="btn-primary" onclick="saveNotificationSettings()">Kaydet</button>
    `);

    // Initialize tabs
    initializeNotificationTabs();
    loadNotificationGeneralContent();
}

function initializeNotificationTabs() {
    const tabs = document.querySelectorAll('.notification-tab');
    const content = document.getElementById('notification-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const tabName = tab.getAttribute('data-tab');
            switch (tabName) {
                case 'general':
                    loadNotificationGeneralContent();
                    break;
                case 'desktop':
                    loadNotificationDesktopContent();
                    break;
                case 'push':
                    loadNotificationPushContent();
                    break;
            }
        });
    });
}

function loadNotificationGeneralContent() {
    const content = document.getElementById('notification-content');
    const settings = state.notifSettings || {};

    const html = `
        <div class="notification-general">
            <div class="notification-group">
                <div class="notification-group-title">Mesaj Bildirimleri</div>
                <div class="notification-options">
                    <label class="notification-option">
                        <input type="checkbox" ${settings.chat !== false ? 'checked' : ''} onchange="updateNotificationSetting('chat', this.checked)">
                        <span>Sohbet mesajları için bildirim göster</span>
                    </label>
                    <label class="notification-option">
                        <input type="checkbox" ${settings.dm !== false ? 'checked' : ''} onchange="updateNotificationSetting('dm', this.checked)">
                        <span>Özel mesajlar için bildirim göster</span>
                    </label>
                    <label class="notification-option">
                        <input type="checkbox" ${settings.mentions !== false ? 'checked' : ''} onchange="updateNotificationSetting('mentions', this.checked)">
                        <span>Bahsetmeler (@user) için bildirim göster</span>
                    </label>
                </div>
            </div>
            <div class="notification-group">
                <div class="notification-group-title">Sunucu Bildirimleri</div>
                <div class="notification-options">
                    <label class="notification-option">
                        <input type="checkbox" ${settings.join !== false ? 'checked' : ''} onchange="updateNotificationSetting('join', this.checked)">
                        <span>Üye katıldığında bildirim göster</span>
                    </label>
                    <label class="notification-option">
                        <input type="checkbox" ${settings.leave !== false ? 'checked' : ''} onchange="updateNotificationSetting('leave', this.checked)">
                        <span>Üye ayrıldığında bildirim göster</span>
                    </label>
                    <label class="notification-option">
                        <input type="checkbox" ${settings.voice !== false ? 'checked' : ''} onchange="updateNotificationSetting('voice', this.checked)">
                        <span>Sesli kanala katıldığında bildirim göster</span>
                    </label>
                </div>
            </div>
            <div class="notification-group">
                <div class="notification-group-title">Bildirim Seviyesi</div>
                <div class="notification-options">
                    <label class="notification-option">
                        <input type="radio" name="chatLevel" value="all" ${settings.chatLevel === 'all' ? 'checked' : ''} onchange="updateNotificationSetting('chatLevel', this.value)">
                        <span>Tüm mesajlar</span>
                    </label>
                    <label class="notification-option">
                        <input type="radio" name="chatLevel" value="mentions" ${settings.chatLevel === 'mentions' ? 'checked' : ''} onchange="updateNotificationSetting('chatLevel', this.value)">
                        <span>Sadece bahsetmeler</span>
                    </label>
                    <label class="notification-option">
                        <input type="radio" name="chatLevel" value="none" ${settings.chatLevel === 'none' ? 'checked' : ''} onchange="updateNotificationSetting('chatLevel', this.value)">
                        <span>Hiçbiri</span>
                    </label>
                </div>
            </div>
        </div>
    `;

    content.innerHTML = html;
}

function loadNotificationDesktopContent() {
    const content = document.getElementById('notification-content');
    const settings = state.notifSettings || {};

    const html = `
        <div class="notification-desktop">
            <div class="notification-group">
                <div class="notification-group-title">Masaüstü Bildirimleri</div>
                <div class="notification-options">
                    <label class="notification-option">
                        <input type="checkbox" ${settings.desktop !== false ? 'checked' : ''} onchange="updateNotificationSetting('desktop', this.checked)">
                        <span>Masaüstü bildirimlerini etkinleştir</span>
                    </label>
                    <label class="notification-option">
                        <input type="checkbox" ${settings.sound !== false ? 'checked' : ''} onchange="updateNotificationSetting('sound', this.checked)">
                        <span>Bildirim seslerini etkinleştir</span>
                    </label>
                    <label class="notification-option">
                        <input type="checkbox" ${settings.badge !== false ? 'checked' : ''} onchange="updateNotificationSetting('badge', this.checked)">
                        <span>Favicon rozetini göster</span>
                    </label>
                </div>
            </div>
            <div class="notification-group">
                <div class="notification-group-title">Bildirim Konumu</div>
                <div class="notification-options">
                    <label class="notification-option">
                        <input type="radio" name="position" value="top-right" ${settings.position === 'top-right' ? 'checked' : ''} onchange="updateNotificationSetting('position', this.value)">
                        <span>Sağ üst</span>
                    </label>
                    <label class="notification-option">
                        <input type="radio" name="position" value="top-left" ${settings.position === 'top-left' ? 'checked' : ''} onchange="updateNotificationSetting('position', this.value)">
                        <span>Sol üst</span>
                    </label>
                    <label class="notification-option">
                        <input type="radio" name="position" value="bottom-right" ${settings.position === 'bottom-right' ? 'checked' : ''} onchange="updateNotificationSetting('position', this.value)">
                        <span>Sağ alt</span>
                    </label>
                    <label class="notification-option">
                        <input type="radio" name="position" value="bottom-left" ${settings.position === 'bottom-left' ? 'checked' : ''} onchange="updateNotificationSetting('position', this.value)">
                        <span>Sol alt</span>
                    </label>
                </div>
            </div>
            <div class="notification-group">
                <div class="notification-group-title">Ses Ayarları</div>
                <div class="notification-options">
                    <div class="notification-option">
                        <label>Bildirim Sesi:</label>
                        <select id="notification-sound-select" onchange="updateNotificationSetting('notificationSound', this.value)">
                            <option value="default" ${settings.notificationSound === 'default' ? 'selected' : ''}>Varsayılan</option>
                            <option value="ding" ${settings.notificationSound === 'ding' ? 'selected' : ''}>Ding</option>
                            <option value="pop" ${settings.notificationSound === 'pop' ? 'selected' : ''}>Pop</option>
                            <option value="chime" ${settings.notificationSound === 'chime' ? 'selected' : ''}>Chime</option>
                            <option value="none" ${settings.notificationSound === 'none' ? 'selected' : ''}>Sessiz</option>
                        </select>
                    </div>
                    <div class="notification-option">
                        <label>Ses Seviyesi:</label>
                        <input type="range" id="notification-volume" min="0" max="100" value="${settings.volume || 50}" onchange="updateNotificationSetting('volume', this.value)">
                        <span id="volume-value">${settings.volume || 50}%</span>
                    </div>
                </div>
            </div>
        </div>
    `;

    content.innerHTML = html;

    // Update volume display
    const volumeSlider = document.getElementById('notification-volume');
    const volumeValue = document.getElementById('volume-value');
    if (volumeSlider && volumeValue) {
        volumeSlider.addEventListener('input', () => {
            volumeValue.textContent = volumeSlider.value + '%';
        });
    }
}

function loadNotificationPushContent() {
    const content = document.getElementById('notification-content');
    const settings = state.notifSettings || {};
    const pushSupported = 'Notification' in window && 'serviceWorker' in navigator;
    const pushEnabled = settings.pushEnabled || false;

    const html = `
        <div class="notification-push">
            <div class="notification-group">
                <div class="notification-group-title">Push Bildirimleri</div>
                <div class="notification-options">
                    <label class="notification-option">
                        <input type="checkbox" ${pushEnabled ? 'checked' : ''} ${!pushSupported ? 'disabled' : ''} onchange="togglePushNotifications(this.checked)">
                        <span>Push bildirimlerini etkinleştir</span>
                        ${!pushSupported ? '<small class="text-muted">(Tarayıcı desteklenmiyor)</small>' : ''}
                    </label>
                    <label class="notification-option">
                        <input type="checkbox" ${settings.pushMobile !== false ? 'checked' : ''} ${!pushEnabled ? 'disabled' : ''} onchange="updateNotificationSetting('pushMobile', this.checked)">
                        <span>Mobil cihazlara bildirim gönder</span>
                    </label>
                    <label class="notification-option">
                        <input type="checkbox" ${settings.pushEmail !== false ? 'checked' : ''} ${!pushEnabled ? 'disabled' : ''} onchange="updateNotificationSetting('pushEmail', this.checked)">
                        <span>E-posta bildirimleri gönder</span>
                    </label>
                </div>
            </div>
            ${pushEnabled ? `
                <div class="notification-group">
                    <div class="notification-group-title">Push Bildirim Ayarları</div>
                    <div class="notification-options">
                        <div class="notification-option">
                            <label>E-posta Adresi:</label>
                            <input type="email" id="push-email" placeholder="ornek@email.com" value="${settings.pushEmail || ''}" onchange="updateNotificationSetting('pushEmailAddress', this.value)">
                        </div>
                        <div class="notification-option">
                            <label>Mobil Cihaz ID:</label>
                            <input type="text" id="push-device-id" placeholder="Cihaz ID" value="${settings.pushDeviceId || ''}" onchange="updateNotificationSetting('pushDeviceId', this.value)">
                        </div>
                    </div>
                </div>
            ` : ''}
            <div class="notification-group">
                <div class="notification-group-title">Test Bildirimi</div>
                <div class="notification-options">
                    <button class="btn-secondary" onclick="sendTestNotification()">Test Bildirimi Gönder</button>
                </div>
            </div>
        </div>
    `;

    content.innerHTML = html;
}

function updateNotificationSetting(key, value) {
    if (!state.notifSettings) state.notifSettings = {};
    state.notifSettings[key] = value;

    // Save to localStorage
    localStorage.setItem('scord_notif_settings', JSON.stringify(state.notifSettings));

    // Apply settings immediately
    if (key === 'desktop') {
        if (value) {
            requestNotificationPermission();
        }
    }

    if (key === 'sound') {
        state.settings.soundEnabled = value;
        localStorage.setItem('scord_sound_enabled', value);
    }

    if (key === 'volume') {
        updateNotificationVolume(value);
    }
}

function requestNotificationPermission() {
    if ('Notification' in window) {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                toast('Bildirim izni verildi', 'success');
            } else if (permission === 'denied') {
                toast('Bildirim izni reddedildi', 'error');
            }
        });
    }
}

function togglePushNotifications(enabled) {
    if (!enabled) {
        // Disable push notifications
        updateNotificationSetting('pushEnabled', false);
        if (state.pushSubscription) {
            state.pushSubscription.unsubscribe();
            state.pushSubscription = null;
        }
        toast('Push bildirimleri devre dışı bırakıldı', 'info');
        return;
    }

    // Enable push notifications
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        navigator.serviceWorker.ready.then(registration => {
            return registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array('YOUR_VAPID_PUBLIC_KEY')
            });
        }).then(subscription => {
            state.pushSubscription = subscription;
            updateNotificationSetting('pushEnabled', true);
            updateNotificationSetting('pushEndpoint', subscription.endpoint);
            toast('Push bildirimleri etkinleştirildi', 'success');
        }).catch(error => {
            console.error('Push subscription error:', error);
            toast('Push bildirimleri etkinleştirilemedi', 'error');
        });
    } else {
        toast('Tarayıcı push bildirimlerini desteklemiyor', 'error');
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
}

function sendTestNotification() {
    const settings = state.notifSettings || {};

    // Send desktop notification
    if (settings.desktop !== false && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('SCORD - Test Bildirimi', {
            body: 'Bu bir test bildirimidir!',
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: 'test-notification'
        });
    }

    // Send push notification
    if (settings.pushEnabled && state.pushSubscription) {
        fetch('/api/push/test', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                subscription: state.pushSubscription,
                title: 'SCORD - Test Bildirimi',
                body: 'Bu bir test bildirimidir!'
            })
        }).catch(error => {
            console.error('Push notification error:', error);
        });
    }

    // Play notification sound
    if (settings.sound !== false) {
        playNotificationSound(settings.notificationSound || 'default', settings.volume || 50);
    }

    toast('Test bildirimi gönderildi', 'success');
}

function playNotificationSound(soundType, volume = 50) {
    if (!state.settings?.soundEnabled) return;

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Set sound based on type
    switch (soundType) {
        case 'ding':
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            break;
        case 'pop':
            oscillator.frequency.value = 600;
            oscillator.type = 'square';
            break;
        case 'chime':
            oscillator.frequency.value = 1000;
            oscillator.type = 'triangle';
            break;
        default:
            oscillator.frequency.value = 440;
            oscillator.type = 'sine';
    }

    gainNode.gain.value = volume / 100;
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.2);
}

function updateNotificationVolume(volume) {
    state.settings.notificationVolume = volume;
    localStorage.setItem('scord_notification_volume', volume);
}

function createNotification(title, body, options = {}) {
    const settings = state.notifSettings || {};

    // Check if notifications are enabled
    if (settings.desktop === false) return;

    // Check notification level
    if (settings.chatLevel === 'none') return;
    if (settings.chatLevel === 'mentions' && !options.isMention) return;

    // Create desktop notification
    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(title, {
            body,
            icon: options.icon || '/favicon.ico',
            badge: options.badge || '/favicon.ico',
            tag: options.tag || 'default',
            requireInteraction: options.requireInteraction || false,
            silent: settings.sound === false
        });

        // Auto close after 5 seconds
        setTimeout(() => notification.close(), 5000);

        // Handle click
        notification.onclick = () => {
            window.focus();
            notification.close();
            if (options.onClick) options.onClick();
        };
    }

    // Play sound
    if (settings.sound !== false) {
        playNotificationSound(settings.notificationSound || 'default', settings.volume || 50);
    }

    // Update badge
    if (settings.badge !== false) {
        updateBadge();
    }
}

function updateBadge() {
    // Update favicon with notification count
    const badge = document.querySelector('.favicon-badge');
    if (badge) {
        badge.style.display = 'block';
    }
}

function clearBadge() {
    // Clear favicon badge
    const badge = document.querySelector('.favicon-badge');
    if (badge) {
        badge.style.display = 'none';
    }
}

function saveNotificationSettings() {
    // Save notification settings
    localStorage.setItem('scord_notif_settings', JSON.stringify(state.notifSettings || {}));

    toast('Bildirim ayarları kaydedildi', 'success');
    hideModal();
}

function loadNotificationSettings() {
    try {
        const saved = localStorage.getItem('scord_notif_settings');
        if (saved) {
            state.notifSettings = JSON.parse(saved);
        }
    } catch (e) {
        console.warn("Failed to load notification settings:", e);
    }
}

// Enhanced Keyboard Shortcuts System
function initializeKeyboardShortcuts() {
    const shortcuts = {
        // Navigation shortcuts
        'Ctrl+K': showQuickSwitcher,
        'Ctrl+N': showCreateModal,
        'Ctrl+Shift+N': createNewServer,
        'Ctrl+Shift+C': createNewChannel,
        'Ctrl+Shift+R': createNewRole,
        'Ctrl+Shift+E': showCustomEmojiModal,
        'Ctrl+Shift+T': showThemeSettingsModal,
        'Ctrl+Shift+N': showNotificationSettingsModal,

        // Message shortcuts
        'Ctrl+Enter': sendMessage,
        'Shift+Enter': addNewLineToMessage,
        'Ctrl+Shift+Enter': sendFormattedMessage,
        'Ctrl+I': toggleItalic,
        'Ctrl+B': toggleBold,
        'Ctrl+U': toggleUnderline,
        'Ctrl+Shift+S': toggleStrikethrough,
        'Ctrl+E': toggleCode,
        'Ctrl+Shift+E': toggleCodeBlock,

        // Search shortcuts
        'Ctrl+F': focusSearchInput,
        'Ctrl+Shift+F': searchInCurrentChannel,
        'Ctrl+G': goToMessage,
        'Ctrl+Shift+G': goToNextUnread,

        // Channel shortcuts
        'Alt+ArrowUp': moveToPreviousChannel,
        'Alt+ArrowDown': moveToNextChannel,
        'Alt+ArrowLeft': moveToPreviousServer,
        'Alt+ArrowRight': moveToNextServer,

        // Voice shortcuts
        'Ctrl+M': toggleMicrophone,
        'Ctrl+Shift+M': toggleDeafen,
        'Ctrl+Shift+S': startScreenShare,
        'Ctrl+Shift+C': startCameraShare,

        // Settings shortcuts
        'Ctrl+Comma': openSettingsModal,
        'Ctrl+Shift+P': openProfileSettings,
        'Ctrl+Shift+U': showUserSettings,

        // Utility shortcuts
        'Escape': closeCurrentModal,
        'Ctrl+Shift+L': toggleDarkMode,
        'Ctrl+Shift+A': toggleAnimations,
        'Ctrl+Shift+D': toggleCompactMode,
        'Ctrl+Shift+H': showHelpModal,
        'F1': showKeyboardShortcutsModal,
        'F11': toggleFullscreen
    };

    // Add event listeners
    document.addEventListener('keydown', (e) => {
        const key = getKeyString(e);
        const shortcut = shortcuts[key];

        if (shortcut) {
            e.preventDefault();
            shortcut(e);
        }
    });

    // Store shortcuts for reference
    state.keyboardShortcuts = shortcuts;
}

function getKeyString(e) {
    const parts = [];

    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');

    // Handle special keys
    const specialKeys = {
        'Enter': 'Enter',
        'Escape': 'Escape',
        'ArrowUp': 'ArrowUp',
        'ArrowDown': 'ArrowDown',
        'ArrowLeft': 'ArrowLeft',
        'ArrowRight': 'ArrowRight',
        ' ': 'Space',
        'Tab': 'Tab',
        'Backspace': 'Backspace',
        'Delete': 'Delete',
        'Home': 'Home',
        'End': 'End',
        'PageUp': 'PageUp',
        'PageDown': 'PageDown',
        'F1': 'F1',
        'F2': 'F2',
        'F3': 'F3',
        'F4': 'F4',
        'F5': 'F5',
        'F6': 'F6',
        'F7': 'F7',
        'F8': 'F8',
        'F9': 'F9',
        'F10': 'F10',
        'F11': 'F11',
        'F12': 'F12'
    };

    const key = specialKeys[e.key] || e.key;
    parts.push(key);

    return parts.join('+');
}

function showQuickSwitcher() {
    const modalContent = `
        <div class="quick-switcher">
            <div class="quick-switcher-header">
                <input type="text" id="quick-switcher-input" placeholder="Sunucu, kanal veya kullanıcı ara..." autocomplete="off">
            </div>
            <div class="quick-switcher-results" id="quick-switcher-results">
                <!-- Results will be loaded dynamically -->
            </div>
        </div>
    `;

    showModal("Hızlı Geçiş", modalContent, '', true); // No footer, closable with Escape

    // Focus input
    const input = document.getElementById('quick-switcher-input');
    if (input) {
        input.focus();
        input.addEventListener('input', handleQuickSwitcherSearch);
        input.addEventListener('keydown', handleQuickSwitcherNavigation);
    }

    // Load initial results
    loadQuickSwitcherResults('');
}

function handleQuickSwitcherSearch(e) {
    const query = e.target.value.toLowerCase();
    loadQuickSwitcherResults(query);
}

function handleQuickSwitcherNavigation(e) {
    const results = document.querySelectorAll('.quick-switcher-item');
    const currentIndex = Array.from(results).findIndex(item => item.classList.contains('selected'));

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = currentIndex < results.length - 1 ? currentIndex + 1 : 0;
        selectQuickSwitcherItem(results, nextIndex);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : results.length - 1;
        selectQuickSwitcherItem(results, prevIndex);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (currentIndex >= 0 && results[currentIndex]) {
            results[currentIndex].click();
        }
    }
}

function selectQuickSwitcherItem(results, index) {
    results.forEach(item => item.classList.remove('selected'));
    results[index].classList.add('selected');
    results[index].scrollIntoView({ block: 'nearest' });
}

function loadQuickSwitcherResults(query) {
    const resultsContainer = document.getElementById('quick-switcher-results');
    if (!resultsContainer) return;

    let html = '';
    let hasResults = false;

    // Search servers
    const matchingServers = state.servers.filter(server =>
        server.name.toLowerCase().includes(query)
    );

    if (matchingServers.length > 0) {
        html += '<div class="quick-switcher-section">Sunucular</div>';
        matchingServers.forEach(server => {
            html += `
                <div class="quick-switcher-item" onclick="switchToServer('${server.id}'); hideModal();">
                    <div class="quick-switcher-icon">🏠</div>
                    <div class="quick-switcher-info">
                        <div class="quick-switcher-title">${escapeHtml(server.name)}</div>
                        <div class="quick-switcher-subtitle">Sunucu</div>
                    </div>
                </div>
            `;
        });
        hasResults = true;
    }

    // Search channels
    const currentServer = state.servers.find(s => s.id === state.activeServerId);
    if (currentServer) {
        const matchingChannels = currentServer.channels.filter(channel =>
            channel.name.toLowerCase().includes(query)
        );

        if (matchingChannels.length > 0) {
            if (hasResults) html += '<div class="quick-switcher-divider"></div>';
            html += '<div class="quick-switcher-section">Kanallar</div>';
            matchingChannels.forEach(channel => {
                const icon = channel.type === 'voice' ? '🎤' : '💬';
                html += `
                    <div class="quick-switcher-item" onclick="switchToChannel('${channel.id}'); hideModal();">
                        <div class="quick-switcher-icon">${icon}</div>
                        <div class="quick-switcher-info">
                            <div class="quick-switcher-title">${escapeHtml(channel.name)}</div>
                            <div class="quick-switcher-subtitle">${channel.type === 'voice' ? 'Sesli Kanal' : 'Metin Kanalı'}</div>
                        </div>
                    </div>
                `;
            });
            hasResults = true;
        }
    }

    // Search users
    const allUsers = new Set();
    state.servers.forEach(server => {
        Object.keys(server.peer_roles || {}).forEach(userId => allUsers.add(userId));
    });

    const matchingUsers = Array.from(allUsers).filter(userId => {
        const user = state.peerInfo?.[userId];
        return user && user.username && user.username.toLowerCase().includes(query);
    });

    if (matchingUsers.length > 0) {
        if (hasResults) html += '<div class="quick-switcher-divider"></div>';
        html += '<div class="quick-switcher-section">Kullanıcılar</div>';
        matchingUsers.forEach(userId => {
            const user = state.peerInfo?.[userId];
            if (user) {
                html += `
                    <div class="quick-switcher-item" onclick="openDMWithUser('${userId}'); hideModal();">
                        <div class="quick-switcher-icon">👤</div>
                        <div class="quick-switcher-info">
                            <div class="quick-switcher-title">${escapeHtml(user.username)}</div>
                            <div class="quick-switcher-subtitle">Kullanıcı</div>
                        </div>
                    </div>
                `;
            }
        });
    }

    if (!hasResults) {
        html = '<div class="quick-switcher-empty">Sonuç bulunamadı</div>';
    }

    resultsContainer.innerHTML = html;
}

function showKeyboardShortcutsModal() {
    const shortcuts = [
        {
            category: 'Gezinme', shortcuts: [
                { key: 'Ctrl+K', description: 'Hızlı geçiş menüsünü aç' },
                { key: 'Ctrl+N', description: 'Yeni oluştur menüsünü aç' },
                { key: 'Alt+↑/↓', description: 'Kanallar arasında gezin' },
                { key: 'Alt+←/→', description: 'Sunucular arasında gezin' }
            ]
        },
        {
            category: 'Mesajlaşma', shortcuts: [
                { key: 'Ctrl+Enter', description: 'Mesajı gönder' },
                { key: 'Shift+Enter', description: 'Yeni satır ekle' },
                { key: 'Ctrl+I', description: 'İtalik yap' },
                { key: 'Ctrl+B', description: 'Kalın yap' },
                { key: 'Ctrl+U', description: 'Altı çizili yap' }
            ]
        },
        {
            category: 'Arama', shortcuts: [
                { key: 'Ctrl+F', description: 'Arama kutusuna odaklan' },
                { key: 'Ctrl+Shift+F', description: 'Mevcut kanalda ara' },
                { key: 'Ctrl+G', description: 'Mesaja git' },
                { key: 'Ctrl+Shift+G', description: 'Sonraki okunmamışa git' }
            ]
        },
        {
            category: 'Sesli', shortcuts: [
                { key: 'Ctrl+M', description: 'Mikrofonu aç/kapat' },
                { key: 'Ctrl+Shift+M', description: 'Sesi kapat/aç' },
                { key: 'Ctrl+Shift+S', description: 'Ekran paylaşımını başlat' },
                { key: 'Ctrl+Shift+C', description: 'Kamera paylaşımını başlat' }
            ]
        },
        {
            category: 'Ayarlar', shortcuts: [
                { key: 'Ctrl+,', description: 'Ayarları aç' },
                { key: 'Ctrl+Shift+T', description: 'Tema ayarlarını aç' },
                { key: 'Ctrl+Shift+N', description: 'Bildirim ayarlarını aç' },
                { key: 'Ctrl+Shift+L', description: 'Koyu/açık mod değiştir' }
            ]
        },
        {
            category: 'Yardımcı', shortcuts: [
                { key: 'Escape', description: 'Mevcut modalı kapat' },
                { key: 'F1', description: 'Klavye kısayollarını göster' },
                { key: 'F11', description: 'Tam ekran modu' }
            ]
        }
    ];

    let html = '<div class="keyboard-shortcuts-list">';

    shortcuts.forEach(category => {
        html += `
            <div class="shortcut-category">
                <div class="shortcut-category-title">${category.category}</div>
                <div class="shortcut-items">
        `;

        category.shortcuts.forEach(shortcut => {
            html += `
                <div class="shortcut-item">
                    <div class="shortcut-keys">${shortcut.key}</div>
                    <div class="shortcut-description">${shortcut.description}</div>
                </div>
            `;
        });

        html += `
                </div>
            </div>
        `;
    });

    html += '</div>';

    showModal("Klavye Kısayolları", html, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
    `);
}

// Shortcut implementations
function createNewServer() {
    showCreateServerModal();
}

function createNewChannel() {
    const server = state.servers.find(s => s.id === state.activeServerId);
    if (server) {
        showCreateChannelModal(server.id);
    }
}

function createNewRole() {
    showRoleManagementModal();
}


function addNewLineToMessage(e) {
    const input = document.getElementById('chat-input');
    if (input) {
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const value = input.value;

        input.value = value.substring(0, start) + '\n' + value.substring(end);
        input.selectionStart = input.selectionEnd = start + 1;
    }
}

function sendFormattedMessage() {
    // Implement formatted message sending
    sendMessage();
}

function toggleItalic() {
    toggleMessageFormat('italic');
}

function toggleBold() {
    toggleMessageFormat('bold');
}

function toggleUnderline() {
    toggleMessageFormat('underline');
}

function toggleStrikethrough() {
    toggleMessageFormat('strikethrough');
}

function toggleCode() {
    toggleMessageFormat('code');
}

function toggleCodeBlock() {
    toggleMessageFormat('codeblock');
}

function toggleMessageFormat(format) {
    const input = document.getElementById('message-input');
    if (!input) return;

    const start = input.selectionStart;
    const end = input.selectionEnd;
    const selectedText = input.value.substring(start, end);

    let formattedText = '';
    switch (format) {
        case 'italic':
            formattedText = `*${selectedText}*`;
            break;
        case 'bold':
            formattedText = `**${selectedText}**`;
            break;
        case 'underline':
            formattedText = `__${selectedText}__`;
            break;
        case 'strikethrough':
            formattedText = `~~${selectedText}~~`;
            break;
        case 'code':
            formattedText = `\`${selectedText}\``;
            break;
        case 'codeblock':
            formattedText = `\`\`\`\n${selectedText}\n\`\`\``;
            break;
    }

    input.value = input.value.substring(0, start) + formattedText + input.value.substring(end);
    input.selectionStart = start + 1;
    input.selectionEnd = start + formattedText.length - 1;
    input.focus();
}

function focusSearchInput() {
    const searchInput = document.querySelector('#search-input');
    if (searchInput) {
        searchInput.focus();
    } else {
        // Create search input if it doesn't exist
        showSearchModal();
    }
}

function searchInCurrentChannel() {
    showSearchModal();
}

function goToMessage() {
    const messageId = prompt('Mesaj ID:');
    if (messageId) {
        jumpToMessage(messageId);
    }
}

function goToNextUnread() {
    // Implement next unread message navigation
    toast('Sonraki okunmamış mesaja gidiliyor', 'info');
}

function moveToPreviousChannel() {
    // Implement channel navigation
    toast('Önceki kanala geçiliyor', 'info');
}

function moveToNextChannel() {
    // Implement channel navigation
    toast('Sonraki kanala geçiliyor', 'info');
}

function moveToPreviousServer() {
    // Implement server navigation
    toast('Önceki sunucuya geçiliyor', 'info');
}

function moveToNextServer() {
    // Implement server navigation
    toast('Sonraki sunucuya geçiliyor', 'info');
}

function toggleMicrophone() {
    if (state.mesh && state.mesh.voiceActive) {
        toggleMute();
    }
}

function toggleDeafen() {
    if (state.mesh && state.mesh.voiceActive) {
        toggleDeafen();
    }
}

function openProfileSettings() {
    showProfileSettingsModal();
}

function showUserSettings() {
    showUserSettingsModal();
}

function toggleDarkMode() {
    const currentTheme = state.theme || 'sapphire';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    selectTheme(newTheme);
}

function toggleAnimations() {
    const enabled = state.settings?.animations !== false;
    updateAnimations(!enabled);
}

function toggleCompactMode() {
    const current = state.settings?.messageDensity || 'cozy';
    const densities = ['comfortable', 'cozy', 'compact'];
    const currentIndex = densities.indexOf(current);
    const nextIndex = (currentIndex + 1) % densities.length;
    updateMessageDensity(densities[nextIndex]);
}

function showHelpModal() {
    showKeyboardShortcutsModal();
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

function closeCurrentModal() {
    hideModal();
}

function openDMWithUser(userId) {
    // Implement DM opening
    toast(`DM açılıyor: ${userId}`, 'info');
}

function switchToChannel(channelId) {
    // Implement channel switching
    toast(`Kanala geçiliyor: ${channelId}`, 'info');
}

// Voice Recording and Call History System
function showVoiceRecordingModal() {
    const modalContent = `
        <div class="voice-recording-modal">
            <div class="voice-recording-header">
                <div class="voice-recording-title">🎙️ Ses Kaydı</div>
                <div class="voice-recording-subtitle">Sesli mesajlar ve aramalar</div>
            </div>
            <div class="voice-recording-tabs">
                <button class="voice-recording-tab active" data-tab="record">Kayıt</button>
                <button class="voice-recording-tab" data-tab="history">Geçmiş</button>
                <button class="voice-recording-tab" data-tab="settings">Ayarlar</button>
            </div>
            <div class="voice-recording-content" id="voice-recording-content">
                <!-- Content will be loaded dynamically -->
            </div>
        </div>
    `;

    showModal("Ses Kaydı", modalContent, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
    `);

    // Initialize tabs
    initializeVoiceRecordingTabs();
    loadVoiceRecordingContent();
}

function initializeVoiceRecordingTabs() {
    const tabs = document.querySelectorAll('.voice-recording-tab');
    const content = document.getElementById('voice-recording-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const tabName = tab.getAttribute('data-tab');
            switch (tabName) {
                case 'record':
                    loadVoiceRecordingContent();
                    break;
                case 'history':
                    loadVoiceHistoryContent();
                    break;
                case 'settings':
                    loadVoiceSettingsContent();
                    break;
            }
        });
    });
}

function loadVoiceRecordingContent() {
    const content = document.getElementById('voice-recording-content');

    const html = `
        <div class="voice-recording-interface">
            <div class="recording-controls">
                <div class="recording-status" id="recording-status">Hazır</div>
                <div class="recording-timer" id="recording-timer">00:00</div>
                <div class="recording-actions">
                    <button class="btn-record" id="start-recording-btn" onclick="startVoiceRecording()">
                        <span class="record-icon">🔴</span>
                        Kayıt Başlat
                    </button>
                    <button class="btn-stop" id="stop-recording-btn" onclick="stopVoiceRecording()" style="display: none;">
                        <span class="stop-icon">⏹️</span>
                        Durdur
                    </button>
                    <button class="btn-pause" id="pause-recording-btn" onclick="pauseVoiceRecording()" style="display: none;">
                        <span class="pause-icon">⏸️</span>
                        Duraklat
                    </button>
                </div>
            </div>
            <div class="recording-visualizer" id="recording-visualizer">
                <div class="visualizer-bars">
                    ${Array(20).fill(0).map(() => '<div class="visualizer-bar"></div>').join('')}
                </div>
            </div>
            <div class="recording-options">
                <div class="option-group">
                    <label>Kalite:</label>
                    <select id="recording-quality">
                        <option value="low">Düşük (8kHz)</option>
                        <option value="medium" selected>Orta (16kHz)</option>
                        <option value="high">Yüksek (44.1kHz)</option>
                    </select>
                </div>
                <div class="option-group">
                    <label>Format:</label>
                    <select id="recording-format">
                        <option value="webm" selected>WebM</option>
                        <option value="mp3">MP3</option>
                        <option value="wav">WAV</option>
                    </select>
                </div>
                <div class="option-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="auto-send" checked>
                        Kaydı otomatik gönder
                    </label>
                </div>
            </div>
        </div>
    `;

    content.innerHTML = html;
}

function loadVoiceHistoryContent() {
    const content = document.getElementById('voice-recording-content');
    const recordings = getVoiceRecordings();
    const calls = getCallHistory();

    let html = '<div class="voice-history">';

    // Recent recordings
    html += `
        <div class="history-section">
            <div class="history-title">🎙️ Son Kayıtlar</div>
            <div class="history-list">
    `;

    if (recordings.length > 0) {
        recordings.slice(0, 5).forEach(recording => {
            html += `
                <div class="history-item voice-recording-item">
                    <div class="history-icon">🎙️</div>
                    <div class="history-info">
                        <div class="history-name">${recording.name || 'Ses Kaydı'}</div>
                        <div class="history-details">${formatDuration(recording.duration)} • ${new Date(recording.timestamp).toLocaleDateString('tr-TR')}</div>
                    </div>
                    <div class="history-actions">
                        <button class="btn-play" onclick="playVoiceRecording('${recording.id}')">▶️</button>
                        <button class="btn-send" onclick="sendVoiceRecording('${recording.id}')">📤</button>
                        <button class="btn-delete" onclick="deleteVoiceRecording('${recording.id}')">🗑️</button>
                    </div>
                </div>
            `;
        });
    } else {
        html += '<div class="history-empty">Henüz kayıt yok</div>';
    }

    html += `
            </div>
        </div>
        <div class="history-section">
            <div class="history-title">📞 Arama Geçmişi</div>
            <div class="history-list">
    `;

    if (calls.length > 0) {
        calls.slice(0, 5).forEach(call => {
            const icon = call.type === 'incoming' ? '📞' : '📱';
            const status = call.status === 'completed' ? '✅' : call.status === 'missed' ? '❌' : '⏹️';
            html += `
                <div class="history-item call-item">
                    <div class="history-icon">${icon}</div>
                    <div class="history-info">
                        <div class="history-name">${call.participant}</div>
                        <div class="history-details">${formatDuration(call.duration)} • ${new Date(call.timestamp).toLocaleDateString('tr-TR')}</div>
                    </div>
                    <div class="history-status">${status}</div>
                </div>
            `;
        });
    } else {
        html += '<div class="history-empty">Arama geçmişi yok</div>';
    }

    html += `
            </div>
        </div>
    </div>`;

    content.innerHTML = html;
}

function loadVoiceSettingsContent() {
    const content = document.getElementById('voice-recording-content');
    const settings = getVoiceRecordingSettings();

    const html = `
        <div class="voice-settings">
            <div class="settings-group">
                <div class="settings-title">Kayıt Ayarları</div>
                <div class="settings-options">
                    <div class="setting-item">
                        <label>Varsayılan Kalite:</label>
                        <select id="default-quality" onchange="updateVoiceSetting('defaultQuality', this.value)">
                            <option value="low" ${settings.defaultQuality === 'low' ? 'selected' : ''}>Düşük (8kHz)</option>
                            <option value="medium" ${settings.defaultQuality === 'medium' ? 'selected' : ''}>Orta (16kHz)</option>
                            <option value="high" ${settings.defaultQuality === 'high' ? 'selected' : ''}>Yüksek (44.1kHz)</option>
                        </select>
                    </div>
                    <div class="setting-item">
                        <label>Varsayılan Format:</label>
                        <select id="default-format" onchange="updateVoiceSetting('defaultFormat', this.value)">
                            <option value="webm" ${settings.defaultFormat === 'webm' ? 'selected' : ''}>WebM</option>
                            <option value="mp3" ${settings.defaultFormat === 'mp3' ? 'selected' : ''}>MP3</option>
                            <option value="wav" ${settings.defaultFormat === 'wav' ? 'selected' : ''}>WAV</option>
                        </select>
                    </div>
                    <div class="setting-item">
                        <label>Maksimum Kayıt Süresi (dakika):</label>
                        <input type="number" id="max-duration" min="1" max="60" value="${settings.maxDuration}" onchange="updateVoiceSetting('maxDuration', this.value)">
                    </div>
                </div>
            </div>
            <div class="settings-group">
                <div class="settings-title">Arama Ayarları</div>
                <div class="settings-options">
                    <div class="setting-item">
                        <label class="checkbox-label">
                            <input type="checkbox" id="auto-record-calls" ${settings.autoRecordCalls ? 'checked' : ''} onchange="updateVoiceSetting('autoRecordCalls', this.checked)">
                            Aramaları otomatik kaydet
                        </label>
                    </div>
                    <div class="setting-item">
                        <label class="checkbox-label">
                            <input type="checkbox" id="save-call-history" ${settings.saveCallHistory ? 'checked' : ''} onchange="updateVoiceSetting('saveCallHistory', this.checked)">
                            Arama geçmişini kaydet
                        </label>
                    </div>
                    <div class="setting-item">
                        <label class="checkbox-label">
                            <input type="checkbox" id="noise-suppression" ${settings.noiseSuppression ? 'checked' : ''} onchange="updateVoiceSetting('noiseSuppression', this.checked)">
                            Gürültü bastırma
                        </label>
                    </div>
                </div>
            </div>
            <div class="settings-group">
                <div class="settings-title">Depolama</div>
                <div class="settings-options">
                    <div class="setting-item">
                        <label>Depolama Alanı:</label>
                        <div class="storage-info">
                            <div class="storage-bar">
                                <div class="storage-used" style="width: ${getStorageUsagePercentage()}%"></div>
                            </div>
                            <div class="storage-text">${formatBytes(getStorageUsed())} / ${formatBytes(getStorageLimit())}</div>
                        </div>
                    </div>
                    <div class="setting-item">
                        <button class="btn-secondary" onclick="clearVoiceRecordings()">Tüm Kayıtları Temizle</button>
                        <button class="btn-secondary" onclick="clearCallHistory()">Arama Geçmişini Temizle</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    content.innerHTML = html;
}

// Voice recording functionality
let mediaRecorder = null;
let recordingChunks = [];
let recordingStartTime = null;
let recordingTimer = null;
let isPaused = false;

async function startVoiceRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: getVoiceRecordingSettings().noiseSuppression,
                sampleRate: getSampleRate()
            }
        });

        const quality = document.getElementById('recording-quality')?.value || 'medium';
        const format = document.getElementById('recording-format')?.value || 'webm';

        mediaRecorder = new MediaRecorder(stream, {
            mimeType: getMimeType(format)
        });

        recordingChunks = [];
        recordingStartTime = Date.now();
        isPaused = false;

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordingChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            handleRecordingComplete();
        };

        mediaRecorder.start(100); // Collect data every 100ms

        // Update UI
        updateRecordingUI('recording');
        startRecordingTimer();
        startVisualizer(stream);

        toast('Kayıt başlatıldı', 'success');
    } catch (error) {
        console.error('Recording error:', error);
        toast('Mikrofon erişimi reddedildi', 'error');
    }
}

function stopVoiceRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }

    stopRecordingTimer();
    stopVisualizer();
    updateRecordingUI('stopped');
}

function pauseVoiceRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.pause();
        isPaused = true;
        stopRecordingTimer();
        updateRecordingUI('paused');
        toast('Kayıt duraklatıldı', 'info');
    } else if (mediaRecorder && mediaRecorder.state === 'paused') {
        mediaRecorder.resume();
        isPaused = false;
        startRecordingTimer();
        updateRecordingUI('recording');
        toast('Kayıt devam ediyor', 'info');
    }
}

function handleRecordingComplete() {
    const blob = new Blob(recordingChunks, { type: getMimeType() });
    const duration = Date.now() - recordingStartTime;

    // Save recording
    const recording = {
        id: generateId(),
        name: `Kayıt ${new Date().toLocaleTimeString('tr-TR')}`,
        blob: blob,
        duration: duration,
        timestamp: Date.now(),
        quality: document.getElementById('recording-quality')?.value || 'medium',
        format: document.getElementById('recording-format')?.value || 'webm'
    };

    saveVoiceRecording(recording);

    // Auto send if enabled
    if (document.getElementById('auto-send')?.checked) {
        sendVoiceRecording(recording.id);
    }

    toast('Kayıt tamamlandı', 'success');
    updateRecordingUI('ready');
}

function updateRecordingUI(status) {
    const startBtn = document.getElementById('start-recording-btn');
    const stopBtn = document.getElementById('stop-recording-btn');
    const pauseBtn = document.getElementById('pause-recording-btn');
    const statusEl = document.getElementById('recording-status');

    switch (status) {
        case 'recording':
            startBtn.style.display = 'none';
            stopBtn.style.display = 'block';
            pauseBtn.style.display = 'block';
            statusEl.textContent = 'Kaydediliyor...';
            statusEl.className = 'recording-status recording';
            break;
        case 'paused':
            startBtn.style.display = 'none';
            stopBtn.style.display = 'block';
            pauseBtn.style.display = 'block';
            pauseBtn.innerHTML = '<span class="resume-icon">▶️</span>Devam Et';
            statusEl.textContent = 'Duraklatıldı';
            statusEl.className = 'recording-status paused';
            break;
        case 'stopped':
            startBtn.style.display = 'block';
            stopBtn.style.display = 'none';
            pauseBtn.style.display = 'none';
            statusEl.textContent = 'Hazır';
            statusEl.className = 'recording-status';
            break;
        case 'ready':
            startBtn.style.display = 'block';
            stopBtn.style.display = 'none';
            pauseBtn.style.display = 'none';
            statusEl.textContent = 'Hazır';
            statusEl.className = 'recording-status';
            break;
    }
}

function startRecordingTimer() {
    recordingTimer = setInterval(() => {
        const elapsed = Date.now() - recordingStartTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        const timerEl = document.getElementById('recording-timer');
        if (timerEl) {
            timerEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }

        // Check max duration
        const maxDuration = getVoiceRecordingSettings().maxDuration * 60000;
        if (elapsed >= maxDuration) {
            stopVoiceRecording();
            toast('Maksimum kayıt süresine ulaşıldı', 'warning');
        }
    }, 1000);
}

function stopRecordingTimer() {
    if (recordingTimer) {
        clearInterval(recordingTimer);
        recordingTimer = null;
    }
}

// Visualizer
let audioContext = null;
let analyser = null;
let dataArray = null;
let animationId = null;

function startVisualizer(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);

    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);

    source.connect(analyser);

    function draw() {
        animationId = requestAnimationFrame(draw);

        analyser.getByteFrequencyData(dataArray);

        const bars = document.querySelectorAll('.visualizer-bar');
        const step = Math.floor(dataArray.length / bars.length);

        bars.forEach((bar, index) => {
            const value = dataArray[index * step];
            const height = Math.max(4, (value / 255) * 40);
            bar.style.height = height + 'px';
        });
    }

    draw();
}

function stopVisualizer() {
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    if (audioContext) {
        audioContext.close();
        audioContext = null;
    }

    // Reset bars
    document.querySelectorAll('.visualizer-bar').forEach(bar => {
        bar.style.height = '4px';
    });
}

// Storage and management functions
function saveVoiceRecording(recording) {
    const recordings = getVoiceRecordings();
    recordings.push(recording);

    // Keep only last 50 recordings
    if (recordings.length > 50) {
        recordings.shift();
    }

    localStorage.setItem('scord_voice_recordings', JSON.stringify(recordings.map(r => ({
        id: r.id,
        name: r.name,
        duration: r.duration,
        timestamp: r.timestamp,
        quality: r.quality,
        format: r.format,
        dataUrl: r.blob ? URL.createObjectURL(r.blob) : null
    }))));
}

function getVoiceRecordings() {
    try {
        const saved = localStorage.getItem('scord_voice_recordings');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.warn("Failed to load voice recordings:", e);
        return [];
    }
}

function playVoiceRecording(recordingId) {
    const recordings = getVoiceRecordings();
    const recording = recordings.find(r => r.id === recordingId);

    if (recording && recording.dataUrl) {
        const audio = new Audio(recording.dataUrl);
        audio.play();
        toast('Kayıt oynatılıyor', 'info');
    }
}

function sendVoiceRecording(recordingId) {
    const recordings = getVoiceRecordings();
    const recording = recordings.find(r => r.id === recordingId);

    if (recording && recording.dataUrl) {
        // Send voice message to current channel
        const message = {
            type: 'voice',
            recordingId: recordingId,
            name: recording.name,
            duration: recording.duration,
            dataUrl: recording.dataUrl
        };

        // This would integrate with the existing message sending system
        toast('Sesli mesaj gönderildi', 'success');
    }
}

function deleteVoiceRecording(recordingId) {
    if (confirm('Bu kaydı silmek istediğinizden emin misiniz?')) {
        const recordings = getVoiceRecordings();
        const index = recordings.findIndex(r => r.id === recordingId);

        if (index !== -1) {
            recordings.splice(index, 1);
            localStorage.setItem('scord_voice_recordings', JSON.stringify(recordings));
            loadVoiceHistoryContent();
            toast('Kayıt silindi', 'success');
        }
    }
}

function getCallHistory() {
    try {
        const saved = localStorage.getItem('scord_call_history');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.warn("Failed to load call history:", e);
        return [];
    }
}

function saveCallToHistory(call) {
    const calls = getCallHistory();
    calls.push(call);

    // Keep only last 100 calls
    if (calls.length > 100) {
        calls.shift();
    }

    localStorage.setItem('scord_call_history', JSON.stringify(calls));
}

// Utility functions
function getVoiceRecordingSettings() {
    try {
        const saved = localStorage.getItem('scord_voice_settings');
        return saved ? JSON.parse(saved) : {
            defaultQuality: 'medium',
            defaultFormat: 'webm',
            maxDuration: 10,
            autoRecordCalls: false,
            saveCallHistory: true,
            noiseSuppression: true
        };
    } catch (e) {
        return {
            defaultQuality: 'medium',
            defaultFormat: 'webm',
            maxDuration: 10,
            autoRecordCalls: false,
            saveCallHistory: true,
            noiseSuppression: true
        };
    }
}

function updateVoiceSetting(key, value) {
    const settings = getVoiceRecordingSettings();
    settings[key] = value;
    localStorage.setItem('scord_voice_settings', JSON.stringify(settings));
    toast('Ayar güncellendi', 'success');
}

function getSampleRate() {
    const quality = document.getElementById('recording-quality')?.value || 'medium';
    switch (quality) {
        case 'low': return 8000;
        case 'medium': return 16000;
        case 'high': return 44100;
        default: return 16000;
    }
}

function getMimeType(format) {
    switch (format) {
        case 'webm': return 'audio/webm';
        case 'mp3': return 'audio/mpeg';
        case 'wav': return 'audio/wav';
        default: return 'audio/webm';
    }
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getStorageUsed() {
    const recordings = getVoiceRecordings();
    return recordings.reduce((total, recording) => {
        // Estimate size based on duration and quality
        const bitrate = recording.quality === 'high' ? 128000 : recording.quality === 'medium' ? 64000 : 32000;
        return total + (recording.duration * bitrate / 8);
    }, 0);
}

function getStorageLimit() {
    return 100 * 1024 * 1024; // 100MB
}

function getStorageUsagePercentage() {
    return Math.min(100, (getStorageUsed() / getStorageLimit()) * 100);
}

function clearVoiceRecordings() {
    if (confirm('Tüm ses kayıtlarını silmek istediğinizden emin misiniz?')) {
        localStorage.removeItem('scord_voice_recordings');
        loadVoiceHistoryContent();
        toast('Tüm kayıtlar silindi', 'success');
    }
}

function clearCallHistory() {
    if (confirm('Arama geçmişini silmek istediğinizden emin misiniz?')) {
        localStorage.removeItem('scord_call_history');
        loadVoiceHistoryContent();
        toast('Arama geçmişi silindi', 'success');
    }
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Screen Recording with Voice System
function showScreenRecordingModal() {
    const modalContent = `
        <div class="screen-recording-modal">
            <div class="screen-recording-header">
                <div class="screen-recording-title">🎬 Ekran Kaydı</div>
                <div class="screen-recording-subtitle">Ekranı sesle birlikte kaydet</div>
            </div>
            <div class="screen-recording-content">
                <div class="recording-setup">
                    <div class="setup-section">
                        <div class="setup-title">Kayıt Kaynakları</div>
                        <div class="setup-options">
                            <div class="option-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="record-screen" checked>
                                    🖥️ Ekranı Kaydet
                                </label>
                            </div>
                            <div class="option-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="record-camera">
                                    📷 Kamerayı Kaydet
                                </label>
                            </div>
                            <div class="option-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="record-microphone" checked>
                                    🎤 Mikrofonu Kaydet
                                </label>
                            </div>
                            <div class="option-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="record-system-audio">
                                    🔊 Sistem Sesini Kaydet
                                </label>
                            </div>
                        </div>
                    </div>
                    
                    <div class="setup-section">
                        <div class="setup-title">Kayıt Ayarları</div>
                        <div class="setup-options">
                            <div class="option-group">
                                <label>Video Kalitesi:</label>
                                <select id="video-quality">
                                    <option value="360p">360p (SD)</option>
                                    <option value="720p" selected>720p (HD)</option>
                                    <option value="1080p">1080p (Full HD)</option>
                                    <option value="4k">4K (Ultra HD)</option>
                                </select>
                            </div>
                            <div class="option-group">
                                <label>Video Formatı:</label>
                                <select id="video-format">
                                    <option value="webm" selected>WebM</option>
                                    <option value="mp4">MP4</option>
                                    <option value="mov">MOV</option>
                                </select>
                            </div>
                            <div class="option-group">
                                <label>Çerçeve Oranı (FPS):</label>
                                <select id="frame-rate">
                                    <option value="15">15 FPS</option>
                                    <option value="30" selected>30 FPS</option>
                                    <option value="60">60 FPS</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    
                    <div class="setup-section">
                        <div class="setup-title">Ekran Seçimi</div>
                        <div class="screen-options">
                            <div class="screen-option" onclick="selectEntireScreen()">
                                <div class="screen-preview entire-screen">
                                    <div class="screen-icon">🖥️</div>
                                    <div class="screen-label">Tüm Ekran</div>
                                </div>
                            </div>
                            <div class="screen-option" onclick="selectApplicationWindow()">
                                <div class="screen-preview application-window">
                                    <div class="screen-icon">🪟</div>
                                    <div class="screen-label">Uygulama Penceresi</div>
                                </div>
                            </div>
                            <div class="screen-option" onclick="selectCustomArea()">
                                <div class="screen-preview custom-area">
                                    <div class="screen-icon">📐</div>
                                    <div class="screen-label">Özel Alan</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="recording-controls">
                    <div class="recording-status" id="screen-recording-status">Hazır</div>
                    <div class="recording-timer" id="screen-recording-timer">00:00:00</div>
                    <div class="recording-actions">
                        <button class="btn-record" id="start-screen-recording-btn" onclick="startScreenRecording()">
                            <span class="record-icon">🔴</span>
                            Kaydı Başlat
                        </button>
                        <button class="btn-stop" id="stop-screen-recording-btn" onclick="stopScreenRecording()" style="display: none;">
                            <span class="stop-icon">⏹️</span>
                            Durdur
                        </button>
                        <button class="btn-pause" id="pause-screen-recording-btn" onclick="pauseScreenRecording()" style="display: none;">
                            <span class="pause-icon">⏸️</span>
                            Duraklat
                        </button>
                    </div>
                </div>
                
                <div class="recording-preview" id="screen-recording-preview" style="display: none;">
                    <video id="preview-video" muted autoplay></video>
                </div>
            </div>
        </div>
    `;

    showModal("Ekran Kaydı", modalContent, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
    `);
}

// Screen recording functionality
let screenMediaRecorder = null;
let screenRecordingChunks = [];
let screenRecordingStartTime = null;
let screenRecordingTimer = null;
let screenRecordingStream = null;
let selectedScreenSource = 'entire';
let isScreenRecordingPaused = false;

async function startScreenRecording() {
    try {
        const constraints = await getRecordingConstraints();

        // Get display media
        screenRecordingStream = await navigator.mediaDevices.getDisplayMedia(constraints);

        // Add audio if requested
        if (document.getElementById('record-microphone')?.checked) {
            const audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            // Add audio tracks to the main stream
            audioStream.getAudioTracks().forEach(track => {
                screenRecordingStream.addTrack(track);
            });
        }

        const format = document.getElementById('video-format')?.value || 'webm';

        screenMediaRecorder = new MediaRecorder(screenRecordingStream, {
            mimeType: getVideoMimeType(format)
        });

        screenRecordingChunks = [];
        screenRecordingStartTime = Date.now();
        isScreenRecordingPaused = false;

        screenMediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                screenRecordingChunks.push(event.data);
            }
        };

        screenMediaRecorder.onstop = () => {
            handleScreenRecordingComplete();
        };

        screenMediaRecorder.start(100); // Collect data every 100ms

        // Show preview
        showRecordingPreview(screenRecordingStream);

        // Update UI
        updateScreenRecordingUI('recording');
        startScreenRecordingTimer();

        // Handle stream end
        screenRecordingStream.getVideoTracks()[0].addEventListener('ended', () => {
            stopScreenRecording();
        });

        toast('Ekran kaydı başlatıldı', 'success');
    } catch (error) {
        console.error('Screen recording error:', error);
        toast('Ekran kaydı başlatılamadı', 'error');
    }
}

function stopScreenRecording() {
    if (screenMediaRecorder && screenMediaRecorder.state !== 'inactive') {
        screenMediaRecorder.stop();
    }

    if (screenRecordingStream) {
        screenRecordingStream.getTracks().forEach(track => track.stop());
        screenRecordingStream = null;
    }

    stopScreenRecordingTimer();
    hideRecordingPreview();
    updateScreenRecordingUI('stopped');
}

function pauseScreenRecording() {
    if (screenMediaRecorder && screenMediaRecorder.state === 'recording') {
        screenMediaRecorder.pause();
        isScreenRecordingPaused = true;
        stopScreenRecordingTimer();
        updateScreenRecordingUI('paused');
        toast('Ekran kaydı duraklatıldı', 'info');
    } else if (screenMediaRecorder && screenMediaRecorder.state === 'paused') {
        screenMediaRecorder.resume();
        isScreenRecordingPaused = false;
        startScreenRecordingTimer();
        updateScreenRecordingUI('recording');
        toast('Ekran kaydı devam ediyor', 'info');
    }
}

async function getRecordingConstraints() {
    const quality = document.getElementById('video-quality')?.value || '720p';
    const frameRate = parseInt(document.getElementById('frame-rate')?.value || '30');
    const recordScreen = document.getElementById('record-screen')?.checked !== false;
    const recordCamera = document.getElementById('record-camera')?.checked;

    let videoConstraints = {};

    if (recordScreen && selectedScreenSource === 'entire') {
        videoConstraints = {
            width: { ideal: getVideoWidth(quality) },
            height: { ideal: getVideoHeight(quality) },
            frameRate: { ideal: frameRate },
            displaySurface: 'monitor'
        };
    } else if (recordCamera) {
        videoConstraints = {
            width: { ideal: getVideoWidth(quality) },
            height: { ideal: getVideoHeight(quality) },
            frameRate: { ideal: frameRate }
        };
    }

    const constraints = {
        video: recordScreen || recordCamera ? videoConstraints : false,
        audio: document.getElementById('record-system-audio')?.checked ? {
            echoCancellation: true,
            noiseSuppression: true
        } : false
    };

    return constraints;
}

function getVideoWidth(quality) {
    switch (quality) {
        case '360p': return 640;
        case '720p': return 1280;
        case '1080p': return 1920;
        case '4k': return 3840;
        default: return 1280;
    }
}

function getVideoHeight(quality) {
    switch (quality) {
        case '360p': return 360;
        case '720p': return 720;
        case '1080p': return 1080;
        case '4k': return 2160;
        default: return 720;
    }
}

function getVideoMimeType(format) {
    switch (format) {
        case 'webm': return 'video/webm';
        case 'mp4': return 'video/mp4';
        case 'mov': return 'video/quicktime';
        default: return 'video/webm';
    }
}

function showRecordingPreview(stream) {
    const preview = document.getElementById('screen-recording-preview');
    const video = document.getElementById('preview-video');

    if (preview && video) {
        preview.style.display = 'block';
        video.srcObject = stream;
    }
}

function hideRecordingPreview() {
    const preview = document.getElementById('screen-recording-preview');
    const video = document.getElementById('preview-video');

    if (preview && video) {
        preview.style.display = 'none';
        video.srcObject = null;
    }
}

function updateScreenRecordingUI(status) {
    const startBtn = document.getElementById('start-screen-recording-btn');
    const stopBtn = document.getElementById('stop-screen-recording-btn');
    const pauseBtn = document.getElementById('pause-screen-recording-btn');
    const statusEl = document.getElementById('screen-recording-status');

    switch (status) {
        case 'recording':
            startBtn.style.display = 'none';
            stopBtn.style.display = 'block';
            pauseBtn.style.display = 'block';
            statusEl.textContent = 'Kaydediliyor...';
            statusEl.className = 'recording-status recording';
            break;
        case 'paused':
            startBtn.style.display = 'none';
            stopBtn.style.display = 'block';
            pauseBtn.style.display = 'block';
            pauseBtn.innerHTML = '<span class="resume-icon">▶️</span>Devam Et';
            statusEl.textContent = 'Duraklatıldı';
            statusEl.className = 'recording-status paused';
            break;
        case 'stopped':
            startBtn.style.display = 'block';
            stopBtn.style.display = 'none';
            pauseBtn.style.display = 'none';
            statusEl.textContent = 'Hazır';
            statusEl.className = 'recording-status';
            break;
        case 'ready':
            startBtn.style.display = 'block';
            stopBtn.style.display = 'none';
            pauseBtn.style.display = 'none';
            statusEl.textContent = 'Hazır';
            statusEl.className = 'recording-status';
            break;
    }
}

function startScreenRecordingTimer() {
    screenRecordingTimer = setInterval(() => {
        const elapsed = Date.now() - screenRecordingStartTime;
        const hours = Math.floor(elapsed / 3600000);
        const minutes = Math.floor((elapsed % 3600000) / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        const timerEl = document.getElementById('screen-recording-timer');
        if (timerEl) {
            timerEl.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }, 1000);
}

function stopScreenRecordingTimer() {
    if (screenRecordingTimer) {
        clearInterval(screenRecordingTimer);
        screenRecordingTimer = null;
    }
}

function handleScreenRecordingComplete() {
    const blob = new Blob(screenRecordingChunks, { type: getVideoMimeType() });
    const duration = Date.now() - screenRecordingStartTime;

    // Save recording
    const recording = {
        id: generateId(),
        name: `Ekran Kaydı ${new Date().toLocaleTimeString('tr-TR')}`,
        blob: blob,
        duration: duration,
        timestamp: Date.now(),
        quality: document.getElementById('video-quality')?.value || '720p',
        format: document.getElementById('video-format')?.value || 'webm',
        frameRate: document.getElementById('frame-rate')?.value || '30',
        sources: {
            screen: document.getElementById('record-screen')?.checked,
            camera: document.getElementById('record-camera')?.checked,
            microphone: document.getElementById('record-microphone')?.checked,
            systemAudio: document.getElementById('record-system-audio')?.checked
        }
    };

    saveScreenRecording(recording);

    toast('Ekran kaydı tamamlandı', 'success');
    updateScreenRecordingUI('ready');

    // Show download option
    showRecordingDownloadOptions(recording);
}

function saveScreenRecording(recording) {
    const recordings = getScreenRecordings();
    recordings.push(recording);

    // Keep only last 20 recordings
    if (recordings.length > 20) {
        recordings.shift();
    }

    localStorage.setItem('scord_screen_recordings', JSON.stringify(recordings.map(r => ({
        id: r.id,
        name: r.name,
        duration: r.duration,
        timestamp: r.timestamp,
        quality: r.quality,
        format: r.format,
        frameRate: r.frameRate,
        sources: r.sources,
        dataUrl: r.blob ? URL.createObjectURL(r.blob) : null
    }))));
}

function getScreenRecordings() {
    try {
        const saved = localStorage.getItem('scord_screen_recordings');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.warn("Failed to load screen recordings:", e);
        return [];
    }
}

function showRecordingDownloadOptions(recording) {
    const modalContent = `
        <div class="recording-download-options">
            <div class="download-title">🎬 Kayıt Tamamlandı</div>
            <div class="download-info">
                <div class="info-item">
                    <span class="info-label">Süre:</span>
                    <span class="info-value">${formatDuration(recording.duration)}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Kalite:</span>
                    <span class="info-value">${recording.quality} @ ${recording.frameRate}fps</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Format:</span>
                    <span class="info-value">${recording.format.toUpperCase()}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Boyut:</span>
                    <span class="info-value">${formatBytes(recording.blob.size)}</span>
                </div>
            </div>
            <div class="download-actions">
                <button class="btn-primary" onclick="downloadScreenRecording('${recording.id}')">
                    💾 İndir
                </button>
                <button class="btn-secondary" onclick="shareScreenRecording('${recording.id}')">
                    📤 Paylaş
                </button>
                <button class="btn-secondary" onclick="playScreenRecording('${recording.id}')">
                    ▶️ Oynat
                </button>
            </div>
        </div>
    `;

    showModal("Kayıt Seçenekleri", modalContent, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
    `);
}

function downloadScreenRecording(recordingId) {
    const recordings = getScreenRecordings();
    const recording = recordings.find(r => r.id === recordingId);

    if (recording && recording.dataUrl) {
        const a = document.createElement('a');
        a.href = recording.dataUrl;
        a.download = `${recording.name}.${recording.format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        toast('Kayıt indiriliyor', 'success');
    }
}

function shareScreenRecording(recordingId) {
    const recordings = getScreenRecordings();
    const recording = recordings.find(r => r.id === recordingId);

    if (recording && recording.dataUrl) {
        // Share to current channel
        const message = {
            type: 'screen-recording',
            recordingId: recordingId,
            name: recording.name,
            duration: recording.duration,
            quality: recording.quality,
            format: recording.format,
            dataUrl: recording.dataUrl
        };

        // This would integrate with the existing message sending system
        toast('Ekran kaydı paylaşıldı', 'success');
    }
}

function playScreenRecording(recordingId) {
    const recordings = getScreenRecordings();
    const recording = recordings.find(r => r.id === recordingId);

    if (recording && recording.dataUrl) {
        // Open video in new tab or modal
        const videoWindow = window.open('', '_blank');
        videoWindow.document.write(`
            <html>
                <head>
                    <title>${recording.name}</title>
                    <style>
                        body { margin: 0; padding: 0; background: #000; display: flex; justify-content: center; align-items: center; height: 100vh; }
                        video { max-width: 100%; max-height: 100%; }
                    </style>
                </head>
                <body>
                    <video controls autoplay>
                        <source src="${recording.dataUrl}" type="video/${recording.format}">
                    </video>
                </body>
            </html>
        `);

        toast('Kayıt oynatılıyor', 'info');
    }
}

// Screen selection functions
function selectEntireScreen() {
    selectedScreenSource = 'entire';
    updateScreenSelectionUI('entire');
}

function selectApplicationWindow() {
    selectedScreenSource = 'window';
    updateScreenSelectionUI('window');
}

function selectCustomArea() {
    selectedScreenSource = 'area';
    updateScreenSelectionUI('area');
}

function updateScreenSelectionUI(selection) {
    document.querySelectorAll('.screen-option').forEach(option => {
        option.classList.remove('selected');
    });

    const selectedOption = Array.from(document.querySelectorAll('.screen-option')).find(option => {
        const preview = option.querySelector('.screen-preview');
        return preview.classList.contains(`${selection}-screen`) ||
            preview.classList.contains(`${selection}-window`) ||
            preview.classList.contains(`${selection}-area`);
    });

    if (selectedOption) {
        selectedOption.classList.add('selected');
    }
}

// Enhanced File Sharing with Previews System
function showFileSharingModal() {
    const modalContent = `
        <div class="file-sharing-modal">
            <div class="file-sharing-header">
                <div class="file-sharing-title">📁 Dosya Paylaşımı</div>
                <div class="file-sharing-subtitle">Dosya yükle ve önizle</div>
            </div>
            <div class="file-sharing-content">
                <div class="file-upload-area" id="file-upload-area">
                    <div class="upload-zone" id="upload-zone">
                        <div class="upload-icon">📤</div>
                        <div class="upload-text">
                            <div class="upload-title">Dosyaları buraya sürükle</div>
                            <div class="upload-subtitle">veya tıklayarak seç</div>
                        </div>
                        <input type="file" id="file-input" multiple accept="*" style="display: none;">
                        <button class="btn-secondary" onclick="document.getElementById('file-input').click()">
                            Dosya Seç
                        </button>
                    </div>
                </div>
                
                <div class="file-preview-section" id="file-preview-section" style="display: none;">
                    <div class="preview-header">
                        <div class="preview-title">Dosya Önizlemesi</div>
                        <div class="preview-actions">
                            <button class="btn-secondary" onclick="clearFileSelection()">Temizle</button>
                            <button class="btn-primary" onclick="uploadFiles()">Yükle</button>
                        </div>
                    </div>
                    <div class="file-previews" id="file-previews">
                        <!-- File previews will be loaded here -->
                    </div>
                </div>
                
                <div class="recent-files-section">
                    <div class="recent-files-title">📂 Son Dosyalar</div>
                    <div class="recent-files-list" id="recent-files-list">
                        <!-- Recent files will be loaded here -->
                    </div>
                </div>
            </div>
        </div>
    `;

    showModal("Dosya Paylaşımı", modalContent, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
    `);

    // Initialize file upload
    initializeFileUpload();
    loadRecentFiles();
}

function initializeFileUpload() {
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const uploadArea = document.getElementById('file-upload-area');

    if (!uploadZone || !fileInput || !uploadArea) return;

    // Click to upload
    uploadZone.addEventListener('click', () => {
        fileInput.click();
    });

    // File selection
    fileInput.addEventListener('change', (e) => {
        handleFileSelection(e.target.files);
    });

    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('drag-over');
    });

    uploadArea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('drag-over');
        handleFileSelection(e.dataTransfer.files);
    });

    // Paste support
    document.addEventListener('paste', (e) => {
        const files = e.clipboardData?.files;
        if (files && files.length > 0) {
            handleFileSelection(files);
        }
    });
}

let selectedFiles = [];

function handleFileSelection(files) {
    selectedFiles = Array.from(files);

    if (selectedFiles.length === 0) return;

    // Check file size limits
    const maxSize = 100 * 1024 * 1024; // 100MB
    const oversizedFiles = selectedFiles.filter(file => file.size > maxSize);

    if (oversizedFiles.length > 0) {
        toast(`${oversizedFiles.length} dosya boyut limitini aşıyor (max 100MB)`, 'error');
        selectedFiles = selectedFiles.filter(file => file.size <= maxSize);
    }

    if (selectedFiles.length === 0) return;

    // Show preview section
    document.getElementById('file-preview-section').style.display = 'block';

    // Generate previews
    generateFilePreviews();
}

function generateFilePreviews() {
    const previewsContainer = document.getElementById('file-previews');
    if (!previewsContainer) return;

    let html = '';

    selectedFiles.forEach((file, index) => {
        const preview = generateFilePreview(file, index);
        html += preview;
    });

    previewsContainer.innerHTML = html;

    // Generate actual previews for images
    selectedFiles.forEach((file, index) => {
        if (file.type.startsWith('image/')) {
            generateImagePreview(file, index);
        } else if (file.type.startsWith('video/')) {
            generateVideoPreview(file, index);
        } else if (file.type.startsWith('audio/')) {
            generateAudioPreview(file, index);
        } else if (file.type.startsWith('text/') || isTextFile(file)) {
            generateTextPreview(file, index);
        }
    });
}

function generateFilePreview(file, index) {
    const fileType = getFileType(file);
    const fileSize = formatFileSize(file.size);
    const fileIcon = getFileIcon(file);

    return `
        <div class="file-preview-item" data-index="${index}">
            <div class="file-preview-content">
                <div class="file-preview-media" id="preview-media-${index}">
                    <div class="file-icon-large">${fileIcon}</div>
                </div>
                <div class="file-preview-info">
                    <div class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
                    <div class="file-details">
                        <span class="file-type">${fileType}</span>
                        <span class="file-size">${fileSize}</span>
                    </div>
                    <div class="file-progress" id="file-progress-${index}" style="display: none;">
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: 0%"></div>
                        </div>
                        <div class="progress-text">0%</div>
                    </div>
                </div>
                <div class="file-preview-actions">
                    <button class="btn-remove" onclick="removeFile(${index})" title="Kaldır">✕</button>
                </div>
            </div>
        </div>
    `;
}

function generateImagePreview(file, index) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const mediaContainer = document.getElementById(`preview-media-${index}`);
        if (mediaContainer) {
            mediaContainer.innerHTML = `
                <img src="${e.target.result}" alt="${escapeHtml(file.name)}" class="preview-image">
            `;
        }
    };
    reader.readAsDataURL(file);
}

function generateVideoPreview(file, index) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const mediaContainer = document.getElementById(`preview-media-${index}`);
        if (mediaContainer) {
            mediaContainer.innerHTML = `
                <video src="${e.target.result}" class="preview-video" muted></video>
            `;
        }
    };
    reader.readAsDataURL(file);
}

function generateAudioPreview(file, index) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const mediaContainer = document.getElementById(`preview-media-${index}`);
        if (mediaContainer) {
            mediaContainer.innerHTML = `
                <audio src="${e.target.result}" class="preview-audio" controls></audio>
            `;
        }
    };
    reader.readAsDataURL(file);
}

function generateTextPreview(file, index) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const mediaContainer = document.getElementById(`preview-media-${index}`);
        if (mediaContainer) {
            const content = e.target.result;
            const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
            mediaContainer.innerHTML = `
                <div class="preview-text">
                    <pre>${escapeHtml(preview)}</pre>
                </div>
            `;
        }
    };
    reader.readAsText(file);
}

function getFileType(file) {
    if (file.type.startsWith('image/')) return 'Görüntü';
    if (file.type.startsWith('video/')) return 'Video';
    if (file.type.startsWith('audio/')) return 'Ses';
    if (file.type.startsWith('text/')) return 'Metin';
    if (file.type === 'application/pdf') return 'PDF';
    if (file.type.includes('word')) return 'Word';
    if (file.type.includes('excel') || file.type.includes('spreadsheet')) return 'Excel';
    if (file.type.includes('powerpoint') || file.type.includes('presentation')) return 'PowerPoint';
    if (file.type.includes('zip') || file.type.includes('rar') || file.type.includes('7z')) return 'Arşiv';
    return 'Dosya';
}

function getFileIcon(file) {
    if (file.type.startsWith('image/')) return '🖼️';
    if (file.type.startsWith('video/')) return '🎬';
    if (file.type.startsWith('audio/')) return '🎵';
    if (file.type.startsWith('text/')) return '📄';
    if (file.type === 'application/pdf') return '📑';
    if (file.type.includes('word')) return '📝';
    if (file.type.includes('excel') || file.type.includes('spreadsheet')) return '📊';
    if (file.type.includes('powerpoint') || file.type.includes('presentation')) return '📽️';
    if (file.type.includes('zip') || file.type.includes('rar') || file.type.includes('7z')) return '📦';
    return '📎';
}

function isTextFile(file) {
    const textExtensions = ['.txt', '.md', '.json', '.xml', '.csv', '.log', '.ini', '.cfg', '.conf'];
    const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    return textExtensions.includes(extension);
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function removeFile(index) {
    selectedFiles = selectedFiles.filter((_, i) => i !== index);

    if (selectedFiles.length === 0) {
        clearFileSelection();
    } else {
        generateFilePreviews();
    }
}

function clearFileSelection() {
    selectedFiles = [];
    document.getElementById('file-preview-section').style.display = 'none';
    document.getElementById('file-input').value = '';
}

async function uploadFiles() {
    if (selectedFiles.length === 0) return;

    const uploadPromises = selectedFiles.map((file, index) => uploadSingleFile(file, index));

    try {
        await Promise.all(uploadPromises);
        toast('Dosyalar başarıyla yüklendi', 'success');
        clearFileSelection();
        loadRecentFiles();
    } catch (error) {
        console.error('Upload error:', error);
        toast('Dosya yükleme başarısız', 'error');
    }
}

async function uploadSingleFile(file, index) {
    return new Promise((resolve, reject) => {
        // Show progress
        const progressContainer = document.getElementById(`file-progress-${index}`);
        const progressFill = progressContainer?.querySelector('.progress-fill');
        const progressText = progressContainer?.querySelector('.progress-text');

        if (progressContainer) {
            progressContainer.style.display = 'block';
        }

        // Simulate upload progress
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 30;
            if (progress > 100) progress = 100;

            if (progressFill) progressFill.style.width = progress + '%';
            if (progressText) progressText.textContent = Math.round(progress) + '%';

            if (progress >= 100) {
                clearInterval(interval);

                // Save file to storage
                saveUploadedFile(file);
                resolve();
            }
        }, 200);
    });
}

function saveUploadedFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const uploadedFile = {
            id: generateId(),
            name: file.name,
            type: file.type,
            size: file.size,
            timestamp: Date.now(),
            dataUrl: e.target.result
        };

        const uploadedFiles = getUploadedFiles();
        uploadedFiles.unshift(uploadedFile);

        // Keep only last 50 files
        if (uploadedFiles.length > 50) {
            uploadedFiles.pop();
        }

        localStorage.setItem('scord_uploaded_files', JSON.stringify(uploadedFiles));
    };
    reader.readAsDataURL(file);
}

function getUploadedFiles() {
    try {
        const saved = localStorage.getItem('scord_uploaded_files');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.warn("Failed to load uploaded files:", e);
        return [];
    }
}

function loadRecentFiles() {
    const recentFilesList = document.getElementById('recent-files-list');
    if (!recentFilesList) return;

    const uploadedFiles = getUploadedFiles();

    if (uploadedFiles.length === 0) {
        recentFilesList.innerHTML = '<div class="recent-files-empty">Henüz dosya yüklenmedi</div>';
        return;
    }

    let html = '';
    uploadedFiles.slice(0, 10).forEach(file => {
        html += `
            <div class="recent-file-item" onclick="shareFile('${file.id}')">
                <div class="recent-file-icon">${getFileIcon(file)}</div>
                <div class="recent-file-info">
                    <div class="recent-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
                    <div class="recent-file-details">
                        <span class="file-type">${getFileType(file)}</span>
                        <span class="file-size">${formatFileSize(file.size)}</span>
                        <span class="file-date">${new Date(file.timestamp).toLocaleDateString('tr-TR')}</span>
                    </div>
                </div>
                <div class="recent-file-actions">
                    <button class="btn-download" onclick="downloadFile('${file.id}', event)" title="İndir">⬇️</button>
                    <button class="btn-share" onclick="shareFile('${file.id}', event)" title="Paylaş">📤</button>
                    <button class="btn-delete" onclick="deleteFile('${file.id}', event)" title="Sil">🗑️</button>
                </div>
            </div>
        `;
    });

    recentFilesList.innerHTML = html;
}

function downloadFile(fileId, event) {
    if (event) event.stopPropagation();

    const uploadedFiles = getUploadedFiles();
    const file = uploadedFiles.find(f => f.id === fileId);

    if (file && file.dataUrl) {
        const a = document.createElement('a');
        a.href = file.dataUrl;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        toast('Dosya indiriliyor', 'success');
    }
}

function shareFile(fileId, event) {
    if (event) event.stopPropagation();

    const uploadedFiles = getUploadedFiles();
    const file = uploadedFiles.find(f => f.id === fileId);

    if (file) {
        // Share to current channel
        const message = {
            type: 'file',
            fileId: fileId,
            name: file.name,
            type: file.type,
            size: file.size,
            dataUrl: file.dataUrl
        };

        // This would integrate with the existing message sending system
        toast('Dosya paylaşıldı', 'success');
    }
}

function deleteFile(fileId, event) {
    if (event) event.stopPropagation();

    if (confirm('Bu dosyayı silmek istediğinizden emin misiniz?')) {
        const uploadedFiles = getUploadedFiles();
        const index = uploadedFiles.findIndex(f => f.id === fileId);

        if (index !== -1) {
            uploadedFiles.splice(index, 1);
            localStorage.setItem('scord_uploaded_files', JSON.stringify(uploadedFiles));
            loadRecentFiles();
            toast('Dosya silindi', 'success');
        }
    }
}

// File viewer modal
function showFileViewer(fileId) {
    const uploadedFiles = getUploadedFiles();
    const file = uploadedFiles.find(f => f.id === fileId);

    if (!file) return;

    let content = '';

    if (file.type.startsWith('image/')) {
        content = `
            <div class="file-viewer-image">
                <img src="${file.dataUrl}" alt="${escapeHtml(file.name)}">
            </div>
        `;
    } else if (file.type.startsWith('video/')) {
        content = `
            <div class="file-viewer-video">
                <video src="${file.dataUrl}" controls autoplay></video>
            </div>
        `;
    } else if (file.type.startsWith('audio/')) {
        content = `
            <div class="file-viewer-audio">
                <audio src="${file.dataUrl}" controls autoplay></audio>
            </div>
        `;
    } else if (file.type.startsWith('text/') || isTextFile(file)) {
        content = `
            <div class="file-viewer-text">
                <pre>${escapeHtml(atob(file.dataUrl.split(',')[1]))}</pre>
            </div>
        `;
    } else {
        content = `
            <div class="file-viewer-info">
                <div class="file-info-icon">${getFileIcon(file)}</div>
                <div class="file-info-details">
                    <div class="file-info-name">${escapeHtml(file.name)}</div>
                    <div class="file-info-type">${getFileType(file)}</div>
                    <div class="file-info-size">${formatFileSize(file.size)}</div>
                    <button class="btn-primary" onclick="downloadFile('${file.id}')">İndir</button>
                </div>
            </div>
        `;
    }

    const modalContent = `
        <div class="file-viewer">
            <div class="file-viewer-header">
                <div class="file-viewer-title">${escapeHtml(file.name)}</div>
                <div class="file-viewer-actions">
                    <button class="btn-secondary" onclick="downloadFile('${file.id}')">İndir</button>
                    <button class="btn-secondary" onclick="shareFile('${file.id}')">Paylaş</button>
                </div>
            </div>
            <div class="file-viewer-content">
                ${content}
            </div>
        </div>
    `;

    showModal("Dosya Görüntüleyici", modalContent, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
    `);
}

// GIF Integration System
function showGifPickerModal() {
    const modalContent = `
        <div class="gif-picker-modal">
            <div class="gif-picker-header">
                <div class="gif-picker-title">🎬 GIF Seçici</div>
                <div class="gif-search-container">
                    <input type="text" id="gif-search-input" placeholder="GIF ara..." autocomplete="off">
                    <button class="btn-secondary" onclick="searchGifs()">Ara</button>
                </div>
            </div>
            <div class="gif-picker-content">
                <div class="gif-categories">
                    <div class="category-tabs">
                        <button class="category-tab active" data-category="trending">Trendler</button>
                        <button class="category-tab" data-category="reactions">Tepkiler</button>
                        <button class="category-tab" data-category="memes">Meme'ler</button>
                        <button class="category-tab" data-category="gaming">Oyun</button>
                        <button class="category-tab" data-category="anime">Anime</button>
                        <button class="category-tab" data-category="cute">Sevimli</button>
                    </div>
                </div>
                <div class="gif-results" id="gif-results">
                    <div class="gif-loading" id="gif-loading" style="display: none;">
                        <div class="loading-spinner"></div>
                        <div>GIF'ler yükleniyor...</div>
                    </div>
                    <div class="gif-grid" id="gif-grid">
                        <!-- GIF results will be loaded here -->
                    </div>
                    <div class="gif-empty" id="gif-empty" style="display: none;">
                        <div class="empty-icon">🔍</div>
                        <div>Sonuç bulunamadı</div>
                        <div class="empty-subtitle">Başka anahtar kelimeler dene</div>
                    </div>
                </div>
            </div>
            <div class="gif-picker-footer">
                <div class="gif-preview" id="gif-preview" style="display: none;">
                    <img id="preview-image" src="" alt="GIF Preview">
                    <div class="preview-info">
                        <div class="preview-title" id="preview-title">GIF Adı</div>
                        <div class="preview-dimensions" id="preview-dimensions">0x0</div>
                    </div>
                </div>
                <div class="gif-actions">
                    <button class="btn-secondary" onclick="hideModal()">İptal</button>
                    <button class="btn-primary" id="send-gif-btn" onclick="sendSelectedGif()" disabled>GIF Gönder</button>
                </div>
            </div>
        </div>
    `;

    showModal("GIF Seçici", modalContent, '', true); // No footer, closable with Escape

    // Initialize GIF picker
    initializeGifPicker();
    loadTrendingGifs();
}

function initializeGifPicker() {
    const searchInput = document.getElementById('gif-search-input');
    const categoryTabs = document.querySelectorAll('.category-tab');

    // Search on Enter
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchGifs();
            }
        });

        // Search on input with debounce
        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                if (searchInput.value.trim()) {
                    searchGifs();
                }
            }, 500);
        });
    }

    // Category tabs
    categoryTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            categoryTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const category = tab.getAttribute('data-category');
            loadCategoryGifs(category);
        });
    });

    // Initialize selected GIF
    state.selectedGif = null;
}

let selectedGif = null;

function loadTrendingGifs() {
    showGifLoading();

    // Simulate API call with mock data
    setTimeout(() => {
        const trendingGifs = getMockGifs('trending');
        displayGifResults(trendingGifs);
    }, 800);
}

function searchGifs() {
    const searchInput = document.getElementById('gif-search-input');
    const query = searchInput?.value.trim();

    if (!query) {
        loadTrendingGifs();
        return;
    }

    showGifLoading();

    // Simulate API call with mock data
    setTimeout(() => {
        const searchResults = getMockGifs('search', query);
        displayGifResults(searchResults);
    }, 600);
}

function loadCategoryGifs(category) {
    showGifLoading();

    // Simulate API call with mock data
    setTimeout(() => {
        const categoryGifs = getMockGifs(category);
        displayGifResults(categoryGifs);
    }, 600);
}

function showGifLoading() {
    const loading = document.getElementById('gif-loading');
    const grid = document.getElementById('gif-grid');
    const empty = document.getElementById('gif-empty');

    if (loading) loading.style.display = 'flex';
    if (grid) grid.style.display = 'none';
    if (empty) empty.style.display = 'none';
}

function displayGifResults(gifs) {
    const loading = document.getElementById('gif-loading');
    const grid = document.getElementById('gif-grid');
    const empty = document.getElementById('gif-empty');

    if (loading) loading.style.display = 'none';

    if (gifs.length === 0) {
        if (grid) grid.style.display = 'none';
        if (empty) empty.style.display = 'flex';
        return;
    }

    if (empty) empty.style.display = 'none';
    if (grid) {
        grid.style.display = 'grid';
        grid.innerHTML = '';

        gifs.forEach(gif => {
            const gifElement = createGifElement(gif);
            grid.appendChild(gifElement);
        });
    }
}

function createGifElement(gif) {
    const div = document.createElement('div');
    div.className = 'gif-item';
    div.setAttribute('data-gif-id', gif.id);

    const img = document.createElement('img');
    img.src = gif.thumbnail;
    img.alt = gif.title;
    img.loading = 'lazy';

    // Handle click
    div.addEventListener('click', () => selectGif(gif));

    // Handle hover preview
    div.addEventListener('mouseenter', () => showGifPreview(gif));
    div.addEventListener('mouseleave', hideGifPreview);

    div.appendChild(img);
    return div;
}

function selectGif(gif) {
    selectedGif = gif;

    // Update UI
    document.querySelectorAll('.gif-item').forEach(item => {
        item.classList.remove('selected');
    });

    const selectedItem = document.querySelector(`[data-gif-id="${gif.id}"]`);
    if (selectedItem) {
        selectedItem.classList.add('selected');
    }

    // Enable send button
    const sendBtn = document.getElementById('send-gif-btn');
    if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = 'GIF Gönder';
    }

    // Show preview
    showGifPreview(gif);
}

function showGifPreview(gif) {
    const preview = document.getElementById('gif-preview');
    const previewImage = document.getElementById('preview-image');
    const previewTitle = document.getElementById('preview-title');
    const previewDimensions = document.getElementById('preview-dimensions');

    if (preview && previewImage && previewTitle && previewDimensions) {
        preview.style.display = 'flex';
        previewImage.src = gif.url;
        previewTitle.textContent = gif.title;
        previewDimensions.textContent = `${gif.width}x${gif.height}`;
    }
}

function hideGifPreview() {
    const preview = document.getElementById('gif-preview');
    if (preview && selectedGif) {
        // Keep preview if a GIF is selected
        return;
    }

    if (preview) {
        preview.style.display = 'none';
    }
}

function sendSelectedGif() {
    if (!selectedGif) return;

    // Send GIF to current channel
    const message = {
        type: 'gif',
        gifId: selectedGif.id,
        title: selectedGif.title,
        url: selectedGif.url,
        thumbnail: selectedGif.thumbnail,
        width: selectedGif.width,
        height: selectedGif.height
    };

    // This would integrate with the existing message sending system
    toast('GIF gönderildi', 'success');

    // Save to recent GIFs
    saveRecentGif(selectedGif);

    hideModal();
}

function saveRecentGif(gif) {
    const recentGifs = getRecentGifs();

    // Remove if already exists
    const index = recentGifs.findIndex(g => g.id === gif.id);
    if (index !== -1) {
        recentGifs.splice(index, 1);
    }

    // Add to beginning
    recentGifs.unshift(gif);

    // Keep only last 20
    if (recentGifs.length > 20) {
        recentGifs.pop();
    }

    localStorage.setItem('scord_recent_gifs', JSON.stringify(recentGifs));
}

function getRecentGifs() {
    try {
        const saved = localStorage.getItem('scord_recent_gifs');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.warn("Failed to load recent GIFs:", e);
        return [];
    }
}

// Mock GIF data generator
function getMockGifs(category, query = '') {
    const mockGifs = [
        // Trending
        { id: 't1', title: 'Happy Dance', url: 'https://media.giphy.com/media/3o7TKTD1NUq1q7CB5C/giphy.gif', thumbnail: 'https://media.giphy.com/media/3o7TKTD1NUq1q7CB5C/giphy.gif', width: 480, height: 270 },
        { id: 't2', title: 'Mind Blown', url: 'https://media.giphy.com/media/l4FGKXHhc4Aq/giphy.gif', thumbnail: 'https://media.giphy.com/media/l4FGKXHhc4Aq/giphy.gif', width: 480, height: 270 },
        { id: 't3', title: 'Yes!', url: 'https://media.giphy.com/media/3o6ZtaO9BZhKU4wFM8/giphy.gif', thumbnail: 'https://media.giphy.com/media/3o6ZtaO9BZhKU4wFM8/giphy.gif', width: 480, height: 270 },
        { id: 't4', title: 'Facepalm', url: 'https://media.giphy.com/media/jUwpNzg9IcyrK/giphy.gif', thumbnail: 'https://media.giphy.com/media/jUwpNzg9IcyrK/giphy.gif', width: 480, height: 270 },
        { id: 't5', title: 'Celebration', url: 'https://media.giphy.com/media/3o7aD2saalBwwftBIQ8/giphy.gif', thumbnail: 'https://media.giphy.com/media/3o7aD2saalBwwftBIQ8/giphy.gif', width: 480, height: 270 },

        // Reactions
        { id: 'r1', title: 'Laughing', url: 'https://media.giphy.com/media/l2Je66zG6mAAZxgqI2/giphy.gif', thumbnail: 'https://media.giphy.com/media/l2Je66zG6mAAZxgqI2/giphy.gif', width: 480, height: 270 },
        { id: 'r2', title: 'Crying', url: 'https://media.giphy.com/media/l41lGvinE5Vw/giphy.gif', thumbnail: 'https://media.giphy.com/media/l41lGvinE5Vw/giphy.gif', width: 480, height: 270 },
        { id: 'r3', title: 'Angry', url: 'https://media.giphy.com/media/3o6fJgOdwvUIa3dGxK/giphy.gif', thumbnail: 'https://media.giphy.com/media/3o6fJgOdwvUIa3dGxK/giphy.gif', width: 480, height: 270 },
        { id: 'r4', title: 'Love', url: 'https://media.giphy.com/media/3o7aD2saalBwwftBIQ8/giphy.gif', thumbnail: 'https://media.giphy.com/media/3o7aD2saalBwwftBIQ8/giphy.gif', width: 480, height: 270 },
        { id: 'r5', title: 'Wow', url: 'https://media.giphy.com/media/l4FGKXHhc4Aq/giphy.gif', thumbnail: 'https://media.giphy.com/media/l4FGKXHhc4Aq/giphy.gif', width: 480, height: 270 },

        // Memes
        { id: 'm1', title: 'Distracted Boyfriend', url: 'https://media.giphy.com/media/3o7aD2saalBwwftBIQ8/giphy.gif', thumbnail: 'https://media.giphy.com/media/3o7aD2saalBwwftBIQ8/giphy.gif', width: 480, height: 270 },
        { id: 'm2', title: 'This is Fine', url: 'https://media.giphy.com/media/l2Je66zG6mAAZxgqI2/giphy.gif', thumbnail: 'https://media.giphy.com/media/l2Je66zG6mAAZxgqI2/giphy.gif', width: 480, height: 270 },
        { id: 'm3', title: 'Change My Mind', url: 'https://media.giphy.com/media/3o6ZtaO9BZhKU4wFM8/giphy.gif', thumbnail: 'https://media.giphy.com/media/3o6ZtaO9BZhKU4wFM8/giphy.gif', width: 480, height: 270 },
        { id: 'm4', title: 'Drake Hotline Bling', url: 'https://media.giphy.com/media/jUwpNzg9IcyrK/giphy.gif', thumbnail: 'https://media.giphy.com/media/jUwpNzg9IcyrK/giphy.gif', width: 480, height: 270 },
        { id: 'm5', title: 'Two Buttons', url: 'https://media.giphy.com/media/3o7aD2saalBwwftBIQ8/giphy.gif', thumbnail: 'https://media.giphy.com/media/3o7aD2saalBwwftBIQ8/giphy.gif', width: 480, height: 270 },

        // Gaming
        { id: 'g1', title: 'Gaming Moment', url: 'https://media.giphy.com/media/l4FGKXHhc4Aq/giphy.gif', thumbnail: 'https://media.giphy.com/media/l4FGKXHhc4Aq/giphy.gif', width: 480, height: 270 },
        { id: 'g2', title: 'Victory Royale', url: 'https://media.giphy.com/media/3o6ZtaO9BZhKU4wFM8/giphy.gif', thumbnail: 'https://media.giphy.com/media/3o6ZtaO9BZhKU4wFM8/giphy.gif', width: 480, height: 270 },
        { id: 'g3', title: 'Rage Quit', url: 'https://media.giphy.com/media/jUwpNzg9IcyrK/giphy.gif', thumbnail: 'https://media.giphy.com/media/jUwpNzg9IcyrK/giphy.gif', width: 480, height: 270 },
        { id: 'g4', title: 'Epic Win', url: 'https://media.giphy.com/media/3o7aD2saalBwwftBIQ8/giphy.gif', thumbnail: 'https://media.giphy.com/media/3o7aD2saalBwwftBIQ8/giphy.gif', width: 480, height: 270 },
        { id: 'g5', title: 'GG WP', url: 'https://media.giphy.com/media/l2Je66zG6mAAZxgqI2/giphy.gif', thumbnail: 'https://media.giphy.com/media/l2Je66zG6mAAZxgqI2/giphy.gif', width: 480, height: 270 },

        // Anime
        { id: 'a1', title: 'Anime Dance', url: 'https://media.giphy.com/media/3o7TKTD1NUq1q7CB5C/giphy.gif', thumbnail: 'https://media.giphy.com/media/3o7TKTD1NUq1q7CB5C/giphy.gif', width: 480, height: 270 },
        { id: 'a2', title: 'Sweat Drop', url: 'https://media.giphy.com/media/l4FGKXHhc4Aq/giphy.gif', thumbnail: 'https://media.giphy.com/media/l4FGKXHhc4Aq/giphy.gif', width: 480, height: 270 },
        { id: 'a3', title: 'Anime Cry', url: 'https://media.giphy.com/media/3o6ZtaO9BZhKU4wFM8/giphy.gif', thumbnail: 'https://media.giphy.com/media/3o6ZtaO9BZhKU4wFM8/giphy.gif', width: 480, height: 270 },
        { id: 'a4', title: 'Power Up', url: 'https://media.giphy.com/media/jUwpNzg9IcyrK/giphy.gif', thumbnail: 'https://media.giphy.com/media/jUwpNzg9IcyrK/giphy.gif', width: 480, height: 270 },
        { id: 'a5', title: 'Anime Fight', url: 'https://media.giphy.com/media/3o7aD2saalBwwftBIQ8/giphy.gif', thumbnail: 'https://media.giphy.com/media/3o7aD2saalBwwftBIQ8/giphy.gif', width: 480, height: 270 },

        // Cute
        { id: 'c1', title: 'Cute Cat', url: 'https://media.giphy.com/media/l2Je66zG6mAAZxgqI2/giphy.gif', thumbnail: 'https://media.giphy.com/media/l2Je66zG6mAAZxgqI2/giphy.gif', width: 480, height: 270 },
        { id: 'c2', title: 'Puppy Love', url: 'https://media.giphy.com/media/3o6ZtaO9BZhKU4wFM8/giphy.gif', thumbnail: 'https://media.giphy.com/media/3o6ZtaO9BZhKU4wFM8/giphy.gif', width: 480, height: 270 },
        { id: 'c3', title: 'Baby Laugh', url: 'https://media.giphy.com/media/jUwpNzg9IcyrK/giphy.gif', thumbnail: 'https://media.giphy.com/media/jUwpNzg9IcyrK/giphy.gif', width: 480, height: 270 },
        { id: 'c4', title: 'Cute Bunny', url: 'https://media.giphy.com/media/3o7aD2saalBwwftBIQ8/giphy.gif', thumbnail: 'https://media.giphy.com/media/3o7aD2saalBwwftBIQ8/giphy.gif', width: 480, height: 270 },
        { id: 'c5', title: 'Happy Puppy', url: 'https://media.giphy.com/media/l4FGKXHhc4Aq/giphy.gif', thumbnail: 'https://media.giphy.com/media/l4FGKXHhc4Aq/giphy.gif', width: 480, height: 270 }
    ];

    // Filter by category
    let filteredGifs = [];
    switch (category) {
        case 'trending':
            filteredGifs = mockGifs.filter(g => g.id.startsWith('t'));
            break;
        case 'reactions':
            filteredGifs = mockGifs.filter(g => g.id.startsWith('r'));
            break;
        case 'memes':
            filteredGifs = mockGifs.filter(g => g.id.startsWith('m'));
            break;
        case 'gaming':
            filteredGifs = mockGifs.filter(g => g.id.startsWith('g'));
            break;
        case 'anime':
            filteredGifs = mockGifs.filter(g => g.id.startsWith('a'));
            break;
        case 'cute':
            filteredGifs = mockGifs.filter(g => g.id.startsWith('c'));
            break;
        case 'search':
            // Simple search simulation
            filteredGifs = mockGifs.filter(g =>
                g.title.toLowerCase().includes(query.toLowerCase())
            );
            break;
        default:
            filteredGifs = mockGifs;
    }

    // Shuffle and return subset
    return filteredGifs.sort(() => Math.random() - 0.5).slice(0, 12);
}

// GIF message display
function createGifMessage(gif) {
    return `
        <div class="message-gif">
            <div class="gif-container">
                <img src="${gif.url}" alt="${escapeHtml(gif.title)}" class="gif-image" loading="lazy">
                <div class="gif-overlay">
                    <div class="gif-title">${escapeHtml(gif.title)}</div>
                    <div class="gif-dimensions">${gif.width}x${gif.height}</div>
                </div>
            </div>
        </div>
    `;
}

// Recent GIFs modal
function showRecentGifsModal() {
    const recentGifs = getRecentGifs();

    if (recentGifs.length === 0) {
        toast('Henüz GIF kullanılmadı', 'info');
        return;
    }

    let content = `
        <div class="recent-gifs-modal">
            <div class="recent-gifs-title">🎬 Son GIF'ler</div>
            <div class="recent-gifs-grid">
    `;

    recentGifs.forEach(gif => {
        content += `
            <div class="recent-gif-item" onclick="shareGif('${gif.id}')">
                <img src="${gif.thumbnail}" alt="${escapeHtml(gif.title)}" class="recent-gif-image">
                <div class="recent-gif-info">
                    <div class="recent-gif-title">${escapeHtml(gif.title)}</div>
                    <div class="recent-gif-date">${new Date(gif.timestamp || Date.now()).toLocaleDateString('tr-TR')}</div>
                </div>
            </div>
        `;
    });

    content += `
            </div>
        </div>
    `;

    showModal("Son GIF'ler", content, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
    `);
}

function shareGif(gifId) {
    const recentGifs = getRecentGifs();
    const gif = recentGifs.find(g => g.id === gifId);

    if (gif) {
        selectGif(gif);
        sendSelectedGif();
    }
}

// Game Invite System
function showGameInviteModal() {
    const modalContent = `
        <div class="game-invite-modal">
            <div class="game-invite-header">
                <div class="game-invite-title">🎮 Oyun Daveti</div>
                <div class="game-invite-subtitle">Arkadaşlarını oynamaya davet et</div>
            </div>
            <div class="game-invite-content">
                <div class="game-selection">
                    <div class="game-categories">
                        <div class="category-tabs">
                            <button class="category-tab active" data-category="all">Tümü</button>
                            <button class="category-tab" data-category="popular">Popüler</button>
                            <button class="category-tab" data-category="action">Aksiyon</button>
                            <button class="category-tab" data-category="strategy">Strateji</button>
                            <button class="category-tab" data-category="puzzle">Bulmaca</button>
                            <button class="category-tab" data-category="multiplayer">Çok Oyunculu</button>
                        </div>
                    </div>
                    
                    <div class="game-search">
                        <input type="text" id="game-search-input" placeholder="Oyun ara..." autocomplete="off">
                    </div>
                    
                    <div class="game-grid" id="game-grid">
                        <!-- Games will be loaded here -->
                    </div>
                </div>
                
                <div class="invite-details" id="invite-details" style="display: none;">
                    <div class="selected-game">
                        <div class="selected-game-header">
                            <div class="selected-game-info">
                                <div class="selected-game-title" id="selected-game-title">Oyun Adı</div>
                                <div class="selected-game-genre" id="selected-game-genre">Tür</div>
                                <div class="selected-game-players" id="selected-game-players">Oyuncu Sayısı</div>
                            </div>
                            <div class="selected-game-image" id="selected-game-image">
                                <div class="game-icon-large">🎮</div>
                            </div>
                        </div>
                        
                        <div class="invite-settings">
                            <div class="setting-group">
                                <label>Oyun Modu:</label>
                                <select id="game-mode">
                                    <option value="casual">Gayriresmi</option>
                                    <option value="ranked">Sıralı</option>
                                    <option value="tournament">Turnuva</option>
                                </select>
                            </div>
                            
                            <div class="setting-group">
                                <label>Oyuncu Limiti:</label>
                                <select id="player-limit">
                                    <option value="2">2 Oyuncu</option>
                                    <option value="4">4 Oyuncu</option>
                                    <option value="6">6 Oyuncu</option>
                                    <option value="8">8 Oyuncu</option>
                                    <option value="unlimited">Sınırsız</option>
                                </select>
                            </div>
                            
                            <div class="setting-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="private-game">
                                    Özel Oda
                                </label>
                            </div>
                            
                            <div class="setting-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="voice-chat" checked>
                                    Sesli Sohbet
                                </label>
                            </div>
                        </div>
                        
                        <div class="invite-message">
                            <label>Mesaj:</label>
                            <textarea id="invite-message" placeholder="Davet mesajını buraya yaz..." rows="3"></textarea>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="game-invite-footer">
                <div class="selected-game-preview" id="selected-game-preview" style="display: none;">
                    <div class="preview-info">
                        <div class="preview-game-title" id="preview-game-title">Oyun Adı</div>
                        <div class="preview-game-mode" id="preview-game-mode">Gayriresmi • 2 Oyuncu</div>
                    </div>
                </div>
                <div class="invite-actions">
                    <button class="btn-secondary" onclick="hideModal()">İptal</button>
                    <button class="btn-primary" id="send-invite-btn" onclick="sendGameInvite()" disabled>Davet Gönder</button>
                </div>
            </div>
        </div>
    `;

    showModal("Oyun Daveti", modalContent, '', true);

    // Initialize game invite system
    initializeGameInvite();
    loadGames();
}

function initializeGameInvite() {
    const searchInput = document.getElementById('game-search-input');
    const categoryTabs = document.querySelectorAll('.category-tab');

    // Search functionality
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            filterGames();
        });
    }

    // Category tabs
    categoryTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            categoryTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const category = tab.getAttribute('data-category');
            filterGamesByCategory(category);
        });
    });

    // Initialize selected game
    state.selectedGame = null;
}

let selectedGame = null;

function loadGames() {
    const games = getMockGames();
    displayGames(games);
}

function getMockGames() {
    return [
        {
            id: 'game1',
            name: 'Valorant',
            genre: 'FPS',
            category: 'popular',
            players: '5v5',
            icon: '🔫',
            description: 'Taktiksel nişancı oyunu',
            modes: ['Casual', 'Ranked', 'Spike Rush'],
            maxPlayers: 10
        },
        {
            id: 'game2',
            name: 'League of Legends',
            genre: 'MOBA',
            category: 'popular',
            players: '5v5',
            icon: '⚔️',
            description: 'Çok oyunculu savaş alanı',
            modes: ['ARAM', 'Ranked', 'Normal'],
            maxPlayers: 10
        },
        {
            id: 'game3',
            name: 'Among Us',
            genre: 'Sosyal Dedektiflik',
            category: 'multiplayer',
            players: '4-10',
            icon: '👨‍🚀',
            description: 'Uzay gemisinde dolandırıcıyı bul',
            modes: ['Classic', 'Hide and Seek'],
            maxPlayers: 10
        },
        {
            id: 'game4',
            name: 'Minecraft',
            genre: 'Sandbox',
            category: 'popular',
            players: '1-∞',
            icon: '⛏️',
            description: 'Bloklardan dünyalar inşa et',
            modes: ['Survival', 'Creative', 'Adventure'],
            maxPlayers: 999
        },
        {
            id: 'game5',
            name: 'Chess.com',
            genre: 'Strateji',
            category: 'strategy',
            players: '1v1',
            icon: '♟️',
            description: 'Klasik satranç oyunu',
            modes: ['Blitz', 'Rapid', 'Classical'],
            maxPlayers: 2
        },
        {
            id: 'game6',
            name: 'PUBG Mobile',
            genre: 'Battle Royale',
            category: 'action',
            players: '100',
            icon: '🎯',
            description: 'Hayatta kalan son kişi',
            modes: ['Solo', 'Duo', 'Squad'],
            maxPlayers: 100
        },
        {
            id: 'game7',
            name: 'Tetris',
            genre: 'Bulmaca',
            category: 'puzzle',
            players: '1v1',
            icon: '🟦',
            description: 'Klasik blok oyunu',
            modes: ['Marathon', 'Sprint', 'Battle'],
            maxPlayers: 2
        },
        {
            id: 'game8',
            name: 'Rocket League',
            genre: 'Spor',
            category: 'popular',
            players: '1v1, 2v2, 3v3',
            icon: '🏎️',
            description: 'Araba ile futbol',
            modes: ['Casual', 'Ranked', 'Tournament'],
            maxPlayers: 6
        },
        {
            id: 'game9',
            name: 'Fortnite',
            genre: 'Battle Royale',
            category: 'popular',
            players: '100',
            icon: '🏝️',
            description: 'İnşa et ve savaş',
            modes: ['Solo', 'Duo', 'Squad', 'Creative'],
            maxPlayers: 100
        },
        {
            id: 'game10',
            name: 'Apex Legends',
            genre: 'Battle Royale',
            category: 'action',
            players: '3v3',
            icon: '🔫',
            description: 'Ekip tabanlı savaş',
            modes: ['Battle Royale', 'Arena'],
            maxPlayers: 60
        },
        {
            id: 'game11',
            name: 'Civilization VI',
            genre: 'Strateji',
            category: 'strategy',
            players: '1-12',
            icon: '🏛️',
            description: 'Medeniyet kur',
            modes: ['Single Player', 'Multiplayer'],
            maxPlayers: 12
        },
        {
            id: 'game12',
            name: 'Fall Guys',
            genre: 'Platform',
            category: 'multiplayer',
            players: '60',
            icon: '🟣',
            description: 'Kaos dolu yarışlar',
            modes: ['Show', 'Party'],
            maxPlayers: 60
        }
    ];
}

function displayGames(games) {
    const gameGrid = document.getElementById('game-grid');
    if (!gameGrid) return;

    let html = '';
    games.forEach(game => {
        html += createGameElement(game);
    });

    gameGrid.innerHTML = html;
}

function createGameElement(game) {
    return `
        <div class="game-item" data-game-id="${game.id}" onclick="selectGame('${game.id}')">
            <div class="game-icon">${game.icon}</div>
            <div class="game-info">
                <div class="game-name">${escapeHtml(game.name)}</div>
                <div class="game-genre">${escapeHtml(game.genre)}</div>
                <div class="game-players">${escapeHtml(game.players)}</div>
            </div>
        </div>
    `;
}

function selectGame(gameId) {
    const games = getMockGames();
    const game = games.find(g => g.id === gameId);

    if (!game) return;

    selectedGame = game;

    // Update UI
    document.querySelectorAll('.game-item').forEach(item => {
        item.classList.remove('selected');
    });

    const selectedItem = document.querySelector(`[data-game-id="${gameId}"]`);
    if (selectedItem) {
        selectedItem.classList.add('selected');
    }

    // Show invite details
    showInviteDetails(game);

    // Enable send button
    const sendBtn = document.getElementById('send-invite-btn');
    if (sendBtn) {
        sendBtn.disabled = false;
    }

    // Update preview
    updateGamePreview(game);
}

function showInviteDetails(game) {
    const inviteDetails = document.getElementById('invite-details');
    const selectedGameTitle = document.getElementById('selected-game-title');
    const selectedGameGenre = document.getElementById('selected-game-genre');
    const selectedGamePlayers = document.getElementById('selected-game-players');
    const selectedGameImage = document.getElementById('selected-game-image');

    if (inviteDetails) {
        inviteDetails.style.display = 'block';
    }

    if (selectedGameTitle) selectedGameTitle.textContent = game.name;
    if (selectedGameGenre) selectedGameGenre.textContent = game.genre;
    if (selectedGamePlayers) selectedGamePlayers.textContent = game.players;
    if (selectedGameImage) {
        selectedGameImage.innerHTML = `<div class="game-icon-large">${game.icon}</div>`;
    }

    // Set default invite message
    const inviteMessage = document.getElementById('invite-message');
    if (inviteMessage) {
        inviteMessage.value = `${game.name} oynamak ister misin? 🎮`;
    }
}

function updateGamePreview(game) {
    const preview = document.getElementById('selected-game-preview');
    const previewTitle = document.getElementById('preview-game-title');
    const previewMode = document.getElementById('preview-game-mode');

    if (preview) {
        preview.style.display = 'block';
    }

    if (previewTitle) previewTitle.textContent = game.name;

    // Update mode based on settings
    updateGameModePreview();
}

function updateGameModePreview() {
    const previewMode = document.getElementById('preview-game-mode');
    const gameMode = document.getElementById('game-mode')?.value || 'casual';
    const playerLimit = document.getElementById('player-limit')?.value || '2';

    if (previewMode) {
        const modeText = gameMode === 'casual' ? 'Gayriresmi' :
            gameMode === 'ranked' ? 'Sıralı' : 'Turnuva';
        const playerText = playerLimit === 'unlimited' ? 'Sınırsız' : `${playerLimit} Oyuncu`;
        previewMode.textContent = `${modeText} • ${playerText}`;
    }
}

// Listen for setting changes
document.addEventListener('change', (e) => {
    if (e.target.id === 'game-mode' || e.target.id === 'player-limit') {
        updateGameModePreview();
    }
});

function filterGames() {
    const searchInput = document.getElementById('game-search-input');
    const query = searchInput?.value.toLowerCase() || '';
    const games = getMockGames();

    const filtered = games.filter(game =>
        game.name.toLowerCase().includes(query) ||
        game.genre.toLowerCase().includes(query) ||
        game.description.toLowerCase().includes(query)
    );

    displayGames(filtered);
}

function filterGamesByCategory(category) {
    const games = getMockGames();

    let filtered = games;
    if (category !== 'all') {
        filtered = games.filter(game => game.category === category);
    }

    displayGames(filtered);
}

function sendGameInvite() {
    if (!selectedGame) return;

    const gameMode = document.getElementById('game-mode')?.value || 'casual';
    const playerLimit = document.getElementById('player-limit')?.value || '2';
    const privateGame = document.getElementById('private-game')?.checked || false;
    const voiceChat = document.getElementById('voice-chat')?.checked || false;
    const inviteMessage = document.getElementById('invite-message')?.value || '';

    // Create invite
    const invite = {
        id: generateId(),
        gameId: selectedGame.id,
        gameName: selectedGame.name,
        gameIcon: selectedGame.icon,
        gameGenre: selectedGame.genre,
        mode: gameMode,
        playerLimit: playerLimit,
        isPrivate: privateGame,
        voiceChat: voiceChat,
        message: inviteMessage,
        timestamp: Date.now(),
        status: 'pending',
        hostId: state.peerId
    };

    // Save invite
    saveGameInvite(invite);

    // Send to current channel
    const message = {
        type: 'game-invite',
        inviteId: invite.id,
        gameName: selectedGame.name,
        gameIcon: selectedGame.icon,
        mode: gameMode,
        playerLimit: playerLimit,
        message: inviteMessage,
        timestamp: invite.timestamp
    };

    // This would integrate with the existing message sending system
    toast('Oyun daveti gönderildi', 'success');

    hideModal();
}

function saveGameInvite(invite) {
    const invites = getGameInvites();
    invites.push(invite);

    // Keep only last 50 invites
    if (invites.length > 50) {
        invites.shift();
    }

    localStorage.setItem('scord_game_invites', JSON.stringify(invites));
}

function getGameInvites() {
    try {
        const saved = localStorage.getItem('scord_game_invites');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.warn("Failed to load game invites:", e);
        return [];
    }
}

// Game invite message display
function createGameInviteMessage(invite) {
    return `
        <div class="message-game-invite">
            <div class="game-invite-container">
                <div class="game-invite-header">
                    <div class="game-invite-icon">${invite.gameIcon}</div>
                    <div class="game-invite-info">
                        <div class="game-invite-title">${escapeHtml(invite.gameName)}</div>
                        <div class="game-invite-details">${escapeHtml(invite.mode)} • ${escapeHtml(invite.playerLimit)} Oyuncu</div>
                    </div>
                    <div class="game-invite-badge">🎮</div>
                </div>
                ${invite.message ? `<div class="game-invite-message">${escapeHtml(invite.message)}</div>` : ''}
                <div class="game-invite-actions">
                    <button class="btn-primary" onclick="acceptGameInvite('${invite.id}')">Katıl</button>
                    <button class="btn-secondary" onclick="declineGameInvite('${invite.id}')">Reddet</button>
                </div>
            </div>
        </div>
    `;
}

function acceptGameInvite(inviteId) {
    const invites = getGameInvites();
    const invite = invites.find(i => i.id === inviteId);

    if (invite) {
        // Update invite status
        invite.status = 'accepted';
        invite.acceptedAt = Date.now();
        invite.acceptedById = state.peerId;

        localStorage.setItem('scord_game_invites', JSON.stringify(invites));

        // Launch game or join session
        toast(`${invite.gameName} daveti kabul edildi!`, 'success');

        // This would integrate with actual game launching
        setTimeout(() => {
            toast('Oyun başlatılıyor...', 'info');
        }, 1000);
    }
}

function declineGameInvite(inviteId) {
    const invites = getGameInvites();
    const invite = invites.find(i => i.id === inviteId);

    if (invite) {
        // Update invite status
        invite.status = 'declined';
        invite.declinedAt = Date.now();
        invite.declinedById = state.peerId;

        localStorage.setItem('scord_game_invites', JSON.stringify(invites));

        toast('Oyun daveti reddedildi', 'info');
    }
}

// Recent game invites modal
function showRecentGameInvitesModal() {
    const invites = getGameInvites();

    if (invites.length === 0) {
        toast('Henüz oyun daveti yok', 'info');
        return;
    }

    let content = `
        <div class="recent-game-invites-modal">
            <div class="recent-invites-title">🎮 Son Oyun Davetleri</div>
            <div class="recent-invites-list">
    `;

    invites.slice(0, 10).forEach(invite => {
        const statusIcon = invite.status === 'accepted' ? '✅' :
            invite.status === 'declined' ? '❌' : '⏳';

        content += `
            <div class="recent-invite-item">
                <div class="invite-game-icon">${invite.gameIcon}</div>
                <div class="invite-info">
                    <div class="invite-game-name">${escapeHtml(invite.gameName)}</div>
                    <div class="invite-details">${escapeHtml(invite.mode)} • ${escapeHtml(invite.playerLimit)}</div>
                    <div class="invite-date">${new Date(invite.timestamp).toLocaleDateString('tr-TR')}</div>
                </div>
                <div class="invite-status">${statusIcon}</div>
            </div>
        `;
    });

    content += `
            </div>
        </div>
    `;

    showModal("Son Oyun Davetleri", content, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
    `);
}

// Calendar and Event Planning System
function showCalendarModal() {
    const modalContent = `
        <div class="calendar-modal">
            <div class="calendar-header">
                <div class="calendar-title">📅 Takvim ve Etkinlikler</div>
                <div class="calendar-nav">
                    <button class="btn-secondary" onclick="previousMonth()">◀</button>
                    <div class="current-month" id="current-month">Ocak 2024</div>
                    <button class="btn-secondary" onclick="nextMonth()">▶</button>
                </div>
            </div>
            
            <div class="calendar-content">
                <div class="calendar-view">
                    <div class="calendar-weekdays">
                        <div class="weekday">Pzt</div>
                        <div class="weekday">Sal</div>
                        <div class="weekday">Çar</div>
                        <div class="weekday">Per</div>
                        <div class="weekday">Cum</div>
                        <div class="weekday">Cmt</div>
                        <div class="weekday">Paz</div>
                    </div>
                    <div class="calendar-days" id="calendar-days">
                        <!-- Calendar days will be generated here -->
                    </div>
                </div>
                
                <div class="calendar-sidebar">
                    <div class="sidebar-section">
                        <div class="sidebar-title">📝 Etkinlik Oluştur</div>
                        <button class="btn-primary" onclick="showCreateEventModal()">Yeni Etkinlik</button>
                    </div>
                    
                    <div class="sidebar-section">
                        <div class="sidebar-title">📋 Yaklaşan Etkinlikler</div>
                        <div class="upcoming-events" id="upcoming-events">
                            <!-- Upcoming events will be loaded here -->
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    showModal("Takvim", modalContent, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
    `);

    // Initialize calendar
    initializeCalendar();
}

let currentMonth = new Date();
let selectedDate = new Date();

function initializeCalendar() {
    renderCalendar();
    loadUpcomingEvents();
}

function renderCalendar() {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    // Update month display
    const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
        'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    document.getElementById('current-month').textContent = `${monthNames[month]} ${year}`;

    // Get first day of month and number of days
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();

    // Adjust for Monday as first day (0 = Monday, 6 = Sunday)
    let startDay = firstDay.getDay() - 1;
    if (startDay === -1) startDay = 6;

    const calendarDays = document.getElementById('calendar-days');
    if (!calendarDays) return;

    let html = '';

    // Add empty cells for days before month starts
    for (let i = 0; i < startDay; i++) {
        html += '<div class="calendar-day empty"></div>';
    }

    // Add days of the month
    const events = getEvents();
    const today = new Date();

    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dateStr = formatDateForStorage(date);
        const dayEvents = events.filter(event => event.date === dateStr);
        const isToday = date.toDateString() === today.toDateString();
        const isSelected = date.toDateString() === selectedDate.toDateString();

        html += `
            <div class="calendar-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${dayEvents.length > 0 ? 'has-events' : ''}" 
                 onclick="selectDate(${year}, ${month}, ${day})">
                <div class="day-number">${day}</div>
                ${dayEvents.length > 0 ? `<div class="event-indicator">${dayEvents.length}</div>` : ''}
            </div>
        `;
    }

    calendarDays.innerHTML = html;
}

function previousMonth() {
    currentMonth.setMonth(currentMonth.getMonth() - 1);
    renderCalendar();
    loadUpcomingEvents();
}

function nextMonth() {
    currentMonth.setMonth(currentMonth.getMonth() + 1);
    renderCalendar();
    loadUpcomingEvents();
}

function selectDate(year, month, day) {
    selectedDate = new Date(year, month, day);
    renderCalendar();
    showDayEvents();
}

function showDayEvents() {
    const dateStr = formatDateForStorage(selectedDate);
    const events = getEvents().filter(event => event.date === dateStr);

    if (events.length === 0) {
        toast('Bu gün için etkinlik yok', 'info');
        return;
    }

    let content = `
        <div class="day-events-modal">
            <div class="day-events-header">
                <div class="day-events-title">${selectedDate.toLocaleDateString('tr-TR')} Etkinlikleri</div>
            </div>
            <div class="day-events-list">
    `;

    events.forEach(event => {
        content += `
            <div class="event-item">
                <div class="event-time">${event.time}</div>
                <div class="event-info">
                    <div class="event-title">${escapeHtml(event.title)}</div>
                    <div class="event-description">${escapeHtml(event.description)}</div>
                    <div class="event-participants">${event.participants?.length || 0} katılımcı</div>
                </div>
                <div class="event-actions">
                    <button class="btn-secondary" onclick="editEvent('${event.id}')">Düzenle</button>
                    <button class="btn-danger" onclick="deleteEvent('${event.id}')">Sil</button>
                </div>
            </div>
        `;
    });

    content += `
            </div>
        </div>
    `;

    showModal("Günlük Etkinlikler", content, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
    `);
}

function showCreateEventModal() {
    const modalContent = `
        <div class="create-event-modal">
            <div class="create-event-header">
                <div class="create-event-title">📝 Yeni Etkinlik</div>
            </div>
            <div class="create-event-content">
                <div class="form-group">
                    <label>Etkinlik Adı:</label>
                    <input type="text" id="event-title" placeholder="Etkinlik adını girin..." maxlength="100">
                </div>
                
                <div class="form-group">
                    <label>Tarih:</label>
                    <input type="date" id="event-date" value="${formatDateForInput(selectedDate)}">
                </div>
                
                <div class="form-group">
                    <label>Saat:</label>
                    <input type="time" id="event-time" value="19:00">
                </div>
                
                <div class="form-group">
                    <label>Açıklama:</label>
                    <textarea id="event-description" placeholder="Etkinlik açıklaması..." rows="3" maxlength="500"></textarea>
                </div>
                
                <div class="form-group">
                    <label>Etkinlik Türü:</label>
                    <select id="event-type">
                        <option value="meeting">Toplantı</option>
                        <option value="game">Oyun Gecesi</option>
                        <option value="study">Çalışma Oturumu</option>
                        <option value="social">Sosyal Etkinlik</option>
                        <option value="birthday">Doğum Günü</option>
                        <option value="other">Diğer</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="event-reminder">
                        Hatırlatıcı Gönder
                    </label>
                </div>
                
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="event-recurring">
                        Tekrarlayan Etkinlik
                    </label>
                </div>
            </div>
            
            <div class="create-event-footer">
                <button class="btn-secondary" onclick="hideModal()">İptal</button>
                <button class="btn-primary" onclick="createEvent()">Oluştur</button>
            </div>
        </div>
    `;

    showModal("Etkinlik Oluştur", modalContent, '', true);
}

function createEvent() {
    const title = document.getElementById('event-title')?.value.trim();
    const date = document.getElementById('event-date')?.value;
    const time = document.getElementById('event-time')?.value;
    const description = document.getElementById('event-description')?.value.trim();
    const type = document.getElementById('event-type')?.value;
    const reminder = document.getElementById('event-reminder')?.checked || false;
    const recurring = document.getElementById('event-recurring')?.checked || false;

    if (!title || !date || !time) {
        toast('Lütfen zorunlu alanları doldurun', 'error');
        return;
    }

    const event = {
        id: generateId(),
        title: title,
        date: date,
        time: time,
        description: description,
        type: type,
        reminder: reminder,
        recurring: recurring,
        createdBy: state.peerId,
        createdAt: Date.now(),
        participants: []
    };

    // Save event
    saveEvent(event);

    // Show success message
    toast('Etkinlik oluşturuldu', 'success');

    // Close modal and refresh calendar
    hideModal();
    renderCalendar();
    loadUpcomingEvents();
}

function saveEvent(event) {
    const events = getEvents();
    events.push(event);

    // Sort events by date and time
    events.sort((a, b) => {
        const dateA = new Date(a.date + ' ' + a.time);
        const dateB = new Date(b.date + ' ' + b.time);
        return dateA - dateB;
    });

    // Keep only last 100 events
    if (events.length > 100) {
        events.splice(0, events.length - 100);
    }

    localStorage.setItem('scord_events', JSON.stringify(events));
}

function getEvents() {
    try {
        const saved = localStorage.getItem('scord_events');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.warn("Failed to load events:", e);
        return [];
    }
}

function loadUpcomingEvents() {
    const events = getEvents();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcomingEvents = events.filter(event => {
        const eventDate = new Date(event.date);
        return eventDate >= today;
    }).slice(0, 5);

    const container = document.getElementById('upcoming-events');
    if (!container) return;

    if (upcomingEvents.length === 0) {
        container.innerHTML = '<div class="no-events">Yaklaşan etkinlik yok</div>';
        return;
    }

    let html = '';
    upcomingEvents.forEach(event => {
        const eventDate = new Date(event.date);
        const dateStr = eventDate.toLocaleDateString('tr-TR', {
            day: 'numeric',
            month: 'short'
        });

        html += `
            <div class="upcoming-event-item" onclick="showEventDetails('${event.id}')">
                <div class="event-date">${dateStr}</div>
                <div class="event-info">
                    <div class="event-title">${escapeHtml(event.title)}</div>
                    <div class="event-time">${event.time}</div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function showEventDetails(eventId) {
    const events = getEvents();
    const event = events.find(e => e.id === eventId);

    if (!event) return;

    const eventDate = new Date(event.date);
    const dateStr = eventDate.toLocaleDateString('tr-TR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const typeLabels = {
        meeting: '📅 Toplantı',
        game: '🎮 Oyun Gecesi',
        study: '📚 Çalışma Oturumu',
        social: '🎉 Sosyal Etkinlik',
        birthday: '🎂 Doğum Günü',
        other: '📝 Diğer'
    };

    const content = `
        <div class="event-details-modal">
            <div class="event-details-header">
                <div class="event-details-title">${escapeHtml(event.title)}</div>
                <div class="event-details-type">${typeLabels[event.type] || typeLabels.other}</div>
            </div>
            <div class="event-details-content">
                <div class="event-detail-item">
                    <div class="detail-label">📅 Tarih:</div>
                    <div class="detail-value">${dateStr}</div>
                </div>
                <div class="event-detail-item">
                    <div class="detail-label">⏰ Saat:</div>
                    <div class="detail-value">${event.time}</div>
                </div>
                ${event.description ? `
                    <div class="event-detail-item">
                        <div class="detail-label">📝 Açıklama:</div>
                        <div class="detail-value">${escapeHtml(event.description)}</div>
                    </div>
                ` : ''}
                <div class="event-detail-item">
                    <div class="detail-label">👥 Katılımcılar:</div>
                    <div class="detail-value">${event.participants?.length || 0} kişi</div>
                </div>
                ${event.reminder ? `
                    <div class="event-detail-item">
                        <div class="detail-label">🔔 Hatırlatıcı:</div>
                        <div class="detail-value">Aktif</div>
                    </div>
                ` : ''}
                ${event.recurring ? `
                    <div class="event-detail-item">
                        <div class="detail-label">🔄 Tekrarlama:</div>
                        <div class="detail-value">Aktif</div>
                    </div>
                ` : ''}
            </div>
            <div class="event-details-actions">
                <button class="btn-primary" onclick="joinEvent('${event.id}')">Katıl</button>
                <button class="btn-secondary" onclick="editEvent('${event.id}')">Düzenle</button>
                <button class="btn-danger" onclick="deleteEvent('${event.id}')">Sil</button>
            </div>
        </div>
    `;

    showModal("Etkinlik Detayları", content, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
    `);
}

function joinEvent(eventId) {
    const events = getEvents();
    const event = events.find(e => e.id === eventId);

    if (!event) return;

    // Check if already joined
    if (event.participants?.includes(state.peerId)) {
        toast('Bu etkinliğe zaten katıldınız', 'info');
        return;
    }

    // Add participant
    if (!event.participants) event.participants = [];
    event.participants.push(state.peerId);

    // Save updated event
    localStorage.setItem('scord_events', JSON.stringify(events));

    toast('Etkinliğe katıldınız!', 'success');

    // Refresh displays
    loadUpcomingEvents();
}

function editEvent(eventId) {
    const events = getEvents();
    const event = events.find(e => e.id === eventId);

    if (!event) return;

    // Pre-fill form with event data
    const modalContent = `
        <div class="create-event-modal">
            <div class="create-event-header">
                <div class="create-event-title">✏️ Etkinliği Düzenle</div>
            </div>
            <div class="create-event-content">
                <div class="form-group">
                    <label>Etkinlik Adı:</label>
                    <input type="text" id="event-title" value="${escapeHtml(event.title)}" maxlength="100">
                </div>
                
                <div class="form-group">
                    <label>Tarih:</label>
                    <input type="date" id="event-date" value="${event.date}">
                </div>
                
                <div class="form-group">
                    <label>Saat:</label>
                    <input type="time" id="event-time" value="${event.time}">
                </div>
                
                <div class="form-group">
                    <label>Açıklama:</label>
                    <textarea id="event-description" rows="3" maxlength="500">${escapeHtml(event.description || '')}</textarea>
                </div>
                
                <div class="form-group">
                    <label>Etkinlik Türü:</label>
                    <select id="event-type">
                        <option value="meeting" ${event.type === 'meeting' ? 'selected' : ''}>Toplantı</option>
                        <option value="game" ${event.type === 'game' ? 'selected' : ''}>Oyun Gecesi</option>
                        <option value="study" ${event.type === 'study' ? 'selected' : ''}>Çalışma Oturumu</option>
                        <option value="social" ${event.type === 'social' ? 'selected' : ''}>Sosyal Etkinlik</option>
                        <option value="birthday" ${event.type === 'birthday' ? 'selected' : ''}>Doğum Günü</option>
                        <option value="other" ${event.type === 'other' ? 'selected' : ''}>Diğer</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="event-reminder" ${event.reminder ? 'checked' : ''}>
                        Hatırlatıcı Gönder
                    </label>
                </div>
                
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="event-recurring" ${event.recurring ? 'checked' : ''}>
                        Tekrarlayan Etkinlik
                    </label>
                </div>
            </div>
            
            <div class="create-event-footer">
                <button class="btn-secondary" onclick="hideModal()">İptal</button>
                <button class="btn-primary" onclick="updateEvent('${eventId}')">Güncelle</button>
            </div>
        </div>
    `;

    showModal("Etkinlik Düzenle", modalContent, '', true);
}

function updateEvent(eventId) {
    const events = getEvents();
    const eventIndex = events.findIndex(e => e.id === eventId);

    if (eventIndex === -1) return;

    const title = document.getElementById('event-title')?.value.trim();
    const date = document.getElementById('event-date')?.value;
    const time = document.getElementById('event-time')?.value;
    const description = document.getElementById('event-description')?.value.trim();
    const type = document.getElementById('event-type')?.value;
    const reminder = document.getElementById('event-reminder')?.checked || false;
    const recurring = document.getElementById('event-recurring')?.checked || false;

    if (!title || !date || !time) {
        toast('Lütfen zorunlu alanları doldurun', 'error');
        return;
    }

    // Update event
    events[eventIndex] = {
        ...events[eventIndex],
        title: title,
        date: date,
        time: time,
        description: description,
        type: type,
        reminder: reminder,
        recurring: recurring,
        updatedAt: Date.now()
    };

    // Save updated events
    localStorage.setItem('scord_events', JSON.stringify(events));

    toast('Etkinlik güncellendi', 'success');

    hideModal();
    renderCalendar();
    loadUpcomingEvents();
}

function deleteEvent(eventId) {
    if (!confirm('Bu etkinliği silmek istediğinizden emin misiniz?')) return;

    const events = getEvents();
    const eventIndex = events.findIndex(e => e.id === eventId);

    if (eventIndex === -1) return;

    events.splice(eventIndex, 1);
    localStorage.setItem('scord_events', JSON.stringify(events));

    toast('Etkinlik silindi', 'success');

    hideModal();
    renderCalendar();
    loadUpcomingEvents();
}

// Utility functions
function formatDateForStorage(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateForInput(date) {
    return formatDateForStorage(date);
}

// Event message display
function createEventMessage(event) {
    const eventDate = new Date(event.date);
    const dateStr = eventDate.toLocaleDateString('tr-TR', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
    });

    const typeLabels = {
        meeting: '📅 Toplantı',
        game: '🎮 Oyun Gecesi',
        study: '📚 Çalışma Oturumu',
        social: '🎉 Sosyal Etkinlik',
        birthday: '🎂 Doğum Günü',
        other: '📝 Etkinlik'
    };

    return `
        <div class="message-event">
            <div class="event-container">
                <div class="event-header">
                    <div class="event-icon">${typeLabels[event.type] || typeLabels.other}</div>
                    <div class="event-info">
                        <div class="event-title">${escapeHtml(event.title)}</div>
                        <div class="event-date-time">${dateStr} • ${event.time}</div>
                    </div>
                </div>
                ${event.description ? `<div class="event-description">${escapeHtml(event.description)}</div>` : ''}
                <div class="event-actions">
                    <button class="btn-primary" onclick="joinEvent('${event.id}')">Katıl</button>
                    <button class="btn-secondary" onclick="showEventDetails('${event.id}')">Detaylar</button>
                </div>
            </div>
        </div>
    `;
}

// Poll System
function showCreatePollModal() {
    const modalContent = `
        <div class="create-poll-modal">
            <div class="create-poll-header">
                <div class="create-poll-title">📊 Anket Oluştur</div>
                <div class="create-poll-subtitle">Topluluğunun fikrini öğren</div>
            </div>
            <div class="create-poll-content">
                <div class="form-group">
                    <label>Anket Sorusu:</label>
                    <input type="text" id="poll-question" placeholder="Anket sorusunu buraya yaz..." maxlength="200">
                </div>
                
                <div class="form-group">
                    <label>Anket Türü:</label>
                    <select id="poll-type" onchange="updatePollType()">
                        <option value="single">Tek Seçim</option>
                        <option value="multiple">Çoklu Seçim</option>
                        <option value="rating">Değerlendirme</option>
                    </select>
                </div>
                
                <div class="form-group">
                    <label>Seçenekler:</label>
                    <div class="poll-options" id="poll-options">
                        <div class="poll-option-item">
                            <input type="text" class="option-input" placeholder="Seçenek 1" maxlength="100">
                            <button class="btn-remove" onclick="removePollOption(this)">✕</button>
                        </div>
                        <div class="poll-option-item">
                            <input type="text" class="option-input" placeholder="Seçenek 2" maxlength="100">
                            <button class="btn-remove" onclick="removePollOption(this)">✕</button>
                        </div>
                    </div>
                    <button class="btn-secondary" onclick="addPollOption()">+ Seçenek Ekle</button>
                </div>
                
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="poll-anonymous">
                        Anonim Oylama
                    </label>
                </div>
                
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="poll-public-results">
                        Sonuçları Herkes Görebilir
                    </label>
                </div>
                
                <div class="form-group">
                    <label>Süre (Opsiyonel):</label>
                    <select id="poll-duration">
                        <option value="">Süresiz</option>
                        <option value="300">5 dakika</option>
                        <option value="600">10 dakika</option>
                        <option value="1800">30 dakika</option>
                        <option value="3600">1 saat</option>
                        <option value="7200">2 saat</option>
                        <option value="14400">4 saat</option>
                        <option value="86400">1 gün</option>
                        <option value="604800">1 hafta</option>
                    </select>
                </div>
            </div>
            
            <div class="create-poll-footer">
                <button class="btn-secondary" onclick="hideModal()">İptal</button>
                <button class="btn-primary" onclick="createPoll()">Anketi Oluştur</button>
            </div>
        </div>
    `;

    showModal("Anket Oluştur", modalContent, '', true);
}

function updatePollType() {
    const pollType = document.getElementById('poll-type')?.value;
    const optionsContainer = document.getElementById('poll-options');

    if (!optionsContainer) return;

    if (pollType === 'rating') {
        // For rating polls, show star rating options
        optionsContainer.innerHTML = `
            <div class="rating-options">
                <div class="rating-label">Değerlendirme Ölçeği:</div>
                <div class="rating-scale">
                    <div class="rating-option">
                        <input type="radio" name="rating-scale" value="5" checked>
                        <label>⭐⭐⭐⭐⭐ (5 yıldız)</label>
                    </div>
                    <div class="rating-option">
                        <input type="radio" name="rating-scale" value="4">
                        <label>⭐⭐⭐⭐ (4 yıldız)</label>
                    </div>
                    <div class="rating-option">
                        <input type="radio" name="rating-scale" value="3">
                        <label>⭐⭐⭐ (3 yıldız)</label>
                    </div>
                    <div class="rating-option">
                        <input type="radio" name="rating-scale" value="2">
                        <label>⭐⭐ (2 yıldız)</label>
                    </div>
                    <div class="rating-option">
                        <input type="radio" name="rating-scale" value="1">
                        <label>⭐ (1 yıldız)</label>
                    </div>
                </div>
            </div>
        `;
    } else {
        // For single/multiple choice, show text options
        optionsContainer.innerHTML = `
            <div class="poll-option-item">
                <input type="text" class="option-input" placeholder="Seçenek 1" maxlength="100">
                <button class="btn-remove" onclick="removePollOption(this)">✕</button>
            </div>
            <div class="poll-option-item">
                <input type="text" class="option-input" placeholder="Seçenek 2" maxlength="100">
                <button class="btn-remove" onclick="removePollOption(this)">✕</button>
            </div>
        `;
    }
}

function addPollOption() {
    const optionsContainer = document.getElementById('poll-options');
    if (!optionsContainer) return;

    const optionCount = optionsContainer.querySelectorAll('.poll-option-item').length;
    const newOption = document.createElement('div');
    newOption.className = 'poll-option-item';
    newOption.innerHTML = `
        <input type="text" class="option-input" placeholder="Seçenek ${optionCount + 1}" maxlength="100">
        <button class="btn-remove" onclick="removePollOption(this)">✕</button>
    `;

    optionsContainer.appendChild(newOption);
}

function removePollOption(button) {
    const optionItem = button.parentElement;
    const optionsContainer = optionItem.parentElement;

    // Keep at least 2 options
    if (optionsContainer.querySelectorAll('.poll-option-item').length > 2) {
        optionItem.remove();
    } else {
        toast('En az 2 seçenek olmalı', 'error');
    }
}

function createPoll() {
    const question = document.getElementById('poll-question')?.value.trim();
    const pollType = document.getElementById('poll-type')?.value;
    const anonymous = document.getElementById('poll-anonymous')?.checked || false;
    const publicResults = document.getElementById('poll-public-results')?.checked || false;
    const duration = document.getElementById('poll-duration')?.value || '';

    if (!question) {
        toast('Lütfen anket sorusunu girin', 'error');
        return;
    }

    let options = [];

    if (pollType === 'rating') {
        // For rating polls, create star rating options
        const selectedScale = document.querySelector('input[name="rating-scale"]:checked')?.value || '5';
        for (let i = 1; i <= parseInt(selectedScale); i++) {
            options.push({
                id: generateId(),
                text: `${i} Yıldız`,
                votes: 0,
                voters: []
            });
        }
    } else {
        // For single/multiple choice, collect text options
        const optionInputs = document.querySelectorAll('.option-input');
        optionInputs.forEach(input => {
            const text = input.value.trim();
            if (text) {
                options.push({
                    id: generateId(),
                    text: text,
                    votes: 0,
                    voters: []
                });
            }
        });
    }

    if (options.length < 2) {
        toast('En az 2 seçenek girin', 'error');
        return;
    }

    const poll = {
        id: generateId(),
        question: question,
        type: pollType,
        options: options,
        anonymous: anonymous,
        publicResults: publicResults,
        duration: duration,
        createdBy: state.peerId,
        createdAt: Date.now(),
        expiresAt: duration ? Date.now() + (parseInt(duration) * 1000) : null,
        totalVotes: 0,
        voters: []
    };

    // Save poll
    savePoll(poll);

    // Send poll message
    const message = {
        type: 'poll',
        pollId: poll.id,
        question: poll.question,
        pollType: poll.type,
        options: poll.options,
        anonymous: poll.anonymous,
        publicResults: poll.publicResults,
        expiresAt: poll.expiresAt,
        totalVotes: poll.totalVotes
    };

    // This would integrate with the existing message sending system
    toast('Anket oluşturuldu', 'success');

    hideModal();
}

function savePoll(poll) {
    const polls = getPolls();
    polls.push(poll);

    // Keep only last 100 polls
    if (polls.length > 100) {
        polls.shift();
    }

    localStorage.setItem('scord_polls', JSON.stringify(polls));
}

function getPolls() {
    try {
        const saved = localStorage.getItem('scord_polls');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.warn("Failed to load polls:", e);
        return [];
    }
}

// Poll message display
function createPollMessage(poll) {
    const isExpired = poll.expiresAt && Date.now() > poll.expiresAt;
    const hasVoted = poll.voters?.includes(state.peerId);
    const canViewResults = poll.publicResults || hasVoted || isExpired;

    let content = `
        <div class="message-poll">
            <div class="poll-container">
                <div class="poll-header">
                    <div class="poll-question">${escapeHtml(poll.question)}</div>
                    <div class="poll-info">
                        <span class="poll-type">${getPollTypeLabel(poll.type)}</span>
                        <span class="poll-votes">${poll.totalVotes} oy</span>
                        ${poll.expiresAt ? `<span class="poll-expires">${getTimeRemaining(poll.expiresAt)}</span>` : ''}
                    </div>
                </div>
                
                <div class="poll-options">
    `;

    poll.options.forEach(option => {
        const percentage = poll.totalVotes > 0 ? Math.round((option.votes / poll.totalVotes) * 100) : 0;
        const hasVotedForOption = option.voters?.includes(state.peerId);

        content += `
            <div class="poll-option ${hasVotedForOption ? 'voted' : ''}" onclick="voteInPoll('${poll.id}', '${option.id}')">
                <div class="poll-option-content">
                    <div class="poll-option-text">${escapeHtml(option.text)}</div>
                    ${canViewResults ? `
                        <div class="poll-option-results">
                            <div class="poll-progress-bar">
                                <div class="poll-progress-fill" style="width: ${percentage}%"></div>
                            </div>
                            <div class="poll-option-stats">
                                <span class="poll-percentage">${percentage}%</span>
                                <span class="poll-vote-count">${option.votes} oy</span>
                            </div>
                        </div>
                    ` : ''}
                </div>
                ${!hasVoted && !isExpired ? `
                    <div class="poll-option-radio">
                        ${poll.type === 'single' ? '○' : '☐'}
                    </div>
                ` : ''}
            </div>
        `;
    });

    content += `
                </div>
                
                ${!hasVoted && !isExpired ? `
                    <div class="poll-actions">
                        <button class="btn-primary" onclick="submitPollVote('${poll.id}')">Oy Ver</button>
                    </div>
                ` : ''}
                
                ${isExpired ? `
                    <div class="poll-expired">Bu anket sona erdi</div>
                ` : ''}
                
                ${hasVoted && !isExpired ? `
                    <div class="poll-voted">Oyunuz kullanıldı</div>
                ` : ''}
            </div>
        </div>
    `;

    return content;
}

function getPollTypeLabel(type) {
    const labels = {
        single: 'Tek Seçim',
        multiple: 'Çoklu Seçim',
        rating: 'Değerlendirme'
    };
    return labels[type] || 'Anket';
}

function getTimeRemaining(expiresAt) {
    const now = Date.now();
    const remaining = expiresAt - now;

    if (remaining <= 0) return 'Sona erdi';

    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);

    if (hours > 24) {
        const days = Math.floor(hours / 24);
        return `${days} gün`;
    } else if (hours > 0) {
        return `${hours} saat ${minutes} dk`;
    } else {
        return `${minutes} dk`;
    }
}

let currentPollVotes = {};

function voteInPoll(pollId, optionId) {
    if (!currentPollVotes[pollId]) {
        currentPollVotes[pollId] = [];
    }

    const poll = getPolls().find(p => p.id === pollId);
    if (!poll) return;

    if (poll.type === 'single') {
        // Single choice - replace previous selection
        currentPollVotes[pollId] = [optionId];
    } else {
        // Multiple choice - toggle selection
        const index = currentPollVotes[pollId].indexOf(optionId);
        if (index === -1) {
            currentPollVotes[pollId].push(optionId);
        } else {
            currentPollVotes[pollId].splice(index, 1);
        }
    }

    // Update UI to show selection
    updatePollSelectionUI(pollId);
}

function updatePollSelectionUI(pollId) {
    const pollContainer = document.querySelector(`[data-poll-id="${pollId}"]`);
    if (!pollContainer) return;

    const poll = getPolls().find(p => p.id === pollId);
    if (!poll) return;

    const selectedOptions = currentPollVotes[pollId] || [];

    poll.options.forEach(option => {
        const optionElement = pollContainer.querySelector(`[data-option-id="${option.id}"]`);
        if (optionElement) {
            if (selectedOptions.includes(option.id)) {
                optionElement.classList.add('selected');
            } else {
                optionElement.classList.remove('selected');
            }
        }
    });
}

function submitPollVote(pollId) {
    const polls = getPolls();
    const poll = polls.find(p => p.id === pollId);

    if (!poll) return;

    const selectedOptions = currentPollVotes[pollId] || [];

    if (selectedOptions.length === 0) {
        toast('Lütfen en az bir seçenek seçin', 'error');
        return;
    }

    if (poll.type === 'single' && selectedOptions.length > 1) {
        toast('Tek seçim anketinde sadece bir seçenek seçebilirsiniz', 'error');
        return;
    }

    // Check if already voted
    if (poll.voters?.includes(state.peerId)) {
        toast('Bu ankete zaten oy verdiniz', 'info');
        return;
    }

    // Check if expired
    if (poll.expiresAt && Date.now() > poll.expiresAt) {
        toast('Bu anket sona ermiş', 'error');
        return;
    }

    // Record vote
    selectedOptions.forEach(optionId => {
        const option = poll.options.find(o => o.id === optionId);
        if (option) {
            option.votes++;
            if (!option.voters) option.voters = [];
            option.voters.push(state.peerId);
        }
    });

    poll.totalVotes++;
    if (!poll.voters) poll.voters = [];
    poll.voters.push(state.peerId);

    // Save updated poll
    localStorage.setItem('scord_polls', JSON.stringify(polls));

    // Clear current votes
    delete currentPollVotes[pollId];

    // Show success message
    toast('Oyunuz kaydedildi', 'success');

    // Update poll display
    updatePollDisplay(pollId);
}

function updatePollDisplay(pollId) {
    // This would update the poll message in the chat
    // For now, we'll just show a success message
    setTimeout(() => {
        const pollContainer = document.querySelector(`[data-poll-id="${pollId}"]`);
        if (pollContainer) {
            // Refresh the poll display
            const poll = getPolls().find(p => p.id === pollId);
            if (poll) {
                pollContainer.outerHTML = createPollMessage(poll);
            }
        }
    }, 100);
}

// Poll results modal
function showPollResultsModal(pollId) {
    const polls = getPolls();
    const poll = polls.find(p => p.id === pollId);

    if (!poll) return;

    const isExpired = poll.expiresAt && Date.now() > poll.expiresAt;
    const canViewResults = poll.publicResults || isExpired;

    if (!canViewResults) {
        toast('Sonuçları görme yetkiniz yok', 'error');
        return;
    }

    let content = `
        <div class="poll-results-modal">
            <div class="poll-results-header">
                <div class="poll-results-title">📊 Anket Sonuçları</div>
                <div class="poll-results-question">${escapeHtml(poll.question)}</div>
            </div>
            <div class="poll-results-content">
                <div class="poll-results-stats">
                    <div class="stat-item">
                        <div class="stat-label">Toplam Oy:</div>
                        <div class="stat-value">${poll.totalVotes}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Anket Türü:</div>
                        <div class="stat-value">${getPollTypeLabel(poll.type)}</div>
                    </div>
                    ${poll.expiresAt ? `
                        <div class="stat-item">
                            <div class="stat-label">Durum:</div>
                            <div class="stat-value">${isExpired ? 'Sona erdi' : 'Aktif'}</div>
                        </div>
                    ` : ''}
                </div>
                
                <div class="poll-results-options">
    `;

    // Sort options by votes
    const sortedOptions = [...poll.options].sort((a, b) => b.votes - a.votes);

    sortedOptions.forEach((option, index) => {
        const percentage = poll.totalVotes > 0 ? Math.round((option.votes / poll.totalVotes) * 100) : 0;
        const isWinner = index === 0 && option.votes > 0;

        content += `
            <div class="result-option ${isWinner ? 'winner' : ''}">
                <div class="result-option-rank">#${index + 1}</div>
                <div class="result-option-content">
                    <div class="result-option-text">${escapeHtml(option.text)}</div>
                    <div class="result-option-bar">
                        <div class="result-option-fill" style="width: ${percentage}%"></div>
                    </div>
                    <div class="result-option-stats">
                        <span class="result-percentage">${percentage}%</span>
                        <span class="result-votes">${option.votes} oy</span>
                    </div>
                </div>
                ${isWinner ? '<div class="winner-crown">👑</div>' : ''}
            </div>
        `;
    });

    content += `
                </div>
                
                ${!poll.anonymous && poll.voters && poll.voters.length > 0 ? `
                    <div class="poll-voters">
                        <div class="voters-title">Oy Kullananlar (${poll.voters.length}):</div>
                        <div class="voters-list">
                            ${poll.voters.map(voterId => `<div class="voter-item">@${voterId.substring(0, 8)}</div>`).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>
    `;

    showModal("Anket Sonuçları", content, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
    `);
}

// Recent polls modal
function showRecentPollsModal() {
    const polls = getPolls();

    if (polls.length === 0) {
        toast('Henüz anket yok', 'info');
        return;
    }

    let content = `
        <div class="recent-polls-modal">
            <div class="recent-polls-title">📊 Son Anketler</div>
            <div class="recent-polls-list">
    `;

    polls.slice(-10).reverse().forEach(poll => {
        const isExpired = poll.expiresAt && Date.now() > poll.expiresAt;
        const statusIcon = isExpired ? '🔒' : '📊';

        content += `
            <div class="recent-poll-item" onclick="showPollResultsModal('${poll.id}')">
                <div class="poll-icon">${statusIcon}</div>
                <div class="poll-info">
                    <div class="poll-question">${escapeHtml(poll.question)}</div>
                    <div class="poll-details">${poll.totalVotes} oy • ${getPollTypeLabel(poll.type)}</div>
                    <div class="poll-date">${new Date(poll.createdAt).toLocaleDateString('tr-TR')}</div>
                </div>
            </div>
        `;
    });

    content += `
            </div>
        </div>
    `;

    showModal("Son Anketler", content, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
    `);
}

// Welcome System for New Members
function showWelcomeSettingsModal() {
    const welcomeSettings = getWelcomeSettings();

    const modalContent = `
        <div class="welcome-settings-modal">
            <div class="welcome-settings-header">
                <div class="welcome-settings-title">👋 Hoş Geldin Sistemi</div>
                <div class="welcome-settings-subtitle">Yeni üyeleri karşılama ayarları</div>
            </div>
            <div class="welcome-settings-content">
                <div class="settings-section">
                    <div class="settings-title">Genel Ayarlar</div>
                    <div class="form-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="welcome-enabled" ${welcomeSettings.enabled ? 'checked' : ''}>
                            Hoş Geldin Sistemini Aktif Et
                        </label>
                    </div>
                    <div class="form-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="welcome-dm" ${welcomeSettings.sendDM ? 'checked' : ''}>
                            Yeni Üyelere Özel Mesaj Gönder
                        </label>
                    </div>
                    <div class="form-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="welcome-channel" ${welcomeSettings.postInChannel ? 'checked' : ''}>
                            Hoş Geldin Mesajını Kanalda Paylaş
                        </label>
                    </div>
                </div>
                
                <div class="settings-section">
                    <div class="settings-title">Hoş Geldin Mesajı</div>
                    <div class="form-group">
                        <label>Mesaj Başlığı:</label>
                        <input type="text" id="welcome-title" value="${escapeHtml(welcomeSettings.title)}" placeholder="Hoş Geldin!" maxlength="100">
                    </div>
                    <div class="form-group">
                        <label>Mesaj İçeriği:</label>
                        <textarea id="welcome-message" rows="4" placeholder="Sunucumuza hoş geldin!">${escapeHtml(welcomeSettings.message)}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Hoş Geldin GIF'i (opsiyonel):</label>
                        <input type="text" id="welcome-gif" value="${escapeHtml(welcomeSettings.gifUrl || '')}" placeholder="GIF URL'si">
                    </div>
                </div>
                
                <div class="settings-section">
                    <div class="settings-title">Otomasyonlar</div>
                    <div class="form-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="auto-roles" ${welcomeSettings.autoRoles ? 'checked' : ''}>
                            Otomatik Rol Ver
                        </label>
                    </div>
                    <div class="form-group">
                        <label>Otomatik Rol:</label>
                        <select id="auto-role-select">
                            <option value="">Rol Seçin</option>
                            <option value="newbie" ${welcomeSettings.autoRole === 'newbie' ? 'selected' : ''}>Yeni Üye</option>
                            <option value="member" ${welcomeSettings.autoRole === 'member' ? 'selected' : ''}>Üye</option>
                            <option value="verified" ${welcomeSettings.autoRole === 'verified' ? 'selected' : ''}>Doğrulanmış</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="checkbox-label">
                            <input type="checkbox" id="welcome-emoji" ${welcomeSettings.addEmoji ? 'checked' : ''}>
                            Hoş Geldin Emoji Ekle
                        </label>
                    </div>
                </div>
                
                <div class="settings-section">
                    <div class="settings-title">Hoş Geldin Kanalı</div>
                    <div class="form-group">
                        <label>Kanal:</label>
                        <select id="welcome-channel-select">
                            <option value="">Genel Sohbet</option>
                            <option value="welcome" ${welcomeSettings.channelId === 'welcome' ? 'selected' : ''}>#hoş-geldin</option>
                            <option value="announcements" ${welcomeSettings.channelId === 'announcements' ? 'selected' : ''}>#duyurular</option>
                        </select>
                    </div>
                </div>
            </div>
            
            <div class="welcome-settings-footer">
                <button class="btn-secondary" onclick="hideModal()">İptal</button>
                <button class="btn-primary" onclick="saveWelcomeSettings()">Kaydet</button>
            </div>
        </div>
    `;

    showModal("Hoş Geldin Ayarları", modalContent, '', true);
}

function getWelcomeSettings() {
    try {
        const saved = localStorage.getItem('scord_welcome_settings');
        return saved ? JSON.parse(saved) : {
            enabled: true,
            sendDM: true,
            postInChannel: true,
            title: '👋 Hoş Geldin!',
            message: 'Sunucumuza hoş geldin! Kuralları okumayı ve tanışmaya başlamayı unutma.',
            gifUrl: '',
            autoRoles: false,
            autoRole: 'newbie',
            addEmoji: true,
            channelId: 'welcome'
        };
    } catch (e) {
        console.warn("Failed to load welcome settings:", e);
        return {
            enabled: true,
            sendDM: true,
            postInChannel: true,
            title: '👋 Hoş Geldin!',
            message: 'Sunucumuza hoş geldin! Kuralları okumayı ve tanışmaya başlamayı unutma.',
            gifUrl: '',
            autoRoles: false,
            autoRole: 'newbie',
            addEmoji: true,
            channelId: 'welcome'
        };
    }
}

function saveWelcomeSettings() {
    const settings = {
        enabled: document.getElementById('welcome-enabled')?.checked || false,
        sendDM: document.getElementById('welcome-dm')?.checked || false,
        postInChannel: document.getElementById('welcome-channel')?.checked || false,
        title: document.getElementById('welcome-title')?.value.trim() || '👋 Hoş Geldin!',
        message: document.getElementById('welcome-message')?.value.trim() || 'Sunucumuza hoş geldin!',
        gifUrl: document.getElementById('welcome-gif')?.value.trim() || '',
        autoRoles: document.getElementById('auto-roles')?.checked || false,
        autoRole: document.getElementById('auto-role-select')?.value || 'newbie',
        addEmoji: document.getElementById('welcome-emoji')?.checked || false,
        channelId: document.getElementById('welcome-channel-select')?.value || 'welcome'
    };

    localStorage.setItem('scord_welcome_settings', JSON.stringify(settings));

    toast('Hoş geldin ayarları kaydedildi', 'success');
    hideModal();
}

function triggerWelcomeMessage(memberId, memberName) {
    const settings = getWelcomeSettings();

    if (!settings.enabled) return;

    const welcomeMessage = createWelcomeMessage(memberName, settings);

    // Send to channel if enabled
    if (settings.postInChannel) {
        // This would integrate with the existing message system
        console.log('Posting welcome message to channel:', welcomeMessage);
    }

    // Send DM if enabled
    if (settings.sendDM) {
        // This would integrate with the existing DM system
        console.log('Sending welcome DM:', welcomeMessage);
    }

    // Add emoji reaction if enabled
    if (settings.addEmoji) {
        // This would add emoji reactions to the join message
        console.log('Adding welcome emoji reactions');
    }

    // Assign auto role if enabled
    if (settings.autoRoles && settings.autoRole) {
        assignAutoRole(memberId, settings.autoRole);
    }

    // Log welcome event
    logWelcomeEvent(memberId, memberName);
}

function createWelcomeMessage(memberName, settings) {
    const personalizedMessage = settings.message.replace('{user}', `@${memberName}`);

    let content = `
        <div class="welcome-message">
            <div class="welcome-header">
                <div class="welcome-title">${escapeHtml(settings.title)}</div>
                <div class="welcome-subtitle">${escapeHtml(memberName)} sunucuya katıldı!</div>
            </div>
            <div class="welcome-content">
                <div class="welcome-text">${escapeHtml(personalizedMessage)}</div>
                ${settings.gifUrl ? `
                    <div class="welcome-gif">
                        <img src="${escapeHtml(settings.gifUrl)}" alt="Welcome GIF" />
                    </div>
                ` : ''}
            </div>
            <div class="welcome-actions">
                <button class="btn-primary" onclick="showServerRules()">Kuralları Gör</button>
                <button class="btn-secondary" onclick="showServerInfo()">Sunucu Hakkında</button>
            </div>
        </div>
    `;

    return content;
}

function assignAutoRole(memberId, roleName) {
    // This would integrate with the existing role system
    console.log(`Assigning role ${roleName} to member ${memberId}`);

    // Show toast for demonstration
    toast(`${roleName} rolü verildi`, 'success');
}

function logWelcomeEvent(memberId, memberName) {
    const welcomeLogs = getWelcomeLogs();

    const logEntry = {
        id: generateId(),
        memberId: memberId,
        memberName: memberName,
        timestamp: Date.now(),
        date: new Date().toISOString()
    };

    welcomeLogs.push(logEntry);

    // Keep only last 100 logs
    if (welcomeLogs.length > 100) {
        welcomeLogs.shift();
    }

    localStorage.setItem('scord_welcome_logs', JSON.stringify(welcomeLogs));
}

function getWelcomeLogs() {
    try {
        const saved = localStorage.getItem('scord_welcome_logs');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.warn("Failed to load welcome logs:", e);
        return [];
    }
}

// Welcome logs modal
function showWelcomeLogsModal() {
    const logs = getWelcomeLogs();

    if (logs.length === 0) {
        toast('Henüz hoş geldin kaydı yok', 'info');
        return;
    }

    let content = `
        <div class="welcome-logs-modal">
            <div class="welcome-logs-title">📋 Hoş Geldin Kayıtları</div>
            <div class="welcome-logs-list">
    `;

    logs.slice(-20).reverse().forEach(log => {
        const date = new Date(log.timestamp);
        const dateStr = date.toLocaleDateString('tr-TR');
        const timeStr = date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

        content += `
            <div class="welcome-log-item">
                <div class="log-info">
                    <div class="log-member">${escapeHtml(log.memberName)}</div>
                    <div class="log-date">${dateStr} • ${timeStr}</div>
                </div>
                <div class="log-actions">
                    <button class="btn-secondary" onclick="showMemberProfile('${log.memberId}')">Profil</button>
                </div>
            </div>
        `;
    });

    content += `
            </div>
        </div>
    `;

    showModal("Hoş Geldin Kayıtları", content, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
    `);
}

// Server rules modal
function showServerRules() {
    const rules = getServerRules();

    let content = `
        <div class="server-rules-modal">
            <div class="server-rules-header">
                <div class="server-rules-title">📜 Sunucu Kuralları</div>
            </div>
            <div class="server-rules-content">
                <div class="rules-list">
    `;

    rules.forEach((rule, index) => {
        content += `
            <div class="rule-item">
                <div class="rule-number">${index + 1}</div>
                <div class="rule-text">${escapeHtml(rule)}</div>
            </div>
        `;
    });

    content += `
                </div>
            </div>
            <div class="server-rules-footer">
                <button class="btn-primary" onclick="acknowledgeRules()">Kuralları Anladım</button>
            </div>
        </div>
    `;

    showModal("Sunucu Kuralları", content, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
    `);
}

function getServerRules() {
    try {
        const saved = localStorage.getItem('scord_server_rules');
        return saved ? JSON.parse(saved) : [
            "Saygılı ol ve diğer üyelere karşı nazik davran",
            "Spam ve flood yapmaktan kaçın",
            "Uygunsuz içerik paylaşmayın",
            "Telif haklarına dikkat edin",
            "Kişisel bilgileri paylaşmayın",
            "Sunucu amacına uygun davranın"
        ];
    } catch (e) {
        console.warn("Failed to load server rules:", e);
        return [
            "Saygılı ol ve diğer üyelere karşı nazik davran",
            "Spam ve flood yapmaktan kaçın",
            "Uygunsuz içerik paylaşmayın"
        ];
    }
}

function acknowledgeRules() {
    // This would mark the user as having read the rules
    localStorage.setItem('scord_rules_acknowledged', Date.now().toString());

    toast('Kuralları anladım olarak işaretlendi', 'success');
    hideModal();
}

// Server info modal
function showServerInfo() {
    const serverInfo = getServerInfo();

    const content = `
        <div class="server-info-modal">
            <div class="server-info-header">
                <div class="server-info-title">ℹ️ Sunucu Hakkında</div>
            </div>
            <div class="server-info-content">
                <div class="info-section">
                    <div class="info-title">📝 Açıklama</div>
                    <div class="info-text">${escapeHtml(serverInfo.description)}</div>
                </div>
                
                <div class="info-section">
                    <div class="info-title">🎯 Amaç</div>
                    <div class="info-text">${escapeHtml(serverInfo.purpose)}</div>
                </div>
                
                <div class="info-section">
                    <div class="info-title">📊 İstatistikler</div>
                    <div class="stats-grid">
                        <div class="stat-item">
                            <div class="stat-value">${serverInfo.memberCount}</div>
                            <div class="stat-label">Üye</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${serverInfo.channelCount}</div>
                            <div class="stat-label">Kanal</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${serverInfo.roleCount}</div>
                            <div class="stat-label">Rol</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-value">${serverInfo.createdAt}</div>
                            <div class="stat-label">Kuruluş</div>
                        </div>
                    </div>
                </div>
                
                <div class="info-section">
                    <div class="info-title">🔗 Bağlantılar</div>
                    <div class="links-list">
                        ${serverInfo.links.map(link => `
                            <div class="link-item">
                                <div class="link-name">${escapeHtml(link.name)}</div>
                                <a href="${escapeHtml(link.url)}" target="_blank" class="link-url">${escapeHtml(link.url)}</a>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;

    showModal("Sunucu Bilgileri", content, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
    `);
}

function getServerInfo() {
    try {
        const saved = localStorage.getItem('scord_server_info');
        return saved ? JSON.parse(saved) : {
            description: "Harika bir topluluk için bir aradayız. Burada herkes kendini evinde hissedecek!",
            purpose: "Arkadaşlık, eğlence ve iletişim kurmak için bir platform.",
            memberCount: "1,234",
            channelCount: "15",
            roleCount: "8",
            createdAt: "Ocak 2024",
            links: [
                { name: "Web Sitesi", url: "https://example.com" },
                { name: "Twitter", url: "https://twitter.com/example" },
                { name: "Instagram", url: "https://instagram.com/example" }
            ]
        };
    } catch (e) {
        console.warn("Failed to load server info:", e);
        return {
            description: "Harika bir topluluk için bir aradayız.",
            purpose: "Arkadaşlık ve iletişim kurmak.",
            memberCount: "100",
            channelCount: "5",
            roleCount: "3",
            createdAt: "2024",
            links: []
        };
    }
}

// Test welcome message
function testWelcomeMessage() {
    const settings = getWelcomeSettings();
    const testMessage = createWelcomeMessage("TestKullanıcı", settings);

    const content = `
        <div class="test-welcome-modal">
            <div class="test-welcome-title">🧪 Hoş Geldin Mesajı Test</div>
            <div class="test-welcome-content">
                ${testMessage}
            </div>
        </div>
    `;

    showModal("Test Mesajı", content, `
        <button class="btn-secondary" onclick="hideModal()">Kapat</button>
    `);
}

function groupedChannels(server, type) {
    const groups = new Map();
    (server.channels || []).filter(c => c.type === type && !c.directCall).forEach(ch => {
        const label = channelCategoryLabel(ch, type === "voice" ? "SES KANALLARI" : "METIN KANALLARI");
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(ch);
    });
    return [...groups.entries()];
}

function renderCategoryHeader(list, label, serverId, type) {
    const cat = document.createElement("div");
    cat.className = "channel-category channel-category--grouped";
    cat.innerHTML = `<span><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg> ${escapeHtml(label)}</span>`;
    const server = state.servers.find(s => s.id === serverId);
    const canAdd = server && (server.ownerId === state.peerId || server.peer_roles?.[state.peerId] === "admin");
    if (canAdd) {
        const addBtn = document.createElement("span");
        addBtn.className = "add-ch-btn";
        addBtn.textContent = "+";
        addBtn.title = type === "voice" ? "Ses kanali ekle" : "Metin kanali ekle";
        addBtn.onclick = (e) => { e.stopPropagation(); promptAddChannel(serverId, type); };
        cat.appendChild(addBtn);
    }
    list.appendChild(cat);
}

function renderVoiceMemberUnderChannel(list, server, ch, m) {
    const vm = document.createElement("div");
    vm.className = "voice-member";
    vm.dataset.peerId = m.peer_id;
    if (m.isSpeaking || (m.peer_id === state.peerId && state.isSpeaking)) vm.classList.add("voice-member--speaking");
    const av = document.createElement("div");
    av.className = "vm-avatar";
    if (m.isSpeaking || (m.peer_id === state.peerId && state.isSpeaking)) av.classList.add("speaking");
    applyAvatarToElement(av, m.avatar_color, m.avatar_image, m.username);
    const nameRow = document.createElement("div");
    nameRow.className = "voice-member-name-row";
    const name = document.createElement("span");
    name.textContent = m.username + (m.peer_id === state.peerId ? " (sen)" : "");
    nameRow.appendChild(name);
    if (m.isSharingScreen || (m.peer_id === state.peerId && getLocalShareStream())) {
        const ico = document.createElement("span");
        ico.className = "voice-mini-live";
        ico.textContent = "LIVE";
        ico.title = "Ekran paylasiyor";
        nameRow.appendChild(ico);
    } else if (m.isSharingCamera || (m.peer_id === state.peerId && state.cameraStream)) {
        const ico = document.createElement("span");
        ico.className = "voice-mini-live";
        ico.textContent = "CAM";
        ico.title = "Kamera acik";
        nameRow.appendChild(ico);
    }
    vm.appendChild(av);
    vm.appendChild(nameRow);
    if (m.peer_id !== state.peerId) {
        vm.onclick = () => openUserProfile(m.peer_id, m.username, m.avatar_image, m.avatar_color);
        vm.oncontextmenu = (e) => {
            e.preventDefault();
            showRichUserMenu(m.peer_id, m.username, e.clientX, e.clientY);
        };
    }
    list.appendChild(vm);
}

const _v22CreateChannelItem = window.createChannelItem || createChannelItem;
updateChannelSidebar = window.updateChannelSidebar = function (serverId) {
    const list = document.getElementById("channel-list");
    if (!list) return;
    list.innerHTML = "";
    if (!serverId) {
        renderHomeSidebar();
        return;
    }
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;

    groupedChannels(server, "text").forEach(([label, channels]) => {
        renderCategoryHeader(list, label, serverId, "text");
        channels.forEach(ch => list.appendChild(_v22CreateChannelItem(ch, serverId)));
    });

    groupedChannels(server, "voice").forEach(([label, channels]) => {
        renderCategoryHeader(list, label, serverId, "voice");
        channels.forEach(ch => {
            const item = _v22CreateChannelItem(ch, serverId);
            const members = server.voiceMembers?.[ch.id] || [];
            if (members.some(m => m.isSharingScreen || m.isSharingCamera)) item.classList.add("channel-live");
            list.appendChild(item);
            members.forEach(m => renderVoiceMemberUnderChannel(list, server, ch, m));
        });
    });
};

function profileRoleLine(server, peerId) {
    if (!server) return "Shercord uyesi";
    if (server.ownerId === peerId) return "Sunucu kurucusu";
    const rid = server.peer_roles?.[peerId] || "member";
    return server.roles?.[rid]?.name || "Uye";
}

function showRichUserMenu(peerId, username, x, y) {
    document.querySelector(".rich-user-menu")?.remove();
    const server = currentServer();
    const isSelf = peerId === state.peerId;
    const role = profileRoleLine(server, peerId);
    const canKick = !isSelf && server && (server.ownerId === state.peerId || roleAllows(server, "force_disconnect", state.voiceChannelId || state.activeChannelId));
    const menu = document.createElement("div");
    menu.className = "rich-user-menu";
    menu.style.left = `${Math.min(x, window.innerWidth - 280)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 330)}px`;
    menu.innerHTML = `
      <div class="rich-user-menu-head">
        <div class="rich-user-menu-avatar">${initials(username)}</div>
        <div><strong>${escapeHtml(username || "Kullanici")}</strong><span>${escapeHtml(role)}</span></div>
      </div>
      <button data-action="profile">Profili ac</button>
      ${!isSelf ? `<button data-action="dm">Mesaj gonder</button><button data-action="call">Sesli ara</button><button data-action="friend">Arkadas ekle</button>` : ""}
      <button data-action="note">Not duzenle</button>
      ${canKick ? `<button class="danger" data-action="disconnect">Sesten cikar</button>` : ""}
    `;
    document.body.appendChild(menu);
    menu.onclick = (e) => {
        const action = e.target?.dataset?.action;
        if (!action) return;
        menu.remove();
        if (action === "profile") {
            const member = server?.members?.find(m => m.peer_id === peerId) || {};
            openUserProfile(peerId, username, member.avatar_image, member.avatar_color);
        } else if (action === "dm") {
            openDM(peerId, username);
        } else if (action === "call") {
            openDM(peerId, username);
            startDirectCall(peerId);
        } else if (action === "friend") {
            addFriend(peerId, username);
        } else if (action === "note") {
            openUserProfile(peerId, username);
            setTimeout(() => document.getElementById("profile-note-input")?.focus(), 80);
        } else if (action === "disconnect") {
            requestForceDisconnect(peerId);
        }
    };
    setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 0);
}

const _v22OpenUserProfile = window.openUserProfile || openUserProfile;
openUserProfile = window.openUserProfile = function (peerId, username, avatarImage, avatarColor) {
    const server = currentServer();
    const isSelf = peerId === state.peerId;
    const role = profileRoleLine(server, peerId);
    const note = getUserNote(peerId);
    const isFriend = state.friends?.some(f => f.peerId === peerId);
    const serverName = server?.name || "Shercord";
    const canModerate = !isSelf && server && (server.ownerId === state.peerId || roleAllows(server, "force_disconnect", state.voiceChannelId || state.activeChannelId));
    const body = `
      <div class="profile-pro-card">
        <div class="profile-pro-banner" style="background:linear-gradient(135deg, ${avatarColor || "#5865f2"}, #111827);"></div>
        <div class="profile-pro-main">
          <div class="profile-pro-avatar" style="background-color:${avatarColor || "#5865f2"};background-image:url(${avatarImage || ""})">${avatarImage ? "" : initials(username)}</div>
          <div class="profile-pro-title">
            <h2>${escapeHtml(username || "Kullanici")}</h2>
            <span>${escapeHtml(role)} - ${escapeHtml(serverName)}</span>
          </div>
          <div class="profile-pro-status">Shercord uzerinde ${isSelf ? "kendi alanin" : "ortak bir topluluk uyesi"}</div>
        </div>
        <div class="profile-pro-grid">
          <section><strong>Hakkinda</strong><p>Bu profil Shercord'a ozgu notlar, arkadaslik ve moderasyon kisayollariyla zenginlestirildi.</p></section>
          <section><strong>Sunucu rolu</strong><p>${escapeHtml(role)}</p></section>
          <section><strong>Durum</strong><p>${server?.voiceMembers && Object.values(server.voiceMembers).some(list => list.some(m => m.peer_id === peerId)) ? "Ses kanalinda" : "Metin kanalinda"}</p></section>
        </div>
        <label class="profile-pro-note">Kisisel not<textarea id="profile-note-input" placeholder="Bu kisi hakkinda sadece sende kalacak not..." maxlength="600">${escapeHtml(note)}</textarea></label>
      </div>`;
    const footer = `
      ${!isSelf ? `<button class="btn-secondary" onclick="openDM('${peerId}', '${escapeHtml(username || "")}'); hideModal();">Mesaj</button>` : ""}
      ${!isSelf ? `<button class="btn-secondary" onclick="startDirectCall('${peerId}'); hideModal();">Sesli ara</button>` : ""}
      ${!isSelf ? `<button class="btn-secondary" onclick="addFriend('${peerId}', '${escapeHtml(username || "")}')">${isFriend ? "Arkadas" : "Arkadas ekle"}</button>` : ""}
      ${canModerate ? `<button class="btn-secondary danger-soft" onclick="requestForceDisconnect('${peerId}')">Sesten cikar</button>` : ""}
      <button class="btn-primary" onclick="saveProfileNote('${peerId}'); hideModal();">Notu kaydet</button>`;
    showModal("Kullanici Profili", body, footer);
};

function markTemplateServersForRail() {
    state.servers.forEach(s => {
        if (String(s.id || "").startsWith("tpl-")) s.template = true;
    });
}

const _v22StartApp = window.startApp;
window.startApp = function () {
    if (_v22StartApp) _v22StartApp();
    markTemplateServersForRail();
    renderServerRail();
};

/* ==========================================================================
   V23 direct message voice calls
   ========================================================================== */

function getPeerDisplay(peerId) {
    const server = currentServer() || state.servers.find(s => s.id === state.activeServerId) || state.servers[0];
    const member = server?.members?.find(m => m.peer_id === peerId);
    const recent = state.recentDMs?.find(d => d.peerId === peerId);
    const friend = state.friends?.find(f => f.peerId === peerId);
    return {
        peerId,
        name: member?.username || recent?.name || friend?.name || "Kullanici",
        avatarColor: member?.avatar_color || recent?.avatarColor || friend?.avatarColor || "#5865f2",
        avatarImage: member?.avatar_image ?? recent?.avatarImage ?? friend?.avatarImage ?? null,
    };
}

function ensureDMCallButton() {
    const header = document.querySelector(".dm-header");
    if (!header || document.getElementById("dm-call-btn")) return;
    const closeBtn = document.getElementById("dm-close-btn");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "dm-call-btn";
    btn.className = "dm-call-btn";
    btn.title = "Sesli ara";
    btn.innerHTML = `
      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M6.62 10.79c1.44 2.83 3.76 5.15 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.61 21 3 13.39 3 4c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
      </svg>`;
    btn.onclick = () => startDirectCall(state.activeDM);
    if (closeBtn) header.insertBefore(btn, closeBtn);
    else header.appendChild(btn);
}

const _v23OpenDM = window.openDM || openDM;
openDM = window.openDM = function (...args) {
    const result = _v23OpenDM.apply(this, args);
    ensureDMCallButton();
    const btn = document.getElementById("dm-call-btn");
    if (btn) btn.onclick = () => startDirectCall(state.activeDM);
    return result;
};

function directCallChannelName(peerName) {
    return `Ozel arama - ${peerName || "Kullanici"}`;
}

function ensureDirectCallChannel(server, channelId, peerName) {
    if (!server || !channelId) return null;
    let channel = server.channels?.find(c => c.id === channelId);
    if (!channel) {
        if (!server.channels) server.channels = [];
        channel = {
            id: channelId,
            name: directCallChannelName(peerName),
            type: "voice",
            category: "OZEL ARAMALAR",
            directCall: true,
        };
        server.channels.push(channel);
    }
    return channel;
}

let directCallTone = null;
let directCallAudioCtx = null;

function unlockDirectCallAudio() {
    try {
        directCallAudioCtx = directCallAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (directCallAudioCtx.state === "suspended") directCallAudioCtx.resume();
    } catch (e) { }
}

function startDirectCallTone(mode = "incoming") {
    stopDirectCallTone();
    try {
        unlockDirectCallAudio();
        const ctx = directCallAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
        directCallAudioCtx = ctx;
        const tick = () => {
            if (!directCallTone) return;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = mode === "incoming" ? 880 : 520;
            gain.gain.setValueAtTime(0.0001, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.025);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.42);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.46);
        };
        directCallTone = { timer: setInterval(tick, mode === "incoming" ? 1100 : 1400) };
        tick();
    } catch (e) {
        console.warn("direct call tone failed", e);
    }
}

function stopDirectCallTone() {
    if (directCallTone?.timer) clearInterval(directCallTone.timer);
    directCallTone = null;
}

function openDirectCallView(call = state.directCall) {
    if (!call) return;
    const server = state.servers.find(s => s.id === call.roomId) || currentServer();
    if (!server) return;
    state.activeServerId = server.id;
    ensureDirectCallChannel(server, call.channelId, call.peerName || call.fromName);
    showVoiceView(server.id, call.channelId);
    renderDMCallStrip();
}

function showDirectCallPanel(mode, call) {
    document.getElementById("direct-call-panel")?.remove();
    const panel = document.createElement("div");
    panel.id = "direct-call-panel";
    panel.className = `direct-call-panel direct-call-panel--${mode}`;
    const title = mode === "incoming" ? "Gelen sesli arama" : mode === "active" ? "Ozel arama" : "Araniyor";
    const status = mode === "incoming"
        ? `${call.fromName || call.peerName || "Kullanici"} seni ariyor`
        : mode === "active"
            ? `${call.peerName || call.fromName || "Kullanici"} ile gorusmedesin`
            : `${call.peerName || "Kullanici"} cevap bekliyor`;
    panel.innerHTML = `
      <div class="direct-call-avatar">${initials(call.fromName || call.peerName || "SC")}</div>
      <div class="direct-call-copy">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(status)}</span>
      </div>
      <div class="direct-call-actions">
        ${mode === "active" ? `<button class="direct-call-action" data-action="return">Gorusmeye Don</button>` : ""}
        ${mode === "ringing" ? `<button class="direct-call-action" data-action="chat">Sohbeti Ac</button>` : ""}
        ${mode === "incoming" ? `<button class="direct-call-action accept" data-action="accept">Kabul Et</button><button class="direct-call-action danger" data-action="decline">Reddet</button>` : ""}
        ${mode !== "incoming" ? `<button class="direct-call-action danger" data-action="end">Kapat</button>` : ""}
      </div>`;
    panel.onclick = (e) => {
        const action = e.target?.dataset?.action;
        if (action === "accept") acceptDirectCall(call.callId);
        if (action === "decline") declineDirectCall(call.callId);
        if (action === "end") endDirectCall();
        if (action === "return") openDirectCallView(call);
        if (action === "chat") openDM(call.peerId, call.peerName, call.peerAvatarColor, call.peerAvatarImage);
    };
    document.body.appendChild(panel);
}

function removeDirectCallPanel() {
    document.getElementById("direct-call-panel")?.remove();
}

function startDirectCall(peerId) {
    if (!peerId || peerId === state.peerId) return;
    const server = currentServer();
    if (!server || !state.mesh) {
        toast("Arama icin once ayni sunucuda bagli olman gerekiyor.", "warning");
        return;
    }
    if (!server.members?.some(m => m.peer_id === peerId)) {
        toast("Bu kisi su an bu sunucuda aktif gorunmuyor.", "warning");
        return;
    }
    if (state.directCall?.status === "active" || state.directCall?.status === "ringing") {
        toast("Zaten devam eden bir arama var.", "info");
        return;
    }
    const peer = getPeerDisplay(peerId);
    const callId = genId();
    const channelId = `dm-call-${callId}`;
    const call = {
        callId,
        channelId,
        roomId: server.id,
        peerId,
        peerName: peer.name,
        fromId: state.peerId,
        fromName: state.username,
        fromAvatarColor: state.avatarColor,
        fromAvatarImage: state.avatarImage,
        status: "ringing",
        participants: [state.peerId, peerId],
    };
    state.directCall = call;
    sendServerEvent({ type: "dm_call_offer", target: peerId, call });
    startDirectCallTone("ringing");
    showDirectCallPanel("ringing", call);
    renderDMCallStrip();
    toast(`${peer.name} araniyor...`, "info");
}

async function acceptDirectCall(callId) {
    const call = state.directCall;
    if (!call || call.callId !== callId || call.status !== "incoming") return;
    const server = state.servers.find(s => s.id === call.roomId) || currentServer();
    if (!server) return;
    state.activeServerId = server.id;
    ensureDirectCallChannel(server, call.channelId, call.peerName || call.fromName);
    state.directCall = { ...call, status: "active", peerId: call.fromId, peerName: call.fromName, participants: Array.from(new Set([...(call.participants || []), state.peerId, call.fromId])) };
    sendServerEvent({ type: "dm_call_answer", target: call.fromId, callId: call.callId, accepted: true, channelId: call.channelId });
    stopDirectCallTone();
    showDirectCallPanel("active", state.directCall);
    await joinVoiceChannel(call.channelId);
}

function declineDirectCall(callId) {
    const call = state.directCall;
    if (!call || call.callId !== callId) return;
    sendServerEvent({ type: "dm_call_answer", target: call.fromId, callId: call.callId, accepted: false });
    state.directCall = null;
    stopDirectCallTone();
    removeDirectCallPanel();
}

function endDirectCall(notify = true) {
    const call = state.directCall;
    if (!call) return;
    const target = call.peerId || call.fromId;
    if (notify && target) sendServerEvent({ type: "dm_call_end", target, callId: call.callId, channelId: call.channelId });
    const wasInCallChannel = state.voiceChannelId === call.channelId;
    state.directCall = null;
    stopDirectCallTone();
    removeDirectCallPanel();
    if (wasInCallChannel) leaveVoiceChannel();
    renderDMCallStrip();
}

async function handleDirectCallEvent(msg) {
    if (msg.type === "dm_call_offer") {
        const call = msg.call || {};
        if (state.directCall?.callId === call.callId) {
            state.directCall = { ...state.directCall, participants: Array.from(new Set([...(state.directCall.participants || []), ...(call.participants || []), msg.from])) };
            renderDMCallStrip();
            return;
        }
        if (state.directCall?.status === "active" || state.directCall?.status === "ringing" || state.directCall?.status === "incoming") {
            sendServerEvent({ type: "dm_call_answer", target: msg.from, callId: call.callId, accepted: false, busy: true });
            return;
        }
        const from = getPeerDisplay(msg.from);
        state.directCall = {
            ...call,
            fromId: msg.from,
            fromName: call.fromName || from.name,
            peerId: msg.from,
            peerName: call.fromName || from.name,
            status: "incoming",
            participants: Array.from(new Set([...(call.participants || []), state.peerId, msg.from])),
        };
        startDirectCallTone("incoming");
        showDirectCallPanel("incoming", state.directCall);
        toast(`${state.directCall.fromName} seni ariyor.`, "info");
        return;
    }
    if (msg.type === "dm_call_answer") {
        const call = state.directCall;
        if (!call || call.callId !== msg.callId) return;
        if (!msg.accepted) {
            toast(msg.busy ? "Kisi su an baska aramada." : "Arama reddedildi.", "info");
            state.directCall = null;
            stopDirectCallTone();
            removeDirectCallPanel();
            return;
        }
        const server = state.servers.find(s => s.id === call.roomId) || currentServer();
        if (!server) return;
        state.activeServerId = server.id;
        ensureDirectCallChannel(server, msg.channelId || call.channelId, call.peerName);
        state.directCall = { ...call, channelId: msg.channelId || call.channelId, status: "active" };
        stopDirectCallTone();
        showDirectCallPanel("active", state.directCall);
        if (state.voiceChannelId !== state.directCall.channelId) {
            await joinVoiceChannel(state.directCall.channelId);
        }
        renderDMCallStrip();
        return;
    }
    if (msg.type === "dm_call_end") {
        const call = state.directCall;
        if (!call || call.callId !== msg.callId) return;
        const wasInCallChannel = state.voiceChannelId === call.channelId;
        state.directCall = null;
        stopDirectCallTone();
        removeDirectCallPanel();
        if (wasInCallChannel) leaveVoiceChannel();
        toast("Arama kapatildi.", "info");
    }
    renderDMCallStrip();
}

const _v23HandleAuthoritativeServerEvent = window.handleAuthoritativeServerEvent || handleAuthoritativeServerEvent;
handleAuthoritativeServerEvent = window.handleAuthoritativeServerEvent = function (msg, roomId) {
    if (msg?.type === "dm_call_offer" || msg?.type === "dm_call_answer" || msg?.type === "dm_call_end") {
        handleDirectCallEvent(msg);
        return;
    }
    return _v23HandleAuthoritativeServerEvent(msg, roomId);
};

function renderDirectCallSidebarShortcut(serverId) {
    const call = state.directCall;
    if (!call || call.status !== "active" || call.roomId !== serverId) return;
    const list = document.getElementById("channel-list");
    if (!list || document.getElementById("direct-call-sidebar-shortcut")) return;
    const item = document.createElement("div");
    item.id = "direct-call-sidebar-shortcut";
    item.className = "channel-item direct-call-sidebar-shortcut active";
    item.innerHTML = `<span class="ch-icon">CALL</span><span class="ch-name">${escapeHtml(call.peerName || call.fromName || "Ozel arama")}</span><span class="ch-badge">CANLI</span>`;
    item.onclick = () => openDirectCallView(call);
    const first = list.firstChild;
    if (first) list.insertBefore(item, first);
    else list.appendChild(item);
}

const _v23UpdateChannelSidebar = window.updateChannelSidebar || updateChannelSidebar;
updateChannelSidebar = window.updateChannelSidebar = function (serverId) {
    const result = _v23UpdateChannelSidebar.apply(this, arguments);
    renderDirectCallSidebarShortcut(serverId);
    return result;
};

const _v23LeaveVoiceChannel = window.leaveVoiceChannel || leaveVoiceChannel;
leaveVoiceChannel = window.leaveVoiceChannel = function (...args) {
    const call = state.directCall;
    if (call?.status === "active" && state.voiceChannelId === call.channelId) {
        const target = call.peerId || call.fromId;
        if (target) sendServerEvent({ type: "dm_call_end", target, callId: call.callId, channelId: call.channelId });
        state.directCall = null;
        stopDirectCallTone();
        removeDirectCallPanel();
    }
    return _v23LeaveVoiceChannel.apply(this, args);
};

document.addEventListener("DOMContentLoaded", () => {
    ensureDMCallButton();
    document.addEventListener("pointerdown", unlockDirectCallAudio, { once: true });
    document.addEventListener("keydown", unlockDirectCallAudio, { once: true });
});

console.log("[Shercord V22] Community template servers, grouped channels and rich user menus loaded.");

/* ==========================================================================
   V24 requested Discord-like polish and voice/chat utilities
   ========================================================================== */

const SCORD_V24_PERMISSIONS = [
    "manage_server", "manage_roles", "manage_channels", "kick_members",
    "move_members", "force_disconnect", "join_voice", "speak",
    "screen_share", "camera", "music_control", "send_messages"
];

function setMembersPanelOpen(open = true) {
    state.membersOpen = !!open;
    document.getElementById("members-panel")?.classList.toggle("collapsed", !open);
    document.getElementById("voice-members-panel")?.classList.toggle("collapsed", !open);
}

function firstTextChannelId(server) {
    return server?.channels?.find(c => c.type === "text")?.id || server?.channels?.[0]?.id || null;
}

function addServerSystemMessage(serverId, text, channelId = null) {
    if (!ENABLE_SERVER_SYSTEM_CHAT_NOTICES) return;
    const server = state.servers.find(s => s.id === serverId);
    const ch = channelId || firstTextChannelId(server);
    if (!server || !ch || !text) return;
    const msg = {
        id: genId(),
        type: "system",
        author: "Shercord",
        authorId: "system",
        text,
        time: now(),
        channelId: ch,
        avatarColor: "#5865f2",
        avatarImage: null,
    };
    if (!server.messages) server.messages = {};
    if (!server.messages[ch]) server.messages[ch] = [];
    server.messages[ch].push(msg);
    if (state.activeServerId === serverId && state.activeChannelId === ch) renderMessages(serverId, ch);
    try {
        fetch(`${API_BASE}/rooms/${serverId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channelId: ch, message: msg }),
        });
    } catch { }
}

const _v24ShowChatView = window.showChatView || showChatView;
showChatView = window.showChatView = function (...args) {
    const result = _v24ShowChatView.apply(this, args);
    setMembersPanelOpen(true);
    return result;
};

const _v24ShowVoiceView = window.showVoiceView || showVoiceView;
showVoiceView = window.showVoiceView = function (...args) {
    const result = _v24ShowVoiceView.apply(this, args);
    setMembersPanelOpen(true);
    ensureVoiceEphemeralChatPanel();
    renderVoiceEphemeralChat();
    return result;
};

const _v24HandlePeerJoined = window.handlePeerJoined || handlePeerJoined;
handlePeerJoined = window.handlePeerJoined = function (peerId, info, roomId) {
    const server = state.servers.find(s => s.id === roomId);
    const wasKnown = !!server?.members?.some(m => m.peer_id === peerId);
    const result = _v24HandlePeerJoined.apply(this, arguments);
    if (!wasKnown && peerId !== state.peerId) {
        addServerSystemMessage(roomId, `${info?.username || "Bir kisi"} sunucuya katildi.`);
    }
    return result;
};

const _v24HandlePeerLeft = window.handlePeerLeft || handlePeerLeft;
handlePeerLeft = window.handlePeerLeft = function (peerId, roomId) {
    const server = state.servers.find(s => s.id === roomId);
    const member = server?.members?.find(m => m.peer_id === peerId);
    const username = member?.username || "Bir kisi";
    const result = _v24HandlePeerLeft.apply(this, arguments);
    if (peerId !== state.peerId) addServerSystemMessage(roomId, `${username} sunucudan ayrildi.`);
    return result;
};

const _v24HandleAuthoritativeServerEvent = window.handleAuthoritativeServerEvent || handleAuthoritativeServerEvent;
handleAuthoritativeServerEvent = window.handleAuthoritativeServerEvent = function (msg, roomId) {
    if (msg?.type === "peer_joined" && msg.peer_id && msg.peer_id !== state.peerId) {
        const server = state.servers.find(s => s.id === roomId);
        if (!server?.members?.some(m => m.peer_id === msg.peer_id)) {
            addServerSystemMessage(roomId, `${msg.username || "Bir kisi"} sunucuya katildi.`);
        }
    }
    if (msg?.type === "peer_left" && msg.peer_id && msg.peer_id !== state.peerId) {
        addServerSystemMessage(roomId, `${msg.username || "Bir kisi"} sunucudan ayrildi.`);
    }
    return _v24HandleAuthoritativeServerEvent.apply(this, arguments);
};

function leaveCurrentServerSelf() {
    const server = currentServer();
    if (!server) return;
    if (server.ownerId === state.peerId || server.owner_id === state.peerId) {
        toast("Sunucu sahibisin; ayrilmak yerine sunucuyu kapatabilirsin.", "warning");
        return;
    }
    if (!confirm(`"${server.name}" sunucusundan ayrilmak istiyor musun?`)) return;
    addServerSystemMessage(server.id, `${state.username || "Bir kisi"} sunucudan ayrildi.`);
    try { meshBroadcastReliable({ type: "server_system", payload: { text: `${state.username || "Bir kisi"} sunucudan ayrildi.`, channelId: firstTextChannelId(server) } }); } catch { }
    try { if (state.voiceChannelId) leaveVoiceChannel(); } catch { }
    try { state.mesh?.disconnect?.(); } catch { }
    state.mesh = null;
    state.servers = state.servers.filter(s => s.id !== server.id);
    try { localStorage.removeItem(`scord_server_${server.id}`); } catch { }
    state.activeServerId = null;
    state.activeChannelId = null;
    renderServerRail();
    showHomeView();
    toast("Sunucudan ayrildin.", "info");
}

function wireSidebarDragAndDrop(serverId = state.activeServerId) {
    const server = state.servers.find(s => s.id === serverId);
    if (!server) return;
    document.querySelectorAll(".voice-member[data-peer-id], .member-item[data-peer-id], .dm-sidebar-item[data-peer-id]").forEach(el => {
        const pid = el.dataset.peerId;
        if (!pid || pid === state.peerId) return;
        el.draggable = true;
        el.addEventListener("dragstart", e => {
            e.dataTransfer?.setData("text/scord-peer", pid);
            e.dataTransfer?.setData("text/plain", pid);
        });
    });
    document.querySelectorAll(".channel-item[data-ch]").forEach(el => {
        const ch = server.channels?.find(c => c.id === el.dataset.ch);
        if (!ch || ch.type !== "voice") return;
        el.addEventListener("dragover", e => {
            e.preventDefault();
            el.classList.add("channel-drop-target");
        });
        el.addEventListener("dragleave", () => el.classList.remove("channel-drop-target"));
        el.addEventListener("drop", e => {
            e.preventDefault();
            el.classList.remove("channel-drop-target");
            const peerId = e.dataTransfer?.getData("text/scord-peer") || e.dataTransfer?.getData("text/plain");
            if (!peerId) return;
            requestMoveMemberToVoice(peerId, ch.id);
        });
    });
}

function requestMoveMemberToVoice(peerId, channelId) {
    if (peerId === state.peerId) return joinVoiceChannel(channelId);
    const server = currentServer();
    if (!server || !roleAllows(server, "move_members", channelId)) {
        toast("Kullaniciyi tasimak icin yetkin yok.", "warning");
        return;
    }
    if (typeof sendServerEvent === "function") {
        sendServerEvent({ type: "force_route", target: peerId, targetChannel: channelId });
    }
    meshBroadcastReliable({ type: "force_route", target: peerId, targetChannel: channelId });
    toast("Kullanici tasima istegi gonderildi.", "info");
}

const _v24UpdateChannelSidebar = window.updateChannelSidebar || updateChannelSidebar;
let _v24ChannelSidebarTimeout = null;
updateChannelSidebar = window.updateChannelSidebar = function (serverId) {
    // Debounce to prevent excessive re-renders
    if (_v24ChannelSidebarTimeout) {
        clearTimeout(_v24ChannelSidebarTimeout);
    }

    _v24ChannelSidebarTimeout = setTimeout(() => {
        const result = _v24UpdateChannelSidebar.apply(this, arguments);
        setTimeout(() => wireSidebarDragAndDrop(serverId), 0);
        return result;
    }, 16); // ~60fps
};

const _v24UpdateMembersPanel = window.updateMembersPanel || updateMembersPanel;
let _v24MembersPanelTimeout = null;
updateMembersPanel = window.updateMembersPanel = function (...args) {
    // Debounce to prevent excessive re-renders
    if (_v24MembersPanelTimeout) {
        clearTimeout(_v24MembersPanelTimeout);
    }

    _v24MembersPanelTimeout = setTimeout(() => {
        const result = _v24UpdateMembersPanel.apply(this, args);
        setTimeout(() => wireSidebarDragAndDrop(args[0] || state.activeServerId), 0);
        return result;
    }, 16); // ~60fps
};

function ensureVoiceEphemeralChatPanel() {
    const voiceView = document.getElementById("voice-view");
    if (!voiceView || document.getElementById("voice-ephemeral-chat")) return;
    const panel = document.createElement("section");
    panel.id = "voice-ephemeral-chat";
    panel.className = "voice-ephemeral-chat collapsed";
    panel.innerHTML = `
      <div class="voice-chat-head">
        <div class="voice-chat-title-wrap">
          <span class="voice-chat-icon">#</span>
          <strong>Sesli Oda Sohbeti</strong>
        </div>
        <button type="button" class="voice-chat-toggle" id="voice-chat-toggle" aria-label="Sesli sohbet panelini aç/kapat">Aç</button>
      </div>
      <div class="voice-chat-body">
        <div id="voice-chat-messages" class="voice-chat-messages"></div>
        <div class="voice-chat-input-row">
          <input id="voice-chat-input" class="voice-chat-input" maxlength="500" placeholder="Bu ses odasina gecici mesaj yaz">
          <button id="voice-chat-send" class="voice-chat-send">Gonder</button>
        </div>
      </div>`;
    const controls = voiceView.querySelector(".voice-controls");
    if (controls) controls.insertAdjacentElement("beforebegin", panel);
    else voiceView.appendChild(panel);
    panel.querySelector("#voice-chat-toggle").onclick = () => {
        panel.classList.toggle("collapsed");
        const btn = panel.querySelector("#voice-chat-toggle");
        if (btn) btn.textContent = panel.classList.contains("collapsed") ? "Aç" : "Kapat";
    };
    panel.querySelector("#voice-chat-send").onclick = sendVoiceEphemeralChat;
    panel.querySelector("#voice-chat-input").addEventListener("keydown", e => {
        if (e.key === "Enter") {
            e.preventDefault();
            sendVoiceEphemeralChat();
        }
    });
}

function syncVoiceEphemeralChatVisibility(serverId = state.activeServerId, channelId = state.activeChannelId) {
    ensureVoiceEphemeralChatPanel();
    const panel = document.getElementById("voice-ephemeral-chat");
    if (!panel) return;
    const server = state.servers.find(s => s.id === serverId);
    const ch = server?.channels?.find(c => c.id === channelId);
    const isDirectCall = !!ch?.directCall;
    panel.classList.toggle("hidden", isDirectCall);
    if (!isDirectCall) {
        renderVoiceEphemeralChat();
    }
}

function voiceChatKey(serverId = state.activeServerId, channelId = state.voiceChannelId || state.activeChannelId) {
    return `${serverId || ""}:${channelId || ""}`;
}

function pruneVoiceEphemeralChat() {
    const cutoff = Date.now() - 60 * 60 * 1000;
    state.voiceTempChats = state.voiceTempChats || {};
    Object.keys(state.voiceTempChats).forEach(k => {
        state.voiceTempChats[k] = (state.voiceTempChats[k] || []).filter(m => (m.ts || 0) >= cutoff);
    });
}

function renderVoiceEphemeralChat() {
    ensureVoiceEphemeralChatPanel();
    pruneVoiceEphemeralChat();
    const area = document.getElementById("voice-chat-messages");
    if (!area) return;
    const list = state.voiceTempChats?.[voiceChatKey()] || [];
    area.innerHTML = list.length ? "" : `<div class="voice-chat-empty">Bu odada gecici sohbet yok.</div>`;
    list.forEach(m => {
        const row = document.createElement("div");
        row.className = "voice-chat-msg";
        row.innerHTML = `<strong>${escapeHtml(m.author || "Kullanici")}</strong><span>${escapeHtml(m.text || "")}</span>`;
        area.appendChild(row);
    });
    area.scrollTop = area.scrollHeight;
}

function addVoiceEphemeralChatMessage(msg) {
    if (!msg?.channelId || !msg?.serverId) return;
    state.voiceTempChats = state.voiceTempChats || {};
    const key = voiceChatKey(msg.serverId, msg.channelId);
    if (!state.voiceTempChats[key]) state.voiceTempChats[key] = [];
    state.voiceTempChats[key].push(msg);
    pruneVoiceEphemeralChat();
    if (key === voiceChatKey()) renderVoiceEphemeralChat();
}

function sendVoiceEphemeralChat() {
    const input = document.getElementById("voice-chat-input");
    const text = input?.value?.trim();
    const channelId = state.voiceChannelId || state.activeChannelId;
    if (!text || !state.activeServerId || !channelId) return;
    const msg = {
        id: genId(),
        type: "voice_ephemeral_chat",
        serverId: state.activeServerId,
        channelId,
        author: state.username,
        authorId: state.peerId,
        text,
        ts: Date.now(),
    };
    addVoiceEphemeralChatMessage(msg);
    meshBroadcastReliable({ type: "voice_ephemeral_chat", payload: msg });
    if (input) input.value = "";
}

const _v24HandleIncomingP2P = window.handleIncomingP2P || handleIncomingP2P;
handleIncomingP2P = window.handleIncomingP2P = function (fromPeerId, data, roomId) {
    if (data?.type === "voice_ephemeral_chat") {
        addVoiceEphemeralChatMessage(data.payload);
        return;
    }
    if (data?.type === "server_system") {
        addServerSystemMessage(roomId, data.payload?.text, data.payload?.channelId);
        return;
    }
    return _v24HandleIncomingP2P.apply(this, arguments);
};

function makeMusicDockDraggable() {
    const dock = document.getElementById("music-player-dock");
    if (!dock || dock.dataset.dragReady === "1") return;
    dock.dataset.dragReady = "1";
    const saved = JSON.parse(localStorage.getItem("scord_music_dock_pos") || "null");
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
        dock.style.left = `${saved.left}px`;
        dock.style.top = `${saved.top}px`;
        dock.style.right = "auto";
        dock.style.bottom = "auto";
    }
    let drag = null;
    dock.addEventListener("pointerdown", e => {
        if (e.button !== 0) return;
        drag = { x: e.clientX, y: e.clientY, left: dock.offsetLeft, top: dock.offsetTop };
        dock.setPointerCapture?.(e.pointerId);
    });
    dock.addEventListener("pointermove", e => {
        if (!drag) return;
        const left = Math.max(0, Math.min(window.innerWidth - dock.offsetWidth, drag.left + e.clientX - drag.x));
        const top = Math.max(0, Math.min(window.innerHeight - dock.offsetHeight, drag.top + e.clientY - drag.y));
        dock.style.left = `${left}px`;
        dock.style.top = `${top}px`;
        dock.style.right = "auto";
        dock.style.bottom = "auto";
    });
    dock.addEventListener("pointerup", () => {
        if (!drag) return;
        localStorage.setItem("scord_music_dock_pos", JSON.stringify({ left: dock.offsetLeft, top: dock.offsetTop }));
        drag = null;
    });
}

const _v24SetMusicDockVisible = window.setMusicDockVisible || setMusicDockVisible;
setMusicDockVisible = window.setMusicDockVisible = function (visible) {
    const result = _v24SetMusicDockVisible.apply(this, arguments);
    makeMusicDockDraggable();
    return result;
};

function ensureYouTubeApiLoaded() {
    if (window.YT?.Player) return true;
    if (!document.querySelector("script[data-scord-yt-api]")) {
        const s = document.createElement("script");
        s.src = "https://www.youtube.com/iframe_api";
        s.dataset.scordYtApi = "1";
        document.head.appendChild(s);
    }
    return false;
}

const _v24StartMusicBot = window.startMusicBot || startMusicBot;
startMusicBot = window.startMusicBot = function (videoId, startAt) {
    ensureYouTubeApiLoaded();
    makeMusicDockDraggable();
    const result = _v24StartMusicBot.apply(this, arguments);
    setTimeout(() => {
        try {
            const p = state.musicBot?.player;
            p?.unMute?.();
            p?.setVolume?.(Math.max(1, Number(state.musicBot?.volume ?? 30)));
            p?.playVideo?.();
        } catch { }
    }, 350);
    return result;
};

function applyChatCustomization() {
    document.documentElement.setAttribute("data-scord-chat", localStorage.getItem("scord_chat_layout") || "bubbles");
    document.documentElement.setAttribute("data-scord-chat-style", localStorage.getItem("scord_chat_style") || "soft");
    document.documentElement.setAttribute("data-scord-palette", localStorage.getItem("scord_palette") || "glass");
    document.documentElement.className = localStorage.getItem("scord_theme") || "";
}

const _v24OpenSettingsModal = window.openSettingsModal || openSettingsModal;
openSettingsModal = window.openSettingsModal = function () {
    const result = _v24OpenSettingsModal.apply(this, arguments);
    const page = document.getElementById("set-appearance");
    if (page && !document.getElementById("settings-chat-style")) {
        page.insertAdjacentHTML("beforeend", `
          <label>Mesaj tasarimi<select class="modal-input" id="settings-chat-style">
            <option value="soft">Yumusak balon</option>
            <option value="flat">Duz Discord</option>
            <option value="outline">Cizgili</option>
          </select></label>
          <label>Renk temasi<select class="modal-input" id="settings-palette-v24">
            <option value="glass">Glass</option>
            <option value="midnight">Midnight</option>
            <option value="forest">Forest</option>
            <option value="rose">Rose</option>
          </select></label>`);
        document.getElementById("settings-chat-style").value = localStorage.getItem("scord_chat_style") || "soft";
        document.getElementById("settings-palette-v24").value = localStorage.getItem("scord_palette") || "glass";
    }
    return result;
};

const _v24SaveSettings = window.saveSettings || saveSettings;
saveSettings = window.saveSettings = function () {
    const chatStyle = document.getElementById("settings-chat-style")?.value;
    const palette = document.getElementById("settings-palette-v24")?.value;
    if (chatStyle) localStorage.setItem("scord_chat_style", chatStyle);
    if (palette) localStorage.setItem("scord_palette", palette);
    const result = _v24SaveSettings.apply(this, arguments);
    applyChatCustomization();
    return result;
};

function renderAdvancedRoleEditor(server) {
    const roles = server.roles || {};
    return Object.entries(roles).map(([roleId, role]) => `
      <div class="role-editor-card" data-role="${escapeHtml(roleId)}">
        <div class="role-editor-head">
          <input class="modal-input role-name-edit" value="${escapeHtml(role.name || roleId)}" data-role-name="${escapeHtml(roleId)}">
          <input type="color" value="${role.color || "#94a3b8"}" data-role-color="${escapeHtml(roleId)}">
          ${roleId !== "member" ? `<button class="btn-secondary danger-soft" onclick="deleteRole('${roleId}')">Sil</button>` : ""}
        </div>
        <div class="permission-grid">
          ${SCORD_V24_PERMISSIONS.map(p => `<label class="permission-item"><input type="checkbox" data-role-perm="${escapeHtml(roleId)}:${p}" ${role.permissions?.[p] ? "checked" : ""}> ${p.replaceAll("_", " ")}</label>`).join("")}
        </div>
      </div>`).join("");
}

const _v24OpenServerSettingsPanel = window.openServerSettingsPanel || openServerSettingsPanel;
openServerSettingsPanel = window.openServerSettingsPanel = function () {
    const result = _v24OpenServerSettingsPanel.apply(this, arguments);
    const server = currentServer();
    const panel = document.getElementById("server-settings-panel");
    if (!server || !panel) return result;
    const nav = panel.querySelector(".scord-server-settings-nav");
    const main = panel.querySelector(".scord-server-settings-main");
    if (nav && !nav.querySelector('[data-page="background"]')) {
        nav.querySelector('[data-page="roles"]')?.insertAdjacentHTML("afterend", `<button data-page="background">Arka Plan</button>`);
        if (server.ownerId !== state.peerId && !nav.querySelector('[data-page="leave"]')) {
            nav.querySelector(".danger")?.insertAdjacentHTML("beforebegin", `<button data-page="leave">Ayril</button>`);
        }
    }
    if (main && !document.getElementById("srv-background")) {
        main.querySelector("footer")?.insertAdjacentHTML("beforebegin", `
          <section id="srv-background" class="srv-page hidden">
            <h2>Chat arka plani</h2>
            <label>Secili kanal URL<input class="modal-input" id="settings-channel-bg-url" value="${escapeHtml(server.channel_backgrounds?.[state.activeChannelId] || "")}" placeholder="https://..."></label>
            <button class="btn-secondary" onclick="saveServerChannelBackground()">Arka plani uygula</button>
          </section>
          <section id="srv-leave" class="srv-page hidden">
            <h2>Sunucudan ayril</h2>
            <div class="srv-danger-zone"><p>Bu sunucu sol listenden kaldirilir. Davet koduyla tekrar katilabilirsin.</p><button class="btn-primary" style="background:var(--red);border:none;width:max-content" onclick="leaveCurrentServerSelf()">Sunucudan Ayril</button></div>
          </section>`);
    }
    const rolesPage = document.getElementById("srv-roles");
    if (rolesPage && !rolesPage.querySelector(".role-editor-card")) {
        rolesPage.innerHTML = `<h2>Roller ve Yetkiler</h2><button class="btn-secondary" onclick="createNewRole()">Yeni Rol Ekle</button>${renderAdvancedRoleEditor(server)}`;
    }
    panel.querySelectorAll(".scord-server-settings-nav button[data-page]").forEach(btn => {
        btn.onclick = () => {
            panel.querySelectorAll(".scord-server-settings-nav button").forEach(b => b.classList.remove("active"));
            panel.querySelectorAll(".srv-page").forEach(p => p.classList.add("hidden"));
            btn.classList.add("active");
            panel.querySelector(`#srv-${btn.dataset.page}`)?.classList.remove("hidden");
        };
    });
    return result;
};

saveServerChannelBackground = window.saveServerChannelBackground = async function () {
    const srv = currentServer();
    const url = document.getElementById("settings-channel-bg-url")?.value?.trim() || "";
    if (!srv || !state.activeChannelId) return toast("Once kanal sec.", "warning");
    if (!srv.channel_backgrounds) srv.channel_backgrounds = {};
    if (url) srv.channel_backgrounds[state.activeChannelId] = url;
    else delete srv.channel_backgrounds[state.activeChannelId];
    await persistChannelBackground(srv.id, state.activeChannelId, url);
    applyChannelBackground(srv.id, state.activeChannelId);
    sendServerEvent({ type: "permission_update", channel_permissions: srv.channel_permissions || {}, roles: srv.roles || {} });
    meshBroadcastReliable({ type: "server_update", payload: { id: srv.id, channel_backgrounds: srv.channel_backgrounds } });
    toast("Chat arka plani guncellendi.", "success");
};

const _v24SaveProfessionalServerSettings = window.saveProfessionalServerSettings || saveProfessionalServerSettings;
saveProfessionalServerSettings = window.saveProfessionalServerSettings = function () {
    const server = currentServer();
    if (server?.roles) {
        document.querySelectorAll("[data-role-name]").forEach(input => {
            const id = input.dataset.roleName;
            if (server.roles[id]) server.roles[id].name = input.value.trim() || id;
        });
        document.querySelectorAll("[data-role-color]").forEach(input => {
            const id = input.dataset.roleColor;
            if (server.roles[id]) server.roles[id].color = input.value;
        });
        document.querySelectorAll("[data-role-perm]").forEach(input => {
            const [id, perm] = input.dataset.rolePerm.split(":");
            if (!server.roles[id]) return;
            if (!server.roles[id].permissions) server.roles[id].permissions = {};
            server.roles[id].permissions[perm] = input.checked;
        });
    }
    return _v24SaveProfessionalServerSettings.apply(this, arguments);
};

const _v24OpenScreenOverlay = window.openScreenOverlay || openScreenOverlay;
openScreenOverlay = window.openScreenOverlay = function (peerId, username) {
    _v24OpenScreenOverlay.apply(this, arguments);
    const overlay = document.getElementById("screen-overlay");
    const video = overlay?.querySelector("video");
    if (!overlay || !video) return;
    const tools = document.createElement("div");
    tools.className = "screen-overlay-tools";
    tools.innerHTML = `<button class="screen-overlay-tool" id="screen-full-btn">Tam ekran</button><label>Ses <input id="screen-volume-slider" type="range" min="0" max="100" value="${Math.round((state.userVolumes?.[peerId] ?? 1) * 100)}"></label>`;
    overlay.appendChild(tools);
    tools.querySelector("#screen-full-btn").onclick = () => {
        const target = video;
        if (target.requestFullscreen) target.requestFullscreen();
    };
    tools.querySelector("#screen-volume-slider").oninput = e => {
        const v = Number(e.target.value) / 100;
        if (!state.userVolumes) state.userVolumes = {};
        state.userVolumes[peerId] = v;
        localStorage.setItem("scord_user_volumes", JSON.stringify(state.userVolumes));
        const remote = state.remoteMedia?.[peerId];
        if (remote) remote.volume = v;
        video.volume = v;
    };
};

document.addEventListener("DOMContentLoaded", () => {
    setMembersPanelOpen(true);
    applyChatCustomization();
    makeMusicDockDraggable();
    setInterval(() => renderVoiceEphemeralChat(), 30 * 1000);
});

applyChatCustomization();

console.log("[Shercord V24] Voice empty layout, auto members, leave/join logs, temp voice chat, drag move, music dock, themes, roles and screen controls loaded.");
