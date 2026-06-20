# Privacy

行情语音助手是一个本地加载的 Chrome 扩展。它不会在源码中携带 Azure Key，也不会把 Key 写入仓库文件。

## 本地保存的数据

扩展会使用 Chrome storage 保存这些配置：

- 自定义提醒规则
- 自定义音频
- 钱包备注和过滤设置
- 音量、语速、音调
- 使用者自己填写的 Azure Speech Region 和 Key
- 跨标签页去重所需的短期事件记录

这些数据保存在使用者自己的浏览器配置里。

扩展不会把运行状态写入 GMGN 页面的 localStorage。为兼容旧版本，扩展启动时只会删除旧版留下的 `gmgn_companion_local_event_v2:` 前缀记录，不会清理 GMGN 登录态或其它站点数据。

## 网络请求

扩展会在 GMGN 页面中读取页面事件，用于触发提醒。

如果启用 Azure 官方神经语音，扩展会把需要播报的文本发送给使用者配置的 Azure Speech endpoint，以换取语音音频。Azure Key 会作为请求头发送给 Azure，不会发送给其它自定义中转服务。

## 敏感信息建议

- 不要把自己的 Azure Key 写进源码。
- 分享给别人前，建议用全新的浏览器配置或重新加载扩展确认设置页为空。
- 如果怀疑 Key 泄露，请在 Azure Portal 里轮换 Key。
