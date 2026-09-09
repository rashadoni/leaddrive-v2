"use client"

/**
 * Forms (No-Code Form Builder) — help article (Azerbaijani).
 *
 * Yalnız `/forms` siyahı səhifəsini əhatə edir: forma siyahısı,
 * status nişanları (Qaralama / Dərc edilib / Arxivləşdirilib),
 * baxış/göndərmə sayğacları, açıq URL (/f/{slug}) və «Yeni forma»
 * yaratma pəncərəsi (ad + slug). Redaktor (/forms/[id]) bu məqalənin
 * əhatəsindən KƏNARDIR — yalnız ona keçid göstərilir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function FormsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq və ya əməliyyat administratorusunuz"
        goal="Açıq URL-i olan müstəqil forma yaratmaq, onu izləmək (baxışlar və göndərmələr) və saytda paylaşmaq üçün hazırlamaq"
      >
        Səhifəyə <HelpKey>Formalar</HelpKey> bölməsindən çatırsınız. Bütün formalar yalnız sizin
        təşkilatınıza aiddir. Bu səhifə formaların <strong>siyahısıdır</strong> — burada forma
        yaradır, statusunu və statistikasını görür, sonra hər formanın daxili məzmununu (sahələr,
        dizayn) ayrıca redaktorda tənzimləyirsiniz.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Formalar</HelpKey> adı, altında «Açıq URL-i olan müstəqil formalar.
          İstənilən yerə yerləşdirin və ya birbaşa paylaşın.» izahı (içində{" "}
          <code>/f/{`{slug}`}</code> nümunəsi), sağ yuxarıda isə <HelpKey>Yeni forma</HelpKey> düyməsi
          var. Aşağıda formaların cədvəli gəlir. Hələ heç forma yoxdursa, cədvəlin yerinə boş vəziyyət
          göstərilir: sənəd ikonası, «Hələ forma yoxdur.» mətni və <HelpKey>İlk formanızı yaradın</HelpKey>{" "}
          düyməsi.
        </p>
        <p>
          Cədvəlin sütunları bunlardır: <strong>Ad</strong>, <strong>Status</strong>,{" "}
          <strong>Baxışlar</strong>, <strong>Göndərmələr</strong>, <strong>Açıq URL</strong> və ən
          sağda hər sətrin <HelpKey>Redaktə et</HelpKey> keçidi. <strong>Ad</strong> sütununda formanın
          adı klik edilə bilən keçiddir; təsviri varsa, adın altında kiçik mətnlə görünür.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Forma">Açıq (login tələb etməyən) URL-i olan müstəqil anket — saytda yerləşdirə və ya linki paylaşa bilərsiniz.</HelpDef>
          <HelpDef term="Status">Formanın həyat dövrü: «Qaralama» (yeni, hələ açıq deyil), «Dərc edilib» (canlı, açıq URL-də işləyir) və ya «Arxivləşdirilib».</HelpDef>
          <HelpDef term="Baxışlar">Formanın açıq səhifəsinin neçə dəfə açıldığını göstərən ümumi sayğac.</HelpDef>
          <HelpDef term="Göndərmələr">Forma vasitəsilə neçə cavabın (məsələn lid məlumatının) göndərildiyini göstərən ümumi sayğac.</HelpDef>
          <HelpDef term="Açıq URL">Dərc edilmiş formanın ünvanı: <code>/f/{`{slug}`}</code>. Yalnız status «Dərc edilib» olanda dolur; əks halda «—» göstərilir.</HelpDef>
          <HelpDef term="Slug">URL-in sonundakı qısa identifikator (məs. «contact-us»). Yalnız kiçik hərflər və defislər, 1–64 simvol; yaradıldıqdan sonra dəyişdirilə bilməz.</HelpDef>
        </dl>
        <p>
          Status nişanları rəng ilə fərqlənir: <strong>Qaralama</strong> boz, <strong>Dərc edilib</strong>{" "}
          yaşıl, <strong>Arxivləşdirilib</strong> sarı tonda göstərilir. Baxış və göndərmə dəyərləri
          rəqəm formatında, sağa düzülmüş şəkildə verilir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni forma yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni forma</HelpKey> düyməsini basın. (Heç forma yoxdursa, boş
            vəziyyətin ortasındakı <HelpKey>İlk formanızı yaradın</HelpKey> düyməsi də eyni pəncərəni
            açır.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni forma» başlıqlı pəncərə açılır. İçində <strong>Ad</strong> sahəsi və{" "}
            <strong>Slug (açıq URL)</strong> sahəsi var; slug sahəsinin altında «Yalnız kiçik hərflər
            və defislər. 1–64 simvol. Yaradıldıqdan sonra dəyişdirilə bilməz.» ipucusu durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Ad</strong> yazın (məs. «Bizimlə əlaqə») və <strong>Slug</strong> daxil edin (məs.{" "}
            <HelpKey>contact-us</HelpKey>). Bu açıq URL-də görünəcək hissədir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca mətn sahələrdə görünür. Hər iki sahə dolana qədər aşağıdakı yaratma düyməsi söndürülü
            (basıla bilməyən) qalır. Slug yadda saxlanarkən avtomatik kiçik hərflərə çevrilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Aşağıdakı <HelpKey>Qaralama yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Yaradılır…» yazısına keçir, sonra pəncərə bağlanır və yeni forma cədvəlin ən
            yuxarısında <strong>Qaralama</strong> statusu ilə peyda olur. Slug və ya ad qəbul
            edilməsə, sahələrin altında qırmızı xəta mesajı göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: formanın məzmununu redaktə et">
        <HelpStep n={1}>
          <p>
            Cədvəldə formanın <strong>adına</strong> klikləyin və ya həmin sətrin sağındakı{" "}
            <HelpKey>Redaktə et</HelpKey> keçidini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Redaktə et</HelpKey> keçidinin yanında kiçik xarici-keçid ikonası var. Klikdən
            sonra həmin formanın redaktoru (<code>/forms/{`{id}`}</code>) açılır — sahələri, dizaynı və
            dərc etmə tənzimləməsi orada idarə olunur (bu məqalənin əhatəsindən kənardır).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Formanı dərc etdikdən sonra siyahıya qayıdın və <strong>Açıq URL</strong> sütununu yoxlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Status <strong>Dərc edilib</strong> olan formanın <strong>Açıq URL</strong> sütununda{" "}
            <code>/f/{`{slug}`}</code> ünvanı görünür; hələ qaralama olan formalarda bu xanada «—»
            durur. <strong>Baxışlar</strong> və <strong>Göndərmələr</strong> sütunları açıq forma
            istifadə olunduqca artır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Slug açıq linkin sonudur — qısa, oxunaqlı və yadda qalan saxlayın (məs. «contact-us» yox,
          uzun təsadüfi mətn deyil). Yaradıldıqdan sonra dəyişdirilə bilmədiyi üçün, paylaşmazdan əvvəl
          doğru seçin; sonradan başqa link lazım olsa, yeni forma yaratmalı olacaqsınız.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Forma yalnız <strong>Dərc edilib</strong> statusunda canlıdır və <code>/f/{`{slug}`}</code>{" "}
          ünvanında işləyir. Qaralama vəziyyətində forma açıq deyil, açıq URL xanasında «—» qalır —
          ona görə linki paylaşmazdan əvvəl statusun «Dərc edilib» olduğuna əmin olun.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün formalar təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın formalarını görürsünüz
          və yaratdığınız formalar başqa təşkilatlara görünmür. Formanın <strong>açıq URL-i</strong>{" "}
          isə login tələb etmir: dərc edilmiş forma linki olan istənilən şəxsə açıqdır, ona görə
          formanı yalnız ictimaiyyətə açmaq istədiyiniz məlumatı toplayacaq şəkildə qurun.
        </p>
      </HelpCallout>
    </div>
  )
}
