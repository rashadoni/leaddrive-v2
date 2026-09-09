"use client"

/**
 * Knowledge Base — Məqalə detalı — help article (Azerbaijani).
 * Mənbə səhifə: src/app/(dashboard)/knowledge-base/[id]/page.tsx
 * Tək məqalənin baxış səhifəsi: başlıq + status nişanı, dörd statistika
 * kartı (baxış / teqlər / kateqoriya / status), məzmun kartı (zəngin HTML),
 * "Redaktə et" forması və "Sil" təsdiqi. Yalnız bu səhifə əhatə olunur —
 * siyahı/portal hissəsi bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function kbarticledetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dəstək agenti, məzmun redaktoru və ya administratorsunuz"
        goal="Konkret bilik bazası məqaləsini açıb oxumaq, məzmununu redaktə etmək, nəşr/qaralama statusunu dəyişmək və ya məqaləni silmək"
      >
        Bu səhifəyə <HelpKey>Bilik bazası</HelpKey> siyahısında bir məqaləyə klikləməklə
        çatırsınız (URL <HelpKey>/knowledge-base/&lt;id&gt;</HelpKey>). Səhifə tək bir məqaləni
        göstərir və bütün məlumat sizin təşkilatınıza aiddir. Səhifəni hər açanda məqalə serverdən
        yenidən yüklənir, ona görə redaktədən sonra dəyişikliklər dərhal əks olunur.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarı sol küncdə geriyə qaytaran <HelpKey>oxlu düymə</HelpKey> var — onu basanda{" "}
          <HelpKey>Bilik bazası</HelpKey> siyahısına qayıdırsınız. Yanında kitab ikonası, sonra
          böyük hərflərlə <strong>məqalənin başlığı</strong>, başlığın altında isə (varsa)
          kateqoriyanın adı və yanında status nişanı (<strong>Nəşr edildi</strong> və ya{" "}
          <strong>Qaralama</strong>) durur. Sağ yuxarıda iki düymə var:{" "}
          <HelpKey>Redaktə et</HelpKey> (qələm ikonalı) və qırmızı <HelpKey>Sil</HelpKey>{" "}
          (zibil qutusu ikonalı).
        </p>
        <p>
          Başlığın altında dörd statistika kartı sıralanır: <strong>baxış</strong>,{" "}
          <strong>Teqlər</strong>, <strong>Kateqoriya</strong> və <strong>Status</strong>.
          Onların altında <strong>Məzmun</strong> başlıqlı kart gəlir — burada məqalənin əsl
          mətni (formatlanmış HTML kimi) göstərilir; məzmun boşdursa «Məlumat yoxdur» yazılır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="baxış">Məqalənin neçə dəfə açıldığını göstərən sayğac (viewCount).</HelpDef>
          <HelpDef term="Teqlər">Məqaləyə əlavə edilmiş teqlərin sayı (vergüllə ayrılmış sözlər).</HelpDef>
          <HelpDef term="Kateqoriya">Məqalənin aid olduğu kateqoriyanın adı; təyin olunmayıbsa «—» göstərilir.</HelpDef>
          <HelpDef term="Status">Məqalənin <strong>Nəşr edildi</strong> (portal istifadəçiləri görür) və ya <strong>Qaralama</strong> (yalnız komandaya görünür) vəziyyəti.</HelpDef>
          <HelpDef term="Məzmun">Məqalənin əsas mətni — redaktorda yazdığınız formatlanmış HTML; ekrana çıxarılmazdan əvvəl təhlükəsizlik üçün təmizlənir.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: məqaləni oxu və geri qayıt">
        <HelpStep n={1}>
          <p>
            Səhifə açılan kimi yuxarıdakı başlığı və status nişanını yoxlayın — bu məqalənin{" "}
            nəşr edilib-edilmədiyini orada görürsünüz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Məqalə yüklənərkən bir neçə an «pulsasiya edən» boz çərçivə (skeleton) görünür, sonra
            əsl başlıq, kateqoriya və status nişanı yerinə düşür. Məqalə tapılmasa, mərkəzdə
            «Məlumat yoxdur» mesajı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Aşağı sürüşdürüb <strong>Məzmun</strong> kartında məqalənin tam mətnini oxuyun. Statistika
            kartlarından <strong>baxış</strong> sayının da artdığını görə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Məzmun formatlanmış mətn (başlıqlar, siyahılar, qalın hərflər və s.) kimi göstərilir.
            Məzmun boşdursa, kartın içində «Məlumat yoxdur» yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Siyahıya qayıtmaq üçün sol yuxarıdakı <HelpKey>oxlu düymə</HelpKey>ni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Bilik bazası</HelpKey> siyahı səhifəsi açılır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: məqaləni redaktə et və nəşr/qaralama statusunu dəyiş">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Redaktə et</HelpKey> (qələm ikonalı) düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Məqaləni redaktə et» başlıqlı pəncərə açılır və mövcud dəyərlərlə əvvəlcədən doldurulur:{" "}
            <strong>Başlıq *</strong>, <strong>Məzmun *</strong> (çoxsətirli mətn sahəsi),{" "}
            <strong>Kateqoriya</strong> və <strong>Status</strong> açılan siyahıları, bir də{" "}
            <strong>Teqlər</strong> sahəsi.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Lazım olan sahələri dəyişin. <strong>Başlıq</strong> və <strong>Məzmun</strong> məcburidir
            (yanında ulduz var). Teqləri vergüllə ayırın (məs. <HelpKey>tag1, tag2, tag3</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Kateqoriya</strong> açılan siyahısında «Kateqoriyasız» variantı və təşkilatınızın
            kateqoriyaları sıralanır. <strong>Status</strong> açılan siyahısında yalnız iki seçim var:{" "}
            <strong>Qaralama</strong> və <strong>Nəşr edildi</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Status sahəsini <strong>Nəşr edildi</strong> seçməklə məqaləni portal istifadəçilərinə
            açır, <strong>Qaralama</strong> seçməklə yenidən gizlədirsiniz — nəşri/gizlətməni məhz
            burada idarə edirsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz status açılan siyahıda göstərilir; hələ heç nə dəyişmir — dəyişiklik yalnız
            yadda saxladıqdan sonra tətbiq olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Aşağıdakı <HelpKey>Yenilə</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yadda saxlanarkən «Saxlanılır...» yazısına keçir, sonra pəncərə bağlanır və
            səhifə yeni başlıq, status nişanı, statistika kartları və məzmunla yenilənir. Yadda saxlama
            alınmasa, formanın yuxarısında qırmızı xəta mesajı çıxır və pəncərə açıq qalır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Başlıq</strong> və <strong>Məzmun</strong> boş ola bilməz. Bu sahələri boşaldıb
            yadda saxlamağa çalışsanız, brauzer onları doldurmağı tələb edir və forma göndərilmir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: məqaləni sil">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı qırmızı <HelpKey>Sil</HelpKey> (zibil qutusu ikonalı) düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Məqaləni sil» başlıqlı təsdiq pəncərəsi açılır; mətndə bu əməliyyatın geri
            qaytarılmadığı və məqalənin həmişəlik silinəcəyi xəbərdar edilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Silməni təsdiqləmək üçün qırmızı <HelpKey>Sil</HelpKey> düyməsini basın. (Fikrinizi
            dəyişsəniz — <HelpKey>Ləğv et</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Silinir...» yazısına və fırlanan ikona keçir; uğurlu olduqda pəncərə bağlanır və{" "}
            <HelpKey>Bilik bazası</HelpKey> siyahısına qayıdırsınız. Silmə alınmasa, pəncərənin
            içində qırmızı xəta mesajı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmə geri qaytarılmır — məqalə həmişəlik yox olur. Məqaləni müştərilərdən gizlətmək
            kifayətdirsə, silmək yerinə <HelpKey>Redaktə et</HelpKey> ilə statusu{" "}
            <strong>Qaralama</strong>ya keçirin; belə olanda məqalə qalır, sadəcə portalda görünmür.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <strong>baxış</strong> sayğacı məqaləyə real maraqdan xəbər verir — çox baxılan amma hələ{" "}
          <strong>Qaralama</strong>da qalan bir məqalə varsa, onu nəşr etməyə dəyər. Teqlər isə
          siyahıda axtarış və qruplaşdırmanı asanlaşdırır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Məqalə yalnız sizin təşkilatınızdan oxunur (sorğu tenant-ınızın id-si ilə göndərilir),
          başqa təşkilatın məqalələrini görmür və redaktə edə bilmirsiniz. Məzmun ekrana
          çıxarılmazdan əvvəl təhlükəsizlik üçün təmizlənir (zərərli HTML/skript çıxarılır), ona görə
          məqalələrə etibarsız mənbədən mətn yapışdırmaq təhlükəsizdir.
        </p>
      </HelpCallout>
    </div>
  )
}
