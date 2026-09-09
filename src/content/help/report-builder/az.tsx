"use client"

/**
 * Report Builder — help article (Azerbaijani).
 * Köhnə birgə "reports" slug'undan ayrılıb: yalnız
 * Hesabatlar → Hesabat konstruktoru səhifəsini əhatə edir
 * (obyekt seçimi, sütunlar, filtrlər, qruplaşdırma, sıralama,
 * qrafik növü, canlı önbaxış, saxlama + email cədvəli, ixrac).
 * Hazır/standart hesabatlar siyahısı bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function reportbuilderHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış və ya əməliyyat üzrə analitiksiniz"
        goal="CRM məlumatlarınızdan kod yazmadan xüsusi hesabat qurmaq, onu qrafik kimi görmək, saxlamaq və ya Excel/CSV faylına ixrac etmək"
      >
        Səhifəyə <HelpKey>Hesabatlar</HelpKey> → <HelpKey>Hesabat konstruktoru</HelpKey> yolu ilə
        çatırsınız. Bütün məlumat yalnız sizin təşkilatınızdan oxunur. Konstruktorun əsas xüsusiyyəti
        budur: solda konfiqurasiyanı dəyişdikcə sağdakı önbaxış öz-özünə yenilənir — heç bir «İşə sal»
        düyməsi yoxdur, dəyişiklikdən təxminən yarım saniyə sonra nəticə avtomatik gəlir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Hesabat konstruktoru</HelpKey> adı və altında «Filtrlər, qruplaşdırma və
          vizuallaşdırma ilə xüsusi hesabatlar yaradın» izahı var. Sağ yuxarıda iki düymə durur:{" "}
          <HelpKey>İxrac</HelpKey> (yükləmə ikonası — məlumat olmayanda söndürülü qalır) və{" "}
          <HelpKey>Hesabatı saxla</HelpKey> (disk ikonası). Səhifə iki sütuna bölünür: solda dar
          konfiqurasiya paneli (yapışqan — siz aşağı sürüşdürdükdə yerində qalır), sağda isə geniş
          önbaxış sahəsi.
        </p>
        <p>
          Sol panel yuxarıdan aşağıya bu kartlardan ibarətdir: <strong>Obyekt</strong>,{" "}
          <strong>Sütunlar</strong>, <strong>Filtrlər</strong>, <strong>Qruplaşdırma</strong>,{" "}
          <strong>Sıralama</strong>, <strong>Qrafik növü</strong> və <strong>Saxlanmış hesabatlar</strong>.
          Sağ panelin yuxarısında üç xülasə kartı (rəqəm göstəriciləri), altında isə{" "}
          <strong>Önbaxış</strong> kartı (qrafik və ya cədvəl) gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Obyekt">
            Hesabatın əsaslandığı məlumat növü. Açılan siyahıda: Sövdələşmələr, Kontaktlar, Şirkətlər,
            Lidlər, Tiketlər, Tapşırıqlar, Fəaliyyətlər.
          </HelpDef>
          <HelpDef term="Sütunlar">
            Hesabatda görünəcək sahələr. Hər biri bir düymədir — seçildikdə üstündə tik (✓) çıxır;
            başlıqda neçə sütun seçildiyi yazılır.
          </HelpDef>
          <HelpDef term="Filtr">
            Üç hissədən ibarət şərt: <strong>sahə</strong> + <strong>operator</strong> (Bərabərdir, Bərabər
            deyil, Böyükdür, Kiçikdir, Ehtiva edir, Daxildir, Arasında) + <strong>dəyər</strong>. Dəyəri boş
            olan filtr nəzərə alınmır.
          </HelpDef>
          <HelpDef term="Qruplaşdırma">
            Sətirləri seçilmiş sahəyə görə birləşdirib ədədi sütunu cəmləyir (qrafiklər üçün kateqoriya
            oxu). «Yoxdur» = qruplaşdırma tətbiq edilmir.
          </HelpDef>
          <HelpDef term="Sıralama">
            Nəticələrin hansı sahəyə görə düzüləcəyi; sahə seçiləndə altda <strong>Artan sıra</strong> /{" "}
            <strong>Azalan sıra</strong> seçimi görünür.
          </HelpDef>
          <HelpDef term="Qrafik növü">
            Beş seçim: <strong>Cədvəl</strong>, <strong>Sütun qrafik</strong>, <strong>Xətt qrafik</strong>,{" "}
            <strong>Dairə qrafik</strong>, <strong>Sahə qrafik</strong>. Qrafiklər üçün ən azı bir ədədi
            sütun lazımdır.
          </HelpDef>
          <HelpDef term="Önbaxış">
            Cari konfiqurasiyanın canlı nəticəsi — seçdiyiniz qrafik növünə uyğun göstərilir; «Cədvəl»
            seçilməyibsə qrafikin altında həm də məlumat cədvəli çıxır.
          </HelpDef>
          <HelpDef term="Saxlanmış hesabatlar">
            Əvvəllər saxladığınız konfiqurasiyalar. Birinə klikləyəndə bütün parametrlər geri yüklənir.
          </HelpDef>
        </dl>
        <p>
          Sağ paneldəki üç xülasə kartından birincisi həmişə <strong>Ümumi qeydlər</strong> sayını
          göstərir. Sonrakı iki kart: önbaxış cəmi (aqreqat) qaytarırsa, həmin cəmlər; əks halda seçilmiş{" "}
          <strong>Sütunlar</strong> və <strong>Filtrlər</strong> sayı göstərilir. Önbaxış kartının
          başlığında cari <strong>Obyekt</strong> və <strong>Qrafik növü</strong> kiçik nişanlar kimi əks
          olunur.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: hesabat qur və canlı önbaxışla bax">
        <HelpStep n={1}>
          <p>
            <HelpKey>Obyekt</HelpKey> kartındakı açılan siyahıdan hesabatın əsaslanacağı məlumat növünü
            seçin (məs. <HelpKey>Sövdələşmələr</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Obyekti dəyişən kimi sistem həmin obyektə uyğun ağıllı standart sütunları (adətən iki mətn +
            bir ədədi sahə) avtomatik seçir, əvvəlki filtrlər, qruplaşdırma və sıralama isə təmizlənir.
            Önbaxış dərhal yeni obyektin məlumatı ilə yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Sütunlar</HelpKey> kartında hesabatda görmək istədiyiniz sahə düymələrini basın.
            Seçimi ləğv etmək üçün eyni düyməyə yenidən basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş düymə vurğulanır və üstündə tik (✓) çıxır. Kartın başlığındakı say (məs. «3 seçilib»)
            anında dəyişir, önbaxış cədvəli/qrafiki isə yeni sütun dəstini əks etdirir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Şərt qoymaq üçün <HelpKey>Filtrlər</HelpKey> kartının sağındakı <HelpKey>Əlavə et</HelpKey>{" "}
            düyməsini basın, sonra sahəni və operatoru açılan siyahılardan seçib <strong>Dəyər</strong>{" "}
            xanasını doldurun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yeni filtr sətri əlavə olunur: sahə açılan siyahısı, operator açılan siyahısı (Bərabərdir,
            Böyükdür, Ehtiva edir və s.), «Dəyər» yazı xanası və sağda zibil qutusu ikonası. Dəyər boş olan
            filtr nəzərə alınmadığı üçün dəyəri yazana qədər önbaxış dəyişmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            İstəyə bağlı: <HelpKey>Qruplaşdırma</HelpKey> kartından sahə seçin və{" "}
            <HelpKey>Sıralama</HelpKey> kartından sahə seçib altından <HelpKey>Artan sıra</HelpKey> /{" "}
            <HelpKey>Azalan sıra</HelpKey> təyin edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qruplaşdırma sahəsi seçiləndə sətirlər birləşir və ədədi sütun cəmlənir. Sıralama sahəsi
            seçilən kimi onun altında artan/azalan açılan siyahısı peyda olur; hər dəyişiklik önbaxışda
            təxminən yarım saniyə sonra əks olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            <HelpKey>Qrafik növü</HelpKey> kartından nəticəni necə görmək istədiyinizi seçin —{" "}
            <HelpKey>Cədvəl</HelpKey>, <HelpKey>Sütun qrafik</HelpKey>, <HelpKey>Xətt qrafik</HelpKey>,{" "}
            <HelpKey>Dairə qrafik</HelpKey> və ya <HelpKey>Sahə qrafik</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sağdakı <strong>Önbaxış</strong> kartı seçilmiş qrafik növünə keçir. Heç bir ədədi sütun
            seçməmisinizsə, qrafik əvəzinə «Qrafik üçün ədədi sütun seçin» ipucusu və əlavə etmək üçün
            ədədi sahə düymələri göstərilir. «Cədvəl» xaricindəki növlərdə qrafikin altında həm də tam
            məlumat cədvəli çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Heç nə yadda saxlamadan nəticəni izləyin — konstruktor avtomatik işləyir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yükləmə anında <strong>Önbaxış</strong> başlığında və <strong>Ümumi qeydlər</strong> kartında
            fırlanan göstərici görünür. Heç nə uyğun gəlmirsə «Göstəriləcək məlumat yoxdur. Konfiqurasiyanı
            dəyişdirin və önbaxışı işə salın» mətni çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: hesabatı saxla və email cədvəli qur">
        <HelpStep n={1}>
          <p>
            Konfiqurasiya hazır olanda sağ yuxarıdakı <HelpKey>Hesabatı saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Hesabatı saxla» başlıqlı pəncərə açılır. İçində <strong>Hesabat adı</strong> xanası, cari
            konfiqurasiyanın xülasə nişanları (obyekt, sütun sayı, filtr sayı, qrafik növü) və altda «Email
            cədvəli (istəyə bağlı)» bölməsi var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Hesabat adı</strong> yazın — ad boş olduqda saxlama düyməsi söndürülü qalır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ad yazana qədər aşağıdakı <HelpKey>Saxla</HelpKey> düyməsi qeyri-aktivdir; ad yazılan kimi
            aktivləşir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İstəyə bağlı olaraq hesabatı avtomatik email kimi göndərmək üçün <HelpKey>Tezlik</HelpKey>{" "}
            açılan siyahısından <HelpKey>Gündəlik</HelpKey>, <HelpKey>Həftəlik</HelpKey> və ya{" "}
            <HelpKey>Aylıq</HelpKey> seçin, sonra <strong>Alıcılar</strong> xanasına email ünvanlarını
            vergüllə ayıraraq yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tezlik «Cədvəl yoxdur» olduqda alıcılar xanası gizli qalır; bir tezlik seçən kimi{" "}
            <strong>Alıcılar (vergüllə ayrılmış)</strong> xanası görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <HelpKey>Saxla</HelpKey> düyməsini basın. (Mövcud hesabatı yükləyib redaktə edirsinizsə, bu
            düymə <HelpKey>Yenilə</HelpKey> olur.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymədə qısa müddət fırlanan göstərici çıxır, sonra pəncərə bağlanır və hesabat sol paneldəki{" "}
            <strong>Saxlanmış hesabatlar</strong> siyahısının yuxarısında peyda olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: saxlanmış hesabatı yüklə">
        <HelpStep n={1}>
          <p>
            Sol panelin aşağısındakı <HelpKey>Saxlanmış hesabatlar</HelpKey> kartında siyahıdan bir
            hesabat sətrini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə qovluq ikonası, hesabatın adı, altında isə obyekti və yaradılma tarixi göstərilir.
            Hələ heç nə saxlanmayıbsa «Hələ saxlanmış hesabat yoxdur» mətni çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sətrə kliklədikdə bütün parametrlər geri qaytarılır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Obyekt, sütunlar, filtrlər, qruplaşdırma, sıralama və qrafik növü saxlanmış vəziyyətə keçir,
            önbaxış dərhal həmin hesabatla yenilənir. İndi <HelpKey>Hesabatı saxla</HelpKey> pəncərəsi
            açılarsa, başlıq «Hesabatı yenilə» olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: hesabatı CSV və ya Excel-ə ixrac et">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>İxrac</HelpKey> düyməsini basın. (Önbaxışda heç bir sətir yoxdursa, bu
            düymə söndürülü olur.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Hesabatı ixrac et» başlıqlı pəncərə açılır və iki kart göstərir: <strong>CSV</strong> («Vergüllə
            ayrılmış dəyərlər») və <strong>Excel</strong> («XLSX cədvəli»).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstədiyiniz formatı — <HelpKey>CSV</HelpKey> və ya <HelpKey>Excel</HelpKey> — basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Fayl brauzerinizə yüklənir (CSV üçün <code>report.csv</code>, Excel üçün <code>report.xlsx</code>)
            və ixrac pəncərəsi bağlanır. İxrac edilən məlumat ekrandakı cari konfiqurasiyanı əks etdirir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Qrafik boş görünürsə, çox güman ki seçilmiş sütunların heç biri ədədi deyil. Konstruktor bunu
          özü tutub «Qrafik üçün ədədi sütun seçin» ipucusu ilə birlikdə bir kliklə əlavə edə biləcəyiniz
          ədədi sahə düymələrini təklif edir. Dairə qrafik nəticəni həmişə kateqoriyaya görə cəmləyir və
          ən çox 8 dilimə (qalanları «Digər»ə) yığır.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu səhifədə «İşə sal» düyməsi yoxdur — hər dəyişiklik önbaxışı avtomatik yeniləyir, amma nəticə
          dərhal yox, təxminən yarım saniyə gecikmə ilə gəlir. Dəyəri boş olan filtrlər tamamilə nəzərə
          alınmır, ona görə filtr əlavə etdikdən sonra <strong>Dəyər</strong> xanasını doldurmağı unutmayın.
          İxrac yalnız ekrandakı cari konfiqurasiyanı götürür — saxlanmış hesabatı ixrac etmək üçün əvvəlcə
          onu yükləyin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün obyektlər, önbaxış nəticələri, saxlanmış hesabatlar və ixraclar təşkilatınızla məhdudlaşır
          — yalnız öz tenant-ınızın məlumatını görür və ixrac edirsiniz, başqa təşkilatın qeydləri heç vaxt
          daxil olmur. Email cədvəli də yalnız sizin yazdığınız alıcılara göndərilir.
        </p>
      </HelpCallout>
    </div>
  )
}
