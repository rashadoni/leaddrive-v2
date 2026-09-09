"use client"

/**
 * Payment Notifications (Ödəniş Bildirişləri) — help article (Azerbaijani).
 * Tənzimləmələr → Maliyyə bildirişləri səhifəsini əhatə edir:
 * bildiriş emaili, dörd bildiriş kateqoriyası (gecikmiş ödənişlər,
 * əvvəlcədən xəbərdarlıq, ödəniş tapşırıqları, hesab ödənişləri),
 * hər kateqoriyanın aç/söndür açarı, çatdırılma kanalları
 * (Telegram / Tətbiqdə / Email) və «əvvəlcədən xəbərdarlıq» üçün
 * son tarixə qalan gün seçimi.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function financenotificationsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Maliyyə administratoru və ya mühasibsiniz"
        goal="Hansı ödəniş hadisələri üçün, hansı kanala (Telegram, tətbiq, e-poçt) bildiriş gəldiyini tənzimləmək"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Maliyyə bildirişləri</HelpKey> yolu ilə
        çatırsınız. Bütün parametrlər yalnız sizin təşkilatınız üçündür. Dəyişiklikləri etdikdən
        sonra sağ yuxarıdakı <HelpKey>Saxla</HelpKey> düyməsi ilə yadda saxlamağı unutmayın — saxlamamış
        çıxsanız, dəyişikliklər itər.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Ödəniş Bildirişləri</HelpKey> adı, altında «Maliyyə bildirişlərinin vaxtını
          və kanalını tənzimləyin» izahı, sağ yuxarıda isə <HelpKey>Saxla</HelpKey> düyməsi var. Səhifə
          yuxarıdan aşağıya beş bölmədən ibarətdir: əvvəlcə <strong>Bildiriş emaili</strong> kartı, sonra
          dörd bildiriş kateqoriyası — <strong>Gecikmiş ödənişlər</strong>,{" "}
          <strong>Əvvəlcədən xəbərdarlıq</strong>, <strong>Ödəniş tapşırıqları</strong> və{" "}
          <strong>Hesab ödənişləri</strong>.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Bildiriş emaili">
            Email kanalı aktiv olanda maliyyə bildirişlərinin göndəriləcəyi ünvan (məs.
            finance@company.com).
          </HelpDef>
          <HelpDef term="Gecikmiş ödənişlər">
            Vaxtı keçmiş ödənişlər haqqında bildiriş kateqoriyası.
          </HelpDef>
          <HelpDef term="Əvvəlcədən xəbərdarlıq">
            Yaxınlaşan son tarixlər haqqında bildiriş; neçə gün qabaqdan xəbər verəcəyini özünüz seçirsiniz.
          </HelpDef>
          <HelpDef term="Ödəniş tapşırıqları">
            Ödəniş tapşırığının göndərilməsi və icrası zamanı bildiriş kateqoriyası.
          </HelpDef>
          <HelpDef term="Hesab ödənişləri">
            Hesab ödənişi qeyd ediləndə bildiriş kateqoriyası.
          </HelpDef>
          <HelpDef term="Çatdırılma kanalları">
            Bildirişin hara gələcəyi: <strong>Telegram</strong>, <strong>Tətbiqdə</strong> (bildiriş
            mərkəzində) və ya <strong>Email</strong>. Bir kateqoriyada birdən çox kanal seçə bilərsiniz.
          </HelpDef>
          <HelpDef term="Son tarixə qalan günlər">
            Yalnız «Əvvəlcədən xəbərdarlıq» üçün — bildirişin neçə gün əvvəl gələcəyi: 1, 3, 7 və ya 14 gün.
          </HelpDef>
        </dl>
        <p>
          Hər kateqoriya bir kart kimi göstərilir: solda zəng ikonası, kateqoriyanın adı və qısa izahı,
          sağda isə aç/söndür açarı (toggle). Açar aktiv olanda kartın altında həmin kateqoriyanın{" "}
          <strong>çatdırılma kanalları</strong> açılır; söndürdükdə kanallar gizlənir. Səhifə ilk
          açılarkən qısa müddət <strong>Yüklənir...</strong> yazısı görünür.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: bildiriş emailini təyin et">
        <HelpStep n={1}>
          <p>
            Ən yuxarıdakı <HelpKey>Bildiriş emaili</HelpKey> kartında mətn sahəsinə e-poçt ünvanını yazın
            (məs. <HelpKey>finance@company.com</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahənin altında «Maliyyə bildirişləri bu emailə göndəriləcək (Email kanalı aktiv olduqda)»
            izahı durur. Sahə boş olanda içində nümunə kimi <strong>finance@company.com</strong> soluq
            mətni göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bu ünvanın işləməsi üçün ən azı bir kateqoriyada <strong>Email</strong> kanalının da seçili
            olduğundan əmin olun (aşağıdakı bölmələrə baxın).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Email kanalı heç bir kateqoriyada seçili deyilsə, bura yazdığınız ünvana heç nə gəlmir — sahə
            sadəcə hara göndəriləcəyini saxlayır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: bir kateqoriyanı aç/söndür və kanalları seç">
        <HelpStep n={1}>
          <p>
            İstədiyiniz kateqoriyanın (məs. <HelpKey>Gecikmiş ödənişlər</HelpKey>) kartının sağındakı
            aç/söndür açarını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açar aktiv vəziyyətə keçəndə sürüşkən düymə sağa sürüşür və rəngi dolur; kartın altında{" "}
            <strong>Çatdırılma kanalları</strong> bölməsi açılır. Söndürəndə açar sola qayıdır və kanallar
            yenidən gizlənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Açılan <HelpKey>Çatdırılma kanalları</HelpKey> bölməsində istədiyiniz kanal(lar)ın yanındakı
            qutunu işarələyin: <strong>Telegram</strong>, <strong>Tətbiqdə</strong> və ya{" "}
            <strong>Email</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kanal bir sətir kimi göstərilir: adı, altında qısa izahı («Telegram bildirişi göndər»,
            «Bildiriş mərkəzində göstər», «Email bildirişi göndər») və sağda qeyd qutusu. Qutunu
            işarələdikdə içi dolur; bir kateqoriyada birdən çox kanal eyni anda seçilə bilər.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: «Əvvəlcədən xəbərdarlıq» üçün xəbərdarlıq günlərini seç">
        <HelpStep n={1}>
          <p>
            <HelpKey>Əvvəlcədən xəbərdarlıq</HelpKey> kartının açarını aktiv edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bu kartın zəng ikonası sarı rəngdədir. Açıldıqda kartın altında əvvəlcə{" "}
            <strong>Son tarixə qalan günlər</strong> sətri, onun altında isə çatdırılma kanalları görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Son tarixə qalan günlər</HelpKey> sətrindəki düymələrdən birini seçin:{" "}
            <HelpKey>1 gün</HelpKey>, <HelpKey>3 gün</HelpKey>, <HelpKey>7 gün</HelpKey> və ya{" "}
            <HelpKey>14 gün</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz düymə dolu (vurğulu) görünür, qalanları isə konturlu qalır. Eyni anda yalnız bir
            seçim aktiv ola bilər. Standart olaraq <strong>7 gün</strong> seçilidir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Altdakı <HelpKey>Çatdırılma kanalları</HelpKey> bölməsindən kanalları əvvəlki kimi seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Gün seçimi və kanal seçimi eyni kartda yan-yana durur; ikisi də həmin bir «Əvvəlcədən
            xəbərdarlıq» kateqoriyasına aiddir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: dəyişiklikləri yadda saxla">
        <HelpStep n={1}>
          <p>
            Bütün kateqoriyaları və kanalları istədiyiniz kimi qurduqdan sonra sağ yuxarıdakı{" "}
            <HelpKey>Saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxlama gedərkən düymə içində fırlanan ikona göstərir; bitdikdə qısa müddət{" "}
            <strong>Saxlanıldı!</strong> yazısına keçir, sonra yenidən <strong>Saxla</strong> olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Hər kateqoriya üçün kanalları ayrı-ayrı seçirsiniz — məsələn gecikmiş ödənişlər həm Telegram, həm
          tətbiqdə gəlsin, hesab ödənişləri isə yalnız tətbiqdə. Bir kateqoriyanı tamamilə söndürsəniz, onun
          kanal seçimləri gizlənir, amma əvvəl seçdikləriniz itmir — açarı yenidən aktiv etdikdə geri qayıdır.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Dəyişikliklər avtomatik yadda saxlanmır. Hansısa açarı çevirib və ya kanal seçib{" "}
          <HelpKey>Saxla</HelpKey> basmadan səhifədən çıxsanız, dəyişikliklər tətbiq olunmur. Həmçinin Email
          kanalını seçsəniz, amma yuxarıda <HelpKey>Bildiriş emaili</HelpKey> sahəsini boş buraxsanız,
          e-poçt bildirişlərinin gedəcəyi ünvan olmaz.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bu parametrlər təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın maliyyə bildirişlərini
          tənzimləyirsiniz və başqa təşkilatın ayarlarını görmürsünüz. Bildiriş emaili də yalnız sizin
          təşkilatınızın maliyyə hadisələri üçün işlədilir.
        </p>
      </HelpCallout>
    </div>
  )
}
