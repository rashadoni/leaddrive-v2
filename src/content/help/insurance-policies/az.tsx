"use client"

/**
 * Insurance → Policies (Sığorta polisləri) — help article (Azerbaijani).
 * Generic Insurance vertical məqaləsindən ayrılıb: yalnız
 * /insurance/policies səhifəsini əhatə edir (polis siyahısı/cədvəli,
 * dörd statistika kartı, status + sığorta sahəsi filtrləri, yenilə,
 * «Daha çox yüklə»). Bu səhifə YALNIZ oxumaq üçündür — yeni polis
 * yaratma və ya redaktə düyməsi RENDER OLUNMUR.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function insurancepoliciesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sığorta əməliyyatları və ya portfel idarəetməsi ilə məşğul olan istifadəçisiniz"
        goal="Bütün sığortalılar üzrə polislərin vahid siyahısına baxmaq, statusa və sığorta sahəsinə görə süzgəcdən keçirmək"
      >
        Səhifəyə <HelpKey>Sığorta</HelpKey> → <HelpKey>Polislər</HelpKey> bölməsindən çatırsınız. Bütün
        polislər yalnız sizin təşkilatınıza aiddir. Bu səhifə yalnız baxış üçündür — burada polis
        siyahısını oxuyur və süzürsünüz; polis yaratma və redaktə bu ekrandan deyil, ayrıca axınlardan
        aparılır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda sənəd ikonası ilə birlikdə <HelpKey>Polislər</HelpKey> başlığı və altında «Bütün
          sığortalılar üzrə sığorta polisləri» izahı durur. Onun altında dörd statistika kartı gəlir:{" "}
          <strong>Ümumi Polis</strong>, <strong>Aktiv</strong>, <strong>Müddəti bitmiş</strong> və{" "}
          <strong>Vaxtı keçmiş</strong>. Daha aşağıda iki açılan süzgəc (status və sığorta sahəsi) ilə
          bir yenilə düyməsi, sonra isə polislər cədvəli yerləşir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi Polis">Cari yüklənmiş polislərin sayını göstərir. Diqqət: bu say bütün təşkilat üzrə cəm yox, yalnız ilk açılışda gələn səhifədəki (maksimum 50) sətirlərin sayıdır.</HelpDef>
          <HelpDef term="Aktiv">Yüklənmiş polislərdən statusu «Aktiv» olanların sayı.</HelpDef>
          <HelpDef term="Müddəti bitmiş">Yüklənmiş polislərdən statusu «Müddəti bitmiş» olanların sayı.</HelpDef>
          <HelpDef term="Vaxtı keçmiş">Yüklənmiş polislərdən statusu «Vaxtı keçmiş» olanların sayı.</HelpDef>
          <HelpDef term="Polis №">Polisin nömrəsi — kiçik, monospace (eyni enli) şriftlə göstərilir.</HelpDef>
          <HelpDef term="Sığorta Sahəsi">Polisin növü: Avto, Əmlak, Həyat, Sağlamlıq, Kommersiya, Çətir və ya Dəniz.</HelpDef>
          <HelpDef term="Status">Polisin vəziyyəti — rəngli nişanla: Qiymət, Bağlanmış, Aktiv, Müddəti bitmiş, Vaxtı keçmiş, Ləğv edilmiş.</HelpDef>
          <HelpDef term="İllik Sığorta Haqqı">İllik premium — USD valyutasında; məlumat yoxdursa «—» göstərilir.</HelpDef>
          <HelpDef term="Qüvvəyə giriş / Bitmə tarixi">Polisin başlama və bitmə tarixləri; boşdursa «—».</HelpDef>
        </dl>
        <p>
          Cədvəlin sütun başlıqları sıralana biləndir. Əgər ilk yükləmə bütün polisləri əhatə
          etmirsə, cədvəlin altında ortada <HelpKey>Daha çox yüklə</HelpKey> düyməsi görünür.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: polisləri statusa görə süz">
        <HelpStep n={1}>
          <p>
            Süzgəc zolağındakı birinci açılan siyahını (status süzgəci) açın. Standart olaraq orada{" "}
            <HelpKey>Bütün statuslar</HelpKey> seçilidir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahıda variantlar görünür: <strong>Bütün statuslar</strong>, sonra Qiymət,
            Bağlanmış, Aktiv, Müddəti bitmiş, Vaxtı keçmiş və Ləğv edilmiş.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Bir status seçin (məsələn <HelpKey>Aktiv</HelpKey>).</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl avtomatik yenidən yüklənir və yalnız seçdiyiniz statusa uyğun polisləri göstərir.
            Cursor (səhifələmə) sıfırlanır və statistika kartları yeni nəticəyə görə hesablanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Süzgəci ləğv etmək üçün yenidən <HelpKey>Bütün statuslar</HelpKey> seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl bütün statuslardakı polisləri yenidən göstərir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: sığorta sahəsinə görə süz">
        <HelpStep n={1}>
          <p>
            İkinci açılan siyahını (sığorta sahəsi süzgəci) açın. Standart olaraq{" "}
            <HelpKey>Bütün sahələr</HelpKey> seçilidir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Variantlar: <strong>Bütün sahələr</strong>, Avto, Əmlak, Həyat, Sağlamlıq, Kommersiya,
            Çətir və Dəniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Bir sahə seçin (məsələn <HelpKey>Avto</HelpKey>).</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl yalnız həmin sahəyə aid polisləri göstərir. Bu süzgəc status süzgəci ilə birlikdə
            işləyir — ikisini eyni anda tətbiq edə bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: siyahını yenilə və davamını yüklə">
        <HelpStep n={1}>
          <p>
            Süzgəclərin yanındakı yenilə düyməsini (dairəvi ox ikonası) basın. Bu düymədə mətn yoxdur —
            yalnız ikonadır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl cari süzgəclərlə baş­dan yenidən yüklənir və ən son polis məlumatlarını gətirir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Daha çox sətir varsa, cədvəlin altındakı <HelpKey>Daha çox yüklə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Növbəti polis dəstəsi mövcud siyahının sonuna əlavə olunur. Yüklənmə davam edərkən düymə
            müvəqqəti deaktiv olur; daha sətir qalmadıqda <HelpKey>Daha çox yüklə</HelpKey> düyməsi
            tamamilə yox olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Statistika kartlarındakı saylar <strong>cari yüklənmiş səhifəyə</strong> əsaslanır, bütün
          təşkilat üzrə cəmə yox. Daha dəqiq say üçün əvvəlcə uyğun statusu süzgəcdən seçin, sonra
          kartlara baxın — onlar həmin süzülmüş nəticəni əks etdirəcək.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu səhifə yalnız oxumaq üçündür: burada yeni polis yaratma, redaktə və ya silmə düyməsi
          yoxdur. Polis nömrəsinə görə axtarış üçün də ekranda mətn qutusu render olunmur — siyahını
          yalnız status və sığorta sahəsi açılan siyahıları ilə daraldırsınız.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün polislər təşkilatınızla məhdudlaşır — başqa tenant-ın polislərini görmürsünüz. Sığortalı
          şəxsin ad, e-poçt kimi şəxsi məlumatları bu cədvəldə deyil, bağlı «Sığortalı» (PolicyHolder)
          qeydində saxlanılır və orada sütun-bağlı şifrələmə ilə qorunur. Bu səhifədə göstərilən polis
          nömrəsi institusional məlumatdır (şifrələnmiş PII deyil), buna görə də sistem onu axtarışa
          açıq sayır — sadəcə bu ekranda axtarış qutusu mövcud deyil. Hər polis siyahısına baxış DOI
          tələblərinə uyğun olaraq audit jurnalına yazılır.
        </p>
      </HelpCallout>
    </div>
  )
}
