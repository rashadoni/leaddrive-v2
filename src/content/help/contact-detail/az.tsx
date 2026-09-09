"use client"

/**
 * Contact Detail — help article (Azerbaijani).
 * Tək kontakt qeydinin (record) səhifəsini əhatə edir:
 * /contacts/[id] — başlıq kartı, KPI kartları, tablar
 * (Fəaliyyətlər / Qarşılıqlı əlaqələr / İcmal / Əlaqə / Zənglər /
 * Da Vinci Tövsiyələr), fəaliyyət əlavə etmə və redaktə dialoqları.
 * Kontaktların SİYAHISI bura DAXİL DEYİL (ayrı səhifə).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ContactdetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış nümayəndəsi və ya hesab meneceri kimi tək bir adamla işləyirsiniz"
        goal="Bir kontaktın bütün məlumatını bir ekranda görmək, son əlaqələri izləmək və növbəti addımı atmaq (zəng, e-poçt, fəaliyyət əlavə etmək, məlumatı redaktə etmək)"
      >
        Bu səhifəyə kontaktlar siyahısından bir adın üzərinə basaraq çatırsınız. Açılan ünvan{" "}
        <HelpKey>/contacts/&lt;id&gt;</HelpKey> formasındadır — yalnız bir kontaktın qeydidir. Bütün
        məlumat sizin təşkilatınıza aiddir. Hansı sahələri görə və ya redaktə edə bilməyiniz icazə
        parametrlərinizdən asılıdır (məs. e-poçt və ya telefon gizlədilə bilər).
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda <strong>başlıq kartı</strong> durur: solda baş hərflərlə dairəvi avatar, yanında
          kontaktın <strong>tam adı</strong>, altında vəzifəsi və{" "}
          <HelpKey>şirkətdə</HelpKey> sözündən sonra şirkət adı (basıla bilən keçid). Aşağıda e-poçt və
          telefon nömrələri, sonra <strong>əlaqə düymələri</strong> (zəng üçün telefon ikonası, narıncı
          e-poçt ikonası, yaşıl WhatsApp ikonası) və varsa <strong>teqlər</strong> görünür. Sağ yuxarıda{" "}
          <HelpKey>Redaktə et</HelpKey> düyməsi var. Adın yanında bəzən rəngli{" "}
          <strong>sağlamlıq balı</strong> nişanı da çıxa bilər.
        </p>
        <p>
          Başlığın altında dörd <strong>KPI kartı</strong> sıralanır: <strong>Son əlaqə</strong>{" "}
          (neçə gün əvvəl), <strong>Fəaliyyətlər</strong> (say), <strong>Teqlər</strong> (say) və{" "}
          <strong>Status</strong> (Aktiv / Qeyri-aktiv). Daha altda <strong>tablar</strong> gəlir, hər
          biri ayrı bir baxış göstərir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Son əlaqə">Bu kontaktla axırıncı qeydə alınmış əlaqədən bəri keçən gün sayı; heç bir əlaqə yoxdursa «—».</HelpDef>
          <HelpDef term="Fəaliyyət (Activity)">Kontaktla bağlı bir hadisə — qeyd, zəng, e-poçt, görüş və ya tapşırıq. Əl ilə əlavə edilir və xronologiyada sıralanır.</HelpDef>
          <HelpDef term="Fəaliyyətlər tabı">Əl ilə əlavə etdiyiniz fəaliyyətlərin xronoloji jurnalı; başlığında ümumi say göstərilir.</HelpDef>
          <HelpDef term="Qarşılıqlı əlaqələr tabı">Sistemdən avtomatik toplanan bütün təmasların (zəng, e-poçt və s.) birləşdirilmiş vaxt xətti.</HelpDef>
          <HelpDef term="İcmal tabı">Mənbə, şöbə, brend, kateqoriya, status və şirkət kimi profil sahələrinin yığcam siyahısı.</HelpDef>
          <HelpDef term="Əlaqə (Engagement) tabı">Zəng/e-poçt/görüş/qeyd/tapşırıq saylarının xülasəsi və e-poçt açılma/klik dərəcələri.</HelpDef>
          <HelpDef term="Zənglər tabı">Bu kontaktla bağlı zənglərin cədvəli — tarix, istiqamət, müddət, status və nömrə.</HelpDef>
          <HelpDef term="Da Vinci Tövsiyələr">Bu kontakta uyğun gələ biləcək məhsulların süni intellekt sıralaması (uyğunluq balı ilə).</HelpDef>
          <HelpDef term="Sağlamlıq balı">Kontaktın «sağlamlığını» qiymətləndirən bal; yalnız fon hesablaması (cron) işlədikdən sonra görünür.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: kontaktı oxu və əlaqə saxla">
        <HelpStep n={1}>
          <p>
            Kontaktlar siyahısında bir ada basın. Səhifə açılanda əvvəlcə qısa müddət boz «yüklənmə»
            kölgələri görünür, sonra əsl məlumat gəlir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yuxarıda avatar və tam ad, altında vəzifə və şirkət, sonra e-poçt/telefon, əlaqə düymələri və
            dörd KPI kartı. Kontakt tapılmasa, «Kontakt tapılmadı» mətni və geriyə qayıtmaq üçün ox düyməsi
            göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Zəng etmək üçün telefon nömrəsinin yanındakı və ya əlaqə düymələri sırasındakı{" "}
            <strong>zəng (telefon) ikonasını</strong> basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Zəng vidceti açılır (sistemdə VoIP qoşulubsa). Hər əlavə nömrənin yanında da ayrıca zəng
            ikonası olur, ona görə düzgün xəttə zəng edə bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            E-poçt göndərmək üçün narıncı <strong>e-poçt (zərf) ikonasını</strong>, WhatsApp-da yazmaq
            üçün yaşıl <strong>mesaj ikonasını</strong> basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            E-poçt ikonası standart poçt proqramınızı kontaktın ünvanı ilə açır. WhatsApp ikonası nömrəni
            yeni səhifədə WhatsApp söhbətində açır. Bu düymələr yalnız müvafiq sahə (e-poçt/telefon)
            doldurulduqda və sizə görünən olduqda çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Şirkət haqqında daha çox bilmək üçün vəzifədən sonra göstərilən <strong>şirkət adına</strong>{" "}
            (mavi keçid) basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Həmin şirkətin qeyd səhifəsinə keçirsiniz. Geri qayıtmaq üçün başlıqdakı sol oxu və ya
            brauzerin geri düyməsini istifadə edin.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: tablar arasında keç">
        <HelpStep n={1}>
          <p>
            Standart olaraq <HelpKey>Fəaliyyətlər</HelpKey> tabı açıq olur. Başqa baxışa keçmək üçün tab
            adına basın: <HelpKey>Qarşılıqlı əlaqələr</HelpKey>, <HelpKey>İcmal</HelpKey>,{" "}
            <HelpKey>Əlaqə</HelpKey>, <HelpKey>Zənglər</HelpKey> və ya{" "}
            <HelpKey>Da Vinci Tövsiyələr</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Fəaliyyətlər</strong> tabında xronoloji xətt üzərində fəaliyyət kartları (hər birinin
            yanında növ ikonası); hələ heç biri yoxdursa «Fəaliyyət yoxdur» mətni. Tab başlığında mötərizədə
            ümumi say göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>İcmal</HelpKey> tabına keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İki sütunlu siyahıda <strong>Mənbə</strong>, <strong>Şöbə</strong>, <strong>Brend</strong>,{" "}
            <strong>Kateqoriya</strong>, <strong>Status</strong> (nişan kimi) və <strong>Şirkət</strong>{" "}
            sahələri; boş sahələr «—» ilə göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Zənglər</HelpKey> tabına basın (məlumat tabı ilk dəfə açanda yüklənir).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Tarix</strong>, <strong>İstiqamət</strong> (Gedən/Gələn nişanı), <strong>Müddət</strong>,{" "}
            <strong>Status</strong> və <strong>Nömrə</strong> sütunları olan cədvəl. Zəng yoxdursa «Hələ zəng
            yoxdur» mətni çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <HelpKey>Da Vinci Tövsiyələr</HelpKey> tabına (üstündə qığılcım ikonası) basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İlk açılışda qısa müddət «Tövsiyələr yüklənir…» yazısı, sonra hər məhsul üçün ad, kateqoriya,
            uyğunluq balı (məs. «72% uyğunluq»), səbəb sətri və qiymət. Kataloqda uyğun məhsul yoxdursa
            «Tövsiyə üçün məhsul yoxdur» mesajı göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: fəaliyyət əlavə et">
        <HelpStep n={1}>
          <p>
            <HelpKey>Fəaliyyətlər</HelpKey> tabında, kartın sağ yuxarısındakı <HelpKey>Fəaliyyət əlavə et</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Fəaliyyət əlavə et» başlıqlı kiçik pəncərə açılır. İçində <strong>Növ</strong> açılan siyahısı,{" "}
            <strong>Mövzu *</strong> sahəsi (məcburi) və <strong>Təsvir</strong> mətn sahəsi var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Növ</strong> seçin — Qeyd, Zəng, E-poçt, Görüş, Tapşırıq və ya Digər. Sonra{" "}
            <strong>Mövzu</strong> yazın (məcburidir) və istəsəniz <strong>Təsvir</strong> əlavə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər növün yanında ikonası var (məs. 📞 Zəng, 📧 E-poçt). Mövzu sahəsində «Nə baş verdi?»
            tutacaq mətni görünür. Mövzunu boş buraxsanız «Mövzu tələb olunur» xəbərdarlığı çıxır və saxlama
            baş tutmur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Aşağıdakı <HelpKey>Yarat</HelpKey> düyməsini basın (fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Saxlanılır…» vəziyyətinə keçir, sonra «Fəaliyyət əlavə edildi» bildirişi çıxır, pəncərə
            bağlanır və yeni fəaliyyət xronologiyada peyda olur. <strong>Fəaliyyətlər</strong> KPI kartındakı
            və tab başlığındakı say bir vahid artır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: kontaktı redaktə et">
        <HelpStep n={1}>
          <p>
            Başlıqda sağ yuxarıdakı <HelpKey>Redaktə et</HelpKey> düyməsini (qələm ikonası) basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Redaktə et» başlıqlı, mövcud dəyərlərlə əvvəlcədən doldurulmuş forma açılır:{" "}
            <strong>Tam ad *</strong>, <strong>Email</strong>, <strong>Telefon</strong>, əlavə telefon
            nömrələri, <strong>Vəzifə</strong>, <strong>Şöbə</strong>, <strong>Şirkət</strong> (açılan
            siyahı), <strong>Mənbə</strong>, <strong>Brend</strong> və <strong>Kateqoriya</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Lazımi sahələri dəyişin. Əlavə telefon nömrəsi əlavə etmək üçün telefon başlığının yanındakı{" "}
            <HelpKey>Yarat</HelpKey> düyməsini, nömrəni silmək üçün isə yanındakı × ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bəzi sahələr (e-poçt, telefon, vəzifə, şöbə, mənbə) icazəniz yoxdursa <strong>passiv (disabled)</strong>{" "}
            görünə bilər — onları dəyişə bilmirsiniz. Hər <HelpKey>Yarat</HelpKey> basışında boş bir telefon
            sətri əlavə olunur; × onu çıxarır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Aşağıdakı <HelpKey>Saxla</HelpKey> düyməsini basın (və ya <HelpKey>Ləğv et</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Saxlanılır…» vəziyyətinə keçir, sonra pəncərə bağlanır və başlıq kartı yenilənmiş ad,
            əlaqə məlumatı və profil sahələri ilə yenidən yüklənir. <strong>Tam ad</strong> boş olduqda
            <HelpKey>Saxla</HelpKey> düyməsi passiv qalır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Fəaliyyətlər tabı yalnız sizin əl ilə əlavə etdiyiniz qeydləri göstərir; sistem avtomatik
          topladığı bütün təmasları (məs. avtomatik loglanan zənglər, e-poçtlar) görmək üçün{" "}
          <HelpKey>Qarşılıqlı əlaqələr</HelpKey> tabına keçin. <HelpKey>Zənglər</HelpKey> və{" "}
          <HelpKey>Da Vinci Tövsiyələr</HelpKey> tabları məlumatı yalnız siz tabı ilk dəfə açanda yükləyir
          — açılması bir anlıq gecikə bilər.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Sağlamlıq balı nişanı və <strong>aktiv xəbərdarlıq paneli</strong> yalnız onlar üçün məlumat
          olduqda görünür — boş ekran «səhv» demək deyil. Sağlamlıq balı fon hesablaması işlədikdən sonra
          peyda olur; tövsiyələr isə kataloqda məhsul olmasından asılıdır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün məlumat təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın kontaktını görür və redaktə
          edirsiniz. Üstəlik sahə səviyyəsində icazələr tətbiq olunur: e-poçt, telefon və bəzi profil
          sahələri sizə gizlədilə və ya yalnız oxunaqlı (redaktə edilməyən) ola bilər. Görmədiyiniz və ya
          dəyişə bilmədiyiniz sahə qüsur deyil — rol icazənizin nəticəsidir.
        </p>
      </HelpCallout>
    </div>
  )
}
