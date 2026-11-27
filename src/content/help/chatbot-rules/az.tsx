"use client"

/** «Автоответы» (/inbox/chatbot-rules) — help article, rewritten with the page on 2026-11-27. */
import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function ChatbotRulesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="Siz müştərilərlə yazışmaya cavabdehsiniz" goal="Tez-tez verilən suallara bot özü cavab versin, lazımi yazışmalar isə dərhal lazımi adama getsin">
        <HelpKey>Avtomatik cavablar</HelpKey> bölməsi — botun müştəriyə özü cavab verdiyi qaydalardır: «<em>qiymət</em> yazsalar → cavab ver … → Leylaya ver». Heç bir qayda uyğun gəlməsə, AI agent və ya menecer cavab verir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <dl className="rounded-md border p-3">
          <HelpDef term="«Avtomatik cavablar açıqdır» açarı">Əsas açar. Söndürülübsə, bot heç bir qayda ilə cavab vermir. Yanında — botun cavab verdiyi kanallar.</HelpDef>
          <HelpDef term="Yoxlayın: müştəri kimi yazın">Mesaj yazın — hansı qaydanın işləyəcəyini və müştərinin nə alacağını görəcəksiniz. Heç nə göndərilmir.</HelpDef>
          <HelpDef term="Qaydalar">Yuxarıdan aşağı yoxlanılır, ilk uyğun gələn işləyir. Sıra oxlarla dəyişir, qayda açarla söndürülür.</HelpDef>
          <HelpDef term="Yazışmadan müraciətlər — lövhəyə">Müştəri ciddi maraqlanıb telefon yazıbsa, AI seçilmiş lövhədə lid və tapşırıq yaradır.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Qayda necə yaradılır">
        <HelpStep n={1}><p><HelpKey>Yeni qayda</HelpKey> düyməsini basın və ad verin.</p></HelpStep>
        <HelpStep n={2}><p>«Müştəri nə yazanda» bölməsində seçin: sözlər (bir-bir yazıb Enter), ilk mesaj və ya istənilən mesaj.</p></HelpStep>
        <HelpStep n={3}><p>Cavabı yazın. <HelpKey>+ Müştərinin adı</HelpKey> göndərəndə adı qoyacaq; mətni «Hazır cavablar»dan da götürmək olar.</p></HelpStep>
        <HelpStep n={4}>
          <p>«Sonra» bölməsində <HelpKey>Əməkdaşa ver</HelpKey> seçə bilərsiniz: yazışma ona veriləcək, bildiriş gələcək, AI orada artıq cavab vermir. Bir neçə nəfər seçsəniz — açıq yazışması az olana.</p>
          <HelpCallout kind="tip">Səhifənin aşağısındakı hazır qaydalarla başlayın — hər biri bir kliklə əlavə olunur və dərhal işləyir.</HelpCallout>
        </HelpStep>
      </HelpSection>
    </div>
  )
}
