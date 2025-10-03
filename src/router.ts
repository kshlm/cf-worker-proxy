/**
 * Extracts the first path segment from a URL pathname to use as server key.
 * Returns null if pathname is empty or only contains slashes.
 */
export function getServerKey(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean)
  return segments.length > 0 ? segments[0] : null
}

/**
 * Builds the backend URL by combining base URL with remaining path and query.
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