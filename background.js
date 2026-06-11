chrome.runtime.onInstalled.addListener(() => {
    // 检查本地数据库中是否已经存在映射规则
    chrome.storage.local.get(['twitterAudioMappings'], (result) => {
        // 只有当完全没有数据时（即全新安装），才注入默认规则
        // 这样不会覆盖老用户自己修改过的数据
        if (!result.twitterAudioMappings) {
            const defaultMappings = {};

            chrome.storage.local.set({ twitterAudioMappings: defaultMappings }, () => {
                console.log("[行情语音助手] 已初始化空映射，使用者可自行添加规则。");
            });
        }
    });
});

function escapeXml(value) {
    return String(value).replace(/[<>&'"]/g, (ch) => ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        "'": '&apos;',
        '"': '&quot;'
    }[ch]));
}

function arrayBufferToDataUrl(buffer, mimeType) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return `data:${mimeType};base64,${btoa(binary)}`;
}

async function synthesizeAzureSpeech(payload) {
    const region = String(payload.region || '').trim();
    const key = String(payload.key || '').trim();
    const voice = String(payload.voice || 'zh-CN-XiaoxiaoNeural').trim();
    const text = String(payload.text || '').trim();
    const rate = String(payload.rate || '+0%').trim();
    const pitch = String(payload.pitch || '+0%').trim();

    if (!/^[a-z0-9-]+$/i.test(region)) throw new Error('Azure region 格式不正确');
    if (!key) throw new Error('缺少 Azure Speech Key');
    if (!text) throw new Error('缺少 TTS 文本');

    const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const ssml = `
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">
  <voice name="${escapeXml(voice)}">
    <prosody rate="${escapeXml(rate)}" pitch="${escapeXml(pitch)}">${escapeXml(text)}</prosody>
  </voice>
</speak>`.trim();

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Ocp-Apim-Subscription-Key': key,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
            'User-Agent': 'Market-Voice-Watcher'
        },
        body: ssml
    });

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Azure TTS 返回 ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ''}`);
    }

    const buffer = await response.arrayBuffer();
    return arrayBufferToDataUrl(buffer, 'audio/mpeg');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'AZURE_TTS') return false;

    synthesizeAzureSpeech(message.payload || {})
        .then((audioDataUrl) => sendResponse({ ok: true, audioDataUrl }))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

    return true;
});
