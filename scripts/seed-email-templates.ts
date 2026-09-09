/**
 * Seed beautiful email templates in 3 languages (EN/RU/AZ)
 * 10 template types × 3 languages = 30 templates
 *
 * Usage: npx tsx scripts/seed-email-templates.ts
 */
import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"

let prisma!: PrismaClient

// ─── Unlayer Design Helpers ─────────────────────────────────────

let counter = 0
const uid = () => `u_${++counter}`

function makeDesign(rows: any[], bodyBg?: string): any {
  return {
    counters: { u_row: rows.length, u_column: rows.length, u_content_text: 1 },
    body: {
      id: "design-body",
      rows,
      values: {
        backgroundColor: bodyBg || "#f0f4f8",
        contentWidth: "600px",
        contentAlign: "center",
        fontFamily: { label: "Inter, Arial", value: "'Inter',arial,helvetica,sans-serif" },
        preheaderText: "",
        linkStyle: { body: true, linkColor: "#2563eb", linkHoverColor: "#1d4ed8", linkUnderline: true, linkHoverUnderline: true },
        _meta: { htmlID: "u_body", htmlClassNames: "u_body" },
      },
    },
    schemaVersion: 12,
  }
}

function textBlock(html: string, styles?: any): any {
  const id = uid()
  return {
    id,
    type: "text",
    values: {
      containerPadding: "16px 24px",
      anchor: "", fontSize: "15px", color: "#374151", textAlign: "left", lineHeight: "170%",
      linkStyle: { inherit: true, linkColor: "#2563eb", linkHoverColor: "#1d4ed8", linkUnderline: true, linkHoverUnderline: true },
      hideDesktop: false, displayCondition: null,
      _meta: { htmlID: `u_content_${id}`, htmlClassNames: `u_content_${id}` },
      selectable: true, draggable: true, duplicatable: true, deletable: true, hideable: true,
      text: html,
      ...styles,
    },
  }
}

function btnBlock(text: string, color: string, href?: string): any {
  const id = uid()
  return {
    id,
    type: "button",
    values: {
      containerPadding: "16px 24px",
      anchor: "",
      href: { name: "web", values: { href: href || "#", target: "_blank" } },
      buttonColors: { color: "#FFFFFF", backgroundColor: color, hoverColor: "#FFFFFF", hoverBackgroundColor: color },
      size: { autoWidth: false, width: "55%" },
      textAlign: "center", lineHeight: "130%", padding: "14px 28px",
      borderRadius: "8px",
      hideDesktop: false, displayCondition: null,
      _meta: { htmlID: `u_content_${id}`, htmlClassNames: `u_content_${id}` },
      selectable: true, draggable: true, duplicatable: true, deletable: true, hideable: true,
      text: `<span style="font-size: 15px; font-weight: 700; letter-spacing: 0.3px;">${text}</span>`,
      calculatedWidth: 300, calculatedHeight: 46,
    },
  }
}

function divider(): any {
  const id = uid()
  return {
    id,
    type: "divider",
    values: {
      containerPadding: "8px 24px",
      border: { borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "#e5e7eb" },
      width: "100%", textAlign: "center",
      hideDesktop: false, displayCondition: null,
      _meta: { htmlID: `u_content_${id}`, htmlClassNames: `u_content_${id}` },
      selectable: true, draggable: true, duplicatable: true, deletable: true, hideable: true,
    },
  }
}

function spacer(h: string = "20px"): any {
  const id = uid()
  return {
    id,
    type: "text",
    values: {
      containerPadding: "0px",
      text: `<div style="height:${h}"></div>`,
      hideDesktop: false, displayCondition: null,
      _meta: { htmlID: `u_content_${id}`, htmlClassNames: `u_content_${id}` },
      selectable: true, draggable: true, duplicatable: true, deletable: true, hideable: true,
    },
  }
}

function row(contents: any[], bg?: string): any {
  const id = uid()
  return {
    id,
    cells: [1],
    columns: [{
      id: `${id}_col`,
      contents,
      values: {
        _meta: { htmlID: `u_column_${id}`, htmlClassNames: `u_column_${id}` },
        border: {}, padding: "0px", backgroundColor: "",
      },
    }],
    values: {
      displayCondition: null, columns: false,
      backgroundColor: bg || "",
      columnsBackgroundColor: "#ffffff",
      backgroundImage: { url: "", fullWidth: true, repeat: "no-repeat", size: "custom", position: "center" },
      padding: "0px", anchor: "",
      hideDesktop: false,
      _meta: { htmlID: `u_row_${id}`, htmlClassNames: `u_row_${id}` },
      selectable: true, draggable: true, duplicatable: true, deletable: true, hideable: true,
    },
  }
}

// ─── Color Themes ───────────────────────────────────────────────

const themes = {
  blue:   { primary: "#2563eb", accent: "#1e40af", headerBg: "#eff6ff", headerColor: "#1e3a5f" },
  green:  { primary: "#16a34a", accent: "#15803d", headerBg: "#f0fdf4", headerColor: "#14532d" },
  purple: { primary: "#7c3aed", accent: "#6d28d9", headerBg: "#f5f3ff", headerColor: "#3b0764" },
  orange: { primary: "#ea580c", accent: "#c2410c", headerBg: "#fff7ed", headerColor: "#7c2d12" },
  teal:   { primary: "#0d9488", accent: "#0f766e", headerBg: "#f0fdfa", headerColor: "#134e4a" },
  rose:   { primary: "#e11d48", accent: "#be123c", headerBg: "#fff1f2", headerColor: "#881337" },
  indigo: { primary: "#4f46e5", accent: "#4338ca", headerBg: "#eef2ff", headerColor: "#312e81" },
  amber:  { primary: "#d97706", accent: "#b45309", headerBg: "#fffbeb", headerColor: "#78350f" },
  sky:    { primary: "#0284c7", accent: "#0369a1", headerBg: "#f0f9ff", headerColor: "#0c4a6e" },
  slate:  { primary: "#475569", accent: "#334155", headerBg: "#f8fafc", headerColor: "#0f172a" },
}

// ─── Template Definitions ───────────────────────────────────────

interface TemplateSet {
  type: string
  category: string
  theme: keyof typeof themes
  variants: {
    lang: string
    name: string
    subject: string
    variables: string[]
  }[]
  buildDesign: (t: typeof themes.blue, lang: string) => any
}

const templateSets: TemplateSet[] = [
  // 1. WELCOME
  {
    type: "welcome",
    category: "welcome",
    theme: "blue",
    variants: [
      { lang: "en", name: "Welcome Email", subject: "Welcome to {{company}}!", variables: ["client_name", "company"] },
      { lang: "ru", name: "Приветственное письмо", subject: "Добро пожаловать в {{company}}!", variables: ["client_name", "company"] },
      { lang: "az", name: "Xoş gəldiniz məktubu", subject: "{{company}}-ə xoş gəldiniz!", variables: ["client_name", "company"] },
    ],
    buildDesign: (t, lang) => {
      const copy = {
        en: {
          h1: "Welcome aboard, {{client_name}}! 🎉",
          p1: "We're thrilled to have you join <strong>{{company}}</strong>. Our team is dedicated to providing you with the best experience possible.",
          p2: "Here's what you can do next:",
          list: "<ul><li>Explore your personalized dashboard</li><li>Set up your profile and preferences</li><li>Connect with our support team anytime</li></ul>",
          btn: "Get Started",
          footer: "Questions? Simply reply to this email — we're always happy to help.",
        },
        ru: {
          h1: "Добро пожаловать, {{client_name}}! 🎉",
          p1: "Мы рады приветствовать вас в <strong>{{company}}</strong>. Наша команда готова обеспечить вам лучший опыт работы.",
          p2: "Вот что вы можете сделать:",
          list: "<ul><li>Изучите персонализированную панель управления</li><li>Настройте свой профиль и предпочтения</li><li>Свяжитесь с нашей командой поддержки</li></ul>",
          btn: "Начать работу",
          footer: "Есть вопросы? Просто ответьте на это письмо — мы всегда рады помочь.",
        },
        az: {
          h1: "Xoş gəldiniz, {{client_name}}! 🎉",
          p1: "<strong>{{company}}</strong> ailəsinə qoşulduğunuz üçün çox şadıq. Komandamız sizə ən yaxşı təcrübəni təmin etməyə hazırdır.",
          p2: "Bunları edə bilərsiniz:",
          list: "<ul><li>Fərdi idarəetmə panelini kəşf edin</li><li>Profilinizi və seçimlərinizi quraşdırın</li><li>Dəstək komandamızla əlaqə saxlayın</li></ul>",
          btn: "Başlayın",
          footer: "Suallarınız var? Bu məktuba cavab yazın — həmişə kömək etməyə hazırıq.",
        },
      }[lang]!
      return makeDesign([
        row([textBlock(`<h1 style="text-align:center;color:${t.headerColor};margin:0;font-size:28px;font-weight:800;">${copy.h1}</h1>`, { textAlign: "center", containerPadding: "40px 24px 8px" })], t.headerBg),
        row([textBlock(`<p style="text-align:center;color:#6b7280;font-size:16px;">${copy.p1}</p>`, { textAlign: "center" })], t.headerBg),
        row([spacer("24px")]),
        row([textBlock(`<p style="font-weight:600;color:#111827;">${copy.p2}</p>${copy.list}`)]),
        row([btnBlock(copy.btn, t.primary)]),
        row([divider()]),
        row([textBlock(`<p style="text-align:center;color:#9ca3af;font-size:13px;">${copy.footer}</p>`, { textAlign: "center", fontSize: "13px", color: "#9ca3af" })]),
      ])
    },
  },

  // 2. ONBOARDING
  {
    type: "onboarding",
    category: "onboarding",
    theme: "teal",
    variants: [
      { lang: "en", name: "Onboarding Guide", subject: "Getting started with {{company}}", variables: ["client_name", "company"] },
      { lang: "ru", name: "Руководство по началу работы", subject: "Начало работы с {{company}}", variables: ["client_name", "company"] },
      { lang: "az", name: "Başlanğıc bələdçisi", subject: "{{company}} ilə işə başlayın", variables: ["client_name", "company"] },
    ],
    buildDesign: (t, lang) => {
      const copy = {
        en: {
          h1: "Your Quick Start Guide",
          sub: "3 simple steps to get up and running",
          s1: "Step 1: Complete Your Profile",
          d1: "Fill in your company details, upload your logo, and configure your preferences.",
          s2: "Step 2: Invite Your Team",
          d2: "Add team members and assign roles. Collaborate efficiently from day one.",
          s3: "Step 3: Import Your Data",
          d3: "Easily import contacts, deals, and tasks from your existing tools.",
          btn: "Go to Dashboard",
          footer: "Need help? Our onboarding team is standing by.",
        },
        ru: {
          h1: "Краткое руководство",
          sub: "3 простых шага для начала работы",
          s1: "Шаг 1: Заполните профиль",
          d1: "Укажите данные компании, загрузите логотип и настройте предпочтения.",
          s2: "Шаг 2: Пригласите команду",
          d2: "Добавьте участников и назначьте роли. Начните совместную работу с первого дня.",
          s3: "Шаг 3: Импортируйте данные",
          d3: "Легко импортируйте контакты, сделки и задачи из ваших текущих инструментов.",
          btn: "Перейти в панель",
          footer: "Нужна помощь? Наша команда всегда на связи.",
        },
        az: {
          h1: "Sürətli Başlanğıc",
          sub: "İşə başlamaq üçün 3 sadə addım",
          s1: "Addım 1: Profilinizi tamamlayın",
          d1: "Şirkət məlumatlarınızı doldurun, loqonuzu yükləyin və seçimlərinizi konfiqurasiya edin.",
          s2: "Addım 2: Komandanızı dəvət edin",
          d2: "Komanda üzvlərini əlavə edin və rollar təyin edin. İlk gündən birlikdə işləyin.",
          s3: "Addım 3: Məlumatlarınızı idxal edin",
          d3: "Kontaktları, sövdələşmələri və tapşırıqları mövcud alətlərinizdən asanlıqla idxal edin.",
          btn: "İdarəetmə panelinə keç",
          footer: "Kömək lazımdır? Dəstək komandamız hazırdır.",
        },
      }[lang]!
      const stepHtml = (num: string, title: string, desc: string) =>
        `<div style="margin-bottom:16px;"><span style="display:inline-block;width:32px;height:32px;border-radius:50%;background:${t.primary};color:#fff;text-align:center;line-height:32px;font-weight:700;font-size:14px;margin-right:10px;">${num}</span><strong style="color:#111827;font-size:16px;">${title}</strong><p style="color:#6b7280;margin:6px 0 0 42px;">${desc}</p></div>`
      return makeDesign([
        row([
          textBlock(`<h1 style="text-align:center;color:${t.headerColor};font-size:26px;font-weight:800;margin:0;">${copy.h1}</h1><p style="text-align:center;color:#6b7280;font-size:15px;margin:8px 0 0;">${copy.sub}</p>`, { textAlign: "center", containerPadding: "36px 24px 16px" }),
        ], t.headerBg),
        row([spacer("16px")]),
        row([textBlock(stepHtml("1", copy.s1, copy.d1) + stepHtml("2", copy.s2, copy.d2) + stepHtml("3", copy.s3, copy.d3), { containerPadding: "16px 32px" })]),
        row([btnBlock(copy.btn, t.primary)]),
        row([divider()]),
        row([textBlock(`<p style="text-align:center;color:#9ca3af;font-size:13px;">${copy.footer}</p>`, { textAlign: "center", fontSize: "13px" })]),
      ])
    },
  },

  // 3. NEWSLETTER / CAMPAIGN
  {
    type: "newsletter",
    category: "marketing",
    theme: "indigo",
    variants: [
      { lang: "en", name: "Monthly Newsletter", subject: "{{company}} — What's New This Month", variables: ["company", "month", "year"] },
      { lang: "ru", name: "Ежемесячная рассылка", subject: "{{company}} — Новости месяца", variables: ["company", "month", "year"] },
      { lang: "az", name: "Aylıq xəbər bülleteni", subject: "{{company}} — Bu ayın yenilikləri", variables: ["company", "month", "year"] },
    ],
    buildDesign: (t, lang) => {
      const copy = {
        en: {
          h1: "{{company}} Newsletter",
          sub: "{{month}} {{year}}",
          s1: "📢 Latest Updates",
          d1: "Share your most important news, product launches, and company milestones with your audience.",
          s2: "💡 Tips & Best Practices",
          d2: "Provide valuable insights, tutorials, and actionable advice your readers can use right away.",
          s3: "📅 Upcoming Events",
          d3: "Highlight webinars, conferences, and meetups your audience won't want to miss.",
          btn: "Read More",
          footer: "You're receiving this because you subscribed to {{company}} updates.",
        },
        ru: {
          h1: "Рассылка {{company}}",
          sub: "{{month}} {{year}}",
          s1: "📢 Последние новости",
          d1: "Поделитесь самыми важными новостями, запусками продуктов и достижениями вашей компании.",
          s2: "💡 Советы и рекомендации",
          d2: "Предоставьте полезные инсайты, руководства и практические советы для ваших читателей.",
          s3: "📅 Предстоящие события",
          d3: "Расскажите о вебинарах, конференциях и встречах, которые нельзя пропустить.",
          btn: "Читать далее",
          footer: "Вы получили это письмо, потому что подписались на обновления {{company}}.",
        },
        az: {
          h1: "{{company}} Bülleteni",
          sub: "{{month}} {{year}}",
          s1: "📢 Son Yeniliklər",
          d1: "Ən vacib xəbərlərinizi, məhsul buraxılışlarınızı və şirkət nailiyyətlərinizi paylaşın.",
          s2: "💡 Məsləhətlər",
          d2: "Oxucularınız üçün faydalı məlumatlar, təlimatlar və praktik tövsiyələr təqdim edin.",
          s3: "📅 Gələcək Tədbirlər",
          d3: "Vebinarlar, konfranslar və görüşlər haqqında məlumat verin.",
          btn: "Ətraflı oxu",
          footer: "Bu məktubu {{company}} yeniliklərinə abunə olduğunuz üçün alırsınız.",
        },
      }[lang]!
      const section = (title: string, desc: string) =>
        `<h2 style="color:${t.headerColor};font-size:18px;margin:0 0 8px;font-weight:700;">${title}</h2><p style="color:#4b5563;">${desc}</p>`
      return makeDesign([
        row([textBlock(`<h1 style="text-align:center;color:#fff;font-size:28px;font-weight:800;margin:0;">${copy.h1}</h1><p style="text-align:center;color:rgba(255,255,255,0.8);font-size:15px;margin:8px 0 0;">${copy.sub}</p>`, { textAlign: "center", color: "#ffffff", containerPadding: "40px 24px 32px" })], t.primary),
        row([spacer("24px")]),
        row([textBlock(section(copy.s1, copy.d1))]),
        row([divider()]),
        row([textBlock(section(copy.s2, copy.d2))]),
        row([divider()]),
        row([textBlock(section(copy.s3, copy.d3))]),
        row([btnBlock(copy.btn, t.primary)]),
        row([divider()]),
        row([textBlock(`<p style="text-align:center;color:#9ca3af;font-size:12px;">${copy.footer}</p>`, { textAlign: "center", fontSize: "12px" })]),
      ])
    },
  },

  // 4. PROMOTION / SALE
  {
    type: "promotion",
    category: "marketing",
    theme: "rose",
    variants: [
      { lang: "en", name: "Special Offer", subject: "Exclusive offer just for you!", variables: ["client_name", "company"] },
      { lang: "ru", name: "Специальное предложение", subject: "Эксклюзивное предложение только для вас!", variables: ["client_name", "company"] },
      { lang: "az", name: "Xüsusi təklif", subject: "Yalnız sizin üçün eksklüziv təklif!", variables: ["client_name", "company"] },
    ],
    buildDesign: (t, lang) => {
      const copy = {
        en: {
          badge: "LIMITED TIME OFFER",
          h1: "Save up to 30%",
          sub: "on our premium solutions",
          p1: "Hi {{client_name}},",
          p2: "For a limited time, we're offering exclusive savings on our most popular services. This is the perfect opportunity to upgrade your experience with <strong>{{company}}</strong>.",
          highlight: "Use code <strong style=\"font-size:20px;letter-spacing:2px;\">SAVE30</strong> at checkout",
          btn: "Claim Your Discount",
          footer: "Offer valid until the end of the month. Cannot be combined with other promotions.",
        },
        ru: {
          badge: "ОГРАНИЧЕННОЕ ПРЕДЛОЖЕНИЕ",
          h1: "Скидка до 30%",
          sub: "на наши премиум-решения",
          p1: "Здравствуйте, {{client_name}},",
          p2: "Ограниченное время мы предлагаем эксклюзивные скидки на наши самые популярные услуги. Это отличная возможность улучшить ваш опыт работы с <strong>{{company}}</strong>.",
          highlight: "Используйте код <strong style=\"font-size:20px;letter-spacing:2px;\">SAVE30</strong> при оформлении",
          btn: "Получить скидку",
          footer: "Предложение действует до конца месяца. Не суммируется с другими акциями.",
        },
        az: {
          badge: "MÜDDƏTLİ TƏKLİF",
          h1: "30%-ə qədər endirim",
          sub: "premium həllərimizə",
          p1: "Salam {{client_name}},",
          p2: "Məhdud müddət ərzində ən populyar xidmətlərimizə eksklüziv endirimlər təklif edirik. <strong>{{company}}</strong> ilə təcrübənizi yaxşılaşdırmaq üçün əla fürsətdir.",
          highlight: "Ödəniş zamanı <strong style=\"font-size:20px;letter-spacing:2px;\">SAVE30</strong> kodunu istifadə edin",
          btn: "Endiriminizi alın",
          footer: "Təklif ayın sonuna qədər keçərlidir. Digər aksiyalarla birləşdirilə bilməz.",
        },
      }[lang]!
      return makeDesign([
        row([
          textBlock(`<p style="text-align:center;margin:0;"><span style="background:${t.primary};color:#fff;padding:6px 16px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:1.5px;">${copy.badge}</span></p>`, { textAlign: "center", containerPadding: "32px 24px 12px" }),
        ], t.headerBg),
        row([
          textBlock(`<h1 style="text-align:center;color:${t.primary};font-size:36px;font-weight:900;margin:0;">${copy.h1}</h1><p style="text-align:center;color:#6b7280;font-size:18px;margin:4px 0 0;">${copy.sub}</p>`, { textAlign: "center" }),
        ], t.headerBg),
        row([spacer("16px")]),
        row([textBlock(`<p>${copy.p1}</p><p>${copy.p2}</p>`)]),
        row([
          textBlock(`<div style="text-align:center;background:${t.headerBg};border:2px dashed ${t.primary};border-radius:12px;padding:20px;">${copy.highlight}</div>`, { textAlign: "center", containerPadding: "8px 32px" }),
        ]),
        row([btnBlock(copy.btn, t.primary)]),
        row([divider()]),
        row([textBlock(`<p style="text-align:center;color:#9ca3af;font-size:12px;">${copy.footer}</p>`, { textAlign: "center", fontSize: "12px" })]),
      ])
    },
  },

  // 5. PROPOSAL / OFFER
  {
    type: "proposal",
    category: "proposal",
    theme: "slate",
    variants: [
      { lang: "en", name: "Business Proposal", subject: "Proposal for {{company}}", variables: ["client_name", "company", "service", "date"] },
      { lang: "ru", name: "Коммерческое предложение", subject: "Предложение для {{company}}", variables: ["client_name", "company", "service", "date"] },
      { lang: "az", name: "Kommersiya təklifi", subject: "{{company}} üçün təklif", variables: ["client_name", "company", "service", "date"] },
    ],
    buildDesign: (t, lang) => {
      const copy = {
        en: {
          h1: "Business Proposal",
          sub: "Prepared for {{company}} · {{date}}",
          greeting: "Dear {{client_name}},",
          p1: "Thank you for the opportunity to present our <strong>{{service}}</strong> solution. We've carefully analyzed your requirements and prepared a tailored proposal.",
          s1: "Scope of Work",
          d1: "Describe deliverables, milestones, timeline, and team allocation. This section should clearly outline what the client will receive.",
          s2: "Investment",
          d2: "Present pricing tiers, payment terms, and any applicable discounts. Be transparent about what's included.",
          s3: "Timeline",
          d3: "Outline key milestones, expected delivery dates, and review checkpoints throughout the project.",
          btn: "Accept Proposal",
          footer: "This proposal is valid for 30 days from {{date}}. For questions, reply directly to this email.",
        },
        ru: {
          h1: "Коммерческое предложение",
          sub: "Подготовлено для {{company}} · {{date}}",
          greeting: "Уважаемый(-ая) {{client_name}},",
          p1: "Благодарим за возможность представить наше решение <strong>{{service}}</strong>. Мы тщательно проанализировали ваши требования и подготовили персональное предложение.",
          s1: "Объём работ",
          d1: "Опишите результаты, этапы, сроки и состав команды. Клиент должен чётко понимать, что он получит.",
          s2: "Стоимость",
          d2: "Укажите тарифы, условия оплаты и возможные скидки. Будьте прозрачны в том, что включено.",
          s3: "Сроки",
          d3: "Перечислите ключевые вехи, даты доставки и контрольные точки на протяжении проекта.",
          btn: "Принять предложение",
          footer: "Предложение действительно 30 дней с {{date}}. По вопросам — ответьте на это письмо.",
        },
        az: {
          h1: "Kommersiya Təklifi",
          sub: "{{company}} üçün hazırlanıb · {{date}}",
          greeting: "Hörmətli {{client_name}},",
          p1: "<strong>{{service}}</strong> həllimizi təqdim etmək imkanı üçün təşəkkür edirik. Tələblərinizi diqqətlə təhlil edərək fərdi təklif hazırladıq.",
          s1: "İş həcmi",
          d1: "Nəticələri, mərhələləri, vaxt cədvəlini və komanda tərkibini təsvir edin. Müştəri nə alacağını aydın başa düşməlidir.",
          s2: "İnvestisiya",
          d2: "Qiymət paketlərini, ödəniş şərtlərini və mümkün endirimləri təqdim edin.",
          s3: "Vaxt cədvəli",
          d3: "Əsas mərhələləri, gözlənilən tarixləri və nəzarət nöqtələrini göstərin.",
          btn: "Təklifi qəbul edin",
          footer: "Bu təklif {{date}} tarixindən 30 gün ərzində keçərlidir. Suallar üçün bu məktuba cavab yazın.",
        },
      }[lang]!
      const section = (title: string, desc: string) =>
        `<h3 style="color:${t.headerColor};font-size:16px;margin:0 0 6px;border-left:3px solid ${t.primary};padding-left:12px;">${title}</h3><p style="color:#4b5563;margin:0 0 4px;">${desc}</p>`
      return makeDesign([
        row([textBlock(`<h1 style="text-align:center;color:#fff;font-size:26px;font-weight:800;margin:0;">${copy.h1}</h1><p style="text-align:center;color:rgba(255,255,255,0.75);font-size:14px;margin:8px 0 0;">${copy.sub}</p>`, { textAlign: "center", color: "#fff", containerPadding: "36px 24px 28px" })], t.accent),
        row([spacer("20px")]),
        row([textBlock(`<p>${copy.greeting}</p><p>${copy.p1}</p>`)]),
        row([divider()]),
        row([textBlock(section(copy.s1, copy.d1), { containerPadding: "12px 24px" })]),
        row([textBlock(section(copy.s2, copy.d2), { containerPadding: "12px 24px" })]),
        row([textBlock(section(copy.s3, copy.d3), { containerPadding: "12px 24px" })]),
        row([divider()]),
        row([btnBlock(copy.btn, "#16a34a")]),
        row([textBlock(`<p style="text-align:center;color:#9ca3af;font-size:12px;">${copy.footer}</p>`, { textAlign: "center", fontSize: "12px" })]),
      ])
    },
  },

  // 6. EVENT INVITATION
  {
    type: "event-invitation",
    category: "general",
    theme: "purple",
    variants: [
      { lang: "en", name: "Event Invitation", subject: "You're invited! Join us for a special event", variables: ["client_name", "company", "date"] },
      { lang: "ru", name: "Приглашение на мероприятие", subject: "Приглашаем! Присоединяйтесь к нашему мероприятию", variables: ["client_name", "company", "date"] },
      { lang: "az", name: "Tədbirə dəvət", subject: "Dəvətlisiniz! Xüsusi tədbirimizə qoşulun", variables: ["client_name", "company", "date"] },
    ],
    buildDesign: (t, lang) => {
      const copy = {
        en: {
          badge: "YOU'RE INVITED",
          h1: "Join Our Exclusive Event",
          date: "📅 {{date}}",
          greeting: "Hi {{client_name}},",
          p1: "We're excited to invite you to an exclusive event hosted by <strong>{{company}}</strong>. Connect with industry leaders, discover new insights, and expand your network.",
          s1: "🎤 Expert Speakers",
          s2: "🤝 Networking Opportunities",
          s3: "🎁 Exclusive Resources",
          btn: "Register Now",
          footer: "Spots are limited — reserve yours today!",
        },
        ru: {
          badge: "ВЫ ПРИГЛАШЕНЫ",
          h1: "Эксклюзивное мероприятие",
          date: "📅 {{date}}",
          greeting: "Здравствуйте, {{client_name}},",
          p1: "Приглашаем вас на эксклюзивное мероприятие от <strong>{{company}}</strong>. Познакомьтесь с лидерами индустрии, откройте новые идеи и расширьте деловые связи.",
          s1: "🎤 Экспертные спикеры",
          s2: "🤝 Нетворкинг",
          s3: "🎁 Эксклюзивные материалы",
          btn: "Зарегистрироваться",
          footer: "Количество мест ограничено — забронируйте своё сегодня!",
        },
        az: {
          badge: "DƏVƏTLİSİNİZ",
          h1: "Eksklüziv Tədbirimizə Qoşulun",
          date: "📅 {{date}}",
          greeting: "Salam {{client_name}},",
          p1: "<strong>{{company}}</strong> tərəfindən keçirilən eksklüziv tədbirə sizi dəvət edirik. Sənaye liderləri ilə tanış olun, yeni biliklər əldə edin.",
          s1: "🎤 Ekspert Spikerlər",
          s2: "🤝 Şəbəkələşmə İmkanları",
          s3: "🎁 Eksklüziv Resurslar",
          btn: "Qeydiyyatdan keçin",
          footer: "Yerlər məhduddur — bu gün rezerv edin!",
        },
      }[lang]!
      const feature = (text: string) => `<div style="background:${t.headerBg};border-radius:8px;padding:12px 16px;margin-bottom:8px;font-weight:600;color:${t.headerColor};">${text}</div>`
      return makeDesign([
        row([
          textBlock(`<p style="text-align:center;margin:0;"><span style="background:${t.primary};color:#fff;padding:6px 20px;border-radius:20px;font-size:11px;font-weight:800;letter-spacing:2px;">${copy.badge}</span></p>`, { textAlign: "center", containerPadding: "36px 24px 16px" }),
        ], t.headerBg),
        row([
          textBlock(`<h1 style="text-align:center;color:${t.headerColor};font-size:28px;font-weight:800;margin:0;">${copy.h1}</h1><p style="text-align:center;color:${t.primary};font-size:18px;font-weight:600;margin:12px 0 0;">${copy.date}</p>`, { textAlign: "center", containerPadding: "0 24px 28px" }),
        ], t.headerBg),
        row([textBlock(`<p>${copy.greeting}</p><p>${copy.p1}</p>`)]),
        row([textBlock(feature(copy.s1) + feature(copy.s2) + feature(copy.s3), { containerPadding: "8px 32px" })]),
        row([btnBlock(copy.btn, t.primary)]),
        row([divider()]),
        row([textBlock(`<p style="text-align:center;color:#9ca3af;font-size:13px;font-weight:600;">${copy.footer}</p>`, { textAlign: "center", fontSize: "13px" })]),
      ])
    },
  },

  // 7. FOLLOW-UP
  {
    type: "follow-up",
    category: "follow_up",
    theme: "sky",
    variants: [
      { lang: "en", name: "Follow-up Email", subject: "Following up on our conversation", variables: ["client_name", "company", "service"] },
      { lang: "ru", name: "Письмо-напоминание", subject: "Напоминание о нашем разговоре", variables: ["client_name", "company", "service"] },
      { lang: "az", name: "Xatırlatma məktubu", subject: "Söhbətimizlə bağlı", variables: ["client_name", "company", "service"] },
    ],
    buildDesign: (t, lang) => {
      const copy = {
        en: {
          p1: "Hi {{client_name}},",
          p2: "I wanted to follow up on our recent conversation about <strong>{{service}}</strong>. I hope you've had a chance to review the information we discussed.",
          p3: "I'd love to answer any questions you might have and explore how <strong>{{company}}</strong> can help you achieve your goals. Would you be available for a quick 15-minute call this week?",
          p4: "Looking forward to hearing from you.",
          sign: "Best regards,<br/>The {{company}} Team",
          btn: "Schedule a Call",
        },
        ru: {
          p1: "Здравствуйте, {{client_name}},",
          p2: "Хотел(а) бы напомнить о нашем недавнем разговоре о <strong>{{service}}</strong>. Надеюсь, вы успели ознакомиться с обсуждавшейся информацией.",
          p3: "Буду рад(а) ответить на любые вопросы и обсудить, как <strong>{{company}}</strong> может помочь вам достичь ваших целей. Сможете ли вы уделить 15 минут на этой неделе?",
          p4: "С нетерпением жду вашего ответа.",
          sign: "С уважением,<br/>Команда {{company}}",
          btn: "Назначить звонок",
        },
        az: {
          p1: "Salam {{client_name}},",
          p2: "Son söhbətimizi <strong>{{service}}</strong> mövzusunda xatırlatmaq istəyirdim. Müzakirə etdiyimiz məlumatları nəzərdən keçirdiyinizə ümid edirəm.",
          p3: "<strong>{{company}}</strong>-nin hədəflərinizə çatmağınıza necə kömək edə biləcəyini müzakirə etmək istərdim. Bu həftə 15 dəqiqəlik zəng üçün vaxtınız olarmı?",
          p4: "Cavabınızı səbirsizliklə gözləyirəm.",
          sign: "Hörmətlə,<br/>{{company}} Komandası",
          btn: "Zəng planlaşdırın",
        },
      }[lang]!
      return makeDesign([
        row([textBlock(`<div style="border-left:4px solid ${t.primary};padding-left:16px;"><p style="color:#111827;">${copy.p1}</p><p>${copy.p2}</p><p>${copy.p3}</p><p>${copy.p4}</p><p style="margin-top:24px;">${copy.sign}</p></div>`)]),
        row([btnBlock(copy.btn, t.primary)]),
      ])
    },
  },

  // 8. THANK YOU
  {
    type: "thank-you",
    category: "general",
    theme: "green",
    variants: [
      { lang: "en", name: "Thank You Email", subject: "Thank you for your trust!", variables: ["client_name", "company"] },
      { lang: "ru", name: "Благодарственное письмо", subject: "Спасибо за ваше доверие!", variables: ["client_name", "company"] },
      { lang: "az", name: "Təşəkkür məktubu", subject: "Etibarınız üçün təşəkkür edirik!", variables: ["client_name", "company"] },
    ],
    buildDesign: (t, lang) => {
      const copy = {
        en: {
          h1: "Thank You! 💚",
          p1: "Dear {{client_name}},",
          p2: "We sincerely appreciate your continued partnership with <strong>{{company}}</strong>. Your trust means the world to us, and we're committed to delivering exceptional results.",
          p3: "As a valued partner, you can always count on us for:",
          list: "<ul><li>Priority support and dedicated attention</li><li>Regular updates and transparent communication</li><li>Innovative solutions tailored to your needs</li></ul>",
          btn: "Share Feedback",
          footer: "Your success is our success. Here's to continued growth together!",
        },
        ru: {
          h1: "Спасибо! 💚",
          p1: "Уважаемый(-ая) {{client_name}},",
          p2: "Мы искренне ценим ваше сотрудничество с <strong>{{company}}</strong>. Ваше доверие значит для нас очень много, и мы стремимся к превосходным результатам.",
          p3: "Как наш ценный партнёр, вы всегда можете рассчитывать на:",
          list: "<ul><li>Приоритетную поддержку и персональное внимание</li><li>Регулярные обновления и прозрачную коммуникацию</li><li>Инновационные решения под ваши потребности</li></ul>",
          btn: "Оставить отзыв",
          footer: "Ваш успех — наш успех. За дальнейший совместный рост!",
        },
        az: {
          h1: "Təşəkkür edirik! 💚",
          p1: "Hörmətli {{client_name}},",
          p2: "<strong>{{company}}</strong> ilə davamlı əməkdaşlığınızı səmimi qəlbdən qiymətləndiririk. Etibarınız bizim üçün çox dəyərlidir.",
          p3: "Dəyərli tərəfdaşımız olaraq, həmişə bizə güvənə bilərsiniz:",
          list: "<ul><li>Prioritet dəstək və fərdi diqqət</li><li>Müntəzəm yeniliklər və şəffaf ünsiyyət</li><li>Ehtiyaclarınıza uyğun innovativ həllər</li></ul>",
          btn: "Rəy bildirin",
          footer: "Sizin uğurunuz bizim uğurumuzdur. Birlikdə böyüməyə davam!",
        },
      }[lang]!
      return makeDesign([
        row([textBlock(`<h1 style="text-align:center;color:${t.headerColor};font-size:32px;font-weight:800;margin:0;">${copy.h1}</h1>`, { textAlign: "center", containerPadding: "40px 24px 16px" })], t.headerBg),
        row([spacer("16px")]),
        row([textBlock(`<p>${copy.p1}</p><p>${copy.p2}</p><p style="font-weight:600;">${copy.p3}</p>${copy.list}`)]),
        row([btnBlock(copy.btn, t.primary)]),
        row([divider()]),
        row([textBlock(`<p style="text-align:center;color:${t.primary};font-size:14px;font-weight:600;">${copy.footer}</p>`, { textAlign: "center" })]),
      ])
    },
  },

  // 9. TICKET RESOLVED
  {
    type: "ticket-resolved",
    category: "notification",
    theme: "green",
    variants: [
      { lang: "en", name: "Ticket Resolved", subject: "Your support ticket has been resolved", variables: ["client_name", "company"] },
      { lang: "ru", name: "Тикет решён", subject: "Ваш тикет решён", variables: ["client_name", "company"] },
      { lang: "az", name: "Tiket həll edildi", subject: "Dəstək tiketiniz həll edildi", variables: ["client_name", "company"] },
    ],
    buildDesign: (t, lang) => {
      const copy = {
        en: {
          icon: "✅",
          h1: "Issue Resolved",
          sub: "Your support request has been addressed",
          p1: "Hi {{client_name}},",
          p2: "Great news! Your support ticket has been successfully resolved by our team. We hope the solution meets your expectations.",
          p3: "If the issue persists or you have additional questions, don't hesitate to reach out. We're always here to help.",
          btn: "Rate Your Experience",
          footer: "Thank you for choosing {{company}} support.",
        },
        ru: {
          icon: "✅",
          h1: "Проблема решена",
          sub: "Ваш запрос в поддержку обработан",
          p1: "Здравствуйте, {{client_name}},",
          p2: "Отличные новости! Ваш тикет успешно решён нашей командой. Надеемся, что решение соответствует вашим ожиданиям.",
          p3: "Если проблема сохраняется или у вас есть дополнительные вопросы — не стесняйтесь обращаться. Мы всегда готовы помочь.",
          btn: "Оценить обслуживание",
          footer: "Спасибо, что выбираете поддержку {{company}}.",
        },
        az: {
          icon: "✅",
          h1: "Məsələ həll edildi",
          sub: "Dəstək sorğunuz cavablandırıldı",
          p1: "Salam {{client_name}},",
          p2: "Yaxşı xəbər! Dəstək tiketiniz komandamız tərəfindən uğurla həll edildi. Həllin gözləntilərinizə cavab verdiyinə ümid edirik.",
          p3: "Əgər problem davam edirsə və ya əlavə suallarınız varsa, bizimlə əlaqə saxlamaqdan çəkinməyin.",
          btn: "Təcrübənizi qiymətləndirin",
          footer: "{{company}} dəstəyini seçdiyiniz üçün təşəkkür edirik.",
        },
      }[lang]!
      return makeDesign([
        row([
          textBlock(`<div style="text-align:center;"><span style="font-size:48px;">${copy.icon}</span><h1 style="color:${t.headerColor};font-size:26px;font-weight:800;margin:12px 0 4px;">${copy.h1}</h1><p style="color:#6b7280;margin:0;">${copy.sub}</p></div>`, { textAlign: "center", containerPadding: "36px 24px 24px" }),
        ], t.headerBg),
        row([textBlock(`<p>${copy.p1}</p><p>${copy.p2}</p><p>${copy.p3}</p>`)]),
        row([btnBlock(copy.btn, t.primary)]),
        row([divider()]),
        row([textBlock(`<p style="text-align:center;color:#9ca3af;font-size:12px;">${copy.footer}</p>`, { textAlign: "center", fontSize: "12px" })]),
      ])
    },
  },

  // 10. RE-ENGAGEMENT
  {
    type: "re-engagement",
    category: "marketing",
    theme: "amber",
    variants: [
      { lang: "en", name: "We Miss You", subject: "We haven't heard from you in a while", variables: ["client_name", "company", "new_services", "improvements"] },
      { lang: "ru", name: "Мы скучаем", subject: "Давно не слышали от вас", variables: ["client_name", "company", "new_services", "improvements"] },
      { lang: "az", name: "Sizi darıxırıq", subject: "Sizdən xeyli müddətdir xəbər yoxdur", variables: ["client_name", "company", "new_services", "improvements"] },
    ],
    buildDesign: (t, lang) => {
      const copy = {
        en: {
          h1: "We Miss You! 👋",
          p1: "Hi {{client_name}},",
          p2: "It's been a while since we've connected, and the team at <strong>{{company}}</strong> wanted to reach out. A lot has changed since your last visit!",
          s1: "🚀 What's New",
          d1: "{{new_services}}",
          s2: "⚡ Recent Improvements",
          d2: "{{improvements}}",
          btn: "Come Back & Explore",
          footer: "We'd love to have you back. If there's anything we can do better, let us know!",
        },
        ru: {
          h1: "Мы скучаем! 👋",
          p1: "Здравствуйте, {{client_name}},",
          p2: "Давно не общались, и команда <strong>{{company}}</strong> решила напомнить о себе. Многое изменилось с вашего последнего визита!",
          s1: "🚀 Что нового",
          d1: "{{new_services}}",
          s2: "⚡ Улучшения",
          d2: "{{improvements}}",
          btn: "Вернуться и изучить",
          footer: "Будем рады видеть вас снова. Если мы можем что-то улучшить — напишите нам!",
        },
        az: {
          h1: "Sizi darıxırıq! 👋",
          p1: "Salam {{client_name}},",
          p2: "Xeyli müddətdir əlaqə saxlamırıq və <strong>{{company}}</strong> komandası sizinlə əlaqə saxlamaq istədi. Son ziyarətinizdən bəri çox şey dəyişdi!",
          s1: "🚀 Yeniliklər",
          d1: "{{new_services}}",
          s2: "⚡ Təkmilləşdirmələr",
          d2: "{{improvements}}",
          btn: "Qayıdın və kəşf edin",
          footer: "Sizi yenidən görmək istərdik. Təkmilləşdirə biləcəyimiz bir şey varsa, bizə yazın!",
        },
      }[lang]!
      const card = (title: string, desc: string) =>
        `<div style="background:${t.headerBg};border-radius:10px;padding:16px 20px;margin-bottom:10px;"><strong style="color:${t.headerColor};font-size:15px;">${title}</strong><p style="color:#4b5563;margin:6px 0 0;">${desc}</p></div>`
      return makeDesign([
        row([textBlock(`<h1 style="text-align:center;color:${t.headerColor};font-size:30px;font-weight:800;margin:0;">${copy.h1}</h1>`, { textAlign: "center", containerPadding: "40px 24px 16px" })], t.headerBg),
        row([spacer("12px")]),
        row([textBlock(`<p>${copy.p1}</p><p>${copy.p2}</p>`)]),
        row([textBlock(card(copy.s1, copy.d1) + card(copy.s2, copy.d2), { containerPadding: "8px 24px" })]),
        row([btnBlock(copy.btn, t.primary)]),
        row([divider()]),
        row([textBlock(`<p style="text-align:center;color:#9ca3af;font-size:13px;">${copy.footer}</p>`, { textAlign: "center", fontSize: "13px" })]),
      ])
    },
  },
]

// ─── Main Seed Function ─────────────────────────────────────────

async function main() {
  prisma = await makeScriptPrisma()
  // Find the organization
  const org = await prisma.organization.findFirst({ select: { id: true, name: true } })
  if (!org) {
    console.error("No organization found in database!")
    process.exit(1)
  }
  console.log(`\nOrganization: ${org.name} (${org.id})`)

  // Delete existing seeded templates to avoid duplicates
  const existingCount = await prisma.emailTemplate.count({ where: { organizationId: org.id } })
  if (existingCount > 0) {
    console.log(`Found ${existingCount} existing templates — deleting to re-seed...`)
    await prisma.emailTemplate.deleteMany({ where: { organizationId: org.id } })
  }

  let created = 0

  for (const tpl of templateSets) {
    const theme = themes[tpl.theme]

    for (const v of tpl.variants) {
      counter = 0 // reset UID counter per template
      const designJson = tpl.buildDesign(theme, v.lang)

      await prisma.emailTemplate.create({
        data: {
          organizationId: org.id,
          name: v.name,
          subject: v.subject,
          htmlBody: "",
          textBody: "",
          designJson,
          editorType: "visual",
          category: tpl.category,
          language: v.lang,
          variables: v.variables,
          isActive: true,
          createdBy: "system",
        },
      })
      created++
      console.log(`  ✓ [${v.lang.toUpperCase()}] ${v.name}`)
    }
  }

  console.log(`\n✅ Created ${created} email templates (${templateSets.length} types × 3 languages)\n`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
