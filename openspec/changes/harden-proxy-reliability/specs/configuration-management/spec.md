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
- **AND** entry values SHALL be the raw KV values preserved verbatim

#### Scenario: Backup file safety
- **WHEN** running the backup script
- **THEN** the output SHALL default to a uniquely named file in the gitignored `backups/` directory
- **AND** the script SHALL refuse to overwrite an existing backup file
- **AND** the file SHALL be written atomically with 0600 permissions

#### Scenario: Malformed KV list output
- **WHEN** the KV key list response is not a valid JSON array
- **THEN** the backup SHALL abort with an error
- **AND** NOT write a backup file that silently omits keys

#### Scenario: Restore accepts versioned and legacy formats
- **WHEN** restoring from a backup file
- **THEN** the script SHALL accept version-1 documents
- **AND** accept legacy bare `Record<string, unknown>` JSON maps
- **AND** treat both identically after load

#### Scenario: Restore validates entries before writing
- **WHEN** restoring a backup
- **THEN** the ENTIRE backup SHALL be validated with the shared configuration validator before the first KV write
- **AND** a backup with any invalid entry SHALL abort with nothing written
- **AND** per-key write failures SHALL be reported and produce a non-zero exit without aborting other keys

#### Scenario: Restore confirmation and dry run
- **WHEN** restoring without `--yes` on a non-TTY or declining the interactive prompt
- **THEN** the restore SHALL abort before any remote write
- **AND** `--dry-run` SHALL validate the backup and perform no remote writes

#### Scenario: Merge and replace semantics
- **WHEN** restoring without `--replace`
- **THEN** only keys present in the backup SHALL be written (merge)
- **AND** `--replace` SHALL additionally delete remote keys absent from the backup
- **AND** `--replace` SHALL require typed strong confirmation before any write

#### Scenario: Uniquely named temp files
- **WHEN** scripts write temporary files for KV operations
- **THEN** each write SHALL target a uniquely named mkdtemp directory
- **AND** the file SHALL be created with 0600 permissions
- **AND** the directory SHALL be removed after the operation

#### Scenario: Global auth key overwrite confirmation
- **WHEN** a restore would overwrite the `global-auth-configs` KV key
- **AND** the `--yes` flag is not set
- **THEN** the script SHALL prompt for confirmation before writing
- **AND** abort that key on refusal

#### Scenario: Wrangler invocation safety
- **WHEN** scripts invoke `wrangler` with user-controlled values such as KV key names
- **THEN** arguments SHALL be passed as an argv array with shell execution disabled
- **AND** nonzero exits SHALL throw rather than be swallowed

#### Scenario: Reserved key filtering in scripts
- **WHEN** scripts enumerate KV keys for route configuration
- **THEN** the reserved `global-auth-configs` key SHALL be excluded from route operations
- **AND** route ids SHALL be validated against a safe character set
