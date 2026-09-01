# Design: Harden Proxy Reliability

## Context

The audit (branch `fix/reliability-hardening`) found the issues listed in `proposal.md`. Runtime code is small (~1000 lines) and tested with Vitest; scripts are Bun-run TypeScript shelling out to `wrangler`. OpenSpec specs under `openspec/specs/` are treated as current truth, but several still document legacy behavior the runtime removed in commit `1e90851`.

## Goals / Non-Goals

- Goals: fail-closed auth, single validation path, deterministic tooling, one config per tool, CI, spec truth aligned with runtime.
- Non-Goals: no new runtime dependencies, no change to KV key layout, no performance work, no request logging/observability additions.

## Decisions

### D1: Fail-closed global auth

Current behavior: `loadGlobalAuthConfiguration` returns `hasGlobalAuth: false` with no error in several paths, and `checkTwoTierAuth` then falls through to per-server logic. An env var set to `[]` (empty array) parses successfully and yields zero configs, indistinguishable from "not configured" — with no per-server auth this allows unauthenticated access even though the operator believes global auth is active.

Decision: treat "global auth configured" as "env var present and non-empty after parse, or KV key present and non-empty". Any load/parse/validate failure while a configured source exists returns 500 (`createConfigInvalidResponse`). Only a genuinely absent source (no env var, no KV key) means global auth is off. The `Env.GLOBAL_AUTH_CONFIGS` presence check moves before JSON parse so `[]` is still "configured" and yields the two-tier required-auth behavior via `checkTwoTierAuth` (empty global configs + configured → per-server auth must pass, and servers with no per-server auth are denied).

Wait — `checkTwoTierAuth` currently allows access when global auth is configured but has empty configs only if per-server auth passes. That is the correct fail-closed semantics for an empty global array. The fix is narrowly: parse errors, validation errors, and secret-interpolation errors while a source exists must return 500 rather than silently degrading to "no global auth".

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

Specs still document legacy auth (`Legacy Single-Header Authentication`, `Authentication Logic Merging`), a duplicated `Authentication Header Security` requirement (appears twice in `authentication/spec.md`), and multi-auth migration behavior removed at runtime. Deltas in `specs/` update `authentication`, `configuration-management`, `header-processing`, and add `build-tooling` for repo/tooling requirements. Docs: `MULTI_AUTH_GUIDE.md` deleted (its still-relevant content folds into README's config section); `SPECS.md` gets a legacy-field rejection note.

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
