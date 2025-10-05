import { describe, it, expect } from 'vitest'
import { checkAuth } from '../src/auth'

describe('auth', () => {
  describe('checkAuth', () => {
    it('should return true when no auth is required', () => {
      const request = new Request('https://example.com')
      expect(checkAuth(request)).toBe(true)
    })

    it('should return true when Authorization header matches', () => {
      const request = new Request('https://example.com', {
        headers: { Authorization: 'Bearer valid-token' }
      })
      expect(checkAuth(request, 'Bearer valid-token')).toBe(true)
    })

    it('should return false when Authorization header is missing', () => {
      const request = new Request('https://example.com')
      expect(checkAuth(request, 'Bearer required-token')).toBe(false)
    })

    it('should return false when Authorization header does not match', () => {
      const request = new Request('https://example.com', {
        headers: { Authorization: 'Bearer wrong-token' }
      })
      expect(checkAuth(request, 'Bearer correct-token')).toBe(false)
    })

    it('should be case-insensitive for header keys', () => {
      const request = new Request('https://example.com', {
        headers: { authorization: 'Bearer lowercase-key' }
      })
      expect(checkAuth(request, 'Bearer lowercase-key')).toBe(true)
    })

    it('should be case-insensitive for custom header keys', () => {
      const request = new Request('https://example.com', {
        headers: { 'x-api-key': 'secret-key-456' }
      })
      expect(checkAuth(request, 'secret-key-456', 'X-API-Key')).toBe(true)
    })

    it('should handle mixed case header keys', () => {
      const request = new Request('https://example.com', {
        headers: { 'AuThOrIzAtIoN': 'Bearer mixed-case' }
      })
      expect(checkAuth(request, 'Bearer mixed-case')).toBe(true)
    })

    it('should handle mixed case custom header keys', () => {
      const request = new Request('https://example.com', {
        headers: { 'X-aPi-kEy': 'secret-mixed' }
      })
      expect(checkAuth(request, 'secret-mixed', 'x-API-key')).toBe(true)
    })

    // Custom header tests
    it('should return true when custom auth header matches', () => {
      const request = new Request('https://example.com', {
        headers: { 'X-API-Key': 'secret-key-123' }
      })
      expect(checkAuth(request, 'secret-key-123', 'X-API-Key')).toBe(true)
    })

    it('should return false when custom auth header is missing', () => {
      const request = new Request('https://example.com')
      expect(checkAuth(request, 'secret-key-123', 'X-API-Key')).toBe(false)
    })

    it('should return false when custom auth header does not match', () => {
      const request = new Request('https://example.com', {
        headers: { 'X-API-Key': 'wrong-key' }
      })
      expect(checkAuth(request, 'secret-key-123', 'X-API-Key')).toBe(false)
    })

    it('should default to Authorization header when custom header not specified', () => {
      const request = new Request('https://example.com', {
        headers: { Authorization: 'Bearer token' }
      })
      expect(checkAuth(request, 'Bearer token', undefined)).toBe(true)
    })
  })
})