"use client"

/**
 * Tasks — справка по задачам (русский).
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function TasksHelpRu() {
  return (
    <div className="space-y-6">
      <HelpSection title="Что здесь можно делать">
        <p>
          Раздел Задачи — это место где вы держите <strong>всё что должны</strong>: звонки,
          письма, документы. Кроме обычных to-do, тут есть две мощные фичи:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Повторяющиеся серии</strong> — авто-создание следующей задачи каждые N дней/недель/месяцев.</li>
          <li><strong>Шаблоны</strong> — сохранил чеклист один раз, применил к каждой новой сделке.</li>
        </ul>
      </HelpSection>

      <HelpSection title="Создать одну задачу">
        <HelpStep n={1}>
          <p>Жмите <HelpKey>New Task</HelpKey> вверху страницы.</p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Заполните название, при желании привяжите к сделке / контакту / компании,
            поставьте срок, приоритет и исполнителя.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Сохраните. Задача появится в списке со статусом <strong>Pending (Ожидание)</strong>.
            Перевести в <em>Completed</em> — галочкой или с детальной страницы.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Повторяющиеся серии (авто-фолоуап)">
        <p>
          Для задач которые делаете еженедельно / ежемесячно / ежеквартально — настройте серию
          один раз, дальше система сама создаёт следующий экземпляр когда вы закрыли текущий.
        </p>
        <HelpStep n={1}>
          <p>На детальной странице задачи откройте панель <strong>Recurring</strong>.</p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Выберите правило. Поддерживаемые шорткаты: <em>daily</em>, <em>weekly</em>,{" "}
            <em>monthly</em>, <em>yearly</em>. Для произвольных интервалов —{" "}
            <code>every:N:day</code>, <code>every:N:week</code>, <code>every:N:month</code>{" "}
            (например <code>every:3:day</code> = каждые 3 дня). Monthly-правило сохраняет число
            месяца как у стартовой; 31 января → 28 февраля (clamped).
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Сохраните. Теперь закрытие задачи автоматически создаст следующую со сдвинутым сроком.
            Остановить серию — кнопка <HelpKey>Stop series</HelpKey>. Уже созданные задачи
            остаются, новые не появятся. Система очищает правило у parent И всех children
            атомарно, так что &laquo;stop&raquo; реально означает stop.
          </p>
        </HelpStep>
        <HelpCallout kind="tip" label="Совет">
          <p>
            Серии связаны через <em>recurrenceParentId</em>, так что видно каждый экземпляр
            который пришёл от оригинала. Удобно ловить устаревшие фолоуапы которые давно надо
            было отменить.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Шаблоны задач (сохранить часто создаваемую задачу)">
        <p>
          Когда одна и та же задача всплывает неделя за неделей —{" "}
          <em>&laquo;еженедельный статус-отчёт&raquo;</em>,{" "}
          <em>&laquo;welcome для нового клиента&raquo;</em>,{" "}
          <em>&laquo;подготовка к квартальному обзору&raquo;</em> — сохраните её как шаблон,
          создавайте экземпляр в один клик.
        </p>
        <HelpStep n={1}>
          <p>
            <HelpKey>Settings → Task Templates</HelpKey>. Жмите <HelpKey>New template</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Назовите шаблон, напишите заголовок задачи (поддерживаются плейсхолдеры:{" "}
            <code>{`{{date}}`}</code>, <code>{`{{user}}`}</code>, <code>{`{{month}}`}</code>,{" "}
            <code>{`{{week}}`}</code> — заполняются автоматом). Поставьте приоритет,{" "}
            опциональный <em>сдвиг срока</em> (например <em>+3 дня от создания</em>), исполнителя
            по умолчанию, и опциональный <strong>чеклист</strong> подпунктов.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Переключатель <em>Share with team</em> — если хотите чтобы коллеги тоже могли
            использовать шаблон (выключено по умолчанию — персональные шаблоны).
          </p>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Сохраните. На любой форме создания задачи жмите <HelpKey>From template</HelpKey>,
            выберите шаблон — задача создаётся с уже заполненными полями и чеклистом.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Статусы и жизненный цикл">
        <dl className="rounded-md border p-3">
          <HelpDef term="Pending">Статус по умолчанию. Фильтруется в тулбаре.</HelpDef>
          <HelpDef term="In progress">Поставьте когда начали работу. Видно менеджеру как &laquo;активная загрузка&raquo;.</HelpDef>
          <HelpDef term="Completed">Терминальный — блокирует задачу. Если задача в серии — триггер для создания следующей.</HelpDef>
          <HelpDef term="Cancelled">Терминальный — следующий экземпляр НЕ создастся, цепочка обрывается.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Советы">
        <HelpCallout kind="tip" label="Совет">
          <p>
            Сочетайте серии с шаблонами: сохраните шаблон &laquo;Quarterly Business Review&raquo;,
            затем поставьте <code>every:90:day</code> на первый экземпляр — каждые 90 дней
            получаете свежую задачу с заполненным чеклистом.
          </p>
        </HelpCallout>
        <HelpCallout kind="warning" label="Внимание">
          <p>
            Отмена задачи в серии (<em>Cancelled</em>) <strong>останавливает цепочку</strong> —
            следующих экземпляров НЕ будет. Если просто хотите пропустить один экземпляр —
            закройте его как <em>Completed</em>, тогда следующий создастся нормально.
          </p>
        </HelpCallout>
      </HelpSection>
    </div>
  )
}
