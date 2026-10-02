"use client"

/**
 * Roles & Permissions — help article (Azerbaijani).
 * Settings → Roles & Permissions is a read-only reference of what each
 * built-in role can do; module access for one person is set in the user's card
 * (Settings → Users → "Module access"), and this article says so.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function RolesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Siz təşkilatın administratorusunuz"
        goal="Hər rolun nə edə bildiyini görmək və konkret əməkdaş üçün modulların siyahısını məhdudlaşdırmaq"
      >
        Səhifə <HelpKey>Parametrlər</HelpKey> → <HelpKey>Rollar və İcazələr</HelpKey> vasitəsilə açılır. Bu, məlumat səhifəsidir: burada heç nə redaktə olunmur.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda <HelpKey>«İstifadəçilər»i aç</HelpKey> düyməsi olan kart var: modullara giriş burada deyil, əməkdaşın kartında təyin olunur. Aşağıda daxili rollar və istifadəçi sayları, sonra isə «Hər rol nə edə bilər» cədvəli gəlir: solda modullar, yuxarıda rollar, kəsişmədə giriş səviyyəsi.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Tam">modulun qeydlərini yaratmaq, dəyişmək və silmək.</HelpDef>
          <HelpDef term="Redaktə">yaratmaq və dəyişmək, silmək olmadan.</HelpDef>
          <HelpDef term="Baxış">yalnız oxumaq.</HelpDef>
          <HelpDef term="Yoxdur">modul bu rol üçün əlçatan deyil.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: modulu əməkdaşdan gizlətmək">
        <HelpStep n={1}><HelpKey>«İstifadəçilər»i aç</HelpKey> düyməsini basın və lazım olan əməkdaşı açın (və ya yenisini yaradın).</HelpStep>
        <HelpStep n={2}><HelpKey>Modullara giriş</HelpKey> blokunda ona lazım olmayan modulların işarəsini götürün.</HelpStep>
        <HelpStep n={3}>Yadda saxlayın. Modul əməkdaşın menyusundan növbəti klikdə itəcək, yenidən daxil olmaq lazım deyil.</HelpStep>
        <HelpCallout kind="warning">
          Rollar cədvəli sistemin həqiqətən tətbiq etdiyi hüquqları göstərir. Bu səhifədə onları dəyişmək və ya öz rolunuzu yaratmaq olmur: əməkdaşa daxili rollardan biri verilir.
        </HelpCallout>
        <HelpCallout kind="tip">
          Administrator təşkilatın bütün modullarını həmişə görür — modulu administratordan gizlətmək olmur.
        </HelpCallout>
      </HelpSection>
    </div>
  )
}
