## ADDED Requirements

### Requirement: Bun-Only Tooling
The project SHALL use Bun as its only package manager and script runner.

#### Scenario: Single lockfile
- **WHEN** inspecting the repository root
- **THEN** `bun.lock` SHALL be the only lockfile present
- **AND** `package-lock.json` SHALL NOT exist

#### Scenario: Scripts run through Bun
- **WHEN** running any project script (`dev`, `test`, `lint`, config scripts)
- **THEN** it SHALL execute via `bun` or Bun-compatible tooling
- **AND** documentation SHALL describe Bun as the only supported package manager

### Requirement: Single Lint and Format Configuration
The project SHALL have exactly one ESLint configuration and one valid Prettier configuration.

#### Scenario: One ESLint config
- **WHEN** inspecting the repository root
- **THEN** only the flat ESLint config (`eslint.config.js`) SHALL exist
- **AND** legacy `.eslintrc*` files SHALL NOT exist
- **AND** linting SHALL cover `src/`, `tests/`, and `scripts/`

#### Scenario: Valid Prettier config
- **WHEN** Prettier loads `.prettierrc`
- **THEN** the file SHALL parse as valid JSON
- **AND** enforce single quotes, trailing commas, 100 char print width, 2-space indent, no semicolons

### Requirement: One Check Command
The project SHALL provide a single command that runs all local verification.

#### Scenario: Check runs everything
- **WHEN** running `bun run check`
- **THEN** typecheck, lint, format check, and tests SHALL run in sequence
- **AND** the command SHALL fail fast on the first failing step

#### Scenario: Typecheck covers tests
- **WHEN** running typecheck
- **THEN** both `src/` and `tests/` SHALL be type-checked

### Requirement: Coverage Guard
The test coverage command SHALL enforce minimum coverage thresholds.

#### Scenario: Threshold enforcement
- **WHEN** running the coverage command
- **THEN** lines and statements coverage on `src/` SHALL meet the configured threshold (80%)
- **AND** the command SHALL fail if coverage drops below the threshold

### Requirement: Continuous Integration
The project SHALL run its check command in CI on push and pull requests.

#### Scenario: CI runs checks
- **WHEN** a push or pull request targets the main branch
- **THEN** a CI workflow SHALL install dependencies with a frozen lockfile
- **AND** run `bun run check`
- **AND** fail the build on any failing step
