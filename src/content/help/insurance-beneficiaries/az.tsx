"use client"

/**
 * Insurance → Beneficiaries — help article (Azerbaijani).
 * Sığorta vertikalının ümumi məqaləsindən ayrılıb: yalnız
 * Sığorta → Benefisiarlar səhifəsini əhatə edir (yalnız-oxu roster:
 * statistika kartları, səviyyə filtri, cədvəl sütunları, "Daha çox yüklə").
 * Bu səhifədə yaratma/redaktə/silmə düymələri YOXDUR — siyahı yalnız oxunur.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function insurancebeneficiariesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sığorta əməliyyatları üzrə mütəxəssis və ya andеrraytеr administratorsunuz"
        goal="Polislərə təyin edilmiş benefisiarları (faydalananları) bir yerdə görmək, səviyyəyə görə süzgəcdən keçirmək və ləğv edilmiş təyinatları izləmək"
      >
        Səhifəyə <HelpKey>Sığorta</HelpKey> → <HelpKey>Benefisiarlar</HelpKey> yolu ilə çatırsınız.
        Bu səhifə <strong>yalnız-oxu siyahıdır</strong>: benefisiarları burada izləyirsiniz, amma
        yaratmaq, redaktə etmək və ya silmək üçün düymə yoxdur (bu əməliyyatlar polis səviyyəsində
        baş verir). Bütün benefisiarlar yalnız sizin təşkilatınıza aiddir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda bənövşəyi insan ikonası, <HelpKey>Benefisiarlar</HelpKey> adı və altında «Polis
          benefisiarları və bölgü qeydləri» izahı var. Aşağıda dörd statistika kartı durur:{" "}
          <strong>Ümumi Benefisiar</strong>, <strong>Əsas</strong>, <strong>Şərti</strong> və{" "}
          <strong>Ləğv edilmiş</strong>. Onların altında bir süzgəc zolağı (səviyyə açılan siyahısı +
          yeniləmə düyməsi), sonra benefisiarların cədvəli, lazım gəldikdə isə{" "}
          <HelpKey>Daha çox yüklə</HelpKey> düyməsi gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi Benefisiar">Hazırda cədvəldə yüklənmiş benefisiarların sayı.</HelpDef>
          <HelpDef term="Əsas">Səviyyəsi «Əsas» (primary) olan benefisiarların sayı.</HelpDef>
          <HelpDef term="Şərti">Səviyyəsi «Şərti» (contingent) olan benefisiarların sayı.</HelpDef>
          <HelpDef term="Ləğv edilmiş">Ləğv tarixi (revoked) qeyd edilmiş benefisiarların sayı.</HelpDef>
          <HelpDef term="Səviyyə">Benefisiarın növbəsi: Əsas, Şərti və ya Üçüncü.</HelpDef>
          <HelpDef term="Allokasiya">Benefisiara düşən pay faizi (%).</HelpDef>
        </dl>
        <p>
          Cədvəlin sütunları: <strong>Ad</strong>, <strong>Səviyyə</strong> (rəngli nişan),{" "}
          <strong>Növ</strong>, <strong>Əlaqə</strong> (məsələn qohumluq; yoxdursa «—»),{" "}
          <strong>Allokasiya</strong> (faizlə) və <strong>Ləğv edildi</strong> (ləğv tarixi, yoxdursa «—»).
          Ad, Səviyyə və Allokasiya sütunları çeşidlənə bilir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: benefisiarları səviyyəyə görə süzgəcdən keçir">
        <HelpStep n={1}>
          <p>
            Süzgəc zolağındakı səviyyə açılan siyahısını açın. Standart olaraq{" "}
            <HelpKey>Bütün səviyyələr</HelpKey> seçilidir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahıda dörd seçim görünür: «Bütün səviyyələr», «Əsas», «Şərti» və «Üçüncü».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bir səviyyə seçin (məsələn <HelpKey>Əsas</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl dərhal yenidən yüklənir və yalnız seçdiyiniz səviyyədəki benefisiarları göstərir.
            Statistika kartlarındakı saylar da bu yenidən yüklənmiş siyahıya görə hesablanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bütün benefisiarlara qayıtmaq üçün açılan siyahıdan yenidən{" "}
            <HelpKey>Bütün səviyyələr</HelpKey> seçin. Hər vaxt yenidən-yükləmə (dairəvi ox) düyməsi
            ilə cari siyahını təzələyə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Süzgəc götürülür, cədvəl yenidən bütün səviyyələri göstərir. Yenidən-yükləmə düyməsini
            basanda eyni süzgəclə siyahı serverdən təzədən gətirilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: daha çox benefisiar yüklə">
        <HelpStep n={1}>
          <p>
            Səhifə hər dəfə ilk 50 benefisiarı gətirir. Daha çoxu varsa, cədvəlin altında{" "}
            <HelpKey>Daha çox yüklə</HelpKey> düyməsi görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Daha yüklənəcək sətir qalmayanda düymə ümumiyyətlə görünmür — siyahı tamdır deməkdir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Daha çox yüklə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Növbəti benefisiarlar mövcud cədvələ ƏLAVƏ olunur (siyahı sıfırlanmır). Yükləmə gedərkən
            düymə müvəqqəti deaktiv olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Statistika kartlarındakı saylar yalnız <strong>ilk açılan 50 sətrə</strong> görə hesablanır,
          bütün baza üzrə yekun deyil. Səviyyə süzgəci dəyişəndə saylar süzülmüş nəticəyə uyğunlaşır;{" "}
          <HelpKey>Daha çox yüklə</HelpKey> ilə əlavə sətir gətirmək saylara təsir etmir. Dəqiq səviyyə
          bölgüsünü görmək üçün uyğun səviyyəni süzgəcdən seçin.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu səhifədə benefisiar əlavə etmək, dəyişmək və ya silmək olmur — burada{" "}
          <strong>yalnız izləyirsiniz</strong>. Səviyyə süzgəcindən başqa axtarış qutusu (məsələn ada
          görə) bu ekranda yoxdur.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Benefisiar adı və əlaqə kimi sahələr təşkilata-bağlı şifrələnmiş PII məlumatlardır və hər
          baxış audit jurnalına yazılır. Texniki səbəbdən ada və ya vergi nömrəsinə görə server
          axtarışı yalnız <strong>tam uyğunluq</strong> ilə işləyir (şifrələmə qismən/hissəvi uyğunluğa
          imkan vermir) — bu səhifə onsuz da yalnız səviyyə süzgəcini göstərir. Bütün benefisiarlar
          təşkilatınızla məhdudlaşır; başqa təşkilatın qeydlərini görmürsünüz.
        </p>
      </HelpCallout>
    </div>
  )
}
