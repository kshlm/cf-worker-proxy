# CRUSH.md for Worker Proxy (Cloudflare Workers)

## Project Overview
Worker Proxy is a Cloudflare Workers-based proxy server for routing requests to multiple downstream servers based on URL paths. Configuration uses Cloudflare KV for servers and auth. Written in TypeScript.

Project technical specs are defined in SPECS.md. An initial implementation plan is provided in PLAN.md.


## Commands

### Development
- Start dev server: `wrangler dev` (runs locally with hot reload)
- Build: `wrangler build` (bundles worker script; usually not needed for JS/TS)
- Typecheck: `bun run typecheck` (if using TypeScript: `tsc --noEmit`)

### Linting & Formatting
- Lint: `bun run lint` (uses ESLint; checks JS/TS for style/errors)
- Format: `bun run format` (uses Prettier; auto-formats code)
- Lint-fix: `bun run lint:fix` (auto-fixes lint issues)

### Testing
- Run all tests: `bun run test` (uses Vitest/Jest; runs in Bun.js or worker env)
- Run single test: `bun run test -- path/to/test.spec.ts` (e.g., `bun run test -- src/handlers.test.ts`)
- Watch mode: `bun run test:watch` (re-runs on file changes)
- Coverage: `bun run test:coverage` (generates coverage report)

### Deployment
- Deploy: `wrangler deploy` (uploads to Cloudflare; sets up KV bindings)
- Deploy with env: `wrangler deploy --env production`
- Publish: `wrangler publish` (alias for deploy)

### Other
- Generate types for KV: `wrangler types` (creates KV types)
- Tail logs: `wrangler tail` (streams invocation logs)

## Code Style Guidelines

### Language & Typing
- Use TypeScript for all new code (strict mode enabled).
- Infer types where possible; explicitly type complex interfaces/props.
- No `any` types; use `unknown` for untyped data.

### Imports
- Prefer named imports: `import { fetch } from 'whatwg-fetch';`
- Group imports: Third-party > Local > Side-effect (e.g., CSS).
- Relative paths for local: `./utils/helper` (no leading /).
- Use aliases if configured (e.g., `@/src` via tsconfig/vite).

### Formatting
- Prettier: 2-space indent, single quotes, trailing commas.
- Line length: 100 characters max.
- No semicolons in JS/TS unless required.

### Naming Conventions
- Variables/Functions: camelCase (e.g., `handleRequest`).
- Constants: UPPER_SNAKE_CASE (e.g., `MAX_RETRIES`).
- Classes/Interfaces: PascalCase (e.g., `ProxyHandler`).
- Files: kebab-case for non-components (e.g., `proxy-router.ts`), PascalCase for exports.

### Error Handling
- Use try/catch for async ops; throw custom errors (e.g., `new ProxyError('Invalid path')`).
- Log errors with context: `console.error('Proxy failed:', { path, error })`.
- Return Response with status 500 for unhandled errors; never expose internals.
- Validate inputs early (e.g., URL paths, auth headers) with guards.

### Best Practices
- Workers: Export single `fetch` handler; use `export default { fetch }`.
- KV: Bind namespace in wrangler.toml; use `env.KV.get(key)`.
- Auth: Compare headers securely (no logging secrets).
- No external deps unless minimal; prefer Workers Runtime APIs.
- Tests: Use `vi.mock` for Workers APIs; test edge cases (auth fail, invalid paths).

## Cursor/Copilot Rules
None specified in .cursor/rules/ or .github/copilot-instructions.md. Follow above guidelines.

## Notes
- Setup: Run `bun install` for deps (assumes package.json with wrangler, typescript, vitest, eslint, prettier).
- Extend this file as conventions evolve.
