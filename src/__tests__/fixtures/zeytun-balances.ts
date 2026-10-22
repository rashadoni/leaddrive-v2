// Synthetic wire-format fixture. Never copy the tenant's commercial export here.
export const guid = "11111111-2222-4333-8444-555555555555"
export const secondGuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
export const context = { organizationId: "tenant-test", observedAt: "2026-10-22T08:00:00Z", source: "attachment" as const }
export function row() {
  return {
    Номенклатура: {
      Наименование: "Тестмедин 500 мг №20 (таблетки) (Тестовый завод)", НаименованиеАз: "Testmedin 500 mq №20",
      Guid: guid, Номер: "SN-TEST-001", БазоваяЕдиницаИзмерения: "шт ", КолУпак: 20,
      Психотропное: false, Сильнодействующее: false, Дефектура: false,
      РеферентныйПрепарат: false, РекламнаяАкция: true,
      ДействительноС: "00010101", ДействительноДо: "00010101", Купи: 10, Получи: 1,
      ВидНоменклатуры: { Наименование: "Таблетки", Guid: guid },
      ОтделениеСклада: { Наименование: "Тестовый отдел", Guid: guid },
      ФармакологическиеНаименования: { Наименование: "", Guid: "00000000-0000-0000-0000-000000000000" },
      МассивШтрихкодов: [{ ТипШтрихкода: "EAN13", Штрихкод: "0012345678905" }],
    },
    Количество: 12.5, Цена: 1.2345,
  }
}
export function payload(rows: unknown[] = [row()]) { return JSON.stringify({ code: 0, message: "success", data: { goods: rows } }) }
