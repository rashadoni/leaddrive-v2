"use client"

/**
 * Dashboard Blokları (Tənzimləmələr → Dashboard) — help article (Azerbaijani).
 * "settings-overview" birgə slug-ından ayrılıb: yalnız
 * Tənzimləmələr → Dashboard alt-səhifəsini əhatə edir
 * (dashboard bloklarını söndürmək/yandırmaq, avtomatik saxlama,
 * aktiv/gizli sayğacları). Digər tənzimləmə bölmələri bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function settingsdashboardHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Təşkilat administratoru və ya komanda rəhbərisiniz"
        goal="Ana səhifədəki (dashboard) blokları seçmək — lazımsızları gizlətmək, lazımlıları göstərmək"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Dashboard</HelpKey> yolu ilə çatırsınız.
        Burada blokları söndürüb-yandırırsınız; ayrıca «yadda saxla» düyməsi yoxdur — hər dəyişiklik
        dərhal avtomatik saxlanılır. Konfiqurasiya bütün təşkilatınız üçündür və yalnız sizin
        tenant-ınıza aiddir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Dashboard Blokları</HelpKey> adı, altında «Blokları söndürün/yandırın —
          dəyişikliklər avtomatik saxlanılır» izahı durur. İzahın altında iki kiçik sayğac var: yaşıl
          göz ikonası ilə neçə blokun <strong>aktiv</strong>, boz «göz-bağlı» ikonası ilə neçəsinin{" "}
          <strong>gizli</strong> olduğunu göstərir. Aşağıda blok kartları üç sütunlu şəbəkədə düzülür —
          bu, dashboard-un öz düzülüşü ilə eyni sıradadır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="aktiv sayğacı">Hazırda yandırılmış (dashboard-da görünən) blokların sayı — yanında yaşıl göz ikonası.</HelpDef>
          <HelpDef term="gizli sayğacı">Söndürülmüş blokların sayı — yanında boz «göz-bağlı» ikonası.</HelpDef>
          <HelpDef term="Blok kartı">Hər blok üçün bir kart: rəngli ikona, blokun adı, bir sətirlik təsviri və sağda açar/söndürmə düyməsi (Switch).</HelpDef>
          <HelpDef term="Switch (açar)">Kartın sağındakı sürüşdürmə düyməsi — blok yandırılıbsa sağda (yaşıl), söndürülübsə solda dayanır.</HelpDef>
        </dl>
        <p>
          Kart yandırılmış olanda yaşıl haşiyə və açıq-yaşıl fon, ikona da yaşıl rəngdə olur.
          Söndürülmüş kart isə bozarır və bir az şəffaflaşır (sönük görünür). Şəbəkədə on beş blok var,
          o cümlədən: <strong>Risk Banneri</strong>, <strong>KPI Kartları</strong>,{" "}
          <strong>AI hərəkətlər növbəsi</strong>, <strong>AI dəyəri bu ay</strong>,{" "}
          <strong>Satış boru xətti</strong>, <strong>Gəlir Trendi</strong>, <strong>Lid Mənbələri</strong>,{" "}
          <strong>Son Sövdələşmələr</strong>, <strong>Da Vinci Lid Skorinq</strong>,{" "}
          <strong>Son Fəaliyyət</strong>, <strong>Kampaniyalar</strong>, <strong>Tədbirlər</strong>,{" "}
          <strong>Həftəlik Metriklər</strong>, <strong>Tövsiyə olunan hərəkətlər</strong> və{" "}
          <strong>İtirilmə riski</strong>.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: bir bloku söndür və ya yandır">
        <HelpStep n={1}>
          <p>
            Səhifə açılanda bir anlıq «yüklənir» vəziyyəti (boz, yanıb-sönən boş kartlar) görə bilərsiniz —
            konfiqurasiya gələnə qədər gözləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yüklənmə bitən kimi boş boz kartlar əvəzinə real blok kartları və başlıqdakı{" "}
            <strong>aktiv</strong> / <strong>gizli</strong> sayğacları görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Dəyişmək istədiyiniz bloku tapın (məs. <HelpKey>Gəlir Trendi</HelpKey>). Bütün karta klik edə
            bilərsiniz, ya da yalnız sağdakı açarı (<HelpKey>Switch</HelpKey>) basa bilərsiniz — ikisi də
            eyni nəticəni verir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart yandırma və söndürmə arasında keçir: yandırılanda yaşıl haşiyə/fon və yaşıl ikona alır;
            söndürüləndə bozarıb sönükləşir. Açar müvafiq olaraq sağa və ya sola sürüşür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Heç bir «yadda saxla» düyməsini axtarmayın — dəyişiklik dərhal avtomatik saxlanılır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxlama gedərkən blokun adının yanında kiçik fırlanan dairə (yüklənmə nişanı) qısa müddət
            görünür, sonra itir. Başlıqdakı <strong>aktiv</strong> və <strong>gizli</strong> sayğacları da
            dəyişikliyə uyğun yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Lazım qədər blok üçün addımı təkrarlayın. Dashboard-a qayıtdıqda yalnız aktiv saxladığınız
            bloklar göstəriləcək.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər keçiddən sonra <strong>aktiv</strong> sayı azalıb-artır, <strong>gizli</strong> sayı isə əks
            istiqamətdə dəyişir — ikisinin cəmi həmişə blokların ümumi sayına bərabər qalır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Hər kartın altındakı kiçik təsviri oxuyun — orada blokun dashboard-da nə göstərdiyi yığcam
          izah olunur (məs. «12 aylıq gəlir area qrafiki» və ya «Son 5 sövdələşmə siyahısı»). Bu, hansı
          bloku saxlamağa dəyər olduğunu seçməyə kömək edir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bir bloku söndürmək onun göstərdiyi məlumatı SİLMİR — sadəcə dashboard-da gizlədir. İstənilən
          vaxt yenidən yandıra bilərsiniz. Saxlama internet xətası ilə alınmasa, açar əvvəlki vəziyyətinə
          qaytarılır — bu halda blokun açarını yenidən basın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bu konfiqurasiya təşkilat səviyyəsindədir və yalnız sizin tenant-ınıza aiddir — dəyişiklik
          təşkilatınızın dashboard-una tətbiq olunur, başqa təşkilatların görünüşünə təsir etmir.
        </p>
      </HelpCallout>
    </div>
  )
}
