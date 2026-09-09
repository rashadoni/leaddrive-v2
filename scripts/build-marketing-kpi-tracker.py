#!/usr/bin/env python3
"""Generate the marketing-department KPI tracker (.xlsx).

Context: B2B company selling IT services, information security, GRC and
project-management services. Team: 1-2 generalist marketers. Period: annual
goals broken into quarters. Focus: brand / thought leadership.

All targets are illustrative starting points - edit them directly in Excel.
Re-run:  python3 scripts/build-marketing-kpi-tracker.py
"""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.formatting.rule import FormulaRule, DataBarRule

OUT = "KPI-Marketing-IT-Security-GRC-2026.xlsx"
FONT = "Arial"

# palette
NAVY = "1F3A5F"; SUB = "2E5077"; INK = "1A1A1A"; MUT = "5A6B7B"
BLUE = "0000FF"; BLACK = "000000"; GREEN = "008000"; WHITE = "FFFFFF"
G = "C6EFCE"; Y = "FFEB9C"; R = "FFC7CE"
FACT = "FFFBEA"; TOTAL = "DCE6F1"
CAT_FILL = {"A": "EAF1FB", "B": "FBEFEA", "C": "E8F6EE", "D": "F1EAFB", "E": "F4F4EF"}
CAT = {
    "A": "A · Экспертный контент / TL",
    "B": "B · Бренд, PR, соцсети",
    "C": "C · Сайт и SEO",
    "D": "D · Спрос и pipeline",
    "E": "E · Операц. эффективность",
}


def f(**k):
    return Font(name=FONT, **k)


thin = Side(style="thin", color="D6DCE4")
B_ALL = Border(left=thin, right=thin, top=thin, bottom=thin)
WL = Alignment(horizontal="left", vertical="center", wrap_text=True)
WC = Alignment(horizontal="center", vertical="center", wrap_text=True)
CT = Alignment(horizontal="center", vertical="center")
RT = Alignment(horizontal="right", vertical="center")

PCT1 = "0.0%"; PCT0 = "0%"; NUM = "#,##0"
PCT1D = '0.0%;-0.0%;"–"'

# (cat, name, definition, source, unit, dir, agg, weight, base, target, (q1..q4))
KPIS = [
    ("A", "Whitepapers / комплаенс-гайды (ISO 27001, SOC 2, GDPR, NIST)",
     "Кол-во опубликованных экспертных материалов по комплаенсу и ИБ",
     "Контент-план / CMS", "шт", "↑", "Σ", 0.08, 2, 8, (2, 2, 2, 2)),
    ("A", "Вебинары / онлайн-семинары проведено",
     "Кол-во проведённых онлайн-мероприятий", "Календарь мероприятий",
     "шт", "↑", "Σ", 0.07, 1, 8, (2, 2, 2, 2)),
    ("A", "Средняя посещаемость вебинара",
     "Ср. число участников онлайн на одно мероприятие", "Платформа вебинаров",
     "чел", "↑", "Среднее", 0.04, 35, 60, (45, 55, 60, 65)),
    ("A", "Клиентские кейсы (case studies) опубликовано",
     "Кол-во опубликованных кейсов с измеримым результатом клиента", "Контент-план",
     "шт", "↑", "Σ", 0.06, 1, 6, (1, 2, 1, 2)),
    ("A", "Внешние публикации и спикерства (СМИ, гостевые, конференции)",
     "Кол-во экспертных выступлений и публикаций вне своего сайта", "PR-трекер",
     "шт", "↑", "Σ", 0.05, 3, 10, (2, 3, 2, 3)),
    ("B", "Упоминания бренда в СМИ (PR mentions)",
     "Кол-во упоминаний компании в медиа за период", "Медиамониторинг",
     "шт", "↑", "Σ", 0.07, 12, 40, (8, 10, 10, 12)),
    ("B", "Прирост подписчиков LinkedIn (страница компании)",
     "Чистый прирост фолловеров за период", "LinkedIn Analytics",
     "чел", "↑", "Σ", 0.07, 0, 3000, (600, 700, 800, 900)),
    ("B", "Средний engagement rate в LinkedIn",
     "Ср. вовлечённость постов: (реакции+комментарии+репосты) / показы", "LinkedIn Analytics",
     "%", "↑", "Среднее", 0.06, 0.02, 0.04, (0.03, 0.035, 0.04, 0.04)),
    ("B", "Share of Voice в темах ИБ / GRC",
     "Доля упоминаний бренда против ключевых конкурентов", "Медиамониторинг",
     "%", "↑", "Уровень", 0.05, 0.08, 0.15, (0.10, 0.12, 0.14, 0.15)),
    ("C", "Органический трафик (сессии / мес)",
     "Среднемесячные органические сессии сайта", "GA4 / Search Console",
     "сессии", "↑", "Уровень", 0.07, 5000, 12000, (7000, 9000, 11000, 12000)),
    ("C", "Целевые ключи в ТОП-10 (vCISO, pentest, ISO 27001, GRC)",
     "Кол-во приоритетных запросов в ТОП-10 поисковой выдачи", "Search Console / Ahrefs",
     "шт", "↑", "Уровень", 0.07, 10, 40, (18, 26, 34, 40)),
    ("C", "Прирост базы рассылки (подписчики)",
     "Чистый прирост контактов в email-базе", "ESP / рассылка",
     "чел", "↑", "Σ", 0.06, 0, 2000, (400, 500, 550, 550)),
    ("D", "MQL — маркетинговые лиды сгенерировано",
     "Кол-во лидов, квалифицированных маркетингом", "CRM (LeadDrive)",
     "шт", "↑", "Σ", 0.06, 80, 600, (120, 140, 160, 180)),
    ("D", "Конверсия MQL → SQL",
     "Доля MQL, принятых отделом продаж в работу", "CRM",
     "%", "↑", "Среднее", 0.05, 0.18, 0.25, (0.20, 0.22, 0.24, 0.25)),
    ("D", "Marketing-sourced pipeline",
     "Сумма квалифицированного пайплайна, инициированного маркетингом", "CRM",
     "₽", "↑", "Σ", 0.06, 0, 12000000, (2000000, 3000000, 3500000, 3500000)),
    ("D", "CPL — стоимость лида",
     "Маркетинг-расходы / число MQL (меньше — лучше)", "CRM + бюджет",
     "₽", "↓", "Среднее", 0.03, 4000, 3000, (3500, 3200, 3000, 3000)),
    ("E", "Контент выходит по плану (в срок)",
     "Доля материалов, опубликованных в запланированный срок", "Контент-план",
     "%", "↑", "Среднее", 0.03, 0.80, 0.90, (0.85, 0.88, 0.90, 0.90)),
    ("E", "Исполнение бюджета (отклонение)",
     "Абсолютное отклонение факта от плана бюджета (меньше — лучше)", "Финплан маркетинга",
     "%", "↓", "Среднее", 0.02, 0.10, 0.05, (0.08, 0.06, 0.05, 0.05)),
]

wb = Workbook()


def L(i):
    return get_column_letter(i)


def nf(u):
    return PCT1 if u == "%" else NUM


# ============ Scorecard ============
ws = wb.active
ws.title = "KPI Scorecard"
ws.sheet_properties.tabColor = NAVY
HDR = ["№", "Категория", "KPI / метрика", "Что измеряем (определение)", "Источник данных",
       "Ед.", "Напр.", "Тип", "Вес", "База\n(сейчас)", "Цель\nна год",
       "Q1 план", "Q1 факт", "Q2 план", "Q2 факт", "Q3 план", "Q3 факт", "Q4 план", "Q4 факт",
       "Факт\n(год)", "% вып.", "Взв.\nбалл", "Статус"]
NC = len(HDR)

ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=NC)
tt = ws.cell(1, 1, "KPI-трекер отдела маркетинга — IT-услуги · Информационная безопасность · GRC · Project Management")
tt.font = f(bold=True, size=13, color=WHITE)
tt.alignment = Alignment(horizontal="left", vertical="center")
tt.fill = PatternFill("solid", fgColor=NAVY)
ws.row_dimensions[1].height = 26
ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=NC)
ss = ws.cell(2, 1, "Период: 2026 год (годовые цели + разбивка по кварталам)   ·   Команда: 1–2 маркетолога-универсала   ·   Фокус: бренд и экспертность (thought leadership)")
ss.font = f(size=9, color=WHITE, italic=True)
ss.alignment = Alignment(horizontal="left", vertical="center")
ss.fill = PatternFill("solid", fgColor=SUB)
ws.row_dimensions[2].height = 18

for c, h in enumerate(HDR, 1):
    cell = ws.cell(3, c, h)
    cell.font = f(bold=True, color=WHITE, size=9)
    cell.fill = PatternFill("solid", fgColor=SUB)
    cell.alignment = WC
    cell.border = B_ALL
ws.row_dimensions[3].height = 30

r0 = 4
for i, (cat, name, defn, src, unit, dr, agg, w, base, tgt, qs) in enumerate(KPIS):
    r = r0 + i
    n = ws.cell(r, 1, i + 1)
    n.alignment = CT
    n.font = f(size=9, color=MUT)
    n.border = B_ALL
    n.fill = PatternFill("solid", fgColor=CAT_FILL[cat])
    b = ws.cell(r, 2, CAT[cat])
    b.font = f(size=8, bold=True, color=INK)
    b.alignment = WL
    b.fill = PatternFill("solid", fgColor=CAT_FILL[cat])
    b.border = B_ALL
    for col, val, al, fn in [(3, name, WL, f(size=9, color=INK)), (4, defn, WL, f(size=8, color=MUT)),
                             (5, src, WL, f(size=8, color=MUT)), (6, unit, CT, f(size=8, color=INK)),
                             (7, dr, CT, f(size=9, color=INK)), (8, agg, CT, f(size=8, color=INK))]:
        cc = ws.cell(r, col, val)
        cc.alignment = al
        cc.font = fn
        cc.border = B_ALL
    wcell = ws.cell(r, 9, w)
    wcell.number_format = PCT0
    wcell.font = f(size=9, color=BLUE)
    wcell.alignment = CT
    wcell.border = B_ALL
    for col, val in [(10, base), (11, tgt)]:
        cc = ws.cell(r, col, val)
        cc.number_format = nf(unit)
        cc.font = f(size=9, color=BLUE)
        cc.alignment = CT
        cc.border = B_ALL
    plancols = [12, 14, 16, 18]
    factcols = [13, 15, 17, 19]
    for k in range(4):
        pc = ws.cell(r, plancols[k], qs[k])
        pc.number_format = nf(unit)
        pc.font = f(size=9, color=BLUE)
        pc.alignment = CT
        pc.border = B_ALL
        fc = ws.cell(r, factcols[k])
        fc.number_format = nf(unit)
        fc.font = f(size=9, color=BLUE)
        fc.alignment = CT
        fc.border = B_ALL
        fc.fill = PatternFill("solid", fgColor=FACT)
    M, O, Q, S, T = L(13), L(15), L(17), L(19), L(20)
    U = L(21)
    tf = (f'=IF($H{r}="Σ",SUM({M}{r},{O}{r},{Q}{r},{S}{r}),'
          f'IF($H{r}="Среднее",IFERROR(AVERAGE({M}{r},{O}{r},{Q}{r},{S}{r}),0),'
          f'IF({S}{r}<>"",{S}{r},IF({Q}{r}<>"",{Q}{r},IF({O}{r}<>"",{O}{r},IF({M}{r}<>"",{M}{r},0))))))')
    tc = ws.cell(r, 20, tf)
    tc.number_format = nf(unit)
    tc.font = f(size=9, bold=True, color=BLACK)
    tc.alignment = CT
    tc.border = B_ALL
    uf = (f'=IF(OR($K{r}=0,COUNT({M}{r},{O}{r},{Q}{r},{S}{r})=0),"",'
          f'IF($G{r}="↓",IFERROR($K{r}/{T}{r},1),{T}{r}/$K{r}))')
    uc = ws.cell(r, 21, uf)
    uc.number_format = PCT0
    uc.font = f(size=9, bold=True, color=BLACK)
    uc.alignment = CT
    uc.border = B_ALL
    vc = ws.cell(r, 22, f'=IF({U}{r}="","",$I{r}*MIN({U}{r},1))')
    vc.number_format = PCT1D
    vc.font = f(size=9, color=BLACK)
    vc.alignment = CT
    vc.border = B_ALL
    wf = (f'=IF({U}{r}="","–",IF({U}{r}>=0.95,"\U0001F7E2 В норме",'
          f'IF({U}{r}>=0.8,"\U0001F7E1 Внимание","\U0001F534 Риск")))')
    stc = ws.cell(r, 23, wf)
    stc.font = f(size=9, color=BLACK)
    stc.alignment = WC
    stc.border = B_ALL
    # hidden helper: 1 if this KPI has any quarter fact entered, else 0.
    # Aggregates divide by SUM of weights where flag=1 — robust to the
    # formula-"" quirk where SUMIF(...,"<>") wrongly counts blank rows.
    fl = ws.cell(r, 24, f'=IF(COUNT({M}{r},{O}{r},{Q}{r},{S}{r})=0,0,1)')
    fl.font = f(size=8, color=MUT)
    fl.alignment = CT

rt = r0 + len(KPIS)
ws.merge_cells(start_row=rt, start_column=1, end_row=rt, end_column=8)
tl = ws.cell(rt, 1, "ИТОГО · KPI-индекс отдела (взвешенный)")
tl.font = f(bold=True, size=10, color=INK)
tl.alignment = RT
for c in range(1, NC + 1):
    ws.cell(rt, c).fill = PatternFill("solid", fgColor=TOTAL)
    ws.cell(rt, c).border = B_ALL
iw = ws.cell(rt, 9, f'=SUM(I{r0}:I{rt - 1})')
iw.number_format = PCT0
iw.font = f(bold=True, color=BLACK)
iw.alignment = CT
ui = ws.cell(rt, 21, f'=IF(SUM(X{r0}:X{rt - 1})=0,"",SUM(V{r0}:V{rt - 1})/SUMIF(X{r0}:X{rt - 1},1,I{r0}:I{rt - 1}))')
ui.number_format = PCT0
ui.font = f(bold=True, size=10, color=BLACK)
ui.alignment = CT
vi = ws.cell(rt, 22, f'=IF(SUM(X{r0}:X{rt - 1})=0,"",SUM(V{r0}:V{rt - 1}))')
vi.number_format = PCT1D
vi.font = f(bold=True, color=BLACK)
vi.alignment = CT
sti = ws.cell(rt, 23, f'=IF(U{rt}="","–",IF(U{rt}>=0.95,"\U0001F7E2 В норме",IF(U{rt}>=0.8,"\U0001F7E1 Внимание","\U0001F534 Риск")))')
sti.font = f(bold=True)
sti.alignment = WC

widths = {1: 4, 2: 20, 3: 34, 4: 30, 5: 18, 6: 7, 7: 7, 8: 9, 9: 7, 10: 9, 11: 9,
          12: 8, 13: 8, 14: 8, 15: 8, 16: 8, 17: 8, 18: 8, 19: 8, 20: 9, 21: 8, 22: 8, 23: 14}
for c, wd in widths.items():
    ws.column_dimensions[L(c)].width = wd
ws.freeze_panes = "D4"
# include the hidden helper col X in the filter range so a sort moves it
# together with its row (otherwise X desyncs from the row it flags).
ws.auto_filter.ref = f"A3:{L(24)}{rt - 1}"
hx = ws.cell(3, 24, "measured")
hx.font = f(bold=True, color=WHITE, size=8)
hx.fill = PatternFill("solid", fgColor=SUB)
ws.column_dimensions["X"].hidden = True

for rng, col in [(f"U{r0}:U{rt - 1}", "$U"), (f"W{r0}:W{rt - 1}", "$U")]:
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f'AND({col}{r0}<>"",{col}{r0}>=0.95)'], fill=PatternFill("solid", fgColor=G)))
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f'AND({col}{r0}<>"",{col}{r0}>=0.8,{col}{r0}<0.95)'], fill=PatternFill("solid", fgColor=Y)))
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f'AND({col}{r0}<>"",{col}{r0}<0.8)'], fill=PatternFill("solid", fgColor=R)))

# ============ Summary ============
sm = wb.create_sheet("Сводка по категориям")
sm.sheet_properties.tabColor = SUB
sm.merge_cells("A1:E1")
sh = sm.cell(1, 1, "Сводка по блокам KPI")
sh.font = f(bold=True, size=12, color=WHITE)
sh.fill = PatternFill("solid", fgColor=NAVY)
sh.alignment = Alignment(horizontal="left", vertical="center")
sm.row_dimensions[1].height = 24
for c, lab in enumerate(["Блок", "Вес блока", "Достигнуто (взв.)", "% достижения", "Статус"], 1):
    cc = sm.cell(3, c, lab)
    cc.font = f(bold=True, color=WHITE, size=9)
    cc.fill = PatternFill("solid", fgColor=SUB)
    cc.alignment = WC
    cc.border = B_ALL
sm.row_dimensions[3].height = 24
SB = "'KPI Scorecard'"
for i, ck in enumerate(["A", "B", "C", "D", "E"]):
    r = 4 + i
    a = sm.cell(r, 1, CAT[ck])
    a.font = f(size=9, color=INK)
    a.alignment = WL
    a.fill = PatternFill("solid", fgColor=CAT_FILL[ck])
    a.border = B_ALL
    bw = sm.cell(r, 2, f'=SUMIF({SB}!$B${r0}:$B${rt - 1},$A{r},{SB}!$I${r0}:$I${rt - 1})')
    bw.number_format = PCT0
    bw.font = f(color=GREEN)
    bw.alignment = CT
    bw.border = B_ALL
    ac = sm.cell(r, 3, f'=SUMIF({SB}!$B${r0}:$B${rt - 1},$A{r},{SB}!$V${r0}:$V${rt - 1})')
    ac.number_format = PCT1D
    ac.font = f(color=GREEN)
    ac.alignment = CT
    ac.border = B_ALL
    pc = sm.cell(r, 4, f'=IF(SUMIFS({SB}!$X${r0}:$X${rt - 1},{SB}!$B${r0}:$B${rt - 1},$A{r})=0,"",C{r}/SUMIFS({SB}!$I${r0}:$I${rt - 1},{SB}!$B${r0}:$B${rt - 1},$A{r},{SB}!$X${r0}:$X${rt - 1},1))')
    pc.number_format = PCT0
    pc.font = f(color=BLACK)
    pc.alignment = CT
    pc.border = B_ALL
    st = sm.cell(r, 5, f'=IF(D{r}="","–",IF(D{r}>=0.95,"\U0001F7E2 В норме",IF(D{r}>=0.8,"\U0001F7E1 Внимание","\U0001F534 Риск")))')
    st.font = f(color=BLACK)
    st.alignment = WC
    st.border = B_ALL
rr = 4 + 5
for c in range(1, 6):
    sm.cell(rr, c).fill = PatternFill("solid", fgColor=TOTAL)
    sm.cell(rr, c).border = B_ALL
tlab = sm.cell(rr, 1, "ИТОГО · KPI-индекс отдела")
tlab.font = f(bold=True, color=INK)
tlab.alignment = RT
b2 = sm.cell(rr, 2, f'=SUM(B4:B{rr - 1})')
b2.number_format = PCT0
b2.font = f(bold=True, color=BLACK)
b2.alignment = CT
c2 = sm.cell(rr, 3, f'=SUM(C4:C{rr - 1})')
c2.number_format = PCT1D
c2.font = f(bold=True, color=BLACK)
c2.alignment = CT
d2 = sm.cell(rr, 4, f'=IF(SUM({SB}!$X${r0}:$X${rt - 1})=0,"",C{rr}/SUMIF({SB}!$X${r0}:$X${rt - 1},1,{SB}!$I${r0}:$I${rt - 1}))')
d2.number_format = PCT0
d2.font = f(bold=True, color=BLACK)
d2.alignment = CT
e2 = sm.cell(rr, 5, f'=IF(D{rr}="","–",IF(D{rr}>=0.95,"\U0001F7E2 В норме",IF(D{rr}>=0.8,"\U0001F7E1 Внимание","\U0001F534 Риск")))')
e2.font = f(bold=True)
e2.alignment = WC
for c, wd in {1: 30, 2: 14, 3: 18, 4: 14, 5: 16}.items():
    sm.column_dimensions[L(c)].width = wd
sm.conditional_formatting.add(f"D4:D{rr - 1}", DataBarRule(start_type="num", start_value=0, end_type="num", end_value=1, color="7CA8DC"))
lr = rr + 2
sm.cell(lr, 1, "Легенда:").font = f(bold=True, size=9, color=INK)
sm.cell(lr + 1, 1, "\U0001F7E2 ≥ 95% выполнения   ·   \U0001F7E1 80–95%   ·   \U0001F534 < 80%   ·   «–» нет данных").font = f(size=9, color=MUT)
sm.cell(lr + 2, 1, "«Достигнуто» и «% достижения» учитывают только KPI, по которым уже внесён факт.").font = f(size=8, italic=True, color=MUT)

# ============ Instructions ============
ins = wb.create_sheet("Инструкция")
ins.sheet_properties.tabColor = "6B7B8C"
ins.column_dimensions["A"].width = 3
ins.column_dimensions["B"].width = 115
INST = [
    ("Как пользоваться KPI-трекером", "h1"),
    ("", "sp"),
    ("1. Заполните столбец «База (сейчас)» — текущее значение каждой метрики на старте года.", "b"),
    ("2. Проверьте «Цель на год» и поквартальный план (Q1–Q4 план). Цифры в шаблоне — иллюстративные ориентиры для команды 1–2 человека с акцентом на бренд/экспертность; замените на свой план.", "b"),
    ("3. В конце каждого квартала вносите факт в столбцы «Qn факт». Всё остальное — «Факт (год)», «% вып.», «Взв. балл», «Статус» — считается автоматически.", "b"),
    ("4. Лист «Сводка по категориям» и строка «KPI-индекс отдела» показывают агрегированный результат и подсвечивают проседающие блоки.", "b"),
    ("", "sp"),
    ("Логика расчёта", "h2"),
    ("• «Тип» агрегации: Σ — кварталы суммируются (год = сумма); «Среднее» — среднее по заполненным кварталам; «Уровень» — последнее внесённое значение, не обязательно Q4 (для метрик-состояний: трафик, подписчики, Share of Voice).", "b"),
    ("• «Напр.» (направление): ↑ — чем больше, тем лучше (% = факт ÷ цель); ↓ — чем меньше, тем лучше, напр. CPL и отклонение бюджета (% = цель ÷ факт).", "b"),
    ("• «Вес» — значимость KPI; сумма весов = 100%. Взвешенный балл = вес × min(% выполнения; 100%). KPI-индекс отдела = сумма баллов ÷ вес уже измеренных KPI.", "b"),
    ("", "sp"),
    ("Статусы", "h2"),
    ("\U0001F7E2 В норме — ≥ 95% выполнения   ·   \U0001F7E1 Внимание — 80–95%   ·   \U0001F534 Риск — < 80%   ·   «–» — данных пока нет.", "b"),
    ("", "sp"),
    ("Цвет ввода", "h2"),
    ("Синие числа вводите вы (база, цели, планы, факты, веса). Чёрные — формулы, их менять не нужно. Зелёные на «Сводке» — ссылки на лист KPI Scorecard.", "b"),
    ("", "sp"),
    ("Ритм ревью", "h2"),
    ("• Ежемесячно — быстрый чек: внести свежие факты, посмотреть статусы.", "b"),
    ("• Ежеквартально — разбор по «Сводке», корректировка планов и приоритетов.", "b"),
    ("• Раз в год — пересбор целей от новой базы.", "b"),
    ("", "sp"),
    ("Почему такой набор", "h2"),
    ("Фокус — бренд и экспертность: блоки A (контент/thought leadership) и B (бренд/PR/соцсети) весят 55% — это важнее всего для доверия в ИБ/GRC. Блок C (сайт/SEO) — 20%, спрос и pipeline (D) — 20%, операционная эффективность (E) — 5%. При росте команды добавляйте строки/блоки (ABM, product marketing, события).", "b"),
    ("Все цели — стартовые ориентиры. Подставьте реальные цифры от своей базы и бюджета.", "i"),
]
ir = 1
for txt, kind in INST:
    cell = ins.cell(ir, 2, txt)
    if kind == "h1":
        cell.font = f(bold=True, size=14, color=NAVY)
    elif kind == "h2":
        cell.font = f(bold=True, size=11, color=NAVY)
    elif kind == "i":
        cell.font = f(size=10, italic=True, color=MUT)
    elif kind == "sp":
        ins.row_dimensions[ir].height = 6
    else:
        cell.font = f(size=10, color=INK)
    cell.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
    if kind in ("b", "i"):
        ins.row_dimensions[ir].height = 30
    ir += 1

# ============ Glossary ============
glo = wb.create_sheet("Глоссарий")
glo.sheet_properties.tabColor = "8A7B6B"
glo.column_dimensions["A"].width = 34
glo.column_dimensions["B"].width = 92
glo.merge_cells("A1:B1")
gh = glo.cell(1, 1, "Глоссарий терминов")
gh.font = f(bold=True, size=12, color=WHITE)
gh.fill = PatternFill("solid", fgColor=NAVY)
gh.alignment = Alignment(horizontal="left", vertical="center")
glo.row_dimensions[1].height = 22
TERMS = [
    ("MQL (Marketing Qualified Lead)", "Лид, проявивший интерес и подходящий под критерии маркетинга."),
    ("SQL (Sales Qualified Lead)", "Лид, принятый отделом продаж в работу."),
    ("Pipeline", "Суммарная стоимость открытых сделок в воронке продаж."),
    ("Marketing-sourced", "Сделки / пайплайн, первично созданные маркетингом."),
    ("Marketing-influenced", "Сделки, которых маркетинг коснулся (не обязательно создал)."),
    ("CPL (Cost per Lead)", "Стоимость одного лида = расходы / число лидов."),
    ("CAC", "Стоимость привлечения одного клиента."),
    ("Thought leadership", "Экспертный контент, формирующий авторитет бренда на рынке."),
    ("Share of Voice (SoV)", "Доля упоминаний бренда против конкурентов в инфополе."),
    ("Engagement rate", "Вовлечённость аудитории (реакции / показы)."),
    ("ABM (Account-Based Marketing)", "Точечный маркетинг на список целевых аккаунтов."),
    ("Whitepaper", "Экспертный документ / гайд (часто по комплаенсу и ИБ)."),
    ("Case study", "Кейс с измеримыми результатами клиента."),
    ("vCISO", "Virtual CISO — услуга «директор по ИБ как сервис»."),
    ("GRC", "Governance, Risk & Compliance — управление, риски и соответствие требованиям."),
    ("ISO 27001 / SOC 2 / GDPR / NIST / PCI DSS", "Стандарты и регуляторика информационной безопасности / данных."),
    ("Pentest", "Тест на проникновение (penetration testing)."),
    ("ROAS", "Окупаемость рекламных расходов (revenue / рекламный бюджет)."),
    ("Deliverability", "Доставляемость email — доля писем, попавших во «Входящие»."),
]
gr = 3
for term, desc in TERMS:
    a = glo.cell(gr, 1, term)
    a.font = f(bold=True, size=9, color=INK)
    a.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
    a.border = B_ALL
    d = glo.cell(gr, 2, desc)
    d.font = f(size=9, color=INK)
    d.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
    d.border = B_ALL
    gr += 1

wb.active = 0
wb.save(OUT)
print("saved", OUT)
