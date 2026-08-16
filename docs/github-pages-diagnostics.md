# GitHub Pages diagnostic UI

Issue #74 moves Visual Director's static diagnostic surface to GitHub Pages and keeps the hosted MCP runtime optional.

## Responsibility split

### GitHub Pages

GitHub Pages hosts only static, read-only diagnostics from `pages/`.

It may describe:

- the current repository-first / Plus-first architecture
- compiled Canon validation rules
- the failure taxonomy
- the optional MCP boundary
- build revision information

It does not execute Visual Director Core, access private game repositories, validate live Canon, or serve MCP requests.

### Game repositories

Game repositories remain authoritative for project-owned visual state, including Visual Canon, Approved Visual Anchors, global visual references, and `.visual-director/compiled-canon.json`.

The compiled Canon is a deterministic derivative. It must not replace the source Canon as the source of truth.

### Optional Node runtime

The existing Node/Vercel hosted runtime may continue to expose `/health` and `/mcp`. It is an optional adapter/runtime and is not a dependency of the ChatGPT Plus repository-native generation path.

A Vercel outage, deployment quota issue, or MCP transport failure must not be classified as a Canon validation failure.

## Deployment

`.github/workflows/pages.yml` publishes `pages/` only when `main` changes relevant Pages files, or when manually dispatched. The workflow injects the short Git revision and UTC build time into the static page before uploading the Pages artifact.

The repository's `vercel.json` disables automatic Vercel deployment for non-`main` branches. This prevents normal PR pushes from consuming Preview Deployments while preserving production deployment from `main`.

Vercel remains available for the optional Node runtime. GitHub Pages is not used as a replacement for `/mcp` or `/health` because Pages cannot host the Node HTTP server.

## Generation availability

Repository-native image generation must remain usable when either of these is unavailable:

- the GitHub Pages diagnostic site
- the optional Vercel/MCP runtime

The required path is the game repository plus its compiled Canon and required reference assets, consumed through the ChatGPT GitHub integration.

## Pages repository setting

The workflow uses `actions/deploy-pages`. The repository must have GitHub Pages configured to use **GitHub Actions** as its build and deployment source. This is a one-time repository setting if Pages has never been enabled before.
