/**
 * Pump — comprehensive coverage of the interval-scheduled callback
 * primitive. Uses vitest's fake timers (vi.useFakeTimers) so we can
 * advance the clock without sleeping.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPump } from './pump.js'

describe('Pump', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==================== Construction ====================

  describe('construction', () => {
    it('throws on invalid duration', () => {
      expect(() => createPump({
        name: 'bad',
        every: 'not-a-duration',
        onTick: async () => {},
      })).toThrow(/invalid duration/)
    })

    it('throws on zero duration', () => {
      expect(() => createPump({
        name: 'bad',
        every: '0m',
        onTick: async () => {},
      })).toThrow(/invalid duration/)
    })

    it('parses common formats successfully', () => {
      expect(() => createPump({ name: 'a', every: '30m', onTick: async () => {} })).not.toThrow()
      expect(() => createPump({ name: 'a', every: '1h', onTick: async () => {} })).not.toThrow()
      expect(() => createPump({ name: 'a', every: '5m30s', onTick: async () => {} })).not.toThrow()
    })
  })

  // ==================== Lifecycle ====================

  describe('lifecycle', () => {
    it('does not fire before start()', async () => {
      const onTick = vi.fn(async () => {})
      createPump({ name: 'p', every: '1m', onTick })
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      expect(onTick).not.toHaveBeenCalled()
    })

    it('start() arms the timer and onTick fires after the interval', async () => {
      const onTick = vi.fn(async () => {})
      const pump = createPump({ name: 'p', every: '1m', onTick })
      pump.start()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(onTick).toHaveBeenCalledTimes(1)
    })

    it('re-arms after a tick completes (recurring)', async () => {
      const onTick = vi.fn(async () => {})
      const pump = createPump({ name: 'p', every: '1m', onTick })
      pump.start()
      await vi.advanceTimersByTimeAsync(60_000)
      await vi.advanceTimersByTimeAsync(60_000)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(onTick).toHaveBeenCalledTimes(3)
    })

    it('stop() clears the pending timer; no further fires', async () => {
      const onTick = vi.fn(async () => {})
      const pump = createPump({ name: 'p', every: '1m', onTick })
      pump.start()
      pump.stop()
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      expect(onTick).not.toHaveBeenCalled()
    })

    it('stop() during in-flight tick: tick completes, no re-arm', async () => {
      let resolveTick: () => void = () => {}
      const onTick = vi.fn(() => new Promise<void>((resolve) => { resolveTick = resolve }))
      const pump = createPump({ name: 'p', every: '1m', onTick })
      pump.start()

      await vi.advanceTimersByTimeAsync(60_000) // schedule first tick

      // Tick is now in flight (onTick promise pending).
      pump.stop()
      resolveTick() // let the tick complete
      await vi.runAllTimersAsync()

      expect(onTick).toHaveBeenCalledTimes(1)
      // No further fires
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      expect(onTick).toHaveBeenCalledTimes(1)
    })

    it('start() is idempotent — calling twice does not double-arm', async () => {
      const onTick = vi.fn(async () => {})
      const pump = createPump({ name: 'p', every: '1m', onTick })
      pump.start()
      pump.start()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(onTick).toHaveBeenCalledTimes(1) // not 2
    })
  })

  // ==================== Enable / disable ====================

  describe('setEnabled', () => {
    it('disabled state — no fires even after start', async () => {
      const onTick = vi.fn(async () => {})
      const pump = createPump({ name: 'p', every: '1m', onTick, enabled: false })
      pump.start()
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      expect(onTick).not.toHaveBeenCalled()
      expect(pump.isEnabled()).toBe(false)
    })

    it('setEnabled(true) on a disabled pump re-arms', async () => {
      const onTick = vi.fn(async () => {})
      const pump = createPump({ name: 'p', every: '1m', onTick, enabled: false })
      pump.start()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(onTick).not.toHaveBeenCalled()

      pump.setEnabled(true)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(onTick).toHaveBeenCalledTimes(1)
    })

    it('setEnabled(false) cancels the pending timer', async () => {
      const onTick = vi.fn(async () => {})
      const pump = createPump({ name: 'p', every: '1m', onTick })
      pump.start()
      pump.setEnabled(false)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(onTick).not.toHaveBeenCalled()
    })

    it('setEnabled is a no-op after stop()', async () => {
      const onTick = vi.fn(async () => {})
      const pump = createPump({ name: 'p', every: '1m', onTick })
      pump.start()
      pump.stop()
      pump.setEnabled(true)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(onTick).not.toHaveBeenCalled()
    })

    it('setEnabled to same value is a no-op', async () => {
      const onTick = vi.fn(async () => {})
      const pump = createPump({ name: 'p', every: '1m', onTick })
      pump.start()
      pump.setEnabled(true) // already true
      await vi.advanceTimersByTimeAsync(60_000)
      expect(onTick).toHaveBeenCalledTimes(1) // not double-armed
    })
  })

  // ==================== runNow ====================

  describe('runNow', () => {
    it('invokes onTick immediately', async () => {
      const onTick = vi.fn(async () => {})
      const pump = createPump({ name: 'p', every: '1m', onTick })
      await pump.runNow()
      expect(onTick).toHaveBeenCalledTimes(1)
    })

    it('runNow works without start() ever being called', async () => {
      const onTick = vi.fn(async () => {})
      const pump = createPump({ name: 'p', every: '1m', onTick })
      await pump.runNow()
      expect(onTick).toHaveBeenCalledTimes(1)
    })

    it('runNow is a no-op after stop()', async () => {
      const onTick = vi.fn(async () => {})
      const pump = createPump({ name: 'p', every: '1m', onTick })
      pump.stop()
      await pump.runNow()
      expect(onTick).not.toHaveBeenCalled()
    })

    it('runNow respects serial guard — awaits in-flight tick', async () => {
      let resolveTick: () => void = () => {}
      const onTick = vi.fn(() => new Promise<void>((resolve) => { resolveTick = resolve }))
      const pump = createPump({ name: 'p', every: '1m', onTick })
      pump.start()
      await vi.advanceTimersByTimeAsync(60_000) // first tick in flight

      // runNow shouldn't fire a second concurrent tick
      const runNowPromise = pump.runNow()
      resolveTick()
      await runNowPromise

      // Only one onTick invocation (the scheduled one)
      expect(onTick).toHaveBeenCalledTimes(1)
    })
  })

  // ==================== Error backoff ====================

  describe('error backoff', () => {
    it('consecutive errors trigger increasing backoff', async () => {
      let calls = 0
      const onTick = vi.fn(async () => {
        calls++
        throw new Error('always fails')
      })
      const pump = createPump({
        name: 'p',
        every: '1m',
        onTick,
        errorBackoffMs: [30_000, 60_000, 300_000],
        logger: { log: () => {}, warn: () => {}, error: () => {} },
      })
      pump.start()

      // first scheduled fire at 60s → throws
      await vi.advanceTimersByTimeAsync(60_000)
      expect(calls).toBe(1)

      // next fire is backoff[0] = 30s later, not 60s
      await vi.advanceTimersByTimeAsync(30_000)
      expect(calls).toBe(2)

      // backoff[1] = 60s
      await vi.advanceTimersByTimeAsync(60_000)
      expect(calls).toBe(3)

      // backoff[2] = 300s
      await vi.advanceTimersByTimeAsync(300_000)
      expect(calls).toBe(4)

      // clamped to last entry on more failures
      await vi.advanceTimersByTimeAsync(300_000)
      expect(calls).toBe(5)
    })

    it('successful tick resets consecutiveErrors', async () => {
      let calls = 0
      let throwOnNext = true
      const onTick = vi.fn(async () => {
        calls++
        if (throwOnNext) throw new Error('fail')
      })
      const pump = createPump({
        name: 'p',
        every: '1m',
        onTick,
        errorBackoffMs: [30_000, 60_000],
        logger: { log: () => {}, warn: () => {}, error: () => {} },
      })
      pump.start()

      await vi.advanceTimersByTimeAsync(60_000) // fail #1
      expect(calls).toBe(1)

      throwOnNext = false
      await vi.advanceTimersByTimeAsync(30_000) // backoff[0]; succeeds
      expect(calls).toBe(2)

      // Now next interval is back to normal 60s (errors reset)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(calls).toBe(3)
    })

    it('onTick error does not kill the pump', async () => {
      let calls = 0
      const onTick = vi.fn(async () => {
        calls++
        if (calls === 1) throw new Error('one bad apple')
      })
      const pump = createPump({
        name: 'p',
        every: '1m',
        onTick,
        errorBackoffMs: [30_000],
        logger: { log: () => {}, warn: () => {}, error: () => {} },
      })
      pump.start()

      await vi.advanceTimersByTimeAsync(60_000)  // fail
      await vi.advanceTimersByTimeAsync(30_000)  // succeed (backoff)
      await vi.advanceTimersByTimeAsync(60_000)  // back to normal
      expect(calls).toBe(3)
    })
  })

  // ==================== Serial guard ====================

  describe('serial guard', () => {
    it('drops a fire when previous tick still in flight (serial=true default)', async () => {
      let resolveTick: () => void = () => {}
      let calls = 0
      const onTick = vi.fn(() => {
        calls++
        return new Promise<void>((resolve) => { resolveTick = resolve })
      })
      const pump = createPump({
        name: 'p',
        every: '1m',
        onTick,
        logger: { log: () => {}, warn: () => {}, error: () => {} },
      })
      pump.start()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(calls).toBe(1)
      // 60s later — onTick still pending. The next timer DOES fire but
      // is dropped at the serial check; no extra onTick call.
      await vi.advanceTimersByTimeAsync(60_000)
      expect(calls).toBe(1)
      // Resolve the in-flight tick; pump re-arms
      resolveTick()
      await vi.runAllTimersAsync()
      // After re-arm, the next fire happens at the configured interval
      // (advance through it)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(calls).toBeGreaterThanOrEqual(2)
    })
  })

  // ==================== Properties ====================

  describe('properties', () => {
    it('exposes name and every', () => {
      const pump = createPump({ name: 'foo', every: '30m', onTick: async () => {} })
      expect(pump.name).toBe('foo')
      expect(pump.every).toBe('30m')
    })
  })
})
