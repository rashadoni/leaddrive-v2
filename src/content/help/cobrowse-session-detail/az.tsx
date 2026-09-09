"use client"

/**
 * T8 Cobrowse — sessiya izləyici (agent) səhifəsi (Azerbaijani).
 *
 * Yalnız `/cobrowse/[id]` səhifəsini əhatə edir: müştərinin qoşulma
 * URL-i, vəziyyət nişanı (gözləyir → canlı → bitdi), canlı video
 * pəncərəsi və Fasilə/Davam/Bitir idarəetmələri. Sessiya yaratma
 * dialoqu (siyahı səhifəsi) bura DAXİL DEYİL — yalnız ötən-keçən
 * qeyd kimi xatırlanır.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function cobrowsesessiondetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dəstək və ya satış nümayəndəsisiniz"
        goal="Müştəri ilə birgə-baxış (cobrowse) sessiyası qurub onun ekranını canlı görmək, lazım olanda fasilə vermək və sessiyanı bitirmək"
      >
        Səhifəyə <HelpKey>Cobrowse</HelpKey> siyahısından bir sessiyanı açmaqla
        (və ya yeni sessiya yaratdıqdan sonra avtomatik yönləndirilməklə) çatırsınız.
        Bütün sessiyalar yalnız sizin təşkilatınıza aiddir. <strong>Müştərinin
        ekranını siz başlatmırsınız</strong> — qoşulma linkini ona göndərirsiniz,
        o özü nəyi paylaşacağını (ekran / tab / pəncərə) seçir və yalnız göstərdiyini
        görürsünüz.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarı sol küncdə <HelpKey>← Back to sessions</HelpKey> (sessiyalara
          qayıt) linki, altında <strong>Session &lt;ID&gt;…</strong> başlığı
          (sessiya identifikatorunun ilk 8 simvolu) durur. Başlığın altında rəngli
          vəziyyət nişanı və sessiyanın başlama tarixi (<strong>Started …</strong>)
          görünür. Sağ yuxarıda sessiya canlı və ya fasilədədirsə əməliyyat
          düymələri (<HelpKey>Pause</HelpKey>/<HelpKey>Resume</HelpKey> və{" "}
          <HelpKey>End</HelpKey>) çıxır.
        </p>
        <p>
          Aşağıda iki blok var: <strong>Customer join URL</strong> (müştərinin
          qoşulma linki — sessiya bitənə qədər görünür) və böyük qara{" "}
          <strong>canlı video pəncərəsi</strong>. Vəziyyətdən asılı olaraq video
          pəncərəsində ya «müştəri gözlənilir» mesajı, ya da müştərinin paylaşdığı
          ekran görünür.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Waiting for customer">Sessiya yaradılıb, müştəri hələ linki açıb razılıq verməyib. Səhifə hər 5 saniyədə avtomatik yenilənir.</HelpDef>
          <HelpDef term="Connecting…">Müştəri qəbul edib — peer (WebRTC) əlaqəsi qurulur, görüntü hələ gəlməyib.</HelpDef>
          <HelpDef term="Live">Müştərinin ekranı canlı axır və video pəncərəsində görünür.</HelpDef>
          <HelpDef term="Paused">Sessiya müvəqqəti dayandırılıb — axın saxlanıb, lakin sessiya bitməyib.</HelpDef>
          <HelpDef term="Ended">Sessiya bitib (siz bitirdiniz, müştəri çıxdı, vaxt doldu və ya xəta). Bundan sonra qoşulma linki gizlənir.</HelpDef>
          <HelpDef term="Customer join URL">Müştəriyə göndərmək üçün hazır link — yalnız oxunan sahə və yanında «Copy» düyməsi.</HelpDef>
          <HelpDef term="Join token">Linkin sonundakı təhlükəsiz açar (`/c/&lt;token&gt;`); müştəri bunsuz sessiyaya qoşula bilmir.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: müştərini sessiyaya dəvət et">
        <HelpStep n={1}>
          <p>
            Sessiyanı açan kimi <strong>Customer join URL</strong> blokuna baxın.
            Yanındakı <HelpKey>Copy</HelpKey> düyməsini basaraq linki kopyalayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yalnız oxunan mətn sahəsində link görünür. <HelpKey>Copy</HelpKey>{" "}
            düyməsi basıldıqdan sonra qısa müddətə <HelpKey>Copied</HelpKey>{" "}
            (təsdiq işarəsi ilə) yazısına keçir, ~2 saniyədən sonra geri qayıdır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Linki müştəriyə çatdırın — söhbət (chat), e-poçt və ya SMS ilə. Blokun
            altındakı izah da məhz bunu xatırladır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahənin altında «Send this to the customer via chat, email, or SMS.»
            izahı durur: müştəri linki açanda ondan ekran / tab / pəncərə paylaşması
            istəniləcək.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Müştəri qoşulana qədər gözləyin. İstəsəniz video pəncərəsindəki{" "}
            <HelpKey>Check now</HelpKey> düyməsi ilə vəziyyəti dərhal yoxlayın
            (avtomatik yoxlamanı gözləmədən).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qara video pəncərəsində «Waiting for customer to join…» mesajı və{" "}
            <HelpKey>Check now</HelpKey> düyməsi olur. Vəziyyət nişanı{" "}
            <strong>Waiting for customer</strong> göstərir. Müştəri razılıq verən
            kimi nişan əvvəlcə <strong>Connecting…</strong>, sonra{" "}
            <strong>Live</strong> olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: canlı sessiyanı idarə et">
        <HelpStep n={1}>
          <p>
            Müştəri qoşulub görüntü gələndə video pəncərəsində onun paylaşdığı ekran
            görünür. Sağ yuxarıda <HelpKey>Pause</HelpKey> və{" "}
            <HelpKey>End</HelpKey> düymələri aktivləşir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Vəziyyət nişanı yaşıl <strong>Live</strong> olur. Qara pəncərə
            müştərinin canlı ekranı ilə dolur. Səs yoxdur — yalnız görüntü (video
            səssizdir).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Müvəqqəti dayandırmaq üçün <HelpKey>Pause</HelpKey> düyməsini basın.
            Davam etdirmək üçün eyni yerdə görünən <HelpKey>Resume</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Fasilədə vəziyyət nişanı sarı <strong>Paused</strong> olur və düymə{" "}
            <HelpKey>Pause</HelpKey>-dan <HelpKey>Resume</HelpKey>-ə dəyişir. Müştəri
            tərəfində də interfeys dərhal fasilə vəziyyətinə keçir — onlara siqnal
            göndərilir. <HelpKey>Resume</HelpKey> basanda nişan yenidən{" "}
            <strong>Live</strong> olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sessiyanı tamamlamaq üçün qırmızı <HelpKey>End</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Vəziyyət nişanı qırmızı <strong>Ended</strong> olur, video pəncərəsində
            «Session ended.» yazısı çıxır, <strong>Customer join URL</strong> bloku
            və əməliyyat düymələri yox olur. Müştəriyə də sessiyanın bitdiyi barədə
            siqnal gedir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: sessiyalar arasında keç və ya çıx">
        <HelpStep n={1}>
          <p>
            Başqa sessiyaya keçmək və ya siyahıya qayıtmaq üçün yuxarı soldakı{" "}
            <HelpKey>← Back to sessions</HelpKey> linkini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Cobrowse</HelpKey> siyahı səhifəsinə qayıdırsınız. Cari canlı
            və ya fasilədəki sessiya bu hərəkətdən <strong>bitmir</strong> — Back
            qəsdən naviqasiya sayılır və sessiyanı saxlayır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <HelpKey>Back to sessions</HelpKey> sessiyanı bitirmir, amma{" "}
            <strong>tab-ı və ya pəncərəni bağlamaq</strong> başqadır: canlı və ya
            fasilədəki sessiyada brauzer «Saytdan çıxasınız?» xəbərdarlığı göstərir,
            və təsdiq etsəniz sessiya «agent bitirdi» kimi qeyd olunur. Müştərini
            işdə qoyub başqa işə keçmək istəyirsinizsə, tab-ı bağlamayın —{" "}
            <HelpKey>Back to sessions</HelpKey> ilə naviqasiya edin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Müştəri linki itirsə, sessiya canlı ikən belə <strong>Customer join
          URL</strong> bloku görünməyə davam edir — eyni linki yenidən kopyalayıb
          göndərə bilərsiniz. «Copy» düyməsi işləməsə (məsələn, sayt hələ HTTPS
          deyilsə), oxunan sahənin üstünə klikləyib mətni əl ilə seçərək kopyalayın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün cobrowse sessiyaları təşkilatınızla məhdudlaşır — başqa təşkilatın
          sessiyalarını görə bilmirsiniz. <strong>İdarəetmə müştərinin
          əlindədir</strong>: o nəyi paylaşacağını seçir, siz isə yalnız onun
          göstərdiyi ekranı görürsünüz (klaviatura/siçanına nəzarət etmirsiniz).
          Qoşulma açarı (join token) sessiya siyahısında saxlanmır və yalnız bu
          izləyici səhifədə ayrıca çəkilir ki, devtools-da sızmasın.
        </p>
      </HelpCallout>
    </div>
  )
}
