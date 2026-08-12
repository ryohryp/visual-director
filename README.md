# Visual Director MCP

Visual Director MCP v0.1 is a small, fail-closed MCP server for preparing image-generation context from a game's Visual Canon. It does not generate images, call the OpenAI Image API, mutate a game repository, or manage candidates and reviews.

The bundled project adapter is `bottom-of-thirst`, targeting `ryohryp/---The-Bottom-of-Thirst`. Additional games can be registered through a local JSON project config without changing the MCP tool contract.

## What v0.1 does

`visual.prepare_generation` reads the configured project's authoritative documents and returns a Generation Package with these separate sections:

- Global Style
- Character Identity and Approved Anchor
- Scene Requirements
- Allowed Changes
- Forbidden Changes
- Reference Assets
- Generation Policy

The adapter resolves Approved Anchor paths from `CHARACTER_VISUAL_CANON.md`. It verifies the Global Visual Style, World Direction, character facts, visual reference asset manifest, approved anchor files, and global reference asset before returning. Unknown projects, unknown subjects, missing documents, missing anchors, and incomplete style locks return explicit errors. No legacy or candidate asset is used as a fallback.

## Architecture

```text
MCP client / Inspector
        |
        v
visual.prepare_generation
        |
        v
project adapter registry
        |
        v
BottomOfThirstAdapter
        |
        +-- docs/WORLD_DIRECTION.md
        +-- docs/visual/GLOBAL_VISUAL_STYLE.md
        +-- docs/visual/CHARACTER_VISUAL_CANON.md
        +-- docs/characters/*.md
        +-- docs/visual/assets/global_visual_style_reference.webp
        +-- public/images/characters/*/v2/* approved anchor
```

The adapter boundary is intentional: the bundled project keeps its existing adapter, while additional Canon-compatible games are loaded through `projects.json` and the generic Canon adapter. Each project has its own repository path, document paths, labels, and subject definitions.

## Setup

Requires Node.js 20 or later.

```powershell
npm.cmd install
$env:BOTTOM_OF_THIRST_REPO_PATH = 'C:\path\to\---The-Bottom-of-Thirst'
```

The repository path may also be supplied with `--repo-path`. Keep it out of source control and do not put credentials in it.

To use multiple games, copy [projects.example.json](projects.example.json), edit the project definitions, and start with:

```powershell
$env:VISUAL_DIRECTOR_PROJECTS_CONFIG = 'C:\path\to\projects.json'
npm.cmd run dev -- --http --host 127.0.0.1 --port 3000
```

The config file is local-only and should not be committed when it contains machine-specific paths. `repo_path` is resolved relative to the config file. The bundled `bottom-of-thirst` project remains available through `BOTTOM_OF_THIRST_REPO_PATH`.

## Start locally

Stdio is the default transport for MCP clients that spawn a local server:

```powershell
npm.cmd run dev
```

For a local Streamable HTTP endpoint:

```powershell
npm.cmd run dev -- --http --host 127.0.0.1 --port 3000
```

The endpoint is `http://127.0.0.1:3000/mcp`. The HTTP server binds to loopback by default. It uses stateful Streamable HTTP sessions and does not expose the project path or source documents until a valid tool call is made.

## Connect from ChatGPT

For local ChatGPT use, keep the server on loopback and connect it through a Secure MCP Tunnel. The connection guide covers the tunnel, Developer mode, verification prompt, and the boundary between local testing and public deployment: [docs/chatgpt-connection.md](docs/chatgpt-connection.md).

The MCP server advertises read-only, idempotent tool metadata and a structured Generation Package output so ChatGPT can select `visual.prepare_generation` and consume its result reliably. The tool still prepares context only; it does not generate images or call an image API.

## Example tool input

```json
{
  "project_id": "bottom-of-thirst",
  "asset_type": "event_cg",
  "subject_ids": ["souma"],
  "request_text": "地下の記録保管庫で古い記録を確認しているイベントCG",
  "scene_context": {
    "location": "地下の記録保管庫",
    "story_state": "present_day_investigation"
  }
}
```

The returned `reference_assets` contains the global style reference and the subject's Approved Anchor, for example:

```json
[
  { "role": "global_reference", "path": "docs/visual/assets/global_visual_style_reference.webp" },
  { "role": "subject_anchor", "subject_id": "souma", "path": "public/images/characters/souma/v2/default.avif" }
]
```

The paths are repository-relative so the calling model can resolve them against the configured project checkout. Visual Director does not pass the image bytes to the model.

## MCP Inspector

Build first if using the compiled server:

```powershell
npm.cmd run build
$env:BOTTOM_OF_THIRST_REPO_PATH = 'C:\path\to\---The-Bottom-of-Thirst'
npx.cmd @modelcontextprotocol/inspector node dist/index.js
```

With a multi-project config:

```powershell
npm.cmd run build
npx.cmd @modelcontextprotocol/inspector node dist/index.js --projects-config C:\path\to\projects.json
```

For HTTP inspection, start the HTTP server in one terminal and point MCP Inspector at `http://127.0.0.1:3000/mcp` in another. The inspector should show exactly one tool: `visual.prepare_generation`.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd test
```

The tests cover Generation Package separation, Canon-derived anchor resolution, contiguous approved-anchor parsing, explicit unknown-subject errors, missing-anchor/manifest errors, MCP tool discovery, and MCP protocol invocation.

## Intentionally out of scope for v0.1

Image generation, Web UI, database storage, asset registration, candidate approval/rejection, Visual QA automation, LoRA, ControlNet, vector search, multi-model orchestration, and automatic writes to a game repository are future work.
