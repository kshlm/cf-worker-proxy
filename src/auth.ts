/**
 * Checks if the incoming request has valid authentication.
 * Returns true if auth is not required or if the Authorization header matches expected value.
 */
export function checkAuth(request: Request, requiredAuth?: string): boolean {
  if (!requiredAuth) {
    return true
  }
  
  const authHeader = request.headers.get('Authorization')
  return authHeader === requiredAuth
}