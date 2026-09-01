<!-- OPENSPEC:START -->

# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:

- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:

- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

## Project Overview

Worker Proxy is a Cloudflare Workers-based reverse proxy routing requests to multiple downstream servers by URL path. Configuration lives in Cloudflare KV; secrets in Workers secrets. Written in TypeScript, Bun-only tooling.

Technical specs are canonical in `openspec/specs/`. The top-level `README.md` is the user-facing guide.

## Commands

All commands run through Bun (the only supported package manager):

- `bun install` — install dependencies
- `bun run check` — one command: typecheck, lint, format check, tests
- `bun run dev` — wrangler dev (local hot reload)
- `bun run build` — wrangler deploy --dry-run (validates the bundle)
- `bun run typecheck` — tsc over src, scripts, and tests
- `bun run lint` / `bun run lint:fix` — ESLint (flat config) over src, scripts, tests
- `bun run format:check` / `bun run format` — Prettier
- `bun run test` / `bun run test:watch` / `bun run test:coverage`
- `bun run update-config` — interactive KV configuration script
- `bun run backup-config` / `bun run restore-config` — KV backup/restore (see README)
- `bun run deploy` — wrangler deploy

## Code Style

- TypeScript strict mode; no `any`
- 2-space indent, single quotes, trailing commas, no semicolons, 100 char lines
- Tests live in `tests/` with `.test.ts` extension (Vitest, Node env)
- ESLint: flat config only (`eslint.config.js`); Prettier: `.prettierrc`
