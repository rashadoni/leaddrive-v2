# Ticket Real-time Notifications — Task

## Цель
Когда создаётся новый тикет, все операторы должны мгновенно увидеть уведомление.

## Что нужно сделать

### 1. Badge на иконке тикетов в sidebar
- Красный кружок с числом новых тикетов
- Обновляется в реальном времени (polling каждые 10-15 секунд)
- Сбрасывается когда оператор открывает страницу тикетов

### 2. Звуковой сигнал
- Короткий notification sound при появлении нового тикета
- Файл: `/public/sounds/new-ticket.mp3`
- Воспроизводится через `new Audio().play()`
- Только если вкладка активна (не спамить если фоновая)

### 3. Toast popup (Sonner)
- Всплывающее уведомление справа внизу
- Текст: "Yeni tiket: {ticketNumber} — {subject}"
- Кликабельный — ведёт на страницу тикета
- Автоисчезает через 10 секунд
- Приоритет: critical = красный, high = оранжевый

### Техническая реализация

**Вариант A: Polling (простой)**
- Компонент `TicketNotifier` в layout.tsx
- `setInterval` каждые 10 секунд → `GET /api/v1/tickets/new-count`
- Сравнивает с предыдущим count → если больше → badge + звук + toast
- API endpoint возвращает `{ count, latestTicket }`

**Вариант B: Server-Sent Events (лучше)**
- Endpoint `GET /api/v1/tickets/stream` → SSE
- При создании тикета → push event через EventSource
- Мгновенная доставка без polling

**Рекомендация:** Начать с Polling (проще, работает везде), потом переключить на SSE.

### Файлы для изменения
- `src/components/ticket-notifier.tsx` — СОЗДАТЬ
- `src/app/(dashboard)/layout.tsx` — добавить TicketNotifier
- `src/components/sidebar.tsx` — badge на иконке tickets
- `src/app/api/v1/tickets/new-count/route.ts` — СОЗДАТЬ
- `public/sounds/new-ticket.mp3` — СОЗДАТЬ (короткий notification sound)

### Чеклист
- [ ] Polling endpoint для новых тикетов
- [ ] Badge на sidebar иконке тикетов
- [ ] Звуковой сигнал при новом тикете
- [ ] Toast popup с темой тикета
- [ ] Toast кликабельный → открывает тикет
- [ ] Разные цвета для разных приоритетов
