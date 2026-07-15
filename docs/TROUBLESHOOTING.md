# Troubleshooting

## `Failed to fetch`

如果错误来自 `chrome-extension://.../sounds/...`，通常有两种原因：

1. 扩展刚更新或重新加载，旧 GMGN 标签页里的脚本上下文已经失效。
2. manifest 里声明的资源文件和磁盘文件名不一致。

处理方式：

1. 在 `chrome://extensions/` 重新加载扩展。
2. 刷新所有已经打开的 GMGN 页面。
3. 在仓库目录运行 `npm run check`，确认资源文件存在。

## `QuotaExceededError: reffer24Code`

这是 GMGN 页面在写自己的 localStorage 时触发的站点存储配额错误。新版扩展已经不再把去重状态写入 GMGN 页面的 localStorage，并会在启动时只清理旧版扩展留下的 `gmgn_companion_local_event_v2:` 前缀记录。

如果你担心清掉登录态，不要直接点「清除全部站点数据」。可以先安装或重新加载新版扩展，然后刷新 GMGN 页面；新版扩展会在页面脚本很早期运行，只删除旧版插件自己的遗留 key。

如果页面已经卡在错误页，可以在 DevTools 的 Console 里手动只清旧插件 key：

```js
for (let i = localStorage.length - 1; i >= 0; i--) {
  const key = localStorage.key(i);
  if (key && key.startsWith('gmgn_companion_local_event_v2:')) {
    localStorage.removeItem(key);
  }
}
location.reload();
```

这不会删除 GMGN 的其它 localStorage 项。

## Azure 试听失败

检查这些项：

- Region 是否和 Azure Speech 资源所在区域一致。
- Key 是否来自同一个 Speech 资源。
- 网络是否可以访问 `https://<region>.tts.speech.microsoft.com/`。
- Azure 资源是否已经创建完成并可用。

## 没有声音

Chrome 对网页自动播放有限制。打开 GMGN 页面后，点一下页面，右下角状态会从待点按变成可播放。

还需要确认：

- GMGN 标签页没有被静音。
- 系统输出设备和音量正常。
- 扩展设置里的总开关、推特开关或钱包开关没有关闭。

## 多个 GMGN 标签页重复播报

扩展内置跨标签页去重，但浏览器更新、页面长时间休眠恢复、网络事件延迟都可能造成边界情况。遇到重复播报时，先刷新所有 GMGN 标签页，让所有页面使用同一版扩展脚本。

## 已开启备注播报但仍然读昵称

依次确认：

- 「使用 AI 语音念昵称」和「优先播报 GMGN 社媒备注」都已开启。
- 当前浏览器中的 GMGN 账号已经给该推特账号设置了社媒备注。
- 设置备注后已经刷新当前 GMGN 页面。
- 推特账号 ID 没有发生变化。

扩展只读取当前 GMGN 页面已有的备注缓存。找不到备注时会按设计回退到推特昵称，再回退到推特 ID；它不会为了获取备注调用第三方中转服务。
