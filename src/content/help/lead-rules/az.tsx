"use client"

/**
 * Lead Assignment Rules — help article (Azerbaijani).
 * Tənzimləmələr → Lid Təyinat Qaydaları səhifəsini əhatə edir:
 * qayda yaratma (inline redaktə), şərtlər (sahə/operator/dəyər),
 * round-robin vs şərt metodu, prioritet, məsul şəxslər, aktiv/deaktiv,
 * statistika kartları və silmə. Səhifə üçün İLK yardım məqaləsidir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function LeadRulesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış meneceri və ya əməliyyat administratorusunuz"
        goal="Gələn lidlərin avtomatik olaraq doğru komanda üzvlərinə — şərtlərə və ya növbə (round-robin) əsasında — yönləndirilməsi üçün qaydalar qurmaq"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Lid Təyinat Qaydaları</HelpKey> yolu ilə
        çatırsınız. Bütün qaydalar yalnız sizin təşkilatınız üçündür. Qaydalar siyahıda{" "}
        <strong>prioritetə</strong> görə (kiçik rəqəm birinci) sıralanır və ekranda nə görürsünüzsə —
        saylar və kartlar — hamısı eyni siyahıdan oxunur, ona görə dəyişiklik etdikcə yuxarıdakı
        statistika kartları dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda filtr ikonası ilə <HelpKey>Lid Təyinat Qaydaları</HelpKey> adı, altında «Şərtlərə və
          ya növbə əsasında avtomatik lid yönləndirmə» izahı, sağ yuxarıda isə{" "}
          <HelpKey>Qayda Əlavə Et</HelpKey> düyməsi var. Altda üç statistika kartı durur:{" "}
          <strong>Ümumi Qaydalar</strong>, <strong>Aktiv Qaydalar</strong> (yaşıl rəqəm) və{" "}
          <strong>Məsul Şəxslər</strong>. Onların altında qaydalar siyahısı gəlir — hələ heç biri
          yoxdursa, bunun yerinə boş vəziyyət göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi Qaydalar">Yaratdığınız bütün qaydaların sayı (aktiv və deaktiv birlikdə).</HelpDef>
          <HelpDef term="Aktiv Qaydalar">Hazırda işləyən (aktiv) qaydaların sayı — yaşıl göstərilir.</HelpDef>
          <HelpDef term="Məsul Şəxslər">Bütün qaydalar üzrə təkrarlanmadan sayılan unikal məsul şəxslərin sayı.</HelpDef>
          <HelpDef term="Qayda">Adlı təyinat qaydası — metodu, prioriteti, şərtləri və məsul şəxsləri olan.</HelpDef>
          <HelpDef term="Metod">İki seçimdən biri: «Şərtə əsaslanan» (şərtlər ödənəndə yönləndirir) və ya «Round Robin» (lidləri məsul şəxslər arasında növbə ilə paylayır).</HelpDef>
          <HelpDef term="Şərt">Üç hissədən ibarət bir sətir: sahə (məs. source) + operator (məs. ==) + dəyər (məs. website). Round-robin metodunda şərt göstərilmir.</HelpDef>
          <HelpDef term="Prioritet">Rəqəm — kiçik dəyər birinci yoxlanılır. Siyahı prioritetə görə artan sırada düzülür.</HelpDef>
          <HelpDef term="Məsul şəxs">Lidin təyin edilə biləcəyi şəxsin adı (vergüllə ayrılmış mətn kimi yazılır).</HelpDef>
        </dl>
        <p>
          Hər qayda kartının başlığında soldan: <strong>Aktiv</strong> / <strong>Deaktiv</strong>{" "}
          nişanı, metod nişanı (<strong>Round Robin</strong> təzələmə ikonası ilə və ya{" "}
          <strong>Şərt</strong> filtr ikonası ilə) və «Prioritet: N» yazısı olur. Sağda üç idarəetmə
          var: <HelpKey>Söndür</HelpKey> / <HelpKey>Yandır</HelpKey> mətn düyməsi, qələm ikonalı redaktə
          düyməsi (redaktə açıqkən × olur) və qırmızı zibil qutusu ikonalı silmə düyməsi. Kartın
          gövdəsində qaydanın adı, varsa təsviri, şərtlər monospace «sahə operator "dəyər"» nişanları
          kimi və məsul şəxslər nişan kimi (heç biri yoxdursa «Məsul şəxs yoxdur») göstərilir. Deaktiv
          qaydanın kartı solğun (yarı-şəffaf) görünür.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni qayda yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Qayda Əlavə Et</HelpKey> düyməsini basın. (Heç qayda yoxdursa, boş
            vəziyyətin ortasındakı <HelpKey>İlk Qaydanı Yarat</HelpKey> düyməsi də eyni işi görür.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Qayda yaradıldı» bildirişi çıxır. Pəncərə AÇILMIR — siyahıya dərhal yeni bir qayda əlavə
            olunur (adı «New Rule», metodu «Şərtə əsaslanan», prioriteti 50, vəziyyəti{" "}
            <strong>Deaktiv</strong>, hazır bir boş şərtlə) və həmin kart birbaşa redaktə rejimində
            açılır. <strong>Ümumi Qaydalar</strong> sayı bir vahid artır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Redaktə formasında <strong>Ad</strong> sahəsinə mənalı bir ad yazın (məs. «Veb-sayt lidləri»),
            yanındakı <strong>Prioritet (kiçik = birinci)</strong> sahəsində isə rəqəmi lazım olsa
            dəyişin. İstəsəniz bir sətirlik <strong>Təsvir</strong> də əlavə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ad və Prioritet yan-yana iki sütunda, altında isə Təsvir sahəsi durur. Prioritet sahəsi
            yalnız rəqəm qəbul edir. Hələ heç nə yadda saxlanmır — dəyişikliklər siz Yadda saxla deyənə
            qədər müvəqqətidir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Metod</strong> açılan siyahısından birini seçin: <HelpKey>Şərtə əsaslanan</HelpKey>{" "}
            (lid şərtlərə uyğun gələndə yönləndirir) və ya <HelpKey>Round Robin</HelpKey> (lidləri məsul
            şəxslər arasında növbə ilə paylayır).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Round Robin» seçsəniz, aşağıdakı <strong>Şərtlər</strong> bölməsi tamamilə gizlənir — bu
            metod heç bir şərt tələb etmir. «Şərtə əsaslanan» seçsəniz şərtlər bölməsi yenidən görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Metod «Şərtə əsaslanan»dırsa, <strong>Şərtlər</strong> bölməsində hər şərt üçün üç element
            seçin: <strong>sahə</strong> (source, estimated_value, interest, company_size, country,
            industry), <strong>operator</strong> (==, !=, &gt;=, &lt;=, contains, starts_with) və{" "}
            <strong>dəyər</strong>. Daha çox şərt üçün <HelpKey>Şərt Əlavə Et</HelpKey> basın; artıq
            şərti yanındakı qırmızı zibil ikonası ilə silin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər şərt bir sətirdə görünür: iki açılan siyahı, bir mətn qutusu («Dəyər» placeholder-i ilə)
            və silmə ikonası. <HelpKey>Şərt Əlavə Et</HelpKey> standart olaraq yeni «source == » sətri
            yaradır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            <strong>Məsul şəxslər (vergüllə ayırın)</strong> sahəsinə adları vergüllə ayıraraq yazın
            (məs. <HelpKey>Əli Həsənov, Aysel Məmmədova</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahə placeholder olaraq nümunə adlar göstərir. Yazdığınız mətn vergüllərə görə ayrı-ayrı
            adlara bölünür; boş aralıqlar avtomatik atılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Aşağıdakı <HelpKey>Yadda saxla</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> ilə redaktəni bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yadda saxla düyməsi qısa müddətə fırlanan ikona göstərir, sonra «Qayda yadda saxlanıldı»
            bildirişi çıxır və kart adi (baxış) rejiminə qayıdır: ad, şərt nişanları və məsul şəxs
            nişanları yenilənmiş halda görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: qaydanı redaktə et, yandır/söndür və ya sil">
        <HelpStep n={1}>
          <p>
            Mövcud qaydanı dəyişmək üçün kartın sağındakı qələm ikonalı düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart, ad/prioritet/təsvir/metod/şərtlər/məsul şəxslər ilə əvvəlcədən doldurulmuş eyni redaktə
            formasına keçir. Qələm ikonası × işarəsinə çevrilir — onu basıb dəyişiklikləri yadda
            saxlamadan redaktəni bağlaya bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Qaydanı silmədən aktiv/deaktiv etmək üçün kartdakı <HelpKey>Yandır</HelpKey> (deaktiv
            qaydada) və ya <HelpKey>Söndür</HelpKey> (aktiv qaydada) mətn düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Vəziyyət nişanı yaşıl <strong>Aktiv</strong> ilə boz <strong>Deaktiv</strong> arasında dərhal
            keçir, kartın solğunluğu dəyişir və yuxarıdakı <strong>Aktiv Qaydalar</strong> sayı uyğun
            olaraq artıb-azalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Qaydanı büsbütün silmək üçün kartdakı qırmızı zibil qutusu ikonalı düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qayda siyahıdan dərhal yox olur, «Qayda silindi» bildirişi çıxır və{" "}
            <strong>Ümumi Qaydalar</strong> (qayda aktiv idisə həm də <strong>Aktiv Qaydalar</strong>)
            sayı azalır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmənin əlavə təsdiq pəncərəsi yoxdur — düyməni basan kimi qayda gedir və bu geri
            qaytarılmır. Qaydanı sadəcə müvəqqəti dayandırmaq istəyirsinizsə, silmək yerinə{" "}
            <HelpKey>Söndür</HelpKey> ilə deaktiv edin — qayda və bütün parametrləri qalır, sadəcə
            işləməz.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Yeni qayda standart olaraq <strong>deaktiv</strong> yaradılır — yəni hazırlamağı bitirib
          məzmunundan əmin olana qədər lidləri yönləndirmir. Hər şeyi düzəltdikdən sonra{" "}
          <HelpKey>Yandır</HelpKey> ilə aktivləşdirin. Prioritetdən istifadə edərək hansı qaydanın əvvəl
          yoxlanacağını idarə edin: kiçik rəqəmli qayda birinci gəlir, ona görə daha dar/spesifik
          qaydalara daha kiçik prioritet verin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün qaydalar təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın qaydalarını görür və
          redaktə edirsiniz, başqa təşkilatınkilərə çıxışınız yoxdur. Səhifə sorğuları cari təşkilat
          kimliyi ilə göndərilir.
        </p>
      </HelpCallout>
    </div>
  )
}
