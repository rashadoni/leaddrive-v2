"use client"

/**
 * MTM Settings — kömək məqaləsi (Azərbaycan).
 *
 * «Marşrut və Sahə» (MTM) modulunun /mtm/settings parametrlər səhifəsini
 * təsvir edir: yeddi parametr qrupu (Şirkət, GPS izləmə, Ziyarət
 * parametrləri, İş saatları, Telegram bot, İnteqrasiyalar, Hesabatlar),
 * dəyərlərin təşkilat daxilində saxlanması, serverin defolt dəyərləri,
 * kimin yadda saxlaya biləcəyi və audit jurnalı.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MtmSettingsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Bu səhifə nədir">
        <p>
          <strong>MTM Parametrləri</strong> — <strong>«Marşrut və Sahə»</strong> komandanızın işini
          tənzimləmək üçün vahid yerdir: GPS izləmə tezliyi, geozona ölçüsü, ziyarət qaydaları, iş
          saatları, xəbərdarlıqlar, Telegram bot, inteqrasiyalar və gündəlik hesabatlar.
        </p>
        <p>
          Hər parametr <strong>təşkilatınız daxilində</strong> saxlanılır, ona görə burada
          dəyişdiyiniz dəyər bütün sahə komandanıza tətbiq olunur və başqa təşkilatlara keçmir.
          Səhifə açılanda cari dəyərləri yükləyir; <HelpKey>Yadda saxla</HelpKey> düyməsini
          basmayana qədər heç nə dəyişmir.
        </p>
      </HelpSection>

      <HelpSection title="Yadda saxlama necə işləyir">
        <HelpStep n={1}>
          <p>
            Kartlardakı istənilən sahəni dəyişin. Açarlar yandırılıb-söndürülür, mətn sahələri
            sərbəst mətn qəbul edir, rəqəm sahələri tam ədədlər, vaxt sahələri isə saat dəyəri
            (SS:DD) qəbul edir.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bir dəfə <HelpKey>Yadda saxla</HelpKey> düyməsini basın — bütün forma birlikdə göndərilir
            və hər parametr öz açarı üzrə ayrıca qeyd kimi yazılır. Mövcud parametrin yenidən yadda
            saxlanması onu əvəz edir, dublikat yaratmır.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Uğurlu olduqda <em>«Parametrlər yadda saxlanıldı»</em> təsdiqini görəcəksiniz. Yadda
            saxlama uğursuz olarsa, xəta göstərilir və serverdə heç nə yarımçıq tətbiq olunmur —
            düzəldib yenidən yadda saxlayın.
          </p>
        </HelpStep>
        <HelpCallout kind="security">
          <p>
            <strong>Yadda saxlama icazə ilə qorunur.</strong> Bu parametrləri yalnız{" "}
            <strong>admin</strong>, <strong>manager</strong> və <strong>superadmin</strong> rolları
            yaza bilər; digərləri <em>«Forbidden»</em> cavabı ilə bloklanır. Hər yadda saxlama həm
            də MTM audit jurnalına yazılır (hansı açarların dəyişdirildiyi, üstəlik sorğunun IP-si və cihaz).
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="GPS izləmə və ziyarət parametrləri">
        <p>
          Bu iki qrup sahə tətbiqinin yerləşməni necə izlədiyini və agentin müştəri nöqtəsində nə
          etməli olduğunu idarə edir. Onların bir hissəsi siz dəyişənə qədər məntiqli defolt
          dəyərlərlə gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="GPS intervalı">Yerləşmə siqnalının nə qədər tez-tez alınması, saniyə ilə. Defolt 30.</HelpDef>
          <HelpDef term="Geozona radiusu">Müştəri ətrafındakı qeydiyyat zonası, metr ilə. Defolt 100.</HelpDef>
          <HelpDef term="GPS saxtalaşdırma">Saxta yerləşmə aşkarlananda xəbərdarlıq. Defolt olaraq aktiv.</HelpDef>
          <HelpDef term="Şəkil tələb olunur">Ziyarət qaydası tapılmadıqda bir şəkil tələb edən ehtiyat qayda. Defolt olaraq deaktivdir.</HelpDef>
          <HelpDef term="Maks. şəkil">Ziyarət başına şəkil limiti. Defolt 10.</HelpDef>
          <HelpDef term="Açıq ziyarət xəbərdarlığı">Açıq ziyarətin neçə dəqiqədən sonra xəbərdarlıq yaratması. Agent tamamlayanadək açıq qalır. Defolt 120.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="İş saatları və xəbərdarlıqlar">
        <p>
          Komandanın <strong>Başlama vaxtı</strong> və <strong>Bitmə vaxtını</strong> təyin edin
          (SS:DD, defolt 09:00–18:00), sonra lazım olan xəbərdarlıqları yandırın:{" "}
          <em>gecikmə</em> və <em>buraxılmış ziyarət</em> defolt olaraq hər ikisi aktivdir.
        </p>
        <HelpCallout kind="tip">
          <p>
            GPS saxtalaşdırma, gecikmə və buraxılmış ziyarət xəbərdarlıqları öncədən aktiv olan üç
            xəbərdarlıqdır. Konkret səbəb olmadıqca onları aktiv saxlayın. Bu, marşrutda nəyinsə
            diqqət tələb etdiyini bildirən erkən siqnalınızdır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Telegram bot, inteqrasiyalar və hesabatlar">
        <p>
          Son üç qrup <strong>istəyə bağlı</strong> qoşulur — onların defolt dəyəri yoxdur, ona görə
          siz onları doldurub yadda saxlayana qədər hər sahə boş, hər açar isə söndürülmüş qalır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Telegram bot">Onu aktiv edin, sonra bot tokenini və çat/qrup ID-sini saxlayın və qeydiyyatda və xəbərdarlıqlarda bildiriş göndərilməsini seçin.</HelpDef>
          <HelpDef term="İnteqrasiyalar">Vebhuk URL-i və onun aktivləşmə açarı, API açarı ilə giriş açarı və xarici CRM ilə sinxronizasiya açarı.</HelpDef>
          <HelpDef term="Hesabatlar">Gündəlik hesabatın avtomatik yaradılması, hesabatların təyin olunan vaxtda adminlərə göndərilməsi və istəyə bağlı şəkillərin əlavə edilməsi.</HelpDef>
        </dl>
        <HelpCallout kind="warning">
          <p>
            <strong>Bot tokeni</strong> və <strong>vebhuk URL-i</strong> etimadnamələrdir. Onları
            diqqətlə yapışdırın və parol kimi qoruyun. Onlar yalnız təşkilatınız daxilində
            saxlanılır, lakin səhv və ya sızmış token bildirişlərin yanlış yerə getməsi deməkdir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Marşrutlar Phase 1 tətbiqinə nəzarət">
        <p>
          Üç açar administratora çox-agentli marşrut təyinatını, vizitin məcburi fəaliyyət siyasətlərini
          və Excel importunu ayrı-ayrılıqda aktiv etməyə imkan verir. Açarın söndürülməsi mövcud marşrutları,
          siyasətləri və import tarixçəsini silmir, yalnız yeni istifadəni bloklayır. Menecerlər üçün ayrıca
          icazə verilməyənədək Excel importu yalnız administratorlara açıq qalır.
        </p>
      </HelpSection>

      <HelpSection title="Şirkət brendinqi">
        <p>
          <strong>Şirkət</strong> qrupu şirkət adını, əsas rəngi və loqotip URL-ini saxlayır. Digər
          istəyə bağlı qruplar kimi əvvəlcə boş olur — sahə komandasının interfeysini öz korporativ
          üslubunuzla göstərmək üçün onu doldurun.
        </p>
      </HelpSection>

      <HelpCallout kind="next">
        <p>
          İzləmə, saatlar və xəbərdarlıqlar tənzimləndikdən sonra «Marşrut və Sahə» ekranlarına
          qayıdın — yeni ziyarətlər, geozonalar və uzun ziyarət xəbərdarlıqları burada təyin etdiyiniz qaydalara
          əməl edəcək. Komandanın cədvəli və ya izləmə siyasəti dəyişəndə bu səhifəyə qayıdın.
        </p>
      </HelpCallout>
    </div>
  )
}
