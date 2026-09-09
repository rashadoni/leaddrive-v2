"use client"

/**
 * Board Configuration — help article (Azerbaijani).
 * Lövhənin Konfiqurasiya səhifəsini (/boards/[divisionId]/settings) əhatə edir:
 * tapşırıq statusları (sütunlar), tapşırıq tipləri, event tipləri, tapşırıq əlavə
 * sahələri və cədvəl görünüşü üçün defolt sütunlar. Yalnız admin/manager rolları
 * bu səhifəni görür; yazma əməliyyatları serverdə də qorunur.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function BoardSettingsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Lövhə administratoru və ya menecersiniz"
        goal="Bir lövhənin sütunlarını, tapşırıq və event tiplərini, əlavə sahələrini və cədvəl görünüşünü tənzimləmək"
      >
        Səhifəyə lövhənin yuxarı alətlər zolağındakı dişli ikonası (<HelpKey>Konfiqurasiya</HelpKey>)
        ilə çatırsınız. Səhifəni yalnız <strong>admin</strong>, <strong>superadmin</strong> və{" "}
        <strong>manager</strong> rolları aça bilir — digər rollar avtomatik lövhənin özünə geri
        yönləndirilir. Bütün tənzimləmələr təşkilatınız (tenant) daxilindədir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda dişli ikonası ilə <HelpKey>Konfiqurasiya</HelpKey> sözü, altında «statuslar,
          tapşırıq tipləri, event tipləri, əlavə sahələr və cədvəl sütunları» izahı (cari lövhənin
          açarı ilə) var. Başlığın üstündə geri ox və lövhənin adı durur — ona basıb lövhəyə qayıdırsınız.
          Səhifə beş bölmədən ibarətdir, hər biri ayrı kartdır:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Tapşırıq statusları">Bu lövhənin sütunları — tapşırığın keçdiyi axın. Hər sütun 6 kanonik mərhələdən birinə («Counts as») uyğunlaşdırılır. Yalnız bu lövhəyə aiddir.</HelpDef>
          <HelpDef term="Tapşırıq tipləri">Tapşırıqlar üçün funksional kateqoriyalar (məs. SEO, Social Media, şöbələr). Bütün lövhələr üçün ortaqdır.</HelpDef>
          <HelpDef term="Event tipləri">Tapşırığın aid olduğu kanal / mənbə (914 LINE, SOCIAL MEDIA…) — filtrləmə üçün. Bütün lövhələr üçün ortaqdır.</HelpDef>
          <HelpDef term="Tapşırıq əlavə sahələri">Tapşırıqlarda əlavə sahələr (məs. Brand, Channel). Bütün lövhələr üçün ortaqdır; cədvəldə sütun kimi görünür.</HelpDef>
          <HelpDef term="Defolt sütunlar">Tapşırıqlar cədvəli görünüşündə hansı sütunların standart göründüyü.</HelpDef>
          <HelpDef term="Counts as (Sayılır)">Hər sütunun arxasında duran kanonik status: Backlog, To Do, In Progress, Testing, Review, Done. Sütunun adını dəyişsəniz belə, status yerində qalır.</HelpDef>
        </dl>
        <p>
          Hər saxlama əməliyyatından sonra sağ yuxarıda qısa bildiriş (toast) çıxır — uğurda yaşıl,
          xətada qırmızı.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: tapşırıq statuslarını (sütunları) dəyiş">
        <HelpStep n={1}>
          <p>
            <HelpKey>Tapşırıq statusları</HelpKey> kartında sütunlar siyahısını görürsünüz. Sütunu
            yuxarı/aşağı oxlarla (chevron) tərpədərək sırasını dəyişin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə soldan: yuxarı/aşağı oxlar, rəngli dairə, sütunun adı sahəsi, sağda «Counts as»
            açılan siyahısı və zibil qutusu ikonası. Birinci sütunda yuxarı ox, sonuncuda aşağı ox sönük olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sütunun adını birbaşa mətn sahəsində dəyişin (maksimum 40 simvol). Rəngi seçmək üçün soldakı
            rəngli dairəyə basın və açılan paletdən rəng seçin — və ya <HelpKey>Avto</HelpKey> ilə standart
            mərhələ rənginə qayıdın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Dairənin altında kiçik palet açılır: solda «Avto» düyməsi, sonra rəng nümunələri. Seçdiyiniz
            rəng dərhal dairəyə tətbiq olunur və palet bağlanır (Escape ilə də bağlanır).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Hər sütunun sağındakı <HelpKey>Counts as</HelpKey> (Sayılır) açılan siyahısından sütunun
            uyğunlaşdığı kanonik mərhələni seçin: Backlog, To Do, In Progress, Testing, Review, Done.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahı altı sabit variantı göstərir. Bu, sütunun görünən adı ilə arxa plandakı status
            arasında körpü qurur — hesabatlar və avtomatlaşdırma statusla işləyir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Yeni sütun əlavə etmək üçün siyahının altındakı <HelpKey>Sütun əlavə et</HelpKey> kəsik-xətli
            düyməsini basın. Sütunu silmək üçün onun sətrindəki zibil qutusu ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Boş adlı yeni sətir əlavə olunur (standart status «To Do»). Ən azı 1 sütun qalmalıdır — son
            sütunun silmə ikonası sönükdür. Maksimum 12 sütun olar; limitə çatanda «Sütun əlavə et» düyməsi sönür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Bitirdikdə kartın sağ aşağısındakı <HelpKey>Statusları saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymədə dönən yükləmə ikonası görünür, sonra sağ yuxarıda yaşıl «Statuslar saxlanıldı»
            bildirişi çıxır. Hər hansı sütunun adı boşdursa, düymə aktiv olmur.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Sütunun <strong>adı</strong> sərbəstdir, amma <HelpKey>Counts as</HelpKey> mərhələsi yük
            daşıyır: hesabatlar, sürüşdürmə (drag) məntiqi və avtomatlaşdırma kanonik statusa baxır. Sütunun
            arxasındakı statusu dəyişəndə həmin sütundakı tapşırıqların effektiv vəziyyəti də dəyişir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: tapşırıq tiplərini və ya event tiplərini idarə et">
        <HelpStep n={1}>
          <p>
            <HelpKey>Tapşırıq tipləri</HelpKey> (və ya <HelpKey>Event tipləri</HelpKey>) kartında mövcud
            tiplərin siyahısı var. İkisi də eyni qaydada işləyir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə: yuxarı/aşağı oxlar, rəngli dairə, ad sahəsi, sağda kiçik boz texniki ad
            (monospace), <HelpKey>Aktiv</HelpKey>/<HelpKey>Qeyri-aktiv</HelpKey> nişanı və zibil qutusu.
            Təşkilatın hələ öz tipi yoxdursa, defolt («default-» ilə başlayan) sətirlər göstərilir — onlar
            redaktə olunmur (sönükdür), ilk öz tipinizi əlavə edəndə isə əvəzlənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Yeni tip əlavə etmək üçün kartın altındakı kəsik-xətli sətrə adı yazın, istəsəniz soldakı
            dairədən rəng seçin və <HelpKey>Add</HelpKey> düyməsini (və ya Enter) basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxlama zamanı düymə dönən ikonaya keçir; uğurda yeni tip siyahıda peyda olur, giriş sahəsi
            təmizlənir. Xəta olarsa, sağ yuxarıda qırmızı bildiriş çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Adı dəyişmək üçün mətn sahəsini düzəldin və başqa yerə klikləyin (blur) — dəyişiklik o anda
            yadda saxlanır. Rəngi dəyişmək üçün dairəyə basıb palet nümunəsini seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ad maksimum 60 simvoldur. Blur-dan sonra yeni ad serverə göndərilir; sahəni boş buraxsanız,
            əvvəlki ad geri qayıdır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Tipi söndürmək üçün <HelpKey>Aktiv</HelpKey> nişanına basın — <HelpKey>Qeyri-aktiv</HelpKey>
            olur (yenidən basanda geri aktivləşir). Tamamilə silmək üçün zibil qutusu ikonasına basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qeyri-aktiv sətir bir az solğunlaşır. Silmədə «{"{tip}"} silinsin?» təsdiq pəncərəsi açılır;
            təsdiqlədikdən sonra tip siyahıdan çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Tapşırıq tipləri <strong>nə</strong> (funksional kateqoriya — SEO, dizayn…), event tipləri isə
            <strong>haradan / hansı kanal</strong> (914 LINE, SOCIAL MEDIA…) sualına cavab verir. Hər ikisi
            bütün lövhələr üçün ortaqdır — burada bir dəfə qurursunuz, hər lövhədə görünür.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: cədvəl görünüşünün defolt sütunları">
        <HelpStep n={1}>
          <p>
            <HelpKey>Cədvəl görünüşü üçün defolt sütunlar</HelpKey> kartında üstdə canlı bir cədvəl
            önbaxışı, altda isə sütun çipləri var. Çipə basaraq sütunu göstərin və ya gizlədin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Aktiv (görünən) çiplərdə tik (✓) işarəsi və vurğulu fon olur. Önbaxış cədvəli dərhal seçdiyiniz
            sütunları əks etdirir. <HelpKey>Task</HelpKey> (ad) sütunu həmişə açıqdır — yanında «(həmişə)»
            yazısı var və sönük görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Çip dəyişikliyi yalnız <strong>bu brauzerə</strong> dərhal tətbiq olunur (lokal yaddaşda
            saxlanır). Seçimi bütün təşkilata standart etmək üçün aşağıdakı{" "}
            <HelpKey>Təşkilat defoltu kimi saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Çipə basanda sağ yuxarıda kiçik yaşıl «Saxlanıldı» yazısı yanıb-sönür. Təşkilat defoltu artıq
            varsa, düymə «Təşkilat defoltunu yenilə» olur və yanında «Təşkilat defoltunu sil» linki çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="security">
          <p>
            Təşkilat defoltunu yalnız admin və ya onu yaradan dəyişə bilər — başqası cəhd etsə, «Təşkilat
            defoltunu yalnız admin və ya yaradan dəyişə bilər» xəbərdarlığı çıxır. Defolt silinəndə öz
            seçimini etməmiş üzvlər kompakt standart sütun dəstinə qayıdır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: tapşırıq əlavə sahələri">
        <HelpStep n={1}>
          <p>
            <HelpKey>Tapşırıq əlavə sahələri</HelpKey> kartında təşkilatın mövcud əlavə sahələri çip kimi
            sadalanır (məs. Brand, Channel) — hər çipdə sahənin etiketi və tipi göstərilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hələ sahə yoxdursa «Hələ əlavə sahə yoxdur.» yazısı görünür. Qeyri-aktiv sahələr solğun
            görünür. Yükləmə alınmasa, sarı «Əlavə sahələri yükləmək olmadı.» mesajı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sahələri yaratmaq və redaktə etmək üçün aşağıdakı <HelpKey>Əlavə sahələri idarə et</HelpKey>
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sizi <HelpKey>/settings/custom-fields</HelpKey> səhifəsinə — tam əlavə-sahə redaktoruna —
            aparır. Bu səhifə yalnız mövcud sahələri göstərir; əsl redaktə orada baş verir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Bütün konfiqurasiya təşkilatınızla məhdudlaşır. Səhifə yalnız admin/manager rollarına açıqdır;
          digər istifadəçilər avtomatik lövhəyə geri yönləndirilir. Hətta düymələri görsəniz belə, yazma
          icazəsi yoxdursa serverdə əməliyyat rədd olunur (403) — qadağa həm interfeysdə, həm də arxa planda
          tətbiq olunur.
        </p>
      </HelpCallout>
    </div>
  )
}
