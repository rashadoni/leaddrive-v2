"use client"

/**
 * Email Templates — help article (Azerbaijani).
 * Köhnə birgə "email" məqaləsindən ayrılıb: yalnız
 * Email şablonları səhifəsini əhatə edir — şablon yaratma,
 * kateqoriya/dil filtrləri, axtarış, redaktor (HTML/Visual),
 * dəyişənlər, bloklar, baxış və silmə. Göndərmə/kampaniya
 * hissələri bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function EmailTemplatesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq və ya satış əməkdaşısınız"
        goal="Kampaniyalar və bildirişlər üçün təkrar istifadə olunan, dəyişənlərlə fərdiləşən email şablonları yaratmaq və idarə etmək"
      >
        Səhifə bütün email şablonlarınızı bir yerdə saxlayır. Şablonu bir dəfə yaradırsınız —
        sonra onu kampaniyalarda və ya bildirişlərdə təkrar-təkrar istifadə edirsiniz.{" "}
        <HelpKey>&#123;&#123;client_name&#125;&#125;</HelpKey> kimi dəyişənlər göndərilən anda
        həqiqi məlumatla əvəz olunur. Bütün şablonlar yalnız sizin təşkilatınız üçündür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Email şablonları</HelpKey> adı və «Kampaniyalar üçün çoxdəfəli email
          şablonları yaradın» izahı var. Sağ yuxarıda iki düymə durur:{" "}
          <HelpKey>Şablondan</HelpKey> (hazır kitabxana şablonundan başlamaq) və{" "}
          <HelpKey>Yeni şablon</HelpKey> (sıfırdan yaratmaq). Altında axtarış sahəsi, sonra iki
          filtr cərgəsi — <strong>Dil</strong> və <strong>Kateqoriya</strong> — və ən altda
          şablon kartlarının torudur (ekranda üç sütuna qədər).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Şablon">Adı, mövzusu, məzmunu, kateqoriyası və dili olan, təkrar istifadə üçün saxlanan email.</HelpDef>
          <HelpDef term="Mövzu">Alıcıların görəcəyi email mövzu sətri (kartda «Mövzu: …» kimi göstərilir).</HelpDef>
          <HelpDef term="Kateqoriya">Şablonun tipi — Ümumi, Xoş gəldiniz, Onboarding, Bildiriş, Marketinq, Təkrar əlaqə, Təklif.</HelpDef>
          <HelpDef term="Dil">Şablonun məzmun dili (🇦🇿 AZ / 🇷🇺 RU / 🇬🇧 EN bayraqları ilə işarələnir).</HelpDef>
          <HelpDef term="Dəyişən">&#123;&#123;client_name&#125;&#125;, &#123;&#123;company&#125;&#125; kimi yer tutucu — göndərmə anında real məlumatla doldurulur.</HelpDef>
          <HelpDef term="Aktiv / Qeyri-aktiv">Şablonun vəziyyəti — qeyri-aktiv kart soluq (yarı şəffaf) görünür.</HelpDef>
        </dl>
        <p>
          Hər şablon kartında ad, yanında yaşıl/boz nöqtə (aktivlik) və dil bayrağı, altında «Mövzu:
          …», sonra məzmunun mətn önbaxışı (HTML-dən təmizlənmiş ilk sətirlər) durur. Aşağıda
          kateqoriya nişanı, <strong>Aktiv</strong> / <strong>Qeyri-aktiv</strong> etiketi və varsa
          dəyişənlərin sayı («N dəyişən») görünür. Karta basanda redaktə forması açılır. Heç şablon
          yoxdursa, «Şablon yoxdur» və altında «İlk email şablonunu yaradın» mesajı göstərilir;
          axtarış/filtr nəticə vermirsə «Heç nə tapılmadı» yazılır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: sıfırdan yeni şablon yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni şablon</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Demək olar bütün ekranı tutan böyük forma açılır. Başlıqda «Yeni şablon», yuxarı cərgədə
            dörd sahə — <strong>Ad</strong>, <strong>Kateqoriya</strong>, <strong>Mövzu</strong>,{" "}
            <strong>Dil</strong> — altında isə məzmun redaktoru durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Ad</strong> və <strong>Mövzu</strong> sahələrini doldurun (hər ikisi
            məcburidir). <strong>Kateqoriya</strong> və <strong>Dil</strong> açılan siyahılarından
            uyğun olanı seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kateqoriya siyahısında yeddi seçim var (Ümumi, Xoş gəldiniz, Onboarding, Bildiriş,
            Marketinq, Təkrar əlaqə, Təklif). Dil siyahısında 🇷🇺 RU / 🇦🇿 AZ / 🇬🇧 EN durur. Ad və ya
            Mövzu boş qalıb yadda saxlamağa çalışsanız, formanın yuxarısında qırmızı «Ad və mövzu
            tələb olunur» xəbərdarlığı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Məzmunu yazın. Standart olaraq <HelpKey>✏️ HTML</HelpKey> redaktoru açıqdır — yuxarıdakı
            keçidlə <HelpKey>🎨 Visual</HelpKey> redaktora da keçə bilərsiniz. HTML redaktorunda
            formatlama paneli (qalın, maili, alt xətt, şrift ölçüsü, rəng, düzləndirmə, siyahılar,
            link, şəkil yükləmə) və üç tab var: <HelpKey>✏️ Redaktor</HelpKey>,{" "}
            <HelpKey>👁 Baxış</HelpKey> və <HelpKey>⬛ Split</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Redaktor tabında mətn yazma sahəsinin üstündə «🧱 Bloklar» paneli görünür — Hero,
            Текстовый блок, Кнопка CTA, 2 колонки, Картинка və s. düymələri. Bir bloka basanda onun
            hazır HTML-i kursorun olduğu yerə əlavə olunur və elə oradaca redaktə edilə bilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Fərdiləşdirmə üçün mavi zolaqdakı <strong>Müştəri məlumatları</strong> dəyişən
            düymələrindən istifadə edin — məsələn <HelpKey>👤 Müştəri adı</HelpKey>,{" "}
            <HelpKey>🏢 Şirkət</HelpKey>, <HelpKey>📆 Tarix</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düyməyə basanda kursorun yerinə{" "}
            <HelpKey>&#123;&#123;client_name&#125;&#125;</HelpKey> kimi etiket daxil olunur. Hər
            düymənin üstünə gələndə onun dəqiq dəyişən adı (məs. <code>&#123;&#123;company&#125;&#125;</code>) ipucu kimi görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Nəticəni yoxlamaq üçün <HelpKey>👁 Baxış</HelpKey> tabına keçin (və ya{" "}
            <HelpKey>⬛ Split</HelpKey> ilə HTML və canlı baxışı yan-yana görün).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Baxışda dəyişənlər nümunə dəyərlərlə əvəzlənir və sarı fonla işarələnir — məsələn{" "}
            <HelpKey>&#123;&#123;client_name&#125;&#125;</HelpKey> → «Иван Иванов»,{" "}
            <HelpKey>&#123;&#123;company&#125;&#125;</HelpKey> → «Güven Technology». Bu yalnız
            önbaxışdır; saxlanan şablonda dəyişənlər olduğu kimi qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Aşağıda sağdakı <HelpKey>Saxla</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> və ya sağ yuxarıdakı × ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Saxlanılır...» yazısına keçir, sonra forma bağlanır və yeni şablon kartlar
            torunda peyda olur. Dil və kateqoriya filtrlərindəki saylar (məs. «🇦🇿 AZ (1)») uyğun
            olaraq artır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: hazır kitabxana şablonundan başla">
        <HelpStep n={1}>
          <p>
            Sıfırdan yazmaq əvəzinə sağ yuxarıdakı <HelpKey>Şablondan</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Şablon kitabxanası» pəncərəsi açılır və «İşə başlamaq üçün hazır şablon seçin» izahı ilə
            hazır şablon kartlarını sadalayır. Hər kartda ikon, ad, qısa təsvir və kateqoriya nişanı
            var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bəyəndiyiniz kartın üstünə basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kitabxana pəncərəsi bağlanır və hazır dizaynla (vizual redaktor rejimində) yeni şablon
            forması açılır. İndi adı, mövzunu yazıb məzmunu öz mətninizlə redaktə edə bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Ad və mövzunu doldurun, lazım gəlsə dizaynı dəyişin və <HelpKey>Saxla</HelpKey> ilə yadda
            saxlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxlandıqdan sonra şablon adi kart kimi torda görünür və başqa şablonlar kimi axtarış,
            filtr və redaktəyə açıqdır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: şablon tap, redaktə et və ya sil">
        <HelpStep n={1}>
          <p>
            Lazımi şablonu tapmaq üçün axtarış sahəsinə ad və ya mövzu yazın, yaxud{" "}
            <strong>Dil</strong> / <strong>Kateqoriya</strong> filtr düymələrindən istifadə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Filtrlərdə yalnız mövcud dil/kateqoriyalar düymə kimi görünür və yanında say durur (məs.
            «📣 Marketinq (3)»). Seçilmiş filtr düyməsi dolu (vurğulu) görünür. Axtarış həm ada, həm
            mövzuya görə süzür; uyğun nəticə yoxdursa «Heç nə tapılmadı» yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Şablonu redaktə etmək üçün onun kartına basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Şablonu redaktə et» başlıqlı, mövcud ad, mövzu, kateqoriya, dil və məzmunla əvvəlcədən
            doldurulmuş eyni böyük forma açılır. Başlıqda əlavə olaraq <HelpKey>Aktiv</HelpKey> /{" "}
            <HelpKey>Qeyri-aktiv</HelpKey> nişanı görünür — ona basaraq şablonu aktiv/qeyri-aktiv edə
            bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Dəyişiklikləri edib <HelpKey>Saxla</HelpKey> ilə təsdiqləyin. Şablonu silmək istəyirsinizsə,
            formanın aşağı sol küncündəki qırmızı zibil qutusu ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Zibil qutusuna basanda forma bağlanır və «Şablonu sil» təsdiq pəncərəsi açılır, içində
            şablonun adı göstərilir. Təsdiqlədikdən sonra şablon kartlar torundan çıxır və filtr
            sayları yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Vizual redaktor (🎨 Visual) <code>editor.unlayer.com</code> xidmətindən asılıdır. Reklam
          bloker və ya korporativ firewall onu bloklasa, redaktor yüklənməyə bilər — bu halda{" "}
          <HelpKey>✏️ HTML</HelpKey> rejiminə keçin; o, tam funksiyanal alternativdir və xarici
          xidmət tələb etmir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Silmə geri qaytarılmır. Şablonu sadəcə müvəqqəti gizlətmək istəyirsinizsə, silmək yerinə
          onu redaktə formasındakı nişanla <HelpKey>Qeyri-aktiv</HelpKey> edin — bu halda şablon
          qalır, sadəcə soluq görünür və aktiv siyahılarda sayılmır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün şablonlar təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın şablonlarını görür və
          redaktə edirsiniz; başqa təşkilatın şablonları sizə görünmür. Yüklədiyiniz şəkillər də
          təşkilatınızın yaddaşına gedir.
        </p>
      </HelpCallout>
    </div>
  )
}
