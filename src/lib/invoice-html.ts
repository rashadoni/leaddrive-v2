/**
 * Shared invoice HTML generator — used by both PDF route and Send route
 */

type InvoiceData = Record<string, unknown> & {
  items: Array<Record<string, unknown>>
  company?: Record<string, unknown> | null
  contact?: Record<string, unknown> | null
}

type LabelSet = {
  invoiceTitle: string; seller: string; buyer: string; date: string; dueDate: string
  paymentTermsLabel: string; email: string; phone: string; bank: string; stamp: string
  subtotal: string; discount: string; vat: string; total: string; paid: string; balance: string
  itemName: string; qty: string; price: string; disc: string; sum: string
  terms: string
  paymentTerms: Record<string, string>
}

const LABELS: Record<string, LabelSet> = {
  az: {
    invoiceTitle: "Hesab-Faktura", seller: "İcraçı Şirkət", buyer: "Sifarişçi Şirkət",
    date: "Tarix", dueDate: "Son ödəniş", paymentTermsLabel: "Ödəniş şərtləri",
    email: "E-poçt", phone: "Tel", bank: "Bank Hesabı", stamp: "Təsdiq (İmza, Möhür)",
    subtotal: "Ara cəm", discount: "Endirim", vat: "ƏDV", total: "YEKUN", paid: "Ödənilmiş", balance: "QALIQ",
    itemName: "Məhsul / Xidmət", qty: "Miqdar", price: "Qiymət", disc: "Endirim", sum: "Cəm",
    terms: "Şərtlər",
    paymentTerms: { dueOnReceipt: "Dərhal", net15: "15 gün", net30: "30 gün", net45: "45 gün", net60: "60 gün", custom: "Fərdi" },
  },
  ru: {
    invoiceTitle: "Счёт-Фактура", seller: "Исполнитель", buyer: "Заказчик",
    date: "Дата", dueDate: "Срок оплаты", paymentTermsLabel: "Условия оплаты",
    email: "E-mail", phone: "Тел", bank: "Банковские реквизиты", stamp: "Подпись и печать",
    subtotal: "Подытог", discount: "Скидка", vat: "НДС", total: "ИТОГО", paid: "Оплачено", balance: "ОСТАТОК",
    itemName: "Товар / Услуга", qty: "Кол-во", price: "Цена", disc: "Скидка", sum: "Сумма",
    terms: "Условия",
    paymentTerms: { dueOnReceipt: "По получении", net15: "15 дней", net30: "30 дней", net45: "45 дней", net60: "60 дней", custom: "Другое" },
  },
  en: {
    invoiceTitle: "Invoice", seller: "Seller", buyer: "Bill To",
    date: "Date", dueDate: "Due Date", paymentTermsLabel: "Payment Terms",
    email: "Email", phone: "Phone", bank: "Bank Details", stamp: "Authorized Signature",
    subtotal: "Subtotal", discount: "Discount", vat: "VAT", total: "TOTAL", paid: "Paid", balance: "BALANCE DUE",
    itemName: "Item / Service", qty: "Qty", price: "Price", disc: "Disc", sum: "Amount",
    terms: "Terms",
    paymentTerms: { dueOnReceipt: "Due on Receipt", net15: "Net 15", net30: "Net 30", net45: "Net 45", net60: "Net 60", custom: "Custom" },
  },
}

export function getInvoiceLabels(lang: string): LabelSet {
  return LABELS[lang] || LABELS.az
}

function escHtml(str: unknown): string {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export function generateInvoiceHtml(
  invoice: InvoiceData,
  orgName: string,
  settings: Record<string, unknown>,
  withStamp = false
): string {
  const companyName = (settings.companyName as string) || orgName
  const companyAddress = (settings.companyAddress as string) || ""
  const companyVoen = (settings.companyVoen as string) || (invoice.sellerVoen as string) || ""
  const companyEmail = (settings.companyEmail as string) || ""
  const companyPhone = (settings.companyPhone as string) || ""
  const clientCo = invoice.company as Record<string, unknown> | null
  const clientVoen = (invoice.voen as string) || (clientCo?.voen as string) || ""
  const bankName = (settings.bankName as string) || ""
  const bankCode = (settings.bankCode as string) || ""
  const bankSwift = (settings.bankSwift as string) || ""
  const bankAccount = (settings.bankAccount as string) || ""
  const bankVoen = (settings.bankVoen as string) || ""
  const bankCorrAccount = (settings.bankCorrAccount as string) || ""
  const signerName = (settings.signerName as string) || ""
  const signerTitle = (settings.signerTitle as string) || ""
  const companyStampUrl = (settings.companyStampUrl as string) || ""
  const footerNote = (invoice.footerNote as string) || (settings.footerNote as string) || ""
  const terms = (invoice.termsAndConditions as string) || (settings.termsAndConditions as string) || ""

  const lang = (invoice.documentLanguage as string) || "az"
  const locale = lang === "ru" ? "ru-RU" : lang === "en" ? "en-US" : "az-AZ"
  const formatDate = (d: unknown) => d ? new Date(d as string).toLocaleDateString(locale) : "—"
  const formatMoney = (n: unknown) => Number(n || 0).toLocaleString(locale, { minimumFractionDigits: 2 })
  const L = LABELS[lang] || LABELS.az
  const formatPaymentTerms = (t: unknown) => t ? (L.paymentTerms[t as string] || String(t)) : ""
  const hasDiscounts = invoice.items.some(item => Number(item.discount) > 0)

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Invoice ${invoice.invoiceNumber}</title>
<style>
  @page { size: A4; margin: 0; }
  @media print { .no-print { display: none !important; } @page { margin: 0; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, 'Segoe UI', sans-serif; width: 794px; margin: 0 auto; color: #222; font-size: 11px; background: #fff; }
  .hdr-band { background: #0891b2; color: white; padding: 18px 28px 14px; display: flex; justify-content: space-between; align-items: flex-end; }
  .hdr-company { font-size: 17px; font-weight: 800; letter-spacing: 0.5px; line-height: 1.2; }
  .hdr-company small { display: block; font-size: 10px; font-weight: 400; opacity: 0.75; margin-top: 2px; letter-spacing: 0.3px; }
  .hdr-inv { text-align: right; }
  .hdr-inv .title { font-size: 22px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; opacity: 0.95; }
  .hdr-inv .num { font-size: 12px; opacity: 0.7; margin-top: 2px; }
  .dates-bar { background: #e0f7fa; border-bottom: 2px solid #0891b2; padding: 7px 28px; display: flex; gap: 32px; }
  .date-item { font-size: 10.5px; color: #0891b2; }
  .date-item strong { font-weight: 700; margin-right: 5px; }
  .body { padding: 16px 28px; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
  .party { border: 1px solid #b2ebf2; border-radius: 4px; overflow: hidden; }
  .party-hdr { background: #0891b2; color: white; font-size: 9.5px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; padding: 5px 12px; }
  .party-body { padding: 9px 12px; background: #f0fdfa; }
  .pr { display: flex; padding: 2px 0; font-size: 10.5px; }
  .pr .k { width: 68px; color: #0e7490; flex-shrink: 0; }
  .pr .v { color: #222; font-weight: 600; }
  .tbl { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  .tbl thead tr { background: #0891b2; }
  .tbl th { padding: 7px 10px; color: white; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; }
  .tbl th:nth-child(n+3), .tbl td:nth-child(n+3) { text-align: right; }
  .tbl tbody tr:nth-child(even) { background: #f0fdfa; }
  .tbl tbody tr { border-bottom: 1px solid #e0f2f1; }
  .tbl td { padding: 6px 10px; font-size: 10.5px; color: #333; vertical-align: top; }
  .tbl td:first-child { color: #aaa; font-size: 10px; }
  .tbl td:last-child { font-weight: 700; color: #0891b2; }
  .sum-wrap { display: flex; justify-content: flex-end; margin: 6px 0 14px; }
  .sum-box { width: 230px; border: 1px solid #b2ebf2; border-radius: 4px; overflow: hidden; }
  .sum-row { display: flex; justify-content: space-between; padding: 4px 12px; font-size: 11px; border-bottom: 1px solid #e0f7fa; color: #555; }
  .sum-row:last-child { border-bottom: none; }
  .sum-row.yekun { background: #0891b2; color: white; font-weight: 800; font-size: 12.5px; padding: 7px 12px; }
  .bottom { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .bot-box { border: 1px solid #b2ebf2; border-radius: 4px; overflow: hidden; }
  .bot-hdr { background: #0891b2; color: white; font-size: 9.5px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; padding: 5px 12px; }
  .bot-body { padding: 9px 12px; background: #f0fdfa; }
  .br { display: flex; padding: 2px 0; font-size: 10.5px; }
  .br .k { width: 48px; color: #0e7490; flex-shrink: 0; }
  .br .v { color: #222; font-weight: 600; }
  .stamp-body { padding: 10px 12px; background: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 210px; }
  .stamp-img { width: 213px; height: 213px; object-fit: contain; }
  .sig-line { border-top: 1.5px solid #333; width: 190px; margin: 10px auto 6px; }
  .sig-name { font-size: 11.5px; font-weight: 700; color: #0891b2; text-align: center; }
  .sig-title { font-size: 10px; color: #777; margin-top: 2px; text-align: center; }
  .footer { padding: 8px 28px 14px; font-size: 10px; color: #aaa; border-top: 1px solid #e0f2f1; margin-top: 12px; }
  .print-btn { position: fixed; bottom: 18px; right: 18px; background: #0891b2; color: white; border: none; padding: 10px 22px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 700; box-shadow: 0 4px 14px rgba(8,145,178,0.4); }
  .print-btn:hover { background: #0e7490; }
</style>
</head>
<body>
<div class="hdr-band">
  <div class="hdr-company">
    ${escHtml(companyName)}
    <small>${companyVoen ? 'VÖEN: ' + escHtml(companyVoen) : ''}${companyVoen && companyAddress ? ' · ' : ''}${escHtml(companyAddress)}</small>
  </div>
  <div class="hdr-inv">
    <div class="title">${L.invoiceTitle}</div>
    <div class="num"># ${invoice.invoiceNumber}</div>
  </div>
</div>
<div class="dates-bar">
  <div class="date-item"><strong>${L.date}:</strong>${formatDate(invoice.issueDate)}</div>
  <div class="date-item"><strong>${L.dueDate}:</strong>${formatDate(invoice.dueDate)}</div>
  ${invoice.paymentTerms ? `<div class="date-item"><strong>${L.paymentTermsLabel}:</strong>${formatPaymentTerms(invoice.paymentTerms)}</div>` : ''}
  ${companyEmail ? `<div class="date-item"><strong>${L.email}:</strong>${companyEmail}</div>` : ''}
  ${companyPhone ? `<div class="date-item"><strong>${L.phone}:</strong>${companyPhone}</div>` : ''}
</div>
<div class="body">
<div class="parties">
  <div class="party">
    <div class="party-hdr">${L.seller}</div>
    <div class="party-body">
      <div class="pr"><span class="k">Ad:</span><span class="v">${escHtml(companyName)}</span></div>
      <div class="pr"><span class="k">VÖEN:</span><span class="v">${escHtml(companyVoen)}</span></div>
      ${companyAddress ? `<div class="pr"><span class="k">Ünvan:</span><span class="v">${escHtml(companyAddress)}</span></div>` : ''}
    </div>
  </div>
  <div class="party">
    <div class="party-hdr">${L.buyer}</div>
    <div class="party-body">
      <div class="pr"><span class="k">Ad:</span><span class="v">${escHtml(clientCo?.name || '—')}</span></div>
      ${clientVoen ? `<div class="pr"><span class="k">VÖEN:</span><span class="v">${escHtml(clientVoen)}</span></div>` : ''}
      ${clientCo?.address ? `<div class="pr"><span class="k">Ünvan:</span><span class="v">${escHtml(clientCo.address)}</span></div>` : ''}
      ${clientCo?.email ? `<div class="pr"><span class="k">${L.email}:</span><span class="v">${escHtml(clientCo.email)}</span></div>` : ''}
      ${clientCo?.phone ? `<div class="pr"><span class="k">${L.phone}:</span><span class="v">${escHtml(clientCo.phone)}</span></div>` : ''}
    </div>
  </div>
</div>
<table class="tbl">
  <thead>
    <tr>
      <th style="width:26px">#</th>
      <th>${L.itemName}</th>
      <th style="width:58px">${L.qty}</th>
      <th style="width:108px">${L.price}</th>
      ${hasDiscounts ? `<th style="width:66px">${L.disc}</th>` : ''}
      <th style="width:108px">${L.sum}</th>
    </tr>
  </thead>
  <tbody>
    ${invoice.items.map((item, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escHtml(item.name)}${item.description ? `<br><span style="color:#999;font-size:9.5px">${escHtml(item.description)}</span>` : ''}</td>
      <td>${item.quantity}</td>
      <td>${formatMoney(item.unitPrice)} ${invoice.currency}</td>
      ${hasDiscounts ? `<td>${Number(item.discount) > 0 ? item.discount + '%' : '—'}</td>` : ''}
      <td>${formatMoney(item.total)} ${invoice.currency}</td>
    </tr>`).join('')}
  </tbody>
</table>
<div class="sum-wrap">
  <div class="sum-box">
    <div class="sum-row"><span>${L.subtotal}</span><span>${formatMoney(invoice.subtotal)} ${invoice.currency}</span></div>
    ${Number(invoice.discountAmount) > 0 ? `<div class="sum-row"><span>${L.discount}</span><span>−${formatMoney(invoice.discountAmount)} ${invoice.currency}</span></div>` : ''}
    ${invoice.includeVat ? `<div class="sum-row"><span>${L.vat} ${Number(invoice.taxRate) * 100}%</span><span>${formatMoney(invoice.taxAmount)} ${invoice.currency}</span></div>` : ''}
    <div class="sum-row yekun"><span>${L.total}</span><span>${formatMoney(invoice.totalAmount)} ${invoice.currency}</span></div>
    ${Number(invoice.paidAmount) > 0 ? `<div class="sum-row"><span>${L.paid}</span><span>${formatMoney(invoice.paidAmount)} ${invoice.currency}</span></div><div class="sum-row yekun"><span>${L.balance}</span><span>${formatMoney(invoice.balanceDue)} ${invoice.currency}</span></div>` : ''}
  </div>
</div>
<div class="bottom">
  <div class="bot-box">
    <div class="bot-hdr">${L.bank}</div>
    <div class="bot-body">
      ${bankName ? `<div class="br"><span class="k">Bank:</span><span class="v">${escHtml(bankName)}</span></div>` : ''}
      ${bankVoen ? `<div class="br"><span class="k">VÖEN:</span><span class="v">${escHtml(bankVoen)}</span></div>` : ''}
      ${bankCode ? `<div class="br"><span class="k">Kod:</span><span class="v">${escHtml(bankCode)}</span></div>` : ''}
      ${bankSwift ? `<div class="br"><span class="k">SWIFT:</span><span class="v">${escHtml(bankSwift)}</span></div>` : ''}
      ${bankCorrAccount ? `<div class="br"><span class="k">M/H:</span><span class="v">${escHtml(bankCorrAccount)}</span></div>` : ''}
      ${bankAccount ? `<div class="br"><span class="k">H/H:</span><span class="v">${escHtml(bankAccount)}</span></div>` : ''}
    </div>
  </div>
  <div class="bot-box">
    <div class="bot-hdr">${L.stamp}</div>
    <div class="stamp-body">
      ${withStamp && companyStampUrl ? `<img src="${companyStampUrl}" class="stamp-img" alt="Stamp" />` : ''}
      <div class="sig-line"></div>
      ${signerName ? `<div class="sig-name">${escHtml(signerName)}</div>` : ''}
      ${signerTitle ? `<div class="sig-title">${escHtml(signerTitle)}</div>` : ''}
    </div>
  </div>
</div>
</div>
${terms || footerNote ? `
<div class="footer">
  ${terms ? `<strong>${L.terms}:</strong> ${escHtml(terms)}<br>` : ''}
  ${footerNote ? escHtml(footerNote) : ''}
</div>` : ''}
<button class="print-btn no-print" onclick="window.print()">🖨️ ${L.invoiceTitle}</button>
</body>
</html>`
}

/** Default email templates by language */
export const DEFAULT_EMAIL_TEMPLATES: Record<string, { greeting: string; body: string; closing: string; note: string }> = {
  az: {
    greeting: "Hörmətli tərəfdaş,",
    body: "{orgName} şirkəti tərəfindən {invoiceNumber} nömrəli hesab-faktura təqdim olunur.\n\nÜmumi məbləğ: {total} {currency}\nÖdəniş tarixi: {dueDate}",
    closing: "Hesab-faktura bu məktuba əlavə edilmişdir. Zəhmət olmasa, faylı açıb ödəniş üçün istifadə edin.",
    note: "Suallarınız varsa, bizimlə əlaqə saxlamaqdan çəkinməyin.\nƏməkdaşlığınız üçün təşəkkür edirik!",
  },
  ru: {
    greeting: "Уважаемый партнёр,",
    body: "Компания {orgName} направляет вам счёт-фактуру {invoiceNumber}.\n\nСумма к оплате: {total} {currency}\nСрок оплаты: {dueDate}",
    closing: "Счёт-фактура прилагается к данному письму. Пожалуйста, откройте вложение для ознакомления и оплаты.",
    note: "При возникновении вопросов не стесняйтесь обращаться к нам.\nБлагодарим за сотрудничество!",
  },
  en: {
    greeting: "Dear Partner,",
    body: "Please find attached invoice {invoiceNumber} from {orgName}.\n\nTotal amount: {total} {currency}\nDue date: {dueDate}",
    closing: "The invoice document is attached to this email. Please review and process the payment at your earliest convenience.",
    note: "Should you have any questions, please don't hesitate to contact us.\nThank you for your business!",
  },
}

export type EmailTemplateFields = { greeting?: string; body?: string; closing?: string; note?: string }

/** Email body templates by language — supports custom templates from settings */
export function getEmailTemplate(
  lang: string,
  data: { orgName: string; invoiceNumber: string; total: string; currency: string; dueDate: string; customMessage?: string },
  customTemplates?: Record<string, EmailTemplateFields>
): { subject: string; html: string } {
  const { orgName, invoiceNumber, total, currency, dueDate, customMessage } = data
  const vars: Record<string, string> = { orgName, invoiceNumber, total, currency, dueDate }

  const subjectTemplates: Record<string, string> = {
    az: `${invoiceNumber} — ${orgName} hesab-fakturası`,
    ru: `${invoiceNumber} — Счёт от ${orgName}`,
    en: `${invoiceNumber} — Invoice from ${orgName}`,
  }

  const defaults = DEFAULT_EMAIL_TEMPLATES[lang] || DEFAULT_EMAIL_TEMPLATES.az
  const custom = customTemplates?.[lang]

  // Substitute {varName} placeholders with actual values
  const sub = (text: string) => text.replace(/\{(\w+)\}/g, (_, key) => vars[key] || `{${key}}`)

  const greeting = sub(custom?.greeting || defaults.greeting)
  const body = sub(custom?.body || defaults.body).replace(/\n/g, "<br>")
  const closing = sub(custom?.closing || defaults.closing).replace(/\n/g, "<br>")
  const note = sub(custom?.note || defaults.note).replace(/\n/g, "<br>")
  const subject = subjectTemplates[lang] || subjectTemplates.az

  const html = `
<div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
  <div style="background: #0891b2; padding: 20px 28px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; font-size: 20px; margin: 0; font-weight: 700;">${orgName}</h1>
    <p style="color: rgba(255,255,255,0.7); font-size: 12px; margin: 4px 0 0;">${invoiceNumber}</p>
  </div>
  <div style="background: #f8fffe; border: 1px solid #e0f2f1; border-top: none; padding: 24px 28px; border-radius: 0 0 8px 8px;">
    <p style="font-size: 14px; margin: 0 0 16px;">${greeting}</p>
    ${customMessage ? `<p style="font-size: 14px; margin: 0 0 16px; padding: 12px 16px; background: #f0f9ff; border-left: 3px solid #0891b2; border-radius: 4px;">${customMessage}</p>` : ''}
    <p style="font-size: 14px; line-height: 1.6; margin: 0 0 16px;">${body}</p>
    <div style="background: #0891b2; color: white; padding: 14px 20px; border-radius: 6px; text-align: center; margin: 20px 0;">
      <span style="font-size: 13px; opacity: 0.8;">${lang === 'ru' ? 'ИТОГО' : lang === 'en' ? 'TOTAL' : 'YEKUN'}</span>
      <br>
      <strong style="font-size: 24px; letter-spacing: 0.5px;">${total} ${currency}</strong>
    </div>
    <p style="font-size: 13px; color: #666; margin: 16px 0 8px;">📎 ${closing}</p>
    <hr style="border: none; border-top: 1px solid #e0f2f1; margin: 16px 0;">
    <p style="font-size: 12px; color: #999; margin: 0;">${note}</p>
  </div>
</div>`

  return { subject, html }
}
