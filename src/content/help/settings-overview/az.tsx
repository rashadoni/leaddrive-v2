"use client"

/**
 * Settings — help article (Azerbaijani).
 * en.tsx-in güzgüsü: Tənzimləmələr hub-ı (/settings) + Dashboard Tənzimləmələri (/settings/dashboard).
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SettingsOverviewHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Bu nə üçün vacibdir">
        <p>
          <strong>Tənzimləmələr</strong> — CRM-in necə işlədiyini idarə edən hər şeyin başlanğıc
          nöqtəsidir: təşkilat profili, rollar, kanallar, billinq, təhlükəsizlik və daha çoxu. Bu,
          bir forma deyil; hər biri ayrıca tənzimləmə səhifəsini açan kartlar şəbəkəsidir.
        </p>
        <p>
          <strong>Dashboard Tənzimləmələri</strong> bu kartlardan biridir. O, əsas dashboard-da hansı
          vidjetlərin görünəcəyini müəyyən edir — komandanızın istifadə etmədiklərini söndürün, əsas
          ekran hamı üçün qısalır və sürətlənir.
        </p>
      </HelpSection>

      <HelpSection title="Tənzimləmələr hub-ı — hər sahə üçün bir kart">
        <p>
          Hər kartda başlıq, bir sətirlik təsvir və <HelpKey>i</HelpKey> məlumat ipucu var; sahəni
          açmaq üçün kartın istənilən yerinə klikləyin. Kartlar bir neçə mövzuya görə qruplaşır:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="İş sahəsi">Təşkilat, Billinq, Rollar və icazələr</HelpDef>
          <HelpDef term="Kanallar və avtomatlaşdırma">Kanallar, İş axınları, Makrolar, AI Avtomatlaşdırma, Veb-çat vidjeti</HelpDef>
          <HelpDef term="Maliyyə">Hesab-faktura tənzimləmələri, Ödəniş bildirişləri, Valyutalar</HelpDef>
          <HelpDef term="Dəstək və giriş">SLA Siyasətləri, Portal istifadəçiləri</HelpDef>
          <HelpDef term="Platforma">Dashboard Tənzimləmələri, Xüsusi sahələr, Öz domenləriniz, İnteqrasiyalar</HelpDef>
          <HelpDef term="İdarəetmə">Təhlükəsizlik, Audit jurnalı</HelpDef>
        </dl>
        <HelpCallout kind="tip">
          <p>
            İstənilən kartdakı <HelpKey>i</HelpKey> üzərinə gəlin — kartı açmazdan əvvəl içində nəyin
            olduğuna dair bir sətirlik xatırlatma alın. Konkret bir tənzimləməni axtaranda və bir
            neçə səhifəni gəzmək istəməyəndə əlverişlidir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Dashboard Tənzimləmələri — vidjetləri göstər və ya gizlət">
        <p>
          Onu <strong>Dashboard Tənzimləmələri</strong> kartından açın (və ya{" "}
          <HelpKey>/settings/dashboard</HelpKey> ünvanına keçin). Hər birində ikon, ad, qısa təsvir
          və bir <HelpKey>aç/söndür</HelpKey> açarı olan vidjet kartları şəbəkəsi görəcəksiniz.
          Başlıqda neçəsinin <strong>aktiv</strong>, neçəsinin <strong>gizli</strong> olduğu sayılır.
        </p>
        <HelpStep n={1}>
          <p>
            Vidjeti açmaq və ya söndürmək üçün karta — və ya onun açarına — klikləyin. Yaşıl,
            vurğulanmış kart açıqdır; sönük, şəffaf kart söndürülüb.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Hər keçid <strong>avtomatik</strong> yadda saxlanılır — «Yadda saxla» düyməsi yoxdur.
            Dəyişiklik yazılarkən kartda kiçik bir yüklənmə göstəricisi görünür.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Nəticəni görmək üçün əsas dashboard-u açın: açıq saxladığınız vidjetlər buradakı eyni
            sıra ilə görünür, söndürdükləriniz isə yox olur.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Burada keçirilə bilən vidjetlərə bunlar daxildir: <strong>Risklər Banneri</strong>,{" "}
            <strong>KPI Kartları</strong>, AI vidjetləri (<strong>AI əməliyyat növbəsi</strong>,{" "}
            <strong>Bu ayın AI dəyəri</strong>, <strong>Da&nbsp;Vinci Lid Skorinqi</strong>),{" "}
            <strong>Satış Boru Kəməri</strong>, <strong>Gəlir Trendi</strong>,{" "}
            <strong>Lid Mənbələri</strong>, <strong>Son Sövdələşmələr</strong>,{" "}
            <strong>Son Fəaliyyət</strong>, <strong>Kampaniyalar</strong>, <strong>Tədbirlər</strong>,{" "}
            <strong>Həftəlik Metriklər</strong>, <strong>Tövsiyə Olunan Addımlar</strong> və{" "}
            <strong>Müştəri İtkisi Riski</strong>.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Vidjetin görünməsi necə qərarlaşır">
        <p>
          Hər vidjet iki şey daşıyır: <strong>aktiv</strong> olub-olmadığı və onu görə bilən{" "}
          <strong>rolların</strong> siyahısı. Dashboard vidjeti yalnız o aktiv olduqda{" "}
          <em>və</em> rol siyahısı boş olduqda ya da cari istifadəçinin rolunu ehtiva etdikdə
          göstərir.
        </p>
        <p>
          Vidjetlərin əksəriyyəti standart olaraq bütün rollar üçün aktivdir. Standart olaraq iki AI
          vidjeti — <strong>AI əməliyyat növbəsi</strong> və <strong>Bu ayın AI dəyəri</strong> —{" "}
          <strong>admin</strong> və <strong>manager</strong> rolları ilə məhdudlaşır, ona görə digər
          rollar onları aktiv olsa belə görməyəcək.
        </p>
        <HelpCallout kind="warning">
          <p>
            Burada vidjeti söndürmək onu yalnız sizin üçün yox, <strong>bütün təşkilat</strong> üçün
            gizlədir. Komanda yoldaşı dashboard-da çatışmayan kart barədə deyirsə — əvvəlcə bu
            səhifəni yoxlayın.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Seçimləriniz harada saxlanılır">
        <p>
          Vidjet seçimləri istifadəçi üzrə yox, <strong>təşkilat</strong> səviyyəsində saxlanılır —
          beləcə dashboard görünüşü iş sahənizdəki hamı üçün eyni olur. Tənzimləmələr hub-ının özü
          heç nə saxlamır; o, sizi sadəcə hər tənzimləməyə sahib olan səhifəyə yönləndirir.
        </p>
        <HelpCallout kind="next">
          <p>
            Quraşdırmaya yeni başlayırsınız? Adi ilk keçid belədir: <strong>Təşkilat</strong> (ad,
            loqo, tarif) → <strong>Rollar və icazələr</strong> → <strong>Kanallar</strong> → sonra{" "}
            <strong>Dashboard Tənzimləmələri</strong> ilə əsas ekranı yalnız komandanın həqiqətən
            istifadə etdiyinə qədər qısaldın.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Tənzimləmələrdəki hər şey təşkilatınızla məhdudlaşır və rolunuzun icazələri ilə qorunur —
          yalnız öz tenant-ınızın konfiqurasiyasını görüb dəyişirsiniz. Vidjet dəyişiklikləri
          təşkilatınızın tənzimləmələrinə yazılır və bütün üzvlər üçün növbəti dashboard yüklənməsində
          qüvvəyə minir.
        </p>
      </HelpCallout>
    </div>
  )
}
