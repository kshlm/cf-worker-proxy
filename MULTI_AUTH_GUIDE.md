# Multi-Auth Configuration Guide

The `update-proxy-config.ts` script has been enhanced to support multiple authentication headers while maintaining backward compatibility with existing configurations.

## New Features

### 1. Automatic Legacy Conversion
When loading existing configurations from KV, the script automatically converts legacy single-header authentication (`auth` and `authHeader` fields) to the new multi-auth format (`authConfigs` array).

**Legacy format:**
```json
{
  "url": "https://api.example.com",
  "auth": "Bearer ${API_TOKEN}",
  "authHeader": "Authorization"
}
```

**Automatically converted to:**
```json
{
  "url": "https://api.example.com",
  "auth": "Bearer ${API_TOKEN}",
  "authConfigs": [
    {
      "header": "Authorization",
      "value": "Bearer ${API_TOKEN}",
      "required": true
    }
  ]
}
```

### 2. Multi-Auth Configuration
Configure multiple authentication headers with "any one match" logic. Access is granted if ANY configured header matches.

**Example multi-auth configuration:**
```json
{
  "url": "https://api.example.com",
  "authConfigs": [
    {
      "header": "Authorization",
      "value": "Bearer ${BEARER_TOKEN}",
      "required": false
    },
    {
      "header": "X-API-Key",
      "value": "${API_KEY}",
      "required": false
    },
    {
      "header": "X-Service-Token",
      "value": "${SERVICE_TOKEN}",
      "required": true
    }
  ]
}
```

## Interactive Script Usage

### Adding New Entries

1. **Choose Multi-Auth Mode:**
   ```
   Does it need authentication? (y/n): y
   Choose auth mode:
   1. Multiple auth headers (new format)
   2. Single auth header (legacy format)
   Enter choice (1 or 2): 1
   ```

2. **Configure Auth Headers:**
   ```
   --- Auth Configuration 1 ---
   Enter header name (e.g., Authorization, X-API-Key): Authorization
   Choose auth type:
   1. Manual entry (use ${SECRET_NAME} placeholders)
   2. Auto-generate token and save as secret
   3. Auto-generate with custom pattern (use <TOKEN> placeholder)
   Enter choice (1, 2, or 3): 2
   Is this header required? (y/n, default: y): y
   Add another auth configuration? (y/n): y
   ```

3. **Repeat for Additional Headers:**
   ```
   --- Auth Configuration 2 ---
   Enter header name (e.g., Authorization, X-API-Key): X-API-Key
   [...]
   ```

### Modifying Existing Entries

1. **View Current Configuration:**
   ```
   Current authentication: Authorization: [BEARER_TOKEN] (required), X-API-Key: [API_KEY] (optional)
   Change authentication? (y/n): y
   ```

2. **Choose Edit Mode:**
   ```
   Choose auth mode:
   1. Multiple auth headers (new format)
   2. Single auth header (legacy format)
   3. Remove all authentication
   Enter choice (1, 2, or 3): 1
   ```

3. **Edit Auth Configurations:**
   ```
   === Current Authentication Configurations ===
   1. Authorization: [BEARER_TOKEN] (required)
   2. X-API-Key: [API_KEY] (optional)

   Choose action:
   1. Add auth header
   2. Edit auth header
   3. Delete auth header
   4. Done
   Enter choice (1-4):
   ```

## Authentication Logic

### "Any One Match" Rule
- Access is granted if ANY configured authentication header matches
- Required headers must be present and match
- Optional headers grant access if present and match, but don't cause failure if absent
- If all headers are optional and none are present, access is granted

### Required vs Optional Headers
- **Required**: Must be present in the request and match exactly
- **Optional**: If present, must match exactly; if absent, no impact on authentication

## Best Practices

1. **Use Secret Placeholders**: Store sensitive values as Cloudflare secrets using `${SECRET_NAME}` format
2. **Set Appropriate Required Flags**: Mark critical authentication headers as required
3. **Unique Header Names**: Ensure all configured header names are unique (case-insensitive)
4. **Validation**: The script automatically validates header names and values for correctness

## Migration Path

Existing configurations will continue to work unchanged. When you modify an existing entry, you can:
- Continue using the legacy single-header format
- Upgrade to the new multi-auth format
- Remove authentication entirely

The script ensures backward compatibility while providing a smooth migration path to the enhanced authentication system.