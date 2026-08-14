# Compact controls design QA

final result: passed

## Comparison target

- Source visual truth: `/Users/jg/.codex/visualizations/2026/08/13/019ffc1d-c24e-77d0-a229-8e737a345645/mqtt-ui-audit/09-hidden-scrollbars-electron.jpeg`, the live Electron workspace before the compact-control pass.
- Final Electron screenshot: `/Users/jg/.codex/visualizations/2026/08/13/019ffc1d-c24e-77d0-a229-8e737a345645/mqtt-ui-audit/11-compact-controls-electron.png`.
- Browser verification screenshot: `/Users/jg/.codex/visualizations/2026/08/13/019ffc1d-c24e-77d0-a229-8e737a345645/mqtt-ui-audit/12-compact-controls-browser.png`.
- Source and final Electron pixels: 1280 × 581 at the same 1× CSS window size. No density normalization was required.
- Browser viewport and pixels: 1280 × 720 at 1× density.
- State: local Mosquitto connected in Electron with the 25,000-topic load test at about 2,000 messages/sec, a selected leaf topic, retained payload display, Message History recording, and the right-side chart visible. The browser fallback state is disconnected because native MQTT transport is Electron-only.

## Full-view comparison evidence

The before and after Electron captures were opened together at the same viewport. The source showed Raw and Diff substantially taller and heavier than Json, UTF-8, Hex, Sparkplug, and MQTT5. In the final capture, all of those mode controls share the same compact height, font scale, padding, radius, and visual weight. Panel headers are six pixels shorter, while the three-column information architecture and resizable workspace proportions remain unchanged.

## Focused-region comparison evidence

The Current Value format switcher, Compare row, Topic Inspector header, History header, Timeline controls, and Connections overlay were inspected in the live Electron application. Raw and Diff now visually match Json and Hex. The Connections overlay fits its primary profile fields, runtime subscriptions bar, and live connection telemetry into a shorter vertical footprint without clipping labels or controls.

## Required fidelity surfaces

- Fonts and typography: the existing Sora/Manrope/Avenir/Segoe stack and hierarchy are unchanged. Secondary controls now consistently use the existing 11px compact text scale.
- Spacing and layout rhythm: secondary controls use a shared 28px minimum height; panel headers changed from 46px to 40px; toolbar, subscription, timeline, and disclosure gaps/padding were reduced by two pixels where appropriate.
- Colors and visual tokens: all existing dark-surface, border, accent, and semantic state colors are unchanged. The new sizing token introduces no visual color drift.
- Image quality and assets: this workspace uses no raster product imagery in the affected regions. The history chart and existing interface rendering remain sharp.
- Copy and content: no MQTT values, labels, actions, or explanatory text changed.

## Interaction and accessibility verification

- Raw, Diff, Json, Hex, Start/Stop History, and the History panel controls remained exposed in the Electron accessibility tree after the sizing pass.
- Opening and closing Connections preserved the form controls and restored the underlying workspace correctly.
- In the in-app browser, Collapse removed the History panel and the header History control restored it, confirming the compact controls remain operable.
- Hidden scroll regions continue to scroll, and no new clipping was visible in the tested desktop states.
- `npm test` passed all 28 tests, and the production TypeScript/Vite build completed successfully.

## Findings and comparison history

1. P2 — Raw and Diff were disproportionately large relative to adjacent view-mode controls.
   - Fix: applied the same 28px compact height, 11px font size, 4px radius, and compact padding to the Compare row.
   - Post-fix evidence: Raw and Diff match Json and Hex in the final Electron capture.
2. P2 — Secondary panel actions and sub-bars consumed inconsistent vertical space.
   - Fix: normalized panel-header buttons, connection controls, timeline controls, subscription bars, and disclosure summaries around the compact control token and tighter spacing.
   - Post-fix evidence: the final workspace retains all controls while exposing more payload and tree space; the live Connections overlay is visibly shorter and remains readable.

No actionable P0, P1, or P2 issues remain for the requested compact-control scope.

## Follow-up polish

- P3: a future responsive pass could selectively abbreviate Sparkplug and MQTT5 labels at very narrow inspector widths to avoid wrapping without reducing desktop readability.
