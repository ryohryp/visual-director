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

`visual.adopt_anchor` is deliberately disabled when hosted GitHub mode is active and returns `HOSTED_WRITE_DISABLED`. Anchor adoption must remain on a separately reviewed write path.

Never expose the GitHub token in source control, MCP output, logs, prompt packages, or error details.

## Required environment variables

Set this as a secret in the deployment environment:

- `VISUAL_DIRECTOR_GITHUB_TOKEN` — a fine-grained GitHub credential restricted to the required private repository with **Contents: Read-only** access.

Optional configuration:

- `VISUAL_DIRECTOR_BOTTOM_OF_THIRST_GITHUB_REPO` — defaults to `ryohryp/---The-Bottom-of-Thirst`.
- `VISUAL_DIRECTOR_BOTTOM_OF_THIRST_GITHUB_REF` — defaults to `main`.

Do not set `BOTTOM_OF_THIRST_REPO_PATH` in hosted production. That variable is for local compatibility only.

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
3. Run the real E2E request:

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
