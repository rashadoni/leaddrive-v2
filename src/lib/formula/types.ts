/**
 * Formula engine shared types — N4 Formula fields (Phase 2 roadmap).
 *
 * Designed as a Salesforce-formula subset: arithmetic + comparison +
 * logical + string concat + IF + ~25 built-in functions, with sandboxed
 * evaluation against a field-context map. Pure functional throughout —
 * no eval, no Function constructor, no I/O.
 */

export type FormulaValue = number | string | boolean | Date | null

export type ValueType = "number" | "string" | "boolean" | "date" | "null"

/* ─── Tokens ──────────────────────────────────────────────────────────── */

export type TokenType =
  | "number"
  | "string"
  | "boolean"
  | "null"
  | "ident"          // function name or constant
  | "field"          // `{field_name}`
  | "op"             // + - * / & == != < <= > >=
  | "lparen"
  | "rparen"
  | "comma"
  | "eof"

export interface Token {
  type: TokenType
  /** Raw source value. For "op" tokens this is the operator string. */
  value: string
  /** 0-based source position for error reporting. */
  pos: number
}

/* ─── AST nodes ───────────────────────────────────────────────────────── */

export type AstNode =
  | { kind: "literal"; value: FormulaValue }
  | { kind: "field"; name: string }
  | { kind: "binary"; op: string; left: AstNode; right: AstNode }
  | { kind: "unary"; op: string; operand: AstNode }
  | { kind: "call"; name: string; args: AstNode[] }

/* ─── Evaluation context ──────────────────────────────────────────────── */

export interface EvaluationContext {
  /** Field-name → value lookup. Missing fields resolve to null. */
  fields: Record<string, FormulaValue>
  /**
   * Reference moment for date functions like TODAY()/NOW(). Tests inject
   * a fixed clock; production omits it to use `new Date()` at call time.
   */
  now?: Date
}

/* ─── Errors ──────────────────────────────────────────────────────────── */

export class FormulaError extends Error {
  constructor(public readonly code: string, message: string, public readonly pos?: number) {
    // Include code as prefix so consumers / regex tests can match either
    // human-readable message or the stable code without parsing.
    const base = pos !== undefined ? `${message} (at ${pos})` : message
    super(`[${code}] ${base}`)
    this.name = "FormulaError"
  }
}

/* ─── Validation result ───────────────────────────────────────────────── */

export interface ValidationResult {
  valid: boolean
  /** Inferred return type when valid; undefined when not. */
  returnType?: ValueType
  /** All field references found in the formula. */
  fieldRefs: string[]
  /** All function names called. */
  functionCalls: string[]
  /** Function names called but not in the built-in registry — UI hint. */
  unknownFunctions: string[]
  error?: { code: string; message: string; pos?: number }
}
