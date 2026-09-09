"use client"

/**
 * Invoice Settings — help article (Russian).
 * Охватывает только Настройки → Настройки счетов: данные компании, значения
 * по умолчанию для счёта (префикс номера / условия оплаты / ставка налога /
 * валюта), банковские реквизиты, подписант + печать + подписант акта, текст
 * по умолчанию и шаблоны писем на трёх языках. Создание или отправка счёта
 * сюда НЕ входят — это только страница настроек.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function invoicesettingsHelpRu() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Вы администратор по финансам или операциям"
        goal="Один раз настроить реквизиты компании, банковские реквизиты, подпись/печать и шаблоны писем, которые автоматически попадают в каждый счёт"
      >
        На страницу попадаете через <HelpKey>Настройки</HelpKey> →{" "}
        <HelpKey>Настройки счетов</HelpKey>. Всё, что вы указываете здесь, относится только к вашей
        организации и применяется как <strong>значение по умолчанию</strong> к новым счетам — в
        каждом счёте это можно переопределить. Ничего не сохраняется автоматически: изменения нужно
        подтвердить кнопкой <HelpKey>Сохранить</HelpKey> в правом верхнем углу.
      </HelpScenario>

      <HelpSection title="Что на странице">
        <p>
          В шапке — иконка шестерёнки с заголовком <HelpKey>Настройки счетов</HelpKey>, описание
          «Параметры счетов, брендинг и реквизиты» и строка-подсказка ниже. Кнопка{" "}
          <HelpKey>Сохранить</HelpKey> находится справа вверху; результат сохранения (зелёное
          «Успешно сохранено» или красная ошибка) появляется рядом с ней. Ниже идут шесть карточек по
          порядку:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Company Information (Данные компании)">Реквизиты компании, отображаемые в счёте: название, адрес, VÖEN (ИНН), e-mail, телефон и URL логотипа. Могут отличаться от названия организации.</HelpDef>
          <HelpDef term="Default Settings (По умолчанию)">Значения по умолчанию для новых счетов: префикс номера, условия оплаты, ставка налога и валюта. Можно переопределить в каждом счёте.</HelpDef>
          <HelpDef term="Bank Details (Банковские реквизиты)">Банковские данные, отображаемые в счёте: название банка, код (MFO), SWIFT, номер счёта, VÖEN и корреспондентский счёт.</HelpDef>
          <HelpDef term="Signer & Stamp (Подписант и печать)">Имя/должность того, кто подписывает счёт, скан печати компании, а также отдельный подписант акта (Акт приёма-передачи) с именем, должностью и сканом подписи.</HelpDef>
          <HelpDef term="Default Text (Текст по умолчанию)">Стандартные условия (Terms &amp; Conditions) и текст нижнего колонтитула, включаемые в каждый счёт.</HelpDef>
          <HelpDef term="Email Templates (Шаблоны писем)">Текст письма при отправке счёта — отдельный шаблон на каждый язык (AZ / Русский / Английский): Приветствие, Основной текст, Закрытие и Примечание.</HelpDef>
        </dl>
        <p>
          При первом открытии страница показывает свёрнутую серую заглушку (скелет) — это загрузка
          ваших текущих настроек; через мгновение поля заполняются ранее сохранёнными значениями.
        </p>
      </HelpSection>

      <HelpSection title="Шаг за шагом: заполните данные компании">
        <HelpStep n={1}>
          <p>
            В первой карточке — <HelpKey>Company Information</HelpKey> — заполните поля{" "}
            <strong>Company Name</strong> (название) и <strong>Company Address</strong> (адрес).
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            В каждом поле есть пример (placeholder) — например «Your Company LLC» в поле названия и
            «123 Main St, Baku, Azerbaijan» в адресе. При вводе пример исчезает, виден ваш текст. Поле
            адреса многострочное.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Заполните парные поля ниже: <strong>VÖEN</strong> и <strong>E-poçt (E-mail)</strong>,
            затем <strong>Telefon (Телефон)</strong> и <strong>Logo URL</strong>.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Поля расположены в две колонки. Поле e-mail ожидает формат электронной почты. Под Logo URL
            подпись «Optional — displayed on invoice header» означает, что оно необязательно и
            отображается в шапке счёта.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Шаг за шагом: задайте значения по умолчанию">
        <HelpStep n={1}>
          <p>
            В карточке <HelpKey>Default Settings</HelpKey> введите в поле <strong>Number Prefix</strong>{" "}
            префикс номера счёта (например <HelpKey>INV-</HelpKey> или <HelpKey>KP-</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Под полем появляется подсказка «Prefix for invoice numbers, e.g. INV-001, KP-001» —
            префикс добавляется перед номером.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Выберите условия оплаты из выпадающего списка <strong>Default Payment Terms</strong>.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            В списке готовые варианты: <strong>Due on Receipt</strong> (по получении),{" "}
            <strong>Net 15</strong>, <strong>Net 30</strong>, <strong>Net 45</strong> и{" "}
            <strong>Net 60</strong> (количество дней). По умолчанию выбрано Net 30.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Введите ставку налога в процентах в поле <strong>Default Tax Rate</strong> и выберите
            валюту в выпадающем списке <strong>Default Currency</strong>.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Поле налога принимает только цифры, справа стоит знак <strong>%</strong>, а ниже подпись
            «Standard VAT rate in Azerbaijan is 18%». Каждая строка списка валют показывает код и
            символ валюты (например AZN ₼).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Шаг за шагом: заполните банковские реквизиты">
        <HelpStep n={1}>
          <p>
            В карточке <HelpKey>Bank Details</HelpKey> заполните парные поля:{" "}
            <strong>Bank adı (Название банка)</strong> и <strong>Kod (MFO)</strong>, затем{" "}
            <strong>SWIFT</strong> и <strong>Hesab nömrəsi (Номер счёта)</strong>, в конце{" "}
            <strong>VÖEN</strong> и <strong>Müxbir hesab (Корр. счёт)</strong>.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            В каждом поле есть пример — например «Example Bank ASC» для названия банка и IBAN-образец
            «AZ00AIIB00000000000000000000» для номера счёта. Эти данные отображаются в отправляемом
            счёте.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Шаг за шагом: задайте подписанта, печать и подписанта акта">
        <HelpStep n={1}>
          <p>
            В карточке <HelpKey>Signer &amp; Stamp</HelpKey> заполните <strong>Ad Soyad (ФИО)</strong>{" "}
            и <strong>Vəzifə (Должность)</strong> того, кто подписывает счёт.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Поля в две колонки; в качестве примера показаны «Yusif Rzayev» и «Director of LeadDrive
            Inc.».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            В <strong>Şirkət Möhürü / Печать компании (скан)</strong> нажмите на пунктирную область
            загрузки и выберите изображение печати (PNG, JPG — макс 2MB).
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Если печати ещё нет, отображается область загрузки с иконкой стрелки вверх и текстом «Möhür
            şəklini yükləyin». После выбора изображения белый фон убирается автоматически, слева
            появляется маленький предпросмотр, а справа — зелёное «✓ Möhür yüklənib» (печать загружена)
            и кнопка <HelpKey>Dəyişdir / Заменить</HelpKey>; × в углу предпросмотра удаляет изображение.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            В разделе <strong>Подписант акта (Акт приёма-передачи)</strong> ниже в той же карточке
            заполните <strong>ФИО</strong> и <strong>Должность</strong> подписанта акта и загрузите{" "}
            <strong>İmza / Подпись (скан)</strong>.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Этот раздел идёт после линии-разделителя. После загрузки подписи появляются предпросмотр,
            зелёное «✓ İmza yüklənib» (подпись загружена) и кнопка <HelpKey>Заменить</HelpKey>; эта
            подпись отдельна от печати и добавляется только в документ акта.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            При загрузке изображений печати и подписи белый/светлый фон вырезается и делается
            прозрачным автоматически, поэтому даже скан на обычной белой бумаге даёт хороший результат.
            Для самого чистого вида используйте PNG с прозрачным фоном.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Шаг за шагом: текст по умолчанию и шаблоны писем">
        <HelpStep n={1}>
          <p>
            В карточке <HelpKey>Default Text</HelpKey> заполните многострочные поля{" "}
            <strong>Default Terms &amp; Conditions</strong> (условия) и{" "}
            <strong>Default Footer Note</strong> (нижняя подпись).
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Оба поля многострочные и идут с примером текста («Payment is due within the specified
            terms…» и «Thank you for your business!»). Этот текст включается в каждый счёт.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Вверху карточки <HelpKey>Email Templates</HelpKey> выберите одну из вкладок языка:{" "}
            <HelpKey>Азербайджанский</HelpKey>, <HelpKey>Русский</HelpKey> или{" "}
            <HelpKey>Английский</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Выбранная вкладка подчёркнута бирюзовой линией. Поля ниже — <strong>Приветствие</strong>,{" "}
            <strong>Основной текст</strong>, <strong>Закрытие</strong>, <strong>Примечание</strong> —
            показывают только текст этого языка; при переключении вкладки виден текст соответствующего
            языка.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Для выбранного языка заполните <strong>Приветствие</strong>,{" "}
            <strong>Основной текст</strong>, <strong>Закрытие</strong> и <strong>Примечание</strong>. В
            тексте можно использовать переменные.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            В серой рамке внизу карточки перечислены доступные переменные:{" "}
            <HelpKey>{"{orgName}"}</HelpKey> — название компании,{" "}
            <HelpKey>{"{invoiceNumber}"}</HelpKey> — номер счёта, <HelpKey>{"{total}"}</HelpKey> —
            итоговая сумма, <HelpKey>{"{currency}"}</HelpKey> — валюта,{" "}
            <HelpKey>{"{dueDate}"}</HelpKey> — дата оплаты. При отправке эти переменные заменяются
            реальными значениями.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Если нужны шаблоны на всех трёх языках, переключайте вкладки по очереди и заполняйте их —
            введённый текст не теряется при переключении вкладок, всё сохраняется вместе.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            При переходе с одного языка на другой то, что вы ввели на предыдущем языке, сохраняется; оно
            снова появляется, когда вы вернётесь.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Шаг за шагом: сохраните изменения">
        <HelpStep n={1}>
          <p>
            Заполнив все карточки, нажмите кнопку <HelpKey>Сохранить</HelpKey> в правом верхнем углу.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Во время сохранения кнопка показывает вращающуюся иконку и временно отключается. При успехе
            рядом с кнопкой появляется зелёная галочка и <strong>Успешно сохранено</strong>; при
            ошибке — красная иконка и <strong>Ошибка сохранения</strong>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          Изменения на этой странице <strong>не сохраняются автоматически</strong>. Если вы изменили
          любое поле, но ушли со страницы, не нажав <HelpKey>Сохранить</HelpKey>, изменения теряются.
          Уходите только после появления зелёного сообщения «Успешно сохранено».
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Все настройки счетов ограничены вашей организацией — заданные здесь значения применяются
          только к счетам вашего тенанта и не видны другим организациям. При сохранении настройки
          обновляются только под идентификатором вашей организации.
        </p>
      </HelpCallout>
    </div>
  )
}
