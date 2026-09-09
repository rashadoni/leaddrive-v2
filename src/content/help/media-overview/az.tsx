"use client"

/**
 * Media Cloud (Media & Telecom industry vertical) — overview help article (Azerbaijani).
 * Generic "industries" məqaləsindən ayrıldı: yalnız Media Buludu landinq səhifəsini
 * (abunəçilər siyahısı, statistika kartları, axtarış/status filtri, cədvəl, sətrə
 * klik → abunəçi detalı) əhatə edir. Kontent inventarı və reklam kampaniyaları
 * səhifələri öz məqalələrindədir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mediaoverviewHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Media və ya telekom operatorunda abunəçi bazasına baxan menecersiniz"
        goal="Media Buludunun əsas səhifəsini tanımaq — abunəçiləri görmək, axtarmaq, statusa görə süzmək və bir abunəçinin detallarına keçmək"
      >
        Bu, <HelpKey>Media Buludu</HelpKey> sənayə modulunun giriş səhifəsidir. Bütün abunəçilər,
        saylar və gəlir rəqəmləri yalnız sizin təşkilatınıza aiddir. Səhifə açılan kimi abunəçilər
        avtomatik yüklənir, ona görə əvvəlcə heç nə basmadan siyahını görəcəksiniz.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda solda bənövşəyi <HelpKey>Tv</HelpKey> ikonası, yanında <strong>Media Buludu</strong>{" "}
          başlığı və altında «Abunəçilər, kontent inventarı və reklam kampaniyaları idarəetməsi» izahı
          durur. Sağ yuxarıda <HelpKey>Yeni abunəçi</HelpKey> düyməsi var. Başlığın altında dörd
          statistika kartı, sonra axtarış və süzgəc paneli, ən altda isə abunəçilərin cədvəli gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi abunəçilər">Hazırda yüklənmiş abunəçilərin sayı.</HelpDef>
          <HelpDef term="Aktiv">Statusu «Aktiv» olan abunəçilərin sayı.</HelpDef>
          <HelpDef term="Premium">Planı «premium» olan abunəçilərin sayı.</HelpDef>
          <HelpDef term="Kampaniyalar">Reklam kampaniyalarının sayı (ayrıca yüklənir).</HelpDef>
          <HelpDef term="Abunəçi №">Hər abunəçinin unikal nömrəsi (monospace mətnlə).</HelpDef>
          <HelpDef term="Plan">Abunəçinin tarif səviyyəsi (məs. premium).</HelpDef>
          <HelpDef term="Status">Sınaq / Aktiv / Dayandırıldı / Ayrıldı / Bloklandı — rəngli nişanla.</HelpDef>
          <HelpDef term="Ömürlük gəlir">Abunəçinin gətirdiyi ümumi gəlir (valyuta formatında).</HelpDef>
        </dl>
        <p>
          Cədvəlin sütunları: <strong>Abunəçi №</strong>, <strong>Ad</strong> (altında email), {""}
          <strong>Plan</strong>, <strong>Status</strong> və <strong>Ömürlük gəlir</strong>. Status
          nişanı rənglə fərqlənir: Sınaq mavi, Aktiv yaşıl, Dayandırıldı sarı, Ayrıldı boz, Bloklandı
          qırmızı. Cədvəldə daha çox abunəçi varsa, altında <HelpKey>Daha çox yüklə</HelpKey> düyməsi
          çıxır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: abunəçi tap və detalına keç">
        <HelpStep n={1}>
          <p>
            Səhifəni açın və statistika kartlarının dolmasını gözləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Dörd kart — <strong>Ümumi abunəçilər</strong>, <strong>Aktiv</strong>,{" "}
            <strong>Premium</strong>, <strong>Kampaniyalar</strong> — saylarla dolur və altında
            abunəçilər cədvəli yüklənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Axtarış xanasına abunəçinin nömrəsini və ya emailini yazın (placeholder: «Nömrə və ya
            email ilə axtar…»).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazmağı dayandırandan təxminən yarım saniyə sonra cədvəl avtomatik süzülür — hər hərfdə
            deyil, qısa fasilədən sonra. Kartlardakı saylar da süzülmüş nəticəyə uyğunlaşır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Status üzrə daraltmaq üçün axtarışın yanındakı açılan siyahıdan birini seçin:{" "}
            <HelpKey>Bütün statuslar</HelpKey>, <HelpKey>Sınaq</HelpKey>, <HelpKey>Aktiv</HelpKey>,{" "}
            <HelpKey>Dayandırıldı</HelpKey>, <HelpKey>Ayrıldı</HelpKey> və ya{" "}
            <HelpKey>Bloklandı</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl dərhal seçilmiş statusa görə yenidən yüklənir. «Bütün statuslar» seçsəniz süzgəc
            götürülür və bütün abunəçilər qayıdır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Siyahıda istədiyiniz abunəçinin sətrinə klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Həmin abunəçinin detal səhifəsi açılır (abunəlik məlumatı, ödəniş və gəlir bölmələri ilə) —
            ünvan <HelpKey>/media/&lt;id&gt;</HelpKey> formasına dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Cədvəlin altında <HelpKey>Daha çox yüklə</HelpKey> düyməsi varsa, onu basıb növbəti
            partiyanı yükləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mövcud sətrlər qalır, altına yeni abunəçilər əlavə olunur. Daha qalmadıqda düymə yox olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: siyahını yenilə">
        <HelpStep n={1}>
          <p>
            Süzgəc panelinin sağındakı dairəvi ox ikonalı (<HelpKey>Yenilə</HelpKey>) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl baxdığınız axtarış və status filtri ilə başdan yüklənir; statistika kartları da
            yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Saylardakı <strong>Ümumi abunəçilər</strong> rəqəmi hazırda yüklənmiş partiyanı sayır —
          <HelpKey>Daha çox yüklə</HelpKey> ilə daha çox gətirdikcə dəyişə bilər. Dəqiq tam say üçün
          status filtrini «Bütün statuslar»da saxlayıb axtarışı boşaldın.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <HelpKey>Yeni abunəçi</HelpKey> düyməsi səhifədə görünür, lakin bu məqalə yalnız landinq
          səhifəsini əhatə edir — yeni abunəçi yaratma axını ayrıca işdir. Mövcud abunəçini açmaq üçün
          sadəcə sətrinə klikləyin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün abunəçilər, saylar və gəlir rəqəmləri yalnız sizin təşkilatınızla məhdudlaşır —
          sorğular daxili <HelpKey>x-organization-id</HelpKey> başlığı ilə tenant-ınıza bağlanır,
          başqa təşkilatın abunəçilərini görmürsünüz.
        </p>
      </HelpCallout>
    </div>
  )
}
