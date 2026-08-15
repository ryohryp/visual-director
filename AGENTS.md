# Visual Director Agent Instructions

This repository is the project-specific source of truth for Visual Director implementation work.

## Screenshot and image-request routing

When the user supplies a screenshot of Visual Director and comments on how the screen looks or behaves, treat it as an implementation/debugging report by default.

Examples that MUST be interpreted as UI implementation feedback unless the user explicitly asks for image generation or image editing:

- "画像の位置がよくない"
- "表示がおかしい"
- "レイアウトが崩れている"
- "この画面を直して"
- "スマホだと切れている"
- "この画像が見切れている"

For these requests:

1. Inspect the current repository implementation first.
2. Identify the relevant route/component/CSS/data-loading code.
3. Change the implementation, not the screenshot or underlying image asset, unless the user explicitly asks to modify the asset itself.
4. Add or update regression coverage when practical.
5. Verify existing related behavior is not regressed.

Do NOT invoke image generation or image editing merely because a screenshot or image is present in the conversation.

Image generation/editing is appropriate only when the user explicitly asks to create, generate, draw, mock up, edit, retouch, replace, restyle, or otherwise modify an image asset itself.

## Context before tool selection

Before selecting a tool, classify the user's request using the active project context:

- UI display/layout/behavior problem -> inspect and modify code.
- Repository/configuration/runtime problem -> inspect repository and deployment state.
- Asset-generation request -> use the image-generation workflow.
- Existing asset modification request -> use image editing only when explicitly requested.

If wording is ambiguous but the surrounding conversation is clearly about implementation/debugging, prefer repository inspection over image generation.

## Recovery after a mistaken action

If a tool was invoked incorrectly:

1. Stop that action path immediately.
2. Re-evaluate the user's original intent from the conversation context.
3. Do not repeat the same tool invocation unless the user explicitly requests it.
4. Continue with the correct next implementation step when it is safe and reversible.
5. Explain the correction briefly and concretely.

A generic apology is not sufficient recovery if the requested implementation work can still be completed.

## Change discipline

- Prefer the smallest change that solves the reported problem.
- Preserve working behavior outside the affected view.
- For shared CSS, check whether a local override is safer than changing global thumbnail behavior.
- For hosted behavior, verify Vercel constraints and runtime behavior where relevant.
- Treat code, tests, configuration, and project docs in this repository as authoritative over conversational memory.
