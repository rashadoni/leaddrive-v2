"use client"

/**
 * Müştəri analitikası (Calculated Insights) — help məqaləsi (Azərbaycan dili).
 * Köhnə birgə "cdp" məqaləsindən AYRILIB: yalnız
 * CDP → Müştəri analitikası səhifəsini əhatə edir (proqnozlu ömürlük
 * dəyər, müştəri itkisi riski, fəallıq balı, son alışdan günlər, KPI
 * kartları, axtarış/filtr/sıralama, saxlama zəngi tapşırığı).
 * Profil birləşdirmə / dublikat növbəsi bura DAXİL DEYİL — o, "cdp"
 * məqaləsindədir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function cdpinsightsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq və ya satış əməliyyatları üzrə məsulsunuz"
        goal="Ən dəyərli, eyni zamanda itki riski olan müştəriləri tapıb onlara dərhal saxlama zəngi tapşırığı təyin etmək"
      >
        Səhifə <strong>vahid müştəri profilləri</strong> üzrə əvvəlcədən hesablanmış göstəriciləri
        göstərir: hər unikal email/telefon üçün bir profil yaranır. Burada heç nə əl ilə doldurulmur —
        bütün rəqəmlər ödənilmiş hesablar və fəaliyyət tarixçəsindən avtomatik hesablanır və hər
        açılışda yenidən sayılır. Göstərilən bütün profillər yalnız sizin təşkilatınıza aiddir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Müştəri analitikası</HelpKey> adı və altında izah durur. Onun altında dörd
          KPI kartı var: <strong>Profillər</strong>, <strong>Proqnozlu ömürlük dəyər (əsas valyuta)</strong>,{" "}
          <strong>Yüksək müştəri itkisi riski</strong> və <strong>Orta fəallıq</strong>. Hər kartın
          altında kifayət qədər gündəlik anlıq görüntü toplananda kiçik trend qrafiki (sparkline) və
          əvvəlki günə nisbətən dəyişiklik (↑/↓/→) görünür. Kartlardan sonra triaj idarəçiləri — axtarış
          qutusu, itki riski filtr düymələri və sıralama açılan siyahısı — və müştəri profillərinin
          siyahısı gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Profil (vahid müştəri profili)">Hər unikal email/telefon üçün yaradılan birləşdirilmiş müştəri qeydi.</HelpDef>
          <HelpDef term="Proqnozlu ömürlük dəyər">Müştərinin gələcəkdə gətirə biləcəyi ümumi dəyərin proqnozu; etibarlılıq faizi ilə birgə göstərilir.</HelpDef>
          <HelpDef term="Müştəri itkisi riski">Müştərinin getmə ehtimalı — Yüksək / Orta / Aşağı kimi və faizlə (rəngli zolaqla).</HelpDef>
          <HelpDef term="Fəallıq balı">0–100 arası fəallıq göstəricisi (rəngli zolaqla).</HelpDef>
          <HelpDef term="Alışdan günlər">Son alışdan keçən günlərin sayı; yanında aktiv kanalların sayı.</HelpDef>
          <HelpDef term="Saxlama zəngi nişanı">Proqnozlu dəyər yüksək VƏ itki riski yüksək olduqda yanan sarı nişan — saxlamağa ən çox dəyən hesablar.</HelpDef>
          <HelpDef term="Etibarlılıq">Rəqəmin nə qədər datadan hesablandığını göstərir; az data olduqda dəyər «~» ilə soluq göstərilir.</HelpDef>
        </dl>
        <p>
          Hər profil sətrində ad (kontaktı varsa profil səhifəsinə link), email/telefon (klikləyəndə
          məktub/zəng açır), sifariş sayı və son baxış vaxtı, altda isə dörd göstərici — ömürlük dəyər,
          itki riski, fəallıq və alışdan günlər — kart şəklində durur. Profil həm dəyərli, həm də riskli
          olduqda sarı <strong>Saxlama zəngi</strong> nişanı və kartın sol kənarında sarı zolaq görünür.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: səhifəni oxu və KPI-ları başa düş">
        <HelpStep n={1}>
          <p>
            Yuxarıdakı dörd KPI kartına baxın: <HelpKey>Profillər</HelpKey>,{" "}
            <HelpKey>Proqnozlu ömürlük dəyər</HelpKey>, <HelpKey>Yüksək müştəri itkisi riski</HelpKey> və{" "}
            <HelpKey>Orta fəallıq</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kart bir böyük rəqəm göstərir. «Yüksək müştəri itkisi riski» rəqəmi sıfırdan böyükdürsə,
            kart qırmızı çalara keçir və rəqəm qırmızı olur. Əsas valyutadan başqa valyutalar varsa,
            ömürlük dəyər kartının altında «+N daha çox valyuta» yazısı çıxır. Orta fəallıq «/100» ilə
            göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            KPI kartlarının altındakı kiçik trend qrafikinə (sparkline) və oxlu dəyişiklik göstəricisinə
            diqqət edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ən azı iki gündəlik anlıq görüntü toplananda sparkline və ↑/↓/→ oxu ilə faiz dəyişiklik
            görünür. Hələ kifayət qədər data yoxdursa, kartların altında «Trendlər gündəlik anlıq
            görüntülər toplandıqca görünəcək» qeydi durur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: profilləri filtrlə və sırala">
        <HelpStep n={1}>
          <p>
            Axtarış qutusuna ad, email və ya telefon yazın (<HelpKey>Ad, email və ya telefon üzrə axtar</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahı yazdıqca dərhal süzülür (server sorğusu olmadan). Yuxarıda «{"{shown}"}/{"{total}"} göstərilir»
            sayğacı uyğun gələn profil sayını əks etdirir. Heç nə uyğun gəlmirsə, «Filtrə uyğun profil
            yoxdur» mesajı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İtki riski düymələrindən birini seçin: <HelpKey>Hamısı</HelpKey>, <HelpKey>Yüksək</HelpKey>,{" "}
            <HelpKey>Orta</HelpKey> və ya <HelpKey>Aşağı</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş düymə dolu (vurğulu) rəngə keçir, siyahı yalnız həmin risk səviyyəsindəki profilləri
            göstərir. Sayğac uyğun olaraq yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sağdakı sıralama açılan siyahısından bir variant seçin:{" "}
            <HelpKey>Prioritet (saxlama əvvəl)</HelpKey>, <HelpKey>Ömürlük dəyər</HelpKey>,{" "}
            <HelpKey>İtki riski</HelpKey> və ya <HelpKey>Fəallıq</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahı dərhal yenidən sıralanır. «Prioritet» variantında saxlama nişanlı profillər yuxarı
            qalxır, sonra ömürlük dəyərə görə azalan sıra ilə düzülür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: saxlama zəngi tapşırığı yarat">
        <HelpStep n={1}>
          <p>
            Sarı <strong>Saxlama zəngi</strong> nişanlı (sol kənarı sarı zolaqlı) bir profil tapın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Belə profilin başlığının yanında sarı «Saxlama zəngi» nişanı, kartın aşağısında isə
            <HelpKey>Saxlama zəngi yarat</HelpKey> düyməsi olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Saxlama zəngi yarat</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə qısa müddət fırlanan göstəriciyə keçir, sonra yaşıl <HelpKey>Tapşırıq yaradıldı</HelpKey>{" "}
            vəziyyətinə düşür. Profilin kontaktı varsa, bu yaşıl düymə birbaşa yeni tapşırığa keçidə —{" "}
            <HelpKey>Tapşırığı aç</HelpKey> — çevrilir. Tapşırıq yüksək prioritetlə və 2 gün sonraya
            son tarixlə yaradılır. Alınmasa, düymə qırmızı <HelpKey>Alınmadı</HelpKey> olur — yenidən
            cəhd edə bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Profili daha yaxından görmək üçün başlıqdakı ada və ya kartın altındakı{" "}
            <HelpKey>Profili aç</HelpKey> düyməsinə klikləyin. Əlaqə üçün email və ya telefon üzərinə
            klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ad/«Profili aç» kontakt səhifəsini açır. Email üzərinə klik məktub yazma pəncərəsini, telefon
            üzərinə klik isə zəng/nömrə əməliyyatını işə salır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Ən sürətli iş axını: sıralamanı <HelpKey>Prioritet (saxlama əvvəl)</HelpKey> saxlayın və ən
          yuxarıdakı sarı nişanlı profillərdən aşağıya doğru hərəkət edin — bunlar ən yüksək dəyərli,
          eyni zamanda getmək üzrə olan müştərilərdir. Hər birinə bir kliklə saxlama zəngi tapşırığı
          yaradın.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Ödənilmiş hesabı az olan profillərdə proqnozlu dəyər «~» işarəsi ilə soluq göstərilir — bu,
          rəqəmin az datadan hesablandığını və qəti olmadığını bildirir. Etibarlılıq faizinə baxın:
          aşağı faiz «hələ təsdiqlənməmiş təxmin» deməkdir. Ümumi xərc çox olduqda yalnız ilk N profil
          göstərilir; belə halda yuxarıda sarı «ilk {"{count}"} profil göstərilir (daha çoxu var)»
          xəbərdarlığı çıxır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün profillər və göstəricilər təşkilatınızla məhdudlaşır — başqa tenant-ın müştərilərini
          görmürsünüz. Hələ ödənilmiş hesab yoxdursa, səhifə «Vahid profil hələ yoxdur» boş vəziyyətini
          göstərir; kontaktların hesabı olduqdan sonra dəyər, risk və fəallıq avtomatik hesablanmağa
          başlayır.
        </p>
      </HelpCallout>
    </div>
  )
}
