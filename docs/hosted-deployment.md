# Hosted Visual Director deployment

Hosted mode removes the local Secure MCP Tunnel and local project checkout from the ChatGPT execution path.

```text
ChatGPT
  -> HTTPS /mcp
  -> Visual Director
  -> GitHub contents API (read-only Canon resolution)
  -> project Canon + Approved Anchors
```

The service remains read-only for generation and Candidate workflow operations. The only reviewed hosted repository mutation is explicit Approved Anchor adoption through `visual.adopt_anchor`.

## Security boundary

`visual.prepare_generation` reads Canon and checks Approved Anchor objects through GitHub. Its ordinary credential remains read-only.

The following hosted operations remain disabled with `HOSTED_WRITE_DISABLED`:

- image generation persistence
- Candidate registration
- Candidate review / promotion
- arbitrary repository writes

Hosted `visual.adopt_anchor` is a narrow exception with a separate validation and credential boundary. It requires:

- `approval: "approve"`
- the repository-relative Approved Candidate manifest in `candidate_path`
- the exact approved host file in `candidate_file`
- manifest status `approved_candidate`
- matching `project_id` and `subject_id`
- matching SHA-256, dimensions, and MIME type
- an existing repository source asset at the manifest `source.path`

If Character Canon already contains that exact Approved Anchor path, adoption succeeds idempotently with `changed: false` and does not require a write credential.

If Canon must change, only the configured project's Character Canon and `.visual-director/compiled-canon.json` are written. They are committed together in one Git commit against the configured catalog repository/ref. Request input cannot choose a repository, branch, Canon path, or compiled Canon path.

Never broaden `VISUAL_DIRECTOR_GITHUB_TOKEN` for this purpose. Never expose either GitHub token in source control, MCP output, logs, prompt packages, or error details.

## Required environment variables

Set this as a secret in the deployment environment:

- `VISUAL_DIRECTOR_GITHUB_TOKEN` — fine-grained GitHub credential restricted to the required private repositories with **Contents: Read-only** access.

Only deployments that must persist a newly reviewed Approved Anchor also require:

- `VISUAL_DIRECTOR_GITHUB_WRITE_TOKEN` — separate repository-scoped credential with the minimum **Contents: Read and write** permission required to create the reviewed Anchor adoption commit.

Do not reuse or broaden the read token. Prefer a dedicated GitHub App installation credential or another short-lived repository-scoped credential over a broad personal token.

When the write credential is absent and a repository mutation is actually required, Visual Director returns `HOSTED_ANCHOR_WRITE_UNAVAILABLE` after validation. This is a deployment capability failure, not an invalid Candidate/manifest result.

Optional configuration:

- `VISUAL_DIRECTOR_BOTTOM_OF_THIRST_GITHUB_REPO` — defaults to `ryohryp/---The-Bottom-of-Thirst`.
- `VISUAL_DIRECTOR_BOTTOM_OF_THIRST_GITHUB_REF` — defaults to `main`.

Do not set `BOTTOM_OF_THIRST_REPO_PATH` in hosted production. That variable is for local compatibility only.

## Approved Anchor request

Hosted adoption uses both the Approved Candidate manifest and exact approved host file:

```json
{
  "project_id": "crownless",
  "subject_id": "player-unarmed",
  "candidate_path": "docs/assets/player-unarmed-approved-anchor-v0.3.json",
  "candidate_file": {
    "download_url": "https://files.example/...",
    "file_id": "file_...",
    "mime_type": "image/png",
    "file_name": "player-unarmed-approved-anchor-v0.3.png"
  },
  "approval": "approve"
}
```

A successful response is explicit:

```text
status = approved
approved_anchor_path = <manifest source.path>
changed = false | true
sha256 / width / height = verified source bytes
```

`changed: false` means the repository was already in the reviewed state. `changed: true` means the Character Canon and deterministic compiled Canon were committed together.

## Vercel runtime

When `VERCEL=1`, `src/index.ts` starts the hosted HTTP server on `PORT` and binds to `0.0.0.0`.

Hosted HTTP is intentionally stateless at the MCP transport layer: each POST receives a fresh `McpServer` and `StreamableHTTPServerTransport` with no server-generated MCP session id. Repository Canon therefore remains the durable source of truth; adoption does not rely on server memory.

Endpoints:

- `POST /mcp` — stateless Streamable HTTP MCP endpoint.
- `GET /health` — lightweight service health check. It does not read Canon or validate GitHub credentials.

A Canon/authentication check belongs in a real `visual.prepare_generation` request so that failures remain explicit and fail closed.

## Read-only credential setup

The existing setup script configures the ordinary read credential. Keep using a fine-grained credential with only the repository read access required by the project catalog.

```powershell
$env:VERCEL_TOKEN = '<Vercel CLI token>'
$env:VISUAL_DIRECTOR_GITHUB_TOKEN = '<fine-grained read credential>'
powershell -ExecutionPolicy Bypass -File scripts/configure-hosted-vercel.ps1
```

The script validates read access, updates only the production `VISUAL_DIRECTOR_GITHUB_TOKEN`, and redeploys. It does not configure the separate Anchor write credential.

Do not place write credentials in shell history, repository files, Issue/PR text, or logs.

## Deployment verification

After deploying and configuring the GitHub read-only secret:

1. `GET /health` returns HTTP 200.
2. Add the production `/mcp` URL to ChatGPT as the Visual Director remote MCP connection.
3. Run the redacted fail-closed verifier:

```powershell
npm.cmd run verify:hosted -- https://visual-director-beta.vercel.app/mcp
```

The verifier checks `/health`, MCP initialize, `tools/list`, and the exact `visual.prepare_generation` result without printing response payloads or credentials.

For `bottom-of-thirst`, the successful Generation Package must continue to resolve the configured Approved Anchor and `policy.must_use_approved_anchor = true`.

For hosted Anchor adoption, first test an already-bound reviewed Anchor. That path must return `status: approved` and `changed: false` without a write credential. Configure the dedicated write credential only when the deployment is intentionally allowed to persist a new reviewed binding.

If a GitHub credential is missing, unauthorized, the Canon document is missing, or the Anchor object is absent, do not fall back to conversation memory or a legacy image. Fix the deployment or Canon and retry.
