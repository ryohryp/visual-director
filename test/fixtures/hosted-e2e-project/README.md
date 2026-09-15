# Hosted E2E Canon Fixture

This fixture is the Visual Director-owned executable Canon contract used by Hosted MCP verification. It must stay independent from application repositories.

The minimum character preparation contract exercised by `visual.prepare_generation` is:

- `.visual-director/manifest.json` uses manifest version 1, canonical camelCase document keys, and a configured subject.
- `.visual-director/grand-design.json` is valid Grand Design schema version 1 for `hosted-e2e-fixture`. It intentionally does not define a `character_visual_anchor` asset contract so Approved-Anchor preparation preserves `grand_design_lock`.
- `docs/visual/style.md` contains both a `text` fenced style lock and a `Fixed Avoid Block` followed by a `text` fenced avoid block.
- `docs/visual/characters.md` contains the subject under its configured level-2 Canon heading and exposes the Approved Visual Anchor through the canonical `### Approved Visual Anchor` bullet syntax.
- The character facts file, world direction, and asset manifest are readable repository documents. World rules use bullets so they enter scene requirements.
- The configured Global Visual Reference and Approved Visual Anchor exist as regular repository files.
- Approved-Anchor preparation returns `must_use_approved_anchor: true`, forbids Candidate chaining, and requires review after generation.

`test/hosted-e2e-fixture.test.ts` runs this fixture through the same Visual Director Core/catalog/Canon adapter path used by Hosted preparation and includes a fail-closed regression check for a missing required style section.
