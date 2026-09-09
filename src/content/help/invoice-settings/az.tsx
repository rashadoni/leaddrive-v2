"use client"

/**
 * Invoice Settings — help article (Azerbaijani).
 * Yalnız Tənzimləmələr → Hesab-faktura parametrləri səhifəsini əhatə edir:
 * şirkət məlumatları, faktura defoltları (nömrə prefiksi / ödəniş şərti /
 * vergi dərəcəsi / valyuta), bank rekvizitləri, imzalayan + möhür + akt
 * imzalayan, defolt mətnlər və üç dilli e-poçt şablonları. Faktura YARATMA
 * və ya göndərmə bura DAXİL DEYİL — bu, yalnız parametrlər səhifəsidir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function invoicesettingsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Maliyyə və ya əməliyyat administratorusunuz"
        goal="Bütün hesab-fakturalara avtomatik düşən şirkət rekvizitlərini, bank məlumatlarını, imza/möhürü və e-poçt şablonlarını bir dəfə təyin etmək"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Hesab-faktura parametrləri</HelpKey> yolu
        ilə çatırsınız. Burada qeyd etdiyiniz hər şey yalnız sizin təşkilatınız üçündür və yeni
        yaradılan fakturalara <strong>defolt</strong> kimi tətbiq olunur — istəsəniz hər fakturada
        ayrıca dəyişdirə bilərsiniz. Heç nə avtomatik yadda saxlanmır: dəyişiklikləri sağ yuxarıdakı
        <HelpKey>Saxla</HelpKey> düyməsi ilə təsdiqləməlisiniz.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda dişli çarx ikonası ilə <HelpKey>Hesab-faktura parametrləri</HelpKey> adı, altında
          «Hesab-faktura defoltları, brendinq və bank rekvizitləri» izahı və bir kömək sətri durur.
          Sağ yuxarıda <HelpKey>Saxla</HelpKey> düyməsi var; saxlama nəticəsi (yaşıl «Uğurla
          saxlanıldı» və ya qırmızı xəta) düymənin yanında görünür. Aşağıda bir-birinin ardınca altı
          kart gəlir:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Company Information">Fakturada göstərilən şirkət rekvizitləri: ad, ünvan, VÖEN, e-poçt, telefon və logo URL. Təşkilat adından fərqli ola bilər.</HelpDef>
          <HelpDef term="Default Settings">Yeni fakturalara tətbiq olunan defoltlar: nömrə prefiksi, ödəniş şərti, vergi dərəcəsi və valyuta. Hər fakturada ayrıca dəyişdirilə bilər.</HelpDef>
          <HelpDef term="Bank Rekvizitləri">Hesab-fakturada göstəriləcək bank məlumatları: bank adı, kod (MFO), SWIFT, hesab nömrəsi, VÖEN və müxbir hesab.</HelpDef>
          <HelpDef term="İmzalayan və Möhür">Fakturanı imzalayan şəxsin adı/vəzifəsi, şirkət möhürünün skanı, həmçinin ayrıca akt (Təhvil-Təslim Aktı) imzalayanın məlumatları və imza skanı.</HelpDef>
          <HelpDef term="Default Text">Hər fakturaya düşən standart şərtlər (Terms &amp; Conditions) və alt qeyd (Footer Note) mətni.</HelpDef>
          <HelpDef term="E-poçt şablonları">Faktura göndərilərkən istifadə olunan e-poçt mətni — hər dil (AZ / Rus / İngilis) üçün ayrı: Müraciət, Əsas mətn, Bağlanış və Alt qeyd.</HelpDef>
        </dl>
        <p>
          Səhifə ilk açılışda kiçilmiş boz lövhə (skelet) göstərir — bu, mövcud parametrlərinizin
          yüklənməsidir; bir neçə an sonra sahələr əvvəl saxlanmış dəyərlərlə dolur.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: şirkət məlumatlarını doldur">
        <HelpStep n={1}>
          <p>
            Birinci kartda — <HelpKey>Company Information</HelpKey> — <strong>Company Name</strong>{" "}
            (şirkət adı), <strong>Company Address</strong> (ünvan) sahələrini doldurun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sahənin içində nümunə mətn (placeholder) var — məsələn ad sahəsində «Your Company
            LLC», ünvan sahəsində «123 Main St, Baku, Azerbaijan». Yazmağa başlayanda nümunə itir,
            mətniniz görünür. Ünvan çoxsətirli sahədir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Aşağıdakı cüt sahələri doldurun: <strong>VÖEN</strong> və <strong>E-poçt</strong>, sonra
            <strong>Telefon</strong> və <strong>Logo URL</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahələr iki sütunda yerləşir. E-poçt sahəsi e-poçt formatı gözləyir. Logo URL altında
            «Optional — displayed on invoice header» qeydi var, yəni bu, məcburi deyil və faktura
            başlığında göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: faktura defoltlarını təyin et">
        <HelpStep n={1}>
          <p>
            <HelpKey>Default Settings</HelpKey> kartında <strong>Number Prefix</strong> sahəsinə
            faktura nömrəsi üçün prefiks yazın (məs. <HelpKey>INV-</HelpKey> və ya{" "}
            <HelpKey>KP-</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahənin altında «Prefix for invoice numbers, e.g. INV-001, KP-001» ipucusu görünür —
            yəni prefiks nömrənin əvvəlinə əlavə olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Default Payment Terms</strong> açılan siyahısından ödəniş şərtini seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahıda hazır seçimlər var: <strong>Due on Receipt</strong> (alınanda),{" "}
            <strong>Net 15</strong>, <strong>Net 30</strong>, <strong>Net 45</strong> və{" "}
            <strong>Net 60</strong> (gün sayı). Standart seçim Net 30-dur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Default Tax Rate</strong> sahəsinə vergi dərəcəsini faiz olaraq yazın və{" "}
            <strong>Default Currency</strong> açılan siyahısından valyutanı seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Vergi sahəsi yalnız rəqəm qəbul edir, sağında <strong>%</strong> işarəsi durur, altında
            isə «Standard VAT rate in Azerbaijan is 18%» qeydi var. Valyuta siyahısında hər sətir
            valyuta kodu və simvolu ilə göstərilir (məs. AZN ₼).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: bank rekvizitlərini doldur">
        <HelpStep n={1}>
          <p>
            <HelpKey>Bank Rekvizitləri</HelpKey> kartında cüt-cüt düzülmüş sahələri doldurun:{" "}
            <strong>Bank adı</strong> və <strong>Kod (MFO)</strong>, sonra <strong>SWIFT</strong> və{" "}
            <strong>Hesab nömrəsi</strong>, ən sonda <strong>VÖEN</strong> və{" "}
            <strong>Müxbir hesab</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sahədə nümunə dəyər var — məsələn bank adında «Example Bank ASC», hesab nömrəsində
            «AZ00AIIB00000000000000000000» kimi IBAN nümunəsi. Bu məlumatlar göndərilən hesab-fakturada
            görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: imzalayan, möhür və akt imzalayanı təyin et">
        <HelpStep n={1}>
          <p>
            <HelpKey>İmzalayan və Möhür</HelpKey> kartında fakturanı imzalayan şəxsin{" "}
            <strong>Ad Soyad</strong> və <strong>Vəzifə</strong> sahələrini doldurun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İki sütunlu sahələr; nümunə kimi «Yusif Rzayev» və «Director of LeadDrive Inc.» göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Şirkət Möhürü (skan)</strong> sahəsində kəsik-xətli yükləmə zolağına basıb möhür
            şəklini seçin (PNG, JPG — maks 2MB).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hələ möhür yoxdursa, yuxarı ox ikonalı «Möhür şəklini yükləyin» zolağı görünür. Şəkil
            seçildikdən sonra ağ fon avtomatik şəffaf edilir, sol tərəfdə kiçik önbaxış, sağda yaşıl
            «✓ Möhür yüklənib» yazısı və <HelpKey>Dəyişdir</HelpKey> düyməsi çıxır; önbaxışın küncündəki
            × ilə şəkli silmək olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Eyni kartın aşağısındakı <strong>Akt imzalayan (Təhvil-Təslim Aktı)</strong> bölməsində
            akt sənədini imzalayanın <strong>Ad Soyad</strong>, <strong>Vəzifə</strong> sahələrini
            doldurun və <strong>İmza (skan)</strong> şəklini yükləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bu bölmə bir ayırıcı xəttdən sonra gəlir. İmza yükləndikdə önbaxış, yaşıl «✓ İmza
            yüklənib» yazısı və <HelpKey>Dəyişdir</HelpKey> düyməsi göstərilir; bu imza möhürdən ayrı,
            yalnız akt sənədinə əlavə olunur.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Möhür və imza şəkilləri yüklənərkən ağ/açıq fon avtomatik kəsilib şəffaf edilir, ona görə
            adi ağ kağız üzərində skan da yaxşı nəticə verir. Ən təmiz görünüş üçün şəffaf fonlu PNG
            istifadə edin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: defolt mətnlər və e-poçt şablonları">
        <HelpStep n={1}>
          <p>
            <HelpKey>Default Text</HelpKey> kartında <strong>Default Terms &amp; Conditions</strong>{" "}
            (şərtlər) və <strong>Default Footer Note</strong> (alt qeyd) çoxsətirli sahələrini
            doldurun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər iki sahə çoxsətirlidir və nümunə mətnlə gəlir («Payment is due within the specified
            terms…» və «Thank you for your business!»). Bu mətnlər hər fakturaya düşür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>E-poçt şablonları</HelpKey> kartının yuxarısındakı dil nişanlarından birini seçin:{" "}
            <HelpKey>Azərbaycan</HelpKey>, <HelpKey>Rus</HelpKey> və ya <HelpKey>İngilis</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş nişanın altı firuzəyi xətlə vurğulanır. Altdakı sahələr — <strong>Müraciət</strong>,{" "}
            <strong>Əsas mətn</strong>, <strong>Bağlanış</strong>, <strong>Alt qeyd</strong> — yalnız
            həmin dilin mətnini göstərir; başqa nişana keçəndə həmin dilin mətni görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Seçdiyiniz dil üçün <strong>Müraciət</strong>, <strong>Əsas mətn</strong>,{" "}
            <strong>Bağlanış</strong> və <strong>Alt qeyd</strong> sahələrini yazın. Mətndə
            dəyişənlərdən istifadə edə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kartın altında boz qutuda mövcud dəyişənlərin siyahısı durur:{" "}
            <HelpKey>{"{orgName}"}</HelpKey> — şirkət adı, <HelpKey>{"{invoiceNumber}"}</HelpKey> —
            faktura nömrəsi, <HelpKey>{"{total}"}</HelpKey> — yekun məbləğ,{" "}
            <HelpKey>{"{currency}"}</HelpKey> — valyuta, <HelpKey>{"{dueDate}"}</HelpKey> — ödəniş
            tarixi. Göndərilərkən bu dəyişənlər real qiymətlərlə əvəz olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Hər üç dilin şablonunu istəsəniz ardıcıl olaraq nişanları dəyişib doldurun — daxil
            etdiyiniz mətnlər nişanlar arasında keçəndə itmir, hamısı birlikdə saxlanılır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bir dildən digərinə keçəndə əvvəlki dildə yazdıqlarınız qorunur; geri qayıtdıqda yenidən
            görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: dəyişiklikləri saxla">
        <HelpStep n={1}>
          <p>
            Bütün kartları doldurduqdan sonra sağ yuxarıdakı <HelpKey>Saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə saxlama müddətində fırlanan ikona göstərir və müvəqqəti deaktiv olur. Uğurlu
            saxlamadan sonra düymənin yanında yaşıl tik ilə <strong>Uğurla saxlanıldı</strong> mesajı,
            səhv olarsa qırmızı işarə ilə <strong>Saxlama xətası</strong> görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          Bu səhifədəki dəyişikliklər <strong>avtomatik yadda saxlanmır</strong>. Hər hansı sahəni
          dəyişdikdən sonra <HelpKey>Saxla</HelpKey> düyməsini basmasanız və səhifədən çıxsanız,
          dəyişikliklər itir. Yaşıl «Uğurla saxlanıldı» mesajını gördükdən sonra çıxın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün hesab-faktura parametrləri təşkilatınızla məhdudlaşır — burada qoyduğunuz dəyərlər
          yalnız sizin tenant-ınızın fakturalarına tətbiq olunur və başqa təşkilatlar tərəfindən
          görünmür. Saxlama zamanı parametrlər yalnız sizin təşkilat kimliyiniz altında yenilənir.
        </p>
      </HelpCallout>
    </div>
  )
}
