"use client"

/**
 * VoIP Parametrləri — kömək məqaləsi (Azərbaycanca).
 * en.tsx-in güzgüsü: Tənzimləmələr → VoIP (/settings/voip) — kliklə zəng,
 * avtomatik zəng qeydiyyatı və zəng yazma üçün telefon provayderini qoşmaq.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SettingsVoipHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Bu nə üçün vacibdir">
        <p>
          Bu ekranda CRM-ə <strong>telefon provayderini</strong> qoşursunuz. Qurulduqdan sonra
          kontakt və ya sövdələşmədəki telefon nömrəsi kliklə zəngə çevrilir, hər zəng həmin
          kartda <strong>avtomatik qeydə alınır</strong>, açsanız isə zənglər{" "}
          <strong>yazıla</strong> bilər.
        </p>
        <p>
          Hər təşkilata dəqiq <strong>bir</strong> provayder qurulur. Komandanızın artıq istifadə
          etdiyini seçin, giriş məlumatlarını daxil edin, yadda saxlayın və aktiv edin.
        </p>
      </HelpSection>

      <HelpSection title="Provayderinizi seçin">
        <p>
          <HelpKey>VoIP Provayder</HelpKey> açılan siyahısında dörd seçim var. Hər biri ayrı giriş
          məlumatları gözləyir, ona görə aşağıdakı forma keçid edəndə dəyişir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Twilio">
            Bulud telefoniya — qlobal əhatə və ən asan quraşdırma üçün ən yaxşısı. Alınmış telefon
            nömrəsi olan Twilio hesabı tələb edir.
          </HelpDef>
          <HelpDef term="3CX">
            Yerli və ya bulud ATS, 3CX Call Control API vasitəsilə qoşulur.
          </HelpDef>
          <HelpDef term="Asterisk">
            Özünüzdə yerləşdirilən açıq mənbə ATS, Asterisk REST Interface (ARI) vasitəsilə qoşulur.
          </HelpDef>
          <HelpDef term="Custom SIP">
            SIP.js vasitəsilə brauzerdən zəng — hər hansı standartlara uyğun SIP serverinə WebSocket
            (WSS) bağlantısı üzərindən.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Giriş məlumatlarını doldurun">
        <p>
          İkinci kartda yalnız seçdiyiniz provayderə lazım olan sahələr göstərilir. Gizli sahələr
          (tokenlər, parollar, SIP sirri) parol sahəsi kimi daxil edilir.
        </p>
        <HelpStep n={1}>
          <p>
            <strong>Twilio</strong> — <HelpKey>Account SID</HelpKey>, <HelpKey>Auth Token</HelpKey>{" "}
            və çıxış zənglərini etdiyiniz <HelpKey>Twilio Nömrəsi</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>3CX</strong> — <HelpKey>Server URL</HelpKey> (məsələn,{" "}
            <em>https://mycompany.3cx.eu</em>), zəng edən <HelpKey>Daxili nömrə</HelpKey> və{" "}
            <HelpKey>API Açar</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Asterisk</strong> — <HelpKey>ARI Host</HelpKey> və <HelpKey>ARI Port</HelpKey>{" "}
            (standart 8088), <HelpKey>İstifadəçi adı</HelpKey> / <HelpKey>Şifrə</HelpKey>,{" "}
            <HelpKey>Dialplan konteksti</HelpKey> (standart <em>from-internal</em>) və{" "}
            <HelpKey>Zəng edənin nömrəsi</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <strong>Custom SIP</strong> — <HelpKey>SIP Server</HelpKey> və{" "}
            <HelpKey>SIP Port</HelpKey> (standart 5060), <HelpKey>SIP Domen</HelpKey>,{" "}
            <HelpKey>Nəqliyyat</HelpKey> (WSS, TLS, TCP və ya UDP) və{" "}
            <HelpKey>İstifadəçi adı</HelpKey> / <HelpKey>Gizli açar</HelpKey>.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Sahələrin altında iki açar var. <strong>Zəngləri yaz</strong> provayderdən çıxış
            zənglərini yazmasını istəyir; <strong>VoIP-u aktiv et</strong> konfiqurasiyanı işə
            salır ki, CRM-in qalan hissəsi ondan istifadə edə bilsin. Konfiqurasiya yaradıldıqda
            başlıqda <HelpKey>Aktiv</HelpKey> və ya <HelpKey>Deaktiv</HelpKey> nişanı görünür.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Yadda saxlayın, sonra yoxlayın">
        <HelpStep n={1}>
          <p>
            <HelpKey>Saxla</HelpKey> düyməsini basın. İlk saxlama konfiqurasiyanı yaradır,
            sonrakılar onu yerində yeniləyir. Uğurlu olduqda təsdiq görəcəksiniz.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Giriş məlumatlarını canlı provayderdə yoxlamaq üçün <HelpKey>Bağlantını yoxla</HelpKey>{" "}
            düyməsini basın. Nəticə elə burada görünür — uğurda yaşıl işarə, uğursuzluqda isə
            provayderin xəta mesajı ilə qırmızı işarə.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Bağlantı yoxlaması yalnız yadda saxlanmış və aktiv konfiqurasiyada
            işləyir.</strong> Ən azı bir dəfə saxlayana qədər düymə qeyri-aktiv qalır, yoxlama isə
            serverdən <em>aktiv</em> VoIP konfiqurasiyasını oxuyur — ona görə yoxlamadan əvvəl{" "}
            <strong>VoIP-u aktiv et</strong> açın və yadda saxlayın. Testin nəyi yoxladığı
            provayderdən asılıdır: Twilio hesabın giriş məlumatlarını yoxlayır, 3CX daxili nömrənin
            əlçatanlığını yoxlayır, Asterisk ARI-dən versiyasını soruşur, Custom SIP isə serverin
            WSS/TLS portunu ping edir (UDP/TCP yalnız tamlıq üçün yoxlanıla bilər, əlaqə qurulmur).
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Aktiv edildikdən sonra nə baş verir">
        <p>
          Aktiv provayderlə kontakt, şirkət və ya sövdələşmədən edilən zəng — istiqamət, «kimdən /
          kimə» nömrələri, provayder, bağlı kart və zəngi kimin etdiyi — zəng hələ başlamamış{" "}
          <strong>zəng jurnalında</strong> qeyd yaradır.
        </p>
        <HelpStep n={1}>
          <p>
            <strong>Twilio, 3CX və Asterisk</strong> zəngi server tərəfində provayderin API-si
            vasitəsilə edir.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Custom SIP</strong> SIP.js vasitəsilə brauzerdən zəng edir — server yalnız
            müştəriyə lazımi konfiqurasiyanı ötürür və jurnalı yazır.
          </p>
        </HelpStep>
        <HelpCallout kind="next">
          <p>
            Zəng jurnalları və zəng tarixçəsi aid olduqları kartlarla birlikdə yaşayır (Kontaktlar →
            Zənglər), bu tənzimləmə səhifəsində yox. Burada yalnız bağlantı qurulur.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          VoIP konfiqurasiyası təşkilatınızla məhdudlaşır — giriş məlumatlarınız və zəng
          jurnallarınız heç vaxt başqa tenant-a keçmir. Provayder sirləri yalnız siz yadda
          saxlayanda göndərilir və telefoniyanıza çatmaq üçün server tərəfində istifadə olunur;
          tokenə, ARI paroluna və SIP sirrinə hər hansı digər giriş məlumatı kimi yanaşın və sızma
          olarsa onları provayderdə dəyişin.
        </p>
      </HelpCallout>
    </div>
  )
}
