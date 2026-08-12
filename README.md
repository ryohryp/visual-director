# Visual Director MCP

Visual Director MCP v0.1は、ゲームのVisual Canon（ビジュアル設定資料）を読み取り、画像生成に必要なコンテキストを準備する、フェイルクローズ設計のMCPサーバーです。

画像を生成したり、OpenAI Image APIを呼び出したり、ゲームリポジトリを変更したり、候補画像やレビューを管理したりはしません。

標準搭載のプロジェクトAdapterは`bottom-of-thirst`で、`ryohryp/---The-Bottom-of-Thirst`を対象にしています。ローカルのJSON設定ファイルを使えば、MCPツールの契約を変更せずに他のゲームも追加できます。

## v0.1でできること

`visual.prepare_generation`は、設定されたプロジェクトの正本資料を読み取り、以下の項目に分けたGeneration Packageを返します。

- 全体のビジュアルスタイル
- キャラクターの同一性とApproved Anchor
- シーン要件
- 許可される変更
- 禁止される変更
- 参照アセット
- 生成ポリシー

Adapterは`CHARACTER_VISUAL_CANON.md`からApproved Anchorのパスを解決します。返却前に、全体ビジュアルスタイル、世界観設定、キャラクター設定、参照アセット一覧、Approved Anchor、全体スタイル参照画像を検証します。

未知のプロジェクト、未知のキャラクター、資料不足、Anchor不足、スタイルロック不足は明示的なエラーとして返します。Legacyアセットや候補アセットを代替として使用することはありません。

## アーキテクチャ

```text
MCPクライアント / Inspector
        |
        v
visual.prepare_generation
        |
        v
プロジェクトAdapterレジストリ
        |
        v
BottomOfThirstAdapter
        |
        +-- docs/WORLD_DIRECTION.md
        +-- docs/visual/GLOBAL_VISUAL_STYLE.md
        +-- docs/visual/CHARACTER_VISUAL_CANON.md
        +-- docs/characters/*.md
        +-- docs/visual/assets/global_visual_style_reference.webp
        +-- public/images/characters/*/v2/* Approved Anchor
```

Adapterの境界は意図的に分離されています。標準のプロジェクトAdapterは既存のものを維持し、追加のCanon互換ゲームは`projects.json`と汎用Canon Adapterから読み込みます。プロジェクトごとに、リポジトリパス、資料パス、見出し名、キャラクター定義を設定できます。

## セットアップ

Node.js 20以降が必要です。

```powershell
npm.cmd install
$env:BOTTOM_OF_THIRST_REPO_PATH = 'C:\path\to\---The-Bottom-of-Thirst'
```

リポジトリパスは`--repo-path`でも指定できます。パスはソース管理に含めず、認証情報を配置しないでください。

### 複数ゲームを使う場合

[projects.example.json](projects.example.json)をコピーしてプロジェクト定義を編集し、次のように起動します。

```powershell
$env:VISUAL_DIRECTOR_PROJECTS_CONFIG = 'C:\path\to\projects.json'
npm.cmd run dev -- --http --host 127.0.0.1 --port 3000
```

マシン固有のパスを含む設定ファイルはローカル専用とし、コミットしないでください。`repo_path`は設定ファイルを基準とした相対パスとして解決されます。標準の`bottom-of-thirst`は、引き続き`BOTTOM_OF_THIRST_REPO_PATH`で利用できます。

## ローカルで起動する

MCPクライアントがローカルサーバーを起動する場合は、stdioトランスポートが標準です。

```powershell
npm.cmd run dev
```

ローカルのStreamable HTTPエンドポイントを使う場合は、次のように起動します。

```powershell
npm.cmd run dev -- --http --host 127.0.0.1 --port 3000
```

エンドポイントは`http://127.0.0.1:3000/mcp`です。HTTPサーバーは標準でループバックアドレスにだけバインドされます。有効なツール呼び出しが行われるまで、プロジェクトパスや資料の内容は公開しません。

## ChatGPTから接続する

ローカルでChatGPTから利用する場合は、サーバーをループバックに限定し、Secure MCP Tunnel経由で接続してください。Tunnel、Developer mode、検証用プロンプト、ローカルテストと公開デプロイの境界については、[ChatGPT接続ガイド](docs/chatgpt-connection.md)を参照してください。

MCPサーバーは、読み取り専用・冪等のツールメタデータと構造化されたGeneration Packageを公開します。そのためChatGPTは`visual.prepare_generation`を選択し、結果を安定して利用できます。このツールはコンテキストの準備だけを行い、画像生成や画像APIの呼び出しは行いません。

## ツール入力の例

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

返却される`reference_assets`には、全体スタイル参照画像とキャラクターのApproved Anchorが含まれます。

```json
[
  { "role": "global_reference", "path": "docs/visual/assets/global_visual_style_reference.webp" },
  { "role": "subject_anchor", "subject_id": "souma", "path": "public/images/characters/souma/v2/default.avif" }
]
```

パスはプロジェクトリポジトリを基準とした相対パスです。呼び出し元のモデルは、設定されたプロジェクトチェックアウトを基準に参照できます。Visual Directorが画像バイト列をモデルへ渡すことはありません。

## MCP Inspector

コンパイル済みサーバーを使う場合は、先にビルドします。

```powershell
npm.cmd run build
$env:BOTTOM_OF_THIRST_REPO_PATH = 'C:\path\to\---The-Bottom-of-Thirst'
npx.cmd @modelcontextprotocol/inspector node dist/index.js
```

複数ゲーム設定を使う場合は、次のように起動します。

```powershell
npm.cmd run build
npx.cmd @modelcontextprotocol/inspector node dist/index.js --projects-config C:\path\to\projects.json
```

HTTPを検査する場合は、1つのターミナルでHTTPサーバーを起動し、別のターミナルからMCP Inspectorを`http://127.0.0.1:3000/mcp`に接続します。Inspectorには`visual.prepare_generation`の1ツールだけが表示されます。

## 検証

```powershell
npm.cmd run typecheck
npm.cmd test
```

テストでは、Generation Packageの分離、CanonからのAnchor解決、Approved Anchorの連続パス解析、未知のキャラクターに対する明示的エラー、Anchorやマニフェスト不足時のエラー、MCPツール検出、MCPプロトコル呼び出しを検証します。

## v0.1の対象外

画像生成、Web UI、データベース保存、アセット登録、候補画像の承認・却下、Visual QA自動化、LoRA、ControlNet、ベクトル検索、複数モデルのオーケストレーション、ゲームリポジトリへの自動書き込みは、今後の対応範囲です。
