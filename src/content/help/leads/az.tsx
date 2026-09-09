"use client"

/**
 * Leads — help article (Azerbaijani).
 * Köhnə paylaşılan "list-power" məqaləsindən ayrılıb — yalnız Lidlər
 * (/leads) səhifəsinə fokuslanır: Kanban + cədvəl iş sahəsi, statuslar,
 * filtrlər, sıralama, sətirdaxili redaktə, kütləvi əməliyyatlar və
 * sövdələşməyə çevirmə.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function leadsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Lidlərlə işləyən satış meneceri və ya komanda üzvüsünüz"
        goal="Potensial müştəriləri bir yerdə izləyin, qiymətləndirin, statuslarını idarə edin və hazır olanları sövdələşməyə çevirin"
      >
        <p>
          Başlamaq üçün heç nə qurmaq lazım deyil — səhifə açılan kimi təşkilatınızın
          lidlərini gətirir. Bütün gördüyünüz yalnız öz təşkilatınıza aiddir.
        </p>
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda <strong>Lidlər</strong> başlığı və yanında ümumi say durur. Onun altında
          dörd statistik kart: ümumi lid sayı, <strong>Çevrildi</strong>, <strong>Ort. bal</strong>{" "}
          (orta Da Vinci balı) və <strong>İsti lidlər</strong> (balı 80-dən yuxarı olanlar). Sağ
          yuxarıda iki rejim açarı — <HelpKey>Analitika</HelpKey> və <HelpKey>Siyahı</HelpKey> —{" "}
          <HelpKey>Anlayışlar</HelpKey> düyməsi və narıncı <HelpKey>Yeni lid</HelpKey> düyməsi.
        </p>
        <p>
          Başlığın altında status pillələri (Hamısı, Yeni, Əlaqə quruldu, Kvalifikasiya edildi,
          Çevrildi, İtirildi — hər birində say) və alət paneli: axtarış, kateqoriya filtri,
          sıralama menyusu və <strong>cədvəl ⇄ Kanban</strong> görünüş açarı durur.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Dərəcə (A–F)">
            Lidin Da Vinci balından çıxarılan hərf: A (80+), B (60+), C (40+), D (20+), F (aşağı).
            Hər sətrin və Kanban kartının solundakı rəngli kvadratdır.
          </HelpDef>
          <HelpDef term="Bal">0–100 arası ədədi Da Vinci balı — dərəcənin və sıralamanın əsasıdır.</HelpDef>
          <HelpDef term="Konversiya">Bu lidin sövdələşməyə çevrilmə ehtimalı (%), balından hesablanır.</HelpDef>
          <HelpDef term="Status">Lidin mərhələsi: Yeni → Əlaqə quruldu → Kvalifikasiya edildi → Çevrildi (və ya İtirildi).</HelpDef>
          <HelpDef term="Kateqoriya">Seqment etiketi: VIP, Partnyor, Prospekt, Adi, Qeyri-aktiv.</HelpDef>
          <HelpDef term="Mənbə">Lidin haradan gəldiyi: Veb sayt, Referans, Soyuq zəng, LinkedIn, Email.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni lid yaratmaq">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı narıncı <HelpKey>Yeni lid</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Lid formu pəncərəsi açılır — əlaqə adı, şirkət, email, telefon, mənbə, kateqoriya və
            təxmini dəyər kimi sahələri doldurursunuz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Sahələri doldurub formu yadda saxlayın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Pəncərə bağlanır, siyahı yenilənir və yeni lid statusuna uyğun Kanban sütununda
            (adətən <strong>Yeni</strong>) və ya cədvəldə görünür; başlıqdakı say bir vahid artır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: lidləri tapmaq və süzmək">
        <HelpStep n={1}>
          <p>
            Status pilləsini basın — məsələn <HelpKey>Kvalifikasiya edildi</HelpKey> — yalnız həmin
            statusdakı lidləri görmək üçün.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş pillə tündləşir, siyahı həmin statusa daralır. Hər pillədəki rəqəm o statusdakı
            lid sayını göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Alət panelindəki axtarış xanasına yazın (<em>«Ad, şirkət, email, telefon üzrə axtarış»</em>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca siyahı dərhal süzülür — ad, şirkət, email, telefon və brend sahələrində uyğunluq
            axtarılır. Sağdakı sayğac «süzülən / ümumi» şəklində dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Lazım gəlsə <strong>kateqoriya</strong> filtrini (Bütün kateqoriyalar, VIP, Adi, Partnyor,
            Prospekt, Qeyri-aktiv) və <strong>sıralama</strong> menyusunu (Da Vinci Bal ↓/↑, Ad A→Z /
            Z→A, Ən yenilər) tətbiq edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahı seçilmiş kateqoriyaya daralır və seçilmiş ardıcıllıqla yenidən düzülür. Heç nə
            uyğun gəlməsə «Nəticə tapılmadı» yazısı çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Kanban lövhəsi ilə işləmək">
        <p>
          Alət panelindəki görünüş açarı ilə <HelpKey>Kanban</HelpKey> rejiminə keçin. Lidlər statusa
          görə sütunlara bölünür: Yeni, Əlaqə quruldu, Kvalifikasiya edildi, Çevrildi, İtirildi (qeyri-standart
          statuslu köhnə lidlər varsa, əlavə <strong>Digər</strong> sütunu da görünür).
        </p>
        <HelpStep n={1}>
          <p>Bir kartı tutub başqa sütuna sürüşdürün.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sütunlar sürükləmə zamanı kəsik-kəsik haşiyə ilə hədəf kimi işıqlanır. Kart dərhal yeni
            sütuna keçir (optimist yeniləmə); server qəbul etməsə, kart geri qayıdır və xəbərdarlıq
            çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Bir kartın özünü basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Həmin lidin detal səhifəsi açılır. Kartın altındakı düymələrlə isə birbaşa çevirmə (yaşıl
            ox), redaktə (qələm) və silmə (zibil qutusu) edə bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: cədvəldə sətirdaxili redaktə">
        <p>
          Görünüş açarı ilə <HelpKey>Siyahı</HelpKey> (cədvəl) rejiminə keçin. Sütunlar: seçim
          xanası, Dərəcə, Lid, Şirkət, Əlaqələr, Konversiya, Mənbə, Kateqoriya, Status və əməliyyatlar.
        </p>
        <HelpStep n={1}>
          <p>Lidin adına iki dəfə klikləyin (cüt-klik).</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ad sahəsi redaktə edilə bilən xanaya çevrilir; yeni adı yazıb yadda saxlaya bilərsiniz.
            Bir dəfə klik isə lidin detal səhifəsini açır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Email və ya telefon xanasını, yaxud Mənbə / Kateqoriya / Status pillələrini birbaşa cədvəldə
            redaktə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Email/telefon mətn xanasına, status və mənbə isə açılan seçim siyahısına çevrilir. Yadda
            saxladıqda dəyişiklik server-ə göndərilir və siyahı yenilənir; xəta olsa qırmızı bildiriş çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Sütun başlığına (məsələn <HelpKey>Bal</HelpKey> və ya <HelpKey>Şirkət</HelpKey>) klikləyin.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl həmin sütun üzrə sıralanır; başlıqdakı ox yuxarı/aşağı istiqaməti göstərir və təkrar
            klik istiqaməti tərsinə çevirir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: kütləvi əməliyyatlar (yalnız cədvəl)">
        <HelpStep n={1}>
          <p>
            Sətirlərdəki seçim xanalarını işarələyin (və ya başlıqdakı xana ilə hamısını seçin).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş sətirlər vurğulanır və yuxarıda kütləvi əməliyyat paneli çıxır: neçə lid seçildiyini
            göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Paneldən <HelpKey>Statusu təyin et…</HelpKey> seçin, istifadəçi seçimi ilə yenidən təyin edin
            (reassign) və ya qırmızı <HelpKey>Sil</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş bütün lidlərə əməliyyat tətbiq olunur; neçə lidin dəyişdiyini göstərən bildiriş çıxır.
            Silmə əvvəlcə təsdiq pəncərəsi açır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: lidi sövdələşməyə çevirmək">
        <HelpStep n={1}>
          <p>
            Lid sətrində və ya Kanban kartında yaşıl ox (<HelpKey>Sövdələşməyə çevir</HelpKey>) düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Çevirmə pəncərəsi açılır — lidi kontakt + sövdələşməyə çevirmək üçün detalları təsdiqləyirsiniz.
            (Artıq «Çevrildi» statusunda olan lidlərdə bu düymə görünmür.)
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Pəncərədə çevirməni təsdiqləyin.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Lid Çevrildi statusuna keçir və siyahı yenilənir; yeni sövdələşmə (və lazım gəlsə kontakt)
            yaradılır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Kanban sütununa sürükləməklə statusu dəyişmək sadəcə status PATCH-idir — tam çevirmə deyil.
          Kontakt və sövdələşmə yaradan əsl çevirmə üçün həmişə yaşıl <strong>ox</strong> düyməsini
          istifadə edin.
        </p>
      </HelpCallout>
      <HelpCallout kind="warning">
        <p>
          Kütləvi əməliyyatlar yalnız <strong>cədvəl</strong> rejimində mövcuddur. Görünüşü, statusu və
          ya filtri dəyişdiyiniz an seçim sıfırlanır — çünki seçilmiş sətirlər artıq yeni siyahıda olmaya bilər.
        </p>
      </HelpCallout>
      <HelpCallout kind="security">
        <p>
          Bütün lidlər təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın lidlərini görür və dəyişdirirsiniz.
          Yaratma, redaktə, çevirmə və silmə əməliyyatları sizin giriş hüququnuza tabedir.
        </p>
      </HelpCallout>
    </div>
  )
}
