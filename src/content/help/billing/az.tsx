"use client"

/**
 * Settings → Billing — help article (Azerbaijani).
 * Yalnız Tənzimləmələr → Hesablaşma səhifəsini əhatə edir.
 * DİQQƏT: bu səhifə hazırda yalnız başlıq (header) göstərən
 * giriş/yer-tutucu səhifədir — tarif kartları, faktura cədvəli və
 * ödəniş formaları BURADA RENDER OLUNMUR. Onları uydurmaq olmaz.
 * Abunələrin/MRR-in real idarəsi ayrı "Abunələr" səhifəsindədir
 * (slug="subscriptions") — bura yalnız istiqamətləndirici qeyd kimi
 * göstərilir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function BillingHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Təşkilat administratoru və ya hesab sahibisiniz"
        goal="Hesablaşma (billing) bölməsini tapmaq — tariflər, fakturalar və ödəniş üsulları ilə bağlı yeri açmaq"
      >
        Bu səhifəyə <HelpKey>Parametrlər</HelpKey> → <HelpKey>Hesablaşma</HelpKey> yolu ilə çatırsınız.
        Bölmə təşkilatınıza aiddir. Qeyd: hazırda <strong>Hesablaşma</strong> səhifəsi yalnız başlıq
        göstərən giriş səhifəsidir — burada hələ tarif kartları, faktura siyahısı və ya ödəniş formaları
        yoxdur. Bu məqalə sizə bölməni necə tapmağı və hansı yerin nəyə xidmət etdiyini izah edir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          <HelpKey>Parametrlər</HelpKey> əsas səhifəsində kartlar şəbəkəsi var. Bunlardan biri kredit-kart
          ikonalı <strong>Hesablaşma</strong> kartıdır: altında «Tariflər, fakturalar, ödəniş üsulları»
          təsviri, adın yanında kiçik məlumat işarəsi (info-hint) və sağda irəli ox (chevron) durur. Bu
          karta klikləyəndə <HelpKey>Hesablaşma</HelpKey> səhifəsi açılır.
        </p>
        <p>
          <HelpKey>Hesablaşma</HelpKey> səhifəsinin özündə hazırda yalnız <strong>başlıq</strong>{" "}
          («Hesablaşma») və başlığın yanında <strong>tur təkrarı</strong> düyməsi (kiçik ikona) görünür.
          Tur təkrarı düyməsi səhifə üzrə qısa təlim turunu yenidən oynadır. Başqa idarəetmə elementi
          (tarif seçimi, faktura cədvəli, ödəniş kartı əlavə etmə) bu səhifədə hələ render olunmur.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Hesablaşma kartı">Parametrlər şəbəkəsindəki giriş nöqtəsi — kredit-kart ikonası, «Tariflər, fakturalar, ödəniş üsulları» təsviri ilə.</HelpDef>
          <HelpDef term="Hesablaşma başlığı">Səhifənin yuxarısındakı ad — hazırda səhifədə görünən əsas (və demək olar ki, yeganə) element.</HelpDef>
          <HelpDef term="Tur təkrarı düyməsi">Başlığın yanındakı kiçik ikona — səhifənin təlim turunu yenidən başladır.</HelpDef>
          <HelpDef term="Məlumat işarəsi (hint)">Parametrlər kartındakı ad yanında kiçik «i» — üstünə gələndə qısa izah göstərir.</HelpDef>
        </dl>
        <p>
          Tarif planlarının, aylıq təkrar gəlirin (MRR), sınaq müddətlərinin və vaxtı keçmiş ödənişlərin
          real idarəsi ayrıca <strong>Abunələr</strong> səhifəsində aparılır — aşağıdakı qeydə baxın.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: Hesablaşma bölməsini aç">
        <HelpStep n={1}>
          <p>
            Sol menyudan və ya hesab menyusundan <HelpKey>Parametrlər</HelpKey> bölməsinə keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Başlıqda «Parametrlər», altında «Hesab və sistem parametrlərini idarə edin» izahı və kartlar
            şəbəkəsi görünür. Kartlardan biri kredit-kart ikonalı <strong>Hesablaşma</strong> kartıdır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Kredit-kart ikonalı <HelpKey>Hesablaşma</HelpKey> kartına klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart üstünə gələndə kölgəsi qalxır (klikləyə biləcəyinizin işarəsi). Klikdən sonra brauzer{" "}
            <HelpKey>/settings/billing</HelpKey> ünvanına keçir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Açılan <HelpKey>Hesablaşma</HelpKey> səhifəsini nəzərdən keçirin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Səhifənin yuxarısında «Hesablaşma» başlığı və yanında tur təkrarı düyməsi görünür. Səhifəyə ilk
            dəfə girəndə qısa təlim turu avtomatik açıla bilər; istənilən vaxt həmin düymə ilə onu yenidən
            oynada bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="next">
        <p>
          Tarif planlarını, abunələrin vəziyyətini, sınaq müddətlərini, vaxtı keçmiş ödənişləri və aylıq
          təkrar gəliri (MRR) görmək/idarə etmək üçün <strong>Abunələr</strong> səhifəsinə keçin — onun öz
          ayrıca yardım məqaləsi var. Hesablaşma kartının «Tariflər, fakturalar, ödəniş üsulları» təsviri
          məhz həmin bölmələrə işarədir.
        </p>
      </HelpCallout>

      <HelpCallout kind="tip">
        <p>
          Hesablaşma kartındakı kiçik «i» (info) işarəsinin üstünə gəlin — orada bölmənin nəyə xidmət
          etdiyini izah edən qısa ipucu var. Səhifəni səhvən bağlasanız, sadəcə yenidən{" "}
          <HelpKey>Parametrlər</HelpKey> → <HelpKey>Hesablaşma</HelpKey> ardıcıllığını təkrarlayın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Hesablaşma və abunə məlumatları təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın hesablaşma
          məlumatlarını görürsünüz. Bu səhifə adətən administrator/hesab sahibi səviyyəli giriş tələb edir;
          kartı görmürsünüzsə, icazələrinizi yoxlayın.
        </p>
      </HelpCallout>
    </div>
  )
}
