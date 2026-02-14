# MQTT Rover

MQTT Rover is a modern MQTT explorer designed for web and desktop.

Current milestone implements:
- Connection profiles (persisted locally)
- Connection-time wildcard subscription filters
- Topic tree explorer with worker-based indexing + virtualized rendering
- Live payload viewer (UTF-8, JSON, HEX)
- Sparkplug B decode (payload decode-only)
- Publish panel (QoS + retain)
- Retained editor for selected topic
- Opt-in per-topic history capture with charting
- Runtime backpressure telemetry chips (msg/s, queue depth, coalescing, flush cost, drops)
- Adaptive overload controls with hard queue caps by mode (`balanced`, `history-priority`, `latest-only`)
- Tree UX upgrades: inline endpoint payload previews, per-topic message counters, and recent-message highlight
- Workspace usability controls: collapsible connections/publish/history panels and focus mode for publish/history

## Stack
- React + TypeScript + Vite
- Zustand for state
- MQTT.js transport for web (`ws`/`wss`)
- Tauri desktop transport (`rumqttc`) for raw `mqtt`/`mqtts`
- Shared workspace packages for protocol and Sparkplug decode

## Workspace Layout
- `apps/client`: React web app + Tauri shell files
- `packages/protocol`: Shared protocol types/utilities
- `packages/sparkplug`: Sparkplug B protobuf decoder

## Run (Web)
```bash
npm install
npm run dev
```

## Build (Web)
```bash
npm run build
```

## Run (Desktop)
```bash
. "$HOME/.cargo/env"
cd apps/client
npm run tauri:dev
```

## Desktop Status
Desktop transport implementation lives under `apps/client/src-tauri`:
- `mqtt` and `mqtts` supported through Rust (`rumqttc`)
- Username/password supported
- mTLS supported for `mqtts` when CA + client cert + client key PEM values are provided

Notes:
- Rust toolchain is required for desktop (`rustc`/`cargo`). Install with `rustup` and source `$HOME/.cargo/env`.
- Desktop backend compiles successfully with `cargo check` in `apps/client/src-tauri`.
- Web mode (`ws` / `wss`) remains fully working and validated.

## Next Milestones
1. Add advanced overload options (custom per-profile caps and optional auto-subscription narrowing).
2. Add workspace layout persistence and advanced payload format plugins.
3. Add Cloudflare deployment workflow and release packaging.
4. Add release automation and cross-platform QA matrix.

## Current Notes
- Default web subscription filter falls back to `#` when empty.
- Some public brokers (including HiveMQ public) reject root wildcard subscriptions; use a scoped filter such as `test/#` when needed.
