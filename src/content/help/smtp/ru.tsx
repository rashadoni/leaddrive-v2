"use client"

/**
 * SMTP Settings — help article (Russian).
 * Зеркало en.tsx: управляемая почта + пресеты + форма SMTP + App-пароль Gmail
 * + тестовое письмо. Только то, что подтверждается в page.tsx и
 * /api/v1/settings/smtp(/test).
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SmtpHelpRu() {
  return (
    <div className="space-y-6">
      <HelpSection title="Зачем это нужно">
        <p>
          LeadDrive уже отправляет почту за вас. Транзакционные письма —
          регистрация, сброс пароля, уведомления о тикетах — уходят
          централизованно от <strong>no-reply@mail.leaddrivecrm.org</strong> с
          именем вашей организации в заголовке From, а ответы клиентов
          автоматически становятся комментариями к тикетам.
        </p>
        <p>
          Форма SMTP на этой странице — это <strong>опциональный fallback</strong>:
          заполняйте её, только если хотите, чтобы исходящие письма уходили с
          вашего домена. Большинству организаций трогать её не нужно.
        </p>
      </HelpSection>

      <HelpSection title="Когда настраивать свой SMTP">
        <p>
          Подключайте сервер, только когда From должен выглядеть как ваш домен —
          например, чтобы клиенты видели <em>billing@yourcompany.com</em>, а не
          управляемый адрес. Если это не требование, оставьте форму пустой и
          пользуйтесь управляемой почтой.
        </p>
        <p>
          Бейдж <HelpKey>Configured</HelpKey> появляется рядом с заголовком, как
          только сохранены хост, логин и пароль, — так сразу видно, задействован
          ли ваш собственный сервер.
        </p>
      </HelpSection>

      <HelpSection title="Быстрые пресеты">
        <p>
          Четыре кнопки заполняют хост, порт и TLS для популярных провайдеров,
          чтобы вам осталось добавить только учётные данные:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Gmail">smtp.gmail.com · порт 587 · TLS вкл.</HelpDef>
          <HelpDef term="Yandex">smtp.yandex.ru · порт 465 · TLS вкл.</HelpDef>
          <HelpDef term="Mail.ru">smtp.mail.ru · порт 465 · TLS вкл.</HelpDef>
          <HelpDef term="Outlook">smtp.office365.com · порт 587 · TLS вкл.</HelpDef>
        </dl>
        <p>
          Пресет задаёт только сервер, порт и TLS — логин, пароль и данные From
          вы всё равно вводите сами.
        </p>
      </HelpSection>

      <HelpSection title="Заполните подключение">
        <dl className="rounded-md border p-3">
          <HelpDef term="SMTP Server">Адрес хоста, напр. smtp.gmail.com</HelpDef>
          <HelpDef term="Port">587 для TLS или 465 для SSL — 25 часто заблокирован</HelpDef>
          <HelpDef term="Use TLS">Да / Нет — обычно Да для порта 587</HelpDef>
          <HelpDef term="Login">Имя пользователя SMTP, обычно ваш email</HelpDef>
          <HelpDef term="Password">Пароль SMTP или пароль приложения</HelpDef>
          <HelpDef term="From Email">Адрес, который получатели видят как отправителя</HelpDef>
          <HelpDef term="From Name">Отображаемое имя для получателей</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            Выберите пресет или введите <HelpKey>SMTP Server</HelpKey> и{" "}
            <HelpKey>Port</HelpKey> вручную, затем задайте{" "}
            <HelpKey>Use TLS</HelpKey>. Порт 465 автоматически считается SSL;
            переключатель TLS относится к порту 587.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Введите <HelpKey>Login</HelpKey> и <HelpKey>Password</HelpKey>, затем{" "}
            <HelpKey>From Email</HelpKey> и <HelpKey>From Name</HelpKey>. Если
            оставить From Email пустым, подставится адрес логина.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Нажмите <HelpKey>Save Settings</HelpKey>. Кнопка остаётся
            неактивной, пока не заполнены сервер, логин и пароль.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Используете Gmail?</strong> Обычный пароль Gmail не подойдёт.
            Включите двухфакторную аутентификацию, создайте{" "}
            <strong>пароль приложения</strong> на{" "}
            <strong>myaccount.google.com/apppasswords</strong> (выберите
            &quot;Mail&quot;) и вставьте 16-значный код в поле пароля. Страница
            показывает это напоминание, как только в хосте появляется
            &quot;gmail&quot;.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Отправьте тестовое письмо">
        <HelpStep n={1}>
          <p>
            Сначала сохраните настройки — <HelpKey>Send Test Email</HelpKey>{" "}
            остаётся неактивной, пока подключение не настроено.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Введите любой адрес в <HelpKey>Test email address</HelpKey> и
            нажмите <HelpKey>Send Test Email</HelpKey>. LeadDrive откроет живое
            соединение с вашим сервером и отправит фирменное письмо-подтверждение
            с указанием сервера, отправителя и времени.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Если тест не прошёл, ошибка подскажет, что не так:{" "}
            <em>не удалось подключиться</em> (неверный хост или порт),{" "}
            <em>ошибка авторизации</em> (неверный логин или пароль),{" "}
            <em>таймаут подключения</em> (сервер не отвечает) или проблема{" "}
            <em>SSL-сертификата</em> (попробуйте отключить TLS). Исправьте
            указанное поле и сохраните заново.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Сохранение настроек SMTP требует права записи в раздел{" "}
          <strong>настроек</strong>, и всё ограничено вашей организацией. Пароль
          хранится на сервере и никогда не возвращается в браузер — он всегда
          загружается замаскированным как <code>••••••••</code>. Оставьте маску
          нетронутой при сохранении — прежний пароль сохранится; очистите её и
          введите новый, чтобы заменить. Эндпоинт теста также удаляет переносы
          строк из полей From, блокируя инъекцию заголовков письма.
        </p>
      </HelpCallout>
    </div>
  )
}
