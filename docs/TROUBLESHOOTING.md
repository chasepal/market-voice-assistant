# Troubleshooting

## `Failed to fetch`

如果错误来自 `chrome-extension://.../sounds/...`，通常有两种原因：

1. 扩展刚更新或重新加载，旧 GMGN 标签页里的脚本上下文已经失效。
2. manifest 里声明的资源文件和磁盘文件名不一致。

处理方式：

1. 在 `chrome://extensions/` 重新加载扩展。
2. 刷新所有已经打开的 GMGN 页面。
3. 在仓库目录运行 `npm run check`，确认资源文件存在。

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
