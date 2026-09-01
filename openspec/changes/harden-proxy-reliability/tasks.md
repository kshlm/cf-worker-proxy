# Tasks: Harden Proxy Reliability

## 1. Runtime: fail-closed auth and legacy rejection

- [ ] 1.1 Write failing test: `GLOBAL_AUTH_CONFIGS` set to invalid JSON returns 500 and never falls back to per-server or open access (`tests/global-auth.test.ts`)
- [ ] 1.2 Write failing test: `GLOBAL_AUTH_CONFIGS` = `[]` (empty array) is treated as configured; server without per-server auth gets 401, not open access
- [ ] 1.3 Write failing test: global auth failing secret interpolation returns 500 instead of degrading to no-global-auth
- [ ] 1.4 Fix `src/utils/global-auth.ts` so any load/parse/validate/interpolation failure with a configured source returns an error result consumed as 500 by `src/request-processor.ts` (make tests from 1.1–1.3 pass)
- [ ] 1.5 Write failing test: server config containing `auth` or `authHeader` is rejected with error naming the fields (`tests/index.test.ts`)
- [ ] 1.6 Add legacy-field rejection to `validateProcessedConfig` in `src/config-validator.ts` (make 1.5 pass)

## 2. Runtime: redirect/header safety and dead code

- [ ] 2.1 Write failing test: backend request is created with `redirect: 'manual'`
- [ ] 2.2 Change `src/request-processor.ts` to pass `redirect: 'manual'` for the backend request (make 2.1 pass)
- [ ] 2.3 Remove dead branch in `processHeadersForProxy` (`src/header-processor.ts`) where both sides of the `allAuthConfigs.length > 0` conditional are identical; existing tests cover behavior
- [ ] 2.4 Remove no-op `convertLegacyToMultiAuth` and `cleanupConfigForSaving` from `scripts/update-proxy-config.ts` and their exports/tests

## 3. Shared validation path

- [ ] 3.1 Write failing test in `tests/` (new `tests/config-validator.test.ts` or extend existing): `validateAuthConfigs` rejects duplicate header names case-insensitively
- [ ] 3.2 Add duplicate-header check to `src/config-validator.ts` `validateAuthConfigs` (make 3.1 pass)
- [ ] 3.3 Delete script-local `validateAuthConfigs` from `scripts/update-proxy-config.ts`; import the shared validator; update `tests/update-proxy-config.test.ts` accordingly

## 4. Scripts: secure and deterministic

- [ ] 4.1 Write failing tests: `runWrangler` passes arguments via `execFileSync` array form (no shell string), temp file names use `crypto.randomUUID()` (`tests/update-proxy-config.test.ts`)
- [ ] 4.2 Refactor `scripts/update-proxy-config.ts` to `execFileSync('wrangler', args)` and UUID temp files (make 4.1 pass)
- [ ] 4.3 Write failing tests for backup format `{ version: 1, exportedAt, entries }` and restore accepting both versioned and legacy bare-map formats
- [ ] 4.4 Update `scripts/backup-config.ts` and `scripts/restore-config.ts` accordingly; restore validates every entry with the shared validator before writing, reports per-key failures, exits non-zero on any failure (make 4.3 pass)
- [ ] 4.5 Restore prompts before overwriting the `global-auth-configs` key; `--yes` flag skips the prompt for non-interactive use

## 5. Tooling consolidation

- [ ] 5.1 Delete `package-lock.json`; confirm `bun.lock` is the only lockfile
- [ ] 5.2 Delete `.eslintrc.cjs`; extend `eslint.config.js` to cover `src/`, `tests/`, `scripts/`
- [ ] 5.3 Rewrite `.prettierrc` as valid JSON (singleQuote, trailingComma all, printWidth 100, tabWidth 2, semi false); add `.prettierignore` (node_modules, package-lock.json, bun.lock, openspec/)
- [ ] 5.4 Extend `tsconfig.json` include (or add `tsconfig.check.json`) so `bun run typecheck` covers `src` and `tests`
- [ ] 5.5 Add scripts to `package.json`: `format:check`, `check` (typecheck && lint && format:check && test); fix `lint` to drop stale `--ext` usage with flat config
- [ ] 5.6 Add coverage thresholds (80% lines/statements on `src/`) to `vitest.config.ts`; run `bun run test:coverage` and tune exclusions only if a file is untestable-by-design (document exclusion reason inline)

## 6. CI

- [ ] 6.1 Add `.github/workflows/ci.yml`: Bun setup, `bun install --frozen-lockfile`, `bun run check`, on push and PR to main
- [ ] 6.2 Verify workflow YAML parses (local `bun` run of the same commands passes)

## 7. Docs and specs

- [ ] 7.1 Delete `MULTI_AUTH_GUIDE.md`; fold any still-relevant config guidance into `README.md`
- [ ] 7.2 Update `README.md`: Bun-only setup, legacy field rejection and migration note, `bun run check`, CI badge/reference
- [ ] 7.3 Update `SPECS.md`: remove legacy auth references, note rejection behavior and `redirect: manual`
- [ ] 7.4 Update `CLAUDE.md`/`CRUSH.md`/`AGENTS.md` if they reference npm, `.eslintrc.cjs`, or legacy auth

## 8. Verification

- [ ] 8.1 `bun run check` passes end to end
- [ ] 8.2 `bun run test:coverage` meets thresholds
- [ ] 8.3 `openspec validate harden-proxy-reliability --strict` passes
- [ ] 8.4 Manual smoke: `wrangler dev` with a migrated config (authConfigs only) — 200 on valid auth, 401 on missing, 500 on legacy-field config
