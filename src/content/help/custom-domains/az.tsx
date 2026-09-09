"use client"

/**
 * Custom Domains — help article (Azerbaijani).
 * Tənzimləmələr → Xüsusi Domenlər səhifəsini əhatə edir:
 * öz domeninizi qoşmaq, CNAME yazısını qurmaq, DNS-i yoxlamaq,
 * status (Gözləmədə / DNS təsdiqləndi / Aktiv / Xəta) və domeni silmək.
 * Açılış səhifələri öz brendli domeninizdə yayımlanır.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CustomDomainsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq və ya əməliyyat administratorusunuz"
        goal="Açılış səhifələrini ümumi URL əvəzinə öz brendli domeninizdə (məs. landing.sirketiniz.com) yayımlamaq"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Xüsusi Domenlər</HelpKey> yolu ilə
        çatırsınız. Bütün domenlər yalnız sizin təşkilatınız üçündür. Quraşdırma üç hissədən ibarətdir:
        domeni burada əlavə edirsiniz, DNS provayderinizdə bir CNAME yazısı yaradırsınız, sonra geri
        qayıdıb <HelpKey>DNS yoxla</HelpKey> ilə təsdiqləyirsiniz. CNAME-i sizdən kənar bir yerdə —
        domeninizi aldığınız provayderin panelində — əlavə etməlisiniz.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda yer kürəsi ikonası ilə <HelpKey>Xüsusi Domenlər</HelpKey> adı, altında «Açılış
          səhifələri üçün öz domeninizi qoşun» izahı, sağ yuxarıda isə <HelpKey>Domen əlavə et</HelpKey>{" "}
          düyməsi var. Aşağıda həmişə görünən <strong>«Xüsusi Domenlər Necə İşləyir»</strong> üç addımlıq
          bələdçi durur (2-ci addımda CNAME nümunəsi və kopyalama düyməsi ilə), sonra bir{" "}
          <strong>«Nümunə Quraşdırma»</strong> kartı, ən altda isə domen siyahısı gəlir — hələ heç domen
          yoxdursa, bunun yerinə boş vəziyyət göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Domen">Açılış səhifələriniz üçün qoşduğunuz alt domen, məsələn landing.sirketiniz.com.</HelpDef>
          <HelpDef term="CNAME yazısı">DNS provayderinizdə yaratdığınız yönləndirmə — domeninizi bizim hədəfimizə (pages.leaddrivecrm.org) işarələyir.</HelpDef>
          <HelpDef term="Gözləmədə">Domen əlavə edilib, amma DNS hələ yoxlanmayıb (sarı nişan, saat ikonası).</HelpDef>
          <HelpDef term="DNS təsdiqləndi">CNAME tapıldı və düzgündür, SSL hələ verilməyib (mavi nişan).</HelpDef>
          <HelpDef term="Aktiv">SSL sertifikatı verilib, domen tam işləkdir (yaşıl nişan, qalxan ikonası).</HelpDef>
          <HelpDef term="Xəta">Yoxlama uğursuz oldu; sətrin altında qırmızı xəta mesajı görünür.</HelpDef>
        </dl>
        <p>
          Domen siyahısı cədvəl şəklindədir: <strong>Domen</strong> (server ikonası ilə, monospace
          yazıda), <strong>Status</strong> (rəngli nişan), <strong>Əlavə edildi</strong> (tarix) və{" "}
          <strong>Əməliyyatlar</strong> sütunları. Status <HelpKey>Gözləmədə</HelpKey> və ya{" "}
          <HelpKey>Xəta</HelpKey> olduqda sətirdə <HelpKey>DNS yoxla</HelpKey> düyməsi çıxır; hər sətirdə
          qırmızı zibil qutusu (sil) düyməsi var. Domen <HelpKey>Aktiv</HelpKey> olanda adın yanında onu
          yeni tabda açan kiçik bayır-keçid ikonası görünür.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: domen əlavə et">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Domen əlavə et</HelpKey> düyməsini basın. (Heç domen yoxdursa, boş
            vəziyyətin ortasındakı eyni adlı düymə də işləyir.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Xüsusi Domen Əlavə Et» başlıqlı pəncərə açılır. İçində <strong>Domen</strong> mətn sahəsi
            («landing.sirketiniz.com» nümunəsi ilə), altında «Alt domen istifadə edin, məsələn
            landing.sirketiniz.com və ya pages.sirketiniz.com» ipucusu, aşağıda isə{" "}
            <HelpKey>Ləğv et</HelpKey> və <HelpKey>Əlavə et</HelpKey> düymələri var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Domeni daxil edin (məsələn <HelpKey>landing.sirketiniz.com</HelpKey>) və{" "}
            <HelpKey>Əlavə et</HelpKey> düyməsini basın. Enter düyməsi də göndərir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mətn sahəsi boşdursa <HelpKey>Əlavə et</HelpKey> düyməsi sönük (söndürülmüş) qalır. Daxil
            etdikdən sonra domen kiçik hərflərə çevrilərək yadda saxlanır; uğurlu olduqda «Domen əlavə
            edildi» bildirişi çıxır, pəncərə bağlanır və domen cədvəldə <HelpKey>Gözləmədə</HelpKey>{" "}
            statusu ilə peyda olur. Domen artıq mövcuddursa və ya səhvdirsə, qırmızı xəta bildirişi
            görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: DNS-i qur və yoxla">
        <HelpStep n={1}>
          <p>
            «Xüsusi Domenlər Necə İşləyir» bələdçisinin 2-ci addımındakı CNAME blokuna baxın. Orada{" "}
            <strong>Yazı Növü</strong> = <HelpKey>CNAME</HelpKey>, <strong>Host / Ad</strong> = sizin alt
            domeniniz və <strong>Dəyər / Hədəf</strong> = <HelpKey>pages.leaddrivecrm.org</HelpKey> göstərilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hədəfin yanındakı kopyalama ikonasını bassanız, dəyər buferə kopyalanır, ikona qısa müddət
            yaşıl təsdiq işarəsinə çevrilir və «Buferə kopyalandı!» bildirişi çıxır. Blokun altında
            «DNS yayılması 48 saata qədər vaxt ala bilər» qeydi durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            DNS provayderinizin (domeni aldığınız xidmət) panelinə keçin və yeni{" "}
            <strong>CNAME</strong> yazısı yaradın: host kimi alt domeninizi, dəyər kimi isə{" "}
            <HelpKey>pages.leaddrivecrm.org</HelpKey> qoyun. Dəyişiklikləri yadda saxlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bu addım LeadDrive-dan kənarda, provayderin öz panelində baş verir. Nümunə üçün səhifədəki
            «Nümunə Quraşdırma» kartına baxın: <strong>landing.yourcompany.com</strong> →{" "}
            <strong>CNAME</strong> → <strong>pages.leaddrivecrm.org</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            LeadDrive-a qayıdın və domen sətrindəki <HelpKey>DNS yoxla</HelpKey> düyməsini basın (bu
            düymə yalnız <HelpKey>Gözləmədə</HelpKey> və ya <HelpKey>Xəta</HelpKey> statuslu domenlərdə
            görünür).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yoxlanış zamanı «Yoxlanılır...» yazısına keçir və ikonası fırlanır. Tapılarsa «DNS
            uğurla təsdiqləndi!» bildirişi çıxır və status irəliləyir; tapılmasa «DNS yoxlaması uğursuz
            oldu. CNAME-in pages.leaddrivecrm.org-a yönləndiyinə əmin olun» bildirişi göstərilir və status{" "}
            <HelpKey>Xəta</HelpKey> ola bilər.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Status <HelpKey>Aktiv</HelpKey> olana qədər gözləyin — SSL sertifikatı təsdiqdən sonra
            avtomatik verilir, əlavə əməliyyat tələb olunmur.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Status nişanı yaşıl qalxan ikonalı <HelpKey>Aktiv</HelpKey>-ə keçir, domen adının yanında
            isə onu yeni tabda açan bayır-keçid ikonası görünür. Bundan sonra ziyarətçilər açılış
            səhifələrinizi öz domeninizdə görür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: domeni sil">
        <HelpStep n={1}>
          <p>
            Domen sətrinin sağındakı qırmızı zibil qutusu ikonalı düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Bu domeni silmək istədiyinizə əminsiniz?» başlıqlı təsdiq pəncərəsi açılır. İçində «Açılış
            səhifələri artıq bu domendə əlçatan olmayacaq» izahı və monospace yazıda silinəcək domenin
            adı, aşağıda isə <HelpKey>Ləğv et</HelpKey> və qırmızı <HelpKey>Sil</HelpKey> düymələri var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Qırmızı <HelpKey>Sil</HelpKey> düyməsini basaraq təsdiqləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Domen silindi» bildirişi çıxır, pəncərə bağlanır və domen cədvəldən yox olur. Bu sonuncu
            domen idisə, səhifə yenidən boş vəziyyəti göstərir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Adi domen əvəzinə alt domen istifadə edin (məs. <HelpKey>landing.sirketiniz.com</HelpKey> və
          ya <HelpKey>pages.sirketiniz.com</HelpKey>) — bu, əsas saytınıza toxunmadan açılış səhifələrini
          ayrıca yayımlamağa imkan verir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          DNS yayılması <strong>48 saata qədər</strong> çəkə bilər. CNAME-i təzəcə əlavə etmisinizsə və
          yoxlama uğursuz olursa, bu normaldır — bir az gözləyib <HelpKey>DNS yoxla</HelpKey> ilə yenidən
          cəhd edin. Hədəfin dəqiq <HelpKey>pages.leaddrivecrm.org</HelpKey> olduğunu yoxlayın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün domenlər təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın domenlərini görür və idarə
          edirsiniz. SSL sertifikatı domen təsdiqləndikdən sonra avtomatik verilir; sertifikatı əl ilə
          yükləmək lazım deyil.
        </p>
      </HelpCallout>
    </div>
  )
}
