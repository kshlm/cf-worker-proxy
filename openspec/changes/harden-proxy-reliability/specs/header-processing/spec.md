## MODIFIED Requirements

### Requirement: Authentication Header Exclusion
The system SHALL exclude authentication headers from forwarded requests to prevent credential exposure to downstream services.

#### Scenario: Modern auth headers exclusion
- **WHEN** server config has `authConfigs` with Authorization and X-Custom-Auth
- **THEN** the system SHALL exclude both headers from forwarded request
- **AND** not send either to downstream service

#### Scenario: Legacy auth header exclusion
- **WHEN** a request carries an auth header configured in `authConfigs`
- **THEN** the system SHALL exclude that header from forwarded request
- **AND** not send it to downstream service

#### Scenario: Global auth headers exclusion
- **WHEN** global authentication is configured with an Authorization header
- **THEN** the system SHALL exclude that header from the forwarded request
- **AND** not send it to downstream service

#### Scenario: Mixed auth configs exclusion
- **WHEN** global and per-server auth configurations both apply to a request
- **THEN** the system SHALL exclude all configured auth headers
- **AND** not send any auth headers to downstream service

#### Scenario: Non-auth headers preserved during exclusion
- **WHEN** excluding auth headers
- **AND** request contains other headers like `User-Agent`
- **THEN** the system SHALL preserve non-auth headers
- **AND** forward them to downstream service

#### Scenario: Redirects not followed to leak headers
- **WHEN** the downstream service responds with a 3xx redirect
- **THEN** the forwarded request SHALL be created with `redirect: 'manual'`
- **AND** the worker SHALL NOT automatically re-issue the request to the redirect target with the same headers


## MODIFIED Requirements

### Requirement: Configured Header Injection
The system SHALL apply configured downstream headers to forwarded requests, overriding conflicting client-supplied headers so downstream services receive operator-intended values.

#### Scenario: Header not present in request
- **WHEN** server config has `headers: { "X-Service": "proxy" }`
- **AND** incoming request does not have `X-Service` header
- **THEN** the system SHALL add `X-Service: proxy` to forwarded request

#### Scenario: Header already present in request
- **WHEN** server config has `headers: { "X-API-Version": "v1" }`
- **AND** incoming request already has `X-API-Version: v2`
- **THEN** the system SHALL set the configured value `v1` on the forwarded request
- **AND** the client-supplied value `v2` SHALL NOT reach the downstream service

#### Scenario: Multiple configured headers
- **WHEN** server config has multiple headers in `headers` object
- **THEN** the system SHALL add all configured headers
- **AND** client-supplied values for those header names SHALL NOT reach the downstream service

#### Scenario: Mixed header presence
- **WHEN** server config has headers A, B, C
- **AND** incoming request has header B
- **THEN** the system SHALL add headers A and C
- **AND** the forwarded request SHALL carry the configured value for header B

#### Scenario: Downstream credentials are operator-controlled
- **WHEN** server config has `headers: { "Authorization": "Bearer downstream-token" }`
- **AND** incoming request has any Authorization header value
- **THEN** the forwarded Authorization header SHALL be "Bearer downstream-token"

### Requirement: Header Priority Resolution
The system SHALL resolve header conflicts in favor of configured downstream headers over incoming client headers.

#### Scenario: Incoming header overrides configured header
- **WHEN** server config has `headers: { "Authorization": "Bearer ${TOKEN}" }`
- **AND** incoming request has `Authorization: Bearer user-token`
- **THEN** the system SHALL use the configured header value
- **AND** not forward the incoming value to the downstream service


#### Scenario: Configured header when incoming absent
- **WHEN** server config has `headers: { "X-Forwarded-For": "proxy" }`
- **AND** incoming request has no `X-Forwarded-For` header
- **THEN** the system SHALL use the configured header value


#### Scenario: Case-insensitive conflict resolution
- **WHEN** server config has `headers: { "content-type": "application/json" }`
- **AND** incoming request has `Content-Type: text/plain`
- **THEN** the system SHALL treat them as conflicting headers
- **AND** the forwarded request SHALL carry the configured value `application/json`
