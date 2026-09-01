# Design: Harden Proxy Reliability

## Context

The audit (branch `fix/reliability-hardening`) found the issues listed in `proposal.md`. Runtime code is small (~1000 lines) and tested with Vitest; scripts are Bun-run TypeScript shelling out to `wrangler`. OpenSpec specs under `openspec/specs/` are treated as current truth, but several still document legacy behavior the runtime removed in commit `1e90851`.

## Goals / Non-Goals

- Goals: fail-closed auth, single validation path, deterministic tooling, one config per tool, CI, spec truth aligned with runtime.
- Non-Goals: no new runtime dependencies, no change to KV key layout, no performance work, no request logging/observability additions.

## Decisions

### D1: Fail-closed global auth

Current behavior: `loadGlobalAuthConfiguration` returns `hasGlobalAuth: false` in several failure paths, and `checkTwoTierAuth` then falls through to per-server logic. An env var set to `[]` (empty array) parses successfully and yields zero configs, indistinguishable from "not configured" — with no per-server auth this allows unauthenticated access even though the operator believes global auth is active.

Decision: "global auth configured" means a source exists — `GLOBAL_AUTH_CONFIGS` env var present (including an empty array) or the KV key `global-auth-configs` present. The loader distinguishes three outcomes:

1. **Source absent** (no env var, no KV key): global auth off, per-server logic only.
2. **Source present, loads and validates cleanly** (empty or not): `hasGlobalAuth: true` with the parsed configs (possibly `[]`). This flag threads into `checkTwoTierAuth`, which keeps its existing required-auth semantics: with global auth configured and zero global configs, only valid per-server auth grants access, and servers without per-server auth are denied.
3. **Source present but load/parse/validate/interpolation fails**: returns an error result the request pipeline converts to 500. Never degrades to outcome 1 or open access.

The runtime change is narrow: `GlobalAuthResult` carries an explicit configured/absent distinction, and `checkTwoTierAuth` branches on that flag rather than on `configs.length > 0`.

### D2: Reject legacy auth fields

`ServerConfig` type no longer contains `auth`/`authHeader` (already removed in `src/types.ts`). `validateProcessedConfig` gains a check: if the parsed KV object has own properties `auth` or `authHeader`, return a validation error naming the fields and pointing at `authConfigs`. This is deliberate rejection at the trust boundary, not silent dropping.

### D3: One validation path

`scripts/update-proxy-config.ts` has a local `validateAuthConfigs` that is stricter in one way (duplicate header names) and looser in others than `src/config-validator.ts`. Move the duplicate-header check into `src/config-validator.ts`'s `validateAuthConfigs`, then delete the script-local copy and import the shared one. The script already imports types from `src/`, so no new coupling.

### D4: Redirect/header safety

`request-processor.ts` builds the backend `Request` with `redirect: request.redirect`. Workers default to `redirect: 'follow'`, meaning a downstream 3xx makes the worker silently re-issue the request to the `Location` target, re-sending all forwarded headers (including injected auth headers from config) to an arbitrary host. Decision: pass `redirect: 'manual'` explicitly so redirect decisions stay with the proxy client. `ponytail:` note — a full allowlist of redirect targets was considered and rejected; `manual` is one line and removes the credential-leak path entirely.

Also remove the dead branch in `processHeadersForProxy` where `allAuthConfigs.length > 0` guards a call that is identical to the else branch.

### D5: Secure deterministic scripts

- Replace `execSync`-with-string with `execFileSync('wrangler', args)` — removes quoting/key-injection hazards without adding a dependency.
- Temp files: `crypto.randomUUID()` instead of `Date.now() + Math.random()`.
- Restore confirms before overwriting the `global-auth-configs` key (prompt, abort on non-yes).

### D6: Backup/import semantics

Backup format: `{ version: 1, exportedAt: ISO string, entries: Record<string, unknown> }`. Restore accepts version-1 documents and legacy bare maps (detect via `entries` property). Restore validates each entry with the shared validator before writing; writes proceed key-by-key but failures are collected and reported with a non-zero exit, and the summary lists which keys failed. Full two-phase all-or-nothing was rejected: KV has no transactions, and per-key failure reporting is more useful for operators.

### D7: Tooling consolidation

- Bun-only: delete `package-lock.json` (Bun uses `bun.lock`), scripts already run via bun.
- ESLint: flat config `eslint.config.js` only; `.eslintrc.cjs` deleted. Add `scripts/**/*.ts` to lint targets.
- Prettier: `.prettierrc` currently contains literal `&quot;` entities — invalid. Rewrite as real JSON matching project conventions (singleQuote, trailingComma all, printWidth 100, tabWidth 2, no semicolons via `"semi": false`).
- `bun run check` = `typecheck && lint && format:check && test`. CI runs this single command.
- Coverage: `@vitest/coverage-v8` already installed; add `coverage.thresholds` to `vitest.config.ts`. Threshold set at 80% lines/statements; tests currently pass with headroom on `src/` (tests cover via integration paths; if thresholds prove unattainable for utils, exclusions are listed explicitly in the config with a reason).

### D8: Spec consolidation

Specs still document legacy auth (`Legacy Single-Header Authentication`, `Authentication Logic Merging`) and reference legacy fields inside `No Authentication Required`, `Secret Interpolation in Authentication`, and `Authentication Header Security`; the same legacy references appear in `header-processing/spec.md`'s exclusion scenarios. Deltas in `specs/` update `authentication`, `configuration-management`, `header-processing`, and add `build-tooling` for repo/tooling requirements. Docs: `MULTI_AUTH_GUIDE.md` deleted (its still-relevant content folds into README's config section); `SPECS.md` gets a legacy-field rejection note; `openspec/project.md` drops its legacy auth references (single-header auth, `auth`/`authHeader` in the Authentication Model section).

## Risks / Trade-offs

- **BREAKING** config rejection (D2) → mitigated by clear error message and README migration note; deployment is manual (`wrangler deploy`), operator controls timing.
- `redirect: 'manual'` changes client-visible behavior for downstream 3xx → proxies are expected to surface redirects; documented in proposal.
- Coverage thresholds may need tuning after first CI run → thresholds live in one config file, adjustable.
- Restore script confirmation prompt breaks non-interactive use → `--yes` flag provided.

## Migration Plan

1. Land tooling/CI changes (no runtime impact).
2. Operators migrate KV configs: run `bun run update-config` and re-save any server with legacy fields (script rejects them, forcing cleanup), or use backup/restore round-trip.
3. Deploy worker with fail-closed auth and legacy-field rejection.
4. Rollback: previous worker version via `wrangler rollback`; no data migration needed for rollback since legacy fields are preserved, not deleted.

## Open Questions

- None blocking. Coverage threshold number (80%) is a starting point, tunable in review.
