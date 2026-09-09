"use client"

/**
 * MTM Analitika — help article (Azerbaijani).
 * REWRITE: əvvəllər hesabatlarla birgə idi; hesabatların indi öz məqaləsi var.
 * Bu məqalə YALNIZ MTM → Analitika səhifəsini əhatə edir: dövr seçimi,
 * standart KPI sətri, Mars KPI sətri, Trend + Həftəlik müqayisə qrafikləri,
 * Agent üzrə KPI cədvəli, Vizitlərə görə top agentlər və Excel ixracı.
 * Hesabat qurucu/detal hesabatlar bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mtmanalyticsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sahə komandasının rəhbəri və ya əməliyyat administratorusunuz"
        goal="Vizitlərin, tapşırıqların və agent performansının ümumi mənzərəsini bir səhifədə görmək və lazım olanda Excel-ə çıxarmaq"
      >
        Səhifəyə <HelpKey>MTM</HelpKey> → <HelpKey>Analitika</HelpKey> yolu ilə çatırsınız. Bütün
        rəqəmlər yalnız sizin təşkilatınızın məlumatından hesablanır. Bu səhifə{" "}
        ilkin vizitlər və marşrutlar <strong>yalnız oxumaq üçündür</strong>. Səlahiyyətli menecer
        səbəb göstərməklə audit olunan KPI sübutu çıxarılması və ya bərpası yaza bilər. Səhifə
        açılanda standart olaraq <HelpKey>Aylıq</HelpKey> dövr seçili gəlir.
      </HelpScenario>

      <HelpSection title="İzahlı vizit planı və GPS KPI-ları">
        <p>
          Menecer və ya supervayzer KPI blokunu tarix, şöbə, əməkdaş,
          vizit növü və açıq şəkildə əlaqələndirilmiş brend üzrə süzür. Hər faiz
          surəti, məxrəci, formula versiyasını, hesablanma vaxtını və mənbənin
          faktlarının yeniliyini göstərir. Bu, toplayıcının işləmə siqnalı deyil,
          vizit növü və brend filtrindən əvvəl cari rəhbər və tarix əhatəsindəki
          son namizəd biznes faktı dəyişikliyinin yaşıdır. Surət
          və ya məxrəcdən ilkin vizitə, marşrut nöqtəsinə və GPS gününə keçmək olar.
        </p>
        <p>
          Səlahiyyət və şöbə filtri komandanın cari tərkibinə əsaslanır. Görünən
          tərkib daxilində birgə marşrut və vizit faktları marşrut tarixində və ya
          vizit anında qüvvədə olan təyinata aid edilir.
        </p>
        <p>
          Reyestrin altındakı əməliyyat kartları mövcud formulaları və cari əsas
          icraçı əhatəsini saxlayır. Audit olunan Plan/GPS qərarları üçün bu izahlı
          reyestrdən və onun CSV faylından istifadə edin.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Vizit planının icrası">Ziyarət edilmiş marşrut nöqtələri / eyni filtr qrupundakı qaralama və ləğv edilmiş olmayan bütün marşrut nöqtələri.</HelpDef>
          <HelpDef term="GPS təsdiqi">Etibarlı giriş və çıxış koordinatları olan tamamlanmış vizitlər / həmin qrupdakı bütün tamamlanmış vizitlər.</HelpDef>
          <HelpDef term="Düzəliş">Məcburi səbəbi olan əlavə-silməsiz menecer qərarı. Etibarsız GPS sübutunun çıxarılması onu surətdən silir, lakin tamamlanmış viziti məxrəcdən silmir.</HelpDef>
        </dl>
        <HelpCallout kind="warning">
          <strong>Qismən</strong> nəticə server fakt limitinə çatıb və qərar üçün
          yekun sayılmır. Qərar və ya ixracdan əvvəl dövrü, şöbəni və ya
          əməkdaşı daraldın.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Analitika</HelpKey> adı və «Performans metrikaları və trend analizi»
          izahı durur. Sağ yuxarıda üç dövr düyməsi —{" "}
          <HelpKey>Həftəlik</HelpKey>, <HelpKey>Aylıq</HelpKey>, <HelpKey>İllik</HelpKey> — və{" "}
          <HelpKey>Excel ixracı</HelpKey> düyməsi var. Aşağıda məlumat bloklarla düzülür: əvvəlcə dörd
          standart KPI kartı, sonra dörd <strong>Mars KPI</strong> kartı, sonra iki qrafik (Trend və
          Həftəlik müqayisə), daha sonra (məlumat varsa) <strong>Agent üzrə KPI</strong> cədvəli və{" "}
          <strong>Vizitlərə görə top agentlər</strong> siyahısı.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Dövr">Seçili vaxt aralığı — Həftəlik, Aylıq və ya İllik; bütün kartlar və qrafiklər bu seçimə görə yenidən hesablanır.</HelpDef>
          <HelpDef term="Ümumi vizitlər">Seçili dövrdə qeydə alınmış vizitlərin sayı.</HelpDef>
          <HelpDef term="Tamamlanmış tapşırıqlar">Dövr ərzində tamamlanmış tapşırıqların sayı.</HelpDef>
          <HelpDef term="Yüklənmiş fotolar">Vizitlər zamanı yüklənmiş fotoların sayı.</HelpDef>
          <HelpDef term="Tamamlanma faizi">Tapşırıqların tamamlanma faizi (%).</HelpDef>
          <HelpDef term="Mars KPI">Mars-stilində dörd əməliyyat metriki: ziyarət planı, effektivlik, marşrut müddəti və mağaza müddəti.</HelpDef>
          <HelpDef term="Trend">Dövr üzrə tapşırıq və vizit saylarını yanaşı zolaqlarla göstərən qrafik.</HelpDef>
          <HelpDef term="Həftəlik müqayisə">Bu həftə ilə keçən həftənin gün-gün müqayisəsi.</HelpDef>
          <HelpDef term="Agent üzrə KPI">Hər agentin vizit, effektivlik, plan və mağaza vaxtı göstəricilərini sıralayan cədvəl.</HelpDef>
        </dl>
        <p>
          Səhifə yüklənərkən qısa müddət boz «skelet» bloklar (yanıb-sönən boş kartlar) görünür —
          məlumat gələndə onlar real kartlarla əvəz olunur. Hansısa blok üçün məlumat yoxdursa, həmin
          blokun yerində «Bu dövr üçün məlumat yoxdur» və ya «Məlumat yoxdur» yazısı çıxır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: dövr seç və KPI-lara bax">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdan dövr düyməsini seçin: <HelpKey>Həftəlik</HelpKey>, <HelpKey>Aylıq</HelpKey>{" "}
            və ya <HelpKey>İllik</HelpKey>. (Standart olaraq <strong>Aylıq</strong> aktivdir.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz düymə dolu (vurğulanmış) görünür, qalan ikisi konturlu qalır. Bütün kartlar və
            qrafiklər yenidən yüklənir — bir anlıq boz skelet bloklar görünə bilər.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Yuxarıdakı dörd standart KPI kartına baxın: <HelpKey>Ümumi vizitlər</HelpKey>,{" "}
            <HelpKey>Tamamlanmış tapşırıqlar</HelpKey>, <HelpKey>Yüklənmiş fotolar</HelpKey> və{" "}
            <HelpKey>Tamamlanma faizi</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Dörd rəngli kart yanaşı düzülür; hər birində metrikin adı, böyük rəqəm və kiçik ikona
            (xəritə nişanı, təsdiq, kamera, yüksələn trend) olur. Tamamlanma faizi kartında dəyər
            faizlə (% ilə) göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Aşağıda <HelpKey>Mars KPI</HelpKey> başlığı altında dörd kartı nəzərdən keçirin:{" "}
            <strong>Ziyarət planının yerinə yetirilməsi</strong>,{" "}
            <strong>Ziyarət effektivliyi</strong>, <strong>Orta marşrut müddəti</strong> və{" "}
            <strong>Orta mağaza müddəti</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İlk iki kartda hədəfə qarşı nazik tərəqqi zolağı var (məs. «100% hədəfin» yazısı ilə),
            zolaq isə nəticəyə görə rənglənir: hədəfin 90%-dən çoxu yaşıl, 70–89% sarı, daha az qırmızı.
            Marşrut və mağaza müddəti kartlarında dəyər <HelpKey>dəq</HelpKey> (dəqiqə) vahidi və altda
            qısa izahla göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: qrafikləri oxu">
        <HelpStep n={1}>
          <p>
            <HelpKey>Trend</HelpKey> qrafikinə baxın — qrafiklər sətrinin solundadır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə dövrün adı (ay qısaltması), yanında iki yanaşı zolaq və sağda{" "}
            «&lt;tapşırıq&gt;t / &lt;vizit&gt;v» rəqəmləri olur. Aşağıda izah var:{" "}
            <strong>Tapşırıqlar</strong> üçün yaşılımtıl (teal) zolaq, <strong>Vizitlər</strong> üçün
            yaşıl zolaq. Bu dövr üçün məlumat yoxdursa, qutu içində «Bu dövr üçün məlumat yoxdur»
            yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sağdakı <HelpKey>Həftəlik müqayisə</HelpKey> qrafikinə keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər həftə günü (B.e, Ç.a, …) üçün iki incə zolaq alt-alta durur: yuxarıdakı (parlaq){" "}
            <strong>Bu həftə</strong>, altdakı (solğun) <strong>Keçən həftə</strong>; sağda{" "}
            «buHəftə/keçənHəftə» rəqəmləri görünür. Məlumat yoxdursa «Məlumat yoxdur» yazısı çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: agent göstəricilərini oxu">
        <HelpStep n={1}>
          <p>
            Aşağı sürüşdürüb <HelpKey>Agent üzrə KPI</HelpKey> cədvəlini tapın. (Bu cədvəl yalnız agent
            məlumatı olduqda görünür.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sütunları olan cədvəl: <strong>Agent</strong>, <strong>Ziyarət</strong>,{" "}
            <strong>Effektivlik</strong>, <strong>Plan %</strong> və <strong>Orta mağaza vaxtı</strong>.
            Effektivlik və Plan % dəyərləri rənglə kodlanır — yüksək yaşıl, orta sarı, aşağı qırmızı.
            Bir sətrin üzərinə gəldikdə sətir bir az işıqlanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Aşağıda <HelpKey>Vizitlərə görə top agentlər</HelpKey> siyahısına baxın. (Bu blok da yalnız
            agent məlumatı olduqda görünür.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Nömrələnmiş (1, 2, 3…) dairə nişanları ilə agentlər sıralanır; hər sətirdə agentin adı və
            sağda «&lt;say&gt; vizit» yazısı olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Excel-ə ixrac et">
        <HelpStep n={1}>
          <p>
            Çıxarmaq istədiyiniz dövrü seçdikdən sonra sağ yuxarıdakı <HelpKey>Excel ixracı</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə müvəqqəti <strong>İxrac edilir…</strong> yazısına keçir və söndürülür (təkrar
            basmaq olmur). Hazır olduqda brauzer{" "}
            <HelpKey>mtm-analytics-&lt;dövr&gt;-&lt;tarix&gt;.xlsx</HelpKey> adlı fayl yükləyir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>İxrac alınmasa, ekranın küncündə qırmızı bildiriş çıxır.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «İxrac xətası. Yenidən cəhd edin.» mesajı görünür və düymə yenidən normal hala qayıdır —
            bir az gözləyib təkrar cəhd edə bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          İxrac etdiyiniz fayl seçili dövrü əks etdirir: əvvəlcə <HelpKey>Həftəlik</HelpKey>,{" "}
          <HelpKey>Aylıq</HelpKey> və ya <HelpKey>İllik</HelpKey> seçin, sonra <HelpKey>Excel ixracı</HelpKey>{" "}
          basın — fayl adındakı dövr hissəsi (məs. <em>monthly</em>) bunu təsdiqləyir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Boş bloklar həmişə nasazlıq demək deyil — sadəcə seçili dövrdə həmin metrik üçün hələ
          məlumat olmaya bilər. «Bu dövr üçün məlumat yoxdur» görsəniz, daha geniş dövr seçin (məs.{" "}
          <HelpKey>İllik</HelpKey>) və ya komandanın həmin dövrdə vizit/tapşırıq qeyd etdiyinə əmin olun.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün rəqəmlər təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın vizit, tapşırıq, foto və
          agent məlumatını görürsünüz, başqa təşkilatların göstəriciləri burada görünmür. Səhifə yalnız
          ilkin vizit və marşrutları dəyişmir. KPI sübutu üzrə qərarlar səbəblə əlavə-silməsiz hadisə
          kimi yazılır və düzəliş tarixçəsində görünür.
        </p>
      </HelpCallout>
    </div>
  )
}
