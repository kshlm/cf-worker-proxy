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
    
    it('should be case-sensitive', () => {
      const request = new Request('https://example.com', {
        headers: { Authorization: 'bearer lowercase' }
      })
      expect(checkAuth(request, 'Bearer lowercase')).toBe(false)
    })
  })
})