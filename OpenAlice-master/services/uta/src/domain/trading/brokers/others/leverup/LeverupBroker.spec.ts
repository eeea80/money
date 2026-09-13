/**
 * LeverupBroker unit tests.
 *
 * Strategy: mock the network surface (fetch + viem PublicClient) and run
 * the broker against deterministic responses. EIP-712 signing happens with
 * a real test private key — signatures are deterministic and we can assert
 * them, plus catch regressions in the typed-data schema.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order, UNSET_DECIMAL } from '@traderalice/ibkr'
import '../../../contract-ext.js'

// Stable test private key for signature assertions (NOT a real wallet).
// Derives to address 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (anvil/hardhat #1).
const TEST_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const
const TEST_TRADER_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const

// Mock viem's chain reads — chainId probe + USDC.balanceOf
vi.mock('viem', async (orig) => {
  const actual = await orig<typeof import('viem')>()
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getChainId: vi.fn().mockResolvedValue(10143),
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === 'balanceOf') return 1_000_000_000n  // 1000 USDC (6dp)
        if (functionName === 'decimals') return 6
        return 0n
      }),
    })),
  }
})

// fetch is global; we replace it per-test
const originalFetch = globalThis.fetch

import { LeverupBroker } from './LeverupBroker.js'
import { findPairBySymbol } from './pairs.js'
import { qtyToWei, priceToWei, amountInToWei, USDC_DECIMALS } from './decimals.js'
import {
  signOpenPosition,
  signClosePosition,
  accountFromPrivateKey,
  generateOpenSalt,
} from './eip712.js'
import { NETWORK_CONSTANTS } from './types.js'

// ==================== Fetch mocks ====================

interface MockFetchOptions {
  pythUpdateData?: `0x${string}`[]
  pythPrice?: number
  positions?: unknown[]
  relayerOpen?: { inputHash: `0x${string}` } | { error: { status: number; body?: string } }
  relayerClose?: { inputHash: `0x${string}` } | { error: { status: number; body?: string } }
  relayerStatus?: { executed: boolean; success: boolean; txnHash?: `0x${string}`; reason?: string }
}

function installFetchMock(opts: MockFetchOptions = {}): void {
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = init?.method ?? 'GET'

    // Pyth Hermes
    if (url.includes('hermes.pyth.network')) {
      return new Response(JSON.stringify({
        binary: { encoding: 'hex', data: opts.pythUpdateData ?? ['0xdeadbeef'] },
        parsed: [{
          id: 'feed-id',
          price: { price: String(Math.round((opts.pythPrice ?? 60000) * 1e8)), conf: '0', expo: -8, publish_time: 1700000000 },
          ema_price: { price: String(Math.round((opts.pythPrice ?? 60000) * 1e8)), conf: '0', expo: -8, publish_time: 1700000000 },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    // Reader REST positions
    if (url.includes('service.leverup.xyz/v1/user/') && url.includes('/positions')) {
      return new Response(JSON.stringify({
        content: opts.positions ?? [],
        pageNumber: 0,
        pageSize: 100,
        totalPages: 1,
        totalElements: opts.positions?.length ?? 0,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    // Relayer open
    if (url.includes('/v1/trading/send-open-position')) {
      const r = opts.relayerOpen ?? { inputHash: '0x1111111111111111111111111111111111111111111111111111111111111111' as `0x${string}` }
      if ('error' in r) {
        return new Response(r.error.body ?? '', { status: r.error.status })
      }
      return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    // Relayer close
    if (url.includes('/v1/trading/send-close-position')) {
      const r = opts.relayerClose ?? { inputHash: '0x2222222222222222222222222222222222222222222222222222222222222222' as `0x${string}` }
      if ('error' in r) {
        return new Response(r.error.body ?? '', { status: r.error.status })
      }
      return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    // Relayer status
    if (url.includes('/v1/trading/') && url.includes('/status')) {
      return new Response(JSON.stringify(opts.relayerStatus ?? { executed: true, success: true, txnHash: '0xabc' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }

    return new Response('not mocked: ' + url, { status: 404 })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  installFetchMock()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.clearAllMocks()
})

// ==================== Helpers ====================

function makeBroker() {
  return new LeverupBroker({
    network: 'testnet',
    privateKey: TEST_PRIVATE_KEY,
  })
}

async function makeInitializedBroker() {
  const b = makeBroker()
  await b.init()
  return b
}

function makeBuyOrder(qty: string, type = 'MKT'): Order {
  const o = new Order()
  o.action = 'BUY'
  o.orderType = type
  o.totalQuantity = new Decimal(qty)
  return o
}

function makeContract(symbol: string): Contract {
  const c = new Contract()
  c.localSymbol = symbol
  c.symbol = symbol.split('/')[0]
  c.secType = 'CRYPTO_PERP'
  c.exchange = 'LEVERUP'
  c.currency = symbol.split('/')[1] ?? 'USD'
  return c
}

// ==================== Tests ====================

describe('LeverupBroker — config & lifecycle', () => {
  it('parses valid config via fromConfig', () => {
    const b = LeverupBroker.fromConfig({
      id: 'leverup-test',
      brokerConfig: {
        network: 'testnet',
        privateKey: TEST_PRIVATE_KEY,
      },
    })
    expect(b.id).toBe('leverup-test')
    expect(b.label).toContain('LeverUp')
  })

  it('rejects malformed private key', () => {
    expect(() => LeverupBroker.fromConfig({
      id: 'x',
      brokerConfig: {
        network: 'testnet',
        privateKey: '0xnotvalidkey',
      },
    })).toThrow()
  })

  it('init() probes RPC chainId', async () => {
    const b = makeBroker()
    await expect(b.init()).resolves.toBeUndefined()
  })
})

describe('LeverupBroker — searchContracts', () => {
  it('finds BTC pair by base', async () => {
    const b = await makeInitializedBroker()
    const results = await b.searchContracts('BTC')
    const symbols = results.map(r => r.contract.localSymbol)
    expect(symbols).toContain('BTC/USD')
    expect(symbols).toContain('500BTC/USD')
  })

  it('returns empty for unknown', async () => {
    const b = await makeInitializedBroker()
    const results = await b.searchContracts('UNKNOWNXYZ')
    expect(results).toHaveLength(0)
  })

  it('returns empty for empty pattern', async () => {
    const b = await makeInitializedBroker()
    expect(await b.searchContracts('')).toHaveLength(0)
  })

  it('marks pairs with secType=CRYPTO_PERP and exchange=LEVERUP', async () => {
    const b = await makeInitializedBroker()
    const [first] = await b.searchContracts('BTC')
    expect(first.contract.secType).toBe('CRYPTO_PERP')
    expect(first.contract.exchange).toBe('LEVERUP')
  })
})

describe('LeverupBroker — getNativeKey / resolveNativeKey roundtrip', () => {
  it('roundtrips via pair table', async () => {
    const b = await makeInitializedBroker()
    const pair = findPairBySymbol('testnet', 'ETH/USD')!
    const c1 = (await b.searchContracts('ETH'))[0].contract
    const native = b.getNativeKey(c1)
    expect(native).toBe('ETH/USD')

    const c2 = b.resolveNativeKey(native)
    expect(c2.localSymbol).toBe(pair.symbol)
    expect(c2.symbol).toBe(pair.base)
    expect(c2.exchange).toBe('LEVERUP')
  })

  it('falls back to synthetic contract for unknown native key', async () => {
    const b = await makeInitializedBroker()
    const c = b.resolveNativeKey('FAKE/USD')
    expect(c.localSymbol).toBe('FAKE/USD')
    expect(c.symbol).toBe('FAKE')
  })
})

describe('LeverupBroker — placeOrder', () => {
  it('rejects non-market order types', async () => {
    const b = await makeInitializedBroker()
    const order = makeBuyOrder('0.001', 'LMT')
    const result = await b.placeOrder(makeContract('BTC/USD'), order)
    expect(result.success).toBe(false)
    expect(result.error).toContain('market')
  })

  it('rejects unknown pair', async () => {
    const b = await makeInitializedBroker()
    const order = makeBuyOrder('1')
    const result = await b.placeOrder(makeContract('NOTAPAIR/USD'), order)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown')
  })

  it('rejects order with no quantity', async () => {
    const b = await makeInitializedBroker()
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    // totalQuantity defaults to UNSET_DECIMAL
    const result = await b.placeOrder(makeContract('BTC/USD'), order)
    expect(result.success).toBe(false)
    expect(result.error).toContain('totalQuantity')
  })

  it('successfully signs + submits market BTC order', async () => {
    installFetchMock({
      pythPrice: 60000,
      relayerOpen: { inputHash: '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed' },
    })
    const b = await makeInitializedBroker()
    const order = makeBuyOrder('0.01')
    const result = await b.placeOrder(makeContract('BTC/USD'), order)
    expect(result.success).toBe(true)
    expect(result.orderId).toBe('0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed')
    expect(result.orderState?.status).toBe('Submitted')
  })

  it('passes Pyth update data through to relayer', async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('hermes.pyth.network')) {
        return new Response(JSON.stringify({
          binary: { encoding: 'hex', data: ['0xCAFEBABE'] },
          parsed: [{ id: 'x', price: { price: '6000000000000', conf: '0', expo: -8, publish_time: 1700000000 }, ema_price: { price: '0', conf: '0', expo: -8, publish_time: 0 } }],
        }), { status: 200 })
      }
      if (url.includes('send-open-position')) {
        const body = JSON.parse(init!.body as string)
        expect(body.pythUpdateData).toEqual(['0xCAFEBABE'])
        return new Response(JSON.stringify({ inputHash: '0xaaaa000000000000000000000000000000000000000000000000000000000000' }), { status: 200 })
      }
      return new Response('not mocked', { status: 404 })
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const b = await makeInitializedBroker()
    await b.placeOrder(makeContract('BTC/USD'), makeBuyOrder('0.01'))
  })

  it('surfaces relayer 5xx as error', async () => {
    installFetchMock({
      pythPrice: 60000,
      relayerOpen: { error: { status: 503, body: 'Service unavailable' } },
    })
    const b = await makeInitializedBroker()
    const result = await b.placeOrder(makeContract('BTC/USD'), makeBuyOrder('0.01'))
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/503|unavailable/i)
  })
})

describe('LeverupBroker — closePosition', () => {
  it('rejects unknown pair', async () => {
    const b = await makeInitializedBroker()
    const result = await b.closePosition(makeContract('NOTAPAIR/USD'))
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown')
  })

  it('rejects when no open position', async () => {
    const b = await makeInitializedBroker()
    const result = await b.closePosition(makeContract('BTC/USD'))
    expect(result.success).toBe(false)
    expect(result.error).toContain('No open position')
  })

  it('signs + submits close for matching pair', async () => {
    const pair = findPairBySymbol('testnet', 'ETH/USD')!
    installFetchMock({
      positions: [{
        positionHash: '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddead',
        pairName: 'ETH/USD',
        pairBase: pair.pairBase,
        tokenIn: NETWORK_CONSTANTS.testnet.usdc,
        marginToken: NETWORK_CONSTANTS.testnet.usdc,
        isLong: true,
        margin: '100000000',
        qty: '10000000000',
        entryPrice: '3000000000000000000000',
        stopLoss: '0',
        takeProfit: '0',
        openFee: '0',
        executionFee: '0',
        fundingFee: '0',
        holdingFee: '0',
        timestamp: 1700000000,
        status: 'OPEN',
      }],
      relayerClose: { inputHash: '0xbbbb000000000000000000000000000000000000000000000000000000000000' },
    })
    const b = await makeInitializedBroker()
    const result = await b.closePosition(makeContract('ETH/USD'))
    expect(result.success).toBe(true)
    expect(result.orderId).toBe('0xbbbb000000000000000000000000000000000000000000000000000000000000')
  })
})

describe('LeverupBroker — modify / cancel always reject', () => {
  it('modifyOrder returns NotSupported', async () => {
    const b = await makeInitializedBroker()
    const r = await b.modifyOrder('any', {})
    expect(r.success).toBe(false)
    expect(r.error).toContain('does not support')
  })

  it('cancelOrder returns NotSupported', async () => {
    const b = await makeInitializedBroker()
    const r = await b.cancelOrder('any')
    expect(r.success).toBe(false)
    expect(r.error).toContain('not')
  })
})

describe('LeverupBroker — getQuote', () => {
  it('parses Pyth payload into Quote', async () => {
    installFetchMock({ pythPrice: 60000 })
    const b = await makeInitializedBroker()
    const q = await b.getQuote(makeContract('BTC/USD'))
    expect(q.last).toBe('60000')
    expect(q.bid).toBe(q.last)  // Pyth gives mid; bid=ask=last
    expect(q.ask).toBe(q.last)
  })

  it('throws for unknown pair', async () => {
    const b = await makeInitializedBroker()
    await expect(b.getQuote(makeContract('NOTAPAIR/USD'))).rejects.toThrow()
  })
})

describe('LeverupBroker — getAccount + getPositions', () => {
  it('aggregates USDC + positions into AccountInfo', async () => {
    installFetchMock({ positions: [] })
    const b = await makeInitializedBroker()
    const acc = await b.getAccount()
    expect(acc.baseCurrency).toBe('USD')
    expect(new Decimal(acc.totalCashValue).toNumber()).toBeCloseTo(1000, 2)  // 1_000_000_000 wei / 1e6
  })

  it('returns positions mapped to LeverUp pair', async () => {
    const pair = findPairBySymbol('testnet', 'BTC/USD')!
    installFetchMock({
      positions: [{
        positionHash: '0xa1' + '0'.repeat(62),
        pairName: 'BTC/USD',
        pairBase: pair.pairBase,
        tokenIn: NETWORK_CONSTANTS.testnet.usdc,
        marginToken: NETWORK_CONSTANTS.testnet.usdc,
        isLong: true,
        margin: '100000000',
        qty: '100000000',
        entryPrice: '60000000000000000000000',
        stopLoss: '0',
        takeProfit: '0',
        openFee: '0',
        executionFee: '0',
        fundingFee: '0',
        holdingFee: '0',
        timestamp: 1700000000,
        status: 'OPEN',
      }],
    })
    const b = await makeInitializedBroker()
    const positions = await b.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].contract.localSymbol).toBe('BTC/USD')
    expect(positions[0].side).toBe('long')
  })
})

describe('LeverupBroker — getOrder tracks submitted orders', () => {
  it('returns Submitted then Filled across status transitions', async () => {
    let executed = false
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('hermes.pyth.network')) {
        return new Response(JSON.stringify({
          binary: { data: ['0xfff'] },
          parsed: [{ id: 'x', price: { price: '6000000000000', conf: '0', expo: -8, publish_time: 1700000000 }, ema_price: { price: '0', conf: '0', expo: -8, publish_time: 0 } }],
        }), { status: 200 })
      }
      if (url.includes('send-open-position')) {
        return new Response(JSON.stringify({ inputHash: '0xc0c0' + '0'.repeat(60) }), { status: 200 })
      }
      if (url.includes('/status')) {
        const r = executed ? { executed: true, success: true, txnHash: '0xtxn' } : { executed: false, success: false }
        return new Response(JSON.stringify(r), { status: 200 })
      }
      return new Response('nope', { status: 404 })
    }) as unknown as typeof fetch

    const b = await makeInitializedBroker()
    const placed = await b.placeOrder(makeContract('BTC/USD'), makeBuyOrder('0.01'))
    expect(placed.success).toBe(true)

    const stillSubmitted = await b.getOrder(placed.orderId!)
    expect(stillSubmitted?.orderState.status).toBe('Submitted')

    executed = true
    const filled = await b.getOrder(placed.orderId!)
    expect(filled?.orderState.status).toBe('Filled')
  })

  it('returns null for unknown orderId', async () => {
    const b = await makeInitializedBroker()
    const r = await b.getOrder('0xunknown')
    expect(r).toBeNull()
  })
})

describe('LeverupBroker — capabilities', () => {
  it('only advertises CRYPTO_PERP + MKT', async () => {
    const b = await makeInitializedBroker()
    const caps = b.getCapabilities()
    expect(caps.supportedSecTypes).toEqual(['CRYPTO_PERP'])
    expect(caps.supportedOrderTypes).toEqual(['MKT'])
  })

  it('always reports market open', async () => {
    const b = await makeInitializedBroker()
    const clock = await b.getMarketClock()
    expect(clock.isOpen).toBe(true)
  })
})

// ==================== EIP-712 signature determinism ====================

describe('EIP-712 — signature determinism per variant', () => {
  it('nested and flat variants produce different signatures', async () => {
    const account = accountFromPrivateKey(TEST_PRIVATE_KEY)
    const pair = findPairBySymbol('testnet', 'BTC/USD')!
    const message = {
      openData: {
        pairBase: pair.pairBase,
        isLong: true,
        tokenIn: NETWORK_CONSTANTS.testnet.usdc,
        lvToken: NETWORK_CONSTANTS.testnet.lvusd,
        amountIn: amountInToWei('600', USDC_DECIMALS),
        qty: qtyToWei('0.01'),
        price: priceToWei('60000'),
        stopLoss: 0n,
        takeProfit: 0n,
        broker: 0,
      },
      trader: TEST_TRADER_ADDRESS,
      salt: '0x1111111111111111111111111111111111111111111111111111111111111111' as `0x${string}`,
      deadline: 1700000000n,
    }
    const sigNested = await signOpenPosition({
      account,
      chainId: 10143,
      oneClickAgent: NETWORK_CONSTANTS.testnet.oneClickAgent,
      message,
      variant: 'nested',
    })
    const sigFlat = await signOpenPosition({
      account,
      chainId: 10143,
      oneClickAgent: NETWORK_CONSTANTS.testnet.oneClickAgent,
      message,
      variant: 'flat',
    })
    expect(sigNested).toMatch(/^0x[a-f0-9]{130}$/)
    expect(sigFlat).toMatch(/^0x[a-f0-9]{130}$/)
    expect(sigNested).not.toEqual(sigFlat)
  })

  it('close-position signature is stable for identical input', async () => {
    const account = accountFromPrivateKey(TEST_PRIVATE_KEY)
    const message = {
      positionHash: '0xdeadbeef' + '0'.repeat(56) as `0x${string}`,
      deadline: 1700000000n,
    }
    const sig1 = await signClosePosition({
      account,
      chainId: 10143,
      oneClickAgent: NETWORK_CONSTANTS.testnet.oneClickAgent,
      message,
      variant: 'nested',
    })
    const sig2 = await signClosePosition({
      account,
      chainId: 10143,
      oneClickAgent: NETWORK_CONSTANTS.testnet.oneClickAgent,
      message,
      variant: 'nested',
    })
    expect(sig1).toBe(sig2)
  })
})

// ==================== Decimal conversion sanity ====================

describe('decimals — wei round-trip', () => {
  it('qty roundtrips through 10dp', async () => {
    expect(qtyToWei('1.234567')).toBe(12345670000n)
  })

  it('price roundtrips through 18dp', async () => {
    expect(priceToWei('60000')).toBe(60000n * 10n ** 18n)
  })

  it('amountIn at USDC 6dp', async () => {
    expect(amountInToWei('1000', USDC_DECIMALS)).toBe(1_000_000_000n)
  })

  it('generateOpenSalt produces a unique 0x-prefixed 32-byte hex', () => {
    const a = generateOpenSalt()
    const b = generateOpenSalt()
    expect(a).toMatch(/^0x[a-f0-9]{64}$/)
    expect(a).not.toBe(b)
  })
})
