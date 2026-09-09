"use client"

/**
 * Approval Routing Rules — help article (Azerbaijani).
 * Yalnız Tənzimləmələr → Təsdiq Marşrutu Qaydaları səhifəsini əhatə edir
 * (qayda yaratma/redaktə, şərtlər, hərəkətlər — mərhələ əlavə/atla,
 * şablon əhatəsi, aktiv/qeyri-aktiv vəziyyət, qaydanın söndürülməsi).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function approvalrulesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Əməliyyat administratoru və ya satış menecerisiniz"
        goal="Müqavilə atributlarına görə təsdiq zəncirinə avtomatik mərhələ əlavə edən və ya artıq mərhələni atlayan qaydalar qurmaq"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Təsdiq Marşrutu Qaydaları</HelpKey> yolu
        ilə çatırsınız. Bütün qaydalar yalnız sizin təşkilatınız üçündür. Qaydalar müqavilə{" "}
        <strong>təsdiqə göndərilən an</strong> qiymətləndirilir: şərtlərinə uyğun gələn hər qayda
        təsdiq zəncirinə avtomatik mərhələ əlavə edir və ya mövcud mərhələni atlayır. Qayda
        yaratmaq, redaktə etmək və ya söndürmək üçün <strong>admin</strong>, <strong>menecer</strong>{" "}
        və ya <strong>superadmin</strong> rolu lazımdır — başqa rollar siyahını yalnız oxuya bilir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlığın solunda <HelpKey>Tənzimləmələr</HelpKey> səhifəsinə qaytaran ox, yanında budaqlanma
          (GitMerge) ikonası ilə <HelpKey>Təsdiq Marşrutu Qaydaları</HelpKey> adı, altında «Müqavilə
          atributlarına görə şərti mərhələ əlavəsi / atlanması» izahı durur. Yazı icazəniz varsa,
          sağda <HelpKey>Qayda Əlavə Et</HelpKey> düyməsi görünür. Altda qaydalar siyahısı gəlir —
          hələ heç biri yoxdursa, onun yerinə boş vəziyyət kartı çıxır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Qayda">Adlı dəst: bir neçə şərt (nə vaxt işə düşsün) + bir neçə hərəkət (nə etsin) + uyğunluq məntiqi + aktiv/qeyri-aktiv vəziyyət.</HelpDef>
          <HelpDef term="Şərt">Müqavilənin yoxlanılan atributu — məbləğ (value), növ (type) və ya valyuta (currency) — operator (gte, lte, gt, lt, eq, neq, in) və qiymətlə.</HelpDef>
          <HelpDef term="Uyğunluq məntiqi">«Bütün şərtlər» (AND — hamısı doğru olmalıdır) yoxsa «İstənilən şərt» (OR — biri bəs edir).</HelpDef>
          <HelpDef term="Hərəkət">Qayda işə düşəndə baş verən: «mərhələ_əlavə» (zəncirə təsdiq mərhələsi əlavə edir) və ya «mərhələ_atla» (mövcud mərhələni atlayır).</HelpDef>
          <HelpDef term="Şablon əhatəsi">Qaydanın yalnız bir müqavilə şablonuna, yoxsa bütün müqavilələrə (org-əhatəli) tətbiq olunması.</HelpDef>
          <HelpDef term="Mövqe">«mərhələ_əlavə» üçün yeni mərhələnin zəncirdə hansı yerə daxil ediləcəyi (boş = sona əlavə edilir).</HelpDef>
          <HelpDef term="İcraçı rolu">Əlavə edilən mərhələni kimin təsdiqləyəcəyini bildirən rol (məs. manager, director).</HelpDef>
        </dl>
        <p>
          Hər qayda kartında ad, yanında <strong>Aktiv</strong> / <strong>Qeyri-aktiv</strong> nişanı,
          sonra ya şablonun adı nişanı, ya da <strong>Bütün müqavilələr (org-əhatəli)</strong> nişanı
          olur. Altında bir sətirdə xülasə var: <em>Uyğunluq məntiqi</em> (Bütün şərtlər / İstənilən
          şərt), şərtlərin sayı və hərəkətlərin sayı. Sağda isə düymələr durur: açıb-yığma oxu
          (şərtlərin və hərəkətlərin təfərrüatını göstərir), redaktə (dişli çarx ikonası) və qayda
          aktivdirsə qırmızı zibil qutusu ikonası (söndürmə). Redaktə və söndürmə düymələri yalnız yazı
          icazəniz olduqda görünür.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni qayda yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Qayda Əlavə Et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Qayda Yarat» başlıqlı pəncərə açılır. İçində ardıcıl olaraq <strong>Qayda adı *</strong>,{" "}
            <strong>Şablon (istəyə bağlı)</strong>, <strong>Uyğunluq məntiqi</strong>,{" "}
            <strong>Qayda aktivdir</strong> qeyd qutusu (standart olaraq işarələnmiş), bir{" "}
            <strong>Şərtlər</strong> bölməsi və bir <strong>Hərəkətlər *</strong> bölməsi var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Qayda adı</strong> yazın — bu məcburi sahədir (məs. «Böyük müqavilələr üçün CFO
            təsdiqi»).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahədə «məs. Böyük müqavilələr üçün CFO təsdiqi» göstərici mətni durur. Adı boş buraxıb
            yadda saxlamağa çalışsanız, pəncərənin altında qırmızı «Qayda adını daxil edin.»
            xəbərdarlığı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Şablon (istəyə bağlı)</strong> açılan siyahısından seçim edin: qaydanı yalnız bir
            müqavilə şablonuna bağlayın, yoxsa <HelpKey>Bütün müqavilələr (org-əhatəli)</HelpKey> kimi
            saxlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahının ilk variantı «Bütün müqavilələr (org-əhatəli)» olur; altında
            təşkilatınızın mövcud müqavilə şablonları sadalanır. (Heç şablon yoxdursa, yalnız
            org-əhatəli variant görünür.)
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <strong>Uyğunluq məntiqi</strong> seçin: <HelpKey>Bütün şərtlər (AND)</HelpKey> — qaydanın
            işə düşməsi üçün hər şərt doğru olmalıdır; <HelpKey>İstənilən şərt (OR)</HelpKey> — bir
            şərtin doğru olması kifayətdir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahıda iki variant var: «Bütün şərtlər (AND)» və «İstənilən şərt (OR)». Standart
            olaraq «Bütün şərtlər» seçilidir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            İstəyə bağlı olaraq şərt əlavə edin. <strong>Şərtlər</strong> bölməsində hər sətirdə üç
            element var: <strong>sahə</strong> açılan siyahısı (məbləğ / növ / valyuta),{" "}
            <strong>operator</strong> açılan siyahısı və <strong>qiymət</strong> sahəsi. Yeni sətir
            üçün <HelpKey>Şərt əlavə et</HelpKey>, sətri silmək üçün yanındakı × düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahə siyahısı «məbləğ (value)», «növ (type)», «valyuta (currency)» variantlarını verir.
            Operator siyahısında gte (&gt;=), lte (&lt;=), gt (&gt;), lt (&lt;), eq (=), neq (≠) və in
            var. Operator <HelpKey>in</HelpKey> olanda qiymət sahəsinin göstəricisi «val1, val2, ...»
            şəklinə keçir — vergüllə ayrılmış neçə qiymət yaza bilərsiniz. Boş qiymətli şərtlər yadda
            saxlanarkən nəzərə alınmır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            <strong>Hərəkətlər *</strong> bölməsində ən azı bir hərəkət qurun. Hər hərəkət üçün növ
            seçin — <HelpKey>mərhələ_əlavə</HelpKey> və ya <HelpKey>mərhələ_atla</HelpKey> — və{" "}
            <strong>Mərhələ adı *</strong> yazın (məcburi). Növ «mərhələ_əlavə» olanda əlavə olaraq{" "}
            <strong>Mövqeyə daxil et</strong> (rəqəm) və <strong>İcraçı rolu</strong> sahələri görünür.
            Yeni hərəkət üçün <HelpKey>Hərəkət əlavə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər hərəkət çərçivə içində göstərilir. «mərhələ_əlavə» seçəndə «Mövqeyə daxil et» («boş =
            sona əlavə et» göstəricisi ilə) və «İcraçı rolu» (məs. «manager, director...» göstəricisi)
            sahələri görünür; «mərhələ_atla» seçəndə bu əlavə sahələr gizlənir. Birdən çox hərəkət
            varsa, hər çərçivənin sağında onu silmək üçün × düyməsi olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={7}>
          <p>
            Altdakı <HelpKey>Qaydanı yadda saxla</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yadda saxlanarkən düymənin yanında fırlanan göstərici çıxır və düymə müvəqqəti deaktiv
            olur. Uğurla saxlanan kimi pəncərə bağlanır və yeni qayda siyahıda peyda olur. Hərəkətdə
            mərhələ adı boş qalıbsa, «Hər hərəkətin mərhələ adı olmalıdır.» xəbərdarlığı çıxır;
            server qəbul etmirsə, «Qayda saxlanılmadı. Yenidən cəhd edin.» mesajı görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: qaydanı oxu, redaktə et və söndür">
        <HelpStep n={1}>
          <p>
            Qaydanın şərt və hərəkətlərini görmək üçün kartın sağındakı aşağı ox ikonasını basın
            (yenidən basanda yığılır).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart açılır və iki blok göstərir: <strong>Şərtlər</strong> (uyğunluq məntiqi mötərizədə
            yazılır; hər şərt monoşrift sətir kimi «sahə operator qiymət» formatında) və{" "}
            <strong>Hərəkətlər</strong> (hər biri «mərhələ_əlavə» yaxud «mərhələ_atla» nişanı, mərhələ
            adı, varsa «@ mövqe N» və mötərizədə icraçı rolu ilə). Şərt yoxdursa «Şərt yoxdur (qayda
            həmişə uyğun gəlir)» yazısı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Qaydanı dəyişmək üçün kartdakı dişli çarx ikonalı (<HelpKey>Redaktə Et</HelpKey>) düyməni
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Qaydanı Redaktə Et» başlıqlı, mövcud ad, şablon, məntiq, vəziyyət, şərtlər və
            hərəkətlərlə əvvəlcədən doldurulmuş eyni forma açılır. Dəyişiklikləri edib{" "}
            <HelpKey>Qaydanı yadda saxla</HelpKey> ilə təsdiqləyin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Qaydanı söndürmək üçün kartdakı qırmızı zibil qutusu ikonalı düyməni basın. (Bu düymə
            yalnız qayda aktiv olduqda görünür.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qayda söndürülür: kartdakı nişan <strong>Aktiv</strong>-dən boz <strong>Qeyri-aktiv</strong>-ə
            keçir və qırmızı zibil qutusu ikonası kartdan yox olur. Qaydanın özü siyahıda qalır,
            sadəcə təsdiq zamanı işə düşmür. Yenidən işə salmaq üçün qaydanı redaktə edib{" "}
            <HelpKey>Qayda aktivdir</HelpKey> qeyd qutusunu işarələyin.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Şərtsiz qayda <strong>hər müqaviləyə</strong> tətbiq olunur — bunu səhifə «Şərt yoxdur (qayda
          həmişə uyğun gəlir)» kimi göstərir. Bütün müqavilələrə bir təsdiq mərhələsi əlavə etmək
          istəyirsinizsə, şərtləri boş buraxın və yalnız hərəkəti qurun. Şərtləri yalnız qaydanı
          müqavilənin məbləği, növü və ya valyutası ilə dəqiqləşdirmək istəyəndə əlavə edin.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Kartdakı qırmızı zibil qutusu düyməsi qaydanı <strong>silmir</strong>, onu{" "}
          <strong>söndürür</strong> (qeyri-aktiv edir) — qayda siyahıda qalır, sadəcə artıq işə
          düşmür. Hər hərəkətin mütləq mərhələ adı olmalıdır; boş mərhələ adı ilə qaydanı yadda saxlaya
          bilməyəcəksiniz. Unutmayın ki, qaydalar yalnız müqavilə{" "}
          <strong>təsdiqə göndərilən an</strong> qiymətləndirilir — artıq prosesdə olan müqavilələrin
          zəncirini geriyə dəyişmir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün qaydalar təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın qaydalarını və müqavilə
          şablonlarını görürsünüz. Qayda yaratmaq, redaktə etmək və söndürmək yalnız{" "}
          <strong>admin</strong>, <strong>menecer</strong> və ya <strong>superadmin</strong> rolu olan
          istifadəçilərə açıqdır; digər rollar üçün <HelpKey>Qayda Əlavə Et</HelpKey>, redaktə və
          söndürmə düymələri ümumiyyətlə göstərilmir.
        </p>
      </HelpCallout>
    </div>
  )
}
