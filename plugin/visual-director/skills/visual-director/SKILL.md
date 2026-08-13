---
name: visual-director
description: Visual Director MCPでゲームのVisual CanonとApproved Anchorを検証し、画像生成用Generation Packageを準備する。キャラクター立ち絵、イベントCG、背景、キービジュアルなどを新規生成・修正するとき、既存ゲームの画風と人物同一性を守る必要がある場合に使う。一般画像生成やCanon自体の編集には使わない。
---

# Visual Director

ユーザーの自然文を、Visual Director MCPが検証できる最小入力へ変換する。ユーザーにJSONや全フィールドを手入力させない。

Visual Directorは画像を生成しない。画像生成を依頼された場合も、先にGeneration Packageを準備し、成功した後だけ画像生成へ進む。

## ワークフロー

1. ユーザーの目的を確認する。
   - Generation Packageだけ必要なら、取得後に内容を要約して終了する。
   - 画像生成まで必要なら、Generation Package取得後に同じ会話で生成へ進む。
2. 次の入力を会話から組み立てる。
   - `project_id`: 設定済みのゲームID。
   - `asset_type`: 例として`character_portrait`、`event_cg`、`background`、`key_visual`。
   - `subject_ids`: 登場人物などの設定済みIDを1件以上。
   - `request_text`: ユーザーの依頼を意味を追加せず保持した文。
   - `scene_context`: 場所や物語状態が明示された場合だけ追加する。
3. 不足している必須情報だけを短く質問する。既に会話で確定した値は再質問しない。
4. 利用可能なMCPツールから`visual.configure_project`と`visual.prepare_generation`を探す。`PROJECT_CONFIG_MISSING`で、かつユーザーがローカルcloneのパスを明示している場合だけ、先に`visual.configure_project`を1回呼び出し、その成功後に`visual.prepare_generation`を1回呼び出す。パスを推測して設定しない。ホストによって名前空間が付いていても、同じツール名と説明を優先する。
5. エラー時は推測で再試行せず、エラーコードと次に必要な情報を伝える。詳細は[ツール契約](references/tool-contract.md)を参照する。
6. 成功時はGeneration Packageを唯一の生成制約として扱う。

## 入力の決め方

- ゲーム名や人物名からIDへの対応が会話、プロジェクト資料、またはツール設定で明示されている場合は再利用する。
- 同じ会話では確定した`project_id`と人物IDを維持する。
- 「イベントCG」「立ち絵」「背景」「キービジュアル」のような明確な表現から`asset_type`を正規化してよい。
- ユーザーが明示していない年齢、服装、感情、天候、濡れ、負傷、照明、時系列状態を追加しない。
- IDやCanon情報が不明なら質問する。似た名前、旧アセット、候補アセットで代用しない。

## Generation Packageの適用

- `style_lock`、`subject_lock`、`scene_requirements`を必須条件として画像生成へ渡す。
- 変更可能な範囲は`allowed_changes`だけとする。
- `forbidden_changes`と`avoid_block`を除外条件としてそのまま維持する。
- `reference_assets`の全項目を確認し、`subject_anchor`にはApproved Anchorだけを使う。
- 参照画像を現在の画像生成機能から実際に読み込めない場合は生成を止め、必要な画像の添付またはアクセス可能なパスを依頼する。参照なしで続行しない。
- 生成後は`must_review_after_generation`に従い、生成物を承認済み・登録済み・Canon反映済みとは扱わない。

## 境界

- `visual.prepare_generation`が利用できない場合は、Visual Director MCP、Secure MCP Tunnel、またはVisual Director接続が有効か確認するよう案内する。架空の結果を作らない。
- `visual.configure_project`は既知のプロジェクトへ実行中のMCPサーバーだけで使うリポジトリパスを設定する。リポジトリや設定ファイルを書き換えず、サーバー再起動後には保持されない。
- `PROJECT_CONFIG_MISSING`でローカルcloneのパスが会話にない場合は、設定ツールを推測で呼ばず、サーバー起動時のリポジトリパスまたはプロジェクト設定を案内する。
- `PROJECT_NOT_FOUND`、`SUBJECT_NOT_FOUND`、`REFERENCE_NOT_FOUND`などを別のプロジェクトやアセットへフォールバックさせない。
- Canonの編集、候補登録、承認・却下、ゲームリポジトリへの書き込みは行わない。
- ユーザーが画像生成を頼んでいない場合、Generation Packageの取得だけで終了する。
