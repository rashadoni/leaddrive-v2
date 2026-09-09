"use client"

/**
 * Insurance Cloud — landing/overview help article (Azerbaijani).
 * "industries" ümumi məqaləsindən ayrılıb: yalnız Sığorta Buludu
 * vertikalının giriş səhifəsini (/insurance) əhatə edir — sığortalılar
 * siyahısı, dörd statistika kartı, axtarış/status filtri, cədvəl və
 * sətrə klik ilə sığortalı detalına keçid. Polis/iddia/benefisiar
 * alt-səhifələri bu məqaləyə DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function insuranceoverviewHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sığorta şirkətində satış və ya portfel idarəçisisiniz"
        goal="Sığorta Buludunun giriş səhifəsindən bütün sığortalıların siyahısını görmək, axtarmaq, filtrləmək və ayrıca sığortalının detalına keçmək"
      >
        Bu, <HelpKey>Sığorta Buludu</HelpKey> vertikalının giriş səhifəsidir və əslində{" "}
        <strong>sığortalılar (policy holders) siyahısıdır</strong>. Başlıqdakı{" "}
        <HelpKey>Sığorta Buludu</HelpKey> adının yanında bu məqaləni açan kömək düyməsi var.
        Bütün sığortalılar, polislər və iddialar yalnız sizin təşkilatınıza aiddir — sayğaclar
        və cədvəl eyni məlumatdan oxunur, ona görə axtarış və ya status dəyişdikcə nəticə dərhal
        yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda sol tərəfdə bənövşəyi çətir ikonası, başlıq <HelpKey>Sığorta Buludu</HelpKey> və
          altında «Sığortalılar, polislər, iddialar və benefisiarların idarəsi» izahı durur. Sağ
          yuxarıda <HelpKey>Yeni Sığortalı</HelpKey> düyməsi var. Altında dörd statistika kartı
          sıralanır, sonra axtarış zolağı (axtarış sahəsi + status seçimi + yeniləmə düyməsi), ən
          altda isə sığortalıların cədvəli gəlir. Cədvəldə məlumat yoxdursa, onun yerinə «Məlumat
          yoxdur» mətni göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi Sığortalı">Hazırda yüklənmiş sığortalıların sayı.</HelpDef>
          <HelpDef term="Aktiv Sığortalılar">Statusu «Aktiv» olan sığortalıların sayı.</HelpDef>
          <HelpDef term="Polislər">Təşkilat üzrə sığorta polislərinin sayğacı.</HelpDef>
          <HelpDef term="İddialar">Təşkilat üzrə sığorta iddialarının sayğacı.</HelpDef>
          <HelpDef term="Sığortalı">Sığorta polisinin sahibi olan şəxs — nömrəsi, adı, statusu, telefonu və aktivləşmə tarixi ilə cədvəldə bir sətir.</HelpDef>
          <HelpDef term="Status">Sığortalının vəziyyəti: Potensial, Aktiv, Qeyri-aktiv və ya Vəfat edib — rəngli nişanla göstərilir.</HelpDef>
        </dl>
        <p>
          Cədvəlin sütunları: <strong>Sığortalı №</strong> (monoşrift nömrə), <strong>Ad</strong>{" "}
          (altında e-poçt varsa görünür), <strong>Status</strong> (rəngli nişan),{" "}
          <strong>Telefon</strong> və <strong>Aktivləşdi</strong> (tarix, yoxdursa «—»). Sütun
          başlıqlarının çoxu çeşidlənə bilir. Cədvəlin öz daxili axtarış xanası və nəticə sayğacı da
          var. Daha çox sığortalı varsa, ən altda <HelpKey>Daha çox yüklə</HelpKey> düyməsi peyda
          olur.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: sığortalıları axtar və filtrlə">
        <HelpStep n={1}>
          <p>
            Axtarış zolağındakı sahəyə sığortalının adını və ya e-poçtunu yazın (yer tutucu mətn:
            «Ad və ya e-poçt ilə axtarın…»).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazmağı dayandırandan təxminən bir an sonra cədvəl avtomatik yenilənir və yalnız uyğun
            sığortalılar qalır. Hər dəfə axtarış dəyişəndə siyahı sıfırdan yüklənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Status üzrə daraltmaq üçün axtarış sahəsinin yanındakı açılan siyahıdan birini seçin:{" "}
            <HelpKey>Bütün statuslar</HelpKey>, <HelpKey>Potensial</HelpKey>, <HelpKey>Aktiv</HelpKey>,{" "}
            <HelpKey>Qeyri-aktiv</HelpKey> və ya <HelpKey>Vəfat edib</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Status seçiləndə cədvəl dərhal həmin statusa uyğun sığortalılarla yenilənir.{" "}
            <strong>Ümumi Sığortalı</strong> və <strong>Aktiv Sığortalılar</strong> kartlarındakı
            saylar göstərilən siyahıya görə yenidən hesablanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Siyahını yenidən çəkmək üçün sağdakı dairəvi ox ikonalı (<HelpKey>Yenilə</HelpKey>)
            düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl cari axtarış və status filtrini saxlamaqla sıfırdan yenidən yüklənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: sığortalını aç və daha çox yüklə">
        <HelpStep n={1}>
          <p>Cədvəldə istənilən sığortalı sətrinin üstünə basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sətir vurğulanır və həmin sığortalının detal səhifəsi (<HelpKey>Sığortalılara qayıt</HelpKey>{" "}
            keçidi, <strong>Ümumi baxış</strong> və <strong>Polislər</strong> bölmələri olan)
            açılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Cədvəlin altında <HelpKey>Daha çox yüklə</HelpKey> düyməsi görünürsə, daha çox sığortalı
            gətirmək üçün onu basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Növbəti sığortalılar dəstəsi mövcud siyahının sonuna əlavə olunur. Yükləmə bitənə qədər
            düymə müvəqqəti söndürülür. Daha gətiriləsi qeyd qalmayanda düymə yox olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Yeni sığortalı yaratmaq üçün sağ yuxarıdakı <HelpKey>Yeni Sığortalı</HelpKey> düyməsini
            istifadə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sığortalı əlavə etmə axını başlayır — sonra yeni qeyd siyahıda və sayğaclarda görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Axtarış iki yerdədir: səhifənin yuxarısındakı zolaq serverdən yalnız uyğun sığortalıları
          çəkir (status filtri ilə birlikdə), cədvəlin öz daxili xanası isə artıq yüklənmiş sətirləri
          yerində süzür. Böyük siyahıda əvvəlcə yuxarıdakı axtarışdan istifadə edin — beləliklə bütün
          uyğun nəticələr (sadəcə cari səhifədəkilər deyil) tapılır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün sığortalılar, polislər və iddialar təşkilatınızla məhdudlaşır — başqa təşkilatın
          sığorta məlumatını görmürsünüz. Sığorta Buludu yalnız bu vertikal aktiv olan tenant-larda
          görünür.
        </p>
      </HelpCallout>
    </div>
  )
}
