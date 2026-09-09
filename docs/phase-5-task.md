# Фаза 5: AI-визуализация (Glassmorphism & фиолетовые акценты)

## Контекст
Это 5-я фаза редизайна CRM в стиле Salesforce Agentforce.
Фазы 1-4 (палитра, сайдбар, UI-компоненты, таблицы) и Фаза 6 (страницы) — уже сделаны.
Фаза 5 осталась незавершённой: CSS-классы `.glass-panel`, `.ai-accent`, `.ai-glow` **определены** в `globals.css`, но **не применены** к большинству AI-компонентов.

**ВАЖНО**: Перед началом прочитать `CLAUDE.md` — там правила защиты UI, деплоя, и т.д.

---

## Цель
Все AI-элементы CRM должны визуально отличаться от обычных карточек:
- **Glassmorphism**: полупрозрачный фон + backdrop-blur
- **Фиолетовый градиент**: левая граница с glow-эффектом
- **Свечение**: усиленный box-shadow на AI-карточках
- **Badge `ai`**: уже существует — убедиться что используется везде где нужно

---

## Что уже есть в CSS (`src/app/globals.css`)

```css
/* Переменные — НЕ ТРОГАТЬ */
--ai-from: 265 48% 55%;    /* #7D55C7 */
--ai-to: 261 100% 71%;     /* #9B6CFF */

/* Классы — НУЖНО УСИЛИТЬ */
.ai-accent {
  border-left: 3px solid hsl(var(--ai-to));
}
.ai-glow {
  box-shadow: 0 0 12px 2px hsl(var(--ai-from) / 0.15);
}
.glass-panel {
  background: hsl(var(--card) / 0.8);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid hsl(var(--border) / 0.4);
}
```

---

## Задачи

### Задача 1: Усилить CSS-классы в `globals.css`

**Файл:** `src/app/globals.css`

#### 1.1 Обновить `.ai-glow` — сделать свечение заметнее
```css
.ai-glow {
  box-shadow: 0 0 16px 4px hsl(var(--ai-from) / 0.18),
              0 0 4px 1px hsl(var(--ai-to) / 0.10);
  transition: box-shadow 0.3s ease;
}
.ai-glow:hover {
  box-shadow: 0 0 24px 6px hsl(var(--ai-from) / 0.25),
              0 0 8px 2px hsl(var(--ai-to) / 0.15);
}
```

#### 1.2 Добавить новый класс `.ai-card` — комбинация glassmorphism + accent + glow
```css
.ai-card {
  background: hsl(var(--card) / 0.85);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  border: 1px solid hsl(var(--border) / 0.4);
  border-left: 3px solid hsl(var(--ai-to));
  box-shadow: 0 0 16px 4px hsl(var(--ai-from) / 0.12);
  transition: box-shadow 0.3s ease, transform 0.2s ease;
}
.ai-card:hover {
  box-shadow: 0 0 24px 6px hsl(var(--ai-from) / 0.20);
  transform: translateY(-1px);
}
```

#### 1.3 Добавить `.ai-gradient-border` — анимированная фиолетовая граница
```css
.ai-gradient-border {
  position: relative;
  overflow: hidden;
}
.ai-gradient-border::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, hsl(var(--ai-from)), hsl(var(--ai-to)));
  border-radius: 0 2px 2px 0;
}
```

#### 1.4 Добавить пульсирующую точку для AI-статуса
```css
.ai-pulse-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: hsl(var(--ai-from));
  animation: ai-pulse 2s ease-in-out infinite;
}
@keyframes ai-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 hsl(var(--ai-from) / 0.4); }
  50% { opacity: 0.8; box-shadow: 0 0 0 6px hsl(var(--ai-from) / 0); }
}
```

---

### Задача 2: AI Assistant Panel — полный glassmorphism

**Файл:** `src/components/ai-assistant-panel.tsx`

Текущее состояние: `bg-card/80 backdrop-blur-xl` — уже частично glassmorphism, но без glow и без hover.

#### 2.1 Панель (основной контейнер, строка ~239)
Заменить:
```tsx
className="fixed right-0 top-0 bottom-0 z-50 w-[380px] bg-card/80 backdrop-blur-xl border-l border-border/40 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
```
На:
```tsx
className="fixed right-0 top-0 bottom-0 z-50 w-[380px] glass-panel shadow-2xl flex flex-col animate-in slide-in-from-right duration-200 ai-glow"
```

#### 2.2 FAB-кнопка (строка ~231) — добавить пульсацию
Добавить класс `animate-pulse-glow` к кнопке:
```tsx
className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-gradient-to-br from-[hsl(var(--ai-from))] to-[hsl(var(--ai-to))] text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 flex items-center justify-center group animate-pulse-glow"
```

#### 2.3 Сообщения ассистента (строка ~291) — фиолетовый акцент
Для `msg.role === "assistant"` вместо `bg-muted` сделать:
```tsx
"bg-[hsl(var(--ai-from))]/5 border border-[hsl(var(--ai-from))]/10 rounded-bl-md"
```

#### 2.4 Пустое состояние (строка ~269) — усилить AI-иконку
Добавить `ai-glow` к контейнеру с иконкой Sparkles:
```tsx
className="h-16 w-16 rounded-2xl bg-gradient-to-br from-[hsl(var(--ai-from))]/10 to-[hsl(var(--ai-to))]/10 flex items-center justify-center mb-4 ai-glow"
```

---

### Задача 3: AI Scoring Page — glassmorphism на карточках

**Файл:** `src/app/(dashboard)/ai-scoring/page.tsx`

#### 3.1 Заголовочная карточка (с Brain иконкой)
Добавить классы `ai-card` к основной Card компоненту вверху страницы.
Если Card обёрнут в обычный `<Card>`, заменить на:
```tsx
<Card className="ai-card">
```

#### 3.2 Кнопка "Скорировать" — ai-glow
Убедиться что основная кнопка действия имеет `ai-glow` класс. Если уже есть — оставить.

#### 3.3 Карточки результатов скоринга
Для карточек с оценкой (A-F) — НЕ добавлять glassmorphism. Они должны остаться обычными. Glassmorphism только для "шапки" с AI-информацией.

---

### Задача 4: AI Command Center — glassmorphism

**Файл:** `src/app/(dashboard)/ai-command-center/page.tsx`

#### 4.1 Главная карточка с описанием "Da Vinci"
Добавить `ai-card` класс.

#### 4.2 Карточки AI-инструментов (chat, scoring, analysis и т.д.)
Каждая карточка инструмента — добавить `ai-gradient-border` класс. Не glassmorphism на каждую — слишком тяжело. Только фиолетовая левая граница.

#### 4.3 Если есть секция "AI Model Info" или "Status"
Добавить `.ai-pulse-dot` рядом с индикатором статуса модели.

---

### Задача 5: AI Lead Scoring (Dashboard widget)

**Файл:** `src/components/dashboard/ai-lead-scoring.tsx`

#### 5.1 Основная карточка (строка ~24 — уже есть `ai-accent`)
Заменить `ai-accent` на `ai-card`:
```tsx
<Card className="ai-card">
```

#### 5.2 Ссылка "Ətraflı" — текст уже `text-[hsl(var(--ai-from))]` — оставить.

---

### Задача 6: AI Observations (Profitability)

**Файл:** `src/components/profitability/ai-observations.tsx`

#### 6.1 Основная карточка (строка ~84 — уже есть `ai-accent`)
Заменить `ai-accent` на `ai-card`.

#### 6.2 Brain иконка
Уже анимирована (`animate-pulse`) — оставить. Добавить `.ai-pulse-dot` рядом с заголовком "Da Vinci Analiz".

---

### Задача 7: Agent Builder

**Файл:** `src/components/ai/agent-builder.tsx`

#### 7.1 Основная карточка (строка ~28 — `ai-accent`)
Заменить `ai-accent` на `ai-card`.

---

### Задача 8: Lead Item Modal — AI-секции

**Файл:** `src/components/lead-item-modal.tsx`

#### 8.1 Секции с `ai-accent` (строки ~732, ~784, ~889)
Заменить `ai-accent` на `ai-gradient-border` — более тонкий фиолетовый эффект для модалок (glassmorphism внутри модалки — overkill).

#### 8.2 Секция с `bg-[hsl(var(--ai-from))]/5` (строка ~900)
Добавить `border border-[hsl(var(--ai-from))]/10` для визуального выделения.

---

### Задача 9: Badge variant="ai" — проверка использования

**Файл:** `src/components/ui/badge.tsx` — текущая реализация уже корректна.

**Проверить** что `variant="ai"` используется в:
- AI Scoring page (заголовок "Da Vinci" или "AI") — сейчас `bg-purple-100 text-purple-700` hardcoded → заменить на `<Badge variant="ai">`
- AI Command Center — если есть AI-бейджи → заменить на `variant="ai"`
- Knowledge Base — если есть AI-related бейджи

**Не** менять бейджи в non-AI контексте (статусы сделок, тикетов и т.д.)

---

### Задача 10: Portal Chat Widget — glassmorphism

**Файл:** `src/components/portal-chat-widget.tsx`

#### 10.1 Основная панель чата
Если панель использует `bg-card` или подобное — добавить `glass-panel` класс.

#### 10.2 Заголовок чата (градиент уже есть)
Оставить как есть — `from-[hsl(var(--ai-from))] to-[hsl(var(--ai-to))]` уже применён.

---

### Задача 11: Budget Rolling Forecast

**Файл:** `src/components/budget-rolling-forecast.tsx`

#### 11.1 Кнопка с `ai-glow` (строка ~81)
Уже есть — оставить. Убедиться что hover-эффект работает после обновления `.ai-glow` в Задаче 1.

---

### Задача 12: Budgeting Page — AI-секции

**Файл:** `src/app/(dashboard)/budgeting/page.tsx`

#### 12.1 Карточки с `ai-accent` (строки ~1551, ~1871)
Заменить `ai-accent` на `ai-gradient-border` — там финансовые карточки, полный glassmorphism не нужен.

---

## Порядок выполнения

1. **Задача 1** — CSS (globals.css) — фундамент, без этого остальное не работает
2. **Задача 2** — AI Assistant Panel — самый заметный AI-элемент
3. **Задачи 3-4** — AI Scoring + Command Center — ключевые AI-страницы
4. **Задачи 5-7** — Компоненты (dashboard widget, profitability, agent builder)
5. **Задачи 8-12** — Остальные мелкие обновления
6. **Верификация**

---

## Файлы которые будут затронуты

| # | Файл | Что меняется |
|---|------|-------------|
| 1 | `src/app/globals.css` | Усилить `.ai-glow`, добавить `.ai-card`, `.ai-gradient-border`, `.ai-pulse-dot` |
| 2 | `src/components/ai-assistant-panel.tsx` | `glass-panel` + `ai-glow` на панель, пульсация FAB, фиолетовые сообщения |
| 3 | `src/app/(dashboard)/ai-scoring/page.tsx` | `ai-card` на заголовочную карточку |
| 4 | `src/app/(dashboard)/ai-command-center/page.tsx` | `ai-card` на главную, `ai-gradient-border` на инструменты |
| 5 | `src/components/dashboard/ai-lead-scoring.tsx` | `ai-accent` → `ai-card` |
| 6 | `src/components/profitability/ai-observations.tsx` | `ai-accent` → `ai-card`, добавить `ai-pulse-dot` |
| 7 | `src/components/ai/agent-builder.tsx` | `ai-accent` → `ai-card` |
| 8 | `src/components/lead-item-modal.tsx` | `ai-accent` → `ai-gradient-border` |
| 9 | `src/components/ui/badge.tsx` | Без изменений (проверить использование `variant="ai"`) |
| 10 | `src/components/portal-chat-widget.tsx` | Добавить `glass-panel` к панели чата |
| 11 | `src/components/budget-rolling-forecast.tsx` | Без изменений (проверить hover) |
| 12 | `src/app/(dashboard)/budgeting/page.tsx` | `ai-accent` → `ai-gradient-border` |

---

## Чего НЕ делать

- **НЕ** менять цветовые переменные `--ai-from`, `--ai-to` — они уже правильные
- **НЕ** добавлять glassmorphism на обычные (не-AI) карточки
- **НЕ** удалять существующие анимации (stagger, fade-in-up и т.д.)
- **НЕ** трогать wallpaper-режим (секция `html[data-wallpaper]` в globals.css)
- **НЕ** менять логику компонентов — только CSS-классы
- **НЕ** перемещать и удалять секции страниц (правило из CLAUDE.md)

---

## Верификация

1. `npm run build` — 0 ошибок
2. Dev server → проверить все 12 файлов визуально:
   - AI Assistant Panel (FAB пульсирует? Панель с blur? Сообщения с фиолетовым?)
   - AI Scoring (заголовочная карточка с blur + glow + фиолетовая граница?)
   - AI Command Center (главная карточка glassmorphism? Инструменты с gradient-border?)
   - Dashboard → AI Lead Scoring widget (glassmorphism карточка?)
   - Profitability → AI Observations (glassmorphism + pulse-dot?)
   - Budgeting → AI-секции (gradient-border?)
   - Lead modal → AI-секции (gradient-border?)
3. Dark mode — проверить что AI-элементы читаемы
4. Wallpaper mode — проверить что AI-элементы не конфликтуют с wallpaper стилями
5. Build + deploy: merge the reviewed branch to `main` and require a green
   `.github/workflows/deploy.yml` run (`scripts/deploy.sh` is retired)
6. Проверка на проде: `app.leaddrivecrm.org`
