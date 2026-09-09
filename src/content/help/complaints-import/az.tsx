"use client"

/**
 * Şikayətlər reyestrinin idxalı (xlsx) — help məqaləsi (Azərbaycan dili).
 * Yalnız Şikayətlər → İdxal səhifəsini əhatə edir: xlsx faylı yüklə,
 * ön baxış (dry-run) oxu, qeydləri reyestrə idxal et. Reyestrin özü
 * (şikayət siyahısı / detal) bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function complaintsimportHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Keyfiyyət/müştəri xidməti operatoru və ya administratorsunuz"
        goal="Müştərinin mövcud Excel şikayət reyestrini sistemə kütləvi şəkildə köçürmək"
      >
        Səhifəyə <HelpKey>Şikayətlər</HelpKey> reyestrindən <HelpKey>İdxal</HelpKey> ilə (və ya birbaşa{" "}
        <HelpKey>/complaints/import</HelpKey> yolu ilə) çatırsınız. İdxal yalnız müştərinin orijinal
        Excel formatını — Azərbaycan dilində 18 sütunlu reyestri (Sıra, Müştəri, Tarix, Mənbə, Marka,
        Məhsul, Obyekt, Cavab, Status, Risk…) — qəbul edir. Hər sətir sistemdə bir{" "}
        <strong>şikayət (ticket)</strong> kimi yaradılır. İdxal etdiyiniz hər şey yalnız sizin
        təşkilatınıza yazılır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda <HelpKey>Reyestrə qayıt</HelpKey> keçidi, altında <strong>«Şikayətlər reyestrinin
          idxalı (xlsx)»</strong> başlığı və qısa izah var. Mərkəzdə böyük <strong>sürüşdür-burax</strong>{" "}
          sahəsi durur: cədvəl ikonası, «xlsx faylı bura sürüşdürün» və «və ya əl ilə seçin» mətni, bir
          də <HelpKey>Fayl seç</HelpKey> düyməsi. Fayl seçiləndən sonra sahənin altında faylın adı görünür.
        </p>
        <p>
          Fayl yükləyəndən sonra səhifə ardıcıl olaraq üç vəziyyət göstərir: əvvəlcə{" "}
          <strong>«Emal olunur…»</strong> mesajı, sonra <strong>Ön baxış</strong> kartı (tanınan sətirlər
          cədvəli + idxal düyməsi), idxaldan sonra isə <strong>nəticə kartı</strong> (neçə qeyd yaradıldı).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="xlsx / xlsm">Yalnız Excel iş kitabı faylları qəbul edilir (CSV, PDF və ya digər formatlar yox).</HelpDef>
          <HelpDef term="Ön baxış (dry-run)">Faylı yüklər-yükləməz avtomatik sınaq oxuması: heç nə yadda saxlanmır, sadəcə neçə sətir tanındığını və ilk 10 sətrin necə oxunduğunu göstərir.</HelpDef>
          <HelpDef term="Tanındı: N sətir">Faylda məzmunu (şikayət mətni) olan və oxuna bilən sətirlərin sayı — boş sətirlər sayılmır.</HelpDef>
          <HelpDef term="Xəbərdarlıqlar">Oxuna bilməyən sətirlərin siyahısı (sətir nömrəsi + səbəb); ilk 5-i göstərilir.</HelpDef>
          <HelpDef term="historicalNumber">Excel-dəki «Sıra» sütunundan gələn orijinal reyestr nömrəsi — qeyddə saxlanılır ki, köhnə nömrələmə itməsin.</HelpDef>
        </dl>
        <p>
          Ön baxış cədvəlinin sütunları sabitdir: <strong>№</strong> (faylın sətir nömrəsi),{" "}
          <strong>Sıra</strong>, <strong>Müştəri</strong>, <strong>Tarix</strong>, <strong>Marka</strong>,{" "}
          <strong>Risk</strong> və <strong>Status</strong>. Bir dəyər oxunmayıbsa, xanada «—» göstərilir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: faylı yüklə və ön baxışı oxu">
        <HelpStep n={1}>
          <p>
            <HelpKey>Fayl seç</HelpKey> düyməsini basıb kompüterinizdən xlsx faylını seçin — və ya faylı
            birbaşa sürüşdür-burax sahəsinə dartıb buraxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Faylı sahənin üstünə gətirəndə çərçivə işıqlanır. Buraxan kimi seçilmiş faylın adı sahənin
            altında görünür və qısaca <strong>«Emal olunur…»</strong> mesajı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Heç bir əlavə düyməyə basmağa ehtiyac yoxdur — sistem faylı dərhal <strong>sınaq rejimində
            (dry-run)</strong> oxuyur. Bu mərhələdə heç nə yadda saxlanmır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Ön baxış</strong> kartı açılır. Başlığın altında <strong>«Tanındı: N sətir»</strong>{" "}
            yazısı, xəta varsa onun yanında <strong>«· xəta: M»</strong> göstərilir. Sağda{" "}
            <HelpKey>N qeydi idxal et</HelpKey> düyməsi durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Cədvəldə ilk 10 sətrin necə oxunduğunu yoxlayın — adların, tarixlərin, marka və riskin düzgün
            sütunlara düşdüyünə əmin olun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>№, Sıra, Müştəri, Tarix, Marka, Risk, Status</strong> sütunlu cədvəl görünür. 10-dan
            çox sətir varsa, cədvəlin altında <strong>«+ X qeyd daha (ilk 10 göstərilir)»</strong> qeydi
            çıxır. Oxunmayan sətirlər <strong>Xəbərdarlıqlar</strong> bölməsində qırmızı rənglə, «Sətir
            R: səbəb» formatında sadalanır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: qeydləri idxal et">
        <HelpStep n={1}>
          <p>
            Ön baxış düzgündürsə, sağ yuxarıdakı <HelpKey>N qeydi idxal et</HelpKey> düyməsini basın
            (burada N — tanınan sətirlərin sayıdır).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yenidən qısa <strong>«Emal olunur…»</strong> mesajı çıxır. Bu dəfə sistem həqiqətən hər
            sətirdən bir şikayət (və varsa əlaqəli kontakt) yaradır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>İdxal bitənə qədər gözləyin.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ön baxış kartı <strong>nəticə kartı</strong> ilə əvəz olunur. Uğurlu idxalda yaşıl ✓
            işarəsi, qeyd yaradılmayıbsa qırmızı ✕ işarəsi, yanında <strong>«İdxal tamamlandı»</strong>{" "}
            və <strong>«Yaradılan qeydlər: X / Y»</strong> xülasəsi (xəta olsa «· xəta: M» əlavə olunur)
            görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Nəticədən sonra iki seçim var: <HelpKey>Reyestri aç</HelpKey> sizi şikayət siyahısına
            aparır, <HelpKey>Daha idxal et</HelpKey> isə səhifəni sıfırlayıb yeni fayl yükləməyə imkan
            verir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Daha idxal et</HelpKey> basanda nəticə və ön baxış silinir, fayl adı təmizlənir və
            yenidən boş sürüşdür-burax sahəsinə qayıdırsınız.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          İdxaldan əvvəl mütləq ön baxışdakı <strong>«Tanındı: N sətir»</strong> sayını faylınızdakı
          sətir sayı ilə tutuşdurun. Rəqəm gözlədiyinizdən azdırsa, ya sütun başlıqları tanınmayıb, ya
          da bəzi sətirlərin şikayət mətni boşdur — belə sətirlər ötürülür. «Sıra» sütunundakı nömrələr
          orijinal reyestr nömrəsi (historicalNumber) kimi qorunur.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bir fayl üzrə <strong>maksimum 5000 sətir</strong> qəbul edilir; daha çoxu olarsa fayl rədd
          edilir. Sütun başlıqları tanınmasa («şikayət mətni» sütunu tapılmasa) sistem xəta verir və heç
          nə idxal etmir. İdxal əməliyyatının özü <strong>geri qaytarma düyməsi yoxdur</strong> — eyni
          faylı təkrar yükləsəniz, qeydlər yenidən yaradıla bilər, ona görə əvvəlcə ön baxışla yoxlayın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          İdxal yalnız sizin təşkilatınız (tenant) daxilində işləyir — yaradılan bütün şikayətlər, kontaktlar
          və reyestr metaməlumatı sizin org-unuza bağlanır, başqa təşkilatın məlumatına toxunmur. Hər
          uğurlu idxal audit jurnalına yazılır (neçə şikayət, hansı fayldan).
        </p>
      </HelpCallout>
    </div>
  )
}
