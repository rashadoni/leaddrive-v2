"use client"

/**
 * Account Engagement (ABM) — help article (Azerbaijani), video-script format.
 * Yalnız /accounts/engagement səhifəsini əhatə edir: başlıq + altyazı,
 * mərhələ süzgəci çipləri (Hamısı + 7 mərhələ), stale-priority banneri,
 * hesab kartları (cəlb balı, qiymət dairəsi, ICP nişanı, siqnallar, gəlir/
 * ölçü/sənaye sətirləri), isti-hesab / susmuş-hesab altlığı, boş vəziyyət və
 * aşağıdakı izah sətirləri. Səhifə YALNIZ oxumaq üçündür — redaktə yoxdur.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function AccountEngagementHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq və ya ABM (hesab-əsaslı marketinq) üzrə mütəxəssissiniz"
        goal="Bütöv şirkətləri — ayrı-ayrı liderləri yox — fəallıq və ideal müştəri profilinə uyğunluq üzrə izləmək, susmuş ən yaxşı hesabları tapıb əvvəlcə onları reaktivləşdirmək"
      >
        Səhifəyə soldakı menyudan <HelpKey>Hesablar</HelpKey> → <HelpKey>Hesab iştirakı</HelpKey> yolu
        ilə çatırsınız. Bu ekran <strong>yalnız oxumaq üçündür</strong>: o, hesabları sıralayır və
        süzgəcləyir, amma burada heç nəyi redaktə etmirsiniz. Gördüyünüz bütün hesablar və siqnallar
        yalnız sizin təşkilatınıza aiddir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda nişan ikonası ilə <HelpKey>Hesab iştirakı</HelpKey> başlığı, altında ABM izahı
          («hər sətir cari fəallıq balı, ICP-uyğunluq dərəcəsi və 30 günlük niyyət siqnalları olan
          hədəf hesabdır») durur. Onun altında <strong>mərhələ süzgəci çipləri</strong> bir sıra ilə
          gəlir: <HelpKey>Hamısı</HelpKey> və yeddi mərhələ — hər birinin yanında say. Daha sonra (varsa)
          sarı <strong>susan prioritet</strong> banneri, sonra isə hesab <strong>kartları</strong>{" "}
          toru (ekran genişliyinə görə 1, 2 və ya 3 sütun). Heç hesab yoxdursa, kartların yerinə boş
          vəziyyət göstərilir. Ən aşağıda balın və qiymətin nə demək olduğunu izah edən iki kiçik sətir
          var.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Fəallıq (cəlb balı)">
            Hər kartdakı <strong>0–100</strong> arası rəqəm və rəngli zolaq: 70+ olduqda yaşıl, 40+
            olduqda sarı, aşağıda boz. Hesabın son zamanlar nə qədər fəal olduğunu göstərir.
          </HelpDef>
          <HelpDef term="Qiymət (A–F)">
            Kartın sağ küncündəki dairə — ICP-uyğunluq hərfi: <strong>A</strong> ən yaxşı uyğunluq,{" "}
            <strong>F</strong> diskvalifikasiya. Təyin edilməyibsə dairədə <HelpKey>?</HelpKey> görünür.
          </HelpDef>
          <HelpDef term="ICP səviyyəsi">
            Strateji hədəf siyahısındakı slot: Səviyyə&nbsp;1, 2, 3, 4 və ya «Qiymətləndirilməyib».
            Adın altında nişan kimi göstərilir.
          </HelpDef>
          <HelpDef term="Mərhələ (həyat dövrü)">
            Hesabın ABM həyat dövründəki yeri: Hədəf → Cəlb edilib → MQL → SQL → İmkan → Müştəri →
            İtirilmiş. Süzgəc çipi və kartdakı rəngli nişan kimi görünür.
          </HelpDef>
          <HelpDef term="Siqnallar (30g)">Son 30 gündə tutulan niyyət siqnallarının sayı.</HelpDef>
          <HelpDef term="Son siqnal">Ən son siqnalın nə qədər əvvəl gəldiyi (məs. «bu gün», «5 gün əvvəl»).</HelpDef>
          <HelpDef term="Susan prioritet (stale-priority)">
            Ən uyğun (Səviyyə&nbsp;1/2), lakin balı 25-dən aşağı və son 30 gündə sıfır siqnalı olan
            hesab. Bunlar dəyərli, lakin susmuş hesablardır — banner onların sayını yuxarıda göstərir.
          </HelpDef>
        </dl>
        <p>
          Hər kartda hesabın adı, altında mərhələ və ICP nişanları, sağ küncdə qiymət dairəsi, ortada
          cəlb balı və zolağı, aşağıda isə <strong>Siqnallar (30g)</strong>, <strong>Son siqnal</strong>{" "}
          və məlum olduqda <strong>Gəlir</strong>, <strong>Ölçü</strong>, <strong>Sənaye</strong>{" "}
          sətirləri olur. Kartın altlığı vəziyyətə görə dəyişir: bal 70+ olanda yaşıl{" "}
          <HelpKey>İsti hesab</HelpKey>, susan prioritetdə isə sarı{" "}
          <HelpKey>Yaxşı uyğun, lakin sakit — reaktivləşdir</HelpKey>.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: mərhələ üzrə süzgəcləyin">
        <HelpStep n={1}>
          <p>
            Səhifə açıldıqda standart olaraq <HelpKey>Hamısı</HelpKey> çipi seçilmiş gəlir və bütün
            hesablar göstərilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Hamısı</HelpKey> çipi vurğulanmış (dolu) vəziyyətdədir və yanındakı saymöterizədə
            ümumi hesab sayını göstərir, məsələn «Hamısı (128)». Qalan çiplər sönük çərçivəli olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Müəyyən bir mərhələyə baxmaq üçün uyğun çipi basın — <HelpKey>Hədəf</HelpKey>,{" "}
            <HelpKey>Cəlb edilib</HelpKey>, <HelpKey>MQL</HelpKey>, <HelpKey>SQL</HelpKey>,{" "}
            <HelpKey>İmkan</HelpKey>, <HelpKey>Müştəri</HelpKey> və ya <HelpKey>İtirilmiş</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz çip vurğulanır, kartlar torunda yalnız həmin mərhələdəki hesablar qalır. Hər
            çipin öz sayğacı var, ona görə baxmadan da hansı səbətdə neçə hesab olduğunu görürsünüz.
            Seçilmiş mərhələdə heç hesab yoxdursa, boş vəziyyət görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bütün hesablara qayıtmaq üçün yenidən <HelpKey>Hamısı</HelpKey> çipini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Süzgəc sıfırlanır və tor yenidən bütün hesabları əvvəlki sıralama qaydası ilə göstərir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: susan prioritet bannerini oxuyun">
        <HelpStep n={1}>
          <p>
            Ən uyğun hesablardan bəziləri susanda, kartların üstündə sarı banner görünür və susan
            prioritet hesabların sayını yazır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Üçbucaq xəbərdarlıq ikonası ilə sarı zolaq: başlıqda say (məs. «3 susan prioritet hesab»),
            altında izah — «Ən yaxşı uyğun ICP (səviyyə 1/2) hesablar, aşağı fəallıq və 30 günlük sıfır
            siqnal. Marketinq əvvəlcə bunları reaktivləşdirməlidir». Belə hesab yoxdursa, banner ümumiyyətlə
            görünmür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bannerdə sayılan hesabları kartlar torunun başında tapın — onlar sarı çərçivə ilə
            fərqlənir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Susan prioritet kartları sarı haşiyə və açıq-sarı fonla seçilir, altlığında isə{" "}
            <HelpKey>Yaxşı uyğun, lakin sakit — reaktivləşdir</HelpKey> qeydi olur. Belə hesablar siyahının
            ən başında gəlir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Susan prioritet bannerini gündəlik iş siyahınız kimi qəbul edin: bunlar cəlb olunmağı
            dayandırmış dəyərli hesablardır. Susmuş Səviyyə&nbsp;1 hesabı yenidən cəlb etmək adətən yeni
            Səviyyə&nbsp;3-ü sıfırdan qızdırmaqdan daha səmərəlidir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: bir hesab kartını oxuyun">
        <HelpStep n={1}>
          <p>
            Bir kartı seçin və yuxarı hissəyə baxın: ad, altında mərhələ və ICP səviyyəsi nişanları,
            sağ küncdə isə qiymət dairəsi.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Dairədə <strong>A–F</strong> hərfi (yaşıldan qırmızıya doğru rənglənir) və ya təyin
            edilməyibsə <HelpKey>?</HelpKey>. Üstünə gətirsəniz «Qiymət X» izahı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Kartın ortasındakı <HelpKey>Fəallıq</HelpKey> sahəsinə baxın — rəqəm və altındakı zolaq.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sağda balın özü monoşrift rəqəmlə, yanında <strong>/100</strong> ilə yazılır; altdakı zolaq
            bala uyğun dolur və rənglənir (70+ yaşıl, 40+ sarı, aşağı boz).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Aşağı hissədəki sətirlərlə kontekst alın: <HelpKey>Siqnallar (30g)</HelpKey>,{" "}
            <HelpKey>Son siqnal</HelpKey>, və məlum olduqda <HelpKey>Gəlir</HelpKey>,{" "}
            <HelpKey>Ölçü</HelpKey>, <HelpKey>Sənaye</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siqnal sayı və son siqnal vaxtı həmişə var; gəlir, ölçü və sənaye yalnız o hesab üçün
            məlumdursa göstərilir — boş olanlar tamamilə gizlədilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Kartın altlığına diqqət edin — o, hesabın vəziyyətini bir baxışda bildirir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bal 70+ olan, lakin susan prioritet olmayan hesabda yaşıl <HelpKey>İsti hesab</HelpKey>{" "}
            altlığı; susan prioritetdə isə sarı <HelpKey>Yaxşı uyğun, lakin sakit — reaktivləşdir</HelpKey>{" "}
            altlığı görünür. Hər iki şərt deyilsə, altlıq olmur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Sıralama, bal və qiymət necə işləyir">
        <p>
          Hesablar elə sıralanır ki, diqqət tələb edənlər birinci gəlsin:{" "}
          <strong>əvvəlcə susan prioritet</strong>, sonra ən yüksək cəlb balı; bərabərlik halında
          qiymət ayırıcı kimi işləyir. Beləliklə siyahının başı həmişə «əvvəlcə bununla məşğul ol»
          siyahısıdır.
        </p>
        <p>
          İki rəqəm fərqli suallara cavab verir. <strong>Fəallıq (bal)</strong> davranışdır — hesabın
          nə qədər fəal olması; son niyyət siqnallarını toplayır və zamanla sönmə tətbiq edir
          (köhnə fəaliyyət sönür, yenisi üstünlük təşkil edir), yekun 100 ilə məhdudlaşır.{" "}
          <strong>Qiymət (A–F)</strong> isə uyğunluqdur — fəaliyyətdən asılı olmayaraq ICP səviyyəsi,
          ölçü, sənaye və gəlir kimi atributlardan gəlir.
        </p>
        <HelpCallout kind="next">
          <p>
            Bal və qiymət bu səhifədə hesablanmır, sadəcə göstərilir — onları arxa fonda sistem yeniləyir.
            Süzgəci dəyişdikdə və ya səhifəni yenidən açdıqda kartlar ən son dəyərlərlə yenilənir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          Seçilmiş mərhələdə (və ya bütövlükdə təşkilatda) hələ hesab yoxdursa, kartların yerinə bina
          ikonası ilə boş vəziyyət çıxır: «Bu seqmentdə hələ hesab yoxdur» və izah — marketinq hədəf
          hesabları müəyyən etdikcə və niyyət siqnalları tutulduqca onlar burada görünəcək. Bu səhv
          deyil; sadəcə həmin səbət hələ boşdur.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bu ekrandakı hər şey təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın hesabları və
          siqnalları ilə işləyirsiniz, başqa təşkilatın hesablarını görmürsünüz. Səhifə yalnız oxumaq
          üçündür: sıralayır və süzgəcləyir, lakin hesabları redaktə etmir. Hesabın həyat dövrü
          mərhələsini irəli aparmaq (SQL-ə keçəndə bu, arxa fonda real CRM satışı yarada bilər) ayrıca,
          icazə ilə qorunan yazma əməliyyatıdır və bu ekrandan kənarda baş verir.
        </p>
      </HelpCallout>
    </div>
  )
}
