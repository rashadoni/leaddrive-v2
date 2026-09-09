"use client"

/**
 * Quota Management — help article (Azerbaijani).
 * Mənbə səhifə: src/app/(dashboard)/settings/quotas/page.tsx
 * "quotas-territories" birgə məqaləsindən ayrılıb — yalnız Kvota İdarəetməsi haqqında.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function QuotasHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış meneceri və ya yuxarı rolusunuz"
        goal="Hər menecer və rüb üçün satış kvotasını təyin edib icranı izləmək istəyirsiniz"
      >
        Səhifə <HelpKey>Parametrlər → Kvotalar</HelpKey> bölməsindədir. Kvotanı yalnız{" "}
        <strong>menecer və ya yuxarı</strong> rol əlavə edə, dəyişə və ya silə bilər; aşağı
        rollar cədvəli görsə də, yeni kvota düyməsi 403 qaytarır. Fakt sütunu avtomatik
        hesablanır — siz yalnız hədəfi təyin edirsiniz.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda başlıq <strong>«Kvota İdarəetməsi»</strong> və alt başlıq «Menecerlər və
          rüblər üzrə satış kvotaları» dayanır. Sağda üç il düyməsi var —{" "}
          <strong>keçən il, cari il və gələn il</strong>; seçdiyiniz il bütün səhifəni filtrləyir.
          Altda <strong>«Kvota əlavə et»</strong> kartı, daha aşağıda isə həmin ilin kvota
          cədvəli yerləşir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Menecer">Kvota təyin etdiyiniz işçi. Açılan siyahıdan seçilir (ad, ad yoxdursa e-poçt göstərilir).</HelpDef>
          <HelpDef term="Rüb">Q1–Q4 — kvotanın aid olduğu rüb.</HelpDef>
          <HelpDef term="Kvota">Sizin təyin etdiyiniz hədəf məbləğ (manatla, ₼).</HelpDef>
          <HelpDef term="Fakt">Həmin işçinin həmin rübdə qazandığı (WON) sövdələrin cəmi — avtomatik hesablanır.</HelpDef>
          <HelpDef term="%">İcra: Fakt ÷ Kvota, faizlə. 100%+ yaşıl, 70%+ mavi, 40%+ sarı, aşağıda qırmızı.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: ili seçmək">
        <HelpStep n={1}>
          <p>
            Başlığın sağındakı il düymələrindən birini basın —{" "}
            <HelpKey>keçən il</HelpKey>, <HelpKey>cari il</HelpKey> və ya <HelpKey>gələn il</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş il düyməsi dolu (primary) rəngə boyanır, qalan ikisi tutqun qalır. Cədvəl həmin
            ilin kvotaları ilə yenilənir; məlumat yüklənərkən qısa müddət «Yüklənir...» mesajı görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni kvota əlavə etmək">
        <HelpStep n={1}>
          <p>
            «Kvota əlavə et» kartında <HelpKey>Menecer</HelpKey> açılan siyahısını açın və işçi seçin.
            Default olaraq «Seçin...» yazılıb.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahıda təşkilatın istifadəçiləri sadalanır (adları, ad yoxdursa e-poçtları ilə).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Rüb</HelpKey> açılan siyahısından <HelpKey>Q1</HelpKey>…<HelpKey>Q4</HelpKey> birini seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Dar açılan siyahıda dörd seçim — Q1, Q2, Q3, Q4. Default olaraq Q1 seçilidir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Məbləğ (₼)</HelpKey> sahəsinə hədəf rəqəmini yazın. Bu rəqəm sahədir (məs. 150000
            yer-tutucu kimi göstərilir).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yalnız rəqəm qəbul edən giriş sahəsi. Menecer və məbləğ doldurulmayana qədər «Əlavə et»
            düyməsi sönük (deaktiv) qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <HelpKey>Əlavə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə üzərində qısa müddət fırlanan yükləmə ikonu görünür, sonra forma sahələri sıfırlanır
            (menecer və məbləğ boşalır) və cədvəl yeni sətirlə yenilənir. Eyni menecer + il + rüb üçün
            təkrar əlavə etsəniz, yeni sətir yaranmır — mövcud kvota yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: kvotanı redaktə etmək">
        <HelpStep n={1}>
          <p>
            Cədvəldə dəyişmək istədiyiniz sətrin <HelpKey>Kvota</HelpKey> məbləğinin üstünə klikləyin.
            Üstünə gələndə altı xətlənir və «Redaktə etmək üçün klikləyin» ipucu çıxır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Məbləğ yerində kiçik rəqəm giriş sahəsi açılır və avtomatik fokuslanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Yeni rəqəmi yazın, sonra <HelpKey>Enter</HelpKey> basın və ya sahənin kənarına klikləyin
            (fokusu itirin). Ləğv etmək üçün <HelpKey>Escape</HelpKey> basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Enter və ya fokus itkisi yeni məbləği yadda saxlayır və cədvəl yenilənir — % sütunu dərhal
            yeni hədəfə görə yenidən hesablanır. Escape isə dəyişiklik etmədən redaktəni bağlayır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: kvotanı silmək">
        <HelpStep n={1}>
          <p>
            Sətrin ən sağındakı <HelpKey>zibil qutusu</HelpKey> ikonuna basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sətir dərhal cədvəldən silinir və cədvəl yenidən yüklənir. Təsdiq dialoqu yoxdur — kliklə
            silinir, ona görə diqqətli olun.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Boş hallar">
        <p>
          Seçilmiş il üçün heç bir kvota yoxdursa, cədvəl yerində mərkəzdə{" "}
          <strong>«{`{il}`} üçün kvota tapılmadı»</strong> mesajı görünür. Məlumat hələ gəlirsə,{" "}
          orada «Yüklənir...» yazısı dayanır. Hər iki halda yuxarıdakı «Kvota əlavə et» kartı yenə də
          əlçatandır.
        </p>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <strong>Fakt</strong> sütununu əl ilə doldurmaq lazım deyil — o, həmin işçinin həmin rübdə
          bağladığı WON sövdələrin məbləğindən avtomatik gəlir (rüb sövdənin qazanıldığı tarixə görə
          təyin olunur). Siz yalnız <strong>hədəfi</strong> dürüst saxlayın, % sütunu özü icranı göstərər.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Silmədə təsdiq pəncərəsi yoxdur. Zibil qutusu ikonu kvotanı dərhal silir. Səhvən silsəniz,
          onu «Kvota əlavə et» ilə yenidən yarada bilərsiniz — Fakt onsuz da sövdələrdən yenidən
          hesablanacaq.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Kvota yaratmaq, redaktə etmək və silmək yalnız <strong>menecer və ya yuxarı</strong> rol
          üçün açıqdır; aşağı rollarda bu əməliyyatlar 403 (qadağan) qaytarır. Bütün kvotalar
          təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın istifadəçilərini və sövdələrini görürsünüz.
        </p>
      </HelpCallout>
    </div>
  )
}
