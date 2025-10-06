/**
 * Extracts the first path segment from a URL pathname to use as server key.
 *
 * This function parses the URL path and returns the first non-empty segment,
 * which determines which downstream server should handle the request.
 *
 * @param pathname - The URL pathname (e.g., "/api/users/123")
 * @returns The server key (e.g., "api") or null if no valid segment found
 *
 * @example
 * getServerKey("/api/users/123") // Returns "api"
 * getServerKey("/web/dashboard") // Returns "web"
 * getServerKey("/") // Returns null
 */
export function getServerKey(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean)
  return segments.length > 0 ? segments[0] : null
}

/**
 * Builds the backend URL by combining base URL with remaining path and query parameters.
 *
 * This function constructs the target URL for the downstream service by:
 * - Removing the server key segment from the original path
 * - Combining the cleaned remaining path with the base URL
 * - Preserving all query parameters from the original request
 *
 * @param baseUrl - The base URL of the downstream server (e.g., "https://api.example.com")
 * @param originalUrl - The complete original URL (e.g., "https://proxy.example.com/api/users/123?filter=active")
 * @param serverKey - The server key to remove from the path (e.g., "api")
 * @returns The complete backend URL (e.g., "https://api.example.com/users/123?filter=active")
 *
 * @example
 * buildBackendUrl(
 *   "https://api.example.com",
 *   "https://proxy.example.com/api/users/123?filter=active",
 *   "api"
 * )
 * // Returns "https://api.example.com/users/123?filter=active"
 */
export function buildBackendUrl(
  baseUrl: string,
  originalUrl: string,
  serverKey: string
): string {
  const url = new URL(originalUrl)
  const pathname = url.pathname

  // Remove the server key and leading slash from pathname
  const serverKeyWithSlash = `/${serverKey}`
  const remainingPath = pathname.startsWith(serverKeyWithSlash)
    ? pathname.slice(serverKeyWithSlash.length)
    : pathname

  // Ensure base URL doesn't end with slash and remaining path starts with slash if not empty
  const cleanBaseUrl = baseUrl.replace(/\/$/, '')
  const cleanRemainingPath = remainingPath.startsWith('/') ? remainingPath : `/${remainingPath}`

  return `${cleanBaseUrl}${cleanRemainingPath}${url.search}`
}