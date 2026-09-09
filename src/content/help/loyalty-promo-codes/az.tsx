"use client"

/**
 * Promo kodlar — help article (Azerbaijani).
 * Mənbə səhifə: src/app/(dashboard)/loyalty/promo-codes/page.tsx
 * Yalnız Loyallıq → Promo kodlar səhifəsini əhatə edir (kod kataloqu —
 * yaratma, redaktə, söndür/yandır, silmə, status filtri, istifadə
 * limitləri). Bal/loyallıq mexanikası bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function loyaltypromocodesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq və ya əməliyyat administratorusunuz"
        goal="Müştərilərin ödəniş zamanı tətbiq edəcəyi endirim kodları yaratmaq və onların istifadəsini idarə etmək"
      >
        Səhifəyə <HelpKey>Loyallıq</HelpKey> → <HelpKey>Promo kodlar</HelpKey> yolu ilə çatırsınız.
        Bütün kodlar yalnız sizin təşkilatınız üçündür. Səhifə açılanda mövcud kodlar siyahısı
        yüklənir; siz buradan kod yarada, redaktə edə, müvəqqəti söndürə və ya silə bilərsiniz. Hər
        kodun yanında onun neçə dəfə istifadə olunduğu da göstərilir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda etiket ikonası ilə <HelpKey>Promo kodlar</HelpKey> adı və altında qısa izah var.
          Sağ yuxarıda iki düymə durur: <HelpKey>Yeni kod</HelpKey> (artı ikonası) və yenilə düyməsi
          (dairəvi ox — yükləmə vaxtı fırlanır). Onların altında <HelpKey>Status:</HelpKey> filtri
          gəlir — kodları <strong>Hamısı</strong>, <strong>Aktiv</strong> və ya{" "}
          <strong>Söndürülüb</strong> üzrə süzgəcdən keçirir. Aşağıda kod siyahısı yerləşir; hələ heç
          bir kod yoxdursa, onun yerinə boş vəziyyət kartı göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Promo kod">Müştərinin ödəniş zamanı yazdığı endirim açarı — böyük hərf və rəqəmlərdən ibarət (məs. SUMMER25).</HelpDef>
          <HelpDef term="Faiz">Endirim sifariş məbləğinin faizi kimi tətbiq olunur (məs. 25%).</HelpDef>
          <HelpDef term="Fiks məbləğ">Endirim seçilmiş valyutada sabit məbləğdir (məs. 10 USD); bu növ üçün valyuta tələb olunur.</HelpDef>
          <HelpDef term="Ümumi istifadə limiti">Kodun ümumilikdə neçə dəfə tətbiq oluna biləcəyi; boş = limitsiz.</HelpDef>
          <HelpDef term="Müştəri başına limit">Bir müştərinin kodu neçə dəfə tətbiq edə biləcəyi; boş = limitsiz.</HelpDef>
          <HelpDef term="Min. sifariş məbləği">Kodun işləməsi üçün lazım olan ən aşağı sifariş məbləği; boş = şərt yoxdur.</HelpDef>
          <HelpDef term="Etibarlılıq müddəti">«Etibarlıdır» və «Bitir» tarix-saatları — kodun nə vaxtdan nə vaxta qədər keçərli olduğu.</HelpDef>
          <HelpDef term="İstifadə olunub">Kodun indiyədək neçə dəfə tətbiq edildiyi; limit varsa «istifadə/limit» formatında göstərilir.</HelpDef>
        </dl>
        <p>
          Hər kod sətrində mono şriftli kod adı, yanında endirim nişanı (faizdə{" "}
          <strong>faiz ikonası + %</strong>, fiksdə <strong>məbləğ + valyuta</strong>), kod
          söndürülübsə boz <strong>Söndürülüb</strong> nişanı, varsa təsvir və bir sətirdə
          statistika (<strong>İstifadə olunub</strong>, <strong>Müştəri başına</strong>,{" "}
          <strong>Min. sifariş</strong>) görünür. Sağda üç əməliyyat var:{" "}
          <HelpKey>Söndür</HelpKey>/<HelpKey>Yandır</HelpKey> mətn düyməsi, redaktə (qələm ikonası) və
          sil (zibil qutusu ikonası).
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni promo kod yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni kod</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahının üstündə «Promo kod yarat» başlıqlı forma kartı açılır. İçində{" "}
            <strong>Kod</strong>, <strong>Endirim növü</strong>, endirim dəyəri, <strong>Təsvir</strong>,{" "}
            <strong>Min. sifariş məbləği</strong>, <strong>Ümumi istifadə limiti</strong> +{" "}
            <strong>Müştəri başına limit</strong>, <strong>Etibarlıdır</strong> / <strong>Bitir</strong>{" "}
            tarixləri və <strong>Aktiv</strong> qeyd qutusu (standart olaraq işarələnmiş) var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Kod</strong> sahəsinə açarı yazın (məs. <HelpKey>SUMMER25</HelpKey>). Bu sahə
            məcburidir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca hərflər avtomatik <strong>böyük hərfə</strong> çevrilir və mono şriftlə görünür;
            yer tutucu kimi «SUMMER25» nümunəsi durur. Kodu boş buraxıb yadda saxlamağa çalışsanız,
            yuxarıda qırmızı «Kod tələb olunur» xətası çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Endirim növü</strong>ndən <HelpKey>Faiz</HelpKey> və ya <HelpKey>Fiks məbləğ</HelpKey>
            {" "}seçin, sonra endirim dəyərini daxil edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Faiz</strong> seçəndə sahə «Endirim %» adlanır. <strong>Fiks məbləğ</strong> seçəndə
            sahə «Endirim məbləği»nə dəyişir və yanında yeni <strong>Valyuta (ISO 4217)</strong> sahəsi
            açılır (yer tutucu «USD», üç hərflə məhdudlaşır). Dəyər 0-dan böyük olmalıdır; faizdə 100-ü
            keçə bilməz — əks halda uyğun qırmızı xəta çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            İstəyə bağlı limitləri və müddəti doldurun: <strong>Min. sifariş məbləği</strong>,{" "}
            <strong>Ümumi istifadə limiti</strong>, <strong>Müştəri başına limit</strong>,{" "}
            <strong>Etibarlıdır</strong> və <strong>Bitir</strong> tarixləri. İstəsəniz{" "}
            <strong>Təsvir</strong> də əlavə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər iki limit sahəsinin yer tutucusu «limitsiz» yazır — boş buraxsanız limit tətbiq
            olunmur. Tarix sahələri təqvim-saat seçicisidir. Limitlər mənfi olmayan tam ədəd, min.
            sifariş isə mənfi olmayan ədəd olmalıdır; əks halda yadda saxlayanda qırmızı xəta çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Aşağıda <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> və ya sağ yuxarıdakı × ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə saxlanarkən içində fırlanan göstərici görünür, sonra forma bağlanır və yeni kod
            siyahıda peyda olur — mono kod adı, endirim nişanı və «İstifadə olunub: 0» ilə. Nəsə
            səhvdirsə, forma bağlanmır və yuxarıda qırmızı xəta mesajı qalır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: kodu redaktə et">
        <HelpStep n={1}>
          <p>
            Dəyişmək istədiyiniz kodun sətrində qələm ikonalı (<HelpKey>Redaktə et</HelpKey>) düyməni
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Promo kodu redaktə et» başlıqlı, mövcud dəyərlərlə əvvəlcədən doldurulmuş eyni forma açılır.
            <strong> Kod</strong> və <strong>Endirim növü</strong> sahələri sönük olur və yanlarında
            «(dəyişmir)» qeydi durur — onlar yaradıldıqdan sonra dəyişdirilə bilməz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Dəyişdirə biləcəyiniz sahələri (təsvir, endirim dəyəri, limitlər, müddət, aktivlik)
            yeniləyin və <HelpKey>Yadda saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxlandıqdan sonra forma bağlanır və kart sətrinə yenilənmiş dəyərlər əks olunur. Yaratma
            ilə eyni yoxlamalar burada da işləyir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: kodu söndür, yandır və ya sil">
        <HelpStep n={1}>
          <p>
            Kodu silmədən müvəqqəti dayandırmaq üçün sətrindəki <HelpKey>Söndür</HelpKey> mətn
            düyməsini basın (söndürülmüş kodda bu düymə <HelpKey>Yandır</HelpKey> olur).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kodun yanında boz <strong>Söndürülüb</strong> nişanı görünür/yox olur, düymə özü{" "}
            <strong>Söndür</strong> ↔ <strong>Yandır</strong> arasında keçir. Söndürülmüş kod ödəniş
            zamanı tətbiq olunmur, lakin siyahıda qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Kodu büsbütün silmək üçün qırmızı zibil qutusu ikonalı (<HelpKey>Sil</HelpKey>) düyməni
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Brauzerin təsdiq pəncərəsi çıxır: «{"«…»"} kodunu tam silmək? İstifadə olunmuşsa bloklanır —
            əvəzində söndürün.» Təsdiqləsəniz və kod heç vaxt istifadə olunmayıbsa, sətirdən yox olur.
            Əgər kodun ən azı bir istifadəsi varsa, silmə bloklanır və yuxarıda qırmızı xəta mesajı
            görünür.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            İstifadə olunmuş kodu <strong>silmək olmur</strong> — bu, müştəri istifadəsi tarixçəsini
            qorumaq üçündür. Belə kodu dövriyyədən çıxarmaq üçün silməyə cəhd etmək yerinə{" "}
            <HelpKey>Söndür</HelpKey> ilə qeyri-aktiv edin: kod və onun istifadə tarixçəsi qalır, sadəcə
            artıq tətbiq olunmur.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Limitlər və müddət istəyə bağlıdır — sadə, müddətsiz kod üçün hamısını boş buraxa bilərsiniz.
          <strong> Ümumi istifadə limiti</strong> kampaniya büdcəsini qorumaq üçün, <strong>Müştəri
          başına limit</strong> isə bir nəfərin kodu təkrar-təkrar tətbiq etməsinin qarşısını almaq üçün
          əlverişlidir. Hər kodun «İstifadə olunub: 5/100» sayğacı kampaniyanın nə qədər istifadə
          edildiyini bir baxışda göstərir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün promo kodlar təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın kodlarını görür və
          idarə edirsiniz. İstifadə limitləri server tərəfində qorunur: bir neçə müştəri kodu eyni anda
          tətbiq etsə belə, limit etibarlı şəkildə saxlanılır və artıq tətbiqlərin qarşısı alınır.
        </p>
      </HelpCallout>
    </div>
  )
}
