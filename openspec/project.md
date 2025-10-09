# Project Context

## Purpose
Worker Proxy is a Cloudflare Workers-based reverse proxy server that routes incoming HTTP requests to multiple downstream services based on URL path segments. The proxy provides authentication, header management, and secret interpolation capabilities while maintaining a lightweight, serverless architecture.

Key goals:
- Route requests to different backend services based on the first URL path segment
- Support flexible authentication methods (single or multiple auth headers)
- Provide secure secret management through Cloudflare Workers secrets
- Enable custom header injection and forwarding control
- Maintain high performance and reliability at edge locations

## Tech Stack
- **Runtime**: Cloudflare Workers (V8 isolates at edge locations)
- **Language**: TypeScript (strict mode, ES2022 target)
- **Package Manager**: Bun (for development and dependency management)
- **Configuration**: Cloudflare KV for server configurations
- **Secrets**: Cloudflare Workers secrets for sensitive data
- **Testing**: Vitest with Node.js environment
- **Linting**: ESLint with TypeScript ESLint rules
- **Formatting**: Prettier (2-space indent, single quotes, 100 char line width)
- **Build Tool**: Wrangler (Cloudflare's CLI tool)

## Project Conventions

### Code Style
- **TypeScript**: Strict mode enabled, explicit typing for complex interfaces
- **Formatting**: 2-space indentation, single quotes, trailing commas, 100 char max line length
- **Naming**: camelCase for variables/functions, PascalCase for classes/interfaces, UPPER_SNAKE_CASE for constants
- **Imports**: Named imports preferred, grouped as third-party > local > side-effect
- **No semicolons** unless required by JavaScript syntax
- **No `any` types** - use `unknown` for untyped data
- **File naming**: kebab-case for utilities, PascalCase for exports

### Architecture Patterns
- **Single Entry Point**: Export default `fetch` handler from `src/index.ts`
- **Modular Design**: Separate utilities for auth, config validation, header processing, and request handling
- **Functional Approach**: Pure functions where possible, minimal side effects
- **Error Handling**: Early validation with guards, custom error types, never expose internals
- **Configuration-Driven**: All behavior controlled through KV configuration
- **Secret Interpolation**: `${SECRET_NAME}` pattern for secure value substitution

### Testing Strategy
- **Framework**: Vitest with Node.js environment for local testing
- **Test Location**: All tests in `tests/` directory with `.test.ts` extension
- **Coverage**: Use `vitest run --coverage` for coverage reports
- **Mocking**: Use `vi.mock` for Cloudflare Workers APIs
- **Test Types**: Unit tests for utilities, integration tests for request processing
- **Edge Cases**: Test authentication failures, invalid paths, configuration errors

### Git Workflow
- **Branching**: Main branch for production, feature branches for development
- **Commits**: Conventional commit messages (feat:, fix:, docs:, etc.)
- **No direct commits** to main branch
- **Pull requests** required for all changes

## Domain Context

### Request Routing Logic
- URL path structure: `/{server-key}/{remaining-path}`
- First path segment determines downstream server configuration
- Remaining path is appended to downstream server URL
- Example: `/api/users/123` → `api` server → `https://api.example.com/users/123`

### Authentication Model
- **Legacy**: Single auth header with `auth` and `authHeader` configuration
- **New**: Multiple auth headers via `authConfigs` array
- **Logic**: Any one matching auth header grants access (OR logic)
- **Security**: Auth headers are stripped before forwarding to downstream services

### Header Processing
- All incoming headers forwarded except configured auth headers
- Configured headers added only if not present in incoming request
- Incoming headers take priority over configured headers
- Secret interpolation supported in header values

### Secret Management
- Pattern: `${SECRET_NAME}` in configuration values
- Storage: Cloudflare Workers secrets (never in KV)
- Security: Secrets never logged or exposed in responses
- Fallback: Missing secrets in headers fall back to placeholder text

## Important Constraints
- **Edge Computing**: Must run within Cloudflare Workers CPU/memory limits
- **HTTPS Only**: All downstream servers must use HTTPS URLs
- **No External Dependencies**: Runtime limited to Workers APIs and built-ins
- **Stateless**: Each request is independent, no server-side state
- **Security First**: Never expose secrets, configurations, or internal errors
- **Performance**: Minimize cold start time and request latency

## Project Requirements

### Core System Requirements

#### Requirement: Edge-Based Reverse Proxy
The system SHALL provide a reverse proxy service that runs on Cloudflare Workers edge locations worldwide.

#### Scenario: Global request routing
- **WHEN** HTTP requests arrive at any edge location
- **THEN** the system SHALL route them to appropriate downstream services
- **AND** maintain low latency regardless of geographic location

#### Requirement: Path-Based Service Routing
The system SHALL route requests to downstream services based on the first URL path segment.

#### Scenario: Service discovery by path
- **WHEN** request arrives at `/api/users/123`
- **THEN** the system SHALL extract `api` as the service key
- **AND** route to configured downstream service
- **AND** preserve remaining path `/users/123`

#### Requirement: Flexible Authentication
The system SHALL support multiple authentication methods for downstream services.

#### Scenario: Multiple auth mechanisms
- **WHEN** downstream service requires authentication
- **THEN** the system SHALL support single-header auth
- **AND** support multi-header auth configurations
- **AND** validate credentials securely
- **AND** remove auth headers from downstream requests

#### Requirement: Secure Secret Management
The system SHALL securely manage sensitive configuration values through Cloudflare Workers secrets.

#### Scenario: Secret interpolation
- **WHEN** configuration contains `${SECRET_NAME}` placeholders
- **THEN** the system SHALL replace with actual secret values
- **AND** never expose secrets in logs or responses
- **AND** handle missing secrets gracefully

#### Requirement: Configuration Management
The system SHALL retrieve and validate server configurations from Cloudflare KV.

#### Scenario: Dynamic configuration
- **WHEN** processing requests
- **THEN** the system SHALL fetch server configs from KV
- **AND** validate configuration structure
- **AND** enforce security constraints
- **AND** cache configurations for performance

#### Requirement: Header Processing
The system SHALL manage HTTP headers for forwarded requests.

#### Scenario: Header forwarding and injection
- **WHEN** forwarding requests to downstream services
- **THEN** the system SHALL preserve incoming headers
- **AND** inject configured headers when absent
- **AND** prioritize incoming headers over configured ones
- **AND** exclude authentication headers from downstream requests

#### Requirement: Error Handling and Security
The system SHALL provide secure error handling without exposing internal details.

#### Scenario: Secure error responses
- **WHEN** errors occur during request processing
- **THEN** the system SHALL return appropriate HTTP status codes
- **AND** provide generic error messages
- **AND** not expose configuration details or secrets
- **AND** log errors for debugging

### Cross-Cutting Requirements

#### Requirement: Performance and Scalability
The system SHALL maintain high performance and handle edge computing constraints.

#### Scenario: Edge optimization
- **WHEN** processing requests at edge locations
- **THEN** the system SHALL minimize cold start time
- **AND** optimize for CPU/memory limits
- **AND** provide sub-second response times
- **AND** handle concurrent requests efficiently

#### Requirement: Security Compliance
The system SHALL enforce security best practices for proxy operations.

#### Scenario: Security enforcement
- **WHEN** routing requests
- **THEN** the system SHALL require HTTPS for downstream services
- **AND** prevent SSRF attacks
- **AND** validate all configurations
- **AND** protect sensitive data

#### Requirement: Observability
The system SHALL provide logging and monitoring capabilities.

#### Scenario: System monitoring
- **WHEN** operating in production
- **THEN** the system SHALL log request processing events
- **AND** provide error metrics
- **AND** support debugging without exposing sensitive data

## External Dependencies
- **Cloudflare Workers**: Runtime environment and edge computing platform
- **Cloudflare KV**: Distributed key-value store for configuration data
- **Cloudflare Secrets**: Secure storage for sensitive configuration values
- **Downstream Services**: Any HTTPS API/service that the proxy routes to
- **Custom Domain**: `pipe.kshlm.xyz` for production deployment
