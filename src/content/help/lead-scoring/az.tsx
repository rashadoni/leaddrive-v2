"use client"

/**
 * Lead Scoring (Da Vinci lid qiymətləndirmə) — help article (Azerbaijani).
 * Yalnız /lead-scoring səhifəsini əhatə edir: «Hamısını qiymətləndir» düyməsi,
 * dörd statistika kartı, A–F dərəcə paylanması, nəticələr cədvəli (səkkiz sütun,
 * sətirdən-sətrə yenidən hesablama) və sətrə klikləməklə açılan lid detal pəncərəsi
 * (altı tab: Detallar / Fəaliyyət / Tonallıq / Tapşırıqlar / Da Vinci Mətn /
 * Da Vinci Reytinq). Lidlərin özünü yaratmaq/idarə etmək bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function LeadscoringHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış meneceri və ya nümayəndəsisiniz"
        goal="Lidləri Da Vinci ilə qiymətləndirib hansılarına əvvəlcə fokuslanmaq lazım olduğunu görmək — və ən qaynar lidlərin üzərində dərhal hərəkətə keçmək"
      >
        Səhifə lidlərinizi <strong>bal (0–100)</strong> və <strong>dərəcə (A–F)</strong> üzrə
        sıralayan vizual paneldir. Burada lid yaratmırsınız — mövcud lidlər avtomatik gəlir;
        siz sadəcə onları qiymətləndirir, hər birini araşdırır və lazım gəlsə birbaşa hərəkətə
        keçirsiniz. Bütün lidlər və ballar yalnız sizin təşkilatınız üçündür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Da Vinci İdarəetmə Mərkəzi</HelpKey> adı və altında bir izah sətri var;
          sağ yuxarıda isə əsas əməliyyat düyməsi durur — <HelpKey>Hamısını qiymətləndir</HelpKey>.
          Onun altında səhifə təsviri, sonra dörd statistika kartı, ardınca beş dərəcə kartı (A–F),
          ən altda isə <strong>Statistika</strong> başlıqlı nəticələr cədvəli gəlir. Hələ heç bir
          lid yoxdursa, cədvəlin yerinə boş vəziyyət göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ort. bal">Qiymətləndirilmiş lidlərin (balı 0-dan böyük olanların) orta balı, 100 üzərindən.</HelpDef>
          <HelpDef term="Ehtimal">Həmin lidlərin orta konversiya ehtimalı (faizlə).</HelpDef>
          <HelpDef term="Cəmi sessiyalar">«Neçə lid qiymətləndirilib / cəmi neçə lid var» şəklində nisbət (məs. 12 / 40).</HelpDef>
          <HelpDef term="Aktiv">Sonuncu qiymətləndirmənin əsl Da Vinci ilə (Bəli), yoxsa sadə qaydalarla (Xeyr) aparıldığını göstərir.</HelpDef>
          <HelpDef term="Dərəcə (A–F)">Bal aralığına görə yarlıq: A İsti (80–100), B İlıq (60–79), C Neytral (40–59), D Soyuq (20–39), F Ölü (0–19). Hər dərəcə kartında o aralığa düşən lidlərin sayı yazılır.</HelpDef>
          <HelpDef term="Bal">Lidin 0–100 arasındakı qiymətləndirmə balı; cədvəl ona görə yüksəkdən aşağıya sıralanır.</HelpDef>
          <HelpDef term="Konversiya">Lidin sövdələşməyə çevrilmə ehtimalı (faizlə).</HelpDef>
        </dl>
        <p>
          Nəticələr cədvəlinin səkkiz sütunu var: <strong>Bal</strong> (dərəcə nişanı),{" "}
          <strong>Bal</strong> (rəqəm), <strong>Ad</strong> (altında e-poçt), <strong>Şirkət</strong>,{" "}
          <strong>Mənbə</strong>, <strong>Konversiya</strong> (faiz), <strong>Statistika</strong>{" "}
          (Da Vinci-nin qısa izahı, iki sətrə qədər kəsilir) və <strong>Əməliyyatlar</strong>.
          Sətirlər ən yüksək baldan başlayaraq sıralanır. Hər sətrin sonunda{" "}
          <HelpKey>Yenilə</HelpKey> düyməsi var; sətrin özünə klikləmək isə lid detal pəncərəsini açır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: bütün lidləri bir dəfəyə qiymətləndir">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Hamısını qiymətləndir</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə üzərində fırlanan ikon görünür və yazı <HelpKey>Yüklənir...</HelpKey> olur;
            proses bitənə qədər düymə deaktiv qalır. Çox lid olduqda bu bir neçə saniyə çəkə bilər.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Qiymətləndirmə bitənə qədər gözləyin — heç bir əlavə təsdiq tələb olunmur.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl təzə ballarla yenidən yüklənir və yenə yüksəkdən aşağıya sıralanır.{" "}
            <strong>Ort. bal</strong>, <strong>Ehtimal</strong> və <strong>Cəmi sessiyalar</strong>{" "}
            kartları, eləcə də beş dərəcə kartındakı saylar yenilənir. <strong>Aktiv</strong> kartı
            əsl Da Vinci işləyibsə <HelpKey>Bəli</HelpKey>, sadə qaydalarla işləyibsə{" "}
            <HelpKey>Xeyr</HelpKey> göstərir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: tək bir lidi yenidən qiymətləndir">
        <HelpStep n={1}>
          <p>
            Cədvəldə həmin lidin sətrini tapın və sağdakı <strong>Əməliyyatlar</strong> sütununda{" "}
            <HelpKey>Yenilə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yalnız o düymənin ikonu fırlanmağa başlayır və düymə müvəqqəti deaktiv olur; cədvəlin
            qalanı yerində qalır. (Bu düyməni basmaq sətri açmır — klik yalnız düyməyə təsir edir.)
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Hesablama bitənə qədər gözləyin.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Lidin balı, dərəcə nişanı, konversiya faizi və <strong>Statistika</strong> sütunundakı
            izah yenilənir. Bal dəyişibsə, sətir cədvəldə yeni mövqeyinə sürüşür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: bir lidi araşdır və hərəkətə keç">
        <HelpStep n={1}>
          <p>Cədvəldə istənilən lid sətrinin üzərinə klikləyin (Yenilə düyməsinin xaricində).</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Lid detal pəncərəsi açılır. Yuxarıda dərəcə dairəsi (A–F), lidin adı, şirkəti, status və
            prioritet nişanları, varsa e-poçt və telefon keçidləri, sağda isə <strong>Bal</strong>,{" "}
            <strong>Konversiya</strong> və (varsa) gözlənilən dəyər göstərilir. Aşağıda altı tab var:{" "}
            <HelpKey>Detallar</HelpKey>, <HelpKey>Fəaliyyət</HelpKey>, <HelpKey>Tonallıq</HelpKey>,{" "}
            <HelpKey>Tapşırıqlar</HelpKey>, <HelpKey>Da Vinci Mətn</HelpKey> və{" "}
            <HelpKey>Da Vinci Reytinq</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Detallar</HelpKey> tabında status və prioriteti birbaşa düymələrlə dəyişin,{" "}
            <HelpKey>Redaktə et</HelpKey> ilə əlaqə məlumatlarını yeniləyin, ya da aşağıdakı
            əməliyyatlardan birini seçin: <HelpKey>Sövdələşməyə çevir</HelpKey> (mümkün olduqda),{" "}
            <HelpKey>İtirildi</HelpKey> və ya <HelpKey>Sil</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Status/prioritet düyməsini basanda seçim dərhal yadda saxlanır və nişan yenilənir.{" "}
            <HelpKey>İtirildi</HelpKey> və <HelpKey>Sil</HelpKey> əvvəlcə təsdiq pəncərəsi çıxarır.
            Aşağıdakı <strong>Da Vinci Score</strong> zolağı cari balı və sonuncu qiymətləndirmə
            tarixini göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Da Vinci-nin izahını və faktorlarını görmək üçün <HelpKey>Da Vinci Reytinq</HelpKey>{" "}
            tabına keçin. Balı yeniləmək üçün buradakı <HelpKey>Da Vinci ilə yenidən hesabla</HelpKey>{" "}
            düyməsini də basa bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Üç kart — <strong>Dərəcə</strong>, <strong>Bal</strong>, <strong>Konversiya</strong> —
            və varsa Da Vinci-nin mətnli izahı çıxır. Qiymətləndirmə faktorları olduqda hər biri ad
            və mütərəqqi zolaqla sadalanır. Lid hələ qiymətləndirilməyibsə, «Da Vinci tərəfindən hələ
            qiymətləndirilməyib» mesajı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            İstəyə bağlı: <HelpKey>Da Vinci Mətn</HelpKey> tabında lidin profilinə uyğun e-poçt/SMS
            yaratdırın (növ, ton və əlavə təlimat seçərək), <HelpKey>Tonallıq</HelpKey> tabında
            tonallıq təhlili işə salın, <HelpKey>Tapşırıqlar</HelpKey> tabında növbəti addım
            tapşırıqları yaratdırın və ya <HelpKey>Fəaliyyət</HelpKey> tabında zəng/qeyd/görüş yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər tab öz «yarat»/«təhlil et» düyməsini göstərir; düyməni basanda yazı «Yaradılır…» və
            ya «Təhlil edilir…» olur, sonra nəticə pəncərə daxilində açılır. Mətn yaranınca onu{" "}
            kopyalaya, (lidin e-poçtu varsa) <strong>E-poçt göndər</strong> ilə yollaya və ya{" "}
            yenidən yaratdıra bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          İş ardıcıllığı sadədir: əvvəlcə <HelpKey>Hamısını qiymətləndir</HelpKey> ilə hamısını
          təzələyin, sonra cədvəlin yuxarısından — yəni A və B dərəcəli, ən yüksək ballı lidlərdən —
          başlayın. <strong>Statistika</strong> sütunundakı qısa izah hər lidə nə üçün belə bal
          verildiyini bir baxışda göstərir; daha dərin baxış üçün sətrə klikləyin.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <strong>Aktiv</strong> kartı <HelpKey>Xeyr</HelpKey> göstərirsə, sonuncu qiymətləndirmə
          əsl Da Vinci yerinə sadə qaydalarla aparılıb (məs. Da Vinci açarı/konfiqı əlçatan olmayanda).
          Ballar yenə işləkdir, sadəcə mətnli izahlar daha sadə ola bilər — şübhələnəndə yenidən
          qiymətləndirin. Lid pəncərəsindəki <HelpKey>Sil</HelpKey> əməliyyatı lidi büsbütün silir və
          geri qaytarılmır; sadəcə işdən çıxarmaq istəyirsinizsə, onun yerinə statusu{" "}
          <HelpKey>İtirildi</HelpKey> edin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün lidlər, ballar və qiymətləndirmələr təşkilatınızla məhdudlaşır — yalnız öz
          tenant-ınızın lidlərini görür və qiymətləndirirsiniz. Yaradılan e-poçtun göndərilməsi
          təşkilatınızın e-poçt kanalından keçir.
        </p>
      </HelpCallout>
    </div>
  )
}
