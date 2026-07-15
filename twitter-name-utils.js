(function (root) {
    'use strict';

    const USER_REMARK_KEYS = [
        'remark', 'remarkName', 'remark_name', 'rename', 'alias',
        'aliasName', 'alias_name', 'note', 'customName', 'custom_name'
    ];
    const EVENT_REMARK_KEYS = [
        'userRemark', 'user_remark', 'twitterRemark', 'twitter_remark',
        'monitorRemark', 'monitor_remark', 'followRemark', 'follow_remark'
    ];
    // GMGN owns these page-storage entries. This extension only reads them.
    const GMGN_REMARK_STORAGE_KEYS = ['x-user-remark-cache', 'x-user-remark'];
    const MAX_REMARK_CACHE_LENGTH = 2_000_000;
    const MAX_REMARK_CACHE_ENTRIES = 10_000;
    let lastRemarkCacheSnapshots = null;
    let cachedRemarksByHandle = new Map();

    function normalizeLabel(value) {
        if (typeof value !== 'string') return '';
        return value.replace(/\s+/g, ' ').trim().slice(0, 160);
    }

    function firstLabel(source, keys) {
        if (!source || typeof source !== 'object') return '';
        for (const key of keys) {
            const value = normalizeLabel(source[key]);
            if (value) return value;
        }
        return '';
    }

    function normalizeHandle(value) {
        return normalizeLabel(value).replace(/^@+/, '').toLowerCase();
    }

    function addRemarkEntries(raw, target) {
        if (!raw || raw.length > MAX_REMARK_CACHE_LENGTH) return;

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            return;
        }

        const entries = Array.isArray(parsed) ? parsed : Object.values(parsed || {});
        for (let index = 0; index < entries.length && index < MAX_REMARK_CACHE_ENTRIES; index++) {
            const entry = entries[index];
            if (!entry || typeof entry !== 'object') continue;
            if (entry.platform !== undefined && Number(entry.platform) !== 0) continue;
            const handle = normalizeHandle(entry.handle || entry.screen_name || entry.screenName);
            const remark = normalizeLabel(entry.remark);
            if (handle && remark) target.set(handle, remark);
        }
    }

    function getRemarksByHandle(storage) {
        const snapshots = [];
        try {
            for (const key of GMGN_REMARK_STORAGE_KEYS) {
                snapshots.push(storage && typeof storage.getItem === 'function' ? (storage.getItem(key) || '') : '');
            }
        } catch (error) {
            snapshots.length = 0;
        }

        const unchanged = lastRemarkCacheSnapshots
            && snapshots.length === lastRemarkCacheSnapshots.length
            && snapshots.every((value, index) => value === lastRemarkCacheSnapshots[index]);
        if (unchanged) return cachedRemarksByHandle;

        const nextMap = new Map();
        for (const raw of snapshots) addRemarkEntries(raw, nextMap);
        lastRemarkCacheSnapshots = snapshots;
        cachedRemarksByHandle = nextMap;
        return cachedRemarksByHandle;
    }

    function findGmgnRemarkInStorage(handle, storage) {
        const normalizedHandle = normalizeHandle(handle);
        if (!normalizedHandle) return '';
        let storageArea = storage;
        if (!storageArea) {
            try {
                storageArea = root.localStorage;
            } catch (error) {
                storageArea = null;
            }
        }
        return getRemarksByHandle(storageArea).get(normalizedHandle) || '';
    }

    function extractGmgnRemark(tweetData) {
        if (!tweetData || typeof tweetData !== 'object') return '';

        const userSources = [
            tweetData.u,
            tweetData.user,
            tweetData.twitterUser,
            tweetData.twitter_user
        ];
        for (const source of userSources) {
            const value = firstLabel(source, USER_REMARK_KEYS);
            if (value) return value;
        }

        return firstLabel(tweetData, EVENT_REMARK_KEYS);
    }

    function resolveGmgnRemark(tweetData, storage) {
        return extractGmgnRemark(tweetData)
            || findGmgnRemarkInStorage(tweetData && tweetData.u && tweetData.u.s, storage);
    }

    function chooseSpeakerName(options = {}) {
        return normalizeLabel(options.localRemark)
            || (options.useGmgnRemark ? normalizeLabel(options.gmgnRemark) : '')
            || normalizeLabel(options.displayName)
            || normalizeLabel(options.twitterId);
    }

    root.__MARKET_VOICE_TWITTER_NAME_UTILS__ = Object.freeze({
        normalizeLabel,
        normalizeHandle,
        extractGmgnRemark,
        findGmgnRemarkInStorage,
        resolveGmgnRemark,
        chooseSpeakerName
    });
})(globalThis);
