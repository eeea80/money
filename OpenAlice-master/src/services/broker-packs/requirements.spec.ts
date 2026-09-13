import { describe, expect, it } from 'vitest'

import type { BrokerPackReleaseAsset } from '../../core/broker-pack-catalog.js'
import { assertBrokerPackRequirements } from './requirements.js'

const longbridge: BrokerPackReleaseAsset = {
  engine: 'longbridge',
  version: '1.0.0',
  apiVersion: 1,
  file: 'longbridge.tgz',
  sha256: '0'.repeat(64),
  size: 1,
  entry: 'dist/index.js',
  requirements: { libc: { family: 'glibc', minVersion: '2.39' } },
}

describe('assertBrokerPackRequirements', () => {
  it('accepts the minimum and newer glibc versions numerically', () => {
    expect(() => assertBrokerPackRequirements(longbridge, { platform: 'linux', glibcVersion: '2.39' })).not.toThrow()
    expect(() => assertBrokerPackRequirements(longbridge, { platform: 'linux', glibcVersion: '2.41' })).not.toThrow()
    expect(() => assertBrokerPackRequirements(longbridge, { platform: 'linux', glibcVersion: '10.1' })).not.toThrow()
  })

  it('rejects older or unknown Linux libc before module evaluation', () => {
    expect(() => assertBrokerPackRequirements(longbridge, { platform: 'linux', glibcVersion: '2.35' }))
      .toThrow(/requires glibc 2\.39\+.*2\.35/i)
    expect(() => assertBrokerPackRequirements(longbridge, { platform: 'linux', glibcVersion: null }))
      .toThrow(/unknown libc/i)
  })

  it('rejects a glibc-only artifact on a non-Linux runtime', () => {
    expect(() => assertBrokerPackRequirements(longbridge, { platform: 'win32', glibcVersion: null }))
      .toThrow(/win32.*no glibc/i)
  })

  it('does not impose libc checks on packs without a requirement', () => {
    expect(() => assertBrokerPackRequirements(
      { ...longbridge, engine: 'ccxt', requirements: undefined },
      { platform: 'linux', glibcVersion: null },
    )).not.toThrow()
  })
})
