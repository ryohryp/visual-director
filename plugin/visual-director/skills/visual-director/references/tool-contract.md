# Visual Director tool contract

## Tool

Use `visual.prepare_generation` to prepare context; it does not generate an image. If the server returns `PROJECT_CONFIG_MISSING` and the user explicitly supplied a local clone path, call `visual.configure_project` first.

Use `visual.adopt_anchor` only after the user explicitly approves the exact candidate. Pass its existing repository-relative path and `approval: "approve"`. The tool registers that file under the subject's `Approved Visual Anchor` Canon heading. It refuses missing or out-of-repository files, unknown subjects, and replacement of a different existing Approved Anchor.

`visual.configure_project` validates and binds a known project to a local repository directory for the current MCP server process. It is runtime-only: it does not write the repository or persist across restart. Do not infer a path or configure a project that the user did not identify.

A successful `visual.prepare_generation` result is a **required gate** before image generation. If preparation fails, do not replace it with assistant memory, a hand-written prompt, another character's Anchor, a legacy asset, or a previous candidate image.

## Input

| Field | Required | Rule |
|---|---:|---|
| `project_id` | Yes | Use a configured project ID. Do not infer an unknown ID. |
| `asset_type` | Yes | Normalize the user's stated output type. New Visual Anchors use `character_visual_anchor`. |
| `subject_ids` | Yes | Supply one or more configured subject IDs or a safe bundled alias. |
| `request_text` | Yes | Preserve the user's intent without adding Canon facts. |
| `scene_context` | No | Include only explicitly known scene or story state. |

Known aliases in the bundled `bottom-of-thirst` adapter include:

- Game title `渇きの底` maps to `project_id: bottom-of-thirst` in the skill/client layer.
- `水上沙耶` / `沙耶` -> `saya`
- `相馬健人` / `相馬` -> `souma`
- `氷川瑠花` / `瑠花` -> `hikawa_ruka`
- `鏡玲央` / `玲央` -> `kagami`
- `鬼頭厳山` / `鬼頭` -> `kitou`
- `御子柴徹` / `御子柴` -> `mikoshiba`
- `神野恭介` / `神野` / `恭介` / `Kamino Kyosuke` -> `kamino_kyosuke`
- `visual_anchor`, `visualanchor`, `character_anchor` -> `character_visual_anchor`

Unknown aliases remain unknown; do not fuzzy-match or substitute a similar character.

## Successful result

Preserve these groups as distinct constraints:

- `prompt_package.style_lock`
- `prompt_package.subject_lock`
- `prompt_package.scene_requirements`
- `prompt_package.allowed_changes`
- `prompt_package.forbidden_changes`
- `prompt_package.avoid_block`
- `reference_assets`
- `policy`

Do not flatten allowed and forbidden changes into one prose prompt that loses their meaning.

For a new Visual Anchor, `subject_lock` must contain structured character facts plus the authoritative new-anchor requirements. If either is missing, treat preparation as incomplete and stop.

## Errors

| Code | Response |
|---|---|
| `PROJECT_CONFIG_MISSING` | If the user explicitly supplied a local clone path, call `visual.configure_project` once and retry preparation. Otherwise ask the user to start Visual Director with a repository path or projects config. |
| `PROJECT_REPOSITORY_INVALID` | Report that the supplied repository path is missing, unreadable, or not a directory; do not retry with a guessed path. |
| `PROJECT_NOT_FOUND` | Ask for a configured `project_id`. |
| `SUBJECT_NOT_FOUND` | Ask for a configured subject ID; do not substitute another subject. |
| `APPROVED_ANCHOR_NOT_FOUND` | Report that the subject or requested state has no Approved Anchor and stop unless the exact request is a supported new `character_visual_anchor`. |
| `APPROVED_ANCHOR_INCOMPLETE` | Report the incomplete same-generation reference set and stop. |
| `NEW_ANCHOR_REQUIREMENTS_NOT_CONFIGURED` | Report the missing per-character Anchor requirements and stop. |
| `NEW_ANCHOR_REQUIREMENTS_EMPTY` | Report the empty Anchor requirements and stop. |
| `NEW_ANCHOR_CANON_INCOMPLETE` | Report the missing critical character facts and stop. Never fill them from memory. |
| `REFERENCE_NOT_FOUND` | Report the missing Canon or Approved Anchor asset; do not use legacy or candidate assets. |
| `CANON_READ_FAILED` | Report the unreadable Canon/requirements file and stop. Do not hand-write a substitute Generation Package. |
| `GLOBAL_STYLE_INCOMPLETE` | Report the incomplete Visual Canon and stop. |
| `INTERNAL_ERROR` | Report the failure and suggest checking the MCP server log; do not invent a package. |

Retry only after the missing or invalid input has been corrected explicitly.
