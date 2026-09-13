/**
 * Snapshot scheduler — periodic snapshots via Pump.
 *
 * Pre-AgentWork refactor, this registered an internal `__snapshot__`
 * cron job and subscribed to `cron.fire` filtered by jobName. That was
 * conceptual debt — snapshot is a state-persistence service, not an
 * AI-work event consumer. It now drives a private Pump (interval-based
 * timer) and calls into `snapshotService.takeAllSnapshots('scheduled')`
 * directly. No event-log involvement at the timer layer.
 *
 * UTA post-push / post-reject hooks still call
 * `snapshotService.takeSnapshot(id, trigger)` directly — those paths
 * are unchanged.
 */

import type { SnapshotService } from './service.js'
import { createPump, type Pump } from '@/core/pump.js'

export interface SnapshotConfig {
  enabled: boolean
  every: string
}

export interface SnapshotScheduler {
  start(): Promise<void>
  stop(): void
  /** Manually trigger a scheduled snapshot run (e.g. for tests / UI). */
  runNow(): Promise<void>
}

export function createSnapshotScheduler(deps: {
  snapshotService: SnapshotService
  config: SnapshotConfig
}): SnapshotScheduler {
  const { snapshotService, config } = deps

  const pump: Pump = createPump({
    name: 'snapshot',
    every: config.every,
    enabled: config.enabled,
    onTick: async () => {
      await snapshotService.takeAllSnapshots('scheduled')
    },
  })

  return {
    async start() {
      pump.start()
    },
    stop() {
      pump.stop()
    },
    async runNow() {
      await pump.runNow()
    },
  }
}
