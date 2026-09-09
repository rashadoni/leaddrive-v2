"use client"

/**
 * Subscriptions (Abunəliklər) — help article (Azerbaijani).
 * Köhnə birgə "invoices" məqaləsindən ayrılıb: yalnız
 * Billing → Abunəliklər idarə paneli (status KPI-ları, MRR,
 * tezliklə bitən sınaqlar, ödənişi gecikmiş abunəliklər, plan üzrə
 * bölgü). Bu səhifə YALNIZ oxunur — burada abunəlik yaradılmır və
 * redaktə edilmir; fakturalar (invoices) bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SubscriptionsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Billing operatoru və ya gəlir üzrə məsul administratorsunuz"
        goal="Təkrarlanan gəlirin sağlamlığını bir ekranda görmək — neçə abunəlik aktivdir, hansı sınaqlar tezliklə çevriləcək, hansı ödənişlər gecikib və hər plan nə qədər MRR gətirir"
      >
        Səhifə <HelpKey>Billing</HelpKey> → <HelpKey>Abunəliklər</HelpKey> yolu ilə açılır. Bütün
        rəqəmlər yalnız sizin təşkilatınızın abunəliklərindən oxunur. Bu səhifə tablodur — yalnız
        baxış üçündür: burada abunəlik yaratmaq, redaktə etmək və ya ləğv etmək düymələri yoxdur,
        məqsəd vəziyyəti görmək və lazım olanda müdaxilə etməkdir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda dövredən ox ikonası ilə <HelpKey>Abunəliklər</HelpKey> adı və yanında kömək
          düyməsi durur; altda «Təkrarlanan gəlirin sağlamlığı…» izahı var. Səhifə açılarkən
          məlumatlar avtomatik yüklənir — qısa müddət <strong>Yüklənir…</strong> spinneri görünür.
          Yüklənəndən sonra üç hissə gəlir: yuxarıda <strong>altı KPI kartı</strong>, ortada iki
          siyahı — <strong>Tezliklə bitən sınaqlar</strong> və <strong>Gecikmiş</strong>, aşağıda
          isə <strong>Plan üzrə aktiv abunəliklər</strong> bölgüsü. Ən altda iki kiçik izah sətri
          (MRR-in necə hesablandığı və gecikmiş abunəliklərin nə demək olduğu) var.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Aktiv">Hazırda aktiv (ödənişləri davam edən) abunəliklərin sayı.</HelpDef>
          <HelpDef term="Sınaq">Sınaq müddətində olan, hələ ödənişə keçməmiş abunəliklərin sayı.</HelpDef>
          <HelpDef term="Gecikmiş">Son ödənişi uğursuz olmuş abunəliklərin sayı; sıfırdan çoxdursa rəqəm qırmızı yanır.</HelpDef>
          <HelpDef term="Dayandırılıb">Müvəqqəti dayandırılmış (pauzalı) abunəliklərin sayı.</HelpDef>
          <HelpDef term="Ləğv olunub">Ləğv edilmiş abunəliklərin sayı.</HelpDef>
          <HelpDef term="MRR (dominant)">Aylıq təkrarlanan gəlir — ən çox işlənən valyutada göstərilir; başqa valyutalar varsa «+N daha çox» kimi qeyd olunur.</HelpDef>
          <HelpDef term="Tezliklə bitən sınaqlar">Yaxın günlərdə (başlıqdakı gün sayı pəncərəsində) sınaq müddəti bitəcək abunəliklər.</HelpDef>
          <HelpDef term="Gecikmiş (siyahı)">Ödənişi alınmamış abunəliklər — saxlama (retention) zəngi tələb edə bilərlər.</HelpDef>
          <HelpDef term="Plan üzrə">Hər planda neçə aktiv abunəlik olduğunu və həmin planın MRR-ini göstərən kartlar.</HelpDef>
        </dl>
        <p>
          KPI kartları ekranın enindən asılı olaraq iki, üç və ya altı sütunda düzülür. Sınaq və
          gecikmiş siyahılarının hər sətrində şirkət (yoxdursa kontakt) adı, planın adı, qiymət və
          billing aralığı (məs. <HelpKey>USD 50 / ay</HelpKey>), sağda isə nisbi tarix — sınaqlarda
          «Sabah» / «3g sonra», gecikmişlərdə «5g əvvəl» kimi göstərilir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: vəziyyəti oxu">
        <HelpStep n={1}>
          <p>
            Səhifəni açın: <HelpKey>Billing</HelpKey> → <HelpKey>Abunəliklər</HelpKey>. Heç nə
            etmədən gözləyin — məlumatlar özü yüklənir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Əvvəlcə qısa müddət fırlanan <strong>Yüklənir…</strong> göstəricisi, sonra altı KPI
            kartı doldurulmuş halda peyda olur. Şəbəkə xətası olarsa, yuxarıda qırmızı çərçivəli
            «Məlumatları yükləmək mümkün olmadı» xəbərdarlığı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Yuxarıdakı altı kartı soldan sağa oxuyun: <strong>Aktiv</strong>, <strong>Sınaq</strong>,{" "}
            <strong>Gecikmiş</strong>, <strong>Dayandırılıb</strong>, <strong>Ləğv olunub</strong> və{" "}
            <strong>MRR (dominant)</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kartda yuxarıda kiçik rəngli ikona ilə ad, altında iri rəqəm durur.{" "}
            <strong>Gecikmiş</strong> sıfırdan çoxdursa rəqəmi qırmızı rəngdə yanır. MRR kartında
            məbləğ qısaldılmış formada göstərilir (məs. <HelpKey>USD 12.5K</HelpKey>,{" "}
            <HelpKey>USD 1.2M</HelpKey>); birdən çox valyuta varsa altında «+N daha çox» yazısı olur
            (üstünə gələndə dəqiq məbləğlər görünür).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Aşağı diyirlədib <HelpKey>Plan üzrə aktiv abunəliklər</HelpKey> bölməsinə baxın — hansı
            planın neçə müştərisi və nə qədər MRR-i olduğunu burada görəcəksiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər plan ayrıca kart kimi göstərilir: solda planın adı, sağda yaşıl nişanda aktiv
            abunəlik sayı, altında isə hər valyuta üzrə «{"{məbləğ}"} /ay» sətirləri. Heç bir
            planda aktiv abunəlik yoxdursa «Heç bir planda aktiv abunəlik yoxdur.» mətni çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: çevriləcək sınaqlarla işlə">
        <HelpStep n={1}>
          <p>
            Sol ortadakı <HelpKey>Sınaqlar … gündə bitir</HelpKey> bölməsinə baxın (başlıqdakı gün
            sayı pəncərəni göstərir — məs. «7g-də bitən sınaqlar»).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yaxın vaxtda bitəcək sınaqlar mavi haşiyəli kartlar kimi sadalanır. Hər sətirdə şirkət
            (və ya kontakt) adı, plan adı və qiymət, sağda isə nə vaxt bitəcəyi — «Sabah», «Bu gün»
            və ya «Ng sonra» — göstərilir. Belə sınaq yoxdursa, yaşıl təsdiq ikonası ilə «Tezliklə
            bitən sınaq yoxdur.» mətni çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Tez bitəcək (məs. «Bu gün» / «Sabah») sətirləri önə alın — çevrilmənin baş tutması üçün
            müştəri ilə əlaqə saxlanmalı və ya ödəniş üsulu yoxlanmalıdır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahıda ilk 10 sınaq göstərilir. 10-dan çox varsa, altda qalanların sayı («+N») kimi
            verilir — qalanlar həmin günlərdə dövriyyəyə düşdükcə siyahı yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: gecikmiş abunəlikləri xilas et">
        <HelpStep n={1}>
          <p>
            Sağ ortadakı <HelpKey>Gecikmiş</HelpKey> bölməsinə baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ödənişi alınmamış abunəliklər qırmızı haşiyəli kartlar kimi sadalanır: şirkət/kontakt
            adı, plan və qiymət, sağda isə növbəti ödəniş tarixi nisbi formada (məs. «3g əvvəl»).
            Heç bir gecikmiş abunəlik yoxdursa, yaşıl təsdiq ikonası ilə «Gecikmiş abunəlik yoxdur.»
            mətni görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Hər sətri saxlama (retention) işi kimi götürün: müştəri ilə əlaqə saxlayıb ödəniş
            üsulunu yeniləməyə kömək edin. Səhifənin ən altındakı izaha diqqət edin —{" "}
            <strong>ödəniş avtomatik təkrarlanır</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bu siyahıda da ilk 10 sətir göstərilir; daha çoxu varsa altda «+N daha çox» yazısı çıxır.
            Aşağıda iki izah sətri durur: biri MRR-in necə hesablandığını, biri gecikmiş abunəliyin
            nə demək olduğunu açıqlayır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Bu səhifə yalnız oxunur — abunəliyi buradan birbaşa yeniləyə və ya bərpa edə bilməzsiniz.
            Müdaxilə (əlaqə, ödəniş üsulunun yenilənməsi, planın dəyişdirilməsi) abunəliyin öz
            qeydində və ya müştəri ilə birbaşa aparılır; bu ekran sizə yalnız kimə müraciət etməyi
            göstərir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Yuxarıda sarı çərçivəli «Son N abunəlik göstərilir» bannerini görsəniz, bu o deməkdir ki,
          abunəliklərin sayı göstərmə həddini keçib və rəqəmlər yalnız ən son N abunəlik üzərindən
          hesablanır. Belə hallarda dəqiq toplamlar üçün abunəlik hesabatından istifadə edin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün abunəliklər və MRR rəqəmləri təşkilatınızla məhdudlaşır — başqa tenant-ın
          abunəliklərini görmürsünüz. Səhifə hər açılışda serverdən cari vəziyyəti çəkir, ona görə
          rəqəmlər həmişə təşkilatınızın aktual gəlir mənzərəsini əks etdirir.
        </p>
      </HelpCallout>
    </div>
  )
}
