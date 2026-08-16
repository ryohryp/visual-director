---
name: visual-director
description: ゲームリポジトリのVisual CanonとApproved Anchorを検証し、ChatGPT PlusでもMCPを必須にせず画像生成制約を解決する。MCPが利用可能な場合はoptional adapterとして利用する。
---

# Visual Director

Visual Directorの正本はGame RepositoryにあるVisual Canon、Approved Visual Anchor、Global Visual Style、World Directionである。ChatGPT Plusからの標準フローはGitHub App + `.visual-director/compiled-canon.json` + image generationで成立させ、Visual Director MCPはoptional adapterとして扱う。

画像生成を依頼された場合、画像生成前に必ず今回のproject / asset type / subjectについて生成制約を解決する。解決経路は次のどちらかとする。

1. MCP経路: `visual.prepare_generation`が利用可能ならGeneration Packageを取得する。
2. Repository-native経路: MCPが利用不能、FORBIDDEN、未接続、または実行経路の都合で呼べない場合は、GitHub Appで対象Game Repositoryの`.visual-director/compiled-canon.json`を読む。

MCP failureをCanon failureとして扱わない。MCPが失敗したという理由だけで制作フローを停止せず、repository-native経路へ切り替える。ただしrepository-native経路の検証に失敗した場合はfail closedとする。

## 絶対ゲート

次を満たさない限り画像生成ツールを呼ばない。

- `project_id`が今回の対象Projectと一致する。
- 今回の`asset_type`に適用するpolicyを解決できる。
- 対象`subject_ids`がcompiled Canonに存在する。
- 各subjectの`subject_lock`が空でない。
- `global_style_lock`が空でない。
- 各subjectの`approved_anchor_path`を解決でき、GitHub上で実ファイルの存在を確認できる。
- `global_reference_path`を解決でき、GitHub上で実ファイルの存在を確認できる。
- `must_use_approved_anchor: true`の場合、Approved Anchorを実際の参照画像として利用できる。
- `forbidden_changes`と`avoid_block`を取得済みである。

参照アセットが見つからない、compiled Canonが存在しない、subjectが存在しない、policyが不整合、または参照画像を画像生成機能へ渡せない場合は生成を停止する。会話履歴、モデル記憶、旧アセット、candidate、他人物のAnchorから補完しない。

## 意図ルーティングゲート

現在のユーザー発話を最優先し、次に分類する。

- **生成・編集**: 「作って」「生成して」「描いて」「修正して」など。生成制約を解決してから画像生成へ進む。
- **採用・登録・保存・反映**: 「これ採用」「登録して」「Anchorにして」「保存して」「反映して」など。画像を再生成しない。採用経路を使う。
- **レビュー**: 「どう？」「確認して」「評価して」など。生成しない。
- **停止・保留**: 「待って」「止めて」など。追加処理を行わない。

画像候補を提示した直後の「これ登録して」「これ採用」は、その候補を対象とする。別画像の再生成やバリエーション作成へ勝手に戻らない。

## 生成ワークフロー

1. `project_id`、`asset_type`、`subject_ids`、ユーザーが明示したrequest-specific scene requirementsを会話から整理する。
2. MCPが利用可能なら`visual.prepare_generation`を試してよい。成功した場合はそのGeneration Packageを唯一の生成制約として使用する。
3. MCPが利用不能またはtransport-level failureの場合はrepository-native経路へ切り替える。
4. GitHub Appで対象Game Repositoryの`.visual-director/compiled-canon.json`を読む。
5. 次を検証する。
   - `schema_version`が対応可能である。
   - `project_id`が一致する。
   - `global_style_lock`が空でない。
   - `global_reference_path`が空でない。
   - 対象subjectがすべて存在する。
   - 各subjectの`approved_anchor_path`と`subject_lock`が空でない。
   - policyで`must_not_chain_from_candidate: true`、`must_review_after_generation: true`を維持する。
6. GitHub Appで`global_reference_path`と各`approved_anchor_path`の実ファイルを読む、または少なくとも存在確認する。candidateやlegacyへfallbackしない。
7. Generation Package相当の制約を組み立てる。
   - style lock = `global_style_lock`
   - subject lock = 対象subjectの`subject_lock`
   - scene requirements = compiled Canonの`world_direction` + ユーザーが今回明示したscene requirementsのみ
   - allowed changes = 対象subjectの`allowed_changes`
   - forbidden changes = 対象subjectの`forbidden_changes`
   - avoid block = `avoid_block`
   - reference assets = global reference + Approved Anchors
   - policy = compiled Canonのpolicy
8. 画像生成後、hard facts、人物同一性、Global Style、必須小物、服装などを照合する。外れていればRejectし、採用・登録へ進めない。

## MCP failureの扱い

次はrepository-native経路へ切り替える対象であり、Canon failureではない。

- `FORBIDDEN: This conversation does not support developer MCPs`
- MCP tool自体が利用できない
- connector / transport / tunnelの接続失敗
- MCP endpointへリクエストが到達しない実行環境上の制約

一方、MCPが正常に応答して`SUBJECT_NOT_FOUND`、`REFERENCE_NOT_FOUND`、`CANON_READ_FAILED`などCanon由来のエラーを返した場合、repository-native経路で都合よく上書きしない。正本の不整合として停止する。

## Repository-native経路の境界

- `.visual-director/compiled-canon.json`はderived artifactであり正本ではない。Canon更新後にstaleの疑いがある場合は`visual-director compile --check`相当のCI結果を確認する。
- `request_text`や会話時の`scene_context`をcompiled Canonの一部として扱わない。
- ユーザーが明示していない年齢、服装、感情、天候、負傷、照明、時系列状態を追加しない。
- Approved Anchor以外のcandidate / archived / legacy画像をgeneration parentとして使わない。
- 参照画像を現在の画像生成機能へ実際に渡せない場合は生成を止める。参照なしで続行しない。

## 採用・登録

MCPが利用可能で、ユーザーが候補を明示的に採用した場合は`visual.adopt_anchor`を使ってよい。MCPが利用不能な場合は画像を再生成せず、GitHub Appによるrepository-native adoption経路が実装済みならそれを使う。未実装なら、候補を採用済みと偽らず停止する。

ChatGPT由来の一時ファイルや`/mnt/data/...`をrepository pathとして解釈しない。Approved Anchor採用では、画像アセットとCanon参照の両方が整合した状態だけを完了とする。

## 入力の決め方

- 会話やプロジェクト資料で確定した`project_id`とsubject IDを再利用する。
- 「イベントCG」「立ち絵」「背景」「キービジュアル」などは既知の`asset_type`へ正規化してよい。
- 未知の人物名やsubject IDを推測変換しない。
- world map / environment / UIのsubjectless assetは、Core側で正式対応していない限り人物Anchorをでっち上げて生成しない。

## 成功時の原則

MCP経路とrepository-native経路のどちらを使っても、style / subject / reference / policyの意味を同値に保つ。利用経路の違いを理由にCanon制約を弱めない。
