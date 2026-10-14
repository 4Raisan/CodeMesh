# Contributing to CodeWeb

Use Node.js 22 or later. No dependencies need installing.

1. Edit the source in `app/`; do not edit `release/CodeWeb.html` by hand.
2. Run `npm --prefix app run lint`, `npm --prefix app run check`, and `npm --prefix app test`.
3. Run `npm --prefix app run build:standalone` and include the rebuilt release with source changes.
4. Check the affected interactions in a browser and describe your validation in the pull request.

Keep graph data separate from view state. Keep the release self-contained. Never commit imported codebases, source evidence from private projects, credentials, or local QA captures.

Optional scale checks: `node scripts/qa-scale.mjs`. These can take several minutes; results go to the ignored `docs/qa/` directory. Timings depend on hardware and host load.
