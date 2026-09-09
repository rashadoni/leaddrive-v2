"use client"

/**
 * Events — help article (Azerbaijani), video-tutorial script format.
 * Mənbə səhifə: src/app/(dashboard)/events/page.tsx + src/components/event-form.tsx
 * + src/components/events/events-analytics.tsx.
 * Yalnız real UI təsvir olunur: Siyahı/Analitika tabları, 3 addımlı tədbir formu,
 * statistika kartları, axtarış/status filtrləri, silmə, Analitikada dəvət/ICS/təsdiq.
 * Qeyd: Analitika tabındakı iştirakçı/büdcə/təqvim panelləri NÜMAYİŞ məlumatıdır.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function EventsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq və ya tədbir təşkilatçısısınız"
        goal="Konfrans, vebinar və ya seminar yaratmaq, onu siyahıda izləmək və iştirak/büdcə mənzərəsinə baxmaq"
      >
        Səhifəyə soldakı menyudan <HelpKey>Tədbirlər</HelpKey> ilə çatırsınız. Bütün tədbirlər yalnız
        sizin təşkilatınıza aiddir. Başlıqda təqvim ikonası, <HelpKey>Tədbirlər</HelpKey> adı və altında
        cari tədbir sayı («{`{n}`} tədbir») göstərilir. Sağ yuxarıda iki rejim arasında keçirən tab
        düyməsi (<HelpKey>Analitika</HelpKey> / <HelpKey>Siyahı</HelpKey>) və mavi{" "}
        <HelpKey>Yeni tədbir</HelpKey> düyməsi durur.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlığın altında bilik kartçığı («Bilirdinizmi?»), sonra dörd rəngli statistika kartı gəlir:{" "}
          <strong>Tədbirlər</strong> (ümumi say), <strong>Planlaşdırılıb</strong>,{" "}
          <strong>Tamamlandı</strong> və <strong>Ləğv edildi</strong>. Kartların altında seçdiyiniz
          tabdan asılı olaraq ya tədbir <strong>Siyahısı</strong>, ya da <strong>Analitika</strong>{" "}
          panelləri görünür. Siyahı rejimində status filtr düymələri, axtarış sahəsi və tədbir
          kartları (iki sütunlu tor) olur; heç tədbir yoxdursa onların yerinə boş vəziyyət göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Tədbirlər (kart)">Təşkilatınızdakı bütün tədbirlərin ümumi sayı.</HelpDef>
          <HelpDef term="Planlaşdırılıb (kart)">«Planlaşdırılıb» və «Qeydiyyat açıqdır» statuslu tədbirlərin birgə sayı.</HelpDef>
          <HelpDef term="Tamamlandı (kart)">Artıq keçirilmiş, «Tamamlandı» statuslu tədbirlər.</HelpDef>
          <HelpDef term="Ləğv edildi (kart)">Ləğv olunmuş tədbirlər.</HelpDef>
          <HelpDef term="Status">Tədbirin mərhələsi: Planlaşdırılıb, Qeydiyyat açıqdır, Davam edir, Tamamlandı, Ləğv edildi.</HelpDef>
          <HelpDef term="Növ">Tədbir tipi: Konfrans, Vebinar, Seminar, Görüş, Sərgi, Digər.</HelpDef>
          <HelpDef term="Siyahı tabı">Real tədbirlərinizin kart siyahısı — filtr, axtarış və silmə burada işləyir.</HelpDef>
          <HelpDef term="Analitika tabı">Tədbir siyahısı + iştirakçı, büdcə/ROI, təqvim və qeydiyyat portalı panelləri (panellərin bəzi rəqəmləri nümayiş üçün doldurulub).</HelpDef>
        </dl>
        <p>
          Hər tədbir kartında solda tarix bloku (ay və gün), yanında tədbir adı, sağ yuxarıda qırmızı
          zibil qutusu (silmə) ikonası, altda <strong>status</strong> nişanı və <strong>növ</strong>{" "}
          nişanı, varsa təsvir, daha aşağıda isə yer, onlayn işarəsi, iştirakçı sayı (varsa{" "}
          <em>iştirakçı / maks</em>), başlanğıc saatı və büdcə (sıfırdan böyükdürsə) bir sətirdə durur.
          Karta klikləyəndə həmin tədbirin öz səhifəsi açılır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni tədbir yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni tədbir</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni tədbir» başlıqlı pəncərə açılır. Yuxarıda üç addımlı keçid var:{" "}
            <strong>Əsas məlumat</strong>, <strong>Yer və vaxt</strong>, <strong>Büdcə və teqlər</strong>.
            İlk addım (<strong>Əsas məlumat</strong>) aktiv gəlir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Əsas məlumat</strong> addımında <strong>Tədbir adı *</strong> yazın (bu məcburidir),
            istəyə görə <strong>Təsvir</strong> əlavə edin, altdakı altı düymədən <strong>Növ</strong>{" "}
            seçin (Konfrans standart olaraq seçili gəlir) və açılan siyahıdan <strong>Status</strong>{" "}
            təyin edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz növ düyməsi rənglənir və çərçivəyə alınır. Status açılan siyahısında beş seçim
            var: Planlaşdırılıb, Qeydiyyat açıqdır, Davam edir, Tamamlandı, Ləğv edildi.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>İrəli</HelpKey> ilə <strong>Yer və vaxt</strong> addımına keçin.{" "}
            <strong>Başlanğıc tarixi *</strong> (tarix-saat, məcburi) və istəyə görə{" "}
            <strong>Bitmə tarixi</strong> seçin. Onlayn tədbir üçün <strong>Onlayn tədbir</strong>{" "}
            qutusunu işarələyin, sonra çıxan <strong>Görüş linki</strong> sahəsini doldurun. İstəyə görə{" "}
            <strong>Yer</strong> və <strong>maks</strong> (maksimal iştirakçı; 0 = limitsiz) əlavə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tarix sahələri təqvim-saat seçicisi açır. <strong>Onlayn tədbir</strong> qutusunu işarələyən
            kimi altda <strong>Görüş linki</strong> sahəsi peyda olur (məs. zoom linki üçün). Maksimal
            iştirakçı sahəsi yalnız rəqəm qəbul edir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Yenidən <HelpKey>İrəli</HelpKey> ilə <strong>Büdcə və teqlər</strong> addımına keçin.{" "}
            <strong>Büdcə</strong> və <strong>Gözlənilən gəlir</strong> (valyuta nişanı ilə) yazın,
            lazımdırsa <strong>Teqlər</strong> əlavə edin: mətni yazıb yanındakı <HelpKey>+</HelpKey>{" "}
            düyməsini basın və ya Enter vurun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Əlavə etdiyiniz hər teq aşağıda kiçik nişan kimi görünür (yanındakı × ilə silinir). Addımın
            altında <strong>Xülasə</strong> bloku ad, növ, tarix, yer və onlayn işarəsini canlı şəkildə
            göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Aşağı sağdakı <HelpKey>Yeni tədbir</HelpKey> düyməsi ilə yadda saxlayın. (Əvvəlki addıma{" "}
            <HelpKey>Geri</HelpKey>, tamamilə çıxmaq üçün <HelpKey>Ləğv et</HelpKey> var.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yadda saxlanarkən düymə «Saxlanılır...» vəziyyətinə keçir. Uğurlu olduqda pəncərə bağlanır,
            yeni tədbir siyahıda peyda olur və yuxarıdakı statistika kartları (Tədbirlər və uyğun status
            kartı) yenilənir. Ad və ya başlanğıc tarixi boş qalıbsa, formada qırmızı «Mütləq sahə»
            xəbərdarlığı çıxır və pəncərə bağlanmır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: tədbirləri filtrlə, axtar və aç">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıda <HelpKey>Siyahı</HelpKey> tabının seçili olduğundan əmin olun. Status filtr
            düymələrindən birini (<HelpKey>Hamısı</HelpKey>, <HelpKey>Planlaşdırılıb</HelpKey>,{" "}
            <HelpKey>Qeydiyyat açıqdır</HelpKey>, <HelpKey>Davam edir</HelpKey>,{" "}
            <HelpKey>Tamamlandı</HelpKey>, <HelpKey>Ləğv edildi</HelpKey>) basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər düymənin yanında mötərizədə say göstərilir. Seçili filtr tündləşir; siyahı yalnız həmin
            statusdakı tədbirləri göstərir. Eyni düyməni təkrar basmaq filtri ləğv edib yenə hamısını
            qaytarır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Konkret tədbir tapmaq üçün axtarış sahəsinə (<HelpKey>Tədbir axtar...</HelpKey>) ad yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca siyahı avtomatik daralır — server axtarışa görə nəticələri qaytarır, ayrıca
            «Axtar» düyməsi yoxdur. Heç nə uyğun gəlməsə, «Hələ tədbir yoxdur» boş vəziyyəti görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Tədbirin detallarına baxmaq üçün onun kartına klikləyin (zibil qutusu ikonasından kənar
            istənilən yerə).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Həmin tədbirin öz səhifəsinə keçirsiniz (iştirakçılar, büdcə və digər detallar orada idarə
            olunur). Zibil qutusu ikonasına klik isə səhifəni açmır — onun yerinə silmə təsdiq pəncərəsi
            çıxarır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: tədbiri sil">
        <HelpStep n={1}>
          <p>
            Tədbir kartının sağ yuxarısındakı qırmızı zibil qutusu ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tədbirin adı ilə silmə təsdiq pəncərəsi açılır. Burada təsdiqləyənə qədər heç nə silinmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pəncərədə silməni təsdiqləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Pəncərə bağlanır, tədbir siyahıdan çıxır və statistika kartları yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmə geri qaytarılmır. Tədbiri arxivləşdirmək üçün ayrıca «arxiv» düyməsi yoxdur — onu
            sıradan çıxarmaq, amma saxlamaq istəyirsinizsə, redaktə edib statusunu{" "}
            <strong>Ləğv edildi</strong> kimi qoymaq daha təhlükəsizdir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: Analitika tabına bax və dəvət göndər">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı tab keçidində <HelpKey>Analitika</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Görünüş dəyişir: yuxarıda real tədbirlərinizin siyahısı (solda) və seçilmiş tədbirin
            iştirakçı paneli (sağda), altda isə <strong>Büdcə və ROI</strong>,{" "}
            <strong>Tədbir Təqvimi</strong> və <strong>Qeydiyyat Portalı</strong> blokları gəlir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Soldakı siyahıdan bir tədbiri seçin (üzərinə klikləyin).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçili tədbir bənövşəyi çərçivə ilə işarələnir; sağdakı və aşağıdakı panellərin başlığı
            həmin tədbirin adını əks etdirir. <strong>Qeydiyyat Portalı</strong> blokunda paylaşıla
            bilən qeydiyyat linki, yanında kopyalama ikonası görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Qeydiyyat Portalı</strong> blokunda <HelpKey>Dəvət et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Dəvətnamə göndər» modalı açılır: yuxarıda tədbirin adı və tarixi, sonra <strong>Email *</strong>{" "}
            sahəsi (ünvanları vergül, nöqtəli vergül və ya yeni sətirlə ayırın), <strong>Mövzu</strong>{" "}
            (tədbir adı ilə əvvəlcədən doldurulub) və <strong>Şəxsi mesaj</strong> sahələri. Altda «.ics
            görüş sorğusu» ilə bağlı qeyd durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Email ünvanlarını yazıb aşağıdakı <HelpKey>Dəvətnamələri göndər</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə spinner-ə keçir, sonra yaşıl nəticə sətri «{`{sent}`} dəvətnamədən {`{total}`}-i göndərildi»
            kimi cavab verir. SMTP qurulmayıbsa, iştirakçılar «dəvət edilmiş» kimi qeyd olunur və yanında
            «SMTP konfiqurasiya edilməyib» xəbərdarlığı çıxır. Email boş olsa, qırmızı «Ən azı bir e-poçt
            ünvanı daxil edin» xətası göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Eyni blokda <HelpKey>ICS</HelpKey> ilə təqvim faylı endirə, <HelpKey>Təsdiq et</HelpKey> ilə
            seçili tədbirin iştirakçılarını topluca təsdiqləyə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>ICS</HelpKey> seçili tədbir üçün <code>.ics</code> faylını birbaşa yükləyir.{" "}
            <HelpKey>Təsdiq et</HelpKey> basıldıqda düymə yaşıl «Təsdiqlənib» vəziyyətinə keçir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Tədbiri ilk yaradanda statusu <strong>Planlaşdırılıb</strong> saxlayın; iştirakçı qəbul
          etməyə hazır olduqda <strong>Qeydiyyat açıqdır</strong> edin. Yalnız adı və başlanğıc tarixi
          məcburidir — qalan sahələri sonra redaktə ilə doldura bilərsiniz, ona görə tədbiri tez yaradıb
          detalları sonraya saxlamaq olar.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Analitika tabındakı <strong>iştirakçı siyahısı</strong>, <strong>Büdcə və ROI</strong> və{" "}
          <strong>Tədbir Təqvimi</strong> panellərinin bəzi rəqəmləri panel dizaynını göstərmək üçün
          nümunə (nümayiş) məlumatıdır — onları konkret tədbirin canlı statistikası kimi qəbul etməyin.
          Real iştirakçı və büdcə idarəetməsi tədbirin öz detal səhifəsində (kartına klikləməklə) aparılır.
          Dəvət, ICS və Təsdiq düymələri isə seçili real tədbirə təsir edir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün tədbirlər təşkilatınızla məhdudlaşır — başqa təşkilatın tədbirlərini görmür və onlara
          dəvət göndərə bilmirsiniz. Email dəvətlərinin faktiki çatması üçün təşkilatınızda SMTP
          quraşdırılmalıdır (Parametrlər → SMTP); qurulmasa, sistem yalnız «dəvət edilmiş» kimi qeyd edir.
        </p>
      </HelpCallout>
    </div>
  )
}
