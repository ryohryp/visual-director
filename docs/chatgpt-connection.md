# Connect Visual Director to ChatGPT

Visual Director exposes a read-only Streamable HTTP MCP endpoint. The recommended first connection is a Secure MCP Tunnel: ChatGPT can call the server while the game repository remains on the local Windows machine.

Visual Director v0.1 prepares a Canon-backed Generation Package. It does not generate an image or call an image API. After the tool returns successfully, ChatGPT can use the package as context for its image-generation capability.

The bundled connection targets `bottom-of-thirst`, but the same Tunnel and ChatGPT connection can serve additional games loaded from a local `projects.json`. Only the `project_id` and project-specific subject data change.

## Prerequisites

- Node.js 20 or later
- A local checkout of `ryohryp/---The-Bottom-of-Thirst`
- ChatGPT Developer mode, if enabled for the account or workspace
- An OpenAI Platform tunnel and the permissions required to create and use it

OpenAI's current tunnel documentation describes the required `tunnel_id`, runtime API key, and `tunnel-client` setup: [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

## Start the local MCP server

In the Visual Director repository:

```powershell
$env:BOTTOM_OF_THIRST_REPO_PATH = 'C:\path\to\---The-Bottom-of-Thirst'
npm.cmd run dev -- --http --host 127.0.0.1 --port 3000
```

The local MCP endpoint is:

```text
http://127.0.0.1:3000/mcp
```

For multiple games, set `VISUAL_DIRECTOR_PROJECTS_CONFIG` or pass `--projects-config`:

```powershell
$env:VISUAL_DIRECTOR_PROJECTS_CONFIG = 'C:\path\to\projects.json'
npm.cmd run dev -- --http --host 127.0.0.1 --port 3000
```

Use [projects.example.json](../projects.example.json) as the starting point. The config's `repo_path` values are resolved relative to the config file and should remain local-only.

Keep the server bound to `127.0.0.1` for tunnel-based development. The tunnel client must be able to reach this endpoint from the same machine or network.

## Create the ChatGPT connection

1. Create or select a tunnel in OpenAI Platform tunnel settings.
2. Run `tunnel-client` with that tunnel's identity and runtime API key. Follow the current command and credential handling instructions in the official tunnel guide; never commit or print the runtime key.
3. In ChatGPT, open **Settings → Security and login** and enable **Developer mode** when available.
4. Open **Plugins** or the **+** connection control, choose the Tunnel connection method, and select the Visual Director tunnel.
5. Start a new conversation, open the tools menu, and add the Visual Director connection.

The official connection guide requires either a public HTTPS MCP endpoint or Secure MCP Tunnel and describes the current Developer mode flow: [Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt). Account and workspace policy can affect whether Developer mode is available.

## Verification prompt

Use a prompt that names the desired outcome and leaves the tool arguments explicit:

```text
Visual Directorを使って、次の画像生成パッケージを作成してください。
- project_id: bottom-of-thirst
- asset_type: event_cg
- subject_ids: [souma]
- request_text: 現場検証中のイベントCG。Canonの制約を維持する。
- scene_context: { location: 現場, story_state: present_day_investigation }

生成パッケージのエラーや不足は補完せずに報告してください。成功した場合だけ、その結果を確認してから画像生成に進めてください。
```

The ChatGPT connection should discover exactly one tool: `visual.prepare_generation`. A successful result includes `structuredContent` and repository-relative reference paths. An unknown project, subject, document, or approved anchor must remain an explicit error; the server must not return a fallback package.

## Public deployment boundary

Do not expose the current local server directly to the public internet. It is designed for a configured local repository path and has no OAuth authorization server. A permanent shared deployment needs a stable HTTPS `/mcp` endpoint, a hosted read-only project checkout or repository adapter, and the MCP OAuth 2.1 authorization flow described in [Authentication](https://developers.openai.com/plugins/build/auth).
