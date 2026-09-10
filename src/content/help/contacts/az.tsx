"use client"

/**
 * Contacts — Segment insights help article (Azerbaijani).
 * Köhnə paylaşılan "list-power" məqaləsindən ayrılıb: yalnız
 * /contacts səhifəsi (Seqment analitikası) haqqındadır.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ContactsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış / marketinq meneceri"
        goal="Kontakt bazasını bir baxışda oxumaq və zəif yerləri tapmaq"
      >
        Bu səhifə kontaktlarınızın <strong>seqment analitikasıdır</strong> — fərdi
        kontakt redaktə etmək yeri deyil. O, mövcud kontaktları kateqoriya, mənbə və
        brend üzrə bölür, SMS əhatəsini göstərir və artım trendini çəkir. Rəqəmlər
        kontaktlara siz və ya komandanız əvvəlcədən doldurduğu sahələrdən gəlir, ona
        görə boş diaqramlar adətən «bu sahə hələ doldurulmayıb» deməkdir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıq <strong>Seqment analitikası</strong>-dır. Sağ üstdə üç düymə var:{" "}
          <HelpKey>Kontakt siyahısı</HelpKey> sizi tam kontakt cədvəlinə (
          <code className="bg-muted px-1 rounded">/contacts</code>) aparır,{" "}
          <HelpKey>Yenilə</HelpKey> say-göstəriciləri yenidən hesablayır,{" "}
          <HelpKey>CSV</HelpKey> isə kateqoriya / mənbə / brend bölgüsünü fayl kimi yükləyir.
          Aşağıda kartlar və diaqramlar gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Kateqoriya">
            Kontaktın seqmenti — VIP, Adi, Partnyor, Potensial və ya Deaktiv. Bunu hər
            kontaktın özündə təyin edirsiniz; burada yalnız nəticə görünür.
          </HelpDef>
          <HelpDef term="Mənbə">
            Kontaktın haradan gəldiyi — Sayt, Tövsiyə, Soyuq zəng, LinkedIn, Email, SMS,
            Sosial, Tədbir, Outlook və ya Digər.
          </HelpDef>
          <HelpDef term="SMS atribusiyası">
            Heç olmasa bir kampaniya SMS-i ilə əlaqələndirilmiş kontaktların payı —
            «əhatə» faiz kimi göstərilir.
          </HelpDef>
          <HelpDef term="Aktivlik balı">
            Kateqoriya üzrə kontaktların orta aktivlik göstəricisi; zolaq nə qədər uzundursa, bal o qədər yüksəkdir.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: səhifəni oxumaq">
        <HelpStep n={1}>
          <p>
            Səhifəni açın və yüklənməsini gözləyin. İlk açılışda rəqəmlər avtomatik gəlir;
            yenilərini istəyirsinizsə sağ üstdə <HelpKey>Yenilə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yüklənmə zamanı boz «skelet» bloklar görünür, sonra yuxarıda iki kart — solda{" "}
            <strong>SMS atribusiyası</strong>, sağda <strong>Kateqoriya üzrə aktivlik</strong> —
            açılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>SMS atribusiyası</strong> kartına baxın. O, üç rəqəm verir —{" "}
            <HelpKey>Hər zaman</HelpKey>, <HelpKey>Son 30 gün</HelpKey> və{" "}
            <HelpKey>Son 90 gün</HelpKey> — və altında mavi əhatə zolağı.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər zaman / 30 / 90 günlük SMS alan kontakt sayları, mavi tərəqqi zolağı və
            «Kontaktların X%-i SMS atribusiyasına sahibdir» yazısı. Hələ heç bir SMS
            yoxdursa, kampaniyalara yönləndirən sarı qeyd çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sağdakı <strong>Kateqoriya üzrə aktivlik</strong> kartını oxuyun — hər kateqoriya
            üçün rəngli bal zolağı.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə kateqoriya nişanı (VIP / Adi / Partnyor / Potensial / Deaktiv), rəngli
            zolaq, sağda orta bal və mötərizədə həmin kateqoriyadakı kontakt sayı.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Aşağıdakı dörd <strong>göstərici kartına</strong> diqqət edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Cəmi kontaktlar</HelpKey>, <HelpKey>Son 30 gün</HelpKey> (əvvəlki 30 günə
            nisbətən faizlə — artımda yaşıl, düşmədə qırmızı), <HelpKey>Brendlə</HelpKey>{" "}
            (neçə unikal brend) və <HelpKey>SMS əhatəsi</HelpKey> (faiz + əhatə / cəmi nisbəti).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: AI ilə qısa rəy almaq">
        <HelpStep n={1}>
          <p>
            <strong>AI analitikası</strong> kartını tapın (bənövşəyi-mavi fonlu) və sağdakı{" "}
            <HelpKey>Generasiya</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə <strong>Analiz olunur…</strong>-a çevrilir, sonra Claude Haiku-nun cari
            rəqəmlər üzrə hazırladığı bir neçə qısa müşahidə maddə-maddə siyahı kimi görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Verilənləri yenilədikdən sonra eyni yerdəki <HelpKey>Yenidən generasiya</HelpKey>{" "}
            düyməsi ilə təhlili təzələyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Köhnə müşahidələr silinir və yenilənmiş rəqəmlər əsasında təzə siyahı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          AI mətni yalnız ekrandakı toplu rəqəmləri ümumiləşdirir — fərdi kontakt adları
          göndərilmir. Boş səhifədə generasiya etsəniz, müşahidələr də zəif olar; əvvəlcə
          kontaktlara kateqoriya və mənbə doldurun.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: diaqramları oxumaq və dərinə getmək">
        <HelpStep n={1}>
          <p>
            <strong>Kateqoriyaya görə</strong> dairəvi diaqrama baxın və istədiyiniz dilimə
            <strong> klikləyin</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kateqoriya öz rəngində dilim kimi görünür, ad və say etiketlə. Dilimə kliklədikdə
            kontakt siyahısı həmin kateqoriya ilə süzgəclənmiş açılır. Altda «Göstərilir X
            kateqoriyalı kontakt · Y kateqoriyasız» yazısı olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Mənbəyə görə</strong> sütun diaqramında hər sütuna klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər mənbə üçün bir sütun (Sayt, Tövsiyə, Soyuq zəng və s.); sütuna kliklədikdə
            kontakt siyahısı həmin mənbə ilə süzgəclənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>İlk 10 brend</strong> üfüqi sütun diaqramında brendə klikləyin və{" "}
            <strong>Həftəlik yeni kontaktlar</strong> xətti ilə artım trendini izləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Solda ən çox təkrarlanan brendlər say üzrə sıralanmış sütunlar kimi (brendə klik =
            o brend üzrə axtarışla süzülmüş siyahı), sağda son 12 həftədə həftəlik yeni kontakt
            sayını göstərən xətt qrafiki.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          Diaqramlar yalnız sahəsi doldurulmuş kontaktları sayır. Kateqoriya, mənbə və ya brend
          boşdursa, «Heç bir kontakt üçün … təyin edilməyib» yazısı çıxır — bu xəta deyil, sadəcə
          həmin sahənin doldurulmadığı deməkdir. Düzəliş: bir kontaktı açın → Dəyiş → uyğun sahəni
          (Kateqoriya / Mənbə / Brend) seçin.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: ixrac və siyahıya keçid">
        <HelpStep n={1}>
          <p>
            Bölgünü kənarda saxlamaq üçün sağ üstdə <HelpKey>CSV</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Brauzer <code className="bg-muted px-1 rounded">contacts-segments-TARİX.csv</code> faylını
            yükləyir; içində kateqoriya, mənbə və brend üzrə say sətirləri olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Konkret kontaktlarla işləmək lazım olanda <HelpKey>Kontakt siyahısı</HelpKey> düyməsi
            ilə tam cədvələ keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Səhifə kontakt siyahısına (<code className="bg-muted px-1 rounded">/contacts</code>)
            keçir, orada hər kontaktı açıb redaktə edə bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        Səhifəni dəyərli edən şey kontaktların <strong>düzgün etiketlənməsidir</strong>:
        kateqoriya, mənbə və brend nə qədər çox doldurulsa, diaqramlar bir o qədər mənalı olur.
        Boş seqmentləri «düzəltmək» istəyirsinizsə, diaqramdan kategoriyasız/mənbəsiz qrupa
        klikləyib siyahıda toplu doldurun.
      </HelpCallout>

      <HelpCallout kind="security">
        Bütün rəqəmlər təşkilatınızla məhdudlaşır — analitika yalnız öz tenant-ınızın kontaktlarını
        oxuyur. AI ümumiləşdirmə yalnız toplu göstəriciləri emal edir, fərdi kontakt məlumatlarını
        deyil; CSV ixracı isə yalnız sizin gördüyünüz aqreqatı ehtiva edir.
      </HelpCallout>
    </div>
  )
}
