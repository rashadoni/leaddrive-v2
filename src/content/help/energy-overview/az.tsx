"use client"

/**
 * Energy & Utilities — landing/overview help article (Azerbaijani).
 * Ümumi "industries" məqaləsindən ayrılıb: yalnız Enerji və Kommunal
 * vertikalının giriş səhifəsini (kommunal müştərilər siyahısı) əhatə edir —
 * statistika kartları (Ümumi müştərilər / Aktiv / Sayğaclar / Qəzalar),
 * axtarış + status filtri, müştəri cədvəli və sətrə klik ilə detal səhifəsi.
 * Sayğaclar, Qəzalar, Xidmət Çağırışları ayrı yan-panel səhifələridir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function energyoverviewHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Kommunal təşkilatda müştəri xidməti və ya əməliyyat administratorusunuz"
        goal="Enerji və Kommunal modulunun giriş səhifəsini açmaq, kommunal müştəriləri axtarıb süzgəcdən keçirmək və konkret hesabın detalına keçmək"
      >
        Səhifəyə yan paneldən <HelpKey>Enerji və Kommunal</HelpKey> bölməsi ilə çatırsınız. Bu, vertikalın
        giriş (landing) səhifəsidir — açıldığı andaca <strong>kommunal müştərilər</strong> siyahısı yüklənir.
        Bütün müştərilər, sayğaclar və qəzalar yalnız sizin təşkilatınız üçündür. Statistika kartlarındakı
        saylar siyahı ilə eyni mənbədən oxunur, ona görə süzgəc və ya axtarış dəyişdikcə müvafiq kartlar
        dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Sol yuxarıda alov ikonası, yanında başlıq <HelpKey>Enerji və Kommunal</HelpKey> və altında
          «Kommunal müştərilər, sayğaclar, qəzalar və xidmət çağırışları.» izahı durur. Sağ yuxarıda{" "}
          <HelpKey>Yeni müştəri</HelpKey> düyməsi var. Başlığın altında dörd statistika kartı, sonra axtarış
          və status süzgəci olan sətr, ən altda isə müştəri cədvəli gəlir. Cədvəldə daha çox sətr varsa,
          aşağıda <HelpKey>Daha çox yüklə</HelpKey> düyməsi görünür.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi müştərilər">Cari süzgəcə uyğun olaraq yüklənmiş kommunal müştərilərin sayı.</HelpDef>
          <HelpDef term="Aktiv">Statusu «Aktiv» olan müştərilərin sayı.</HelpDef>
          <HelpDef term="Sayğaclar">Sayğac nöqtələrinin ümumi sayı (ayrıca sayğac sorğusundan gəlir).</HelpDef>
          <HelpDef term="Qəzalar">Şəbəkə qəzalarının ümumi sayı (ayrıca qəza sorğusundan gəlir).</HelpDef>
          <HelpDef term="Müştəri sətri">Bir kommunal hesab — hesab nömrəsi, ad, kateqoriya, status nişanı və xidmət şəhəri ilə.</HelpDef>
          <HelpDef term="Status">Müştərinin vəziyyəti: Potensial, Aktiv, Dayandırıldı və ya Xitam verildi — rəngli nişan kimi göstərilir.</HelpDef>
        </dl>
        <p>
          Cədvəlin sütunları belədir: <strong>Hesab №</strong> (monospace mətnlə), <strong>Ad</strong>{" "}
          (altında xidmət şəhəri kiçik yazı ilə), <strong>Kateqoriya</strong>, <strong>Status</strong>{" "}
          (rəngli nişan) və <strong>Şəhər</strong>. Sayğaclar, Qəzalar və Xidmət Çağırışları bu səhifədə
          deyil — onlar yan paneldə ayrıca səhifələrdir; bu giriş səhifəsi yalnız müştərilər siyahısını
          göstərir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: səhifəni açıb statistikanı oxu">
        <HelpStep n={1}>
          <p>
            Yan paneldən <HelpKey>Enerji və Kommunal</HelpKey> bölməsini açın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Səhifə açılır və müştərilər siyahısı yüklənir. Yuxarıda dörd kart sıralanır:{" "}
            <strong>Ümumi müştərilər</strong>, <strong>Aktiv</strong>, <strong>Sayğaclar</strong> və{" "}
            <strong>Qəzalar</strong>. Hər kartda say və yanında uyğun ikona (müştərilər üçün insan,
            sayğaclar üçün ölçü cihazı, qəzalar üçün xəbərdarlıq üçbucağı) görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Kartlardakı rəqəmlərə baxın. <strong>Ümumi müştərilər</strong> və <strong>Aktiv</strong> hazırda
            yüklənmiş siyahıdan hesablanır; <strong>Sayğaclar</strong> və <strong>Qəzalar</strong> isə öz
            ayrıca sorğularından gəlir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Heç müştəri yoxdursa, kartlarda <strong>0</strong> görünür və cədvəl boş qalır. Saylar açılışdan
            sonra qısa müddətdə dolur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: müştəri axtar və süzgəcdən keçir">
        <HelpStep n={1}>
          <p>
            Süzgəc sətrindəki axtarış qutusuna hesab nömrəsini yazın (yer tutucu: «Hesab nömrəsi ilə
            axtar…»).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazmağı dayandırandan təxminən yarım saniyə sonra cədvəl avtomatik yenilənir və yalnız uyğun
            müştərilər qalır. Hər dəfə hərf basanda dərhal sorğu getmir — gözlədikdən sonra bir dəfə gedir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Status açılan siyahısından bir vəziyyət seçin: <HelpKey>Bütün statuslar</HelpKey>,{" "}
            <strong>Potensial</strong>, <strong>Aktiv</strong>, <strong>Dayandırıldı</strong> və ya{" "}
            <strong>Xitam verildi</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçim edən kimi cədvəl yenidən yüklənir və yalnız həmin statuslu müştərilər göstərilir.{" "}
            <strong>Ümumi müştərilər</strong> və <strong>Aktiv</strong> kartları yeni nəticəyə uyğun
            yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Siyahını yeniləmək üçün süzgəc sətrinin sağındakı dairəvi ox ikonalı yenilə düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl cari axtarış və status süzgəci ilə baş­dan yüklənir; yeni və ya dəyişmiş müştərilər
            görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: müştəri detalına keç və daha çox yüklə">
        <HelpStep n={1}>
          <p>
            Cədvəldə istənilən müştəri sətrinə klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Həmin müştərinin detal səhifəsi açılır (ünvan, hesab məlumatları və sayğaclar / xidmət
            müraciətləri kimi bölmələrlə). Müştərilər siyahısına qayıtmaq üçün detal səhifəsindəki{" "}
            <HelpKey>Müştərilərə qayıt</HelpKey> keçidindən istifadə edin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Cədvəlin altında <HelpKey>Daha çox yüklə</HelpKey> düyməsi varsa, onu basaraq növbəti
            müştəriləri əlavə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yeni müştərilər mövcud siyahının sonuna əlavə olunur (siyahı sıfırlanmır). Daha sətr qalmasa,{" "}
            <HelpKey>Daha çox yüklə</HelpKey> düyməsi yox olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Axtarış yalnız <strong>hesab nömrəsi</strong> üzrə işləyir, ad üzrə deyil. Konkret müştərini ada
          görə tapmaq çətindirsə, əvvəlcə status süzgəci ilə siyahını daraldın, sonra cədvəldə gözlə tapın.
          Süzgəc və axtarışı eyni anda birlikdə tətbiq etmək olar.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <strong>Sayğaclar</strong> və <strong>Qəzalar</strong> kartlarındakı saylar müştərilər
          siyahısından deyil, ayrıca sayğac və qəza sorğularından gəlir. Bu kartlardakı rəqəm 0-dırsa, bu
          mütləq səhv demək deyil — sadəcə həmin sorğunun nəticəsidir; sayğac və qəzalarla ətraflı işləmək
          üçün yan paneldəki <strong>Sayğac Nöqtələri</strong> və <strong>Qəzalar</strong> səhifələrinə keçin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün kommunal müştərilər, sayğaclar və qəzalar təşkilatınızla məhdudlaşır — başqa təşkilatın
          məlumatlarını görmürsünüz. Səhifə yalnız sessiyanızdakı təşkilat üçün məlumat çəkir; siyahı boş
          görünürsə, ola bilsin ki, hələ heç bir müştəri yaradılmayıb.
        </p>
      </HelpCallout>
    </div>
  )
}
