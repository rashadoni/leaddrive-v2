"use client"

/**
 * Contract Templates & Clauses — help article (Azerbaijani).
 * Video-ssenari formatına yenidən yazılıb: yalnız
 * /contracts/templates səhifəsini əhatə edir — iki sekme
 * (Şablonlar + Bəndlər kitabxanası), axtarış/filtrlər, şablon və
 * bənd redaktorları, AI bənd hazırlama köməkçisi, təsdiqlə/ləğv et
 * idarəçiliyi və silmə. Müqavilə YARATMA axını (Müqavilələr səhifəsi)
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

export default function contracttemplatesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Hüquq, satış əməliyyatları və ya administrator rolundasınız"
        goal="Təkrar istifadəli müqavilə şablonları qurmaq və əvvəlcədən təsdiqlənmiş hüquqi bəndlərin idarə olunan kitabxanasını saxlamaq"
      >
        Səhifə başlıqda <HelpKey>Şablonlar və bəndlər</HelpKey> adını, altında «Müqavilə
        şablonlarını və idarəolunan bəndlər kitabxanasını idarə edin» izahını daşıyır. Burada iki
        sekme var: <HelpKey>Şablonlar</HelpKey> və <HelpKey>Bəndlər kitabxanası</HelpKey>. Hər şey
        yalnız sizin təşkilatınız üçündür — başqa tenant-ın şablon və ya bəndlərini görmürsünüz.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlığın yanında sənəd ikonası, sağ yuxarıda isə bu kömək düyməsi durur. Onun altında iki
          sekme gəlir; hər sekmenin adının yanında, içində nə qədər element olduğunu göstərən kiçik
          say nişanı var (məsələn <HelpKey>Şablonlar 3</HelpKey>). Standart olaraq{" "}
          <strong>Şablonlar</strong> sekmesi açıq olur.
        </p>
        <p>
          <strong>Şablonlar</strong> sekmesində yuxarıda axtarış sahəsi və{" "}
          <HelpKey>Yeni şablon</HelpKey> düyməsi, altında isə şablon siyahısı var. Hər sətirdə ad,
          (varsa) təsvir, müqavilə növü, <strong>v{"{nömrə}"}</strong> versiya nişanı, bənd sayı və
          sağda redaktə (qələm) ilə sil (zibil qutusu) düymələri görünür.
        </p>
        <p>
          <strong>Bəndlər kitabxanası</strong> sekmesində axtarış sahəsi, üç filtr (status, risk,
          kateqoriya), <HelpKey>Yeni bənd</HelpKey> və <HelpKey>AI ilə qaralama</HelpKey> düymələri,
          altında isə bənd siyahısı durur. Hər bənd sətrində başlıq, (varsa) kateqoriya, risk
          nişanı, status nişanı, versiya nişanı, təsdiqlə/ləğv et düyməsi, redaktə və sil düymələri
          olur.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Şablon">Adlı müqavilə planı — müqavilə növü, isteğe bağlı standart müddət (ay), bənd bloklarının siyahısı və dəyişənlər toplusunu birləşdirir.</HelpDef>
          <HelpDef term="Bənd bloku (şablon daxilində)">Şablonun bir bölməsi: başlığı və mətni olan blok. Mətndə dəyişənlərə <code>{"{{dəyişənAdı}}"}</code> kimi istinad olunur; blok şərti də ola bilər.</HelpDef>
          <HelpDef term="Dəyişən">Adlı yer tutucu — Mətn, Rəqəm, Tarix və ya Bəli/Xeyr tipində. «Məcburi» işarələnə, etiket və ipucu daşıya bilər.</HelpDef>
          <HelpDef term="Versiya">Hər yadda saxlama versiyanı artırır (v1, v2, …). Siyahıda sonuncu versiya göstərilir.</HelpDef>
          <HelpDef term="Kitabxana bəndi">Ayrı-ayrı, idarə olunan hüquqi paraqraf — risk səviyyəsi, status, kateqoriya, tətbiq olunan hüquq, sahib və əsas bəndlə əlaqəsi ilə.</HelpDef>
          <HelpDef term="Risk səviyyəsi">«Standart» (yaşıl), «Ehtiyat» (sarı) və ya «Yüksək risk» (qırmızı) — bəndin nə qədər standart olduğunu bildirir.</HelpDef>
          <HelpDef term="Status">«Qaralama», «Təsdiqlənib» və ya «Ləğv edilib» — bəndin istifadəyə yararlılığını göstərir.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni şablon yarat">
        <HelpStep n={1}>
          <p>
            <HelpKey>Şablonlar</HelpKey> sekmesində sağdakı <HelpKey>Yeni şablon</HelpKey> düyməsini
            basın. (Hələ heç bir şablon yoxdursa, boş vəziyyətin ortasındakı{" "}
            <HelpKey>İlk şablonu yarat</HelpKey> düyməsi də eyni pəncərəni açır.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni şablon» başlıqlı geniş pəncərə açılır. Yuxarıda <strong>Şablon adı</strong> və{" "}
            <strong>Müqavilə növü</strong> sahələri yan-yana, altında <strong>Təsvir</strong> və{" "}
            <strong>Standart müddət (ay)</strong> durur. Daha aşağıda «Dəyişənlər» və «Bənd blokları»
            bölmələri var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Şablon adı</strong> yazın və <strong>Müqavilə növü</strong> seçin (Xidmət
            müqaviləsi, NDA, Texniki xidmət, Lisenziya, SLA və ya Digər). İstəsəniz qısa{" "}
            <strong>Təsvir</strong> və <strong>Standart müddət</strong> əlavə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Müqavilə növü açılan siyahıda altı seçim göstərir. Standart müddət sahəsi yalnız rəqəm
            qəbul edir (minimum 1). Adı boş buraxıb yadda saxlamağa çalışsanız, «Şablon adı
            mütləqdir» bildirişi çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            «Dəyişənlər» bölməsində <HelpKey>Dəyişən əlavə et</HelpKey> ilə bənd mətninizin istinad
            edəcəyi yer tutucuları əlavə edin. Hər dəyişən üçün ad, tip (Mətn/Rəqəm/Tarix/Bəli-Xeyr)
            və <strong>məcburi</strong> qutusu, ikinci sətirdə isə etiket və ipucu var.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Heç dəyişən yoxkən «Dəyişən yoxdur — bənd mətninə {"{{dəyişənAdı}}"} ilə istinad edin»
            ipucusu görünür. Dəyişən əlavə etdikcə hər biri ayrıca sətirdə peyda olur; sağdakı × ilə
            silinir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            «Bənd blokları» bölməsində <HelpKey>Bənd əlavə et</HelpKey> ilə hər bölmə üçün blok
            yaradın. Hər blokda <strong>başlıq</strong> və <strong>mətn</strong> sahəsi var; mətndə
            dəyişənləri <code>{"{{dəyişənAdı}}"}</code> kimi yazın. İstəyə bağlı olaraq{" "}
            <HelpKey>şərt əlavə et</HelpKey> ilə blokun yalnız müəyyən dəyişən bir dəyərə bərabər
            olanda görünməsini təyin edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Forma açılanda artıq bir boş bənd bloku gəlir. «+ şərt əlavə et» basanda «Göstər əgər»
            sətri açılır: dəyişən adı, <code>==</code> işarəsi və dəyər. Yalnız bir blok qalıbsa,
            onun zibil qutusu düyməsi söndürülmüş olur — şablonda ən azı bir blok qalmalıdır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Aşağıdakı <HelpKey>Saxla</HelpKey> düyməsini basın (fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Başlıqsız bənd blokunuz varsa, «Bəndin başlığı mütləqdir» bildirişi çıxır. Hər şey
            qaydasındadırsa, «Şablon yaradıldı» bildirişi görünür, pəncərə bağlanır və yeni şablon
            siyahıda <strong>v1</strong> nişanı və bənd sayı ilə peyda olur; sekme başlığındakı say
            da artır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Dəyişən adları böyük-kiçik hərflərə həssasdır: <code>clientName</code> ilə{" "}
            <code>ClientName</code> fərqli sayılır. Bütün şablon boyu eyni yazılışı saxlayın ki,
            mətndəki <code>{"{{...}}"}</code> markerləri düzgün uyğunlaşsın.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: şablonu redaktə et və ya sil">
        <HelpStep n={1}>
          <p>
            Şablon sətrindəki qələm ikonalı düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Şablonu redaktə et» başlıqlı eyni forma açılır, mövcud ad, növ, müddət, dəyişənlər və
            bəndlərlə əvvəlcədən doldurulmuş şəkildə.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Dəyişiklikləri edib <HelpKey>Saxla</HelpKey> ilə təsdiqləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Şablon yeniləndi» bildirişi çıxır və siyahıdakı versiya nişanı bir vahid artır (məs.
            v1-dən v2-yə).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Şablonu silmək üçün sətirdəki qırmızı zibil qutusu ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «{"„"}{"{ad}"}{"“"} silinsin? Bu əməliyyatı geri qaytarmaq olmaz» mətnli təsdiq
            pəncərəsi açılır. Təsdiqlədikdən sonra «Şablon silindi» bildirişi çıxır, sətir siyahıdan
            yox olur və sekme sayı azalır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: bəndlər kitabxanasını idarə et">
        <HelpStep n={1}>
          <p>
            Yuxarıdakı <HelpKey>Bəndlər kitabxanası</HelpKey> sekmesinə keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Axtarış sahəsi, «Bütün statuslar» və «Bütün risk səviyyələri» açılan filtrləri,
            (kitabxanada kateqoriyalı bənd varsa) «Bütün kateqoriyalar» filtri, sonra{" "}
            <HelpKey>Yeni bənd</HelpKey> və <HelpKey>AI ilə qaralama</HelpKey> düymələri görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Yeni bənd</HelpKey> düyməsini basın. Açılan pəncərədə{" "}
            <strong>Bəndin başlığı</strong> və <strong>Bəndin mətni</strong> (məcburi), həmçinin{" "}
            <strong>Kateqoriya</strong>, <strong>Risk səviyyəsi</strong>,{" "}
            <strong>Tətbiq edilən hüquq</strong>, <strong>Status</strong>, <strong>Sahib</strong> və{" "}
            <strong>Əsas bənd</strong> sahələri var.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mətn sahəsinin üstündə «{"{{dəyişən}}"} markerləri istifadə edin» ipucusu durur. Risk
            səviyyəsi (Standart/Ehtiyat/Yüksək risk) və Status (Qaralama/Təsdiqlənib/Ləğv edilib)
            açılan siyahılardır. <strong>Sahib</strong> təşkilatınızın istifadəçilərindən, «Əsas
            bənd» isə mövcud kitabxana bəndlərindən seçilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Doldurub <HelpKey>Saxla</HelpKey> basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Başlıq və ya mətn boşdursa, müvafiq olaraq «Bəndin başlığı mütləqdir» / «Bəndin mətni
            mütləqdir» bildirişi çıxır. Uğurlu halda «Bənd yaradıldı» görünür və yeni bənd risk,
            status (yeni bənd <strong>Qaralama</strong> olur) və versiya nişanları ilə siyahıya
            əlavə olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Bir bəndi təsdiqləmək üçün sətirdəki yaşıl işarə (✓) düyməsini basın; təsdiqlənmiş bənddə
            isə bu düymə arxiv ikonasına çevrilir və onu <HelpKey>İstifadədən çıxar</HelpKey> edir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Uğurlu halda «Bənd təsdiqləndi» və ya «Bənd istifadədən çıxarıldı» bildirişi çıxır,
            sətirdəki status nişanı uyğun olaraq dəyişir. İcazəniz yoxdursa, server xəta mesajını
            qaytarır və status dəyişmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Bəndi redaktə etmək üçün qələm, silmək üçün isə qırmızı zibil qutusu ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Redaktə eyni, əvvəlcədən doldurulmuş formanı açır. Silmə «{"„"}{"{ad}"}{"“"}
            bəndi silinsin? Bu əməliyyatı geri qaytarmaq olmaz» təsdiqini göstərir; təsdiqlədikdən
            sonra «Bənd silindi» bildirişi çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Status dəyişikliyi (təsdiqlə / istifadədən çıxar) serverdə administrator hüququna
            bağlıdır. İcazəniz olmasa, düymə görünsə də əməliyyat alınmır və ekranda xəta mesajı
            çıxır — bu, gözlənilən davranışdır, nasazlıq deyil.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: AI ilə bənd qaralaması hazırla">
        <HelpStep n={1}>
          <p>
            <HelpKey>Bəndlər kitabxanası</HelpKey> sekmesində <HelpKey>AI ilə qaralama</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «AI Bənd Hazırlama Köməkçisi» başlıqlı pəncərə açılır. İçində böyük «Bəndi təsvir edin»
            mətn sahəsi (sağ altda <strong>0/2000</strong> sayğacı ilə) və isteğe bağlı{" "}
            <strong>Kateqoriya</strong> sahəsi var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstədiyiniz bəndi sadə dillə yazın (məs. «Hadisə başına 1 milyon dollara qədər məsuliyyəti
            məhdudlaşdıran bənd»), sonra <HelpKey>Bəndi hazırla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Təsvir boşdursa, «Zəhmət olmasa hazırlamaq istədiyiniz bəndi təsvir edin» bildirişi
            çıxır. Hazırlanan zaman düymə «Hazırlanır…» yazısına və fırlanan ikona keçir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Nəticəni nəzərdən keçirin: açılan paneldə <strong>başlıq</strong>, <strong>mətn</strong>,{" "}
            <strong>kateqoriya</strong> və <strong>risk səviyyəsi</strong> redaktə oluna bilər.
            Lazım gəlsə <HelpKey>Yenidən hazırla</HelpKey> ilə təkrar yaradın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hazırlanmış qaralama açıla-bağlana bilən paneldə görünür. Paneldəki sahələri sərbəst
            dəyişə bilərsiniz — bunlar saxlanılan bəndi təşkil edir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Razısınızsa, aşağıdakı <HelpKey>Qaralama kimi saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Bənd qaralaması kitabxanaya əlavə edildi» bildirişi çıxır, pəncərə bağlanır və yeni
            bənd <strong>Qaralama</strong> statusunda siyahıya düşür. Onu adi qaydada redaktə edib
            sonradan təsdiqləyə bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Axtarış və filtrlər birgə işləyir. <strong>Bəndlər kitabxanası</strong> sekmesində status,
          risk və kateqoriya filtrlərini birləşdirib, məsələn, yalnız «Təsdiqlənib» statuslu və
          «Standart» riskli bəndləri görə bilərsiniz. Kateqoriya filtri yalnız kitabxanada ən azı
          bir kateqoriyalı bənd olanda görünür.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün şablonlar və bəndlər təşkilatınıza bağlıdır — başqa tenant onları görmür və istifadə
          edə bilmir. Bəndin statusunu dəyişmək (təsdiqlə / istifadədən çıxar) administrator
          hüququ tələb edir; bu, təsdiqlənmiş hüquqi dilə kimin nəzarət etdiyini idarə altında
          saxlayır. <strong>Sahib</strong> və «Əsas bənd» seçimləri yalnız öz təşkilatınızın
          istifadəçi və bəndlərindən gəlir.
        </p>
      </HelpCallout>
    </div>
  )
}
