/**
 * Error messages used throughout the application
 */
export const ERROR_MESSAGES = {
  INVALID_ROUTE: "Invalid route: No server configured for this path.",
  SERVER_NOT_FOUND: "Server not found: No configuration available for this route.",
  SERVICE_UNAVAILABLE: "Service unavailable: Unable to load configuration.",
  CONFIG_INVALID_REVIEW: "Configuration invalid: Server setup requires review.",
  CONFIG_INVALID_URL: "Configuration invalid: Backend URL is malformed or insecure.",
  UNAUTHORIZED: "Unauthorized: Invalid or missing credentials.",
  BACKEND_UNAVAILABLE: "Backend unavailable: Target server is unreachable.",
  INTERNAL_SERVER_ERROR: "Internal server error: An unexpected issue occurred."
} as const;

/**
 * HTTP status codes used in responses
 */
export const HTTP_STATUS = {
  OK: 200,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502
} as const;

/**
 * Default header names
 */
export const DEFAULT_HEADERS = {
  AUTHORIZATION: 'Authorization',
  CONTENT_TYPE: 'application/json'
} as const;

/**
 * URL protocols
 */
export const PROTOCOLS = {
  HTTPS: 'https:'
} as const;