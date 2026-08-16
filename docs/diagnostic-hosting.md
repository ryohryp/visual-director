# Diagnostic hosting

Issue #74 separates Visual Director's static diagnostics from the image-generation critical path without requiring GitHub Pages or a paid GitHub plan.

## Responsibility split

### Static diagnostics

The source for the read-only diagnostic UI lives under `pages/`.

`npm run build` copies that content into `dist/diagnostics/`, injects the build revision and UTC build time, and Vercel serves it at `/diagnostics` from the production build output.

The diagnostic surface may describe:

- the repository-first / Plus-first architecture
- compiled Canon validation rules
- the failure taxonomy
- the optional MCP boundary
- build revision information

It does not execute Visual Director Core, access private game repositories, validate live Canon, or make MCP availability part of generation correctness.

### Game repositories

Game repositories remain authoritative for project-owned visual state, including Visual Canon, Approved Visual Anchors, global visual references, and `.visual-director/compiled-canon.json`.

The compiled Canon is a deterministic derivative. It must not replace the source Canon as the source of truth.

### Optional Node runtime

The existing Node/Vercel hosted runtime may continue to expose `/health` and `/mcp`. It is an optional adapter/runtime and is not a dependency of the ChatGPT Plus repository-native generation path.

A Vercel outage, deployment quota issue, or MCP transport failure must not be classified as a Canon validation failure.

## Deployment policy

`vercel.json` keeps automatic deployment enabled for `main` only and disables normal branch/PR Preview Deployments. This avoids consuming deployment quota for every implementation commit while preserving production deployment from the authoritative branch.

The static diagnostic UI is bundled into that same production build. It does not require GitHub Pages, a public repository, or a separate paid hosting service.

## Generation availability

Repository-native image generation must remain usable when either of these is unavailable:

- the static `/diagnostics` surface
- the optional Vercel/MCP runtime

The required path is the game repository plus its compiled Canon and required reference assets, consumed through the ChatGPT GitHub integration.
