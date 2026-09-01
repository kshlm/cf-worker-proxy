## MODIFIED Requirements

### Requirement: Configuration Schema Compliance
The system SHALL ensure all configurations comply with the defined schema for ServerConfig and related interfaces.

#### Scenario: AuthConfig validation
- **WHEN** configuration includes `authConfigs` array
- **THEN** each item SHALL have `header` and `value` as strings
- **AND** the system SHALL validate array structure

#### Scenario: Duplicate auth header names rejected
- **WHEN** `authConfigs` contains two entries whose `header` values differ only by case
- **THEN** the system SHALL reject the configuration
- **AND** report the duplicated header name

#### Scenario: Headers object validation
- **WHEN** configuration includes `headers` object
- **THEN** all values SHALL be strings
- **AND** the system SHALL validate object structure

#### Scenario: Legacy auth validation
- **WHEN** configuration includes legacy `auth` and `authHeader`
- **THEN** the system SHALL reject the configuration as specified by the Legacy Auth Field Rejection requirement in the authentication capability
- **AND** the validation error SHALL name the legacy fields

#### Scenario: Optional field handling
- **WHEN** configuration includes only required fields
- **THEN** the system SHALL accept minimal valid configuration
- **AND** not require optional fields

### Requirement: Configuration Migration Support
The system SHALL NOT support legacy configuration format migration; legacy fields SHALL be rejected and operators SHALL migrate explicitly.

#### Scenario: Legacy configuration format
- **WHEN** encountering a configuration containing `auth` or `authHeader`
- **THEN** the system SHALL reject it with an error naming the fields
- **AND** NOT apply any automatic conversion

#### Scenario: Configuration version detection
- **WHEN** loading a backup file
- **THEN** the system SHALL detect whether it is a version-1 document or a legacy bare map
- **AND** handle each format explicitly

#### Scenario: Deprecated field handling
- **WHEN** configuration contains deprecated fields such as `auth` or `authHeader`
- **THEN** the system SHALL reject them with an explicit migration error
- **AND** NOT provide migration warnings with silent passthrough

#### Scenario: New field addition
- **WHEN** the configuration schema adds new fields
- **THEN** the system SHALL handle missing new fields
- **AND** use appropriate default values

#### Scenario: Config tooling uses the shared validator
- **WHEN** the configuration management scripts validate a config before saving to KV
- **THEN** they SHALL use the same validator as the runtime (`src/config-validator.ts`)
- **AND** there SHALL be no second, diverging validation implementation

## ADDED Requirements

### Requirement: Backup and Restore Semantics
The configuration management scripts SHALL produce deterministic, versioned backups and SHALL validate before import.

#### Scenario: Backup document format
- **WHEN** running the backup script
- **THEN** the output file SHALL contain a JSON document with `version: 1`, an `exportedAt` ISO timestamp, and an `entries` object mapping KV keys to values

#### Scenario: Restore accepts versioned and legacy formats
- **WHEN** restoring from a backup file
- **THEN** the script SHALL accept version-1 documents
- **AND** accept legacy bare `Record<string, unknown>` JSON maps
- **AND** treat both identically after load

#### Scenario: Restore validates entries before writing
- **WHEN** restoring a backup
- **THEN** each entry SHALL be validated with the shared configuration validator before any KV write
- **AND** entries failing validation SHALL be reported per key with a non-zero script exit
- **AND** no invalid entry SHALL be written to KV

#### Scenario: Deterministic temp files
- **WHEN** scripts write temporary files for KV operations
- **THEN** file names SHALL use `crypto.randomUUID()`
- **AND** not use timestamp-plus-random concatenation

#### Scenario: Global auth key overwrite confirmation
- **WHEN** a restore would overwrite the `global-auth-configs` KV key
- **AND** the `--yes` flag is not set
- **THEN** the script SHALL prompt for confirmation before writing
- **AND** abort that key on refusal

#### Scenario: Wrangler invocation safety
- **WHEN** scripts invoke `wrangler` with user-controlled values such as KV key names
- **THEN** arguments SHALL be passed as an argument array without shell string interpolation
