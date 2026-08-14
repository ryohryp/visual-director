# Visual Director MCP

Visual Director MCP v0.1は、ゲームのVisual Canon（ビジュアル設定資料）を読み取り、画像生成に必要なコンテキストを準備する、フェイルクローズ設計のMCPサーバーです。

画像を生成したり、OpenAI Image APIを呼び出したり、ゲームリポジトリを変更したり、候補画像やレビューを管理したりはしません。`visual.configure_project`は実行中のプロセス内にローカルリポジトリの紐づけを保持しますが、リポジトリや設定ファイルは変更せず、再起動後にも保持しません。

標準搭載のプロジェクトAdapterは`bottom-of-thirst`で、`ryohryp/---The-Bottom-of-Thirst`を対象にしています。ローカルのJSON設定ファイルを使えば、MCPツールの契約を変更せずに他のゲームも追加できます。

## v0.1でできること

`visual.configure_project`で既知のプロジェクトへローカルcloneのディレクトリを紐づけられます。続けて`visual.prepare_generation`を呼ぶと、設定されたプロジェクトの正本資料を読み取り、以下の項目に分けたGeneration Packageを返します。

Generation Packageには、スキーマ版を示す`schema_version`（現在は`1`）と、意味内容が同じPackageを識別する決定論的SHA-256値の`fingerprint`も含まれます。

- 全体のビジュアルスタイル
- キャラクターの同一性とApproved Anchor
- シーン要件
- 許可される変更
- 禁止される変更
- 参照アセット
- 生成ポリシー

Adapterは`CHARACTER_VISUAL_CANON.md`からApproved Anchorのパスを解決します。返却前に、全体ビジュアルスタイル、世界観設定、キャラクター設定、参照アセット一覧、Approved Anchor、全体スタイル参照画像を検証します。

未知のプロジェクト、未知のキャラクター、資料不足、Anchor不足、スタイルロック不足は明示的なエラーとして返します。Legacyアセットや候補アセットを代替として使用することはありません。

### 実行中のプロジェクト設定

起動時に`BOTTOM_OF_THIRST_REPO_PATH`または`--repo-path`を指定していない場合でも、ユーザーが明示した既存のローカルcloneパスをMCPから設定できます。

```json
{
  "project_id": "bottom-of-thirst",
  "repository_path": "I:\\04_develop\\---The-Bottom-of-Thirst"
}
```

この呼び出しは`visual.configure_project`が実行中のMCPサーバーだけに設定を保持します。パスの存在とディレクトリ性を検証し、成功後は同じセッションで`visual.prepare_generation`を呼び出します。パスを推測したり、設定ファイルへ保存したりはしません。

## アーキテクチャ

```text
MCPクライアント / Inspector
        |
        v
visual.configure_project（必要な場合）
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

## インストール後の使い方

Visual Directorは単独で画像を作るアプリではありません。ChatGPTから呼び出され、ゲームのCanonを検証して「画像生成用の指示書（Generation Package）」を作るMCPツールです。

ChatGPTから使うときは、次の3つを順番に動かします。

```text
Visual Directorを起動
        ↓
Secure MCP Tunnelを起動
        ↓
ChatGPTのチャットでVisual Directorを選んで依頼
```

ChatGPTへの接続登録がまだの場合だけ、先に[ChatGPT接続ガイド](docs/chatgpt-connection.md)を参照して、Developer mode、Tunnel、Visual Directorプラグインを設定してください。登録済みなら毎回やり直す必要はありません。

### スキルを使う最短手順

[Visual Directorスキル](plugin/visual-director/skills/visual-director/SKILL.md)をインストールすると、`project_id`などのJSONを毎回書く必要がなくなります。ChatGPTでは`@Visual Director`、Codexでは`$visual-director`を選び、普段の言葉で依頼してください。

ChatGPTへ追加する場合は、スキルの中身をZIPにして、ChatGPTの**プラグイン → スキル → 作成 → パソコンからアップロード**から登録します。

```powershell
$skillSource = Join-Path $PWD 'plugin\visual-director\skills\visual-director\*'
$skillZip = Join-Path $env:TEMP 'visual-director-skill.zip'
Compress-Archive -Path $skillSource -DestinationPath $skillZip -Force
```

Codexへ追加する場合は、ユーザースキルの場所へコピーします。

```powershell
$codexSkills = Join-Path $env:USERPROFILE '.agents\skills'
New-Item -ItemType Directory -Path $codexSkills -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PWD 'plugin\visual-director\skills\visual-director') -Destination $codexSkills -Recurse -Force
```

```text
@Visual Director 『渇きの底』で、水上沙耶の通常立ち絵を作って。
```

```text
$visual-director 『渇きの底』で、水上沙耶の通常立ち絵を作って。
```

スキルは、会話から判断できないゲームIDや人物IDだけを質問し、必要なら明示されたローカルcloneパスで`visual.configure_project`を呼び出してから、`visual.prepare_generation`、Generation Packageの適用、参照画像の確認までを案内します。スキル本体は[ChatGPTとCodex共通のプラグインパッケージ](plugin/visual-director)に含まれています。

ChatGPTで使う場合はVisual Director接続も有効にしてください。Codexでリポジトリ内のスキルだけを試す場合は、`plugin/visual-director/skills/visual-director`をユーザースキルの場所へインストールできます。プラグインをインストールした後は、新しいチャットまたはタスクを開始してください。

### 1. Visual Directorを起動する

PowerShellを開き、このリポジトリで次を実行します。

```powershell
$env:BOTTOM_OF_THIRST_REPO_PATH = 'C:\path\to\---The-Bottom-of-Thirst'
npm.cmd run dev -- --http --host 127.0.0.1 --port 3000
```

次の表示が出れば起動成功です。このPowerShellは閉じずに残します。

```text
Visual Director MCP listening on http://127.0.0.1:3000/mcp
```

### 2. Secure MCP Tunnelを起動する

別のPowerShellを開きます。APIキーをコマンド履歴へ直接残さないよう、マスク入力してから、設定済みの`visual-director`プロファイルを起動します。

```powershell
$tunnelExe = 'C:\path\to\tunnel-client.exe'
$profileDir = 'C:\path\to\tunnel-client\profiles'
$runtimeKey = Read-Host 'OpenAI runtime API key' -AsSecureString
$env:CONTROL_PLANE_API_KEY = [System.Net.NetworkCredential]::new('', $runtimeKey).Password

& $tunnelExe doctor --profile visual-director --profile-dir $profileDir --explain
& $tunnelExe run --profile visual-director --profile-dir $profileDir
```

`doctor`が成功し、`run`が接続待機状態になれば準備完了です。このPowerShellも閉じずに残します。APIキーをREADME、Git、チャット、スクリーンショットへ貼り付けないでください。

`tunnel-client`がPATHに登録済みで、プロファイルが標準ディレクトリにある場合は、次の短いコマンドでも起動できます。

```powershell
tunnel-client doctor --profile visual-director --explain
tunnel-client run --profile visual-director
```

### 3. ChatGPTから呼び出す

ChatGPTで新しいチャットを開き、ツールまたは「＋」メニューから`Visual Director`を有効にして、次のように依頼します。

```text
Visual Directorを使って、次の画像生成パッケージを作ってください。

- project_id: bottom-of-thirst
- asset_type: character_portrait
- subject_ids: [saya]
- request_text: 水上沙耶の通常立ち絵

Canonの不足やエラーは推測で補完せず、そのまま報告してください。
```

起動時のリポジトリパスが未設定で、ユーザーがローカルcloneのパスを明示している場合、ChatGPTは先に`visual.configure_project`を呼び出します。その成功後、`visual.prepare_generation`からスタイル、キャラクター、禁止事項、参照アセットをまとめたGeneration Packageを受け取ります。

Visual Director自身は画像を生成しません。Generation Packageを確認したあと、必要なら同じチャットで次のように依頼します。

```text
このGeneration Packageの制約を守って画像を生成してください。
```

### 終了する

作業が終わったら、Visual DirectorとTunnelを起動した各PowerShellで`Ctrl+C`を押します。Tunnel側のPowerShellでは、APIキーの環境変数も削除してください。

```powershell
Remove-Item Env:CONTROL_PLANE_API_KEY
```

### うまく動かない場合

| 状況 | 確認すること |
|---|---|
| ChatGPTにVisual Directorが表示されない | Developer mode、プラグインの接続状態、Tunnelの起動状態を確認する |
| `PROJECT_CONFIG_MISSING` | ローカルcloneのパスが明示されている場合は`visual.configure_project`を呼び出し、それ以外は`BOTTOM_OF_THIRST_REPO_PATH`または`VISUAL_DIRECTOR_PROJECTS_CONFIG`を設定する |
| `PROJECT_REPOSITORY_INVALID` | 指定パスが存在しない、読めない、またはディレクトリではない。パスを修正して再設定する |
| `PROJECT_NOT_FOUND` | プロンプトの`project_id`が設定済みのIDと一致しているか確認する |
| `SUBJECT_NOT_FOUND` | `subject_ids`にプロジェクトで定義されたIDを指定する |
| `REFERENCE_NOT_FOUND` | Canonに記載されたApproved Anchorが実際に存在するか確認する |
| ChatGPTから呼び出すと失敗する | Visual Directorと`tunnel-client`の両方が動いているか確認する |

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

MCPサーバーは、実行時設定用の`visual.configure_project`と、読み取り専用・冪等の`visual.prepare_generation`を公開します。`visual.configure_project`はローカルリポジトリの存在を検証して実行中のサーバーにだけ紐づけます。`visual.prepare_generation`はコンテキストの準備だけを行い、画像生成や画像APIの呼び出しは行いません。

## ツール入力の例

```json
{
  "project_id": "bottom-of-thirst",
  "asset_type": "character_portrait",
  "subject_ids": ["saya"],
  "request_text": "水上沙耶の通常立ち絵"
}
```

返却される`reference_assets`には、全体スタイル参照画像とキャラクターのApproved Anchorが含まれます。

```json
[
  { "role": "global_reference", "path": "docs/visual/assets/global_visual_style_reference.webp" },
  { "role": "subject_anchor", "subject_id": "saya", "path": "public/images/characters/saya/v2/default.avif" }
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

HTTPを検査する場合は、1つのターミナルでHTTPサーバーを起動し、別のターミナルからMCP Inspectorを`http://127.0.0.1:3000/mcp`に接続します。Inspectorには`visual.configure_project`と`visual.prepare_generation`の2ツールが表示されます。

## 検証

```powershell
npm.cmd run typecheck
npm.cmd test
```

テストでは、Generation Packageの分離、CanonからのAnchor解決、Approved Anchorの連続パス解析、未知のキャラクターに対する明示的エラー、Anchorやマニフェスト不足時のエラー、MCPツール検出、MCPプロトコル呼び出しを検証します。

## v0.1の対象外

画像生成、Web UI、データベース保存、アセット登録、候補画像の承認・却下、Visual QA自動化、LoRA、ControlNet、ベクトル検索、複数モデルのオーケストレーション、ゲームリポジトリへの自動書き込みは、今後の対応範囲です。
