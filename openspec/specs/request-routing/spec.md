# Request Routing Specification

## Purpose
Extract the first path segment from incoming URLs to determine which downstream server should handle the request, and construct the target URL for request forwarding while validating the server configuration.

## Overview
The request routing capability extracts the first path segment from incoming URLs to determine which downstream server should handle the request. It validates the path, retrieves the corresponding server configuration, and constructs the target URL for request forwarding.

## Requirements

### Requirement: Path Segment Extraction
The system SHALL extract the first non-empty path segment from the incoming request URL to use as the server routing key.

#### Scenario: Valid path with server key
- **WHEN** a request arrives at `/api/users/123`
- **THEN** the system SHALL extract `api` as the server key
- **AND** the remaining path SHALL be `users/123`

#### Scenario: Path with leading slash
- **WHEN** a request arrives at `//api/users`
- **THEN** the system SHALL extract `api` as the server key
- **AND** ignore empty segments

#### Scenario: Root path request
- **WHEN** a request arrives at `/`
- **THEN** the system SHALL return 404 Not Found
- **AND** not attempt to route to any server

#### Scenario: Empty path request
- **WHEN** a request arrives with an empty pathname
- **THEN** the system SHALL return 404 Not Found

### Requirement: Server Configuration Lookup
The system SHALL retrieve server configuration from KV using the extracted path segment as the key.

#### Scenario: Existing server configuration
- **WHEN** the server key `api` exists in KV configuration
- **THEN** the system SHALL retrieve the corresponding ServerConfig object
- **AND** use it for request processing

#### Scenario: Non-existent server configuration
- **WHEN** the server key `unknown` does not exist in KV configuration
- **THEN** the system SHALL return 404 Not Found with message "Server not found"

#### Scenario: KV read failure
- **WHEN** KV namespace read operation fails
- **THEN** the system SHALL return 500 Internal Server Error with message "Configuration error"

### Requirement: Target URL Construction
The system SHALL construct the downstream target URL by combining the server's base URL with the remaining path and original query parameters.

#### Scenario: Simple path forwarding
- **WHEN** request is `/api/users/123` and server config URL is `https://api.example.com`
- **THEN** the target URL SHALL be `https://api.example.com/users/123`

#### Scenario: Path with query parameters
- **WHEN** request is `/api/search?q=test&page=2` and server config URL is `https://api.example.com`
- **THEN** the target URL SHALL be `https://api.example.com/search?q=test&page=2`

#### Scenario: Root server path
- **WHEN** request is `/api/` and server config URL is `https://api.example.com`
- **THEN** the target URL SHALL be `https://api.example.com/`

#### Scenario: Server with trailing slash
- **WHEN** request is `/web/dashboard` and server config URL is `https://web.example.com/`
- **THEN** the target URL SHALL be `https://web.example.com/dashboard`

### Requirement: URL Validation
The system SHALL validate that all server configuration URLs use HTTPS protocol.

#### Scenario: Valid HTTPS URL
- **WHEN** server config URL is `https://api.example.com`
- **THEN** the system SHALL accept the URL for routing

#### Scenario: Invalid HTTP URL
- **WHEN** server config URL is `http://api.example.com`
- **THEN** the system SHALL reject the configuration
- **AND** return 500 Internal Server Error

#### Scenario: Invalid URL format
- **WHEN** server config URL is `not-a-url`
- **THEN** the system SHALL reject the configuration
- **AND** return 500 Internal Server Error

### Requirement: Request Method and Body Preservation
The system SHALL preserve the original HTTP method and request body when forwarding to downstream servers.

#### Scenario: GET request
- **WHEN** original request uses GET method
- **THEN** the forwarded request SHALL use GET method
- **AND** shall not include a request body

#### Scenario: POST request with body
- **WHEN** original request uses POST method with JSON body
- **THEN** the forwarded request SHALL use POST method
- **AND** shall include the same JSON body

#### Scenario: PUT request with form data
- **WHEN** original request uses PUT method with form data
- **THEN** the forwarded request SHALL use PUT method
- **AND** shall include the same form data

#### Scenario: DELETE request
- **WHEN** original request uses DELETE method
- **THEN** the forwarded request SHALL use DELETE method