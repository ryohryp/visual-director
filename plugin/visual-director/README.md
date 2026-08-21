# Visual Director Agent Plugin

`plugin/visual-director/` is the distributable Visual Director plugin package. It keeps the existing Codex-specific package metadata while adding an Agent Plugins 1.0 Portable Core.

## Portable Core

Agent Plugins 1.0 discovers portable components from fixed locations relative to this directory:

```text
plugin/visual-director/
├── plugin.json
├── mcp.json
├── skills/
│   └── visual-director/
│       └── SKILL.md
└── .codex-plugin/
    └── plugin.json
```

- `plugin.json` is the Agent Plugins 1.0 portable manifest. It contains portable metadata only; component paths are intentionally not declared there.
- `skills/visual-director/SKILL.md` is the existing Agent Skill and remains the single skill source for both portable and Codex-specific packaging.
- `mcp.json` declares the existing hosted Visual Director MCP as a `streamable-http` server at `https://visual-director-beta.vercel.app/mcp`.
- `.codex-plugin/plugin.json` remains the Codex-specific compatibility manifest. It is not merged into or replaced by the portable manifest.

The portable package is a distribution layer, not a security boundary. Credentials, approval, permissions, sandboxing, and audit remain responsibilities of the client/runtime and the MCP deployment. Do not add secrets to `plugin.json` or `mcp.json`.

## Validation

The repository test suite includes `test/agent-plugin-portable.test.ts`. It checks the published Agent Plugins 1.0 manifest/MCP schema constraints used by this package, the fixed skill discovery layout, and separation from the existing Codex manifest.

Run the focused test with:

```powershell
npm.cmd test -- agent-plugin-portable
```

Run the normal repository validation before merging:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

For client compatibility, load this directory as the plugin root. A conformant client should discover `skills/` and `mcp.json` without additional component-path metadata. Codex-specific installations may continue using `.codex-plugin/plugin.json`; the two manifests intentionally coexist.
