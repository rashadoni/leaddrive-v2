"use client"

/**
 * MTM Activity Journal — help article (Azerbaijani).
 * Yalnız /mtm/activity (Aktivlik jurnalı) səhifəsini əhatə edir: dörd KPI
 * kartı, aktivlik növü filtri (açılan siyahı) və dörd sütunlu jurnal cədvəli
 * (Vaxt / Agent / Əməliyyat / Təfərrüatlar). Bu səhifə YALNIZ OXUMAQ üçündür —
 * burada heç nə yaradılmır və redaktə edilmir, yalnız sahə hadisələri göstərilir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MtmactivityHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Saha rəhbəri və ya əməliyyat administratorusunuz"
        goal="Komandanın sahədə nə etdiyini izləmək — check-in/check-out, foto yükləmələri və digər hadisələri bir jurnalda görmək və lazım olan növə görə süzgəcdən keçirmək"
      >
        Səhifəyə <HelpKey>Marşrutlar və saha</HelpKey> → <HelpKey>Aktivlik jurnalı</HelpKey>{" "}
        (<HelpKey>/mtm/activity</HelpKey>) yolu ilə çatırsınız. Bu səhifə{" "}
        <strong>yalnız oxumaq üçün monitorinq ekranıdır</strong> — sahə hadisələrini göstərir, onları
        yaratmır və redaktə etmir. Hadisələrin özü mobil tətbiqdə və modulun başqa yerlərində baş
        verir; bura yalnız yığılıb göstərilir. Bütün məlumatlar yalnız sizin təşkilatınıza aiddir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Aktivlik jurnalı</HelpKey> adı və «Check-in/check-out və sahə aktivlik
          jurnalı» izahı var; sağ yuxarıda isə <HelpKey>İxrac</HelpKey> düyməsi durur. Altında dörd
          KPI kartı gəlir: <strong>Ümumi aktivlik</strong>, <strong>Check-in</strong>,{" "}
          <strong>Check-out</strong> və <strong>Foto yükləmə</strong>. Onların altında{" "}
          <strong>Aktivlik növü</strong> başlıqlı süzgəc kartı (açılan siyahı ilə), ən altda isə ya
          jurnal cədvəli, ya da heç nə yoxdursa boş vəziyyət mətni olur.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi aktivlik">Cari yükləmədəki bütün hadisələrin ümumi sayı.</HelpDef>
          <HelpDef term="Check-in">Agentlərin müştəri məntəqəsinə daxil olma (giriş) hadisələrinin sayı.</HelpDef>
          <HelpDef term="Check-out">Məntəqədən çıxış (vizitin bitirilməsi) hadisələrinin sayı.</HelpDef>
          <HelpDef term="Foto yükləmə">Sahədən yüklənmiş foto hadisələrinin sayı.</HelpDef>
          <HelpDef term="Aktivlik növü">Cədvəli müəyyən hadisə növünə görə süzgəcdən keçirən açılan siyahı.</HelpDef>
          <HelpDef term="Əməliyyat">Cədvəldəki rəngli nişan — hadisənin texniki adı (məs. CHECK_IN, CHECK_OUT, PHOTO_UPLOAD).</HelpDef>
          <HelpDef term="⚠ Məcburi check-in">Geo-məsafə yoxlamasını keçməyən, lakin məcburi rejimdə təsdiqlənmiş check-in (CHECK_IN_FORCED) — qırmızı nişanla fərqlənir.</HelpDef>
        </dl>
        <p>
          Cədvəl dörd sütundan ibarətdir: <strong>Vaxt</strong> (hadisənin tarixi və saatı),{" "}
          <strong>Agent</strong> (kim — ad yoxdursa «—»), <strong>Əməliyyat</strong> (rəngli
          nişanda hadisənin adı) və <strong>Təfərrüatlar</strong> (qısa izah; çox uzundursa kəsilir,
          boşdursa «—»). Səhifə açılan kimi son 50 hadisə yüklənir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: jurnalı oxu və süz">
        <HelpStep n={1}>
          <p>
            Səhifəni açın. Yuxarıdakı dörd KPI kartına baxın — onlar cari jurnalın ümumi mənzərəsini
            verir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yüklənmə zamanı qısa müddət boz «nəbz» yer-tutucular görünür, sonra dörd kart real
            rəqəmlərlə dolur: <strong>Ümumi aktivlik</strong>, <strong>Check-in</strong>,{" "}
            <strong>Check-out</strong> və <strong>Foto yükləmə</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Aktivlik növü</strong> kartındakı açılan siyahıdan istədiyiniz növü seçin —{" "}
            <HelpKey>Hamısı</HelpKey>, <HelpKey>Check-in</HelpKey>,{" "}
            <HelpKey>⚠ Məcburi check-in</HelpKey>, <HelpKey>Check-out</HelpKey>,{" "}
            <HelpKey>Foto yükləmə</HelpKey> və ya <HelpKey>Tapşırıqlar</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçim etdikdə cədvəl dərhal yenidən yüklənir və yalnız seçilmiş növə uyğun sətirləri
            göstərir. <HelpKey>Hamısı</HelpKey> süzgəci sıfırlayır və bütün hadisələri qaytarır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Jurnal sətirlərini oxuyun — hər sətir bir hadisədir. <strong>Əməliyyat</strong>{" "}
            sütunundakı rəngli nişana diqqət edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər əməliyyat növünün öz rəngi var: check-in yaşıl, check-out mavi, foto bənövşəyi,
            silmələr çəhrayı tonda görünür. <strong>CHECK_IN_FORCED</strong> (məcburi check-in)
            xüsusi olaraq qırmızı nişanla işarələnir — rəhbər bypass-ı bir baxışda tutsun deyə.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Heç bir uyğun hadisə yoxdursa, cədvəl yerinə mesaj görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Bu dövr üçün aktivlik tapılmadı» mətni mərkəzdə göstərilir. Başqa süzgəc seçərək və ya{" "}
            <HelpKey>Hamısı</HelpKey>-ya qayıdaraq nəticəni genişləndirə bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: jurnalı ixrac et">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>İxrac</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yanında yükləmə (ox) ikonası ilə görünür — sahə hadisələrini kənar fayla çıxarmaq
            üçün nəzərdə tutulub.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Süzgəc və KPI kartları eyni mənbədən oxunur, ona görə qırmızı{" "}
          <strong>CHECK_IN_FORCED</strong> nişanlarını tez görmək üçün{" "}
          <HelpKey>⚠ Məcburi check-in</HelpKey> növünü seçin — bu, geo-məsafə yoxlamasını
          atlamış check-in-ləri ayrıca süzür və uyğunluğu yoxlamağa kömək edir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu səhifə yalnız oxumaq üçündür — jurnaldan sətir silə və ya redaktə edə bilməzsiniz.
          Cədvəl bir dəfəyə son 50 hadisəni göstərir; əməliyyat sütununda tanış olmayan, boz nişan
          görsəniz, bu, hələ rənglənməmiş bir hadisə növüdür, lakin yenə də həqiqi bir hadisədir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün hadisələr təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın sahə aktivliyini
          görürsünüz, başqa təşkilatın jurnalına çıxışınız yoxdur. Sorğu sessiyanızın təşkilat
          kimliyi ilə bağlanır.
        </p>
      </HelpCallout>
    </div>
  )
}
