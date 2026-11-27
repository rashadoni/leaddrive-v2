"use client"

import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function MessageSnippetsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="Siz yazışmalara cavab verən komandanın rəhbərisiniz" goal="Menecerlər eyni cavabı hər dəfə yenidən yazmasın">
        Hazır cavablar — müştərilərə tez-tez yazılan cavablardır. Yazışmada <HelpKey>/</HelpKey> yazın, siyahıdan cavabı seçin: müştərinin adı özü yerinə düşür, mətni göndərməzdən əvvəl düzəldə bilərsiniz.
      </HelpScenario>

      <HelpSection title="Pəncərədəki sahələr">
        <dl className="rounded-md border p-3">
          <HelpDef term="Yazışmada nə yazmalı">/ işarəsindən sonra yazılan bir söz, məsələn <HelpKey>/salam</HelpKey>. Boşluq və / özü silinir.</HelpDef>
          <HelpDef term="Ad">Yalnız əməkdaşlar görür — siyahıda cavabı tapmaq üçün.</HelpDef>
          <HelpDef term="Cavabın mətni">Müştərinin görəcəyi mətn. «+ Müştərinin adı», «+ Mənim adım» düymələri mətnə narıncı söz qoyur — göndərəndə o, müştərinin məlumatı ilə əvəz olunur.</HelpDef>
          <HelpDef term="Harada göstərilsin">«Bütün kanallarda» və ya «Yalnız seçilmişlərdə» — məsələn, yalnız WhatsApp və SMS üçün.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Cavab necə yaradılır">
        <HelpStep n={1}>
          <p>İlk dəfə: «Hazır nümunələrlə başlayın» blokunda lazım olanı <HelpKey>Əlavə et</HelpKey> ilə əlavə edin.</p>
        </HelpStep>
        <HelpStep n={2}>
          <p>Öz mətniniz üçün <HelpKey>Yeni cavab</HelpKey> düyməsini basın və üç sahəni doldurun. Sağda müştərinin görəcəyi mətn görünür.</p>
        </HelpStep>
        <HelpStep n={3}>
          <p><HelpKey>Cavabı yadda saxla</HelpKey> basın və yazışmada / yazaraq yoxlayın. Səhifənin yuxarısındakı pəncərədə də yoxlamaq olar.</p>
          <HelpCallout kind="tip">Cavabı müvəqqəti gizlətmək üçün sətirdəki açarı söndürün — cavab silinmir.</HelpCallout>
        </HelpStep>
      </HelpSection>
    </div>
  )
}
