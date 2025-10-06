import { ERROR_MESSAGES, HTTP_STATUS, DEFAULT_HEADERS } from './constants';

/**
 * Creates a standardized JSON error response
 */
export function createErrorResponse(
  message: string,
  status: number = HTTP_STATUS.INTERNAL_SERVER_ERROR
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': DEFAULT_HEADERS.CONTENT_TYPE }
  });
}

/**
 * Creates a 404 response for invalid routes
 */
export function createInvalidRouteResponse(): Response {
  return createErrorResponse(ERROR_MESSAGES.INVALID_ROUTE, HTTP_STATUS.NOT_FOUND);
}

/**
 * Creates a 404 response for server not found
 */
export function createServerNotFoundResponse(): Response {
  return createErrorResponse(ERROR_MESSAGES.SERVER_NOT_FOUND, HTTP_STATUS.NOT_FOUND);
}

/**
 * Creates a 500 response for service unavailable (KV errors)
 */
export function createServiceUnavailableResponse(): Response {
  return createErrorResponse(
    ERROR_MESSAGES.SERVICE_UNAVAILABLE,
    HTTP_STATUS.INTERNAL_SERVER_ERROR
  );
}

/**
 * Creates a 500 response for configuration errors
 */
export function createConfigInvalidResponse(message: string = ERROR_MESSAGES.CONFIG_INVALID_REVIEW): Response {
  return createErrorResponse(message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
}

/**
 * Creates a 401 response for unauthorized access
 */
export function createUnauthorizedResponse(): Response {
  return createErrorResponse(ERROR_MESSAGES.UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED);
}

/**
 * Creates a 502 response for backend unavailable
 */
export function createBackendUnavailableResponse(): Response {
  return createErrorResponse(ERROR_MESSAGES.BACKEND_UNAVAILABLE, HTTP_STATUS.BAD_GATEWAY);
}

/**
 * Creates a 500 response for unexpected internal errors
 */
export function createInternalServerErrorResponse(): Response {
  return createErrorResponse(
    ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
    HTTP_STATUS.INTERNAL_SERVER_ERROR
  );
}