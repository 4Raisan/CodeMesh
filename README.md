# CodeMesh

![CodeMesh — See how your code fits together.](docs/assets/codemesh-brand.svg)

A portable codebase explorer that turns source folders into an interactive knowledge graph. Navigate files and dependencies, inspect source evidence, filter relationships, and save or export a useful view of a project.

## Open the app

Open [release/CodeMesh.html](release/CodeMesh.html) in your browser. This standalone file bundles the application and can be copied elsewhere. Choose a repository folder, drop source files, or load a compatible graph JSON export. The app starts empty until a folder is loaded. Browsers require a folder drop or selection to authorize local filesystem access; placing an HTML alone cannot silently read nearby files. This permission step repeats on reopening. Export a graph JSON to reopen a snapshot without rereading sources. Servers with directory listings automatically scan only the HTML directory and descendants, never its parents.

For local development, use Node.js 22 or later. No package installation is required; the app has no runtime dependencies. Run from this repository:

```text
npm --prefix app run serve
```

Then open http://127.0.0.1:8000.

## Explore the map

The map starts with its panels closed and Architecture layers selected. Data, services, routes, endpoints, API calls, UI and dependencies occupy separate concentric tracks. Layer assignment is a display heuristic based on node type and source path; it does not add architectural facts to the graph. Force and grouped-grid layouts remain available. Search at the top, choose **Open project**, or drop a source folder. New projects start with **All relationships**, Architecture layers, Night theme, and connection animation enabled. A loading indicator appears during import; a dismissible notice shows node counts, local import time, and viewing guidance. Search can discover nodes outside the overview.

Select a node to open its details, full source path, and connections. **Show neighbors** focuses its local map; **Pin** keeps its position when you adjust layout physics. Source evidence is available inside each relationship's disclosure.

**View** contains layout, spacing, connection visibility and opacity, animation, node-type filters, and graph themes. The legend controls connection names and confirmed/possible connections. Selecting a node focuses its connections and shows their names; clicking the empty canvas clears the selection.

**Nodes** opens the keyboard-accessible node list. Fit and zoom controls sit in the bottom bar. **Open project** accepts a folder or compatible JSON file. **Export** provides SVG, graph JSON, and view JSON.

## Recommended viewing range

Aim for **up to 300 visible nodes** for everyday exploration. This is a practical recommendation, not an enforced node limit or a verified performance guarantee.

- **300–1,000 visible nodes:** prefer Architecture layers and use search, node-type filters, or Show neighbors; avoid Force for large maps.
- **Over 1,000 visible nodes:** explore smaller groups or neighborhoods. Loading all nodes does not guarantee a responsive full-map view.

The viewing recommendation does not discard extracted nodes: keep the full graph available in graph JSON. Extraction has separate limits (5,000 files, 2 MB per file, 40 MB total), and unsupported patterns can still leave relationships missing or unresolved. The 1,000/1,500/2,000-node checks exposed Force delays and Grid overlaps; browser responsiveness at that scale remains unverified.

See the [architecture diagram](docs/ARCHITECTURE.md) and [validation notes](docs/QA.md) for scope and limitations.

## What it does

- Builds a graph from source files using static pattern extraction in the browser.
- Shows files, dependencies, routes, data models, tests, and external or unresolved references where supported by the parser.
- Provides search, filters, pan/zoom, layout controls, a source-evidence inspector, and a keyboard-accessible node list.
- Exports graph JSON, view JSON, and SVG diagrams.

Extraction does not execute imported source code. Pattern extraction is not a compiler or language server: it can miss or misinterpret constructs. Unresolved and inferred relationships require review. This is currently a dependency-free browser prototype with an SVG renderer, not a graph database or a complete semantic code index.

## One portable release

Only **release/CodeMesh.html** needs to be copied into a developer's project. Choose a dashboard folder to map User, Customer and Admin together; choose only User to map User and its descendants. Imports outside that tree remain unresolved and do not read outside files.

The repository includes modular source in `app/`, automated tests, build tools, documentation, and the portable release. Local QA captures and generated stress fixtures are excluded from Git.

## Validate and build

```text
npm --prefix app test
npm --prefix app run lint
npm --prefix app run check
npm --prefix app run build:standalone
```

The standalone build generates only release/CodeMesh.html. Edit the modular source files, then rebuild; avoid editing the generated HTML directly.

## Status

Local project; package version 0.1.0. A distribution license has not been selected.

See [the application validation notes](docs/QA.md) for real-project and browser checks.


Nodes are locked against pointer dragging; empty-canvas panning, zooming and selection remain available. The desktop legend combines layer categories and the inferred-line key at bottom right. View offers Night, Slate, Black and Custom graph themes, background line opacity/visibility, and separate inferred-line opacity/visibility. These controls never alter layer boundaries.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development checks. See [SECURITY.md](SECURITY.md) for reporting security issues. A reuse/distribution license is not yet selected.
