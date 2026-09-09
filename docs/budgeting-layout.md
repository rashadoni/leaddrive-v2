# Budgeting Page — WorkspaceTab Layout (Рабочая область)

**File:** `src/app/(dashboard)/budgeting/page.tsx` → `WorkspaceTab`

## ОБЯЗАТЕЛЬНЫЕ секции (НЕ удалять/менять без подтверждения пользователя!)

### ROW 0: Time Machine (collapsible)
- `BudgetTimeMachine` — интерактивный slider для просмотра истории изменений бюджета
  - Компонент: `src/components/budget-time-machine.tsx`
  - Свёрнутое состояние: "Time Machine — N checkpoints available" + кнопка "Explore History"
  - Развёрнутое: slider с временной шкалой, badge "Viewing historical state", кнопка "Return to current"
  - При активации: все данные (KPI, графики, таблица) показывают историческое состояние
  - При активации: кнопки редактирования и удаления скрыты (read-only mode)
  - Heatmap: ячейки мигают зелёным/красным/жёлтым при изменении значений

### ROW 1: 3 KPI Cards (grid-cols-3)
1. **Расходы (факт)** — красная карточка, `ColorStatCard color="red"`
   - Значение: `totalExpenseActual`
   - Sub: `expExecPct% исполнение · план: totalExpensePlanned`
2. **Доходы (факт)** — зелёная карточка, `ColorStatCard color="green"`
   - Значение: `totalRevenueActual`
   - Sub: `revenueExecPct% исполнение · план: totalRevenuePlanned`
3. **Маржа (факт)** — teal/red карточка, `ColorStatCard color="teal"/"red"`
   - Значение: `marginActual`
   - Sub: `ОТКЛОНЕНИЕ: totalVariance`

### ROW 2: Waterfall + Gauge (grid-cols-3, 2:1)
- **LEFT (col-span-2):** `BudgetWaterfallChart` — Водопадный анализ
  - Props: totalPlanned, totalForecast, totalActual, totalVariance, yearEndProjection
- **RIGHT (col-span-1):** `BudgetExecutionGauge` — Исполнение бюджета
  - Props: executionPct, expenseExecPct, revenueExecPct, elapsedPct
  - Цвета: >=80% зелёный, 50-80% жёлтый, <50% красный

### ROW 3: Category Bars (full width)
- `BudgetCategoryBars` — План / Прогноз / Факт по категориям
  - Props: categories (byCategory)
  - Фильтры: Все / Расходы / Доходы
  - Интерактивные: click-to-select с detail card

### ROW 4: Overspend Alert (conditional)
- **Красный баннер** если `overspendPct > 25` — "Критический перерасход бюджета"
- **Жёлтый баннер** если `overspendPct > 10 && <= 25` — предупреждение

### ROW 5: Executive Summary
- Текстовая сводка: расходы выше/ниже плана на X%

### ROW 6: Action Buttons
- AI-анализ, Обновить факт, Excel

### ROW 7: Editable Grid (таблица категорий)
- Заголовки: КАТЕГОРИЯ, ДЕПАРТАМЕНТ, ПЛАН, ФАКТ, ОТКЛ %
- Группы: ДОХОДЫ, РАСХОДЫ (COGS, OpEx, CapEx)
- Кнопки: + Добавить строку, Сохранить

### ROW 8: Drill-down Sheet
- Sheet для детализации факт значений при клике

---

## Компоненты (НЕ удалять файлы!)
- `src/components/budget-waterfall-chart.tsx`
- `src/components/budget-execution-gauge.tsx`
- `src/components/budget-category-bars.tsx`
- `src/components/budget-margin-summary.tsx` (используется в OverviewTab)
- `src/components/color-stat-card.tsx`
- `src/lib/budget-chart-theme.tsx`

## Правило
**Любое изменение layout — ТОЛЬКО после подтверждения пользователя.**
