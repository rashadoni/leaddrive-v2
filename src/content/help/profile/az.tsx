"use client"

/**
 * Profilim (/profile) — help article (Azerbaijani).
 * Self-service "şəxsi kabinet": bütün rollar üçün açıqdır (/settings deyil).
 * Altı kart: Şəxsi məlumatlar (avatar + ad/telefon/şöbə/e-poçt + rol),
 * Şifrəni dəyiş, Təhlükəsizlik (2FA statusu + bütün cihazlardan çıxış),
 * Dil və region, Görünüş (tema + fon), Fəaliyyət (son daxilolma + bildirişlər).
 * Yalnız real UI təsvir edilir — heç nə uydurulmur.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ProfileHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="LeadDrive istifadəçisisiniz — satış, dəstək, baxış və ya administrator, fərqi yoxdur"
        goal="Öz hesabınızı idarə etmək: ad və əlaqə məlumatları, şifrə, dil və saat qurşağı, tema və fon, daxilolma tarixçəsi"
      >
        Bu səhifə sizin <strong>şəxsi kabinetiniz</strong>dir və başlığı{" "}
        <HelpKey>Profilim</HelpKey>, altında «Hesabınızı, təhlükəsizliyi və tənzimləmələri idarə edin»
        izahıdır. <HelpKey>Tənzimləmələr</HelpKey>-dən (yalnız administratorlar üçün) FƏRQLİ olaraq, bu
        səhifə BÜTÜN rollar üçün açıqdır — burada etdiyiniz dəyişikliklər yalnız <strong>sizin öz
        hesabınıza</strong> aiddir, başqa istifadəçilərə yox.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Səhifə yuxarıdan aşağıya altı kartdan ibarətdir: <strong>Şəxsi məlumatlar</strong>,{" "}
          <strong>Şifrəni dəyiş</strong>, <strong>Təhlükəsizlik</strong>, <strong>Dil və region</strong>,{" "}
          <strong>Görünüş</strong> və <strong>Fəaliyyət</strong>. Səhifə açılarkən məlumatlar yüklənənə
          qədər boz «yüklənmə» zolaqları görünür.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Şəxsi məlumatlar">Avatar (profil şəkli), Ad, Telefon, Şöbə, E-poçt sahələri və dəyişdirilə bilməyən rol nişanı.</HelpDef>
          <HelpDef term="Rol">Sistemdəki rolunuz (məs. admin, sales). Yalnız oxunur — özünüz dəyişə bilməzsiniz.</HelpDef>
          <HelpDef term="Şifrəni dəyiş">Daxil olmaq üçün istifadə etdiyiniz şifrəni yeniləmək: cari, yeni və təsdiq sahələri.</HelpDef>
          <HelpDef term="Təhlükəsizlik">İki mərhələli doğrulamanın (autentifikator + SMS) cari vəziyyəti və bütün cihazlardan çıxış düyməsi.</HelpDef>
          <HelpDef term="Dil və region">Görünüş dili (Rus / Azərbaycan / İngilis) və saat qurşağı seçimi.</HelpDef>
          <HelpDef term="Görünüş">Tema açarı (İşıqlı / Qaranlıq) və fon şəkli seçici.</HelpDef>
          <HelpDef term="Fəaliyyət">Son daxilolma tarixi, ümumi daxilolmaların sayı və bildiriş tənzimləmələrinə keçid.</HelpDef>
        </dl>
        <p>
          Bütün kartlar bir sütunda, mərkəzdə yığcam şəkildə düzülür. Hər dəyişikliyin nəticəsi sağ
          aşağıda kiçik bildiriş (toast) kimi görünür — məsələn «Yadda saxlanıldı» və ya xəta mesajı.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: şəxsi məlumatları redaktə et və avatar yüklə">
        <HelpStep n={1}>
          <p>
            <strong>Şəxsi məlumatlar</strong> kartında <strong>Ad</strong>, <strong>Telefon</strong>,{" "}
            <strong>Şöbə</strong> və <strong>E-poçt</strong> sahələrini lazımi kimi dəyişin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sahənin öz yer tutucusu var: ad üçün «Tam adınız», telefon üçün «+994 50 000 00 00»,
            şöbə üçün «məs. Satış», e-poçt üçün «siz@example.com». Aşağıda rol nişanı (məs.{" "}
            <strong>admin</strong>) durur, amma onu redaktə edə bilməzsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Profil şəkli üçün avatarın yanındakı <HelpKey>Şəkil yüklə</HelpKey> düyməsini basın və
            kompüterinizdən şəkil seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymənin altında «PNG, JPG, WEBP və ya GIF, 2 MB-a qədər» ipucusu var. Yükləmə zamanı düymə
            «Yüklənir…» yazısına və fırlanan ikona keçir; uğurlu olduqda yeni şəkil dərhal dairəvi
            avatarda görünür və «Şəkil yeniləndi» bildirişi çıxır. Hələ şəkil yoxdursa, avatar yerində
            adınızın və ya e-poçtunuzun ilk hərfi göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sahələri dəyişdikdən sonra sağ aşağıdakı <HelpKey>Yadda saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Yadda saxlanılır…» yazısına və fırlanan ikona keçir, sonra «Yadda saxlanıldı»
            bildirişi çıxır. Heç nə dəyişməmisinizsə də, sistem onsuz da «Yadda saxlanıldı» göstərir.
            E-poçtu başqasının artıq istifadə etdiyi ünvanla əvəz etsəniz, «Bu e-poçt artıq başqa
            istifadəçi tərəfindən istifadə olunur» xətası çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: şifrəni dəyiş">
        <HelpStep n={1}>
          <p>
            <strong>Şifrəni dəyiş</strong> kartında <strong>Cari şifrə</strong>, <strong>Yeni
            şifrə</strong> və <strong>Yeni şifrəni təsdiqlə</strong> sahələrini doldurun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər üç sahə nöqtələrlə gizlədilir. Üç sahənin hamısı dolana qədər aşağıdakı{" "}
            <HelpKey>Şifrəni yenilə</HelpKey> düyməsi qeyri-aktiv (sönük) qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Şifrəni yenilə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yeni şifrə ən azı 12 simvoldan, böyük və kiçik hərfdən, rəqəmdən və xüsusi simvoldan ibarət
            olmalıdır. Siyasət ödənmirsə server çatışmayan tələbi göstərir; təsdiq uyğun gəlmirsə «Yeni
            şifrə və təsdiq uyğun gəlmir» xətası çıxır. Cari şifrə yanlışdırsa «Cari şifrə
            yanlışdır» göstərilir. Uğurlu olduqda «Şifrə dəyişdirildi, zəhmət olmasa yenidən daxil olun»
            bildirişi çıxır və qısa müddətdən sonra sizi avtomatik <strong>çıxış</strong> edib login
            səhifəsinə yönləndirir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Şifrə dəyişdikdən sonra cari sessiyanız etibarsız olur, ona görə sistem sizi avtomatik çıxış
            edir — bu normaldır. Yeni şifrə ilə yenidən daxil olun.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: təhlükəsizliyə bax və bütün cihazlardan çıx">
        <HelpStep n={1}>
          <p>
            <strong>Təhlükəsizlik</strong> kartında iki mərhələli doğrulamanın vəziyyətinə baxın:{" "}
            <strong>Autentifikator tətbiqi (2FA)</strong> və <strong>SMS doğrulama</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətrin yanında yaşıl <strong>Aktiv</strong> və ya boz <strong>Deaktiv</strong> nişanı
            durur. Bunlar yalnız vəziyyəti GÖSTƏRİR — onları bu səhifədə yandırıb-söndürə bilməzsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            2FA-nı qurmaq və ya dəyişmək üçün <HelpKey>Təhlükəsizlik tənzimləmələrini idarə et</HelpKey>{" "}
            keçidini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sizi ayrıca <HelpKey>Tənzimləmələr → Təhlükəsizlik</HelpKey> səhifəsinə aparır; iki mərhələli
            doğrulamanın faktiki qurulması orada edilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bütün cihazlardan çıxmaq üçün kartın altındakı qırmızı <HelpKey>Bütün cihazlardan çıx</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Bütün cihazlardan çıxılsın? Bura daxil olmaqla hər yerdən çıxış edəcəksiniz.» təsdiq
            pəncərəsi açılır. Təsdiqlədikdən sonra bütün aktiv sessiyalar (cari daxil olmaqla) bağlanır
            və sizi login səhifəsinə yönləndirir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Bütün cihazlardan çıx</strong> bu cihaz da daxil olmaqla bütün aktiv sessiyaları
            bağlayır — telefon, başqa brauzer, hər yer. Hesabınızın oğurlandığından şübhələndiyiniz
            zaman istifadə edin; bundan sonra hər cihazda yenidən daxil olmalı olacaqsınız.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: dili və saat qurşağını dəyiş">
        <HelpStep n={1}>
          <p>
            <strong>Dil və region</strong> kartında <strong>Dil</strong> açılan siyahısından birini
            seçin: <HelpKey>Rus</HelpKey>, <HelpKey>Azərbaycan</HelpKey> və ya <HelpKey>İngilis</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçim yadda saxlanır, «Dil yeniləndi» bildirişi çıxır və səhifə dərhal yenilənərək bütün
            interfeysi yeni dildə göstərir. Bu seçim hesabınıza yazılır — başqa cihazda da növbəti
            açılışda tətbiq olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Yanındakı <strong>Saat qurşağı</strong> açılan siyahısından öz qurşağınızı seçin (məs.{" "}
            <HelpKey>Asia/Baku</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahıda regional qısa siyahı var: Europe/Warsaw, Asia/Baku, Europe/Moscow, Europe/London,
            Europe/Istanbul, Europe/Kyiv, Asia/Dubai, America/New_York və UTC. Seçəndə «Saat qurşağı
            yeniləndi» bildirişi çıxır; seçim tətbiq olunarkən siyahı qısa müddət qeyri-aktiv olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: temanı və fonu dəyiş">
        <HelpStep n={1}>
          <p>
            <strong>Görünüş</strong> kartında <strong>Tema</strong> açarındakı <HelpKey>İşıqlı</HelpKey>{" "}
            və ya <HelpKey>Qaranlıq</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açar iki düyməli kapsuldur; aktiv olan rəngli (vurğulu) görünür və yanında uyğun ikona —
            günəş (İşıqlı) və ya ay (Qaranlıq) — durur. Basan kimi bütün interfeysin rəng sxemi dərhal
            dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Fon şəklini dəyişmək üçün <strong>Fon şəkli</strong> sətrindəki seçicini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mövcud fon seçimlərini göstərən popover açılır; birini seçəndə fon dərhal tətbiq olunur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Fəaliyyət kartı">
        <p>
          Ən aşağıdakı <strong>Fəaliyyət</strong> kartı iki xanada{" "}
          <strong>Son daxilolma</strong> tarixini (heç vaxt olmayıbsa «Heç vaxt») və{" "}
          <strong>Ümumi daxilolmalar</strong> sayını göstərir. Altında <HelpKey>Bildiriş
          tənzimləmələri</HelpKey> keçidi var — onu basanda bildiriş tənzimləmələri səhifəsinə keçirsiniz.
          Bu kart yalnız məlumat göstərir; burada redaktə ediləsi sahə yoxdur.
        </p>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Telefon və ya şöbə sahəsini təmizləyib boş yadda saxlasanız, həmin məlumat hesabınızdan silinir
          — sonradan istənilən vaxt yenidən doldura bilərsiniz. Dil dəyişikliyi səhifəni yeniləyir, ona
          görə əvvəlcə şəxsi məlumatları yadda saxlayın, sonra dili dəyişin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bu səhifə yalnız <strong>sizin öz hesabınızı</strong> idarə edir — başqa istifadəçilərə təsir
          etmir. Rol sahəsi yalnız oxunur; onu administrator <HelpKey>Tənzimləmələr</HelpKey>-dən təyin
          edir. 2FA-nın faktiki qurulması və şifrə siyasəti ayrıca təhlükəsizlik səhifəsində idarə olunur.
        </p>
      </HelpCallout>
    </div>
  )
}
