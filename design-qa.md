# Tree-first workspace design QA

final result: passed

## Comparison target

- Source visual truth: `/Users/jg/.codex/visualizations/2026/08/13/019ffc1d-c24e-77d0-a229-8e737a345645/mqtt-ui-audit/01-mqtt-explorer-main.png`
- Implementation screenshot: `/Users/jg/.codex/visualizations/2026/08/13/019ffc1d-c24e-77d0-a229-8e737a345645/mqtt-ui-audit/05-mqtt-rover-tree-first.png`
- Browser interaction screenshot: `/Users/jg/.codex/visualizations/2026/08/13/019ffc1d-c24e-77d0-a229-8e737a345645/mqtt-ui-audit/06-mqtt-rover-browser-interactions.png`
- Source pixels: 1280 × 720 at 1× density.
- Implementation pixels: 1280 × 640 at 1× density; the 80px height difference is macOS Electron window chrome/capture framing and was excluded from layout judgments.
- CSS desktop viewport: approximately 1280 × 640.
- State: topic tree expanded to an endpoint under a 25,000-topic retained namespace; right inspector showing a current JSON value.

The implementation deliberately adopts MQTT Explorer's tree-first spatial model rather than cloning its light theme or dated Material styling. MQTT Rover's dark palette, payload tools, and high-volume controls remain product constraints.

## Full-view comparison evidence

The source and implementation were opened together at equal 1280px width. Both use a compact application bar, a dominant left topic tree, one contextual inspector on the right, selected-topic context above the current value, and secondary history/publish tools that do not permanently compete with the tree. Rover uses a 46% default tree split within the requested 42–50% range and persists user resizing.

## Focused-region comparison evidence

The top application bar, topic-tree header and expanded endpoint rows, selected-topic breadcrumb, current-value controls, and collapsed history/retained sections were inspected at full resolution. No separate crops were needed because all important controls and type were legible in the 1280px captures.

## Required fidelity surfaces

- Fonts and typography: Rover retains its Sora/Manrope/Segoe UI stack and uses clearer sentence-case 14px panel titles and 13px tree labels. Small metadata remains secondary without obscuring identifiers. Metric names remain non-shrinking and values truncate first.
- Spacing and layout rhythm: the tree is the dominant default pane; the former oversized workspace strip is replaced by a 50px app bar. Panel radii are reduced from 14px to 7px and section boundaries are flatter and calmer.
- Colors and tokens: Rover intentionally keeps its dark navy and teal identity. Selection uses blue; activity retains a separate restrained signal. The heavy radial background and excess gradients were removed.
- Image quality and assets: neither design requires imagery in the working application surface. No placeholder imagery, custom SVG, or CSS-drawn asset substitutes were introduced.
- Copy and content: explanatory copy about prioritizing panels was removed. Labels now describe stable product objects and actions: Topic Explorer, Topic Inspector, Current value, Connections, Publish, and History.

## Interaction and accessibility verification

- Search input accepted and displayed a topic filter.
- Inline values switched between Show and Hide.
- Publish opened from the compact app bar, exposed its functional form, and reported pressed state.
- Topic branch expansion, selection, resizers, and current-value tabs remained present in the Electron capture.
- Keyboard focus is visibly rendered around the active app-bar control.
- Controls retain semantic labels and pressed states.
- Browser console contained no application errors. Two pre-existing protobufjs/Vite browser-compatibility warnings were present and are unrelated to this UI pass.

## Findings and comparison history

Initial audit findings were inspector-heavy proportions, an oversized workspace strip, weak selected-topic hierarchy, excessive surface chrome, and payload previews competing with metric names.

Fixes made:

1. Increased and persisted the default tree split.
2. Replaced the workspace strip with a compact search-centered app bar.
3. Added a breadcrumb topic summary and quieter message metadata.
4. Flattened panel surfaces and reduced radii and gradients.
5. Added a persisted Show/Hide control for inline values while preserving full metric names.
6. Kept history, publishing, and connection management available as contextual utilities.

Post-fix evidence shows no remaining actionable P0, P1, or P2 issue relative to the selected design direction.

## Follow-up polish

- P3: Replace some text utility actions with a consistent icon set once the project's icon library is selected.
- P3: Test a slightly taller tree-row density option for accessibility without sacrificing very-large-broker scanning efficiency.
