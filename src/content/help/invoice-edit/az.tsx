"use client"

/**
 * Invoice editor — help article (Azerbaijani).
 * Mövcud hesab-fakturanın redaktə səhifəsini əhatə edir
 * (/invoices/[id]/edit): başlıqdakı gradient zolaq, Müştəri / Mövqelər /
 * Detallar / Qeydlər kartları, aşağıdakı Yekun bloku və Saxla axını.
 * Bu səhifə yeni faktura YARATMIR — mövcud olanı dəyişir və yaddan
 * sonra faktura baxış səhifəsinə qayıdır.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function invoiceeditHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış və ya maliyyə əməkdaşısınız"
        goal="Mövcud hesab-fakturanın müştərisini, mövqelərini, məbləğlərini və ya detallarını düzəltmək və dəyişiklikləri yadda saxlamaq"
      >
        Bu səhifəyə hesab-faktura baxış səhifəsindəki redaktə düyməsindən gəlirsiniz; ünvan{" "}
        <HelpKey>/invoices/&lt;id&gt;/edit</HelpKey> formasındadır. Səhifə açıldıqda mövcud fakturanın
        bütün məlumatları avtomatik yüklənir — yəni siz boş formanı yox, artıq doldurulmuş formanı
        görürsünüz. Faktura nömrəsi dəyişdirilə bilməz. Bütün məlumatlar yalnız sizin təşkilatınız
        üçündür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda mavi-firuzəyi <strong>gradient başlıq</strong> var: solda{" "}
          <HelpKey>Hesab-fakturalara qayıt</HelpKey> düyməsi, onun yanında «Redaktə et — &lt;faktura
          nömrəsi&gt;» yazısı və altında redaktə edilə bilən <strong>başlıq sahəsi</strong>{" "}
          (placeholder: «İnkişaf xidmətləri — mart 2026»), sağda isə faktura nömrəsi mono-şriftli
          nişan kimi göstərilir. Başlıqdan aşağıda dörd kart bir-birinin ardınca düzülür, hər birinin
          sol kənarında fərqli rəngli zolaq var:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Müştəri">
            Firuzəyi zolaqlı kart: <strong>Şirkət *</strong> (məcburi), <strong>Əlaqədar şəxs</strong>{" "}
            (yalnız şirkət seçildikdən sonra aktiv olur) və <strong>Sövdələşmə</strong> açılan
            siyahıları.
          </HelpDef>
          <HelpDef term="Mövqelər">
            Mavi zolaqlı kart: hesab-fakturanın sətirləri olan cədvəl. Sütunlar — <strong>Ad</strong>,{" "}
            <strong>Təsvir</strong>, <strong>Miqdar</strong>, <strong>Qiymət</strong>,{" "}
            <strong>Endirim %</strong> və hesablanan <strong>Yekun</strong>. Sağ yuxarıda{" "}
            <HelpKey>Məhsullardan</HelpKey> və <HelpKey>Mövqe əlavə et</HelpKey> düymələri.
          </HelpDef>
          <HelpDef term="Detallar">
            Bənövşəyi zolaqlı kart: <strong>Hesab-faktura nömrəsi</strong> (yalnız oxunur),{" "}
            <strong>Tarix</strong>, <strong>Ödəniş tarixi</strong>, <strong>Valyuta</strong>,{" "}
            <strong>Ödəniş şərtləri</strong>, <strong>VÖEN</strong> və müqavilə sətri (müqavilə seçimi,
            müqavilə nömrəsi, müqavilə tarixi).
          </HelpDef>
          <HelpDef term="Qeydlər və şərtlər">
            Kəhrəba zolaqlı yığılan kart: standart olaraq bağlıdır. Açanda{" "}
            <strong>Qeydlər</strong>, <strong>Şərtlər</strong> və <strong>Alt qeyd</strong> mətn
            sahələri görünür. Başlıqda doldurulubsa kəhrəba rəngli «● filled», boşdursa «optional»
            yazısı olur.
          </HelpDef>
          <HelpDef term="Yekun">
            Üstündə firuzəyi zolaq olan ən aşağı kart: <strong>Ara cəm</strong>,{" "}
            <strong>Endirim</strong> (faiz və ya sabit), <strong>ƏDV daxil et (18%)</strong> qutusu və
            qalın <strong>Yekun</strong> məbləği. Sağ aşağıda <HelpKey>Saxla</HelpKey> düyməsi.
          </HelpDef>
        </dl>
        <p>
          Cədvəlin altındakı <HelpKey>Daha əlavə et</HelpKey> zolağı və hər sətrin sonundakı zibil
          qutusu ikonası ilə mövqeləri əlavə edib silə bilərsiniz. Bütün məbləğlər siz yazdıqca dərhal
          yenidən hesablanır — heç bir «hesabla» düyməsinə basmaq lazım deyil.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: müştəri və başlığı dəyiş">
        <HelpStep n={1}>
          <p>
            Faktura adını dəyişmək üçün gradient başlıqdakı ağ <strong>başlıq sahəsinə</strong> klikləyib
            mətni redaktə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mətn birbaşa başlıq zolağında, alt xətli ağ sahədə dəyişir. Boş buraxsanız, yaddan sonra
            faktura nömrəsi başlıq kimi istifadə olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Müştəri</HelpKey> kartında <strong>Şirkət</strong> açılan siyahısından şirkət seçin
            (bu yeganə məcburi seçimdir, ulduzla işarələnib).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Şirkət seçildikdən sonra <strong>Əlaqədar şəxs</strong> açılan siyahısı aktivləşir və həmin
            şirkətin kontaktları ilə dolur. Müqavilə açılan siyahısı da həmin şirkətin müqavilələri ilə
            yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İstəyə bağlı olaraq <strong>Əlaqədar şəxs</strong> və <strong>Sövdələşmə</strong> seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Şirkət hələ seçilməyibsə, Əlaqədar şəxs sahəsi boz və qeyri-aktivdir. Sövdələşmə siyahısı
            təşkilatınızın bütün sövdələşmələrini göstərir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: mövqeləri redaktə et">
        <HelpStep n={1}>
          <p>
            <HelpKey>Mövqelər</HelpKey> kartındakı cədvəldə mövcud sətirlərin xanalarına klikləyib{" "}
            <strong>Ad</strong>, <strong>Təsvir</strong>, <strong>Miqdar</strong>,{" "}
            <strong>Qiymət</strong> və <strong>Endirim %</strong> dəyərlərini dəyişin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətrin sonundakı <strong>Yekun</strong> xanası dərhal yenidən hesablanır (miqdar ×
            qiymət, sonra sətrin endirimi çıxılır). Miqdar ən az 1, endirim isə 0–100 aralığında qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Yeni boş sətir əlavə etmək üçün sağ yuxarıdakı <HelpKey>Mövqe əlavə et</HelpKey> düyməsini
            və ya cədvəlin altındakı <HelpKey>Daha əlavə et</HelpKey> zolağını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəlin sonuna boş bir sətir əlavə olunur; orada ad, miqdar (standart 1) və qiymət yazmağa
            başlaya bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Mövqeni məhsul kataloqundan əlavə etmək üçün <HelpKey>Məhsullardan</HelpKey> düyməsini basın
            və açılan siyahıdan məhsul seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymənin altında məhsulların adı və qiyməti olan açılan siyahı çıxır. Məhsulu seçəndə onun
            adı, təsviri və qiyməti ilə yeni sətir cədvələ əlavə olunur, siyahı isə bağlanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Lazımsız sətri silmək üçün həmin sətrin sonundakı zibil qutusu ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sətir cədvəldən çıxır və yekun məbləğlər yenilənir. Yalnız bir sətir qalıbsa, zibil qutusu
            ikonası qeyri-aktiv olur — son mövqeni silmək mümkün deyil.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: detalları və müqaviləni dəyiş">
        <HelpStep n={1}>
          <p>
            <HelpKey>Detallar</HelpKey> kartında <strong>Tarix</strong>, <strong>Ödəniş tarixi</strong>,{" "}
            <strong>Valyuta</strong>, <strong>Ödəniş şərtləri</strong> və <strong>VÖEN</strong>{" "}
            sahələrini lazımınca dəyişin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Hesab-faktura nömrəsi</strong> sahəsi boz fonlu və yalnız oxunandır — dəyişdirilə
            bilməz. Ödəniş şərtləri açılan siyahısında «Dərhal», «15 gün», «30 gün», «45 gün» və «60
            gün» variantları var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Müqavilə sətrində <strong>Müqavilə</strong> açılan siyahısından mövcud müqaviləni seçə
            bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Müqavilə seçəndə <strong>Müqavilə №</strong> və <strong>Müqavilə tarixi</strong> sahələri
            avtomatik dolur. Şirkət hələ seçilməyibsə açılan siyahıda «Əvvəlcə şirkət seçin», şirkətin
            müqaviləsi yoxdursa «Müqavilə yoxdur» yazısı görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: yekun, endirim, ƏDV və yadda saxlama">
        <HelpStep n={1}>
          <p>
            Ən aşağı <HelpKey>Yekun</HelpKey> kartında ümumi endirim tətbiq etmək üçün endirim tipi
            açılan siyahısından <HelpKey>%</HelpKey> və ya valyuta (sabit məbləğ) seçib yanındakı sahəyə
            dəyəri yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Endirim sıfırdan böyükdürsə, qırmızı rəngli <strong>Endirim məbləği</strong> sətri çıxır və{" "}
            <strong>Yekun</strong> dərhal azalır. Bu endirim hər sətrin öz endirimindən AYRIDIR — ara
            cəmin üzərinə tətbiq olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Vergi əlavə etmək üçün <HelpKey>ƏDV daxil et (18%)</HelpKey> qutusunu işarələyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qutu işarələnəndə endirimdən sonrakı məbləğin 18%-i kimi hesablanmış <strong>ƏDV (18%)</strong>{" "}
            sətri görünür və qalın <strong>Yekun</strong> məbləğinə əlavə olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bütün dəyişiklikləri təsdiqləmək üçün sağ aşağıdakı <HelpKey>Saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Saxlanılır...» yazısına keçir; uğurla yaddan sonra sistem sizi avtomatik olaraq həmin
            fakturanın baxış səhifəsinə qaytarır. Xəta olsa, qırmızı bildiriş (toast) çıxır və səhifədə
            qalırsınız.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Adı boş olan mövqelər yaddan keçirilir — yəni boş bir sətir saxlanmadan əvvəl avtomatik
          atılır, ona görə onu əl ilə silmək məcburi deyil. Məbləğ sahələri (qiymət, endirim) nöqtə ilə
          onluq kəsr qəbul edir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Dəyişikliklər yalnız <HelpKey>Saxla</HelpKey> basıldıqdan sonra qorunur. Səhifədən qabaqcadan
          çıxsanız (<HelpKey>Hesab-fakturalara qayıt</HelpKey> və ya brauzerin geri düyməsi),
          etdiyiniz redaktələr itir. Faktura nömrəsini bu səhifədən dəyişmək mümkün deyil.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün məlumatlar — fakturalar, şirkətlər, kontaktlar, sövdələşmələr, məhsullar və müqavilələr
          — təşkilatınızla məhdudlaşır. Açılan siyahılarda yalnız öz tenant-ınızın yazıları görünür,
          başqa təşkilatın fakturasını redaktə edə bilməzsiniz.
        </p>
      </HelpCallout>
    </div>
  )
}
