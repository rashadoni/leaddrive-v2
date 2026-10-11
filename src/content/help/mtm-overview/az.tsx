"use client"

/**
 * MTM — «Panel» (/mtm), kömək məqaləsi (Azərbaycan dili).
 * Yalnız `operational-week-home.tsx` ekrana çıxardığını təsvir edir: komanda bu
 * gün, filtrlər və bir işçinin həftəsi. Yazılar `messages/az.json` faylından
 * götürülüb (`mtmDashboardPage` və `mtmDashboardPage.operationalWeek`): orada
 * yazı dəyişirsə, burada da düzəldin. Növbə və iş günü bura daxil deyil (Workforce).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MtmOverviewHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sahə komandasının rəhbəri"
        goal="Bu gün işçilərdən kimin harada olduğunu görmək və istənilən işçinin həftəsini açmaq"
      >
        Bu, <HelpKey>Marşrut &amp; Sahə</HelpKey> modulunun ilk ekranıdır, menyuda —{" "}
        <HelpKey>Panel</HelpKey>. Siz yalnız öz əhatənizdəki işçiləri görürsünüz. Öz hesabı ilə
        daxil olan agent yalnız öz həftəsini görür.
      </HelpScenario>

      <HelpSection title="Komanda bu gün">
        <p>
          Birinci sətir günün yekunudur: <strong>«İndi vizitdə 14 nəfərdən 2»</strong> — hazırda
          neçə işçinin viziti açıqdır. Yanında — <strong>«bu günə plan yoxdur»</strong> və ya{" "}
          <strong>«3 işçinin planı yoxdur»</strong> və rəqəmlərin hansı vaxta aid olduğu:{" "}
          <strong>«14:05 üzrə»</strong>.
        </p>
        <p>Aşağıda hər işçiyə bir sətir. Sətir yalnız onun haqqında məlum olanı deyir:</p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Haradadır">«… müştərisindədir, 10:40-dən», «Növbəti: …, 11:30» və ya «10:15-dək … müştərisində olub».</HelpDef>
          <HelpDef term="marşrut 3/8">Bu günə planlaşdırılmış nöqtələrdən neçəsinə baş çəkilib. «Plan yoxdur» — bu günə marşrut yoxdur.</HelpDef>
          <HelpDef term="son GPS">Son koordinatın gəldiyi vaxt. Bu, işçinin indi də orada olduğunu bildirmir. «Bu gün GPS yoxdur» — o, vizitdədir, koordinat isə gəlməyib.</HelpDef>
          <HelpDef term="xəbərdarlıq">«2 açıq xəbərdarlıq» — bu işçinin xəbərdarlıqları siyahısına keçid.</HelpDef>
          <HelpDef term="Xəritədə">Xəritəni bu işçinin üzərində açır.</HelpDef>
        </dl>
        <p>
          Solda kəhrəba rəngli zolaq nəyinsə qaydasında olmadığı sətri göstərir: plansız vizit,
          GPS-siz vizit və ya açıq xəbərdarlıqlar. Bu gün nə viziti, nə də koordinatı olan işçilər bir
          sətrə yığılıb — «5 işçi bu gün aktivlik göstərməyib»; onu <HelpKey>Göstər</HelpKey> açır.
        </p>
      </HelpSection>

      <HelpSection title="İşçinin həftəsini açırıq">
        <HelpStep n={1}>
          <p>
            Siyahının altında filtrlər var: <HelpKey>Region</HelpKey> və <HelpKey>Komanda</HelpKey>{" "}
            siyahını daraldır, <HelpKey>İşçi</HelpKey> bir nəfərin həftəsini açır.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İşçinin sətrinə klikləyin və ya onu <HelpKey>İşçi</HelpKey> filtrində seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Həmin işçinin <HelpKey>Əməliyyat həftəsi</HelpKey>. Komandaya qayıtmaq üçün{" "}
            <HelpKey>İşçi</HelpKey> filtrini xaç işarəsi ilə sıfırlayın.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Həftə nəyi göstərir">
        <dl className="rounded-md border p-3">
          <HelpDef term="Dövr">«1 gün», «5 gün», «7 gün» düymələri, «Tarix» sahəsi və oxlar ekranda hansı günlərin olacağını seçir.</HelpDef>
          <HelpDef term="Əlaqə">«Əlaqədədir: …» və ya «…-dən əlaqə yoxdur» — işçinin son koordinatının vaxtı. «Xəritədə yol» onun seçilmiş gündəki yolunu açır.</HelpDef>
          <HelpDef term="Günlər">Hər gündə «Plan», «Fakt», «Ləğv» və marşrut nöqtələri var: müəssisə, müştəri, plan və fakt vaxtı, vizit qeydləri (giriş və çıxış, dəqiqələr, foto, imza). «Marşrutu aç» və «Viziti aç» marşrutun və vizitin özünə aparır. Plandan kənar vizitlər ayrıca göstərilir: «Dərc olunmuş plandan kənar faktiki vizitlər». Telefonda günlər düymələrlə dəyişdirilir.</HelpDef>
          <HelpDef term="Planın icrası">Ekrandakı dövr üzrə dərc olunmuş planın icra edilmiş nöqtələrinin payı.</HelpDef>
          <HelpDef term="Diqqət tələb edir">Bu işçinin xəbərdarlıqları, «Təsdiq gözləyən ləğvlər», plan dəyişiklikləri və «Aktiv tapşırıqlar». Heç nə olmadıqda — «Hər şey qaydasındadır — tədbir lazım deyil.»</HelpDef>
        </dl>
        <p>
          Nöqtənin ləğvini agent öz həftəsində <HelpKey>Ləğv sorğusu göndər</HelpKey> düyməsi ilə
          istəyir. Təsdiq hüququ olan rəhbər onu elə burada həll edir: <HelpKey>Təsdiqlə</HelpKey>,{" "}
          <HelpKey>Köçür</HelpKey>, <HelpKey>Geri qaytar</HelpKey> və ya <HelpKey>Rədd et</HelpKey>.
          Köçürmə üçün yeni tarix, geri qaytarma və rədd üçün şərh lazımdır.
        </p>
      </HelpSection>

      <HelpSection title="Mesaj və dəstək">
        <p>
          Panelin altında «Əsas mesaj» — sizə göndərilmiş, «… tarixinədək aktivdir» müddətli elan —
          və modul parametrlərindəki e-poçt və telefonla «Dəstək» ola bilər.{" "}
          <HelpKey>Təsdiq et</HelpKey> düyməsi mesajı oxuduğunuzu qeyd edir. Nə mesaj, nə də əlaqə
          məlumatı olmadıqda bu blok yoxdur.
        </p>
      </HelpSection>

      <HelpCallout kind="tip" label="Məsləhət">
        <p>
          Vərəq qarşınızda açıq olduqca ekran dəqiqədə bir dəfə özü yenilənir. Dairəvi oxlu düymə
          dərhal yeniləyir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning" label="Vacib">
        <p>
          Sıfır və boş siyahı yalnız uğurlu yükləmədən sonra heç nə olmadığını bildirir. Məlumat
          gəlməyibsə, ekran bunu sözlə deyir — «Komandanın bugünkü vəziyyətini yükləmək alınmadı» —
          və <HelpKey>Həftəni yenidən yüklə</HelpKey> təklif edir. Şəbəkə olmadıqda işçinin həftəsi
          saxlanmış nüsxə varsa, ondan və «Şəbəkə yoxdur — son saxlanmış görüntü göstərilir» qeydi
          ilə göstərilir.
        </p>
      </HelpCallout>
    </div>
  )
}
