(function () {
    "use strict";
    console.log("[Fixes V2] Initializing comprehensive fixes...");

    // 1. MUSIC BOT FIX (Moved to fixes.js)

    // 2. DM CALL STABILITY & AUDIO
    function applyDMCallFix() {
        const origHandleP2P = window.handleIncomingP2P;
        if (origHandleP2P && !window._dmCallFixApplied) {
            window._dmCallFixApplied = true;
            window.handleIncomingP2P = function(fromPeerId, data, roomId) {
                if (data && data.type === "call_signal") {
                    console.log("[Fixes V2] Intercepted call signal from", fromPeerId);
                }
                return origHandleP2P.apply(this, arguments);
            };
        }
        
        // Ensure DM overlay doesn't block audio
        const checkOverlay = setInterval(() => {
            const audioElements = document.querySelectorAll("audio, video");
            audioElements.forEach(el => {
                if (el.muted && el.srcObject && el.classList.contains("voice-video")) {
                    el.muted = false; // Force unmute remote audio
                }
            });
        }, 2000);
    }

    // 3. OFFLINE STATUS DETECTION
    function applyStatusFix() {
        setInterval(() => {
            if (!window.state || !window.state.peerStatuses) return;
            const now = Date.now();
            let changed = false;
            Object.keys(window.state.peerStatuses).forEach(pid => {
                const p = window.state.peerStatuses[pid];
                // If no update for 45 seconds, mark offline
                if (p.status !== "offline" && (now - (p.lastSeen || 0)) > 45000) {
                    p.status = "offline";
                    changed = true;
                }
            });
            if (changed && window.state.activeServerId && typeof window.updateMembersPanel === "function") {
                window.updateMembersPanel(window.state.activeServerId);
            }
            
            // Re-broadcast queued friend requests when peers are online
            if (window.state && window.state.mesh && window.state.mesh.peers) {
                try {
                    let queued = JSON.parse(localStorage.getItem("scord_queued_friend_requests") || "[]");
                    if (queued.length > 0) {
                        let toKeep = [];
                        queued.forEach(req => {
                            if (Date.now() - req.timestamp > 7 * 24 * 60 * 60 * 1000) return; // drop after 7 days
                            // Broadcast if we have peers
                            if (Object.keys(window.state.mesh.peers).length > 0) {
                                window.state.mesh.broadcast(req.payload);
                                // remove from queue
                            } else {
                                toKeep.push(req);
                            }
                        });
                        localStorage.setItem("scord_queued_friend_requests", JSON.stringify(toKeep));
                    }
                } catch (e) {
                    console.error("[Fixes V2] Queue error", e);
                }
            }
        }, 10000);

        // Offline Friend Request hook
        setInterval(() => {
            if (!window._offlineFrHooked && typeof window.sendFriendRequest === "function") {
                window._offlineFrHooked = true;
                const origFr = window.sendFriendRequest;
                window.sendFriendRequest = function (targetPeerId, targetTag) {
                    if (!window.state || !window.state.mesh || Object.keys(window.state.mesh.peers || {}).length === 0) {
                        // Offline queue
                        const reqPayload = {
                            type: "friend_request",
                            from: window.state.peerId,
                            username: window.state.username || "Anonim",
                            tag: window.state._discriminator || "0000",
                            targetTag: targetTag,
                            timestamp: Date.now()
                        };
                        try {
                            let queued = JSON.parse(localStorage.getItem("scord_queued_friend_requests") || "[]");
                            queued.push({ timestamp: Date.now(), payload: reqPayload });
                            localStorage.setItem("scord_queued_friend_requests", JSON.stringify(queued));
                            if (typeof window.toast === "function") {
                                window.toast("Bağlantı zayıf, istek sıraya alındı. Çevrimiçi olunduğunda iletilecek.", "info");
                            }
                        } catch (e) {}
                        
                        if (!window.state._friendRequests) window.state._friendRequests = [];
                        window.state._friendRequests.push({ peerId: targetPeerId, tag: targetTag, timestamp: Date.now() });
                        localStorage.setItem("scord_friend_requests", JSON.stringify(window.state._friendRequests));
                        return;
                    }
                    return origFr.apply(this, arguments);
                };
            }
        }, 2000);

        // Status Update broadcasting hook
        setInterval(() => {
            if (!window._statusUpdateHooked && typeof window.setStatus === "function") {
                window._statusUpdateHooked = true;
                const origSetStatus = window.setStatus;
                let statusDebounce = null;
                window.setStatus = function (newStatus, customStatus, statusEmoji) {
                    origSetStatus.apply(this, arguments);
                    
                    if (window.state) {
                        window.state.status = newStatus || window.state.status || "online";
                        window.state.customStatus = customStatus || "";
                        window.state.statusEmoji = statusEmoji || "";
                        
                        if (typeof window.updateStatusBar === "function") {
                            window.updateStatusBar();
                        }
                        
                        if (window.state.mesh) {
                            clearTimeout(statusDebounce);
                            statusDebounce = setTimeout(() => {
                                window.state.mesh.broadcast({
                                    type: "user_status",
                                    status: window.state.status,
                                    customStatus: window.state.customStatus
                                });
                            }, 500); // 500ms debounce to prevent P2P spam
                        }
                    }
                };
            }
        }, 2000);
    }

    // 4. VOICE EFFECTS
    function applyVoiceEffects() {
        if (window._voiceEffectsApplied) return;
        window._voiceEffectsApplied = true;

        window.currentVoiceEffect = "normal";
        window.audioContext = null;

        function initAudioContext() {
            if (!window.audioContext) {
                window.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (window.audioContext.state === "suspended") {
                window.audioContext.resume();
            }
        }

        window.applyEffectToStream = function(stream) {
            initAudioContext();
            const ctx = window.audioContext;
            const source = ctx.createMediaStreamSource(stream);
            const dest = ctx.createMediaStreamDestination();

            if (window.currentVoiceEffect === "normal") {
                source.connect(dest);
                return dest.stream;
            }

            if (window.currentVoiceEffect === "robot") {
                const osc = ctx.createOscillator();
                osc.type = "sawtooth";
                osc.frequency.value = 50;
                const gain = ctx.createGain();
                source.connect(gain);
                osc.connect(gain.gain);
                gain.connect(dest);
                osc.start();
            } else if (window.currentVoiceEffect === "deep") {
                const filter = ctx.createBiquadFilter();
                filter.type = "lowshelf";
                filter.frequency.value = 400;
                filter.gain.value = 15;
                source.connect(filter);
                filter.connect(dest);
            } else if (window.currentVoiceEffect === "echo") {
                const delay = ctx.createDelay();
                delay.delayTime.value = 0.3;
                const feedback = ctx.createGain();
                feedback.gain.value = 0.4;
                source.connect(delay);
                delay.connect(feedback);
                feedback.connect(delay);
                source.connect(dest);
                delay.connect(dest);
            } else {
                source.connect(dest);
            }

            return dest.stream;
        };

        const obs = new MutationObserver(() => {
            const voiceControls = document.querySelector(".voice-controls");
            if (voiceControls && !document.getElementById("voice-effect-btn")) {
                const btn = document.createElement("button");
                btn.id = "voice-effect-btn";
                btn.className = "ctrl-btn";
                btn.innerHTML = "🎙️ Efekt";
                btn.title = "Ses Efekti Seç";
                btn.onclick = () => {
                    const effects = {
                        normal: "Normal",
                        robot: "Robot 🤖",
                        deep: "Kalın Ses 👹",
                        echo: "Eko ⛰️"
                    };
                    let html = '<div style="display:flex; flex-direction:column; gap:8px;">';
                    Object.keys(effects).forEach(k => {
                        const active = window.currentVoiceEffect === k ? 'background:var(--accent);' : 'background:rgba(255,255,255,0.1);';
                        html += \`<button style="padding:10px; border:none; border-radius:6px; color:#fff; cursor:pointer; font-weight:bold; transition:all 0.2s; \${active}" onclick="window.setVoiceEffect('\${k}')">\${effects[k]}</button>\`;
                    });
                    html += '</div>';
                    if (typeof window.showModal === "function") {
                        window.showModal("Ses Efektleri", html, '<button class="btn-secondary" onclick="window.hideModal()">Kapat</button>');
                    }
                };
                voiceControls.insertBefore(btn, voiceControls.firstChild);
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });

        window.setVoiceEffect = function(eff) {
            window.currentVoiceEffect = eff;
            if (typeof window.hideModal === "function") window.hideModal();
            if (typeof window.toast === "function") window.toast("Ses efekti uygulandı: " + eff, "success");
            if (window.state && window.state.localStream) {
                if (typeof window.toggleMicrophone === "function") {
                    window.toggleMicrophone();
                    setTimeout(() => window.toggleMicrophone(), 500);
                }
            }
        };

        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getUserMedia = async function(constraints) {
                const stream = await origGetUserMedia(constraints);
                if (constraints.audio && window.currentVoiceEffect !== "normal") {
                    try {
                        const effectStream = window.applyEffectToStream(stream);
                        if (constraints.video) {
                            stream.getVideoTracks().forEach(t => effectStream.addTrack(t));
                        }
                        return effectStream;
                    } catch (e) {
                        console.error("[Fixes V2] Error applying voice effect:", e);
                        return stream;
                    }
                }
                return stream;
            };
        }
    }

    // 5. CHAT HEADER FIX & CSS & THEME POLISH
    function applyUIFixes() {
        const style = document.createElement("style");
        style.id = "scord-fixes-v2-css";
        style.textContent = `
            /* ═══ GOOGLE FONT INJECTION ═══ */
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

            /* ═══ GLOBAL TYPOGRAPHY & SMOOTHING ═══ */
            *, *::before, *::after {
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
                text-rendering: optimizeLegibility;
            }
            body, button, input, textarea, select {
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            }

            /* ═══ GLOBAL TRANSITION DEFAULTS ═══ */
            button, .rail-icon, .channel-item, .member-item, .dm-search-item, .stab-item {
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }

            /* ═══ SCROLLBAR REFINEMENT ═══ */
            ::-webkit-scrollbar { width: 6px; }
            ::-webkit-scrollbar-track { background: transparent; }
            ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
            ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }

            /* ═══ NEW PREMIUM THEMES ═══ */

            /* Midnight Purple */
            .midnight {
                --bg-primary: #0d0a1a;
                --bg-surface: #15112b;
                --bg-elevated: #1f1a3c;
                --bg-highlight: #2d2554;
                --text-primary: #e8e0ff;
                --text-secondary: #c8b8ff;
                --text-muted: #8b7cc8;
                --accent: #7c3aed;
                --accent-light: #a78bfa;
                --accent-hover: #6d28d9;
                --border: #2d2554;
                --red: #ef4444;
                --bg-selected: rgba(124, 58, 237, 0.2);
                --bg-active: rgba(124, 58, 237, 0.15);
            }

            /* Ocean Depths */
            .ocean {
                --bg-primary: #0a1628;
                --bg-surface: #0f1f3d;
                --bg-elevated: #162a52;
                --bg-highlight: #1e3a6e;
                --text-primary: #e0f0ff;
                --text-secondary: #a8d4ff;
                --text-muted: #5e8ab4;
                --accent: #0ea5e9;
                --accent-light: #38bdf8;
                --accent-hover: #0284c7;
                --border: #1e3a6e;
                --red: #ef4444;
                --bg-selected: rgba(14, 165, 233, 0.2);
                --bg-active: rgba(14, 165, 233, 0.15);
            }

            /* Neon Cyberpunk */
            .cyberpunk {
                --bg-primary: #0a0a0f;
                --bg-surface: #111118;
                --bg-elevated: #1a1a24;
                --bg-highlight: #252530;
                --text-primary: #e0ffe0;
                --text-secondary: #b0ffb0;
                --text-muted: #5eff5e;
                --accent: #00ff88;
                --accent-light: #33ffaa;
                --accent-hover: #00cc6e;
                --border: #1a3a2a;
                --red: #ff3366;
                --bg-selected: rgba(0, 255, 136, 0.12);
                --bg-active: rgba(0, 255, 136, 0.08);
            }

            /* Sunset Warm */
            .sunset {
                --bg-primary: #1a0f0a;
                --bg-surface: #2a1810;
                --bg-elevated: #3a2218;
                --bg-highlight: #4a2e22;
                --text-primary: #fff0e6;
                --text-secondary: #ffccaa;
                --text-muted: #c89070;
                --accent: #f97316;
                --accent-light: #fb923c;
                --accent-hover: #ea580c;
                --border: #4a2e22;
                --red: #ef4444;
                --bg-selected: rgba(249, 115, 22, 0.2);
                --bg-active: rgba(249, 115, 22, 0.15);
            }

            /* ═══ ELEMENT VISIBILITY / READABILITY ═══ */

            /* Better readable message text */
            .messages-area .msg-bubble, .messages-area .message-content {
                font-size: 14.5px !important;
                line-height: 1.6 !important;
                letter-spacing: 0.01em !important;
            }
            .messages-area .msg-author, .messages-area .message-author {
                font-weight: 600 !important;
                font-size: 14px !important;
            }
            .messages-area .msg-time, .messages-area .message-time {
                font-size: 11px !important;
                opacity: 0.6;
            }

            /* Better channel sidebar readability */
            .channel-item, .channel-list .ch-item {
                padding: 8px 12px !important;
                border-radius: 6px !important;
                font-size: 14px !important;
                font-weight: 500 !important;
            }
            .channel-item:hover, .channel-list .ch-item:hover {
                background: var(--bg-highlight) !important;
            }
            .channel-item.active, .channel-list .ch-item.active {
                background: var(--accent) !important;
                color: #fff !important;
            }

            /* Sidebar header branding */
            .sidebar-header {
                padding: 14px 16px !important;
                font-size: 16px !important;
                font-weight: 700 !important;
                letter-spacing: -0.02em !important;
                border-bottom: 1px solid var(--border) !important;
                background: var(--bg-surface) !important;
            }

            /* User bar at bottom */
            .user-bar {
                border-top: 1px solid var(--border) !important;
                background: var(--bg-surface) !important;
            }
            .user-bar-name {
                font-weight: 600 !important;
                font-size: 13px !important;
            }

            /* Better modal styling */
            .modal-backdrop:not(.hidden) {
                background: rgba(0,0,0,0.7) !important;
                backdrop-filter: blur(6px) !important;
            }
            .modal-card, .modal-content {
                border-radius: 12px !important;
                border: 1px solid rgba(255,255,255,0.08) !important;
                box-shadow: 0 20px 60px rgba(0,0,0,0.6) !important;
            }

            /* Better toast notifications */
            .toast-container .toast, .scord-toast {
                border-radius: 8px !important;
                font-weight: 500 !important;
                backdrop-filter: blur(12px) !important;
                box-shadow: 0 6px 20px rgba(0,0,0,0.4) !important;
            }

            /* Better context menu */
            .ctx-menu {
                border-radius: 8px !important;
                box-shadow: 0 8px 24px rgba(0,0,0,0.5) !important;
                border: 1px solid rgba(255,255,255,0.08) !important;
                backdrop-filter: blur(16px) !important;
            }
            .ctx-item {
                border-radius: 4px !important;
                margin: 2px 4px !important;
                transition: background 0.15s !important;
            }
            .ctx-item:hover {
                background: var(--accent) !important;
                color: #fff !important;
            }

            /* ═══ MICRO-ANIMATIONS ═══ */

            /* Subtle hover glow on server icons */
            .rail-icon:hover {
                box-shadow: 0 0 12px rgba(99, 102, 241, 0.3) !important;
                transform: scale(1.08) !important;
            }
            .rail-icon.active {
                box-shadow: 0 0 16px rgba(99, 102, 241, 0.4) !important;
            }

            /* Smooth message appear animation */
            @keyframes msgFadeIn {
                from { opacity: 0; transform: translateY(8px); }
                to { opacity: 1; transform: translateY(0); }
            }
            .messages-area > div:last-child {
                animation: msgFadeIn 0.25s ease-out;
            }

            /* Pulse on new notification badge */
            @keyframes badgePulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.15); }
            }
            .unread-badge, .notification-dot {
                animation: badgePulse 2s ease-in-out infinite;
            }

            /* ═══ DM SEARCH DROPDOWN ═══ */
            .dm-main-search {
                position: relative;
            }
            .dm-search-dropdown {
                position: absolute;
                top: 100%;
                left: 0;
                width: 100%;
                max-width: 320px;
                background: var(--bg-elevated, #2f3136);
                border: 1px solid var(--border, #202225);
                border-radius: 8px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.5);
                z-index: 100;
                margin-top: 8px;
                max-height: 300px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                padding: 8px 0;
            }
            .dm-search-dropdown.hidden {
                display: none;
            }
            .dm-search-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 8px 12px;
                cursor: pointer;
                transition: background 0.1s;
            }
            .dm-search-item:hover {
                background: var(--bg-active, rgba(255,255,255,0.1));
            }
            .dm-search-item-avatar {
                width: 32px;
                height: 32px;
                border-radius: 50%;
                background-size: cover;
                background-position: center;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: bold;
                color: #fff;
            }
            .dm-search-item-info {
                display: flex;
                flex-direction: column;
            }
            .dm-search-item-name {
                font-size: 14px;
                font-weight: 500;
                color: var(--text-normal, #dcddde);
            }
            .dm-search-item-label {
                font-size: 12px;
                color: var(--text-muted, #8e9297);
            }
            
            /* Hide the old chip container */
            #dm-main-top-actions {
                display: none !important;
            }

            /* Fix chat header duplication */
            #chat-channel-name, .header-right { display: none !important; }
            .chat-header {
                display: flex !important;
                justify-content: space-between !important;
                align-items: center !important;
                background: var(--bg-elevated) !important;
                border-bottom: 1px solid var(--border) !important;
                padding: 12px 16px !important;
                box-shadow: 0 1px 2px rgba(0,0,0,0.2) !important;
            }
            .chat-header .header-left {
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
            }
            #active-channel-name {
                font-size: 16px !important;
                font-weight: 600 !important;
                color: var(--text-normal) !important;
            }
            
            /* Premium Setup Overlay */
            #setup-overlay {
                background: linear-gradient(135deg, rgba(10,10,20,0.95), rgba(20,20,40,0.95)) !important;
                backdrop-filter: blur(10px) !important;
            }
            .setup-card {
                background: rgba(30,30,45,0.7) !important;
                border: 1px solid rgba(255,255,255,0.1) !important;
                box-shadow: 0 10px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1) !important;
                backdrop-filter: blur(20px) !important;
                border-radius: 16px !important;
            }
            #enter-btn {
                background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
                border: none !important;
                box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4) !important;
                transition: all 0.2s ease !important;
            }
            #enter-btn:hover:not(:disabled) {
                transform: translateY(-2px) !important;
                box-shadow: 0 6px 20px rgba(99, 102, 241, 0.6) !important;
            }
            
            /* Premium Music Bot Dock */
            #music-player-dock {
                background: rgba(20,20,30,0.85) !important;
                backdrop-filter: blur(12px) !important;
                border: 1px solid rgba(255,255,255,0.1) !important;
                box-shadow: 0 8px 32px rgba(0,0,0,0.5) !important;
                border-radius: 12px !important;
                overflow: hidden !important;
                transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
            }
            #music-player-dock.active {
                transform: translateY(0) scale(1) !important;
                opacity: 1 !important;
            }
            #music-ctrl-bar {
                background: rgba(0,0,0,0.5) !important;
                backdrop-filter: blur(5px) !important;
            }
            
            /* Server Logos Fix */
            .rail-icon {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                font-weight: bold !important;
                overflow: hidden !important;
            }
            .rail-icon img {
                width: 100% !important;
                height: 100% !important;
                object-fit: cover !important;
            }

            /* Password field toggle button */
            .pass-toggle-btn {
                position: absolute;
                right: 10px;
                top: 50%;
                transform: translateY(-50%);
                background: none;
                border: none;
                color: var(--text-muted);
                cursor: pointer;
                font-size: 16px;
            }
            .pass-toggle-btn:hover {
                color: var(--text-normal);
            }
        `;
        document.head.appendChild(style);

        // Add password visibility toggle and fix sidebar server name
        setInterval(() => {
            // Fix: Dynamically update sidebar server name
            if (window.state && window.state.activeServerId && window.state.servers) {
                const server = window.state.servers.find(s => s.id === window.state.activeServerId);
                const sidebarName = document.getElementById("sidebar-server-name");
                if (server && sidebarName && sidebarName.textContent !== server.name) {
                    sidebarName.textContent = server.name;
                    sidebarName.style.cursor = "pointer";
                    sidebarName.title = "Sunucu Bilgilerini Görüntüle";
                    
                    // Add click listener if not added
                    if (!sidebarName.dataset.infoLinked) {
                        sidebarName.dataset.infoLinked = "true";
                        sidebarName.addEventListener("click", () => {
                            if (typeof window.showServerInfo === "function") {
                                window.showServerInfo();
                            }
                        });
                    }
                }
            } else if (!window.state || !window.state.activeServerId) {
                const sidebarName = document.getElementById("sidebar-server-name");
                if (sidebarName && sidebarName.textContent !== "SCORD") {
                    sidebarName.textContent = "SCORD";
                    delete sidebarName.dataset.infoLinked;
                }
            }

            // Hook DM search input to show dropdown
            const dmSearchInput = document.getElementById("dm-main-search-input");
            if (dmSearchInput && !dmSearchInput.dataset.dropdownHooked) {
                dmSearchInput.dataset.dropdownHooked = "true";
                
                let dropdown = document.getElementById("dm-search-dropdown");
                if (!dropdown) {
                    dropdown = document.createElement("div");
                    dropdown.id = "dm-search-dropdown";
                    dropdown.className = "dm-search-dropdown hidden";
                    dmSearchInput.parentNode.appendChild(dropdown);
                }

                // Override renderDMMainSearch to populate dropdown instead of chips
                window.renderDMMainSearch = function() {
                    const q = String(dmSearchInput.value || "").trim().toLowerCase();
                    const rows = [
                        ...(window.state.recentDMs || []).map(dm => ({ ...dm, label: "DM" })),
                        ...(window.state.friends || []).map(f => ({ peerId: f.peerId, name: f.name || f.username, avatarColor: f.avatarColor, avatarImage: f.avatarImage, label: "Arkadaş" })),
                    ];
                    const seen = new Set();
                    dropdown.innerHTML = "";
                    
                    const filtered = rows.filter(row => row.peerId && !seen.has(row.peerId) && (!q || String(row.name || "").toLowerCase().includes(q))).slice(0, 10);
                    
                    if (filtered.length === 0) {
                        dropdown.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--text-muted, #8e9297); font-size: 13px;">Kullanıcı bulunamadı</div>`;
                    } else {
                        filtered.forEach(row => {
                            seen.add(row.peerId);
                            const item = document.createElement("div");
                            item.className = "dm-search-item";
                            
                            const avatar = document.createElement("div");
                            avatar.className = "dm-search-item-avatar";
                            avatar.style.backgroundColor = row.avatarColor || "#5865f2";
                            if (row.avatarImage) {
                                avatar.style.backgroundImage = `url(${row.avatarImage})`;
                            } else {
                                avatar.textContent = window.initials ? window.initials(row.name || "?") : (row.name || "?").charAt(0).toUpperCase();
                            }
                            
                            const info = document.createElement("div");
                            info.className = "dm-search-item-info";
                            info.innerHTML = `<span class="dm-search-item-name">${window.escapeHtml ? window.escapeHtml(row.name || "Kullanıcı") : (row.name || "Kullanıcı")}</span>
                                              <span class="dm-search-item-label">${row.label}</span>`;
                                              
                            item.appendChild(avatar);
                            item.appendChild(info);
                            
                            item.onmousedown = (e) => {
                                e.preventDefault();
                                if (typeof window.openDM === "function") {
                                    window.openDM(row.peerId, row.name, row.avatarColor, row.avatarImage);
                                }
                                dropdown.classList.add("hidden");
                                dmSearchInput.value = "";
                            };
                            dropdown.appendChild(item);
                        });
                    }
                };

                dmSearchInput.addEventListener("focus", () => {
                    dropdown.classList.remove("hidden");
                    if (typeof window.renderDMMainSearch === "function") window.renderDMMainSearch();
                });

                dmSearchInput.addEventListener("blur", () => {
                    setTimeout(() => dropdown.classList.add("hidden"), 150);
                });
            }

            const passInput = document.getElementById("scord-pass-input");
            if (passInput && !passInput.dataset.toggleAdded) {
                passInput.dataset.toggleAdded = "true";
                const wrapper = document.createElement("div");
                wrapper.style.position = "relative";
                passInput.parentNode.insertBefore(wrapper, passInput);
                wrapper.appendChild(passInput);
                
                const btn = document.createElement("button");
                btn.className = "pass-toggle-btn";
                btn.innerHTML = "👁️";
                btn.onclick = (e) => {
                    e.preventDefault();
                    if (passInput.type === "password") {
                        passInput.type = "text";
                        btn.innerHTML = "🙈";
                    } else {
                        passInput.type = "password";
                        btn.innerHTML = "👁️";
                    }
                };
                wrapper.appendChild(btn);
            }
        }, 1000);
    }

    // 6. P2P QUALITY CONTROLS
    function applyQualitySettings() {
        window.streamQuality = localStorage.getItem("scord_quality") || "standard";

        // Add Quality Toggle Button to User Bar
        setInterval(() => {
            const controls = document.querySelector(".user-bar-controls");
            if (controls && !document.getElementById("quality-toggle-btn")) {
                const btn = document.createElement("button");
                btn.id = "quality-toggle-btn";
                btn.className = "user-ctrl-btn";
                btn.title = window.streamQuality === "eco" ? "Yayın Kalitesi: Eco (Düşük Veri)" : "Yayın Kalitesi: Standart (HD)";
                btn.innerHTML = window.streamQuality === "eco" ? "🌱" : "🔥";
                
                btn.onclick = () => {
                    const newQ = window.streamQuality === "eco" ? "standard" : "eco";
                    window.streamQuality = newQ;
                    localStorage.setItem("scord_quality", newQ);
                    btn.innerHTML = newQ === "eco" ? "🌱" : "🔥";
                    btn.title = newQ === "eco" ? "Yayın Kalitesi: Eco (Düşük Veri)" : "Yayın Kalitesi: Standart (HD)";
                    if (typeof window.toast === "function") {
                        window.toast("Yayın kalitesi güncellendi: " + (newQ === "eco" ? "Eco Modu (Tasarruf)" : "Standart Mod (HD)"), "info");
                    }
                };
                
                const settingsBtn = document.getElementById("settings-btn");
                if (settingsBtn) {
                    controls.insertBefore(btn, settingsBtn);
                } else {
                    controls.appendChild(btn);
                }
            }
        }, 2000);

        // Override getUserMedia (Mic/Cam) and getDisplayMedia (Screen)
        if (navigator.mediaDevices) {
            // Overriding getDisplayMedia
            if (navigator.mediaDevices.getDisplayMedia) {
                const origGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
                navigator.mediaDevices.getDisplayMedia = async function(constraints) {
                    let finalConstraints = constraints || { video: true };
                    
                    if (window.streamQuality === "eco") {
                        if (typeof finalConstraints.video === "boolean") finalConstraints.video = {};
                        finalConstraints.video.frameRate = { max: 15 };
                        finalConstraints.video.height = { max: 480 };
                        finalConstraints.video.width = { max: 854 };
                    }
                    return origGetDisplayMedia(finalConstraints);
                };
            }

            // Hooking into existing getUserMedia (from applyVoiceEffects or native)
            const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getUserMedia = async function(constraints) {
                let finalConstraints = constraints || { audio: true };
                
                if (window.streamQuality === "eco") {
                    if (finalConstraints.video && typeof finalConstraints.video === "object") {
                        finalConstraints.video.frameRate = { max: 15 };
                        finalConstraints.video.height = { max: 360 };
                    }
                    if (finalConstraints.audio) {
                        if (typeof finalConstraints.audio === "boolean") finalConstraints.audio = {};
                        finalConstraints.audio.sampleRate = 24000;
                        finalConstraints.audio.channelCount = 1;
                        finalConstraints.audio.echoCancellation = true;
                    }
                }
                
                return nativeGetUserMedia(finalConstraints);
            };
        }
    }

    // 7. IDENTITY ISOLATION
    function applyIdentityIsolation() {
        const isolatedKeys = ["scord_friends", "scord_recent_dms", "scord_blocked_peers", "scord_friend_requests", "scord_queued_friend_requests", "scord_dms"];
        const origSetItem = localStorage.setItem.bind(localStorage);
        const origGetItem = localStorage.getItem.bind(localStorage);
        
        localStorage.setItem = function(key, value) {
            if (isolatedKeys.includes(key) && window.state && window.state.peerId) {
                origSetItem(`${key}_${window.state.peerId}`, value);
            } else {
                origSetItem(key, value);
            }
        };
        
        localStorage.getItem = function(key) {
            if (isolatedKeys.includes(key) && window.state && window.state.peerId) {
                const specific = origGetItem(`${key}_${window.state.peerId}`);
                if (specific !== null) return specific;
                return null; // Ensure true isolation
            }
            return origGetItem(key);
        };
        
        let lastPeerId = null;
        setInterval(() => {
            if (window.state && window.state.peerId && window.state.peerId !== lastPeerId) {
                lastPeerId = window.state.peerId;
                
                // Reload state using new isolated keys
                const friends = localStorage.getItem("scord_friends");
                if (friends) {
                    try { window.state.friends = JSON.parse(friends); } catch(e){}
                } else {
                    window.state.friends = [];
                }
                
                const dms = localStorage.getItem("scord_recent_dms");
                if (dms) {
                    try { window.state.recentDMs = JSON.parse(dms); } catch(e){}
                } else {
                    window.state.recentDMs = [];
                }
                
                if (typeof window.renderHomeSidebar === "function" && !window.state.activeServerId) {
                    window.renderHomeSidebar();
                }
            }
        }, 500);
    }

    // 8. SOUND EFFECTS (AUDIO NOTIFICATIONS)
    function applySoundEffects() {
        window.scordSounds = {
            enabled: localStorage.getItem("scord_sounds_enabled") !== "false",
            ctx: null,
            init: function() {
                if (!this.ctx) {
                    const AudioContext = window.AudioContext || window.webkitAudioContext;
                    if (AudioContext) this.ctx = new AudioContext();
                }
                if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
            },
            playTone: function(freqs, durations, type = "sine") {
                if (!this.enabled) return;
                this.init();
                if (!this.ctx) return;
                
                let startTime = this.ctx.currentTime;
                freqs.forEach((freq, i) => {
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();
                    osc.type = type;
                    osc.frequency.setValueAtTime(freq, startTime);
                    
                    gain.gain.setValueAtTime(0, startTime);
                    gain.gain.linearRampToValueAtTime(0.05, startTime + 0.02);
                    gain.gain.exponentialRampToValueAtTime(0.001, startTime + durations[i]);
                    
                    osc.connect(gain);
                    gain.connect(this.ctx.destination);
                    osc.start(startTime);
                    osc.stop(startTime + durations[i]);
                    
                    startTime += durations[i] - 0.02;
                });
            },
            playMessage: function() { this.playTone([600, 800], [0.1, 0.2], "sine"); },
            playJoin: function() { this.playTone([400, 600, 800], [0.1, 0.1, 0.3], "sine"); },
            playLeave: function() { this.playTone([800, 600, 400], [0.1, 0.1, 0.3], "sine"); },
            playCall: function() { this.playTone([440, 550], [0.2, 0.2], "square"); }
        };

        setInterval(() => {
            const controls = document.querySelector(".user-bar-controls");
            if (controls && !document.getElementById("sound-toggle-btn")) {
                const btn = document.createElement("button");
                btn.id = "sound-toggle-btn";
                btn.className = "user-ctrl-btn";
                btn.title = window.scordSounds.enabled ? "Bildirim Sesleri: Açık" : "Bildirim Sesleri: Kapalı";
                btn.innerHTML = window.scordSounds.enabled ? "🔊" : "🔇";
                
                btn.onclick = () => {
                    window.scordSounds.enabled = !window.scordSounds.enabled;
                    localStorage.setItem("scord_sounds_enabled", window.scordSounds.enabled);
                    btn.innerHTML = window.scordSounds.enabled ? "🔊" : "🔇";
                    btn.title = window.scordSounds.enabled ? "Bildirim Sesleri: Açık" : "Bildirim Sesleri: Kapalı";
                    if (window.scordSounds.enabled) window.scordSounds.playJoin();
                };
                
                const settingsBtn = document.getElementById("settings-btn");
                if (settingsBtn) {
                    controls.insertBefore(btn, settingsBtn);
                } else {
                    controls.appendChild(btn);
                }
            }
            
            if (window.state && window.state.mesh && !window.state.mesh._soundsHooked) {
                window.state.mesh._soundsHooked = true;
                const origOnMsg = window.state.mesh.onMessage;
                window.state.mesh.onMessage = function(peerId, data) {
                    if (data && (data.type === "chat" || data.type === "dm")) {
                        window.scordSounds.playMessage();
                    }
                    if (origOnMsg) return origOnMsg.apply(this, arguments);
                };
            }
            
            if (typeof window.joinVoiceChannel === "function" && !window._voiceJoinHooked) {
                window._voiceJoinHooked = true;
                const origJoin = window.joinVoiceChannel;
                window.joinVoiceChannel = function() {
                    window.scordSounds.playJoin();
                    return origJoin.apply(this, arguments);
                };
                
                const origLeave = window.leaveVoiceChannel;
                window.leaveVoiceChannel = function() {
                    window.scordSounds.playLeave();
                    if(origLeave) return origLeave.apply(this, arguments);
                };
            }
        }, 2000);
    }

    // 10. PERFORMANCE OPTIMIZATIONS
    function applyPerformanceBoost() {
        // Optimize rendering with requestAnimationFrame instead of immediate DOM updates
        if (typeof window.renderHomeSidebar === "function" && !window._renderHomeSidebarOptimized) {
            window._renderHomeSidebarOptimized = true;
            const origRender = window.renderHomeSidebar;
            let renderPending = false;
            window.renderHomeSidebar = function() {
                if (renderPending) return;
                renderPending = true;
                requestAnimationFrame(() => {
                    origRender.apply(this, arguments);
                    renderPending = false;
                });
            };
        }

        // Throttle chat rendering
        if (typeof window.renderMessages === "function" && !window._renderMessagesOptimized) {
            window._renderMessagesOptimized = true;
            const origRenderMsg = window.renderMessages;
            let msgRenderPending = false;
            window.renderMessages = function() {
                if (msgRenderPending) return;
                msgRenderPending = true;
                requestAnimationFrame(() => {
                    origRenderMsg.apply(this, arguments);
                    msgRenderPending = false;
                });
            };
        }

        // Memory leak prevention - clean up old peer connections periodically
        setInterval(() => {
            if (window.state && window.state.mesh && window.state.mesh.peers) {
                const now = Date.now();
                Object.keys(window.state.mesh.peers).forEach(pid => {
                    const peerConn = window.state.mesh.peers[pid];
                    // If connection is closed or failed, make sure we clean it up
                    if (peerConn && peerConn.connectionState && 
                       (peerConn.connectionState === 'closed' || peerConn.connectionState === 'failed')) {
                        console.log(`[Performance] Cleaning up dead peer connection: ${pid}`);
                        delete window.state.mesh.peers[pid];
                    }
                });
            }
        }, 60000); // Check every minute
    }

    // INITIALIZATION
    function initV2() {
        console.log("[Fixes V2] Starting...");
        setTimeout(() => {
            applyDMCallFix();
            applyStatusFix();
            applyVoiceEffects();
            applyUIFixes();
            applyQualitySettings();
            applyIdentityIsolation();
            applySoundEffects();
            applyPremiumServerSettings();
            applyPerformanceBoost();
            console.log("[Fixes V2] All patches applied successfully");
        }, 1500);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initV2);
    } else {
        initV2();
    }
})();
