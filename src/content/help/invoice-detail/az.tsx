"use client"

/**
 * Invoice detail — help article (Azerbaijani).
 * Tək hesab-faktura kartını əhatə edir: başlıq əməliyyatları (Göndər,
 * PDF/Möhürsüz PDF, Akt, Dublikat, Sil), pipeline + KPI kartları,
 * altı tab (İcmal / Mövqelər / Ödənişlər / Fəaliyyət / Zəncir / Baxış),
 * ödəniş qeyd etmə, faktura göndərmə və avtomatik xatırlatma zənciri.
 * Faktura yaratma və redaktə AYRI səhifələrdir — bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InvoicedetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış və ya maliyyə əməkdaşısınız"
        goal="Bir hesab-fakturanı müştəriyə göndərmək, daxil olan ödənişi qeyd etmək və qalıq borcu izləmək — lazım gəldikdə avtomatik xatırlatma zənciri qurmaq"
      >
        Bu səhifəyə hesab-faktura siyahısından bir sətrə basaraq çatırsınız. Başlıqda faktura
        nömrəsi (məs. <HelpKey>INV-0001</HelpKey>) və yanında rəngli status nişanı durur. Bütün
        məbləğlər, ödənişlər və fəaliyyət yalnız sizin təşkilatınızın bu fakturasına aiddir.
        Burada nə dəyişdirsəniz — ödəniş əlavə etsəniz, göndərsəniz — yuxarıdakı KPI kartları və
        status dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda <strong>geri ox</strong> düyməsi (siyahıya qaytarır), faktura nömrəsi, status
          nişanı və varsa fakturanın başlığı durur. Sağ tərəfdə bir sıra əməliyyat düyməsi var:{" "}
          <HelpKey>Düzəliş et</HelpKey>, <HelpKey>Göndər</HelpKey>, <HelpKey>PDF yüklə</HelpKey>,{" "}
          <HelpKey>Möhürsüz PDF</HelpKey>, <HelpKey>Akt</HelpKey>, <HelpKey>Dublikat yarat</HelpKey>{" "}
          və qırmızı <HelpKey>Sil</HelpKey>. Onların altında üç mərhələli pipeline lenti
          (<strong>Qaralama → Göndərilib → Ödənilib</strong>) və beş KPI kartı gəlir. Daha aşağıda
          altı tab var.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status nişanı">Fakturanın hazırkı vəziyyəti: Qaralama, Göndərilib, Baxılıb, Qismən ödənilib, Ödənilib, Gecikdirilmiş, Ləğv edilib və ya Geri qaytarılıb.</HelpDef>
          <HelpDef term="Pipeline">Üç mərhələli lent — Qaralama, Göndərilib, Ödənilib; faktura hansı mərhələdədirsə, o işıqlanır.</HelpDef>
          <HelpDef term="Ara cəm (ƏDV-siz)">ƏDV əlavə olunmadan mövqelərin cəmi; varsa ƏDV faizi alt sətirdə göstərilir.</HelpDef>
          <HelpDef term="Ümumi məbləğ (ƏDV daxil)">Müştərinin ödəməli olduğu son məbləğ.</HelpDef>
          <HelpDef term="Qalıq borc">Hələ ödənilməmiş hissə; sıfırdan böyükdürsə qırmızı, sıfırdırsa yaşıl rəngdə.</HelpDef>
          <HelpDef term="Ödənilib">İndiyə qədər qeyd edilmiş ödənişlərin cəmi.</HelpDef>
          <HelpDef term="Ödəniş günü / Gecikdirilmiş">Son ödəniş tarixinə neçə gün qaldığını göstərir; tarix keçibsə qırmızı «gün gecikmiş» kimi görünür.</HelpDef>
        </dl>
        <p>
          Tablar: <strong>İcmal</strong> (faktura və müştəri məlumatı + qeydlər),{" "}
          <strong>Mövqelər</strong> (sətir-sətir mallar/xidmətlər və yekun cədvəl),{" "}
          <strong>Ödənişlər</strong> (ödəniş tarixçəsi və yeni ödəniş qeydi),{" "}
          <strong>Fəaliyyət</strong> (yaradılma, göndərmə, baxış, ödəniş — vaxt xətti üzrə),{" "}
          <strong>Zəncir</strong> (avtomatik xatırlatma axını) və <strong>Baxış</strong>{" "}
          (fakturanın PDF görünüşü).
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: fakturanı müştəriyə göndər">
        <HelpStep n={1}>
          <p>
            Başlıqdakı <HelpKey>Göndər</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Göndər» başlıqlı pəncərə açılır. <strong>Alıcının emaili</strong>, <strong>Mövzu</strong>{" "}
            və <strong>Mesaj</strong> sahələri var. Email və mövzu əvvəlcədən doldurulmuş olur —
            alıcı emaili kimi fakturanın alıcı emaili (yoxdursa kontaktın emaili), mövzu kimi isə
            «Invoice &lt;nömrə&gt;» yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Lazım gəlsə email ünvanını və mövzunu dəqiqləşdirin, <strong>Mesaj</strong> sahəsinə bir
            neçə söz əlavə edin və aşağıdakı <HelpKey>Göndər</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Göndərilir...» yazısına keçir, sonra pəncərə bağlanır. Status nişanı{" "}
            <strong>Göndərilib</strong> olur, pipeline ikinci mərhələyə keçir və <strong>Fəaliyyət</strong>{" "}
            tabında «Faktura göndərildi» qeydi peyda olur. Göndərmə alınmasa, pəncərənin içində
            qırmızı xəta mesajı çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: daxil olan ödənişi qeyd et">
        <HelpStep n={1}>
          <p>
            <HelpKey>Ödənişlər</HelpKey> tabına keçin və sağ yuxarıdakı <HelpKey>Ödəniş qeyd et</HelpKey>{" "}
            düyməsini basın. (Bu düymə yalnız qalıq borc sıfırdan böyük olanda görünür.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Ödəniş qeyd et» başlıqlı pəncərə açılır. <strong>Məbləğ</strong> avtomatik olaraq qalıq
            borcla doldurulur; aşağıda <strong>Ödəniş üsulu</strong> (Bank köçürməsi, Nağd, Kart,
            Çek, Digər), <strong>Ödəniş tarixi</strong> (standart — bugün), <strong>İstinad</strong>{" "}
            və <strong>Qeydlər</strong> sahələri var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Məbləği yoxlayın (qismən ödəniş üçün dəyişin), üsulu və tarixi seçin, istəsəniz istinad
            nömrəsi yazın və aşağıdakı <HelpKey>Ödəniş qeyd et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Pəncərə bağlanır və ödəniş <strong>Ödənişlər</strong> cədvəlinə yaşıl məbləğlə əlavə
            olunur. <strong>Ödənilib</strong> və <strong>Qalıq borc</strong> KPI kartları yenilənir;
            tam ödənildikdə status <strong>Ödənilib</strong>, qismən ödənildikdə{" "}
            <strong>Qismən ödənilib</strong> olur. Xəta olarsa, pəncərədə qırmızı mesaj görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: PDF, Akt və Dublikat">
        <HelpStep n={1}>
          <p>
            Möhürlü PDF üçün başlıqdakı <HelpKey>PDF yüklə</HelpKey>, möhürsüz nüsxə üçün{" "}
            <HelpKey>Möhürsüz PDF</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Fakturanın PDF-i yeni brauzer tabında açılır. Eyni görünüşü səhifəni tərk etmədən{" "}
            <strong>Baxış</strong> tabında da görə bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Təhvil-təslim aktı üçün <HelpKey>Akt</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Akt sənədi yeni tabda HTML formatında açılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Eyni mövqelərlə yeni faktura yaratmaq üçün <HelpKey>Dublikat yarat</HelpKey> düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sistem yeni qaralama faktura yaradır və sizi həmin yeni fakturanın səhifəsinə yönləndirir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: avtomatik xatırlatma zənciri qur">
        <HelpStep n={1}>
          <p>
            <HelpKey>Zəncir</HelpKey> tabına keçin. İlk dəfədirsə, ortada «Zəncir qurulmayıb» mətni
            və <HelpKey>Zəncir qur</HelpKey> düyməsi olur — onu basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Trigger: hesab-faktura göndərilməsi» başlanğıc node-u ilə zəncir qurucusu açılır.
            Aşağıda <HelpKey>Addım əlavə et</HelpKey> üçün kəsik-kəsik çərçivə görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Addım əlavə et</HelpKey> düyməsini basın və tipi seçin: <strong>Email</strong>,{" "}
            <strong>SMS</strong>, <strong>Gözləmə</strong>, <strong>Telegram</strong>,{" "}
            <strong>WhatsApp</strong> və ya <strong>Şərt</strong>. Mətni doldurub{" "}
            <HelpKey>Əlavə et</HelpKey> ilə təsdiqləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Üç sütunlu tip seçicisi olan pəncərə açılır. Mövzu/mesaj sahələri seçdiyiniz dilə uyğun
            hazır şablonla doldurulmuş gəlir (<HelpKey>{"{{invoice_number}}"}</HelpKey>,{" "}
            <HelpKey>{"{{amount}}"}</HelpKey>, <HelpKey>{"{{balance_due}}"}</HelpKey> kimi
            dəyişənlərlə). «Şərt» seçsəniz, hazır reseptlər çıxır — məsələn «Ödənilibsə → dayandır».
            Əlavə etdikdən sonra addım triggerin altında nömrələnmiş kart kimi görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Addımları əlavə etdikdən sonra əvvəlcə <HelpKey>Addımları saxla</HelpKey> düyməsini basın,
            sonra <HelpKey>Başlat</HelpKey> ilə zənciri işə salın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxlanmamış dəyişiklik varsa, <strong>Başlat</strong> düyməsi «Əvvəlcə saxlayın» kimi
            söndürülmüş qalır. Saxladıqdan sonra başlatmaq mümkün olur; aktivləşəndə yuxarıda yaşıl
            «Zəncir aktivdir» zolağı və yanıb-sönən nöqtə çıxır, varsa növbəti hərəkətin vaxtı
            göstərilir. Dayandırmaq üçün <HelpKey>Dayandır</HelpKey> düyməsini basın.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <strong>Düzəliş et</strong> düyməsi sizi fakturanın ayrıca redaktə səhifəsinə aparır —
          orada mövqeləri, tarixləri və müştəri məlumatını dəyişə bilərsiniz. Sadəcə nə baş verdiyini
          görmək istəyirsinizsə, <strong>Fəaliyyət</strong> tabı yaradılma, göndərmə, müştəri baxışı
          və hər ödənişi vaxt ardıcıllığı ilə bir yerdə toplayır.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <HelpKey>Sil</HelpKey> düyməsi fakturanı təsdiq pəncərəsindən sonra büsbütün silir və bu
          geri qaytarılmır. Ödənişi olan fakturanı silmək yerinə statusunu dəyişməyi düşünün.
          Zəncirdəki addımı «Başlat»dan əvvəl mütləq <HelpKey>Addımları saxla</HelpKey> ilə yadda
          saxlayın — yoxsa start işləməyəcək.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün fakturalar, ödənişlər və zəncir təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın
          fakturasını görür və dəyişirsiniz. Faktura göndərmə, ödəniş qeydi və silmə kimi əməliyyatlar{" "}
          <strong>Fəaliyyət</strong> tabındakı audit qeydinə düşür.
        </p>
      </HelpCallout>
    </div>
  )
}
