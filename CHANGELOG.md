# Changelog

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
