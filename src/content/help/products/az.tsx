"use client"

/**
 * Məhsullar və Xidmətlər — help məqaləsi (Azərbaycan dili).
 * en.tsx-in güzgüsü: /products kataloqu — satdığınız hər şeyin təkrar
 * istifadəli siyahısı (xidmət / məhsul / əlavə / konsaltinq), qiymət,
 * valyuta, xüsusiyyətlər, teqlər və aktivlik bayrağı; həmçinin məhsul
 * səhifəsi və anbar qalığı olduqda silmə qoruması.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ProductsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Bu nə üçün vacibdir">
        <p>
          <strong>Məhsullar və Xidmətlər</strong> sizin kataloqunuzdur — satdığınız hər şeyin təkrar
          istifadəli siyahısı. Hər təklifi qiymət və kateqoriya ilə bir dəfə təyin edin və o, hər
          yazıda eyni şeyi yenidən yazmaq əvəzinə təkrar istifadə edə biləcəyiniz tikinti blokuna
          çevrilsin.
        </p>
        <p>
          Kataloq qeydi birdəfəlik <em>məhsul</em>, davamlı <em>xidmət</em>, <em>əlavə</em> və ya{" "}
          <em>konsaltinq</em> ola bilər. Burada onu səliqəli saxlasanız, qiymətləriniz hər yerdə
          eyni qalacaq.
        </p>
      </HelpSection>

      <HelpSection title="Kataloq qeydi nəyi saxlayır">
        <p>
          Hər məhsulun adı, kateqoriyası, seçilmiş valyutada qiyməti, aktivlik bayrağı və iki sərbəst
          siyahısı var — xüsusiyyətlər və teqlər.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ad">Məcburi — məhsulun və ya xidmətin adı.</HelpDef>
          <HelpDef term="Kateqoriya">Xidmət, Məhsul, Əlavə və ya Konsaltinq.</HelpDef>
          <HelpDef term="Qiymət">Rəqəm üstəgəl valyuta; <strong>0</strong> <em>Pulsuz</em> kimi göstərilir.</HelpDef>
          <HelpDef term="Xüsusiyyətlər">Vergüllə ayrılmış siyahı (məs., <em>Azure/AWS, Fasiləsiz</em>).</HelpDef>
          <HelpDef term="Teqlər">Qruplaşdırma və axtarış üçün vergüllə ayrılmış siyahı.</HelpDef>
          <HelpDef term="Status">Aktiv və ya Qeyri-aktiv — sadə əlçatanlıq bayrağı.</HelpDef>
        </dl>
        <HelpCallout kind="tip">
          <p>
            <strong>Xüsusiyyətlər</strong> və <strong>teqlər</strong> hər ikisi vergüllə ayrılmış adi
            mətn kimi yazılır — «Məlumat köçürməsi, Dəstək» iki ayrı çipə çevrilir. Vergüllərin
            ətrafındakı boşluqlar kəsilir, boş elementlər atılır, ona görə də dəqiq olmağınıza ehtiyac
            yoxdur.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Məhsul əlavə et və ya redaktə et">
        <HelpStep n={1}>
          <p>
            <HelpKey>Yeni məhsul</HelpKey> düyməsini basın. Adı (məcburi) və könüllü təsviri yazın,
            kateqoriya seçin və valyutası ilə qiymət təyin edin.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Xüsusiyyətlər və teqləri vergüllə ayrılmış mətn kimi əlavə edin və məhsul satışa açıqdırsa{" "}
            <HelpKey>Aktiv</HelpKey> bayrağını açıq saxlayın. <HelpKey>Məhsul yarat</HelpKey> ilə
            yadda saxlayın.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Qeydi sonradan dəyişmək üçün onun sətrindəki <HelpKey>qələm</HelpKey> ikonuna toxunun (ya
            da məhsulu açıb <HelpKey>Redaktə et</HelpKey> basın), sahələri düzəldin və{" "}
            <HelpKey>Dəyişiklikləri saxla</HelpKey> edin.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Valyuta menyusunda sabit kod dəsti var (AZN, USD, EUR, GBP, RUB, PLN və başqaları). Qiymət
            və valyuta hər məhsul üçün ayrıca saxlanılır; valyutalar arasında avtomatik çevrilmə
            yoxdur, ona görə də hər qeydi faktiki hesab kəsdiyiniz valyutada təyin edin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Kataloq siyahısı">
        <p>
          Səhifənin yuxarısında dörd sayğac var: <strong>Cəmi məhsul</strong>, <strong>Aktiv</strong>,{" "}
          <strong>Ümumi dəyər</strong> (bütün məhsulların qiymətlərinin cəmi) və{" "}
          <strong>Kateqoriyalar</strong> (neçə fərqli kateqoriya işlətdiyiniz).
        </p>
        <HelpStep n={1}>
          <p>
            Kateqoriya həbləri ilə süzün (<HelpKey>Hamısı</HelpKey>, Xidmət, Məhsul, Əlavə,
            Konsaltinq). Kateqoriya həbi yalnız ən azı bir məhsul onu işlətdikdə görünür və öz
            sayğacını göstərir.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Cədvəlin axtarış xanasında ada görə axtarın. <strong>Qiymət</strong> sütunu məbləği
            valyutası ilə göstərir, qiymət 0 olduqda isə <em>Pulsuz</em> yazır.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Xüsusiyyətlər</strong> sütunu ilk üç çipi və qalanları üçün <em>+N</em> nişanını
            göstərir. Məhsul səhifəsini açmaq üçün istənilən sətrə toxunun.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Məhsul səhifəsi">
        <p>
          Məhsulu açanda onun qiyməti, kateqoriyası, xüsusiyyət sayı və teq sayı üçün KPI kartları,
          həmçinin iki tab görünür:
        </p>
        <HelpStep n={1}>
          <p>
            <strong>Detallar</strong> — ad, kateqoriya, qiymət, status, təsvir və teqlər.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Xüsusiyyətlər</strong> — hər xüsusiyyət ayrıca yoxlama sətri kimi (heç biri yoxdursa
            boş hal).
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Yerində redaktə üçün <HelpKey>Redaktə et</HelpKey> basın, sonra <HelpKey>Saxla</HelpKey>{" "}
            — və ya ləğv etmək üçün <HelpKey>Ləğv et</HelpKey>. <HelpKey>Sil</HelpKey> məhsulu silir.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Bütün kataloq sizin təşkilatınızla məhdudlaşır — yalnız öz tenantınızın məhsullarını görür və
          redaktə edirsiniz. Məhsulun hələ anbar qalığı varsa, silmə bloklanır: tətbiq onu saxlayır və{" "}
          <em>«Hələ anbar qalığı olan məhsulu silmək olmaz»</em> mesajını göstərir ki, istinad olunan
          element səssizcə yox olmasın. Əvvəlcə həmin ehtiyatı silin və ya başqasına təyin edin, sonra
          silin.
        </p>
      </HelpCallout>
    </div>
  )
}
