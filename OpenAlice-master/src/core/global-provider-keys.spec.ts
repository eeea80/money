/**
 * User-global provider keys — merge-under + mirror-on-save semantics.
 *
 * Fully sandboxed: OPENALICE_HOME points the instance data dir and
 * OPENALICE_GLOBAL_DIR the user-global dir at temp folders, and config.js
 * is imported DYNAMICALLY after the env is set (its CONFIG_DIR is resolved
 * at module load). The real data/config and ~/.openalice are never touched
 * — an earlier version of this spec wrote through to the developer's real
 * config; don't regress that.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

let dataHome: string
let globalDir: string
let config: typeof import('./config.js')

beforeAll(async () => {
  dataHome = await mkdtemp(join(tmpdir(), 'oa-home-'))
  globalDir = await mkdtemp(join(tmpdir(), 'oa-global-'))
  process.env['OPENALICE_HOME'] = dataHome
  process.env['OPENALICE_GLOBAL_DIR'] = globalDir
  // Import AFTER env is set — paths.ts/config.ts resolve their roots at load.
  config = await import('./config.js')
})

afterAll(async () => {
  delete process.env['OPENALICE_HOME']
  delete process.env['OPENALICE_GLOBAL_DIR']
  await rm(dataHome, { recursive: true, force: true })
  await rm(globalDir, { recursive: true, force: true })
})

async function seedGlobal(keys: Record<string, string>) {
  await writeFile(join(globalDir, 'provider-keys.json'), JSON.stringify(keys))
}

async function seedLocal(providerKeys: Record<string, string>) {
  await mkdir(join(dataHome, 'data', 'config'), { recursive: true })
  await writeFile(
    join(dataHome, 'data', 'config', 'market-data.json'),
    JSON.stringify({ providerKeys }),
  )
}

describe('global provider keys', () => {
  it('fills gaps from the global file; the instance value wins per key', async () => {
    await seedGlobal({ fred: 'global-fred', fmp: 'global-fmp' })
    await seedLocal({ fmp: 'local-fmp' })
    const cfg = await config.readMarketDataConfig()
    expect(cfg.providerKeys.fred).toBe('global-fred') // gap filled
    expect(cfg.providerKeys.fmp).toBe('local-fmp')    // local wins
  })

  it('mirror-on-save: non-empty sets, explicit empty clears, absent untouched', async () => {
    await seedGlobal({ fred: 'old-fred', eia: 'old-eia', tiingo: 'old-tiingo' })
    await seedLocal({})
    await config.writeConfigSection('marketData', {
      providerKeys: { fred: 'new-fred', eia: '' }, // tiingo absent from payload
    })
    const global = JSON.parse(await readFile(join(globalDir, 'provider-keys.json'), 'utf-8'))
    expect(global.fred).toBe('new-fred')      // updated
    expect(global.eia).toBeUndefined()        // explicitly cleared → cleared globally
    expect(global.tiingo).toBe('old-tiingo')  // absent from payload → survives
  })

  it('missing/corrupt global file degrades to no-op', async () => {
    await writeFile(join(globalDir, 'provider-keys.json'), 'not json{{{')
    await seedLocal({ fmp: 'local-fmp' })
    const cfg = await config.readMarketDataConfig()
    expect(cfg.providerKeys.fmp).toBe('local-fmp')
    expect(cfg.providers.equity).toBeTruthy()
  })
})
