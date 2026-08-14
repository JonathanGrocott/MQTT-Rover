# Hidden scrollbar treatment design QA

final result: passed

## Comparison target

- Source visual truth: user-provided conversation attachment `Electron Appshot 2026-08-13T23-59-54.609Z.png`, showing bright native scrollbar tracks in the topic tree, inspector, payload viewer, and Message History. The conversation-owned attachment has no exposed local filesystem path.
- Final Electron screenshot: `/Users/jg/.codex/visualizations/2026/08/13/019ffc1d-c24e-77d0-a229-8e737a345645/mqtt-ui-audit/09-hidden-scrollbars-electron.jpeg`.
- Browser verification screenshot: `/Users/jg/.codex/visualizations/2026/08/13/019ffc1d-c24e-77d0-a229-8e737a345645/mqtt-ui-audit/10-hidden-scrollbars-browser.png`.
- Source attachment pixels: 1692 × 768. The source is approximately a 1.322× representation of the 1280 × 581 Electron CSS window, so the final Electron capture was compared after accounting for that density difference.
- Final Electron pixels: 1280 × 581.
- Browser viewport and pixels: 1280 × 720 at 1× density.
- State: connected to the 25,000-topic load test at approximately 2,000 messages/sec, history chart active, Message History expanded, and topic tree scrolled away from its initial position.

## Full-view comparison evidence

The source attachment and final Electron screenshot were reviewed together in this implementation turn. The source contains four highly visible white native scrollbar tracks that interrupt the dark panel surfaces. The final capture preserves the same three-column layout and content density while removing all painted tracks, thumbs, and reserved scrollbar gutters.

## Focused-region comparison evidence

The tree's right edge, inspector's right edge, JSON payload viewer, and expanded Message History region were inspected at full capture resolution. Each edge now remains visually continuous with its panel background. The tree was scrolled from the selected `device-000` area down to `device-008` through `device-022`, demonstrating that hidden tracks did not disable scrolling.

## Required fidelity surfaces

- Fonts and typography: unchanged. Removing scrollbar gutters gives labels and payload content slightly more horizontal room without changing size, weight, wrapping, or hierarchy.
- Spacing and layout rhythm: the bright scrollbar widths and the inspector's reserved gutter were removed. Panel boundaries and resizer handles remain visually distinct.
- Colors and visual tokens: no new colors were introduced. Scroll regions now use the surrounding dark navy surfaces instead of native white macOS/Chromium tracks.
- Image quality and assets: the working screen has no raster product imagery or custom icon assets. Chart rendering remains sharp and unchanged.
- Copy and content: no labels, actions, or MQTT data presentation changed.

## Interaction and accessibility verification

- Electron trackpad scrolling moved the topic tree by more than one viewport while no scrollbar was painted.
- Topic tree, payload panel, payload viewer, Message History, Timeline, breadcrumb, and connection drawer retain their existing `auto` scrolling behavior.
- Browser computed styles report `scrollbar-width: none` while `.topic-tree-list` remains `overflow-x: auto; overflow-y: auto` and `.payload-panel` remains `overflow-y: auto`.
- Keyboard scrolling remains available when a scrollable child or control within it has focus; programmatic scrolling is unaffected.
- Browser console contained no application errors. The two existing protobufjs/Vite `fs` externalization warnings remain unrelated to this change.

## Findings and comparison history

1. P2 — Native scrollbar tracks visually dominated the dark workspace.
   - Fix: applied workspace-scoped cross-browser hidden-scrollbar styling using `scrollbar-width: none`, `-ms-overflow-style: none`, and a zero-sized hidden WebKit scrollbar.
   - Post-fix evidence: the final Electron capture has no visible white tracks or thumbs in any panel.
2. P2 — The inspector reserved a bright scrollbar gutter even when the thumb was not useful.
   - Fix: removed `scrollbar-gutter: stable` from the payload panel.
   - Post-fix evidence: Current Value, Message History, and Retained Editor extend cleanly to the panel edge.

No actionable P0, P1, or P2 issues remain for the requested state.

## Follow-up polish

- P3: if keyboard-only users need a stronger spatial cue later, add a very subtle inset fade at scroll boundaries rather than restoring a persistent track.
