"use client"

/**
 * Healthcare → Providers (Həkimlər və Heyət) — help article (Azerbaijani).
 * Healthcare vertical-in ümumi məqaləsindən ayrılıb: yalnız
 * Səhiyyə → Həkimlər və Heyət (health/providers) səhifəsini əhatə edir —
 * mütəxəssis siyahısı (cədvəl), statistika kartları, axtarış + rol filtri,
 * "Daha çox yüklə". Bu səhifə YALNIZ oxumaq üçündür: burada yaratma/redaktə
 * düyməsi YOXDUR. Axtarış yalnız e-poçt və NPI üzrə işləyir (ad şifrələnib).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function healthprovidersHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Klinika administratoru və ya əməliyyat işçisisiniz"
        goal="Təşkilatınızdakı tibb mütəxəssislərinin və klinik heyətin siyahısını gözdən keçirmək, rola görə süzgəcdən keçirmək və konkret mütəxəssisi e-poçt və ya NPI ilə tapmaq"
      >
        Səhifəyə <HelpKey>Səhiyyə</HelpKey> → <HelpKey>Həkimlər və Heyət</HelpKey> yolu ilə
        çatırsınız. Bu səhifə <strong>yalnız oxumaq üçündür</strong> — burada heyəti gözdən keçirir,
        süzür və axtarırsınız; yaratma və ya redaktə düyməsi yoxdur. Bütün mütəxəssislər yalnız sizin
        təşkilatınıza aiddir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda mavi insan ikonası, yanında <HelpKey>Həkimlər və Heyət</HelpKey> adı və altında
          «Tibb mütəxəssisləri və klinik heyət.» izahı durur. Altda dörd statistika kartı var:{" "}
          <strong>Ümumi Mütəxəssis</strong>, <strong>Aktiv</strong>, <strong>Həkimlər</strong> və{" "}
          <strong>Tibb bacıları / NP</strong>. Kartların altında bir süzgəc zolağı (axtarış qutusu, rol
          açılan siyahısı və yeniləmə düyməsi), sonra isə mütəxəssis cədvəli gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi Mütəxəssis">Yüklənmiş siyahıdakı bütün mütəxəssislərin sayı.</HelpDef>
          <HelpDef term="Aktiv">Yüklənmiş siyahıda <strong>Aktiv</strong> statuslu mütəxəssislərin sayı.</HelpDef>
          <HelpDef term="Həkimlər">Rolu «Həkim» olan mütəxəssislərin sayı.</HelpDef>
          <HelpDef term="Tibb bacıları / NP">Rolu «Qeydiyyatlı Tibb Bacısı» və ya «Praktiki Tibb Bacısı» olanların sayı.</HelpDef>
          <HelpDef term="Mütəxəssis (sütun)">Mütəxəssisin adı, altında isə (varsa) e-poçtu.</HelpDef>
          <HelpDef term="Rol">Rəngli nişan — Həkim, Praktiki Tibb Bacısı, Həkim Köməkçisi, Qeydiyyatlı Tibb Bacısı, Mütəxəssis, Terapevt, Texnik və ya Administrator.</HelpDef>
          <HelpDef term="İxtisas">Mütəxəssisin sahəsi (məs. kardiologiya); boşdursa «—» göstərilir.</HelpDef>
          <HelpDef term="NPI">Mütəxəssisin NPI nömrəsi (ABŞ reyestri nömrəsi); boşdursa «—» göstərilir.</HelpDef>
          <HelpDef term="Status">Yaşıl <strong>Aktiv</strong> və ya boz <strong>Qeyri-aktiv</strong> nişanı.</HelpDef>
        </dl>
        <p>
          Cədvəldə <strong>Mütəxəssis</strong>, <strong>Rol</strong> və <strong>Status</strong> sütunları
          başlığa basıldıqda sıralana bilir. Cədvəlin altında, daha çox sətir varsa,{" "}
          <HelpKey>Daha çox yüklə</HelpKey> düyməsi peyda olur.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: heyəti rola görə süz">
        <HelpStep n={1}>
          <p>
            Süzgəc zolağındakı rol açılan siyahısını açın (standart olaraq{" "}
            <HelpKey>Bütün rollar</HelpKey> seçilidir).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahıda «Bütün rollar» variantı, sonra səkkiz rol gəlir: Həkim, Praktiki Tibb
            Bacısı, Həkim Köməkçisi, Qeydiyyatlı Tibb Bacısı, Mütəxəssis, Terapevt, Texnik və
            Administrator.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Bir rol seçin (məs. <HelpKey>Həkim</HelpKey>).</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl dərhal yenidən yüklənir və yalnız seçdiyiniz rola uyğun mütəxəssisləri göstərir.
            Statistika kartlarındakı saylar da yenilənmiş siyahıya uyğun olaraq dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bütün heyətə qayıtmaq üçün açılan siyahıdan yenidən <HelpKey>Bütün rollar</HelpKey> seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl bütün rolları yenidən göstərir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: mütəxəssis axtar">
        <HelpStep n={1}>
          <p>
            Süzgəc zolağının solundakı axtarış qutusuna klikləyin — içində «E-poçt və ya NPI ilə
            axtarın…» yazısı var.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qutunun solunda axtarış (böyüdücü) ikonası durur. Yazmağa başlayanda mətn qutuya düşür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Axtardığınız mütəxəssisin <strong>e-poçtunu</strong> və ya <strong>NPI nömrəsini</strong>{" "}
            yazın (ən azı iki simvol).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazmağı dayandırandan təxminən bir saniyə sonra cədvəl avtomatik yenilənir (düyməyə
            basmaq lazım deyil) və yalnız uyğun gələn sətirlər qalır. Statistika kartları da nəticəyə
            görə yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Axtarışı təmizləmək üçün qutudakı mətni silin.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl bütün siyahıya (cari rol süzgəci daxilində) qayıdır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Axtarış yalnız <strong>e-poçt</strong> və <strong>NPI</strong> üzrə işləyir.{" "}
            <strong>Ada görə axtarış işləmir</strong> — mütəxəssisin adı təhlükəsizlik üçün
            şifrələnmiş saxlanılır, ona görə də sistem onun içində mətn axtara bilmir. Konkret adamı
            tapmaq üçün onun e-poçtundan və ya NPI nömrəsindən istifadə edin (və ya əvvəlcə rola görə
            süzün, sonra cədvəldə baxın).
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: siyahını yenilə və daha çox yüklə">
        <HelpStep n={1}>
          <p>
            Siyahını ən son vəziyyətə gətirmək üçün süzgəc zolağının sağındakı yeniləmə düyməsini
            (dairəvi ox ikonası) basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl yenidən yüklənir və mövcud süzgəclərlə (rol/axtarış) ilk səhifəni göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Siyahı bir səhifəyə sığmayacaq qədər uzundursa, cədvəlin altındakı{" "}
            <HelpKey>Daha çox yüklə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Növbəti mütəxəssislər mövcud sətirlərin sonuna əlavə olunur. Daha sətir qalmayanda düymə
            yox olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Statistika kartlarındakı saylar <strong>ekrana yüklənmiş</strong> sətirlərə əsaslanır.
          Çox böyük heyətdə daha dəqiq mənzərə üçün əvvəlcə rola görə süzün — onda kartlar yalnız həmin
          rolu sayar.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün mütəxəssislər təşkilatınızla məhdudlaşır — başqa təşkilatın heyətini görmürsünüz.
          Mütəxəssis adları şifrələnmiş saxlanılır və hər baxış HIPAA üzrə giriş jurnalına yazılır.
          Səhiyyə modulu üçün «oxumaq» icazəsi olmayan istifadəçilər bu səhifəni aça bilmir.
        </p>
      </HelpCallout>
    </div>
  )
}
