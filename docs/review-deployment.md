# UI review deployment

## Canonical review target

- URL: `https://visual-director-beta.vercel.app`
- Vercel project: `visual-director`
- GitHub repository: `ryohryp/visual-director`
- Production branch: `main`
- Authentication: the Visual Director review routes are expected to be readable without Vercel sign-in. The Vercel dashboard itself may require account authentication.

Do not use an individual immutable deployment hostname as the canonical review URL. The production alias above is the stable review target and is verified against the deployed Git revision.

## Revision diagnostics

Every review page exposes a small deployment diagnostics line. The same non-sensitive information is available as JSON at:

`https://visual-director-beta.vercel.app/api/deployment`

The response includes the Visual Director app identifier, full Git revision, branch, build time, Vercel deployment ID, and production URL when available. It intentionally reads only whitelisted deployment metadata and does not expose repository tokens or other environment variables.

Compare the `revision` value with the commit intended for review, for example:

```bash
git rev-parse HEAD
```

## Deployment flow

`.github/workflows/deploy-production.yml` deploys `main` automatically after each push to `main` and can also be started manually. The workflow captures the exact checked-out revision and build time, passes them to the Vercel runtime, then verifies both the hosted MCP endpoint and the UI review surface.

The Vercel Git deployment path remains disabled in `vercel.json`; the GitHub Actions workflow is the single production deployment path and prevents duplicate deployments.

## Smoke verification

Run the review smoke check against the canonical production alias:

```bash
VISUAL_DIRECTOR_REVIEW_URL=https://visual-director-beta.vercel.app \
EXPECTED_REVISION="$(git rev-parse HEAD)" \
npm run verify:review
```

The check rejects login/fallback HTML, stale revisions, wrong applications, missing project data contracts, and failures on these canonical routes:

- `/`
- `/projects/<project_id>`
- `/projects/<project_id>/canon`
- `/projects/<project_id>/anchors`
- `/projects/<project_id>/assets`
- `/projects/<project_id>/generations`
- `/api/projects`
- `/api/projects/<project_id>/overview`
- `/api/deployment`

The default smoke project is `bottom-of-thirst`; override it with `VISUAL_DIRECTOR_SMOKE_PROJECT_ID` when needed.

## Verified observation — 2026-08-22

During Issue #128 investigation, `https://visual-director-beta.vercel.app/` returned the Visual Director project picker with HTTP 200 and `cache-control: no-store`. `/api/projects` and `/api/projects/bottom-of-thirst/overview` also returned the expected JSON contracts without Vercel sign-in.

The Vercel production deployment was `dpl_5sEddbu7MSDcD5PRU6VwvghSQG5n` at revision `f12d69dd11a902fac3b5b138c492d7d39d0994a9` on `main`, while GitHub `main` had already advanced to `030147b8de1f1a0160fb905e7229252b013dc82f`. That verified mismatch is the stale-deployment failure this workflow and smoke check are intended to prevent. After this change is merged, `/api/deployment` plus `npm run verify:review` is the authoritative verification path for the current production revision.
