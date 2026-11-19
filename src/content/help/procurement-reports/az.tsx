"use client"

/**
 * «Təchizat hesabatları» — xərc, müddətlər və marja (Azərbaycan dili).
 */
import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function ProcurementReportsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="Rəhbər, maliyyə və ya təchizat" goal="Dövr üzrə alışa baxmaq: nə qədər xərcləndi, təchizatçılar vaxtında gətirdimi, sövdələşmələr nə qədər qazandırdı">
        Hesabatda seçilmiş dövrdə yaradılan təchizatçı sifarişləri var. Hesabatları və onların fayllarını rəhbərlik, maliyyə və təchizat görür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <dl className="rounded-md border p-3">
          <HelpDef term="Göstəricilər">Sifariş, Xərc (təsdiqlənmiş), Vaxtında, Orta gecikmə, İndi gecikir, Təsdiq müddəti.</HelpDef>
          <HelpDef term="Təchizatçılar">hər təchizatçı üzrə sifariş sayı, xərc, vaxtında və gecikmə ilə gələnlər, orta gecikmə (gün).</HelpDef>
          <HelpDef term="Sövdələşmələr üzrə marja">gəlir, maya dəyəri və marja; başqa valyutada olan sifariş qarışdırılmır — «başqa valyuta» kimi göstərilir.</HelpDef>
          <HelpDef term="Sifarişlər">nömrə, təchizatçı, sövdələşmə, status, gözlənilən tarix və məbləğ.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım">
        <HelpStep n={1}>
          <p><HelpKey>Başlanğıc</HelpKey> və <HelpKey>Son</HelpKey> tarixlərini seçin və <HelpKey>Göstər</HelpKey> basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Göstəricilər və üç cədvəl həmin dövr üzrə yenilənir.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Faylı lazımdırsa — <HelpKey>Excel</HelpKey> və ya <HelpKey>PDF</HelpKey> basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Hesabat seçilmiş dövr üzrə fayl kimi yüklənir.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">«Vaxtında» və «Orta gecikmə» təqvim günləri ilə hesablanır: gözlənilən tarixlə faktiki qəbul arasında.</HelpCallout>

      <HelpCallout kind="warning">Valyutalar toplanmır: CRM-də məzənnə yoxdur, ona görə başqa valyutada olan xərc ayrıca göstərilir və marjaya düşmür.</HelpCallout>
    </div>
  )
}
