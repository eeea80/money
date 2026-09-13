import { describe, it, expect } from 'vitest'
import { parseDuration } from './duration.js'

describe('parseDuration', () => {
  it('parses minutes-only', () => {
    expect(parseDuration('30m')).toBe(30 * 60 * 1000)
  })

  it('parses hours-only', () => {
    expect(parseDuration('1h')).toBe(60 * 60 * 1000)
  })

  it('parses seconds-only', () => {
    expect(parseDuration('45s')).toBe(45 * 1000)
  })

  it('parses combined h+m+s', () => {
    expect(parseDuration('2h15m30s')).toBe((2 * 3600 + 15 * 60 + 30) * 1000)
  })

  it('parses h+m subset', () => {
    expect(parseDuration('1h30m')).toBe((3600 + 30 * 60) * 1000)
  })

  it('parses m+s subset', () => {
    expect(parseDuration('5m30s')).toBe((5 * 60 + 30) * 1000)
  })

  it('trims surrounding whitespace', () => {
    expect(parseDuration('  30m  ')).toBe(30 * 60 * 1000)
  })

  it('returns null for unparseable format', () => {
    expect(parseDuration('30 minutes')).toBeNull()
    expect(parseDuration('1d')).toBeNull()
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('abc')).toBeNull()
  })

  it('returns null for zero-total duration', () => {
    expect(parseDuration('0m')).toBeNull()
    expect(parseDuration('0h0m0s')).toBeNull()
  })
})
