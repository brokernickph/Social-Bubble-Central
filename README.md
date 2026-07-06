# 🫧 Bubbly

An edge-docked, always-on-top messenger hub for Windows. All your chats — Instagram DMs, Discord, WhatsApp, Telegram, Messenger and more — live in a quiet bubble rail on the edge of your screen.

## Features

- **Edge rail** — a slim, always-on-top dock of service bubbles that hugs its content (no dead zone along the edge). Click a bubble to expand the chat panel; press `Esc` or click elsewhere to collapse it back.
- **Movable** — drag the rail by its grip (or any gap between bubbles, or the panel header) and drop it anywhere; it snaps to the nearest screen edge, left or right, and remembers its vertical spot.
- **Floating chat-head bubbles** — pop any chat out of the panel into a floating, always-on-top bubble you can drag anywhere and use independently (the ⧉ button in the panel header, or right-click a bubble → "Pop out as floating bubble"). It opens as a compact chat panel with its own header, and collapses to a 76px draggable head (Messenger-style) — click the head to reopen. It shares the same login session, shows an unread badge, and pulses when a new message arrives while collapsed. The rail bubble gets a cyan badge while it's floating; click it to bring the bubble forward, and closing the bubble returns the chat to the panel.
- **Narrow-layout fixes** — desktop web apps like Discord assume a wide window, so Bubbly injects per-service CSS + zoom (see `catalogTweaks` in [catalog.js](renderer/catalog.js)) to make them usable in a narrow panel/bubble. For Discord it hides the server-icon rail and member list and zooms to 0.8, so the message column actually has room. You can also widen the docked panel (Settings → Dock → Panel width, up to 960px).
- **Slide-away idle** — when you're not interacting, the whole rail slides into the screen edge leaving a 12px sliver with a glow strip (violet, or red when there are unreads). Hover the sliver and it glides back out.
- **Ghost mode** — Bubbly hides completely and slides back in when a new message arrives. Bring it back anytime with `Ctrl+Shift+B` or the tray icon. Toggle from the rail (ghost button), the tray menu, or Settings.
- **Real logins, kept private** — every service is the real web app in its own isolated, persistent session. Log in once; sessions survive restarts. Two accounts of the same service work fine (add it twice).
- **Unread badges** — page titles and per-service DOM probes feed unread counts to bubble badges and the tray tooltip. New messages pulse the bubble and reveal the window in ghost mode.
- **Notifications** — services can fire native Windows notifications (grant permission inside each service).
- **Mute per service** — right-click a bubble → mute; muted services never pulse, reveal, or count toward the total.
- **Drag to reorder** bubbles; right-click for reload / open-in-browser / remove.
- **OAuth-friendly** — "Continue with Google/Facebook/Apple" popups open as proper windows so SSO logins complete in-app; all other external links open in your default browser.
- **No passkey nagging** — WebAuthn is neutralized in the chat webviews by default, so sites like Discord can't pop the Windows "Choose a passkey" dialog; you sign in with a password instead. Password/federated autofill still works. Turn it off in Settings → System if you actually want passkeys.

## Keyboard

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+B` | Show / hide Bubbly (global) |
| `Esc` | Collapse the panel |
| `Ctrl` `+` / `-` / `0` | Zoom the active service |

## Run (development)

```
npm install
npm start
```

## Build a native Windows app

Bubbly packages into a real installable Windows application with [electron-builder](https://www.electron.build/).

```
npm install          # first time, pulls in electron-builder
npm run icon         # regenerate build/icon.ico (only if you change the icon)
npm run dist         # build the installer + portable exe into dist/
```

`npm run dist` produces, in `dist/`:

- **`Bubbly Setup 1.0.0.exe`** — an NSIS installer. It lets you choose the install
  folder, creates Start-menu and desktop shortcuts, and registers an uninstaller
  under "Apps & features".
- **`Bubbly-1.0.0-portable.exe`** — a single-file portable build that runs without
  installing.
- **`dist/win-unpacked/Bubbly.exe`** — the raw unpacked app (handy for quick testing).

`npm run pack` builds just the unpacked `win-unpacked` folder (faster, no installer).

The app icon (`build/icon.ico`) is generated procedurally by `tools/make-icon.js` —
no binary assets are checked in. Builds are unsigned; Windows SmartScreen may warn
on first launch ("More info → Run anyway"). To ship without the warning you'd add a
code-signing certificate via electron-builder's `win.certificateFile`.

## Included services

Instagram, Discord, WhatsApp, Telegram, Messenger, Slack, X Messages, Reddit Chat, Google Chat, LinkedIn, Snapchat, Steam Chat — plus any custom URL.

## Structure

- `main.js` — window docking/resizing, tray, ghost reveal, settings store, OAuth popup routing
- `preload.js` — the small IPC bridge
- `renderer/app.js` — rail, panel, webviews, unread tracking, settings UI
- `renderer/catalog.js` — the service catalog (add new services here)
