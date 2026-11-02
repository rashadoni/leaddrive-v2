# Критический аудит: переход из задачи во встречу

## Проверяемый объём

Остаточное I-02 после выпуска единого раздела встреч: обычная карточка/форма
задачи не объясняла, почему связанную задачу нельзя менять, и не давала перехода
к источнику. Этот проход исправляет TaskDetailView, TaskForm и индивидуальные
PATCH/DELETE `/api/v1/tasks/:id`. Остальные пункты предыдущего аудита и bulk/voice
обработка ошибок не объявляются закрытыми этим изменением.

Сотрудник видит предупреждение и «Открыть встречу», если Booking API подтверждает
доступ. Task read/write само по себе не даёт ссылку на чужую встречу. При закрытом
доступе после конфликта показывается совет обратиться к координатору; ID встречи
не возвращается. Редактирование не закрывается после409. Подтверждённая Booking
и её защита в PostgreSQL остаются источником истины.

## Критический проход

- Сохранён существующий порядок command validation/board/field403 перед
  классификацией ошибки PATCH. Начальный preflight до этих проверок убран после
  аудита; отказ в правах не превращается в подсказку о связи встречи.
- Отдельный lookup защищён `withRlsAuth(bookings,read)` и свежим BookingAccess:
  org + own/team, без API-key impersonation/wildcard viewers. DTO содержит
  только booking ID, private/no-store; клиент не конструирует внешний URL.
- Смена пользователя/организации/задачи скрывает прежнюю ссылку; старый
  abort-ответ не переносится в новый контекст. После конфликта lookup повторяется;
  сетевой503 имеет локальный retry, без повторения операции изменения задачи.
- Не снимаются DB guard, RLS и ограничения прямых task writers. Нет migrations,
  новых grants, преобразования Booking/Task или Google/provider writes.
- Имеющийся частичный unique index(organizationId,taskId) ограничивает lookup;
  запрос читает только ID и не загружает контакты/историю/secret capabilities.

В исходнике после этого прохода новых P0/P1 не найдено. Допуск к выпуску зависит
от обязательного CI, реального PostgreSQL27-case gate и full hosted build;
локальные результаты ниже не заменяют эти допуски.

## Проверки на текущем кандидате

- Узкие API/UI114/114 PASS: обычные задачи, managed conflict, сохранение403,
  own/team/revocation/tenant predicates, отсутствие ID для недоступного scope,
  смена пользователя, новый link после конфликта, сетевой retry.
- Новые/узкие файлы ESLint PASS; старые TaskForm/TaskDetail содержат14 прежних
  ошибок any и5 предупреждений. Сравнение diagnostics по rule/message/source
  line с origin/main:0 добавленных; правила и baseline не ослаблялись.
- AZ/RU/EN `npm run i18n:check` PASS,28635 leaf keys.
- Настоящий TaskForm browser fixture PASS1440/390, dark,44px/focus, exact href,
  сохранение формы при409, закрытие при переходе, denied ID absent,503retry.
  Снимки/результат: `booking-task-navigation/evidence/`. Это синтетические данные.
- Actual PostgreSQL расширен26→27: реальный scoped lookup с отзывом назначения,
  cross-tenant/viewer отказ, PATCH/DELETE409 и неизменённая защищённая задача.
  **NOT RUN локально:** host policy; required hosted gate ещё предстоит.
- **NOT RUN локально:** full build/full typecheck/full app E2E — запрещены на
  постоянном dev Contabo. Hosted compiler/build gates обязательны; production
  role sessions/live OAuth/customer/provider sends, full axe/contrast/load/DR
  также не выполнялись в этом узком проходе.

## Остаточные границы

Этот UX не делает связанную Task независимо редактируемой и не даёт права
координации. Bulk/voice/нестандартные writers по-прежнему защищены DB, но не
получают новый UX этой карточки. Прочие I-03/I-04/I-06/I-12/I-13 предыдущего
аудита остаются отдельными задачами. Отсутствие live role browser-сессии явно
сохранено: проверенный fixture не называется production-скриншотом.
