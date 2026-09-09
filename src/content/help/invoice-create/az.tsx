"use client"

/**
 * Create Invoice — help article (Azerbaijani).
 * Yalnız Hesab-fakturalar → Hesab-faktura yarat səhifəsini əhatə edir
 * (gradient başlıq + avtomatik nömrə, Müştəri kartı, Mövqelər cədvəli,
 * Detallar + qabaqcıl sahələr, Qeydlər və şərtlər, Yekun + Qaralama/Göndər).
 * Hesab-faktura siyahısı və ayarlar bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InvoiceCreateHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış və ya mühasibatlıq üzrə işçisiniz"
        goal="Müştəriyə göndərmək üçün yeni hesab-faktura tərtib etmək — şirkəti, mövqeləri, endirim/ƏDV və ödəniş şərtlərini bir səhifədə doldurmaq"
      >
        Səhifəyə <HelpKey>Hesab-fakturalar</HelpKey> siyahısından <HelpKey>Hesab-faktura yarat</HelpKey> ilə
        çatırsınız. Bütün siyahılar — şirkətlər, kontaktlar, sövdələşmələr, müqavilələr və məhsullar —
        yalnız sizin təşkilatınızdan oxunur. Hesab-faktura nömrəsi siz heç nə yazmadan avtomatik
        verilir. Yekun (ara cəm, endirim, ƏDV, ümumi məbləğ) siz mövqeləri doldurduqca canlı hesablanır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda mavi gradient başlıq var: solda <HelpKey>Hesab-fakturalara qayıt</HelpKey> düyməsi,
          ortada «Hesab-faktura yarat» yazısı və altında ad (başlıq) sahəsi, sağda isə avtomatik
          verilən hesab-faktura nömrəsi nişanı. Aşağıda yuxarıdan-aşağıya beş kart düzülür:{" "}
          <strong>Müştəri</strong>, <strong>Mövqelər</strong>, <strong>Detallar</strong>,{" "}
          <strong>Qeydlər və şərtlər</strong> (yığcam) və <strong>Yekun</strong> (alt hissə —
          hesablamalar və yadda saxlama düymələri).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ad (başlıq)">Başlıqdakı sahə — hesab-fakturaya verdiyiniz ad (məs. «İnkişaf xidmətləri — mart 2026»). Boş buraxsanız, nömrə və ya tarix əsasında avtomatik ad qoyulur.</HelpDef>
          <HelpDef term="Hesab-faktura nömrəsi">Sağ yuxarıdakı nişan — sistem tərəfindən avtomatik verilir, redaktə edilmir.</HelpDef>
          <HelpDef term="Şirkət">Yeganə məcburi seçim — kimə hesab-faktura kəsdiyiniz. Axtarış qutusuna yazaraq seçilir.</HelpDef>
          <HelpDef term="Mövqe">Cədvəldəki bir sətir — məhsul/xidmət adı, miqdarı, qiyməti və sətir cəmi.</HelpDef>
          <HelpDef term="Ara cəm">Bütün mövqe cəmlərinin toplamı (sətir endirimlərindən sonra, ümumi endirim və ƏDV-dən əvvəl).</HelpDef>
          <HelpDef term="Ödəniş şərtləri">«Dərhal / 15 / 30 / 45 / 60 gün» — seçdikcə Ödəniş tarixi avtomatik hesablanır.</HelpDef>
          <HelpDef term="ƏDV">18% dərəcə — qeyd qutusunu işarələdikdə endirimdən sonrakı məbləğə əlavə olunur.</HelpDef>
          <HelpDef term="Qaralama / Göndər">İki yadda saxlama rejimi — qaralama (qaralama statusu) və ya saxla-və-göndər (göndərildi statusu).</HelpDef>
        </dl>
        <p>
          <strong>Detallar</strong> kartının altında «Qabaqcıl sahələri göstər (VÖEN, imzalayan,
          müqavilə, dil)» keçidi var — basanda gizli sahələr açılır. <strong>Qeydlər və şərtlər</strong>{" "}
          kartı isə standart olaraq yığılıdır; içində nə isə doldurulubsa, başlıqda narıncı{" "}
          <strong>● dolu</strong> göstəricisi, boşdursa <strong>seçimə görə</strong> yazısı görünür.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: hesab-faktura yarat">
        <HelpStep n={1}>
          <p>
            İstəsəniz başlıqdakı ad sahəsinə hesab-fakturanın adını yazın. Bu, məcburi deyil.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mavi başlıqda «İnkişaf xidmətləri — mart 2026» kimi nümunə mətn (placeholder) durur; yazdıqca
            sizin mətniniz onu əvəz edir. Sağ yuxarıda hesab-faktura nömrəsi nişanı artıq doldurulub.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Müştəri</strong> kartında <HelpKey>Şirkət</HelpKey> axtarış qutusuna şirkət adını
            yazmağa başlayın və açılan siyahıdan birini seçin. Bu — yeganə məcburi sahədir (yanında *).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca uyğun şirkətlərin açılan siyahısı çıxır (ən çox 15 nəticə). Uyğun gələn yoxdursa
            «No companies found» mətni görünür. Şirkət seçəndən sonra yandakı{" "}
            <HelpKey>Əlaqədar şəxs</HelpKey> və <HelpKey>Sövdələşmə</HelpKey> açılan siyahıları
            işəyararlı olur və həmin şirkətin kontaktları ilə sövdələşmələri ilə dolur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İstəyə bağlı olaraq <HelpKey>Əlaqədar şəxs</HelpKey> və <HelpKey>Sövdələşmə</HelpKey> seçin.
            Sövdələşmə seçsəniz, bəzi sahələr ondan avtomatik doldurulur.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Şirkət seçilməyibsə bu siyahılarda «Əvvəlcə şirkət seçin» yazısı durur; sövdələşmə yoxdursa
            «Sövdələşmə yoxdur» görünür. Sövdələşmə seçdikdə onun adı başlığa, valyutası valyuta sahəsinə
            keçir və ilk mövqe sövdələşmənin adı və məbləği ilə doldurulur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <strong>Mövqelər</strong> cədvəlində ilk sətrin <HelpKey>Məhsul, xidmət və ya işin
            təsnifatı</HelpKey> xanasına ad yazın, sonra <HelpKey>Miqdar</HelpKey> və{" "}
            <HelpKey>Qiymət</HelpKey> daxil edin. Hazır məhsul siyahısından əlavə etmək üçün sağ
            yuxarıdakı <HelpKey>Məhsullardan</HelpKey> düyməsindən istifadə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəlin başlığı mavi (firuzəyi) zolaqdır; standart sütunlar: ad, <strong>Layihə</strong>,{" "}
            <strong>Ö/V</strong> (ölçü vahidi), Miqdar, Qiymət və <strong>Məbləğ</strong>. Miqdar ×
            Qiymət sətrin sağındakı <strong>Məbləğ</strong> xanasında dərhal hesablanır.{" "}
            <HelpKey>Məhsullardan</HelpKey> düyməsini basanda məhsulların açılan siyahısı (ad və qiymət ilə)
            çıxır; birini seçəndə yeni sətir kimi əlavə olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Daha çox sətir lazımdırsa <HelpKey>Mövqe əlavə et</HelpKey> (və ya cədvəlin altındakı{" "}
            <HelpKey>Daha əlavə et</HelpKey>) düyməsini basın. Öz sütununuzu yaratmaq üçün{" "}
            <HelpKey>Column</HelpKey> düyməsini basın. Artıq sətri silmək üçün sətrin sonundakı zibil
            qutusu ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Column</HelpKey> düyməsi sütun adını soruşan kiçik pəncərə açır; təsdiqlədikdə yeni
            sütun cədvələ əlavə olunur (başlığını birbaşa cədvəldə redaktə edə, yanındakı × ilə silə
            bilərsiniz). Cədvəldə yalnız bir sətir qalıbsa, onun silmə düyməsi söndürülmüş olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            <strong>Detallar</strong> kartında <HelpKey>Tarix</HelpKey> (verilmə tarixi),{" "}
            <HelpKey>Valyuta</HelpKey> və <HelpKey>Ödəniş şərtləri</HelpKey> seçin. Hesab-faktura nömrəsi
            və <HelpKey>Ödəniş tarixi</HelpKey> avtomatik gəlir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Hesab-faktura nömrəsi</HelpKey> xanası boz fonludur və yazıla bilməz (yalnız oxunur).
            Ödəniş şərtlərini dəyişdikcə <HelpKey>Ödəniş tarixi</HelpKey> verilmə tarixinə uyğun olaraq
            avtomatik yenilənir (məs. «30 gün» seçəndə tarix +30 gün olur). İstəsəniz Ödəniş tarixini əl
            ilə dəyişə bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={7}>
          <p>
            VÖEN, sənəd dili, imzalayan və ya müqavilə lazımdırsa, <HelpKey>Qabaqcıl sahələri göstər</HelpKey>{" "}
            keçidini basın və açılan sahələri doldurun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Keçidin altında <strong>VÖEN</strong>, <strong>Dil</strong> (Azərbaycan / Rus / İngilis),{" "}
            <strong>İmzalayan</strong> və <strong>İmzalayanın vəzifəsi</strong> sahələri açılır. Aşağıda
            <strong> Müqavilə</strong> açılan siyahısı və yanında redaktə edilə bilən nömrə/tarix
            xanaları var — müqavilə seçəndə nömrə və başlama tarixi avtomatik doldurulur; «Müqavilə seçin
            və ya əl ilə daxil edin» izahı altda görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={8}>
          <p>
            İstəyə bağlı olaraq <HelpKey>Qeydlər və şərtlər</HelpKey> kartının başlığına basıb açın və{" "}
            <strong>Qeydlər</strong>, <strong>Şərtlər</strong>, <strong>Alt qeyd</strong> sahələrini
            doldurun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart açılır və üç mətn sahəsi görünür. Nə isə yazsanız, kart yığılı olanda başlıqda narıncı{" "}
            <strong>● dolu</strong> göstəricisi qalır, beləcə içəridə məlumat olduğunu yığmadan da
            bilirsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={9}>
          <p>
            <strong>Yekun</strong> kartında lazım olsa <HelpKey>Endirim</HelpKey> (% və ya məbləğ olaraq)
            və <HelpKey>ƏDV daxil et (18%)</HelpKey> qeyd qutusunu seçin, <HelpKey>Yekun</HelpKey> məbləği
            yoxlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Ara cəm</strong>, endirim sətri (varsa qırmızı mənfi məbləğ), seçilibsə{" "}
            <strong>ƏDV (18%)</strong> sətri və ən altda iri şriftlə <strong>Yekun</strong> məbləği canlı
            yenilənir. Endirimin valyuta/faiz seçimi və dəyəri burada idarə olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={10}>
          <p>
            Bitirdikdə <HelpKey>Qaralama saxla</HelpKey> (sonra göndərmək üçün) və ya{" "}
            <HelpKey>Saxla və göndər</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymələr «Saxlanılır...» yazısına keçir, sonra yaradılan hesab-fakturanın səhifəsinə
            yönləndirilirsiniz. Şirkət seçməsəniz «Şirkət seçin», adı olan heç bir mövqe yoxdursa «Ən azı
            bir mövqe əlavə edin» bildirişi (toast) çıxır və yadda saxlama dayanır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Tez yol: əvvəlcə şirkəti, sonra <HelpKey>Sövdələşmə</HelpKey>ni seçin — sövdələşmənin adı,
          valyutası və məbləği başlığa və ilk mövqeyə avtomatik köçürülür, beləcə əl ilə daha az yazırsınız.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Yadda saxlamaq üçün iki şey mütləqdir: bir <strong>Şirkət</strong> seçilməli və adı olan ən azı
          bir <strong>Mövqe</strong> olmalıdır. Hesab-faktura nömrəsini dəyişə bilməzsiniz — o, sistem
          tərəfindən verilir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün açılan siyahılar — şirkətlər, kontaktlar, sövdələşmələr, müqavilələr və məhsullar — yalnız
          sizin təşkilatınızdan gəlir; başqa tenant-ın məlumatını seçə bilməzsiniz. Yaradılan hesab-faktura
          da sizin təşkilatınıza bağlanır.
        </p>
      </HelpCallout>
    </div>
  )
}
