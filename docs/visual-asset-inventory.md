# Visual Asset Inventory

Visual Director derives a project-wide asset inventory from repository evidence. The game repository remains the source of truth; Visual Director does not copy the plan or asset state into a database.

## Required Asset Plan

Place the plan at:

```text
.visual-director/asset-plan.json
```

Start from [`asset-plan.example.json`](../asset-plan.example.json). Version 1 accepts only these top-level fields:

- `version`: must be `1`.
- `scan`: optional explicit image scan scope.
  - `roots`: repository-relative production image directories.
  - `ignore`: repository-relative `*`, `**`, and `?` glob rules.
- `assets`: Required Asset definitions.

Each asset declares:

- `asset_id`: stable logical ID using letters, numbers, dot, underscore, or hyphen.
- `asset_type`: project-defined visual asset type.
- `title` and `usage`: human-readable purpose.
- `production_path`: unique repository-relative production image path.
- `subject_ids`: zero or more project subject IDs.
- `required`: `true` for required assets and `false` for optional assets.
- `generation`: optional `aspect_ratio`, `request`, and `requirements` preparation hints.

The plan must not contain a manual status. Unknown fields, unsafe paths, duplicate IDs/production paths, unsupported versions, and invalid definitions fail closed with `ASSET_PLAN_INVALID`.

## Workflow association

`.visual-director/asset-index.json` remains lifecycle history. A workflow asset is associated with one Required Asset by explicit evidence, in this order:

1. `required_asset_id` on the workflow asset or its source Generation Job;
2. an exact workflow `asset_id` match;
3. an exact Registered `registered_path` / planned `production_path` match.

If those fields point to different Required Assets, reconciliation fails with `ASSET_INVENTORY_CONFLICT`. Visual Director does not guess from title, subject, asset type, or request text.

An active workflow asset whose explicit `required_asset_id` is no longer declared remains visible as a managed asset with `BROKEN` / `REQUIRED_ASSET_NOT_IN_PLAN`; the stale identifier is never ignored in favor of a coincidental path match.

Local `visual.generate_image` and candidate registration accept optional `required_asset_id`, and persist it to both the Generation Job and Candidate record. Existing workflow indexes without that field remain readable.

## Derived states

| State | Repository evidence |
|---|---|
| `MISSING` | Planned asset has no current Candidate or Registered asset and no production file. Optional missing assets remain visible but do not increment the required `missing` count. |
| `REVIEW_REQUIRED` | A matching Candidate or Approved-but-not-registered lifecycle record points to an existing Candidate file. |
| `READY` | A matching Registered record points to the planned production path and the regular file exists. |
| `BROKEN` | A lifecycle path is absent/mismatched, its file is missing, multiple current Registered records exist, or a planned production file exists without a matching Registered record. |
| `UNMANAGED` | An image inside an explicit scan root is not covered by the plan, Approved Anchors, Canon references, or workflow metadata. |
| `SUPERSEDED` | Unplanned workflow history is Rejected or Superseded and its recorded file integrity is intact. |

The Project Dashboard returns `required`, `ready`, `review_required`, `missing`, `broken`, and `unmanaged` counts from `ProjectVisualOverview.inventory.summary`. Readiness counters and their state filters cover required assets; optional and unplanned workflow items remain explicit in `All`, while `Unmanaged` has its own count and filter. The canonical Assets view uses the same Core read model for cards, filters, previews, problems, Required Asset definition, Generation Job fingerprint, reference lineage, and lifecycle history. The browser does not rescan or reinterpret the repository.

## Missing Asset generation preparation

A `kind: required`, `required: true`, `status: MISSING` asset can expose **Prepare Generation** in the canonical Assets view. The action is explicit; opening the page never starts generation automatically.

Preparation is deterministic and repository-owned:

1. Resolve the exact Required Asset by `asset_id` from the reconciled inventory.
2. Require `generation.request`; Visual Director does not invent a missing request from the title, usage, or conversation context.
3. Build the request from the plan's `asset_type`, `subject_ids`, `generation.aspect_ratio`, `generation.request`, and `generation.requirements`.
4. Pass that request through the existing `prepareGeneration()` Canon / Grand Design / Approved Anchor path.
5. Return the Generation Package, resolved references, policy, expected production path, and a generation input that can be handed to local/tunnel `visual.generate_image`.

Hosted web remains preparation-only. It does not create Candidate bytes, mutate `.visual-director/asset-index.json`, approve an image, or register a production asset. Local/tunnel `visual.generate_image` remains the write-capable generation boundary. When it succeeds with the prepared `required_asset_id`, the existing reconciliation changes that Required Asset from `MISSING` to `REVIEW_REQUIRED`; explicit human review is still required before registration.

Preparation is not offered for optional, `BROKEN`, `UNMANAGED`, `READY`, or already-reviewable assets. A non-terminal Generation Job for the same `required_asset_id` also blocks a second generation attempt even if a caller supplies a different job or asset ID. Failed or rejected attempts can be retried.

Subjectless Grand Design assets keep their existing fail-closed rules. If their asset contract requires source references that are not available in the preparation input, preparation fails with the existing reference error rather than guessing a source asset.

## Scan boundary

Unmanaged detection is disabled unless `scan.roots` is explicitly non-empty. Missing roots are empty scopes, while unreadable roots, symlinks/submodules, unsafe returned paths, or a GitHub directory at the Contents API limit fail closed. `.visual-director` cannot be a scan root.

Use narrow production roots and ignore documentation images, test fixtures, and build output. Required production paths, Approved Anchors, the Global Visual Canon reference, workflow Candidate/Registered/archived paths, and workflow reference paths are excluded from `UNMANAGED`.

## Compatibility and hosted mode

Projects without `.visual-director/asset-plan.json` return `inventory.plan.available = false`. Existing Canon, Approved Anchor, and workflow views continue to work, and the Assets page explicitly falls back to workflow history without inventing required assets.

Hosted mode performs the same repository reads and reconciliation but remains read-only. Required Asset generation preparation is read-only as well; Candidate generation, review mutations, and repository writes remain outside Hosted Visual Director.
