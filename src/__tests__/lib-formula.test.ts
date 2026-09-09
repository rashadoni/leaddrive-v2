/**
 * Tests for N4 Formula fields slice 1 — tokenizer + parser + evaluator
 * + built-in functions + validator. Pure functional, no Prisma.
 */
import { describe, it, expect } from "vitest"
import {
  evaluateFormulaStrict,
  evaluateFormula,
  validateFormula,
  FormulaError,
  FORMULA_FUNCTION_NAMES,
  type EvaluationContext,
  type FormulaValue,
} from "@/lib/formula"
import { tokenize } from "@/lib/formula/tokenizer"
import { parse } from "@/lib/formula/parser"

const NOW = new Date(2026, 4, 17, 12, 0, 0) // May 17 2026 noon

function ctx(fields: Record<string, FormulaValue> = {}, now: Date = NOW): EvaluationContext {
  return { fields, now }
}

const evalF = (src: string, fields: Record<string, FormulaValue> = {}) =>
  evaluateFormulaStrict(src, ctx(fields))

/* ─── Tokenizer ───────────────────────────────────────────────────────── */

describe("N4 formula — tokenizer", () => {
  it("tokenizes numbers + operators", () => {
    const toks = tokenize("2 + 3")
    expect(toks.map(t => t.type)).toEqual(["number", "op", "number", "eof"])
  })

  it("tokenizes decimal numbers", () => {
    const toks = tokenize("3.14")
    expect(toks[0].value).toBe("3.14")
  })

  it("tokenizes string literals with escapes", () => {
    const toks = tokenize('"hello\\nworld"')
    expect(toks[0].type).toBe("string")
    expect(toks[0].value).toBe("hello\nworld")
  })

  it("tokenizes field references", () => {
    const toks = tokenize("{amount} + {tax}")
    expect(toks[0]).toMatchObject({ type: "field", value: "amount" })
    expect(toks[2]).toMatchObject({ type: "field", value: "tax" })
  })

  it("tokenizes function calls", () => {
    const toks = tokenize("IF(x > 0, 1, 0)")
    expect(toks.map(t => t.type)).toEqual(["ident","lparen","ident","op","number","comma","number","comma","number","rparen","eof"])
  })

  it("recognises TRUE/FALSE/NULL keywords case-insensitively", () => {
    expect(tokenize("true")[0].type).toBe("boolean")
    expect(tokenize("False")[0].type).toBe("boolean")
    expect(tokenize("NULL")[0].type).toBe("null")
  })

  it("recognises AND/OR/NOT as logical idents", () => {
    expect(tokenize("a AND b")[1]).toMatchObject({ type: "ident", value: "AND" })
  })

  it("multi-char operators", () => {
    const toks = tokenize("a >= 5 != 10")
    expect(toks[1].value).toBe(">=")
    expect(toks[3].value).toBe("!=")
  })

  it("'=' is treated as '==' (Salesforce convention)", () => {
    expect(tokenize("a = b")[1].value).toBe("==")
  })

  it("throws on unterminated string", () => {
    expect(() => tokenize('"unterminated')).toThrow(FormulaError)
  })

  it("throws on unterminated field reference", () => {
    expect(() => tokenize("{field")).toThrow(FormulaError)
  })

  it("throws on bad escape sequence", () => {
    expect(() => tokenize('"\\q"')).toThrow(FormulaError)
  })

  it("rejects input exceeding the length limit", () => {
    expect(() => tokenize("x".repeat(20_000))).toThrow(/too_long/)
  })

  it("rejects decimal without digits after point", () => {
    expect(() => tokenize("3.")).toThrow(FormulaError)
  })

  it("rejects invalid field name", () => {
    expect(() => tokenize("{123abc}")).toThrow(/Invalid field name/)
  })
})

/* ─── Parser ──────────────────────────────────────────────────────────── */

describe("N4 formula — parser", () => {
  it("parses arithmetic with precedence", () => {
    const ast = parse(tokenize("2 + 3 * 4"))
    expect(ast).toEqual({
      kind: "binary", op: "+",
      left: { kind: "literal", value: 2 },
      right: {
        kind: "binary", op: "*",
        left: { kind: "literal", value: 3 },
        right: { kind: "literal", value: 4 },
      },
    })
  })

  it("parses left-associative operators", () => {
    const ast = parse(tokenize("10 - 3 - 2"))
    // (10 - 3) - 2 = 5
    expect((ast as { kind: "binary"; left: { kind: "binary" } }).left.kind).toBe("binary")
  })

  it("parses parentheses to override precedence", () => {
    const ast = parse(tokenize("(2 + 3) * 4"))
    expect((ast as { kind: "binary"; left: { kind: "binary" } }).left.kind).toBe("binary")
  })

  it("parses function calls with arguments", () => {
    const ast = parse(tokenize('IF({a} > {b}, {x}, {y})'))
    expect(ast.kind).toBe("call")
  })

  it("parses nested function calls", () => {
    const ast = parse(tokenize("ROUND(SQRT(16), 2)"))
    expect(ast.kind).toBe("call")
  })

  it("rejects bare identifier without parens", () => {
    expect(() => parse(tokenize("unknownIdent"))).toThrow(/parens/)
  })

  it("rejects unbalanced parens", () => {
    expect(() => parse(tokenize("(1 + 2"))).toThrow(FormulaError)
  })

  it("rejects trailing tokens", () => {
    expect(() => parse(tokenize("1 + 2)"))).toThrow(FormulaError)
  })
})

/* ─── Evaluator — arithmetic ──────────────────────────────────────────── */

describe("N4 formula — evaluator arithmetic", () => {
  it("integer addition", () => expect(evalF("2 + 3")).toBe(5))
  it("decimal addition", () => expect(evalF("0.1 + 0.2")).toBeCloseTo(0.3, 10))
  it("subtraction", () => expect(evalF("10 - 7")).toBe(3))
  it("multiplication", () => expect(evalF("6 * 7")).toBe(42))
  it("division", () => expect(evalF("20 / 4")).toBe(5))
  it("unary minus", () => expect(evalF("-5")).toBe(-5))
  it("nested minus", () => expect(evalF("-(2 + 3)")).toBe(-5))
  it("precedence: mul > add", () => expect(evalF("2 + 3 * 4")).toBe(14))
  it("parens override precedence", () => expect(evalF("(2 + 3) * 4")).toBe(20))
  it("division by zero throws", () => expect(() => evalF("1 / 0")).toThrow(/div_by_zero/))
})

/* ─── Evaluator — string + concat ─────────────────────────────────────── */

describe("N4 formula — string operations", () => {
  it("string concat with &", () => expect(evalF('"hello" & " " & "world"')).toBe("hello world"))
  it("concat with number coerces", () => expect(evalF('"value: " & 42')).toBe("value: 42"))
  it("concat with boolean", () => expect(evalF('"flag: " & TRUE')).toBe("flag: TRUE"))
  it("LEN", () => expect(evalF('LEN("abc")')).toBe(3))
  it("LEFT", () => expect(evalF('LEFT("hello", 3)')).toBe("hel"))
  it("RIGHT", () => expect(evalF('RIGHT("hello", 2)')).toBe("lo"))
  it("MID is 1-indexed", () => expect(evalF('MID("abcdef", 2, 3)')).toBe("bcd"))
  it("UPPER / LOWER", () => {
    expect(evalF('UPPER("Mix")')).toBe("MIX")
    expect(evalF('LOWER("Mix")')).toBe("mix")
  })
  it("TRIM", () => expect(evalF('TRIM("  hi  ")')).toBe("hi"))
  it("CONTAINS", () => {
    expect(evalF('CONTAINS("hello world", "world")')).toBe(true)
    expect(evalF('CONTAINS("hello", "xyz")')).toBe(false)
  })
  it("BEGINS", () => {
    expect(evalF('BEGINS("hello", "hel")')).toBe(true)
    expect(evalF('BEGINS("hello", "ell")')).toBe(false)
  })
  it("SUBSTITUTE", () => expect(evalF('SUBSTITUTE("foo bar foo", "foo", "baz")')).toBe("baz bar baz"))
  it("CONCAT variadic", () => expect(evalF('CONCAT("a", "b", "c", "d")')).toBe("abcd"))
})

/* ─── Evaluator — logical + comparison ────────────────────────────────── */

describe("N4 formula — logical + comparison", () => {
  it("AND short-circuits", () => {
    // 5/0 would throw; AND short-circuits at FALSE
    expect(evalF("FALSE AND (1 / 0)")).toBe(false)
  })
  it("OR short-circuits", () => {
    expect(evalF("TRUE OR (1 / 0)")).toBe(true)
  })
  it("NOT", () => {
    expect(evalF("NOT(TRUE)")).toBe(false)
    expect(evalF("NOT(FALSE)")).toBe(true)
  })
  it("equality with type coercion (number == numeric string)", () => {
    expect(evalF('5 == "5"')).toBe(true)
  })
  it("inequality", () => expect(evalF('5 != "6"')).toBe(true))
  it("comparison <, >, <=, >=", () => {
    expect(evalF("3 < 5")).toBe(true)
    expect(evalF("5 < 3")).toBe(false)
    expect(evalF("3 <= 3")).toBe(true)
    expect(evalF("3 >= 3")).toBe(true)
    expect(evalF("5 > 3")).toBe(true)
  })
  it("string comparison", () => expect(evalF('"abc" < "abd"')).toBe(true))
  it("null equality only to null", () => {
    expect(evalF("NULL == NULL")).toBe(true)
    expect(evalF("NULL == 0")).toBe(false)
  })
  it("null comparison throws", () => {
    expect(() => evalF("NULL < 5")).toThrow(/null_compare/)
  })
})

/* ─── Evaluator — IF + ISBLANK + ISNULL ───────────────────────────────── */

describe("N4 formula — logical functions", () => {
  it("IF then-branch", () => expect(evalF('IF(5 > 0, "pos", "neg")')).toBe("pos"))
  it("IF else-branch", () => expect(evalF('IF(5 < 0, "pos", "neg")')).toBe("neg"))
  it("IF lazy: only chosen branch evaluated", () => {
    expect(evalF('IF(TRUE, 42, 1 / 0)')).toBe(42)
    expect(evalF('IF(FALSE, 1 / 0, 99)')).toBe(99)
  })
  it("nested IF", () => {
    expect(evalF('IF({x} > 0, "pos", IF({x} == 0, "zero", "neg"))', { x: -5 })).toBe("neg")
  })
  it("ISBLANK on empty string", () => expect(evalF('ISBLANK("")')).toBe(true))
  it("ISBLANK on null", () => expect(evalF("ISBLANK(NULL)")).toBe(true))
  it("ISBLANK on number", () => expect(evalF("ISBLANK(0)")).toBe(false))
  it("ISNULL", () => {
    expect(evalF("ISNULL(NULL)")).toBe(true)
    expect(evalF("ISNULL(0)")).toBe(false)
  })
  it("ISNUMBER", () => {
    expect(evalF("ISNUMBER(42)")).toBe(true)
    expect(evalF('ISNUMBER("x")')).toBe(false)
  })
})

/* ─── Evaluator — math functions ──────────────────────────────────────── */

describe("N4 formula — math functions", () => {
  it("ABS", () => expect(evalF("ABS(-5)")).toBe(5))
  it("ROUND default 0 decimals", () => expect(evalF("ROUND(3.567)")).toBe(4))
  it("ROUND with N decimals", () => expect(evalF("ROUND(3.567, 2)")).toBe(3.57))
  it("CEILING / FLOOR", () => {
    expect(evalF("CEILING(3.1)")).toBe(4)
    expect(evalF("FLOOR(3.9)")).toBe(3)
  })
  it("MIN / MAX variadic", () => {
    expect(evalF("MIN(5, 2, 8, 1)")).toBe(1)
    expect(evalF("MAX(5, 2, 8, 1)")).toBe(8)
  })
  it("MOD", () => expect(evalF("MOD(10, 3)")).toBe(1))
  it("MOD by zero throws", () => expect(() => evalF("MOD(10, 0)")).toThrow(/div_by_zero/))
  it("SQRT", () => expect(evalF("SQRT(16)")).toBe(4))
  it("SQRT negative throws", () => expect(() => evalF("SQRT(-1)")).toThrow(/domain_error/))
  it("POWER", () => expect(evalF("POWER(2, 10)")).toBe(1024))
})

/* ─── Evaluator — date functions ──────────────────────────────────────── */

describe("N4 formula — date functions", () => {
  it("TODAY returns start-of-day", () => {
    const r = evalF("TODAY()") as Date
    expect(r.getFullYear()).toBe(2026)
    expect(r.getMonth()).toBe(4)
    expect(r.getDate()).toBe(17)
    expect(r.getHours()).toBe(0)
  })
  it("NOW returns timestamp from context", () => {
    const r = evalF("NOW()") as Date
    expect(r.getTime()).toBe(NOW.getTime())
  })
  it("YEAR / MONTH / DAY", () => {
    expect(evalF('YEAR(DATE(2026, 5, 17))')).toBe(2026)
    expect(evalF('MONTH(DATE(2026, 5, 17))')).toBe(5)
    expect(evalF('DAY(DATE(2026, 5, 17))')).toBe(17)
  })
  it("DAYS between two dates", () => {
    expect(evalF('DAYS(DATE(2026, 5, 20), DATE(2026, 5, 15))')).toBe(5)
  })
})

/* ─── Evaluator — field references ────────────────────────────────────── */

describe("N4 formula — field references", () => {
  it("resolves field from context", () => {
    expect(evalF("{revenue} * 1.18", { revenue: 1000 })).toBeCloseTo(1180)
  })
  it("missing field resolves to null", () => {
    expect(evalF("ISNULL({nope})")).toBe(true)
  })
  it("Salesforce classic: tax-inclusive price", () => {
    expect(evalF("{price} * {qty} * (1 + {tax_rate})", {
      price: 100, qty: 3, tax_rate: 0.18,
    })).toBeCloseTo(354)
  })
  it("bucket field via IF", () => {
    expect(evalF(
      'IF({value} > 100, "high", IF({value} > 10, "medium", "low"))',
      { value: 50 }
    )).toBe("medium")
  })
})

/* ─── validateFormula ─────────────────────────────────────────────────── */

describe("N4 formula — validateFormula", () => {
  it("returns valid=true with type inference", () => {
    const r = validateFormula("{price} * (1 + {tax})")
    expect(r.valid).toBe(true)
    expect(r.returnType).toBe("number")
    expect(r.fieldRefs).toEqual(expect.arrayContaining(["price", "tax"]))
  })

  it("infers string for concat", () => {
    expect(validateFormula('"a" & "b"').returnType).toBe("string")
  })

  it("infers boolean for comparison", () => {
    expect(validateFormula("5 > 3").returnType).toBe("boolean")
  })

  it("infers boolean for AND/OR", () => {
    expect(validateFormula("{a} AND {b}").returnType).toBe("boolean")
  })

  it("infers IF return type from then-branch", () => {
    expect(validateFormula('IF(TRUE, 42, 0)').returnType).toBe("number")
    expect(validateFormula('IF(TRUE, "x", "y")').returnType).toBe("string")
  })

  it("captures field references", () => {
    const r = validateFormula("{a} + {b} + {a}")
    expect(r.fieldRefs.sort()).toEqual(["a", "b"]) // dedup
  })

  it("captures function names", () => {
    const r = validateFormula("ROUND(SQRT({x}), 2)")
    expect(r.functionCalls.sort()).toEqual(["ROUND", "SQRT"])
  })

  it("reports parse error structure", () => {
    const r = validateFormula("1 + ")
    expect(r.valid).toBe(false)
    expect(r.error?.code).toBeDefined()
  })

  it("reports unknown function error at validation time", () => {
    const r = validateFormula("MAGIC()")
    expect(r.valid).toBe(false)
    expect(r.unknownFunctions).toEqual(["MAGIC"])
    expect(r.error?.code).toBe("unknown_function")
  })

  it("reports multiple unknown functions", () => {
    const r = validateFormula("FOO(BAR(), BAZ())")
    expect(r.valid).toBe(false)
    expect(r.unknownFunctions.sort()).toEqual(["BAR", "BAZ", "FOO"])
  })

  it("unknownFunctions empty when all built-in", () => {
    const r = validateFormula("ROUND(SQRT({x}), 2)")
    expect(r.valid).toBe(true)
    expect(r.unknownFunctions).toEqual([])
  })
})

describe("N4 formula — overflow protection", () => {
  it("Infinity from POWER throws overflow", () => {
    expect(() => evalF("POWER(10, 400)")).toThrow(/overflow/)
  })

  it("Infinity from chained multiplication via large literals throws", () => {
    // Build a large product without scientific notation (tokenizer doesn't
    // support `1e300` yet — slice 2 TODO). 309 nines is ~10^309 → overflow.
    expect(() => evalF("999999999999999 * 999999999999999 * POWER(10, 350)"))
      .toThrow(/overflow/)
  })

  it("normal large numbers still pass", () => {
    expect(evalF("999999 * 999999")).toBe(999998000001)
  })
})

describe("N4 formula — DATE bounds", () => {
  it("rejects month > 12", () => {
    expect(() => evalF("DATE(2026, 13, 1)")).toThrow(/bad_date/)
  })

  it("rejects month < 1", () => {
    expect(() => evalF("DATE(2026, 0, 1)")).toThrow(/bad_date/)
  })

  it("rejects day > 31", () => {
    expect(() => evalF("DATE(2026, 5, 32)")).toThrow(/bad_date/)
  })

  it("rejects non-existent date (Feb 30)", () => {
    expect(() => evalF("DATE(2026, 2, 30)")).toThrow(/bad_date/)
  })

  it("accepts Feb 29 in leap year", () => {
    expect((evalF("DATE(2024, 2, 29)") as Date).getDate()).toBe(29)
  })

  it("rejects Feb 29 in non-leap year", () => {
    expect(() => evalF("DATE(2025, 2, 29)")).toThrow(/bad_date/)
  })

  it("rejects year out of range", () => {
    expect(() => evalF("DATE(1800, 5, 17)")).toThrow(/bad_date/)
    expect(() => evalF("DATE(99999, 5, 17)")).toThrow(/bad_date/)
  })
})

/* ─── evaluateFormula (lenient) ───────────────────────────────────────── */

describe("N4 formula — evaluateFormula lenient mode", () => {
  it("returns null on division by zero (no throw)", () => {
    expect(evaluateFormula("1 / 0", ctx())).toBe(null)
  })

  it("invokes onError callback", () => {
    let captured: FormulaError | null = null
    evaluateFormula("1 / 0", ctx(), e => { captured = e })
    expect(captured).not.toBeNull()
    expect((captured as unknown as FormulaError).code).toBe("div_by_zero")
  })

  it("returns valid result when no error", () => {
    expect(evaluateFormula("2 + 2", ctx())).toBe(4)
  })
})

/* ─── Security / safety ───────────────────────────────────────────────── */

describe("N4 formula — security", () => {
  it("rejects nesting beyond 64 levels", () => {
    const src = "(".repeat(70) + "1" + ")".repeat(70)
    expect(() => evalF(src)).toThrow(/too_deep/)
  })

  it("rejects token count exceeding limit", () => {
    // 1500 numbers + 1499 plus signs = 2999 tokens > 2000 limit.
    // Source = "1+1+1+...+1" with 1500 ones → length = 1500 + 1499 = 2999 chars, well under MAX_INPUT_LEN.
    const src = Array(1500).fill("1").join("+")
    expect(() => tokenize(src)).toThrow(/too_many_tokens/)
  })

  it("string result length capped — concat overflow from field context", () => {
    // Bypass MAX_INPUT_LEN by injecting a long field value. Two ~60K
    // strings concatenated exceed MAX_STRING_LEN (100K).
    const big = "x".repeat(60_000)
    expect(() => evaluateFormulaStrict("{a} & {b}", ctx({ a: big, b: big })))
      .toThrow(/string_too_long/)
  })

  it("unknown function at eval throws clean FormulaError", () => {
    expect(() => evalF("MAGIC()")).toThrow(/Unknown function/)
  })

  it("arity mismatch throws", () => {
    expect(() => evalF('LEFT("abc")')).toThrow(/arity_error/)
    expect(() => evalF('ABS(1, 2)')).toThrow(/arity_error/)
  })
})

/* ─── Registry sanity ─────────────────────────────────────────────────── */

describe("N4 formula — function registry", () => {
  it("exports 30+ canonical functions", () => {
    expect(FORMULA_FUNCTION_NAMES.length).toBeGreaterThanOrEqual(30)
  })

  it("all function names are uppercase identifiers", () => {
    for (const n of FORMULA_FUNCTION_NAMES) {
      expect(n).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  })

  it("includes canonical Salesforce-equivalent set", () => {
    const must = ["IF","AND","OR","NOT","ISBLANK","ISNULL","ABS","ROUND","TODAY","NOW",
                  "YEAR","MONTH","DAY","DATE","LEN","LEFT","RIGHT","MID","UPPER","LOWER",
                  "TRIM","CONTAINS","BEGINS","TEXT","VALUE"]
    for (const fn of must) {
      // AND/OR/NOT are operators, not registered functions — handled by parser
      if (fn === "AND" || fn === "OR" || fn === "NOT") continue
      expect(FORMULA_FUNCTION_NAMES, `${fn} missing`).toContain(fn)
    }
  })
})
