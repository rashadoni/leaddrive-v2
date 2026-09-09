"use client"

/**
 * Recurring Invoices — help article (Azerbaijani).
 * Yalnız Hesab-fakturalar → Təkrarlanan hesab-fakturalar səhifəsini əhatə edir
 * (təkrarlanan qayda yaratma, başlıq şablonu, tezlik/interval, mövqelər,
 * aktiv/dayandır vəziyyəti, toplu əməliyyatlar, "Hazırla və göndər" axını).
 * Adi (birdəfəlik) hesab-faktura bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InvoicesRecurringHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Maliyyə əməkdaşı və ya əməliyyat administratorusunuz"
        goal="Sabit dövriyyə ilə (məs. aylıq abunə və ya xidmət haqqı) hesab-fakturaları avtomatik hazırlamaq və müştəriyə göndərmək üçün təkrarlanan qaydalar qurmaq"
      >
        Səhifəyə <HelpKey>Hesab-fakturalar</HelpKey> siyahısından açılan{" "}
        <HelpKey>Təkrarlanan hesab-fakturalar</HelpKey> ekranı ilə çatırsınız; yuxarı solda{" "}
        <HelpKey>Siyahıya qayıt</HelpKey> düyməsi sizi adi hesab-faktura siyahısına qaytarır. Burada
        gördüyünüz hər şey — saylar, qaydalar siyahısı və nəticələr — yalnız sizin təşkilatınız üçündür.
        Qayda təkrarlanan hesab-fakturanı özü yaratmır: o, vaxtı çatanda və ya siz əl ilə işə salanda
        əsl hesab-fakturanı hazırlayan «resept»dir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda firuzəyi başlıq zolağı var: solda <HelpKey>Siyahıya qayıt</HelpKey>, ortada{" "}
          <strong>Təkrarlanan hesab-fakturalar</strong> adı və altında neçə qaydanın olduğunu göstərən
          say, sağda isə iki düymə — <HelpKey>Hazırla və göndər</HelpKey> (fırlanma ikonalı) və{" "}
          <HelpKey>Yeni</HelpKey> (üstəgəl ikonalı). Onun altında üç statistika kartı durur:{" "}
          <strong>Ümumi qaydalar</strong>, <strong>Aktiv</strong> və <strong>Dayandırılıb</strong>.
          Daha aşağıda axtarış sahəsi, «Hamısı» seçim qutusu və qaydaların cədvəli gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi qaydalar">Yaratdığınız bütün təkrarlanan qaydaların sayı (aktiv və dayandırılmış birlikdə).</HelpDef>
          <HelpDef term="Aktiv">Hazırda işləyən — vaxtı çatanda hesab-faktura hazırlayacaq qaydaların sayı.</HelpDef>
          <HelpDef term="Dayandırılıb">Müvəqqəti söndürülmüş — hesab-faktura hazırlamayan qaydaların sayı.</HelpDef>
          <HelpDef term="Tezlik / İnterval sayı">Qaydanın nə qədər tez-tez işləməsi: Gündəlik / Həftəlik / Aylıq / Rüblük / İllik, vurulan interval sayı (məs. interval 2 + Aylıq = hər 2  aydan bir).</HelpDef>
          <HelpDef term="Başlıq şablonu (Title Template)">Hazırlanan hesab-fakturanın adının necə qurulacağı. {"{month}"}, {"{year}"}, {"{number}"} dəyişənlərini dəstəkləyir; boş buraxılsa sabit başlıq işlədilir.</HelpDef>
          <HelpDef term="Növbəti">Cədvəldəki sütun — qaydanın növbəti dəfə işləyəcəyi tarix.</HelpDef>
          <HelpDef term="Yaradılıb">Cədvəldəki sütun — qaydanın indiyə qədər neçə hesab-faktura hazırladığı.</HelpDef>
        </dl>
        <p>
          Cədvəlin sütunları: seçim qutusu, <strong>Şirkət / Başlıq</strong>, <strong>Email</strong>,{" "}
          <strong>Status</strong> (yaşıl yanıb-sönən nöqtə ilə <strong>Aktiv</strong> və ya narıncı
          nöqtə ilə <strong>Dayandırılıb</strong>), <strong>Növbəti</strong> tarixi,{" "}
          <strong>Yaradılıb</strong> sayı və sağda iki əməliyyat düyməsi: dayandır/aktivləşdir (pauza
          və ya oxşar ikon) və sil (zibil qutusu). Heç bir nəticə yoxdursa cədvəldə «Nəticə tapılmadı»
          yazılır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni təkrarlanan qayda yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni təkrarlanan» başlıqlı geniş pəncərə açılır. İçində ardıcıl sahələr var:{" "}
            <strong>Başlıq *</strong>, <strong>Title Template</strong>, <strong>Şirkət</strong>,{" "}
            <strong>Tezlik</strong> + <strong>İnterval sayı</strong>, <strong>Başlanğıc</strong> +{" "}
            <strong>Bitmə</strong> tarixləri, <strong>Maksimum sayı</strong>, <strong>Valyuta</strong> +{" "}
            <strong>ƏDV daxil et</strong>, <strong>Ödəniş şərtləri</strong>,{" "}
            <strong>Alıcının emaili</strong>, <strong>Qeydlər</strong> və ən altda{" "}
            <strong>Mövqelər</strong> cədvəli.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Başlıq</strong> yazın — bu yeganə məcburi sahədir (məs. «Aylıq xidmət haqqı»).{" "}
            <strong>Title Template</strong> sahəsi siz Başlıq yazdıqca avtomatik olaraq{" "}
            <HelpKey>{"{başlıq} — {month} {year}"}</HelpKey> şəklində doldurulur; istəsəniz onu əl ilə
            dəyişin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Title Template sahəsinin altında «Variables: {"{month}"}, {"{year}"}, {"{number}"}. Leave
            empty to use static title.» izahı durur. Başlıq boş qalsa, aşağıdakı{" "}
            <HelpKey>Yarat</HelpKey> düyməsi sönük (deaktiv) qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İstəyə bağlı <strong>Şirkət</strong> açılan siyahısından alıcı şirkəti seçin (standart:
            «Şirkət seçin»). Sonra <strong>Tezlik</strong> və <strong>İnterval sayı</strong> ilə
            ritmi qurun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Şirkət siyahısı təşkilatınızın şirkətləri ilə dolur. Tezlik açılanında beş seçim var:{" "}
            <strong>Gündəlik</strong>, <strong>Həftəlik</strong>, <strong>Aylıq</strong>,{" "}
            <strong>Rüblük</strong>, <strong>İllik</strong>. İnterval sayı yalnız rəqəm qəbul edir
            (minimum 1).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            İstəyə bağlı <strong>Başlanğıc</strong> / <strong>Bitmə</strong> tarixlərini və{" "}
            <strong>Maksimum sayı</strong>nı təyin edin (boş buraxılsa «Limitsiz»).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tarix sahələri təqvim seçici açır. Maksimum sayı sahəsi boş olanda yer tutucu kimi
            «Limitsiz» göstərilir — yəni qayda dayandırılana və ya bitmə tarixinə çatana qədər işləyir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            <strong>Valyuta</strong>nı seçin və lazımdırsa <strong>ƏDV daxil et</strong> qutusunu
            işarələyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            ƏDV qutusunu işarələyən kimi yanında <strong>Vergi dərəcəsi</strong> sahəsi peyda olur
            (standart 0.18, yəni 18%; 0 ilə 1 arası onluq kəsr kimi yazılır). Qutu işarələnməmiş
            qalsa, vergi dərəcəsi sahəsi ümumiyyətlə görünmür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            İstəyə bağlı <strong>Ödəniş şərtləri</strong>ni (Net 7 / 15 / 30 / 45 / 60 və ya «Dərhal»),{" "}
            <strong>Alıcının emaili</strong>ni və <strong>Qeydlər</strong>i doldurun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ödəniş şərtləri açılanında standart «Ödəniş şərtlərini seçin» durur. Alıcının emaili sahəsi
            email formatı gözləyir (yer tutucu «email@example.com»). Bu email hazırlanan hesab-fakturanın
            avtomatik göndəriləcəyi ünvandır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={7}>
          <p>
            Ən aşağıdakı <strong>Mövqelər</strong> cədvəlində hesab-fakturanın sətirlərini yazın:{" "}
            <strong>Ad</strong>, <strong>Miqdar</strong>, <strong>Qiymət</strong> və{" "}
            <strong>Endirim</strong>. Daha çox sətir üçün <HelpKey>Mövqe əlavə et</HelpKey> düyməsini
            basın; sətri silmək üçün sağdakı zibil qutusu ikonasını işlədin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəldə həmişə ən azı bir boş sətir olur — sonuncu sətir qalanda silmə düyməsi sönük
            (deaktiv) olur. Adı boş qalan sətirlər yadda saxlanarkən nəzərə alınmır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={8}>
          <p>
            Aşağıdakı <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yadda saxlanarkən fırlanan ikon və «Saxlanılır...» yazısına keçir, sonra pəncərə
            bağlanır və yeni qayda cədvəldə peyda olur. <strong>Ümumi qaydalar</strong> (və qayda aktiv
            olduğu üçün <strong>Aktiv</strong>) kartındakı say bir vahid artır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: dərhal hazırla və göndər">
        <HelpStep n={1}>
          <p>
            Vaxtı çatmış qaydalar üzrə hesab-fakturaları dərhal yaratmaq və göndərmək üçün sağ
            yuxarıdakı <HelpKey>Hazırla və göndər</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymədəki ikon fırlanmağa başlayır (proses gedir). Bitdikdə yaşıl çərçivəli nəticə paneli
            açılır: başlığında «Son nəticə: N göndərildi, M xəta» yazılır, içində isə hər hesab-faktura
            ayrıca sətirdə — nömrəsi, şirkəti və statusu (<strong>Göndərildi</strong> /{" "}
            <strong>Xəta</strong> / <strong>Qaralama</strong>) ilə — sadalanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Nəticələri nəzərdən keçirin. Paneli bağlamaq üçün sağ yuxarıdakı{" "}
            <HelpKey>Bağla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Göndərildi» sətirlər yaşıl, «Xəta» sətirlər qırmızı fonla (səbəbin qısa mətni ilə)
            işarələnir. Cədvəldəki hər qaydanın <strong>Növbəti</strong> tarixi və{" "}
            <strong>Yaradılıb</strong> sayı yenilənmiş dəyərləri əks etdirir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: dayandır, aktivləşdir, sil və toplu əməliyyatlar">
        <HelpStep n={1}>
          <p>
            Bir qaydanı müvəqqəti söndürmək üçün onun sətrindəki pauza ikonalı düyməni basın; geri
            qaytarmaq üçün eyni yerdə görünən aktivləşdir (oxşar) ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Status</strong> sütunundakı nişan yaşıl <strong>Aktiv</strong> ilə narıncı{" "}
            <strong>Dayandırılıb</strong> arasında keçir, yuxarıdakı <strong>Aktiv</strong> və{" "}
            <strong>Dayandırılıb</strong> statistika kartlarındakı saylar uyğun dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bir qaydanı silmək üçün sətrdəki qırmızı zibil qutusu ikonalı düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Təkrarlanan qaydanı sil» təsdiq pəncərəsi açılır və silinəcək qaydanın adını göstərir.
            Təsdiqlədikdən sonra qayda cədvəldən çıxır və statistika kartları yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bir neçə qaydanı eyni anda idarə etmək üçün sətirlərin sol tərəfindəki seçim qutularını
            (və ya yuxarıdakı «Hamısı» qutusunu) işarələyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Statistika kartları ilə cədvəl arasında firuzəyi toplu əməliyyat zolağı peyda olur:
            «N seçilib» yazısı və üç düymə — <HelpKey>Aktivləşdir</HelpKey>, <HelpKey>Dayandır</HelpKey>{" "}
            və <HelpKey>Hazırla</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Toplu zolaqdakı <HelpKey>Aktivləşdir</HelpKey> və ya <HelpKey>Dayandır</HelpKey> ilə
            seçilmişlərin hamısının vəziyyətini birdən dəyişin; <HelpKey>Hazırla</HelpKey> ilə isə
            dərhal hesab-faktura hazırlama prosesini işə salın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Əməliyyatdan sonra seçim təmizlənir (zolaq itir), cədvəl və statistika kartları yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Axtarış və süzgəc">
        <HelpStep n={1}>
          <p>
            Cədvəlin üstündəki axtarış sahəsinə yazın — <HelpKey>Axtar... (şirkət, ad, email)</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl dərhal süzülür: yalnız başlığında, şirkət adında və ya alıcı emailində axtarış mətni
            olan qaydalar qalır. Yanındakı «Hamısı (N)» say uyğunlaşır; heç nə tapılmazsa «Nəticə
            tapılmadı» göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Hazır hesab-faktura adlarını avtomatik yeniləmək üçün <strong>Title Template</strong>{" "}
          dəyişənlərindən istifadə edin: məsələn <HelpKey>{"Abunə — {month} {year}"}</HelpKey> hər ayın
          adı və ili ilə özünü doldurur, beləcə hər təkrarda fərqli, oxunaqlı başlıq alırsınız. Şablonu
          boş buraxsanız sabit Başlıq işlədilir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <HelpKey>Hazırla və göndər</HelpKey> əsl hesab-fakturalar yaradıb <strong>Alıcının emaili</strong>nə
          dərhal göndərir — sınaq deyil. İşə salmazdan əvvəl tezliyin, alıcı emailinin və mövqelərin
          düzgünlüyünə əmin olun. Silmə isə geri qaytarılmır; qaydanı müvəqqəti dayandırmaq istəyirsinizsə
          silmək yerinə pauza düyməsini işlədin — qayda qalır, sadəcə hesab-faktura hazırlamır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün təkrarlanan qaydalar və onların hazırladığı hesab-fakturalar təşkilatınızla
          məhdudlaşır — yalnız öz tenant-ınızın şirkətlərini alıcı kimi seçə bilərsiniz və başqa
          təşkilatın qaydalarını görmürsünüz. Şirkət açılan siyahısı təşkilatınızın şirkətlərindən gəlir.
        </p>
      </HelpCallout>
    </div>
  )
}
