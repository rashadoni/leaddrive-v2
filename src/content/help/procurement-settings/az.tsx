"use client"

/**
 * «Təsdiq limitləri» — sifarişi məbləğə görə kim təsdiqləyir (Azərbaycan dili).
 */
import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function ProcurementSettingsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="Administrator" goal="Təchizatçı sifarişlərinin kimin tərəfindən və hansı ardıcıllıqla təsdiqlənəcəyini qurmaq">
        Limitləri yalnız administrator dəyişir; digərləri qaydaları görür. Heç bir aralığa düşməyən sifarişi rəhbər təsdiqləyir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <dl className="rounded-md border p-3">
          <HelpDef term="Aralıq"><HelpKey>Başlanğıc</HelpKey> və <HelpKey>Son (boş — limitsiz)</HelpKey> məbləği; sifariş məbləğinə görə bir aralığa düşür.</HelpDef>
          <HelpDef term="Təsdiqləyənlər ardıcıllıqla">hər addımda rol (Rəhbər, Maliyyə, Təchizat, Administrator) və ya konkret əməkdaş; addımlar növbə ilə açılır.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım">
        <HelpStep n={1}>
          <p><HelpKey>Aralıq əlavə et</HelpKey> basın, məsələn 0 — 5000 yazın və birinci addımda əməkdaşı seçin.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Aralıq kartı görünür: «1.» addımda seçdiyiniz əməkdaş, məsələn «Əməkdaş: Lalə Quliyeva».</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Daha böyük məbləğlər üçün yenə <HelpKey>Aralıq əlavə et</HelpKey>: 5000-dən, Son boş; <HelpKey>Təsdiqləyən əlavə et</HelpKey> ilə iki addım — Rəhbər, sonra Maliyyə.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">İkinci aralıqda iki addım görünür; ikinci addım birincidən sonra açılacaq.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p><HelpKey>Yadda saxla</HelpKey> basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">«Yadda saxlanıldı»; yeni qaydalar təsdiqə göndərilən növbəti sifarişlərdən işləyir.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="warning">Aralıqlar üst-üstə düşməməlidir — əks halda yadda saxlamaq olmur.</HelpCallout>

      <HelpCallout kind="security">Sifarişi yaradan öz sifarişini təsdiqləyə bilməz; administrator istənilən addımı təsdiqləyə bilər. Maliyyə təsdiqləyə bilər, amma təchizat işinə yaza bilməz.</HelpCallout>
    </div>
  )
}
