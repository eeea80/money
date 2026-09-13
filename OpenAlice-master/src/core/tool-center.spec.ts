import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ToolCenter } from './tool-center.js'
import type { Tool } from 'ai'

vi.mock('./config.js', () => ({
  readToolsConfig: vi.fn(),
}))

import { readToolsConfig } from './config.js'
const mockReadToolsConfig = vi.mocked(readToolsConfig)

// ==================== Helpers ====================

function makeTool(description = 'A test tool'): Tool {
  return { description } as Tool
}

// ==================== ToolCenter ====================

describe('ToolCenter', () => {
  describe('register + list', () => {
    it('should register and list tool names', () => {
      const tc = new ToolCenter()
      tc.register({ alpha: makeTool(), beta: makeTool() }, 'group1')
      expect(tc.list().sort()).toEqual(['alpha', 'beta'])
    })

    it('should overwrite same-name tool on re-register', () => {
      const tc = new ToolCenter()
      tc.register({ alpha: makeTool('v1') }, 'group1')
      tc.register({ alpha: makeTool('v2') }, 'group2')
      expect(tc.list()).toEqual(['alpha'])
      const inv = tc.getInventory()
      expect(inv[0].group).toBe('group2')
      expect(inv[0].description).toBe('v2')
    })

    it('should handle multiple groups', () => {
      const tc = new ToolCenter()
      tc.register({ a: makeTool() }, 'g1')
      tc.register({ b: makeTool() }, 'g2')
      expect(tc.list().sort()).toEqual(['a', 'b'])
    })

    it('should return empty list when nothing registered', () => {
      const tc = new ToolCenter()
      expect(tc.list()).toEqual([])
    })
  })

  describe('getInventory', () => {
    it('should return name, group, and description', () => {
      const tc = new ToolCenter()
      tc.register({ myTool: makeTool('Does something') }, 'analysis')
      const inv = tc.getInventory()
      expect(inv).toEqual([
        { name: 'myTool', group: 'analysis', description: 'Does something' },
      ])
    })

    it('should truncate long descriptions to 200 chars', () => {
      const tc = new ToolCenter()
      const longDesc = 'x'.repeat(300)
      tc.register({ tool: makeTool(longDesc) }, 'g')
      const inv = tc.getInventory()
      expect(inv[0].description).toHaveLength(200)
    })

    it('should handle tools with no description', () => {
      const tc = new ToolCenter()
      tc.register({ tool: {} as Tool }, 'g')
      const inv = tc.getInventory()
      expect(inv[0].description).toBe('')
    })
  })

  describe('getVercelTools', () => {
    beforeEach(() => {
      mockReadToolsConfig.mockResolvedValue({ disabled: [] })
    })

    it('should return all tools when disabled list is empty', async () => {
      const tc = new ToolCenter()
      tc.register({ a: makeTool(), b: makeTool() }, 'g')
      const tools = await tc.getVercelTools()
      expect(Object.keys(tools).sort()).toEqual(['a', 'b'])
    })

    it('should exclude disabled tools from the result', async () => {
      mockReadToolsConfig.mockResolvedValue({ disabled: ['b'] })
      const tc = new ToolCenter()
      tc.register({ a: makeTool(), b: makeTool(), c: makeTool() }, 'g')
      const tools = await tc.getVercelTools()
      expect(Object.keys(tools).sort()).toEqual(['a', 'c'])
    })

    it('should exclude all matching tools when multiple are disabled', async () => {
      mockReadToolsConfig.mockResolvedValue({ disabled: ['a', 'c'] })
      const tc = new ToolCenter()
      tc.register({ a: makeTool(), b: makeTool(), c: makeTool() }, 'g')
      const tools = await tc.getVercelTools()
      expect(Object.keys(tools)).toEqual(['b'])
    })

    it('should not error when disabled list contains unknown tool names', async () => {
      mockReadToolsConfig.mockResolvedValue({ disabled: ['nonexistent'] })
      const tc = new ToolCenter()
      tc.register({ a: makeTool() }, 'g')
      const tools = await tc.getVercelTools()
      expect(Object.keys(tools)).toEqual(['a'])
    })

    it('should return empty object when all tools are disabled', async () => {
      mockReadToolsConfig.mockResolvedValue({ disabled: ['a', 'b'] })
      const tc = new ToolCenter()
      tc.register({ a: makeTool(), b: makeTool() }, 'g')
      const tools = await tc.getVercelTools()
      expect(Object.keys(tools)).toEqual([])
    })

    it('should return empty object when no tools are registered', async () => {
      const tc = new ToolCenter()
      const tools = await tc.getVercelTools()
      expect(tools).toEqual({})
    })
  })

  describe('getMcpTools', () => {
    beforeEach(() => {
      mockReadToolsConfig.mockResolvedValue({ disabled: [] })
    })

    it('should return same results as getVercelTools when disabled list is empty', async () => {
      const tc = new ToolCenter()
      tc.register({ x: makeTool(), y: makeTool() }, 'g')
      const vercel = await tc.getVercelTools()
      const mcp = await tc.getMcpTools()
      expect(Object.keys(mcp).sort()).toEqual(Object.keys(vercel).sort())
    })

    it('should apply disabled list filtering same as getVercelTools', async () => {
      mockReadToolsConfig.mockResolvedValue({ disabled: ['x'] })
      const tc = new ToolCenter()
      tc.register({ x: makeTool(), y: makeTool() }, 'g')
      const tools = await tc.getMcpTools()
      expect(Object.keys(tools)).toEqual(['y'])
    })
  })
})
