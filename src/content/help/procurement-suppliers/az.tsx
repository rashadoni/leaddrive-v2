"use client"

/**
 * «Təchizatçılar» — alış etdiyiniz şirkətlər (Azərbaycan dili).
 */
import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function ProcurementSuppliersHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="Təchizat əməkdaşı" goal="Təchizatçıları bir yerdə saxlamaq və onları məhsullara bağlamaq">
        Təchizatçı da şirkətdir — əlaqələri, faylları və tarixçəsi var — amma müştəri siyahısına qarışmır. Əlavə etmək və idxal təchizat işidir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <dl className="rounded-md border p-3">
          <HelpDef term="Siyahı">ad (altında rəhbər), VÖEN, telefon, e-poçt və şəhər.</HelpDef>
          <HelpDef term="Axtarış">«Ad, VÖEN, telefon və ya e-poçt üzrə axtarış».</HelpDef>
          <HelpDef term="Süzgəclər"><HelpKey>Aktiv</HelpKey>, <HelpKey>Qeyri-aktiv</HelpKey>, <HelpKey>Hamısı</HelpKey>.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: təchizatçı əlavə etmək">
        <HelpStep n={1}>
          <p><HelpKey>Təchizatçı əlavə et</HelpKey> basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Pəncərə: ad, VÖEN, rəhbər, telefon, e-poçt, sayt, şəhər, ünvan və qeydlər.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Ən azı adı yazın, qeyddə ödəniş şərtlərini qeyd edin və <HelpKey>Yadda saxla</HelpKey> basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Təchizatçı siyahıda görünür; e-poçtu sonra sifarişin PDF-ini göndərmək üçün istifadə olunur.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Excel-dən idxal">
        <HelpStep n={1}>
          <p><HelpKey>Excel-dən idxal</HelpKey> basın və <HelpKey>Fayl seç</HelpKey> ilə .xlsx və ya .csv faylı seçin (birinci sətirdə sütun adları).</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Sistem sütunları özü tanıyır — «Ad», «VÖEN», «Telefon», «E-poçt» — və hər sütunun hansı sahəyə getdiyini göstərir; lazım olsa dəyişin.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p><HelpKey>Yoxla</HelpKey> basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Neçə təchizatçının əlavə ediləcəyi, təkrarlar və səhvli sətirlər görünür — hələ heç nə yazılmayıb.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p><HelpKey>İdxal et</HelpKey> basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Yeni təchizatçılar siyahıya əlavə olunur; artıq olanlar (eyni VÖEN və ya ad) ötürülür.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Təchizatçı və məhsul">
        <p>Məhsulun kartındakı «Satınalma» blokunda təchizatçını əsas təchizatçı kimi seçirsiniz — alış qiyməti və çatdırılma müddəti ilə birlikdə. Sövdələşməyə bu məhsul əlavə olunanda alış qiyməti planlaşdırılan maya dəyəri kimi götürülür.</p>
      </HelpSection>

      <HelpCallout kind="tip">Daha işləmədiyiniz təchizatçını silməyin — qeyri-aktiv edin: köhnə sifarişlər və hesabatlar ona bağlı qalır.</HelpCallout>

      <HelpCallout kind="security">Alış qiymətini və əsas təchizatçını yalnız rəhbərlik, maliyyə və təchizat görür.</HelpCallout>
    </div>
  )
}
