import { describe, it, expect } from 'vitest'
import { createChannel } from './async-channel.js'

/** Collect all items from an async iterable. */
async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = []
  for await (const item of iter) items.push(item)
  return items
}

describe('AsyncChannel', () => {
  it('should yield pushed items then close', async () => {
    const ch = createChannel<number>()
    ch.push(1)
    ch.push(2)
    ch.push(3)
    ch.close()

    expect(await collect(ch)).toEqual([1, 2, 3])
  })

  it('should resolve items pushed after iteration starts', async () => {
    const ch = createChannel<string>()

    const promise = collect(ch)
    ch.push('a')
    ch.push('b')
    ch.close()

    expect(await promise).toEqual(['a', 'b'])
  })

  it('should return done after close with empty queue', async () => {
    const ch = createChannel<number>()
    ch.close()

    const iter = ch[Symbol.asyncIterator]()
    const result = await iter.next()
    expect(result.done).toBe(true)
  })

  it('should drain queued items before signaling done on close', async () => {
    const ch = createChannel<number>()
    ch.push(1)
    ch.push(2)
    ch.close()

    const iter = ch[Symbol.asyncIterator]()
    expect(await iter.next()).toEqual({ value: 1, done: false })
    expect(await iter.next()).toEqual({ value: 2, done: false })
    expect((await iter.next()).done).toBe(true)
  })

  it('should ignore push after close', async () => {
    const ch = createChannel<number>()
    ch.push(1)
    ch.close()
    ch.push(2) // should be ignored

    expect(await collect(ch)).toEqual([1])
  })

  it('should ignore close after close', async () => {
    const ch = createChannel<number>()
    ch.close()
    ch.close() // should not throw
    expect(await collect(ch)).toEqual([])
  })

  it('should reject on error', async () => {
    const ch = createChannel<number>()
    ch.push(1)
    ch.error(new Error('boom'))

    const iter = ch[Symbol.asyncIterator]()
    expect(await iter.next()).toEqual({ value: 1, done: false })
    await expect(iter.next()).rejects.toThrow('boom')
  })

  it('should reject waiting iterator on error', async () => {
    const ch = createChannel<number>()

    const iter = ch[Symbol.asyncIterator]()
    const nextPromise = iter.next()

    ch.error(new Error('fail'))

    await expect(nextPromise).rejects.toThrow('fail')
  })

  it('should ignore error after close', async () => {
    const ch = createChannel<number>()
    ch.close()
    ch.error(new Error('ignored')) // should not throw

    expect(await collect(ch)).toEqual([])
  })

  it('should ignore push after error', async () => {
    const ch = createChannel<number>()
    ch.error(new Error('err'))
    ch.push(42) // should be ignored since done=true

    const iter = ch[Symbol.asyncIterator]()
    await expect(iter.next()).rejects.toThrow('err')
  })

  it('should wake waiter when value is pushed', async () => {
    const ch = createChannel<number>()

    // Start iterating — will block
    const iter = ch[Symbol.asyncIterator]()
    const p = iter.next()

    // Push wakes the waiter
    ch.push(99)
    expect(await p).toEqual({ value: 99, done: false })

    ch.close()
    expect((await iter.next()).done).toBe(true)
  })

  it('should support for-await-of', async () => {
    const ch = createChannel<string>()

    setTimeout(() => {
      ch.push('x')
      ch.push('y')
      ch.close()
    }, 0)

    const result: string[] = []
    for await (const item of ch) {
      result.push(item)
    }
    expect(result).toEqual(['x', 'y'])
  })
})
