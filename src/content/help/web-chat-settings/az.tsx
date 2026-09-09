"use client"

/**
 * Web Chat Widget — help article (Azerbaijani).
 * Tənzimləmələr → Veb Çat Vidceti səhifəsini əhatə edir: vidceti aktivləşdirmə,
 * əlavə etmə kodu (embed snippet) və ictimai açar, görünüş (başlıq/rəng/salamlama/
 * yerləşmə/oflayn mesajı), davranış (Da Vinci AI avtomatik cavabı / bilet eskalasiyası /
 * başlatma düyməsi), iş saatları və icazəli mənbələr (allowed origins).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function WebChatSettingsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Saytınızda canlı çat dəstəyi qurmaq istəyən administrator və ya marketinq məsulusunuz"
        goal="Saytınıza üzən çat düyməsi əlavə etmək, onun görünüşünü və davranışını tənzimləmək"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Veb Çat Vidceti</HelpKey> yolu ilə
        çatırsınız. Vidcet konfiqurasiyası yalnız sizin təşkilatınıza aiddir. Səhifə açılanda cari
        ayarlarınız serverdən yüklənir; yüklənənə qədər boz «pulsing» bloku görünür. Dəyişiklikləri
        etdikdən sonra mütləq aşağıdakı <HelpKey>Dəyişiklikləri yadda saxla</HelpKey> düyməsi ilə
        təsdiqləyin — açar yeniləmə və kopyalama istisna olmaqla heç nə avtomatik yadda saxlanmır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda mavi söhbət ikonası, yanında <HelpKey>Veb Çat Vidceti</HelpKey> adı və «Saytınıza
          canlı çat düyməsi əlavə edin» izahı durur. Altda bir neçə kart bölmə şəklində sıralanır:{" "}
          <strong>Vidcet aktivdir</strong> açarı, <strong>Əlavə etmə kodu</strong>,{" "}
          <strong>Görünüş</strong>, <strong>Davranış</strong>, <strong>İş saatları</strong> və{" "}
          <strong>İcazəli mənbələr</strong>. Ən altda isə sağ tərəfdə yerləşən{" "}
          <HelpKey>Dəyişiklikləri yadda saxla</HelpKey> düyməsi var.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Vidcet aktivdir">Bütün saytlarda çat düyməsini bir anda göstərən/gizlədən əsas açar.</HelpDef>
          <HelpDef term="Əlavə etmə kodu (embed snippet)">Saytınıza yapışdırılan hazır &lt;script&gt; sətri — içində ictimai açarınız (publicKey) var.</HelpDef>
          <HelpDef term="İctimai açar (publicKey)">Vidceti təşkilatınızla əlaqələndirən kod; «Açarı yenilə» onu sıfırlayır.</HelpDef>
          <HelpDef term="Görünüş">Çat pəncərəsinin başlığı, əsas rəngi, salamlama mesajı, ekrandakı yeri və oflayn mesajı.</HelpDef>
          <HelpDef term="Davranış">Üç qeyd qutusu: Da Vinci (AI) avtomatik cavabı, e-poçt buraxılanda bilet yaratma və üzən başlatma düyməsinin göstərilməsi.</HelpDef>
          <HelpDef term="İş saatları">Aktiv olduqda iş saatları xaricində AI cavabını dayandırıb oflayn mesajını göstərən cədvəl.</HelpDef>
          <HelpDef term="İcazəli mənbələr (allowed origins)">Vidceti işlətməyə icazəli sayt ünvanlarının siyahısı — boş buraxılsa istənilən saytda işləyir.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: vidceti aktivləşdir və kodu sayta yerləşdir">
        <HelpStep n={1}>
          <p>
            Yuxarıdakı <strong>Vidcet aktivdir</strong> kartında sağdakı açarı basıb yandırın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açar yaşıl vəziyyətə keçir və içindəki dairə sağa sürüşür. Altındakı «Bütün saytlarda
            düyməni gizlətmək üçün söndürün» izahı dəyişməz qalır. Bu hələ yadda saxlanmayıb — dəyişiklik
            yalnız <HelpKey>Dəyişiklikləri yadda saxla</HelpKey> basıldıqda tətbiq olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Əlavə etmə kodu</strong> kartında boz çərçivədəki <code>&lt;script&gt;</code> sətrinin
            yanındakı <HelpKey>Kodu kopyala</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymənin ikonası kopyala işarəsindən qısa müddətə təsdiq «✓» işarəsinə keçir və mətni{" "}
            <strong>Kopyalandı</strong> olur, sonra təxminən 2 saniyəyə geri qayıdır. Kod artıq panoda
            (clipboard) saxlanılıb.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Kopyaladığınız kodu saytınızın istənilən səhifəsində <code>&lt;/body&gt;</code> etiketindən
            əvvəl yapışdırın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kartın altındakı ipucu məhz bunu xatırladır: «Kodu çatın göstəriləcəyi hər səhifədə{" "}
            &lt;/body&gt; etiketindən əvvəl yerləşdirin». Sayt yenidən yüklənəndə çat düyməsi seçdiyiniz
            küncdə peyda olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: görünüşü tənzimlə">
        <HelpStep n={1}>
          <p>
            <strong>Görünüş</strong> kartında <HelpKey>Başlıq</HelpKey> sahəsinə çat pəncərəsinin adını
            yazın və <HelpKey>Əsas rəng</HelpKey> sahəsindəki rəng seçicisini basıb brendinizə uyğun
            rəngi seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bölmə iki sütunlu şəbəkədir: solda mətn xanası kimi başlıq, sağda rəng seçici (kiçik rəngli
            kvadrat). Yazdıqca mətn sahədə görünür; rəng seçəndə kvadratın rəngi dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Salamlama mesajı</HelpKey> xanasına ziyarətçiyə ilk göründüyü mətni yazın (iki sətirlik
            sahədir).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Salamlama xanası kartın eni boyu uzanır və iki sətir hündürlüyündədir; yazdığınız mətn olduğu
            kimi əks olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Yerləşmə</HelpKey> açılan siyahısından düymənin ekranda harada görünəcəyini seçin:{" "}
            <strong>Aşağı sağ</strong> və ya <strong>Aşağı sol</strong>. İstəsəniz{" "}
            <HelpKey>Oflayn mesajı</HelpKey> xanasını da doldurun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yerləşmə siyahısında yalnız iki seçim var. Oflayn mesajı xanası boşdursa içində «Hazırda
            oflaynıq — mesaj buraxın» nümunə mətni (placeholder) görünür — bu, yazılana qədər saxlanmır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: davranışı və iş saatlarını qur">
        <HelpStep n={1}>
          <p>
            <strong>Davranış</strong> kartındakı qeyd qutularını lazımına görə işarələyin:{" "}
            <HelpKey>Da Vinci (AI) avtomatik cavabı</HelpKey>,{" "}
            <HelpKey>Ziyarətçi e-poçt buraxdıqda bilet yarat</HelpKey> və{" "}
            <HelpKey>Üzən başlatma düyməsini göstər</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Üç sıra qeyd qutusu yuxarıdan-aşağı düzülür; hər birinin yanında izah mətni var. İşarələyəndə
            qutuda «✓» görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>İş saatları</strong> kartının başlığının sağındakı <HelpKey>Aktiv</HelpKey> qeyd
            qutusunu işarələyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qutu işarələnəndə altda həftənin yeddi günü (B.e, Ç.a, Çər, C.a, Cüm, Şn, Bz) üçün sətirlər
            açılır. İşarə götürülsə bu cədvəl yenidən gizlənir və başlıq altındakı ipucu görünməyə davam
            edir: «Söndürülübsə vidcet həmişə onlayndır…».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Hər gün üçün <HelpKey>Açıq</HelpKey> qutusunu işarələyin və göründükdə başlanğıc/bitiş vaxtını
            seçin. İstəyə bağlı olaraq aşağıda <HelpKey>Saat qurşağı</HelpKey> xanasını doldurun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Açıq» işarələnən gündə iki vaxt seçicisi (başlanğıc — bitiş, standart 09:00 — 18:00) peyda
            olur; işarə götürülsə həmin gün bağlı sayılır və vaxt sahələri yox olur. Saat qurşağı xanasında
            «Europe/Warsaw» nümunə mətni görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: icazəli mənbələr və yadda saxlama">
        <HelpStep n={1}>
          <p>
            <strong>İcazəli mənbələr</strong> kartındakı mətn sahəsinə vidcetə icazə verdiyiniz sayt
            ünvanlarını <strong>sətir başına bir dənə</strong> tam URL kimi yazın (məs.{" "}
            <HelpKey>https://example.com</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mətn sahəsi monospace (bərabər enli) şriftdə dörd sətirlikdir; boşdursa içində iki nümunə
            ünvan placeholder kimi görünür. Üstündəki ipucu: «Sətir başına bir dənə. Hər mənbəyə icazə
            vermək üçün boş buraxın (istehsal üçün tövsiyə olunmur)».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Səhifənin ən altındakı <HelpKey>Dəyişiklikləri yadda saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə müddətincə <strong>Yadda saxlanılır…</strong> yazısına keçir və qeyri-aktiv olur. Mənbə
            sətirləri normallaşdırılır (yalnız sxem + host saxlanır, təkrarlar atılır). Yanlış URL varsa
            yadda saxlanmır və mətn sahəsinin altında qırmızı «Yanlış mənbə: … Tam URL istifadə edin,
            məsələn https://example.com» xəbərdarlığı çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: ictimai açarı yenilə (təhlükəsizlik)">
        <HelpStep n={1}>
          <p>
            Açarın açıqlandığını ehtimal edirsinizsə, <strong>Əlavə etmə kodu</strong> kartında{" "}
            <HelpKey>Açarı yenilə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Brauzerin təsdiq pəncərəsi çıxır: «İctimai açarı yeniləmək? Mövcud quraşdırmalar işləməyi
            dayandıracaq.» Təsdiqlədikdən sonra kod sətrindəki açar (data-key) yenisi ilə əvəz olunur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <strong>Da Vinci (AI) avtomatik cavabı</strong> ilə <strong>İş saatları</strong> birlikdə
          işləyir: iş saatları aktivdirsə, saatlar xaricində AI cavabı dayanır və ziyarətçiyə{" "}
          <strong>Oflayn mesajı</strong> göstərilir. Buna görə oflayn mesajını mənalı bir mətnlə doldurun.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <HelpKey>Açarı yenilə</HelpKey> geri qaytarılmır: saytlarınızdakı köhnə kod (köhnə data-key ilə)
          dərhal işləməyi dayandırır. Açarı yenilədikdən sonra yeni əlavə etmə kodunu kopyalayıb saytlarınızda
          dəyişdirməyi unutmayın. İcazəli mənbələri boş buraxmaq isə vidceti istənilən saytda işlədir —
          istehsal üçün tövsiyə olunmur.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün vidcet konfiqurasiyası təşkilatınızla məhdudlaşır — ayarlar yüklənərkən və yadda
          saxlanarkən sorğu sizin təşkilat kimliyinizi (<code>x-organization-id</code>) daşıyır. İcazəli
          mənbələr siyahısı çatın yalnız sizin etibar etdiyiniz saytlarda yüklənməsini təmin edən əsas
          təhlükəsizlik nəzarətidir; istehsalda onu doldurun.
        </p>
      </HelpCallout>
    </div>
  )
}
