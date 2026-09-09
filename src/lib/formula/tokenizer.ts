/**
 * Formula tokenizer — string → Token[]. Pure, single-pass, no regex
 * backtracking surprises.
 *
 * Lexical grammar:
 *   number   = digit+ ("." digit+)?
 *   string   = '"' ([^"\\] | \\. )* '"'
 *   ident    = letter (letter | digit | "_")*
 *   field    = "{" ident "}"
 *   op       = + - * / & == != <= >= < > = !
 *   delim    = ( ) ,
 *
 * Keywords (case-insensitive): TRUE, FALSE, NULL, AND, OR, NOT.
 *
 * Part of N4 Formula fields (Phase 2 roadmap, slice 1).
 */
import { FormulaError, type Token } from "./types"

const KEYWORDS = new Set(["TRUE", "FALSE", "NULL", "AND", "OR", "NOT"])

// Three independent safety limits — caller hits whichever fires first.
// MAX_INPUT_LEN bounds raw source size; MAX_TOKENS bounds parser cost
// (a 4K input of `1+1+1+...` is still only ~2K tokens, so token limit
// kicks in later than length).
const MAX_INPUT_LEN = 10_000
const MAX_TOKENS = 2_000

export function tokenize(source: string): Token[] {
  if (source.length > MAX_INPUT_LEN) {
    throw new FormulaError("input_too_long", `Formula exceeds ${MAX_INPUT_LEN} characters`)
  }
  const tokens: Token[] = []
  let i = 0
  const n = source.length

  while (i < n) {
    const c = source[i]

    // Skip whitespace
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++
      continue
    }

    // Field reference {name}
    if (c === "{") {
      const start = i
      i++
      let name = ""
      while (i < n && source[i] !== "}") {
        name += source[i]
        i++
      }
      if (i >= n) throw new FormulaError("unclosed_field", "Unterminated field reference", start)
      i++ // consume }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new FormulaError("bad_field_name", `Invalid field name: '${name}'`, start)
      }
      pushToken(tokens, { type: "field", value: name, pos: start })
      continue
    }

    // String literal
    if (c === '"') {
      const start = i
      i++
      let value = ""
      while (i < n && source[i] !== '"') {
        if (source[i] === "\\" && i + 1 < n) {
          const next = source[i + 1]
          if (next === "n") value += "\n"
          else if (next === "t") value += "\t"
          else if (next === '"') value += '"'
          else if (next === "\\") value += "\\"
          else throw new FormulaError("bad_escape", `Invalid escape \\${next}`, i)
          i += 2
        } else {
          value += source[i]
          i++
        }
      }
      if (i >= n) throw new FormulaError("unclosed_string", "Unterminated string literal", start)
      i++ // consume closing quote
      pushToken(tokens, { type: "string", value, pos: start })
      continue
    }

    // Number literal
    if (isDigit(c)) {
      const start = i
      let value = ""
      while (i < n && isDigit(source[i])) {
        value += source[i]
        i++
      }
      if (i < n && source[i] === ".") {
        value += "."
        i++
        if (!(i < n && isDigit(source[i]))) {
          throw new FormulaError("bad_number", "Expected digits after decimal point", start)
        }
        while (i < n && isDigit(source[i])) {
          value += source[i]
          i++
        }
      }
      pushToken(tokens, { type: "number", value, pos: start })
      continue
    }

    // Identifier / keyword
    if (isLetter(c) || c === "_") {
      const start = i
      let value = ""
      while (i < n && (isLetter(source[i]) || isDigit(source[i]) || source[i] === "_")) {
        value += source[i]
        i++
      }
      const upper = value.toUpperCase()
      if (KEYWORDS.has(upper)) {
        if (upper === "TRUE" || upper === "FALSE") {
          pushToken(tokens, { type: "boolean", value: upper, pos: start })
        } else if (upper === "NULL") {
          pushToken(tokens, { type: "null", value: "NULL", pos: start })
        } else {
          // AND / OR / NOT — surface as logical-op identifiers; parser routes them
          pushToken(tokens, { type: "ident", value: upper, pos: start })
        }
      } else {
        pushToken(tokens, { type: "ident", value, pos: start })
      }
      continue
    }

    // Delimiters
    if (c === "(") { pushToken(tokens, { type: "lparen", value: "(", pos: i }); i++; continue }
    if (c === ")") { pushToken(tokens, { type: "rparen", value: ")", pos: i }); i++; continue }
    if (c === ",") { pushToken(tokens, { type: "comma", value: ",", pos: i }); i++; continue }

    // Operators — multi-char first
    const two = source.slice(i, i + 2)
    if (two === "==" || two === "!=" || two === "<=" || two === ">=") {
      pushToken(tokens, { type: "op", value: two, pos: i })
      i += 2
      continue
    }
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "&" ||
        c === "<" || c === ">" || c === "=") {
      // '=' alone is treated as equality (Salesforce convention)
      pushToken(tokens, { type: "op", value: c === "=" ? "==" : c, pos: i })
      i++
      continue
    }

    throw new FormulaError("bad_char", `Unexpected character '${c}'`, i)
  }

  pushToken(tokens, { type: "eof", value: "", pos: n })
  return tokens
}

function pushToken(tokens: Token[], tok: Token): void {
  if (tokens.length >= MAX_TOKENS) {
    throw new FormulaError("too_many_tokens", `Formula exceeds ${MAX_TOKENS} tokens`)
  }
  tokens.push(tok)
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9"
}
function isLetter(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z")
}
