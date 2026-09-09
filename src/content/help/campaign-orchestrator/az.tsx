"use client"

/**
 * Customer Journeys (kampaniya orkestratoru) — help article (Azerbaijani).
 * Video-ssenari formatında yenidən yazılıb: yalnız Müştəri Zəncirləri
 * (/journeys) səhifəsini əhatə edir — zəncir yaratma (şablonlar + forma),
 * addımlar redaktoru (linear + vizual konstruktor), lid qeydiyyatı,
 * iştirakçıların idarəsi, dayandır/davam/sil. Səhifədə MÖVCUD OLMAYAN
 * funksiyalar (A/B bölmə və s.) DAXİL EDİLMƏYİB.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CampaignorchestratorHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq və ya satış əməliyyatları üzrə məsulsunuz"
        goal="Hadisə ilə işə düşən çoxaddımlı avtomatik zəncir qurmaq — email, SMS, gözləmə, şərt və tapşırıqları ardıcıllığa düzmək, sonra lidləri ora salıb nəticəni izləmək"
      >
        Səhifə sol menyudan <HelpKey>Müştəri Zəncirləri</HelpKey> bölməsindədir. Bütün zəncirlər,
        iştirakçılar və lidlər yalnız sizin təşkilatınıza aiddir. Yuxarıdakı statistika kartları
        siyahıdan oxunur, ona görə zənciri aktivləşdirdikcə və ya lid qeyd etdikcə saylar dərhal
        yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda axın ikonası ilə <HelpKey>Müştəri Zəncirləri</HelpKey> adı, altında «Müştəri cəlbi
          üçün avtomatik ardıcıllıqlar» izahı, sağ yuxarıda isə <HelpKey>Yeni zəncir</HelpKey> düyməsi
          durur. Altında bir sətir təsvir və «Bilirdinizmi?» ipucu zolağı gəlir. Sonra dörd statistika
          kartı sıralanır: <strong>Cəmi</strong>, <strong>Aktiv</strong>, <strong>Daxil oldu</strong> və{" "}
          <strong>Tamamladı</strong> (faizlə). Əgər iştirakçılarda çıxış səbəbləri varsa, kartların
          altında «Çıxış səbəbləri» nişanları görünür. Daha aşağıda zəncir kartlarının siyahısı yer
          alır — heç zəncir yoxdursa, onun yerinə boş vəziyyət göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Zəncir (Journey)">Hadisə ilə başlayan, addım-addım icra olunan avtomatik ardıcıllıq — adı, statusu, tetikleyicisi və addımları olan.</HelpDef>
          <HelpDef term="Cəmi">Yaratdığınız bütün zəncirlərin sayı (bütün statuslar birlikdə).</HelpDef>
          <HelpDef term="Aktiv">Hazırda «Aktiv» statusunda işləyən zəncirlərin sayı.</HelpDef>
          <HelpDef term="Daxil oldu">Bütün zəncirlərə girmiş əlaqələrin (iştirakçıların) ümumi sayı.</HelpDef>
          <HelpDef term="Tamamladı">Tam yolu keçən iştirakçıların faizi (konversiya nisbəti).</HelpDef>
          <HelpDef term="Tetikleyici">Zənciri işə salan hadisə: Əl ilə, Yeni lid, Yeni kontakt və ya Sövdələşmə mərhələsi dəyişdi.</HelpDef>
          <HelpDef term="Addım">Zəncirin bir mərhələsi: Email, SMS, Gözləmə, Şərt, Tapşırıq, Telegram, WhatsApp və ya Sahəni yenilə.</HelpDef>
          <HelpDef term="Hədəf">İstəyə bağlı uğur ölçüsü (məs. Sövdələşmə yaradıldı) — neçə konversiya gözlədiyinizi və hədəfə çatanda çıxış olub-olmayacağını təyin edir.</HelpDef>
          <HelpDef term="İştirakçı (qeydiyyat)">Zəncirə salınmış konkret lid və ya kontakt — aktiv, dayandırılmış və ya tamamlanmış ola bilər.</HelpDef>
        </dl>
        <p>
          Hər zəncir kartında solda status nişanı (<strong>Qaralama</strong> / <strong>Aktiv</strong> /{" "}
          <strong>Dayandırılmış</strong> / <strong>Tamamlanmış</strong>) və zəncirin adı, varsa təsvir,
          altda isə tetikleyici, <strong>Daxil oldu</strong>, <strong>Aktiv</strong> və{" "}
          <strong>Tamamladı</strong> sayları görünür. Hədəf təyin edilibsə, kiçik proqres zolağı ilə
          «Hədəf: cari/hədəf» göstərilir. Sağda beş əməliyyat düyməsi var: <HelpKey>Addımlar</HelpKey>{" "}
          (göz ikonası), <HelpKey>Redaktə et</HelpKey> (qələm), <HelpKey>Lidi qeyd et</HelpKey>{" "}
          (insan+plus), dayandır/davam (aktivdə <HelpKey>Dayandır</HelpKey>, qeyri-aktivdə{" "}
          <HelpKey>Aktiv</HelpKey>) və sil (zibil qutusu ikonası).
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni zəncir yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni zəncir</HelpKey> düyməsini basın. (Heç zəncir yoxdursa, boş
            vəziyyətin ortasındakı eyni adlı düymə də işləyir.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Şablon seçin» başlıqlı pəncərə açılır. İçində dörd şablon kartı var:{" "}
            <strong>Qarşılama axını</strong>, <strong>Lid istiləşdirmə</strong>,{" "}
            <strong>Sövdələşmə izləmə</strong> və <strong>Boş zəncir</strong> — hər birinin altında qısa
            izahı.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bir şablon kartını basın. Sıfırdan tam nəzarətlə başlamaq istəyirsinizsə{" "}
            <HelpKey>Boş zəncir</HelpKey> seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Pəncərə forma görünüşünə keçir. Yuxarıda «← Şablonlara qayıt» keçidi, sonra sahələr gəlir:{" "}
            <strong>Ad *</strong>, yan-yana <strong>Status</strong> və <strong>Tetikleyici</strong>{" "}
            açılan siyahıları, <strong>Hədəf seqment</strong> seçimi, <strong>Təsvir</strong>,{" "}
            <strong>Maksimum qeydiyyat günləri</strong> və yığcam «Hədəf izləmə» bölməsi. Seçdiyiniz
            şablonun dəyərləri sahələrə əvvəlcədən yazılmış olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Ad</strong> yazın — bu yeganə məcburi sahədir (məs. «Yeni lidlər üçün qarşılama»).
            Lazım olsa <strong>Status</strong> (standart Qaralama) və <strong>Tetikleyici</strong>{" "}
            (Əl ilə, Yeni lid, Yeni kontakt, Sövdələşmə mərhələsi dəyişdi) seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca mətn sahədə görünür. Adı boş buraxıb yadda saxlamağa çalışsanız, formanın
            yuxarısında qırmızı «Mütləq sahə» xəbərdarlığı çıxır və pəncərə bağlanmır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            İstəyə bağlı olaraq <strong>Hədəf seqment</strong> seçin (standart «Bütün kontaktlar (filtr
            yoxdur)»), bir sətirlik <strong>Təsvir</strong> əlavə edin və{" "}
            <strong>Maksimum qeydiyyat günləri</strong> yazın (N gündən sonra avtomatik çıxış, 1–365).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seqment açılan siyahısında «Bütün kontaktlar» ilə yanaşı təşkilatınızın seqmentləri (yanında
            kontakt sayı ilə) sıralanır. Altda «Yalnız bu seqmentə uyğun kontaktlar zəncirə daxil
            olacaq» ipucusu durur. Qeydiyyat günləri sahəsi yalnız rəqəm qəbul edir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Uğuru ölçmək istəyirsinizsə, <HelpKey>Hədəf izləmə</HelpKey> başlığını basıb açın və{" "}
            <strong>Hədəf növü</strong> seçin (Hədəf yoxdur, Sövdələşmə yaradıldı, Status dəyişikliyi,
            Tiket həll edildi). Lazım olsa <strong>Hədəf (konversiyalar)</strong> sayını yazın və{" "}
            <strong>Hədəfə çatdıqda çıxış</strong> qeyd qutusunu işarələyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Başlığın yanındakı üçbucaq açıq/qapalı vəziyyəti göstərir. «Status dəyişikliyi» seçəndə əlavə{" "}
            <strong>Hədəf status dəyəri</strong> sahəsi peyda olur (məs. converted, qualified).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Aşağıdakı <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> və ya sağ yuxarıdakı × ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Saxlanılır…» yazısına keçir, sonra pəncərə bağlanır və yeni zəncir siyahıda peyda
            olur. <strong>Cəmi</strong> kartındakı say bir vahid artır (status Aktiv seçilibsə{" "}
            <strong>Aktiv</strong> kartı da artır).
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Təzəcə yaranan zəncir HƏLƏ addımsızdır. İş görməsi üçün növbəti bölmədəki kimi ona ən azı
            bir addım əlavə etməli və statusunu <strong>Aktiv</strong> etməlisiniz — yoxsa daxil olan
            əlaqələrlə heç nə baş verməyəcək.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: zəncirə addımlar əlavə et">
        <HelpStep n={1}>
          <p>
            Zəncir kartında <HelpKey>Addımlar</HelpKey> (göz ikonalı) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Zəncirin adı ilə pəncərə açılır; başlıq altında status, tetikleyici və (varsa) hədəf
            yazılır. Yuxarıda <HelpKey>Vizual konstruktor</HelpKey> / <HelpKey>Siyahı</HelpKey> keçirici
            və <HelpKey>Lidi qeyd et</HelpKey> düyməsi var. Aşağıda bənövşəyi <strong>Tetikleyici</strong>{" "}
            qovşağından başlayan şaquli axın, mövcud addımlar və ən altda kəsik xətli «+ Addım əlavə et»
            düyməsi görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Axının altındakı <HelpKey>Addım əlavə et</HelpKey> (kəsik xətli +) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Addım #N əlavə et» pəncərəsi açılır. Yuxarıda səkkiz növlü ikon şəbəkəsi var:{" "}
            <strong>Email</strong>, <strong>SMS</strong>, <strong>Gözləmə</strong>, <strong>Şərt</strong>,{" "}
            <strong>Tapşırıq</strong>, <strong>Telegram</strong>, <strong>WhatsApp</strong> və{" "}
            <strong>Sahəni yenilə</strong>. Standart olaraq <strong>Email</strong> seçilidir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Növü seçin və altda peyda olan sahələri doldurun. Məsələn <strong>Email</strong> üçün
            mövzu və mətn, <strong>Gözləmə</strong> üçün say və vahid (Saat/Gün/Həftə),{" "}
            <strong>Şərt</strong> üçün hazır ssenari kartlarından biri (məs. «Lid uyğun olduqda») və ya
            «Öz şərtim», <strong>Tapşırıq</strong> üçün ad və təsvir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz növ vurğulanır və yalnız ona aid sahələr göstərilir. <strong>Şərt</strong>{" "}
            seçəndə doqquz ssenari kartı və altda qırmızı çərçivədə «Şərt uyğun gəlmirsə» seçimi
            (Növbəti addıma keç, 1/2 addımı keç, Əvvəldən başla, Zənciri dayandır) çıxır. «Öz şərtim»
            seçsəniz, əlavə Sahə/Operator/Dəyər sahələri açılır. Email mövzu və mətn sahələrində{" "}
            <HelpKey>{"{{contact_name}}"}</HelpKey> kimi dəyişənləri istifadə edə bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Pəncərənin altındakı <HelpKey>Əlavə et</HelpKey> düyməsini basın. (Lazım olsa{" "}
            <HelpKey>Ləğv et</HelpKey> ilə imtina edin.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Pəncərə bağlanır və yeni addım axına nömrəli qovşaq kimi əlavə olunur (məs. «1. Email»),
            altında qısa xülasə və «Daxil oldu / Keçdi» statistikası ilə. İstədiyiniz qədər addım əlavə
            edə bilərsiniz; hər addımın üstündə qələm (redaktə) və zibil qutusu (sil) ikonaları var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Hamısı hazır olanda pəncərənin altındakı <HelpKey>Addımları saxla</HelpKey> düyməsini basın.
            (Dəyişiklik etmədən çıxmaq üçün <HelpKey>Bağla</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Saxlanılır…» yazısına keçir, sonra pəncərə bağlanır. Addımlar saxlanılır və zəncir
            kartındakı saylar uyğun olaraq yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Addımlar pəncərəsinin yuxarısındakı <HelpKey>Vizual konstruktor</HelpKey> düyməsi eyni
            zənciri sürüklə-burax diaqram kimi göstərir. <HelpKey>Siyahı</HelpKey> ilə geri qayıdırsınız.
            Hər iki görünüş eyni addımlarla işləyir — sadəcə fərqli redaktə üsuludur.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: zəncirə lid qeyd et və iştirakçıları idarə et">
        <HelpStep n={1}>
          <p>
            Zəncir kartında <HelpKey>Lidi qeyd et</HelpKey> (insan+plus ikonalı) düyməni basın.
            (Addımlar pəncərəsinin içindəki eyni adlı düymə də işləyir.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Lidi qeyd et» başlıqlı pəncərə açılır; yuxarıda hansı zəncirə qeyd etdiyiniz qalın yazılır.
            Altda axtarış sahəsi və lidlərin siyahısı var; lidlər yüklənərkən «Lidlər yüklənir…» fırlanan
            ikonası görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Axtarış sahəsinə lidin adını, e-poçtunu və ya şirkətini yazıb siyahıdan birini seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə lidin baş hərfli avatarı, adı, e-poçt/şirkəti və status nişanı (Yeni, Uyğun,
            Əlaqə saxlanıldı və s.) görünür. Altda «N liddən M» sayğacı durur. Seçəndə yuxarıda yaşıl
            təsdiq zolağı çıxır; × ilə seçimi ləğv edə bilərsiniz. Heç nə tapılmasa «Heç nə tapılmadı»,
            ümumiyyətlə lid yoxdursa «Mövcud lid yoxdur» yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Aşağıdakı <HelpKey>Qeyd et</HelpKey> düyməsini basın. (Lid seçilməyincə düymə qeyri-aktivdir.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə fırlanan ikonaya keçir, sonra pəncərə bağlanır və siyahı yenilənir. Lid zəncirin
            iştirakçısı olur — kartdakı <strong>Daxil oldu</strong> sayı və <strong>Daxil oldu</strong>{" "}
            statistika kartı uyğun olaraq artır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Mövcud iştirakçıları görmək üçün <HelpKey>Addımlar</HelpKey> pəncərəsini açın və{" "}
            <HelpKey>Siyahı</HelpKey> görünüşündə aşağı sürüşdürün — orada iştirakçılar cədvəli var.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «İştirakçılar (N)» başlığı altında hər sətir bir iştirakçıdır: status nişanı (Aktiv /
            Dayandırılmış / Tamamlanmış), qısa lid/kontakt ID-si və (varsa) çıxış səbəbi. Sağda statusa
            görə əməliyyat düymələri çıxır: aktivdə <HelpKey>Dayandır</HelpKey>, dayandırılmışda{" "}
            <HelpKey>Davam et</HelpKey>, hər ikisində <HelpKey>Ləğv et</HelpKey>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: zənciri redaktə et, dayandır/davam etdir və ya sil">
        <HelpStep n={1}>
          <p>
            Zənciri dəyişmək üçün kartdakı <HelpKey>Redaktə et</HelpKey> (qələm ikonalı) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Zənciri redaktə et» başlıqlı, mövcud ad, status, tetikleyici, seqment, təsvir, qeydiyyat
            günləri və hədəf dəyərləri ilə əvvəlcədən doldurulmuş eyni forma açılır. Dəyişiklikləri edib{" "}
            <HelpKey>Saxla</HelpKey> ilə təsdiqləyin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Zənciri silmədən söndürmək/işə salmaq üçün status düyməsini basın: aktiv zəncirdə bu{" "}
            <HelpKey>Dayandır</HelpKey>, dayandırılmışda <HelpKey>Aktiv</HelpKey> kimi görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kartdakı status nişanı <strong>Aktiv</strong> ilə <strong>Dayandırılmış</strong> arasında
            keçir və <strong>Aktiv</strong> statistika kartındakı say uyğun olaraq dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Zənciri büsbütün silmək üçün kartdakı qırmızı zibil qutusu ikonalı düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Zənciri sil» təsdiq pəncərəsi açılır və zəncirin adını göstərir. Təsdiqlədikdən sonra zəncir
            siyahıdan çıxır və statistika kartları yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmə geri qaytarılmır. Zənciri sadəcə müvəqqəti saxlamaq istəyirsinizsə, silmək yerinə{" "}
            <HelpKey>Dayandır</HelpKey> ilə qeyri-aktiv edin — zəncir, addımları və iştirakçıları qalır,
            sadəcə yeni heç kim emal olunmur.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Şablonla başlamaq ən sürətli yoldur: <strong>Qarşılama axını</strong>, <strong>Lid
          istiləşdirmə</strong> və <strong>Sövdələşmə izləmə</strong> tetikleyici, qeydiyyat müddəti və
          hədəfi əvvəlcədən doldurur — sizə yalnız ad verib addımları əlavə etmək qalır. Sıfırdan tam
          nəzarət istəyirsinizsə <strong>Boş zəncir</strong> seçin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün zəncirlər, iştirakçılar və qeyd edə biləcəyiniz lidlər təşkilatınızla məhdudlaşır —
          başqa tenant-ın zəncirlərini görmür və yalnız öz lidlərinizi qeyd edə bilərsiniz. Lid axtarış
          siyahısı və seqmentlər təşkilatınızın məlumatından gəlir.
        </p>
      </HelpCallout>
    </div>
  )
}
