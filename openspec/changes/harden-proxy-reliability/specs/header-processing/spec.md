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

