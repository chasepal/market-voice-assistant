import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const helperSource = fs.readFileSync(new URL('../twitter-name-utils.js', import.meta.url), 'utf8');
const injectSource = fs.readFileSync(new URL('../inject.js', import.meta.url), 'utf8');
const contentSource = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');
const popupHtml = fs.readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
const popupSource = fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

function loadNameUtils() {
    const context = vm.createContext({});
    vm.runInContext(helperSource, context);
    return context.__MARKET_VOICE_TWITTER_NAME_UTILS__;
}

function createStorage(initialValues = {}) {
    const values = new Map(Object.entries(initialValues));
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        }
    };
}

function createInjectHarness(storageValues = {}) {
    const windowListeners = new Map();

    class FakeWebSocket {
        constructor() {
            this.listeners = new Map();
        }

        addEventListener(type, listener) {
            if (!this.listeners.has(type)) this.listeners.set(type, []);
            this.listeners.get(type).push(listener);
        }

        emitMessage(data) {
            for (const listener of this.listeners.get('message') || []) listener({ data });
        }
    }

    class FakeCustomEvent {
        constructor(type, init = {}) {
            this.type = type;
            this.detail = init.detail;
        }
    }

    const window = {
        WebSocket: FakeWebSocket,
        localStorage: createStorage(storageValues),
        addEventListener(type, listener) {
            if (!windowListeners.has(type)) windowListeners.set(type, []);
            windowListeners.get(type).push(listener);
        },
        removeEventListener() {},
        dispatchEvent(event) {
            for (const listener of windowListeners.get(event.type) || []) listener(event);
            return true;
        }
    };
    const context = vm.createContext({
        window,
        CustomEvent: FakeCustomEvent,
        console: { log() {}, warn() {} }
    });
    vm.runInContext(helperSource, context);
    vm.runInContext(injectSource, context);

    return { window };
}

test('extracts explicit GMGN social remarks and ignores empty values', () => {
    const utils = loadNameUtils();

    assert.equal(utils.extractGmgnRemark({ u: { remark: '  量化 小王  ' } }), '量化 小王');
    assert.equal(utils.extractGmgnRemark({ u: { remark: '   ' }, user_remark: '备用备注' }), '备用备注');
    assert.equal(utils.extractGmgnRemark({ u: { s: 'alice', n: 'Alice' } }), '');
});

test('reads GMGN social remarks from its site-owned cache by Twitter handle', () => {
    const utils = loadNameUtils();
    const storage = createStorage({
        'x-user-remark-cache': JSON.stringify({
            '123@0': { handle: 'Alice', platform: 0, remark: '  链上观察员  ', user_id: '123' },
            '456@0': { handle: 'empty_note', platform: 0, remark: '   ', user_id: '456' },
            '789@1': { handle: 'other_platform', platform: 1, remark: '不应使用', user_id: '789' }
        })
    });

    assert.equal(utils.findGmgnRemarkInStorage('@alice', storage), '链上观察员');
    assert.equal(utils.findGmgnRemarkInStorage('empty_note', storage), '');
    assert.equal(utils.findGmgnRemarkInStorage('other_platform', storage), '');
    assert.equal(utils.findGmgnRemarkInStorage('unknown', storage), '');

    storage.setItem('x-user-remark-cache', JSON.stringify({
        '123@0': { handle: 'alice', platform: 0, remark: '更新后的备注', user_id: '123' }
    }));
    assert.equal(utils.findGmgnRemarkInStorage('ALICE', storage), '更新后的备注');
});

test('speaker-name precedence preserves existing behavior while the switch is off', () => {
    const utils = loadNameUtils();
    const base = {
        gmgnRemark: 'GMGN 备注',
        displayName: 'Alice',
        twitterId: 'alice'
    };

    assert.equal(utils.chooseSpeakerName({ ...base, useGmgnRemark: false }), 'Alice');
    assert.equal(utils.chooseSpeakerName({ ...base, useGmgnRemark: true }), 'GMGN 备注');
    assert.equal(utils.chooseSpeakerName({ ...base, localRemark: '扩展备注', useGmgnRemark: true }), '扩展备注');
    assert.equal(utils.chooseSpeakerName({ gmgnRemark: '', displayName: '', twitterId: 'alice', useGmgnRemark: true }), 'alice');
});

test('inject bridge forwards a sanitized GMGN remark only after the switch is enabled', () => {
    const { window } = createInjectHarness({
        'x-user-remark-cache': JSON.stringify({
            '123@0': { handle: 'alice', platform: 0, remark: '  GMGN 备注  ', user_id: '123' }
        })
    });
    let received;
    window.addEventListener('TWITTER_WS_MSG_RECEIVED', (event) => {
        received = event.detail;
    });

    const socket = new window.WebSocket('wss://example.invalid');
    socket.emitMessage(JSON.stringify({
        channel: 'twitter_user_monitor_basic',
        data: [{ id: 'tweet-1', tw: 'tweet', u: { s: 'alice', n: 'Alice' } }]
    }));

    assert.equal(received.triggers.length, 1);
    assert.equal(received.triggers[0].id, 'alice');
    assert.equal(received.triggers[0].name, 'Alice');
    assert.equal(received.triggers[0].gmgnRemark, '');

    window.dispatchEvent({
        type: 'GMGN_AUDIO_TOGGLE',
        detail: { enabled: true, useGmgnTwitterRemark: true }
    });
    socket.emitMessage(JSON.stringify({
        channel: 'twitter_user_monitor_basic',
        data: [{ id: 'tweet-2', tw: 'tweet', u: { s: 'alice', n: 'Alice' } }]
    }));
    assert.equal(received.triggers[0].gmgnRemark, 'GMGN 备注');
});

test('public package wires the default-off switch without activating refactor scripts', () => {
    assert.deepEqual(manifest.content_scripts[0].js, ['twitter-name-utils.js', 'inject.js']);
    assert.deepEqual(manifest.content_scripts[1].js, ['twitter-name-utils.js', 'content.js']);
    assert.equal(JSON.stringify(manifest).includes('runtime-core.js'), false);

    assert.match(popupHtml, /id="useGmgnTwitterRemarkToggle"/);
    assert.match(popupSource, /useGmgnTwitterRemark:\s*e\.target\.checked/);
    assert.match(contentSource, /useGmgnTwitterRemark\s*=\s*result\.useGmgnTwitterRemark\s*===\s*true/);
    assert.doesNotMatch(helperSource, /\.setItem\s*\(/);
});
