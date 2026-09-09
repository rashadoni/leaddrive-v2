"use client"

/**
 * Sales Territories — help article (Azerbaijani).
 * "quotas-territories" birgə məqaləsindən ayrılıb: yalnız
 * Tənzimləmələr → Satış əraziləri səhifəsini əhatə edir
 * (ərazi yaratma, avtomatik təyinat qaydaları, üzv idarəetməsi,
 * aktiv/qeyri-aktiv vəziyyət). Kvota hissəsi bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function TerritoriesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış meneceri və ya əməliyyat administratorusunuz"
        goal="Komandanı coğrafi və ya sahə üzrə bölgələrə bölmək və hansı nümayəndənin hansı hesabları əhatə etdiyini təyin etmək"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Satış əraziləri</HelpKey> yolu ilə
        çatırsınız. Bütün ərazilər və üzv təyinatları yalnız sizin təşkilatınız üçündür. Burada nə
        görürsünüzsə — saylar, ərazilər və üzvlər — hamısı eyni siyahıdan oxunur, ona görə dəyişiklik
        etdikcə statistika kartları dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Satış əraziləri</HelpKey> adı, altında «Nümayəndələri coğrafi və ya sahə
          üzrə bölgələrə təyin edin» izahı, sağ yuxarıda isə <HelpKey>Yeni ərazi</HelpKey> düyməsi var.
          Altda üç statistika kartı durur: <strong>Ümumi</strong>, <strong>Aktiv</strong> və{" "}
          <strong>Ümumi üzvlər</strong>. Onların altında ərazi siyahısı gəlir — hələ heç biri yoxdursa,
          bunun yerinə boş vəziyyət göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi">Yaratdığınız bütün ərazilərin sayı (aktiv və qeyri-aktiv birlikdə).</HelpDef>
          <HelpDef term="Aktiv">Hazırda aktiv vəziyyətdə olan ərazilərin sayı.</HelpDef>
          <HelpDef term="Ümumi üzvlər">Bütün ərazilər üzrə üzv təyinatlarının cəmi.</HelpDef>
          <HelpDef term="Ərazi">Adlı bölgə — təsviri, aktiv/qeyri-aktiv vəziyyəti, avtomatik təyinat qaydaları və üzvləri olan.</HelpDef>
          <HelpDef term="Avtomatik təyinat qaydaları">Ölkə, sahə və şirkət ölçüsü filtrləri — hansı şirkətlərin bu əraziyə uyğun gəldiyini təsvir edir; boş buraxılsa bütün şirkətlərə uyğun gəlir.</HelpDef>
          <HelpDef term="Üzv">Əraziyə təyin edilmiş istifadəçi (nümayəndə).</HelpDef>
        </dl>
        <p>
          Hər ərazi kartında ad və yanında <strong>Aktiv</strong> / <strong>Qeyri-aktiv</strong>{" "}
          nişanı, varsa təsvir, bir sətirdə qaydaların xülasəsi, sağda isə dörd əməliyyat düyməsi olur:
          üzvlər (insan ikonası, yanında say), redaktə (qələm ikonası), dayandır/davam etdir və sil
          (zibil qutusu ikonası). Əraziyə üzv əlavə edilibsə, kartın altında ilk altı üzvün adı kiçik
          nişanlar kimi görünür.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni ərazi yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni ərazi</HelpKey> düyməsini basın. (Heç ərazi yoxdursa, boş
            vəziyyətin ortasındakı eyni adlı düymə də işləyir.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni ərazi» başlıqlı pəncərə açılır. İçində <strong>Ad *</strong> və{" "}
            <strong>Təsvir</strong> sahələri, <strong>Aktiv</strong> qeyd qutusu (standart olaraq
            işarələnmiş) və «Avtomatik təyinat qaydaları» adlı çərçivə var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Ad</strong> yazın — bu yeganə məcburi sahədir (məs. «Bakı regionu»). İstəsəniz bir
            sətirlik <strong>Təsvir</strong> də əlavə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca mətn sahələrdə görünür. Adı boş buraxıb yadda saxlamağa çalışsanız, yuxarıda
            qırmızı «Ad mütləqdir» xəbərdarlığı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İstəyə bağlı olaraq «Avtomatik təyinat qaydaları» çərçivəsini doldurun:{" "}
            <strong>Ölkələr</strong> (ISO kodları, vergüllə ayrılmış — məs. <HelpKey>AZ, GE, TR</HelpKey>),{" "}
            <strong>Sahələr</strong> (vergüllə ayrılmış — məs. Texnologiya, Maliyyə, Pərakəndə),{" "}
            <strong>Min. işçi sayı</strong> və <strong>Maks. işçi sayı</strong> (0 = limitsiz).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Çərçivənin başında «Boş buraxın — bütün şirkətlərə uyğun gəlir» ipucusu durur. Ölkə kodları
            yadda saxlanarkən avtomatik böyük hərflərə çevrilir; işçi sayı sahələri yalnız rəqəm qəbul
            edir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Aşağıdakı <HelpKey>Ərazini yadda saxla</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> və ya sağ yuxarıdakı × ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yadda saxlanarkən «Yadda saxlanılır…» yazısına keçir, sonra pəncərə bağlanır və yeni
            ərazi siyahıda peyda olur. <strong>Ümumi</strong> (və əgər aktivdirsə <strong>Aktiv</strong>)
            kartındakı say bir vahid artır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: əraziyə üzv əlavə et və ya sil">
        <HelpStep n={1}>
          <p>
            Ərazi kartında yanında say olan insan ikonalı düyməni (<HelpKey>Üzvləri idarə et</HelpKey>)
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Üzvlər — &lt;ərazi adı&gt;» başlıqlı pəncərə açılır. Cari üzvlər ad və e-poçtu ilə
            sadalanır; hələ üzv yoxdursa «Hələ üzv yoxdur.» mətni görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Üzv əlavə etmək üçün aşağıdakı açılan siyahıdan bir istifadəçi seçin və{" "}
            <HelpKey>Əlavə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahıda yalnız hələ üzv OLMAYAN istifadəçilər ad və e-poçtla görünür. Əlavə
            etdikdən sonra istifadəçi yuxarıdakı cari üzvlər siyahısına keçir və açılan siyahıdan
            çıxır. Əlavə alınmasa, qırmızı xəta mesajı göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Üzvü silmək üçün onun sətrindəki × ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İstifadəçi cari üzvlər siyahısından dərhal yox olur və yenidən açılan siyahıda mövcud olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Bitirdikdə aşağıdakı <HelpKey>Hazırdır</HelpKey> düyməsi ilə (və ya × ilə) pəncərəni bağlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Pəncərə bağlanır. Ərazi kartındakı üzv sayı və alt hissədəki ad nişanları yenilənmiş üzv
            siyahısını əks etdirir; <strong>Ümumi üzvlər</strong> kartı da uyğunlaşır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: ərazini redaktə et, dayandır və ya sil">
        <HelpStep n={1}>
          <p>
            Ərazini dəyişmək üçün kartdakı qələm ikonalı (<HelpKey>Redaktə et</HelpKey>) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Ərazini redaktə et» başlıqlı, mövcud ad, təsvir, vəziyyət və qaydalarla əvvəlcədən
            doldurulmuş eyni forma açılır. Dəyişiklikləri edib <HelpKey>Ərazini yadda saxla</HelpKey>{" "}
            ilə təsdiqləyin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Ərazini silmədən müvəqqəti söndürmək üçün <HelpKey>Dayandır</HelpKey> düyməsini basın
            (qeyri-aktiv ərazidə bu düymə <HelpKey>Davam etdir</HelpKey> olur).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kartdakı vəziyyət nişanı yaşıl <strong>Aktiv</strong> ilə boz <strong>Qeyri-aktiv</strong>{" "}
            arasında keçir, <strong>Aktiv</strong> statistika kartındakı say isə uyğun olaraq dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Ərazini büsbütün silmək üçün qırmızı zibil qutusu ikonalı (<HelpKey>Sil</HelpKey>) düyməni
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Ərazini sil» təsdiq pəncərəsi açılır və silinmənin bütün üzv təyinatlarını da
            siləcəyini xəbərdar edir. Təsdiqlədikdən sonra ərazi siyahıdan çıxır və statistika kartları
            yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmə geri qaytarılmır və <strong>həmin ərazinin bütün üzv təyinatlarını da silir</strong>.
            Komandanı sadəcə müvəqqəti çıxarmaq istəyirsinizsə, silmək yerinə{" "}
            <HelpKey>Dayandır</HelpKey> ilə qeyri-aktiv edin — ərazi və üzvləri qalır, sadəcə aktiv
            sayılmır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Qaydaları doldurmaq məcburi deyil. Boş qaydalı ərazi «Bütün şirkətlərə uyğun gəlir» kimi
          işarələnir — sadəcə insanları qruplaşdırmaq üçün adlı bölgə kimi istifadə edə bilərsiniz. Ölkə,
          sahə və ölçü filtrlərini yalnız bu əraziyə hansı hesabların uyğun gəldiyini dəqiqləşdirmək
          istəyəndə əlavə edin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün ərazilər və üzv təyinatları təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın
          istifadəçilərini üzv kimi əlavə edə bilərsiniz və başqa təşkilatın ərazilərini görmürsünüz. Üzv
          açılan siyahısı təşkilatınızın istifadəçilərindən gəlir.
        </p>
      </HelpCallout>
    </div>
  )
}
