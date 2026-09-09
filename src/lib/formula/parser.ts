/**
 * Formula parser — Token[] → AST. Pratt-style with precedence:
 *
 *   logical_or   : logical_and ('OR' logical_and)*
 *   logical_and  : comparison ('AND' comparison)*
 *   comparison   : concat (('==' | '!=' | '<' | '<=' | '>' | '>=') concat)*
 *   concat       : additive ('&' additive)*
 *   additive     : multiplicative (('+' | '-') multiplicative)*
 *   multiplicative: unary (('*' | '/') unary)*
 *   unary        : ('-' | 'NOT') unary | primary
 *   primary      : literal | field | call | '(' expression ')'
 *   call         : ident '(' (expression (',' expression)*)? ')'
 *
 * Part of N4 Formula fields (Phase 2 roadmap, slice 1).
 */
import { FormulaError, type AstNode, type Token } from "./types"

const MAX_DEPTH = 64

export function parse(tokens: Token[]): AstNode {
  const p = new Parser(tokens)
  const ast = p.parseExpression()
  p.expect("eof")
  return ast
}

class Parser {
  private i = 0
  private depth = 0
  constructor(private readonly tokens: Token[]) {}

  parseExpression(): AstNode { return this.parseLogicalOr() }

  private parseLogicalOr(): AstNode {
    return this.parseBinaryLeft(["OR"], () => this.parseLogicalAnd(), true)
  }
  private parseLogicalAnd(): AstNode {
    return this.parseBinaryLeft(["AND"], () => this.parseComparison(), true)
  }
  private parseComparison(): AstNode {
    return this.parseBinaryLeft(["==", "!=", "<", "<=", ">", ">="], () => this.parseConcat(), false)
  }
  private parseConcat(): AstNode {
    return this.parseBinaryLeft(["&"], () => this.parseAdditive(), false)
  }
  private parseAdditive(): AstNode {
    return this.parseBinaryLeft(["+", "-"], () => this.parseMultiplicative(), false)
  }
  private parseMultiplicative(): AstNode {
    return this.parseBinaryLeft(["*", "/"], () => this.parseUnary(), false)
  }

  /**
   * Generic left-associative binary parser. `usingIdent=true` means the
   * operator is a keyword (AND/OR) consumed from "ident" tokens; otherwise
   * the op string is matched against "op" tokens.
   */
  private parseBinaryLeft(ops: string[], nextLevel: () => AstNode, usingIdent: boolean): AstNode {
    let left = nextLevel()
    while (true) {
      const tok = this.peek()
      const matchType = usingIdent ? "ident" : "op"
      if (tok.type !== matchType || !ops.includes(tok.value)) break
      this.consume()
      const right = nextLevel()
      left = { kind: "binary", op: tok.value, left, right }
    }
    return left
  }

  private parseUnary(): AstNode {
    const tok = this.peek()
    if (tok.type === "op" && tok.value === "-") {
      this.consume()
      return { kind: "unary", op: "-", operand: this.parseUnary() }
    }
    if (tok.type === "ident" && tok.value === "NOT") {
      this.consume()
      return { kind: "unary", op: "NOT", operand: this.parseUnary() }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): AstNode {
    this.depth++
    if (this.depth > MAX_DEPTH) {
      throw new FormulaError("too_deep", `Expression nesting exceeds ${MAX_DEPTH} levels`)
    }
    try {
      const tok = this.peek()

      // Number literal
      if (tok.type === "number") {
        this.consume()
        const num = Number(tok.value)
        if (!Number.isFinite(num)) {
          throw new FormulaError("bad_number", `Invalid number: ${tok.value}`, tok.pos)
        }
        return { kind: "literal", value: num }
      }

      // String literal
      if (tok.type === "string") {
        this.consume()
        return { kind: "literal", value: tok.value }
      }

      // Boolean literal
      if (tok.type === "boolean") {
        this.consume()
        return { kind: "literal", value: tok.value === "TRUE" }
      }

      // Null literal
      if (tok.type === "null") {
        this.consume()
        return { kind: "literal", value: null }
      }

      // Field reference
      if (tok.type === "field") {
        this.consume()
        return { kind: "field", name: tok.value }
      }

      // Identifier — function call (with parens) only
      if (tok.type === "ident") {
        const name = tok.value
        this.consume()
        if (this.peek().type === "lparen") {
          this.consume()
          const args: AstNode[] = []
          if (this.peek().type !== "rparen") {
            args.push(this.parseExpression())
            while (this.peek().type === "comma") {
              this.consume()
              args.push(this.parseExpression())
            }
          }
          this.expect("rparen")
          return { kind: "call", name: name.toUpperCase(), args }
        }
        throw new FormulaError("unknown_identifier", `Unknown identifier '${name}' (functions require parens)`, tok.pos)
      }

      // Parenthesised sub-expression
      if (tok.type === "lparen") {
        this.consume()
        const expr = this.parseExpression()
        this.expect("rparen")
        return expr
      }

      throw new FormulaError("unexpected_token", `Unexpected ${tok.type} '${tok.value}'`, tok.pos)
    } finally {
      this.depth--
    }
  }

  private peek(): Token { return this.tokens[this.i] }
  private consume(): Token { return this.tokens[this.i++] }
  expect(type: string): Token {
    const tok = this.peek()
    if (tok.type !== type) {
      throw new FormulaError("expected_token", `Expected ${type} but got ${tok.type} '${tok.value}'`, tok.pos)
    }
    return this.consume()
  }
}
