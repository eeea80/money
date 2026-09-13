import { describe, it, expect } from 'vitest'
import { parse } from './parser.js'
import { CalcError } from './errors.js'

function diag(fn: () => unknown) {
  try { fn(); return null } catch (e) { return e instanceof CalcError ? e.diagnostic : (e as Error) }
}

describe('calc-v2 parser', () => {
  it('parses let-bindings + a final result expression', () => {
    const p = parse(`s = bars("alpaca-paper|AAPL", "1d", count=250)\nsma(s.close, 50)`)
    expect(p.bindings).toHaveLength(1)
    expect(p.bindings[0]).toMatchObject({ type: 'assign', name: 's' })
    const bars = p.bindings[0].value
    expect(bars).toMatchObject({ type: 'call', callee: 'bars' })
    if (bars.type === 'call') {
      expect(bars.args[0]).toMatchObject({ value: { type: 'str', value: 'alpaca-paper|AAPL' } })
      expect(bars.args[2]).toMatchObject({ name: 'count', value: { type: 'num', value: 250 } })
    }
    expect(p.result).toMatchObject({ type: 'call', callee: 'sma' })
  })

  it('parses attribute access and negative index', () => {
    const p = parse(`s = bars("x", "1d")\ns.close[-1]`)
    // s.close[-1] → index( attr(name s, close), unary -(1) )
    expect(p.result.type).toBe('index')
    if (p.result.type === 'index') {
      expect(p.result.obj).toMatchObject({ type: 'attr', name: 'close', obj: { type: 'name', id: 's' } })
      expect(p.result.index).toMatchObject({ type: 'unary', op: '-', operand: { type: 'num', value: 1 } })
    }
  })

  it('respects arithmetic precedence', () => {
    const p = parse(`a = bars("x","1d")\nsma(a.close,50)[-1] - sma(a.close,200)[-1]`)
    expect(p.result).toMatchObject({ type: 'binary', op: '-' })
  })

  it('multi-source script (mix barIds)', () => {
    const p = parse(`a = bars("ibkr|265598","1d")\nb = bars("yfinance|AAPL","1d")\na.close[-1] / b.close[-1]`)
    expect(p.bindings).toHaveLength(2)
    expect(p.result).toMatchObject({ type: 'binary', op: '/' })
  })

  it('reports a syntax error with position', () => {
    const d = diag(() => parse(`s = bars("x","1d")\nsma(s.close, )`)) as { kind: string; line?: number }
    expect(d.kind).toBe('syntax')
    expect(d.line).toBe(2)
  })

  it('catches the pandas method-chain reflex with a redirect', () => {
    const d = diag(() => parse(`s = bars("x","1d")\ns.close.rolling(50).mean()`)) as { kind: string; suggestion?: string }
    expect(d.kind).toBe('reflex')
    expect(d.suggestion).toMatch(/sma\(s\.close, 50\)/)
  })

  it('requires a final result expression (not ending on a binding)', () => {
    const d = diag(() => parse(`s = bars("x","1d")`)) as { kind: string; message: string }
    expect(d.kind).toBe('syntax')
    expect(d.message).toMatch(/result expression/)
  })

  it('rejects a bare expression before the final line', () => {
    const d = diag(() => parse(`sma(x, 50)\ns = bars("x","1d")\ns.close[-1]`)) as { kind: string }
    expect(d.kind).toBe('syntax')
  })

  it('gives a friendly error for slices (not low-level lexer noise)', () => {
    const d = diag(() => parse(`s = bars("x","1d")\ns.close[-50:]`)) as { kind: string; suggestion?: string }
    expect(d.kind).toBe('reflex')
    expect(d.suggestion).toMatch(/count=/)
  })

  it('rejects conditionals/ternary with guidance', () => {
    const d = diag(() => parse(`s = bars("x","1d")\nsma(s.close, 50) if 1 else 2`)) as { kind: string; message: string }
    expect(d.kind).toBe('reflex')
    expect(d.message).toMatch(/if.*not supported|pure expression/)
  })

  it('the end-of-script error does not teach the wrong [-1] syntax', () => {
    const d = diag(() => parse(`s = bars("x","1d")`)) as { message: string }
    expect(d.message).not.toMatch(/\[-1\]/)
  })

  it('ignores comments and blank lines', () => {
    const p = parse(`# fetch\ns = bars("x", "1d")  # daily\n\nsma(s.close, 50)`)
    expect(p.bindings).toHaveLength(1)
    expect(p.result).toMatchObject({ type: 'call', callee: 'sma' })
  })

  it('parses a labeled panel (dict) across lines with a trailing comma', () => {
    const p = parse(`a = bars("x","1h")\n{\n  "1h": rsi(a.close, 14),\n  "4h": rsi(a.close, 14),\n}`)
    expect(p.result.type).toBe('dict')
    if (p.result.type === 'dict') {
      expect(p.result.entries.map((e) => e.key)).toEqual(['1h', '4h'])
      expect(p.result.entries[0].value).toMatchObject({ type: 'call', callee: 'rsi' })
    }
  })

  it('parses a positional panel (list literal)', () => {
    const p = parse(`a = bars("x","1d")\n[ a.close[-1], sma(a.close, 50) ]`)
    expect(p.result.type).toBe('list')
    if (p.result.type === 'list') expect(p.result.elements).toHaveLength(2)
  })
})
