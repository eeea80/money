import { describe, expect, it } from 'vitest'

import type { WorkspaceService } from '../../workspaces/service.js'
import { createWorkspaceRoutes } from './workspaces.js'

describe('Workspace creation storage response', () => {
  it('returns an actionable 507 without exposing a partial Workspace', async () => {
    const app = createWorkspaceRoutes({
      config: { launcherRepoRoot: '/repo' },
      templates: { defaultName: () => 'chat' },
      creator: {
        create: async () => ({
          ok: false,
          code: 'insufficient_storage',
          message: 'Not enough free space to create this Workspace. Free disk space and retry.',
        }),
      },
    } as unknown as WorkspaceService)

    const response = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tag: 'diskfull', template: 'chat' }),
    })

    expect(response.status).toBe(507)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: 'insufficient_storage',
      message: expect.stringContaining('Free disk space'),
    }))
  })
})
