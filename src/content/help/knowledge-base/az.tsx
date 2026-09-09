"use client"

/**
 * Knowledge Base — help article (Azerbaijani).
 * Köhnə birgə "support" məqaləsindən ayrılıb: yalnız
 * Bilik bazası səhifəsini əhatə edir (məqalə yaratma/redaktə,
 * nəşr/qaralama statusu, kateqoriya idarəetməsi, axtarış və
 * filtrlər, qruplaşdırılmış cədvəl). Tiketlər/dəstək hissəsi
 * bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function KnowledgeBaseHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dəstək komandasının üzvü və ya məzmun administratorusunuz"
        goal="Müştərilər və komanda üçün təlimat və məqalələr yazmaq, onları kateqoriyalara bölmək və nəşr etmək"
      >
        Səhifə soldakı menyudan <HelpKey>Bilik bazası</HelpKey> bölməsindədir. Bütün məqalələr və
        kateqoriyalar yalnız sizin təşkilatınız üçündür. Başlıqda yazdığınız ad — yuxarıdakı saylar,
        cədvəl və filtrlər — hamısı eyni məqalə siyahısından oxunur, ona görə məqalə əlavə etdikcə və
        ya statusunu dəyişdikcə yuxarıdakı saylar dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Bilik bazası</HelpKey> adı, onun altında bir sətirlik xülasə durur:{" "}
          <em>«X məqalə · Y nəşr edilib · Z baxış»</em>. Sağ yuxarıda iki düymə var:{" "}
          <HelpKey>Kateqoriyalar</HelpKey> (dişli ikonası) və <HelpKey>Yeni məqalə</HelpKey> (artı
          ikonası). Onların altında «Bilirdinizmi?» ipucu lövhəsi göstərilə bilər.
        </p>
        <p>
          Bundan aşağıda filtr sətri gəlir: solda <strong>axtarış qutusu</strong> (lupa ikonalı,{" "}
          «Axtar...» mətni ilə), sonra üç status düyməsi — <HelpKey>Hamısı</HelpKey>,{" "}
          <HelpKey>Nəşr edilmiş</HelpKey>, <HelpKey>Qaralamalar</HelpKey> (hər birinin yanında say) —
          və ən sağda <strong>kateqoriya açılan siyahısı</strong> (yalnız ən azı bir kateqoriya və ya
          kateqoriyalı məqalə olduqda görünür).
        </p>
        <p>
          Səhifənin əsas hissəsi məqalə cədvəlidir. Filtr «Bütün kateqoriyalar» olduqda məqalələr{" "}
          <strong>kateqoriyalar üzrə açıla-bağlana bilən bloklara</strong> qruplaşır (qovluq ikonası,
          ad və yanında məqalə sayı nişanı). Konkret bir kateqoriya seçəndə isə sadə başlıqlı cədvələ
          keçir. Heç məqalə yoxdursa, bunun yerinə kitab ikonalı boş vəziyyət göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Məqalə">Başlığı, mətni (Markdown), statusu, kateqoriyası, teqləri, baxış və faydalılıq sayı olan bir bilik yazısı.</HelpDef>
          <HelpDef term="Nəşr edilib">Portal istifadəçilərinə və müştərilərə görünən məqalə statusu (yaşıl nöqtə ilə işarələnir).</HelpDef>
          <HelpDef term="Qaralama">Hələ yazılan, müştərilərə görünməyən məqalə statusu (sarı nöqtə ilə işarələnir).</HelpDef>
          <HelpDef term="Kateqoriya">Məqalələri qruplaşdırmaq üçün adlı qovluq; kateqoriyasız məqalələr «Kateqoriyasız» altında toplanır.</HelpDef>
          <HelpDef term="Teqlər">Vergüllə ayrılmış açar sözlər; cədvəldə başlığın altında ilk üçü kiçik nişan kimi görünür və axtarışda nəzərə alınır.</HelpDef>
          <HelpDef term="Baxış">Məqalənin neçə dəfə açıldığını göstərən say (göz ikonalı sütun).</HelpDef>
        </dl>
        <p>
          Cədvəlin hər sətrində fayl ikonası, başlıq (açıldıqda məqalə səhifəsinə keçən keçid), altında
          teqlər, sonra mətnin qısa önbaxışı, status nöqtəsi, baxış sayı və son yenilənmə tarixi olur.
          Sətrin üzərinə kursoru gətirəndə sağda <strong>redaktə</strong> (qələm) və <strong>sil</strong>{" "}
          (qırmızı zibil qutusu) ikonaları peyda olur.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni məqalə yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni məqalə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni məqalə» başlıqlı pəncərə açılır. İçində <strong>Başlıq *</strong> sahəsi,{" "}
            <strong>Məzmun *</strong> üçün böyük mətn sahəsi (təxminən 8 sətirlik), aşağıda yan-yana{" "}
            <strong>Kateqoriya</strong> və <strong>Status</strong> açılan siyahıları, ən altda isə{" "}
            <strong>Teqlər</strong> sahəsi («tag1, tag2, tag3» nümunəsi ilə) var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Başlıq</strong> və <strong>Məzmun</strong> yazın — bu ikisi məcburidir (yanında *
            işarəsi var). Məzmun Markdown qəbul edir (başlıqlar, qalın/maili mətn, keçidlər).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca mətn sahələrdə görünür. Başlıq və ya məzmun boş qalsa, brauzer formanı təqdim
            etməyə qoymur və boş məcburi sahəni qeyd edir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İstəyə bağlı olaraq <strong>Kateqoriya</strong> seçin (siyahıda mövcud kateqoriyalar və
            «Kateqoriyasız» variantı var), <strong>Status</strong>u təyin edin (standart{" "}
            <HelpKey>Qaralama</HelpKey>; müştərilərə göstərmək üçün <HelpKey>Nəşr edildi</HelpKey>
            seçin) və lazımdırsa <strong>Teqlər</strong>i vergüllə ayıraraq yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Status açılan siyahısında yalnız iki seçim olur: «Qaralama» və «Nəşr edildi». Kateqoriya
            siyahısı təşkilatınızda yaratdığınız kateqoriyalardan doldurulur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Aşağıdakı <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə saxlanarkən «Saxlanılır...» yazısına keçir, sonra pəncərə bağlanır və yeni məqalə
            cədvəldə peyda olur. Başlıqdakı saylar (<em>məqalə</em> və status <HelpKey>Nəşr edildi</HelpKey>{" "}
            seçmişdinizsə <em>nəşr edilib</em>) uyğun artır. Saxlama alınmasa, formanın yuxarısında
            qırmızı xəta mesajı göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: məqaləni axtar və filtrlə">
        <HelpStep n={1}>
          <p>
            Solda lupa ikonalı <HelpKey>Axtar...</HelpKey> qutusuna açar söz yazın. Axtarış başlıq,
            teqlər və məqalə mətni üzrə işləyir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl yazdıqca dərhal süzülür — yalnız uyğun gələn məqalələr qalır. Heç nə tapılmasa,
            kitab ikonalı «Məqalə tapılmadı» boş vəziyyəti göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Statusa görə daraltmaq üçün <HelpKey>Hamısı</HelpKey>, <HelpKey>Nəşr edilmiş</HelpKey> və ya{" "}
            <HelpKey>Qaralamalar</HelpKey> düymələrindən birini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş düymə dolu (vurğulanmış) görünür, qalanları çərçivəli qalır. Hər düymənin
            yanındakı mötərizədəki say o statusda neçə məqalə olduğunu göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Kateqoriyaya görə süzmək üçün sağdakı açılan siyahıdan bir kateqoriya (və ya{" "}
            <HelpKey>Kateqoriyasız</HelpKey>) seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Konkret kateqoriya seçəndə cədvəl qruplaşdırma rejimindən sütun başlıqlı (Başlıq,
            Önbaxış, Status, baxış, Tarix) sadə cədvələ keçir və yalnız həmin kateqoriyanın məqalələri
            görünür. <HelpKey>Bütün kateqoriyalar</HelpKey>a qayıtsanız yenidən qovluqlar üzrə
            qruplaşma açılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            «Bütün kateqoriyalar» rejimində qovluq başlığını basaraq həmin kateqoriyanı bağlayıb-aça
            bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Başlıqdakı ox aşağıya (açıq) və sağa (bağlı) çevrilir; bağlı qovluğun məqalələri gizlənir,
            ancaq yanındakı say nişanı görünməyə davam edir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: məqaləni aç, redaktə et və ya sil">
        <HelpStep n={1}>
          <p>
            Məqaləni oxumaq üçün cədvəldəki <strong>başlıq keçidini</strong> basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Məqalənin öz səhifəsi açılır və baxış sayı bir vahid artır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Məqaləni dəyişmək üçün onun sətrinin üzərinə kursoru gətirib sağda peyda olan qələm
            ikonalı (<HelpKey>Redaktə et</HelpKey>) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Məqaləni redaktə et» başlıqlı, mövcud başlıq, məzmun, kateqoriya, status və teqlərlə
            əvvəlcədən doldurulmuş eyni forma açılır. Dəyişiklikləri edib aşağıdakı{" "}
            <HelpKey>Yenilə</HelpKey> düyməsi ilə təsdiqləyin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Məqaləni silmək üçün eyni yerdə qırmızı zibil qutusu ikonalı (<HelpKey>Sil</HelpKey>) düyməni
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Məqaləni sil» təsdiq pəncərəsi açılır və silinəcək məqalənin adını göstərir. Təsdiqlədikdən
            sonra məqalə cədvəldən çıxır və başlıqdakı saylar yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmə geri qaytarılmır. Məqaləni müvəqqəti müştərilərdən gizlətmək istəyirsinizsə, silmək
            yerinə onu redaktə edib statusunu yenidən <HelpKey>Qaralama</HelpKey> edin — məqalə qalır,
            sadəcə nəşr edilmiş sayılmır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: kateqoriyaları idarə et">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı dişli ikonalı <HelpKey>Kateqoriyalar</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Kateqoriyalar» başlıqlı pəncərə açılır. Yuxarıda yeni kateqoriya adı üçün giriş sahəsi və{" "}
            <HelpKey>Əlavə et</HelpKey> düyməsi, altında isə mövcud kateqoriyaların siyahısı var; hələ
            heç biri yoxdursa «Hələ kateqoriya yoxdur» mətni görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Yeni kateqoriya üçün ad yazın və <HelpKey>Əlavə et</HelpKey> düyməsini basın (və ya Enter).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Giriş sahəsi boşalır və yeni kateqoriya aşağıdakı siyahıda qovluq ikonası ilə peyda olur.
            Ad boş olduqca <HelpKey>Əlavə et</HelpKey> düyməsi söndürülmüş qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Kateqoriyanı silmək üçün onun sətrindəki qırmızı zibil qutusu ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kateqoriya siyahıdan dərhal yox olur. Həmin kateqoriyaya bağlı məqalələr silinmir — onlar{" "}
            <strong>«Kateqoriyasız»</strong>a keçir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Bitirdikdə aşağıdakı <HelpKey>Bağla</HelpKey> düyməsi ilə pəncərəni bağlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Pəncərə bağlanır; yeni kateqoriyalar artıq həm filtr açılan siyahısında, həm də məqalə
            formasının «Kateqoriya» seçimində mövcuddur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Status iş prosesinizin əsasıdır: məqaləni hazırlayarkən <HelpKey>Qaralama</HelpKey> saxlayın
          (yalnız komandanız görür), hazır olanda redaktə edib <HelpKey>Nəşr edildi</HelpKey> edin.
          Cədvəldəki rəngli nöqtə — yaşıl nəşr edilmiş, sarı qaralama — bir baxışda hansı məqalələrin
          canlı olduğunu göstərir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün məqalələr və kateqoriyalar təşkilatınızla məhdudlaşır — başqa təşkilatın bilik bazasını
          görmürsünüz və onlar sizinkini görmür. <HelpKey>Nəşr edildi</HelpKey> statusu məqaləni portal
          istifadəçilərinə və müştərilərə görünən edir, ona görə həssas və ya daxili qeydləri nəşr
          etməzdən əvvəl yoxlayın.
        </p>
      </HelpCallout>
    </div>
  )
}
