import { Hono } from 'hono'
import { z } from 'zod'
import type { ToolCenter } from '../../core/tool-center.js'
import { readToolsConfig, writeConfigSection } from '../../core/config.js'
import { extractMcpShape, wrapToolExecute } from '../../core/mcp-export.js'

/** Tools routes: inventory, detail, execute, enable/disable */
export function createToolsRoutes(toolCenter: ToolCenter) {
  const app = new Hono()

  /** GET / — inventory + disabled list */
  app.get('/', async (c) => {
    try {
      const inventory = toolCenter.getInventory()
      const { disabled } = await readToolsConfig()
      return c.json({ inventory, disabled })
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  /** PUT / — update disabled list */
  app.put('/', async (c) => {
    try {
      const body = await c.req.json()
      const validated = await writeConfigSection('tools', body)
      return c.json(validated)
    } catch (err) {
      if (err instanceof Error && err.name === 'ZodError') {
        return c.json({ error: 'Validation failed', details: JSON.parse(err.message) }, 400)
      }
      return c.json({ error: String(err) }, 500)
    }
  })

  /** GET /:name — full tool detail with JSON Schema */
  app.get('/:name', (c) => {
    const name = c.req.param('name')
    const tool = toolCenter.get(name)
    if (!tool) return c.json({ error: `Tool not found: ${name}` }, 404)

    let inputSchema: unknown = {}
    try {
      inputSchema = z.toJSONSchema(tool.inputSchema as z.ZodType)
    } catch { /* fallback to empty */ }

    return c.json({
      name,
      group: toolCenter.getGroup(name),
      description: tool.description ?? '',
      inputSchema,
    })
  })

  /** POST /:name/execute — execute a tool with given input */
  app.post('/:name/execute', async (c) => {
    const name = c.req.param('name')
    const tool = toolCenter.get(name)
    if (!tool) return c.json({ error: `Tool not found: ${name}` }, 404)

    const rawInput = await c.req.json().catch(() => ({}))

    // Validate + coerce through MCP shape (handles string→number etc.)
    const shape = extractMcpShape(tool)
    const schema = z.object(shape)
    let validated: Record<string, unknown>
    try {
      validated = await schema.parseAsync(rawInput)
    } catch (err) {
      return c.json({ error: 'Validation failed', details: String(err) }, 400)
    }

    const execute = wrapToolExecute(tool)
    const result = await execute(validated)
    return c.json(result)
  })

  return app
}
