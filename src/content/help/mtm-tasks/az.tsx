"use client"

/**
 * MTM Sahə tapşırıqları — kömək (azərbaycanca). 2026-09-da status düymələri olan ekrana görə yenidən yazılıb.
 */
import { HelpCallout, HelpKey, HelpScenario, HelpSection } from "@/components/help/help-content"

export default function MtmTasksHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="Siz sahə komandasının rəhbərisiniz" goal="Nəyin gecikdiyini və nəyin qəbulunuzu gözlədiyini görmək, tapşırığı bir kliklə açmaq">
        Bölmə açıq tapşırıqlarla açılır: əvvəlcə ən köhnə gecikmələr, sonra ən yaxın son tarixlər.
      </HelpScenario>

      <HelpSection title="Status düymələri">
        <p>
          Siyahının üstündə <HelpKey>Açıq</HelpKey>, <HelpKey>Vaxtı keçib</HelpKey>, <HelpKey>Qəbul gözləyir</HelpKey>, <HelpKey>Tamamlanıb</HelpKey> düymələri var (və varsa <HelpKey>Ləğv edilib</HelpKey>). Düymədəki rəqəm onun neçə tapşırıq göstərəcəyidir. Basılmış düymə filtrdir.
        </p>
        <HelpCallout kind="tip">
          Vaxtı keçib — son tarixi keçmiş açıq tapşırıqdır; tarixin altında qırmızı ilə nə qədər gecikdiyi yazılır. Qəbul gözləyir — rəhbərin hələ qəbul etmədiyi və geri qaytarmadığı tamamlanmış tapşırıqdır.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Axtarış və filtrlər">
        <p>
          Axtarış başlıq, təsvir, təşkilat və əməkdaş üzrə aparılır. <HelpKey>Əlavə filtrlər</HelpKey> içində komanda və əməkdaş var; düymədəki rəqəm neçəsinin seçildiyidir.
        </p>
      </HelpSection>

      <HelpSection title="Tapşırıq">
        <p>
          Sətirin istənilən yerinə klik tapşırığı açır: tarixçəsi, sənədləri və tamamlanmış üçün <HelpKey>Qəbul et</HelpKey> / <HelpKey>Geri qaytar</HelpKey>.
        </p>
        <HelpCallout kind="tip">
          Açıq tapşırıqları başqa əməkdaşa birdən təyin etmək üçün onları işarələyin. Tamamlanmış və ləğv edilmişlərdə işarə qutusu yoxdur — onlar yenidən təyin edilmir.
        </HelpCallout>
        <p>
          Yeni tapşırıq — sağ yuxarıdakı <HelpKey>Tapşırıq əlavə et</HelpKey> düyməsi.
        </p>
      </HelpSection>
    </div>
  )
}
