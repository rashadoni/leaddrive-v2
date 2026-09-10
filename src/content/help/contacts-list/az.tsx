"use client"

/**
 * Contacts (list) — help article (Azerbaijani).
 * Əhatə edir: /contacts səhifəsi — kontakt bazasının siyahısı.
 * Statistika kartları, Əlaqə (engagement) icmalı, axtarış/filtr/sıralama,
 * cədvəldə sətirdaxili redaktə, sətrə klikləyib kartı açmaq, kütləvi
 * əməliyyat paneli, saxlanmış görünüşlər, CSV idxal, yeni kontakt.
 * Kontakt KARTININ daxili tabları (İcmal/Fəaliyyətlər/Sövdələşmələr) ayrı
 * səhifədir (/contacts/[id]) və bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function contactslistHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış nümayəndəsi və ya əməliyyat administratorusunuz"
        goal="Kontakt bazasını gözdən keçirmək, lazımi şəxsi tapmaq, məlumatlarını cədvəldə tez düzəltmək və kontakt kartına keçmək"
      >
        Səhifəyə <HelpKey>Kontaktlar</HelpKey> → <HelpKey>Siyahı</HelpKey> bölməsindən çatırsınız.
        Bütün kontaktlar yalnız sizin təşkilatınıza aiddir. Səhifə açılan kimi bütün kontaktlar bir
        dəfəyə yüklənir, ona görə axtarış, filtr və sıralama dərhal — səhifə yenilənmədən — işləyir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Kontaktlar</HelpKey> adı və «Kontakt bazasını idarə et» izahı var. Sağ
          yuxarıda üç düymə durur: <HelpKey>Insights</HelpKey> (kontakt analitikasına keçir),{" "}
          <HelpKey>CSV Import</HelpKey> (fayldan toplu idxal) və <HelpKey>Kontakt əlavə et</HelpKey>.
          Altda dörd statistika kartı, sonra rəngli nöqtələrlə <strong>Əlaqə</strong> (engagement)
          icmalı, axtarış/filtr/sıralama sətri və nəhayət kontakt cədvəli gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Cəmi">Sistemdəki bütün kontaktların sayı.</HelpDef>
          <HelpDef term="Aktiv">Aktiv (statusu açıq) kontaktların sayı.</HelpDef>
          <HelpDef term="Email ilə">E-poçt ünvanı olan kontaktların sayı.</HelpDef>
          <HelpDef term="Telefonla">Telefon nömrəsi olan kontaktların sayı.</HelpDef>
          <HelpDef term="Əlaqə (engagement) balı">
            Hər kontakt üçün server tərəfdən hesablanan rəqəm: 50+ «isti» (qırmızı), 20–49 «ilıq»
            (kəhrəba), 20-dən aşağı «soyuq» (mavi). Cədvəldə dəyişdirilə bilməz.
          </HelpDef>
          <HelpDef term="Mənbə">Kontaktın necə əldə edildiyi (sayt, tövsiyə, soyuq zəng, LinkedIn, email, SMS, sosial, digər).</HelpDef>
          <HelpDef term="Kateqoriya">Kontaktın seqmenti: VIP, partnyor, prospekt, qeyri-aktiv (toplu paneldə «regular» da var).</HelpDef>
          <HelpDef term="Portal">Kontakt müştəri portalına giriş əldə edibsə yaşıl «Portal», dəvət gözləyirsə sarı «Pending» nişanı.</HelpDef>
        </dl>
        <p>
          Cədvəldə hər sətir bir kontaktdır: solda seçim qutusu, sonra baş hərflərlə dairəvi nişan və
          ad, şirkət, email, telefon, mənbə, kateqoriya, bal, status (aktiv/qeyri-aktiv açarı) və
          portal sütunları, sağda isə redaktə (qələm) və sil (zibil qutusu) düymələri. Telefondan
          açanda cədvəl əvəzinə yığcam kart siyahısı göstərilir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: kontakt tap və kartını aç">
        <HelpStep n={1}>
          <p>
            Soldakı axtarış qutusuna ad, email, telefon, şirkət və ya brend hissəsini yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siz yazdıqca cədvəl dərhal süzülür və qutunun yanındakı «Nəticələr» sayğacı azalır.
            Heç nə tapılmasa, «Kontakt tapılmadı» mətni görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstəsəniz sağdakı <HelpKey>Bütün kateqoriyalar</HelpKey> açılan siyahısı ilə yalnız bir
            kateqoriyanı (məs. VIP), qonşu siyahı ilə isə sıralamanı (Ad A→Z, Şirkət, Email ilə,
            Aktiv birinci) seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl seçilmiş kateqoriyaya görə daralır və yeni qaydaya görə yenidən sıralanır.
            Nəticələr sayğacı dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Kontaktın kartını açmaq üçün cədvəldə onun <strong>adına bir dəfə klikləyin</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Həmin kontaktın ayrıca səhifəsi açılır (İcmal, Fəaliyyətlər, Sövdələşmələr, Əlaqə
            tabları ilə). Telefon kartlarında isə adın olduğu sahəyə toxunmaq kifayətdir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: cədvəldə sətirdaxili redaktə">
        <HelpStep n={1}>
          <p>
            Adı dəyişmək üçün cədvəldə kontaktın adına <strong>iki dəfə klikləyin</strong> (cüt klik).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ad mətn sahəsinə çevrilir və fokuslanır. Yeni adı yazıb <HelpKey>Enter</HelpKey> ilə
            təsdiqləyin və ya <HelpKey>Esc</HelpKey> ilə imtina edin. Boş və ya dəyişməyən ad
            saxlanmır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Email, telefon, mənbə və ya kateqoriya xanasına klikləyib birbaşa cədvəldə dəyişin.
            Mənbə və kateqoriya açılan siyahıdan seçilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Xana redaktə rejiminə keçir; dəyişikliyi təsdiqlədikdə dərhal yadda saxlanır və kontakt
            siyahısı yenilənir. Xəta olsa, qırmızı bildiriş çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Kontaktı aktiv/qeyri-aktiv etmək üçün <strong>Status</strong> sütunundakı açarı çevirin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açarın yanındakı yazı <strong>Aktiv</strong> ilə <strong>Qeyri-aktiv</strong> arasında
            keçir, yuxarıdakı <strong>Aktiv</strong> statistika kartı uyğun olaraq yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Bir kontaktı redaktə pəncərəsində tam dəyişmək üçün sətrin sağındakı qələm ikonasını
            (<HelpKey>Redaktə et</HelpKey>), silmək üçün isə zibil qutusu ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qələm — kontakt formasını mövcud məlumatla açır. Zibil qutusu — «Kontaktı sil» təsdiq
            pəncərəsini açır; təsdiqlədikdə kontakt siyahıdan çıxır və sayğaclar yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: çox kontaktla bir anda işlə">
        <HelpStep n={1}>
          <p>
            Sətirlərin solundakı qutuları işarələyin. Başlıqdakı qutu ilə cari səhifədəki hamısını
            seçə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yuxarıda «Seçildi: N / cəm» yazılı kütləvi əməliyyat paneli peyda olur. Süzgəcdən keçən
            BÜTÜN kontaktları seçmək üçün paneldəki «Hamısını seç» bağlantısı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Paneldən bir əməliyyat seçin: <HelpKey>Kateqoriya…</HelpKey>, <HelpKey>Mənbə…</HelpKey>{" "}
            və ya <HelpKey>Aktivlik…</HelpKey> dəyişin; etiket xanasına söz yazıb{" "}
            <HelpKey>+ Etiket</HelpKey> / <HelpKey>− Etiket</HelpKey> ilə əlavə edin və ya silin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Əməliyyat bütün seçilmiş kontaktlara tətbiq olunur, neçə kontaktın yeniləndiyini bildirən
            yaşıl mesaj çıxır, seçim sıfırlanır və cədvəl yenidən yüklənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Seçilmişləri silmək üçün panelin sağındakı qırmızı <HelpKey>Sil</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Kontaktı sil» təsdiq pəncərəsi neçə kontaktın silinəcəyini göstərir. Təsdiqlədikdən
            sonra hamısı siyahıdan çıxır və statistika kartları yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni kontakt əlavə et və ya CSV idxal et">
        <HelpStep n={1}>
          <p>
            Tək kontakt üçün sağ yuxarıdakı <HelpKey>Kontakt əlavə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kontakt forması açılır (ad, email, telefon, vəzifə, şirkət, mənbə, brend, kateqoriya).
            Yadda saxladıqda yeni kontakt siyahıya əlavə olunur və <strong>Cəmi</strong> kartı bir
            vahid artır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Çoxlu kontaktı fayldan gətirmək üçün <HelpKey>CSV Import</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            CSV idxal pəncərəsi açılır: faylı seçib sütunları kontakt sahələrinə uyğunlaşdırırsınız.
            İdxal bitdikdə cədvəl avtomatik yenilənir və yeni kontaktlar görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Tez-tez işlətdiyiniz axtarış+filtr+sıralama birləşməsini saxlamaq üçün axtarış sətrinin
            üstündəki saxlanmış görünüş zolağından istifadə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxlanmış görünüşə klikləmək cari filtrləri tətbiq edir. Qeyd: ünvanda{" "}
            <HelpKey>?search</HelpKey> və ya <HelpKey>?category</HelpKey> parametri varsa, o,
            saxlanmış standart görünüşdən üstün tutulur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Bir klik — kartı açır, cüt klik (iki dəfə) — adı yerindəcə redaktə edir. Ad, email,
          telefon, mənbə, kateqoriya və status cədvəldən birbaşa dəyişdirilə bilər; engagement balı,
          şirkət və portal sütunları isə yalnız oxunur. Siyahı 20 sətirlik səhifələrə bölünür — altdakı
          oxlarla keçin.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Silmə geri qaytarılmır. Kontaktı arxivdə saxlamaq, yox tamamilə silmək istəyirsinizsə,
          silmək yerinə <strong>Status</strong> açarı ilə onu <strong>Qeyri-aktiv</strong> edin —
          kontakt və tarixçəsi qalır, sadəcə aktiv sayılmır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün kontaktlar təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın kontaktlarını görür
          və dəyişirsiniz, başqa təşkilatın bazasına çıxışınız yoxdur. Bütün dəyişikliklər (sətirdaxili
          redaktə, toplu əməliyyatlar, silmə) eyni org-scope qaydaları altında işləyir.
        </p>
      </HelpCallout>
    </div>
  )
}
