"use client"

/**
 * Event detail — help article (Azerbaijani).
 * Tək bir tədbirin detal səhifəsini əhatə edir:
 * src/app/(dashboard)/events/[id]/page.tsx
 * Başlıq + status xətti (pipeline) + 4 KPI kartı + 3 tab (Detallar,
 * Büdcə, İştirakçılar) + iştirakçı idarəetməsi (CRM-dən / əl ilə),
 * rol və status dəyişmə, dəvətnamələrin göndərilməsi, qeydiyyat linki,
 * redaktə və silmə. Yalnız səhifədə real mövcud olan UI təsvir olunur.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function EventDetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq və ya tədbir təşkilatçısısınız"
        goal="Bir tədbiri idarə etmək — gedişatını izləmək, iştirakçıları əlavə edib dəvətnamə göndərmək, iştirakı qeyd etmək və büdcə/gəlir göstəricilərini görmək"
      >
        Bu səhifəyə tədbirlər siyahısından bir tədbirin adını basaraq çatırsınız (URL{" "}
        <HelpKey>/events/&lt;id&gt;</HelpKey>). Bütün məlumatlar — tədbir, iştirakçılar və
        göstəricilər — yalnız sizin təşkilatınızındır. Səhifə hər dəyişiklikdən sonra məlumatları
        yenidən oxuyur, ona görə status, KPI kartları və iştirakçı sayı dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda geri ox düyməsi (tədbirlər siyahısına qaytarır), təqvim ikonası, tədbirin adı və
          adın altında nişanlar var: <strong>status</strong> (rəngli), <strong>növ</strong>{" "}
          (Konfrans, Vebinar, Seminar, Görüş, Sərgi, Digər), tədbir onlayndırsa{" "}
          <HelpKey>Onlayn</HelpKey> nişanı və varsa yer (xəritə ikonası ilə). Sağ yuxarıda üç düymə
          durur: <HelpKey>Qeydiyyat</HelpKey> (qeydiyyat linkini kopyalayır),{" "}
          <HelpKey>Redaktə et</HelpKey> və qırmızı <HelpKey>Sil</HelpKey>.
        </p>
        <p>
          Başlığın altında <strong>status xətti</strong> (pipeline) gəlir — dörd mərhələli düymə
          cərgəsi: Planlaşdırılıb → Qeydiyyat açıqdır → Davam edir → Tamamlandı. Cari mərhələ
          vurğulanır, ondan əvvəlkilər açıq rənglə işarələnir. Daha aşağıda dörd KPI kartı, sonra isə
          üç tab var: <HelpKey>Detallar</HelpKey>, <HelpKey>Büdcə</HelpKey> və{" "}
          <HelpKey>İştirakçı (N)</HelpKey> — mötərizədəki rəqəm cari iştirakçı sayıdır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status xətti (pipeline)">
            Tədbirin gedişat mərhələsini bir kliklə dəyişən dörd düymə: Planlaşdırılıb, Qeydiyyat
            açıqdır, Davam edir, Tamamlandı. (Ləğv edilmiş statusu burada deyil, redaktə formasında
            təyin olunur.)
          </HelpDef>
          <HelpDef term="İştirakçı kartı">
            «Qeydiyyatdan keçib / maksimum» nisbətini göstərir (maks. təyin edilibsə).
          </HelpDef>
          <HelpDef term="İştirak etdi kartı">
            İştirak edən sayını və qeydiyyatdan keçənlərə nisbətən faiz (iştirak dərəcəsi) göstərir.
          </HelpDef>
          <HelpDef term="Büdcə / Gəlir kartları">Planlanan büdcə və faktiki gəlir (₼ ilə).</HelpDef>
          <HelpDef term="İştirakçı">
            Tədbirə əlavə edilmiş şəxs — adı, kontaktı (email/telefon), rolu (İştirakçı, Spiker,
            Sponsor, Təşkilatçı, VIP), statusu və dəvət vəziyyəti olan.
          </HelpDef>
          <HelpDef term="Dəvət vəziyyəti">
            İştirakçıya dəvətnamə göndərilib (Göndərildi) və ya hələ göndərilməyib.
          </HelpDef>
          <HelpDef term="Qeydiyyat linki">
            Tədbirin açıq qeydiyyat səhifəsinin ünvanı — paylaşıb adamların özlərinin qeydiyyatdan
            keçməsi üçün.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: tədbirin statusunu dəyiş">
        <HelpStep n={1}>
          <p>
            Başlığın altındakı status xəttində istədiyiniz mərhələni — məs.{" "}
            <HelpKey>Qeydiyyat açıqdır</HelpKey> və ya <HelpKey>Davam edir</HelpKey> — basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Basdığınız mərhələ vurğulanmış (dolu rəngli) düyməyə çevrilir, ondan əvvəlki mərhələlər
            açıq rənglə qalır. Yuxarıdakı adın altındakı status nişanı da yeni mərhələni əks etdirir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Status xətti yalnız əsas dörd mərhələni göstərir. Tədbiri{" "}
            <strong>Ləğv edildi</strong> kimi qeyd etmək üçün <HelpKey>Redaktə et</HelpKey>{" "}
            düyməsindən formanı açın və statusu orada dəyişin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: detalları və büdcəni gör">
        <HelpStep n={1}>
          <p>
            <HelpKey>Detallar</HelpKey> tabında qalın. Sol kartda növ, başlanğıc və bitmə tarixi,
            yer, onlayn olub-olmaması, görüş linki və yaradılma tarixi sıralanır; sağ kartda tədbirin
            təsviri və varsa teqlər var.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sol kart sahə–dəyər cütlüklərini göstərir; doldurulmamış sahələrdə «—» işarəsi durur. Sağ
            kartda təsvir yoxdursa «Məlumat yoxdur» yazısı görünür; teqlər varsa altda kiçik nişanlar
            kimi sıralanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Büdcə</HelpKey> tabına keçin. Sol kartda <strong>Xərc və gəlir</strong> (büdcə,
            faktiki xərc, gözlənilən gəlir, faktiki gəlir), sağ kartda isə{" "}
            <strong>Göstəricilər</strong> var: iştirakçı başına xərc və gəlir, ROI, iştirak dərəcəsi,
            büdcə istifadəsi.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər iki kart sahə–dəyər cütlükləri kimi göstərilir. Göstəricilər avtomatik hesablanır;
            məlumat yetərsizdirsə (məs. heç kim iştirak etməyibsə) uyğun sətirlərdə «—» görünür.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Büdcə, xərc və gəlir rəqəmlərini bu səhifədə birbaşa düzəltmək olmur — onları{" "}
            <HelpKey>Redaktə et</HelpKey> formasında dəyişin, göstərici kartları sonra avtomatik
            yenilənir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: iştirakçı əlavə et">
        <HelpStep n={1}>
          <p>
            <HelpKey>İştirakçı</HelpKey> tabına keçin və sağda <HelpKey>Əlavə et</HelpKey> düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kəsik-kənarlı (dashed) panel açılır. Yuxarıda iki rejim düyməsi var:{" "}
            <HelpKey>CRM kontaktlarından</HelpKey> (standart) və <HelpKey>Əl ilə daxil et</HelpKey>,
            onların altında <strong>Rol</strong> seçicisi. <HelpKey>Əlavə et</HelpKey> düyməsi indi{" "}
            <HelpKey>Bağla</HelpKey> mətninə dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Əvvəlcə <strong>Rol</strong> seçin (İştirakçı, Spiker, Sponsor, Təşkilatçı və ya VIP) —
            əlavə edəcəyiniz şəxs(lər) bu rolla yaradılacaq.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahıda beş rol görünür; seçdiyiniz rol indiki dəyər kimi qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>CRM kontaktlarından</strong> əlavə etmək üçün axtarış sahəsinə ad və ya email
            yazın, sonra siyahıdan istədiyiniz kontaktın üstünə basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Axtarış nəticələri ad və email (və ya şirkət) ilə kart kimi sıralanır; artıq əlavə
            edilmiş kontaktlar siyahıda görünmür. Bir kontaktı basanda o, dərhal aşağıdakı iştirakçı
            cədvəlinə düşür. Uyğun nəticə yoxdursa «Nəticə tapılmadı» yazısı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            CRM-də olmayan birini əlavə etmək üçün <HelpKey>Əl ilə daxil et</HelpKey> rejiminə keçin,{" "}
            <strong>Ad</strong> (məcburi), istəyə bağlı <strong>Email</strong> və{" "}
            <strong>Telefon</strong> yazın, sonra <HelpKey>Əlavə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yeni iştirakçı cədvələ əlavə olunur və sahələr təmizlənir. Ad boşdursa düymə işləmir;
            əlavə alınmasa, panelin üstündə qırmızı xəta mesajı («İştirakçı əlavə edilmədi» və ya
            şəbəkə xətası) göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: rol və iştirak statusunu idarə et">
        <HelpStep n={1}>
          <p>
            İştirakçı cədvəlində bir sətirin <strong>Növ</strong> sütunundakı açılan siyahıdan rolu
            dəyişin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Rol nişanının rəngi seçimə uyğun dəyişir (məs. Spiker — bənövşəyi, Sponsor — kəhrəba) və
            dəyişiklik dərhal yadda saxlanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Status</strong> sütunundakı açılan siyahıdan iştirakçının vəziyyətini seçin:
            Qeydiyyatdan keçib, Təsdiqlənib, İştirak edib, Ləğv edilib və ya Gəlməyib.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Status nişanının rəngi yenilənir. İştirakçını <HelpKey>İştirak edib</HelpKey> kimi qeyd
            edəndə yuxarıdakı <strong>İştirak etdi</strong> KPI kartındakı say (və iştirak dərəcəsi)
            buna uyğun artır; statusu yenidən dəyişəndə say geri düzəlir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Bir iştirakçını silmək üçün onun sətrinin sağındakı qırmızı × ikonasını basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İştirakçı cədvəldən çıxır və tab başlığındakı say (və KPI kartları) yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: dəvətnamələri göndər">
        <HelpStep n={1}>
          <p>
            Bir iştirakçıya dəvətnamə göndərmək üçün onun <strong>Göndər</strong> sütunundakı{" "}
            <HelpKey>Göndər</HelpKey> linkini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İştirakçının email-i yoxdursa, sütunda göndərmə əvəzinə «Email yoxdur» yazısı durur və
            link sönük olur. Göndərmədən sonra sütun «Göndərildi» yaşıl nişanına və tarixinə çevrilir,
            yanında isə <HelpKey>Yenidən göndər</HelpKey> linki görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Hamısına birdən göndərmək üçün cədvəlin yuxarısındakı{" "}
            <HelpKey>Bütün dəvətnamələri göndər</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yüklənmə (fırlanan) ikonasına keçir, sonra yuxarıda nəticə zolağı çıxır — məs. «N
            dəvətnamədən M-i uğurla göndərildi». Yuxarıdakı sayğaclar (dəvət edilib / göndərilməyib)
            və hər sətrin göndər sütunu yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            E-poçtların real göndərilməsi üçün SMTP quraşdırılmalıdır (<HelpKey>Parametrlər</HelpKey>{" "}
            → <HelpKey>SMTP</HelpKey>). SMTP yoxdursa, sistem iştirakçıları sadəcə «dəvət edilmiş»
            kimi qeyd edir və bunu nəticə zolağında bildirir — məktub fiziki olaraq getmir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: qeydiyyat linkini paylaş, tədbiri redaktə et və ya sil">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Qeydiyyat</HelpKey> düyməsini basın — tədbirin açıq qeydiyyat
            səhifəsinin linki panoya kopyalanır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə qısa müddətə yaşıl işarə ilə «Saxlanıldı» mətninə dəyişir, sonra geri qayıdır. İndi
            linki istənilən yerə (email, mesaj) yapışdıra bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Tədbirin məlumatlarını (ad, tarix, büdcə, status və s.) dəyişmək üçün{" "}
            <HelpKey>Redaktə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mövcud dəyərlərlə əvvəlcədən doldurulmuş tədbir forması açılır. Yadda saxladıqdan sonra
            forma bağlanır və səhifədəki başlıq, kartlar və göstəricilər yeni dəyərləri əks etdirir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Tədbiri büsbütün silmək üçün qırmızı <HelpKey>Sil</HelpKey> düyməsini basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tədbirin adı ilə təsdiq pəncərəsi açılır. Təsdiqlədikdən sonra tədbir silinir və sistem
            sizi avtomatik olaraq tədbirlər siyahısına qaytarır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Tədbirin silinməsi geri qaytarılmır və onunla birlikdə bütün iştirakçı qeydlərini də
            aparır. Tədbiri saxlamaq, sadəcə bağlamaq istəyirsinizsə, silmək yerinə statusu{" "}
            <strong>Tamamlandı</strong> (və ya redaktə formasında <strong>Ləğv edildi</strong>)
            edin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Tədbir, iştirakçılar və kontakt seçimi yalnız sizin təşkilatınızla məhdudlaşır — başqa
          tenant-ın tədbirlərini görmür, yalnız öz CRM kontaktlarınızı iştirakçı kimi əlavə edə
          bilərsiniz. Qeydiyyat linki isə açıqdır: onu kim alırsa, qeydiyyat səhifəsini aça bilər,
          ona görə linki yalnız nəzərdə tutduğunuz auditoriya ilə paylaşın.
        </p>
      </HelpCallout>
    </div>
  )
}
