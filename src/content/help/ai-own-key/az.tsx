"use client"

/**
 * Öz Gemini açarı — yardım məqaləsi (Azərbaycan dili). Yalnız administratorlar üçün:
 * «Parametrlər → AI və xərclər» ekranından açılır. Google addımları Google AI Studio
 * sənədlərinə əsasən (açar və ödəniş), 2026-11-23 tarixində oxunub.
 */
import { HelpCallout, HelpDef, HelpKey, HelpScenario, HelpSection, HelpStep } from "@/components/help/help-content"

export default function AiOwnKeyHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="Təşkilatın administratoru" goal="AI üçün Google-a birbaşa ödəmək: öz Gemini açarını qoşmaq">
        Susmaya görə AI LeadDrive açarı ilə işləyir və heç nə etmək lazım deyil. Öz açarınız yalnız Google-a
        özünüz ödəmək qərarına gəldikdə lazımdır. Şirkətin Google hesabı və bank kartı lazım olacaq.
      </HelpScenario>

      <HelpSection title="Nə dəyişəcək">
        <dl className="rounded-md border p-3">
          <HelpDef term="Sizin açarla işləyəcək">Telefon zənglərində AI-ın danışığı və səsli assistent. Onların hesabını Google sizə göndərəcək.</HelpDef>
          <HelpDef term="LeadDrive açarında qalacaq">Xəttin səslə oxunuşu və zənglərdə nitqin tanınması.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım">
        <HelpStep n={1}>
          <p><HelpKey>aistudio.google.com/apikey</HelpKey> ünvanını açın və şirkətin Google hesabına daxil olun.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Açarlar səhifəsi. Yeni istifadəçi üçün Google şərtləri qəbul etdikdən sonra layihəni və ilk açarı özü yaradır.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Siyahıda açar yoxdursa, <HelpKey>Create API key</HelpKey> düyməsini basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Siyahıda yeni açar.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Ödənişi qoşun: layihənin sətrində, <HelpKey>Billing Tier</HelpKey> sütununda <HelpKey>Set up billing</HelpKey> düyməsini basın. Ölkəni və kartı göstərin, ilkin ödəniş edin (5 dollardan).</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Layihə pulsuz səviyyədən ödənişli səviyyəyə keçdi. Pulsuz səviyyədə limitlər azdır — zənglər üçün ödənişli səviyyə lazımdır.</HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>Açarı tam kopyalayın.</p>
        </HelpStep>
        <HelpStep n={5}>
          <p>CRM-də <HelpKey>Parametrlər</HelpKey> → <HelpKey>AI və xərclər</HelpKey> bölməsini açın. <HelpKey>AI provayderlərinin açarları</HelpKey> blokunda, Gemini sətrində <HelpKey>Öz açarını daxil et</HelpKey> düyməsini basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">«Gemini açarı» sahəsi.</HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>Açarı yapışdırın və <HelpKey>Yoxla və yadda saxla</HelpKey> düyməsini basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Gemini sətrində — «Sizin açar» və onun son 4 simvolu. Google açarı qəbul etməsə, CRM bunu bildirəcək və heç nə saxlamayacaq.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="İşlədiyini necə yoxlamaq">
        <p>Növbəti zəngdən və ya assistentlə söhbətdən sonra bu ekrandakı xərclər cədvəlini açın: sətrin <HelpKey>Kimin açarı</HelpKey> sütununda «Sizin açar» yazılıb.</p>
      </HelpSection>

      <HelpSection title="Əvvəlki kimi qaytarmaq">
        <p>Gemini sətrində <HelpKey>Açarı sil</HelpKey> düyməsini basın. AI yenidən LeadDrive açarı ilə işləyir.</p>
      </HelpSection>

      <HelpCallout kind="warning" label="Vacibdir">
        Google zəng zamanı açarınızı rədd etsə (məsələn, hesabda pul bitibsə), zəng kəsilməyəcək: o, LeadDrive açarı ilə keçəcək və LeadDrive açarı üzrə xərcə düşəcək.
      </HelpCallout>
      <HelpCallout kind="security" label="Təhlükəsizlik">
        Açar şifrələnmiş saxlanılır. Ekranda yalnız son 4 simvolu görünür, o da yalnız administratorlara.
      </HelpCallout>
    </div>
  )
}
