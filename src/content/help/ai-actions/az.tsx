"use client"

/**
 * AI əməliyyatları / AI məsləhətçi — kömək məqaləsi (Azərbaycanca).
 * Cari /ai/actions bölməsi: AI siqnalları üçün əməliyyat mərkəzi, risk
 * yoxlaması, Advisor sualları, modul əhatəsi və təhlükəsiz təsdiq növbəsi.
 */
import {
  HelpCallout,
  HelpDef,
  HelpKey,
  HelpScenario,
  HelpSection,
  HelpStep,
} from "@/components/help/help-content"

export default function AiActionsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış, dəstək, maliyyə və ya əməliyyat rəhbəri"
        goal="Günün riskini, səbəbini və hansı AI addımının təsdiqə göndərilə biləcəyini anlamaq"
      >
        Bölməni <HelpKey>AI</HelpKey> → <HelpKey>AI məsləhətçi</HelpKey> yolu ilə açın. Bu artıq
        sadəcə approve/reject siyahısı deyil: səhifə CRM, satış, tapşırıqlar, maliyyə, tiketlər,
        marşrutlar və KPI-lardan əməliyyat siqnalları toplayır, sübut göstərir və növbəti addımı
        təklif edir. Əməliyyat dərhal icra olunmur; əvvəl təsdiq növbəsinə düşür.
      </HelpScenario>

      <HelpSection title="Bölmə auditi: nə dəyişib">
        <dl className="rounded-md border p-3">
          <HelpDef term="KPI zolağı">Açıq riskləri, kritik siqnalları, risk altında məbləği, təsdiq gözləyən əməliyyatları, aktiv modulları və icra xətalarını göstərir.</HelpDef>
          <HelpDef term="Bu gün">Əsas iş ekranıdır: solda siqnal siyahısı, sağda seçilmiş risk və təhlükəsiz növbəti addım.</HelpDef>
          <HelpDef term="Soruş">Hazır ssenarilər və xüsusi Advisor sualı. Cavablar bu səhifədəki siqnallara bağlı qalır.</HelpDef>
          <HelpDef term="Modullar">Hansı mənbələrin aktiv, icazə ilə bloklu, söndürülmüş və ya collector xətalı olduğunu göstərir.</HelpDef>
          <HelpDef term="Növbə"><HelpKey>Növbəyə əlavə et</HelpKey> sonrası əməliyyatlar burada yoxlanır, payload düzəldilir, təsdiq və ya rədd edilir.</HelpDef>
          <HelpDef term="Tarixçə">Baxılmış əməliyyatlar və icra statusu üçün audit jurnalı.</HelpDef>
        </dl>
        <HelpCallout kind="warning" label="Vacib">
          Köhnə “hamısını təsdiqlə və 5 saniyədə geri al” modeli artıq əsas axın deyil. Cari axın:
          siqnal → sübut → əməliyyat ön baxışı → təsdiq növbəsi → icra və tarixçə.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Yuxarı xülasəni oxuyun">
        <HelpStep n={1}>
          <p>Əvvəl <HelpKey>Açıq risklər</HelpKey> və <HelpKey>Kritik</HelpKey> göstəricilərinə baxın.</p>
          <HelpCallout kind="see" label="Nəyə baxmaq lazımdır">
            Kritik say çoxdursa, <HelpKey>Diqqət tələb edir</HelpKey> siyahısındakı ilk elementdən başlayın.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p><HelpKey>Risk altında məbləğ</HelpKey> və <HelpKey>Təsdiq gözləyən</HelpKey> göstəricilərini yoxlayın.</p>
          <HelpCallout kind="tip">
            Risk altında məbləğ adi gecikməni gəlirə, ödənişə və ya müqaviləyə təsir edən siqnaldan ayırır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p><HelpKey>İcra xətaları</HelpKey> sıfır deyilsə, <HelpKey>Növbə</HelpKey> və ya <HelpKey>Tarixçə</HelpKey> açın.</p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Əsas iş axını: riski yoxlayın">
        <HelpStep n={1}>
          <p>
            <HelpKey>Bu gün</HelpKey> tabında siyahını modul, sahib və ya axtarışla daraldın:
            Sales, Finance, Tasks, Ticketing və ya konkret şirkət.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>Solda siqnalı klikləyin. Sağda <strong>Risk detalı</strong> açılacaq.</p>
          <HelpCallout kind="see" label="Yoxlayın">
            Risk başlığı, hərəkətsiz günlər, məbləğ, sahib, faktlar, mənbələr və bağlı siqnallar.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Növbəti addım</HelpKey> blokunda Advisor-un nə təklif etdiyini oxuyun:
            tapşırıq, qeyd, xəbərdarlıq, follow-up qaralaması və ya qeyd yeniləməsi.
          </p>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Tövsiyə düzgündürsə, <HelpKey>Növbəyə əlavə et</HelpKey> basın. Bu müştəriyə göndəriş
            deyil; əməliyyat təsdiq növbəsinə keçir.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Soruş tabından istifadə">
        <p>
          <HelpKey>Soruş</HelpKey> tək sətir yox, biznes sualı ilə başlamaq üçündür: pul harada risk
          altındadır, hansı satışlar dayanıb, hansı tapşırıqlar gecikir, hansı SLA riskləri açıqdır.
        </p>
        <HelpStep n={1}>
          <p><HelpKey>Satış riskləri</HelpKey> və ya <HelpKey>Pul riski</HelpKey> kimi hazır ssenari seçin.</p>
        </HelpStep>
        <HelpStep n={2}>
          <p>Advisor siqnalları süzür, əsas riski açır və mənbələrlə cavab verir.</p>
        </HelpStep>
        <HelpStep n={3}>
          <p>Cavabdan riskə qayıda və ya əsas addımı növbəyə əlavə edə bilərsiniz.</p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Modullar, növbə və tarixçə">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Modullar</strong> Advisor əhatəsini izah edir: mənbə aktivdir, icazə ilə bloklanıb, yoxsa siqnal yoxdur.</li>
          <li><strong>Təsdiq növbəsi</strong> sübut və ön baxışla hazırlanmış əməliyyatları göstərir. Təsdiqdən əvvəl düzəldilən sahələr dəyişə bilər.</li>
          <li><strong>Tarixçə</strong> audit izidir: kim təsdiqlədi və ya rədd etdi, icra tamamlandımı, xəta harada oldu.</li>
        </ul>
        <HelpCallout kind="security">
          Advisor yalnız sizin təşkilatınızın məlumatını göstərir. AI təklifi istifadəçi onu növbəyə göndərib təsdiqləməyincə xarici mesaj, tapşırıq və ya qeyd yeniləməsi olmur.
        </HelpCallout>
      </HelpSection>
    </div>
  )
}
