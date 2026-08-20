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
- `global_style_lock`が空でない。
- `global_reference_path`を解決でき、GitHub上で実ファイルの存在を確認できる。
- `forbidden_changes`と`avoid_block`を取得済みである。
- 人物・subject固有assetでは、対象`subject_ids`がcompiled Canonに存在する。
- 人物・subject固有assetでは、各subjectの`subject_lock`が空でない。
- 人物・subject固有assetでは、各subjectの`approved_anchor_path`を解決でき、GitHub上で実ファイルの存在を確認できる。
- `must_use_approved_anchor: true`の場合、Approved Anchorを実際の参照画像として利用できる。
- subjectless assetでは、`subject_ids`をでっち上げず、今回の`asset_type`がsubjectなしで正式に扱えることを確認する。
- `must_not_chain_from_candidate: true`を最終画像生成段階でも維持できる。

参照アセットが見つからない、compiled Canonが存在しない、必要なsubjectが存在しない、policyが不整合、または必要な参照画像を画像生成機能へ渡せない場合は生成を停止する。会話履歴、モデル記憶、旧アセット、candidate、他人物のAnchorから補完しない。

### Canon-first prompt preflight

**画像生成ツールを呼ぶ直前に、Canonから解決した制約と最終promptを必ず突き合わせる。** これは人物画像だけでなく、background / environment / world map / UI / itemなどのsubjectless assetにも同じように適用する。

- Issue本文や会話に「Visual Canonを使う」と書いてあるだけではCanon確認済みとみなさない。今回の実行でGeneration Packageまたは`.visual-director/compiled-canon.json`を実際に読み、`global_style_lock`、`global_reference_path`、`world_direction`、`avoid_block`を解決してから生成へ進む。
- ユーザーのrequest-specificな表現は、構図・題材・時間帯・状態などのscene requirementとして扱い、Global Visual Styleを上書きするstyle sourceとして扱わない。
- モデルが一般的なゲーム美術語を補ってはならない。`cinematic`、`painterly`、`photorealistic`、`AAA`、`anime`、`glossy`など、今回の`avoid_block`や`forbidden_changes`と衝突し得るstyle語を慣習で追加しない。
- 最終promptは、`global_style_lock`をstyleの土台とし、`avoid_block` / `forbidden_changes`をnegative constraintとして維持し、その後にsubject lock（存在する場合）、`world_direction`、今回のscene requirementsを重ねる。
- 最終promptに`avoid_block`または`forbidden_changes`と意味的に矛盾する指示が残っている場合、画像生成ツールを呼ばない。promptをCanon側へ修正してから再度preflightする。
- ユーザーが明示したstyle要求そのものがCanonと衝突する場合、黙って折衷しない。Canon準拠では実行できないことを示し、生成を停止するか、ユーザーが明示的にCanon変更を選ぶまで待つ。
- subjectless assetだからGlobal Style確認を省略しない。人物Anchorが不要であることと、Global Visual Canonが不要であることを混同しない。

生成後レビューだけを安全網にしない。**Canonと矛盾したpromptを生成モデルへ送らないこと**がこのpreflightの目的である。

### Conversation image context isolation

ChatGPT native image generationを使う場合、Generation Packageが正しくても同一会話の過去画像が暗黙のgeneration parentになる可能性を前提にする。「新規生成だから過去画像は使われない」と仮定しない。

次のいずれかに該当する場合はnative image generationをfail closedする。

- 今回のGeneration Packageで許可された`reference_assets`以外のuploaded/generated imageがgeneration contextへ入る可能性がある。
- 同一会話に無関係なgenerated/uploaded imageが存在し、hostが今回のreferenceだけに明示限定できない。
- hostへ実際にbindされるreferenceの中に、今回のGeneration Packageに存在しない画像がある。

この場合、その会話でnative image generationを呼ばない。新しいclean contextへ移るか、利用可能ならlocal/tunnel限定の`visual.generate_image`を使う。MCPが利用不能だからという理由で、このcontext-isolation gateを迂回しない。

生成結果が別の会話画像や過去成果物を継承したと判断した場合は、prompt品質ではなくcontext/reference binding問題として扱う。同じ誤参照が2回連続したら、そのcontextでは生成を停止し、3回目を盲目的に再生成しない。

誤参照で生成されたdashboard / UI / reportなどを切り出し、cropし、名称変更してbackground candidateとして再利用しない。Rejectのまま扱う。

## 意図ルーティングゲート

画像生成可否を判断するときは、過去の依頼より**現在のユーザー発話の動詞を最優先**する。現在のユーザー発話を次に分類する。

- **生成・編集**: 「作って」「生成して」「描いて」「修正して」など。**この分類だけ**画像生成・画像編集ツールを呼べる。生成制約を解決してから画像生成へ進む。
- **採用・登録・保存・反映**: 「これ採用」「登録して」「Anchorにして」「保存して」「反映して」など。**画像生成・画像編集ツールを呼ばない。** 画像を再生成せず、採用経路を使う。
- **レビュー**: 「どう？」「確認して」「評価して」など。生成しない。
- **停止・保留**: 「待って」「止めて」など。追加処理を行わない。

特に、画像候補を提示した直後の「これ登録して」「これ採用」「これ反映して」は、その候補そのものを対象とする採用・登録意図として扱う。より良い画像を作り直す、透過版を再生成する、別バリエーションを作る、といった処理を勝手に挟まない。

現在発話に生成・編集の明示がない場合、以前の「作って」「生成して」という依頼は画像候補が一度提示された時点で自動継続しない。採用・登録・レビューへ意図が変わった後に、過去の生成依頼を理由として画像生成へ戻らない。

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
   - 今回の`asset_type`に適用するpolicyを解決できる。
   - subjectがある場合、対象subjectがすべて存在する。
   - subjectがある場合、各subjectの`approved_anchor_path`と`subject_lock`が空でない。
   - subjectless assetの場合、人物Anchorを捏造せずに正式な生成経路を解決できる。
   - policyで`must_not_chain_from_candidate: true`、`must_review_after_generation: true`を維持する。
6. GitHub Appで`global_reference_path`と、subjectがある場合は各`approved_anchor_path`の実ファイルを読む、または少なくとも存在確認する。candidateやlegacyへfallbackしない。
7. Generation Package相当の制約を組み立てる。
   - style lock = `global_style_lock`
   - subject lock = 対象subjectの`subject_lock`（subjectがある場合）
   - scene requirements = compiled Canonの`world_direction` + ユーザーが今回明示したscene requirementsのみ
   - allowed changes = 対象subjectの`allowed_changes`（subjectがある場合）
   - forbidden changes = compiled Canon / policy + 対象subjectの`forbidden_changes`（subjectがある場合）
   - avoid block = `avoid_block`
   - reference assets = global reference + Approved Anchors（subjectがある場合）
   - policy = compiled Canonのpolicy
8. **Canon-first prompt preflightを実行する。** 最終promptが`global_style_lock`を土台としており、`avoid_block` / `forbidden_changes`と意味的に衝突するstyle語や指示を含まないことを確認する。衝突があれば生成せずpromptを修正する。
9. 実際の画像生成経路を決める。
   - local/tunnelで`visual.generate_image`が利用可能で、会話画像から機械的に分離した生成が必要ならこれを優先する。`visual.generate_image`はfreshなGeneration Packageを再構築し、そのrepository `reference_assets`だけをgeneratorへ渡す。
   - host-native image generationを使う場合は、上記Conversation image context isolationを満たすことを確認する。明示限定できない無関係画像が会話にあるなら生成しない。
   - Hosted read-only MCPに`visual.generate_image`が存在しないことは正常であり、Hosted write/generationを有効化して回避しない。
10. 画像生成後、hard facts、人物同一性、Global Style、必須小物、服装などを照合する。外れていればRejectし、採用・登録へ進めない。

## Isolated generation path

`visual.generate_image`はlocal/tunnel限定のisolated generation pathである。利用可能な場合はVisual Director Coreの`generateImage()`へ委譲し、今回のrepositoryからfreshに解決したGeneration Packageだけを使う。

- ChatGPT会話履歴の画像をgenerator inputに含めない。
- Generation Packageの`reference_assets`だけをgeneratorへ送る。
- 生成物は`.visual-director/candidates/`へCandidateとして保存する。
- 自動Approved / Registered化しない。
- Hosted read-onlyでは公開しない。
- background / `16:9` primary compositionはportrait固定にせずlandscape canvasを使う。

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
- repository-native fallbackはconversation image context isolationを無効化しない。Canonを正しく読めてもhost-native generationのreference bindingが安全でなければ生成しない。
- subjectless assetでも`global_style_lock` / `global_reference_path` / `world_direction` / `avoid_block`の解決を省略しない。
- issueや会話にCanon利用が宣言されていても、それをrepository確認の代替にしない。

## 採用・登録

MCPが利用可能で、ユーザーが候補を明示的に採用した場合は`visual.adopt_anchor`を使ってよい。MCPが利用不能な場合は画像を再生成せず、GitHub Appによるrepository-native adoption経路が実装済みならそれを使う。未実装なら、候補を採用済みと偽らず停止する。

ChatGPT由来の一時ファイルや`/mnt/data/...`をrepository pathとして解釈しない。Approved Anchor採用では、画像アセットとCanon参照の両方が整合した状態だけを完了とする。

## 入力の決め方

- 会話やプロジェクト資料で確定した`project_id`とsubject IDを再利用する。
- 「イベントCG」「立ち絵」「背景」「キービジュアル」などは既知の`asset_type`へ正規化してよい。
- 未知の人物名やsubject IDを推測変換しない。
- world map / environment / UIのsubjectless assetは、Core側で正式対応していない限り人物Anchorをでっち上げて生成しない。

## 成功時の原則

MCP経路とrepository-native経路のどちらを使っても、style / subject / reference / policyの意味を同値に保つ。利用経路の違いを理由にCanon制約を弱めない。host-nativeかisolated generatorかという最終生成経路の違いでも`must_not_chain_from_candidate: true`を弱めない。
