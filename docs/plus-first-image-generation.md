# Plus-first image generation and conversation-context isolation

This document is the operational contract for image generation after repository-native / Plus-first Canon resolution.

The Game Repository and the exact Generation Package remain the source of truth. Conversation history is not a visual source of truth and must never silently become a generation parent.

## Native image generation gate

Before calling a host-native image generator such as ChatGPT image generation, evaluate the current image context against the exact `reference_assets` from the current Generation Package.

Generation MUST fail closed when any of the following is true:

- an uploaded/generated image outside the current Generation Package may enter the generation context;
- unrelated images exist in the conversation and the host cannot guarantee an explicit reference whitelist or a no-reference mode;
- the host would bind any reference path that is not present in the current Generation Package;
- the same wrong reference/image binding has occurred twice consecutively in the current context.

Do not assume that "new generation" means earlier conversation images are ignored.

If the context is unsafe, do not invoke native image generation in that conversation. Use a clean context whose image bindings can be guaranteed, or use the isolated local/tunnel generation path described below.

`policy.must_not_chain_from_candidate = true` applies at the final host-generation boundary as well as during Canon preparation. A Candidate, rejected asset, prior generated dashboard, UI mock, report, or other conversation image cannot become an implicit parent merely because it is visible in the conversation.

A generated dashboard/UI/report must not be extracted, cropped, or re-labelled as a background Candidate after a reference-contamination failure.

## Repeated wrong-reference stop rule

One wrong-reference result is treated as a binding/context failure and should trigger context review before another generation attempt.

If the same wrong-reference pattern occurs twice consecutively, stop generation in that context. Do not perform a third blind retry. Record or report it as a context/reference-binding problem instead of treating it as a prompt-quality problem.

## Isolated generation path

For requests that need a mechanically isolated reference boundary, the adopted path is local/tunnel `visual.generate_image`.

`visual.generate_image` delegates to `VisualDirectorCore.generateImage()` and therefore:

- resolves Canon from the explicitly supplied repository;
- builds a fresh Generation Package for the request;
- sends only repository assets listed in that Generation Package to the configured image generator;
- does not use ChatGPT conversation images as image inputs;
- writes the result only as a Candidate under `.visual-director/candidates/`;
- does not auto-approve or register the generated asset.

The hosted read-only MCP surface does not expose this generation tool and remains non-mutating.

## Background / aspect-ratio handling

The OpenAI image API accepts square, portrait, and landscape canvases. Visual Director resolves the generator canvas from explicit scene/composition requirements first and then from asset type.

- `16:9` / landscape primary composition -> `1536x1024`
- `9:16` / portrait primary composition -> `1024x1536`
- `1:1` / square -> `1024x1024`
- background-like asset types default to `1536x1024`
- other assets preserve the existing portrait default unless the request says otherwise

`1536x1024` is the supported landscape generation canvas, not an exact 16:9 output. When the Canon requires a 16:9 production background, review/crop the Candidate against that 16:9 contract after generation; never silently fall back to the old portrait-fixed generator behavior.

## Host-adapter contract

A host adapter that continues to use native image generation should call `evaluateNativeImageContext()` with:

- the current Generation Package reference paths;
- the exact references the host will bind;
- whether unrelated conversation images exist;
- whether the host can mechanically enforce the reference whitelist/no-reference mode;
- the count of consecutive reference-binding mismatches.

Only `{ allowed: true }` permits native generation. A blocked decision is terminal for that invocation and must not be bypassed by reconstructing references from conversation history.
