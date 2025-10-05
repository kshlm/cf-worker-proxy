/**
 * Checks if the incoming request has valid authentication.
 * Returns true if auth is not required or if the specified auth header matches expected value.
 */
export function checkAuth(request: Request, requiredAuth?: string, authHeaderName?: string): boolean {
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

  return authHeaderValue === requiredAuth
}