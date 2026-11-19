"use client"

/**
 * «Satınalma sorğuları» — müştəri sifarişi altında alışın başlanğıcı (Azərbaycan dili).
 */
import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function ProcurementRequestsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="Satış meneceri və ya təchizat əməkdaşı" goal="Müştərinin sifarişi üçün lazım olanı təchizatdan istəmək və təchizatçılardan ən yaxşı qiyməti seçmək">
        Modul «Təchizat» təşkilatınızda açıq olmalıdır. Sorğunu satış yaradır, qiymətləri təchizat toplayır; alış qiymətlərini yalnız rəhbərlik, maliyyə və təchizat görür.
      </HelpScenario>

      <HelpSection title="Bütün yol bir baxışda">
        <p>Satış müştəri ilə razılaşır və sövdələşməyə məhsulları əlavə edir → təchizatdan alış istəyir → təchizat təchizatçılardan təkliflər toplayır və ən yaxşısını seçir → təklifdən təchizatçıya sifariş yaranır → sifariş limitlərə görə təsdiqlənir, göndərilir və mal qəbul edilir → sövdələşmədə real maya dəyəri və marja görünür. Yuxarıdakı video bu yolu əvvəldən axıra göstərir.</p>
      </HelpSection>

      <HelpSection title="Səhifədə nə var">
        <dl className="rounded-md border p-3">
          <HelpDef term="Siyahı">hər sorğunun nömrəsi (PR-0001), adı, sövdələşməsi, statusu və mövqelərinin sayı.</HelpDef>
          <HelpDef term="Süzgəclər"><HelpKey>Açıq</HelpKey>, <HelpKey>Qaralama</HelpKey>, <HelpKey>Sifariş edilib</HelpKey>, <HelpKey>Bağlanıb</HelpKey>, <HelpKey>Hamısı</HelpKey>.</HelpDef>
          <HelpDef term="Statuslar">Qaralama → Təchizata göndərilib → Təchizatda → Sifariş edilib → Bağlanıb; və ya Ləğv edilib.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: sövdələşmədən sorğu">
        <HelpStep n={1}>
          <p>Sövdələşməni açın, <HelpKey>Təchizat</HelpKey> vərəqinə keçin və <HelpKey>Satınalma istə</HelpKey> basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Pəncərə: sövdələşmənin sətirləri ölçü vahidi ilə birlikdə artıq doldurulub; miqdarı dəyişmək, sətri silmək, lazım olan tarixi və qeyd yazmaq olar.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p><HelpKey>Dərhal təchizata göndər</HelpKey> işarəli qalsın və <HelpKey>Yarat</HelpKey> basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Sorğu siyahıda «Təchizata göndərilib» statusu ilə görünür, təchizat əməkdaşı bildiriş alır. Sövdələşmə olmadan sorğu üçün bu səhifədə <HelpKey>Yeni sorğu</HelpKey> düyməsi var.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: təkliflər və sifariş">
        <HelpStep n={1}>
          <p>Sorğunu açın və <HelpKey>İşə götür</HelpKey> basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Status «Təchizatda» olur, sorğu sizin üzərinizdədir.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p><HelpKey>Təklif əlavə et</HelpKey>: təchizatçını seçin, <HelpKey>Çatdırılma müddəti, gün</HelpKey>, <HelpKey>Şərtlər</HelpKey> və hər mövqe üçün <HelpKey>Vahidin qiyməti</HelpKey> yazın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Təklif cədvəldə ayrıca sütun kimi görünür; hər sətirdə ən yaxşı qiymət yaşıl ilə seçilir, aşağıda hər təklifin məbləği.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Qalib təklifin altında <HelpKey>Sifariş et</HelpKey> basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Təchizatçıya sifariş qaralama kimi yaranır və «Bu sorğu üzrə sifarişlər» bölməsində görünür; sorğunun statusu «Sifariş edilib» olur.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">Lazım olmayan təklifi silmək lazım deyil — <HelpKey>Rədd et</HelpKey> basın, sonra fikrinizi dəyişsəniz, <HelpKey>Qaytar</HelpKey> ilə geri qaytarın.</HelpCallout>

      <HelpCallout kind="warning">Sorğu göndərildikdən sonra sövdələşmə dəyişərsə (miqdar, mövqe, müştərinin təsdiqi), sorğu «sövdələşmə dəyişib — yoxlayın» qeydi alır və təchizat bildiriş alır.</HelpCallout>

      <HelpCallout kind="security">Satış öz sorğusunu izləyir, amma təchizatçıların qiymətlərini görmür: «Qiymətləri rəhbərlik, maliyyə və təchizat görür».</HelpCallout>
    </div>
  )
}
