/**
 * AsyncChannel — push-to-pull bridge for converting callbacks into AsyncIterable.
 *
 * Used by Claude Code and Vercel providers where events arrive via synchronous
 * callbacks (onToolUse, onToolResult, onStepFinish) but consumers need an
 * AsyncIterator interface.
 */

export interface AsyncChannel<T> {
  push(value: T): void
  close(): void
  error(err: Error): void
  [Symbol.asyncIterator](): AsyncIterableIterator<T>
}

export function createChannel<T>(): AsyncChannel<T> {
  const queue: T[] = []
  let done = false
  let err: Error | null = null
  let waiter: ((value: IteratorResult<T>) => void) | null = null

  return {
    push(value: T) {
      if (done) return
      if (waiter) {
        const w = waiter
        waiter = null
        w({ value, done: false })
      } else {
        queue.push(value)
      }
    },

    close() {
      if (done) return
      done = true
      if (waiter) {
        const w = waiter
        waiter = null
        w({ value: undefined as unknown as T, done: true })
      }
    },

    error(e: Error) {
      if (done) return
      done = true
      err = e
      if (waiter) {
        const w = waiter
        waiter = null
        // Signal error by rejecting — but IteratorResult doesn't support rejection.
        // Instead, store error and let next() throw on subsequent call.
        w({ value: undefined as unknown as T, done: true })
      }
    },

    [Symbol.asyncIterator](): AsyncIterableIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false })
          }
          if (err) {
            return Promise.reject(err)
          }
          if (done) {
            return Promise.resolve({ value: undefined as unknown as T, done: true })
          }
          return new Promise((resolve, reject) => {
            waiter = (result) => {
              // Check if error was set between push and resolve
              if (err) return reject(err)
              resolve(result)
            }
          })
        },

        [Symbol.asyncIterator]() {
          return this
        },
      }
    },
  }
}
