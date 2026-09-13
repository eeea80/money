/**
 * MockBroker TDD tests — written BEFORE implementation.
 *
 * MockBroker is an in-memory exchange that implements IBroker.
 * It's the precision gatekeeper: if the chain passes imprecise floats,
 * these tests will catch it.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order, OrderState } from '@traderalice/ibkr'
import { MockBroker, makeContract, makePosition, makeOpenOrder, makePlaceOrderResult } from './index.js'
import '../../contract-ext.js'

let broker: MockBroker

beforeEach(() => {
  broker = new MockBroker({ cash: 100_000 })
})

// ==================== Precision ====================

describe('precision', () => {
  it('placeOrder quantity survives Decimal round-trip', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|ETH', symbol: 'ETH' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('0.123456789')

    const result = await broker.placeOrder(contract, order)
    expect(result.success).toBe(true)
    // Verify via position — placeOrder doesn't return execution (async model)
    const positions = await broker.getPositions()
    expect(positions[0].quantity.toString()).toBe('0.123456789')
  })

  it('position quantity matches placed order exactly', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|ETH', symbol: 'ETH' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('0.51')

    await broker.placeOrder(contract, order)
    const positions = await broker.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity.toString()).toBe('0.51')
  })

  it('closePosition removes position completely', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|ETH', symbol: 'ETH' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('0.51')

    await broker.placeOrder(contract, order)
    const closeResult = await broker.closePosition(contract)
    expect(closeResult.success).toBe(true)

    const positions = await broker.getPositions()
    expect(positions).toHaveLength(0)
  })

  it('partial close leaves correct remainder via Decimal subtraction', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|ETH', symbol: 'ETH' })
    const buyOrder = new Order()
    buyOrder.action = 'BUY'
    buyOrder.orderType = 'MKT'
    buyOrder.totalQuantity = new Decimal('1.0')

    await broker.placeOrder(contract, buyOrder)
    await broker.closePosition(contract, new Decimal('0.3'))

    const positions = await broker.getPositions()
    expect(positions).toHaveLength(1)
    // 1.0 - 0.3 = 0.7 exactly, no IEEE 754 nonsense
    expect(positions[0].quantity.toString()).toBe('0.7')
  })
})

// ==================== placeOrder ====================

describe('placeOrder', () => {
  it('market order returns submitted (fill confirmed via getOrder)', async () => {
    broker.setQuote('AAPL', 150)
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(10)

    const result = await broker.placeOrder(contract, order)
    expect(result.success).toBe(true)
    expect(result.orderId).toBeDefined()
    // No execution in response — async model
    expect(result.execution).toBeUndefined()
    // But getOrder shows filled status
    const detail = await broker.getOrder(result.orderId!)
    expect(detail!.orderState.status).toBe('Filled')
  })

  it('limit order stays submitted, no execution', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal(10)
    order.lmtPrice = new Decimal(140)

    const result = await broker.placeOrder(contract, order)
    expect(result.success).toBe(true)
    expect(result.execution).toBeUndefined()
    expect(result.orderState!.status).toBe('Submitted')
    expect(result.orderId).toBeDefined()
  })

  it('creates position on buy', async () => {
    broker.setQuote('AAPL', 150)
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(10)

    await broker.placeOrder(contract, order)
    const positions = await broker.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].side).toBe('long')
    expect(positions[0].quantity.toNumber()).toBe(10)
    expect(positions[0].avgCost).toBe('150')
  })

  it('updates existing position on additional buy (avg cost recalc)', async () => {
    broker.setQuote('AAPL', 150)
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })

    const order1 = new Order()
    order1.action = 'BUY'
    order1.orderType = 'MKT'
    order1.totalQuantity = new Decimal(10)
    await broker.placeOrder(contract, order1)

    broker.setQuote('AAPL', 160)
    const order2 = new Order()
    order2.action = 'BUY'
    order2.orderType = 'MKT'
    order2.totalQuantity = new Decimal(10)
    await broker.placeOrder(contract, order2)

    const positions = await broker.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity.toNumber()).toBe(20)
    // avg cost = (10*150 + 10*160) / 20 = 155
    expect(positions[0].avgCost).toBe('155')
  })
})

// ==================== closePosition ====================

describe('closePosition', () => {
  it('closes full position', async () => {
    broker.setQuote('AAPL', 150)
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(10)
    await broker.placeOrder(contract, order)

    const result = await broker.closePosition(contract)
    expect(result.success).toBe(true)

    const positions = await broker.getPositions()
    expect(positions).toHaveLength(0)
  })

  it('partial close reduces quantity', async () => {
    broker.setQuote('AAPL', 150)
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(10)
    await broker.placeOrder(contract, order)

    await broker.closePosition(contract, new Decimal(3))

    const positions = await broker.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity.toNumber()).toBe(7)
  })

  it('returns error when no position', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const result = await broker.closePosition(contract)
    expect(result.success).toBe(false)
    expect(result.error).toContain('No open position')
  })
})

// ==================== cancelOrder ====================

describe('cancelOrder', () => {
  it('cancels pending order', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal(10)
    order.lmtPrice = new Decimal(140)

    const placed = await broker.placeOrder(contract, order)
    const cancelled = await broker.cancelOrder(placed.orderId!)
    expect(cancelled.success).toBe(true)
    expect(cancelled.orderId).toBe(placed.orderId)
    expect(cancelled.orderState?.status).toBe('Cancelled')

    const brokerOrder = await broker.getOrder(placed.orderId!)
    expect(brokerOrder!.orderState.status).toBe('Cancelled')
  })

  it('returns error for unknown order', async () => {
    const result = await broker.cancelOrder('nonexistent')
    expect(result.success).toBe(false)
    expect(result.error).toContain('nonexistent')
  })
})

// ==================== modifyOrder ====================

describe('modifyOrder', () => {
  it('updates pending order qty/price', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal(10)
    order.lmtPrice = new Decimal(140)

    const placed = await broker.placeOrder(contract, order)

    const changes = new Order()
    changes.totalQuantity = new Decimal(20)
    changes.lmtPrice = new Decimal(145)
    const modified = await broker.modifyOrder(placed.orderId!, changes)
    expect(modified.success).toBe(true)

    const brokerOrder = await broker.getOrder(placed.orderId!)
    expect(brokerOrder!.order.totalQuantity.toNumber()).toBe(20)
    expect(brokerOrder!.order.lmtPrice.toNumber()).toBe(145)
  })

  it('returns error for unknown order', async () => {
    const changes = new Order()
    changes.totalQuantity = new Decimal(20)
    const result = await broker.modifyOrder('nonexistent', changes)
    expect(result.success).toBe(false)
  })
})

// ==================== getOrder ====================

describe('getOrder', () => {
  it('finds order by id', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal(10)
    order.lmtPrice = new Decimal(140)

    const placed = await broker.placeOrder(contract, order)
    const found = await broker.getOrder(placed.orderId!)
    expect(found).not.toBeNull()
    expect(found!.order.action).toBe('BUY')
  })

  it('returns null for unknown id', async () => {
    const result = await broker.getOrder('nonexistent')
    expect(result).toBeNull()
  })
})

// ==================== fillPendingOrder (test helper) ====================

describe('fillPendingOrder', () => {
  it('fills a pending limit order at specified price', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal(10)
    order.lmtPrice = new Decimal(140)

    const placed = await broker.placeOrder(contract, order)
    broker.fillPendingOrder(placed.orderId!, 139.50)

    const filled = await broker.getOrder(placed.orderId!)
    expect(filled!.orderState.status).toBe('Filled')

    // Position should be created
    const positions = await broker.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].avgCost).toBe('139.5')
  })
})

// ==================== getAccount ====================

describe('getAccount', () => {
  it('starts with configured cash', async () => {
    const account = await broker.getAccount()
    expect(account.netLiquidation).toBe('100000')
    expect(account.totalCashValue).toBe('100000')
    expect(account.unrealizedPnL).toBe('0')
  })

  it('cash decreases after buy, equity includes unrealized PnL', async () => {
    broker.setQuote('AAPL', 150)
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(10)
    await broker.placeOrder(contract, order)

    // Price goes up
    broker.setQuote('AAPL', 160)
    const account = await broker.getAccount()
    // cash = 100000 - 10*150 = 98500
    expect(account.totalCashValue).toBe('98500')
    // unrealized = 10 * (160 - 150) = 100
    expect(account.unrealizedPnL).toBe('100')
    // equity = cash + market value = 98500 + 10*160 = 100100
    expect(account.netLiquidation).toBe('100100')
  })
})

// ==================== getHistorical ====================

describe('getHistorical', () => {
  it('returns deterministic synthetic bars anchored to markPrice (ascending, string-typed)', async () => {
    const acc = new MockBroker({ id: 'mock-paper', cash: 100_000 })
    acc.setMarkPrice('AAPL', 200)
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })

    const bars = await acc.getHistorical(contract, { interval: '1d', limit: 5 })

    expect(bars).toHaveLength(5)
    const ts = bars.map((b) => b.timestamp.getTime())
    expect(ts).toEqual([...ts].sort((a, b) => a - b)) // ascending
    expect(typeof bars[0].close).toBe('string')
    expect(Number(bars[0].close)).toBeCloseTo(200) // oldest at base
    expect(Number(bars[bars.length - 1].close)).toBeCloseTo(200 + 4 * 0.1) // newest drifted up
    expect(acc.callCount('getHistorical')).toBe(1)
  })
})

// ==================== Call tracking ====================

describe('call tracking', () => {
  it('records method calls with args', async () => {
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    await broker.getQuote(contract)
    expect(broker.callCount('getQuote')).toBe(1)
    expect(broker.lastCall('getQuote')!.args[0]).toBe(contract)
  })

  it('tracks multiple calls', async () => {
    broker.setQuote('AAPL', 150)
    const contract = makeContract({ aliceId: 'mock-paper|AAPL', symbol: 'AAPL' })
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(10)

    await broker.placeOrder(contract, order)
    await broker.getPositions()
    await broker.getAccount()

    expect(broker.callCount('placeOrder')).toBe(1)
    expect(broker.callCount('getPositions')).toBe(1)
    expect(broker.callCount('getAccount')).toBe(1)
    expect(broker.calls().length).toBeGreaterThanOrEqual(3)
  })

  it('returns null for uncalled method', () => {
    expect(broker.lastCall('placeOrder')).toBeNull()
    expect(broker.callCount('placeOrder')).toBe(0)
  })

  it('resetCalls clears the log', async () => {
    await broker.getAccount()
    expect(broker.callCount('getAccount')).toBe(1)
    broker.resetCalls()
    expect(broker.callCount('getAccount')).toBe(0)
  })
})

// ==================== accountInfo constructor option ====================

describe('accountInfo constructor option', () => {
  it('overrides getAccount return value', async () => {
    const b = new MockBroker({ accountInfo: { netLiquidation: '50000', totalCashValue: '30000', unrealizedPnL: '2000', realizedPnL: '500' } })
    const account = await b.getAccount()
    expect(account.netLiquidation).toBe('50000')
    expect(account.totalCashValue).toBe('30000')
    expect(account.unrealizedPnL).toBe('2000')
    expect(account.realizedPnL).toBe('500')
  })
})

// ==================== Factory helpers ====================

describe('factory helpers', () => {
  it('makeContract creates a contract with defaults', () => {
    const c = makeContract()
    expect(c.aliceId).toBe('mock-paper|AAPL')
    expect(c.symbol).toBe('AAPL')
  })

  it('makeContract accepts overrides', () => {
    const c = makeContract({ aliceId: 'mock-paper|ETH', symbol: 'ETH', secType: 'CRYPTO' })
    expect(c.aliceId).toBe('mock-paper|ETH')
    expect(c.symbol).toBe('ETH')
    expect(c.secType).toBe('CRYPTO')
  })

  it('makePosition creates a position with defaults', () => {
    const p = makePosition()
    expect(p.side).toBe('long')
    expect(p.quantity.toNumber()).toBe(10)
  })

  it('makeOpenOrder creates an order with defaults', () => {
    const o = makeOpenOrder()
    expect(o.orderState.status).toBe('Filled')
  })

  it('makePlaceOrderResult creates a success result', () => {
    const r = makePlaceOrderResult()
    expect(r.success).toBe(true)
    expect(r.orderId).toBe('order-1')
  })
})

// ==================== Position-key consistency ====================
//
// Regression: positions placed via the IBroker pipeline (where UTA stamps
// `aliceId` like "simulator|BTC") and positions injected via the simulator
// surface (`externalDeposit`, keyed by user-supplied nativeKey "BTC")
// must land in the same map slot. Previously _applyFill used
// `aliceId ?? symbol` while externalDeposit used the bare nativeKey, so
// the same logical asset showed up as TWO positions in the simulator UI.

describe('position keying — placeOrder and externalDeposit converge', () => {
  it('externalDeposit + market BUY on same symbol merge into one position', async () => {
    const Decimal = (await import('decimal.js')).default
    const { Order, Contract } = await import('@traderalice/ibkr')

    const acc = new MockBroker({ id: 'mock-paper', cash: 100_000 })
    acc.setMarkPrice('BTC', 80_000)

    // Step 1: external deposit (transfer-in / 空投) of 1 BTC.
    acc.externalDeposit({ nativeKey: 'BTC', quantity: 1 })

    // Step 2: market BUY 0.5 BTC via the IBroker pipeline. Mimic UTA by
    // stamping aliceId on the contract before placing.
    const contract = new Contract()
    contract.symbol = 'BTC'
    contract.secType = 'CRYPTO'
    contract.exchange = 'MOCK'
    contract.currency = 'USD'
    contract.aliceId = 'mock-paper|BTC'   // what UTA.stampAliceId would write
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal('0.5')
    await acc.placeOrder(contract, order)

    const positions = await acc.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity.toString()).toBe('1.5')
  })

  it('closePosition resolves a position originally created by externalDeposit', async () => {
    const Decimal = (await import('decimal.js')).default
    const { Contract } = await import('@traderalice/ibkr')

    const acc = new MockBroker({ id: 'mock-paper', cash: 100_000 })
    acc.setMarkPrice('BTC', 80_000)
    acc.externalDeposit({ nativeKey: 'BTC', quantity: 2 })

    const contract = new Contract()
    contract.symbol = 'BTC'
    contract.secType = 'CRYPTO'
    contract.exchange = 'MOCK'
    contract.currency = 'USD'
    contract.aliceId = 'mock-paper|BTC'
    const result = await acc.closePosition(contract, new Decimal(1))
    expect(result.success).toBe(true)

    const positions = await acc.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity.toString()).toBe('1')
  })

  it('pending limit order matches against externalDeposit position on the same nativeKey', async () => {
    const Decimal = (await import('decimal.js')).default
    const { Order, Contract } = await import('@traderalice/ibkr')

    const acc = new MockBroker({ id: 'mock-paper', cash: 100_000 })
    acc.setMarkPrice('BTC', 80_000)
    acc.externalDeposit({ nativeKey: 'BTC', quantity: 1 })

    const contract = new Contract()
    contract.symbol = 'BTC'
    contract.secType = 'CRYPTO'
    contract.exchange = 'MOCK'
    contract.currency = 'USD'
    contract.aliceId = 'mock-paper|BTC'
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal('0.5')
    order.lmtPrice = new Decimal(75_000)
    await acc.placeOrder(contract, order)

    expect(acc.getSimulatorState().pendingOrders).toHaveLength(1)

    const filled = acc.setMarkPrice('BTC', 75_000)
    expect(filled).toHaveLength(1)

    const positions = await acc.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity.toString()).toBe('1.5')
  })
})

// ==================== Multi-asset / multiplier discipline ====================
//
// IBroker.Position contract requires `marketValue` and `unrealizedPnL` to
// be multiplier-applied at the broker layer; cash flow on BUY/SELL must
// likewise debit/credit `qty × price × multiplier`. A live QA run on
// 2026-05-07 found three bug shapes from violating this:
//   1. cash flow missed multiplier (BUY 3 OPT @50 dropped $150 not $15,000)
//   2. resolveNativeKey returned a STK stub, losing secType/multiplier
//      when re-ordering an aliceId after a position was sold flat
//   3. oversell silently filled (SELL 999 BTC against 0.01 BTC) and
//      phantom-credited cash
// These tests pin those down.

describe('multiplier discipline (regression)', () => {
  it('BUY of OPT contracts debits cash by qty × price × multiplier (×100)', async () => {
    const Decimal = (await import('decimal.js')).default
    const { Order, Contract } = await import('@traderalice/ibkr')

    const acc = new MockBroker({ id: 'mock-paper', cash: 100_000 })
    acc.setMarkPrice('AAPL-20260720-C150', 50)
    // Seed position via deposit so OPT contract is in the registry
    acc.externalDeposit({
      nativeKey: 'AAPL-20260720-C150',
      quantity: 1,
      contract: {
        symbol: 'AAPL', secType: 'OPT', localSymbol: 'AAPL-20260720-C150',
        lastTradeDateOrContractMonth: '20260720', strike: 150, right: 'C', multiplier: '100',
      },
    })

    // BUY 3 more contracts at premium 50 — should drop cash by 3 × 50 × 100 = 15,000
    const cashBefore = (await acc.getAccount()).totalCashValue
    const contract = acc.resolveNativeKey('AAPL-20260720-C150')
    contract.aliceId = 'mock-paper|AAPL-20260720-C150'
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(3)
    await acc.placeOrder(contract, order)

    const cashAfter = (await acc.getAccount()).totalCashValue
    const dropped = new Decimal(cashBefore).minus(cashAfter)
    expect(dropped.toNumber()).toBe(15_000)
  })

  it('resolveNativeKey returns the original Contract (preserves OPT metadata) after sell-down', async () => {
    const Decimal = (await import('decimal.js')).default
    const { Order } = await import('@traderalice/ibkr')

    const acc = new MockBroker({ id: 'mock-paper', cash: 200_000 })
    acc.setMarkPrice('AAPL-20260720-C150', 50)
    acc.externalDeposit({
      nativeKey: 'AAPL-20260720-C150',
      quantity: 5,
      contract: {
        symbol: 'AAPL', secType: 'OPT', localSymbol: 'AAPL-20260720-C150',
        lastTradeDateOrContractMonth: '20260720', strike: 150, right: 'C', multiplier: '100',
      },
    })

    // Sell all 5 to clear the position from _positions
    const sellContract = acc.resolveNativeKey('AAPL-20260720-C150')
    sellContract.aliceId = 'mock-paper|AAPL-20260720-C150'
    const sellOrder = new Order()
    sellOrder.action = 'SELL'
    sellOrder.orderType = 'MKT'
    sellOrder.totalQuantity = new Decimal(5)
    await acc.placeOrder(sellContract, sellOrder)
    expect(await acc.getPositions()).toHaveLength(0)

    // Re-resolve: registry must remember the OPT metadata.
    const reresolved = acc.resolveNativeKey('AAPL-20260720-C150')
    expect(reresolved.secType).toBe('OPT')
    expect(reresolved.multiplier).toBe('100')
    expect(reresolved.strike).toBe(150)
    expect(reresolved.right).toBe('C')
    expect(reresolved.lastTradeDateOrContractMonth).toBe('20260720')
  })

  it('SELL beyond held quantity rejects without phantom-crediting cash', async () => {
    const Decimal = (await import('decimal.js')).default
    const { Order } = await import('@traderalice/ibkr')

    const acc = new MockBroker({ id: 'mock-paper', cash: 100_000 })
    acc.setMarkPrice('BTC', 80_000)
    acc.externalDeposit({ nativeKey: 'BTC', quantity: 0.01 })

    const cashBefore = (await acc.getAccount()).totalCashValue

    const contract = acc.resolveNativeKey('BTC')
    contract.aliceId = 'mock-paper|BTC'
    const order = new Order()
    order.action = 'SELL'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(999)

    const result = await acc.placeOrder(contract, order)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/cannot SELL/i)

    const cashAfter = (await acc.getAccount()).totalCashValue
    expect(cashAfter).toBe(cashBefore)
    const positions = await acc.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity.toNumber()).toBeCloseTo(0.01)
  })
})

// QA finding 2026-05-09: across all brokers that self-compute netLiq via
// `cash + Σ(marketValue)` (Mock / IBKR / CCXT), a SELL-to-open short
// double-counts the position. The premium received is added to cash, AND
// the (unsigned) marketValue is added on top — leaving netLiq inflated by
// 2 × |marketValue|. For OPT this is amplified by the 100x multiplier and
// shows up as the "options direction is wrong" report from the community.
describe('short positions — netLiquidation aggregation', () => {
  it('short OPT (SELL to open) leaves netLiquidation flat at mark = entry', async () => {
    const acc = new MockBroker({ id: 'mock-paper', cash: 10_000 })
    const optionKey = 'SPY-20260117-P-580'
    acc.setMarkPrice(optionKey, '5.80')
    acc.externalTrade({
      nativeKey: optionKey,
      side: 'SELL',
      quantity: '1',
      price: '5.80',
      contract: {
        symbol: 'SPY', secType: 'OPT', localSymbol: optionKey,
        lastTradeDateOrContractMonth: '20260117', strike: 580, right: 'P',
        multiplier: '100',
      },
    })

    const account = await acc.getAccount()
    // Premium received → cash = 10000 + 1×5.80×100 = 10580
    expect(account.totalCashValue).toBe('10580')
    // No PnL (mark unchanged from entry), so netLiq should equal the original equity.
    // Pre-fix: getAccount returns 11160 (10580 + 580 mv added on top — short ignored).
    expect(account.netLiquidation).toBe('10000')
  })

  it('short STK (SELL to open) leaves netLiquidation flat at mark = entry', async () => {
    const acc = new MockBroker({ id: 'mock-paper', cash: 10_000 })
    acc.setMarkPrice('NVDA', '100')
    acc.externalTrade({
      nativeKey: 'NVDA',
      side: 'SELL',
      quantity: '50',
      price: '100',
      contract: { symbol: 'NVDA', secType: 'STK' },
    })

    const account = await acc.getAccount()
    // Short proceeds → cash = 10000 + 50×100 = 15000
    expect(account.totalCashValue).toBe('15000')
    // Mark unchanged → netLiq unchanged at 10000.
    expect(account.netLiquidation).toBe('10000')
  })

  it('mixed long + short — netLiquidation reflects net equity', async () => {
    const acc = new MockBroker({ id: 'mock-paper', cash: 10_000 })

    // Long 10 NVDA @ $50, mark @ $60 → +$100 unrealized PnL
    acc.setMarkPrice('NVDA', '60')
    acc.externalTrade({
      nativeKey: 'NVDA',
      side: 'BUY',
      quantity: '10',
      price: '50',
      contract: { symbol: 'NVDA', secType: 'STK' },
    })
    // cash now = 10000 - 500 = 9500; long mv at mark = 600 → +100 PnL

    // Short 5 TSLA @ $200, mark @ $180 → +$100 unrealized PnL (mark dropped, good for short)
    acc.setMarkPrice('TSLA', '180')
    acc.externalTrade({
      nativeKey: 'TSLA',
      side: 'SELL',
      quantity: '5',
      price: '200',
      contract: { symbol: 'TSLA', secType: 'STK' },
    })
    // cash now = 9500 + 1000 = 10500; short notional at mark = 900 → +100 PnL

    const account = await acc.getAccount()
    // cash = 10500; long contributes +600, short contributes -900 → netLiq = 10500 + 600 - 900 = 10200
    // Equivalently: starting equity 10000 + 100 (long PnL) + 100 (short PnL) = 10200
    expect(account.netLiquidation).toBe('10200')
    expect(account.unrealizedPnL).toBe('200')
  })
})
