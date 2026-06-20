# 行情语音助手

一个本地加载的 Chrome 扩展，用于 GMGN 页面上的推特、行情和钱包语音提醒。扩展默认不内置任何个人 Azure Key，使用者需要在自己的浏览器里填写自己的 Azure Speech 配置。

> 仅用于信息提醒，不构成交易建议。请自行确认数据和风险。

## 功能

- GMGN 页面事件监听
- 推特提醒音和 TTS 播报
- 钱包买入、减仓、清仓播报
- Azure 官方神经语音，可回退到本机系统语音
- 多标签页去重和轻量状态提示
- 自定义音频、音量和冷却规则

## 安装

1. 下载本仓库代码并解压。
2. 打开 Chrome，进入 `chrome://extensions/`。
3. 打开右上角「开发者模式」。
4. 点击「加载已解压的扩展程序」。
5. 选择这个仓库文件夹。
6. 打开或刷新 GMGN 页面。

## 配置 Azure 语音

1. 点击扩展图标，进入「语音设置」。
2. 在「AI 语音来源」选择 `Azure 官方神经语音`。
3. 填写自己的 Azure Speech `Region` 和 `Key`。
4. 选择喜欢的声音并点击「试听」。

Azure Key 只保存在使用者自己浏览器的 Chrome storage 里，不在仓库源码中。

## 排障

- 如果 Chrome 扩展错误页出现 `Failed to fetch`，通常是刚更新扩展后旧 GMGN 页面还没刷新。刷新所有打开的 GMGN 标签页即可。
- 如果 Azure 试听失败，先确认 Region 和 Key 是否来自同一个 Azure Speech 资源。
- 如果页面右下角显示需要点按，点一下 GMGN 页面即可解锁浏览器音频播放权限。

更多细节见 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)。

## 隐私

见 [PRIVACY.md](PRIVACY.md)。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

## 本地检查

```bash
npm run check
```

检查内容包括：

- manifest 列出的资源文件是否真实存在且大小写一致
- 分享版中是否残留旧人物预置或旧品牌关键词
- 主要 JavaScript 文件是否能通过语法检查
