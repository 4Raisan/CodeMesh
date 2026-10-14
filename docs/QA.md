# Validation and known limits

The latest local validation passed all 66 automated tests, syntax checks, graph contract checks, and standalone bundle freshness checks. GitHub Actions runs these checks with Node.js 22 and verifies the generated release matches its source.

## Scope

Checks cover extraction, imports, graph integrity, folder boundaries, layout geometry, selection, visibility, and standalone wiring. Local browser checks covered folder imports, navigation, filters, the inspector, and exports. Direct disk opening was not automated; embedded scripts/styles are verified by tests.

## Scale

Synthetic graphs with 1,000, 1,500, and 2,000 nodes exposed Grid overlaps and slow Force arrangements. Completed layouts retained all nodes with finite positions. The 2,000-node Force run was interrupted; a browser Fit action timed out at 2,000 nodes. Sustained browser responsiveness is unverified, and timings varied substantially with host load.

Recommend up to **300 visible nodes** for everyday exploration; use Layers and filters for 300–1,000, and smaller neighborhoods above 1,000. This is guidance, not an enforced cap or performance guarantee. Filtering does not discard extracted graph data.

## Extraction

Static pattern extraction can miss dynamic relationships and framework routes or leave imports unresolved. File limits are 5,000 files, 2 MB per file, and 40 MB total. Choosing a subtree cannot read imports outside that folder. Large vendor or generated folders can distort results.

Local QA screenshots, imported-project audit files, and stress fixtures are deliberately excluded from Git to avoid publishing project-specific source information. The scale audit script can regenerate synthetic data locally.
