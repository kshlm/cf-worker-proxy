# Request Routing Design

## Technical Implementation

### Core Components
- **Path Parser**: Extracts server key from URL pathname
- **URL Builder**: Constructs target downstream URLs
- **Request Router**: Orchestrates routing flow
- **URL Validator**: Validates downstream server URLs

### Implementation Patterns

#### Path Extraction Algorithm
```typescript
function extractServerKey(pathname: string): string | null {
  // Remove leading/trailing slashes and split
  const segments = pathname.replace(/^\/+|\/+$/g, '').split('/')
  // Find first non-empty segment
  return segments.find(segment => segment.length > 0) || null
}
```

#### URL Construction Strategy
- Use `new URL()` for proper URL parsing and construction
- Preserve query parameters with `URL.searchParams`
- Handle edge cases like trailing slashes and empty paths

#### Validation Approach
- Regex pattern for HTTPS URL validation
- URL constructor for comprehensive validation
- Early validation to fail fast on invalid configs

### Performance Considerations
- Minimize string operations in hot path
- Cache parsed URL objects when possible
- Use efficient regex patterns for path parsing

### Security Measures
- Strict HTTPS-only URL validation
- Prevent SSRF through URL validation
- Input sanitization for path segments

### Error Handling
- Graceful handling of malformed URLs
- Clear error messages for different failure modes
- Logging without exposing sensitive URLs