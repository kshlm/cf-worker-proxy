/**
 * Checks if the incoming request has valid authentication.
 *
 * This function validates authentication by comparing the value of the specified
 * authentication header in the incoming request with the expected authentication value.
 * It supports both the default Authorization header and custom header names.
 *
 * @param request - The incoming HTTP request to authenticate
 * @param requiredAuth - The expected authentication value (undefined if no auth required)
 * @param authHeaderName - The name of the header to check (defaults to 'Authorization')
 * @returns True if authentication is not required or if the header value matches expected value
 *
 * @example
 * // Check default Authorization header
 * const isValid = checkAuth(request, 'Bearer my-token')
 *
 * @example
 * // Check custom header
 * const isValid = checkAuth(request, 'secret-key', 'X-API-Key')
 */
export function checkAuth(request: Request, requiredAuth?: string, authHeaderName?: string): boolean {
  // If no authentication is required, allow the request
  if (!requiredAuth) {
    return true
  }

  // Default to Authorization header if no custom header specified
  const headerName = authHeaderName || 'Authorization'

  // Find header case-insensitively
  let authHeaderValue = null
  for (const [key, value] of request.headers.entries()) {
    if (key.toLowerCase() === headerName.toLowerCase()) {
      authHeaderValue = value
      break
    }
  }

  // Return true only if the header value matches exactly
  return authHeaderValue === requiredAuth
}