"use client"

/**
 * Task detail (/tasks/[id]) — help article (Azerbaijani).
 * Tək bir tapşırığın detal səhifəsini əhatə edir: başlıq + status/prioritet
 * nişanları, üst əməliyyat düymələri (Redaktə / Sil / Təqvimə), status xətti
 * (pipeline), kompakt statistika zolağı, Təsvir / Çek-list / Qoşmalar / Şərhlər
 * sütunu və sağdakı «Məlumat» kartı (İcraçı, İştirakçılar, Prioritet, Tip,
 * Event tipi, Əlaqəli obyekt, Layihə) + təkrarlanan tapşırıqlar üçün Seriya
 * paneli. Eyni görünüş lövhə (board) modalının içində də açılır.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function TaskDetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Komanda üzvü və ya menecersiniz"
        goal="Bir tapşırığı açıb üzərində işləmək — statusu dəyişmək, icraçı təyin etmək, çek-list və şərh əlavə etmək, fayl qoşmaq"
      >
        Bu səhifəyə tapşırıqlar siyahısından və ya lövhədən hər hansı tapşırığa
        klikləməklə (ünvan <HelpKey>/tasks/&lt;id&gt;</HelpKey>) çatırsınız. Eyni
        görünüş lövhədə tapşırığa kliklədikdə modal pəncərə kimi də açılır.
        Səhifədə gördüyünüz hər şey — status, icraçı, çek-list, şərhlər — yalnız
        sizin təşkilatınıza aiddir və real vaxtda saxlanılır: dəyişiklik etdikcə
        yenidən yüklənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda tapşırıqlar siyahısına qaytaran «cığır» (breadcrumb), altında
          tapşırığın <strong>başlığı</strong> və onun yanında status nişanı
          (məs. <HelpKey>İcrada</HelpKey>), prioritet nişanı (məs.{" "}
          <HelpKey>Yüksək</HelpKey>), əgər varsa əlaqəli obyekt və təkrar
          nişanları. Sağ tərəfdə <HelpKey>Redaktə et</HelpKey> və qırmızı{" "}
          <HelpKey>Sil</HelpKey> düymələri durur; tapşırığın son tarixi varsa,
          yanında <HelpKey>Təqvimə</HelpKey> (Google Calendar sinxronizasiyası)
          düyməsi də görünür.
        </p>
        <p>
          Başlığın altında kompakt statistika zolağı var: açıq günlərin sayı,
          son tarixə qalan vaxt (vaxt keçibsə qırmızı «gecikib»), çek-list
          gedişatı, şərh və qoşma sayları, sağda isə icraçının adı. Onun altında
          basıla bilən <strong>status xətti</strong> (pipeline) gəlir. Səhifə iki
          sütuna bölünür: solda <strong>Təsvir</strong>, <strong>Çek-list</strong>,{" "}
          <strong>Qoşmalar</strong> və <strong>Şərhlər</strong>; sağda{" "}
          <strong>Məlumat</strong> kartı və (varsa) <strong>Seriya</strong> /{" "}
          <strong>Əlavə sahələr</strong> kartları.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status xətti (pipeline)">Mərhələlər üfüqi zolaq kimi düzülür; cari mərhələ rəngli işıqlanır. Başqa mərhələyə basaraq statusu birbaşa dəyişə bilərsiniz.</HelpDef>
          <HelpDef term="Statistika zolağı">Açıq günlər, son tarix geri sayımı, çek-list gedişatı, şərh və qoşma sayları, icraçı — heç birinə sürüşdürmədən baxmaq üçün tək sətir.</HelpDef>
          <HelpDef term="Çek-list">Tapşırığın alt-addımları; hər bənd işarələnə bilər, başlıqda gedişat faizi göstərilir.</HelpDef>
          <HelpDef term="Şərhlər">Komanda yazışması; sistem qeydləri də burada solğun görünür.</HelpDef>
          <HelpDef term="Qoşmalar">Tapşırığa yüklənmiş fayllar (maks. 10 MB hər biri).</HelpDef>
          <HelpDef term="Məlumat kartı">İcraçı, İştirakçılar, Prioritet, Tip, Event tipi, Əlaqəli obyekt, Layihə və yaradılma/yenilənmə tarixləri — çoxu birbaşa burada redaktə olunur.</HelpDef>
          <HelpDef term="Seriya">Yalnız təkrarlanan tapşırıqlarda görünür; seriyanın bütün təkrarlarını sadalayır və «Seriyanı dayandır» düyməsi verir.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: statusu dəyiş">
        <HelpStep n={1}>
          <p>
            Statistika zolağının altındakı <strong>status xəttində</strong> keçmək
            istədiyiniz mərhələnin üstünə basın (məs. <HelpKey>İcrada</HelpKey>{" "}
            və ya <HelpKey>Tamamlandı</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Basdığınız mərhələ rəngli (dolu) işıqlanır, ondan əvvəlkilər
            «keçilmiş» kimi solğunlaşır. Başdakı status nişanı da yeni statusa
            uyğun dəyişir. Tapşırığı <HelpKey>Tamamlandı</HelpKey> etsəniz,
            Məlumat kartında yaşıl «Tamamlandı» tarixi peyda olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Status saxlanılarkən xətt qısa müddət qeyri-aktiv olur — yenidən
            basmadan gözləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxlama bitdikdə səhifə yenilənir və statistika zolağındakı son
            tarix göstəricisi də uyğunlaşır (tamamlanmış tapşırıqda qırmızı
            «gecikib» xəbərdarlığı boz adi tarixə çevrilir).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: icraçı, prioritet və digər sahələri dəyiş">
        <HelpStep n={1}>
          <p>
            Sağdakı <HelpKey>Məlumat</HelpKey> kartında <strong>İcraçı</strong>{" "}
            sətrinə basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yuxarıda axtarış sahəsi olan istifadəçi siyahısı açılır. Ən üstdə{" "}
            <HelpKey>Təyin edilməyib</HelpKey> sətri durur; ad yazaraq siyahını
            süzgəcdən keçirə bilərsiniz. Bir istifadəçi seçdikdə siyahı bağlanır
            və həmin ad icraçı kimi görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>İştirakçılar</strong> sətrinə basaraq əlavə komanda üzvlərini
            qeyd qutuları ilə işarələyin (icraçı bu siyahıda görünmür — bir adam
            eyni anda həm icraçı, həm iştirakçı ola bilməz).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Çoxseçimli siyahı açıq qalır; hər toggle saxlanarkən kiçik fırlanan
            işarə görünür və seçilmiş adlar sətirdə yumru nişanlar kimi yığılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Prioritet</strong> nişanına basıb yeni səviyyə seçin (
            <HelpKey>Təcili</HelpKey> / <HelpKey>Yüksək</HelpKey> /{" "}
            <HelpKey>Orta</HelpKey> / <HelpKey>Aşağı</HelpKey>). Eyni üsulla{" "}
            <strong>Tip</strong> və <strong>Event tipi</strong> sahələrini də
            rəngli nöqtəli açılan siyahıdan dəyişə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçim edən kimi nişan/etiket dərhal yenilənir. Event tipini
            təmizləmək üçün açılan siyahının başındakı <HelpKey>—</HelpKey>{" "}
            sətrini seçin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <strong>Əlaqəli obyekt</strong> sətrinə basıb tapşırığı bir
            şirkət, kontakt, sövdələşmə, lead və ya müraciətə (ticket) bağlayın:
            yuxarıdakı tip ikonlarından birini seçin, sonra adla axtarın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Axtardıqca uyğun nəticələr aşağıda sadalanır; birini seçdikdə əlaqə
            saxlanılır. Obyekt həll olunubsa, yanında onun səhifəsinə aparan
            keçid ikonu (kənar keçid) görünür. Bağı silmək üçün siyahının
            başındakı <HelpKey>Sil</HelpKey> sətrini seçin.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Bu inline (yerindəcə) sahələr ANI yadda saxlanır — ayrıca «Saxla»
            düyməsi yoxdur. Adı, son tarixi və ya təkrar qaydasını dəyişmək üçünsə
            yuxarıdakı <HelpKey>Redaktə et</HelpKey> düyməsi ilə tam formanı açın.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: çek-list, qoşma və şərh əlavə et">
        <HelpStep n={1}>
          <p>
            Sol sütundakı <HelpKey>Çek-list</HelpKey> kartında aşağıdakı{" "}
            <HelpKey>Bənd əlavə et...</HelpKey> sahəsinə yazıb <HelpKey>Enter</HelpKey>{" "}
            basın (və ya yanındakı <HelpKey>+</HelpKey> düyməsi ilə əlavə edin).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yeni bənd siyahıya əlavə olunur. Bəndin solundakı qutuya basaraq onu
            tamamlanmış kimi işarələyin — mətnin üstündən xətt çəkilir, başlıqdakı
            «tamamlanan/cəmi» sayı və yaşıl gedişat zolağı yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Qoşmalar</HelpKey> kartında <HelpKey>Fayl əlavə et</HelpKey>{" "}
            düyməsini basıb kompüterinizdən bir sənəd seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yüklənmə zamanı düymədə fırlanan işarə görünür, sonra fayl ad,
            ölçü və tarixlə siyahıda peyda olur. Hər faylın yanında yükləmə
            (endir) ikonu və silmək üçün × ikonu var. Fayl 10 MB-dan böyükdürsə,
            xəbərdarlıq çıxır və yüklənmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Şərhlər</HelpKey> kartında mətn sahəsinə şərhinizi yazın və{" "}
            göndər (təyyarə) düyməsini basın (yaxud <HelpKey>Cmd/Ctrl + Enter</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Şərh aşağıdakı siyahıya, adınızın baş hərfli avatarı və «neçə vaxt
            əvvəl» vaxt damğası ilə düşür. Başlıqdakı şərh sayı bir vahid artır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: redaktə et, təqvimə sinxronlaşdır və ya sil">
        <HelpStep n={1}>
          <p>
            Başlığın əsas sahələrini (ad, təsvir, son tarix, təkrar qaydası və s.)
            dəyişmək üçün yuxarı sağdakı <HelpKey>Redaktə et</HelpKey> düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mövcud dəyərlərlə əvvəlcədən doldurulmuş tapşırıq forması açılır.
            Dəyişiklikləri saxladıqdan sonra səhifə yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Tapşırığın son tarixi varsa, onu Google Calendar-a köçürmək üçün{" "}
            <HelpKey>Təqvimə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sinxronizasiya gedərkən düymə «Sinxr...» yazısına keçir. Uğurlu olsa,
            təsdiq mesajı çıxır; təqvim hələ qoşulmayıbsa, sizi{" "}
            <HelpKey>Tənzimləmələr → İnteqrasiyalar</HelpKey> səhifəsinə
            yönləndirmək təklif olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Tapşırığı silmək üçün qırmızı <HelpKey>Sil</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tapşırığın adını göstərən «Tapşırığı sil» təsdiq pəncərəsi açılır.
            Təsdiqlədikdən sonra tapşırıq silinir və siz tapşırıqlar siyahısına
            qaytarılırsınız (lövhə modalında isə pəncərə bağlanır).
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmə geri qaytarılmır — tapşırıqla birlikdə onun çek-listi,
            qoşmaları və şərhləri də gedir. Tapşırığı arxivləmək əvəzinə sadəcə
            statusunu <HelpKey>Ləğv edildi</HelpKey> etmək çox vaxt daha
            təhlükəsiz seçimdir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Təkrarlanan tapşırıqlar (Seriya)">
        <p>
          Tapşırıq təkrar qaydası ilə yaradılıbsa, başlığında dövr nişanı (məs.
          «hər həftə») və sağ sütunda <HelpKey>Seriya</HelpKey> kartı görünür.
          Əsas (parent) tapşırıqda kart bütün təkrarları status nişanları ilə
          xronoloji sadalayır — istənilən sətrə basıb həmin instansiyaya keçə
          bilərsiniz; cari tapşırıq çərçivə ilə vurğulanır. Bir törəmə (child)
          tapşırıqdasınızsa, kart sizi əsas tapşırığa qaytaran keçid göstərir.
        </p>
        <HelpStep n={1}>
          <p>
            Yeni təkrarların yaranmasını dayandırmaq üçün Seriya kartının
            başındakı <HelpKey>Seriyanı dayandır</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Seriyanı dayandırmaq? Mövcud tapşırıqlar qalacaq, amma yeniləri
            yaranmayacaq.» təsdiqi açılır. Təsdiqlədikdən sonra təsdiq mesajı
            çıxır və artıq yeni təkrar yaranmır; mövcud tapşırıqlar qalır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Səhifədəki çoxlu sahə (status, icraçı, iştirakçılar, prioritet, tip,
          event tipi, əlaqəli obyekt, çek-list) birbaşa yerindəcə redaktə olunur
          — formaya girməyə ehtiyac yoxdur. Tam forma yalnız ad, təsvir, son
          tarix və təkrar qaydası kimi əsas sahələr üçün lazımdır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün tapşırıqlar, şərhlər, qoşmalar və istifadəçi siyahıları
          təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın tapşırıqlarını
          görür və yalnız öz istifadəçilərinizi icraçı/iştirakçı təyin edə
          bilərsiniz. Fayl yükləmə və silmə əməliyyatları server tərəfdə
          icazələrlə (tasks:write / tasks:delete) yoxlanılır.
        </p>
      </HelpCallout>
    </div>
  )
}
