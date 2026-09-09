"use client"

/**
 * Pipelines & Stages — help article (Azerbaijani).
 * en.tsx-in güzgüsü: hunilər, mərhələlər (sıra/rəng/ehtimal/qazanma-uduzma)
 * və sövdələşmənin mərhələ keçidini məhdudlaşdıran doğrulama qaydaları.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function PipelinesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Bu nə üçün vacibdir">
        <p>
          <strong>Huni</strong> — sövdələşmənin ilk təmasdan bağlanmaya qədər keçdiyi mərhələlər
          toplusudur. Bu ekranda həmin yolu siz qurursunuz: bir və ya bir neçə huni yaradırsınız,
          mərhələləri adlandırıb yenidən sıralayırsınız, hər mərhələnin qazanma ehtimalını təyin
          edirsiniz və sövdələşmənin əsl hazır olana qədər irəli keçməsinə imkan verməyən{" "}
          <strong>doğrulama qaydaları</strong> əlavə edirsiniz.
        </p>
        <p>
          Bir dəfə qurun — və aşağıdakı hər sövdələşmə lövhəsi, proqnoz və hesabat eyni strukturu
          miras alır, beləliklə rəqəmlər bütün komanda üzrə uyğun qalır.
        </p>
      </HelpSection>

      <HelpSection title="Hunilər — bir yol və ya bir neçə">
        <p>
          Hər huni mötərizədə sövdələşmə sayı ilə tab kimi göstərilir.{" "}
          <HelpKey>★</HelpKey> <strong>standart</strong> hunini işarələyir — başqa cür
          demədiyiniz halda yeni sövdələşmələrin düşdüyü huni.
        </p>
        <HelpStep n={1}>
          <p>
            Sahəyə ad yazın və <HelpKey>Huni əlavə et</HelpKey> düyməsini basın. Yeni huni altı
            standart mərhələ ilə (Lead, Qualified, Proposal, Negotiation, Won, Lost) əvvəlcədən
            doldurulmuş başlayır — dərhal satışa başlaya, sonra tənzimləyə bilərsiniz.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Keçmək üçün taba klikləyin. <HelpKey>Standart olaraq təyin et</HelpKey> ilə onu düşmə
            hunisinə çevirin — bu zaman standart bayrağı əvvəlkindən avtomatik götürülür.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Sil</HelpKey> yalnız huni həm standart olmayanda, həm də{" "}
            <strong>sıfır sövdələşmə</strong> saxlayanda görünür. Əvvəlcə onun sövdələşmələrini
            köçürün və ya yenidən təyin edin; standart hunini isə heç vaxt silmək olmaz.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Huninin silinməsi geri dönməzdir — zibil qutusu yoxdur. Sövdələşmə sayı yoxlaması məhz
            ona görədir ki, canlı sövdələşmələri hunisiz qoymayasınız; onu yan keçmək yox, ona
            riayət etmək lazımdır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Mərhələlər — sövdələşmənin qalxdığı pillələr">
        <p>
          Hər mərhələnin rəngi, göstərilən adı (mötərizədə daxili kodu ilə) və{" "}
          <strong>ehtimalı</strong> var — bu mərhələdəki sövdələşmənin bağlanma faiz ehtimalı; o,
          çəkili proqnozlaşdırmanı qidalandırır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ad">Lövhələrdə və hesabatlarda görünür; böyük hərflərlə kod (məs. PROPOSAL) ondan avtomatik formalaşır.</HelpDef>
          <HelpDef term="Ehtimal">0–100%. Standart mərhələlər: Lead 10 → Qualified 25 → Proposal 50 → Negotiation 75 → Won 100.</HelpDef>
          <HelpDef term="Qazanma / uduzma">Bağlanma mərhələsini işarələyən bayraqlar. Hər mərhələ ya biri, ya digəridir — heç vaxt hər ikisi deyil.</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            <HelpKey>Mərhələ əlavə et</HelpKey> düyməsini basın, ad təyin edin, palitradan rəng
            seçin və ehtimal göstərin. Yeni mərhələlər sıranın sonuna əlavə olunur.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Mərhələni redaktə et</HelpKey> üçün qələm işarəsini açın — adını dəyişin,
            rəngini və ya ehtimalını dəyişin, <HelpKey>Qazanma mərhələsi</HelpKey> /{" "}
            <HelpKey>Uduzma mərhələsi</HelpKey> keçidlərini dəyişin (birini seçmək digərini ləğv
            edir). Tətbiq etmək üçün saxlayın.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sıranı <HelpKey>↑</HelpKey> / <HelpKey>↓</HelpKey> oxları ilə dəyişin; buradakı sıra
            sövdələşmə lövhəsindəki sütunların soldan sağa sırasıdır. Mərhələni onun redaktə
            panelindən silə bilərsiniz.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Aktiv sövdələşmələri olan mərhələni <strong>silmək olmaz</strong> — sistem orada hələ
            neçə sövdələşmə olduğunu bildirir. Əvvəlcə həmin sövdələşmələri başqa mərhələyə köçürün.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Doğrulama qaydaları — sövdələşmə hazır olana qədər mərhələni bağla">
        <p>
          Mərhələni açın (sətrinə klikləyin) ki, onun <strong>doğrulama qaydalarını</strong> idarə
          edəsiniz. Qayda deyir: «şərt yerinə yetirilməyincə sövdələşmə bu mərhələyə daxil ola
          bilməz» — məsələn, sahə doldurulmalı və ya minimum məbləğə çatılmalıdır.
        </p>
        <HelpStep n={1}>
          <p>
            <HelpKey>Doğrulama qaydası əlavə et</HelpKey> düyməsini basın, yoxlanacaq{" "}
            <HelpKey>Sahə</HelpKey>-ni seçin (Sövdələşmə dəyəri, Əlaqə şəxsi, Şirkət, Qeydlər,
            Gözlənilən bağlanma tarixi, Təyin edilib, Tapşırıqlar və ya Aktivliklər). Mövcud{" "}
            <HelpKey>Qayda növü</HelpKey> variantları seçdiyiniz sahəyə uyğun dəyişir.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Qayda növlərinin siyahısı sahəyə uyğunlaşır: <em>Tələb olunur</em>, minimum / maksimum
            dəyər, minimum mətn uzunluğu, gələcək tarix yoxlaması, bu gündən gün sayı və tapşırıq /
            aktivlik sayları. Rəqəmli qaydalar dəyər istəyir (məs. <em>Minimum dəyər 1000</em>).
            Sonra aydın bir <strong>xəta mesajı</strong> yazın — bu, işə düşən qayda satıcının
            qarşısını kəsəndə onun gördüyü dəqiq mətndir.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Saxlanılmış qaydalar mərhələnin altında <HelpKey>qalxan</HelpKey> sayğacı ilə
            siyahılanır. İstənilənini zibil işarəsi ilə silin. Qaydası olmayan mərhələ
            sövdələşmələri sərbəst buraxır.
          </p>
        </HelpStep>
        <HelpCallout kind="next">
          <p>
            Qaydalar sövdələşmə bağlı mərhələyə <em>köçürüləndə</em> yoxlanılır. Bu gün sistem
            onlardan üçünü real tətbiq edir — <em>Tələb olunur</em>, <em>Minimum dəyər</em>{" "}
            (sövdələşmə dəyəri üçün) və <em>Ən azı 1 tapşırıq tamamlanmalıdır</em>; bunlardan biri
            yerinə yetirilməyəndə köçürmə <em>422</em> kodu ilə rədd edilir və sizin xəta mesajınız
            göstərilir, sövdələşmə isə yerində qalır. Digər qayda növlərini indi konfiqurasiya edib
            siyahıda görmək olar, lakin onlar hələ sərt maneə kimi tətbiq olunmur — emalı gələnə
            qədər onları niyyətin qeydi sayın.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Hər şey necə bir araya gəlir">
        <ol className="list-decimal pl-5 space-y-1">
          <li>Burada <strong>hunini</strong> və onun <strong>mərhələlərini</strong> təyin edirsiniz.</li>
          <li>Sövdələşmələr sövdələşmə lövhəsində bu mərhələlər üzrə hərəkət edir.</li>
          <li>Hər mərhələnin <strong>ehtimalı</strong> proqnozunuzu avtomatik çəkiləndirir.</li>
          <li><strong>Doğrulama qaydası</strong> səhlənkar köçürməni baş verməzdən əvvəl bloklayır, məlumatlarınızı təmiz, proqnozunuzu dürüst saxlayır.</li>
        </ol>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Hunilər, mərhələlər və qaydalar təşkilatınızla məhdudlaşır — hər sorğu sizin tenant-ınıza
          görə süzülür, ona görə yalnız öz konfiqurasiyanızı görüb redaktə edirsiniz və heç vaxt
          başqa şirkətinkini görmürsünüz. Bu ekran <strong>Tənzimləmələr</strong> bölməsindədir —
          bütün komandanın sövdələşmələrinin tabe olduğu ümumi struktur (mərhələlər və qaydalar)
          məhz orada idarə olunmalıdır, gündəlik sövdələşmə lövhəsində yox.
        </p>
      </HelpCallout>
    </div>
  )
}
