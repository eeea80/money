import type { BrokerPackReleaseAsset } from '../../core/broker-pack-catalog.js'

export interface BrokerPackRuntimeAbi {
  platform: NodeJS.Platform
  glibcVersion: string | null
}

export function assertBrokerPackRequirements(
  asset: BrokerPackReleaseAsset,
  runtime: BrokerPackRuntimeAbi,
): void {
  const libc = asset.requirements?.libc
  if (!libc) return
  if (
    runtime.platform !== 'linux'
    || !runtime.glibcVersion
    || compareNumericVersions(runtime.glibcVersion, libc.minVersion) < 0
  ) {
    const actual = runtime.platform === 'linux'
      ? runtime.glibcVersion ?? 'an unknown libc'
      : `${runtime.platform} (no glibc runtime)`
    throw new Error(`${asset.engine} requires glibc ${libc.minVersion}+; this system reports ${actual}`)
  }
}

function compareNumericVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}
