import { jsPDF } from "jspdf"
import QRCode from "qrcode"
import { PDF_FONT, registerUnicodeFont } from "@/lib/pdf/unicode-font"
import { TIME_APP_ORIGIN } from "@/lib/mtm/time-app-release"

/** Where the QR leads: the public Time download page. */
export const TIME_LEAFLET_URL = `${TIME_APP_ORIGIN}/time`

/**
 * Personnel → Employees → «Листовка для отдела» (owner, 2026-11-05: rolling
 * Time out to a thousand people a department at a time). One A4 page to pin at
 * the door or hand out at a meeting: the QR to download Time and the three
 * steps in Azerbaijani and Russian, with the words the app's own buttons use
 * (`MTMobileApp/src/i18n`: «Kodu WhatsApp-a göndər», «Получить код в WhatsApp»)
 * and the company's short name the app asks for first.
 */
export async function buildTimeLeaflet(input: { companyName: string; companySlug: string }) {
  const doc = new jsPDF({ unit: "mm", format: "a4" })
  registerUnicodeFont(doc)
  const width = doc.internal.pageSize.getWidth(), center = width / 2
  doc.setFont(PDF_FONT, "bold"); doc.setFontSize(26)
  doc.text(input.companyName, center, 30, { align: "center", maxWidth: width - 30 })
  doc.setFont(PDF_FONT, "normal"); doc.setFontSize(14); doc.setTextColor(90)
  doc.text("İş gününün uçotu · Учёт рабочего дня", center, 40, { align: "center" })
  const qr = await QRCode.toDataURL(TIME_LEAFLET_URL, { errorCorrectionLevel: "M", margin: 1, width: 600 })
  doc.addImage(qr, "PNG", center - 37.5, 48, 75, 75)
  doc.setFontSize(11)
  doc.text(TIME_LEAFLET_URL.replace(/^https:\/\//, ""), center, 129, { align: "center" })
  doc.setTextColor(20)
  const steps: Array<[string, string[]]> = [
    ["Azərbaycanca", [
      "1. Telefonun kamerasını QR koda tutun və LeadDrive Time-ı yükləyin.",
      `2. Time-ı açın, şirkət olaraq «${input.companySlug}» yazın.`,
      "3. «Kodu WhatsApp-a göndər» düyməsini basın, öz nömrənizi yazın. Gələn kodu daxil edin və şifrənizi özünüz qurun.",
    ]],
    ["По-русски", [
      "1. Наведите камеру телефона на QR-код и скачайте LeadDrive Time.",
      `2. Откройте Time и введите компанию «${input.companySlug}».`,
      "3. Нажмите «Получить код в WhatsApp» и введите свой номер. Введите пришедший код и придумайте пароль сами.",
    ]],
  ]
  let y = 145
  for (const [title, lines] of steps) {
    doc.setFont(PDF_FONT, "bold"); doc.setFontSize(15); doc.text(title, 22, y); y += 8
    doc.setFont(PDF_FONT, "normal"); doc.setFontSize(13)
    for (const line of lines) {
      const wrapped = doc.splitTextToSize(line, width - 44) as string[]
      doc.text(wrapped, 22, y); y += wrapped.length * 6.2 + 2.5
    }
    y += 6
  }
  doc.setFontSize(10); doc.setTextColor(110)
  doc.text("Nömrəniz şirkətdə qeyd olunmalıdır · Номер должен быть записан у вас в компании", center, 285, { align: "center" })
  return Buffer.from(doc.output("arraybuffer"))
}
