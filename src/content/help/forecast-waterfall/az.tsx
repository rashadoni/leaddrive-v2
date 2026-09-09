"use client"

/**
 * Pipeline Waterfall — help article (Azerbaijani).
 * Köhnə birləşik "forecast" məqaləsindən ayrılıb: yalnız
 * /forecast/waterfall səhifəsinin mövzusu — satış boru xəttinin
 * seçilmiş dövr ərzində mərhələ keçidləri üzrə necə hərəkət etdiyini
 * oxumaq. Bu səhifə yalnız OXUNUR: heç nə yaratmır/silmir, yeganə
 * idarəetmə — dövr filtri və izah ipucuları.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function forecastwaterfallHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış meneceri və ya rəhbərisən"
        goal="Satış boru xəttinin seçilmiş dövrdə necə hərəkət etdiyini görmək — neçə sövdə yarandı, irəlilədi, geri qayıtdı, qazanıldı və ya itirildi, və pulda yekun nəticə nə oldu"
      >
        Səhifə avtomatik açılır və təşkilatının sövdə mərhələ keçidlərini
        oxuyur. Bu səhifə tamamilə <strong>oxunan</strong> səhifədir — burada
        heç nə yaratmır, redaktə etmir və ya silmirsən. Yeganə idarəetmə —
        yuxarıdakı dövr filtri və rəqəmlərin yanındakı izah ipucularıdır. Bütün
        məlumatlar yalnız öz tenant-ının sövdələrindən gəlir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda axın ikonu ilə <strong>Satış boru xətti şəlaləsi</strong> adı
          və altında qısa izah var. Sağda dövr filtri düymələri dayanır:{" "}
          <HelpKey>Son 7 gün</HelpKey>, <HelpKey>Son 30 gün</HelpKey>,{" "}
          <HelpKey>Son 90 gün</HelpKey>, <HelpKey>Son 180 gün</HelpKey> və{" "}
          <HelpKey>Bütün dövr</HelpKey> — standart olaraq <strong>Son 30 gün</strong>{" "}
          seçili olur. Aşağıda üç xülasə kartı, sonra şəlalə qrafiki, ən altda
          isə ətraflı cədvəl gəlir. Səhifənin sonunda bir sətirlik qeyd durur.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi keçidlər">
            Seçilmiş dövrdə sövdələrin neçə dəfə mərhələ dəyişdiyi — birinci
            kartda fəaliyyət ikonu ilə.
          </HelpDef>
          <HelpDef term="Xalis dəyişiklik">
            Satış boru xəttinin pulda yekun dəyişikliyi — dövrdəki bütün «Məbləğ
            Δ»-ların cəmi. Müsbətdirsə yaşıl və yuxarı ox, mənfidirsə qırmızı və
            aşağı ox ilə göstərilir.
          </HelpDef>
          <HelpDef term="Ən böyük hərəkət">
            Dövrdə ən çox sövdəsi olan keçid tipi — adı, sövdə sayı və onun
            məbləğ dəyişikliyi ilə. Heç keçid yoxdursa «—» yazılır.
          </HelpDef>
          <HelpDef term="Keçid növünə görə">
            Əsas qrafik: hər sütun bir keçid tipini göstərir, sütunun hündürlüyü
            o tipdə neçə sövdə olduğunu bildirir. Sütunlar tipə görə rənglənir.
          </HelpDef>
          <HelpDef term="Keçid (cədvəl sətri)">
            Cədvəldə hər sətir bir keçid tipidir: rəngli nöqtə + ad, sövdə sayı
            və həmin tipin məbləğ dəyişikliyi (Məbləğ Δ).
          </HelpDef>
        </dl>
        <p>
          Keçid tipləri yeddidir: <strong>Yaradıldı</strong> (huniyə daxil olan
          yeni sövdələr), <strong>İrəlilədi</strong> (daha yüksək ehtimallı
          mərhələyə keçən), <strong>Geri qayıtdı</strong> (daha aşağı ehtimallı
          mərhələyə qayıdan), <strong>Qazanıldı</strong>, <strong>İtirildi</strong>,{" "}
          <strong>Yenidən açıldı</strong> (bağlı mərhələdən huniyə geri qayıdan)
          və <strong>Yenidən təyin edildi</strong> (mərhələ dəyişmədən yalnız
          sahibi dəyişən). Hər ad və xülasə rəqəminin yanında kiçik{" "}
          <HelpKey>?</HelpKey> ikonu var — üzərinə gələndə bir sətirlik izah açır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: dövrü seç və rəqəmləri oxu">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı dövr filtrindən bir aralıq seç —{" "}
            <HelpKey>Son 7 gün</HelpKey>, <HelpKey>Son 30 gün</HelpKey>,{" "}
            <HelpKey>Son 90 gün</HelpKey>, <HelpKey>Son 180 gün</HelpKey> və ya{" "}
            <HelpKey>Bütün dövr</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş düymə əsas rənglə dolur, qalanları boz qalır. Səhifə həmin
            dövr üçün yenidən yüklənir — qısa müddət fırlanan ikon və{" "}
            <strong>Yüklənir…</strong> yazılı kart çıxır, sonra kartlar, qrafik
            və cədvəl yeni aralığa uyğun yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Üç xülasə kartına bax: <HelpKey>Ümumi keçidlər</HelpKey>,{" "}
            <HelpKey>Xalis dəyişiklik</HelpKey> və{" "}
            <HelpKey>Ən böyük hərəkət</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Birinci kartda keçidlərin ümumi sayı qalın rəqəmlə görünür. Xalis
            dəyişiklik kartı müsbət olanda yaşıl və yuxarı ox, mənfi olanda
            qırmızı və aşağı ox ilə göstərilir və məbləğin əvvəlində «+» və ya
            «−» işarəsi olur. «Ən böyük hərəkət» kartında keçid tipinin adı,
            mötərizədə sövdə sayı və altında onun məbləğ dəyişikliyi yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İstədiyin rəqəmin yanındakı <HelpKey>?</HelpKey> ikonunun üzərinə gəl
            (və ya klaviatura ilə fokuslayar).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kiçik ipucu pəncərəsi həmin göstəricinin nə demək olduğunu bir
            sətirdə açır — məsələn «Xalis dəyişiklik» üçün «dövrdəki bütün Məbləğ
            Δ-ların cəmi». Ipucu yalnız izahdır, heç nəyə toxunmur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: qrafiki və cədvəli oxu">
        <HelpStep n={1}>
          <p>
            Xülasə kartlarının altındakı <HelpKey>Keçid növünə görə</HelpKey>{" "}
            qrafikinə bax.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sütunlu qrafik görünür: hər sütun bir keçid tipidir, hündürlüyü o
            tipdəki sövdə sayını bildirir. Sütunlar tipə görə rənglənir (məsələn
            yaradıldı — mavi, qazanıldı — tünd yaşıl, itirildi — qırmızı). Sütunun
            üzərinə gələndə həmin tipin sövdə sayını və məbləğ dəyişikliyini
            göstərən qara ipucu açılır. Yalnız sayı 0-dan böyük olan tiplər
            qrafikdə görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Aşağıdakı ətraflı cədvələ keç — sütunlar{" "}
            <HelpKey>Keçid</HelpKey>, <HelpKey>Sövdələr</HelpKey> və{" "}
            <HelpKey>Məbləğ Δ</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə keçid tipinin rəngli nöqtəsi və adı (yanında ? ipucu),
            sövdə sayı və məbləğ dəyişikliyi olur. Məbləğ Δ müsbət olanda yaşıl
            və yuxarı ox, mənfi olanda qırmızı və aşağı ox, sıfır olanda boz
            göstərilir; rəqəmin əvvəlində «+» və ya «−» işarəsi yazılır. Cədvəl
            qrafikdən fərqli olaraq sayı 0 olan tipləri də göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Seçilmiş dövrdə heç bir mərhələ keçidi yoxdursa, qrafik kartı boş
            vəziyyət göstərir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qrafik yerinə <em>«Dövrdə mərhələ keçidi yoxdur.»</em> mesajı və
            altında «Mərhələ keçidləri sövdə mərhələsi dəyişəndə avtomatik
            yazılır. Köhnə sövdələr (funksiya işə düşməzdən əvvəl) retrospektiv
            görünməyəcək» izahı çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Bu səhifə nəyin işlədiyini deyil, satış boru xəttinin nə qədər
          <strong> hərəkət etdiyini</strong> göstərir. Mənfi <strong>Xalis
          dəyişiklik</strong> mütləq pis demək deyil — bəzən böyük itki bir
          böyük qazancla balanslanır. Tam mənzərəni görmək üçün əvvəlcə{" "}
          <HelpKey>Bütün dövr</HelpKey> seç, sonra son trendi izləmək üçün{" "}
          <HelpKey>Son 30 gün</HelpKey>-ə keç.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Mərhələ keçidləri yalnız sövdə mərhələsi dəyişdiyi <strong>andan</strong>{" "}
          yazılır. Bu funksiya əlavə olunmazdan əvvəl bağlanmış və ya hərəkət
          etmiş köhnə sövdələr burada retrospektiv görünmür — yəni boş və ya az
          dolu cədvəl mütləq «sakit dövr» yox, sadəcə tarixçənin hələ yığılmamış
          olması ola bilər.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün rəqəmlər təşkilatınla məhdudlaşır — səhifə yalnız öz tenant-ının
          sövdə keçidlərini oxuyur və başqa təşkilatların heç bir məlumatını
          göstərmir.
        </p>
      </HelpCallout>
    </div>
  )
}
