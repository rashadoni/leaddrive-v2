"use client"

/**
 * Da Vinci İdarəetmə Mərkəzi — help article (Azerbaijani).
 * Video-skript formatında: /ai-command-center səhifəsini əhatə edir —
 * İdarə paneli (KPI-lar, xəbərdarlıqlar, sessiyalar, qarşılıqlı əlaqə logları,
 * iz/trace modalı) və Agent konstruktoru (agent kartları, yeni/redaktə forması,
 * ötürmələr, niyyət bölgüsü, qaydalar/məhdudiyyətlər).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function aicommandcenterHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dəstək və ya əməliyyat administratorusunuz"
        goal="Da Vinci AI agentlərini qurmaq, onların müştərilərlə söhbətlərini izləmək və keyfiyyət, xərc, gecikmə göstəricilərinə nəzarət etmək"
      >
        Səhifəyə sol menyudan <HelpKey>Da Vinci İdarəetmə Mərkəzi</HelpKey> ilə çatırsınız. Başlıqda
        beyin ikonası, sağ tərəfdə yaşıl <HelpKey>Agent onlayn</HelpKey> nişanı və pulsasiya edən nöqtə
        durur. Altda iki böyük tab var: <HelpKey>İdarə paneli</HelpKey> və{" "}
        <HelpKey>Agent konstruktoru</HelpKey>. Bütün agentlər, sessiyalar, loglar və göstəricilər yalnız
        sizin təşkilatınız üçündür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          İki tab arasında keçid edirsiniz. <strong>İdarə paneli</strong> — yalnız oxumaq üçün analitika:
          KPI kartları, xəbərdarlıqlar, son sessiyalar və qarşılıqlı əlaqə logları.{" "}
          <strong>Agent konstruktoru</strong> — agentləri yaratdığınız, redaktə etdiyiniz və qaydalar təyin
          etdiyiniz iş yeri. İdarə panelində yuxarıda dörd böyük KPI kartı (<strong>Cəmi sessiyalar</strong>,{" "}
          <strong>Yönləndirmə</strong>, <strong>CSAT</strong>, <strong>FCR</strong>), altında altı
          dairəvi-ikonlu kart (<strong>Ort. həll</strong>, <strong>Cəmi mesajlar</strong>,{" "}
          <strong>Eskalasiyalar</strong>, <strong>Ort. gecikmə</strong>, <strong>Xərclər</strong>,{" "}
          <strong>Keyfiyyət</strong>) gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Da Vinci agenti">Sizin qurduğunuz AI köməkçi konfiqurasiyası — model, alətlər, qaydalar və davranışla. Eyni anda bir neçə agent ola bilər, biri «aktiv» olur.</HelpDef>
          <HelpDef term="Cəmi sessiyalar">Müştərilərlə açılan söhbətlərin ümumi sayı; altında bu günkü aktiv sessiyalar göstərilir.</HelpDef>
          <HelpDef term="Yönləndirmə (deflection)">Agent tərəfindən canlı operatora ötürülmədən həll edilən söhbətlərin faizi; yuxarı = daha yaxşı.</HelpDef>
          <HelpDef term="CSAT">Müştəri məmnuniyyət balı — 5 üzərindən orta qiymət.</HelpDef>
          <HelpDef term="FCR">İlk təmasda həll faizi (first contact resolution).</HelpDef>
          <HelpDef term="Eskalasiya">Söhbətin agentdən canlı operatora ötürülməsi; konstruktorda qaydalarla idarə olunur.</HelpDef>
          <HelpDef term="Xəbərdarlıq">Avtomatik siqnal — məsələn token sıçrayışı və ya yüksək gecikmə; oxunmamışların sayı qırmızı nişanda görünür.</HelpDef>
          <HelpDef term="Qarşılıqlı əlaqə logu (log)">Bir suala verilən hər bir cavabın qeydi — model, gecikmə, xərc, token sayı və izi (trace) ilə.</HelpDef>
          <HelpDef term="Qayda / məhdudiyyət (guardrail)">Agentin nə etməsinin qadağan olduğunu təsvir edən qoruyucu qayda.</HelpDef>
        </dl>
        <p>
          İdarə panelinin aşağısında <strong>Xəbərdarlıqlar</strong> bloku (zınqırov ikonası), ardınca{" "}
          <strong>Son 7 gün sessiyalar</strong> cədvəli və <strong>Qarşılıqlı əlaqə logları</strong> siyahısı
          gəlir. Konstruktor tabında isə agent kartları, <strong>Agent ötürmələri</strong>,{" "}
          <strong>Niyyət bölgüsü</strong>, <strong>Qaydalar və məhdudiyyətlər</strong> bloku və ən altda
          «Təsvirlə konfiqurasiya yarat» paneli var.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: İdarə panelini oxu">
        <HelpStep n={1}>
          <p>
            Yuxarıdakı tab cərgəsindən <HelpKey>İdarə paneli</HelpKey> düyməsini seçin (standart olaraq açıq
            gəlir).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tab qradiyent rəngə boyanır. Aşağıda dörd KPI kartı görünür:{" "}
            <strong>Cəmi sessiyalar</strong> (mesaj ikonası), <strong>Yönləndirmə</strong> (faiz + rəngli
            zolaq), <strong>CSAT</strong> (ulduz, «—» və ya N/5) və <strong>FCR</strong> (şimşək ikonası).
            Hələ məlumat yoxdursa, saylar sıfır və ya «—» kimi durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İkinci cərgədəki altı dairəvi-ikonlu kartı nəzərdən keçirin: <strong>Ort. həll</strong> (dəq),{" "}
            <strong>Cəmi mesajlar</strong>, <strong>Eskalasiyalar</strong>, <strong>Ort. gecikmə</strong> (s),{" "}
            <strong>Xərclər</strong> ($) və <strong>Keyfiyyət</strong> (10 üzərindən).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bir çox başlığın yanında izah ikonası (kiçik «i») var — üzərinə gətirdikdə həmin göstəricinin nə
            demək olduğu açılır. Xərc dollarla, gecikmə saniyə ilə göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Xəbərdarlıqlar</HelpKey> blokuna baxın. Oxunmamış xəbərdarlıq varsa, başlıqda qırmızı
            saylı nişan və sağda <HelpKey>Oxunmuş kimi işarələ</HelpKey> düyməsi görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər xəbərdarlıq sətrində növ (məs. token sıçrayışı və ya yüksək gecikmə), mesaj və neçə vaxt əvvəl
            baş verdiyi yazılır. Sessiyaya bağlı xəbərdarlıqda sağda göz ikonalı <HelpKey>İzləmə</HelpKey>{" "}
            keçidi olur. Heç xəbərdarlıq yoxdursa «Xəbərdarlıq yoxdur» yazısı görünür.{" "}
            <HelpKey>Oxunmuş kimi işarələ</HelpKey> basıldıqda sarı fonlar sönür və say sıfırlanır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: sessiyaya və ya logun izinə bax">
        <HelpStep n={1}>
          <p>
            <HelpKey>Son 7 gün sessiyalar</HelpKey> cədvəlində sətrin sağındakı{" "}
            <HelpKey>Detallar</HelpKey> (göz ikonalı) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəldə sessiya identifikatoru (qısaldılmış), mesaj sayı, vəziyyət nişanı (aktiv / həll edilib /
            bağlı / eskalasiya) və tarix sütunları var; yuxarıda axtarış sahəsi durur. Sessiya yoxdursa
            «Sessiya yoxdur» göstərilir. <HelpKey>Detallar</HelpKey> basıldıqda söhbət pəncərəsi açılır —
            istifadəçi mesajları sağda, agent cavabları solda balon kimi sıralanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Aşağıdakı <HelpKey>Qarşılıqlı əlaqə logları</HelpKey> siyahısında istənilən sətirə klikləyin
            (başlıqda mötərizədə ümumi say göstərilir).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə nömrə, istifadəçi sualının əvvəli, model nişanı, gecikmə (saniyə — yavaşlar qırmızı,
            sürətlilər yaşıl), xərc və token sayı durur. Sətirə klikləyəndə tam <strong>iz (trace)</strong>{" "}
            modalı açılır. Log yoxdursa «Log yoxdur» yazısı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İz modalında emalın addımlarını oxuyun, sonra sağ yuxarıdakı × ilə (və ya fonun boş yerinə
            klikləməklə) bağlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Modalda dörd kart — <strong>Gecikmə</strong>, <strong>Tokenlər</strong>, <strong>Xərc</strong>,{" "}
            <strong>Keyfiyyət</strong>; istifadəçi sualı; rəngli emal lenti (bilik bazası axtarışı, alətlər,
            LLM çağırışı); addım-addım kartlar (BB axtarışı — neçə məqalə tapıldı/seçildi; LLM çağırışı —
            giriş/çıxış tokenləri; əgər varsa alət çağırışları) və ən altda Da Vinci-nin cavabı görünür.
            Copilot logunda ayrıca «Copilot» nişanı olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni Da Vinci agenti yarat">
        <HelpStep n={1}>
          <p>
            Yuxarıdan <HelpKey>Agent konstruktoru</HelpKey> tabına keçin, sonra sağdakı{" "}
            <HelpKey>Yeni konfiqurasiya</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni agent» başlıqlı geniş forma açılır. İçində ardıcıllıqla: <strong>Agent adı</strong> sahəsi
            və yanında aktiv/qeyri-aktiv açarı, <strong>AI Modeli</strong> seçimi, <strong>Parametrlər</strong>,{" "}
            <strong>Agent imkanları</strong>, <strong>Eskalasiya</strong>, agent orkestrasiyası,{" "}
            <strong>Sistem promptu</strong> və <strong>Qeydlər</strong> bölmələri var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Agent adı</strong> yazın (məs. «Support Pro»). Bu məcburidir. Yanındakı açarla agentin
            dərhal <HelpKey>Aktiv</HelpKey> olub-olmamasını seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Adı boş buraxıb saxlamağa çalışsanız, yuxarıda qırmızı «Agent adını daxil edin» xəbərdarlığı çıxır.
            Açar yaşıldırsa <strong>Aktiv</strong>, bozdursa <strong>Qeyri-aktiv</strong> yazır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>AI Modeli</HelpKey> bölməsində üç seçimdən birini basın:{" "}
            <strong>Da Vinci Lite</strong> (sürətli/ucuz), <strong>Da Vinci Pro</strong> (balanslı) və ya{" "}
            <strong>Da Vinci Ultra</strong> (ən güclü).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər model kartında ad, qısa izah və 1 milyon token üçün qiymət göstərilir. Seçilən kart çərçivəyə
            alınır və üstündə «Seçildi» nişanı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <HelpKey>Parametrlər</HelpKey> bölməsindəki üç sürgünü (slider) tənzimləyin:{" "}
            <strong>Cavab uzunluğu</strong> (qısa↔ətraflı), <strong>Yaradıcılıq</strong> (dəqiq↔yaradıcı) və{" "}
            <strong>BB Məqalələri</strong> (1↔10).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sürgünün sağında cari rəqəm mavi rəngdə dərhal yenilənir; uclarındakı etiketlər (məs. «Qısa» /
            «Ətraflı») hansı istiqamətin nə demək olduğunu göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            <HelpKey>Agent imkanları</HelpKey> bölməsində agentin istifadə edəcəyi alət qruplarını açarla aktiv
            edin — məsələn <strong>CRM məlumat əldə etmə</strong>, <strong>Tiket yaratma</strong>,{" "}
            <strong>Bilik bazası</strong> və digərləri.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər qrupun adı, qısa izahı və solunda açarı var. Aktiv qrupun fonu mavi olur. Bir qrupu açmaq
            içindəki bütün alətləri eyni anda aktivləşdirir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            <HelpKey>Eskalasiya</HelpKey> bölməsindəki üst açarla canlı operatora ötürməni aktiv saxlayın və
            tətbiq olunacaq qaydaları işarələyin (məs. müştəri operator istəyir, qəzəbli müştəri, ödəniş sualı).
            İstəsəniz aşağıdakı sahəyə öz qaydanızı yazıb <HelpKey>+</HelpKey> ilə əlavə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bəzi qaydalar «Həmişə» nişanı ilə gəlir — onları söndürmək olmur. İşarələnmiş qaydanın fonu qırmızıya
            çalır; xüsusi qaydalar sarı fonla aşağıda sıralanır və zibil ikonası ilə silinir. Eskalasiya açarını
            söndürsəniz, bütün qaydalar gizlənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={7}>
          <p>
            İstəyə bağlı olaraq agent orkestrasiyasını qurun: <strong>Agent növü</strong> (General, Sales,
            Support, Marketing, Analyst, Contract), <strong>Department</strong>, <strong>Prioritet</strong>,{" "}
            <strong>Max Tool Rounds</strong>, idarə etdiyi niyyətlər və xüsusi salamlama. Sonra istəsəniz{" "}
            <strong>Sistem promptu</strong> və <strong>Qeydlər</strong> əlavə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Agent növləri beş sütunlu kart şəbəkəsi kimi görünür, seçilən narıncı çərçivəyə alınır. Niyyət
            etiketləri klikləndikdə narıncı rəngə keçir. Sistem promptu və qeydlər çoxsətrli mətn sahələridir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={8}>
          <p>
            Aşağıdakı <HelpKey>Agent yarat</HelpKey> düyməsini basın (fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> və ya × ilə bağlayın).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Saxlanılır…» yazısına keçir, sonra pəncərə bağlanır və yeni agent konstruktordakı kart
            şəbəkəsində peyda olur. Aktiv agentdə yaşıl «AKTİV» nişanı görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: agenti redaktə et, aktivləşdir və ya sil">
        <HelpStep n={1}>
          <p>
            Konstruktorda agent kartındakı <HelpKey>Redaktə et</HelpKey> (qələm ikonalı, sarı) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Eyni forma açılır, lakin bütün sahələr mövcud konfiqurasiya ilə əvvəlcədən doldurulmuş olur. Başlıq
            «Agenti redaktə et» yazır; dəyişiklikləri edib <HelpKey>Saxla</HelpKey> ilə təsdiqləyin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Qeyri-aktiv agenti işə salmaq üçün kartdakı <HelpKey>Aktivləşdir</HelpKey> (güc ikonalı, yaşıl)
            düyməni basın. Bu düymə yalnız aktiv olmayan agentlərdə görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart yenilənir və yaşıl «AKTİV» nişanı, beyin ikonalı qradiyent fon ilə gəlir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Agenti silmək üçün kartdakı <HelpKey>Sil</HelpKey> (qırmızı zibil qutusu ikonalı) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Da Vinci agenti sil» təsdiq pəncərəsi açılır və silinəcək agentin adını göstərir. Təsdiqlədikdən
            sonra kart şəbəkədən çıxır. Heç agent qalmasa, beyin ikonalı boş vəziyyət («Agent yoxdur» + «İşə
            başlamaq üçün ilk agenti yaradın») görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: qayda (məhdudiyyət) əlavə et və ya sil">
        <HelpStep n={1}>
          <p>
            Konstruktorun aşağısındakı <HelpKey>Qaydalar və məhdudiyyətlər</HelpKey> blokunda sağdakı qırmızı{" "}
            <HelpKey>Yeni qayda</HelpKey> düyməsini basın — səhifə aşağıdakı əlavə formasına sürüşür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Blokun başlığında qalxan ikonası və «Agentin nə etməsi qadağandır» izahı var. Mövcud qayda yoxdursa
            «Qayda yoxdur» yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Qayda adı</HelpKey> sahəsini doldurun (məcburi), istəsəniz <strong>Təsvir</strong> və{" "}
            sistem promptu üçün prompt inyeksiyası mətnini də yazın, sonra <HelpKey>Əlavə et</HelpKey> düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Əlavə et</HelpKey> düyməsi qayda adı boş olduqda passiv qalır. Əlavə etdikdən sonra yeni
            qayda yuxarıdakı siyahıda qalxan ikonası ilə peyda olur və sahələr təmizlənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Qaydanı silmək üçün onun sətrindəki zibil qutusu ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qayda siyahıdan dərhal yox olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Konstruktorun ən altındakı «Təsvirlə konfiqurasiya yarat» paneli agent rolunu adi mətinlə təsvir
          edib avtomatik konfiqurasiya almağa imkan verir — sürətli başlanğıc üçün faydalıdır. Eyni zamanda
          bir neçə agent saxlaya bilərsiniz; <strong>Agent ötürmələri</strong> və{" "}
          <strong>Niyyət bölgüsü</strong> blokları agentlər arasında işin necə paylandığını göstərir (məlumat
          yığılana qədər boş ola bilər).
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          İdarə paneli yalnız <strong>oxumaq üçündür</strong> — orada agenti dəyişmək olmur, bütün konfiqurasiya
          dəyişiklikləri <HelpKey>Agent konstruktoru</HelpKey> tabında edilir. Agentin və ya qaydanın silinməsi
          geri qaytarılmır; agenti müvəqqəti dayandırmaq istəyirsinizsə, silmək yerinə redaktə formasında aktiv
          açarını söndürün.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün agentlər, sessiyalar, loglar, xəbərdarlıqlar və qaydalar təşkilatınızla məhdudlaşır —
          başqa tenant-ın məlumatını görmürsünüz. Daha güclü model (Da Vinci Ultra) və uzun cavablar token
          xərcini artırır; <strong>Xərclər</strong> kartı və hər logdakı xərc sütunu bu sərfiyyatı izləməyə
          kömək edir.
        </p>
      </HelpCallout>
    </div>
  )
}
