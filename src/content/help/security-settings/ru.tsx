"use client"

/**
 * Security settings — help article (Russian).
 * Охватывает Настройки → Безопасность: 2FA через authenticator (TOTP),
 * SMS 2FA, Методы авторизации (переключатели Google/Microsoft OAuth),
 * Привязанные аккаунты (привязать/отвязать) и API-ключи.
 * Только реальный UI этой страницы.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SecuritySettingsHelpRu() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Вы пользователь или администратор, защищающий свой аккаунт и вход в организацию"
        goal="Настроить двухфакторную аутентификацию (authenticator или SMS), управлять способами входа, привязать соцаккаунты и создать API-ключи для интеграций"
      >
        На страницу вы попадаете через <HelpKey>Настройки</HelpKey> → <HelpKey>Безопасность</HelpKey>. Вверху —
        стрелка назад, иконка щита, заголовок <HelpKey>Безопасность</HelpKey> и подпись «Двухфакторная
        аутентификация, политика паролей и настройки безопасности». 2FA и привязанные аккаунты относятся к
        ВАШЕМУ аккаунту; методы авторизации и API-ключи действуют на уровне организации.
      </HelpScenario>

      <HelpSection title="Что есть на странице">
        <p>
          Сверху вниз страница состоит из нескольких разделов: карточка <strong>Authenticator 2FA</strong>,{" "}
          <strong>SMS двухфакторная аутентификация</strong>, <strong>Методы авторизации</strong>,{" "}
          <strong>Привязанные аккаунты</strong> и <strong>API Keys</strong>. У каждого раздела свой заголовок,
          иконка и краткое описание.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="2FA (двухфакторная аутентификация)">Второй шаг подтверждения в дополнение к паролю — одноразовый код из приложения-аутентификатора или из SMS.</HelpDef>
          <HelpDef term="Приложение-аутентификатор">Приложения вроде Google Authenticator, Authy, Microsoft Authenticator: сканируют QR-код и каждые 30 секунд генерируют 6-значный код.</HelpDef>
          <HelpDef term="Резервные коды">Одноразовые коды восстановления для входа, если вы потеряли приложение-аутентификатор; каждый код работает только один раз.</HelpDef>
          <HelpDef term="SMS 2FA">Настройка второго шага в виде SMS-кода на телефон вместо приложения-аутентификатора.</HelpDef>
          <HelpDef term="Метод авторизации">Способ входа, отображаемый на странице логина — Google OAuth и Microsoft OAuth можно включать и выключать.</HelpDef>
          <HelpDef term="Привязанный аккаунт">Аккаунт Google или Microsoft, подключённый к вашему аккаунту LeadDrive, чтобы входить через него.</HelpDef>
          <HelpDef term="API-ключ">Секретный ключ для программного доступа внешних систем к данным LeadDrive; у него есть права на чтение/запись (scopes) и срок действия.</HelpDef>
          <HelpDef term="Scope (право доступа)">Определяет, к каким модулям и на каком уровне может обращаться ключ (read = чтение, write = запись).</HelpDef>
        </dl>
        <p>
          На первой карточке — зелёная или оранжевая иконка щита, текст <strong>2FA Enabled</strong> /{" "}
          <strong>2FA Not Enabled</strong> и справа значок <strong>Активные</strong> / <strong>Неактивные</strong>.
          Ниже — блок «How it works» и, в зависимости от состояния 2FA, кнопка <HelpKey>Enable 2FA</HelpKey> или{" "}
          <HelpKey>Disable 2FA</HelpKey>.
        </p>
      </HelpSection>

      <HelpSection title="Пошагово: включить 2FA через authenticator">
        <HelpStep n={1}>
          <p>
            На карточке статуса вверху нажмите <HelpKey>Enable 2FA</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Кнопка ненадолго показывает спиннер, затем открывается карточка «Step 1: Scan QR Code» с большим
            изображением QR-кода внутри.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Откройте приложение-аутентификатор (Google Authenticator, Authy и т. д.) и отсканируйте этот
            QR-код. Если отсканировать не получается, введите ключ под QR вручную — его также можно скопировать
            иконкой копирования рядом.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Под надписью «Can't scan? Enter this key manually:» секретный ключ показан текстом. После нажатия
            кнопки копирования иконка ненадолго превращается в зелёную галочку.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            В поле под «Step 2: Enter verification code» введите 6-значный код из приложения, затем нажмите{" "}
            <HelpKey>Verify &amp; Enable</HelpKey>. (Передумали? <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Поле принимает только цифры и ограничено 6 символами. Кнопка <HelpKey>Verify &amp; Enable</HelpKey>{" "}
            неактивна, пока не введены 6 цифр. Если код неверный, под полем появляется красный текст ошибки.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Если код верный, открывается карточка «2FA Enabled Successfully!» с вашими резервными кодами.
            Сохраните их в надёжном месте — <HelpKey>Copy All Codes</HelpKey> копирует все сразу. По завершении
            нажмите <HelpKey>Done</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Жёлтый блок «Save your backup codes!» и коды, разложенные в две колонки. После <HelpKey>Done</HelpKey>{" "}
            вы вернётесь к карточке статуса; теперь щит зелёный, текст — <strong>2FA Enabled</strong>, а значок —{" "}
            <strong>Активные</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Резервные коды показываются на этом экране только один раз, и каждый код срабатывает лишь однажды.
            Если не скопировать и не сохранить их сейчас в надёжном месте, увидеть их снова позже не получится.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Пошагово: отключить 2FA через authenticator">
        <HelpStep n={1}>
          <p>
            Если 2FA включена, нажмите красную кнопку <HelpKey>Disable 2FA</HelpKey> на карточке статуса.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Откроется (красная) карточка «Disable 2FA» с запросом ввести текущий 6-значный код.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Введите текущий 6-значный код из приложения-аутентификатора и нажмите красную кнопку{" "}
            <HelpKey>Disable 2FA</HelpKey>. (Чтобы отменить, используйте <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Кнопка остаётся неактивной, пока не введены 6 цифр. После подтверждения вы вернётесь к карточке
            статуса; щит станет оранжевым, текст — <strong>2FA Not Enabled</strong>, а значок —{" "}
            <strong>Неактивные</strong>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Пошагово: настроить SMS 2FA">
        <HelpStep n={1}>
          <p>
            В разделе <strong>SMS двухфакторная аутентификация</strong> нажмите <HelpKey>Включить SMS 2FA</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            В заголовке карточки — иконка телефона, название «Подтвердить телефон через SMS» и значок статуса в
            углу (<strong>Не активно</strong> / <strong>Активно</strong>). По нажатию кнопки открывается поле
            номера телефона, рядом подсказка «Добавит шаг ввода SMS-кода после пароля при входе».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Введите номер в международном формате в поле <strong>Номер телефона</strong> (например,{" "}
            <HelpKey>+15551234567</HelpKey>) и нажмите <HelpKey>Отправить код</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Под полем — подсказка «Используйте международный формат». Если номер неверный, появляется красный
            текст ошибки. Когда код отправлен, вверху всплывает уведомление об отправке, и форма переходит к шагу
            ввода 6-значного кода.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Введите 6-значный код из SMS в поле <strong>6-значный код</strong> и нажмите{" "}
            <HelpKey>Подтвердить и включить</HelpKey>. (Чтобы вернуться, используйте <HelpKey>Назад</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Сверху показан номер, на который отправлен код. Поле принимает только цифры; кнопка неактивна, пока
            не введены 6 цифр. При успехе карточка переключается на зелёный блок «SMS 2FA включена», показывает
            маскированный номер, а значок — <strong>Активно</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Позже используйте <HelpKey>Отключить SMS 2FA</HelpKey>, чтобы выключить, или{" "}
            <HelpKey>Сменить телефон</HelpKey>, чтобы перейти на другой номер.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            <HelpKey>Сменить телефон</HelpKey> заново запускает поток «номер → код»; после отключения карточка
            возвращается в исходное состояние с кнопкой <HelpKey>Включить SMS 2FA</HelpKey>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Пошагово: управлять способами входа и привязать аккаунты">
        <HelpStep n={1}>
          <p>
            В разделе <strong>Методы авторизации</strong> нажмите переключатель на карточках Google OAuth и
            Microsoft OAuth, чтобы включить или выключить каждый способ на странице логина.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            На каждой карточке рядом с названием провайдера значок <strong>Настроено</strong> (зелёный) или{" "}
            <strong>Не настроено</strong> (красный). Если провайдер не настроен на сервере, переключатель
            неактивен, а ниже появляется жёлтое предупреждение («…не заданы в .env на сервере»).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            В разделе <strong>Привязанные аккаунты</strong> используйте <HelpKey>Link</HelpKey>, чтобы привязать
            свой аккаунт Google или Microsoft к аккаунту LeadDrive, и <HelpKey>Unlink</HelpKey>, чтобы отвязать.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Если аккаунт привязан, рядом с названием провайдера зелёный значок <strong>Connected</strong> и
            красная кнопка <HelpKey>Unlink</HelpKey>. Если не привязан — кнопка <HelpKey>Link</HelpKey>; по
            нажатию вас перенаправит на экран входа провайдера, а после возврата вы окажетесь на странице
            Безопасность.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Пошагово: создать и отозвать API-ключ">
        <HelpStep n={1}>
          <p>
            В разделе <strong>API Keys</strong> нажмите <HelpKey>New API Key</HelpKey> в правом верхнем углу.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Откроется форма с янтарной рамкой: поле <strong>Key Name</strong>, список <strong>Scopes</strong>{" "}
            (для каждого модуля отдельные кнопки <HelpKey>read</HelpKey> и <HelpKey>write</HelpKey>) и
            выпадающий список <strong>Expires in</strong>. Если ключей ещё нет и форма закрыта, вместо неё
            показано пустое состояние с пунктирной рамкой («No API keys yet…»).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Введите <strong>Key Name</strong> (например, «My Integration»), выберите права{" "}
            <HelpKey>read</HelpKey>/<HelpKey>write</HelpKey> для нужных модулей и задайте срок —{" "}
            <HelpKey>30 days</HelpKey>, <HelpKey>90 days</HelpKey>, <HelpKey>1 year</HelpKey> или{" "}
            <HelpKey>Never</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Рядом с заголовком Scopes — быстрые ссылки <HelpKey>Select all read</HelpKey> и{" "}
            <HelpKey>Clear</HelpKey>. Выбранная кнопка права подсвечивается. Если имя пустое или не выбрано ни
            одного права, кнопка <HelpKey>Generate Key</HelpKey> остаётся неактивной.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Нажмите <HelpKey>Generate Key</HelpKey> и сразу скопируйте показанный ключ.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            В зелёном блоке надпись «Key created! Copy it now — it won't be shown again.» и полный ключ;
            заберите его кнопкой копирования рядом. После <HelpKey>Done</HelpKey> новый ключ появится в списке
            ниже со значком <strong>Active</strong>, префиксом, числом scopes и сроком действия.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Чтобы отозвать ключ, нажмите красную иконку корзины в его строке списка.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Появится подтверждение «Revoke this API key? This cannot be undone.». После подтверждения значок
            ключа меняется с <strong>Active</strong> на <strong>Revoked</strong>, а карточка тускнеет.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Полный API-ключ показывается ТОЛЬКО в момент создания, один раз — после закрытия блока увидеть его
            снова нельзя. Если потеряли — отзовите ключ и создайте новый. Отзыв ключа отменить нельзя.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          При создании API-ключа выдавайте только действительно нужные права: для большинства интеграций
          достаточно <HelpKey>read</HelpKey>, а <HelpKey>write</HelpKey> добавляйте только если система должна
          менять данные. Установка срока (например, <HelpKey>90 days</HelpKey>) сужает окно риска, даже если
          ключ утечёт.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          2FA и привязанные аккаунты относятся к вашему личному аккаунту. <strong>Методы авторизации</strong>,
          напротив, действуют на уровне организации — отключив вход через Google/Microsoft, вы влияете на
          страницу логина всей организации. Google/Microsoft можно включить только после того, как на сервере
          настроены соответствующие переменные <code>.env</code> (CLIENT_ID / CLIENT_SECRET). API-ключи дают
          программный доступ к данным вашей организации — берегите их как пароль.
        </p>
      </HelpCallout>
    </div>
  )
}
