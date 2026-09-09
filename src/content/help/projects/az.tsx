"use client"

/**
 * Projects — help article (Azerbaijani).
 * en.tsx-in güzgüsü: layihə siyahısı + layihə kartı (İcmal / Tapşırıqlar /
 * CRM aktivliyi / İştirakçılar / Mərhələlər / Büdcə), həmçinin tamamlanma və xərcin necə hesablanması.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ProjectsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Layihələr nə üçündür">
        <p>
          <strong>Layihə</strong> — sona qədər apardığınız işdir: büdcəsi, müddətləri, komandası,
          mərhələləri və tapşırıqları olan. O, CRM-inizin üzərində dayanır: layihəni{" "}
          <strong>şirkətə</strong> və <strong>sövdələşməyə</strong> bağlamaq olar ki, çatdırılma işi
          gəldiyi gəlirlə bağlı qalsın.
        </p>
        <p>
          Siyahı səhifəsi bütün portfelə baxışdır; bir layihəni açanda onu hərəkətə gətirən hər şeyə
          dərinləşirsiniz.
        </p>
      </HelpSection>

      <HelpSection title="Siyahı — layihə portfeliniz">
        <p>
          Yuxarıda dörd KPI kartı var — <HelpKey>Cəmi</HelpKey>, <HelpKey>Aktiv</HelpKey>,{" "}
          <HelpKey>Tamamlanmış</HelpKey> və <HelpKey>Gecikmiş</HelpKey>. Hər kart klikə həssasdır və
          sürətli süzgəc kimi işləyir.
        </p>
        <HelpStep n={1}>
          <p>
            Formu açmaq üçün <HelpKey>Yeni layihə</HelpKey> düyməsini basın. Ad (vacibdir), təsvir,
            status, prioritet, başlama / bitmə tarixləri, menecer, şirkət, sövdələşmə, valyuta,
            büdcə, rəng və teqlər təyin edin. Kod daxil etməsəniz, o, formada özü yaranır:{" "}
            <em>PRJ-001</em>, <em>PRJ-002</em>, …
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Siyahını status süzgəc həbləri ilə daraldın (<em>Planlaşdırma</em>, <em>Aktiv</em>,{" "}
            <em>Gözləmədə</em>, <em>Tamamlanıb</em>, <em>Ləğv edilib</em>) — həb yalnız ən azı bir
            layihənin həmin statusu olanda görünür. Axtarış xanası layihənin{" "}
            <strong>adı</strong> üzrə axtarır.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Layihəni açmaq üçün istənilən sətrə klikləyin. Siyahı səhifə başına 20 ilə bölünür;
            sütunda rəngli tamamlanma zolağı görünür, layihə gecikəndə isə bitmə tarixi qırmızıya
            çevrilir.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Sətirləri seçmək üçün qutucuqları işarələyin, sonra kütləvi əməliyyat panelində hamısı
            üçün eyni anda <HelpKey>Change status…</HelpKey> edin və ya onları birlikdə silin.{" "}
            <HelpKey>İxrac</HelpKey> cari siyahını CSV kimi yükləyir (ad, kod, status, prioritet,
            şirkət, tamamlanma, büdcə, valyuta, tarixlər).
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Status, prioritet və gecikmə">
        <p>
          Hər layihənin <strong>statusu</strong> və <strong>prioriteti</strong> var, siyahı isə
          bitmə tarixini ötən hər şeyi işarələyir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status">planlaşdırma → aktiv → gözləmədə → tamamlanıb / ləğv&nbsp;edilib</HelpDef>
          <HelpDef term="Prioritet">aşağı, orta, yüksək, kritik</HelpDef>
          <HelpDef term="Gecikmə">bitmə tarixi keçmişdədir, status isə «tamamlanıb» və «ləğv edilib» deyil</HelpDef>
        </dl>
        <HelpCallout kind="next">
          <p>
            Layihəni <em>Aktiv</em> etmək onun faktiki başlama tarixini qeyd edir;{" "}
            <em>Tamamlanıb</em> etmək faktiki bitmə tarixini qeyd edir və tamamlanmanı{" "}
            <strong>100%</strong>-ə çatdırır. Bu, bir layihəni redaktə edəndə də, statusu kütləvi
            dəyişəndə də işləyir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Layihənin içində — altı tab">
        <p>
          Layihəni açın — yan panel bir baxışda xülasəni göstərir (tamamlanma, status, prioritet,
          menecer, şirkət, tarixlər, büdcə faktiki xərcə qarşı, həmçinin <em>Overdue</em> nişanı).
          İşin özü altı taba bölünür:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="İcmal">tapşırıq bölgüsü, büdcə xülasəsi və mərhələ zaman xətti</HelpDef>
          <HelpDef term="Tapşırıqlar">layihənin öz tapşırıq siyahısı — Siyahı və ya Kanban lövhəsi kimi</HelpDef>
          <HelpDef term="CRM aktivliyi">Tapşırıqlar səhifəsindən bu layihəyə bağlanmış CRM tapşırıqları</HelpDef>
          <HelpDef term="İştirakçılar">layihədəki insanlar, rolu və qeyd olunmuş saatları ilə</HelpDef>
          <HelpDef term="Mərhələlər">fazalar, hər birinin öz tamamlanma zolağı ilə</HelpDef>
          <HelpDef term="Büdcə">büdcə, faktiki xərc, qalıq və iştirakçı üzrə xərc</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Tapşırıqlar və mərhələlər">
        <p>
          Layihə tapşırıqları <strong>Ediləcək → Davam edir → Yoxlama → Bitib</strong> yolu ilə
          gedir (plus <em>Ləğv</em> statusu). Hər tapşırığın prioriteti, icraçısı, son tarixi,
          təxmini saatları və mərhələsi ola bilər.
        </p>
        <HelpStep n={1}>
          <p>
            Tapşırıqlar tabında <HelpKey>List</HelpKey> ilə <HelpKey>Kanban</HelpKey> lövhəsi
            arasında keçin. Lövhədə statusu dəyişmək üçün kartı başqa sütuna sürükləyin. Statusa,
            mərhələyə və ya icraçıya görə süzgəcləyin.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Mərhələ əlavə et</HelpKey> ilə son tarixi və rəngi olan faza yaradın. Mərhələnin
            tamamlanma zolağı onun tapşırıqları <em>Bitib</em>-ə çatdıqca dolur, son tarix isə
            mərhələ gecikəndə qırmızıya çevrilir.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Layihənin ümumi <strong>tamamlanma %-i</strong> əllə daxil edilmir — o, görülmüş işdən
            yenidən hesablanır: <em>Bitib</em> statuslu layihə tapşırıqları plus{" "}
            <em>Tamamlanıb</em> statuslu bağlı CRM tapşırıqları, ümumi sayına bölünür. Heç bir
            tapşırığı olmayan layihə 0% göstərir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="İştirakçılar, büdcə və xərc">
        <p>
          Komanda yoldaşlarını <HelpKey>İştirakçılar</HelpKey> tabında rolla əlavə edin —{" "}
          <strong>Menecer</strong>, <strong>İştirakçı</strong> və ya <strong>Baxıcı</strong>.
          İştirakçının saatlıq dərəcəsi və qeyd olunmuş saatları ola bilər.
        </p>
        <HelpStep n={1}>
          <p>
            <HelpKey>Büdcə</HelpKey> tabı büdcəni, faktiki xərci və qalığı göstərir. «İstifadə
            edilib %» zolağı 70%-ə qədər yaşıl, 70%-dən yuxarı sarı, 90%-dən yuxarı qırmızıdır;
            İcmal tabındakı büdcə xülasəsində isə artıq xərclədikdə qalıq qırmızıya çevrilir.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Dərəcəsi olan hər iştirakçı üçün Büdcə tabı <em>saat × dərəcə</em> göstərir və yekunlaşdırır
            — əmək xərcinin hara getdiyinə sürətli baxış.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="CRM aktivliyi — Tapşırıqlardan bağlanmış iş">
        <p>
          Bu tab CRM-inizlə əlaqənin ikinci yarısıdır. <strong>Tapşırıqlar</strong> səhifəsindən bu
          layihəyə bağladığınız tapşırıqlar burada görünür, <HelpKey>Açıq</HelpKey> və{" "}
          <HelpKey>Tamamlanmış</HelpKey> kimi qruplaşdırılmış. Birbaşa həmin tapşırığa keçmək üçün
          istənilənini klikləyin.
        </p>
        <HelpCallout kind="warning">
          <p>
            Bu siyahı <strong>200</strong>-ə qədər bağlı tapşırıq yükləyir; bundan artıqda bir
            banner görəcəksiniz və qalanını Tapşırıqlar səhifəsindən idarə etməlisiniz. Boş hal yolu
            göstərir: tapşırığı açın və bu layihəni seçin, ya da <strong>/tasks</strong> səhifəsində
            layihə süzgəcindən istifadə edin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Buradakı hər şey təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın layihələrini görüb
          dəyişirsiniz. Layihənin silinməsi <strong>geri dönməzdir</strong> (zibil qutusu yoxdur): o,
          layihənin iştirakçılarını, mərhələlərini və tapşırıqlarını silir, ona istinad edən hər
          hansı CRM tapşırığını isə ayırır. İstinad etdiyi menecer, şirkət və sövdələşmə — və həmin
          ayrılmış CRM tapşırıqları — silinmir.
        </p>
      </HelpCallout>
    </div>
  )
}
