# Repository-native Anchor adoption

Issue #71 Phase 4 adds an Anchor adoption path that does not require MCP write access.

The candidate image must already exist inside the target game repository. Visual Director then reuses the existing Core adoption validation, updates the character Visual Canon, and refreshes `.visual-director/compiled-canon.json` in the same command flow.

```powershell
node dist/index.js adopt-anchor `
  --project-id bottom-of-thirst `
  --repo-path I:\04_develop\---The-Bottom-of-Thirst `
  --subject-id kamino_kyosuke `
  --candidate-path .visual-director/candidates/job-123/kamino.webp `
  --approve
```

For projects defined through the legacy/local project configuration, add `--projects-config <path>`.

The command intentionally requires `--approve`. It does not infer approval from the existence of a candidate, and it does not fall back to legacy or unrelated assets.

## Boundary

This path removes MCP write access from the adoption requirement, but it does not make ChatGPT itself a binary Git client. The image must first be committed or otherwise placed inside the game repository by an explicit repository write step. Once present, adoption is deterministic and validated by Visual Director Core.

Hosted Visual Director remains read-only. `visual.adopt_anchor` stays disabled there until a separately reviewed hosted write boundary is deliberately enabled.

## Compiled Canon freshness

A successful adoption automatically runs the same compiled Canon generation used by the Plus-first consumption path. This prevents the Canon update from leaving `.visual-director/compiled-canon.json` stale.
