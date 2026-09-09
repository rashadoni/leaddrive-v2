"use client"

/**
 * Workflow Templates — help article (Azerbaijani).
 * Yalnız Tənzimləmələr → Avtomatlaşdırmalar → Şablonlar səhifəsini
 * əhatə edir: hazır avtomatlaşdırma şablonları qalereyası, kateqoriyalara
 * görə qruplaşma, önbaxış/fərdiləşdirmə pəncərəsi və şablonu tətbiq etmə.
 * Avtomatlaşdırmanın özünü qurmaq (sıfırdan qayda yaratmaq) bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function workflowtemplatesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Əməliyyat administratoru və ya komanda rəhbərisiniz"
        goal="Sıfırdan qayda qurmadan, hazır bir ssenaridən başlamaq və onu öz mətninizlə fərdiləşdirib tətbiq etmək"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Avtomatlaşdırmalar</HelpKey> bölməsindən
        keçib <HelpKey>Şablonlar</HelpKey> ilə çatırsınız. Burada heç nə yaratmırsınız — yalnız hazır
        avtomatlaşdırmalara baxır, birini seçib mətnini dəyişir və tətbiq edirsiniz. Tətbiq etdikdən sonra
        sistem sizi avtomatlaşdırmalar siyahısına aparır. Bütün şablonlar və yaradılan qaydalar yalnız
        sizin təşkilatınız üçündür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda sol tərəfdə <HelpKey>Avtomatlaşdırmalara qayıt</HelpKey> keçidi, altında bənövşəyi
          işarə (Sparkles) ilə <strong>Avtomatlaşdırma şablonları</strong> başlığı və «Hazır ssenaridən
          başlayın və sonra fərdiləşdirin» izahı durur. Əgər təşkilatınızda SMS provayderi
          konfiqurasiya olunmayıbsa, başlığın altında sarı xəbərdarlıq lenti çıxır — içində{" "}
          <HelpKey>İndi konfiqurasiya et →</HelpKey> keçidi olur.
        </p>
        <p>
          Əsas hissə şablonların qalereyasıdır: onlar kateqoriyalara görə qruplaşdırılıb (
          <strong>Satış</strong>, <strong>Dəstək</strong>, <strong>Marketinq</strong>,{" "}
          <strong>Əməliyyatlar</strong>), hər qrupun başlığı kiçik böyük hərflərlə yazılır və altında
          kartlar üç sütunlu şəbəkədə düzülür. Şablonlar yüklənərkən boz «nəbz» kartları görünür; heç
          şablon yoxdursa «Şablon mövcud deyil» yazısı çıxır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Şablon">Hazır avtomatlaşdırma ssenarisi — bir tetik və bir neçə əməliyyatdan ibarət, tətbiq edildikdə real qaydaya çevrilir.</HelpDef>
          <HelpDef term="Kateqoriya">Şablonun aid olduğu sahə: Satış, Dəstək, Marketinq və ya Əməliyyatlar.</HelpDef>
          <HelpDef term="Tetik">Qaydanı işə salan hadisə — kartda «entity.event» formatında (məs. lead.created) monoşrift etiket kimi göstərilir.</HelpDef>
          <HelpDef term="Əməliyyat">Tetik baş verdikdə yerinə yetiriləcək iş (e-poçt göndər, tapşırıq yarat, SMS göndər və s.); kartda sayı yazılır.</HelpDef>
          <HelpDef term="SMS lazımdır">Şablon SMS göndərirsə, provayder qurulmayana qədər kartda sarı «SMS lazımdır» nişanı çıxır.</HelpDef>
          <HelpDef term="Tətbiq edilib">Bu şablonu artıq tətbiq etmisinizsə, kartın sağ yuxarısında yaşıl «Tətbiq edilib (say)» nişanı görünür.</HelpDef>
        </dl>
        <p>
          Hər kartda soldakı ikon, şablonun adı, kateqoriya nişanı, qısa təsvir, altda monoşrift
          tetik etiketi və «N əməliyyat» göstəricisi, ən altda isə bütün eni tutan göy düymə olur. Düymənin
          adı şablon hələ tətbiq olunmayıbsa <HelpKey>Bax və tətbiq et</HelpKey>, artıq tətbiq olunubsa{" "}
          <HelpKey>Yenidən bax</HelpKey> olur.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: şablona bax və fərdiləşdir">
        <HelpStep n={1}>
          <p>
            Bəyəndiyiniz şablon kartında ən altdakı <HelpKey>Bax və tətbiq et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Şablonun adı və təsviri ilə başlayan böyük bir pəncərə açılır. Yuxarıda boz qutuda{" "}
            <strong>Tetik</strong> sahəsi və yanında monoşrift kodla tetik (məs. lead.created)
            göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Əməliyyatlar (fərdiləşdirmək üçün aşağıda redaktə edin)</strong> başlığının altında
            şablonun bütün addımlarına baxın — hər biri öz çərçivəsindədir, üstündə əməliyyatın növü
            (məs. <HelpKey>send_email</HelpKey>) və nömrəsi (#1, #2…) yazılır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər əməliyyat çərçivəsində yalnız həmin əməliyyata aid sahələr çıxır:{" "}
            <strong>Mövzu</strong>, <strong>Mətn</strong>, <strong>Mesaj</strong>,{" "}
            <strong>Başlıq</strong> və ya <strong>Gecikmə (dəqiqə)</strong>. Sahələr şablonun standart
            dəyərləri ilə əvvəlcədən doldurulmuş gəlir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İstədiyiniz mətni dəyişin — məsələn salamlama e-poçtunun <strong>Mövzu</strong> və{" "}
            <strong>Mətn</strong> sahələrini öz şirkətinizə uyğunlaşdırın. Gecikmə qoymaq istəyirsinizsə,{" "}
            <strong>Gecikmə (dəqiqə)</strong> sahəsinə 0–1440 arası rəqəm yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca dəyişiklik sahədə dərhal görünür. Gecikmə sahəsinin altında «0 = dərhal. CRM
            əməliyyatı yerinə yetirməmişdən əvvəl göstərilən dəqiqə qədər gözləyəcək» ipucusu durur.
            Boş və ya yanlış rəqəm qoysanız dəyər 0-a düşür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: şablonu tətbiq et">
        <HelpStep n={1}>
          <p>
            Pəncərənin ən altında sağdakı <HelpKey>Şablonu tətbiq et</HelpKey> düyməsini basın.
            (Fikrinizi dəyişsəniz, solundakı <HelpKey>Ləğv et</HelpKey> ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə tətbiq olunarkən «Tətbiq olunur...» yazısına keçir. Uğurlu olduqda «Şablon tətbiq
            edildi. Avtomatlaşdırma açılır...» bildirişi çıxır, pəncərə bağlanır və sistem sizi{" "}
            <HelpKey>Avtomatlaşdırmalar</HelpKey> siyahısına yönləndirir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Şablonu daha əvvəl tətbiq etmisinizsə, kartdakı düymə <HelpKey>Yenidən bax</HelpKey> olur və
            pəncərənin içində sarı qutuda «Başa düşürəm — yenə də tətbiq et. Bu dublikat qayda
            yaradacaq» qeyd qutusu peyda olur.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qeyd qutusunu işarələməyincə <strong>Şablonu tətbiq et</strong> düyməsi sönük (basıla bilməz)
            qalır. İşarələdikdən sonra düymə aktivləşir. İşarələmədən tətbiqə cəhd etsəniz, «Bu şablon
            artıq tətbiq edilib...» xəbərdarlığı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            SMS göndərən şablonda provayder qurulmayıbsa, pəncərənin içində sarı «Şablon SMS göndərir.
            Əvvəlcə Parametrlər → VoIP-də Twilio və ya Vonage qurun» bloku çıxır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bu halda <strong>Şablonu tətbiq et</strong> düyməsi sönük qalır. SMS provayderini qurmadan
            tətbiqə cəhd etsəniz, eyni mətnli xəta bildirişi göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Tətbiq edilmiş şablon bir daha çıxmır — sadəcə yeni bir avtomatlaşdırma qaydası kimi{" "}
          <HelpKey>Avtomatlaşdırmalar</HelpKey> siyahısına əlavə olunur. Orada həmin qaydanı sonradan da
          redaktə edə, dayandıra və ya silə bilərsiniz, ona görə şablon tətbiq etməzdən əvvəl hər mətni
          mükəmməl etmək məcburi deyil.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Eyni şablonu təkrar tətbiq etmək <strong>ikinci, dublikat qayda</strong> yaradır — köhnəsini
          əvəz etmir. Buna görə də «Yenidən bax» edib təkrar tətbiq etməzdən əvvəl əmin olun ki, həqiqətən
          ikinci qayda istəyirsiniz; əks halda eyni hadisəyə iki dəfə e-poçt/SMS gedə bilər.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün şablonlar və onlardan yaranan qaydalar təşkilatınızla məhdudlaşır — başqa təşkilatın
          qaydalarını görmür və onlara təsir etmirsiniz. SMS göndərən şablonlar yalnız sizin tenant-ınızın
          VoIP konfiqurasiyasından (Twilio/Vonage) istifadə edir.
        </p>
      </HelpCallout>
    </div>
  )
}
