/**
 * Quant Calculator v2 — recursive-descent parser.
 *
 * Grammar (precedence low→high):
 *   program    := (assign NEWLINE)* expr NEWLINE?
 *   assign     := NAME '=' expr
 *   expr       := additive
 *   additive   := multiplicative (('+' | '-') multiplicative)*
 *   multiplic. := unary (('*' | '/') unary)*
 *   unary      := '-'? postfix
 *   postfix    := primary ('.' NAME | '[' expr ']')*
 *   primary    := NUMBER | STRING | call | NAME | '(' expr ')'
 *   call       := NAME '(' (arg (',' arg)*)? ')'
 *   arg        := NAME '=' expr | expr
 */

import { tokenize, type Token, type TokenType } from './lexer.js'
import { CalcError } from './errors.js'
import type { Program, Expr, Assign, Arg, DictEntry, Pos } from './ast.js'

const KEYWORDS = new Set(['if', 'else', 'elif', 'and', 'or', 'not', 'for', 'while', 'in', 'lambda'])

class Parser {
  private toks: Token[]
  private p = 0
  constructor(src: string) { this.toks = tokenize(src) }

  private peek(ahead = 0): Token { return this.toks[Math.min(this.p + ahead, this.toks.length - 1)] }
  private next(): Token { return this.toks[this.p++] }
  private at(t: TokenType): boolean { return this.peek().type === t }
  private eat(t: TokenType): Token {
    if (!this.at(t)) {
      const got = this.peek()
      throw new CalcError({ kind: 'syntax', message: `Expected ${describe(t)} but got ${describe(got.type, got.value)}`, line: got.pos.line, col: got.pos.col })
    }
    return this.next()
  }
  private skipNewlines(): void { while (this.at('newline')) this.next() }

  parseProgram(): Program {
    const bindings: Assign[] = []
    let result: Expr | undefined

    this.skipNewlines()
    while (!this.at('eof')) {
      if (result !== undefined) {
        const t = this.peek()
        throw new CalcError({ kind: 'syntax', message: 'Only the final line may be a bare result expression; earlier lines must be `name = ...` bindings', line: t.pos.line, col: t.pos.col })
      }
      // assignment vs final expression
      if (this.at('name') && this.peek(1).type === '=') {
        const name = this.next().value
        const pos = this.peek().pos
        this.eat('=')
        bindings.push({ type: 'assign', name, value: this.parseExpr(), pos })
      } else {
        result = this.parseExpr()
      }
      if (this.at('name') && KEYWORDS.has(this.peek().value)) {
        const t = this.peek()
        throw new CalcError({ kind: 'reflex', message: `\`${t.value}\` is not supported — v2 is a pure expression language (no if/else/and/or/loops)`, line: t.pos.line, col: t.pos.col, suggestion: 'Compute the values you need and compare them in your own reasoning, not inside the script.' })
      }
      if (!this.at('eof')) this.eat('newline')
      this.skipNewlines()
    }

    if (result === undefined) {
      const last = this.toks[this.toks.length - 1]
      throw new CalcError({ kind: 'syntax', message: 'Script must end with a result expression (e.g. `sma(s.close, 50)`)', line: last.pos.line })
    }
    return { type: 'program', bindings, result }
  }

  private parseExpr(): Expr { return this.parseAdditive() }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative()
    while (this.at('+') || this.at('-')) {
      const op = this.next().type as '+' | '-'
      left = { type: 'binary', op, left, right: this.parseMultiplicative(), pos: left.pos }
    }
    return left
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary()
    while (this.at('*') || this.at('/')) {
      const op = this.next().type as '*' | '/'
      left = { type: 'binary', op, left, right: this.parseUnary(), pos: left.pos }
    }
    return left
  }

  private parseUnary(): Expr {
    if (this.at('-')) {
      const pos = this.next().pos
      return { type: 'unary', op: '-', operand: this.parseUnary(), pos }
    }
    return this.parsePostfix()
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary()
    for (;;) {
      if (this.at('.')) {
        this.next()
        const name = this.eat('name')
        e = { type: 'attr', obj: e, name: name.value, pos: name.pos }
      } else if (this.at('[')) {
        const pos = this.next().pos
        const index = this.parseExpr()
        if (this.at(':')) {
          const t = this.peek()
          throw new CalcError({ kind: 'reflex', message: 'Slices are not supported', line: t.pos.line, col: t.pos.col, suggestion: 'Use count= on bars(...) to limit the window; index a single value with [-1] / [-n].' })
        }
        this.eat(']')
        e = { type: 'index', obj: e, index, pos }
      } else if (this.at('(')) {
        // Calling something that isn't a bare function name → almost always a
        // pandas method-chain reflex (s.close.rolling(50).mean()).
        const t = this.peek()
        throw new CalcError({
          kind: 'reflex',
          message: 'Method chaining is not supported here',
          line: t.pos.line, col: t.pos.col,
          suggestion: 'Use the function form, e.g. `sma(s.close, 50)` instead of `s.close.rolling(50).mean()`',
        })
      } else {
        return e
      }
    }
  }

  private parsePrimary(): Expr {
    const t = this.peek()
    if (t.type === 'num') { this.next(); return { type: 'num', value: Number(t.value), pos: t.pos } }
    if (t.type === 'str') { this.next(); return { type: 'str', value: t.value, pos: t.pos } }
    if (t.type === '(') { this.next(); const e = this.parseExpr(); this.eat(')'); return e }
    if (t.type === '[') return this.parseList()
    if (t.type === '{') return this.parseDict()
    if (t.type === 'name') {
      if (this.peek(1).type === '(') return this.parseCall()
      this.next(); return { type: 'name', id: t.value, pos: t.pos }
    }
    throw new CalcError({ kind: 'syntax', message: `Unexpected ${describe(t.type, t.value)}`, line: t.pos.line, col: t.pos.col })
  }

  /** `[a, b, c]` — positional panel. Newlines + a trailing comma are allowed. */
  private parseList(): Expr {
    const pos = this.eat('[').pos
    const elements: Expr[] = []
    this.skipNewlines()
    while (!this.at(']')) {
      elements.push(this.parseExpr())
      this.skipNewlines()
      if (this.at(',')) { this.next(); this.skipNewlines() } else break
    }
    this.skipNewlines()
    this.eat(']')
    return { type: 'list', elements, pos }
  }

  /** `{ "1h": expr, name: expr }` — labeled panel. */
  private parseDict(): Expr {
    const pos = this.eat('{').pos
    const entries: DictEntry[] = []
    this.skipNewlines()
    while (!this.at('}')) {
      const key = this.parseDictKey()
      this.eat(':')
      const value = this.parseExpr()
      entries.push({ key, value })
      this.skipNewlines()
      if (this.at(',')) { this.next(); this.skipNewlines() } else break
    }
    this.skipNewlines()
    this.eat('}')
    return { type: 'dict', entries, pos }
  }

  private parseDictKey(): string {
    const t = this.peek()
    if (t.type === 'str' || t.type === 'name' || t.type === 'num') { this.next(); return t.value }
    throw new CalcError({ kind: 'syntax', message: `Dict key must be a string or name, got ${describe(t.type, t.value)}`, line: t.pos.line, col: t.pos.col })
  }

  private parseCall(): Expr {
    const callee = this.eat('name')
    this.eat('(')
    const args: Arg[] = []
    if (!this.at(')')) {
      for (;;) {
        args.push(this.parseArg())
        if (this.at(',')) { this.next(); continue }
        break
      }
    }
    this.eat(')')
    return { type: 'call', callee: callee.value, args, pos: callee.pos }
  }

  private parseArg(): Arg {
    // kwarg: NAME '=' expr
    if (this.at('name') && this.peek(1).type === '=') {
      const name = this.next().value
      this.eat('=')
      return { name, value: this.parseExpr() }
    }
    return { value: this.parseExpr() }
  }
}

export function parse(src: string): Program {
  return new Parser(src).parseProgram()
}

function describe(t: TokenType, value?: string): string {
  if (t === 'eof') return 'end of input'
  if (t === 'newline') return 'a new line'
  if (t === 'name') return value ? `"${value}"` : 'a name'
  if (t === 'num' || t === 'str') return value !== undefined ? `"${value}"` : t
  return `"${t}"`
}

export type { Pos }
