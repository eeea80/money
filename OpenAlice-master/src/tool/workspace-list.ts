import { tool } from 'ai'
import { z } from 'zod'

import type { WorkspaceToolFactory } from '../core/workspace-tool-center.js'

/** Active office-floor inventory. Departed desks intentionally do not appear. */
export const workspaceListFactory: WorkspaceToolFactory = {
  name: 'workspace_list',
  build(ctx) {
    return tool({
      description: [
        'List every active OpenAlice Workspace with its stable id, role shape, live workload counts, and recent attributable Session titles.',
        '',
        'Use this before auditing, delegating, consolidating, or upgrading desks. The result is the active office floor only; a missing Workspace may be departed rather than deleted.',
        'Use the recent Session titles to form a first-pass responsibility map. Use peer path or peer sessions only for a chosen Workspace that genuinely needs deeper inspection.',
      ].join('\n'),
      inputSchema: z.object({}),
      execute: async () => {
        if (!ctx.workspaceInventory) {
          return { ok: false as const, error: 'workspace inventory is unavailable in this context' }
        }
        try {
          const workspaces = await ctx.workspaceInventory()
          return { ok: true as const, count: workspaces.length, workspaces }
        } catch (error) {
          return {
            ok: false as const,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      },
    })
  },
}
