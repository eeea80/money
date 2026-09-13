import { describe, it, expect } from 'vitest'
import { extractMediaFromToolOutput, extractMediaFromToolResultContent } from './media.js'

// ==================== extractMediaFromToolOutput ====================

describe('extractMediaFromToolOutput', () => {
  it('should return empty for null', () => {
    expect(extractMediaFromToolOutput(null)).toEqual([])
  })

  it('should return empty for undefined', () => {
    expect(extractMediaFromToolOutput(undefined)).toEqual([])
  })

  it('should return empty for non-object', () => {
    expect(extractMediaFromToolOutput('hello')).toEqual([])
    expect(extractMediaFromToolOutput(42)).toEqual([])
  })

  it('should extract from details.path', () => {
    const output = { details: { path: '/tmp/screenshot.png' } }
    expect(extractMediaFromToolOutput(output)).toEqual([
      { type: 'image', path: '/tmp/screenshot.png' },
    ])
  })

  it('should prefer details.path over content MEDIA: prefix', () => {
    const output = {
      details: { path: '/preferred.png' },
      content: [{ type: 'text', text: 'MEDIA:/fallback.png' }],
    }
    expect(extractMediaFromToolOutput(output)).toEqual([
      { type: 'image', path: '/preferred.png' },
    ])
  })

  it('should ignore details with empty path', () => {
    const output = { details: { path: '' } }
    expect(extractMediaFromToolOutput(output)).toEqual([])
  })

  it('should ignore details with non-string path', () => {
    const output = { details: { path: 42 } }
    expect(extractMediaFromToolOutput(output)).toEqual([])
  })

  it('should extract from content MEDIA: prefix', () => {
    const output = {
      content: [
        { type: 'text', text: 'MEDIA:/tmp/image.png' },
      ],
    }
    expect(extractMediaFromToolOutput(output)).toEqual([
      { type: 'image', path: '/tmp/image.png' },
    ])
  })

  it('should extract multiple MEDIA: paths', () => {
    const output = {
      content: [
        { type: 'text', text: 'MEDIA:/a.png' },
        { type: 'text', text: 'some text' },
        { type: 'text', text: 'MEDIA:/b.jpg' },
      ],
    }
    expect(extractMediaFromToolOutput(output)).toEqual([
      { type: 'image', path: '/a.png' },
      { type: 'image', path: '/b.jpg' },
    ])
  })

  it('should return empty for content with no MEDIA: prefix', () => {
    const output = {
      content: [{ type: 'text', text: 'just normal text' }],
    }
    expect(extractMediaFromToolOutput(output)).toEqual([])
  })

  it('should return empty for object with no details or content', () => {
    expect(extractMediaFromToolOutput({ foo: 'bar' })).toEqual([])
  })
})

// ==================== extractMediaFromToolResultContent ====================

describe('extractMediaFromToolResultContent', () => {
  it('should return empty for plain text with no MEDIA:', () => {
    expect(extractMediaFromToolResultContent('hello world')).toEqual([])
  })

  it('should extract MEDIA: from plain text', () => {
    expect(extractMediaFromToolResultContent('MEDIA:/tmp/img.png')).toEqual([
      { type: 'image', path: '/tmp/img.png' },
    ])
  })

  it('should extract MEDIA: from inline text', () => {
    expect(extractMediaFromToolResultContent('result: MEDIA:/path/to/file.jpg done')).toEqual([
      { type: 'image', path: '/path/to/file.jpg' },
    ])
  })

  it('should extract from JSON with details.path', () => {
    const input = JSON.stringify({ details: { path: '/tmp/shot.png' }, content: [] })
    expect(extractMediaFromToolResultContent(input)).toEqual([
      { type: 'image', path: '/tmp/shot.png' },
    ])
  })

  it('should extract from JSON array of content blocks', () => {
    const input = JSON.stringify([
      { type: 'text', text: 'MEDIA:/tmp/a.png' },
      { type: 'text', text: 'no media here' },
    ])
    expect(extractMediaFromToolResultContent(input)).toEqual([
      { type: 'image', path: '/tmp/a.png' },
    ])
  })

  it('should extract from JSON object with content array', () => {
    const input = JSON.stringify({
      content: [{ type: 'text', text: 'MEDIA:/tmp/b.png' }],
    })
    expect(extractMediaFromToolResultContent(input)).toEqual([
      { type: 'image', path: '/tmp/b.png' },
    ])
  })

  it('should return empty for JSON with no media', () => {
    const input = JSON.stringify({ content: [{ type: 'text', text: 'no media' }] })
    expect(extractMediaFromToolResultContent(input)).toEqual([])
  })

  it('should return empty for JSON null', () => {
    expect(extractMediaFromToolResultContent('null')).toEqual([])
  })

  it('should return empty for JSON number', () => {
    expect(extractMediaFromToolResultContent('42')).toEqual([])
  })
})
