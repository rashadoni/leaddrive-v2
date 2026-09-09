"use client"

/**
 * Media Cloud → Reklam Kampaniyaları (ad-campaigns siyahısı) — help məqaləsi (Azərbaycanca).
 * Media bölməsindən ayrılmış müstəqil məqalə: YALNIZ
 * Media → Reklam Kampaniyaları siyahı səhifəsini əhatə edir
 * (statistika kartları, axtarış/status filtri, kampaniya cədvəli, "Daha çox yüklə").
 * Bu səhifə yalnız oxumaq üçündür — burada kampaniya yaratmaq/redaktə düyməsi YOXDUR.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mediaadcampaignsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Media və ya reklam əməliyyatları ilə məşğul olan istifadəçisiniz"
        goal="Reklam kampaniyalarının siyahısına baxmaq, statusa və büdcəyə görə vəziyyəti izləmək və konkret kampaniyanı tez tapmaq"
      >
        Səhifəyə <HelpKey>Media</HelpKey> → <HelpKey>Reklam Kampaniyaları</HelpKey> yolu ilə çatırsınız.
        Bütün kampaniyalar yalnız sizin təşkilatınız üçündür. Bu səhifə baxış (oxu) səhifəsidir — burada
        statistika, filtr və siyahı görürsünüz; kampaniya yaratmaq/redaktə üçün düymə bu səhifədə yoxdur.
        Statistika kartlarındakı saylar hazırda yüklənmiş siyahıdan hesablanır, ona görə filtri
        dəyişdikcə kartlar da uyğun olaraq yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda televizor ikonası ilə birlikdə <HelpKey>Reklam Kampaniyaları</HelpKey> adı, altında
          «Reklam kampaniyaları — büdcə, tarixlər və performans.» izahı var. Onun altında dörd statistika
          kartı durur: <strong>Ümumi kampaniyalar</strong>, <strong>Aktiv</strong>,{" "}
          <strong>Tamamlandı</strong> və <strong>Ümumi büdcə</strong>. Kartların altında filtr zolağı
          (axtarış sahəsi, status açılan siyahısı və yeniləmə düyməsi), daha aşağıda isə kampaniya cədvəli
          gəlir. Siyahı uzundursa, ən altda <HelpKey>Daha çox yüklə</HelpKey> düyməsi görünür.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi kampaniyalar">Hazırda yüklənmiş kampaniyaların sayı.</HelpDef>
          <HelpDef term="Aktiv">Statusu «Davam edir» olan kampaniyaların sayı.</HelpDef>
          <HelpDef term="Tamamlandı">Statusu «Tamamlandı» olan kampaniyaların sayı.</HelpDef>
          <HelpDef term="Ümumi büdcə">Yüklənmiş kampaniyaların ümumi büdcələrinin cəmi (valyuta formatında).</HelpDef>
          <HelpDef term="Kampaniya">Cədvəl sətrində kampaniyanın adı və altında monospace şriftlə kampaniya nömrəsi.</HelpDef>
          <HelpDef term="Status">Kampaniyanın vəziyyəti rəngli nişan kimi: Qaralama, Planlaşdırıldı, Davam edir, Dayandırıldı, Tamamlandı, Ləğv edildi.</HelpDef>
          <HelpDef term="Büdcə / Xərcləndi">Kampaniyanın ümumi büdcəsi və indiyə qədər xərclənmiş məbləğ (valyuta ilə).</HelpDef>
          <HelpDef term="Başlama / Bitmə tarixi">Kampaniyanın yayım (flight) tarixləri; təyin edilməyibsə «—» göstərilir.</HelpDef>
        </dl>
        <p>
          Cədvəlin sütunları soldan sağa: <strong>Kampaniya</strong>, <strong>Status</strong>,{" "}
          <strong>Büdcə</strong>, <strong>Xərcləndi</strong>, <strong>Başlama tarixi</strong> və{" "}
          <strong>Bitmə tarixi</strong>. Hər sütun başlığına basıb sıralaya bilərsiniz.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: siyahını oxu və saylara bax">
        <HelpStep n={1}>
          <p>
            Səhifə açılan kimi dörd statistika kartına nəzər salın: <HelpKey>Ümumi kampaniyalar</HelpKey>,{" "}
            <HelpKey>Aktiv</HelpKey>, <HelpKey>Tamamlandı</HelpKey> və <HelpKey>Ümumi büdcə</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kart üzərində öz ikonası (mətn balonu, oxun işarəsi, dollar işarəsi) və rəqəm dəyəri var.
            <strong>Ümumi büdcə</strong> kartı dəyəri valyuta formatında (məs. $0) göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Aşağıda kampaniya cədvəlinə baxın. Hər sətirdə kampaniyanın adı, altında kampaniya nömrəsi,
            sonra status nişanı, büdcə, xərclənən məbləğ və yayım tarixləri var.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Status sütunu rəngli nişan kimi görünür — məsələn yaşıl <strong>Davam edir</strong>, sarı{" "}
            <strong>Dayandırıldı</strong>, boz <strong>Qaralama</strong>. Tarix təyin edilməmiş sahələrdə
            «—» yazılır. Heç kampaniya yoxdursa, cədvəl boş vəziyyət göstərir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: axtar və statusa görə filtr et">
        <HelpStep n={1}>
          <p>
            Filtr zolağındakı axtarış sahəsinə kampaniya nömrəsini (və ya email-i) yazın — sahənin
            placeholder mətni <HelpKey>Nömrə və ya email ilə axtar…</HelpKey> şəklindədir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazmağı dayandırdıqdan az sonra (təxminən yarım saniyə) siyahı avtomatik yenilənir — düyməyə
            basmağa ehtiyac yoxdur. Axtarışa uyğun kampaniyalar qalır, qalanları cədvəldən çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Status açılan siyahısından bir vəziyyət seçin (məs. <HelpKey>Davam edir</HelpKey> və ya{" "}
            <HelpKey>Tamamlandı</HelpKey>). Bütün kampaniyaları göstərmək üçün{" "}
            <HelpKey>Bütün statuslar</HelpKey> seçimini saxlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçim edən kimi siyahı yalnız həmin statusdakı kampaniyalarla yenilənir. Statistika kartları da
            görünən nəticəyə uyğunlaşır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Siyahını yenidən serverdən çəkmək üçün filtr zolağının sağındakı yeniləmə (dövrə oxu) ikonalı
            düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl ilk səhifədən yenidən yüklənir; cari axtarış və status filtri qüvvədə qalır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: daha çox kampaniya yüklə və sırala">
        <HelpStep n={1}>
          <p>
            Cədvəl bir səhifədə müəyyən sayda kampaniya göstərir. Daha çoxu varsa, ən altdakı{" "}
            <HelpKey>Daha çox yüklə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Növbəti kampaniyalar mövcud siyahının sonuna əlavə olunur (siyahı sıfırlanmır). Yükləmə
            gedərkən düymə müvəqqəti söndürülür. Daha çox kampaniya qalmayıbsa, düymə görünmür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sıralamaq üçün istənilən sütun başlığına — <HelpKey>Kampaniya</HelpKey>,{" "}
            <HelpKey>Status</HelpKey>, <HelpKey>Büdcə</HelpKey>, <HelpKey>Xərcləndi</HelpKey>,{" "}
            <HelpKey>Başlama tarixi</HelpKey> və ya <HelpKey>Bitmə tarixi</HelpKey> — basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl həmin sütuna görə yenidən sıralanır; təkrar bassanız, istiqamət (artan/azalan) dəyişir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Statistika kartlarındakı saylar bütün baza yox, hazırda <strong>yüklənmiş</strong> siyahıdan
          hesablanır. Ona görə real ümumi mənzərəni görmək üçün əvvəlcə <HelpKey>Daha çox yüklə</HelpKey>{" "}
          ilə qalan kampaniyaları əlavə edin və ya istədiyiniz statusu filtrlə seçib həmin kəsiyə baxın.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu səhifə yalnız baxış üçündür — burada kampaniya yaratmaq, redaktə etmək və ya silmək düyməsi
          yoxdur. Status, büdcə və tarixlər burada dəyişdirilmir; bu səhifə mövcud kampaniyaların
          vəziyyətini izləmək üçündür.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün reklam kampaniyaları təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın kampaniyalarını
          görürsünüz, başqa təşkilatın məlumatı bu siyahıya düşmür.
        </p>
      </HelpCallout>
    </div>
  )
}
