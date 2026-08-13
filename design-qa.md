# History right-column layout design QA

final result: passed

## Comparison target

- Source visual truth: user-provided conversation attachment `Electron Appshot 2026-08-13T23-48-45.073Z.png`, showing the History chart incorrectly placed below the tree and inspector and Message History painting over Current Value. The attachment is conversation-owned and has no exposed local filesystem path.
- Supporting pre-change reference: `/Users/jg/.codex/visualizations/2026/08/13/019ffc1d-c24e-77d0-a229-8e737a345645/mqtt-ui-audit/04-mqtt-rover-expanded-tree.png`.
- Final Electron screenshot: `/Users/jg/.codex/visualizations/2026/08/13/019ffc1d-c24e-77d0-a229-8e737a345645/mqtt-ui-audit/07-history-right-column-expanded.jpeg`.
- Browser responsive-layout screenshot: `/Users/jg/.codex/visualizations/2026/08/13/019ffc1d-c24e-77d0-a229-8e737a345645/mqtt-ui-audit/08-history-three-column-browser.png`.
- Source attachment pixels: 1692 × 768. The Electron source capture is approximately a 1.322× representation of the 1280 × 581 CSS window used for the implementation capture, so composition was compared after accounting for that density difference.
- Final Electron pixels: 1280 × 581 at the native Computer Use capture density.
- Browser verification viewport and pixels: 1280 × 720 at 1× density.
- State: 25,000-topic namespace at approximately 2,000 messages/sec, numeric topic selected, chart recording, and Message History expanded.

## Full-view comparison evidence

The supplied source attachment and final Electron capture were reviewed together in the same implementation turn. The source shows two columns above a full-width bottom chart; the final capture keeps Topic Explorer, Topic Inspector, and History in one desktop row. The live chart occupies the far-right column and does not reduce the vertical workspace available to the tree. At the 1280px browser breakpoint the measured tracks were 561px tree, 366px inspector, and 293px history, plus two 10px resize handles.

## Focused-region comparison evidence

The inspector and chart region was inspected at full capture resolution with Message History expanded. The source shows Message History rows painting across the Current Value region. The final Electron capture shows Current Value, the bounded Message History viewport, Retained Editor, and the right-side chart as separate non-overlapping regions. The History header exposes Timeline, Collapse, and Focus without clipping.

## Required fidelity surfaces

- Fonts and typography: the existing Sora/Manrope/Segoe UI stack, weights, sizes, and hierarchy were preserved. No labels wrap unexpectedly in the 293px history panel.
- Spacing and layout rhythm: desktop history now has a minimum 24% column share; the tree remains dominant and resize handles stay between panels. Expanded Message History uses a bounded 220px/32vh region with internal scrolling.
- Colors and visual tokens: existing dark navy, teal, blue, line, and muted text tokens are unchanged. The fix introduces no competing surface treatment.
- Image quality and assets: this screen contains no raster product imagery or custom icon assets. Chart rendering remains sharp and uses the existing Recharts implementation.
- Copy and content: Start History, Stop History, History, Timeline, Collapse, Focus, Message History, and Retained Editor remain unchanged and accurately describe their actions.

## Interaction and accessibility verification

- Clicking Start History on a selected numeric topic changed it to Stop History and immediately opened the History chart in the far-right column.
- Live numeric points appeared after subsequent MQTT messages.
- Expanding Message History exposed recorded rows in a scrollable region without covering Current Value or the chart.
- The 1280px in-app browser check confirmed one grid row and all three panel headers.
- Browser console check found no application errors. Two existing protobufjs/Vite `fs` externalization warnings remain and are unrelated to this layout.
- Electron verification retained the live broker-specific path that is unavailable in a normal browser renderer.

## Findings and comparison history

1. P1 — History chart moved below the workspace at the normal Electron width.
   - Fix: lowered the stacked-layout breakpoint from 1400px to 1080px and aligned resizer behavior with the same threshold.
   - Post-fix evidence: the final Electron and browser screenshots both show a single-row three-panel grid.
2. P1 — Expanded Message History painted over sibling inspector content.
   - Fix: gave Current Value a protected minimum track, made the inspector vertically scrollable, and bounded/clipped the open Message History region with its own scrollbar.
   - Post-fix evidence: Retained Editor appears after the history viewport and no message row paints through it.
3. P2 — The restored right column initially clipped History header actions.
   - Fix: raised the history-column minimum from 18% to 24% and tightened/wrapped its header controls.
   - Post-fix evidence: Timeline, Collapse, and Focus are simultaneously visible at 1280px.

No actionable P0, P1, or P2 issues remain for the requested state.

## Follow-up polish

- P3: consider a user preference for the default history-column width after more Windows testing at common display scaling levels.
