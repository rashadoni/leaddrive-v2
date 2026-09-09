"use client"

/**
 * Health detail (Xəstə Kartı) — help article (Azerbaijani).
 * Gold-standard struktur: territories/az.tsx.
 * Mənbə səhifə: src/app/(dashboard)/health/[id]/page.tsx —
 * tək pasiyentin yalnız-oxunan kartı: başlıq kartı + dörd tab
 * (Ümumi Baxış / Ziyarətlər / Müalicə Planları / Tibbi Qeydlər).
 * Yaratma / redaktə / status dəyişmə düymələri BU səhifədə YOXDUR.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function HealthDetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Klinik heyət üzvü, qəbul administratoru və ya həkimsiniz"
        goal="Bir pasiyentin tam klinik mənzərəsini — şəxsi məlumat, ziyarətlər, müalicə planları və tibbi qeydlər — bir yerdə oxumaq"
      >
        Bu səhifəyə <HelpKey>Sağlamlıq Buludu</HelpKey> → <HelpKey>Xəstələr</HelpKey> siyahısından
        bir pasiyentə klik etməklə düşürsünüz. Bu, <strong>yalnız-oxunan kartdır</strong>:
        baxır, tablar arasında keçir və qeydləri vərəqləyirsiniz — burada yaratma, redaktə və
        ya status dəyişdirmə düyməsi yoxdur. Bütün məlumat sizin təşkilatınızla məhdudlaşır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda <HelpKey>Xəstələrə Qayıt</HelpKey> düyməsi var. Onun altında qırmızı ürək
          ikonalı <strong>başlıq kartı</strong> durur: pasiyentin <strong>tam adı</strong>,
          yanında rəngli status nişanı (<strong>active</strong> / <strong>inactive</strong> /{" "}
          <strong>deceased</strong>) və bir sıra qısa sahə — <strong>tibb nömrəsi (MRN)</strong>{" "}
          (monoaralıqlı şriftlə), varsa doğum tarixi, e-poçt və telefon. Bu sahələrdən hansılar
          doludursa, yalnız onlar göstərilir.
        </p>
        <p>
          Başlıq kartının altında dörd <strong>tab</strong> sırası gəlir:{" "}
          <HelpKey>Ümumi Baxış</HelpKey>, <HelpKey>Ziyarətlər</HelpKey>,{" "}
          <HelpKey>Müalicə Planları</HelpKey> və <HelpKey>Tibbi Qeydlər</HelpKey>. Hansı tab
          seçilibsə, onun adı və alt xətti qırmızı olur. <strong>Ümumi Baxış</strong> səhifə
          açılanda dərhal gəlir; qalan üç tabın məlumatı isə yalnız siz həmin taba klik
          edəndə yüklənir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="MRN (TN)">
            Tibb nömrəsi — pasiyentin təşkilat daxilindəki unikal identifikatoru; başlıqda və
            Ümumi Baxış kartında monoaralıqlı şriftlə göstərilir.
          </HelpDef>
          <HelpDef term="Status">
            Pasiyentin vəziyyəti: <strong>active</strong> (yaşıl), <strong>inactive</strong> (boz)
            və ya <strong>deceased</strong> (qırmızı).
          </HelpDef>
          <HelpDef term="Ziyarət (Encounter)">
            Pasiyentin ayrıca klinik təmasları — növü, statusu və vaxt nişanları ilə.
          </HelpDef>
          <HelpDef term="Müalicə Planı (Care Plan)">
            Adlandırılmış uzunmüddətli proqram — statusu, başlama/bitmə tarixi və məqsədləri ilə.
          </HelpDef>
          <HelpDef term="Tibbi Qeyd (Medical Record)">
            Klinik sənəd — növü, tarixi və qısa xülasəsi ilə.
          </HelpDef>
        </dl>
        <p>
          Qeyd: başlıqdakı status nişanı və Ümumi Baxış kartlarındakı bəzi etiketlər
          (<HelpKey>Demographics</HelpKey>, <HelpKey>Clinical Summary</HelpKey>, <HelpKey>MRN</HelpKey>,{" "}
          <HelpKey>Status</HelpKey>, <HelpKey>Registered</HelpKey> və s.) interfeys dili nə olsa da
          ingiliscə göstərilir — bunlar sistemin standart dəyərləridir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: pasiyentin ümumi mənzərəsinə bax">
        <HelpStep n={1}>
          <p>
            Səhifə açılanda <HelpKey>Ümumi Baxış</HelpKey> tabı artıq seçilidir — əlavə klik
            lazım deyil.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yan-yana iki kart: solda <strong>Demographics</strong> (MRN, Status, varsa doğum
            tarixi, e-poçt, telefon və qeydiyyat tarixi sətirləri), sağda{" "}
            <strong>Clinical Summary</strong> (varsa aparıcı həkimin ID-si və qeydin yaradılma
            vaxtı).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Clinical Summary</strong> kartının altındakı iki sürətli keçid düyməsindən
            birini — <HelpKey>Ziyarətlər</HelpKey> və ya <HelpKey>Müalicə Planları</HelpKey> —
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Səhifə dərhal müvafiq taba keçir (eyni nəticəni yuxarıdakı tab sırasından da almaq
            olar) və həmin tabın məlumatı yüklənməyə başlayır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: ziyarətlərə bax">
        <HelpStep n={1}>
          <p>
            Tab sırasından <HelpKey>Ziyarətlər</HelpKey> tabını seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qısa bir <strong>yüklənmə dövrəsi</strong> (fırlanan ikon) görünür, sonra bu
            pasiyentin ziyarətləri kart-kart sadalanır. Heç ziyarət yoxdursa, ortada
            «Ziyarət qeyd edilməyib» mətni çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstədiyiniz ziyarət kartını gözdən keçirin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kartda sol tərəfdə <strong>ziyarət növü</strong> (məs. «in person», «telehealth»),
            sağda rəngli <strong>status nişanı</strong> (scheduled / checked in / in progress /
            completed / cancelled / no show), altında isə dolu olan vaxt nişanları: planlaşdırılma,
            qeydiyyat, tamamlanma və ya ləğv vaxtı.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: müalicə planlarına və tibbi qeydlərə bax">
        <HelpStep n={1}>
          <p>
            <HelpKey>Müalicə Planları</HelpKey> tabını seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Plan kartları yüklənir: hər birində <strong>plan adı</strong>, rəngli{" "}
            <strong>status nişanı</strong> (draft / active / paused / completed / cancelled), varsa
            başlama və bitmə tarixi və məqsəd sayı («N goal(s)»). Plan yoxdursa «Müalicə planı
            yoxdur» göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Tibbi Qeydlər</HelpKey> tabını seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qeyd kartları yüklənir: hər birində sənəd ikonası, <strong>qeyd növü</strong>, varsa
            tarixi və (varsa) üç sətirə qədər kəsilmiş <strong>xülasə</strong>. Qeyd yoxdursa
            «Tibbi qeyd yoxdur» göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pasiyentlər siyahısına qayıtmaq üçün yuxarıdakı <HelpKey>Xəstələrə Qayıt</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Xəstə Kartı bağlanır və <HelpKey>Xəstələr</HelpKey> siyahısına qayıdırsınız.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Tablar arasında sərbəst keçə bilərsiniz — hər tab ilk açılanda öz məlumatını ayrıca
          yükləyir, ona görə bir tab dolu yüklənərkən digərinin gözləməsinə ehtiyac yoxdur.
          Bir tab boş görünürsə (məs. «Ziyarət qeyd edilməyib»), bu o pasiyent üçün hələ heç
          bir qeydin olmaması deməkdir — səhv deyil.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu səhifə <strong>yalnız oxumaq üçündür</strong>: yeni ziyarət, plan və ya qeyd əlavə
          etmək, statusu dəyişmək və ya sahələri redaktə etmək imkanı buradan verilmir. Belə
          dəyişikliklər müvafiq klinik axınlar və ya Health API vasitəsilə aparılır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün məlumat təşkilatınızla məhdudlaşır və <em>health</em> icazəsi ilə qorunur — yalnız
          öz tenant-ınızın pasiyentini, ziyarətlərini, planlarını və qeydlərini görürsünüz. Pasiyent
          məlumatı həssasdır: tablardakı qeydlər müvafiq Health API endpoint-lərindən gəlir, həssas
          mətn şifrəli saxlanılır və girişlər audit jurnalına yazılır.
        </p>
      </HelpCallout>
    </div>
  )
}
