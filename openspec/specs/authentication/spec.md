# Authentication Specification

## Purpose
Provide flexible and secure authentication mechanisms for downstream services, supporting both legacy single-header authentication and modern multi-header authentication configurations with secure secret interpolation.

## Overview
The authentication capability provides flexible header-based authentication for downstream services. It supports both legacy single-header authentication and modern multi-header authentication configurations, with secure secret interpolation and backward compatibility.
## Requirements
### Requirement: Legacy Single-Header Authentication
The system SHALL support legacy authentication using a single configured header and expected value.

#### Scenario: Default Authorization header
- **WHEN** server config has `auth: "Bearer token123"` without `authHeader`
- **THEN** the system SHALL check the `Authorization` header
- **AND** require exact match with "Bearer token123"

#### Scenario: Custom auth header
- **WHEN** server config has `auth: "secret-key"` and `authHeader: "X-API-Key"`
- **THEN** the system SHALL check the `X-API-Key` header
- **AND** require exact match with "secret-key"

#### Scenario: Missing legacy auth header
- **WHEN** required auth header is not present in the request
- **THEN** the system SHALL return 401 Unauthorized
- **AND** response message SHALL be "Authentication required"

#### Scenario: Incorrect legacy auth value
- **WHEN** auth header value does not match configured value
- **THEN** the system SHALL return 401 Unauthorized
- **AND** response message SHALL be "Authentication required"

### Requirement: Multi-Header Authentication
The system SHALL support multiple authentication configurations where any one valid header grants access.

#### Scenario: Multiple valid auth headers
- **WHEN** server config has `authConfigs` with Authorization and X-API-Key options
- **AND** request provides valid Authorization header
- **THEN** authentication SHALL succeed
- **AND** X-API-Key header check SHALL be skipped

#### Scenario: First auth header fails, second succeeds
- **WHEN** server config has multiple auth configs
- **AND** first auth header check fails
- **AND** second auth header check succeeds
- **THEN** authentication SHALL succeed

#### Scenario: All auth headers fail
- **WHEN** request provides headers that don't match any configured auth config
- **THEN** the system SHALL return 401 Unauthorized
- **AND** response message SHALL be "Authentication required"

#### Scenario: No auth headers present with configs
- **WHEN** server has authConfigs configured
- **AND** request provides none of the configured headers
- **THEN** the system SHALL return 401 Unauthorized

### Requirement: Authentication Logic Merging
The system SHALL merge legacy and modern authentication configurations into a unified authentication check.

#### Scenario: Legacy and modern configs coexist
- **WHEN** server config has both `auth`/`authHeader` and `authConfigs`
- **AND** header names do not conflict
- **THEN** the system SHALL merge all auth configurations
- **AND** check against any of them

#### Scenario: Header name conflict
- **WHEN** legacy `authHeader` conflicts with `authConfigs` header name
- **THEN** `authConfigs` SHALL take precedence
- **AND** legacy config SHALL be ignored for that header

#### Scenario: Only legacy config present
- **WHEN** server config has only `auth`/`authHeader`
- **THEN** the system SHALL use only legacy authentication logic

#### Scenario: Only modern config present
- **WHEN** server config has only `authConfigs`
- **THEN** the system SHALL use only modern authentication logic

### Requirement: No Authentication Required
The system SHALL allow requests without authentication when no authentication is configured.

#### Scenario: No auth configuration
- **WHEN** server config has no `auth`, `authHeader`, or `authConfigs`
- **THEN** the system SHALL skip authentication checks
- **AND** allow the request to proceed

#### Scenario: Empty auth configs
- **WHEN** server config has empty `authConfigs` array
- **THEN** the system SHALL treat as no authentication required
- **AND** allow the request to proceed

### Requirement: Secret Interpolation in Authentication
The system SHALL support secret interpolation in authentication header values using `${SECRET_NAME}` pattern.

#### Scenario: Secret in legacy auth value
- **WHEN** server config has `auth: "Bearer ${API_TOKEN}"`
- **AND** environment has `API_TOKEN` secret set to "secret123"
- **THEN** the system SHALL interpolate to "Bearer secret123"
- **AND** compare against interpolated value

#### Scenario: Secret in modern auth value
- **WHEN** auth config has `value: "${SECRET_KEY}"`
- **AND** environment has `SECRET_KEY` secret set to "key456"
- **THEN** the system SHALL interpolate to "key456"
- **AND** compare against interpolated value

#### Scenario: Missing secret
- **WHEN** auth value references `${MISSING_SECRET}`
- **AND** environment does not have `MISSING_SECRET`
- **THEN** the system SHALL use the literal placeholder text
- **AND** compare against "${MISSING_SECRET}"

#### Scenario: Multiple secrets in one value
- **WHEN** auth value is "${PREFIX}_${SUFFIX}"
- **AND** both secrets exist
- **THEN** the system SHALL interpolate both placeholders
- **AND** produce the combined value

### Requirement: Authentication Header Security
The system SHALL remove authentication headers from requests before forwarding to downstream services.

#### Scenario: Legacy auth header removal
- **WHEN** server config uses legacy `authHeader: "X-API-Key"`
- **THEN** the system SHALL remove `X-API-Key` header from forwarded request
- **AND** not expose it to downstream service

#### Scenario: Modern auth headers removal
- **WHEN** server config uses `authConfigs` with Authorization and X-API-Key
- **THEN** the system SHALL remove both headers from forwarded request
- **AND** not expose them to downstream service

#### Scenario: Mixed auth headers removal
- **WHEN** server config has both legacy and modern auth configs
- **THEN** the system SHALL remove all configured auth headers
- **AND** not expose any of them to downstream service

#### Scenario: Non-auth headers preserved
- **WHEN** request contains non-authentication headers like `Content-Type`
- **THEN** the system SHALL preserve these headers in forwarded request
- **AND** not remove them during auth processing

### Requirement: Authentication Error Handling
The system SHALL handle authentication failures consistently without exposing sensitive information.

#### Scenario: Authentication failure logging
- **WHEN** authentication fails
- **THEN** the system SHALL log the failure for debugging
- **AND** not log the actual auth values or secrets
- **AND** not expose internal details in response

#### Scenario: Invalid auth configuration
- **WHEN** auth configuration is malformed or invalid
- **THEN** the system SHALL return 500 Internal Server Error
- **AND** not expose configuration details in response

#### Scenario: Case-sensitive comparison
- **WHEN** comparing auth header values
- **THEN** the system SHALL use case-sensitive exact matching
- **AND** not perform case normalization or hashing

### Requirement: Global Authentication Configuration
The system SHALL support global authentication configuration that applies to all servers.

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

### Requirement: Global Authentication Priority
The system SHALL check global authentication before per-server authentication with specific override behavior.

#### Scenario: Global auth success overrides per-server auth
- **WHEN** global authentication is configured
- **AND** request provides valid global auth headers
- **AND** server has its own authentication configured
- **THEN** the system SHALL grant access immediately
- **AND** skip per-server authentication checks
- **AND** remove global auth headers before forwarding

#### Scenario: Global auth fails, per-server auth succeeds
- **WHEN** global authentication is configured
- **AND** request does not provide valid global auth headers
- **AND** server has valid per-server authentication
- **AND** request provides valid per-server auth headers
- **THEN** global authentication SHALL fail
- **AND** per-server authentication SHALL succeed
- **AND** request SHALL be allowed

#### Scenario: Global auth fails, per-server auth fails
- **WHEN** global authentication is configured
- **AND** request does not provide valid global auth headers
- **AND** server has per-server authentication configured
- **AND** request does not provide valid per-server auth headers
- **THEN** both authentication checks SHALL fail
- **AND** system SHALL return 401 Unauthorized

#### Scenario: No global auth configured
- **WHEN** global authentication is not configured
- **THEN** the system SHALL skip global authentication checks
- **AND** proceed with existing per-server authentication logic

### Requirement: Global Auth Required Behavior
The system SHALL require authentication when global auth is configured, even for servers without per-server auth.

#### Scenario: Global auth configured, server has no auth
- **WHEN** global authentication is configured
- **AND** server has no per-server authentication configured
- **AND** request provides valid global auth headers
- **THEN** authentication SHALL succeed
- **AND** request SHALL be allowed

#### Scenario: Global auth configured, server has no auth, request fails global auth
- **WHEN** global authentication is configured
- **AND** server has no per-server authentication configured
- **AND** request does not provide valid global auth headers
- **THEN** global authentication SHALL fail
- **AND** no per-server auth to fall back to
- **AND** system SHALL return 401 Unauthorized

#### Scenario: Global auth not configured, server has no auth
- **WHEN** global authentication is not configured
- **AND** server has no per-server authentication configured
- **THEN** the system SHALL allow requests without authentication
- **AND** maintain existing open access behavior

### Requirement: Global Authentication Secret Interpolation
The system SHALL support secret interpolation in global authentication configuration using `${SECRET_NAME}` pattern.

#### Scenario: Global auth with secret interpolation
- **WHEN** global auth config contains `{"header": "Authorization", "value": "Bearer ${GLOBAL_TOKEN}"}`
- **AND** environment has `GLOBAL_TOKEN` secret set to "secret123"
- **THEN** the system SHALL interpolate to "Bearer secret123"
- **AND** compare against interpolated value

#### Scenario: Global auth with multiple secrets
- **WHEN** global auth config contains `{"header": "X-API-Key", "value": "${PREFIX}-${SUFFIX}"}`
- **AND** both secrets exist in environment
- **THEN** the system SHALL interpolate both placeholders
- **AND** produce the combined value

#### Scenario: Global auth with missing secret
- **WHEN** global auth config references `${MISSING_GLOBAL_SECRET}`
- **AND** environment does not have `MISSING_GLOBAL_SECRET`
- **THEN** the system SHALL use the literal placeholder text
- **AND** compare against "${MISSING_GLOBAL_SECRET}"

### Requirement: Global Authentication Header Security
The system SHALL remove global authentication headers from requests before forwarding to downstream services.

#### Scenario: Global auth header removal
- **WHEN** global authentication is configured with `Authorization` header
- **AND** request provides valid Authorization header
- **THEN** the system SHALL remove `Authorization` header from forwarded request
- **AND** not expose it to downstream service

#### Scenario: Mixed global and per-server auth header removal
- **WHEN** global auth uses `Authorization` header
- **AND** per-server auth uses `X-API-Key` header
- **THEN** the system SHALL remove both headers from forwarded request
- **AND** not expose either to downstream service

#### Scenario: Global auth headers conflict with per-server headers
- **WHEN** global auth and per-server auth both use `Authorization` header
- **AND** request provides valid global auth
- **THEN** the system SHALL remove `Authorization` header from forwarded request
- **AND** not expose it to downstream service

### Requirement: Global Authentication Error Handling
The system SHALL handle global authentication failures consistently without exposing sensitive information.

#### Scenario: Global auth failure logging
- **WHEN** global authentication fails
- **THEN** the system SHALL log the failure for debugging
- **AND** not log the actual global auth values or secrets
- **AND** continue to per-server authentication checks

#### Scenario: Global auth configuration loading failure
- **WHEN** global auth configuration cannot be loaded
- **THEN** the system SHALL return 500 Internal Server Error
- **AND** not expose configuration details in response
- **AND** not bypass authentication

#### Scenario: Global auth validation error
- **WHEN** global auth configuration fails validation
- **THEN** the system SHALL return 500 Internal Server Error
- **AND** not expose validation details in response
- **AND** not bypass authentication

### Requirement: Global Authentication Performance
The system SHALL optimize global authentication checking for minimal performance impact.

#### Scenario: Global auth config caching
- **WHEN** global authentication is configured via environment variables
- **THEN** the system SHALL cache the parsed configuration
- **AND** avoid parsing on every request
- **AND** minimize authentication check overhead

#### Scenario: Early exit on global auth success
- **WHEN** global authentication succeeds
- **THEN** the system SHALL skip per-server authentication checks
- **AND** avoid unnecessary per-server config processing
- **AND** improve request processing time

