# Global Authentication Specification

## Overview
Global authentication provides a master authentication layer that applies across all servers in the proxy. When global authentication is configured, it can override per-server authentication rules, allowing administrators to configure universal access while maintaining server-specific authentication for regular users.

## ADDED Requirements

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