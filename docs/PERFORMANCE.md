# Practical performance checks

Measured locally on 2026-10-15. Single fresh-process run per case; synthetic mixed node types, three connections per node. Values measure layout computation only, excluding file parsing, DOM drawing, and animation. Host load affects results; these are comparisons, not guarantees.

| Full graph | Architecture layers | 300-node view | Force (38 iterations) | Experimental Force (12 iterations) |
| --- | ---: | ---: | ---: | ---: |
| 1,000 nodes | 55 ms | 17 ms | 2,776 ms | 2,214 ms |
| 1,500 nodes | 160 ms | 30 ms | 6,740 ms | 4,929 ms |
| 2,000 nodes | 316 ms | 33 ms | 17,502 ms | 12,799 ms |

Every completed layout had finite positions and zero rectangular node overlaps in these particular fixtures. That does not establish zero overlaps for arbitrary projects or assess whether Force produced a useful arrangement. The 300-node view uses the first 300 nodes as a bounded-view proxy; it is not a neighborhood-quality test and does not discard nodes from the source graph.

## Recommendations

- Keep Architecture layers as the default: approximately 50–55 times faster than Force in these cases.
- For large graphs, use a focused view: 2,000-to-300 visible nodes reduced layout time from 316 ms to 33 ms (about 9.6 times faster). Keep the full graph for search and export.
- Do not ship the tested lower-iteration Force shortcut as a scalability fix. It saved 20–27% but still needed 12.8 seconds at 2,000 nodes; arrangement quality needs broader evaluation.
- A worker-based layout and Canvas/WebGL rendering are possible future improvements, not tested improvements in this report. A worker can protect responsiveness but does not itself reduce algorithmic cost.

## Browser checks

The standalone release loaded synthetic 1,000-node/999-connection and 2,000-node/1,999-connection JSON through the actual file picker. DOM counts matched the graph counts. Zoom in and Fit responded at both sizes. The 2,000-node view had no horizontal page overflow. This lighter connection density differs from the layout benchmark. No sustained frame-rate or full memory profile was measured.

Automatic launch update checking displayed the green current-version dot and hid Get latest when the local version was at least the latest release; the GitHub star was yellow. Test-only browser fixtures also verified red glow with Get latest for an older version, and a gray dot with no link when the endpoint was unavailable. Automated update tests cover current, older, newer, failed, and invalid versions.

Reproduce layout comparisons with `node scripts/qa-practical-performance.mjs`. Each case has a 20-second process timeout; local JSON output is ignored under `docs/qa/`.
