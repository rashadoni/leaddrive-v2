# Подтверждения из одноразового hosted стенда

Данные на снимках вымышленные. Это не production-сессии и не публичный staging.
Финальный источник PR#1032 —39ec68f1d0f7b640e8437d57b74ad7f5c3f06c27,
проверенный merge —50f205317e4d7d4ea155a786586f01c181ed7d60.

- [result.json](result.json): исходная санитарная квитанция15/15PASS.
- [source-checks.json](source-checks.json): все5 обязательных source contexts
  и дополнительный browser stand SUCCESS; Booking PostgreSQL27/27PASS,
  действующие unit/type baseline сохранены без новых отклонений.
- [artifact-metadata.json](artifact-metadata.json): run/job/artifact, проверенный
  ZIP SHA256 и файлы;16 source hashes независимо сверены с Git и рабочими файлами.
- [workflow-context.json](workflow-context.json): исходный PREPARING-контекст;
  самостоятельно не является итоговым результатом. Итог находится в result.json.
- [coordinator-calendar.png](coordinator-calendar.png): native Chromium1440×1000,
  календарь координатора с2встречами26октября2026 при доступной команде.
- [employee-task-link.png](employee-task-link.png): карточка связанной задачи
  сотрудника с настоящим Open meeting. Последующий реальный click успешно
  вернулся к точной встрече, что подтверждено отдельным case в result.json.

[Run40175047313](https://github.com/rashadoni/leaddrive-v2/actions/runs/40175047313)
завершён SUCCESS. БД/приложение уничтожены после job; артефакт GitHub истекает
8ноября2026. Здесь сохранены малые санитарные JSON/PNG, без signed download URL,
паролей, cookies, auth tokens, storageState или raw app logs. Снимки просмотрены.

Первый run40173681459 был FAIL, а не PASS:8 начальных cases прошли, но возврат
из задачи перехватил onboarding overlay. История, фактический первоначальный
артефакт и исправления сохранены в append-only session log. Финальная версия
отдельно учитывает обычные UI recents/CSP запросы; неожиданного traffic0,
бизнес-таблицы неизменны. toursDismissed0 означает, что Escape handler в финальном
прогоне не понадобился и его срабатывание не доказано.

Scope,2P2 замечания и реальные build/DB warnings описаны в
[critical-audit.md](../critical-audit.md). Все NOT RUN там сохраняются: этот
артефакт не объявляет пройденной live production ролевую/crypto/provider приёмку.
