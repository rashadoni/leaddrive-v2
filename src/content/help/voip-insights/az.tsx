"use client"

/**
 * Söhbət analitikası (Conversation Intelligence) — help article (Azerbaijani).
 * Köhnə birgə "voip" məqaləsindən ayrılıb: YALNIZ
 * voip/insights səhifəsini (zəng sonrası AI-təhlil paneli — əhval
 * paylanması, rəqib qeydləri, kouçinq nümunələri, son zənglər siyahısı)
 * əhatə edir. Zəng jurnalı və provayder quruluşu bu məqaləyə DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function voipinsightsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış meneceri və ya komanda rəhbərisiniz"
        goal="Zənglərdən sonra AI-nin çıxardığı əhval, tapşırıq, rəqib və kouçinq siqnallarını oxuyub komandanın telefonda real olaraq nə baş verdiyini görmək"
      >
        Bu səhifə zəng sonrası <strong>AI-təhlilini</strong> aqreqasiya edir — burada zəng etmir
        və ya provayder qurmursunuz. Hər şey yalnız sizin təşkilatınızın zəngləri üçündür. Zənglər
        transkript tutulduqdan sonra avtomatik təhlil edilir; bu panel həmin nəticələri seçdiyiniz
        zaman pəncərəsi üzrə bir yerə yığır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda beyin ikonası ilə <HelpKey>Söhbət analitikası</HelpKey> adı, altında «Zəng sonrası
          AI-təhlil: əhval, mövzular, görüləcək işlər, rəqib qeydləri, kouçinq məsləhətləri» izahı
          durur. Sağ yuxarıda dörd zaman pəncərəsi düyməsi var: <HelpKey>Bu gün</HelpKey>,{" "}
          <HelpKey>Son 7 gün</HelpKey>, <HelpKey>Son 30 gün</HelpKey> və{" "}
          <HelpKey>Son 90 gün</HelpKey> (standart olaraq <strong>Son 7 gün</strong> seçilidir). Altda
          dörd göstərici kartı, sonra əhval paylanması zolağı, rəqib qeydləri və kouçinq nümunələri
          panelləri, ən altda isə son zənglər siyahısı gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Təhlil edilmiş zənglər">Seçilmiş pəncərədə AI-nin təhlil etdiyi zənglərin sayı (təhlili olmayan zənglər bu saya düşmür).</HelpDef>
          <HelpDef term="Tapşırıqlar">Həmin zənglərdən çıxarılmış görüləcək işlərin ümumi sayı.</HelpDef>
          <HelpDef term="Rəqiblər adlandırılıb">Pəncərə üzrə adı çəkilmiş fərqli rəqiblərin sayı.</HelpDef>
          <HelpDef term="Kouçinq nümunələri">Komanda üzrə təkrarlanan kouçinq siqnallarının (qaydaların) sayı.</HelpDef>
          <HelpDef term="Əhval paylanması">Təhlil edilmiş zəngləri beş səviyyəyə bölən rəngli zolaq: çox müsbət, müsbət, neytral, mənfi, çox mənfi.</HelpDef>
          <HelpDef term="Rəqib qeydləri">Hansı rəqiblərin neçə dəfə xatırlandığını sıralayan panel.</HelpDef>
          <HelpDef term="Kouçinq nümunələri (panel)">Komanda üzrə təkrarlanan ipucuları — sərtliyə görə kritik → xəbərdarlıq → məlumat rəngləri ilə, hər birində neçə dəfə baş verdiyi (×N) göstərilir.</HelpDef>
          <HelpDef term="Son zənglər">Pəncərədəki zənglərin siyahısı; hər sətir açılıb mövzular, tapşırıqlar, rəqib qeydləri və kouçinq məsləhətlərini göstərir.</HelpDef>
        </dl>
        <p>
          Hər zəng sətrində istiqamət oxu (gedən üçün mavi yuxarı-sağ, gələn üçün yaşıl aşağı-sol),
          kontakt adı (yoxdursa nömrə), bir-iki sətirlik xülasə, müddət, nisbi vaxt («indicə», «3
          saat əvvəl»…), tapşırıq sayı və sağda əhval ikonası (gülən üzdən düşən ox kimi mənfi
          işarəyə qədər) olur.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: zaman pəncərəsini seç və göstəriciləri oxu">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdan bir zaman pəncərəsi seçin — <HelpKey>Bu gün</HelpKey>,{" "}
            <HelpKey>Son 7 gün</HelpKey>, <HelpKey>Son 30 gün</HelpKey> və ya{" "}
            <HelpKey>Son 90 gün</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz düymə dolu (primary) rəngə keçir, qalanları boş qalır. Panel qısa müddət
            «Yüklənir…» fırlanan ikonasını göstərir, sonra bütün kartlar, zolaq və siyahı həmin
            dövrün məlumatı ilə yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Üst sıradakı dörd göstəricini oxuyun: <strong>Təhlil edilmiş zənglər</strong>,{" "}
            <strong>Tapşırıqlar</strong>, <strong>Rəqiblər adlandırılıb</strong> və{" "}
            <strong>Kouçinq nümunələri</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kartda kiçik ikona ilə adın altında böyük rəqəm durur. Bu saylar yalnız seçilmiş
            pəncərəyə aiddir; pəncərəni dəyişdikcə dərhal dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Əhval paylanması</strong> zolağına baxın — komandanın ümumi əhval mənzərəsini
            verir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Rəngli zolaq seqmentlərə bölünür (çox müsbət — yaşıl, …, çox mənfi — qırmızı); seqmentin
            eni o əhvalın payı qədərdir, üstünə gələndə «&lt;əhval&gt;: &lt;say&gt;» ipucusu çıxır.
            Altda hər mövcud əhval üçün rəngli nöqtə, ad və say göstərilir. Pəncərədə heç bir zəng
            yoxdursa, bu zolaq ümumiyyətlə görünmür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: rəqibləri və kouçinq nümunələrini araşdır">
        <HelpStep n={1}>
          <p>
            Sol paneldəki <HelpKey>Rəqib qeydləri</HelpKey> siyahısına baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə rəqibin adı və sağda neçə dəfə xatırlandığını göstərən rəqəm (monospace ilə)
            durur. Pəncərədə heç bir rəqib qeyd edilməyibsə, «Pəncərədə rəqib qeyd edilməyib.» mətni
            görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sağdakı geniş <HelpKey>Kouçinq nümunələri</HelpKey> panelini oxuyun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər nümunə qutucuğunda mesaj, sağ küncdə neçə dəfə baş verdiyi (<strong>×N</strong>) və
            altda qaydanın adı (məsələn «Dəyər təklifi qaçırıldı», «Rəqib qeyd edildi», «Çox qısa
            zəng») durur. Qutu çərçivəsi sərtliyə görə rənglənir: kritik — qırmızı, xəbərdarlıq —
            sarı, məlumat — adi boz. Heç bir təkrarlanan nümunə yoxdursa, «Pəncərədə təkrarlanan
            kouçinq nümunəsi yoxdur.» mətni çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: bir zəngi aç və detallarını gör">
        <HelpStep n={1}>
          <p>
            <strong>Son zənglər ({"{say}"})</strong> başlığının altındakı siyahıdan bir zəng sətrini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sətir genişlənir və altda incə bölücü xəttdən sonra detallar açılır. Eyni sətri yenidən
            basmaq onu bağlayır (bir anda yalnız bir zəng açıq qalır).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Açılan hissədə zəngin AI-detallarını oxuyun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mövcud olduqda görəcəyiniz bloklar: <strong>Mövzular</strong> (kiçik nişanlar kimi),{" "}
            <strong>Tapşırıqlar</strong> (qeyd ikonası ilə, varsa məsul və son tarix ipucu mötərizədə),{" "}
            <strong>Rəqib qeydləri</strong> (ad, ×say və kontekst) və{" "}
            <strong>Kouçinq məsləhətləri</strong> (sərtliyə görə üçbucaq/dairə/info ikonası ilə). Ən
            altda zəng üçün <strong>Model</strong> adı, gecikmə (ms) və xərc ($) göstərilə bilər.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Boş vəziyyət normaldır. Seçilmiş pəncərədə təhlil edilmiş zəng yoxdursa, mərkəzdə beyin
          ikonası ilə «Seçilmiş pəncərədə təhlil edilmiş zəng yoxdur.» və «Zənglər transkript
          tutulduqdan sonra avtomatik təhlil edilir.» mesajı çıxır. Bu, panelin sınması demək deyil —
          sadəcə hələ təhlil edilmiş zəng yoxdur. Daha geniş pəncərə seçin və ya zənglərin
          transkriptlərinin tutulduğundan əmin olun.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Pəncərədə çox sayda zəng varsa, yuxarıda sarı banner çıxır: «Son N zəng göstərilir. Tam
          əhatə üçün pəncərəni qısaltın». Bu, siyahının ən son zənglərlə kəsildiyini bildirir — daha
          dəqiq mənzərə üçün daha qısa zaman pəncərəsi seçin. Yükləmə alınmasa, yuxarıda qırmızı xəta
          kartı göstərilir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bu panel yalnız oxumaq üçündür və təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın
          zənglərini və onların təhlilini görürsünüz. Burada təhlil işə salınmır: təhlil hər zəngin
          transkripti tutulduqdan sonra avtomatik baş verir, bu səhifə isə hazır nəticələri yalnız
          göstərir.
        </p>
      </HelpCallout>
    </div>
  )
}
