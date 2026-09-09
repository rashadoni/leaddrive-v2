"use client"

/**
 * Contract Analytics — help article (Azerbaijani).
 *
 * Köhnə birgə "contracts" məqaləsindən ayrılıb: yalnız
 * Müqavilələr → Analitika səhifəsini (/contracts/analytics) əhatə edir —
 * server hesablamaları, KPI kartları, tarix filtri, XLSX ixracı,
 * bitmə kohortları, növə görə bölgü, təsdiq hunisi və sapma riski.
 * Müqavilə reyestri / mərhələlər bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ContractsanalyticsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Müqavilə üzrə məsul, satış əməliyyatları və ya rəhbər rolundasınız"
        goal="Müqavilə portfelinin vəziyyətini bir baxışda görmək — neçə müqavilə canlıdır, ümumi dəyər nədir, dövriyyə nə qədər çəkir, nə yenilənir və hansı sapmalar açıqdır"
      >
        Səhifəyə <HelpKey>Müqavilələr</HelpKey> → <HelpKey>Analitika</HelpKey> yolu ilə çatırsınız.
        Bütün rəqəmlər <strong>serverdə</strong> hesablanır və yalnız sizin təşkilatınızın
        müqavilələrini əhatə edir — bu, sadəcə oxu üçün analitika lövhəsidir, burada müqavilə
        yaratmırsınız və ya redaktə etmirsiniz. Səhifə açılanda məlumat avtomatik yüklənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Müqavilə Analitikası</HelpKey> adı (yanında diaqram ikonası), altında
          «Server hesablamaları: dövriyyə müddəti, yeniləmə faizi, dəyər kohortları, təsdiq hunisi və
          sapmalar» izahı var. Bunun altında bir tarix-filtri zolağı durur: <strong>Başlanğıc</strong>{" "}
          və <strong>Bitiş</strong> tarix sahələri, <HelpKey>Tətbiq et</HelpKey>, <HelpKey>Sıfırla</HelpKey>{" "}
          və <HelpKey>XLSX İxrac</HelpKey> düymələri, sağ tərəfdə isə son hesablanma vaxtı
          («Yaradılıb: …») göstərilir.
        </p>
        <p>
          Aşağıda altı KPI kartı bir sırada gəlir, sonra dörd diaqram kartı (iki-iki düzülür):{" "}
          <strong>Bitmə kohortları</strong>, <strong>Müqavilə növünə görə</strong>,{" "}
          <strong>Təsdiq hunisi</strong> və <strong>Sapma riski</strong>. Məlumat yüklənərkən mərkəzdə
          fırlanan göstərici görünür; yüklənmə alınmasa qırmızı xəta zolağı çıxır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Aktiv müqavilələr">Hazırda canlı (aktiv) müqavilələrin sayı.</HelpDef>
          <HelpDef term="Ümumi dəyər">Müqavilələrin yığılmış pul dəyəri (qısa formatda göstərilir).</HelpDef>
          <HelpDef term="Aylıq gəlir (MRR)">Təkrarlanan aylıq dəyər; kartın altında «Aylıq dəyər» izahı durur.</HelpDef>
          <HelpDef term="Ort. dövriyyə müddəti">Müqavilənin yaradılışından imzasına qədər keçən orta gün sayı («Yaradılış → imza»); məlumat yoxdursa «—».</HelpDef>
          <HelpDef term="Yeniləmə faizi">Yenilənmiş müqavilələrin faizi; kartın altında yenilənmiş/cəmi nisbəti (məs. 4/5), məlumat yoxdursa «Son status məlumatı yoxdur».</HelpDef>
          <HelpDef term="Açıq sapmalar">Açıq sapma bayraqlarının sayı; kartın altında «N 30 gündə bitir» göstəricisi.</HelpDef>
          <HelpDef term="Bitmə kohortları">Növbəti 12 ay üçün rüb (kvartal) üzrə bitən müqavilələrin dəyəri — sütunlu diaqram.</HelpDef>
          <HelpDef term="Müqavilə növünə görə">Aktiv müqavilələrin növə görə bölgüsü — üfüqi sütunlu mini-diaqram + altında cədvəl (Növ / Say / Dəyər).</HelpDef>
          <HelpDef term="Təsdiq hunisi">Hər statusda neçə müqavilə olduğunu göstərən rəngli zolaqlar (Qaralama, Təsdiq gözləyir, Təsdiqlənib, Aktiv, Yenilənir, Yenilənib, Bitib, Ləğv edilib, Rədd edilib, İmtina edilib).</HelpDef>
          <HelpDef term="Sapma riski">Açıq sapmaların ağırlıq üzrə bölgüsü: Kritik, Xəbərdarlıq, Məlumat.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: lövhəni oxu və tarix aralığı ilə filtrlə">
        <HelpStep n={1}>
          <p>
            Səhifəni açın. Heç nə basmaq lazım deyil — məlumat avtomatik yüklənir və bütün təşkilatınız
            üzrə hesablanır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Əvvəlcə mərkəzdə qısa müddət fırlanan yükləmə göstəricisi, sonra altı KPI kartı (Aktiv
            müqavilələr, Ümumi dəyər, Aylıq gəlir, Ort. dövriyyə müddəti, Yeniləmə faizi, Açıq sapmalar)
            və dörd diaqram kartı görünür. Sağ yuxarıda «Yaradılıb: &lt;vaxt&gt;» yazısı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Metrikləri vaxt aralığına salmaq üçün <strong>Başlanğıc</strong> və/və ya{" "}
            <strong>Bitiş</strong> tarixini seçin, sonra <HelpKey>Tətbiq et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Tətbiq et</HelpKey> düyməsi qısa müddət fırlanan göstəriciyə keçir, sonra KPI
            kartları və diaqramlar seçilmiş aralığa görə yeni rəqəmlərlə yenilənir. «Yaradılıb»
            vaxtı da təzələnir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Filtri ləğv etmək üçün <HelpKey>Sıfırla</HelpKey> düyməsini (yanında dairəvi ox ikonası)
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər iki tarix sahəsi boşalır və lövhə yenidən bütün vaxt üzrə tam məlumata qayıdır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: diaqramları oxu">
        <HelpStep n={1}>
          <p>
            <strong>Bitmə kohortları (növbəti 12 ay)</strong> kartına baxın — bu, gələcək rüblərdə hansı
            müqavilə dəyərinin bitəcəyini göstərir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sütun bir dövrü (rübü) təmsil edir; sütunun üstünə gəldikdə «Dəyər» tooltip-i çıxır.
            Növbəti 12 ayda bitən müqavilə yoxdursa, kartın içində «Növbəti 12 ayda bitən müqavilə
            yoxdur.» mətni görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Müqavilə növünə görə (aktiv)</strong> kartına baxın — aktiv müqavilələrin növə görə
            bölgüsü.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Üfüqi sütunlu mini-diaqram, altında isə <strong>Növ</strong> / <strong>Say</strong> /{" "}
            <strong>Dəyər</strong> sütunlu cədvəl. Hər sətrin əvvəlində növün rənginə uyğun kiçik
            nöqtə durur. Aktiv müqavilə yoxdursa «Aktiv müqavilə yoxdur.» mətni göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Təsdiq hunisi</strong> kartına baxın — müqavilələrin statuslar üzrə paylanması.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər status üçün rəngli nişan (Qaralama, Təsdiq gözləyir, Təsdiqlənib, Aktiv, Yenilənir,
            Yenilənib, Bitib və s.), yanında ümumiyə nisbətini göstərən zolaq və sağda dəqiq say.
            Heç bir statusda müqavilə yoxdursa «Heç bir statusda müqavilə yoxdur.» mətni çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <strong>Sapma riski (açıq bayraqlar)</strong> kartına baxın — açıq sapmaların ağırlığı.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Üç sıra: <strong>Kritik</strong> (qırmızı), <strong>Xəbərdarlıq</strong> (narıncı) və{" "}
            <strong>Məlumat</strong> (mavi), hər birinin yanında nisbət zolağı və say; altında «Cəmi N
            açıq bayraq» yazısı. Heç bir açıq bayraq yoxdursa, yaşıl təsdiq ikonası ilə «Açıq sapma
            bayrağı yoxdur.» göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: analitikanı XLSX kimi ixrac et">
        <HelpStep n={1}>
          <p>
            İstəsəniz əvvəlcə <strong>Başlanğıc</strong>/<strong>Bitiş</strong> tarixini təyin edin —
            ixrac filtrdəki həmin aralığı götürür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz tarixlər sahələrdə qalır; ixrac düyməsi bu aralığı avtomatik öz ünvanına əlavə
            edir (filtr boşdursa bütün məlumat ixrac olunur).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>XLSX İxrac</HelpKey> düyməsini (yanında yükləmə ikonası) basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Brauzer Excel (.xlsx) faylının yüklənməsini başladır — sapma diaqramları yox, hesablanmış
            analitika rəqəmləri faylda olur. Fayl cari tarix filtrini əks etdirir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          «—» işarəsi və ya «Son status məlumatı yoxdur» yazısı xəta deyil — sadəcə o metriki
          hesablamaq üçün kifayət qədər müqavilə tarixçəsi yoxdur (məsələn, hələ heç bir müqavilə
          yeniləmə/bitmə mərhələsinə çatmayıb). Müqavilələr həyat dövrünü keçdikcə bu rəqəmlər özü
          dolacaq.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Tarix filtri yalnız <strong>vaxta bağlı</strong> metriklərə təsir edir. Boş bir aralıq
          gözlədiyiniz rəqəmləri sıfıra endirə bilər — diaqram «boşdur» görünürsə, əvvəlcə{" "}
          <HelpKey>Sıfırla</HelpKey> ilə tam görünüşə qayıdın və məlumatın həqiqətən yoxluğunu yoxlayın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün rəqəmlər təşkilatınızla məhdudlaşır və serverdə hesablanır — başqa təşkilatın
          müqavilələrini görmürsünüz, brauzerdə heç bir aralarası toplama aparılmır. İxrac edilən XLSX
          də yalnız öz tenant-ınızın məlumatını ehtiva edir.
        </p>
      </HelpCallout>
    </div>
  )
}
