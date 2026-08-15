# Hosted repository write boundary

Status: design only. Hosted write access remains disabled.

This document defines the security and consistency boundary that must be satisfied before Visual Director may mutate a game repository from hosted mode.

## Current state

Hosted Visual Director is intentionally read-only.

```text
ChatGPT / Browser
  -> Hosted Visual Director
  -> VisualDirectorCore
  -> GitHub Contents API
  -> Canon / Approved Anchors / workflow metadata
```

The existing `VISUAL_DIRECTOR_GITHUB_TOKEN` is a read credential. It must remain **Contents: Read-only** and must not be broadened to make candidate review or image registration work.

`visual.adopt_anchor`, Candidate lifecycle mutations, and hosted image-generation persistence continue to return `HOSTED_WRITE_DISABLED` until a separate write implementation is reviewed and explicitly enabled.

## Design principles

1. **Separate read and write credentials.** A compromise of the ordinary hosted read path must not automatically grant repository mutation rights.
2. **Repository remains authoritative.** Hosted state changes commit to the configured game repository; Visual Director does not introduce a second authoritative database.
3. **Least privilege.** Write access is limited to one configured repository and an explicit path allowlist.
4. **Explicit human approval.** AI generation may create Candidate state, but promotion to Approved/Registered remains an explicit human action.
5. **Fail closed.** Ambiguous repository state, stale revisions, missing source objects, or authorization failures must abort without partial promotion.
6. **Auditable mutations.** Every hosted write records the actor/request context and source Generation Job metadata without storing secrets.

## Credential model

Preferred implementation: a dedicated GitHub App installation credential or equivalent short-lived repository-scoped credential.

The write credential must be distinct from `VISUAL_DIRECTOR_GITHUB_TOKEN` and must satisfy all of the following:

- installation/repository scope restricted to the configured game repository;
- only the minimum Contents permission required for the reviewed operations;
- no organization administration, Actions, Secrets, Members, or repository administration permission;
- short-lived credentials when the platform supports them;
- loaded only in the server-side runtime;
- never returned in MCP/API/UI output, logs, traces, exceptions, workflow metadata, or commits.

A broad personal access token is not an acceptable production default.

## Allowed write surface

The first hosted write implementation may modify only these logical areas:

```text
.visual-director/asset-index.json
.visual-director/candidates/**
.visual-director/rejected/**
.visual-director/superseded/**
public/images/**               # only during explicit Approved/Registered promotion
```

Additional production asset roots must be added explicitly per project configuration. A user-supplied arbitrary repository path is not sufficient authorization.

The hosted service must reject:

- `..` path traversal;
- absolute paths or drive-qualified paths;
- writes outside the configured repository;
- arbitrary branch/ref selection from request input;
- writes to Canon documents unless a future separately reviewed feature requires them;
- writes to CI/workflow files, repository configuration, secrets, source code, or unrelated assets;
- cross-repository writes.

## Mutation operations

The initial hosted write API should expose narrow domain operations rather than a generic repository writer.

### Register Candidate

Inputs are limited to a known Generation Job, generated image bytes/object, subject/asset metadata, and the expected repository revision.

Effects:

1. store the generated output under `.visual-director/candidates/<job>/<asset>.<ext>`;
2. update `.visual-director/asset-index.json` with Candidate and source-job metadata;
3. never modify a production path;
4. never mark the asset Approved or Registered.

### Reject Candidate

Effects:

1. mark the Candidate Rejected in workflow metadata;
2. optionally move its candidate object into `.visual-director/rejected/**` if that behavior is implemented consistently;
3. never touch production assets.

### Approve and Register Candidate

This is the highest-risk operation and requires explicit human approval.

Effects:

1. verify the Candidate and workflow record still match the reviewed state;
2. verify the target production path is allowed;
3. if an existing production asset is Visual Director-managed, archive it under `.visual-director/superseded/**` and mark it Superseded;
4. promote the approved Candidate to the production path;
5. update workflow metadata to Registered with source-job and supersession lineage.

An unmanaged existing production file must cause a conflict rather than being overwritten.

## Authorization boundary

Hosted write endpoints must not be anonymous mutation endpoints.

Before enabling them, the deployment must have a reviewed way to bind a mutation request to an authorized user/session. The authorization check must occur server-side before the write credential is used.

At minimum:

- read-only GET/dashboard endpoints remain non-mutating;
- mutations use POST or another explicit non-GET method;
- approval/register operations require an explicit approval action, not an inferred state transition;
- request data cannot select a different repository or Git ref than the server-side project mapping;
- CSRF/replay protections appropriate to the chosen authentication mechanism are required for browser-originated mutations.

Until this authorization mechanism exists, Hosted write remains disabled even if a write credential is technically available.

## Optimistic concurrency

Hosted GitHub writes must use repository revision checks rather than last-write-wins behavior.

Each mutation reads and records the SHA/revision of the relevant workflow index and files. The write succeeds only if those expected revisions still match.

If another actor changes the workflow index, Candidate, or production asset between review and mutation, return a conflict and require the user to reload/review the current state.

Do not silently retry a state-changing approval against a newer repository state.

## Atomicity and rollback

Git does not provide a multi-file transactional Contents API operation equivalent to a database transaction. The hosted implementation therefore needs an explicit commit strategy.

Preferred approach: construct all required blobs/tree changes and create **one Git commit** that atomically points the branch to the complete mutation, using the expected branch head as the parent. Advance the configured branch ref only if the expected head still matches.

This provides a stronger boundary than sequential Contents API writes because the production asset, archive object, and `asset-index.json` become visible together in one commit.

If implementation initially uses a different GitHub API path, it must provide equivalent all-or-nothing visibility or remain disabled for Approved/Registered promotion.

No partial commit should leave:

- production image changed but metadata stale;
- metadata marked Registered while the production image is absent;
- an old production image removed without a traceable superseded copy.

## Audit metadata

Each hosted mutation should record non-secret audit fields, for example:

```json
{
  "mutation_id": "...",
  "operation": "approve_and_register",
  "project_id": "bottom-of-thirst",
  "asset_id": "...",
  "source_job_id": "...",
  "generation_package_fingerprint": "...",
  "requested_by": "stable-authorized-user-id",
  "requested_at": "ISO-8601",
  "repository_head_before": "git-sha",
  "repository_head_after": "git-sha"
}
```

Do not record bearer tokens, session secrets, raw authorization headers, or unnecessary personal data.

The Git commit message should identify the Visual Director operation and stable asset/job IDs, not embed prompts or credentials.

## Error taxonomy

Hosted mutation failures should remain explicit and machine-readable. Expected categories include:

- `HOSTED_WRITE_DISABLED` — feature not enabled;
- `HOSTED_WRITE_UNAUTHORIZED` — caller is not authorized for mutation;
- `HOSTED_WRITE_CONFIG_INVALID` — write credential/project mapping is incomplete;
- `REPOSITORY_REVISION_CONFLICT` — repository changed after review;
- `UNSAFE_REPOSITORY_PATH` — requested path is outside the allowlist;
- `PRODUCTION_ASSET_CONFLICT` — unmanaged object exists at the production path;
- `WORKFLOW_INDEX_INVALID` — repository workflow metadata is inconsistent;
- `HOSTED_WRITE_FAILED` — GitHub mutation failed without a more specific safe category.

Errors must not include credentials or raw sensitive GitHub response payloads.

## Enablement gates

Hosted writes must remain off until all of these are true:

- [ ] dedicated least-privilege write credential exists;
- [ ] server-side user authorization for mutations exists;
- [ ] repository/project/ref are server-configured, not request-selected;
- [ ] path allowlist is enforced;
- [ ] optimistic concurrency is enforced against expected Git revisions;
- [ ] one-commit/all-or-nothing promotion strategy is implemented;
- [ ] Candidate registration cannot auto-approve;
- [ ] Approved/Registered promotion requires explicit human action;
- [ ] superseded production history is preserved;
- [ ] audit metadata is persisted without secrets;
- [ ] tests cover unauthorized writes, traversal, stale revisions, unmanaged production conflicts, rollback/atomicity, and credential redaction;
- [ ] existing read-only hosted behavior remains unchanged when write configuration is absent.

## Non-goals for this design

This document does not:

- enable Hosted write access;
- change the permissions of `VISUAL_DIRECTOR_GITHUB_TOKEN`;
- add a database, object store, queue, or generalized workflow engine;
- authorize Canon editing;
- make AI-generated output automatically Approved;
- expose a generic Git repository editing API.
