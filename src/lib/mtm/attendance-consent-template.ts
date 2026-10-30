/**
 * A first draft of the employees' agreement on the place of a mark (owner,
 * 2026-10-30: «поставь примерный текст … я покажу юристу»). It only fills an
 * empty editor; nothing is shown to employees until an administrator confirms
 * the lawyer's approval and switches on the double check. It says exactly what
 * the system does: the place at «start» and «finish» only, never on a break.
 * Bracketed parts are for the organization to complete.
 */
const COMPANY = "{company}"

const TEMPLATE = {
  az: `Məkan məlumatlarının emalına razılıq

${COMPANY} iş vaxtının uçotu üçün LeadDrive Time tətbiqindən istifadə edir. Bu razılıq yalnız iş gününün başlanğıcı və sonu qeyd edilərkən telefonunuzun məkanına aiddir.

Nə toplanır: «İşə başladım» və «İşi bitirdim» düymələrini basdığınız anda telefonun koordinatları, onların dəqiqliyi, məkanın təyin olunduğu vaxt və məkanın saxta olub-olmaması əlaməti.

Nə toplanmır: tətbiq sizi gün ərzində izləmir. Fasilə zamanı məkan qeyd edilmir. Digər vaxtlarda məkan göndərilmir.

Nə üçün: işə gəlişinizi və çıxışınızı öz filialınızda qeyd etdiyinizi təsdiqləmək üçün. Filialın QR kodu oxunduqda telefonun məkanı həmin filialın yeri ilə müqayisə olunur.

Kim görür: kadrlar şöbəsi, sizin birbaşa rəhbəriniz və təşkilatın administratoru — yalnız iş vaxtının uçotu məqsədi ilə.

Saxlanma müddəti: [müddəti göstərin].

Razılıq verməsəniz: iş gününün başlanğıcını və sonunu yenə də qeyd edə bilərsiniz, vaxtınız saxlanılır. Lakin filial QR kodu ilə təsdiqlənməyəcək.

Razılığı istənilən vaxt tətbiqdə geri götürə bilərsiniz. Bundan sonra məkan göndərilmir; əvvəlki qeydlər saxlanılır.

Suallar üçün: [məsul şəxs, telefon və ya e-poçt].`,
  ru: `Согласие на обработку данных о местоположении

${COMPANY} ведёт учёт рабочего времени в приложении LeadDrive Time. Это согласие касается только местоположения вашего телефона в момент отметки начала и окончания рабочего дня.

Что собирается: в момент нажатия «Начал работу» и «Закончил работу» — координаты телефона, их точность, время определения места и признак подмены местоположения.

Что не собирается: приложение не следит за вами в течение дня. Во время перерыва место не записывается. В другое время место не передаётся.

Зачем: чтобы подтвердить, что вы отмечаете приход и уход в своём филиале. При сканировании QR-кода филиала место телефона сравнивается с местом этого филиала.

Кто видит: отдел кадров, ваш непосредственный руководитель и администратор организации — только для учёта рабочего времени.

Срок хранения: [укажите срок].

Если вы не дадите согласие: вы по-прежнему можете отмечать начало и конец дня, время сохраняется. Но филиал по QR-коду подтверждаться не будет.

Согласие можно отозвать в приложении в любой момент. После этого место не передаётся; прежние отметки сохраняются.

По вопросам: [ответственное лицо, телефон или e-mail].`,
  en: `Consent to processing of location data

${COMPANY} records working time in the LeadDrive Time app. This consent covers only your phone's location at the moment you mark the start and end of your working day.

What is collected: when you press "Start work" and "Finish work" — the phone's coordinates, their accuracy, the time the location was determined, and whether the location was faked.

What is not collected: the app does not track you during the day. No location is recorded during a break. No location is sent at any other time.

Why: to confirm that you mark your arrival and departure at your own branch. When the branch QR code is scanned, the phone's location is compared with that branch's location.

Who sees it: HR, your direct manager and the organization's administrator — only for recording working time.

Retention period: [state the period].

If you do not consent: you can still mark the start and end of your day, and your time is saved. But your branch will not be confirmed by the QR code.

You can withdraw consent in the app at any time. After that no location is sent; earlier marks are kept.

Questions: [responsible person, phone or e-mail].`,
} as const

const FALLBACK_COMPANY = { az: "[Şirkətin adı]", ru: "[Название компании]", en: "[Company name]" } as const

/** The draft in three languages, with the organization's name where it is known. */
export function attendanceConsentTemplate(organizationName?: string | null): { az: string; ru: string; en: string } {
  const name = organizationName?.trim()
  return {
    az: TEMPLATE.az.replace(COMPANY, name || FALLBACK_COMPANY.az),
    ru: TEMPLATE.ru.replace(COMPANY, name || FALLBACK_COMPANY.ru),
    en: TEMPLATE.en.replace(COMPANY, name || FALLBACK_COMPANY.en),
  }
}
