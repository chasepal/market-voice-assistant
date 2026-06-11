let configCache = {};
let isCacheReady = false;
let pendingWsMessages = [];
let audioSyncChannel = new BroadcastChannel('gmgn_audio_sync_channel');
let sharedAudioCtx = null; // 🌟 全局共享 AudioContext（必须在 _unlockAutoplay 之前声明）

const STORAGE_KEYS = [
    'twitterAudioMappings', 'customAudios', 'defaultAudio', 'isMasterEnabled',
    'enableTwitter', 'enableWallet', 'globalVolume', 'twitterVolume', 'walletVolume',
    'eventFilters', 'playDefaultUnmapped', 'enableTTS', 'ttsVoice', 'ttsRate', 'ttsPitch',
    'twitterTts', 'walletTts', 'azureTts', 'walletFilters', 'walletDictionary'
];
const DEFAULT_LOCAL_TTS = { voice: 'Sandy (中文（中国大陆）)', rate: '+0%', pitch: '+0%' };
const DEFAULT_AZURE_TTS = { provider: 'local', region: '', key: '', voice: 'zh-CN-XiaoxiaoNeural' };
const DEFAULT_EVENT_FILTERS = { tweet: true, repost: true, reply: true, quote: true, other: true };
const DEFAULT_WALLET_FILTERS = { buy: true, sellReduce: true, sellClear: true, minAmount: 0 };
const STATUS_HINT_ID = 'gmgn-companion-local-status-hint';
const STATUS_INDICATOR_ID = 'gmgn-companion-local-status-indicator';
const CROSS_TAB_EVENT_STORAGE_PREFIX = 'gmgn_companion_local_event_v2:';
const CROSS_TAB_EVENT_LOCK_PREFIX = 'gmgn-companion-local-event:';
const TWITTER_EVENT_TTL_MS = 6000;
const WALLET_TX_EVENT_TTL_MS = 45000;
const WALLET_FALLBACK_EVENT_TTL_MS = 8000;
const TAB_INSTANCE_ID = (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let statusHintTimer = null;
let extensionContextStale = false;

function isExtensionContextReady() {
    return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id && !!chrome.storage;
}

function isExtensionContextError(error) {
    return error instanceof Error && error.message.includes('Extension context invalidated');
}

function hideStatusHint() {
    const host = document.getElementById(STATUS_HINT_ID);
    if (host) host.remove();
    if (statusHintTimer) {
        clearTimeout(statusHintTimer);
        statusHintTimer = null;
    }
}

function getStatusState() {
    if (extensionContextStale || !isExtensionContextReady()) {
        return {
            tone: 'stale',
            label: '需刷新',
            title: '行情语音助手：插件已更新或页面脚本失效，请刷新此 GMGN 页面。'
        };
    }
    if (!isCacheReady) {
        return {
            tone: 'loading',
            label: '启动中',
            title: '行情语音助手：正在加载配置并挂载监听。'
        };
    }
    if (!configCache.isMasterEnabled || (!configCache.enableTwitter && !configCache.enableWallet)) {
        return {
            tone: 'paused',
            label: '已暂停',
            title: '行情语音助手：监听开关已关闭。'
        };
    }
    if (!_autoplayUnlocked) {
        return {
            tone: 'audio',
            label: '待点按启音',
            title: '行情语音助手：监控已挂上，点一下页面后才能播放语音。'
        };
    }
    return {
        tone: 'ok',
        label: '监控中',
        title: '行情语音助手：监控已启动，语音可播放。'
    };
}

function updateStatusIndicator() {
    if (!document || !document.documentElement) return;
    if (!document.body) {
        window.setTimeout(updateStatusIndicator, 500);
        return;
    }

    let host = document.getElementById(STATUS_INDICATOR_ID);
    if (!host) {
        host = document.createElement('div');
        host.id = STATUS_INDICATOR_ID;
        host.style.cssText = [
            'position:fixed',
            'right:14px',
            'bottom:14px',
            'z-index:2147483646',
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
            'pointer-events:auto'
        ].join(';');

        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                .status {
                    box-sizing: border-box;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    min-height: 24px;
                    padding: 4px 8px;
                    border-radius: 999px;
                    border: 1px solid rgba(255,255,255,0.16);
                    background: rgba(22, 24, 29, 0.78);
                    color: rgba(255,255,255,0.86);
                    font-size: 12px;
                    line-height: 1;
                    opacity: 0.72;
                    user-select: none;
                }
                .status:hover {
                    opacity: 1;
                    background: rgba(22, 24, 29, 0.86);
                }
                .dot {
                    width: 7px;
                    height: 7px;
                    border-radius: 50%;
                    background: var(--dot);
                    box-shadow: 0 0 0 2px var(--glow);
                    flex: 0 0 auto;
                }
                .status[data-tone="ok"] { --dot: #35c759; --glow: rgba(53,199,89,0.18); }
                .status[data-tone="audio"] { --dot: #ffcc00; --glow: rgba(255,204,0,0.18); }
                .status[data-tone="loading"] { --dot: #64a8ff; --glow: rgba(100,168,255,0.18); }
                .status[data-tone="paused"] { --dot: #9aa0a6; --glow: rgba(154,160,166,0.18); }
                .status[data-tone="stale"] { --dot: #ff453a; --glow: rgba(255,69,58,0.18); }
                .label { white-space: nowrap; }
            </style>
            <div class="status" title="">
                <span class="dot"></span>
                <span class="label"></span>
            </div>
        `;
        document.body.appendChild(host);
    }

    const state = getStatusState();
    const status = host.shadowRoot.querySelector('.status');
    status.dataset.tone = state.tone;
    status.title = state.title;
    host.shadowRoot.querySelector('.label').textContent = state.label;
}

function showStatusHint(message, options = {}) {
    if (!document || !document.documentElement) return;
    if (!document.body) {
        window.setTimeout(() => showStatusHint(message, options), 500);
        return;
    }

    const duration = options.duration === undefined ? 8000 : options.duration;
    let host = document.getElementById(STATUS_HINT_ID);
    if (!host) {
        host = document.createElement('div');
        host.id = STATUS_HINT_ID;
        host.style.cssText = [
            'position:fixed',
            'right:18px',
            'bottom:54px',
            'z-index:2147483647',
            'max-width:min(360px,calc(100vw - 36px))',
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
            'pointer-events:auto'
        ].join(';');

        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                .hint {
                    box-sizing: border-box;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    border-radius: 8px;
                    background: rgba(22, 24, 29, 0.94);
                    color: #fff;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.22);
                    font-size: 13px;
                    line-height: 1.45;
                }
                .text { flex: 1; min-width: 0; word-break: break-word; }
                button {
                    appearance: none;
                    border: 0;
                    background: transparent;
                    color: rgba(255,255,255,0.78);
                    cursor: pointer;
                    font-size: 18px;
                    line-height: 1;
                    padding: 0 2px;
                }
                button:hover { color: #fff; }
            </style>
            <div class="hint" role="status">
                <span class="text"></span>
                <button type="button" aria-label="关闭">×</button>
            </div>
        `;
        shadow.querySelector('button').addEventListener('click', hideStatusHint);
        document.body.appendChild(host);
    }

    host.shadowRoot.querySelector('.text').textContent = message;
    if (statusHintTimer) clearTimeout(statusHintTimer);
    if (duration > 0) {
        statusHintTimer = window.setTimeout(hideStatusHint, duration);
    }
}

function showAudioUnlockHint() {
    if (_autoplayUnlocked) return;
    updateStatusIndicator();
    showStatusHint('行情语音助手：声音还没解锁，点一下页面即可播报。', { duration: 7000 });
}

function cleanupStaleExtensionContext() {
    extensionContextStale = true;
    updateStatusIndicator();
    showStatusHint('行情语音助手：插件刚更新，请刷新此 GMGN 页面恢复监控。', { duration: 12000 });
    window.removeEventListener('TWITTER_WS_MSG_RECEIVED', handleTwitterMsg);
    window.removeEventListener('GMGN_WALLET_MSG', handleWalletMsg);
    try {
        if (typeof audioSyncChannel !== 'undefined') audioSyncChannel.close();
    } catch (e) { }
}

function applyStorageConfig(result = {}) {
    if (result.twitterAudioMappings) configCache.mappings = result.twitterAudioMappings;
    if (result.defaultAudio) configCache.defaultAudio = result.defaultAudio;
    if (!configCache.defaultAudio) configCache.defaultAudio = 'sounds/default.MP3';
    if (result.isMasterEnabled !== undefined) configCache.isMasterEnabled = result.isMasterEnabled;
    if (result.enableTwitter !== undefined) configCache.enableTwitter = result.enableTwitter;
    if (result.enableWallet !== undefined) configCache.enableWallet = result.enableWallet;
    if (result.globalVolume !== undefined) configCache.globalVolume = result.globalVolume;
    if (result.twitterVolume !== undefined) configCache.twitterVolume = result.twitterVolume;
    if (result.walletVolume !== undefined) configCache.walletVolume = result.walletVolume;
    if (result.eventFilters) configCache.eventFilters = result.eventFilters;
    if (configCache.eventFilters && configCache.eventFilters.other === undefined) configCache.eventFilters.other = true;
    if (result.playDefaultUnmapped !== undefined) configCache.playDefaultUnmapped = result.playDefaultUnmapped;
    if (result.enableTTS !== undefined) configCache.enableTTS = result.enableTTS;
    if (result.twitterTts) configCache.twitterTts = result.twitterTts;
    if (result.walletTts) configCache.walletTts = result.walletTts;
    if (result.azureTts) configCache.azureTts = result.azureTts;
    if (result.walletFilters) configCache.walletFilters = result.walletFilters;
    if (result.walletDictionary) configCache.walletDictionary = result.walletDictionary;
}

function initDefaultConfig(result = {}) {
    configCache.isMasterEnabled = result.isMasterEnabled !== false;
    configCache.enableTwitter = result.enableTwitter !== false;
    configCache.enableWallet = result.enableWallet !== false;
    configCache.globalVolume = result.globalVolume !== undefined ? result.globalVolume : 1.0;
    configCache.twitterVolume = result.twitterVolume !== undefined ? result.twitterVolume : (configCache.globalVolume || 1.0);
    configCache.walletVolume = result.walletVolume !== undefined ? result.walletVolume : (configCache.globalVolume || 1.0);
    configCache.mappings = result.twitterAudioMappings || {};
    configCache.customAudios = result.customAudios || {};
    configCache.eventFilters = result.eventFilters || { ...DEFAULT_EVENT_FILTERS };
    configCache.playDefaultUnmapped = result.playDefaultUnmapped !== false;
    configCache.enableTTS = result.enableTTS !== false;
    configCache.twitterTts = result.twitterTts || { ...DEFAULT_LOCAL_TTS };
    configCache.walletTts = result.walletTts || { ...DEFAULT_LOCAL_TTS };
    configCache.azureTts = result.azureTts || { ...DEFAULT_AZURE_TTS };
    configCache.walletFilters = result.walletFilters || { ...DEFAULT_WALLET_FILTERS };
    configCache.walletDictionary = result.walletDictionary || {};
    configCache.defaultAudio = result.defaultAudio || 'sounds/default.MP3';
}

// ════════════════════════════════════════════════════════════
// 🔒 跨 Tab 事件去重引擎
// BroadcastChannel 只做通知；真正抢占播放权用 Web Locks + localStorage。
// 这样多个 GMGN 标签页同时收到同一条消息时，也只有一个页面会拿到播放权。
// ════════════════════════════════════════════════════════════
const otherTabPlayedEvents = new Map(); // fingerprint -> { owner, ts, expires }

function normalizeEventKey(key) {
    return encodeURIComponent(String(key)).slice(0, 220);
}

function getEventStorageKey(key) {
    return `${CROSS_TAB_EVENT_STORAGE_PREFIX}${normalizeEventKey(key)}`;
}

function isActiveEventRecord(record, now = Date.now()) {
    return !!record && Number(record.expires) > now;
}

function rememberEventInMemory(key, record) {
    otherTabPlayedEvents.set(key, record);
    if (otherTabPlayedEvents.size > 300) {
        const iter = otherTabPlayedEvents.keys();
        for (let i = 0; i < 120; i++) otherTabPlayedEvents.delete(iter.next().value);
    }
}

function readStoredEventRecord(key) {
    try {
        const raw = localStorage.getItem(getEventStorageKey(key));
        if (!raw) return null;
        const record = JSON.parse(raw);
        if (!isActiveEventRecord(record)) {
            localStorage.removeItem(getEventStorageKey(key));
            return null;
        }
        rememberEventInMemory(key, record);
        return record;
    } catch (e) {
        return null;
    }
}

function writeStoredEventRecord(key, ttlMs) {
    const now = Date.now();
    const existing = getKnownEventRecord(key);
    const record = existing && existing.owner === TAB_INSTANCE_ID ? {
        ...existing,
        expires: Math.max(Number(existing.expires) || 0, now + ttlMs)
    } : {
        owner: TAB_INSTANCE_ID,
        ts: now,
        expires: now + ttlMs
    };
    rememberEventInMemory(key, record);
    try {
        localStorage.setItem(getEventStorageKey(key), JSON.stringify(record));
    } catch (e) { }
    try {
        audioSyncChannel.postMessage({ type: 'EVENT_PLAYED', key, record });
    } catch (e) { }
    return record;
}

function getKnownEventRecord(key) {
    const memoryRecord = otherTabPlayedEvents.get(key);
    if (isActiveEventRecord(memoryRecord)) return memoryRecord;
    if (memoryRecord) otherTabPlayedEvents.delete(key);
    return readStoredEventRecord(key);
}

function isEventClaimed(key, { allowOwner = false } = {}) {
    const record = getKnownEventRecord(key);
    if (!record) return false;
    return !(allowOwner && record.owner === TAB_INSTANCE_ID);
}

async function claimCrossTabEvent(key, ttlMs, options = {}) {
    if (!key) return true;
    const allowOwner = !!options.allowOwner;
    const claim = () => {
        const existing = getKnownEventRecord(key);
        if (existing) return allowOwner && existing.owner === TAB_INSTANCE_ID;
        writeStoredEventRecord(key, ttlMs);
        return true;
    };

    if (navigator.locks && typeof navigator.locks.request === 'function') {
        let result = false;
        try {
            await navigator.locks.request(
                `${CROSS_TAB_EVENT_LOCK_PREFIX}${normalizeEventKey(key)}`,
                { ifAvailable: true },
                (lock) => {
                    result = !!lock && claim();
                }
            );
            return result;
        } catch (e) {
            return claim();
        }
    }

    return claim();
}

/** 兼容旧调用点：检查事件是否已被别的页面抢占。 */
function wasPlayedByOtherTab(fingerprint) {
    return isEventClaimed(fingerprint);
}

/** 标记事件已播放并广播给其他 Tab。 */
function markEventPlayed(fingerprint, ttlMs = TWITTER_EVENT_TTL_MS) {
    writeStoredEventRecord(fingerprint, ttlMs);
}

// 注入移交至 manifest.json 中的 world: "MAIN" 保证绝对的同步执行

// 🔓 Autoplay Policy 解锁器：用户首次交互时同时解锁 Audio.play() + AudioContext
let _autoplayUnlocked = false;
const _unlockAutoplay = () => {
    if (_autoplayUnlocked) return;
    _autoplayUnlocked = true;
    hideStatusHint();
    updateStatusIndicator();

    // 1️⃣ 解锁 Audio.play()（从对象池借用，避免创建新实例）
    const silent = AudioPool.acquire();
    if (silent) {
        silent.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
        silent.volume = 0;
        silent.play().then(() => {
            console.log("🔓 [行情语音助手] Audio.play() 已解锁");
            AudioPool.release(silent);
        }).catch(() => { AudioPool.release(silent); });
    }

    // 2️⃣ 解锁 AudioContext（GainNode 超级音量依赖此上下文）
    try {
        if (!sharedAudioCtx) {
            sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (sharedAudioCtx.state === 'suspended') {
            sharedAudioCtx.resume().then(() => {
                console.log("🔓 [行情语音助手] AudioContext 已解锁, state:", sharedAudioCtx.state);
            });
        }
    } catch (e) {
        console.warn("⚠️ [行情语音助手] AudioContext 解锁失败:", e);
    }

    ['click', 'keydown', 'touchstart'].forEach(evt =>
        document.removeEventListener(evt, _unlockAutoplay, true)
    );
};
['click', 'keydown', 'touchstart'].forEach(evt =>
    document.addEventListener(evt, _unlockAutoplay, { once: false, capture: true })
);

if (isExtensionContextReady()) {
    chrome.storage.local.get(null, (result) => {
        if (chrome.runtime.lastError) return;
        initDefaultConfig(result);
        updateStatusIndicator();
    });
} else {
    initDefaultConfig();
    updateStatusIndicator();
}

// Local build: TTS uses the browser's built-in speechSynthesis API.
// No event text is sent to a remote TTS service.

// 🌟 极速双缓存引擎：IndexedDB 本地持久化（带连接健康检查 + 超时保护）
const idb = {
    db: null,
    async init() {
        if (this.db) {
            try {
                // 健康检查：尝试发起空事务，如果底层连接已断会立刻抛异常
                this.db.transaction('audio', 'readonly');
                return this.db;
            } catch (e) {
                console.warn("⚠️ [行情语音助手 - IDB] 连接已失效，重连中...");
                this.db = null;
            }
        }
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('GMGNTTSCache', 1);
            req.onupgradeneeded = (e) => e.target.result.createObjectStore('audio', { keyPath: 'text' });
            req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
            req.onerror = () => reject(req.error);
        });
    },
    async get(text) {
        try {
            await this.init();
            return await Promise.race([
                new Promise((resolve, reject) => {
                    const req = this.db.transaction('audio', 'readonly').objectStore('audio').get(text);
                    req.onsuccess = () => resolve(req.result ? req.result.blob : null);
                    req.onerror = () => reject(req.error);
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('IDB get timeout')), 3000))
            ]);
        } catch (e) {
            console.warn("⚠️ [行情语音助手 - IDB] 读取失败，跳过缓存:", e.message);
            this.db = null; // 标记连接失效，下次强制重连
            return null;    // 保留旧缓存接口兼容性；本地版 TTS 不再使用网络请求。
        }
    },
    async set(text, blob) {
        try {
            await this.init();
            await Promise.race([
                new Promise((resolve, reject) => {
                    const req = this.db.transaction('audio', 'readwrite').objectStore('audio').put({ text, blob, ts: Date.now() });
                    req.onsuccess = () => resolve();
                    req.onerror = () => reject(req.error);
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('IDB set timeout')), 3000))
            ]);
        } catch (e) {
            console.warn("⚠️ [行情语音助手 - IDB] 写入失败，跳过缓存:", e.message);
            this.db = null;
        }
    }
};

// 🌟 新增核心：极速内存预热引擎
// ════════════════════════════════════════════════════════════
// 🏊 Audio 固定对象池 — 彻底消灭 WebMediaPlayer 泄漏
// 核心原则：启动时创建少量 Audio 实例，永不增减
// 播放时并发借用，全部占满才排队，播完归还
// ════════════════════════════════════════════════════════════
const AudioPool = {
    _pool: [],       // 所有 Audio 实例（固定 20 个）
    _idle: [],       // 空闲实例索引（FIFO 队列）
    _queue: [],      // 待播放任务队列（仅当池满时排队）
    SIZE: 8,

    init() {
        for (let i = 0; i < this.SIZE; i++) {
            const audio = new Audio();
            audio.__poolIdx = i;
            audio.__inUse = false;
            this._pool.push(audio);
            this._idle.push(i);
        }
        console.log(`🏊 [行情语音助手] Audio 对象池已初始化, 容量: ${this.SIZE}`);
    },

    /** 尝试获取空闲 Audio，无空闲返回 null */
    acquire() {
        if (this._idle.length === 0) return null;
        const idx = this._idle.shift();
        const audio = this._pool[idx];
        audio.__inUse = true;
        return audio;
    },

    /** 归还 Audio 到空闲池 + 触发队列消费 */
    release(audio) {
        if (!audio || audio.__poolIdx === undefined || !audio.__inUse) return;
        try {
            audio.pause();
            audio.onended = null;
            audio.onerror = null;
            audio.removeAttribute('src');
            audio.load(); // 释放底层解码器，但不影响 sourceNode/gainNode 绑定
        } catch (e) { /* 忽略清理异常 */ }
        audio.__inUse = false;
        this._idle.push(audio.__poolIdx);
        this._drain();
    },

    /**
     * 请求播放：有空闲实例直接并发执行，否则排队等待
     * @param {Function} taskFn - 接收 (audio) 参数的播放回调
     */
    play(taskFn) {
        const audio = this.acquire();
        if (audio) {
            taskFn(audio);
        } else {
            if (this._queue.length >= 20) {
                this._queue.shift();
                console.warn("⚠️ [行情语音助手] 播放队列已满，丢弃最旧任务");
            }
            this._queue.push(taskFn);
        }
    },

    /** 消费等待队列 */
    _drain() {
        while (this._queue.length > 0 && this._idle.length > 0) {
            const task = this._queue.shift();
            const audio = this.acquire();
            if (audio) task(audio);
        }
    },

    /** 获取状态信息（调试用） */
    status() {
        return { total: this.SIZE, idle: this._idle.length, queued: this._queue.length };
    }
};

// 🏊 立即初始化对象池（Audio 元素创建不需要用户交互）
AudioPool.init();

// ════════════════════════════════════════════════════════════
// 🗄️ Blob 数据预热缓存 — 纯数据层，不占 WebMediaPlayer 配额
// ════════════════════════════════════════════════════════════
const blobCache = new Map(); // src → blobUrl（字符串）
const audioWarmupWarnAt = new Map(); // src → last warning timestamp
const AUDIO_WARMUP_WARN_INTERVAL = 60000;

async function warmupAudio(src) {
    if (!src || blobCache.has(src)) return;
    blobCache.set(src, null); // 占位，防止并发重复获取
    try {
        let fetchUrl = src;
        // chrome-extension:// URL 需要先 fetch 转 Blob（页面上下文跨域限制）
        if (src.startsWith('chrome-extension://')) {
            fetchUrl = src;
        }
        // data: URI 和 blob: URL 不需要预热
        if (src.startsWith('data:') || src.startsWith('blob:')) {
            blobCache.set(src, src); // 直接缓存原始 URL
            return;
        }
        const res = await fetch(fetchUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        blobCache.set(src, blobUrl);
    } catch (e) {
        blobCache.delete(src); // 失败时移除占位，允许下次重试
        const now = Date.now();
        const lastWarnAt = audioWarmupWarnAt.get(src) || 0;
        if (now - lastWarnAt > AUDIO_WARMUP_WARN_INTERVAL) {
            audioWarmupWarnAt.set(src, now);
            console.warn("⚠️ [行情语音助手] 音频预热失败（如刚更新/重载插件，请刷新 GMGN 页面）:", src, e.message);
        }
    }
}

// 🌟 将所有可能播放的音频提前灌入 Blob 缓存
function initPreloadCache() {
    // 回收旧的 Blob URL（避免内存泄漏）
    blobCache.forEach((blobUrl, src) => {
        if (blobUrl && blobUrl.startsWith('blob:') && !src.startsWith('blob:')) {
            URL.revokeObjectURL(blobUrl);
        }
    });
    blobCache.clear();

    // 1. 预热默认提示音
    const defaultSrc = configCache.defaultAudio || 'sounds/default.MP3';
    warmupAudio(chrome.runtime.getURL(defaultSrc));

    // 2. 预热自定义音频 (Blob 链接直接缓存)
    for (const key in configCache.customAudios) {
        const audioItem = configCache.customAudios[key];
        if (audioItem && audioItem.data) warmupAudio(audioItem.data);
    }

    // 3. 预热扩展内置的预设音频
    for (const key in configCache.mappings) {
        const rule = configCache.mappings[key];
        const audioId = (typeof rule === 'object' && rule !== null) ? rule.id : rule;
        if (audioId && !audioId.startsWith('custom_')) {
            warmupAudio(chrome.runtime.getURL(`sounds/${audioId}`));
        }
    }
    console.log(`🚀 [行情语音助手] Blob 预热完成 | 对象池状态:`, AudioPool.status());
}

// sharedAudioCtx 已提升到文件顶部声明
function applyGainToAudio(audio, volume) {
    // 已绑定 GainNode 的池 Audio：统一通过 GainNode 控制音量（createMediaElementSource 不可逆）
    if (audio.__gainNode) {
        audio.__gainNode.gain.value = volume;
        audio.volume = 1.0;
        return;
    }

    // 未绑定 GainNode：音量 ≤100% 直接用原生 volume
    if (volume <= 1.0) {
        audio.volume = Math.max(0, volume);
        return;
    }
    audio.volume = 1.0;

    // 🛡️ Autoplay 未解锁时，禁止触碰 AudioContext
    if (!_autoplayUnlocked) return;

    // 🔥 防御静音 Bug：非 blob/data 源不走 Web Audio API
    const isSafe = audio.crossOrigin === "anonymous" ||
                  (audio.src && (audio.src.startsWith('blob:') || audio.src.startsWith('data:')));
    if (!isSafe) return;

    try {
        if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume();

        // 首次绑定（永久），后续复用时直走上方 __gainNode 分支
        if (!audio.__sourceNode) {
            audio.__sourceNode = sharedAudioCtx.createMediaElementSource(audio);
            audio.__gainNode = sharedAudioCtx.createGain();
            audio.__sourceNode.connect(audio.__gainNode);
            audio.__gainNode.connect(sharedAudioCtx.destination);
        }
        audio.__gainNode.gain.value = volume;
    } catch (e) {
        console.warn("[行情语音助手] 超级音量增益失败，降级为 100% 音量:", e);
    }
}



function handleAudioSyncMessage(event) {
    const data = event.data;
    if (data && typeof data === 'object' && data.type === 'EVENT_PLAYED') {
        const record = data.record || { owner: 'unknown', ts: Date.now(), expires: Date.now() + TWITTER_EVENT_TTL_MS };
        rememberEventInMemory(data.key, record);
    }
}

audioSyncChannel.onmessage = handleAudioSyncMessage;

// 🌟 优化：仅在真正的休眠恢复时重新初始化（避免标签页切换时的性能浪费）
let lastVisibilityState = document.visibilityState;
let lastVisibilityChangeTime = Date.now();

document.addEventListener('visibilitychange', () => {
    const now = Date.now();
    const hiddenDuration = now - lastVisibilityChangeTime;

    // 只有当页面隐藏超过 5 分钟（300000ms）才认为可能是休眠，否则只是普通的标签切换
    if (lastVisibilityState === 'hidden' && document.visibilityState === 'visible' && hiddenDuration > 300000) {
        console.log("🔄 [行情语音助手] 检测到长时间休眠恢复，正在重新初始化音频系统...");

        // 重新创建 BroadcastChannel（可能已断开）
        try {
            audioSyncChannel.close();
        } catch (e) { }
        audioSyncChannel = new BroadcastChannel('gmgn_audio_sync_channel');
        audioSyncChannel.onmessage = handleAudioSyncMessage;

        // 重新加载配置并预热音频
        try {
            if (!isExtensionContextReady()) return;
            chrome.storage.local.get(STORAGE_KEYS, async (result) => {
                if (chrome.runtime.lastError) return;
            applyStorageConfig(result);

            if (result.customAudios) {
                // 🔥 关键修复：回收旧的 Blob URL，防止内存泄漏
                for (const key in configCache.customAudios) {
                    const oldData = configCache.customAudios[key].data;
                    if (typeof oldData === 'string' && oldData.startsWith('blob:')) {
                        URL.revokeObjectURL(oldData);
                    }
                }

                configCache.customAudios = result.customAudios;
                await convertBase64ToBlobUrl(configCache.customAudios);
            }

            initPreloadCache();
            syncMasterToggle();
            console.log("✅ [行情语音助手] 音频系统恢复完成:", {
                mappingCount: Object.keys(configCache.mappings).length,
                customAudioCount: Object.keys(configCache.customAudios).length
            });
        });
        } catch (e) {
            if (isExtensionContextError(e)) {
                cleanupStaleExtensionContext();
            } else {
                console.error(e);
            }
        }
    }

    lastVisibilityState = document.visibilityState;
    lastVisibilityChangeTime = now;
});

function syncMasterToggle() {
    window.dispatchEvent(new CustomEvent('GMGN_AUDIO_TOGGLE', { detail: { enabled: configCache.isMasterEnabled } }));
}

function convertBase64ToBlobUrl(customAudiosObj) {
    for (const key in customAudiosObj) {
        const audioItem = customAudiosObj[key];
        if (typeof audioItem.data === 'string' && audioItem.data.startsWith('data:')) {
            try {
                // MV3 content script 禁止 fetch data: URI，改用 atob 手动解码
                const [header, b64] = audioItem.data.split(',');
                const mime = header.match(/data:(.*?);/)?.[1] || 'audio/mpeg';
                const binary = atob(b64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                const blob = new Blob([bytes], { type: mime });
                audioItem.data = URL.createObjectURL(blob);
            } catch (e) {
                console.error("[行情语音助手] Blob 转换失败:", e);
            }
        }
    }
}

if (isExtensionContextReady()) {
chrome.storage.local.get(STORAGE_KEYS, async (result) => { // 🌟 数组加了高级定制选项+旧版字段用于迁移
    if (chrome.runtime.lastError) return;
    applyStorageConfig(result);

    // ════════════════════════════════════════════════════════════
    // 🔄 一次性存储迁移（旧版 → 新版），迁移完成后回写并清除旧字段
    // ════════════════════════════════════════════════════════════
    const migrationWrites = {};  // 需要写入的新字段
    const migrationDeletes = []; // 需要清除的旧字段

    // 1️⃣ TTS 配置迁移：旧版 ttsVoice/ttsRate/ttsPitch → 新版 twitterTts/walletTts
    if (!result.twitterTts && (result.ttsVoice || result.ttsRate || result.ttsPitch)) {
        const oldTts = {
            voice: result.ttsVoice || 'Sandy (中文（中国大陆）)',
            rate: result.ttsRate || '+0%',
            pitch: result.ttsPitch || '+0%'
        };
        configCache.twitterTts = oldTts;
        configCache.walletTts = { ...oldTts }; // 钱包也继承旧版设置
        migrationWrites.twitterTts = oldTts;
        migrationWrites.walletTts = { ...oldTts };
        migrationDeletes.push('ttsVoice', 'ttsRate', 'ttsPitch');
        console.log("🔄 [行情语音助手 - 迁移] TTS 配置已从旧版迁移:", oldTts);
    }

    // 2️⃣ 音量迁移：旧版 globalVolume → 新版 twitterVolume/walletVolume
    if (result.globalVolume !== undefined && result.twitterVolume === undefined) {
        configCache.twitterVolume = result.globalVolume;
        configCache.walletVolume = result.globalVolume;
        migrationWrites.twitterVolume = result.globalVolume;
        migrationWrites.walletVolume = result.globalVolume;
        console.log("🔄 [行情语音助手 - 迁移] 音量已从 globalVolume 迁移:", result.globalVolume);
    }

    // 3️⃣ 钱包过滤器迁移：旧版 sell:true → 新版 sellReduce/sellClear
    if (result.walletFilters && result.walletFilters.sell !== undefined && result.walletFilters.sellReduce === undefined) {
        const oldSell = result.walletFilters.sell;
        configCache.walletFilters.sellReduce = oldSell;
        configCache.walletFilters.sellClear = oldSell;
        delete configCache.walletFilters.sell;
        migrationWrites.walletFilters = configCache.walletFilters;
        console.log("🔄 [行情语音助手 - 迁移] 卖出过滤器已拆分:", { sellReduce: oldSell, sellClear: oldSell });
    }

    // 4️⃣ defaultAudio 迁移：确保 storage 中有值
    if (!result.defaultAudio) {
        migrationWrites.defaultAudio = 'sounds/default.MP3';
    }

    // 执行回写（仅在有迁移项时触发一次 set + remove）
    if (Object.keys(migrationWrites).length > 0) {
        chrome.storage.local.set(migrationWrites, () => {
            console.log("✅ [行情语音助手 - 迁移] 已回写新版配置:", Object.keys(migrationWrites));
        });
    }
    if (migrationDeletes.length > 0) {
        chrome.storage.local.remove(migrationDeletes, () => {
            console.log("🗑️ [行情语音助手 - 迁移] 已清除旧版字段:", migrationDeletes);
        });
    }
    // ════════════════════════════════════════════════════════════

    if (result.customAudios) {
        configCache.customAudios = result.customAudios;
        await convertBase64ToBlobUrl(configCache.customAudios);
    }

    // 🌟 在数据加载完毕后，立刻执行预热
    initPreloadCache();
    // warmupTTSVoice(); 已废弃，本地版使用浏览器 speechSynthesis。

    syncMasterToggle();
    isCacheReady = true;
    updateStatusIndicator();

    console.log("⚙️ [行情语音助手] 配置加载完成:", {
        mappingCount: Object.keys(configCache.mappings).length,
        customAudioCount: Object.keys(configCache.customAudios).length,
        isMasterEnabled: configCache.isMasterEnabled,
        playDefaultUnmapped: configCache.playDefaultUnmapped
    });

    if (pendingWsMessages.length > 0) {
        pendingWsMessages.forEach(pendingE => {
            handleTwitterMsg(pendingE);
        });
        pendingWsMessages = [];
    }
});
}

if (isExtensionContextReady()) {
chrome.storage.onChanged.addListener(async (changes, namespace) => {
    // 增加防御性校验：如果上下文已丢失，直接阻断后续的异步逻辑
    if (!isExtensionContextReady()) return;
    if (namespace === 'local') {
        let needsPreload = false;

        if (changes.twitterAudioMappings) {
            configCache.mappings = changes.twitterAudioMappings.newValue || {};
            needsPreload = true;
        }
        if (changes.globalVolume) configCache.globalVolume = changes.globalVolume.newValue;
        if (changes.twitterVolume) configCache.twitterVolume = changes.twitterVolume.newValue;
        if (changes.walletVolume) configCache.walletVolume = changes.walletVolume.newValue;
        if (changes.eventFilters) configCache.eventFilters = changes.eventFilters.newValue;
        if (changes.isMasterEnabled) {
            configCache.isMasterEnabled = changes.isMasterEnabled.newValue;
            syncMasterToggle();
            updateStatusIndicator();
        }
        if (changes.enableTwitter) {
            configCache.enableTwitter = changes.enableTwitter.newValue;
            updateStatusIndicator();
        }
        if (changes.enableWallet) {
            configCache.enableWallet = changes.enableWallet.newValue;
            updateStatusIndicator();
        }
        // 🌟 监听开关变动更新缓存
        if (changes.playDefaultUnmapped) {
            configCache.playDefaultUnmapped = changes.playDefaultUnmapped.newValue;
        }
        if (changes.enableTTS) {
            configCache.enableTTS = changes.enableTTS.newValue;
        }
        if (changes.twitterTts) configCache.twitterTts = changes.twitterTts.newValue;
        if (changes.walletTts) configCache.walletTts = changes.walletTts.newValue;
        if (changes.azureTts) configCache.azureTts = changes.azureTts.newValue;
        if (changes.walletFilters) configCache.walletFilters = changes.walletFilters.newValue;
        if (changes.walletDictionary) configCache.walletDictionary = changes.walletDictionary.newValue;
        if (changes.customAudios) {
            const oldAudios = configCache.customAudios;
            for (const key in oldAudios) {
                const oldData = oldAudios[key].data;
                if (typeof oldData === 'string' && oldData.startsWith('blob:')) {
                    URL.revokeObjectURL(oldData);
                }
            }
            configCache.customAudios = changes.customAudios.newValue || {};
            await convertBase64ToBlobUrl(configCache.customAudios);
            needsPreload = true;
        }

        // 🌟 配置有任何变动，立刻重新刷新预热池
        if (needsPreload) {
            initPreloadCache();
        }
    }
});
}

// 🌟 优化：使用 Map 结构，利用其维持插入顺序的特性进行优雅的 LRU 淘汰
let lastPlayTime = new Map();
let globalLastPlayTime = 0;

function parseTtsPercent(value, fallback = 1) {
    if (typeof value !== 'string') return fallback;
    const match = value.match(/^([+-]?\d+(?:\.\d+)?)%$/);
    if (!match) return fallback;
    return fallback + (Number(match[1]) / 100);
}

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function cleanTtsText(text) {
    return String(text)
        .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0E\uFE0F\u200D\u20E3]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function scoreLocalVoice(voice) {
    const name = (voice.name || '').toLowerCase();
    const lang = (voice.lang || '').toLowerCase();
    let score = 0;

    if (lang === 'zh-cn') score += 70;
    else if (lang.startsWith('zh')) score += 55;
    else if (name.includes('chinese') || name.includes('mandarin') || name.includes('putonghua')) score += 35;

    if (voice.localService) score += 15;
    if (name.includes('sandy')) score += 46;
    if (name.includes('shelley')) score += 44;
    if (name.includes('flo')) score += 42;
    if (name.includes('eddy')) score += 40;
    if (name.includes('reed') || name.includes('rocko')) score += 35;
    if (name.includes('xiaoxiao')) score += 32;
    if (name.includes('yaoyao')) score += 30;
    if (name.includes('yunjian') || name.includes('yunxi') || name.includes('yunyang')) score += 28;
    if (name.includes('tingting')) score += 18;
    if (name.includes('yu-shu') || name.includes('meijia') || name.includes('sin-ji')) score += 22;
    if (name.includes('google')) score += 10;
    if (name.includes('enhanced') || name.includes('premium')) score += 10;

    return score;
}

function chooseLocalVoice(preferredVoice) {
    const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    const exact = voices.find(v => v.voiceURI === preferredVoice || v.name === preferredVoice);
    if (exact) return exact;

    return voices
        .slice()
        .sort((a, b) => scoreLocalVoice(b) - scoreLocalVoice(a))[0]
        || null;
}

function speakLocalSegment(text, ttsConfig, targetVolume) {
    return new Promise((resolve, reject) => {
        if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
            reject(new Error('speechSynthesis unavailable'));
            return;
        }

        const cleanedText = cleanTtsText(text);
        if (!cleanedText) {
            resolve();
            return;
        }

        const utterance = new SpeechSynthesisUtterance(cleanedText);
        const voice = chooseLocalVoice(ttsConfig.voice);
        if (voice) utterance.voice = voice;
        utterance.lang = voice && voice.lang ? voice.lang : 'zh-CN';
        utterance.rate = clampNumber(parseTtsPercent(ttsConfig.rate, 1), 0.5, 2);
        utterance.pitch = clampNumber(parseTtsPercent(ttsConfig.pitch, 1), 0, 2);
        utterance.volume = clampNumber(targetVolume, 0, 1);
        utterance.onend = () => resolve();
        utterance.onerror = (event) => {
            if (event && event.error === 'not-allowed') showAudioUnlockHint();
            reject(new Error(event.error || 'speechSynthesis error'));
        };
        window.speechSynthesis.speak(utterance);
    });
}

function playDataUrlAudio(dataUrl, source = 'twitter') {
    return new Promise((resolve, reject) => {
        const defaultVol = configCache.globalVolume !== undefined ? configCache.globalVolume : 1;
        const targetVolume = source === 'wallet'
            ? (configCache.walletVolume !== undefined ? configCache.walletVolume : defaultVol)
            : (configCache.twitterVolume !== undefined ? configCache.twitterVolume : defaultVol);

        AudioPool.play((player) => {
            player.crossOrigin = "anonymous";
            player.src = dataUrl;
            applyGainToAudio(player, targetVolume);

            player.onended = () => {
                AudioPool.release(player);
                resolve();
            };
            player.onerror = () => {
                AudioPool.release(player);
                reject(new Error('audio playback failed'));
            };
            player.play().catch((error) => {
                AudioPool.release(player);
                if (error && error.name === 'NotAllowedError') showAudioUnlockHint();
                reject(error);
            });
        });
    });
}

function requestAzureTTS(text, source, ttsConfig) {
    if (!isExtensionContextReady()) {
        return Promise.reject(new Error('Extension context invalidated'));
    }
    const azureTts = configCache.azureTts || {};
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: 'AZURE_TTS',
            payload: {
                text,
                source,
                region: azureTts.region,
                key: azureTts.key,
                voice: azureTts.voice || 'zh-CN-XiaoxiaoNeural',
                rate: ttsConfig.rate || '+0%',
                pitch: ttsConfig.pitch || '+0%'
            }
        }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (!response || !response.ok) {
                reject(new Error((response && response.error) || 'Azure TTS failed'));
                return;
            }
            resolve(response.audioDataUrl);
        });
    });
}

// 🎤 本地 TTS 播放引擎：使用浏览器内置 speechSynthesis，不发送网络请求
async function playNetworkTTS(textItems, source = 'twitter') {
    const items = Array.isArray(textItems) ? textItems : [textItems];
    if (items.length === 0 || !items[0]) return;
    console.log(`🔊 [行情语音助手 Local - TTS (${source})] 播报:`, items.join(' → '));

    const ttsConfig = source === 'wallet' ? (configCache.walletTts || {}) : (configCache.twitterTts || {});
    const localTtsConfig = {
        voice: ttsConfig.voice || 'Sandy (中文（中国大陆）)',
        rate: ttsConfig.rate || '+0%',
        pitch: ttsConfig.pitch || '+0%'
    };

    const defaultVol = configCache.globalVolume !== undefined ? configCache.globalVolume : 1;
    const targetVolume = source === 'wallet' 
        ? (configCache.walletVolume !== undefined ? configCache.walletVolume : defaultVol)
        : (configCache.twitterVolume !== undefined ? configCache.twitterVolume : defaultVol);

    try {
        const azureTts = configCache.azureTts || {};
        const cleanedItems = items.map(cleanTtsText).filter(Boolean);
        if (azureTts.provider === 'azure' && azureTts.region && azureTts.key && cleanedItems.length > 0) {
            const audioDataUrl = await requestAzureTTS(cleanedItems.join('，'), source, localTtsConfig);
            await playDataUrlAudio(audioDataUrl, source);
            return;
        }

        for (const item of items) {
            await speakLocalSegment(String(item), localTtsConfig, targetVolume);
        }
    } catch (error) {
        if (isExtensionContextError(error)) {
            cleanupStaleExtensionContext();
            return;
        }
        console.warn("⚠️ [行情语音助手 Local - TTS] Azure/本地 TTS 失败，尝试本地回退:", error.message || error);
        try {
            for (const item of items) {
                await speakLocalSegment(String(item), localTtsConfig, targetVolume);
            }
        } catch (fallbackError) {
            console.warn("⚠️ [行情语音助手 Local - TTS] 本地 TTS 回退失败，播放默认提示音:", fallbackError.message || fallbackError);
            playConcurrentAudio(chrome.runtime.getURL(configCache.defaultAudio || 'sounds/default.MP3'), source);
        }
    }
}

// 🌟 统一的 playConcurrentAudio（AudioPool 池化版）
function playConcurrentAudio(src, source = 'twitter', ttsFallbackText = null) {
    if (!src) return;
    const defaultVol = configCache.globalVolume !== undefined ? configCache.globalVolume : 1;
    const targetVolume = source === 'wallet' 
        ? (configCache.walletVolume !== undefined ? configCache.walletVolume : defaultVol)
        : (configCache.twitterVolume !== undefined ? configCache.twitterVolume : defaultVol);

    // 优先使用 Blob 缓存的 URL（预热时已转换）
    const playUrl = blobCache.get(src) || src;

    // 如果缓存还在预热中（占位 null），降级用原始 src
    const finalUrl = playUrl || src;

    // 🏊 从池中借用 Audio，播完归还
    AudioPool.play((player) => {
        // Blob/data URL 设置 crossOrigin 以支持 Web Audio API 增益
        if (finalUrl.startsWith('blob:') || finalUrl.startsWith('data:')) {
            player.crossOrigin = "anonymous";
        } else {
            player.crossOrigin = null;
        }

        player.src = finalUrl;
        applyGainToAudio(player, targetVolume);

        player.onended = () => {
            AudioPool.release(player);
        };

        player.onerror = (e) => {
            console.warn("⚠️ [行情语音助手] 音频播放错误:", e);
            AudioPool.release(player);
            if (ttsFallbackText) {
                playNetworkTTS(ttsFallbackText, source);
            }
        };

        player.play().catch(e => {
            if (e.name !== 'NotAllowedError') {
                console.error("❌ [行情语音助手] 音频播放失败:", { error: e.name, message: e.message });
            } else {
                showAudioUnlockHint();
            }
            AudioPool.release(player);
            if (ttsFallbackText) {
                playNetworkTTS(ttsFallbackText, source);
            }
        });
    });

    // 缓存未命中时，触发后台预热（下次播放时可用）
    if (!blobCache.has(src)) {
        warmupAudio(src);
    }
}

function processTwitterMessage(e, fingerprint) {
    // 平滑清理：当容量超过 1000 时，只清理最老的 100 条，而不是全部清空
    if (lastPlayTime.size > 1000) {
        let i = 0;
        for (const key of lastPlayTime.keys()) {
            lastPlayTime.delete(key);
            if (++i > 100) break;
        }
    }
    if (!e.detail || !Array.isArray(e.detail.triggers)) return;

    const now = Date.now();
    let vipAudioSrc = null;
    let vipFallbackDefault = false;
    let nobodyWantsDefault = false;
    let isVipPresent = false;

    // 🎤 用于存储需要 TTS 播报的信息
    let ttsInfo = null;

    e.detail.triggers.forEach(trigger => {
        if (!trigger || typeof trigger.id !== 'string') return;

        const twitterId = trigger.id.trim().toLowerCase();
        const displayName = trigger.name || twitterId; // 🎤 获取显示名称，用于 TTS 播报
        const rawActionType = trigger.tw;

        const knownTypes = ['tweet', 'repost', 'reply', 'quote'];
        const actionType = knownTypes.includes(rawActionType) ? rawActionType : 'other';

        if (configCache.eventFilters && configCache.eventFilters[actionType] === false) return;

        const rule = configCache.mappings[twitterId];
        const mappedAudioId = (typeof rule === 'object' && rule !== null) ? rule.id : rule;

        if (mappedAudioId) {
            isVipPresent = true;
            // 🌟 修正：严格使用 Map API 读取和写入，确保 size 计算准确
            if (lastPlayTime.has(twitterId) && (now - lastPlayTime.get(twitterId) < 2500)) return;
            lastPlayTime.set(twitterId, now);

            console.log("✅ [行情语音助手] 规则匹配:", {
                twitterId,
                audioId: mappedAudioId,
                hasRemark: !!(typeof rule === 'object' && rule.remark)
            });

            if (configCache.customAudios[mappedAudioId]) {
                // 🎤 自定义音频：直接播放，不加 TTS
                const customObj = configCache.customAudios[mappedAudioId];
                vipAudioSrc = typeof customObj === 'string' ? customObj : customObj.data;
                ttsInfo = null; // 自定义音频不需要 TTS
            } else if (mappedAudioId.startsWith('custom_')) {
                vipFallbackDefault = true;
                console.log("⚠️ [行情语音助手] 自定义音频丢失，降级为默认音频");
            } else {
                // 🎤 内置音频：区分通用提示音和人物专属音
                vipAudioSrc = chrome.runtime.getURL(`sounds/${mappedAudioId}`);

                // 只有通用提示音才需要 TTS，人物专属音频不需要
                const genericSounds = ['default.MP3', 'preset1.MP3'];
                if (configCache.enableTTS && genericSounds.includes(mappedAudioId)) {
                    // 提取播报名称：优先使用 remark，其次用显示名称，最后降级到 ID
                    let speakerName = displayName;
                    if (typeof rule === 'object' && rule !== null && rule.remark) {
                        speakerName = rule.remark;
                    }

                    ttsInfo = `${speakerName} 发推啦`;
                    // 🚀 如果开启了 TTS，则完全抛弃原有的兜底铃声，只保留 TTS
                    vipAudioSrc = null; 
                }
            }
        } else {
            // 🌟 修正：严格使用 Map API 读取和写入
            if (lastPlayTime.has(twitterId) && (now - lastPlayTime.get(twitterId) < 2500)) return;
            lastPlayTime.set(twitterId, now);
            nobodyWantsDefault = true;
        }
    });



    try {
        if (vipAudioSrc) {
            globalLastPlayTime = now;
            markEventPlayed(fingerprint);
            playConcurrentAudio(vipAudioSrc, 'twitter', ttsInfo); // 🎤 传入 TTS 文本
        } else if (ttsInfo) {
            // 🚀 新增分支：只有纯 TTS，没有任何前置铃声
            globalLastPlayTime = now;
            markEventPlayed(fingerprint);
            playNetworkTTS(ttsInfo, 'twitter');
        } else if (vipFallbackDefault) {
            // 降级情况：文件丢失被迫使用默认音 (不受新开关影响，照常播放)
            globalLastPlayTime = now;
            markEventPlayed(fingerprint);
            console.log("🎵 [行情语音助手] 降级播放默认音频");
            playConcurrentAudio(chrome.runtime.getURL(configCache.defaultAudio || 'sounds/default.MP3'), 'twitter');
        } else if (nobodyWantsDefault && !isVipPresent) {
            // 🌟 新增判断：只有当允许播放未映射音频，且距离上次播放大于2秒时，才播放
            if (configCache.playDefaultUnmapped && (now - globalLastPlayTime > 2000)) {
                globalLastPlayTime = now;
                markEventPlayed(fingerprint);

                // 🎤 检查是否开启了 TTS，提取触发者名称
                let unmappedTTS = null;
                if (configCache.enableTTS) {
                    const firstTrigger = e.detail.triggers.find(t => t && typeof t.id === 'string');
                    if (firstTrigger) {
                        const speakerName = firstTrigger.name || firstTrigger.id.trim();
                        unmappedTTS = `${speakerName} 发推啦`;
                    }
                }

                // 🚀 核心逻辑修改：如果启用了 TTS 并成功生成了播报文本，则【只播放 TTS 人声】，彻底抛弃 default.MP3
                if (unmappedTTS) {
                    playNetworkTTS(unmappedTTS, 'twitter');
                } else {
                    // 如果关闭了 TTS 开关，则降级为只播放默认的“推特新消息” MP3
                    playConcurrentAudio(chrome.runtime.getURL(configCache.defaultAudio || 'sounds/default.MP3'), 'twitter');
                }
            }
        }
    } catch (error) {
        // 🔥 优化：精准的异常处理，不掩盖真实错误
        if (error instanceof Error) {
            if (isExtensionContextError(error)) {
                cleanupStaleExtensionContext();
                return;
            }
            // 其他错误，详细记录
            console.error("[行情语音助手] 播放异常:", {
                message: error.message,
                stack: error.stack,
                name: error.name
            });
        } else {
            console.error("[行情语音助手] 未知播放异常:", error);
        }
    }
}

async function handleTwitterMsg(e) {
    // 📡 信号到达日志：无论是否播放，均打印原始信号，方便排障
    const triggers = (e.detail && Array.isArray(e.detail.triggers)) ? e.detail.triggers : [];
    const triggerIds = triggers.map(t => t && t.id ? t.id.trim().toLowerCase() : '').filter(Boolean);
    const triggerLabel = triggers.map(t => t && t.id ? `${t.id}(${t.tw || '?'})` : '?').join(', ');

    const triggerParts = triggers
        .map(t => t && t.id ? `${t.id.trim().toLowerCase()}:${t.tw || '?'}:${t.eventId || ''}` : '')
        .filter(Boolean)
        .sort();
    const eventFingerprint = `tw_${triggerParts.join('|') || triggerIds.sort().join(',')}`;

    console.log(`📡 [行情语音助手 - 推特信号] 收到 ${triggers.length} 条 | ${triggerLabel}`, {
        fingerprint: eventFingerprint,
        masterOn: configCache.isMasterEnabled,
        twitterOn: configCache.enableTwitter,
        cacheReady: isCacheReady,
        crossTabKey: eventFingerprint,
        willPlay: configCache.isMasterEnabled && configCache.enableTwitter && isCacheReady
    });

    // 1. 前置拦截：精准判断扩展上下文是否已丢失
    if (!isExtensionContextReady()) {
        cleanupStaleExtensionContext();
        return;
    }

    if (!configCache.isMasterEnabled || !configCache.enableTwitter) return;
    if (!isCacheReady) {
        pendingWsMessages.push(e);
        return;
    }

    const claimed = await claimCrossTabEvent(eventFingerprint, TWITTER_EVENT_TTL_MS);
    if (!claimed) return;

    try {
        processTwitterMessage(e, eventFingerprint);
    } catch (error) {
        // 2. 精准异常捕获：只拦截上下文失效引发的错误，不掩盖其他真实 Bug
        if (isExtensionContextError(error)) {
            cleanupStaleExtensionContext();
        } else {
            console.error("[行情语音助手] 播放异常捕获:", error);
        }
    }
}

window.addEventListener('TWITTER_WS_MSG_RECEIVED', handleTwitterMsg);

const walletLastPlayed = new Map();

// ════════════════════════════════════════════════════════════
// 🔇 钱包监控三层冷却引擎（BSC 出块 0.45s，拆单机器人每区块可发一笔）
// Layer 1: 同钱包冷却 — 同一钱包对同一代币的同方向操作，5秒内只播第一笔
// Layer 2: 同代币全局冷却 — 跨钱包防叠音，首笔完整TTS，后续播短促"滴"声
// Layer 3: 🧊 用户自定义同币冷却器 — 跨所有钱包，按代币合约(CA)冷却，时间可调(5-60s)
// ════════════════════════════════════════════════════════════
const walletActionCooldown = new Map();  // key: `${maker}_${action}_${ba}` → timestamp
const WALLET_COOLDOWN_MS = 5000;         // 5秒 ≈ 11个BSC区块

const tokenGlobalCooldown = new Map();   // key: `${ba}_${action}` → timestamp
const TOKEN_COOLDOWN_MS = 3000;          // 3秒 ≈ 7个BSC区块

// 🧊 Layer 3: 用户自定义同币冷却器
const userTokenCooldown = new Map();     // key: `${ba}_buy` 或 `${ba}_sell` → timestamp

// 🏠 Layer 4: 用户自定义同址冷却器
const userAddrCooldown = new Map();      // key: `${maker}_buy` 或 `${maker}_sell` 或 `${maker}_clear` → timestamp

/** 🔔 播放极短提示音（880Hz / 80ms），用于并发买入时感知热度 */
function playShortBeep(source = 'wallet') {
    if (!_autoplayUnlocked) {
        showAudioUnlockHint();
        return;
    } // 🛡️ 用户未交互，AudioContext 不可用
    try {
        const ctx = sharedAudioCtx || new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const vol = source === 'wallet' ? (configCache.walletVolume || 1.0) : (configCache.twitterVolume || 1.0);
        osc.type = 'sine';
        osc.frequency.value = 880;     // A5 高频短促
        gain.gain.value = 0.3 * Math.min(vol, 1.5);  // 音量跟随用户设置
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);  // 仅 80ms
    } catch (e) {
        console.warn('🔔 [行情语音助手] beep 播放失败:', e);
    }
}
async function handleWalletMsg(e) {
    // 1. 前置拦截：精准判断扩展上下文是否已丢失
    if (!isExtensionContextReady()) {
        cleanupStaleExtensionContext();
        return;
    }

    try {
        if (!configCache.isMasterEnabled || !configCache.enableWallet) return;
        const item = e.detail;
    if (!item || !item.m || !item.bs) return; // 'm' is maker, 'bs' is token symbol
    
    const maker = item.m.toLowerCase();
    const tokenSymbol = item.bs || '代币';
    const amountUSD = parseFloat(item.cu) || parseFloat(item.au) || 0;
    const action = item.s;
    const cnt = item.cnt; // 'processed' 或 'confirm'

    if (action !== 'buy' && action !== 'sell') return; // 只关心买卖动作

    if (configCache.walletFilters && amountUSD < configCache.walletFilters.minAmount) return;
    if (configCache.walletFilters && configCache.walletFilters.maxAmount > 0 && amountUSD > configCache.walletFilters.maxAmount) return;
    if (action === 'buy' && configCache.walletFilters && configCache.walletFilters.buy === false) return;
    // 卖出的减仓/清仓过滤延迟到 confirm 阶段（processed 时还没有 ooc 信息）
    // 但如果减仓和清仓都关闭了，直接跳过
    if (action === 'sell' && configCache.walletFilters && configCache.walletFilters.sellReduce === false && configCache.walletFilters.sellClear === false) return;

    // 🌟 市值范围过滤：市值 = 单价(pu) × 总供应量(bts)，单位 K(千美元)
    if (configCache.walletFilters) {
        const marketCapK = (parseFloat(item.pu) || 0) * (parseFloat(item.bts) || 0) / 1000;
        if (configCache.walletFilters.minMcap > 0 && marketCapK < configCache.walletFilters.minMcap) return;
        if (configCache.walletFilters.maxMcap > 0 && marketCapK > configCache.walletFilters.maxMcap) return;
    }

    // 🌟 代币时间范围过滤：代币年龄 = (交易时间ts - 创建时间bct) / 60，单位分钟
    if (configCache.walletFilters && item.bct) {
        const tokenAgeMin = (item.ts - item.bct) / 60;
        if (configCache.walletFilters.minAge > 0 && tokenAgeMin < configCache.walletFilters.minAge) return;
        if (configCache.walletFilters.maxAge > 0 && tokenAgeMin > configCache.walletFilters.maxAge) return;
    }

    if (!configCache.walletDictionary) return;
    const walletInfo = configCache.walletDictionary[maker];
    if (!walletInfo || !walletInfo.rename || walletInfo.rename.trim() === "") return;
    
    let rename = walletInfo.rename.trim();
    const txHash = item.h;

    // ----- 🛡️ 新增：统一的 txHash 状态预检 -----
    // 如果这个 txHash 已经被完全处理过（TTS），或者被冷却引擎抛弃过，直接忽略
    let txState = txHash ? walletLastPlayed.get(txHash) : undefined;
    if (txState === true) return; 

    const ba = (item.ba || item.a || '').toLowerCase(); // 代币合约地址
    // txHash 事件用统一跨阶段 key，让同一个标签页拥有 processed+confirm 的完整播报权。
    const walletFingerprint = txHash
        ? `wl_tx_${txHash}`
        : `wl_${maker}_${action}_${ba || tokenSymbol}`;
    const ownsWalletEvent = await claimCrossTabEvent(
        walletFingerprint,
        txHash ? WALLET_TX_EVENT_TTL_MS : WALLET_FALLBACK_EVENT_TTL_MS,
        { allowOwner: !!txHash }
    );
    if (!ownsWalletEvent) return;

    const now = Date.now();
    
    // 只有当这个 txHash 已经被放行了第一阶段（pending_sell / skip_processed），它的第二阶段才豁免冷却！
    const isStage2OfAllowedSell = (action === 'sell' && cnt === 'confirm' && (txState === 'pending_sell' || txState === 'skip_processed'));
    // 只有当 txState 为 pending_sell 时，才真正跳过用户冷却（Layer 3 和 4），因为 skip_processed 明确表示需要将用户冷却检查延后到 confirm 阶段
    const bypassUserCooldowns = isStage2OfAllowedSell && txState !== 'skip_processed';

    // 预准备调试日志文本，便于观察哪些播报被冷却拦截
    const isLogClearAll = item.ooc === 1;
    const logActionText = action === 'buy' ? '买入' : (isLogClearAll ? '清仓' : '减仓');
    const fullLogText = `${rename}${logActionText}${tokenSymbol}`;

    // ════════════════════════════════════════════════════════════
    // 🔇 Layer 1: 同钱包冷却 — 拦截拆单/机器人连击
    // 同一个钱包对同一个代币的同方向操作，5秒内只播第一笔
    // ════════════════════════════════════════════════════════════
    if (!isStage2OfAllowedSell) {
        const walletCoolKey = `${maker}_${action}_${ba}`;
        const lastWalletTime = walletActionCooldown.get(walletCoolKey);
        if (lastWalletTime && (now - lastWalletTime) < WALLET_COOLDOWN_MS) {
            console.log(`🔇 [行情语音助手 - TTS (wallet)] 钱包冷却拦截: ${fullLogText} (剩余 ${((WALLET_COOLDOWN_MS - (now - lastWalletTime)) / 1000).toFixed(1)}s)`);
            if (txHash) walletLastPlayed.set(txHash, true); // 💀 标记该交易已死亡，防止它的 confirm 阶段绕过冷却
            return;
        }
        walletActionCooldown.set(walletCoolKey, now);
    }

    // ════════════════════════════════════════════════════════════
    // 🔔 Layer 2: 同代币全局冷却 — 多钱包并发防叠音
    // 首笔完整 TTS 播报，后续在冷却窗口内只播短促"滴"声（感知热度）
    // ════════════════════════════════════════════════════════════
    if (!isStage2OfAllowedSell) {
        const tokenCoolKey = `${ba}_${action}`;
        const lastTokenTime = tokenGlobalCooldown.get(tokenCoolKey);
        if (lastTokenTime && (now - lastTokenTime) < TOKEN_COOLDOWN_MS) {
            console.log(`🔔 [行情语音助手 - TTS (wallet)] 代币热度降级(仅滴声): ${fullLogText} (剩余 ${((TOKEN_COOLDOWN_MS - (now - lastTokenTime)) / 1000).toFixed(1)}s)`);
            markEventPlayed(walletFingerprint);
            if (txHash) walletLastPlayed.set(txHash, true); // 💀 标记该交易已处理为 Beep，防止它的 confirm 阶段再次 Beep
            playShortBeep('wallet');
            return;
        }
        tokenGlobalCooldown.set(tokenCoolKey, now);
    }

    // ════════════════════════════════════════════════════════════
    // 🧊 Layer 3: 用户自定义同币冷却器（跨所有钱包，按 CA 冷却）
    // 买入冷却器：同一代币合约在 N 秒内只播报第一笔买入
    // 减仓冷却器：同一代币合约在 N 秒内只播报第一笔减仓
    //   ⚠️ 关键：清仓(ooc===1)是逃顶信号，绝不被减仓冷却器压制
    //   ⚠️ processed 阶段无法区分减仓/清仓，仅在 confirm 阶段触发冷却判定
    // ════════════════════════════════════════════════════════════
    if (!bypassUserCooldowns && ba && configCache.walletFilters) {
        const wf = configCache.walletFilters;
        if (action === 'buy' && wf.buyCooldownEnabled && wf.buyCooldownTime > 0) {
            const userCoolKey = `${ba}_buy`;
            const lastUserTime = userTokenCooldown.get(userCoolKey);
            const cooldownMs = wf.buyCooldownTime * 1000;
            if (lastUserTime && (now - lastUserTime) < cooldownMs) {
                console.log(`🧊 [行情语音助手 - TTS (wallet)] 同币买入冷却拦截: ${fullLogText} (剩余 ${((cooldownMs - (now - lastUserTime)) / 1000).toFixed(1)}s)`);
                if (txHash) walletLastPlayed.set(txHash, true);
                return;
            }
            userTokenCooldown.set(userCoolKey, now);
        }
        // 减仓冷却器：仅 confirm 阶段且非清仓时触发（processed 阶段放行，因为无法区分减仓/清仓）
        const isClearAll = item.ooc === 1;
        if (action === 'sell' && cnt === 'confirm' && !isClearAll && wf.sellReduceCooldownEnabled && wf.sellReduceCooldownTime > 0) {
            const userCoolKey = `${ba}_sell`;
            const lastUserTime = userTokenCooldown.get(userCoolKey);
            const cooldownMs = wf.sellReduceCooldownTime * 1000;
            if (lastUserTime && (now - lastUserTime) < cooldownMs) {
                console.log(`🧊 [行情语音助手 - TTS (wallet)] 同币减仓冷却拦截: ${fullLogText} (剩余 ${((cooldownMs - (now - lastUserTime)) / 1000).toFixed(1)}s)`);
                if (txHash) walletLastPlayed.set(txHash, true);
                return;
            }
            userTokenCooldown.set(userCoolKey, now);
        }
    }

    // ════════════════════════════════════════════════════════════
    // 🏠 Layer 4: 用户自定义同址冷却器（按钱包地址冷却）
    // 同一个钱包地址在 N 秒内的同方向操作只播第一笔（不管买/卖什么币）
    //   ⚠️ 清仓有独立的同址冷却开关
    // ════════════════════════════════════════════════════════════
    if (!bypassUserCooldowns && maker && configCache.walletFilters) {
        const wf = configCache.walletFilters;
        const isClearAll = item.ooc === 1;

        if (action === 'buy' && wf.buyAddrCooldownEnabled && wf.buyAddrCooldownTime > 0) {
            const addrKey = `${maker}_buy`;
            const lastTime = userAddrCooldown.get(addrKey);
            const coolMs = wf.buyAddrCooldownTime * 1000;
            if (lastTime && (now - lastTime) < coolMs) {
                console.log(`🏠 [行情语音助手 - TTS (wallet)] 同址买入冷却拦截: ${fullLogText} (剩余 ${((coolMs - (now - lastTime)) / 1000).toFixed(1)}s)`);
                if (txHash) walletLastPlayed.set(txHash, true);
                return;
            }
            userAddrCooldown.set(addrKey, now);
        }
        // 减仓同址冷却：仅 confirm 阶段且非清仓
        if (action === 'sell' && cnt === 'confirm' && !isClearAll && wf.sellReduceAddrCooldownEnabled && wf.sellReduceAddrCooldownTime > 0) {
            const addrKey = `${maker}_sell`;
            const lastTime = userAddrCooldown.get(addrKey);
            const coolMs = wf.sellReduceAddrCooldownTime * 1000;
            if (lastTime && (now - lastTime) < coolMs) {
                console.log(`🏠 [行情语音助手 - TTS (wallet)] 同址减仓冷却拦截: ${fullLogText} (剩余 ${((coolMs - (now - lastTime)) / 1000).toFixed(1)}s)`);
                if (txHash) walletLastPlayed.set(txHash, true);
                return;
            }
            userAddrCooldown.set(addrKey, now);
        }
        // 清仓同址冷却：仅 confirm 阶段且为清仓
        if (action === 'sell' && cnt === 'confirm' && isClearAll && wf.sellClearAddrCooldownEnabled && wf.sellClearAddrCooldownTime > 0) {
            const addrKey = `${maker}_clear`;
            const lastTime = userAddrCooldown.get(addrKey);
            const coolMs = wf.sellClearAddrCooldownTime * 1000;
            if (lastTime && (now - lastTime) < coolMs) {
                console.log(`🏠 [行情语音助手 - TTS (wallet)] 同址清仓冷却拦截: ${fullLogText} (剩余 ${((coolMs - (now - lastTime)) / 1000).toFixed(1)}s)`);
                if (txHash) walletLastPlayed.set(txHash, true);
                return;
            }
            userAddrCooldown.set(addrKey, now);
        }
    }
    if (action === 'buy') {
        // ✅ 买入：processed 阶段直接播报完整内容，confirm 通过 txHash 去重跳过
        if (txHash) {
            walletLastPlayed.set(txHash, true);
        } else {
            const dbKey = `${maker}_buy_${tokenSymbol}`;
            if (walletLastPlayed.has(dbKey) && now - walletLastPlayed.get(dbKey) < 2500) return;
            walletLastPlayed.set(dbKey, now);
        }
        markEventPlayed(walletFingerprint);
        playNetworkTTS([`${rename}买入`, tokenSymbol], 'wallet');
    } else {
        // 🌟 卖出：两阶段流式播报架构
        // 第一阶段 (processed)：立刻播报备注名，不等待 ooc 判定，抢占先机
        // 第二阶段 (confirm)：获取 ooc 后判断减仓/清仓，根据用户开关决定是否补播
        if (txHash) {

            if (cnt === 'processed') {
                if (txState) return; // 已处理过 processed 阶段

                // 🧊 如果有任何卖出冷却器启用，跳过 processed 阶段的提前播报
                // 因为 confirm 阶段可能被冷却吞掉，导致用户只听到孤立的备注名没有下文
                // 此时改为让 confirm 阶段走降级兜底路径，一次性播完整内容
                const wf = configCache.walletFilters || {};
                const hasSellCooldown = wf.sellReduceCooldownEnabled || wf.sellReduceAddrCooldownEnabled
                    || wf.sellClearAddrCooldownEnabled;
                if (hasSellCooldown) {
                    walletLastPlayed.set(txHash, 'skip_processed'); // 标记跳过，让 confirm 走完整播报
                    return;
                }

                walletLastPlayed.set(txHash, 'pending_sell');
                markEventPlayed(walletFingerprint);
                playNetworkTTS([rename], 'wallet'); // 🎤 第一阶段：先播备注名
            } else if (cnt === 'confirm') {
                const isClearAll = item.ooc === 1;
                const actionText = isClearAll ? '清仓' : '减仓';

                // 🌟 根据用户开关过滤：清仓关闭则不播清仓，减仓关闭则不播减仓
                if (configCache.walletFilters) {
                    if (isClearAll && configCache.walletFilters.sellClear === false) {
                        walletLastPlayed.set(txHash, true); // 标记已完成，避免重复
                        return;
                    }
                    if (!isClearAll && configCache.walletFilters.sellReduce === false) {
                        walletLastPlayed.set(txHash, true);
                        return;
                    }
                }

                if (txState === 'pending_sell') {
                    // 🎤 第二阶段：补播 "减仓/清仓+代币名" 合并为一条 TTS 请求
                    walletLastPlayed.set(txHash, true);
                    markEventPlayed(walletFingerprint);
                    playNetworkTTS([`${actionText}${tokenSymbol}`], 'wallet');
                } else {
                    // 降级兜底：没收到 processed / 冷却器跳过了 processed → 直接播完整内容
                    walletLastPlayed.set(txHash, true);
                    markEventPlayed(walletFingerprint);
                    playNetworkTTS([`${rename}${actionText}${tokenSymbol}`], 'wallet');
                }
            }
        } else {
            // 无 txHash 的降级去重逻辑
            const dbKey = `${maker}_sell_${tokenSymbol}`;
            if (walletLastPlayed.has(dbKey) && now - walletLastPlayed.get(dbKey) < 2500) return;
            walletLastPlayed.set(dbKey, now);
            const isClearAll = item.ooc === 1;
            const actionText = isClearAll ? '清仓' : '减仓';
            // 无 txHash 时直接根据开关过滤
            if (configCache.walletFilters) {
                if (isClearAll && configCache.walletFilters.sellClear === false) return;
                if (!isClearAll && configCache.walletFilters.sellReduce === false) return;
            }
            markEventPlayed(walletFingerprint);
            playNetworkTTS([`${rename}${actionText}`, tokenSymbol], 'wallet');
        }
    }

    // 定期清理防爆内存（Map 保证插入顺序，FIFO 淘汰最老的一半）
    if (walletLastPlayed.size > 2000) {
        const iter = walletLastPlayed.keys();
        for (let i = 0; i < 1000; i++) walletLastPlayed.delete(iter.next().value);
    }
    // 冷却 Map 也需要清理，避免长期运行内存膨胀
    if (walletActionCooldown.size > 500) {
        const iter = walletActionCooldown.keys();
        for (let i = 0; i < 250; i++) walletActionCooldown.delete(iter.next().value);
    }
    if (tokenGlobalCooldown.size > 500) {
        const iter = tokenGlobalCooldown.keys();
        for (let i = 0; i < 250; i++) tokenGlobalCooldown.delete(iter.next().value);
    }
    // 🧊 用户自定义冷却器 Map 清理
    if (userTokenCooldown.size > 500) {
        const iter = userTokenCooldown.keys();
        for (let i = 0; i < 250; i++) userTokenCooldown.delete(iter.next().value);
    }
    // 🏠 同址冷却器 Map 清理
    if (userAddrCooldown.size > 500) {
        const iter = userAddrCooldown.keys();
        for (let i = 0; i < 250; i++) userAddrCooldown.delete(iter.next().value);
    }
    } catch (error) {
        if (isExtensionContextError(error)) {
            cleanupStaleExtensionContext();
        } else {
            console.error("[行情语音助手] 钱包播放异常捕获:", error);
        }
    }
}

window.addEventListener('GMGN_WALLET_MSG', handleWalletMsg);
