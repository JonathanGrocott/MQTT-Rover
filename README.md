# MQTT Rover

MQTT Rover is a modern MQTT explorer designed for web and desktop.

Current milestone implements:
- Connection profiles (persisted locally)
- Initial subscription list with per-filter QoS (applied on connect)
- Runtime subscription manager (add/remove topic filters with QoS)
- Topic tree explorer with worker-based indexing + virtualized rendering
- Live payload viewer (UTF-8, JSON, HEX)
- Timeline workflow panel (pause, filter, diff A/B payloads, export JSONL)
- Timeline bookmarks + advanced filter drawer (payload/QoS/retain/MQTT5/regex)
- Timeline session import + replay from JSONL/NDJSON exports
- Sparkplug B decode (payload decode-only)
- Publish panel (QoS + retain + MQTT5 publish properties inspector)
- Clean-by-default controls with collapsible advanced sections/toolbars
- Workspace view presets (`Simple` / `Advanced`) persisted locally
- Retained editor for selected topic
- Opt-in per-topic history capture with charting
- Runtime backpressure telemetry chips (msg/s, queue depth, coalescing, flush cost, drops)
- Adaptive overload controls with hard queue caps by mode (`balanced`, `history-priority`, `latest-only`)
- Tree UX upgrades: inline endpoint payload previews, per-topic message counters, and scalable Off/Subtle/Full activity indications
- Workspace usability controls: collapsible connections/publish/history panels and focus mode for publish/history

## Stack
- React + TypeScript + Vite
- Zustand for state
- MQTT.js transport for web (`ws`/`wss`)
- Electron desktop shell with main-process MQTT.js transport (`mqtt`/`mqtts`/`ws`/`wss`)
- Shared workspace packages for protocol and Sparkplug decode

## Workspace Layout
- `apps/client`: React web app + Electron desktop shell
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

## Validate
```bash
npm run typecheck
npm run test
npm run build
```

## Run (Desktop)
```bash
npm run electron:dev
```

To exercise the desktop client against a disposable, busy local broker, see
[Local MQTT load testing](docs/load-testing.md). The included simulator can populate up to the
100,000-topic design target and sustain a configurable message rate without using shared public
broker capacity.

## Desktop Status
Desktop implementation lives under `apps/client/electron`:
- Broker sockets run in Electron's main process; the renderer has no Node.js access
- `mqtt`, `mqtts`, `ws`, and `wss` are supported through MQTT.js
- Username/password and mTLS are supported
- MQTT 5 connection, publish, subscribe, and incoming publish-property metadata are supported
- Incoming messages cross the isolated preload bridge in frame-sized batches
- Password and TLS PEM values are encrypted with Electron `safeStorage`

Notes:
- Web mode (`ws` / `wss`) remains fully working and validated.
- Electron requires its platform binary to be available through npm's download path, an internal
  `ELECTRON_MIRROR`, or a pre-populated cache.
- CI runs web checks plus packaged Electron builds on macOS and Windows.
- The active desktop build is npm-only and does not require Rust, Cargo, or crates.io.

## Package (Desktop)
```bash
# Unpacked application for the current OS
npm run electron:package

# Installer/archive for the current OS
npm run electron:make
```

## Next Milestones
1. Add advanced overload options (custom per-profile caps and optional auto-subscription narrowing).
2. Add workspace layout persistence and advanced payload format plugins.
3. Add Cloudflare deployment workflow and release packaging.
4. Add release automation and cross-platform QA matrix.

## Current Notes
- Default web subscription filter falls back to `#` when empty.
- Some public brokers (including HiveMQ public) reject root wildcard subscriptions; use a scoped filter such as `test/#` when needed.
