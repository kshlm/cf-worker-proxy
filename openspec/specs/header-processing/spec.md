# Header Processing Specification

## Purpose
Manage HTTP headers in requests being forwarded to downstream services, handling incoming header preservation, configured header injection, authentication header removal, and secret interpolation in header values.

## Overview
The header processing capability manages HTTP headers in requests being forwarded to downstream services. It handles incoming header preservation, configured header injection, authentication header removal, and secret interpolation in header values.

## Requirements

### Requirement: Incoming Header Preservation
The system SHALL preserve all incoming HTTP headers when forwarding requests to downstream services, except for configured authentication headers.

#### Scenario: Standard headers preservation
- **WHEN** request contains `Content-Type: application/json` and `Accept: application/json`
- **THEN** the system SHALL preserve both headers in the forwarded request
- **AND** forward them unchanged to the downstream service

#### Scenario: Custom headers preservation
- **WHEN** request contains `X-Request-ID: 12345` and `X-Client-Version: 1.0.0`
- **THEN** the system SHALL preserve both custom headers
- **AND** forward them to the downstream service

#### Scenario: Case-insensitive header handling
- **WHEN** request contains `content-type: application/json` (lowercase)
- **THEN** the system SHALL preserve the header
- **AND** maintain original casing in forwarded request

#### Scenario: Multiple values for same header
- **WHEN** request contains multiple `Accept` header values
- **THEN** the system SHALL preserve all values
- **AND** forward them as received

### Requirement: Configured Header Injection
The system SHALL add configured headers to forwarded requests when they are not already present in the incoming request.

#### Scenario: Header not present in request
- **WHEN** server config has `headers: { "X-Service": "proxy" }`
- **AND** incoming request does not have `X-Service` header
- **THEN** the system SHALL add `X-Service: proxy` to forwarded request

#### Scenario: Header already present in request
- **WHEN** server config has `headers: { "X-API-Version": "v1" }`
- **AND** incoming request already has `X-API-Version: v2`
- **THEN** the system SHALL NOT add the configured header
- **AND** preserve the incoming header value `v2`

#### Scenario: Multiple configured headers
- **WHEN** server config has multiple headers in `headers` object
- **AND** none are present in incoming request
- **THEN** the system SHALL add all configured headers
- **AND** preserve their configured values

#### Scenario: Mixed header presence
- **WHEN** server config has headers A, B, C
- **AND** incoming request has header B
- **THEN** the system SHALL add headers A and C
- **AND** preserve incoming header B value

### Requirement: Header Priority Resolution
The system SHALL prioritize incoming request headers over configured headers when conflicts occur.

#### Scenario: Incoming header overrides configured header
- **WHEN** server config has `headers: { "Authorization": "Bearer ${TOKEN}" }`
- **AND** incoming request has `Authorization: Bearer user-token`
- **THEN** the system SHALL use the incoming header value
- **AND** not override with configured value

#### Scenario: Configured header when incoming absent
- **WHEN** server config has `headers: { "X-Forwarded-For": "proxy" }`
- **AND** incoming request has no `X-Forwarded-For` header
- **THEN** the system SHALL use the configured header value

#### Scenario: Case-insensitive conflict resolution
- **WHEN** server config has `headers: { "content-type": "application/json" }`
- **AND** incoming request has `Content-Type: text/plain`
- **THEN** the system SHALL treat as conflicting headers
- **AND** preserve the incoming header value

### Requirement: Authentication Header Exclusion
The system SHALL exclude authentication headers from forwarded requests to prevent credential exposure to downstream services.

#### Scenario: Legacy auth header exclusion
- **WHEN** server config has `authHeader: "X-API-Key"`
- **THEN** the system SHALL exclude `X-API-Key` header from forwarded request
- **AND** not send it to downstream service

#### Scenario: Modern auth headers exclusion
- **WHEN** server config has `authConfigs` with Authorization and X-Custom-Auth
- **THEN** the system SHALL exclude both headers from forwarded request
- **AND** not send either to downstream service

#### Scenario: Mixed auth configs exclusion
- **WHEN** server config has both legacy and modern auth configurations
- **THEN** the system SHALL exclude all configured auth headers
- **AND** not send any auth headers to downstream service

#### Scenario: Non-auth headers preserved during exclusion
- **WHEN** excluding auth headers
- **AND** request contains other headers like `User-Agent`
- **THEN** the system SHALL preserve non-auth headers
- **AND** forward them to downstream service

### Requirement: Secret Interpolation in Headers
The system SHALL support secret interpolation in configured header values using the `${SECRET_NAME}` pattern.

#### Scenario: Single secret interpolation
- **WHEN** server config has `headers: { "Authorization": "Bearer ${API_TOKEN}" }`
- **AND** environment has `API_TOKEN` set to "secret123"
- **THEN** the system SHALL interpolate to "Bearer secret123"
- **AND** use the interpolated value in forwarded request

#### Scenario: Multiple secrets in one header
- **WHEN** server config has `headers: { "X-Custom": "${PREFIX}_${SUFFIX}" }`
- **AND** both secrets exist in environment
- **THEN** the system SHALL interpolate both placeholders
- **AND** produce combined value

#### Scenario: Missing secret fallback
- **WHEN** header value references `${MISSING_SECRET}`
- **AND** environment does not have `MISSING_SECRET`
- **THEN** the system SHALL use literal "${MISSING_SECRET}" text
- **AND** not fail the request

#### Scenario: Mixed text and secrets
- **WHEN** header value is "Token: ${SECRET}_v1"
- **AND** `SECRET` exists in environment
- **THEN** the system SHALL interpolate only the secret part
- **AND** preserve surrounding text

### Requirement: Header Case Sensitivity
The system SHALL handle HTTP headers in a case-insensitive manner for comparison while preserving original casing in forwarded requests.

#### Scenario: Case-insensitive comparison for conflicts
- **WHEN** configured header is "X-API-Key"
- **AND** incoming header is "x-api-key"
- **THEN** the system SHALL treat them as the same header
- **AND** preserve incoming header value

#### Scenario: Original casing preservation
- **WHEN** incoming header is "Content-Type: application/json"
- **THEN** the system SHALL preserve "Content-Type" casing
- **AND** not normalize to lowercase

#### Scenario: Configured header casing
- **WHEN** adding configured header "X-Request-ID"
- **THEN** the system SHALL use the configured casing
- **AND** not modify it

### Requirement: Header Value Validation
The system SHALL validate header values and handle invalid or malformed headers appropriately.

#### Scenario: Valid header values
- **WHEN** header values contain standard ASCII characters
- **THEN** the system SHALL accept and forward them unchanged

#### Scenario: Header value with special characters
- **WHEN** header value contains spaces, quotes, or special characters
- **THEN** the system SHALL preserve the exact value
- **AND** not modify or escape it

#### Scenario: Empty header values
- **WHEN** configured header has empty string value
- **THEN** the system SHALL add the header with empty value
- **AND** not skip it

#### Scenario: Null or undefined header values
- **WHEN** configured header value is null or undefined
- **THEN** the system SHALL skip adding that header
- **AND** not include it in forwarded request