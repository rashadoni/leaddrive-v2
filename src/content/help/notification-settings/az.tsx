"use client"

/**
 * Notification Preferences — help article (Azerbaijani).
 * Tənzimləmələr → Bildiriş tənzimləmələri səhifəsini əhatə edir:
 * modul (bölmə) qrupları üzrə brauzer/tətbiq-içi açılır bildirişlərinin
 * idarəsi, hər qrupun açılıb ayrı-ayrı bildiriş növlərinin söndürülməsi,
 * giriş icazəsi olmayan bölmələrin sönük göstərilməsi. Dəyişikliklər
 * dərhal (optimistik) tətbiq olunur və avtomatik yadda saxlanılır —
 * ayrıca «Yadda saxla» düyməsi YOXDUR.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function notificationsettingsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="CRM istifadəçisisiniz və hansı hadisələrin sizə açılır bildiriş göstərəcəyini özünüz tənzimləmək istəyirsiniz"
        goal="Modullar üzrə brauzer və tətbiq-içi açılır bildirişlərini aç/söndür və lazımsız bildiriş səs-küyünü azalt"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Bildiriş tənzimləmələri</HelpKey> yolu ilə
        çatırsınız. Bu tənzimləmələr <strong>yalnız sizin hesabınıza</strong> aiddir — başqa
        istifadəçilərin bildirişlərinə təsir etmir. Burada dəyişiklik etdiyiniz hər açar dərhal yadda
        saxlanılır; ayrıca «Yadda saxla» düyməsi yoxdur.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda zəng ikonası ilə <HelpKey>Bildiriş tənzimləmələri</HelpKey> adı, altında «Hər modul
          üçün brauzer və tətbiq içi bildiriş açılır-bağlanırlarını idarə edin…» izahı və kursiv yazılmış
          xatırlatma durur: <em>bildiriş siyahısı həmişə görünür — bu düymələr yalnız aktiv açılır
          bildirişləri idarə edir</em>. Altda modul qruplarının kart-siyahısı gəlir: <strong>CRM</strong>,{" "}
          <strong>Satış</strong>, <strong>Müqavilə nəzarəti</strong>, <strong>Dəstək</strong>,{" "}
          <strong>Marketinq</strong>, <strong>Maliyyə</strong>, <strong>Analitika</strong>,{" "}
          <strong>Kommunikasiya</strong> və təşkilatınızda aktiv olan digər modullar (məs. Marşrut və
          Sahə, sənaye buludları).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Modul qrupu (bölmə)">
            Bir kart = bir modul (məs. CRM, Satış, Dəstək). Kartın adı və qısa təsviri o modulun hansı
            hadisələri əhatə etdiyini göstərir (məs. CRM üçün «Tapşırıqlar, sövdələşmələr, lidlər,
            kontaktlar, şirkətlər»).
          </HelpDef>
          <HelpDef term="Brauzer və tətbiq bildirişləri">
            Kartın sağındakı əsas açar. Bütün bu modul üçün açılır (popup) bildirişləri bir dəfəyə
            aç/söndürür.
          </HelpDef>
          <HelpDef term="Bildiriş növü">
            Qrupu açanda görünən tək-tək hadisələr (məs. «Tapşırıq yaradıldı», «Sövdələşmə qazanıldı»).
            Hər birinin öz kiçik açarı var ki, qrupu büsbütün söndürmədən yalnız bəzi növləri kəsə
            biləsiniz.
          </HelpDef>
          <HelpDef term="Bu bölməyə giriş icazəniz yoxdur">
            Giriş icazəniz olmayan modul kartının yanında çıxan boz nişan; belə kart sönük görünür və
            açarları bağlıdır.
          </HelpDef>
        </dl>
        <p>
          Hər kartda sol tərəfdə (əgər modulun tək-tək növləri varsa) açma üçbucağı/oxu, ortada modulun
          adı və təsviri, onun altında «Brauzer və tətbiq bildirişləri» yazısı, sağda isə həmin modulun
          əsas açarı olur. Giriş icazəniz olmayan modul kartı yarı-şəffaf (sönük) göstərilir, yanında
          xəbərdarlıq ikonalı «Bu bölməyə giriş icazəniz yoxdur» nişanı çıxır və bütün açarları işləmir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: bütöv bir modulun bildirişlərini aç/söndür">
        <HelpStep n={1}>
          <p>
            Tənzimləmək istədiyiniz modulun kartını tapın (məs. <HelpKey>Satış</HelpKey> və ya{" "}
            <HelpKey>Dəstək</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kartda modulun adı, altında qısa təsviri (məs. Dəstək üçün «Biletlər və şərhlər») və «Brauzer
            və tətbiq bildirişləri» yazısı görünür. Sağ tərəfdə həmin modulun əsas açarı durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Kartın sağındakı əsas açarı basıb açıq və ya bağlı vəziyyətə gətirin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açar dərhal yeni vəziyyətə keçir (optimistik) — gözləmə yoxdur. Dəyişiklik arxa planda
            avtomatik yadda saxlanılır. Saxlama alınmasa, açar əvvəlki vəziyyətinə qayıdır və aşağıda
            «Yadda saxlamaq alınmadı — yenidən cəhd edin» bildirişi (toast) çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: yalnız ayrı-ayrı bildiriş növlərini tənzimlə">
        <HelpStep n={1}>
          <p>
            Modul kartının solundakı açma oxuna (üçbucağa) basaraq qrupu genişləndirin. (Yalnız tək-tək
            bildiriş növləri olan modullarda bu ox görünür.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ox aşağı baxan vəziyyətə keçir və kartın altında, sol kənarda nazik xətt ilə girintili
            şəkildə, o modulun bütün bildiriş növləri sadalanır — hər birinin yanında öz kiçik açarı
            (məs. CRM-də «Tapşırıq yaradıldı», «Sövdələşmə qazanıldı», «Lid çevrildi»).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Söndürmək (və ya açmaq) istədiyiniz konkret növün yanındakı kiçik açarı basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yalnız həmin növ dəyişir — qrupun digər növləri və əsas açarı toxunulmaz qalır. Dəyişiklik
            dərhal görünür və avtomatik saxlanılır; xəta olsa, açar geri qayıdır və «Yadda saxlamaq
            alınmadı» bildirişi çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Siyahını yığışdırmaq üçün eyni oxu (artıq aşağı baxan) yenidən basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tək-tək növlər gizlənir, ox yenidən sağa baxan vəziyyətə qayıdır və kart kompakt görünüşə
            qayıdır. Etdiyiniz dəyişikliklər qalır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Açılır bildirişlər çox olub diqqətinizi yayındırırsa, bütöv modulu söndürmək əvəzinə əvvəlcə
          onu genişləndirib yalnız az vacib növləri (məs. «Tapşırıq yaradıldı») kəsin — beləcə «Sövdələşmə
          qazanıldı» kimi vacib hadisələr açıq qalar.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu açarlar yalnız <strong>açılır (popup) bildirişləri</strong> idarə edir. Zəng ikonasının
          altındakı <strong>bildiriş siyahısı həmişə görünür</strong> — burada nəyi söndürsəniz də,
          hadisələr həmin siyahıda yenə qeydə alınır, sadəcə ekranda popup kimi çıxmır. Həmçinin ayrıca
          «Yadda saxla» düyməsi yoxdur: hər açar basışı dərhal effekt verir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bu tənzimləmələr <strong>yalnız sizin istifadəçi hesabınıza</strong> bağlıdır və başqalarının
          bildirişlərini dəyişmir. Sönük (yarı-şəffaf) kart və «Bu bölməyə giriş icazəniz yoxdur» nişanı
          o deməkdir ki, həmin modula rolunuz çatmır — bu kartın açarları bağlıdır və onları
          dəyişə bilməzsiniz.
        </p>
      </HelpCallout>
    </div>
  )
}
