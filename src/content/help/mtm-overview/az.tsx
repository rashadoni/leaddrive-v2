"use client"

/**
 * MTM — İdarə paneli (home/overview) help article (Azerbaijani).
 * REWRITE: yalnız «Marşrutlar və saha» modulunun BAŞ səhifəsini (idarə paneli)
 * SWM-17 əməliyyat həftəsini və əvvəlki panel icmalını əhatə edir — salamlama + canlı saat,
 * dörd KPI kartı, tamamlanma halqası, zaman metrikaları, aktiv agentlər və
 * son vizitlər cədvəli. Canlı Xəritə, Fəaliyyət jurnalı və Reytinq ARTIQ
 * öz ayrıca məqalələrinə malikdir, ona görə bura DAXİL DEYİL.
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
        persona="Saha əməliyyatları üzrə menecer və ya supervayzer"
        goal="Bir işçinin dərc olunmuş həftəsini, faktiki sübutlarını, iş günü vəziyyətini, GPS yeniliyini, tapşırıqlarını və plan dəyişikliklərini yoxlamaq"
      >
        Bu, <HelpKey>Marşrutlar və saha</HelpKey> modulunun baş səhifəsidir (sol menyuda{" "}
        <HelpKey>Panel</HelpKey>). Rəhbər server tərəfindən məhdudlaşdırılmış işçi seçimi və yalnız
        oxunan əməliyyat həftəsi alır. Agent öz həftəsində yalnız serverin həmin anda icazə verdiyi
        iş günü əməliyyatlarını yerinə yetirə bilər. Əvvəlki KPI icmalı aşağıda qalır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda sol tərəfdə adınızla salamlama (<strong>«Xoş gəldiniz, {"{ad}"}!»</strong>),
          altında səhifə adı <HelpKey>Panel</HelpKey> və «Sahə komandasının idarə edilməsi — agentlər,
          marşrutlar, vizitlər, tapşırıqlar» izahı, sağ tərəfdə isə canlı tarix və saniyəsi ilə
          işləyən rəqəmsal saat var. Saatın altında üç sürətli əməliyyat düyməsi durur:{" "}
          <HelpKey>Yeni agent</HelpKey>, <HelpKey>Hesabatlar</HelpKey> və <HelpKey>Canlı xəritə</HelpKey>.
        </p>
        <p>
          Onların altında <HelpKey>Əməliyyat həftəsi</HelpKey> var: region, komanda, işçi, tarix,
          1/5/7 günlük dövr, günlər üzrə dərc olunmuş plan və diqqət bloku. Ondan sonra əvvəlki dövr
          filtri gəlir — <HelpKey>Bu gün</HelpKey>, <HelpKey>Bu həftə</HelpKey>,{" "}
          <HelpKey>Bu ay</HelpKey> — seçilmiş dövr tünd rənglə işarələnir. Filtrin altında dörd KPI
          kartı, sonra üç sütunlu sıra (tamamlanma halqası, zaman metrikaları, aktiv agentlər) və ən
          aşağıda <HelpKey>Son vizitlər</HelpKey> cədvəli gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Planlaşdırılmış marşrutlar">Seçilmiş dövr üçün planlaşdırılmış marşrutların sayı; altında dövr etiketi (məs. «bu gün üçün»).</HelpDef>
          <HelpDef term="Tamamlanıb">Tamamlanmış marşrutların sayı; altında «{"{faiz}"}% tamamlanma» göstərilir.</HelpDef>
          <HelpDef term="Marşrutdan kənar">Marşrutdan kənara çıxma siqnallarının sayı; altında «diqqət tələb edir» yazılır.</HelpDef>
          <HelpDef term="Gözləyən tapşırıqlar">Hələ açıq tapşırıqların sayı; altında «{"{n}"} təcili» göstərilir.</HelpDef>
          <HelpDef term="Tamamlanma faizi">Halqa qrafiki — mərkəzdə faiz, yanında «Tamamlanıb» və «Qalıb» rəng açarları.</HelpDef>
          <HelpDef term="Zaman metrikaları">Orta marşrut vaxtı və orta vizit vaxtı (dəqiqə ilə), ümumi iş vaxtı (saat ilə).</HelpDef>
          <HelpDef term="Aktiv agentlər">Əvvəlki fəaliyyət xülasəsi. Son GPS vaxtı və yeniliyi üçün Əməliyyat həftəsinə və ya xəritəyə baxın.</HelpDef>
          <HelpDef term="Son vizitlər">Son vizitlərin cədvəli: Agent, Müştəri, Status, Check-in vaxtı və Müddət sütunları.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: əməliyyat həftəsini yoxla">
        <HelpStep n={1}>
          <p>
            Lazım olduqda <HelpKey>Region</HelpKey> və <HelpKey>Komanda</HelpKey> seçimini daraldın,
            sonra bir <HelpKey>İşçi</HelpKey> seçin. İşçi seçilənədək rəhbərə marşrut, vizit,
            tapşırıq, iş günü və GPS faktları göndərilmir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş işçinin məlumatları əvvəlkiləri tam əvəz edir. Hər gündə plan, fakt və ləğv
            sayı mətn və nişanla, həmçinin iş günü vəziyyəti göstərilir. Telefonda gün dəyişdiricisi
            işləyir; beş sütun dar ekrana sıxılmır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Nöqtədən təşkilatı, əlaqəni, marşrutu, viziti və ya GPS tarixçəsini aça bilərsiniz;
            panel konteksti geri keçiddə saxlanılır. Dərc olunmuş plandan kənar faktiki vizitlər
            ayrıca göstərilir və planın məxrəcinə daxil edilmir.
          </p>
          <HelpCallout kind="see" label="Sübut qaydaları">
            GPS yeniliyi iş gününün vəziyyətindən ayrıdır. “Yeni”, “gecikmiş” və “köhnəlmiş” son
            etibarlı koordinatın yaşını bildirir, işçinin indi həmin nöqtədə olduğunu iddia etmir.
            Keş və qismən görüntülər həmişə ayrıca işarələnir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: dövrü seç və KPI-ları oxu">
        <HelpStep n={1}>
          <p>
            Dövr filtrindən birini seçin: <HelpKey>Bu gün</HelpKey>, <HelpKey>Bu həftə</HelpKey> və ya{" "}
            <HelpKey>Bu ay</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz düymə tünd (dolu) görünür, qalanları çərçivəli qalır. Dörd KPI kartı və
            aşağıdakı bloklar yeni dövrə görə yenilənir; <strong>Planlaşdırılmış marşrutlar</strong>{" "}
            kartının altındakı etiket də ona uyğun dəyişir («bu gün üçün» / «bu həftə» / «bu ay»).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Dörd KPI kartını soldan sağa oxuyun:{" "}
            <strong>Planlaşdırılmış marşrutlar</strong>, <strong>Tamamlanıb</strong>,{" "}
            <strong>Marşrutdan kənar</strong> və <strong>Gözləyən tapşırıqlar</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kartda iri rəqəm, başlıq və kiçik alt yazı var: <strong>Tamamlanıb</strong> faizi,{" "}
            <strong>Marşrutdan kənar</strong> «diqqət tələb edir», <strong>Gözləyən tapşırıqlar</strong>{" "}
            isə neçəsinin təcili olduğunu göstərir. Yüklənmə, məhdud əhatədə əlçatmaz metrika və
            həqiqi sıfır bir-birindən fərqli göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: tamamlanma və zaman bloklarını oxu">
        <HelpStep n={1}>
          <p>
            Soldakı <HelpKey>Tamamlanma faizi</HelpKey> halqasına baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Dairəvi halqa qrafiki seçilmiş dövrün tamamlanma faizini doldurur, mərkəzdə həmin faiz
            yazılır. Yanında iki açar var: <strong>Tamamlanıb</strong> (tamamlanmış marşrutların sayı)
            və <strong>Qalıb</strong> (planlaşdırılmış minus tamamlanmış).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Ortadakı <HelpKey>Zaman metrikaları</HelpKey> blokuna keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Üç sətir, hər biri saat ikonalı: <strong>Orta marşrut vaxtı</strong> və{" "}
            <strong>Orta vizit vaxtı</strong> dəqiqə ilə, <strong>Ümumi iş vaxtı</strong> isə saat ilə
            göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: aktiv agentləri izlə">
        <HelpStep n={1}>
          <p>
            Sağdakı <HelpKey>Aktiv agentlər</HelpKey> blokuna baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bu əvvəlki blok fəaliyyət nişanı, beşədək ad və son göndərilmiş sürəti göstərə bilər.
            Bu, işçinin dəqiq cari yerini sübut etmir. Koordinat vaxtı, yenilik, dəqiqlik və batareya
            üçün Əməliyyat həftəsinə və ya <HelpKey>Canlı xəritə</HelpKey>yə baxın.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Onlayn agent varsa, blokun altındakı <HelpKey>Xəritədə göstər</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Canlı xəritə</HelpKey> səhifəsinə keçirsiniz (sürətli əməliyyatlardakı{" "}
            <HelpKey>Canlı xəritə</HelpKey> düyməsi ilə eyni yer). Xəritənin öz təfərrüatlı izahı üçün
            ayrıca yardım məqaləsi var.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: son vizitlər cədvəlini oxu">
        <HelpStep n={1}>
          <p>
            Səhifənin ən altındakı <HelpKey>Son vizitlər</HelpKey> cədvəlinə baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Beş sütunlu cədvəl: <strong>Agent</strong>, <strong>Müştəri</strong>,{" "}
            <strong>Status</strong>, <strong>Check-in</strong> və <strong>Müddət</strong>. Status
            rəngli nişan kimi göstərilir (məs. CHECKED_OUT yaşıl, CHECKED_IN mavi). Məlumat yüklənərkən
            «Yüklənir...», hələ vizit yoxdursa «Hələ vizit yoxdur» yazısı çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: sürətli əməliyyatlar">
        <HelpStep n={1}>
          <p>
            Başlığın altındakı üç düymədən birini basın: <HelpKey>Yeni agent</HelpKey>,{" "}
            <HelpKey>Hesabatlar</HelpKey> və ya <HelpKey>Canlı xəritə</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Yeni agent</HelpKey> sizi agentlər səhifəsinə,{" "}
            <HelpKey>Hesabatlar</HelpKey> hesabatlar səhifəsinə, <HelpKey>Canlı xəritə</HelpKey> isə
            canlı xəritəyə aparır. Bunlar sadəcə naviqasiya keçidləridir — burada heç nə dəyişmir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Əməliyyat həftəsi vərəq görünəndə avtomatik yenilənir və əl ilə də yenilənə bilər. Sorğular
          üst-üstə düşmür. Son uğurlu server cavabının vaxtı ilə avtonom görüntünün saxlanma vaxtı
          ayrıca göstərilir. Cihaz nüsxəni saxlaya bilməzsə, aktual görünüş əlçatan qalır və mane
          olmayan xəbərdarlıq göstərir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Sıfır yalnız uğurlu cavabdan sonra məna daşıyır. Yüklənmə, giriş qadağası, qismən məlumat,
          tezlik limiti, avtonom görüntü və əhatədə əlçatmaz metrika açıq işarələnir; bunları sıfır
          fəaliyyət kimi qəbul etməyin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Server tenant, rəhbər, komanda və işçi əhatəsini tətbiq edir. Əhatədən kənar işçi qaytarılmır
          və başqa işçi sorğulanmazdan əvvəl əvvəlki faktlar silinir. Keş tenant, daxil olmuş istifadəçi,
          işçi, filtrlər, tarix və diapazonla bağlanır.
        </p>
      </HelpCallout>
    </div>
  )
}
