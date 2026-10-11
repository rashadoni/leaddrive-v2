"use client"

/**
 * MTM — «Panel» (/mtm), kömək məqaləsi (Azərbaycan dili).
 * Yalnız ekranda olanı təsvir edir: komandanın ana ekranı
 * (`home-dashboard.tsx` və onun kartları) və bir işçinin həftəsi
 * (`operational-week-home.tsx`). Yazılar `messages/az.json` faylından
 * götürülüb (`mtmDashboardPage`, `.home`, `.operationalWeek`): orada yazı
 * dəyişirsə, burada da düzəldin, yoxsa `help-mtm-overview-labels.test.ts`
 * qırmızı olacaq. Növbə və iş vaxtı bura daxil deyil (Workforce).
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
        goal="Bir dəqiqəyə komandanın gününün və həftəsinin necə getdiyini və nəyin qərarınızı gözlədiyini anlamaq"
      >
        Bu, <HelpKey>Marşrut &amp; Sahə</HelpKey> modulunun ilk ekranıdır, menyuda —{" "}
        <HelpKey>Panel</HelpKey>. Siz yalnız öz əhatənizdəki işçiləri görürsünüz. Öz hesabı ilə
        daxil olan agent yalnız öz həftəsini görür.
      </HelpScenario>

      <HelpSection title="Günün dörd rəqəmi">
        <p>Başlıqda tarix, «İş günü» və ya «İstirahət günü» və rəqəmlərin hansı vaxta aid olduğu yazılır.</p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Sahədə indi">Neçə sahə işçisi müştərinin yanındadır və ya nöqtələr arasında yoldadır; «2 vizitdə» müştərinin yanında olanlardır. Vizitsiz gündə burada «Son vizit — …» yazılır.</HelpDef>
          <HelpDef term="Bugünkü plan">Bu günə planlaşdırılmış nöqtələrdən neçəsinə baş çəkilib. Bu günə plan yoxdursa, burada «Sabah üçün plan» olur: neçə işçinin artıq marşrutu var.</HelpDef>
          <HelpDef term="Bu həftə plan üzrə">Eyni rəqəm bazar ertəsindən bu günədək və müqayisə: «keçən həftənin bu günü 62% idi · ↑ 5 bənd».</HelpDef>
          <HelpDef term="Qərar gözləyir">Sizi neçə məsələ gözləyir. Heç biri olmadıqda — «hər şey həll olunub».</HelpDef>
        </dl>
        <p>
          Sayda sahə işçiləri var. Administratorun və ya rəhbərin kartı yalnız marşrutu, viziti və ya
          xəbərdarlığı olan gün sayılır.
        </p>
      </HelpSection>

      <HelpSection title="Qərar gözləyir">
        <p>
          Nəyinsə gözlədiyi hər siyahı üçün bir sətir: yeni müştəri və müəssisə sorğuları, marşrut
          dəyişikliyi sorğuları, dərc olunmamış marşrutlar, əvvəlki günlərin həll olunmamış
          xəbərdarlıqları, yoxlanılmamış fotolar və növbəti iş gününə marşrutu olmayan işçilər.
          Sətirdə kimin olduğu və hansı gündən gözlədiyi yazılır. Sətrin düyməsi —{" "}
          <HelpKey>Sorğuya bax</HelpKey>, <HelpKey>Dərc et</HelpKey>, <HelpKey>Həll et</HelpKey>,{" "}
          <HelpKey>Yoxla</HelpKey> və ya <HelpKey>Planlaşdır</HelpKey> — həmin siyahını açır.
        </p>
      </HelpSection>

      <HelpSection title="Komanda · bu həftə">
        <p>
          Hər sahə işçisinə bir sətir. Adın altında onun indi harada olduğu yazılır: «vizitdə»,
          «yolda», «plan bitib», «başlamayıb» və ya «aktivlik yoxdur», yanında müştəri və vaxt,
          yaxud «son GPS 10:52». Son GPS işçinin nə vaxt göründüyünü bildirir, indi harada
          olduğunu yox.
        </p>
        <p>
          Sağda günlər üzrə həftə var: xanada baş çəkilmiş nöqtələr və planda neçə nöqtə olduğu
          yazılır; rənglərin mənası siyahının altındadır. Aşağıda «Həftə: 42 vizit» və{" "}
          <HelpKey>Nəticələri aç</HelpKey> keçidi var.
        </p>
      </HelpSection>

      <HelpSection title="Baza və vizitlərin keyfiyyəti">
        <dl className="rounded-md border p-3">
          <HelpDef term="Müştəri bazası">Bu ay bazadakı müştərilərin və ya müəssisələrin neçəsinə baş çəkilib — siniflər üzrə, siniflər verilməyibsə, ixtisas və ya növ üzrə.</HelpDef>
          <HelpDef term="Keyfiyyət">Həftənin neçə viziti «Müştərinin yanında qeyd olunub», neçəsi «Foto ilə», neçəsi «Çox uzun vizit» və ya «Çox qısa vizit».</HelpDef>
        </dl>
        <p>
          Administrator əlavə zolaq da görür: «Rəqəmlər tam olsun deyə 2 addım qalıb:» — modulda
          nəyin qurulmadığı. Hər şey qurulanda zolaq yox olur.
        </p>
      </HelpSection>

      <HelpSection title="Bir işçinin həftəsi">
        <HelpStep n={1}>
          <p>
            İşçinin adına və ya həftəsinin xanasına klikləyin, yaxud onu başlıqdakı{" "}
            <HelpKey>İşçi</HelpKey> filtrində seçin. <HelpKey>Region</HelpKey> və{" "}
            <HelpKey>Komanda</HelpKey> filtrləri ekranı daraldır; seçiləcək heç nə yoxdursa, onlar
            göstərilmir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Əməliyyat həftəsi</HelpKey>: «Plan», «Fakt», «Ləğv» və marşrut nöqtələri olan
            günlər, «Planın icrası» və «Diqqət tələb edir» bloku — xəbərdarlıqlar, «Təsdiq gözləyən
            ləğvlər», «Aktiv tapşırıqlar». Komandaya qayıtmaq üçün <HelpKey>İşçi</HelpKey> filtrini
            xaç işarəsi ilə sıfırlayın.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Nöqtənin ləğvini agent öz həftəsində istəyir — <HelpKey>Ləğv sorğusu göndər</HelpKey>.
            Təsdiq hüququ olan rəhbər onu elə burada həll edir: <HelpKey>Təsdiqlə</HelpKey>,{" "}
            <HelpKey>Köçür</HelpKey>, <HelpKey>Geri qaytar</HelpKey> və ya <HelpKey>Rədd et</HelpKey>.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip" label="Məsləhət">
        <p>
          Vərəq qarşınızda açıq olduqca ekran dəqiqədə bir dəfə özü yenilənir; dairəvi oxlu düymə
          dərhal yeniləyir. Panelin altında sizin üçün «Əsas mesaj» və əlaqə məlumatı ilə «Dəstək»
          ola bilər.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning" label="Vacib">
        <p>
          Sıfır və boş kart yalnız uğurlu yükləmədən sonra heç nə olmadığını bildirir. Məlumat
          gəlməyibsə, kart bunu sözlə deyir və <HelpKey>Yenidən yoxla</HelpKey> təklif edir.
        </p>
      </HelpCallout>
    </div>
  )
}
