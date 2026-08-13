# Implementation Plan (Confirmed)

## Product Decisions
- License: MIT
- Desktop tech: Electron (npm-only internal build requirement)
- Web transport: `ws`/`wss`
- Desktop transport: `mqtt`/`mqtts`/`ws`/`wss` in the Electron main process
- Sparkplug B scope (v1): Decode-only
- Auth: username/password + mTLS
- Must-have v1 features:
  - connection profiles
  - topic tree
  - retained editor
  - payload viewer
  - publish panel
  - history (opt-in per selected topic from activation point)
- Scale target: 100k topics / 5k messages per second
- Visual direction: modern dashboard aesthetic
- Web release target: Cloudflare (self-host during development)

## Milestone Status

### M1 (in progress, core transport complete)
- [x] Monorepo scaffold (apps + packages)
- [x] Shared protocol package
- [x] Sparkplug decode package
- [x] React dashboard shell
- [x] Connection profile manager
- [x] Live topic tree + search + virtual list
- [x] Payload viewer + retained editor
- [x] Publish panel
- [x] Opt-in history capture + chart
- [x] Electron desktop foundation with a sandboxed renderer and typed preload bridge
- [x] Main-process MQTT.js transport with username/password + mTLS inputs
- [x] OS-encrypted desktop credential storage
- [x] Connection-time subscription filter controls + wildcard presets
- [x] Topic tree usability pass: inline payload previews + recent-message highlight
- [x] Workspace usability pass: collapsible and focusable publish/history panels

### M2
- [x] Throughput hardening pass 1: frame-batched ingestion + per-topic coalescing
- [x] Lower-cost ingestion path: lazy Sparkplug decode and insert-on-first-seen topic indexing
- [x] Throughput hardening pass 2: worker-based topic indexing and runtime backpressure telemetry
- [x] Throughput hardening pass 3: adaptive queue caps and overload mode controls
- [ ] Throughput hardening pass 4: custom overload profiles and optional subscription auto-narrowing
- Payload plugin architecture and binary tools

### M3
- Sparkplug UI enhancements (metric table ergonomics)
- Sparkplug lifecycle overlays (still decode-focused, non-compliance engine)

### M4
- Cloudflare deployment pipeline
- Electron Forge packaging and release automation
- Cross-platform QA matrix

## Electron Migration Gates

- [x] Electron main/preload build uses the existing npm workspace
- [x] Renderer is sandboxed with context isolation and Node integration disabled
- [x] Raw MQTT/TLS transport is implemented without Rust/Cargo
- [x] macOS application packaging succeeds
- [ ] Packaged macOS broker connection smoke test
- [ ] Packaged Windows application and broker connection smoke test
- [ ] Configure company Electron binary mirror/cache in internal CI
- [ ] Configure macOS and Windows signing credentials
- [x] Remove Tauri runtime and npm dependencies from the active build
- [x] Remove the transitional Tauri implementation after packaged Windows parity
