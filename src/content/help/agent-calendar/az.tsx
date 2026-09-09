"use client"

/**
 * Agent Calendar — help article (Azerbaijani).
 * Video-skript formatı: yalnız-oxumaq üçün həftəlik təqvim — Tiketlər + Tapşırıqlar +
 * Tədbirlər + Fəaliyyətlər /api/v1/calendar/agent-dən birləşdirilir. Burada heç nə
 * yaradılmır/redaktə edilmir — bu, planlama mənzərəsidir; elementə klikləmək sizi
 * mənbə səhifəsinə aparır.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function AgentCalendarHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dəstək agenti və ya menecersiniz"
        goal="Bu həftə sizdən nə tələb olunduğunu — tiketlər, tapşırıqlar, tədbirlər və fəaliyyətlər — bir həftəlik lövhədə görmək və lazım olan elementə birbaşa keçmək"
      >
        Səhifə dörd ayrı yeri — <HelpKey>Tiketlər</HelpKey>, <HelpKey>Tapşırıqlar</HelpKey>,{" "}
        <HelpKey>Tədbirlər</HelpKey> və <HelpKey>Fəaliyyətlər</HelpKey> (zənglər, e-poçtlar, görüşlər,
        qeydlər, tapşırıq-fəaliyyətlər) — vahid həftəlik mənzərəyə yığır. Bütün məlumat yalnız sizin
        təşkilatınızdandır və <strong>yalnız-oxunaqlıdır</strong>: burada heç nə yaratmırsınız, bu, hər
        şeyi bir yerdə göstərən planlama görünüşüdür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarı solda təqvim ikonu və <HelpKey>Agent Təqvimi</HelpKey> başlığı, onun altında isə cari
          həftənin tarix aralığı (məs. «16 iyn — 22 iyn 2026») yazılır. Sağ yuxarıda üç naviqasiya
          düyməsi durur: <HelpKey>‹</HelpKey> (əvvəlki həftə), <HelpKey>Bu gün</HelpKey> və{" "}
          <HelpKey>›</HelpKey> (növbəti həftə). Başlığın altında dörd rəngli statistika kartı gəlir:{" "}
          <strong>Tiketlər</strong>, <strong>Tapşırıqlar</strong>, <strong>Tədbirlər</strong> və{" "}
          <strong>Fəaliyyətlər</strong> — hər biri bu həftə üçün sayı göstərir.
        </p>
        <p>
          Mərkəzdə həftəlik şəbəkə var: solda saat sütunu (<strong>7:00-dan 19:00-a qədər</strong>),
          yuxarıda yeddi gün başlığı (B.e.–B.). Bu gün vurğulanır — rəqəm dairə içində göstərilir. Gün
          başlığının altındakı kiçik rəngli nöqtələr o gün hansı növ işlərin olduğunu bildirir (qırmızı =
          tiket, narıncı = tapşırıq, indiqo = tədbir, yaşıl = fəaliyyət). Bütün gün davam edən elementlər
          varsa, gün başlıqları ilə saat sətirləri arasında ayrıca <HelpKey>BÜTÜN GÜN</HelpKey> sətri çıxır.
        </p>
        <p>
          Aşağıda yan-yana iki kart durur: solda <HelpKey>İzah</HelpKey> (rənglərin hansı növə aid
          olduğunu və saylarını göstərir), sağda isə <HelpKey>Bu gün</HelpKey> — bugünkü cədvəli vaxt
          sırası ilə sadalayır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Tiketlər / Tapşırıqlar / Tədbirlər / Fəaliyyətlər">Yuxarıdakı dörd kart — cari həftədə hər növün sayı (məzmun /api/v1/calendar/agent-dən gəlir).</HelpDef>
          <HelpDef term="Saat sütunu">Sol kənardakı 7:00–19:00 vaxt slotları; vaxtlı elementlər başladıqları saata yerləşir.</HelpDef>
          <HelpDef term="BÜTÜN GÜN sətri">Konkret saatı olmayan elementlər (məs. açıq tiketlər və tapşırıqlar) — yalnız belə element varsa görünür.</HelpDef>
          <HelpDef term="Cari vaxt xətti">Bu günün sütununda indiki anı göstərən nazik xətt (kiçik nöqtə ilə).</HelpDef>
          <HelpDef term="Prioritet nöqtəsi">Element kartındakı rəngli nöqtə: qırmızı=təcili, narıncı=yüksək, sarı=orta, yaşıl=aşağı.</HelpDef>
          <HelpDef term="İzah">Aşağı sol kart — hansı rəngin hansı növ olduğunu və bu həftə üzrə sayını göstərir.</HelpDef>
          <HelpDef term="Bu gün (cədvəl)">Aşağı sağ kart — bugünkü elementlər: əvvəl bütün gün açıq tiketlər/tapşırıqlar, sonra vaxt sırası ilə planlaşdırılmışlar.</HelpDef>
        </dl>
        <p>
          Hər element kartında rəngli sol haşiyə, növ ikonu və başlıq olur; prioriteti varsa, altında rəngli
          nöqtə və prioritet adı görünür. Üzərinə kursoru gətirdikdə kart bir az qalxır və varsa{" "}
          <strong>məkan</strong> (xəritə ikonu ilə) və <strong>status</strong> nişanı əlavə görünür.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: həftələr arasında naviqasiya">
        <HelpStep n={1}>
          <p>
            Növbəti həftəyə keçmək üçün sağ yuxarıdakı <HelpKey>›</HelpKey> oxunu, əvvəlki həftəyə qayıtmaq
            üçün <HelpKey>‹</HelpKey> oxunu basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Başlıq altındakı tarix aralığı yeddi gün irəli/geri sürüşür, şəbəkə yenidən yüklənir və yuxarıdakı
            dörd statistika kartı həmin həftənin saylarına yenilənir. Yüklənmə zamanı şəbəkə yerinə fırlanan
            işarə və «Təqvim yüklənir...» mətni çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstənilən vaxt cari həftəyə qayıtmaq üçün ortadakı <HelpKey>Bu gün</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Təqvim bu günü əhatə edən həftəyə qayıdır; bugünkü gün sütunu vurğulanır (rəqəm dairə içində),
            cari saat slotunda isə nazik <strong>cari vaxt xətti</strong> görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: bir elementi oxu və ona keç">
        <HelpStep n={1}>
          <p>
            Şəbəkədə bir elementə baxın — rəngli sol haşiyəsi və ikonu növü bildirir (məs. qırmızı = tiket,
            indiqo = tədbir). Daha çox detal üçün kursoru elementin üzərinə gətirin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart bir az böyüyüb kölgələnir. Varsa, məkan (xəritə ikonu ilə) və status nişanı («Açıq», «İcrada»,
            «Həll edildi» və s.) görünür. Prioritet nöqtəsi və adı (təcili/yüksək/orta/aşağı) isə həmişə görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Elementin tam mənbəsinə keçmək üçün onun üzərinə klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sizi həmin elementin öz səhifəsinə aparır (məs. tiketin detalı). <strong>BÜTÜN GÜN</strong>{" "}
            sətrindəki tiket/tapşırıq yığını isə müvafiq olaraq <HelpKey>Tiketlər</HelpKey> və ya{" "}
            <HelpKey>Tapşırıqlar</HelpKey> siyahısını açır. Mənbə URL-i olmayan element klikləməyə cavab vermir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: İzah və Bu gün kartlarını oxu">
        <HelpStep n={1}>
          <p>
            Aşağı soldakı <HelpKey>İzah</HelpKey> kartına baxın — hansı rəngin hansı işə aid olduğunu öyrənmək
            üçün.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə kiçik rəngli ikon, növün adı (Tiket, Tapşırıq, Tədbir, Zəng, E-poçt, Görüş, Qeyd,
            Tapşırıq Fəaliyyəti) və bu həftə üzrə sayı durur. Tiket, Tapşırıq, Tədbir və Zəng həmişə göstərilir;
            digər növlər yalnız bu həftə mövcuddursa siyahıya düşür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Aşağı sağdakı <HelpKey>Bu gün</HelpKey> kartına baxın — bugünkü işlərin vaxt sıralı siyahısı üçün.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Əvvəl <HelpKey>BÜTÜN GÜN</HelpKey> bölməsi — açıq tiketlər (prioritet bölgüsü ilə: kritik/yüksək/
            orta/aşağı) və açıq tapşırıqlar; sonra <HelpKey>Planlaşdırılmış</HelpKey> bölməsi — vaxt sırası ilə
            elementlər (saat · növ). Bu gün heç nə yoxdursa, təqvim ikonu və «Bu gün üçün element yoxdur» mətni
            görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Şəbəkə yalnız <strong>7:00–19:00</strong> aralığını göstərir və üfüqi sürüşmə tələb edə bilər — dar
          ekranlarda bütün yeddi günü görmək üçün şəbəkəni sağa-sola sürüşdürün. Gün başlığının altındakı rəngli
          nöqtələr o günü açmadan hansı növ işlərin olduğunu tez bildirir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu səhifə <strong>yalnız-oxunaqlıdır</strong>: burada tiket, tapşırıq, tədbir və ya fəaliyyət
          yaratmaq/redaktə etmək olmaz. Hər hansı dəyişiklik üçün elementə klikləyib öz mənbə səhifəsində işləyin
          — təqvim növbəti yüklənmədə yenilənmiş vəziyyəti əks etdirəcək.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün təqvim məlumatı təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın tiketlərini, tapşırıqlarını,
          tədbirlərini və fəaliyyətlərini görürsünüz. Məlumat <HelpKey>/api/v1/calendar/agent</HelpKey>{" "}
          son-nöqtəsindən təşkilat ID-niz ilə oxunur.
        </p>
      </HelpCallout>
    </div>
  )
}
