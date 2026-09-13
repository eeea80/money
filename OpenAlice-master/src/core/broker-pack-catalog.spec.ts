import { describe, expect, it } from 'vitest'

import { brokerPackArchiveFileName, brokerPackCatalogFileName } from './broker-pack-catalog.js'

describe('broker-pack release asset names', () => {
  it('pins catalog and archive names to version, platform, and architecture', () => {
    expect(brokerPackCatalogFileName('0.80.0-beta', 'win32', 'x64'))
      .toBe('OpenAlice-Broker-Packs-0.80.0-beta-win32-x64.json')
    expect(brokerPackArchiveFileName('0.80.0-beta', 'longbridge', 'linux', 'x64'))
      .toBe('OpenAlice-Broker-longbridge-0.80.0-beta-linux-x64.tgz')
  })

  it('sanitizes release-provided path separators and whitespace', () => {
    expect(brokerPackCatalogFileName('beta/../../unsafe build', 'darwin', 'arm64'))
      .toBe('OpenAlice-Broker-Packs-beta-..-..-unsafe-build-darwin-arm64.json')
  })
})
