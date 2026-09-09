"use client"

/**
 * Inbox (Omni-Channel) — kömək məqaləsi (Azərbaycan).
 * Video-dərslik ssenarisi formatında. Real 4-zonalı ekrana (qovluq paneli ·
 * söhbət siyahısı · mesaj yazışması · müştəri konteksti) əsaslanır
 * (src/app/(dashboard)/inbox/page.tsx, inboxV2 tərcümə açarları).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InboxHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dəstək və ya satış agentisiniz, müştəri yazışmalarını idarə edirsiniz"
        goal="Bütün kanallardan (E-poçt, Telegram, WhatsApp, SMS, sosial) gələn söhbətləri bir ekranda görmək, cavablamaq, təyin etmək, bağlamaq və komanda ilə daxili müzakirə etmək"
      >
        Səhifəyə yan menyudan <HelpKey>Gələnlər</HelpKey> ilə çatırsınız. Ekran dörd
        şaquli zonaya bölünür: solda <strong>qovluq paneli</strong>, yanında
        <strong> söhbət siyahısı</strong>, ortada <strong>mesaj yazışması</strong>, sağda isə
        (geniş ekranda) <strong>müştəri konteksti</strong>. Bütün söhbətlər yalnız sizin
        təşkilatınızındır; mesajlar real vaxtda gəlir, ona görə yeni mesaj heç bir səhifə
        yeniləmədən siyahıda peyda olur.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Birinci zona — <strong>qovluq paneli</strong> — başında <HelpKey>Gələnlər</HelpKey> adı, altında
          isə üç qrup var: <strong>baxış filtrləri</strong> (Hamısı, Mənim, Təyin edilməyib, Digər
          agentlər, Çatbot, Mənimlə, Spam — Spam «soon» nişanı ilə hələ qeyri-aktivdir),
          <strong> Kanallar</strong> siyahısı (yanında say) və <strong>Qovluqlar</strong> (komanda üçün
          ümumi; altında «Yeni qovluq…» sahəsi).
        </p>
        <p>
          İkinci zona — <strong>söhbət siyahısı</strong>: yuxarıda axtarış, altında üç status tabı
          (<strong>Açıq</strong>, <strong>Bağlı</strong>, <strong>Təxirə salınmış</strong>) və sağ küncdə
          canlılıq göstəricisi (<strong>Canlı</strong> / <strong>Sorğu</strong>). Hər sətirdə kontaktın
          avatarı, adı, son mesajın önizləməsi və vaxtı, kanal nişanları və oxunmamış mesaj sayğacı olur.
        </p>
        <p>
          Üçüncü zona — <strong>mesaj yazışması</strong>: yuxarıda kontakt başlığı və əməliyyat düymələri
          (təyinat, iştirakçılar, bağla/yenidən aç, təxirə sal, qovluğa köçür), ortada mesaj balonları
          (daxili qeydlər vaxt sırası ilə araya hörülür), aşağıda isə <strong>tərtibatçı</strong>
          («Cavab» və «Komanda» tabları). Dördüncü zona — <strong>müştəri konteksti</strong>: təfərrüatlar,
          kanallar, teqlər, qeydlər və qoşmalar.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Söhbət">Bir kontaktın bütün kanallar üzrə yazışması — bir sətir, açılanda tam tarixçə.</HelpDef>
          <HelpDef term="Baxış filtri">Söhbətləri sahibinə görə süzür: Mənim, Təyin edilməyib, Digər agentlər, Çatbot, Mənimlə (iştirakçı olduqlarım).</HelpDef>
          <HelpDef term="Kanal">Mesajın gəldiyi yer — E-poçt, Telegram, WhatsApp, SMS, sosial. Panel hər kanalın yanında sayını göstərir.</HelpDef>
          <HelpDef term="Qovluq">Komanda üçün ümumi qovluq; söhbətləri ora yığa və ona görə süzə bilərsiniz.</HelpDef>
          <HelpDef term="Status tabı">Açıq / Bağlı / Təxirə salınmış — söhbətin iş vəziyyəti.</HelpDef>
          <HelpDef term="Cavab">Müştəriyə gedən mesaj. «Komanda» isə yalnız daxili qeyddir — müştəri görmür.</HelpDef>
          <HelpDef term="İştirakçı">Söhbətə əlavə edilmiş daxili həmkar (yalnız komanda görür, müştəri yox).</HelpDef>
        </dl>
        <p>
          Status göstəricisinə diqqət edin: yaşıl nöqtə + <strong>Canlı</strong> o deməkdir ki, mesajlar
          real vaxtda axır; boz nöqtə + <strong>Sorğu</strong> isə axın oflayndır və siyahı hər 15
          saniyədə yenilənir. Bəzi əməliyyatlar (təyinat, status, təxirə salma, qovluq) yalnız
          sosial-kanal söhbətlərinə aiddir — belə söhbət üçün düymə qeyri-aktiv (boz) görünür.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: söhbəti tap və oxu">
        <HelpStep n={1}>
          <p>
            Sol paneldən bir <strong>baxış filtri</strong> seçin (məs. <HelpKey>Mənim</HelpKey> və ya{" "}
            <HelpKey>Təyin edilməyib</HelpKey>). İstəsəniz altdakı <strong>Kanallar</strong> siyahısından
            bir kanala (məs. <HelpKey>WhatsApp</HelpKey>) klikləyib yalnız onu görün.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş filtr vurğulanır, yanındakı say aktiv tabdakı söhbətlərin sayını göstərir. Kanala
            klikləyəndə siyahı yalnız o kanalı saxlayır; eyni kanala bir də klikləsəniz filtr götürülür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Söhbət siyahısının üstündəki <strong>status tablarından</strong> birini seçin:{" "}
            <HelpKey>Açıq</HelpKey>, <HelpKey>Bağlı</HelpKey> və ya <HelpKey>Təxirə salınmış</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər tabın yanında o tabdakı söhbət sayı durur. Tab boşdursa, ortada «No &lt;status&gt;
            conversations» yazısı və solğun gələnlər ikonası görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Yuxarıdakı <HelpKey>Söhbətləri axtar</HelpKey> sahəsinə kontakt adı, e-poçt və ya mesaj mətni
            yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahı yazdıqca süzülür — ad, son mesaj və ya e-poçtla uyğun gələn söhbətlər qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>Söhbətin sətrinə klikləyin.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ortadakı zonada tam yazışma açılır — hər mesaj balon kimi (gələn solda, gedən sağda), altında
            kanal nişanı və vaxt, gedən mesajlarda isə çatdırılma nişanı (✓✓ çatdırıldı, ⏳ göndərilir, ✕
            çatdırılmadı). Oxuduğunuz an söhbətin oxunmamış sayğacı sıfırlanır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: müştəriyə cavab ver">
        <HelpStep n={1}>
          <p>
            Söhbəti açın və aşağıda tərtibatçıda <HelpKey>Cavab</HelpKey> tabının seçili olduğuna əmin
            olun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mesaj sahəsinin üstündə boz <strong>↗ Müştəriyə gedir</strong> nişanı görünür — bu, mesajın
            müştəriyə gedəcəyini bildirir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Soldakı açılan siyahıdan göndəriləcək <strong>kanalı</strong> seçin (E-poçt, SMS, Telegram,
            WhatsApp və s.), sonra mesajınızı yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kanal seçicisi yalnız «Cavab» tabında görünür. Yanındakı düymələrlə emoji və — şablonunuz
            varsa — sürətli cavab (Zap ikonası) əlavə edə bilərsiniz; şablon yoxdursa, düymə qeyri-aktivdir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Enter</HelpKey> basın və ya sağdakı göndər düyməsini (kağız təyyarə ikonası) klikləyin.
            WhatsApp və Telegram seçəndə qoşma (sancaq ikonası) ilə fayl da əlavə edə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Göndərmə zamanı düymədə fırlanan ikon görünür, sonra cavab sağ tərəfdə yeni balon kimi
            yazışmaya düşür. Qoşma düyməsi yalnız WhatsApp və Telegram-da aktivdir — başqa kanalda boz olur.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Müştərinin yazdığı kanaldan cavab verin. WhatsApp-da kontakt son 24 saatda yazmayıbsa, sərbəst
            mesaj getmir — ekranda «Sərbəst WhatsApp mesajı göndərmək olmur — kontakt son 24 saatda
            yazmayıb…» xəbərdarlığı çıxır. Digər göndərmə xətaları da qırmızı zolaqda səbəbi ilə göstərilir,
            mesaj səssizcə itmir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: təyin et, bağla, təxirə sal və qovluğa köçür">
        <HelpStep n={1}>
          <p>
            Yazışmanın başlığındakı təyinat düyməsini (insan ikonası) basıb söhbəti bir agentə{" "}
            <HelpKey>Təyin et</HelpKey> və ya <HelpKey>Təyini ləğv et</HelpKey> seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Agentlər siyahısı açılır; birini seçəndə söhbət təyin olunur və adətən cari baxışdan çıxdığı
            üçün seçim götürülür. Düymə qeyri-aktivdirsə, bu söhbət hələ sosial-kanal söhbəti deyil («Təyinat
            sosial-kanal söhbətlərinə aiddir» ipucusu çıxır).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Söhbəti bitirdikdə işarə düyməsi (✓) ilə <HelpKey>Söhbəti bağla</HelpKey>. Bağlı söhbətdə həmin
            düymə <HelpKey>Yenidən aç</HelpKey> (geri-dönüş ikonası) olur.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bağladıqdan sonra söhbət <strong>Açıq</strong> tabından çıxıb <strong>Bağlı</strong> taba keçir
            və siyahıdan seçim götürülür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Söhbəti müvəqqəti gizlətmək üçün saat ikonalı <HelpKey>Təxirə sal</HelpKey> düyməsini basın və
            müddəti seçin: <HelpKey>1 saat</HelpKey>, <HelpKey>3 saat</HelpKey> və ya <HelpKey>Sabah</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Söhbət <strong>Təxirə salınmış</strong> taba keçir. Təxirə salınmış söhbətdə saat ikonası
            sarı olur — onu basıb <HelpKey>Oyat (təxiri ləğv et)</HelpKey> ilə geri qaytara bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Söhbəti qovluğa yerləşdirmək üçün qovluq ikonasını basıb mövcud qovluqlardan birini (və ya
            «No folder») seçin. Əvvəlcə sol panelin altındakı <HelpKey>Yeni qovluq…</HelpKey> sahəsindən
            qovluq yaratmaq lazımdır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qovluq yoxdursa, düymə qeyri-aktiv olur və «Əvvəlcə qovluq yaradın» ipucusu çıxır. Yerləşdirmədən
            sonra söhbət seçilmiş qovluğa keçir; sol paneldə həmin qovluğa klikləyib yalnız onun söhbətlərini
            görə bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: komanda ilə işlə (daxili qeydlər və iştirakçılar)">
        <HelpStep n={1}>
          <p>
            Tərtibatçıda <HelpKey>Cavab</HelpKey> əvəzinə <HelpKey>Komanda</HelpKey> tabına keçin və daxili
            qeydinizi yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahə sarımtıl rəng alır və üstündə <strong>🔒 Daxili — müştəri bunu GÖRMÜR</strong> nişanı
            görünür. Qeyd yazışmaya sarı balon kimi (kilid + müəllif adı ilə) düşür və sağ paneldəki
            «Qeydlər» bölməsinə də əlavə olunur. Müştəri bu qeydi heç vaxt görmür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Komanda tabında həmkarınızı çağırmaq üçün <HelpKey>@</HelpKey> yazın və adından bir neçə hərf
            əlavə edin, sonra siyahıdan seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            @-dən sonra uyğun gələn həmkarların açılan siyahısı çıxır; birini seçəndə adı qeydə düşür və o
            bildiriş alır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Başlıqdakı iştirakçı düyməsini (insan+ ikonası) basıb həmkarınızı söhbətə <strong>iştirakçı</strong>
            kimi əlavə edin (yenidən basanda çıxarılır).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahıda agentlər görünür; əlavə olunmuş hər kəsin yanında işarə (✓) durur. İştirakçı
            əlavə olunan söhbət onların <strong>Mənimlə</strong> baxışında görünür, siyahıda isə{" "}
            <strong>Siz iştirakçısınız</strong> nişanı çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: müştəri kontekstini istifadə et">
        <HelpStep n={1}>
          <p>
            Geniş ekranda sağ panelə baxın: kontaktın avatarı, adı və — CRM-ə bağlıdırsa —{" "}
            <HelpKey>CRM kontaktına bax →</HelpKey> keçidi, altında <strong>Təfərrüatlar</strong> (e-poçt,
            telefon, mesaj sayı, son/ilk görünüş) və <strong>Kanallar</strong> bölmələri.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Söhbət seçilməyibsə, panel boş olur və «Söhbəti açdığınız zaman müştəri məlumatları burada
            görünəcək» yazısı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Teqlər</strong> bölməsində aşağıdakı sahəyə teq yazıb <HelpKey>Enter</HelpKey> basın;
            silmək üçün teqdəki × ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Teqlər CRM kontaktına tətbiq olunur (altda «Teqlər CRM kontaktına tətbiq olunur» qeydi var).
            Söhbət hələ kontakta bağlı deyilsə, «Teq əlavə etmək üçün bu söhbəti CRM kontaktına bağlayın»
            yazısı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Qoşmalar</strong> bölməsi söhbətdəki bütün şəkil və faylları bir yerə yığır — açmaq
            üçün üzərinə klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Şəkillər kiçik önizləmə kimi, digər fayllar sancaq ikonası ilə sadalanır; heç nə yoxdursa
            «Qoşma yoxdur» yazısı görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Eyni kontaktın müxtəlif kanallardan mesajları <strong>bir söhbətə</strong> birləşir — keçən həftə
          WhatsApp-da, bu gün e-poçtda yazan müştəri bir sətir kimi görünür, bütün tarixçə bir yerdə. Ayrıca
          ticket yoxdur: yazışmanın özü qeyddir. Zaman üzrə həcm dinamikası lazımdırsa, menyudan ayrıca
          gələnlər analitikası ekranını açın.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          «Cavab» ilə «Komanda» tablarını qarışdırmayın. <strong>Cavab</strong> mesajı müştəriyə gedir
          (boz «↗ Müştəriyə gedir» nişanı), <strong>Komanda</strong> isə yalnız daxili qeyddir (sarı «🔒
          Daxili» nişanı). Göndərməzdən əvvəl tərtibatçının üstündəki rəngli nişana baxın ki, daxili qeyd
          səhvən müştəriyə getməsin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün söhbətlər, qovluqlar və iştirakçılar təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın
          söhbətlərini görür və yalnız öz istifadəçilərinizi agent, iştirakçı və ya @-çağırış kimi əlavə
          edə bilərsiniz. Daxili qeydlər və @-çağırışlar müştəriyə heç vaxt göstərilmir.
        </p>
      </HelpCallout>
    </div>
  )
}
