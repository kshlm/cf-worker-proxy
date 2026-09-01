## MODIFIED Requirements

### Requirement: Global Authentication Configuration
The system SHALL support global authentication configuration that applies to all servers, and SHALL fail closed when a configured source cannot be loaded, parsed, or validated.

#### Scenario: Global auth with environment variable configuration
- **WHEN** environment variable `GLOBAL_AUTH_CONFIGS` is set with valid JSON array
- **AND** contains `[{"header": "Authorization", "value": "Bearer global-token"}]`
- **THEN** the system SHALL parse and use this as global authentication configuration
- **AND** apply it to all incoming requests regardless of server

#### Scenario: Global auth with KV storage configuration
- **WHEN** KV key `global-auth-configs` contains valid JSON array
- **AND** contains `[{"header": "X-API-Key", "value": "global-secret"}]`
- **THEN** the system SHALL load and use this as global authentication configuration
- **AND** apply it to all incoming requests regardless of server

#### Scenario: Multiple global auth headers
- **WHEN** global auth config contains multiple auth configurations
- **AND** request provides any one valid global auth header
- **THEN** global authentication SHALL succeed
- **AND** grant access regardless of per-server configuration

#### Scenario: Invalid global auth configuration
- **WHEN** global auth configuration is malformed JSON
- **OR** contains invalid auth config structure
- **THEN** the system SHALL return 500 Internal Server Error
- **AND** not bypass any authentication checks

#### Scenario: Invalid global auth configuration fails closed
- **WHEN** global auth configuration is malformed JSON
- **OR** contains invalid auth config structure
- **OR** secret interpolation for global auth values fails
- **OR** global auth KV loading throws
- **OR** secret interpolation for global auth values fails
- **THEN** the system SHALL return 500 Internal Server Error
- **AND** SHALL NOT fall back to per-server authentication
- **AND** SHALL NOT allow unauthenticated access

#### Scenario: Empty global auth array counts as configured
- **WHEN** global auth source exists (env variable or KV key present)
- **AND** parses to an empty array
- **THEN** the system SHALL treat global authentication as configured
- **AND** apply the required-authentication behavior of the two-tier flow
- **AND** servers without per-server authentication SHALL return 401 Unauthorized

#### Scenario: Global auth absent on all sources
- **WHEN** environment variable `GLOBAL_AUTH_CONFIGS` is unset
- **AND** KV key `global-auth-configs` does not exist
- **THEN** the system SHALL treat global authentication as not configured
- **AND** proceed with per-server authentication logic only

## REMOVED Requirements

### Requirement: Legacy Single-Header Authentication
**Reason**: Legacy `auth`/`authHeader` fields were removed from the runtime in commit 1e90851; the spec no longer matches the code. Keeping the requirement invites stale KV configs that behave differently than documented.
**Migration**: Operators replace `auth`/`authHeader` with an equivalent `authConfigs` entry, e.g. `{"auth": "v", "authHeader": "X-API-Key"}` becomes `"authConfigs": [{"header": "X-API-Key", "value": "v"}]`.

### Requirement: Authentication Logic Merging
**Reason**: There is no legacy configuration to merge with `authConfigs` anymore; only `authConfigs` exists. The merge scenarios are unreachable.
**Migration**: None needed; `authConfigs` is the only supported authentication configuration.

## ADDED Requirements

### Requirement: Legacy Auth Field Rejection
The system SHALL reject server configurations containing the removed legacy fields `auth` or `authHeader` instead of silently ignoring them.

#### Scenario: Config with legacy fields rejected
- **WHEN** a server configuration in KV contains `auth` or `authHeader` properties
- **THEN** the system SHALL return 500 Internal Server Error
- **AND** the error context SHALL name the offending legacy fields
- **AND** the error SHALL direct the operator to `authConfigs`

#### Scenario: Config without legacy fields unaffected
- **WHEN** a server configuration contains only `url`, `headers`, and `authConfigs`
- **THEN** the system SHALL process it normally
- **AND** apply no legacy-field checks
