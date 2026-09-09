"use client"

/**
 * Boards index — help article (Azerbaijani).
 * Yalnız /boards siyahı səhifəsini əhatə edir: lövhələrin (bölmələrin)
 * siyahısı, yeni lövhə yaratma, lövhəni redaktə etmə (ad, rəng, iştirakçılar,
 * sütunlar), lövhəsiz tapşırıqları köçürmə və lövhəni arxivləmə.
 * Lövhənin DAXİLİ (Kanban kartları, status keçidləri) /boards/[id]
 * səhifəsindədir və bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function BoardsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Komanda rəhbəri, menecer və ya administratorsunuz"
        goal="Komanda işini Kanban lövhələrinə (bölmələrə) bölmək, hər lövhəyə kimin girişi olduğunu və lövhənin sütunlarını idarə etmək"
      >
        Səhifəyə yan paneldəki <HelpKey>Lövhələr</HelpKey> bəndindən çatırsınız. Burada təşkilatınızın
        bütün Kanban lövhələri kart şəklində sadalanır. Yeni lövhə yaratmaq, lövhəni redaktə etmək və ya
        arxivləmək yalnız <strong>admin</strong>, <strong>superadmin</strong> və <strong>menecer</strong>{" "}
        rollarına açıqdır; digər istifadəçilər lövhələri görür və açır, amma yaratma/redaktə düymələri
        onlarda görünmür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda sütun ikonası ilə yanaşı <HelpKey>Lövhələr</HelpKey> adı durur. Sizdə idarəetmə icazəsi
          varsa, sağ yuxarıda <HelpKey>Yeni Lövhə</HelpKey> düyməsi olur. Aşağıda lövhələr üç sütunlu
          kart torunda göstərilir. Heç lövhə yoxdursa, bunun yerinə boş vəziyyət (<HelpKey>Hələ lövhə
          yoxdur</HelpKey>) görünür. Səhifə açılarkən qısa müddət «Yüklənir…» yazısı görünə bilər.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Lövhə (bölmə)">Müstəqil Kanban iş sahəsi — öz açarı, adı, rəngi, sütunları, iştirakçıları və tapşırıqları olan.</HelpDef>
          <HelpDef term="Açar">Lövhənin 1–16 simvolluq qısa kodu (yalnız hərf və rəqəm, məs. KHS) — kartda rəngli nişan kimi görünür və avtomatik böyük hərflərə çevrilir.</HelpDef>
          <HelpDef term="İştirakçılar">Bu lövhəyə girişi olan istifadəçilər. Siz və adminlər həmişə görür; seçilmiş istifadəçilər isə yalnız bu lövhəni görür.</HelpDef>
          <HelpDef term="Sütunlar">Lövhənin Kanban sütunları — adlandırıla, sıralana və rəngləndirilə bilər. Hər sütunun bir «Sayılır» mərhələsi var (tapşırıq ora köçürüləndə hansı statusu alır).</HelpDef>
          <HelpDef term="Sayılır">Sütuna verilmiş standart mərhələ: Backlog, To Do, In Progress, Testing, Review və ya Done.</HelpDef>
          <HelpDef term="Arxivlə">Lövhəni siyahıdan çıxarır, amma tapşırıqları silmir (silmə deyil).</HelpDef>
        </dl>
        <p>
          Hər lövhə kartında sol yuxarıda lövhənin rəngli <strong>açar</strong> nişanı, altında lövhənin
          <strong>adı</strong>, daha aşağıda tapşırıq sayı (məs. «12 tapşırıq») və varsa lövhə rəhbərinin
          adı olur. İdarəetmə icazəniz varsa, kartın sağ yuxarısında qələm ikonalı{" "}
          <HelpKey>Lövhəni redaktə et</HelpKey> düyməsi görünür; icazəniz yoxdursa, onun yerinə kursoru
          kartın üstünə gətirəndə bir ox işarəsi peyda olur. Kartın özünə (açar/ad) kliklə lövhənin
          içinə — Kanban səhifəsinə keçirsiniz.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni lövhə yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni Lövhə</HelpKey> düyməsini basın. (Heç lövhə yoxdursa, boş
            vəziyyətin ortasındakı eyni adlı düymə də işləyir.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni Lövhə» başlıqlı pəncərə açılır. İçində <strong>Açar</strong> sahəsi (nümunə «KHS»),{" "}
            <strong>Ad</strong> sahəsi, yeddi rəng dairəsindən ibarət palitra, <strong>İştirakçılar
            (girişi olanlar)</strong> seçici və altda <HelpKey>Ləğv et</HelpKey> / <HelpKey>Yarat</HelpKey>{" "}
            düymələri var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Açar</strong> yazın — qısa kod (yalnız hərf və rəqəm, 1–16 simvol). Yazdıqca avtomatik
            böyük hərflərə çevrilir. Sonra <strong>Ad</strong> sahəsinə lövhənin adını yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açar böyük hərflərlə görünür. Açar düzgün formatda deyilsə (boş və ya icazəsiz simvol) və ya
            ad boşdursa, <HelpKey>Yarat</HelpKey> düyməsi sönük (basılmayan) qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Palitradan lövhəyə rəng seçin (klikləyin) — bu rəng kartdakı açar nişanının fonu olur.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz dairənin ətrafında tünd haşiyə yaranır və onun cari seçim olduğunu bildirir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            İstəyə bağlı olaraq <strong>İştirakçılar</strong> bölməsində axtarış qutusuna ad və ya e-poçt
            yazıb istifadəçiləri süzün, sonra qarşılarındakı qeyd qutularını işarələyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Axtarış qutusunun altında istifadəçi siyahısı (ad + e-poçt) görünür; yazdıqca uyğun gələnlər
            filtrlənir. Siyahının altında «Sən və adminlər həmişə görür; seçilmişlər yalnız bu lövhəni.»
            ipucusu durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Aşağıdakı <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> və ya sağ yuxarıdakı × ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Yaradılır…» yazısına keçir, sonra pəncərə bağlanır və yeni lövhə kart torunda peyda
            olur. Nəsə alınmasa, pəncərənin içində qırmızı xəta mesajı (məs. «Dəyişiklik alınmadı»)
            göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Yaratma zamanı işarələdiyiniz istifadəçilər dərhal lövhə iştirakçısı olur — onlar lövhəyə
            tam giriş (baxış, tapşırıq yaratma, redaktə, sütunlar arası köçürmə və şərh) alır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: lövhəni redaktə et (ad, rəng, iştirakçılar, sütunlar)">
        <HelpStep n={1}>
          <p>
            İdarə etmək istədiyiniz lövhə kartının sağ yuxarısındakı qələm ikonalı{" "}
            <HelpKey>Lövhəni redaktə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Lövhəni redaktə et · &lt;AÇAR&gt;» başlıqlı pəncərə açılır. İçində mövcud{" "}
            <strong>Ad</strong>, rəng palitrası, <strong>İştirakçılar</strong> seçicisi,{" "}
            <strong>Sütunlar</strong> redaktoru və <HelpKey>Lövhəsiz tapşırıqları bu lövhəyə köçür</HelpKey>{" "}
            düyməsi əvvəlcədən doldurulmuş gəlir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Ad</strong> sahəsini dəyişin, lazım gələrsə palitradan başqa rəng seçin və{" "}
            <strong>İştirakçılar</strong> siyahısında qeyd qutularını işarələyib/sıxışdırıb girişi olan
            istifadəçiləri yeniləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İştirakçı seçici lövhənin hazırkı üzvlərini əvvəlcədən işarələnmiş göstərir. İşarə qaldırılan
            istifadəçinin girişi geri alınacaq, yeni işarələnən isə əlavə olunacaq.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Sütunlar</strong> redaktorunda hər sətirdə yuxarı/aşağı oxlarla sütunları sıralayın,
            soldakı rəngli dairəni basıb rəng seçin (<HelpKey>Avto</HelpKey> və ya hazır rənglərdən),
            ortadakı sahədə sütun adını dəyişin, sağdakı <HelpKey>Sayılır</HelpKey> açılan siyahısı ilə
            mərhələni təyin edin. Yeni sütun üçün <HelpKey>Sütun əlavə et</HelpKey>, silmək üçün zibil
            qutusu ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Rəngli dairəni basanda kiçik rəng seçici açılır (Escape ilə bağlanır). <HelpKey>Sayılır</HelpKey>{" "}
            siyahısında altı standart mərhələ var: Backlog, To Do, In Progress, Testing, Review, Done.
            Sütun sayı 12-yə çatanda <HelpKey>Sütun əlavə et</HelpKey>, yalnız bir sütun qalanda isə
            silmə düyməsi sönür. Redaktorun altında «…«Sayılır» — tapşırıq buraya köçürüləndə aldığı
            mərhələ» ipucusu durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Sağ aşağıdakı <HelpKey>Yadda saxla</HelpKey> düyməsini basın. (<HelpKey>Ləğv et</HelpKey> və
            ya × dəyişiklikləri ataraq pəncərəni bağlayır.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Saxlanılır…» yazısına keçir, sonra pəncərə bağlanır və kart yenilənmiş ad/rəng ilə
            görünür. Adı boş buraxsanız və ya adsız sütun qalsa, <HelpKey>Yadda saxla</HelpKey> sönük
            qalır; giriş dəyişiklikləri tam tətbiq olunmasa, qırmızı xəta mesajı göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: lövhəsiz tapşırıqları köçür və lövhəni arxivlə">
        <HelpStep n={1}>
          <p>
            Redaktə pəncərəsində orta hissədəki <HelpKey>Lövhəsiz tapşırıqları bu lövhəyə köçür</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Brauzer təsdiq pəncərəsi çıxır: «Heç bir lövhəyə bağlı olmayan bütün tapşırıqları bu lövhəyə
            köçürmək? Onları yalnız lövhə iştirakçıları görəcək.» Təsdiqlədikdən sonra köçürmə işləyir və
            «&lt;say&gt; tapşırıq lövhəyə köçürüldü.» bildirişi göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Lövhəni siyahıdan çıxarmaq üçün redaktə pəncərəsinin sol aşağısındakı qırmızı zibil qutusu
            ikonalı <HelpKey>Arxivlə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Brauzer təsdiq pəncərəsi çıxır: «Bu lövhəni arxivləmək? Siyahıdan çıxacaq; tapşırıqlar
            qalır.» Təsdiqlədikdən sonra pəncərə bağlanır və lövhə kart torundan yox olur.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Köçürmə</strong> təkcə hazırda heç bir lövhəyə bağlı OLMAYAN tapşırıqlara təsir edir
            və köçürdükdən sonra onlar yalnız bu lövhənin iştirakçılarına görünür — yəni başqalarının
            görmə dairəsini daraldır. <strong>Arxivləmə</strong> isə lövhəni silmir: tapşırıqlar yerində
            qalır, lövhə sadəcə siyahıdan çıxır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Lövhə kartının üzərinə (açar və ya ad) klikləsəniz, redaktə pəncərəsi yox, lövhənin İÇİ —
          Kanban səhifəsi açılır. Lövhənin parametrlərini dəyişmək üçün məhz sağ yuxarıdakı qələm
          ikonalı düyməni basın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün lövhələr və iştirakçı təyinatları təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın
          istifadəçilərini iştirakçı kimi əlavə edə bilərsiniz. Lövhə yaratma, redaktə və arxivləmə
          düymələri yalnız admin/superadmin/menecer rollarına görünür; baxış icazəli istifadəçilər bu
          əməliyyatları edə bilmir.
        </p>
      </HelpCallout>
    </div>
  )
}
