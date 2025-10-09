# Authentication Design

## Technical Implementation

### Core Components
- **Auth Merger**: Combines legacy and modern auth configs
- **Header Validator**: Validates authentication headers
- **Secret Interpolator**: Handles secret substitution in auth values
- **Auth Checker**: Performs authentication logic

### Implementation Patterns

#### Authentication Merging Strategy
```typescript
function mergeAuthConfigs(config: ServerConfig): AuthConfig[] {
  const configs: AuthConfig[] = []
  
  // Add legacy auth if present
  if (config.auth && config.authHeader) {
    configs.push({ header: config.authHeader, value: config.auth })
  }
  
  // Add modern auth configs, taking precedence on conflicts
  if (config.authConfigs) {
    config.authConfigs.forEach(modern => {
      // Remove legacy config with same header name
      const legacyIndex = configs.findIndex(c => 
        c.header.toLowerCase() === modern.header.toLowerCase()
      )
      if (legacyIndex >= 0) configs.splice(legacyIndex, 1)
      configs.push(modern)
    })
  }
  
  return configs
}
```

#### Authentication Logic Flow
1. Merge legacy and modern auth configurations
2. For each auth config, check if header exists in request
3. Compare header values (case-sensitive exact match)
4. Success if any auth config matches
5. Fail if no matches and auth is required

#### Security Considerations
- Constant-time comparison for auth values (timing attack prevention)
- Secure header handling to prevent injection
- Memory cleanup of auth values after comparison
- No logging of actual auth values or secrets

### Performance Optimizations
- Early exit on first successful auth match
- Cache merged auth configurations per request
- Efficient header lookup using case-insensitive comparison
- Minimize secret interpolation operations

### Error Handling
- Generic "Authentication required" message for all auth failures
- Detailed logging without exposing sensitive data
- Graceful handling of malformed auth configurations
- Clear separation between auth failures and system errors