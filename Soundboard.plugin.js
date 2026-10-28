/**
 * @name Soundboard
 * @author 8ug8ird
 * @authorId 698947564459917343
 * @version 1.1.0
 * @description Play your own sounds in voice calls
 * @source https://github.com/8ug8ird/Soundboard
 */

const NAME = "Soundboard";
const VERSION = "1.1.0";
const UPDATE_REPO = "8ug8ird/Soundboard";
const RELEASES_URL = `https://github.com/${UPDATE_REPO}/releases`;

module.exports = class Soundboard {
    start() {
        this.stopped = false;
        this.settings = BdApi.Data.load(NAME, "settings") || { sounds: [], volume: 0.7 };
        this.resumeAfterUpdate = BdApi.Data.load(NAME, "updateChannel");
        if (this.resumeAfterUpdate) BdApi.Data.delete(NAME, "updateChannel");
        this.migrateAudio();
        this.graphs = new Map();
        this.sources = new Set();
        this.buffers = new Map();
        this.keyboard = BdApi.Webpack.getByKeys("inputEventRegister", "inputEventUnregister");
        this.keybindIds = [];
        this.globalKeys = new Set();
        this.pressedKeys = new Set();
        this.onBlur = () => this.pressedKeys.clear();
        window.addEventListener("blur", this.onBlur);
        this.keybindId = 0x40000000 + Math.floor(Math.random() * 1000000);
        this.onKey = event => {
            if (event.type === "mousedown" && event.button < 2) return;
            if (event.repeat || event.target.closest?.("input,textarea,[contenteditable=true]")) return;
            const sound = this.settings.sounds.find(sound => sound.key === this.keyName(event));
            if (sound) {
                event.preventDefault();
                if (!this.globalKeys.has(sound.key)) this.play(sound).catch(error => this.error(error));
            }
        };
        this.blockMouseNavigation = event => {
            if (event.button >= 2 && (this.recordingKey || this.settings.sounds.some(sound => sound.key?.endsWith(`Mouse${event.button + 1}`)))) event.preventDefault();
        };
        document.addEventListener("keydown", this.onKey);
        document.addEventListener("mousedown", this.onKey);
        document.addEventListener("mouseup", this.blockMouseNavigation, true);
        document.addEventListener("auxclick", this.blockMouseNavigation, true);
        const keybindStore = BdApi.Webpack.getByKeys("hasKeybind", "hasExactKeybind");
        if (keybindStore?.hasKeybind) BdApi.Patcher.instead(NAME, keybindStore, "hasKeybind", (_, args, original) =>
            args[0] === 1 && (this.recordingKey || this.settings.sounds.some(sound => sound.key?.endsWith(`Mouse${args[1] + 1}`))) ? true : original(...args));
        this.bindGlobalKeys();
        this.onStateChange = () => this.updatePlaybackState();
        this.stateStores = ["MediaEngineStore", "SelectedChannelStore"].map(name => BdApi.Webpack.getStore(name));
        this.stateStores.forEach(store => store?.addChangeListener?.(this.onStateChange));
        this.menuObserver = new MutationObserver(() => {
            if (!this.menuFrame && !document.querySelector("#soundboard-menu")) this.menuFrame = requestAnimationFrame(() => {
                this.menuFrame = null;
                this.mountMenu();
            });
        });
        this.menuObserver.observe(document.body, { childList: true, subtree: true });
        this.mountMenu();
        this.startUpdateChecks();
        return this.activate().catch(error => this.error(error));
    }

    async activate() {
        if (this.web) return;
        const channels = BdApi.Webpack.getByKeys("selectVoiceChannel");
        let channelId;
        let reconnect = false;
        this.native = BdApi.Webpack.getStore("MediaEngineStore").getMediaEngine();
        const factory = BdApi.Webpack.getByKeys("WI", "hB");
        const web = factory.hB("WEBRTC");
        this.web = web;
        try {
            if (!web.supported()) throw Error("The WebRTC voice engine is not available in this client.");
            await web.fetchAsyncResources({ fetchDave: true });
            if (this.stopped || this.web !== web) return web.destroy();
            this.context = web.getAudioContext();
            this.effects = this.context.createGain();
            this.effects.gain.value = this.settings.volume;
            this.monitor = this.context.createGain();
            this.monitor.gain.value = this.settings.monitor === false ? 0 : 1;
            this.effects.connect(this.monitor).connect(this.context.destination);
            await web.enable();
            web.interact();
            const devices = await Promise.all([
                web.getAudioInputDevices(), web.getAudioOutputDevices(), web.getVideoInputDevices()
            ]);
            if (this.stopped || this.web !== web) return web.destroy();
            channelId = BdApi.Webpack.getStore("SelectedChannelStore").getVoiceChannelId();
            if (channelId) {
                await channels.selectVoiceChannel(null);
                reconnect = true;
            } else if (this.resumeAfterUpdate) {
                channelId = this.resumeAfterUpdate;
                reconnect = true;
            }
            this.resumeAfterUpdate = null;
            const nativeEmit = this.native.emit.bind(this.native);
            this.connectionEvent = factory.bg.Connection;
            BdApi.Patcher.instead(NAME, web, "emit", (_, args) => {
                if (args[0] === this.connectionEvent) this.attach(args[1]);
                return nativeEmit(...args);
            });
            for (const method of Object.getOwnPropertyNames(Object.getPrototypeOf(web))) {
                if (["constructor", "destroy", "getCodecSurvey", "getMLSSigningKey", "rankRtcRegions"].includes(method)) continue;
                if (typeof web[method] === "function" && typeof this.native[method] === "function") {
                    BdApi.Patcher.instead(NAME, this.native, method, (_, args) => {
                        if (method === "fetchAsyncResources") args[0] = { ...args[0], fetchDave: true };
                        return web[method](...args);
                    });
                }
            }
            const store = BdApi.Webpack.getStore("MediaEngineStore");
            BdApi.Patcher.instead(NAME, store, "getVideoComponent", () => web.Video);
            BdApi.Patcher.instead(NAME, store, "getCameraComponent", () => web.Camera);
            web.emit(factory.bg.DeviceChange, ...devices);
            if (reconnect && !this.stopped) await channels.selectVoiceChannel(channelId);
            BdApi.UI.showToast("Soundboard is ready.", { type: "success" });
        } catch (error) {
            this.release();
            if (reconnect && !this.stopped) await channels.selectVoiceChannel(channelId);
            throw error;
        }
    }

    attach(connection) {
        const audio = connection.input?.audio;
        if (!audio || this.graphs.has(audio)) return;
        this.graphs.set(audio, null);
        BdApi.Patcher.before(NAME, audio, "enable", () => this.disposeGraph(audio));
        BdApi.Patcher.before(NAME, audio, "destroy", () => {
            this.disposeGraph(audio);
            this.graphs.delete(audio);
        });
        BdApi.Patcher.before(NAME, audio, "emit", (_, args) => {
            if (args[0] !== "stream") return;
            const stream = args[1];
            this.disposeGraph(audio);
            const destination = this.context.createMediaStreamDestination();
            const source = this.context.createMediaStreamSource(stream);
            source.connect(destination);
            this.effects.connect(destination);
            stream.getAudioTracks().forEach(track => track.enabled = true);
            destination.stream.getAudioTracks().forEach(track => track.enabled = !audio.mute);
            this.graphs.set(audio, { stream, source, destination });
            audio.stream = args[1] = destination.stream;
            audio.updateMode();
            this.updatePlaybackState();
        });
    }

    disposeGraph(audio) {
        const graph = this.graphs.get(audio);
        if (!graph) return;
        graph.source.disconnect();
        this.effects.disconnect(graph.destination);
        graph.stream.getTracks().forEach(track => track.stop());
        graph.destination.stream.getTracks().forEach(track => track.stop());
        this.graphs.set(audio, null);
    }

    loadBuffer(sound, context) {
        if (!this.buffers.has(sound.id)) {
            const loading = Promise.resolve().then(() => {
                const bytes = require("fs").readFileSync(this.audioPath(sound.id), null);
                return context.decodeAudioData(Uint8Array.from(bytes).buffer);
            });
            this.buffers.set(sound.id, loading);
            loading.catch(() => this.buffers.delete(sound.id));
        }
        return this.buffers.get(sound.id);
    }

    async play(sound, preview = false) {
        if (!preview && !this.web) throw Error("Audio is still starting. Please try again in a moment.");
        if (!preview) {
            if (![...this.graphs.values()].some(Boolean)) throw Error("Join a voice call to play sounds.");
            const store = BdApi.Webpack.getStore("MediaEngineStore");
            if (store.isMute()) throw Error("Unmute your microphone to play sounds.");
        }
        const context = preview ? this.previewContext ||= new AudioContext() : this.context;
        const buffer = await this.loadBuffer(sound, context);
        if (this.stopped || context.state === "closed") return;
        if (!preview && (!this.web || BdApi.Webpack.getStore("MediaEngineStore").isMute() || ![...this.graphs.values()].some(Boolean))) return;
        await context.resume();
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        source.soundId = sound.id;
        source.preview = preview;
        gain.gain.value = (sound.volume ?? 1) * (preview ? this.settings.volume : 1);
        source.connect(gain).connect(preview ? context.destination : this.effects);
        source.onended = () => { source.disconnect(); gain.disconnect(); this.sources.delete(source); this.updatePlaybackState(); };
        this.sources.add(source);
        const start = sound.start ?? 0;
        source.start(0, start, (sound.end ?? buffer.duration) - start);
        this.updatePlaybackState();
    }

    stopSounds() {
        for (const source of this.sources || []) source.stop();
        this.sources?.clear();
    }

    release() {
        this.stopSounds();
        BdApi.Patcher.unpatchAll(NAME);
        this.web?.destroy();
        for (const audio of this.graphs.keys()) this.disposeGraph(audio);
        this.graphs.clear();
        this.buffers?.clear();
        this.effects?.disconnect();
        this.monitor?.disconnect();
        this.context?.close();
        this.previewContext?.close();
        this.previewContext = null;
        this.web = null;
        this.context = null;
        if (this.native) {
            const native = this.native;
            Promise.all([native.getAudioInputDevices(), native.getAudioOutputDevices(), native.getVideoInputDevices()])
                .then(devices => native.emit(BdApi.Webpack.getByKeys("WI", "hB").bg.DeviceChange, ...devices))
                .catch(error => console.error(NAME, error));
        }
    }

    stop() {
        this.stopped = true;
        this.stopUpdateChecks();
        this.clearMouseRecording();
        this.clearGlobalKeys();
        this.menuObserver?.disconnect();
        if (this.menuFrame) cancelAnimationFrame(this.menuFrame);
        this.stateStores?.forEach(store => store?.removeChangeListener?.(this.onStateChange));
        document.querySelector("#soundboard-menu")?.remove();
        document.removeEventListener("keydown", this.onKey);
        window.removeEventListener("blur", this.onBlur);
        document.removeEventListener("mousedown", this.onKey);
        document.removeEventListener("mouseup", this.blockMouseNavigation, true);
        document.removeEventListener("auxclick", this.blockMouseNavigation, true);
        if (this.web?.connections.size) {
            BdApi.Webpack.getByKeys("selectVoiceChannel").selectVoiceChannel(null);
        }
        this.release();
    }

    error(error) {
        console.error(NAME, error);
        BdApi.UI.showToast(error.message || String(error), { type: "error" });
    }

    startUpdateChecks() {
        this.stopUpdateChecks();
        if (this.settings.autoCheckUpdates === false) return;
        this.updateKickoff = setTimeout(() => this.checkUpdates(), 5000);
        this.updateInterval = setInterval(() => this.checkUpdates(), 30 * 60 * 1000);
    }

    stopUpdateChecks() {
        clearTimeout(this.updateKickoff);
        clearTimeout(this.updateRetry);
        clearInterval(this.updateInterval);
        this.updateEpoch = (this.updateEpoch || 0) + 1;
        this.checkingUpdates = false;
        this.updateNotice?.();
        this.updateNotice = null;
    }

    async updateText(url, redirects = 0) {
        const target = new URL(url);
        const hosts = ["api.github.com", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com", "codeload.github.com"];
        if (target.protocol !== "https:" || !hosts.includes(target.hostname)) throw Error("Untrusted update URL.");
        if (redirects > 5) throw Error("Too many update redirects.");
        const response = await BdApi.Net.fetch(url, {
            redirect: "manual", timeout: 10000,
            headers: { "User-Agent": "Soundboard-UpdateChecker", Accept: "application/vnd.github+json", "Cache-Control": "no-cache" }
        });
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (!location) throw Error("Update redirect has no destination.");
            return this.updateText(new URL(location, url).href, redirects + 1);
        }
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        return response.text();
    }

    isNewerVersion(version) {
        const remote = version.split(".").map(Number);
        const local = VERSION.split(".").map(Number);
        for (let i = 0; i < 3; i++) if (remote[i] !== local[i]) return remote[i] > local[i];
        return false;
    }

    async checkUpdates(manual = false, attempt = 0) {
        if (this.stopped || this.checkingUpdates || (!manual && this.settings.autoCheckUpdates === false)) return;
        const epoch = this.updateEpoch;
        this.checkingUpdates = true;
        try {
            const release = JSON.parse(await this.updateText(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`));
            if (this.stopped || this.updateEpoch !== epoch) return;
            const version = release.tag_name?.match(/^v?(\d+\.\d+\.\d+)$/)?.[1];
            if (!version) throw Error("The latest release has an invalid version tag.");
            if (!this.isNewerVersion(version)) {
                if (manual) BdApi.UI.showToast("Soundboard is up to date.", { type: "success" });
                return;
            }
            const asset = release.assets?.find(asset => asset.name === `${NAME}.plugin.js`);
            if (!asset?.browser_download_url?.startsWith(`${RELEASES_URL}/download/`)) throw Error("The release has no Soundboard.plugin.js download.");
            if (!manual && this.notifiedVersion === version) return;
            this.updateNotice?.();
            this.updateNotice = BdApi.UI.showNotice(`Soundboard v${version} is now available!`, {
                timeout: 0,
                buttons: [
                    { label: "Update now", onClick: () => this.installUpdate(version, asset.browser_download_url) },
                    { label: "What's new", onClick: () => window.open(`${RELEASES_URL}/tag/${release.tag_name}`, "_blank", "noopener,noreferrer") }
                ]
            });
            if (!this.updateNotice) BdApi.UI.showToast(`Soundboard v${version} is available. Check for updates in settings.`, { type: "info" });
            this.notifiedVersion = version;
        } catch (error) {
            if (this.stopped || this.updateEpoch !== epoch) return;
            if (manual) this.error(Error(`Could not check for updates: ${error.message}`));
            else if (attempt < 3 && /ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ECONNREFUSED|timed out|NetworkError|Failed to fetch|HTTP (429|5\d\d)/i.test(error.message)) {
                this.updateRetry = setTimeout(() => this.checkUpdates(false, attempt + 1), [5000, 15000, 30000][attempt]);
            } else console.warn(NAME, "Update check failed:", error);
        } finally {
            if (this.updateEpoch === epoch) this.checkingUpdates = false;
        }
    }

    async installUpdate(version, url) {
        if (this.stopped || this.installingUpdate) return;
        const epoch = this.updateEpoch;
        this.installingUpdate = true;
        try {
            const text = await this.updateText(url);
            if (this.stopped || this.updateEpoch !== epoch) return;
            if (text.match(/@name\s+(\S+)/)?.[1] !== NAME || text.match(/@version\s+(\S+)/)?.[1] !== version) {
                throw Error("The downloaded plugin does not match the release.");
            }
            new Function("module", "exports", "require", text);
            const channel = BdApi.Webpack.getStore("SelectedChannelStore").getVoiceChannelId();
            if (channel) BdApi.Data.save(NAME, "updateChannel", channel);
            try {
                require("fs").writeFileSync(require("path").join(BdApi.Plugins.folder, `${NAME}.plugin.js`), text, "utf8");
            } catch (error) {
                if (channel) BdApi.Data.delete(NAME, "updateChannel");
                throw error;
            }
            this.updateNotice?.();
            this.updateNotice = null;
            BdApi.UI.showToast(`Soundboard updated to v${version}!`, { type: "success" });
        } catch (error) {
            this.error(Error(`Update failed: ${error.message} Download manually from GitHub.`));
        } finally {
            this.installingUpdate = false;
        }
    }

    save() {
        BdApi.Data.save(NAME, "settings", this.settings);
        document.querySelector("#soundboard-menu")?.remove();
        this.mountMenu();
    }

    audioPath(id) {
        return require("path").join(BdApi.Plugins.folder, NAME, `${id}.audio`);
    }

    migrateAudio() {
        const fs = require("fs");
        if (!this.settings.sounds.some(sound => sound.data)) return;
        fs.mkdirSync(require("path").join(BdApi.Plugins.folder, NAME), { recursive: true });
        for (const sound of this.settings.sounds) {
            if (!sound.data) continue;
            fs.writeFileSync(this.audioPath(sound.id), Buffer.from(sound.data, "base64"));
            delete sound.data;
        }
        BdApi.Data.save(NAME, "settings", this.settings);
    }

    updatePlaybackState() {
        const ready = [...this.graphs.values()].some(Boolean) && !BdApi.Webpack.getStore("MediaEngineStore").isMute();
        for (const button of document.querySelectorAll(".soundboard-broadcast")) {
            button.disabled = !ready;
            button.title = ready ? "Play in voice call" : "Join a voice call and unmute to play";
        }
        for (const tile of document.querySelectorAll("[data-soundboard-id]")) {
            tile.classList.toggle("soundboard-playing", [...this.sources].some(source => source.soundId === tile.dataset.soundboardId));
        }
    }

    keyName(event) {
        return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift",
            event.metaKey && "Meta", event.code ?? `Mouse${event.button + 1}`].filter(Boolean).join("+");
    }

    nativeShortcut(key) {
        const codes = {
            Ctrl: 162, Alt: 164, Shift: 160, Meta: 91,
            ControlLeft: 162, ControlRight: 163, AltLeft: 164, AltRight: 165,
            ShiftLeft: 160, ShiftRight: 161, MetaLeft: 91, MetaRight: 92,
            Backspace: 8, Tab: 9, Enter: 13, NumpadEnter: 13, Pause: 19, CapsLock: 20,
            Escape: 27, Space: 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
            ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
            PrintScreen: 44, Insert: 45, Delete: 46, ContextMenu: 93,
            NumpadMultiply: 106, NumpadAdd: 107, NumpadSubtract: 109,
            NumpadDecimal: 110, NumpadDivide: 111, NumLock: 144, ScrollLock: 145,
            Semicolon: 186, Equal: 187, Comma: 188, Minus: 189, Period: 190,
            Slash: 191, Backquote: 192, BracketLeft: 219, Backslash: 220,
            BracketRight: 221, Quote: 222, IntlBackslash: 226
        };
        return key.split("+").map(code => {
            if (/^Mouse[3-5]$/.test(code)) return [1, Number(code.slice(5)) - 1];
            const value = /^Key[A-Z]$/.test(code) ? code.charCodeAt(3)
                : /^Digit[0-9]$/.test(code) ? code.charCodeAt(5)
                : /^Numpad[0-9]$/.test(code) ? 96 + Number(code.slice(6))
                : /^F([1-9]|1[0-9]|2[0-4])$/.test(code) ? 111 + Number(code.slice(1))
                : codes[code];
            if (value === undefined) throw Error(`Unsupported global hotkey: ${key}`);
            return [0, value, 1];
        });
    }

    clearGlobalKeys() {
        for (const id of this.keybindIds || []) this.keyboard.inputEventUnregister(id);
        this.keybindIds = [];
        this.globalKeys?.clear();
        this.pressedKeys?.clear();
    }

    clearMouseRecording() {
        for (const id of this.recordMouseIds || []) this.keyboard.inputEventUnregister(id);
        this.recordMouseIds = [];
        this.recordingKey = null;
        this.pressedKeys?.clear();
        if (this.onRecordMouse) window.removeEventListener("mousedown", this.onRecordMouse, true);
    }

    recordMouse(key, record, modifiers = {}) {
        for (const id of this.recordMouseIds || []) this.keyboard.inputEventUnregister(id);
        this.recordMouseIds = [];
        this.recordingKey = key;
        const { ctrlKey, altKey, shiftKey, metaKey } = modifiers;
        for (const button of [2, 3, 4]) {
            const event = { button, ctrlKey, altKey, shiftKey, metaKey, preventDefault() {}, stopPropagation() {} };
            const id = this.keybindId++;
            this.keyboard.inputEventRegister(id, this.nativeShortcut(this.keyName(event)), down => {
                if (down && this.recordingKey === key) record(event);
            }, { focused: true, blurred: false, keydown: true, keyup: false });
            this.recordMouseIds.push(id);
        }
    }

    bindGlobalKeys() {
        this.clearGlobalKeys();
        for (const sound of this.settings.sounds) {
            if (!sound.key) continue;
            try {
                const shortcut = this.nativeShortcut(sound.key);
                const id = this.keybindId++;
                if (this.recordingKey) this.pressedKeys.add(id);
                this.keyboard.inputEventRegister(id, shortcut, down => {
                    if (!down) { this.pressedKeys.delete(id); return; }
                    if (this.stopped || this.recordingKey) return;
                    if (this.pressedKeys.has(id)) return;
                    if (document.hasFocus() && document.activeElement?.closest("input,textarea,[contenteditable=true]")) return;
                    this.pressedKeys.add(id);
                    this.play(sound).catch(error => this.error(error));
                }, { focused: true, blurred: true, keydown: true, keyup: true });
                this.keybindIds.push(id);
                this.globalKeys.add(sound.key);
            } catch (error) { this.error(error); }
        }
    }

    uiNode(tag, className, text) {
        const node = document.createElement(tag);
        node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    uiButton(label, action, variant = "secondary") {
        const button = this.uiNode("button", `soundboard-button soundboard-${variant}`, label);
        button.type = "button";
        button.onclick = () => Promise.resolve().then(action).catch(error => this.error(error));
        return button;
    }

    uiStyle() {
        const style = document.createElement("style");
        style.textContent = `
            .soundboard-root { color:var(--text-default,#f2f3f5); font:14px/1.4 var(--font-primary,sans-serif); }
            .soundboard-root * { box-sizing:border-box; }
            .soundboard-header,.soundboard-toolbar,.soundboard-label { display:flex;align-items:center;justify-content:space-between;gap:8px; }
            .soundboard-title { font-size:13px;font-weight:600; }
            .soundboard-count { color:var(--text-muted,#a4a9b2);font-size:12px;font-weight:400; }
            .soundboard-button { appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:0;min-height:34px;padding:7px 12px;border:1px solid transparent;border-radius:7px;font:inherit;font-weight:500;color:inherit;background:var(--background-modifier-hover,#35373c);cursor:pointer; }
            .soundboard-button:hover { background:var(--background-modifier-selected,#45474e); }
            .soundboard-button:disabled { opacity:.4;cursor:not-allowed; }
            .soundboard-button:disabled:hover { background:var(--background-modifier-hover,#35373c); }
            .soundboard-button:focus-visible,.soundboard-key:focus-visible { outline:2px solid var(--brand-500,#5865f2);outline-offset:2px; }
            .soundboard-primary { color:#fff;background:var(--brand-500,#5865f2); }
            .soundboard-primary:hover { background:var(--brand-560,#4752c4); }
            .soundboard-menu { flex:0 1 auto;min-height:100px;max-height:240px;overflow-y:auto;padding:12px 12px 12px 6px;border-bottom:1px solid var(--background-modifier-accent,#ffffff14); }
            .soundboard-menu .soundboard-button { font-size:12px;min-height:30px;padding:5px 10px; }
            .soundboard-grid { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px; }
            .soundboard-grid .soundboard-sound { min-height:36px;padding:0 12px;font-size:14px;border:0;border-radius:8px;background:color-mix(in srgb,currentColor 6%,transparent); }
            .soundboard-grid .soundboard-sound:hover { background:color-mix(in srgb,currentColor 12%,transparent); }
            .soundboard-tile { position:relative;min-width:0;border-radius:8px; }
            .soundboard-tile>.soundboard-sound { width:100%;height:40px; }
            .soundboard-tile .soundboard-action { position:absolute;top:4px;width:28px;min-height:32px;padding:0;opacity:0;background:var(--background-secondary,#232428); }
            .soundboard-tile:hover .soundboard-action,.soundboard-tile:focus-within .soundboard-action { opacity:1; }
            .soundboard-preview { left:2px; }
            .soundboard-favorite { right:2px; }
            .soundboard-favorite[aria-pressed=true] { color:var(--status-warning,#f0b232); }
            .soundboard-playing { box-shadow:inset 0 0 0 2px var(--brand-500,#5865f2); }
            .soundboard-menu-tools { display:flex;gap:6px;align-items:center;margin-top:8px; }
            .soundboard-search,.soundboard-text { min-width:0;padding:7px 9px;border:1px solid var(--background-modifier-accent,#ffffff20);border-radius:6px;color:inherit;background:var(--input-background,var(--background-tertiary,#1e1f22));font:inherit; }
            .soundboard-search { width:100%;font-size:12px; }
            .soundboard-menu-tools .soundboard-button { flex:0 0 auto; }
            .soundboard-filter[aria-pressed=true] { color:var(--status-warning,#f0b232); }
            .soundboard-sound-label { display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-width:0; }
            .soundboard-sound-icon { display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:20px;height:20px;font-size:20px;line-height:1; }
            .soundboard-truncate { overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0; }
            .soundboard-panel { display:grid;gap:18px;padding:4px 0; }
            .soundboard-description { margin:0;color:var(--text-muted,#a4a9b2);font-size:13px; }
            .soundboard-toolbar { justify-content:flex-start; }
            .soundboard-options { display:grid;gap:16px;padding:14px;border:1px solid var(--background-modifier-accent,#ffffff14);border-radius:9px;background:var(--background-secondary,#232428); }
            .soundboard-toggle { display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer; }
            .soundboard-toggle input { appearance:none;position:relative;flex:0 0 auto;width:34px;height:20px;margin:0;border-radius:10px;background:#5d6069;cursor:pointer; }
            .soundboard-toggle input::before { content:"";position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .12s; }
            .soundboard-toggle input:checked { background:var(--brand-500,#5865f2); }
            .soundboard-toggle input:checked::before { transform:translateX(14px); }
            .soundboard-toggle input:focus-visible { outline:2px solid var(--brand-500,#5865f2);outline-offset:3px; }
            .soundboard-volume { display:grid;gap:9px; }
            .soundboard-volume input { width:100%;margin:0;accent-color:var(--brand-500,#5865f2);cursor:pointer; }
            .soundboard-library { display:grid;gap:10px; }
            .soundboard-list { display:grid;gap:8px;padding:2px; }
            .soundboard-row { display:grid;gap:10px;padding:10px;border:1px solid var(--background-modifier-accent,#ffffff14);border-radius:8px;background:var(--background-secondary,#232428); }
            .soundboard-row-main { display:grid;grid-template-columns:38px minmax(0,1fr) 116px 28px;gap:6px;align-items:center; }
            .soundboard-row-controls { display:flex;gap:8px;align-items:center; }
            .soundboard-clip[hidden] { display:none; }
            .soundboard-waveform { display:block;width:100%;height:90px;background:#191a1d;border-radius:6px;cursor:ew-resize;touch-action:none; }
            .soundboard-clip-fields { display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:10px; }
            .soundboard-clip-fields label { display:grid;gap:4px;font-size:12px; }
            .soundboard-clip-fields input { width:110px; }
            .soundboard-row-controls label { display:flex;gap:6px;align-items:center;flex:1;font-size:12px;color:var(--text-muted,#a4a9b2); }
            .soundboard-row-controls input { width:100%;min-width:40px;accent-color:var(--brand-500,#5865f2); }
            .soundboard-row-controls .soundboard-button { min-height:28px;padding:4px 8px;font-size:12px; }
            .soundboard-text { width:100%;font-size:13px; }
            .soundboard-emoji { padding:0;min-height:34px;border-color:var(--background-modifier-accent,#ffffff20);background:var(--input-background,var(--background-tertiary,#1e1f22)); }
            .soundboard-sound-icon img { display:block;width:20px;height:20px;object-fit:contain; }
            .soundboard-emoji-picker { height:400px; }
            .soundboard-emoji-picker>div { width:100%;height:100%; }
            .soundboard-drop { outline:2px dashed var(--brand-500,#5865f2);outline-offset:4px; }
            .soundboard-row .soundboard-play { justify-content:flex-start;text-align:left;padding:8px; }
            .soundboard-key { width:100%;height:34px;padding:7px 8px;border:1px solid var(--background-modifier-accent,#ffffff20);border-radius:6px;color:inherit;background:var(--input-background,var(--background-tertiary,#1e1f22));font:12px var(--font-code,monospace);text-align:center;cursor:pointer; }
            .soundboard-key::placeholder { color:var(--text-muted,#a4a9b2);opacity:1; }
            .soundboard-remove { width:32px;min-height:32px;padding:0;font-size:22px;font-weight:400;color:var(--text-muted,#a4a9b2);background:transparent; }
            .soundboard-remove:hover { color:#ff7b86;background:#ed42451a; }
            .soundboard-empty { padding:12px 0;color:var(--text-muted,#a4a9b2);font-size:12px; }
        `;
        return style;
    }

    displayKey(key) {
        return key.replace(/Mouse3/g, "Mouse Middle").replace(/Mouse4/g, "Mouse Back").replace(/Mouse5/g, "Mouse Forward")
            .replace(/Key|Digit/g, "").replace(/Numpad/g, "Num ").replace(/\+/g, " + ");
    }

    emojiNode(sound, chooser = false) {
        const node = this.uiNode("span", "soundboard-sound-icon");
        if (sound.emoji) {
            const image = document.createElement("img");
            image.src = sound.emoji.id
                ? `https://cdn.discordapp.com/emojis/${sound.emoji.id}.${sound.emoji.animated ? "gif" : "webp"}?size=32`
                : BdApi.Webpack.getByKeys("getURL", "isEmojiFiltered").getURL(sound.emoji);
            image.alt = sound.emoji.name || sound.emoji;
            node.append(image);
        } else if (chooser) node.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 14a4 4 0 0 0 8 0M8 9h1m6 0h1"/></svg>';
        else node.textContent = "♪";
        return node;
    }

    chooseEmoji(sound, onChange) {
        const Picker = BdApi.Webpack.getModule(value => typeof value?.type === "function"
            && value.type.toString().includes("showOnlyUnicode") && value.type.toString().includes("onSelectEmoji"), { searchExports: true });
        if (!Picker) throw Error("The Discord emoji picker is unavailable. Please reopen the sound settings.");
        const modals = BdApi.Webpack.getByKeys("openModal", "closeModal");
        const selected = BdApi.Webpack.getStore("SelectedChannelStore");
        const channel = BdApi.Webpack.getStore("ChannelStore").getChannel(selected.getChannelId());
        const apply = emoji => { sound.emoji = emoji; this.save(); onChange(); };
        const modal = BdApi.UI.showConfirmationModal("Choose emoji", BdApi.React.createElement("div", {
            className: "soundboard-emoji-picker", style: { width: 440, maxWidth: "100%", margin: "0 auto" }
        }, BdApi.React.createElement(Picker, {
            channel,
            pickerIntention: BdApi.Webpack.getByKeys("EmojiIntention").EmojiIntention.SOUNDBOARD,
            containerWidth: 440,
            showAddEmojiButton: false,
            closePopout: () => modals.closeModal(modal),
            onSelectEmoji: ({ emoji }) => {
                apply(emoji.id ? { id: emoji.id, name: emoji.name, animated: Boolean(emoji.animated) } : emoji.surrogates);
                modals.closeModal(modal);
            }
        })), { size: "bd-modal-medium", confirmText: "Remove emoji", cancelText: "Cancel", onConfirm: () => apply("") });
    }

    favoriteButton(sound) {
        const button = this.uiButton(sound.favorite ? "★" : "☆", () => {
            sound.favorite = !sound.favorite;
            button.textContent = sound.favorite ? "★" : "☆";
            button.setAttribute("aria-pressed", String(sound.favorite));
            button.title = sound.favorite ? "Remove from favorites" : "Add to favorites";
            this.save();
        }, "favorite");
        button.setAttribute("aria-label", `Favorite ${sound.name}`);
        button.setAttribute("aria-pressed", String(Boolean(sound.favorite)));
        button.title = sound.favorite ? "Remove from favorites" : "Add to favorites";
        return button;
    }

    mountMenu() {
        if (document.querySelector("#soundboard-menu")) return;
        const picker = document.querySelector("[class*=soundButtonWrapper]")?.closest('[role="dialog"]');
        if (!picker) return;
        const section = this.uiNode("section", "soundboard-root soundboard-menu");
        section.id = "soundboard-menu";
        const nativeGrid = picker.querySelector('[role="grid"]');
        section.style.marginLeft = `${nativeGrid?.offsetLeft || 0}px`;
        const header = this.uiNode("div", "soundboard-header");
        const title = this.uiNode("strong", "soundboard-title", "Soundboard");
        title.append(this.uiNode("span", "soundboard-count", ` · ${this.settings.sounds.length}`));
        const manage = this.uiButton("Manage sounds", () => BdApi.UI.showConfirmationModal("Soundboard", BdApi.React.createElement("div", {
            ref: node => { if (node) node.replaceChildren(this.getSettingsPanel()); }
        }), { confirmText: "Done", cancelText: null }));
        header.append(title, manage);
        const tools = this.uiNode("div", "soundboard-menu-tools");
        const search = this.uiNode("input", "soundboard-search");
        search.placeholder = "Search your sounds";
        search.setAttribute("aria-label", "Search your sounds");
        search.value = this.search || "";
        const favorites = this.uiButton("★", () => {
            this.favoritesOnly = !this.favoritesOnly;
            favorites.setAttribute("aria-pressed", String(this.favoritesOnly));
            render();
        }, "filter");
        favorites.title = "Show favorites only";
        favorites.setAttribute("aria-label", "Show favorites only");
        favorites.setAttribute("aria-pressed", String(Boolean(this.favoritesOnly)));
        tools.append(search, favorites, this.uiButton("Stop all", () => this.stopSounds()));
        const grid = this.uiNode("div", "soundboard-grid");
        const render = () => {
            grid.replaceChildren();
            const query = search.value.trim().toLocaleLowerCase();
            const sounds = this.settings.sounds.filter(sound => (!this.favoritesOnly || sound.favorite) && sound.name.toLocaleLowerCase().includes(query))
                .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)));
            for (const sound of sounds) {
                const tile = this.uiNode("div", "soundboard-tile");
                tile.dataset.soundboardId = sound.id;
                const button = this.uiButton("", () => this.play(sound), "sound soundboard-broadcast");
                button.setAttribute("aria-label", `Play ${sound.name} in voice call`);
                const label = this.uiNode("span", "soundboard-sound-label");
                label.append(this.emojiNode(sound), this.uiNode("span", "soundboard-truncate", sound.name));
                button.append(label);
                const preview = this.uiButton("", () => this.play(sound, true), "action soundboard-preview");
                preview.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';
                preview.title = "Preview: only you can hear this";
                preview.setAttribute("aria-label", `Preview ${sound.name} locally`);
                const favorite = this.favoriteButton(sound);
                favorite.classList.add("soundboard-action");
                tile.title = sound.name + (sound.key ? ` (${this.displayKey(sound.key)})` : "");
                tile.append(button, preview, favorite);
                grid.append(tile);
            }
            if (!sounds.length) grid.append(this.uiNode("div", "soundboard-empty", this.settings.sounds.length ? "No matching sounds." : "Add an audio file to get started."));
            this.updatePlaybackState();
        };
        search.oninput = () => { this.search = search.value; render(); };
        section.append(this.uiStyle(), header, tools, grid);
        let top = picker.querySelector("input");
        while (top?.parentElement && !top.parentElement.contains(nativeGrid)) top = top.parentElement;
        if (top && nativeGrid) top.after(section);
        else picker.append(section);
        render();
    }

    async createClipEditor(sound) {
        const context = this.previewContext ||= new AudioContext();
        const buffer = await this.loadBuffer(sound, context);
        const editor = this.uiNode("div", "soundboard-clip");
        const canvas = this.uiNode("canvas", "soundboard-waveform");
        canvas.width = 800;
        canvas.height = 100;
        canvas.setAttribute("aria-label", "Waveform: drag near either edge of the selection to trim");
        const peaks = new Float32Array(400);
        const stride = Math.max(1, Math.floor(buffer.length / 100000));
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const samples = buffer.getChannelData(channel);
            for (let i = 0; i < samples.length; i += stride) {
                const bin = Math.min(399, Math.floor(i / samples.length * 400));
                peaks[bin] = Math.max(peaks[bin], Math.abs(samples[i]));
            }
        }
        const fields = this.uiNode("div", "soundboard-clip-fields");
        const inputs = {};
        const duration = this.uiNode("span", "soundboard-count");
        const draw = () => {
            const start = sound.start ?? 0;
            const end = sound.end ?? buffer.duration;
            inputs.start.value = start.toFixed(3);
            inputs.end.value = end.toFixed(3);
            duration.textContent = `${(end - start).toFixed(2)}s / ${buffer.duration.toFixed(2)}s`;
            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, 800, 100);
            ctx.fillStyle = "#5865f244";
            ctx.fillRect(start / buffer.duration * 800, 0, (end - start) / buffer.duration * 800, 100);
            for (let i = 0; i < peaks.length; i++) {
                const time = i / peaks.length * buffer.duration;
                ctx.fillStyle = time >= start && time <= end ? "#f2f3f5" : "#60646c";
                const height = Math.max(1, peaks[i] * 88);
                ctx.fillRect(i * 2, (100 - height) / 2, 1, height);
            }
            ctx.fillStyle = "#fff";
            for (const time of [start, end]) ctx.fillRect(Math.min(797, time / buffer.duration * 800), 0, 3, 100);
        };
        const change = (edge, value) => {
            if (!Number.isFinite(value)) return draw();
            const gap = 1 / buffer.sampleRate;
            if (edge === "start") sound.start = Math.max(0, Math.min(value, (sound.end ?? buffer.duration) - gap));
            else sound.end = Math.min(buffer.duration, Math.max(value, (sound.start ?? 0) + gap));
            for (const source of this.sources) if (source.soundId === sound.id) source.stop();
            draw();
        };
        for (const edge of ["start", "end"]) {
            const label = this.uiNode("label", "", `${edge === "start" ? "Start" : "End"} (s)`);
            const input = this.uiNode("input", "soundboard-text");
            input.type = "number";
            input.min = 0;
            input.max = buffer.duration;
            input.step = "0.001";
            input.setAttribute("aria-label", `${edge} in seconds for ${sound.name}`);
            input.onchange = () => { change(edge, input.valueAsNumber); this.save(); };
            inputs[edge] = input;
            label.append(input);
            fields.append(label);
        }
        let dragging;
        const timeAt = event => Math.max(0, Math.min(buffer.duration, (event.clientX - canvas.getBoundingClientRect().left) / canvas.getBoundingClientRect().width * buffer.duration));
        canvas.onpointerdown = event => {
            if (event.button !== 0) return;
            const time = timeAt(event);
            dragging = Math.abs(time - (sound.start ?? 0)) <= Math.abs(time - (sound.end ?? buffer.duration)) ? "start" : "end";
            canvas.setPointerCapture(event.pointerId);
            change(dragging, time);
        };
        canvas.onpointermove = event => { if (dragging) change(dragging, timeAt(event)); };
        canvas.onlostpointercapture = () => { dragging = null; this.save(); };
        canvas.onpointerup = event => canvas.releasePointerCapture(event.pointerId);
        const full = this.uiButton("Use full audio", () => {
            delete sound.start;
            delete sound.end;
            draw();
            this.save();
        });
        fields.append(full, duration);
        editor.append(canvas, fields);
        draw();
        return editor;
    }

    getSettingsPanel() {
        const panel = this.uiNode("div", "soundboard-root soundboard-panel");
        panel.append(this.uiStyle(), this.uiNode("p", "soundboard-description", "Your sounds, in any voice call. Use global keyboard or mouse hotkeys, or preview a sound just for yourself."));
        const toolbar = this.uiNode("div", "soundboard-toolbar");
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "audio/*";
        input.multiple = true;
        input.hidden = true;
        const importFiles = async files => {
            try {
                const fs = require("fs");
                fs.mkdirSync(require("path").join(BdApi.Plugins.folder, NAME), { recursive: true });
                for (const file of files) {
                    const sound = { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, ""), key: "" };
                    fs.writeFileSync(this.audioPath(sound.id), Buffer.from(await file.arrayBuffer()));
                    this.settings.sounds.push(sound);
                    addSound(sound);
                }
                this.save();
                updateCount();
                input.value = "";
            } catch (error) { this.error(error); }
        };
        input.onchange = () => importFiles(input.files);
        panel.ondragover = event => { event.preventDefault(); event.stopPropagation(); panel.classList.add("soundboard-drop"); };
        panel.ondragleave = event => { if (!panel.contains(event.relatedTarget)) panel.classList.remove("soundboard-drop"); };
        panel.ondrop = event => {
            event.preventDefault();
            event.stopPropagation();
            panel.classList.remove("soundboard-drop");
            importFiles([...event.dataTransfer.files].filter(file => file.type.startsWith("audio/") || /\.(mp3|wav|ogg|flac|m4a|aac|webm|opus)$/i.test(file.name)));
        };
        toolbar.append(this.uiButton("+ Add sounds", () => input.click(), "primary"), this.uiButton("Stop all", () => this.stopSounds()), input);
        const options = this.uiNode("div", "soundboard-options");
        const monitorLabel = this.uiNode("label", "soundboard-toggle");
        monitorLabel.append(this.uiNode("span", "", "Hear my sounds"));
        const monitor = document.createElement("input");
        monitor.type = "checkbox";
        monitor.setAttribute("role", "switch");
        monitor.checked = this.settings.monitor !== false;
        monitor.onchange = () => {
            this.settings.monitor = monitor.checked;
            if (this.monitor) this.monitor.gain.value = monitor.checked ? 1 : 0;
            this.save();
        };
        monitorLabel.append(monitor);
        const volumeGroup = this.uiNode("div", "soundboard-volume");
        const volumeLabel = this.uiNode("label", "soundboard-label", "Master volume");
        const percentage = this.uiNode("span", "soundboard-count", `${Math.round(this.settings.volume * 100)}%`);
        volumeLabel.append(percentage);
        const volume = document.createElement("input");
        volume.type = "range";
        volume.min = 0;
        volume.max = 1;
        volume.step = 0.05;
        volume.value = this.settings.volume;
        volume.setAttribute("aria-label", "Master volume");
        volume.oninput = () => {
            this.settings.volume = Number(volume.value);
            percentage.textContent = `${Math.round(this.settings.volume * 100)}%`;
            if (this.effects) this.effects.gain.value = this.settings.volume;
        };
        volume.onchange = () => this.save();
        volumeGroup.append(volumeLabel, volume);
        options.append(monitorLabel, volumeGroup);
        const library = this.uiNode("div", "soundboard-library");
        const heading = this.uiNode("div", "soundboard-header");
        const count = this.uiNode("span", "soundboard-count");
        heading.append(this.uiNode("strong", "soundboard-title", "Your sounds"), count);
        const list = this.uiNode("div", "soundboard-list");
        const keyInputs = new Map();
        const empty = this.uiNode("div", "soundboard-empty", "Add audio files above or drop them here.");
        list.append(empty);
        const updateCount = () => {
            count.textContent = `${this.settings.sounds.length} sound${this.settings.sounds.length === 1 ? "" : "s"}`;
            empty.hidden = this.settings.sounds.length > 0;
        };
        const addSound = sound => {
            const row = this.uiNode("div", "soundboard-row");
            row.dataset.soundboardId = sound.id;
            const main = this.uiNode("div", "soundboard-row-main");
            const emoji = this.uiButton("", () => this.chooseEmoji(sound, () => emoji.replaceChildren(this.emojiNode(sound, true))), "emoji");
            emoji.append(this.emojiNode(sound, true));
            emoji.title = "Choose emoji";
            emoji.setAttribute("aria-label", `Emoji for ${sound.name}`);
            const name = this.uiNode("input", "soundboard-text");
            name.value = sound.name;
            name.setAttribute("aria-label", "Sound name");
            name.onchange = () => { sound.name = name.value.trim() || sound.name; name.value = sound.name; this.save(); };
            const key = this.uiNode("input", "soundboard-key");
            key.placeholder = "Record hotkey";
            key.title = "Click, then press keys or a middle/side mouse button. Backspace clears it.";
            key.setAttribute("aria-label", `Hotkey for ${sound.name}`);
            key.value = this.displayKey(sound.key);
            key.readOnly = true;
            keyInputs.set(sound, key);
            const record = event => {
                event.preventDefault();
                event.stopPropagation();
                if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return this.recordMouse(key, record, event);
                sound.key = event.code === "Backspace" ? "" : this.keyName(event);
                for (const other of this.settings.sounds) {
                    if (other !== sound && other.key === sound.key) {
                        other.key = "";
                        keyInputs.get(other).value = "";
                    }
                }
                key.value = this.displayKey(sound.key);
                this.save();
                this.bindGlobalKeys();
                this.clearMouseRecording();
                key.blur();
            };
            key.onkeydown = record;
            key.onkeyup = event => {
                if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) this.recordMouse(key, record, event);
            };
            const onMouse = event => {
                if (event.button >= 2) record(event);
            };
            key.onfocus = () => { this.recordMouse(key, record); this.onRecordMouse = onMouse; window.addEventListener("mousedown", onMouse, true); };
            key.onblur = () => this.clearMouseRecording();
            const remove = this.uiButton("×", () => {
                this.settings.sounds = this.settings.sounds.filter(item => item !== sound);
                this.buffers.delete(sound.id);
                keyInputs.delete(sound);
                this.save();
                this.bindGlobalKeys();
                row.remove();
                updateCount();
            }, "remove");
            remove.title = "Remove sound";
            remove.setAttribute("aria-label", `Remove ${sound.name}`);
            main.append(emoji, name, key, remove);
            const controls = this.uiNode("div", "soundboard-row-controls");
            const play = this.uiButton("▶ Play", () => this.play(sound), "broadcast");
            const preview = this.uiButton("Preview", () => this.play(sound, true));
            preview.title = "Only you can hear this";
            let editor;
            const trim = this.uiButton("Edit clip", async () => {
                trim.disabled = true;
                try {
                    if (!editor) { editor = await this.createClipEditor(sound); row.append(editor); }
                    else editor.hidden = !editor.hidden;
                    trim.setAttribute("aria-expanded", String(!editor.hidden));
                } finally { trim.disabled = false; }
            });
            trim.setAttribute("aria-expanded", "false");
            const gainLabel = this.uiNode("label", "", "Volume");
            const gain = document.createElement("input");
            gain.type = "range";
            gain.min = 0;
            gain.max = 1;
            gain.step = 0.05;
            gain.value = sound.volume ?? 1;
            gain.setAttribute("aria-label", `Volume for ${sound.name}`);
            const gainValue = this.uiNode("span", "soundboard-count", `${Math.round(gain.value * 100)}%`);
            gain.oninput = () => { sound.volume = Number(gain.value); gainValue.textContent = `${Math.round(sound.volume * 100)}%`; };
            gain.onchange = () => this.save();
            gainLabel.append(gain, gainValue);
            controls.append(play, preview, trim, this.favoriteButton(sound), gainLabel);
            row.append(main, controls);
            list.append(row);
        };
        this.settings.sounds.forEach(addSound);
        updateCount();
        library.append(heading, list);
        panel.append(toolbar, options, library, this.uiNode("p", "soundboard-description", "Unmute to send sounds to the call. Previews are always private. Enabling during a call briefly reconnects you; disabling disconnects the call."));
        requestAnimationFrame(() => { if (!this.stopped) this.updatePlaybackState(); });
        return panel;
    }
};
