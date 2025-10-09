# Design: Global Authentication Feature

## Overview

This design document outlines the approach for implementing a global authentication feature that sits above the existing per-server authentication system. The global auth feature provides a way to configure authentication that applies across all servers in the proxy, with specific override behavior for per-server configurations.

## Current Architecture Analysis

### Existing Authentication Flow
1. Request comes in → Extract server key from path
2. Load server configuration from KV storage
3. Process configuration with secret interpolation
4. Merge legacy and modern auth configs
5. Check authentication against merged configs
6. If auth passes → Forward request; If auth fails → Return 401

### Current Auth Logic
- Uses "any one match" logic (OR condition) for multiple auth headers
- Supports both legacy (`auth`/`authHeader`) and modern (`authConfigs`) formats
- Auth headers are removed before forwarding to downstream services
- If no auth is configured, requests are allowed without authentication

## Proposed Global Authentication Architecture

### Global Auth Configuration
- New environment variable or KV entry for global auth configuration
- Same structure as existing `AuthConfig` array (header/value pairs)
- Stored at the worker level, not per-server

### Authentication Priority & Flow
1. **Global Auth First**: Check global authentication if configured
2. **Global Auth Success**: If global auth passes → Allow request (skip per-server auth)
3. **Global Auth Failure**: If global auth fails → Fall back to per-server auth
4. **Per-Server Auth**: Check per-server auth as before
5. **No Auth Allowed**: If global auth is configured but neither global nor per-server auth succeeds → Return 401

### Key Design Decisions

#### 1. Override Behavior
- Global auth acts as a "master key" - if it passes, access is granted regardless of per-server config
- This allows administrators to configure universal access while maintaining per-server specific auth for regular users

#### 2. Fallback Logic
- When global auth fails, we still check per-server auth
- This maintains backward compatibility and allows mixed authentication scenarios

#### 3. Global Auth Requirement
- When global auth is configured, some form of authentication is always required
- Servers without per-server auth still need either global auth or will be blocked

#### 4. Security Considerations
- Global auth headers are removed before forwarding, same as per-server auth
- Secret interpolation works the same way for global auth
- Logging respects the same security constraints (no auth values logged)

## Implementation Strategy

### Phase 1: Configuration Structure
- Add global auth configuration loading
- Extend types to include global auth support
- Update configuration validation

### Phase 2: Authentication Logic
- Implement two-tier authentication checking
- Update auth flow to handle global + per-server auth
- Maintain backward compatibility

### Phase 3: Testing & Documentation
- Comprehensive test coverage for all scenarios
- Update documentation with global auth examples
- Migration guide for existing configurations

## Technical Considerations

### Performance Impact
- Minimal overhead: One additional auth check at the beginning
- Global auth config can be cached (worker-level, not per-request)
- No additional KV lookups needed if stored in environment variables

### Backward Compatibility
- Existing configurations continue to work unchanged
- No breaking changes to current authentication behavior
- Gradual adoption possible

### Security Model
- Global auth provides the same security guarantees as per-server auth
- Same secret interpolation and header removal logic
- No additional attack surface introduced

### Configuration Management
- Global auth configured at worker deployment level (environment variables)
- Per-server auth remains in KV storage
- Clear separation of concerns: global vs. server-specific

## Edge Cases & Scenarios

### Scenario 1: Global Auth + Per-Server Auth
- Global auth configured, server also has auth
- Request with valid global auth → Allowed (per-server auth skipped)
- Request with valid per-server auth → Allowed (global auth failed, per-server auth succeeded)

### Scenario 2: Global Auth Only
- Global auth configured, server has no auth
- Request with valid global auth → Allowed
- Request without global auth → 401 (no per-server auth to fall back to)

### Scenario 3: No Global Auth
- Global auth not configured
- Behavior identical to current implementation
- Per-server auth works as before

### Scenario 4: Invalid Global Auth Config
- Malformed global auth configuration
- System fails safe: returns 500 error, doesn't bypass authentication