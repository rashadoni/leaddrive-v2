"use client"

/**
 * Agent Calendar — help article (Azerbaijani).
 * Video-skript formatı: yalnız-oxumaq üçün həftəlik təqvim — Tiketlər + Tapşırıqlar +
 * Tədbirlər + Fəaliyyətlər /api/v1/calendar/agent-dən birləşdirilir. Burada heç nə
 * yaradılmır/redaktə edilmir — bu, planlama mənzərəsidir; elementə klikləmək
 * məlumat panelini açır; oradan mövcud mənbə səhifəsinə keçmək olar.
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
        goal="Həftənin tiketlərini, tapşırıqlarını, tədbirlərini və fəaliyyətlərini bir təqvimdə nəzərdən keçirmək, elementin məlumatını açmaq və mövcud mənbəsinə keçmək"
      >
        Səhifə dörd ayrı yeri — <HelpKey>Tiketlər</HelpKey>, <HelpKey>Tapşırıqlar</HelpKey>,{" "}
        <HelpKey>Tədbirlər</HelpKey> və <HelpKey>Fəaliyyətlər</HelpKey> (zənglər, e-poçtlar, görüşlər,
        qeydlər, tapşırıq-fəaliyyətlər) — vahid həftəlik mənzərəyə yığır. Bütün məlumat yalnız sizin
        təşkilatınızdandır və <strong>yalnız-oxunaqlıdır</strong>: burada heç nə yaratmırsınız, bu,
        təqvim elementlərini bir yerdə göstərən planlama görünüşüdür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarı solda təqvim ikonu və <HelpKey>Agent Təqvimi</HelpKey> başlığı, onun altında isə cari
          həftənin tarix aralığı (məs. «15 iyn — 21 iyn 2026») yazılır. Sağ yuxarıda <HelpKey>‹</HelpKey>{" "}
          (əvvəlki həftə) və <HelpKey>›</HelpKey> (növbəti həftə) oxları, aralarında isə <HelpKey>Bu gün</HelpKey> var.
          Kiçik ekranda «Bu gün» düyməsi başlığın altında yerləşir. Kompakt yekun sətri həftə üzrə{" "}
          <strong>Tiketlər</strong>, <strong>Tapşırıqlar</strong>, <strong>Tədbirlər</strong> və{" "}
          <strong>Fəaliyyətlər</strong> sayını göstərir.
        </p>
        <p>
          Geniş ekranda kompakt həftə görünüşündə yeddi gün sütunu var (B.e.–B.). Hər başlıqda tarix və
          element sayı göstərilir; bu günün başlığı vurğulanır. Hər sütunda əvvəlcə altıya qədər element görünür.
          Daha dar ekranda yeddi tarix arasından gün seçin: onun altında həmin günün cədvəli, əvvəlcə
          20-yə qədər element açılır. Əvvəl bütün gün elementləri, sonra vaxt ardıcıllığı ilə digər elementlər gəlir.
        </p>
        <p>
          Göstərilən həftədə vaxtı qeyd edilmiş gələcək element varsa, təqvimin üstündə{" "}
          <HelpKey>Növbəti planlaşdırılmış iş</HelpKey> görünür. Bəzi mənbələr yüklənməsə, bildiriş onların
          adını göstərir və <HelpKey>Yenidən cəhd et</HelpKey> düyməsini təklif edir; mövcud məlumat görünür.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Həftə yekunu">Dörd təqvim mənbəsinin sayını göstərən kompakt sətir.</HelpDef>
          <HelpDef term="Gün seçimi">Daha dar ekranda cədvəlini oxumaq istədiyiniz tarixi seçin.</HelpDef>
          <HelpDef term="BÜTÜN GÜN">Konkret vaxtı olmayan elementin etiketi; element öz gününün siyahısında qalır.</HelpDef>
          <HelpDef term="07:00–19:00 xaricində">Standart iş saatlarından kənarda vaxtı qeyd edilmiş element. O, görünən qalır.</HelpDef>
          <HelpDef term="Prioritet">Elementin prioriteti olduqda göstərilən çərçivəli etiket.</HelpDef>
          <HelpDef term="Daha … göstər">Gün sütununun qalan elementlərini və ya seçilmiş günün cədvəlində növbəti hissəni açır.</HelpDef>
          <HelpDef term="Qeydi aç">Mənbə keçidi olduqda elementin məlumat panelində göstərilən düymə.</HelpDef>
        </dl>
        <p>
          Hər elementdə ikon, başlıq, vaxt və ya <HelpKey>BÜTÜN GÜN</HelpKey> etiketi və növ adı görünür.
          Prioritet və iş saatlarından kənar etiketi uyğun olduqda göstərilir. Məlumatını oxumaq üçün elementə klikləyin.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: həftələr arasında naviqasiya">
        <HelpStep n={1}>
          <p>
            Növbəti həftəyə keçmək üçün sağ yuxarıdakı <HelpKey>›</HelpKey> oxunu, əvvəlki həftəyə qayıtmaq
            üçün <HelpKey>‹</HelpKey> oxunu basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tarix aralığı yeddi gün irəli və ya geri dəyişir, təqvim və yekun sayları yenidən yüklənir.
            Yüklənmə zamanı yer tutan sətirlər göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Cari həftəyə qayıtmaq üçün <HelpKey>Bu gün</HelpKey> düyməsini basın. Kiçik ekranda düymə
            başlığın altında yerləşir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Təqvim bu günü əhatə edən həftəyə qayıdır. Geniş görünüşdə bugünkü başlıq vurğulanır;
            daha dar görünüşdə bu gün seçilir və onun cədvəli göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: bir elementi oxu və ona keç">
        <HelpStep n={1}>
          <p>
            Elementin başlığını, vaxtını və növünü oxuyun, sonra məlumatını açmaq üçün ona klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sağda məlumat paneli açılır; telefonda bütün ekranı tutur. Tarix və vaxt, mövcud olduqda isə
            status, prioritet, məkan və onlayn format göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Mənbə səhifəsinə keçmək üçün məlumat panelində <HelpKey>Qeydi aç</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Əlaqəli qeyd və ya siyahı, məsələn tiket məlumatı və ya tapşırıqlar siyahısı açılır.
            Mənbə keçidi yoxdursa, panel yenə məlumatı göstərir, lakin «Qeydi aç» düyməsi olmur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: günün işlərini oxu">
        <HelpStep n={1}>
          <p>
            Geniş ekranda lazım olan günün sütununu oxuyun. Daha dar ekranda cədvəlin üstündə həmin tarixi seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Əvvəl bütün gün elementləri, sonra vaxt ardıcıllığı ilə digər elementlər gəlir. Boş gün üçün{" "}
            <HelpKey>Planlaşdırılmış iş yoxdur</HelpKey> görünür. Daha çox element varsa, <HelpKey>Daha … göstər</HelpKey>{" "}
            düyməsini basın. Geniş sütunu <HelpKey>Daha az göstər</HelpKey> ilə yenidən yığmaq olar.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Təqvimin üstündə <HelpKey>Növbəti planlaşdırılmış iş</HelpKey> varsa, göstərilən həftədə vaxtı
            qeyd edilmiş ən yaxın gələcək elementə baxmaq üçün onu basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Eyni məlumat paneli açılır. Göstərilən həftədə vaxtı qeyd edilmiş gələcək element yoxdursa,
            bu düymə göstərilmir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Saat 07:00-dan əvvəl və ya 19:00-dan etibarən olan işlər görünür və{" "}
          <HelpKey>07:00–19:00 xaricində</HelpKey> ilə işarələnir. Daha dar ekranda saat şəbəkəsini sürüşdürmək
          əvəzinə gün seçimi ilə tarixləri dəyişin.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu səhifə <strong>yalnız-oxunaqlıdır</strong>: burada tiket, tapşırıq, tədbir və ya fəaliyyət
          yaratmaq/redaktə etmək olmaz. Dəyişiklik üçün məlumat panelini açın, mövcud olduqda «Qeydi aç» düyməsini
          basın və mənbə səhifəsində işləyin — təqvim növbəti yüklənmədə yenilənmiş vəziyyəti əks etdirəcək.
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
