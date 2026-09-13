import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import { SessionStore } from '../../core/session.js'
import { readWebSubchannels, writeWebSubchannels } from '../../core/config.js'
import type { WebChannel } from '../../core/types.js'

/**
 * SSE client handle for a chat sub-channel's event stream. Defined here
 * (relocated from the deleted chat route module) because the web
 * sub-channels surface is its only remaining consumer. Slated to be
 * removed wholesale when the legacy channel stack is retired.
 */
export interface SSEClient {
  id: string
  send: (data: string) => void
}

interface ChannelsDeps {
  sessions: Map<string, SessionStore>
  sseByChannel: Map<string, Map<string, SSEClient>>
}

/**
 * Slugify a free-form label into an id matching the subchannel id schema
 * (`^[a-z0-9-_]+$`). Falls back to a random hex id when the label has no
 * Latin-alphabet content (e.g., pure CJK), so users with non-Latin names
 * still get usable channels — they just won't see the slug.
 */
function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  if (slug) return slug
  return `channel-${randomBytes(3).toString('hex')}`
}

/** Pick an id derived from `label` that doesn't collide with anything in `existing` or the reserved `default` id. */
function makeUniqueId(label: string, existing: WebChannel[]): string {
  const taken = new Set<string>(existing.map((c) => c.id))
  taken.add('default')
  const base = slugify(label)
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** Channels CRUD: GET /, POST /, PUT /:id, DELETE /:id */
export function createChannelsRoutes({ sessions, sseByChannel }: ChannelsDeps) {
  const app = new Hono()

  /**
   * GET / — list all channels.
   * Default is always first. If subchannels file has a stored 'default' entry
   * (because the user renamed it), use that; otherwise fall back to the
   * built-in label.
   */
  app.get('/', async (c) => {
    const subChannels = await readWebSubchannels()
    const defaultEntry = subChannels.find((ch) => ch.id === 'default') ?? { id: 'default', label: 'Alice' }
    const others = subChannels.filter((ch) => ch.id !== 'default')
    return c.json({ channels: [defaultEntry, ...others] })
  })

  /**
   * POST / — create a new sub-channel.
   * Caller supplies only a free-form `label`; the storage id is derived
   * server-side via slugify + collision suffixing.
   */
  app.post('/', async (c) => {
    const body = await c.req.json() as {
      label?: string
      systemPrompt?: string
      profile?: string
      disabledTools?: string[]
    }

    const label = body.label?.trim()
    if (!label) {
      return c.json({ error: 'name is required' }, 400)
    }

    const existing = await readWebSubchannels()

    // Effective channel list includes the default's fallback label so the
    // user can't accidentally create a duplicate of "Alice".
    const defaultEntry = existing.find((c) => c.id === 'default') ?? { id: 'default', label: 'Alice' } as WebChannel
    const effective = [defaultEntry, ...existing.filter((c) => c.id !== 'default')]

    const labelLc = label.toLowerCase()
    if (effective.some((c) => c.label.trim().toLowerCase() === labelLc)) {
      return c.json({ error: `A channel named "${label}" already exists` }, 409)
    }

    const id = makeUniqueId(label, existing)

    const newChannel: WebChannel = {
      id,
      label,
      ...(body.systemPrompt ? { systemPrompt: body.systemPrompt } : {}),
      ...(body.profile ? { profile: body.profile } : {}),
      ...(body.disabledTools?.length ? { disabledTools: body.disabledTools } : {}),
    }

    await writeWebSubchannels([...existing, newChannel])

    // Initialize session and SSE map for the new channel
    const session = new SessionStore(`web/${id}`)
    await session.restore()
    sessions.set(id, session)
    sseByChannel.set(id, new Map())

    return c.json({ channel: newChannel }, 201)
  })

  /**
   * PUT /:id — update a channel (including default).
   * Default is editable but can't be deleted; on first edit it's inserted
   * into the subchannels file as a regular entry.
   */
  app.put('/:id', async (c) => {
    const id = c.req.param('id')

    const body = await c.req.json() as {
      label?: string
      systemPrompt?: string
      profile?: string | null
      disabledTools?: string[]
    }

    const existing = await readWebSubchannels()
    const idx = existing.findIndex((ch) => ch.id === id)

    // First-time edit of default: it's not yet persisted, insert it.
    if (idx === -1) {
      if (id !== 'default') return c.json({ error: 'channel not found' }, 404)
      const inserted: WebChannel = {
        id: 'default',
        label: body.label?.trim() || 'Alice',
        ...(body.systemPrompt ? { systemPrompt: body.systemPrompt } : {}),
        ...(body.profile ? { profile: body.profile } : {}),
        ...(body.disabledTools?.length ? { disabledTools: body.disabledTools } : {}),
      }
      await writeWebSubchannels([...existing, inserted])
      return c.json({ channel: inserted })
    }

    const updated: WebChannel = {
      ...existing[idx],
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.systemPrompt !== undefined ? { systemPrompt: body.systemPrompt || undefined } : {}),
      ...(body.profile !== undefined ? { profile: body.profile || undefined } : {}),
      ...(body.disabledTools !== undefined ? { disabledTools: body.disabledTools?.length ? body.disabledTools : undefined } : {}),
    }
    existing[idx] = updated
    await writeWebSubchannels(existing)

    return c.json({ channel: updated })
  })

  /** DELETE /:id — delete a sub-channel */
  app.delete('/:id', async (c) => {
    const id = c.req.param('id')
    if (id === 'default') return c.json({ error: 'cannot delete default channel' }, 400)

    const existing = await readWebSubchannels()
    if (!existing.find((ch) => ch.id === id)) return c.json({ error: 'channel not found' }, 404)

    await writeWebSubchannels(existing.filter((ch) => ch.id !== id))

    // Clean up in-memory state
    sessions.delete(id)
    sseByChannel.delete(id)

    return c.json({ success: true })
  })

  return app
}
