# Visual Director

Visual Director v0.2 は、ゲームの Visual Canon と Approved Visual Anchor を読み取り、画像生成前に fail-closed な Generation Package を作るためのツールです。

画像そのものは生成しません。OpenAI Image API も呼びません。Visual Director の役割は、画像生成モデルへ渡す前に「誰を、どの見た目で、何を変えてよく、何を変えてはいけないか」を Canon から機械的に解決し、勝手な再解釈や legacy asset への暗黙 fallback を防ぐことです。

## v0.2 の設計方針

v0.1 では MCP session、runtime repository binding、Canon 解決、Generation Package 構築が一つの経路に密結合していました。v0.2 では責務を分離し、MCP は Visual Director 本体ではなく薄い adapter として扱います。

```text
Game Repository
  ├─ Visual Canon
  ├─ Character Canon
  ├─ Approved Visual Anchors
  └─ Global Visual Style
          |
          v
Visual Director Core
  ├─ repository resolution
  ├─ Canon validation
  ├─ subject / anchor resolution
  └─ Generation Package builder
          |
          +--------------------+
          |                    |
          v                    v
      Unit Test / CLI      MCP Adapter
                               |
                               v
                            ChatGPT
```

Core は `@modelcontextprotocol/sdk` に依存しません。MCP transport や session が切れても、それは Canon validation failure ではなく接続層の障害です。

## 維持する fail-closed ルール

次の場合は Generation Package を返さず、明示的に失敗します。

- project が不明
- subject が不明
- 必須 Canon が不足
- Approved Visual Anchor が必要なのに未登録
- style lock / identity lock に必要な情報が不足
- Canon に記載された reference asset が存在しない
- legacy / candidate asset へ暗黙 fallback しないと成立しない

一方、次は Canon failure ではありません。

- MCP session 切断
- ChatGPT の action refresh failure
- tunnel / transport failure
- stale session

これらは transport / adapter 層の障害として扱います。

## Visual Director Core

MCP 非依存の entry point は `src/core/visual-director.ts` にあります。

主要 API は次の通りです。

```ts
const core = createVisualDirectorCore(options);

await core.prepareGeneration(input);
await core.configureProject(projectId, repositoryPath); // backward compatibility
await core.adoptAnchor(input);
```

`prepareGeneration()` は、明示された `scene_context.repository_path` を request-scoped repository path として利用できます。この値は prompt へ混入させず、Generation Package 構築前に取り除かれます。

そのため、画像生成準備のために `visual.configure_project` を事前実行することは必須ではありません。

## Generation Package

`visual.prepare_generation` または Core の `prepareGeneration()` は、Canon 検証に成功した場合のみ Generation Package を返します。

主な内容は次の通りです。

- `prompt_package.style_lock`
- `prompt_package.subject_lock`
- `prompt_package.scene_requirements`
- `prompt_package.allowed_changes`
- `prompt_package.forbidden_changes`
- `prompt_package.avoid_block`
- `reference_assets`
- `policy`

Approved Anchor が存在する既存キャラクターでは、`reference_assets` に `subject_anchor` が入り、`policy.must_use_approved_anchor` は `true` になります。

例:

```json
{
  "reference_assets": [
    {
      "role": "global_reference",
      "path": "docs/visual/assets/global_visual_style_reference.webp"
    },
    {
      "role": "subject_anchor",
      "subject_id": "kamino_kyosuke",
      "path": "public/images/characters/kamino_kyosuke/v2/default.avif"
    }
  ],
  "policy": {
    "must_use_approved_anchor": true,
    "must_not_chain_from_candidate": true,
    "must_review_after_generation": true
  }
}
```

## 標準プロジェクト

標準 Adapter は `bottom-of-thirst` です。

対象リポジトリ:

```text
ryohryp/---The-Bottom-of-Thirst
```

主に次の正本を参照します。

```text
docs/WORLD_DIRECTION.md
docs/visual/GLOBAL_VISUAL_STYLE.md
docs/visual/CHARACTER_VISUAL_CANON.md
docs/characters/*.md
docs/visual/assets/global_visual_style_reference.webp
public/images/characters/*/v2/*
```

追加ゲームは `projects.json` と Canon 互換 Adapter で追加できます。

## repository path の解決

推奨順は次の通りです。

1. `scene_context.repository_path` を明示する request-scoped 解決
2. 起動時 `--repo-path`
3. `BOTTOM_OF_THIRST_REPO_PATH`
4. 後方互換の `visual.configure_project`

例:

```json
{
  "project_id": "bottom-of-thirst",
  "asset_type": "character_visual_anchor",
  "subject_ids": ["kamino_kyosuke"],
  "request_text": "神野恭介の現在の Approved Visual Anchor を使って Generation Package を作る",
  "scene_context": {
    "repository_path": "I:\\04_develop\\---The-Bottom-of-Thirst"
  }
}
```

`repository_path` は Generation Package の scene requirement には入りません。

## MCP Adapter

MCP server は次の3ツールを公開します。

### `visual.prepare_generation`

Visual Director Core を呼び、Generation Package を返します。画像生成は行いません。

### `visual.configure_project`

既存クライアント向けの後方互換機能です。実行中プロセス内に repository path を保持します。永続化せず、Core の必須前提でもありません。

### `visual.adopt_anchor`

ユーザーが明示承認した画像だけを Approved Visual Anchor として採用します。

- approval は明示的に `approve`
- unknown subject を拒否
- unsafe path を拒否
- 既存の別 Approved Anchor を勝手に上書きしない
- legacy asset を代替採用しない
- 画像と Canon 更新を rollback 可能な形で処理

ChatGPT からは OpenAI file reference を `candidate_file` として渡せます。既存 repository asset を採用する場合は後方互換の `candidate_path` を利用できます。

## セットアップ

Node.js 20 以降が必要です。

```powershell
npm.cmd install
```

ローカル HTTP server を起動する場合:

```powershell
$env:BOTTOM_OF_THIRST_REPO_PATH = 'I:\04_develop\---The-Bottom-of-Thirst'
npm.cmd run dev -- --http --host 127.0.0.1 --port 3000
```

または repository path を request ごとに渡す場合、環境変数なしでも起動できます。

```powershell
npm.cmd run dev -- --http --host 127.0.0.1 --port 3000
```

MCP endpoint:

```text
http://127.0.0.1:3000/mcp
```

stdio transport:

```powershell
npm.cmd run dev
```

## ChatGPT から使う

ローカル Visual Director を ChatGPT へ接続する場合は Secure MCP Tunnel を利用します。接続手順は `docs/chatgpt-connection.md` を参照してください。

例:

```text
@Visual Director
神野恭介の Approved Visual Anchor を正本として Generation Package を取得してください。
画像生成はまだ行わないでください。
```

接続が stale になった場合、Canon failure として扱わず MCP 接続を再初期化してください。

## Approved Anchor 採用

ChatGPT file reference の例:

```json
{
  "project_id": "bottom-of-thirst",
  "subject_id": "kamino_kyosuke",
  "candidate_file": {
    "download_url": "https://files.example/...",
    "file_id": "file_...",
    "mime_type": "image/png",
    "file_name": "kyosuke.png"
  },
  "approval": "approve"
}
```

保存先は Canon の subject ID から決定され、呼び出し元が任意の絶対パスへ書き込ませることはできません。

## 複数ゲーム

`projects.example.json` を参考にローカル設定を作成します。

```powershell
$env:VISUAL_DIRECTOR_PROJECTS_CONFIG = 'C:\path\to\projects.json'
npm.cmd run dev -- --http --host 127.0.0.1 --port 3000
```

マシン固有の repository path や認証情報を Git へコミットしないでください。

## 検証

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

テスト対象には次を含みます。

- MCP 非依存 Core の直接実行
- request-scoped repository path
- repository path が prompt へ混入しないこと
- Approved Anchor 解決
- Anchor 不在時の fail-closed
- legacy / candidate fallback 禁止
- runtime binding の後方互換
- MCP Streamable HTTP transport
- stale session と Canon error の区別
- Anchor 採用時の画像検証と rollback

## トラブルシューティング

| 状況 | 意味 / 対応 |
|---|---|
| `PROJECT_CONFIG_MISSING` | repository path を request、起動設定、または互換 `configure_project` で明示する |
| `PROJECT_REPOSITORY_INVALID` | repository path が存在し、読み取り可能な directory か確認する |
| `PROJECT_NOT_FOUND` | `project_id` を確認する |
| `SUBJECT_NOT_FOUND` | Canon / project definition に存在する subject ID を使う |
| `REFERENCE_NOT_FOUND` | Canon に記載された Approved Anchor / reference asset の実ファイルを確認する |
| `Session terminated` | Canon error ではない。MCP / tunnel / ChatGPT 接続層を再初期化する |
| action refresh failure | MCP tool metadata の更新失敗。server 再起動後に ChatGPT 側で Refresh / reconnect する |

## 非目標

Visual Director 自身には次を持たせません。

- Image API 呼び出し
- 画像生成
- Web UI
- 永続 DB
- ベクトル検索
- LoRA / ControlNet
- AI による自由な人物像の再解釈
- candidate / legacy asset への自動 fallback

Visual Director は「画像を作るAI」ではなく、**確定済み Visual Canon を画像生成へ安全に適用する Canon compiler / gatekeeper** として扱います。

## v0.2 の実リポジトリ確認

`bottom-of-thirst` の正本側では、神野恭介の Approved Visual Anchor として `public/images/characters/kamino_kyosuke/v2/default.avif` が Canon に登録され、同じ `v2` ディレクトリに実ファイルが存在することを確認している。ローカル MCP を v0.2 へ更新後は、この実データを使って `reference_assets` の `subject_anchor` と `policy.must_use_approved_anchor = true` を最終 E2E 確認する。
