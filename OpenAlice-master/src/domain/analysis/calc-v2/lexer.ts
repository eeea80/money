/**
 * Quant Calculator v2 — lexer.
 *
 * Tokenizes the Python-subset surface. Whitespace is insignificant except
 * newlines (statement separators); `#` starts a line comment.
 */

import { CalcError } from './errors.js'
import type { Pos } from './ast.js'

export type TokenType =
  | 'num' | 'str' | 'name'
  | '+' | '-' | '*' | '/' | '=' | '(' | ')' | '[' | ']' | '{' | '}' | ',' | '.' | ':'
  | 'newline' | 'eof'

export interface Token {
  type: TokenType
  value: string
  pos: Pos
}

const SINGLE: Record<string, TokenType> = {
  '+': '+', '-': '-', '*': '*', '/': '/', '=': '=',
  '(': '(', ')': ')', '[': '[', ']': ']', '{': '{', '}': '}', ',': ',', '.': '.', ':': ':',
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  let line = 1
  let col = 1
  const here = (): Pos => ({ line, col })
  const advance = (n = 1) => { i += n; col += n }

  while (i < src.length) {
    const c = src[i]

    if (c === '\n') {
      // Collapse runs of blank lines into a single separator.
      if (tokens.length > 0 && tokens[tokens.length - 1].type !== 'newline') {
        tokens.push({ type: 'newline', value: '\n', pos: here() })
      }
      i++; line++; col = 1
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') { advance(); continue }
    if (c === '#') { while (i < src.length && src[i] !== '\n') advance(); continue }

    // String — single or double quoted (no escapes needed for symbols/intervals).
    if (c === '"' || c === "'") {
      const start = here()
      const quote = c
      advance()
      let s = ''
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\n') throw new CalcError({ kind: 'syntax', message: 'Unterminated string', line: start.line, col: start.col })
        s += src[i]; advance()
      }
      if (i >= src.length) throw new CalcError({ kind: 'syntax', message: 'Unterminated string', line: start.line, col: start.col })
      advance() // closing quote
      tokens.push({ type: 'str', value: s, pos: start })
      continue
    }

    // Number — int or float (no exponent needed).
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      const start = here()
      let n = ''
      while (i < src.length && (isDigit(src[i]) || src[i] === '.')) { n += src[i]; advance() }
      if ((n.match(/\./g)?.length ?? 0) > 1) throw new CalcError({ kind: 'syntax', message: `Invalid number "${n}"`, line: start.line, col: start.col })
      tokens.push({ type: 'num', value: n, pos: start })
      continue
    }

    // Identifier.
    if (isIdentStart(c)) {
      const start = here()
      let id = ''
      while (i < src.length && isIdentPart(src[i])) { id += src[i]; advance() }
      tokens.push({ type: 'name', value: id, pos: start })
      continue
    }

    // Single-char operators / punctuation.
    const t = SINGLE[c]
    if (t) { tokens.push({ type: t, value: c, pos: here() }); advance(); continue }

    throw new CalcError({ kind: 'syntax', message: `Unexpected character "${c}"`, line, col })
  }

  // Trailing newline + EOF.
  if (tokens.length > 0 && tokens[tokens.length - 1].type === 'newline') tokens.pop()
  tokens.push({ type: 'eof', value: '', pos: here() })
  return tokens
}

function isDigit(c: string): boolean { return c >= '0' && c <= '9' }
function isIdentStart(c: string): boolean { return /[A-Za-z_]/.test(c) }
function isIdentPart(c: string): boolean { return /[A-Za-z0-9_]/.test(c) }
