(function () {
    'use strict';

    const LOG_PREFIX = '[Market Voice]';
    const READY_EVENT = 'MARKET_VOICE_BRIDGE_READY';
    const PING_EVENT = 'MARKET_VOICE_BRIDGE_PING';
    const TOGGLE_EVENT = 'GMGN_AUDIO_TOGGLE';
    const MAX_BATCH_ITEMS = 100;
    const twitterNameUtils = globalThis.__MARKET_VOICE_TWITTER_NAME_UTILS__;

    const originalWebSocket = window.__MARKET_VOICE_ORIGINAL_WS
        || window.__GMGN_ORIGINAL_WS
        || window.WebSocket;
    if (typeof originalWebSocket !== 'function') return;

    window.__MARKET_VOICE_ORIGINAL_WS = originalWebSocket;
    window.__GMGN_ORIGINAL_WS = originalWebSocket;
    window.__GMGN_AUDIO_ENABLED = window.__GMGN_AUDIO_ENABLED !== false;
    window.__GMGN_USE_TWITTER_REMARK = window.__GMGN_USE_TWITTER_REMARK === true;

    if (window.__MARKET_VOICE_TOGGLE_HANDLER) {
        window.removeEventListener(TOGGLE_EVENT, window.__MARKET_VOICE_TOGGLE_HANDLER);
    }
    window.__MARKET_VOICE_TOGGLE_HANDLER = (event) => {
        const detail = event && event.detail;
        window.__GMGN_AUDIO_ENABLED = !!(detail && detail.enabled);
        if (detail && detail.useGmgnTwitterRemark !== undefined) {
            window.__GMGN_USE_TWITTER_REMARK = detail.useGmgnTwitterRemark === true;
        }
    };
    window.addEventListener(TOGGLE_EVENT, window.__MARKET_VOICE_TOGGLE_HANDLER);

    if (window.__MARKET_VOICE_PING_HANDLER) {
        window.removeEventListener(PING_EVENT, window.__MARKET_VOICE_PING_HANDLER);
    }
    window.__MARKET_VOICE_PING_HANDLER = () => window.dispatchEvent(new CustomEvent(READY_EVENT));
    window.addEventListener(PING_EVENT, window.__MARKET_VOICE_PING_HANDLER);

    const observedSockets = window.__MARKET_VOICE_OBSERVED_SOCKETS || new WeakSet();
    window.__MARKET_VOICE_OBSERVED_SOCKETS = observedSockets;
    let lastParseWarningAt = 0;

    function parseSocketPayload(raw) {
        let parsed = JSON.parse(raw.replace(/^\d+/, ''));
        if (Array.isArray(parsed) && parsed.length >= 2) parsed = parsed[1];
        if (typeof parsed === 'string') parsed = JSON.parse(parsed);
        return parsed;
    }

    function resolveGmgnRemark(tweetData) {
        if (!twitterNameUtils) return '';
        try {
            if (window.__GMGN_USE_TWITTER_REMARK
                && typeof twitterNameUtils.resolveGmgnRemark === 'function') {
                return twitterNameUtils.resolveGmgnRemark(tweetData, window.localStorage);
            }
            if (typeof twitterNameUtils.extractGmgnRemark === 'function') {
                return twitterNameUtils.extractGmgnRemark(tweetData);
            }
        } catch (error) { }
        return '';
    }

    function dispatchTwitter(data) {
        const triggers = new Map();
        for (const tweetData of data.slice(0, MAX_BATCH_ITEMS)) {
            if (!tweetData || !tweetData.u || typeof tweetData.u.s !== 'string') continue;
            const actionType = typeof tweetData.tw === 'string' ? tweetData.tw : 'unknown';
            const eventId = tweetData.id || tweetData.tid || tweetData.tweet_id || tweetData.twid
                || tweetData.h || tweetData.ts || tweetData.ct
                || (tweetData.t && (tweetData.t.id || tweetData.t.tid || tweetData.t.ts))
                || '';
            const id = tweetData.u.s.slice(0, 160);
            const key = `${id}:${actionType}:${String(eventId).slice(0, 200)}`;
            triggers.set(key, {
                id,
                tw: actionType.slice(0, 40),
                name: String(tweetData.u.n || id).slice(0, 160),
                gmgnRemark: resolveGmgnRemark(tweetData),
                eventId: String(eventId).slice(0, 200)
            });
        }
        if (triggers.size > 0) {
            window.dispatchEvent(new CustomEvent('TWITTER_WS_MSG_RECEIVED', {
                detail: { triggers: Array.from(triggers.values()) }
            }));
        }
    }

    function dispatchWallet(data) {
        for (const item of data.slice(0, MAX_BATCH_ITEMS)) {
            if (!item || typeof item !== 'object') continue;
            window.dispatchEvent(new CustomEvent('GMGN_WALLET_MSG', { detail: item }));
        }
    }

    function observeSocket(socket) {
        if (!socket || observedSockets.has(socket)) return;
        observedSockets.add(socket);
        socket.addEventListener('message', (event) => {
            if (!window.__GMGN_AUDIO_ENABLED || typeof event.data !== 'string') return;
            const isTwitter = event.data.includes('twitter_user_monitor_basic');
            const isWallet = event.data.includes('following_wallet_activity');
            if (!isTwitter && !isWallet) return;

            try {
                const parsed = parseSocketPayload(event.data);
                if (parsed && parsed.channel === 'twitter_user_monitor_basic' && Array.isArray(parsed.data)) {
                    dispatchTwitter(parsed.data);
                } else if (parsed && parsed.channel === 'following_wallet_activity' && Array.isArray(parsed.data)) {
                    dispatchWallet(parsed.data);
                }
            } catch (error) {
                const now = Date.now();
                if (now - lastParseWarningAt > 30_000) {
                    lastParseWarningAt = now;
                    console.warn(`${LOG_PREFIX} WebSocket 数据解析失败:`, error && error.message || error);
                }
            }
        });
    }

    let websocketProxy;
    websocketProxy = new Proxy(originalWebSocket, {
        construct(target, args, newTarget) {
            const effectiveTarget = newTarget === websocketProxy ? target : newTarget;
            const socket = Reflect.construct(target, args, effectiveTarget);
            observeSocket(socket);
            return socket;
        }
    });

    window.WebSocket = websocketProxy;
    window.dispatchEvent(new CustomEvent(READY_EVENT));
    console.log(`${LOG_PREFIX} WebSocket 监听已就绪`);
})();
