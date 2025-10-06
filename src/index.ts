import { Env } from './types'
import { requestProcessor } from './request-processor'

/**
 * Cloudflare Worker proxy server that routes requests to downstream services.
 *
 * This worker acts as a reverse proxy that:
 * - Extracts server keys from URL paths
 * - Loads server configurations from Cloudflare KV
 * - Handles authentication and secret interpolation
 * - Validates configurations and forwards requests
 * - Provides comprehensive error handling and logging
 */
export default {
  /**
   * Main fetch handler for the Cloudflare Worker
   *
   * @param request - The incoming HTTP request
   * @param env - Environment variables including KV namespace and secrets
   * @returns Promise resolving to the HTTP response
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    return await requestProcessor.processRequest(request, env)
  }
}
