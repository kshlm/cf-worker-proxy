import { getServerKey, buildBackendUrl } from './router';
import { checkAuth } from './auth';
import { Env, ServerConfig, ProcessedServerConfig, RequestContext, KVOperationResult } from './types';
import { secretInterpolationService } from './secret-interpolation';
import { configValidator } from './config-validator';
import { headerProcessor } from './header-processor';
import {
  createInvalidRouteResponse,
  createServerNotFoundResponse,
  createServiceUnavailableResponse,
  createConfigInvalidResponse,
  createUnauthorizedResponse,
  createBackendUnavailableResponse,
  createInternalServerErrorResponse
} from './errors';

/**
 * Service for processing proxy requests through a pipeline of steps
 */
export class RequestProcessor {
  /**
   * Extracts request context from the incoming request
   *
   * @param request - The incoming request
   * @returns RequestContext with extracted information
   */
  public extractRequestContext(request: Request): RequestContext | null {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const serverKey = getServerKey(pathname);

    if (!serverKey) {
      return null;
    }

    return {
      request,
      serverKey,
      pathname,
      originalUrl: request.url
    };
  }

  /**
   * Loads server configuration from KV storage
   *
   * @param serverKey - The server key to load configuration for
   * @param env - Environment variables including KV namespace
   * @returns KVOperationResult with the server configuration or error
   */
  public async loadServerConfig(
    serverKey: string,
    env: Env
  ): Promise<KVOperationResult<ServerConfig>> {
    try {
      const serverData = await env.PROXY_SERVERS.get(serverKey, { type: 'json' });
      const config = serverData as ServerConfig;

      if (!config) {
        return {
          success: false,
          error: `No configuration found for server key: ${serverKey}`
        };
      }

      return {
        success: true,
        data: config
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: `KV retrieval failed: ${errorMessage}`
      };
    }
  }

  /**
   * Processes server configuration with secret interpolation
   *
   * @param config - The raw server configuration
   * @param env - Environment variables containing secrets
   * @returns ProcessedServerConfig with interpolated secrets
   * @throws Error if configuration processing fails
   */
  public processServerConfiguration(
    config: ServerConfig,
    env: Env
  ): ProcessedServerConfig {
    try {
      return secretInterpolationService.processServerConfig(config, env);
    } catch (error) {
      throw new Error(`Configuration processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validates the processed server configuration
   *
   * @param processedConfig - The processed configuration to validate
   * @throws Error if validation fails
   */
  public validateServerConfiguration(processedConfig: ProcessedServerConfig): void {
    const validation = configValidator.validateProcessedConfig(processedConfig);

    if (!validation.isValid) {
      throw new Error(validation.error?.message || 'Configuration validation failed');
    }
  }

  /**
   * Checks if the request is properly authenticated
   *
   * @param request - The incoming request
   * @param processedConfig - The processed server configuration
   * @returns True if authenticated, false otherwise
   */
  public checkRequestAuthentication(
    request: Request,
    processedConfig: ProcessedServerConfig
  ): boolean {
    return checkAuth(request, processedConfig.auth, processedConfig.authHeader);
  }

  /**
   * Creates the modified request for the backend server
   *
   * @param originalRequest - The original incoming request
   * @param processedConfig - The processed server configuration
   * @param requestContext - The request context
   * @returns Modified Request ready for forwarding to backend
   */
  public createBackendRequest(
    originalRequest: Request,
    processedConfig: ProcessedServerConfig,
    requestContext: RequestContext
  ): Request {
    // Build backend URL
    const targetUrl = buildBackendUrl(
      processedConfig.url,
      requestContext.originalUrl,
      requestContext.serverKey
    );

    // Process headers
    const processedHeaders = headerProcessor.processHeadersForProxy(
      originalRequest,
      processedConfig
    );

    // Create and return the modified request
    return new Request(targetUrl, {
      method: originalRequest.method,
      headers: processedHeaders,
      body: originalRequest.body,
      redirect: originalRequest.redirect,
      duplex: 'half'
    } as RequestInit);
  }

  /**
   * Forwards the request to the backend server
   *
   * @param backendRequest - The request to forward
   * @returns Response from the backend server
   * @throws Error if backend request fails
   */
  public async forwardToBackend(backendRequest: Request): Promise<Response> {
    try {
      return await fetch(backendRequest);
    } catch (error) {
      throw new Error(`Backend fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Processes the complete request pipeline
   *
   * @param request - The incoming request
   * @param env - Environment variables
   * @returns Response from the backend or error response
   */
  public async processRequest(request: Request, env: Env): Promise<Response> {
    try {
      // Extract request context
      const requestContext = this.extractRequestContext(request);
      if (!requestContext) {
        return createInvalidRouteResponse();
      }

      // Load server configuration
      const configResult = await this.loadServerConfig(requestContext.serverKey, env);
      if (!configResult.success) {
        console.error(`Config load failed for server "${requestContext.serverKey}": ${configResult.error}`);

        if (configResult.error?.includes('No configuration found')) {
          return createServerNotFoundResponse();
        }
        return createServiceUnavailableResponse();
      }

      // Process configuration with secret interpolation
      let processedConfig: ProcessedServerConfig;
      try {
        processedConfig = this.processServerConfiguration(configResult.data!, env);
      } catch (error) {
        console.error(`Config processing failed for server "${requestContext.serverKey}": ${error}`);
        return createConfigInvalidResponse();
      }

      // Validate configuration
      try {
        this.validateServerConfiguration(processedConfig);
      } catch (error) {
        console.error(`Config validation failed for server "${requestContext.serverKey}": ${error}`);
        const errorMessage = error instanceof Error ? error.message : 'Configuration invalid: Server setup requires review.';
        return createConfigInvalidResponse(errorMessage);
      }

      // Check authentication
      if (!this.checkRequestAuthentication(request, processedConfig)) {
        const authHeaderName = processedConfig.authHeader || 'Authorization';
        console.warn(`Authentication failed for server "${requestContext.serverKey}" using ${authHeaderName} header`);
        return createUnauthorizedResponse();
      }

      // Create backend request
      const backendRequest = this.createBackendRequest(
        request,
        processedConfig,
        requestContext
      );

      // Forward to backend
      try {
        return await this.forwardToBackend(backendRequest);
      } catch (error) {
        const backendUrl = new URL(backendRequest.url).origin;
        console.error(`Backend request failed for server "${requestContext.serverKey}" (target: "${backendUrl}"): ${error}`);
        return createBackendUnavailableResponse();
      }

    } catch (error) {
      console.error(`Unexpected error processing request to "${request.url}":`, error);
      return createInternalServerErrorResponse();
    }
  }
}

// Export singleton instance for convenience
export const requestProcessor = new RequestProcessor();
