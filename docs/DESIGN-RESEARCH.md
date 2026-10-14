# CodeMesh visual design research

Reviewed 12 October 2026. These are established references, not a worldwide ranking. The application recommendations are design judgments; they still need user testing.

## Main finding

Color changes cannot repair unreadable labels or poorly routed connections. Spatial grouping, reading scale and connector routing come first. Color reinforces that structure. A graph with no overlapping cards can still be difficult to understand.

Our current graph fits many detailed cards into a small space, shrinking their text. Concentric tracks still send many edges through the center. Most node types share the same shape. These are separate problems from palette selection.

## References and lessons

- [Harry Beck / TfL archives](https://content.tfl.gov.uk/research-guide-24-harry-beck.pdf): Beck emphasized connectivity, straightened routes and regularized spacing. Application: prioritize traceable connections over decorative positioning.
- [Minard / Edward Tufte](https://www.edwardtufte.com/notebook/the-work-of-charles-joseph-minard/): study how position, direction, annotation and line width carry information together. Application inference: assign each visual channel a defined meaning; line width should not imply an undefined quantity.
- [C4 notation](https://c4model.com/diagrams/notation): explicit scope, element types, directional relationships, consistent notation and a legend. Application: distinguish an architecture overview from a detailed file graph, and retain relationship evidence.
- [NN/g visualization guidance](https://www.nngroup.com/articles/dashboards-preattentive/?lm=contrast-charts&pt=youtubevideo): proximity and shape establish grouping; color reinforces it. Application: groups and node types should remain recognizable without hue.
- [ColorBrewer](https://colorbrewer2.org/): qualitative, sequential and diverging palettes serve different purposes. Application: qualitative hues identify layers; ordered lightness represents ordered measurements. Evaluate palettes using the available colorblind-safe filters.
- [W3C use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html): do not communicate meaning through color alone. Application: category names, type glyphs and line styles accompany color.
- [W3C non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html): meaningful graphical cues generally require 3:1 contrast against adjacent colors. Thin strokes can appear fainter through antialiasing. Application: measure the displayed colors after opacity blending; decorative rings and meaningful connections have different roles.
- [yWorks layered layouts](https://www.yworks.com/pages/layered-graph-layout): hierarchical layouts address layering, crossing reduction and routing. Application: offer a flow-oriented architecture view while retaining rings as an alternative.
- [yWorks edge bundling](https://yed.yworks.com/support/manual/layout/router_edge_bundling.html): bundling can reduce clutter in dense networks. Application: counted group connections can summarize an overview, with individual relationships available on expansion. A crossing must never imply a junction.

## Proposed visual grammar

### Layout and navigation

Use named groups with a dominant reading direction for an architecture overview. A possible display sequence is UI, routes/endpoints, services, data; it is not a universal runtime sequence. Cycles and reverse dependencies remain visible. Keep concentric exploration available, without implying that radius is an architectural fact.

At distant zoom show groups and counted relationships. Expand to files, then source evidence. Preserve access to every underlying edge. Do not silently hide connections to make the screenshot cleaner.

### Color

Use a neutral background, readable text and restrained category accents. Match node accent, group boundary and legend. Selection strengthens an outline rather than changing a node's category color.

Test the palette at the actual category count, with color-vision simulations and grayscale. Different hex values do not prove perceptual separation. The current palette has not passed those checks. Warnings need an explicit symbol and label so ordinary category colors cannot be mistaken for status.

### Shapes

Keep names inside cards, as requested. Add compact, stable type glyphs for files, endpoints, services, data and external dependencies. Retain readable type text. Glyphs provide redundancy without requiring oversized or unrelated silhouettes.

### Lines

Keep connection appearance independent from decorative layer boundaries. Show direction where arrowheads are readable. Inferred links have a distinct style and evidence text. Decorative dashed rings must not be mistaken for inferred edges.

Route around node boundaries and minimize crossings before increasing brightness. Prefer disciplined bends over arbitrary curves. Bundle only when shared meaning is explicit; label counts and preserve evidence. Selection may emphasize related lines, while background hiding remains a user choice.

### Text

Legibility is a requirement, not a side effect of fitting. Sixty-nine detailed cards cannot all remain readable when squeezed into a small canvas. Use levels of detail instead of alternating between tiny node text and oversized layer headings. Curved labels supplement a readable group heading or legend.

## Acceptance checks

1. Identify a layer without guessing its color.
2. Read a filename at the intended exploration zoom.
3. Trace a specific relationship and find its source evidence.
4. Distinguish selection and status without hue alone.
5. Check actual contrast after opacity and thin-stroke rendering.
6. Check labels, edges and controls in settled screenshots at desktop and narrow sizes.
7. Verify SVG exports retain marks, labels and grouping.
8. Compare real reading and tracing tasks with users. Screenshot inspection and passing unit tests do not establish usability.

Implementation order: grouping and reading scale, connector routing, consistent color/type tokens, then motion and polish. Preserve the portable single-HTML release and existing import/export features.
