"use client"

/**
 * Communication Channels — help article (Azerbaijani).
 * Tənzimləmələr → Kanallar kataloqu ilə sinxron saxlanılır.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ChannelsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Omni-channel inbox-u quran administratorsunuz"
        goal="Kanalları düzgün ardıcıllıqla qoşmaq, hansı düymənin nə etdiyini anlamaq və mesaj, SMS, zəng kanallarını qarışdırmamaq"
      >
        <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Kanallar</HelpKey> səhifəsini açın. Bu səhifə
        kanal kataloqudur: əvvəl kateqoriyanı, sonra dəqiq provayderi seçirsiniz. Saxlanmış kanallar
        eyni səhifədə redaktə edilə bilən kartlar kimi qalır.
      </HelpScenario>

      <HelpSection title="60 saniyəlik video-tur">
        <HelpStep n={1}>
          <p>
            Yuxarıdan başlayın. Tablar kataloqu <HelpKey>Hamısı</HelpKey>,{" "}
            <HelpKey>Business Messaging</HelpKey>, <HelpKey>Zənglər</HelpKey>, <HelpKey>SMS</HelpKey>,{" "}
            <HelpKey>Email</HelpKey> və <HelpKey>Live Chat</HelpKey> bölmələrinə ayırır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Böyük provayder kartları. Hər kart kanalın nə üçün lazım olduğunu izah edir və üstündə{" "}
            <HelpKey>Qoş</HelpKey>, <HelpKey>Redaktə et</HelpKey> və ya <HelpKey>Tezliklə</HelpKey>{" "}
            vəziyyəti olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Axtarışı siyahı uzun olanda istifadə edin. Məsələn <HelpKey>whatsapp</HelpKey>,{" "}
            <HelpKey>atl</HelpKey>, <HelpKey>facebook</HelpKey> və ya <HelpKey>3cx</HelpKey> yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kartlar dərhal süzülür. Heç nə tapılmasa, axtarışı təmizləyin və tab seçin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Lazım olan provayder kartında <HelpKey>Qoş</HelpKey> düyməsini basın.{" "}
            <HelpKey>+ Kanal əlavə et</HelpKey> düyməsini yalnız xüsusi/manual qoşulma üçün istifadə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Rekvizit sahələrindən əvvəl checklist açılır. Əvvəl onu oxuyun: LeadDrive-da kanalı
            saxlamazdan əvvəl provayder tərəfində nə hazırlanmalı olduğunu göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Rekvizitləri daxil edin, saxlayın və real müştərilərlə istifadə etməzdən əvvəl bir
            nəzarətli test mesajı və ya inbound test edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Gizli sahələr redaktə zamanı boş görünür. Köhnə dəyəri saxlamaq üçün boş saxlayın; yalnız
            dəyişmək istəyirsinizsə yeni secret yazın.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Hansı kartı seçməliyəm?">
        <dl className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4">
          <HelpDef term="WhatsApp Business Platform">
            Inbox mesajları və şablonlar üçün rəsmi Meta WhatsApp Business API. Production WhatsApp
            yazışması üçün əsas kart budur.
          </HelpDef>
          <HelpDef term="Facebook Messenger">
            Facebook Page-i qoşur ki, Messenger mesajları Inbox-a gəlsin.
          </HelpDef>
          <HelpDef term="Instagram">
            Instagram Direct üçün istifadə edin. Formada göstərilən Meta/Facebook icazələri lazımdır.
          </HelpDef>
          <HelpDef term="Telegram">
            Telegram Bot qoşur. BotFather-da bot yaradın və Bot Token-i LeadDrive-a daxil edin.
          </HelpDef>
          <HelpDef term="TikTok">
            Bizim sxemdə TikTok <strong>Chatwoot</strong> vasitəsilə qoşulur. Əvvəl TikTok-u
            Chatwoot-da qoşun, sonra Chatwoot token/webhook məlumatlarını LeadDrive-a yazın.
          </HelpDef>
          <HelpDef term="ATL SMS">
            Azərbaycan üçün əsas SMS provayderi. Lokal SMS trafiki üçün ATL rekvizitlərindən istifadə edin.
          </HelpDef>
          <HelpDef term="Email">
            Google Workspace, Gmail və Other Email oxşar SMTP qurulması ilə işləyir. Provayder app
            password tələb edirsə, onu istifadə edin.
          </HelpDef>
          <HelpDef term="Zənglər">
            Telefon zəngləri mesaj kanallarından ayrıdır. Zənglər tabında Twilio, 3CX, Asterisk və
            SIP tipli provayderlər qurulur. WhatsApp Business Calling üçün ayrıca{" "}
            <HelpKey>WhatsApp Business Calling</HelpKey> kartından istifadə edin; Meta app və Cloud
            API nömrəsi calls events abunəliyinə hazır olmalıdır. WhatsApp Calling-i VoIP
            səhifəsindən qurmayın.
          </HelpDef>
          <HelpDef term="Website Chat">
            Saytınızda live-chat widget üçün istifadə olunur; mesajlar eyni inbox-a düşür.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: WhatsApp Business qoş">
        <HelpStep n={1}>
          <p>
            <HelpKey>Business Messaging</HelpKey> tabını açın və{" "}
            <HelpKey>WhatsApp Business Platform</HelpKey> kartında <HelpKey>Qoş</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            WhatsApp checklist-i. O, WhatsApp aktiv olan Meta app, permanent access token, Phone
            Number ID, WABA ID, verify token və app secret istəyir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bu dəyərləri Meta Business / developers.facebook.com-dan kopyalayın, LeadDrive-a daxil
            edin və saxlayın.
          </p>
          <HelpCallout kind="warning">
            Meta-nın public test nömrələrindən istifadə edirsinizsə, <HelpKey>hello_world</HelpKey>{" "}
            şablonu yalnız Meta public test nömrələrindən göndərilə bilər. Bu provider xətası
            gözləniləndir: problem LeadDrive formunda deyil, Meta məhdudiyyətindədir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Saxladıqdan sonra Meta-da webhook/templates tərəfini qurun və Inbox-da göründüyünü
            yoxlamaq üçün bir inbound mesaj göndərin.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Facebook və ya Instagram qoş">
        <HelpStep n={1}>
          <p>
            Page/Messenger mesajları üçün <HelpKey>Facebook Messenger</HelpKey>, Instagram Direct
            üçün isə <HelpKey>Instagram</HelpKey> seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Forma Meta App ID, App Secret, verify token və callback/redirect URL-lərini göstərir.
            URL-ləri Meta-ya olduğu kimi kopyalayın.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Əvvəl kanalı saxlayın. OAuth qoşulması yalnız App ID və secret saxlanandan sonra görünür.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: TikTok-u Chatwoot ilə qoş">
        <HelpStep n={1}>
          <p>
            TikTok-u əvvəl <HelpKey>Chatwoot</HelpKey> daxilində qoşun. LeadDrive TikTok üçün
            Chatwoot-u transport kimi istifadə edir.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            LeadDrive-da <HelpKey>TikTok</HelpKey> kartını seçin, Chatwoot access token və webhook
            secret daxil edin, sonra saxlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxlanmış kanal kataloqda yenə TikTok kimi görünür, amma texniki provayder Chatwoot-dur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Telegram qoş">
        <HelpStep n={1}>
          <p>
            <HelpKey>Business Messaging</HelpKey> tabını açın, <HelpKey>Telegram</HelpKey> seçin və{" "}
            <HelpKey>Qoş</HelpKey> düyməsini basın.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Telegram-da <HelpKey>BotFather</HelpKey> açın, support bot yaradın və ya seçin, sonra{" "}
            <HelpKey>Bot Token</HelpKey>-i LeadDrive-a kopyalayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Forma Bot Token və optional Chat ID istəyir. Saxlayın, sonra bota bir mesaj göndərin və
            dialoqun Inbox-da göründüyünü yoxlayın.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: ATL ilə SMS qoş">
        <HelpStep n={1}>
          <p>
            <HelpKey>SMS</HelpKey> tabını açın, <HelpKey>ATL SMS</HelpKey> seçin və{" "}
            <HelpKey>Qoş</HelpKey> düyməsini basın.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            ATL login, password və sender title daxil edin. Saxlayın, sonra saxlanmış kanalı redaktə
            edin və daxildəki test sahəsindən bir nəzarətli SMS testi göndərin.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Email qoş">
        <HelpStep n={1}>
          <p>
            <HelpKey>Email</HelpKey> tabını açın və <HelpKey>Google Workspace</HelpKey>,{" "}
            <HelpKey>Gmail</HelpKey> və ya <HelpKey>Other Email</HelpKey> seçin.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Mailbox SMTP password və ya app password hazırlayın, rekvizitləri LeadDrive-a daxil edin
            və kanalı saxlayın.
          </p>
          <HelpCallout kind="tip">
            Provayder Google/Gmail deyil, amma SMTP ilə göndərə bilirsə, <HelpKey>Other Email</HelpKey>{" "}
            istifadə edin.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Live Chat qoş">
        <HelpStep n={1}>
          <p>
            <HelpKey>Live Chat</HelpKey> tabını açın. LeadDrive vidceti üçün{" "}
            <HelpKey>Website Chat</HelpKey>, xarici chat provayderi söhbətləri Integrations ilə
            ötürməlidirsə <HelpKey>Custom Channel (Live Chat)</HelpKey> seçin.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Website Chat üçün <HelpKey>Tənzimləmələr → Web Chat</HelpKey> səhifəsinə keçin, vidceti
            qurun, sonra bir test visitor mesajı göndərin və Inbox-u yoxlayın.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Calls / VoIP qoş">
        <HelpStep n={1}>
          <p>
            <HelpKey>Zənglər</HelpKey> tabını açın. Adi telefon provayderləri üçün{" "}
            <HelpKey>Twilio</HelpKey>, <HelpKey>3CX</HelpKey>, <HelpKey>Asterisk</HelpKey> və ya{" "}
            <HelpKey>Custom SIP</HelpKey> istifadə edin; onlar <HelpKey>Tənzimləmələr → VoIP</HelpKey>{" "}
            səhifəsinə aparır.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>WhatsApp Business Calling</HelpKey> yalnız Meta WhatsApp Calling readiness üçün
            istifadə olunur. Bu ayrıca checklist-dir, SIP/PBX qurulması ilə eyni flow deyil.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Kanalı tap, dəyiş və ya müvəqqəti söndür">
        <HelpStep n={1}>
          <p>
            Kartı axtarış və ya tablarla tapın. Qoşulmuş kartlarda <HelpKey>Qoş</HelpKey> əvəzinə{" "}
            <HelpKey>Redaktə et</HelpKey> görünür.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Kanalın adını dəyişmək, rekvizitləri yeniləmək və ya aktiv/qeyri-aktiv etmək üçün{" "}
            <HelpKey>Redaktə et</HelpKey> basın.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Müvəqqəti dayandırmaq üçün kanalı qeyri-aktiv edin. Yalnız saxlanmış rekvizitləri tam
            silmək istəyəndə kanalı silin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Kanallar təşkilatla məhdudlaşır. Başqa tenant sizin tokenləri görmür və istifadə etmir.
          Secret sahələri oxunanda maskalanır: redaktə zamanı boş secret sahəsi “saxlanmış dəyəri
          saxla” deməkdir, “secret itib” demək deyil.
        </p>
      </HelpCallout>
    </div>
  )
}
