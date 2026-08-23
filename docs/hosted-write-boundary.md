# Hosted repository write boundary

Status: one reviewed exception exists for explicit Approved Anchor adoption. All other hosted repository mutations remain disabled.

This document defines the security and consistency boundary for hosted mutation. The ordinary hosted Canon path remains read-only.

## Current state

```text
ChatGPT / Browser
  -> Hosted Visual Director
  -> read path: VISUAL_DIRECTOR_GITHUB_TOKEN (Contents: Read-only)
  -> reviewed Anchor path only: VISUAL_DIRECTOR_GITHUB_WRITE_TOKEN
  -> configured game repository / configured ref
```

The existing `VISUAL_DIRECTOR_GITHUB_TOKEN` is a read credential. It must remain **Contents: Read-only**.

`visual.adopt_anchor` now has a narrow hosted adapter path for one explicitly approved character Anchor. Candidate lifecycle mutations, image-generation persistence, generic Canon editing, and arbitrary repository writes continue to return `HOSTED_WRITE_DISABLED` or remain unexposed.

## Approved Anchor exception

The hosted Anchor path is allowed only when all of the following are true:

1. `approval` is exactly `approve`.
2. `candidate_path` identifies an Approved Candidate manifest in the configured repository.
3. `candidate_file` supplies the exact approved host file.
4. The manifest status is `approved_candidate` and its project/subject match the request.
5. The downloaded file matches the manifest SHA-256, dimensions, and MIME type.
6. The manifest `source.path` already exists in the configured repository.
7. The requested subject exists in the repository project manifest.
8. Canon either already contains the exact same Approved Anchor path or has no conflicting Approved Anchor.

The request cannot choose a GitHub owner/repository, Git ref, Character Canon path, compiled Canon path, or arbitrary write path. Those values come from the server-side project catalog and repository manifest.

If Canon is already in the approved state, the operation is idempotent and returns `changed: false` without using a write credential. This is the expected path when the reviewed repository change was merged before hosted adoption is called.

If persistence is required, the only files written are:

```text
<configured Character Canon document>
.visual-director/compiled-canon.json
```

Both files are generated from the same verified repository state and become visible together through one Git commit.

## Credential model

Read and write credentials are deliberately separate:

- `VISUAL_DIRECTOR_GITHUB_TOKEN` — repository-scoped **Contents: Read-only** credential for normal hosted Canon resolution.
- `VISUAL_DIRECTOR_GITHUB_WRITE_TOKEN` — separately reviewed credential used only when an Approved Anchor binding actually needs to be committed.

Do not broaden or reuse the read credential for mutation.

Preferred production credential is a dedicated GitHub App installation credential or equivalent short-lived repository-scoped credential. A broad personal access token is not an acceptable production default.

The write credential must never be returned in MCP/API/UI output, logs, traces, exceptions, workflow metadata, or commits.

If the write credential is absent and Canon needs a change, return `HOSTED_ANCHOR_WRITE_UNAVAILABLE`. That error means validation succeeded but the deployment cannot persist the binding; it must not imply that the Candidate, source file, or manifest is invalid.

## Authorization boundary

A write credential must not be configured on an anonymously writable or otherwise untrusted hosted endpoint.

The MCP connection/deployment must provide a reviewed access boundary appropriate to the deployment before enabling actual repository mutation. Explicit `approval: "approve"` is a required domain action, but it is not a substitute for deployment access control.

This restriction does not affect the idempotent `changed: false` path because that path performs no repository mutation and does not use the write credential.

## Optimistic concurrency

Hosted Anchor commits use the configured branch head as the expected parent:

1. read the configured branch ref;
2. read its base tree;
3. construct blobs for Character Canon and compiled Canon;
4. construct one tree and one commit whose parent is the previously read branch head;
5. advance the configured ref with `force: false`.

If another actor advances the branch before step 5, the proposed commit is no longer a fast-forward and GitHub rejects the ref update. The operation fails rather than silently replaying approval against a newer repository state.

Do not silently retry state-changing approval against a newer repository revision.

## Atomicity

The Anchor binding and compiled Canon must not be updated through independent Contents API writes. The reviewed implementation creates one Git commit containing both files and advances the branch ref only after the complete tree exists.

No successful hosted adoption may leave:

- Character Canon updated while compiled Canon is stale;
- compiled Canon claiming an Anchor not present in Character Canon;
- unrelated repository files changed by the adoption request.

## Path and scope controls

The hosted Anchor adapter rejects:

- `..` path traversal;
- absolute or drive-qualified source paths;
- cross-project / cross-subject manifests;
- request-selected repository or Git ref;
- a conflicting existing Approved Anchor;
- writes outside the configured Character Canon and compiled Canon paths.

The internal GitHub writer also rejects unsafe repository-relative write paths. It is not exposed as a generic MCP tool.

## Error taxonomy

Expected hosted Anchor errors include:

- `HOSTED_ANCHOR_ADOPTION_INPUT_REQUIRED` — hosted adoption did not receive both manifest and exact source file.
- `APPROVAL_REQUIRED` — explicit approval is missing.
- `APPROVED_ANCHOR_SCOPE_MISMATCH` — manifest project/subject does not match the request.
- `APPROVED_SOURCE_SHA_MISMATCH` / dimension or manifest validation errors — exact source verification failed.
- `APPROVED_ANCHOR_CONFLICT` — another Approved Anchor is already registered for the subject.
- `HOSTED_ANCHOR_WRITE_UNAVAILABLE` — validation succeeded but write capability is not configured.
- `HOSTED_ANCHOR_WRITE_FAILED` — GitHub rejected or failed the reviewed commit operation.
- `UNSAFE_REPOSITORY_PATH` — a path escapes the repository-safe boundary.
- `HOSTED_WRITE_DISABLED` — unrelated hosted workflow mutation remains disabled.

Errors must not include credentials or raw sensitive GitHub response payloads.

## What remains disabled

This exception does **not** enable:

- Candidate registration from hosted generation;
- Candidate rejection / supersession workflows;
- production image upload or promotion;
- arbitrary Canon edits;
- generic repository file writes;
- CI/workflow, source-code, configuration, or secret changes;
- cross-repository mutation selected by request data;
- a persistent database or workflow engine.

Those operations require their own separately reviewed design and authorization boundary.

## Verification requirements

Changes to this exception must keep tests for:

- exact SHA/dimension source validation;
- project/subject scope mismatch;
- idempotent already-bound adoption;
- missing write capability reported separately from validation failure;
- only Character Canon + compiled Canon included in the commit;
- non-forced branch advancement from the expected head;
- credential redaction from safe failures;
- ordinary hosted Core and unrelated workflow writes remaining read-only.
