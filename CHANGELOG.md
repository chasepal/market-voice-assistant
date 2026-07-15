# Changelog

## 1.8.3 - 2026-07-15

### Added

- Added an optional `优先播报 GMGN 社媒备注` switch for Twitter voice alerts.
- Added read-only lookup of GMGN social remarks from the current page cache.
- Added fallback order: extension rule remark, GMGN remark, Twitter display name, then Twitter handle.
- Added automated tests for remark parsing, switch behavior, WebSocket forwarding, and manifest wiring.

### Safety And Compatibility

- The new switch is off by default, so existing nickname announcements stay unchanged after upgrade.
- The extension never writes to GMGN's remark cache and does not export the cache.
- The public package stays on the proven `inject.js` plus `content.js` runtime; experimental refactor scripts are not included.
- GMGN and Azure host access is restricted to HTTPS.

### Upgrade Notes

1. Reload the unpacked extension in `chrome://extensions/`.
2. Refresh every open GMGN tab so the page receives the new scripts.
3. Open the Twitter monitoring tab and enable `优先播报 GMGN 社媒备注` when needed.

## 2026-06-20

### Fixed

- Stopped writing cross-tab dedupe records into the GMGN page `localStorage`.
- Moved short-lived dedupe state into extension-owned `chrome.storage.local`.
- Added a startup cleanup that removes only legacy extension keys with the `gmgn_companion_local_event_v2:` prefix.
- Documented how to recover from GMGN `QuotaExceededError: reffer24Code` without clearing login state.

### Why It Matters

Older builds could indirectly contribute to `gmgn.ai` site storage pressure when many GMGN tabs or events were open. If GMGN later tried to write its own `reffer24Code`, the page could hit `QuotaExceededError` and enter a Next.js client-side error boundary.

This release keeps extension runtime state inside extension storage, so GMGN site storage and login/session data are not used for plugin dedupe.

### Upgrade Notes

1. Reload the unpacked extension in `chrome://extensions/`.
2. Refresh all open GMGN tabs.
3. Do not clear all GMGN site data unless you explicitly want to log out. The new build only removes old extension-owned keys.

## 2026-06-11

### Added

- Initial public shareable version of the local GMGN voice assistant.
- Azure Speech configuration UI for user-owned Region and Key.
- Privacy notes, troubleshooting docs, and local package checks.
- Neutral icon, neutral extension name, and generic built-in alert sound names.
