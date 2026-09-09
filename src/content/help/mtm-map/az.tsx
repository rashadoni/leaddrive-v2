"use client"

/** MTM Canlı Xəritə — komanda monitorinqi səhifəsi üçün qısa bələdçi. */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MtmmapHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sahə əməliyyatları meneceri və ya rəhbərsiniz"
        goal="Komandanın indi harada olduğunu anlamaq və lazım gəldikdə GPS tarixçəsinə ayrıca baxmaq"
      >
        <HelpKey>MTM</HelpKey> → <HelpKey>Canlı xəritə</HelpKey> bölməsini açın. Bu, yalnız izləmə
        səhifəsidir: təşkilatınız üçün serverin qəbul etdiyi koordinatları və marşrut məlumatını göstərir.
      </HelpScenario>

      <HelpSection title="Səhifəni bir baxışda anlayın">
        <p>
          Başlıqda iki aydın rejim — <HelpKey>İndi</HelpKey> və <HelpKey>Tarixçə</HelpKey> — həmçinin
          son yenilənmə vaxtı və <HelpKey>Yenilə</HelpKey> düyməsi var. Aşağıdakı qısa xülasə
          komandanın cari GPS vəziyyətlərini göstərir. Əsas iş sahəsi əməkdaş siyahısı və xəritədir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Aktual">Yalnız serverin qəbul etdiyi yeni koordinat. Cari yer kimi göstərilir.</HelpDef>
          <HelpDef term="Son məlum">Real yaşı göstərilən gecikmiş koordinat. Heç vaxt aktual kimi təqdim edilmir.</HelpDef>
          <HelpDef term="GPS yoxdur">Əməkdaş siyahıda qalır, amma xəritə üçün qəbul edilən koordinat yoxdur.</HelpDef>
          <HelpDef term="Tarixçə">Açıq şəkildə tələb etdiyiniz, seçilmiş tarixə aid GPS izi.</HelpDef>
          <HelpDef term="ETA">Seçilmiş əməkdaşın növbəti plan dayanacağına təxmini çatma vaxtı.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: «İndi» rejimi">
        <HelpStep n={1}>
          <p>
            <HelpKey>İndi</HelpKey> rejimini saxlayın və status filtri və ya axtarışla əməkdaşı tapın.
            Serverdən ən yeni nəticəni dərhal almaq üçün <HelpKey>Yenilə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Xülasə, yığcam əməkdaş siyahısı və xəritə birlikdə yenilənir. Hər sətirdə koordinatın aktual,
            son məlum və ya mövcud olmadığı aydın yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Siyahıdan bir əməkdaş seçin.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Xəritə əməkdaşın qəbul edilən cari koordinatına fokuslanır. Məlumat varsa, bu günün plan
            marşrutu, nömrələnmiş dayanacaqlar və ETA göstərilir. Əməkdaş seçimi onun tam hərəkət
            tarixçəsini yükləmir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: GPS izinə baxın">
        <HelpStep n={1}>
          <p><HelpKey>İndi</HelpKey> rejimindən <HelpKey>Tarixçə</HelpKey> rejiminə keçin.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tarixçə seçimləri canlı monitorinqdən ayrıca açılır. Əməkdaşı və tarixi seçin, sonra izi
            açıq şəkildə tələb edin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Qeydə alınmış nöqtələrə və təkrara baxmaq üçün nəticəni açın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tam günlük iz yalnız Tarixçə rejimindədir. <HelpKey>İndi</HelpKey> rejiminə qayıdanda köhnə
            iz daşınmadan komandanın cari görünüşü bərpa olunur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Əlavə alətlər">
        <p>
          <HelpKey>Əlavə alətlər</HelpKey> bloku xəritəni sadə saxlamaq üçün ilkin olaraq bağlıdır.
          Yalnız <HelpKey>Geozona</HelpKey>, <HelpKey>İstilik xəritəsi</HelpKey> və ya son hadisələr
          lazım olduqda açın. Bloku bağlamaq koordinatları və cari seçimi dəyişmir.
        </p>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          Xəritə fonunun xətası GPS xətası deyil. CARTO/OSM təbəqələri yüklənmədikdə səhifə{" "}
          <strong>xəritə fonunun</strong> açılmadığını bildirir və təkrar düyməsi göstərir. Əməkdaşın
          adı, GPS vəziyyəti, koordinatın yaşı və seçim siyahıda işləməyə davam edir. Əksinə,{" "}
          <strong>GPS yoxdur</strong> yazısı fon görünsə belə həmin əməkdaş üçün qəbul edilən koordinatın
          olmadığını bildirir.
        </p>
      </HelpCallout>

      <HelpCallout kind="tip">
        <p>
          Yalnız nişana deyil, vaxta və GPS yazısına baxın. Köhnə koordinat «son məlum» olaraq qalır və
          əməkdaş onlayn olsa da aktual sayılmır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Koordinatlar, statuslar, marşrutlar və hadisələr təşkilatınızla məhdudlaşır. Bu səhifədən
          əməkdaşın yerini və ya marşrutunu dəyişmək mümkün deyil.
        </p>
      </HelpCallout>
    </div>
  )
}
