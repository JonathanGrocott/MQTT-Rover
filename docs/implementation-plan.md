# Implementation Plan (Confirmed)

## Product Decisions
- License: MIT
- Desktop tech: Tauri
- Web transport: `ws`/`wss`
- Desktop transport: `mqtt`/`mqtts`
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
- [x] Desktop raw MQTT transport (Tauri Rust) with username/password + mTLS inputs
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
- Desktop packaging and release automation
- Cross-platform QA matrix
