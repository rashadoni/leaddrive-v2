"use client"

/**
 * Security settings — help article (Azerbaijani).
 * Tənzimləmələr → Təhlükəsizlik səhifəsini əhatə edir:
 * Authenticator (TOTP) 2FA, SMS 2FA, Avtorizasiya metodları
 * (Google/Microsoft OAuth açar-bağla), Bağlı hesablar (link/unlink)
 * və API açarları. Yalnız bu səhifədəki real UI təsvir olunur.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SecuritySettingsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Hesabını və təşkilatının girişini qoruyan istifadəçi və ya administratorsunuz"
        goal="İki faktorlu autentifikasiyanı (authenticator və ya SMS) qurmaq, giriş üsullarını idarə etmək, sosial hesabları bağlamaq və inteqrasiyalar üçün API açarları yaratmaq"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Təhlükəsizlik</HelpKey> yolu ilə çatırsınız.
        Yuxarıda geriyə ox, qalxan ikonu, <HelpKey>Təhlükəsizlik</HelpKey> başlığı və altında «İki faktorlu
        autentifikasiya, parol siyasətləri və təhlükəsizlik parametrləri» izahı var. 2FA və bağlı hesablar
        SİZİN hesabınıza aiddir; avtorizasiya metodları və API açarları isə təşkilat səviyyəsində təsir göstərir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Səhifə yuxarıdan aşağı bir neçə bölmədən ibarətdir: <strong>Authenticator 2FA</strong> kartı,{" "}
          <strong>SMS ikifaktorlu autentifikasiya</strong>, <strong>Avtorizasiya Metodları</strong>,{" "}
          <strong>Bağlı Hesablar</strong> və <strong>API Keys</strong>. Hər bölmə öz başlığı, ikonu və qısa
          izahı ilə ayrılır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="2FA (iki faktorlu autentifikasiya)">Paroldan əlavə ikinci təsdiq addımı — authenticator tətbiqindən və ya SMS-dən gələn birdəfəlik kod.</HelpDef>
          <HelpDef term="Authenticator tətbiqi">Google Authenticator, Authy, Microsoft Authenticator kimi — QR kodu skan edib hər 30 saniyədə 6 rəqəmli kod yaradan tətbiq.</HelpDef>
          <HelpDef term="Backup kodları">Authenticator tətbiqini itirsəniz giriş üçün istifadə edilən birdəfəlik ehtiyat kodlar; hər kod yalnız bir dəfə işləyir.</HelpDef>
          <HelpDef term="SMS 2FA">İkinci addımı authenticator əvəzinə telefon nömrənizə gələn SMS kodu ilə qurmaq.</HelpDef>
          <HelpDef term="Avtorizasiya metodu">Giriş səhifəsində görünən üsul — Google OAuth və Microsoft OAuth açıb-bağlana bilir.</HelpDef>
          <HelpDef term="Bağlı hesab">Sizin LeadDrive hesabınıza bağlanmış Google və ya Microsoft hesabı — onunla giriş edə bilirsiniz.</HelpDef>
          <HelpDef term="API açarı">Xarici sistemlərin LeadDrive məlumatlarına proqram vasitəsilə müraciəti üçün gizli açar; oxu/yazı icazələri (scope) və bitmə müddəti olur.</HelpDef>
          <HelpDef term="Scope (icazə)">Açarın hansı modullara hansı səviyyədə (read = oxu, write = yazı) çata biləcəyini təyin edən icazə.</HelpDef>
        </dl>
        <p>
          Birinci kartda yaşıl və ya narıncı qalxan ikonu, <strong>2FA Enabled</strong> / <strong>2FA Not
          Enabled</strong> mətni və sağda <strong>Aktiv</strong> / <strong>Qeyri-aktiv</strong> nişanı durur.
          Aşağıda «How it works» qutusu və 2FA vəziyyətinə görə <HelpKey>Enable 2FA</HelpKey> ya da{" "}
          <HelpKey>Disable 2FA</HelpKey> düyməsi olur.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: authenticator 2FA-nı aktivləşdir">
        <HelpStep n={1}>
          <p>
            Yuxarıdakı status kartında <HelpKey>Enable 2FA</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə qısa müddət fırlanan ikona göstərir, sonra «Step 1: Scan QR Code» başlıqlı kart açılır.
            İçində böyük QR kod şəkli görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Authenticator tətbiqinizi (Google Authenticator, Authy və s.) açıb həmin QR kodu skan edin.
            Skan edə bilmirsinizsə, QR-ın altındakı açarı əl ilə daxil edin — yanındakı kopya ikonu ilə də
            götürə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Can't scan? Enter this key manually:» yazısı altında gizli açar mətn kimi göstərilir.
            Kopya düyməsini basanda işarə qısa müddət yaşıl quş işarəsinə çevrilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            «Step 2: Enter verification code» altındakı sahəyə tətbiqdəki 6 rəqəmli kodu yazın, sonra{" "}
            <HelpKey>Verify &amp; Enable</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahə yalnız rəqəm qəbul edir və 6 rəqəmlə məhdudlaşır. 6 rəqəm yığılmayınca{" "}
            <HelpKey>Verify &amp; Enable</HelpKey> düyməsi qeyri-aktivdir. Kod səhvdirsə, sahənin altında
            qırmızı xəta mətni çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Kod düzgündürsə, «2FA Enabled Successfully!» kartı açılır və backup kodlarınızı göstərir. Onları
            təhlükəsiz yerdə saxlayın — <HelpKey>Copy All Codes</HelpKey> ilə hamısını birdən kopyalaya
            bilərsiniz. Bitirdikdə <HelpKey>Done</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sarı «Save your backup codes!» qutusu və iki sütunda düzülmüş kodlar görünür. <HelpKey>Done</HelpKey>{" "}
            düyməsindən sonra status kartına qayıdırsınız; indi qalxan yaşıl, mətn <strong>2FA Enabled</strong>{" "}
            və nişan <strong>Aktiv</strong> olur.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Backup kodları yalnız bu ekranda bir dəfə göstərilir və hər kod yalnız bir dəfə işləyir. İndi
            kopyalayıb təhlükəsiz saxlamasanız, sonra onları yenidən görə bilməyəcəksiniz.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: authenticator 2FA-nı söndür">
        <HelpStep n={1}>
          <p>
            2FA aktivdirsə, status kartında qırmızı <HelpKey>Disable 2FA</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Disable 2FA» başlıqlı (qırmızı) kart açılır və cari 6 rəqəmli kodu daxil etməyi istəyir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Authenticator tətbiqindəki cari 6 rəqəmli kodu yazıb qırmızı <HelpKey>Disable 2FA</HelpKey>{" "}
            düyməsini basın. (Vaz keçmək üçün <HelpKey>Cancel</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            6 rəqəm yığılmayınca düymə qeyri-aktiv qalır. Təsdiqdən sonra status kartına qayıdırsınız; qalxan
            narıncı, mətn <strong>2FA Not Enabled</strong> və nişan <strong>Qeyri-aktiv</strong> olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: SMS 2FA-nı qur">
        <HelpStep n={1}>
          <p>
            <strong>SMS ikifaktorlu autentifikasiya</strong> bölməsində <HelpKey>SMS 2FA aktivləşdir</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart başlığında telefon ikonu, «Telefonu SMS ilə təsdiqlə» adı və sağ küncdə vəziyyət nişanı
            (<strong>Aktiv deyil</strong> / <strong>Aktiv</strong>) var. Düyməni basanda telefon nömrəsi sahəsi
            açılır; yanında «Daxil olarkən paroldan sonra SMS kodu addımı əlavə olunacaq» ipucu görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Telefon nömrəsi</strong> sahəsinə nömrənizi beynəlxalq formatda yazıb (məs.{" "}
            <HelpKey>+994501234567</HelpKey>) <HelpKey>Kod göndər</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahənin altında «Beynəlxalq formatdan istifadə edin» ipucu durur. Nömrə düzgün deyilsə, qırmızı
            xəta mətni çıxır. Kod göndəriləndə yuxarıda «Kod göndərildi» bildirişi görünür və forma 6 rəqəmli
            kod addımına keçir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            SMS-də gələn 6 rəqəmli kodu <strong>6 rəqəmli kod</strong> sahəsinə yazıb{" "}
            <HelpKey>Təsdiqlə və aktivləşdir</HelpKey> düyməsini basın. (Geri qayıtmaq üçün{" "}
            <HelpKey>Geri</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yuxarıda kodun hansı nömrəyə göndərildiyi yazılır. Sahə yalnız rəqəm qəbul edir; 6 rəqəm
            yığılmayınca düymə qeyri-aktivdir. Uğurlu olanda kart yaşıl «SMS 2FA aktivdir» qutusuna keçir,
            maskalanmış nömrəni göstərir və nişan <strong>Aktiv</strong> olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Sonradan söndürmək üçün <HelpKey>SMS 2FA deaktivləşdir</HelpKey>, başqa nömrəyə keçmək üçün isə{" "}
            <HelpKey>Telefonu dəyiş</HelpKey> düyməsindən istifadə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Telefonu dəyiş</HelpKey> yenidən nömrə → kod axınını başladır; deaktivləşdirmədən sonra
            kart yenidən <HelpKey>SMS 2FA aktivləşdir</HelpKey> düyməsi olan ilkin halına qayıdır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: giriş üsullarını idarə et və hesab bağla">
        <HelpStep n={1}>
          <p>
            <strong>Avtorizasiya Metodları</strong> bölməsində Google OAuth və Microsoft OAuth kartlarındakı
            keçid düyməsini (toggle) basaraq həmin üsulu giriş səhifəsində açıb-bağlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kartda provayder adının yanında <strong>Qurulub</strong> (yaşıl) və ya <strong>Qurulmayıb</strong>{" "}
            (qırmızı) nişanı var. Provayder serverdə qurulmayıbsa, keçid düyməsi qeyri-aktivdir və altında
            sarı xəbərdarlıq mətni («…serverdə .env-də təyin edilməyib») görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Bağlı Hesablar</strong> bölməsində öz Google və ya Microsoft hesabınızı LeadDrive
            hesabınıza bağlamaq üçün <HelpKey>Link</HelpKey>, ayırmaq üçün <HelpKey>Unlink</HelpKey>{" "}
            düyməsindən istifadə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hesab bağlıdırsa, provayder adının yanında yaşıl <strong>Connected</strong> nişanı və qırmızı{" "}
            <HelpKey>Unlink</HelpKey> düyməsi olur. Bağlı deyilsə <HelpKey>Link</HelpKey> düyməsi görünür və
            onu basanda provayderin giriş ekranına yönəlir, geri qayıdanda Təhlükəsizlik səhifəsinə düşürsünüz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: API açarı yarat və ləğv et">
        <HelpStep n={1}>
          <p>
            <strong>API Keys</strong> bölməsində sağ yuxarıdakı <HelpKey>New API Key</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sarımtıl çərçivəli forma açılır: <strong>Key Name</strong> sahəsi, <strong>Scopes</strong> siyahısı
            (hər modul üçün ayrı <HelpKey>read</HelpKey> və <HelpKey>write</HelpKey> düymələri) və{" "}
            <strong>Expires in</strong> açılan siyahısı. Hələ açar yoxdursa, formanın olmadığı halda kəsik
            xəttli boş vəziyyət («No API keys yet…») göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Key Name</strong> yazın (məs. «My Integration»), lazım olan modullar üçün{" "}
            <HelpKey>read</HelpKey>/<HelpKey>write</HelpKey> icazələrini seçin və bitmə müddətini —{" "}
            <HelpKey>30 days</HelpKey>, <HelpKey>90 days</HelpKey>, <HelpKey>1 year</HelpKey> və ya{" "}
            <HelpKey>Never</HelpKey> — təyin edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Scopes başlığının yanında <HelpKey>Select all read</HelpKey> və <HelpKey>Clear</HelpKey> qısa
            yolları var. Seçilmiş icazə düyməsi rənglənir. Ad boşdursa və ya heç bir icazə seçilməyibsə,{" "}
            <HelpKey>Generate Key</HelpKey> düyməsi qeyri-aktiv qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Generate Key</HelpKey> düyməsini basın və açıq görünən açarı dərhal kopyalayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yaşıl qutuda «Key created! Copy it now — it won't be shown again.» yazısı və tam açar göstərilir;
            yanındakı kopya düyməsi ilə götürürsünüz. <HelpKey>Done</HelpKey> ilə bağlayanda yeni açar aşağıdakı
            siyahıda <strong>Active</strong> nişanı, prefiks, scope sayı və müddətlə peyda olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Açarı ləğv etmək üçün siyahıdakı sətrində qırmızı zibil qutusu ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Revoke this API key? This cannot be undone.» təsdiq pəncərəsi çıxır. Təsdiqdən sonra açarın nişanı{" "}
            <strong>Active</strong>-dən <strong>Revoked</strong>-a keçir və kart solğunlaşır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Tam API açarı YALNIZ yaradılan an, bir dəfə göstərilir — pəncərəni bağladıqdan sonra onu yenidən
            görmək mümkün deyil. İtirsəniz, açarı ləğv edib yenisini yaradın. Açarın ləğvi geri qaytarılmır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          API açarı yaradanda yalnız həqiqətən lazım olan icazələri verin: çox inteqrasiya üçün{" "}
          <HelpKey>read</HelpKey> kifayət edir, <HelpKey>write</HelpKey>-ı yalnız sistem məlumatı dəyişməlidirsə
          əlavə edin. Müddət təyin etmək (məs. <HelpKey>90 days</HelpKey>) açar sızsa belə təhlükə pəncərəsini
          daraldır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          2FA və bağlı hesablar sizin şəxsi hesabınıza aiddir. <strong>Avtorizasiya metodları</strong> isə
          təşkilat səviyyəsindədir — Google/Microsoft girişini bağlasanız, bu, təşkilatın giriş səhifəsinə
          təsir edir. Google/Microsoft yalnız serverdə müvafiq <code>.env</code> dəyişənləri (CLIENT_ID /
          CLIENT_SECRET) qurulduqda açıla bilir. API açarları təşkilatınızın məlumatlarına proqram girişi
          verir — onları parol kimi qoruyun.
        </p>
      </HelpCallout>
    </div>
  )
}
