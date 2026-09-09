"use client"

/**
 * Approval Delegation — help article (Azerbaijani).
 * Yalnız Tənzimləmələr → Təsdiqlə Nümayəndəlik səhifəsini əhatə edir:
 * işdə olmadığınız müddətdə müqavilə təsdiqləmələrini başqa istifadəçiyə
 * yönləndirmək (nümayəndəlik yaratmaq, tarix aralığı, səbəb, silmək).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ApprovaldelegatesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Müqavilələri təsdiqləyən menecer və ya komanda rəhbərisiniz"
        goal="Məzuniyyət və ya iş səfəri müddətində müqavilə təsdiqləmələrinin sizdə ilişib qalmaması üçün onları etibarlı bir həmkara yönləndirmək"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Təsdiqlə Nümayəndəlik</HelpKey> yolu ilə
        çatırsınız. Bu, <strong>sizin öz nümayəndəlikləriniz</strong>dir — siz başqasını öz əvəzinizə
        təyin edirsiniz. Yaratdığınız nümayəndəlik müddətində sizə düşən müqavilə təsdiqləmə mərhələləri
        avtomatik olaraq seçdiyiniz həmkara yönləndirilir. Bütün məlumat təşkilatınızla məhdudlaşır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda solda <HelpKey>Tənzimləmələr</HelpKey> səhifəsinə qayıtmaq üçün geri ox düyməsi,
          yanında insan-işarəli ikon və <HelpKey>Təsdiqlə Nümayəndəlik</HelpKey> başlığı durur. Başlığın
          altında «İşdə olmadığınız zaman müqavilə təsdiqləməsinin yönləndirilməsi» izahı və bir sətirlik
          səhifə təsviri var. Sağda <HelpKey>Nümayəndəlik Əlavə Et</HelpKey> düyməsi (artı işarəli) yerləşir.
          Onun altında nümayəndəlik siyahısı gəlir — hələ heç biri yoxdursa, onun yerinə boş vəziyyət göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Nümayəndəlik">Müəyyən tarix aralığında sizin müqavilə təsdiqləmələrinizi başqa istifadəçiyə yönləndirən qeyd.</HelpDef>
          <HelpDef term="Nümayəndəyə">Sizin əvəzinizə təsdiqləyəcək həmkar — onun adı və e-poçtu kartda göstərilir.</HelpDef>
          <HelpDef term="Başlanğıc / Bitmə Tarixi">Nümayəndəliyin qüvvədə olduğu tarix aralığı; kartda «başlanğıc → bitmə» şəklində görünür.</HelpDef>
          <HelpDef term="Səbəb">İstəyə bağlı qeyd (məzuniyyət, iş səfəri və s.); doldurulsa, kartda nişan kimi görünür.</HelpDef>
          <HelpDef term="Aktiv">Yaşıl nişan — bugünkü tarix başlanğıc və bitmə aralığındadır, yəni nümayəndəlik indi qüvvədədir.</HelpDef>
          <HelpDef term="Gəlirli">Boz nişan — nümayəndəlik gələcəkdə başlayacaq (başlanğıc tarixi hələ gəlməyib).</HelpDef>
        </dl>
        <p>
          Hər nümayəndəlik öz kartında göstərilir: «<strong>Nümayəndəyə</strong>: ad», altında e-poçt,
          təqvim ikonu ilə tarix aralığı, varsa səbəb nişanı, sonra vəziyyətdən asılı olaraq yaşıl{" "}
          <strong>Aktiv</strong> və ya boz <strong>Gəlirli</strong> nişanı. Kartın sağında qırmızı zibil
          qutusu ikonu var — nümayəndəliyi silmək üçün. Bu səhifədə redaktə düyməsi yoxdur: dəyişiklik
          lazım olsa, köhnəsini silib yenisini yaradırsınız.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni nümayəndəlik yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Nümayəndəlik Əlavə Et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Nümayəndə Əlavə Et» başlıqlı pəncərə açılır. İçində <strong>Nümayəndəyə</strong> açılan
            siyahısı, yan-yana <strong>Başlanğıc Tarixi</strong> və <strong>Bitmə Tarixi</strong> sahələri,
            altda isə <strong>Səbəb</strong> sahəsi (yanında «İstəyə bağlı» qeydi) var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Nümayəndəyə</HelpKey> açılan siyahısından sizin əvəzinizə təsdiqləyəcək həmkarı seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahı açılana qədər qısa müddət «Yüklənir...» yazısı görünür. Sonra siyahıda təşkilatınızın
            aktiv istifadəçiləri «ad (e-poçt)» formatında sıralanır — <strong>özünüz siyahıda olmursunuz</strong>,
            yəni özünüzü öz nümayəndəniz təyin edə bilməzsiniz. Standart seçim «Həmkar seçin...» olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Başlanğıc Tarixi</HelpKey> və <HelpKey>Bitmə Tarixi</HelpKey> sahələrini doldurun —
            hər ikisi məcburidir. Bu, nümayəndəliyin qüvvədə olacağı dövrdür (məs. məzuniyyətinizin
            başlanğıcı və sonu).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sahə tarix seçən sahədir — üzərinə klikləyəndə təqvim açılır və oradan gün seçirsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            İstəyə bağlı olaraq <HelpKey>Səbəb</HelpKey> yazın (məs. «məzuniyyət» və ya «iş səfəri»).
            Bu sahəni boş da buraxa bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahədə «məzuniyyət, iş səfəri, tapşırıq...» nümunə mətni göstərilir. Maksimum 100 simvol qəbul
            edir; doldursanız, sonra kartda nişan kimi görünəcək.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Aşağıdakı <HelpKey>Yadda saxla</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yadda saxlanarkən düymənin yanında fırlanan göstərici çıxır, sonra pəncərə bağlanır və yeni
            nümayəndəlik siyahıda peyda olur. Başlanğıc tarixi bu günə qədərdirsə, kartda dərhal yaşıl{" "}
            <strong>Aktiv</strong> nişanı, gələcəkdədirsə boz <strong>Gəlirli</strong> nişanı görünür.
            Bir səhv olsa (məs. boş sahə), pəncərənin içində qırmızı xəta mətni göstərilir və pəncərə
            bağlanmır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: nümayəndəliyi sil">
        <HelpStep n={1}>
          <p>
            Aradan qaldırmaq istədiyiniz nümayəndəlik kartının sağındakı qırmızı zibil qutusu ikonlu
            düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə qısa müddətə fırlanan göstəriciyə çevrilir, sonra nümayəndəlik siyahıdan yox olur.
            Sonuncu nümayəndəliyi silsəniz, səhifə boş vəziyyətə qayıdır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Bu səhifədə təsdiq pəncərəsi yoxdur — zibil qutusu düyməsini basan kimi nümayəndəlik silinir.
            Silmədən sonra həmin tarix aralığında təsdiqləmələr yenidən sizə qayıdır. Sadəcə adı və ya
            tarixi dəyişmək istəyirsinizsə, redaktə yoxdur: köhnəni silib yenidən{" "}
            <HelpKey>Nümayəndəlik Əlavə Et</HelpKey> ilə düzgün məlumatı daxil edin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Boş vəziyyət">
        <p>
          Hələ heç bir nümayəndəlik yaratmamısınızsa, siyahının yerinə mərkəzdə insan-işarəli solğun ikon,
          «<strong>Aktiv nümayəndəlik yoxdur</strong>» başlığı və «Nümayəndəlik əlavə edin ki, işdə olmadıqda
          müqavilə təsdiqləmələri nümayəndəyə getsin» izahı göstərilir. Nümayəndəlik yaratmaq üçün yenə
          sağ yuxarıdakı <HelpKey>Nümayəndəlik Əlavə Et</HelpKey> düyməsindən istifadə edirsiniz.
        </p>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Nümayəndəlik yalnız təyin etdiyiniz <strong>tarix aralığında</strong> işləyir — qabaqcadan
          yarada bilərsiniz: başlanğıc tarixi gələnə qədər kart <strong>Gəlirli</strong> kimi gözləyir,
          tarix çatanda öz-özünə <strong>Aktiv</strong> olur. Dövr bitəndən sonra kart siyahıda qalsa da,
          artıq təsdiqləmələri yönləndirmir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Nümayəndələrin siyahısı yalnız <strong>təşkilatınızın aktiv istifadəçiləri</strong>ndən gəlir —
          başqa təşkilatın istifadəçisini seçə bilməzsiniz və özünüzü siyahıda görməzsiniz. Burada idarə
          etdiyiniz nümayəndəliklər sizin öz hesabınıza aiddir.
        </p>
      </HelpCallout>
    </div>
  )
}
