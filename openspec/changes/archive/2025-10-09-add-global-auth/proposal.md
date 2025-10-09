# Proposal: Add Global Authentication Feature

## Change ID: add-global-auth

## Summary

This proposal introduces a global authentication feature that provides a master authentication layer across all servers in the proxy. When global authentication is configured, it can override per-server authentication rules, allowing administrators to configure universal access while maintaining server-specific authentication for regular users.

## Why

The current per-server authentication model has limitations for administrators managing multiple servers:

1. **Administrative Overhead**: When managing multiple servers that should share the same authentication, administrators must configure auth for each server individually, leading to configuration duplication and maintenance burden

2. **Inconsistent Security**: It's easy to accidentally leave a server without authentication when it should be protected, creating security gaps in the proxy setup

3. **Limited Flexibility**: There's no way to provide "master access" that works across all servers regardless of their individual auth configuration, making it difficult to implement universal administrative access

4. **Configuration Complexity**: Large deployments with many servers become unwieldy to manage when each requires separate auth configuration

## What Changes

- Add global authentication configuration support via environment variables or KV storage
- Implement two-tier authentication flow (global auth → per-server auth)
- Add global auth override behavior when global auth succeeds
- Extend secret interpolation to work with global auth configuration
- Add global auth header removal from forwarded requests
- Ensure global auth is required when configured, even for servers without per-server auth

## Impact

- **Affected specs**: authentication (extending existing capability)
- **Affected code**: src/request-processor.ts, src/types.ts, src/utils/auth-helpers.ts, src/config-validator.ts
- **Configuration**: New environment variable `GLOBAL_AUTH_CONFIGS` and KV key `global-auth-configs`

## Proposed Solution

Implement a global authentication feature that:

1. **Global Auth Configuration**: Allow authentication to be configured at the worker level (via environment variables or KV storage)
2. **Two-Tier Authentication**: Check global auth first, then fall back to per-server auth if global auth fails
3. **Override Behavior**: When global auth succeeds, grant access immediately regardless of per-server configuration
4. **Mandatory Auth**: When global auth is configured, some form of authentication is always required

## Key Features

### Global Authentication Configuration
- Support for environment variable configuration (`GLOBAL_AUTH_CONFIGS`)
- Fallback to KV storage configuration (`global-auth-configs`)
- Same authentication structure as existing per-server auth
- Secret interpolation support using `${SECRET_NAME}` pattern

### Authentication Flow
1. Check global authentication if configured
2. If global auth succeeds → Allow request (skip per-server auth)
3. If global auth fails → Check per-server authentication
4. If neither succeeds → Return 401 Unauthorized
5. If global auth is configured but server has no per-server auth → Still require global auth

### Security Features
- Global auth headers removed before forwarding to downstream services
- Same secret interpolation and validation as per-server auth
- Secure error handling without exposing sensitive information
- Consistent logging without auth values

## Benefits

1. **Simplified Administration**: Configure auth once for universal access
2. **Enhanced Security**: Ensure all servers are protected when global auth is enabled
3. **Flexible Access Control**: Support both universal access and server-specific access
4. **Backward Compatibility**: Existing configurations continue to work unchanged
5. **Performance**: Minimal overhead with early exit on global auth success

## Implementation Approach

### Phase 1: Configuration Structure
- Extend types for global auth support
- Add configuration loading from environment variables and KV
- Implement configuration validation

### Phase 2: Authentication Logic
- Implement two-tier authentication flow
- Update request processor for global auth checking
- Integrate with existing header removal and secret interpolation

### Phase 3: Testing & Documentation
- Comprehensive test coverage for all scenarios
- Performance testing and optimization
- Documentation and migration guides

## Impact Assessment

### Breaking Changes
- None. This is a purely additive feature that maintains backward compatibility.

### Performance Impact
- Minimal: One additional authentication check at request start
- Optimized with early exit when global auth succeeds
- Configuration caching to avoid repeated parsing

### Security Impact
- Enhanced: Provides additional authentication layer
- No new attack surface introduced
- Same security guarantees as existing authentication

## Success Metrics

1. **Functional**: All authentication scenarios work as specified
2. **Performance**: No measurable performance regression
3. **Security**: Global auth provides same security as per-server auth
4. **Compatibility**: Existing configurations work unchanged
5. **Usability**: Easy to configure and understand

## Related Specifications

This change extends the existing `authentication` specification with new global authentication requirements while maintaining all existing functionality.