"use client"

/**
 * SMTP Settings — help article (Azerbaijani).
 * en.tsx-in güzgüsü: idarə olunan e-poçt + hazır şablonlar + SMTP formu +
 * Gmail App-parolu + test məktubu. Yalnız page.tsx və
 * /api/v1/settings/smtp(/test) ilə təsdiqlənən məlumat.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SmtpHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Bu nə üçün vacibdir">
        <p>
          LeadDrive e-poçtu sizin üçün artıq göndərir. Tranzaksiya məktubları —
          qeydiyyat, şifrə sıfırlama, ticket bildirişləri —{" "}
          <strong>no-reply@mail.leaddrivecrm.org</strong> ünvanından From
          başlığında təşkilatınızın adı ilə mərkəzləşdirilmiş şəkildə göndərilir,
          müştəri cavabları isə avtomatik olaraq ticket şərhlərinə çevrilir.
        </p>
        <p>
          Bu səhifədəki SMTP formu <strong>istəyə bağlı ehtiyat variantdır</strong>:
          onu yalnız çıxan məktubların öz domeninizdən getməsini istəyirsinizsə
          doldurun. Əksər təşkilatların ona toxunmasına ehtiyac yoxdur.
        </p>
      </HelpSection>

      <HelpSection title="Öz SMTP-nizi nə vaxt qurmalı">
        <p>
          Serveri yalnız From sizin domen kimi görünməli olduqda qoşun —
          məsələn, müştərilərin idarə olunan ünvanı yox,{" "}
          <em>billing@yourcompany.com</em> görməsini istəyirsinizsə. Bu tələb
          deyilsə, formu boş saxlayın və idarə olunan e-poçtdan istifadə edin.
        </p>
        <p>
          Host, login və parol saxlanan kimi başlığın yanında{" "}
          <HelpKey>Configured</HelpKey> nişanı görünür — beləcə öz serverinizin
          işə düşüb-düşmədiyini bir baxışda bilirsiniz.
        </p>
      </HelpSection>

      <HelpSection title="Hazır şablonlar">
        <p>
          Dörd düymə məşhur provayderlər üçün host, port və TLS-i doldurur ki,
          sizə yalnız giriş məlumatlarını əlavə etmək qalsın:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Gmail">smtp.gmail.com · port 587 · TLS aktiv</HelpDef>
          <HelpDef term="Yandex">smtp.yandex.ru · port 465 · TLS aktiv</HelpDef>
          <HelpDef term="Mail.ru">smtp.mail.ru · port 465 · TLS aktiv</HelpDef>
          <HelpDef term="Outlook">smtp.office365.com · port 587 · TLS aktiv</HelpDef>
        </dl>
        <p>
          Şablon yalnız serveri, portu və TLS-i təyin edir — login, parol və
          From məlumatlarını yenə özünüz daxil edirsiniz.
        </p>
      </HelpSection>

      <HelpSection title="Qoşulmanı doldurun">
        <dl className="rounded-md border p-3">
          <HelpDef term="SMTP Server">Host ünvanı, məs. smtp.gmail.com</HelpDef>
          <HelpDef term="Port">TLS üçün 587 və ya SSL üçün 465 — 25 çox vaxt bloklanır</HelpDef>
          <HelpDef term="Use TLS">Bəli / Xeyr — port 587 üçün adətən Bəli</HelpDef>
          <HelpDef term="Login">SMTP istifadəçi adı, adətən e-poçt ünvanınız</HelpDef>
          <HelpDef term="Password">SMTP parolu və ya tətbiq parolu</HelpDef>
          <HelpDef term="From Email">Alıcıların göndərən kimi gördüyü ünvan</HelpDef>
          <HelpDef term="From Name">Alıcılara göstərilən ad</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            Şablon seçin və ya <HelpKey>SMTP Server</HelpKey> və{" "}
            <HelpKey>Port</HelpKey>-u əllə yazın, sonra{" "}
            <HelpKey>Use TLS</HelpKey>-i təyin edin. Port 465 avtomatik SSL kimi
            tutulur; TLS açarı port 587-yə aiddir.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Login</HelpKey> və <HelpKey>Password</HelpKey>, sonra{" "}
            <HelpKey>From Email</HelpKey> və <HelpKey>From Name</HelpKey> daxil
            edin. From Email boş qalsa, login ünvanı əvəzə qoyulur.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Save Settings</HelpKey> düyməsini basın. Server, login və
            parol doldurulana qədər düymə qeyri-aktiv qalır.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Gmail istifadə edirsiniz?</strong> Adi Gmail parolu işləməz.
            İki faktorlu autentifikasiyanı aktiv edin,{" "}
            <strong>myaccount.google.com/apppasswords</strong> ünvanında{" "}
            <strong>tətbiq parolu</strong> yaradın (&quot;Mail&quot; seçin) və
            16 simvolluq kodu parol sahəsinə yapışdırın. Host-da
            &quot;gmail&quot; görünən kimi səhifə bu xatırlatmanı göstərir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Test məktubu göndərin">
        <HelpStep n={1}>
          <p>
            Əvvəlcə parametrləri saxlayın — qoşulma qurulana qədər{" "}
            <HelpKey>Send Test Email</HelpKey> qeyri-aktiv qalır.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Test email address</HelpKey> sahəsinə istənilən ünvanı yazın
            və <HelpKey>Send Test Email</HelpKey> düyməsini basın. LeadDrive
            serverinizə canlı qoşulma açır və serveri, göndərəni və vaxtı
            göstərən brendli təsdiq məktubu göndərir.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Test alınmasa, xəta nəyin səhv olduğunu deyir:{" "}
            <em>qoşulmaq mümkün olmadı</em> (yanlış host və ya port),{" "}
            <em>avtorizasiya xətası</em> (yanlış login və ya parol),{" "}
            <em>qoşulma vaxtı bitdi</em> (server cavab vermir) və ya{" "}
            <em>SSL sertifikatı</em> problemi (TLS-i söndürməyə cəhd edin).
            Göstərdiyi sahəni düzəldin və yenidən saxlayın.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          SMTP parametrlərini saxlamaq <strong>parametrlər</strong> üzrə yazma
          icazəsi tələb edir və hər şey təşkilatınızla məhdudlaşır. Parolunuz
          serverdə saxlanılır və heç vaxt brauzerə geri göndərilmir — o, həmişə
          maskalanmış <code>••••••••</code> kimi yüklənir. Saxlayanda maskaya
          toxunmasanız, köhnə parol qalır; əvəz etmək üçün onu silib yenisini
          yazın. Test endpoint-i həmçinin From sahələrindən sətir keçidlərini
          silərək e-poçt başlığı inyeksiyasının qarşısını alır.
        </p>
      </HelpCallout>
    </div>
  )
}
