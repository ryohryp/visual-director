# ADR-0001: Repository-owned Canon and request-scoped project resolution

- Status: Accepted (architecture direction; implementation pending)
- Date: 2026-11-06
- Applies to: Visual Director Core, MCP, Hosted, CLI, and Web read models

## Context

Visual Director exists to compile a project's Visual Canon and Approved Visual Anchors into a fail-closed Generation Package, not to maintain a second authoritative copy of project-specific visual state.

The current repository is already repository-first for generic games, but it still bundles a default Project Catalog, a project-specific Personal Orbit definition/adapter, and backward-compatible runtime project bindings. The compiler also extracts Approved Anchors from Markdown headings. A legitimate change to a game's Canon layout can therefore break preparation even when the game itself has correctly adopted a new generation of Anchors.

`ryohryp/---The-Bottom-of-Thirst` illustrates the risk: its current Character Visual Canon describes a unified v3 cast and a table of v3 Anchor paths, while the repository manifest still points to per-subject Markdown headings and its compiled Canon contains v2 Anchor paths. On 2026-11-06, hosted read-only preparation for `saya`, `souma`, `hikawa_ruka`, and `kagami` returned `APPROVED_ANCHOR_NOT_FOUND`. This is a project-contract drift, not a reason to fall back to v2. The project's source files must be reconciled in that project repository.

Separately, a Generation Package currently identifies reference assets by repository-relative paths, and the generation fingerprint hashes the Package JSON. Replacing bytes at the same path does not necessarily change that fingerprint. Hosted GitHub reads also use a mutable catalog `ref` independently for each file request, rather than first resolving one immutable repository snapshot.

## Decision

1. **Project repository is the only authority for project visual state.** Visual Canon, Grand Design, Approved Anchor identities/paths, Required Asset Plan, generation history, Candidate state, and production assets live in the owning project repository. Visual Director must not embed project-specific character, style, or Anchor facts in its production code or a central state store.
2. **Visual Director owns generic behavior only.** It owns schemas, validation, Canon compilation, Generation Package contracts, safe reference binding, and read-only presentation/reconciliation. MCP, Web, and CLI remain adapters; they must not independently reinterpret Canon.
3. **Repository selection is request-scoped.** The target is conceptually `(project_id, repository locator, requested ref)`, resolved once for the request. Local paths and GitHub repository locators are transport-specific inputs, not prompt text. A Project Catalog may offer an optional saved list for UX/backward compatibility, but it is neither a prerequisite for Core execution nor a store of Canon facts. `visual.configure_project` remains a transitional compatibility path until clients are migrated.
4. **All reads within a preparation use one immutable snapshot.** Resolve a mutable branch/tag ref to a commit SHA before reading Canon and references. Preserve the resolved revision and content digests for the canonical inputs and required reference images in a versioned generation contract. The final image-generation boundary must verify the bound asset bytes match that contract; paths alone do not establish identity.
5. **One authoritative field per machine-readable fact.** Approved Anchor identity/path should have one project-owned machine-readable authority. Human-readable Canon may explain it, but duplicate hand-maintained tables or compiled representations must be derived or checked for consistency. `.visual-director/compiled-canon.json`, where retained, is a regenerable output and never overrides current sources.
6. **Fail closed on incompatibility.** Missing/ambiguous Canon, unapproved or changed references, stale compiled output, unsupported schema versions, and unauthorized project locators are explicit errors. Never recover by using legacy/Candidate assets, remembered images, another character, or cached project data.
7. **Hosted authorization is separate from discovery.** Request-scoped locators do not grant arbitrary access through service credentials. Hosted reads must be authorized to access the requested repository; hosted writes require an authenticated and separately authorized destination and a narrowly scoped credential. A repository allowlist or equivalent server-side policy is a security boundary, not an authoritative Project Catalog. Existing hosted writes remain restricted to reviewed Approved Anchor adoption.
8. **Workflow state stays with the project.** Candidate registration, explicit human approval, and production promotion update project-owned state through reviewed write paths. Stateless means Visual Director does not own durable project state; it does not mean generation history is discarded.
9. **Visual Director-owned fixtures test the engine.** Blocking CI/Hosted E2E uses fixture Canon owned by this repository. Real project smoke tests are separate and must not make deployment fail merely because a game's Canon legitimately changes.

## Target responsibility boundary

| Owner | Data / behavior |
| --- | --- |
| Project repository | Manifest, Canon, Grand Design, Anchor files, asset plan, workflow records, production files |
| Visual Director Core | Repository snapshot resolution, schema validation, Canon compilation, immutable Generation Package |
| Generation adapter | Bind only verified Package references, invoke a generator, return a Candidate |
| Workflow service | Reconcile assets, record generation lineage, submit explicitly approved project changes |
| MCP / Web / CLI | Request/response transport, UI, diagnostics; no independent Canon interpretation |
| Hosted access policy | Authorized repository scope and narrowly approved mutation capability; no Canon data |

## Migration slices (in order)

### 0. Repair existing project-contract drift without weakening the engine

- In `ryohryp/---The-Bottom-of-Thirst`, reconcile the current v3 Canon, repository manifest, and derived compiled Canon. Keep v3 as the authority; never restore v2 references as a fallback.
- Add project-owned consistency checks for all current subjects, actual Anchor files, obsolete subject removal, and compiled output freshness.
- Keep this work in the game repository. Visual Director may add a generic regression fixture if a parser/contract change is needed, but must not import the game's v3 facts.

### 1. Make repository selection independent of the bundled Catalog

- Introduce a request-scoped repository target for local and GitHub resolution and route it through a single Core resolver.
- Retain Catalog lookup as an optional convenience and preserve existing MCP inputs during migration; do not accept request-selected arbitrary GitHub URLs through privileged hosted credentials.
- Prove unknown/unauthorized projects fail closed and project A cannot resolve project B's assets.

### 2. Remove bundled project-specific Canon knowledge

- Move Personal Orbit style, subject, and Approved Anchor definitions into the Personal Orbit repository with a compatible project-owned manifest/Canon contract.
- Switch it to a generic adapter without changing its current visual identity or asset behavior; delete the specialized implementation only after parity tests pass.
- Remove duplicate project mappings and obsolete examples after callers have migrated.

### 3. Version and pin generation inputs

- Resolve GitHub refs to immutable revisions for each preparation; pin every read in that operation to the same revision.
- Extend the Generation Package contract with source revision and canonical/reference content digests; version the contract rather than silently changing its shape.
- Ensure the generator verifies reference bytes before execution. A changed reference must change its generation identity or fail validation, including when its path is unchanged.
- Keep approved/rejected lineage and human review semantics unchanged.

### 4. Clarify internal modules and documentation

- Keep one repository and deployment. Separate pure preparation, read-model reconciliation, and write-capable workflow operations internally without introducing a database or generalized plugin framework.
- Update README, connection examples, and issue status after the new paths actually work. Retire `visual.configure_project` only with client migration evidence.

## Acceptance criteria

- A new compatible project can prepare a Generation Package from an explicit authorized repository target without adding its Canon to the Visual Director repository or registering it in a mandatory Catalog.
- Local and Hosted preparation share the same schema/Canon behavior and resolve one immutable project revision per request.
- The Package identifies its Canon/reference contents; changing a reference file in place cannot silently reuse the same verified generation identity.
- Project-specific Canon changes are validated in the owning project repository; Visual Director's blocking Hosted E2E remains fixture-backed.
- No cross-project Canon leakage, no Candidate/legacy fallback, and no write through an unauthorized hosted repository target.
- Existing callers continue to work during staged migration, and Approved Anchor adoption still requires explicit human approval.

## Consequences and non-goals

This reduces duplicate authority and makes generation reproducible, but requires a compatibility migration for existing MCP clients and project adapters. Some project repositories will need to adopt a consistent machine-readable Anchor contract. We accept that work rather than retaining duplicated project facts in Visual Director.

This ADR does **not** authorize a broad rewrite, a persistent database, a new object store, automatic Canon rewriting, autonomous approval/promotion, or unrestricted Hosted repository access.

## Current implementation evidence

- `src/projects/catalog.ts` and `projects.catalog.json`: bundled project mappings.
- `src/projects/catalog-runtime.ts`: Catalog-dependent Hosted resolution and special-case Personal Orbit routing.
- `src/projects/personal-orbit/definition.ts` / `adapter.ts`: project-specific visual facts in Visual Director.
- `src/projects/canon/adapter.ts` / `repository-manifest.ts`: Markdown-heading-based Anchor lookup.
- `src/projects/repository-source.ts`: GitHub Contents requests use catalog ref, not a per-operation pinned commit.
- `src/core/image-generation-service.ts`: fingerprint of Package JSON, with path-only reference assets.
- `src/compiled-canon.ts`: derived Canon serializer/compiler.
- `scripts/verify-hosted-mcp.mjs` and `test/fixtures/hosted-e2e-project/`: engine-owned Hosted E2E fixture (already implemented, see #147).
- `docs/hosted-write-boundary.md`: separate authorization requirements for hosted mutations.
