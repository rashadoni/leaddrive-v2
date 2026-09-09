"use client"

/**
 * Media Cloud → Kontent İnventarı — help article (Azerbaijani).
 * Əvvəllər ümumi "media" vertikal məqaləsini paylaşırdı; indi öz
 * slug-u var. Yalnız /media/content səhifəsini əhatə edir:
 * kontent kataloqu/siyahısı — statistika kartları, axtarış+status
 * filtri, cədvəl və "Daha çox yüklə". Bu səhifə yalnız oxunaqlıdır
 * (kontent yaratma/redaktə/silmə YOXDUR).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mediacontentHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Media və ya kontent komandasının redaktoru, yaxud əməliyyat administratorusunuz"
        goal="Bütün media materiallarının — məqalə, video, podkast və digərlərinin — vahid siyahısını gözdən keçirmək, status üzrə süzgəcdən keçirmək və axtarmaq"
      >
        Səhifəyə Media Cloud bölməsindəki <HelpKey>Kontent İnventarı</HelpKey> ilə çatırsınız. Bu, yalnız
        oxunaqlı kataloqdur — burada material yaratmaq, redaktə etmək və ya silmək üçün düymə yoxdur;
        məqsəd mövcud kontenti tapmaq və vəziyyətinə baxmaqdır. Bütün materiallar yalnız sizin
        təşkilatınıza aiddir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda bənövşəyi (fuchsia) televizor ikonası, yanında <HelpKey>Kontent İnventarı</HelpKey>{" "}
          adı və altında «Bütün media materialları — məqalələr, videolar, podkastlar və digərləri.»
          izahı var. Altda dörd statistika kartı durur: <strong>Ümumi materiallar</strong>,{" "}
          <strong>Dərc edildi</strong>, <strong>Qaralama</strong> və <strong>Arxivləndi</strong>.
          Sonra süzgəc zolağı (axtarış sahəsi, status seçimi və yenilə düyməsi), onun altında isə
          kontent cədvəli gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi materiallar">Hazırda yüklənmiş materialların sayı (cədvəldə görünən partiya üzrə).</HelpDef>
          <HelpDef term="Dərc edildi">Yüklənmiş materiallardan statusu «Dərc edildi» olanların sayı.</HelpDef>
          <HelpDef term="Qaralama">Yüklənmiş materiallardan statusu «Qaralama» olanların sayı.</HelpDef>
          <HelpDef term="Arxivləndi">Yüklənmiş materiallardan statusu «Arxivləndi» olanların sayı.</HelpDef>
          <HelpDef term="Başlıq">Materialın adı; varsa, altında müəllif (byline) kiçik yazı ilə göstərilir.</HelpDef>
          <HelpDef term="Növ">Materialın tipi — Məqalə, Video, Podkast, Audio, Canlı yayım, Serial epizodu.</HelpDef>
          <HelpDef term="Status">Rəngli nişan: Qaralama, Planlaşdırıldı, Dərc edildi, Geri çəkildi, Arxivləndi.</HelpDef>
          <HelpDef term="Müddət">Video/audio uzunluğu — qısa materiallar saniyə (məs. «45s»), uzunlar dəqiqə (məs. «3m») kimi; yoxdursa «—».</HelpDef>
          <HelpDef term="Söz sayı">Mətn materialları üçün söz sayı; yoxdursa «—».</HelpDef>
          <HelpDef term="Dərc tarixi">Materialın dərc olunduğu tarix; hələ dərc olunmayıbsa «—».</HelpDef>
        </dl>
        <p>
          Cədvəldə altı sütun var: <strong>Başlıq</strong>, <strong>Növ</strong>,{" "}
          <strong>Status</strong>, <strong>Müddət</strong>, <strong>Söz sayı</strong> və{" "}
          <strong>Dərc tarixi</strong>. Başlıq, Növ, Status, Müddət və Dərc tarixi sütunları üzrə
          çeşidləmə (sıralama) mümkündür.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: kontent siyahısına bax">
        <HelpStep n={1}>
          <p>
            Media Cloud bölməsində <HelpKey>Kontent İnventarı</HelpKey> səhifəsini açın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Səhifə açılarkən materiallar yüklənir. Yuxarıdakı dörd statistika kartı yüklənmiş partiyaya
            görə doldurulur, aşağıda isə cədvəl ən son materiallarla dolur. Heç material yoxdursa,
            cədvəl boş görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Cədvəli gözdən keçirin. Hər sətirdə materialın <strong>Başlıq</strong>ı (varsa, altında
            müəllif), <strong>Növ</strong>ü, rəngli <strong>Status</strong> nişanı,{" "}
            <strong>Müddət</strong>i, <strong>Söz sayı</strong> və <strong>Dərc tarixi</strong> göstərilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Status nişanı rəngə görə fərqlənir — məsələn, <strong>Dərc edildi</strong> yaşıl,{" "}
            <strong>Qaralama</strong> boz, <strong>Planlaşdırıldı</strong> mavi,{" "}
            <strong>Geri çəkildi</strong> sarı, <strong>Arxivləndi</strong> qırmızı tonda olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sütun başlığına basaraq siyahını həmin sütun üzrə çeşidləyin (Başlıq, Növ, Status, Müddət
            və ya Dərc tarixi).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sətirlər seçdiyiniz sütuna görə yenidən sıralanır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: axtar və status üzrə süzgəcdən keçir">
        <HelpStep n={1}>
          <p>
            Süzgəc zolağındakı axtarış sahəsinə («Nömrə və ya email ilə axtar…» yer tutucusu olan,
            sol tərəfində lupa ikonası olan sahə) axtarış mətnini yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazmağı dayandırdıqdan qısa müddət sonra (avtomatik) cədvəl yenilənir və yalnız uyğun gələn
            materiallar qalır. Statistika kartları da nəticəyə görə yenidən hesablanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Axtarışın yanındakı status açılan siyahısından bir vəziyyət seçin —{" "}
            <HelpKey>Bütün statuslar</HelpKey>, <HelpKey>Qaralama</HelpKey>,{" "}
            <HelpKey>Planlaşdırıldı</HelpKey>, <HelpKey>Dərc edildi</HelpKey>,{" "}
            <HelpKey>Geri çəkildi</HelpKey> və ya <HelpKey>Arxivləndi</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl dərhal seçilmiş statusa görə süzülür. <HelpKey>Bütün statuslar</HelpKey> süzgəci
            sıfırlayır və hamısını geri qaytarır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Siyahını yeniləmək (server-dən təzə oxumaq) üçün süzgəc zolağının sağındakı yenilə (dairəvi
            ox) ikonalı düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl cari axtarış və status süzgəcləri ilə yenidən yüklənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: daha çox material yüklə">
        <HelpStep n={1}>
          <p>
            Cədvəlin altında <HelpKey>Daha çox yüklə</HelpKey> düyməsi görünürsə, onu basın — bu o
            deməkdir ki, göstəriləndən artıq material var.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Növbəti partiya materiallar mövcud siyahının sonuna əlavə olunur. Yükləmə davam edərkən
            düymə müvəqqəti deaktiv olur. Daha material qalmasa, düymə yox olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Statistika kartları server üzrə bütün materialların deyil, hazırda yüklənmiş partiyanın
          saylarını əks etdirir. Daha dəqiq say üçün əvvəlcə axtarış və ya status süzgəci ilə siyahını
          daraldın — bu zaman kartlar süzülmüş nəticəyə görə hesablanır.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu səhifə yalnız oxunaqlı kataloqdur — material yaratmaq, redaktə etmək, dərc etmək və ya
          silmək üçün burada düymə yoxdur. Səhifə yalnız mövcud kontenti tapıb vəziyyətinə baxmaq
          üçündür.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün kontent təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın materiallarını görürsünüz,
          başqa təşkilatın kontenti bu siyahıda görünmür.
        </p>
      </HelpCallout>
    </div>
  )
}
