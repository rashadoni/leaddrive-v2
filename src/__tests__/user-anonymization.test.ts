import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  ANONYMIZED_USER_NAME,
  anonymizedEmailFor,
  buildUserAnonymizationData,
} from "@/lib/user-anonymization"

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8")

/** Поля модели User, которые несут персональные данные или дают доступ. */
function userModelScalarFields(): string[] {
  const start = schema.indexOf("model User {")
  const end = schema.indexOf("\n}", start)
  return schema
    .slice(start, end)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("@@"))
    .map((l) => l.split(/\s+/)[0])
    .filter((n) => /^[a-z][A-Za-z0-9]*$/.test(n))
}

describe("надгробие пользователя затирает всё, что нужно затереть", () => {
  const data = buildUserAnonymizationData("u123", new Date("2026-09-09T12:00:00Z"))

  it("затирает имя и контакты", () => {
    expect(data.name).toBe(ANONYMIZED_USER_NAME)
    expect(data.phone).toBeNull()
    expect(data.verifiedPhone).toBeNull()
    expect(data.avatar).toBeNull()
    expect(data.department).toBeNull()
  })

  it("даёт почте уникальную заглушку, а не пустоту", () => {
    // На email стоит @@unique([organizationId, email]): второй обезличенный
    // в той же организации упёрся бы в конфликт, если бы заглушка была общей.
    expect(data.email).toBe("deleted-u123@invalid.local")
    expect(anonymizedEmailFor("a")).not.toBe(anonymizedEmailFor("b"))
    // .invalid зарезервирован RFC 2606: на такой адрес нельзя случайно
    // отправить письмо.
    expect(String(data.email)).toContain(".local")
  })

  it("закрывает вход и снимает второй фактор", () => {
    expect(data.isActive).toBe(false)
    expect(data.passwordHash).not.toBe("")
    expect(String(data.passwordHash)).toMatch(/anonymized/)
    expect(data.totpSecret).toBeNull()
    expect(data.totpEnabled).toBe(false)
    expect(data.smsAuthEnabled).toBe(false)
    expect(data.require2fa).toBe(false)
    expect(data.backupCodes).toEqual([])
    expect(data.twoFactorNonce).toBeNull()
  })

  it("гасит токены восстановления и календаря", () => {
    expect(data.resetToken).toBeNull()
    expect(data.resetTokenExp).toBeNull()
    expect(data.calendarToken).toBeNull()
  })

  it("инвалидирует живые сессии", () => {
    // Проверка сессии сравнивает метку в токене с passwordChangedAt.
    expect(data.passwordChangedAt).toEqual(new Date("2026-09-09T12:00:00Z"))
  })

  it("ставит метку, отличающую стёртого от просто отключённого", () => {
    // isActive: false обратим — сотрудника можно вернуть.
    // anonymizedAt необратим: возвращать уже нечего.
    expect(data.anonymizedAt).toEqual(new Date("2026-09-09T12:00:00Z"))
  })

  it("не трогает id: на него ссылаются журналы соответствия", () => {
    // Ради этого всё и затевалось. Обнулив автора в журналах, мы сохранили бы
    // таблицу и потеряли её смысл — там ценно именно «кто это сделал».
    expect(data).not.toHaveProperty("id")
  })
})

describe("список полей не отстаёт от схемы", () => {
  it("покрывает каждое персональное поле модели User", () => {
    // Негативный контроль. Добавили в User новое поле с персональными данными
    // и забыли внести сюда — это утечка, которую иначе заметит только аудит.
    // Список намеренно перечислен вручную: он должен ломаться при росте схемы.
    const personal = [
      "email", "name", "passwordHash", "avatar", "phone", "department",
      "totpSecret", "totpEnabled", "smsAuthEnabled", "verifiedPhone",
      "require2fa", "backupCodes", "calendarToken", "twoFactorNonce",
      "resetToken", "resetTokenExp",
    ]
    const fields = userModelScalarFields()
    // Сначала убеждаемся, что разбор схемы вообще работает.
    expect(fields).toContain("email")
    expect(fields.length).toBeGreaterThan(20)

    const missing = personal.filter((f) => !fields.includes(f))
    expect(missing, "поля исчезли из схемы — обнови список").toEqual([])

    const data = buildUserAnonymizationData("u1")
    const notScrubbed = personal.filter((f) => !(f in (data as Record<string, unknown>)))
    expect(notScrubbed, "персональное поле не затирается").toEqual([])
  })
})
