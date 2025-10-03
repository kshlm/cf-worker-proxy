import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getServerKey, buildBackendUrl } from '../src/router'

describe('router', () => {
  describe('getServerKey', () => {
    it('should extract first path segment', () => {
      expect(getServerKey('/api/users/123')).toBe('api')
      expect(getServerKey('/web/dashboard')).toBe('web')
      expect(getServerKey('/test')).toBe('test')
    })
    
    it('should handle multiple slashes', () => {
      expect(getServerKey('//api//users')).toBe('api')
      expect(getServerKey('/api/')).toBe('api')
    })
    
    it('should return null for empty paths', () => {
      expect(getServerKey('/')).toBeNull()
      expect(getServerKey('')).toBeNull()
      expect(getServerKey('///')).toBeNull()
    })
  })
  
  describe('buildBackendUrl', () => {
    it('should build correct backend URL', () => {
      const result = buildBackendUrl(
        'https://api.example.com',
        'https://proxy.example.com/api/users/123?query=test',
        'api'
      )
      expect(result).toBe('https://api.example.com/users/123?query=test')
    })
    
    it('should handle trailing slashes in base URL', () => {
      const result = buildBackendUrl(
        'https://api.example.com/',
        'https://proxy.example.com/api/users',
        'api'
      )
      expect(result).toBe('https://api.example.com/users')
    })
    
    it('should handle empty remaining path', () => {
      const result = buildBackendUrl(
        'https://api.example.com',
        'https://proxy.example.com/api',
        'api'
      )
      expect(result).toBe('https://api.example.com/')
    })
    
    it('should preserve query parameters', () => {
      const result = buildBackendUrl(
        'https://api.example.com',
        'https://proxy.example.com/web/search?q=test&limit=10',
        'web'
      )
      expect(result).toBe('https://api.example.com/search?q=test&limit=10')
    })
  })
})