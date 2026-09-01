# Proposal: Harden Proxy Reliability

## Why

A full reliability audit found structural and security defects across the runtime, configuration tooling, and repository. The most serious: when global auth is configured via `GLOBAL_AUTH_CONFIGS` but contains an empty array, or when env-based loading fails silently in edge cases, requests fall through to per-server logic that may allow unauthenticated access. Legacy `auth`/`authHeader` fields are still honored at the spec level even though runtime support was removed, so stale configs can behave differently than documented. Tooling is split between npm and Bun, two ESLint configs coexist, the Prettier config file contains escaped HTML entities and is not valid, and there is no CI. Scripts shell out through string interpolation with quoting hazards and nondeterministic temp-file names.

## What Changes

**Runtime (src/)**
- **Fail-closed global auth**: if global auth is configured (env or KV) but fails to load, parse, or validate, the worker returns 500 and never falls back to per-server or open access. Empty global auth config means "not configured", not "allow all".
- **Reject removed legacy auth fields**: server configs containing `auth` or `authHeader` fail validation with a clear error, forcing operators to migrate to `authConfigs`.
- **Redirect/header safety**: forwarded requests explicitly opt out of redirect following (`redirect: 'manual'` unless the caller specifies otherwise); header construction drops the dead no-op branch that builds an empty exclusion set.
- **Dead code cleanup**: remove duplicate `Authentication Header Security` requirement remnants in code paths, the unused `checkAuth` export if superseded, and the no-op `convertLegacyToMultiAuth`/`cleanupConfigForSaving` functions in scripts.

**Configuration tooling (scripts/)**
- **One validation path**: `update-proxy-config.ts` deletes its local `validateAuthConfigs` copy and imports `validateAuthConfigs` / `validateAuthConfig` from `src/config-validator.ts`, adding the duplicate-header check to the shared validator.
- **Secure deterministic scripts**: all `wrangler` invocations go through a helper that passes arguments as an array (no shell interpolation of key names); temp files use `crypto.randomUUID()`; restore rejects a backup file whose keys would overwrite the `global-auth-configs` key without confirmation.
- **Backup/import semantics**: backup writes a versioned document (`{ version: 1, exportedAt, entries }`); restore accepts both the new format and legacy bare `Record<string, unknown>` maps, and validates every entry before writing anything (all-or-nothing per run, reporting failures without partial writes).

**Repository / tooling**
- **Bun-only tooling**: delete `package-lock.json`; all scripts run through `bun`; README documents Bun as the only supported package manager.
- **One ESLint config**: delete `.eslintrc.cjs`; keep `eslint.config.js` (flat config) as the single source, updated to also lint `scripts/`.
- **Valid Prettier config**: rewrite `.prettierrc` with real JSON (it currently contains `&quot;` entities); add `.prettierignore` for lockfiles and node_modules.
- **Typecheck/lint scripts and tests**: `typecheck` covers `src` and `tests` via a shared tsconfig include; `lint` covers `src/`, `tests/`, `scripts/`; `format:check` added.
- **One check command**: `bun run check` runs typecheck, lint, format:check, and tests in sequence (fail-fast).
- **Coverage guard**: `test:coverage` enforces thresholds (80% lines/statements on `src/`) via `vitest.config.ts`; CI runs coverage.
- **CI**: GitHub Actions workflow on push/PR running `bun run check` with Bun.
- **Docs/spec consolidation**: remove legacy auth and multi-auth-guide references from `README.md`, `SPECS.md`; `MULTI_AUTH_GUIDE.md` is folded into README or deleted as part of implementation.

**BREAKING**: configs in KV containing `auth`/`authHeader` will be rejected (500) instead of being silently ignored. Operators must migrate to `authConfigs` before deploying. Backup files produced by the new script are versioned; the restore script still reads legacy backups.

## Impact

- Affected specs: `authentication`, `configuration-management`, `header-processing`, `build-tooling` (new)
- Affected code: `src/config-validator.ts`, `src/request-processor.ts`, `src/utils/global-auth.ts`, `src/header-processor.ts`, `scripts/*.ts`, `package.json`, `eslint.config.js`, `.prettierrc`, `vitest.config.ts`, `.github/workflows/ci.yml`, `README.md`, `SPECS.md`, `MULTI_AUTH_GUIDE.md`, root config files
- Not affected: KV key layout for per-server configs, secret interpolation semantics, routing logic
