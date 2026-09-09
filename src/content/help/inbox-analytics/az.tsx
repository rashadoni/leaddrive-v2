"use client"

/**
 * Inbox Analytics — help article (Azerbaijani).
 * Yalnız Gələnlər → Gələnlər analitikası səhifəsini əhatə edir:
 * tarix/kanal/agent filtrləri, KPI kartları, həcm qrafiki, ən sıx
 * saatlar istilik xəritəsi, kanallar üzrə həcm, cavab vaxtı/SLA,
 * backlog yaşa görə, komanda göstəriciləri cədvəli, söhbət statusları,
 * seqment üzərinə klik → drill-down pəncərə və CSV ixracı.
 * Səhifə yalnız oxunur — heç bir məlumat dəyişdirilmir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function inboxanalyticsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dəstək rəhbəri və ya əməliyyat administratorusunuz"
        goal="Bütün kanallar üzrə mesaj həcmini, cavab sürətini və komandanın yükünü tək ekrandan izləmək"
      >
        Səhifəyə <HelpKey>Gələnlər</HelpKey> → <HelpKey>Gələnlər analitikası</HelpKey> yolu ilə
        çatırsınız. Səhifə tamamilə <strong>yalnız oxunur</strong> — heç bir söhbəti və ya mesajı
        burada dəyişmirsiniz, sadəcə hesabatlara baxırsınız. Bütün saylar yalnız sizin
        təşkilatınızın gələn qutusundan oxunur. Filtr (tarix, kanal, agent) dəyişdikcə bütün kartlar
        və qrafiklər birlikdə yenidən yüklənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda diaqram ikonası ilə birgə <HelpKey>Gələnlər analitikası</HelpKey> adı və altında
          «Mesaj həcmi, söhbət statusları və ilk cavab vaxtı — bütün kanallar üzrə» izahı var. Sağ
          yuxarıda dörd idarəetmə durur: <strong>kanal</strong> açılan siyahısı, <strong>agent</strong>{" "}
          açılan siyahısı, üç tarix düyməsi (<HelpKey>7 gün</HelpKey>, <HelpKey>30 gün</HelpKey>,{" "}
          <HelpKey>Bütün vaxt</HelpKey> — standart olaraq <strong>30 gün</strong> seçilidir) və{" "}
          <HelpKey>CSV ixrac</HelpKey> düyməsi.
        </p>
        <p>
          Məlumat varsa, aşağıda ardıcıl olaraq belə bloklar gəlir: KPI kartları sırası, mesaj həcmi
          qrafiki, ən sıx saatlar istilik xəritəsi, kanallar üzrə həcm, cavab vaxtı və SLA, backlog
          yaşa görə, komanda göstəriciləri cədvəli və söhbətlər kartı. Seçilmiş dövrdə heç mesaj
          yoxdursa, bunların hamısının yerinə tək «Bu dövrdə mesaj yoxdur.» mətni göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi mesajlar">Seçilmiş filtr üzrə gələn və gedən mesajların cəmi.</HelpDef>
          <HelpDef term="Gələn / Gedən">Müştəridən gələn və komandanın göndərdiyi mesajlar; hər birinin altında ümumidən neçə faiz olduğu yazılır.</HelpDef>
          <HelpDef term="İlk cavabın medianı">Söhbətlərə ilk cavabın tipik (median) vaxtı; kartın altında orta vaxt da görünür.</HelpDef>
          <HelpDef term="SLA ödənildi">Cavablanmış söhbətlərin neçə faizinin SLA həddi (məs. {"<"}5 dəqiqə) ərzində cavablandığı.</HelpDef>
          <HelpDef term="Açıq backlog">Hələ bağlanmamış (açıq) söhbətlərin sayı; kartın altında ən köhnəsinin yaşı yazılır.</HelpDef>
          <HelpDef term="Median FRT">İlk cavab vaxtının medianı (First Response Time) — komanda cədvəlində hər agent üçün ayrıca.</HelpDef>
          <HelpDef term="Backlog">Açıq qalmış söhbətlər yığını; «yaşa görə» onları nə qədər köhnə olmalarına görə qruplaşdırır.</HelpDef>
          <HelpDef term="Drill-down">Hər hansı saya/zolağa kliklədikdə həmin rəqəmin arxasındakı konkret söhbətlərin siyahısını açan pəncərə.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: dövrü və filtrləri seç">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı tarix düymələrindən birini seçin: <HelpKey>7 gün</HelpKey>,{" "}
            <HelpKey>30 gün</HelpKey> və ya <HelpKey>Bütün vaxt</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz düymə dolu (vurğulanmış) görünür, qısa yükləmə fırlanğacı çıxır, sonra bütün
            kartlar və qrafiklər yeni dövr üzrə yenidən hesablanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstəsəniz <HelpKey>Bütün kanallar</HelpKey> açılan siyahısından tək kanal seçin (e-poçt,
            SMS, WhatsApp, Telegram, Facebook, Instagram, VKontakte, veb-çat).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bütün saylar yalnız seçilmiş kanala görə süzülür. Siyahıda həmişə eyni kanal seçimləri
            qalır — nəticə boş olsa belə siyahı «yığılmır».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Konkret bir komanda üzvünə baxmaq üçün <HelpKey>Bütün agentlər</HelpKey> açılan
            siyahısından bir agent seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hesabat seçilmiş agentə daralır. Agent siyahısı süzülmüş nəticədən asılı olmayaraq tam
            qalır, ona görə istənilən vaxt başqa agentə keçə bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: kartları və qrafikləri oxu">
        <HelpStep n={1}>
          <p>
            Yuxarıdakı KPI kartları sırasına baxın: <strong>Ümumi mesajlar</strong>,{" "}
            <strong>Gələn</strong>, <strong>Gedən</strong>, <strong>İlk cavabın medianı</strong>,{" "}
            <strong>SLA ödənildi</strong> və <strong>Açıq backlog</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kartda ikona, rəqəm və kiçik alt sətir olur (məs. «ümumidən 60%», «orta 3.2d», «ən
            köhnə 2g»). SLA kartı yalnız cavablanmış söhbət varsa görünür; median və backlog
            məlumatı yoxdursa, rəqəm yerinə «—» göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Mesaj həcmi</HelpKey> qrafikində günlük gələn (mavi) və gedən (yaşıl) həcmin
            necə dəyişdiyinə baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İki rəngli sahə qrafiki. Hər hansı günün üzərinə kursoru gətirsəniz, o günün dəqiq gələn
            və gedən saylarını göstərən ipucu çıxır. Bu qrafik yalnız bir gündən çox məlumat olanda
            görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Ən sıx saatlar</HelpKey> istilik xəritəsində həftənin günü × saat üzrə hansı
            vaxtların ən yüklü olduğunu görün.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            7 sətir (həftə günləri) × 24 sütun (saatlar) şəbəkəsi; xana nə qədər tünddürsə, o saatda
            o qədər gələn mesaj olub. Başlığın yanında «UTC · gələn» qeydi var — saatlar UTC üzrədir.
            Bir xananın üzərinə gəlsəniz, gün, saat və say göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <HelpKey>Kanallar üzrə</HelpKey> blokunda hər kanalın həcm payına baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə kanal ikonası, adı, ümumi say və faiz, bir tərəqqi zolağı, altında isə həmin
            kanalın gələn/gedən bölgüsü olur. Tanınmayan kanallar «Digər» kimi qruplaşır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: rəqəmin arxasındakı söhbətləri aç (drill-down)">
        <HelpStep n={1}>
          <p>
            <HelpKey>Cavab vaxtı və SLA</HelpKey> blokunda paylanma zolaqlarından birini basın
            (məs. {"<"}5d, 5–15d). Eyni qaydada <HelpKey>Backlog yaşa görə</HelpKey> blokunda rəngli
            yaş zolağını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ortada pəncərə açılır; başlığında blok adı və seçilmiş zolaq yazılır, içində o seqmentə
            düşən söhbətlər sadalanır. Boşdursa «Bu seqmentdə söhbət yoxdur» göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Komanda göstəriciləri</HelpKey> cədvəlində hər hansı agent sətrinə klikləyin və
            ya <HelpKey>Söhbətlər</HelpKey> kartında kanal zolaqlarından birini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl sütunları: <strong>Agent</strong>, <strong>Təyin edilib</strong>,{" "}
            <strong>Həll edilib</strong>, <strong>Resolution</strong>, <strong>Median FRT</strong>,{" "}
            <strong>Oxunmamış</strong>. Sətrə kliklədikdə həmin agentin söhbətləri ilə drill-down
            pəncərəsi açılır; kanal zolağı isə həmin kanalın söhbətlərini açır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pəncərədəki söhbət sətirlərindən birini basın və ya altdakı{" "}
            <HelpKey>Gələn qutusunu aç</HelpKey> linkinə keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə kanal ikonası, kontaktın adı, kanal · agent · yaş və status nişanı olur; varsa
            oxunmamış say sarı rəngdə görünür. Sətrə kliklədikdə həmin söhbət birbaşa Gələn qutusunda
            açılır. Aşağıda nəticə sayı (və ya «Son 50 göstərilir») yazılır. Bağlamaq üçün × düyməsini
            və ya pəncərədən kənarı basın.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: söhbət statuslarını oxu və CSV ixrac et">
        <HelpStep n={1}>
          <p>
            <HelpKey>Söhbətlər</HelpKey> kartında həll göstəricisinə, orta söhbət müddətinə və status
            nişanlarına baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Solda iri faizlə həll göstəricisi (məs. «… / …») və saat ikonası ilə orta müddət; altında{" "}
            <strong>Açıq</strong>, <strong>Həll edilib</strong>, <strong>Arxivlənib</strong>{" "}
            (varsa <strong>Digər</strong>) nişanları və «Kanallar üzrə söhbətlər» bölgüsü. Diqqət: bu
            göstərici «bu dövrdə başlanan söhbətlər» koqortasıdır, dövr üzrə ümumi həll dərəcəsi deyil.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sağ yuxarıdakı <HelpKey>CSV ixrac</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ekranda olan rəqəmlərdən (KPI-lar, kanallar, SLA, yaş, agentlər) ibarət bir CSV faylı
            «inbox-analytics-TARİX.csv» adı ilə yüklənir — heç bir yeni sorğu getmir, sadəcə artıq
            göstərilən məlumat ixrac olunur. Məlumat yoxdursa (ümumi mesaj 0-dırsa) düymə qeyri-aktiv
            olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Vaxt sahələri UTC üzrədir — «Ən sıx saatlar» istilik xəritəsi yerli saatla deyil, UTC ilə
          oxunmalıdır. Filtrləri birləşdirin: əvvəlcə dövrü, sonra kanalı, sonra agenti seçərək çətin
          kanal × agent kəsişmələrini araşdıra bilərsiniz; sonra qrafiklərdəki zolaqlara klikləyib
          birbaşa söhbətlərə düşün.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Söhbətlər kartındakı həll göstəricisi <strong>başlama tarixinə görə koqortadır</strong>:
          «bu dövrdə başlanan söhbətlərin indi neçəsi həll edilib» deməkdir, dövr ərzindəki ümumi həll
          sürəti deyil. Backlog blokunda yanlış tarixli yazılar varsa, başlıqda neçəsinin istisna
          edildiyi qeyd olunur — saylardakı kiçik fərqlər buradan gələ bilər.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün analitika təşkilatınızın gələn qutusu ilə məhdudlaşır — yalnız öz tenant-ınızın
          mesajlarını, söhbətlərini və agentlərini görürsünüz. Səhifə yalnız oxunur: drill-down
          pəncərəsindən söhbəti açmaq sizi Gələn qutusuna aparır, lakin bu analitika ekranında heç bir
          məlumat dəyişdirilmir.
        </p>
      </HelpCallout>
    </div>
  )
}
