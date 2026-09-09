"use client"

/**
 * Agent Masaüstü — kömək məqaləsi (Azərbaycan dili).
 * Video-ssenari formatı: dəstək agentinin ana ekranı —
 * əlçatanlıq açarı, dörd KPI kartı, Komanda KPI halqaları +
 * prioritetə görə bölgü, açıq müraciətlər növbəsi və agent reytinqi.
 * Səhifə yalnız oxuyur/göstərir; tək yazma əməliyyatı öz əlçatanlıq açarınızdır.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function agentdesktopHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dəstək agenti və ya dəstək komandasının rəhbərisiniz"
        goal="Növbənin əvvəlində bir baxışda görmək: indi iş götürürəmmi, nə yanır və komandanın işləri necə gedir"
      >
        Səhifəyə <HelpKey>Dəstək</HelpKey> → <HelpKey>Agent Masaüstü</HelpKey> yolu ilə çatırsınız.
        Başlıqda salam mesajı sizin adınızla görünür. Bu səhifə əsasən{" "}
        <strong>oxuyur</strong> — rəqəmlər sizin ticketlərinizdən canlı hesablanır, yeganə yazma
        əməliyyatı isə yuxarı sağ küncdəki öz əlçatanlıq açarınızdır. Hər şey təşkilatınızla
        məhdudlaşır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda qulaqlıq ikonası, <HelpKey>Agent Masaüstü</HelpKey> başlığı və altında «Dəstək
          paneli — &lt;adınız&gt;» yazısı var. Sağ yuxarıda <strong>Mövcuddur</strong> /{" "}
          <strong>Mövcud deyil</strong> mətni və yanında açar (toggle) durur. Altda dörd rəngli KPI
          kartı: <strong>Açıq müraciətlər</strong>, <strong>Mənim müraciətlərim</strong>,{" "}
          <strong>Ort. cavab vaxtı</strong> və <strong>CSAT</strong>. Onların altında solda{" "}
          <HelpKey>Komanda KPI</HelpKey> kartı (üç halqa göstərici + prioritetə görə bölgü), sağda
          isə <HelpKey>Açıq müraciətlər</HelpKey> cədvəli gəlir. Ən altda <HelpKey>Agent reytinqi</HelpKey>{" "}
          cədvəli var.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Əlçatanlıq açarı">Yaşıl/«Mövcuddur» = rotasiyadasınız; «Mövcud deyil» = avtomatik təyinat sizi yan keçsin. Yalnız öz statusunuzu dəyişir.</HelpDef>
          <HelpDef term="Açıq müraciətlər">Hələ həll edilməmiş və bağlanmamış bütün ticketlərin sayı. Səhifə yüklənəndə ticketlərinizdən canlı sayılır.</HelpDef>
          <HelpDef term="Mənim müraciətlərim">Konkret olaraq sizə təyin edilmiş açıq ticketlər. Canlı sayılır.</HelpDef>
          <HelpDef term="Ort. cavab vaxtı">Tipik ilk cavab vaxtı. Hələlik canlı ölçmə deyil — sabit istinad dəyəri göstərir.</HelpDef>
          <HelpDef term="CSAT">Müştərilərin ticketlərinə verdiyi qiymətlərdən canlı orta məmnunluq balı (faizlə). Qiymət yoxdursa 0% göstərir.</HelpDef>
          <HelpDef term="Komanda KPI">Üç halqa: Həll edilib (resolved payı, canlı), SLA (sabit istinad) və CSAT — komandanın vəziyyəti bir baxışda.</HelpDef>
          <HelpDef term="Prioritetə görə açıq">Açıq ticketlərin kritik / yüksək / orta / aşağı üzrə canlı bölgüsü.</HelpDef>
          <HelpDef term="Agent reytinqi">Agentlərin həll etdiyi ticket sayına görə ilk beş sıralaması.</HelpDef>
        </dl>
        <p>
          Səhifə açılarkən bir anlıq «pulsasiya edən» boş skeletlər görünür — bu, ticketlərin və
          istifadəçilərin yüklənməsi deməkdir; yüklənmə bitən kimi kartlar real rəqəmlərlə dolur.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: əlçatanlığınızı dəyişin">
        <HelpStep n={1}>
          <p>
            Sağ yuxarı küncdəki açarı bir dəfə basın. Yanındakı mətn cari statusunuzu göstərir —
            yaşıl <HelpKey>Mövcuddur</HelpKey> və ya boz <HelpKey>Mövcud deyil</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açar yaşıl (sağa sürüşmüş) ilə boz (sola sürüşmüş) arasında keçir, yanındakı mətn isə{" "}
            <strong>Mövcuddur</strong> ↔ <strong>Mövcud deyil</strong> dəyişir. Basıldığı an açar
            qısa müddət solğunlaşır (sorğu gedir), sonra yeni vəziyyətdə sabitlənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Dəyişiklik dərhal və <strong>yalnız öz hesabınız üçün</strong> yadda saxlanır. Buradan
            başqasının statusunu təyin etmək olmaz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Səhifəni yeniləsəniz belə, açar son seçdiyiniz vəziyyətdə qalır — status hesabınızda
            saxlanır, yalnız ekranda deyil.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Bu, ticket marşrutlaşdırmasının oxuduğu eyni bayraqdır. Görüşdən və ya fasilədən əvvəl
            özünüzü <HelpKey>Mövcud deyil</HelpKey> qoyun — yeni ticketlər cavabsız yığılmaq əvəzinə
            sizi yan keçər.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: KPI kartlarını oxuyun">
        <HelpStep n={1}>
          <p>
            Yuxarıdakı dörd rəngli karta baxın. Soldan sağa: mavi <strong>Açıq müraciətlər</strong>,
            bənövşəyi <strong>Mənim müraciətlərim</strong>, yaşıl <strong>Ort. cavab vaxtı</strong>{" "}
            və narıncı <strong>CSAT</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kartda kiçik ikona, etiket və böyük rəqəm var: <strong>Açıq müraciətlər</strong> və{" "}
            <strong>Mənim müraciətlərim</strong> — say; <strong>Ort. cavab vaxtı</strong> — vaxt
            (məs. «2h 15m»); <strong>CSAT</strong> — faiz (məs. «0%»).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Hansı rəqəmlərin canlı olduğunu fərqləndirin: <strong>Açıq müraciətlər</strong>,{" "}
            <strong>Mənim müraciətlərim</strong> və <strong>CSAT</strong> hər yükləmədə real
            ticketlərinizdən hesablanır. <strong>Ort. cavab vaxtı</strong> isə hələlik sabit istinad
            dəyəri-doldurucudur.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            CSAT <strong>0%</strong> görünürsə, bu «pis rəy» deyil — sadəcə hələ heç bir müştəri
            ticketini qiymətləndirməyib deməkdir. Qiymətlər gəldikcə bal dəyişir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: komanda göstəricilərini və prioritetləri oxuyun">
        <HelpStep n={1}>
          <p>
            Sol kartdakı <HelpKey>Komanda KPI</HelpKey> başlığının altındakı üç halqaya baxın:{" "}
            <strong>Resolved</strong>, <strong>SLA</strong> və <strong>CSAT</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Üç dairəvi göstərici görünür — hər biri mərkəzində faiz rəqəmi olan halqa: yaşıl
            «Resolved» (həll edilmiş/bağlanmış ticketlərin payı, canlı), bənövşəyi «SLA» (sabit
            istinad) və narıncı «CSAT» (yuxarı kartla eyni bal). Halqalar dəyərə uyğun yumşaq
            animasiya ilə dolur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Halqaların altındakı <strong>Prioritetə görə açıq</strong> bölməsinə baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Dörd sətir: hər birində rəngli nöqtə, prioritet adı (<strong>critical</strong>,{" "}
            <strong>high</strong>, <strong>medium</strong>, <strong>low</strong>) və sağda say.
            Rənglər: kritik — qırmızı, yüksək — narıncı, orta — kəhrəba, aşağı — yaşıl. Növbəni hələ
            açmamış diqqətinizi hara yönəltmək lazım olduğunu görürsünüz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: açıq müraciətlər növbəsində işləyin">
        <HelpStep n={1}>
          <p>
            Sağdakı <HelpKey>Açıq müraciətlər</HelpKey> cədvəlinə baxın. Sütunlar:{" "}
            <HelpKey>Mövzu</HelpKey>, <HelpKey>Prioritet</HelpKey>, <HelpKey>Status</HelpKey> və{" "}
            <HelpKey>Yaradılıb</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ən son açıq ticketlər (ən çox 10 sətir) sadalanır. Hər sətirdə mövzu, kiçik rəngli
            prioritet nöqtəsi, rəngli status nişanı (məs. <strong>new</strong>,{" "}
            <strong>in progress</strong>, <strong>waiting</strong>) və yaradılma tarixi var. Açıq
            ticket yoxdursa, «Açıq müraciət yoxdur» mətni görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstənilən sətrə klikləyin ki, birbaşa o ticketin səhifəsinə keçəsiniz — orada cavab
            verə, yenidən təyin edə və ya statusunu dəyişə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kursoru sətrin üzərinə gətirəndə fon bir az işıqlanır (klikləyə biləcəyinizi bildirir).
            Klikdən sonra həmin ticketin detal səhifəsi açılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Tam növbəni açmaq üçün cədvəlin başlığının sağındakı <HelpKey>Hamısına bax</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ox işarəli <strong>Hamısına bax</strong> düyməsi sizi tam <strong>Ticketlər</strong>{" "}
            səhifəsinə aparır — orada bütün növbə, status, prioritet süzgəcləri və ətraflı idarəetmə
            var.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="next">
          <p>
            Bu panel qısayoldur, tam mənzərə deyil — yalnız ən son 10 açıq ticketi göstərir. Tam
            növbə, SLA taymerləri və süzgəcləmə üçün <strong>Ticketlər</strong> səhifəsindən işləyin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: agent reytinqini oxuyun">
        <HelpStep n={1}>
          <p>
            Səhifənin altındakı <HelpKey>Agent reytinqi</HelpKey> cədvəlinə baxın. Sütunlar:{" "}
            <HelpKey>#</HelpKey>, <HelpKey>Agent</HelpKey>, <HelpKey>Həll edilib</HelpKey>,{" "}
            <HelpKey>Ort. vaxt</HelpKey> və <HelpKey>CSAT</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ən çox ticket həll etmiş ilk beş agent sıralanır. Birinci yerdə qızılı rəngli sıra
            nömrəsi olur; «Həll edilib» sütununda yaşıl rəqəm, CSAT sütununda isə ulduz ikonası ilə
            faiz görünür. Heç təyinat yoxdursa, «Məlumat yoxdur» mətni görünür.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Agent yalnız ona ticketlər <strong>təyin ediləndən</strong> sonra reytinqdə görünür.
            Lövhə boşdursa, təyinat hələ axmır — <strong>növbələr</strong> qurun və ya Ticketlər
            səhifəsində əl ilə təyin edin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          Bütün rəqəmlər təxminən son 100 ticket üzərindən anlıq hesablanır və avtomatik
          yenilənmir — yeni ticket gələndə cari sayğacları görmək üçün səhifəni təzələyin.{" "}
          <strong>Ort. cavab vaxtı</strong> və <strong>SLA</strong> hələlik sabit istinad
          dəyərləridir, ona görə onları hesabat rəqəmi kimi yox, yer-tutucu kimi qəbul edin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bu səhifədəki hər şey təşkilatınızla məhdudlaşır — ticketlər, agentlər və rəqəmlər öz
          tenant-ınızdan gəlir və rolunuzun icazələri ilə qorunur. Əlçatanlıq açarı qəsdən yeganə
          istisnadır: o, yalnız <strong>sizin öz</strong> statusunuzu dəyişir və admin hüququ tələb
          etmir, ona görə hər agent komandanın qalanına toxunmadan özünü uzaqda işarələyə bilər.
        </p>
      </HelpCallout>
    </div>
  )
}
