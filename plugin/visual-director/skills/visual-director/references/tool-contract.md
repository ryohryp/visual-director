# Visual Director tool contract

## Tool

Use `visual.prepare_generation`. It is read-only and prepares context; it does not generate an image.

## Input

| Field | Required | Rule |
|---|---:|---|
| `project_id` | Yes | Use a configured project ID. Do not infer an unknown ID. |
| `asset_type` | Yes | Normalize the user's stated output type. |
| `subject_ids` | Yes | Supply one or more configured subject IDs. |
| `request_text` | Yes | Preserve the user's intent without adding Canon facts. |
| `scene_context` | No | Include only explicitly known scene or story state. |

Known aliases in the bundled adapter:

- Game title `渇きの底` maps to `project_id: bottom-of-thirst`.
- Character `水上沙耶` or `沙耶` maps to `subject_ids: [saya]`.
- Character `相馬` or `相馬健人` maps to `subject_ids: [souma]`, but generation must stop if the current Canon still marks the requested state as lacking an Approved Anchor.

Treat aliases for other configured games as unknown until their project configuration or conversation establishes them.

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

## Errors

| Code | Response |
|---|---|
| `PROJECT_CONFIG_MISSING` | Ask the user to start Visual Director with a repository path or projects config. |
| `PROJECT_NOT_FOUND` | Ask for a configured `project_id`. |
| `SUBJECT_NOT_FOUND` | Ask for a configured subject ID; do not substitute another subject. |
| `APPROVED_ANCHOR_NOT_FOUND` | Report that the subject or requested state has no Approved Anchor and stop. |
| `APPROVED_ANCHOR_INCOMPLETE` | Report the incomplete same-generation reference set and stop. |
| `REFERENCE_NOT_FOUND` | Report the missing Canon or Approved Anchor asset; do not use legacy or candidate assets. |
| `STYLE_LOCK_MISSING` | Report the incomplete Visual Canon and stop. |
| `INTERNAL_ERROR` | Report the failure and suggest checking the MCP server log; do not invent a package. |

Retry only after the missing or invalid input has been corrected explicitly.
