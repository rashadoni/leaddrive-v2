"use client"

/**
 * Web-to-Lead — help article (Russian).
 * Охватывает только страницу Настройки → Web-to-Lead: конфигурацию формы
 * (slug организации, заголовок формы, текст кнопки, URL перенаправления,
 * бейджи полей), карточку API Endpoint, копирование кода для встраивания
 * и живой предпросмотр. Страница — это конструктор формы: ничего не
 * сохраняется, всё генерирует код в реальном времени.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function WebToLeadHelpRu() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Вы маркетолог или администратор операций"
        goal="Сгенерировать готовую форму обратной связи для вставки на свой сайт — чтобы при отправке формы посетителем в LeadDrive автоматически создавался лид"
      >
        На страницу вы попадаете через <HelpKey>Настройки</HelpKey> → <HelpKey>Web-to-Lead</HelpKey>. Эта
        страница — <strong>конструктор формы</strong>: вы меняете настройки слева, а код и предпросмотр справа
        обновляются мгновенно. Здесь ничего не сохраняется — вы копируете сгенерированный HTML и вставляете его
        на свой сайт, а лиды поступают прямо с формы вашего сайта в LeadDrive.
      </HelpScenario>

      <HelpSection title="Что есть на странице">
        <p>
          В заголовке — название <HelpKey>Web-to-Lead</HelpKey> со значком глобуса, ниже подпись «Настройка форм
          захвата лидов» и подсказка «Веб-формы, автоматически создающие лидов из посетителей сайта». Ниже
          страница делится на две колонки. В левой колонке две карточки: <strong>Form Configuration</strong>{" "}
          (настройки формы) и <strong>API Endpoint</strong>. В правой колонке тоже две карточки:{" "}
          <strong>Embed Code</strong> (код для встраивания) и <strong>Preview</strong> (живой предпросмотр).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Organization Slug">
            Короткое имя, которое сообщает форме, к какой организации относится лид. LeadDrive подставляет его
            из текущего tenant-а, когда вы вошли в систему; меняйте его только если поддержка попросила
            направить лиды в другой tenant.
          </HelpDef>
          <HelpDef term="Form Title">
            Заголовок, отображаемый в верхней части формы. По умолчанию <HelpKey>Contact Us</HelpKey>.
          </HelpDef>
          <HelpDef term="Submit Button Text">
            Текст на кнопке отправки. По умолчанию <HelpKey>Submit</HelpKey>.
          </HelpDef>
          <HelpDef term="Redirect URL (optional)">
            Необязательно — страница, на которую попадёт посетитель после успешной отправки (например, страница
            «спасибо»). Если оставить пустым, посетитель увидит уведомление с благодарностью.
          </HelpDef>
          <HelpDef term="Fields">
            Поля формы в виде бейджей: <strong>Name *</strong> и <strong>Email *</strong> присутствуют всегда
            (обязательные, отключить нельзя), а <strong>Phone</strong>, <strong>Company</strong> и{" "}
            <strong>Message</strong> добавляются и убираются кликом.
          </HelpDef>
          <HelpDef term="API Endpoint">
            Адрес, на который форма отправляет данные — <HelpKey>POST</HelpKey> на{" "}
            <code>/api/v1/public/leads</code>. CORS включён, лимит — 10 запросов в минуту с одного IP.
          </HelpDef>
          <HelpDef term="Embed Code">
            Полный автоматически сгенерированный код HTML + JavaScript. Код обновляется вживую при изменении
            настроек.
          </HelpDef>
          <HelpDef term="Preview">
            Живой предпросмотр того, как форма выглядит на самом деле (не код) — все поля отключены (disabled),
            это только для демонстрации.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Шаг за шагом: настройте форму">
        <HelpStep n={1}>
          <p>
            В карточке <strong>Form Configuration</strong> слева вверху проверьте поле{" "}
            <HelpKey>Organization Slug</HelpKey>. Оно должно уже показывать slug текущего tenant-а.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            По мере ввода значение <code>org_slug</code> внутри <strong>Embed Code</strong> справа мгновенно
            меняется на введённый текст.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Введите заголовок в поле <HelpKey>Form Title</HelpKey> (например, «Свяжитесь с нами»), затем задайте
            подпись кнопки в поле <HelpKey>Submit Button Text</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Карточка <strong>Preview</strong> справа обновляет заголовок формы и текст кнопки в реальном времени
            по мере ввода; те же значения попадают в <strong>Embed Code</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            При желании введите полный адрес в поле <HelpKey>Redirect URL (optional)</HelpKey> (например,{" "}
            <HelpKey>https://yoursite.com/thank-you</HelpKey>). Если оставить пустым, посетитель увидит
            уведомление с благодарностью.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Принимается только адрес, начинающийся с <code>http://</code> или <code>https://</code> — при
            корректном URL часть кода, отвечающая за отправку, переключается на строку перенаправления, иначе
            остаётся строка с уведомлением-благодарностью.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            В разделе <HelpKey>Fields</HelpKey> кликайте по бейджам, чтобы включать и выключать необязательные
            поля: <HelpKey>Phone</HelpKey>, <HelpKey>Company</HelpKey>, <HelpKey>Message</HelpKey>. (Бейджи{" "}
            <strong>Name *</strong> и <strong>Email *</strong> всегда включены и не переключаются.)
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Активный бейдж залит (стиль по умолчанию), выключенный — только с контуром (outline). Под ними
            подсказка «Click badges to toggle optional fields». Отключённое поле сразу исчезает и из{" "}
            <strong>Preview</strong>, и из <strong>Embed Code</strong>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Шаг за шагом: скопируйте код и вставьте на сайт">
        <HelpStep n={1}>
          <p>
            В карточке <strong>Embed Code</strong> справа вверху проверьте, что настройки выглядят правильно —
            карточка отмечена значком кода и показывает весь HTML + JavaScript.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Блок кода начинается с комментария «&lt;!-- LeadDrive Web-to-Lead Form --&gt;» и содержит форму,
            выбранные вами поля и скрипт отправки. Он обновляется мгновенно при изменении настроек слева.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Нажмите кнопку <HelpKey>Copy</HelpKey> в правом верхнем углу карточки.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Кнопка ненадолго переключается на <HelpKey>Copied!</HelpKey> (со значком галочки), затем примерно
            через две секунды возвращается к <HelpKey>Copy</HelpKey>. Код скопирован в буфер обмена.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Вставьте скопированный код в HTML своего сайта в том месте, где должна появиться форма.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Форма на сайте выглядит так же, как в <strong>Preview</strong>. Когда посетитель заполнит её и
            отправит, данные будут отправлены методом POST на адрес из карточки <strong>API Endpoint</strong>, и
            в LeadDrive создастся новый лид.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Эта страница ничего не сохраняет — она только генерирует код. Если вы измените конфигурацию и снова
          нажмёте <HelpKey>Copy</HelpKey>, придётся заменить старый код на сайте новым. Сначала настройте
          заголовок, текст кнопки и поля, а затем скопируйте всё за один раз.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Перед копированием кода убедитесь, что <HelpKey>Organization Slug</HelpKey> соответствует вашей
          организации. Кроме того,{" "}
          <strong>API Endpoint</strong> принимает не более <strong>10 запросов в минуту с одного IP</strong>;
          учитывайте этот лимит на страницах с высоким трафиком.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Эндпоинт публичный (<HelpKey>POST /api/v1/public/leads</HelpKey>), и CORS включён, чтобы форма работала
          с любого сайта — но для ограничения злоупотреблений действует лимит 10 запросов в минуту с одного IP.
          Заголовок формы, текст кнопки и slug безопасно экранируются (HTML-escape) при генерации кода, а URL
          перенаправления допускает только протоколы <code>http/https</code> — это предотвращает инъекцию кода.
        </p>
      </HelpCallout>
    </div>
  )
}
