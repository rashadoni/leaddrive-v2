"use client"

/**
 * Product detail — help article (Azerbaijani).
 * Tək məhsul/xidmət kartını əhatə edir: /products/[id] səhifəsi.
 * Əsas iş axını = məhsulu açıb baxmaq, redaktə etmək (detallar + xüsusiyyətlər)
 * və silmək. Kataloq siyahısı (məhsullar siyahısı) bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ProductdetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış əməliyyatı və ya kataloq administratorusunuz"
        goal="Bir məhsul və ya xidmətin kartını açıb məlumatlarına baxmaq, redaktə etmək və lazım olduqda silmək"
      >
        Bu səhifəyə <HelpKey>Məhsullar və Xidmətlər</HelpKey> kataloqundan istənilən sətrə klikləməklə
        çatırsınız. Açılan kart yalnız bir məhsulu göstərir və yalnız sizin təşkilatınıza aiddir. Burada
        gördüyünüz hər şey — qiymət, kateqoriya, xüsusiyyətlər, teqlər — eyni qeyddən oxunur, ona görə
        redaktə edib yadda saxladıqca yuxarıdakı kartlar dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda geri ox düyməsi, narıncı qutu (paket) ikonası, sonra məhsulun <strong>adı</strong>{" "}
          gəlir. Adın altında iki nişan durur: <strong>kateqoriya</strong> (rəngli — Xidmət mavi, Məhsul
          yaşıl, Əlavə bənövşəyi, Konsaltinq kəhrəba) və <strong>Aktiv</strong> / <strong>Qeyri-aktiv</strong>{" "}
          vəziyyəti. Sağ yuxarıda <HelpKey>Redaktə et</HelpKey> və qırmızı <HelpKey>Sil</HelpKey>{" "}
          düymələri var.
        </p>
        <p>
          Bunun altında dörd statistika kartı sıralanır: <strong>Qiymət</strong>, <strong>Kateqoriya</strong>,{" "}
          <strong>Xüsusiyyətlər</strong> (sayı) və <strong>Teqlər</strong> (sayı). Daha aşağıda isə iki
          tablı sahə durur: <HelpKey>Detallar</HelpKey> və <HelpKey>Xüsusiyyətlər</HelpKey> (yanında say).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Qiymət">Məhsulun vahid qiyməti və valyutası. Qiymət 0-dırsa, «Pulsuz» yazılır.</HelpDef>
          <HelpDef term="Kateqoriya">Növ: Xidmət, Məhsul, Əlavə və ya Konsaltinq — başlıqda rəngli nişanla göstərilir.</HelpDef>
          <HelpDef term="Xüsusiyyətlər">Məhsulun imkanlarını sadalayan vergüllə ayrılmış siyahı; kartda say, «Xüsusiyyətlər» tabında isə ayrıca yaşıl işarəli sətirlər kimi görünür.</HelpDef>
          <HelpDef term="Teqlər">Axtarış və qruplaşdırma üçün sərbəst etiketlər; «Təsvir» kartında nişanlar kimi görünür.</HelpDef>
          <HelpDef term="SKU / Part #">Məhsulun anbar/hissə kodu (istəyə bağlı). Yalnız doldurulubsa Detallarda görünür.</HelpDef>
          <HelpDef term="Type (Növ)">Sətir növü — hardware, license, subscription, service və ya other; təkliflərdə (CPQ) miqdar qaydasını müəyyən edir.</HelpDef>
          <HelpDef term="Aktiv">Məhsulun hazırda mövcud olub-olmadığı; qeyri-aktiv məhsul kataloqda passiv sayılır.</HelpDef>
        </dl>
        <p>
          <HelpKey>Detallar</HelpKey> tabında baxış rejimində iki kart var: solda{" "}
          <strong>Məhsulu redaktə et</strong> başlıqlı kart Ad, Kateqoriya, Qiymət, Status, (varsa) SKU və
          Type sətirlərini göstərir; sağda <strong>Təsvir</strong> kartı izahı və varsa teqləri göstərir.{" "}
          <HelpKey>Xüsusiyyətlər</HelpKey> tabı isə hər xüsusiyyəti yaşıl ✓ ikonalı kart kimi düzür —
          xüsusiyyət yoxdursa «Məlumat yoxdur» yazılır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: məhsulu redaktə et">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Redaktə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sağ yuxarıdakı düymələr <HelpKey>Ləğv et</HelpKey> və <HelpKey>Saxla</HelpKey> ilə əvəz olunur.
            <HelpKey>Detallar</HelpKey> tabındakı baxış kartları redaktə formasına çevrilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Detallar</HelpKey> tabında sahələri dəyişin: <strong>Ad *</strong> (məcburi),{" "}
            <strong>Təsvir</strong>, <strong>Kateqoriya</strong> (açılan siyahı), <strong>Qiymət</strong>{" "}
            və yanındakı <strong>valyuta</strong> seçimi.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ad sahəsinin yanında <strong>*</strong> işarəsi var. Qiymət yalnız rəqəm qəbul edir; valyuta
            açılan siyahısında valyuta kodları öz simvolları ilə (məs. USD $) sıralanır. Kateqoriya
            siyahısında Xidmət, Məhsul, Əlavə və Konsaltinq variantları var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İstəyə bağlı olaraq <strong>SKU / Part #</strong> (məs. <HelpKey>HW-1001</HelpKey>),{" "}
            <strong>Type</strong> (hardware, license, subscription, service, other) və{" "}
            <strong>Teqlər</strong> (vergüllə — məs. cloud, migration, enterprise) sahələrini doldurun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            SKU və Teqlər sahələrində nümunə mətnli boz placeholder var. Type açılan siyahısındakı
            variantlar baş hərfi böyük yazılmış görünür (Hardware, License…).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <HelpKey>Aktiv</HelpKey> qeyd qutusu ilə məhsulun mövcudluğunu yandırıb-söndürün, sonra
            aşağıdakı <HelpKey>Saxla</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> bütün dəyişiklikləri əvvəlki halına qaytarır.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxlanarkən <HelpKey>Saxla</HelpKey> düyməsində fırlanan göstərici çıxır, sonra forma yenidən
            baxış rejiminə qayıdır. Başlıqdakı ad, kateqoriya/aktivlik nişanları və yuxarıdakı statistika
            kartları yenilənmiş dəyərləri əks etdirir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: xüsusiyyətləri redaktə et">
        <HelpStep n={1}>
          <p>
            <HelpKey>Redaktə et</HelpKey> rejimində <HelpKey>Xüsusiyyətlər</HelpKey> tabına keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tab başlığında cari xüsusiyyət sayı mötərizədə görünür. Tabın içində bir böyük çoxsətirli
            mətn sahəsi (textarea) açılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Xüsusiyyətləri <strong>vergüllə ayıraraq</strong> bir sahəyə yazın (məs.{" "}
            <HelpKey>Azure/AWS, Zero Downtime, Data Migration</HelpKey>), sonra yuxarıdakı{" "}
            <HelpKey>Saxla</HelpKey> ilə təsdiqləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxladıqdan sonra baxış rejimində hər xüsusiyyət ayrı-ayrı yaşıl ✓ dairəli kart kimi düzülür.
            <strong>Xüsusiyyətlər</strong> statistika kartındakı say və tab başlığındakı mötərizə dəyəri
            yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: məhsulu sil">
        <HelpStep n={1}>
          <p>
            Baxış rejimində sağ yuxarıdakı qırmızı <HelpKey>Sil</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Məhsulun adı ilə təsdiq pəncərəsi açılır və silmənin geri qaytarılmadığını xəbərdar edir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Pəncərədəki təsdiq düyməsini basaraq silməni tamamlayın (və ya{" "}
            <HelpKey>Ləğv et</HelpKey> ilə imtina edin).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Silmə alınırsa siyahı (<HelpKey>Məhsullar və Xidmətlər</HelpKey>) səhifəsinə qaytarılırsınız.
            Məhsulun hələ anbar qalığı varsa, silinmir — əvəzində «Hələ anbar qalığı olan məhsulu silmək
            olmaz. Əvvəlcə onun ehtiyatını silin və ya başqasına təyin edin.» bildirişi çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Qiymət sahəsini boş və ya 0 saxlasanız, məhsul başlıqdakı və <strong>Qiymət</strong> kartındakı
          dəyər kimi «Pulsuz» göstərilir — pulsuz əlavələr və ya demo paketlər üçün faydalıdır.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Anbar qalığı (inventory) olan məhsul silinmir — sistem 409 ilə imtina edir. Belə məhsulu
          kataloqdan çıxarmaq istəyirsinizsə, silmək yerinə <HelpKey>Redaktə et</HelpKey> →{" "}
          <HelpKey>Aktiv</HelpKey> qeyd qutusunu söndürərək onu qeyri-aktiv edin: qeyd və qalıqları qalır,
          sadəcə kataloqda passiv sayılır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Hər məhsul kartı təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın məhsullarını görür və
          redaktə edirsiniz. Bütün dəyişikliklər (qiymət, status, xüsusiyyətlər) yalnız sizin
          təşkilatınızın kataloquna təsir edir.
        </p>
      </HelpCallout>
    </div>
  )
}
