"use client"

/**
 * VoIP Zənglər — help article (Azerbaijani), video-script format.
 * Yalnız Dəstək → VoIP Zənglər səhifəsini əhatə edir
 * (src/app/(dashboard)/support/voip/page.tsx): bağlantı göstəricisi,
 * statistika kartları, süzgəc/axtarış, zəng jurnalı cədvəli, boş vəziyyət,
 * səhifələmə. Provayder qurğusu (Tənzimləmələr → VoIP) ayrıca məqalədir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function VoipHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış və ya dəstək nümayəndəsi, yaxud komanda rəhbərisiniz"
        goal="Bütün gələn və gedən zəngləri bir jurnalda izləmək, hər zəngi düzgün kontakta bağlamaq və VoIP provayderinin qoşulu olduğunu yoxlamaq"
      >
        Səhifəyə <HelpKey>Dəstək</HelpKey> → <HelpKey>VoIP Zənglər</HelpKey> yolu ilə çatırsınız.
        Bütün zənglər yalnız sizin təşkilatınız üçündür. Zənglər jurnala yalnız VoIP provayderi
        qoşulandan sonra avtomatik düşür — buna görə səhifənin başında canlı bağlantı göstəricisi
        durur. Provayder hələ qoşulmayıbsa cədvəl boş qalır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda telefon ikonu ilə <HelpKey>VoIP Zənglər</HelpKey> adı, altında «Zəng jurnalı,
          klikləmə ilə zəng, gələn zəng bildirişləri» izahı var. Sağ yuxarıda üç element gəlir:{" "}
          canlı <strong>bağlantı göstəricisi</strong> (rəngli nöqtə + mətn),{" "}
          <HelpKey>Yoxla</HelpKey> düyməsi və <HelpKey>Parametrlər</HelpKey> düyməsi (Tənzimləmələr →
          VoIP-ə aparır). Altda dörd statistika kartı, sonra süzgəc cərgəsi və zəng cədvəli durur.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Bağlantı göstəricisi">Yaşıl nöqtə + «Qoşulub», qırmızı nöqtə + «Bağlantı yoxdur», yaxud fırlanan ikon + «Yoxlanılır…» — provayderlə əlaqənin cari vəziyyəti.</HelpDef>
          <HelpDef term="Ümumi zənglər">Süzgəcə uyğun gələn bütün zənglərin gerçək sayı (bütün səhifələr üzrə, serverdən gəlir).</HelpDef>
          <HelpDef term="Gələn / Gedən">Yalnız cari səhifədəki zənglərin istiqamət üzrə sayı (ümumi deyil, baxdığınız 25-lik səhifənin xülasəsidir).</HelpDef>
          <HelpDef term="Orta müddət">Cari səhifədəki müddəti olan zənglərin orta dəyəri, dəqiqə:saniyə formatında.</HelpDef>
          <HelpDef term="İstiqamət">Gələn (mavi) və ya gedən (yaşıl) — cədvəldə ox ikonası ilə göstərilir.</HelpDef>
          <HelpDef term="Status">Başladıldı, zəng gəlir, davam edir, tamamlandı, cavab yoxdur, məşğuldur, uğursuz — rəngli nişanla.</HelpDef>
          <HelpDef term="Zəng nəticəsi">Nümayəndənin teqlədiyi nəticə: maraqlıdır, maraqlı deyil, geri zəng, səsli poçt, yanlış nömrə, cavab yoxdur, digər.</HelpDef>
          <HelpDef term="Qeyd">Zəngin audio qeydi — varsa, Play ikonası yeni tabda açır.</HelpDef>
        </dl>
        <p>
          Cədvəlin sütunları: <strong>Tarix</strong>, <strong>İstiqamət</strong>,{" "}
          <strong>Nömrə</strong>, <strong>Əlaqə</strong>, <strong>Müddət</strong>,{" "}
          <strong>Status</strong>, <strong>Zəng nəticəsi</strong> və <strong>Qeyd</strong>. Hər
          səhifədə 25 zəng göstərilir; daha çox olduqda cədvəlin altında səhifələmə zolağı çıxır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: bağlantını yoxla">
        <HelpStep n={1}>
          <p>
            Səhifə açılanda başlıqdakı <strong>bağlantı göstəricisinə</strong> baxın. İstənilən vaxt
            yenidən yoxlamaq üçün sağ yuxarıdakı <HelpKey>Yoxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yoxlama gedərkən nöqtə yerinə fırlanan ikon və «Yoxlanılır…» mətni görünür. Bitəndə
            yaşıl nöqtə + <strong>Qoşulub</strong> (provayder işləyir) və ya qırmızı nöqtə +{" "}
            <strong>Bağlantı yoxdur</strong> (qoşulma uğursuz) görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bağlantı yoxdursa, provayderi qurmaq üçün <HelpKey>Parametrlər</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tənzimləmələr → VoIP səhifəsinə keçirsiniz, orada provayderi seçib giriş məlumatlarını
            daxil edirsiniz. Qurğunu bitirib bu səhifəyə qayıdanda <HelpKey>Yoxla</HelpKey> ilə
            göstərici yenidən yaşıla dönməlidir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: zəngləri süz və axtar">
        <HelpStep n={1}>
          <p>
            İstiqamət düymələrindən birini seçin: <HelpKey>Hamısı</HelpKey>,{" "}
            <HelpKey>Gələn</HelpKey> və ya <HelpKey>Gedən</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş düymə dolu (tünd) görünür, qalanları çərçivəli qalır. Cədvəl dərhal yalnız həmin
            istiqamətdəki zəngləri göstərir və siyahı birinci səhifəyə qayıdır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Müəyyən nömrəni tapmaq üçün soldakı axtarış qutusuna telefon nömrəsini yazın (placeholder:
            «Telefon nömrəsinə görə axtar...»).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca cədvəl o nömrəyə uyğun zənglərə süzülür və <strong>Ümumi zənglər</strong> kartı
            uyğun gələn nəticələrin gerçək sayını göstərir. Hər dəyişiklikdə siyahı birinci səhifəyə
            qayıdır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Yuxarıdakı kartlardan yalnız <strong>Ümumi zənglər</strong> bütün nəticələri sayır;{" "}
            <strong>Gələn</strong>, <strong>Gedən</strong> və <strong>Orta müddət</strong> isə yalnız
            ekranda gördüyünüz cari səhifəni ümumiləşdirir. Səhifəni dəyişəndə bu üç dəyər də dəyişə
            bilər.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: bir zəng sətrini oxu">
        <HelpStep n={1}>
          <p>
            Cədvəldəki istənilən sətrə baxın. <strong>İstiqamət</strong> sütununda ox ikonası gələn
            (mavi) yoxsa gedən (yaşıl) olduğunu göstərir; <strong>Nömrə</strong> sütununda qarşı
            tərəfin nömrəsi monospace şriftlə durur.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Status</strong> sütununda rəngli nişan (məs. yaşıl «Tamamlandı», qırmızı
            «Uğursuz»), <strong>Zəng nəticəsi</strong> sütununda isə teqlənmiş nəticə var — heç biri
            yoxdursa «—» tire göstərilir. <strong>Müddət</strong> dəqiqə:saniyə kimi yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Zəng kontakta bağlıdırsa, <strong>Əlaqə</strong> sütunundakı ada klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Həmin kontaktın səhifəsinə keçirsiniz. Zəng heç bir kontaktla uyğunlaşmayıbsa, ad yerinə
            «—» tire görünür və klikləmək olmur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Zəngi dinləmək üçün <strong>Qeyd</strong> sütunundakı <HelpKey>Play</HelpKey> ikonasını
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qeyd yeni tabda açılır. Play ikonası yalnız həmin zəng üçün qeyd mövcud olduqda görünür;
            qeyd yoxdursa burada «—» tire durur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: səhifələr arasında keç">
        <HelpStep n={1}>
          <p>
            Zəng sayı 25-i keçəndə cədvəlin altında səhifələmə zolağı çıxır.{" "}
            <HelpKey>Geri</HelpKey> və <HelpKey>İrəli</HelpKey> düymələri ilə hərəkət edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Solda cari mövqe — «səhifə / ümumi səhifə (ümumi zənglər)» kimi — göstərilir. Birinci
            səhifədə <HelpKey>Geri</HelpKey>, sonuncuda <HelpKey>İrəli</HelpKey> deaktiv olur. Yalnız
            bir səhifə varsa, bu zolaq ümumiyyətlə görünmür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          Cədvəl yüklənərkən bir neçə boz «skelet» sətir göstərilir. Heç zəng yoxdursa — provayder
          hələ qoşulmayıb və ya süzgəcə uyğun nəticə tapılmayıbsa — telefon ikonu ilə birlikdə{" "}
          <strong>«Hələ zəng yoxdur»</strong> və altında «VoIP provayder qoşulduqdan sonra zənglər
          burada görünəcək» mətni çıxır. Bu, xəta deyil — sadəcə hələ jurnala düşən zəng yoxdur.
        </p>
      </HelpCallout>

      <HelpCallout kind="tip">
        <p>
          Bağlantı göstəricisi səhifə açılanda bir dəfə avtomatik yoxlanır. Provayderi yeni
          qoşmusunuzsa və ya kənarda bir şey dəyişdirmisinizsə, jurnalı yeniləmədən əvvəl{" "}
          <HelpKey>Yoxla</HelpKey> ilə vəziyyəti təzələyin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün zənglər, qeydlər və kontakt bağlantıları təşkilatınızla məhdudlaşır — yalnız öz
          tenant-ınızın zənglərini görürsünüz, başqa təşkilatın jurnalı sizə görünmür. Kontakt
          adına klikləmək yalnız sizin tenant-ınızdakı kontaktın səhifəsini açır.
        </p>
      </HelpCallout>
    </div>
  )
}
