/**
 * Quant Calculator v2 — AST.
 *
 * A bounded, total, side-effect-free expression language with a Python/pandas
 * surface. A script is a sequence of `name = expr` let-bindings followed by a
 * final result expression. NO loops, branches, def, mutation, or I/O — this is
 * the in-process expression tier (auto-quant is the arbitrary-code tier).
 */

export interface Pos { line: number; col: number }

export type Node = Program | Stmt | Expr

export interface Program {
  type: 'program'
  bindings: Assign[]
  result: Expr
}

export interface Assign {
  type: 'assign'
  name: string
  value: Expr
  pos: Pos
}

export type Stmt = Assign

export type Expr =
  | NumLit
  | StrLit
  | NameRef
  | CallExpr
  | AttrExpr
  | IndexExpr
  | BinaryExpr
  | UnaryExpr
  | ListLit
  | DictLit

export interface NumLit { type: 'num'; value: number; pos: Pos }
export interface StrLit { type: 'str'; value: string; pos: Pos }
export interface NameRef { type: 'name'; id: string; pos: Pos }

export interface Arg { name?: string; value: Expr }
export interface CallExpr { type: 'call'; callee: string; args: Arg[]; pos: Pos }

/** `obj.name` — e.g. `s.close`. */
export interface AttrExpr { type: 'attr'; obj: Expr; name: string; pos: Pos }

/** `obj[index]` — e.g. `x[-1]`. Scalar integer index (negative = from end). */
export interface IndexExpr { type: 'index'; obj: Expr; index: Expr; pos: Pos }

export type BinaryOp = '+' | '-' | '*' | '/'
export interface BinaryExpr { type: 'binary'; op: BinaryOp; left: Expr; right: Expr; pos: Pos }

export interface UnaryExpr { type: 'unary'; op: '-'; operand: Expr; pos: Pos }

/** `[a, b, c]` — a positional panel of values (batch many computations in one call). */
export interface ListLit { type: 'list'; elements: Expr[]; pos: Pos }

/** `{ "1h": rsi(...), "4h": rsi(...) }` — a labeled panel. Keys are string
 *  literals or bare identifiers. */
export interface DictEntry { key: string; value: Expr }
export interface DictLit { type: 'dict'; entries: DictEntry[]; pos: Pos }
