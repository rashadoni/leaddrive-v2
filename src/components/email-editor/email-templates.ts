/**
 * M1 Email Editor — Pre-built email template presets.
 *
 * Presets (6): welcome, newsletter, promo, followup, invitation, thankyou
 *
 * Each preset ships with:
 *   - Email-safe HTML with inline styles (renders in Gmail/Outlook/Apple Mail)
 *   - 600 px centered container — the standard email width
 *
 * The HTML is loaded into GrapesJS via editor.setComponents(preset.html).
 * After the user customises the template, GrapesJS exports:
 *   - getHtml() + getCss()  → stored in EmailTemplate.htmlBody
 *   - getProjectData()      → stored in EmailTemplate.designJson
 */

export interface EmailTemplatePreset {
  id: string
  name: string
  description: string
  emoji: string
  category: string
  html: string
}

// ─── Shared primitives ────────────────────────────────────────────────────────

const FONT = "Arial, Helvetica, sans-serif"
const BRAND = "#001E3C"
const ACCENT = "#2563EB"

const wrapper = (inner: string) => `
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F3F4F7;padding:24px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:8px;overflow:hidden;font-family:${FONT};">
      ${inner}
    </table>
  </td></tr>
</table>`.trim()

const header = (title: string, subtitle = "") => `
<tr>
  <td style="background:${BRAND};padding:36px 32px;text-align:center;">
    <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;line-height:1.3;">${title}</h1>
    ${subtitle ? `<p style="margin:8px 0 0;color:#94a3b8;font-size:15px;">${subtitle}</p>` : ""}
  </td>
</tr>`

const body = (paragraphs: string[]) => `
<tr>
  <td style="padding:32px;">
    ${paragraphs.map(p => `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">${p}</p>`).join("")}
  </td>
</tr>`

const button = (label: string, href = "#") => `
<tr>
  <td style="padding:0 32px 32px;text-align:center;">
    <a href="${href}" style="display:inline-block;background:${ACCENT};color:#ffffff;font-size:15px;font-weight:600;padding:14px 32px;border-radius:6px;text-decoration:none;">${label}</a>
  </td>
</tr>`

const divider = () => `
<tr><td style="padding:0 32px;"><hr style="border:none;border-top:1px solid #E5E7EB;margin:0;" /></td></tr>`

const footer = (company = "LeadDrive CRM") => `
<tr>
  <td style="background:#F9FAFB;padding:20px 32px;text-align:center;border-top:1px solid #E5E7EB;">
    <p style="margin:0;color:#9CA3AF;font-size:12px;">&copy; 2025 ${company}. Все права защищены.</p>
    <p style="margin:6px 0 0;color:#9CA3AF;font-size:12px;"><a href="#" style="color:#6B7280;text-decoration:underline;">Отписаться</a></p>
  </td>
</tr>`

const twoColumn = (left: string, right: string) => `
<tr>
  <td style="padding:32px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td width="48%" valign="top" style="padding-right:12px;">${left}</td>
        <td width="4%"></td>
        <td width="48%" valign="top" style="padding-left:12px;">${right}</td>
      </tr>
    </table>
  </td>
</tr>`

// ─── Presets ──────────────────────────────────────────────────────────────────

export const EMAIL_TEMPLATE_PRESETS: EmailTemplatePreset[] = [
  {
    id: "welcome",
    name: "Приветственное",
    description: "Для новых клиентов и партнёров",
    emoji: "👋",
    category: "general",
    html: wrapper(`
      ${header("Добро пожаловать!", "Мы рады видеть вас в нашей команде")}
      ${body([
        "Уважаемый {{client_name}},",
        "Благодарим вас за регистрацию. Ваш аккаунт успешно создан и готов к работе.",
        "Если у вас возникнут вопросы — наша команда всегда рядом.",
      ])}
      ${button("Начать работу", "#")}
      ${divider()}
      ${footer()}
    `),
  },

  {
    id: "newsletter",
    name: "Новостная рассылка",
    description: "Ежемесячный дайджест для базы контактов",
    emoji: "📰",
    category: "newsletter",
    html: wrapper(`
      ${header("Новости {{month}} {{year}}", "Главное за этот месяц")}
      ${twoColumn(
        `<h3 style="margin:0 0 8px;font-size:16px;color:#111827;">🚀 Новые функции</h3>
         <p style="margin:0;font-size:14px;color:#6B7280;line-height:1.5;">{{new_services}}</p>`,
        `<h3 style="margin:0 0 8px;font-size:16px;color:#111827;">📈 Улучшения</h3>
         <p style="margin:0;font-size:14px;color:#6B7280;line-height:1.5;">{{improvements}}</p>`,
      )}
      ${divider()}
      ${body(["{{upcoming}}"])}
      ${button("Подробнее на сайте", "#")}
      ${footer()}
    `),
  },

  {
    id: "promo",
    name: "Акция / Предложение",
    description: "Специальное предложение для клиентов",
    emoji: "🎯",
    category: "marketing",
    html: wrapper(`
      <tr>
        <td style="background:linear-gradient(135deg,#001E3C 0%,#2563EB 100%);padding:48px 32px;text-align:center;">
          <p style="margin:0 0 8px;color:#93C5FD;font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;">Специальное предложение</p>
          <h1 style="margin:0 0 12px;color:#ffffff;font-size:32px;font-weight:800;">Скидка 30%</h1>
          <p style="margin:0;color:#BFDBFE;font-size:16px;">Только до {{date}}</p>
        </td>
      </tr>
      ${body([
        "Уважаемый {{client_name}},",
        "Мы подготовили для вас эксклюзивное предложение. Воспользуйтесь им до конца месяца.",
        "Услуга: <strong>{{service}}</strong>",
      ])}
      ${button("Получить скидку", "#")}
      ${divider()}
      ${body(["<em style='font-size:13px;color:#9CA3AF;'>Предложение действительно до {{date}}. Не суммируется с другими акциями.</em>"])}
      ${footer()}
    `),
  },

  {
    id: "followup",
    name: "Follow-up",
    description: "Напоминание после встречи или звонка",
    emoji: "📞",
    category: "sales",
    html: wrapper(`
      ${header("Рады были пообщаться!")}
      ${body([
        "Уважаемый {{client_name}},",
        "Благодарим вас за время, которое вы уделили нашей встрече. Как мы и обсудили — вот следующие шаги:",
        "✅ {{service}}",
        "Если у вас появятся вопросы или понадобится дополнительная информация — просто ответьте на это письмо.",
      ])}
      ${button("Запланировать следующий звонок", "#")}
      ${divider()}
      ${footer()}
    `),
  },

  {
    id: "invitation",
    name: "Приглашение",
    description: "Приглашение на мероприятие или вебинар",
    emoji: "🎟",
    category: "events",
    html: wrapper(`
      <tr>
        <td style="background:#F0FDF4;padding:32px;text-align:center;border-bottom:3px solid #16A34A;">
          <p style="margin:0 0 4px;color:#16A34A;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Вы приглашены</p>
          <h1 style="margin:0;color:#111827;font-size:26px;font-weight:700;">{{service}}</h1>
          <p style="margin:12px 0 0;color:#6B7280;font-size:15px;">📅 {{date}} &nbsp;|&nbsp; {{upcoming}}</p>
        </td>
      </tr>
      ${body([
        "Уважаемый {{client_name}},",
        "Приглашаем вас принять участие в нашем мероприятии. Количество мест ограничено.",
      ])}
      ${button("Зарегистрироваться", "#")}
      ${divider()}
      ${footer()}
    `),
  },

  {
    id: "thankyou",
    name: "Благодарность",
    description: "После оплаты, завершения проекта или отзыва",
    emoji: "🙏",
    category: "general",
    html: wrapper(`
      <tr>
        <td style="padding:48px 32px;text-align:center;">
          <div style="font-size:56px;line-height:1;margin-bottom:16px;">🙏</div>
          <h1 style="margin:0 0 12px;color:#111827;font-size:26px;font-weight:700;">Спасибо, {{client_name}}!</h1>
          <p style="margin:0;color:#6B7280;font-size:16px;line-height:1.6;max-width:440px;margin:0 auto;">
            Ценим ваше доверие и сотрудничество. Рады работать с вами!
          </p>
        </td>
      </tr>
      ${divider()}
      ${body([
        "Если хотите оставить отзыв или поделиться опытом — будем очень рады.",
        "До скорой встречи! 👋",
      ])}
      ${button("Оставить отзыв", "#")}
      ${footer()}
    `),
  },
]

/**
 * Returns a preset by id, or undefined if not found.
 * Pure function — safe to call in tests without any DOM/browser context.
 */
export function getEmailTemplatePreset(id: string): EmailTemplatePreset | undefined {
  return EMAIL_TEMPLATE_PRESETS.find((p) => p.id === id)
}

/**
 * Validates that a preset HTML string contains the outer wrapper table.
 * Used in tests to verify templates are well-formed.
 */
export function isValidTemplateHtml(html: string): boolean {
  return (
    html.includes("<table") &&
    html.includes("</table>") &&
    html.includes("600")
  )
}
