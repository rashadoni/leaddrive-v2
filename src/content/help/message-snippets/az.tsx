"use client"

import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MessageSnippetsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Inbox administratoru və ya komanda rəhbərisiniz"
        goal="Agentlər eyni cavabı təkrar yazmasın deyə hazır cavablar hazırlamaq"
      >
        Mesaj snippetləri inbox composer-i üçün hazır cavablardır. Agent <HelpKey>/greeting</HelpKey> kimi slash
        komandası yazır, snippet seçir, mətni yoxlayır və dialoqdan göndərir.
      </HelpScenario>

      <HelpSection title="Hər sahə nə deməkdir">
        <dl className="rounded-md border p-3">
          <HelpDef term="Qısayol">Agentin slash-dan sonra yazdığı söz. Bir söz olmalıdır, boşluq və / olmamalıdır.</HelpDef>
          <HelpDef term="Başlıq">Komanda üçün daxili ad. Müştərilər bunu görmür.</HelpDef>
          <HelpDef term="Mətn">
            Müştəriyə gedəcək cavab mətni. <code>{"{{contact.name}}"}</code> və <code>{"{{agent.name}}"}</code>{" "}
            kimi dəyişənlərdən istifadə edə bilərsiniz.
          </HelpDef>
          <HelpDef term="Kanallar">
            Mətn bütün kanallara uyğundursa boş saxlayın. Cavab yalnız WhatsApp, Telegram, SMS, email və ya web
            chat üçün görünməlidirsə həmin kanalları seçin.
          </HelpDef>
          <HelpDef term="Aktiv">
            Snippet saxlanılsın, amma agentlərə inbox-da görünməsin deyə bunu söndürün.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Snippet yarat">
        <HelpStep n={1}>
          <p>
            <HelpKey>Yeni snippet</HelpKey> düyməsini basın, qısa qısayol və aydın daxili başlıq yazın.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Hazır cavabı <HelpKey>Mətn</HelpKey> sahəsinə yazın. Mətn göndərilməyə hazır olmalıdır, amma agent
            göndərməzdən əvvəl onu görəcək.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bütün kanallar üçün <HelpKey>Kanallar</HelpKey> sahəsini boş saxlayın və ya snippet-in görünəcəyi
            konkret kanalları seçin.
          </p>
          <HelpCallout kind="tip">
            Kanal üzrə snippetlər ton, linklər və format WhatsApp, SMS, email və web chat arasında fərqli olanda
            faydalıdır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>
    </div>
  )
}
