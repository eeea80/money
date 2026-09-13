import { describe, expect, it } from 'vitest'

import { BrokerError } from './broker.js'

describe('BrokerError.from', () => {
  it('preserves a structured error from a separately loaded broker pack', () => {
    const packError = Object.assign(new Error('credentials were rejected'), {
      name: 'BrokerError',
      code: 'AUTH',
      permanent: true,
    })

    const wrapped = BrokerError.from(packError)

    expect(wrapped).toBeInstanceOf(BrokerError)
    expect(wrapped.code).toBe('AUTH')
    expect(wrapped.permanent).toBe(true)
    expect(wrapped.cause).toBe(packError)
  })

  it('does not trust an unknown structured code', () => {
    const invalid = Object.assign(new Error('opaque failure'), {
      name: 'BrokerError',
      code: 'NOT_A_REAL_CODE',
    })

    expect(BrokerError.from(invalid).code).toBe('UNKNOWN')
  })
})
