# Hosted Visual Director deployment

Hosted mode removes the local Secure MCP Tunnel and local project checkout from the ChatGPT execution path.

```text
ChatGPT
  -> HTTPS /mcp
  -> Visual Director Core
  -> GitHub contents API (read-only)
  -> project Canon + Approved Anchors
```

## Security boundary

Hosted `visual.prepare_generation` reads Canon and checks Approved Anchor objects through GitHub. It does not receive repository write permission.

`visual.adopt_anchor`, Candidate lifecycle mutations, and hosted generation persistence are deliberately disabled and return `HOSTED_WRITE_DISABLED`. Do not broaden the existing read credential to enable them.

The reviewed prerequisites for any future hosted mutation path are defined in [`hosted-write-boundary.md`](./hosted-write-boundary.md). That document is an enablement gate, not an instruction to turn writes on.

Never expose the GitHub token in source control, MCP output, logs, prompt packages, or error details.

## Required environment variables

Set this as a secret in the deployment environment:

- `VISUAL_DIRECTOR_GITHUB_TOKEN` — a fine-grained GitHub credential restricted to the required private repository with **Contents: Read-only** access.

Optional configuration:

- `VISUAL_DIRECTOR_BOTTOM_OF_THIRST_GITHUB_REPO` — defaults to `ryohryp/---The-Bottom-of-Thirst`.
- `VISUAL_DIRECTOR_BOTTOM_OF_THIRST_GITHUB_REF` — defaults to `main`.

Do not set `BOTTOM_OF_THIRST_REPO_PATH` in hosted production. That variable is for local compatibility only.

## Automated Vercel setup

The hosted runtime needs a GitHub bearer credential because the application reads Canon and Approved Anchor files through the GitHub Contents API. The Vercel-GitHub deployment connection alone is not used as an application credential.

Use a fine-grained GitHub credential scoped only to `ryohryp/---The-Bottom-of-Thirst` with **Contents: Read-only** access. Keep it in the current PowerShell process only; do not put it in a file, command-line argument, commit, or log.

From this repository, set a Vercel CLI token and the GitHub credential in the process environment, then run:

```powershell
$env:VERCEL_TOKEN = '<Vercel CLI token>'
$env:VISUAL_DIRECTOR_GITHUB_TOKEN = '<fine-grained GitHub credential>'
powershell -ExecutionPolicy Bypass -File scripts/configure-hosted-vercel.ps1
```

The script validates that the credential can read the target Canon file, links the `visual-director` project in the `ryohryps-projects` scope, adds or updates only the production `VISUAL_DIRECTOR_GITHUB_TOKEN` secret, and redeploys the current production deployment once. It suppresses CLI output and never prints the secret value.

If GitHub CLI is already authenticated with a credential that has only the required repository read access, the token may be obtained without placing it in the shell history:

```powershell
$env:VERCEL_TOKEN = '<Vercel CLI token>'
powershell -ExecutionPolicy Bypass -File scripts/configure-hosted-vercel.ps1 -UseGitHubCliToken
```

Do not use `-UseGitHubCliToken` with a broad personal token. If no suitable credential already exists, creating the fine-grained credential remains the one-time human step; the script handles the Vercel configuration and deployment afterward.

## Vercel runtime

When `VERCEL=1`, `src/index.ts` starts the hosted HTTP server on `PORT` and binds to `0.0.0.0`.

Hosted HTTP is intentionally stateless at the MCP transport layer: each POST receives a fresh `McpServer` and `StreamableHTTPServerTransport` with no server-generated MCP session id. This avoids depending on process-local session maps across serverless instances.

Endpoints:

- `POST /mcp` — stateless Streamable HTTP MCP endpoint.
- `GET /health` — lightweight service health check. It does not read Canon or validate GitHub credentials.

A Canon/authentication check belongs in a real `visual.prepare_generation` request so that failures remain explicit and fail closed.

## Deployment verification

After deploying and configuring the GitHub read-only secret:

1. `GET /health` returns HTTP 200 and `mode: hosted-read-only`.
2. Add the production `/mcp` URL to ChatGPT as the Visual Director remote MCP connection.
3. Run the redacted, fail-closed verifier. It checks `/health`, MCP initialize, `tools/list`, and the exact `visual.prepare_generation` result without printing response payloads or credentials:

```powershell
npm.cmd run verify:hosted -- https://visual-director-beta.vercel.app/mcp
```

For a local HTTP server only, set `VISUAL_DIRECTOR_ALLOW_INSECURE_HTTP=1` for that process. The verifier still requires `/mcp`, and it never sends a repository path in the hosted request.

The underlying request is:

```text
project_id: bottom-of-thirst
asset_type: character_visual_anchor
subject_ids: [kamino_kyosuke]
request_text: 神野恭介のApproved Visual Anchorを正本としてGeneration Packageを取得する。画像生成は行わない。
```

The successful Generation Package must contain:

```text
reference_assets:
  role: subject_anchor
  subject_id: kamino_kyosuke
  path: public/images/characters/kamino_kyosuke/v2/default.avif

policy.must_use_approved_anchor = true
```

If the GitHub credential is missing, unauthorized, the Canon document is missing, or the Anchor object is absent, do not fall back to conversation memory or a legacy image. Fix the deployment or Canon and retry.
