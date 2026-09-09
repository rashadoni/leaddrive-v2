"use client"

/**
 * CRM Dashboard — help article (Azerbaijani).
 * en.tsx-in güzgüsü: Dashboard (icmal paneli) + Bildirişlər vahid ekran kimi.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CrmDashboardHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Bu nə üçün vacibdir">
        <p>
          <strong>Dashboard</strong> biznesin bir ekranda icmalıdır: əhəmiyyətli rəqəmlər, onların
          arxasındakı qrafiklər, bu gün diqqət tələb edən məsələlər və CRM-in qalan modullarına sürətli
          keçidlər. <strong>Bildirişlər</strong> isə onun yoldaşıdır — sistem sövdələşmə, tapşırıq,
          ticket və ya başqa hadisənin sizdən nə vaxt asılı olduğunu özü xəbər verir.
        </p>
        <p>
          İşlərin vəziyyətini görmək üçün Dashboard-u açın; siz yox ikən CRM-in topladığı bildirişləri
          təmizləmək üçün Bildirişləri açın. Hər iki səhifədəki hər şey təşkilatınızla məhdudlaşır.
        </p>
      </HelpSection>

      <HelpSection title="Dashboard — başlıq və Sürətli giriş">
        <p>
          Başlıq sizi günün vaxtına görə salamlayır, bugünkü tarixi göstərir və{" "}
          <HelpKey>Yeniləndi</HelpKey> vaxtını qeyd edir — məlumat anlıq görüntüsü səhifəni açanda bir
          dəfə yüklənir, ona görə təzə rəqəmlər üçün səhifəni yeniləyin.
        </p>
        <HelpStep n={1}>
          <p>
            <strong>Sürətli giriş</strong> zolağı metriklərin üstündə yerləşir: sevimli və son
            istifadə olunan modullarınızı bir kliklik çiplər kimi, həmçinin tətbiq başladıcısını açan{" "}
            <HelpKey>Bütün tətbiqlər</HelpKey> düyməsini göstərir. Bu sırf əlavədir — yeni hesabda yalnız
            başladıcı işarəsi görünür.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Çip yalnız həmin modula girişiniz varsa görünür — rolunuzun görə bilmədiyi modulların
            sevimliləri və sonuncuları sadəcə süzülüb çıxır.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Altı KPI kartı">
        <p>
          Yuxarı sıra cari dövr üçün altı əsas rəqəmdir. Bütün məbləğlər manatla (₼) göstərilir, böyük
          dəyərlər isə qısaldılır (məsələn, 12.5K).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Gəlir">Aylıq gəlir. Mənfəətlilik məlumatı qurulmayıbsa, qazanılmış sövdələşmələrinizin cəmi qoyulur.</HelpDef>
          <HelpDef term="Lidlər">İşdə olan lidlərin sayı (aktiv — hələ çevrilməyib və itirilməyib).</HelpDef>
          <HelpDef term="Sövdələşmələr">Satış kanalındakı aktiv sövdələşmələr, alt sətirdə qazanılanların ümumi məbləği.</HelpDef>
          <HelpDef term="Çevrilmə">Kanal çevrilmə nisbəti — qazanılmış sövdələşmələrin bütün sövdələşmələrə payı.</HelpDef>
          <HelpDef term="Ticketlər">Açıq dəstək ticketləri, SLA-nı pozanları nişanlayır.</HelpDef>
          <HelpDef term="Kampaniyalar">Son kampaniyaların sayı, alt sətirdə sonuncu açılma göstəricisi.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Qrafiklər, süni intellekt vidcetləri və aktivlik lenti">
        <p>
          KPI-ların altında eyni anlıq görüntüdən oxuyan vidcet şəbəkəsi yerləşir:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Satış kanalı</strong>, <strong>Gəlir trendi</strong> (faktiki — öhdəlik, ən yaxşı ssenari və kanal proqnozu ilə müqayisədə) və <strong>Lid mənbələri</strong> halqası.</li>
          <li><strong>Son sövdələşmələr</strong>, <strong>Da&nbsp;Vinci Lid Skorinqi</strong> (ən yüksək balla lidləriniz) və son zənglər, məktublar, görüşlər və qeydlərlə <strong>Aktivlik lenti</strong>.</li>
          <li><strong>Kampaniyalar</strong>, yaxın <strong>Tədbirlər</strong>, <strong>həftəlik</strong> metriklər (SLA-ya əməl, CSAT, orta cavab vaxtı, günlük yeni lidlər və ticketlər) və kontakt <strong>Seqmentləri</strong>.</li>
        </ul>
        <HelpCallout kind="tip">
          <p>
            İki <strong>Da&nbsp;Vinci</strong> vidceti — süni intellekt əməliyyatları növbəsi və bu ay
            süni intellektin faydası — standart olaraq administratorlara və menecerlərə görünür. Hər
            digər vidcet kimi, onları da rollara görə açıb-bağlamaq olar.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Risklər banneri — bu gün nə diqqət tələb edir">
        <p>
          Nəsə qaydasında deyilsə, qrafiklərin üstündə rənglə kodlanmış kartlarla{" "}
          <strong>Risklər</strong> banneri görünür. <em>Kritik</em> risklər qırmızı zolaq,{" "}
          <em>xəbərdarlıqlar</em> isə kəhrəba zolaq alır. Hər şey qaydasında olanda banner gizli qalır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Aşağı marja">Marja hədəfin altına düşüb.</HelpDef>
          <HelpDef term="Zərərli müştərilər">Çox sayda müştəri zərərlə işləyir.</HelpDef>
          <HelpDef term="SLA pozulub">Bir və ya bir neçə ticket SLA müddətini ötürüb.</HelpDef>
          <HelpDef term="Gecikmiş tapşırıqlar">Bir neçədən çox tapşırıq vaxtı keçib.</HelpDef>
          <HelpDef term="Riskli sövdələşmələr">Proqnoz balının 40%-dən aşağı qiymətləndirdiyi aktiv sövdələşmələr.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Hansı vidcetlərin görünəcəyini seçmək">
        <p>
          Dashboard düzülüşü sabit deyil. Hər vidceti açıb-bağlamaq olar və bu seçim bütün təşkilat üçün
          saxlanılır — rollara görə görünmə ilə, beləliklə müşahidəçi ilə administratorun panelləri fərqli
          ola bilər.
        </p>
        <HelpStep n={1}>
          <p>
            <strong>Tənzimləmələr → Dashboard</strong> bölməsinə keçin və istənilən vidcetin yanındakı
            açarı dəyişin. Dəyişiklik dərhal saxlanılır.
          </p>
        </HelpStep>
        <HelpCallout kind="next">
          <p>
            Bir neçə əlavə vidcet standart olaraq bağlıdır (hesab-faktura statistikası, kampaniya ROI-si,
            sövdələşmə çevrilməsi, ticket SLA-sı, komanda effektivliyi və başqaları). Panelə əlavə etmək
            istəyəndə onları eyni qaydada açın.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Bildirişlər — xəbərdarlıq lenti">
        <p>
          Bildirişlər sövdələşmələr, tapşırıqlar, ticketlər və başqa hadisələr barədə qısa sistem
          xəbərdarlıqlarıdır. Hər birinin ikonunu və rəngini təyin edən <strong>tipi</strong> var:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="İnfo">Neytral xəbərdarlıq (mavi).</HelpDef>
          <HelpDef term="Uğur">Nəsə tamamlandı (yaşıl).</HelpDef>
          <HelpDef term="Xəbərdarlıq">Nəyəsə baxmaq lazımdır (sarı).</HelpDef>
          <HelpDef term="Xəta">Nəsə alınmadı.</HelpDef>
        </dl>
        <p>
          Ən təzə bildirişlər yuxarıdadır. Üç kart siyahını ümumiləşdirir:{" "}
          <HelpKey>Cəmi</HelpKey>, <HelpKey>Oxunmamış</HelpKey> və <HelpKey>Oxunmuş</HelpKey>.
        </p>
      </HelpSection>

      <HelpSection title="Bildiriş siyahısı ilə işləmək">
        <HelpStep n={1}>
          <p>
            <HelpKey>Hamısı</HelpKey> / <HelpKey>Oxunmamış</HelpKey> tabları ilə bütün lent və hələ
            oxumadıqlarınız arasında keçin. Hər tab öz sayını göstərir.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Oxunmamışlar seçilir — solda rəngli zolaq, çalarlı fon və nöqtə.{" "}
            <strong>Oxunmamış bildirişə klik onu oxunmuş kimi nişanlayır.</strong>
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Hamısını birdən başlıqdakı <HelpKey>Hamısını oxunmuş kimi işarələ</HelpKey> ilə təmizləyin.
            Oxunmamış olmayanda düymə qeyri-aktivdir.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Bu səhifə özü yenilənmir — açandan sonra gələn xəbərdarlıqları gətirmək üçün onu yenidən
            yükləyin. Vaxt nisbi göstərilir (məsələn, «5 dəq əvvəl») və bir həftədən sonra təqvim
            tarixinə keçir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Hər iki səhifə təşkilatınızla məhdudlaşır, bildirişlər isə sizə görə süzülür — hesabınıza ünvanlanan
          xəbərdarlıqları və təşkilat üzrə ümumi olanları görürsünüz, heç vaxt başqasının şəxsi lentini yox.
          Dashboard yalnız oxumaq üçün icmaldır: o, məlumatlarınızı əks etdirir, amma dəyişmir, ona görə onu
          istənilən şəxs qeydi redaktə etmək riski olmadan aça bilər.
        </p>
      </HelpCallout>
    </div>
  )
}
