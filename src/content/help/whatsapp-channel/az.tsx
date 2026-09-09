"use client"

/**
 * WhatsApp Business kanalı — kömək məqaləsi (Azərbaycan dili).
 * Yalnız Tənzimləmələr → Kanallar → WhatsApp səhifəsini əhatə edir:
 * qoşulmanın yoxlanması, webhook URL, avtomatik bildiriş şablonlarının
 * təyini və Meta-dan şablonların sinxronizasiyası. qoşulma məlumatlarının
 * doldurulması (/settings/channels) bura DAXİL DEYİL — bu səhifə yalnız
 * oxuma + yoxlama + sinxronizasiya rejimindədir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function WhatsappChannelHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dəstək və ya marketinq administratorusunuz"
        goal="WhatsApp Business bağlantısının işlədiyini yoxlamaq, Meta-dan təsdiqlənmiş şablonları gətirmək və hansı şablonun hansı sistem hadisəsində avtomatik göndəriləcəyini təyin etmək"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Kanallar</HelpKey> →{" "}
        <HelpKey>WhatsApp Business</HelpKey> yolu ilə çatırsınız. Bütün məlumat — qoşulma məlumatları,
        şablonlar və bildiriş təyinatları — yalnız sizin təşkilatınız (tenant) üçündür: öz WABA-nız,
        öz nömrəniz, öz təsdiqlənmiş şablonlarınız. <strong>Vacib:</strong> bu səhifə şablonları{" "}
        <strong>yaratmır</strong> və qoşulma məlumatlarını <strong>doldurmur</strong> — şablonlar Meta
        Business Manager-də yaradılıb moderasiyadan keçir, qoşulma məlumatları isə{" "}
        <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Kanallar</HelpKey> ekranında doldurulur. Burada
        siz yalnız <strong>yoxlayır, sinxronlaşdırır və xəritələyirsiniz</strong>.
        Bu səhifə messaging-i yoxlayır. WhatsApp Business Calling eyni Meta app və nömrədən istifadə
        edir, amma calls events abunəliyi və Inbox call controls{" "}
        <HelpKey>Tənzimləmələr → Kanallar</HelpKey> içindəki{" "}
        <HelpKey>WhatsApp Business Calling</HelpKey> checklist ilə hazırlanır.{" "}
        <HelpKey>Tənzimləmələr → VoIP</HelpKey> yalnız Twilio, 3CX, Asterisk və ya SIP kimi adi
        telefon provayderləri üçündür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda yaşıl mesaj ikonası ilə <HelpKey>WhatsApp Business</HelpKey> adı və altında qısa
          izah durur. Altında dörd kart yuxarıdan aşağı sıralanır: <strong>Qoşulmanı yoxla</strong>,{" "}
          <strong>Webhook URL</strong>, <strong>Avtomatik bildirişlər</strong> və{" "}
          <strong>Şablonlar</strong>. Kanal hələ qurulmayıbsa, bir neçə yerdə sarı xəbərdarlıq
          zolaqları görünür və bəzi düymələr söndürülmüş qalır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Qoşulma məlumatları">
            WhatsApp bağlantısının açarları — access token və phone number ID. Bu səhifədə yalnız
            yoxlanılır; doldurulması <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Kanallar</HelpKey>{" "}
            ekranında olur.
          </HelpDef>
          <HelpDef term="Verified name">
            Meta-nın WhatsApp Business profilinizə təsdiqlədiyi rəsmi ad — yoxlama uğurlu olanda
            qaytarılır.
          </HelpDef>
          <HelpDef term="Webhook URL">
            Meta-nın gələn mesajları sizə ötürdüyü ünvan. Bunu Meta Business Manager-də yapışdırmaq
            lazımdır.
          </HelpDef>
          <HelpDef term="Şablon (template)">
            Meta-da yaradılıb təsdiqlənmiş hazır mesaj forması. 24 saatlıq xidmət pəncərəsindən kənarda
            müştəriyə yalnız təsdiqlənmiş şablonla yazmaq olar.
          </HelpDef>
          <HelpDef term="Approved (təsdiqlənmiş)">
            Meta tərəfindən moderasiyadan keçmiş şablon statusu. Yalnız <strong>Approved</strong>{" "}
            şablonlar avtomatik bildiriş açılan siyahılarında seçilə bilir.
          </HelpDef>
          <HelpDef term="24 saatlıq xidmət pəncərəsi">
            Müştərinin son mesajından sonrakı 24 saat — bu müddətdə sərbəst mətn yaza bilərsiniz;
            müddət bitəndən sonra yalnız təsdiqlənmiş şablon işləyir.
          </HelpDef>
          <HelpDef term="WhatsApp zəngləri">
            WhatsApp Business Calling bu messaging səhifəsindən ayrıca hazırlanır. WhatsApp Business
            API credentials saxlayın, Meta webhook-u app.leaddrivecrm.org üzərində calls events üçün
            abunə edin və Inbox-da bir controlled inbound call test edin.
          </HelpDef>
        </dl>
        <p>
          <strong>Qoşulmanı yoxla</strong> kartında kanalın qurulub-qurulmadığı, qurulubsa
          verified name və Phone ID, həmçinin son yoxlama vaxtı göstərilir; sağda{" "}
          <HelpKey>Qoşulma məlumatlarını redaktə et</HelpKey> və <HelpKey>Yoxla</HelpKey> düymələri var.{" "}
          <strong>Webhook URL</strong> kartında kopyalana bilən ünvan göstərilir.{" "}
          <strong>Avtomatik bildirişlər</strong> kartında tiket statusları üzrə şablon seçimləri, sorğu
          və journey şablonları və <HelpKey>Saxla</HelpKey> düyməsi olur. <strong>Şablonlar</strong>{" "}
          kartında Meta-dan gələn şablonların siyahısı və <HelpKey>Meta ilə sinxronlaşdır</HelpKey>{" "}
          düyməsi var.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: bağlantını yoxla">
        <HelpStep n={1}>
          <p>
            <strong>Qoşulmanı yoxla</strong> kartına baxın. Altdakı kiçik mətndə kanalın
            vəziyyəti yazılır — qurulubsa verified name, Phone ID və son yoxlama vaxtı; qurulmayıbsa
            «WhatsApp qurulmayıb» xəbərdarlığı.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kanal qurulmayıbsa sarı rəngli «WhatsApp qurulmayıb — /settings/channels-da qoşulma məlumatları
            doldurun» mətni çıxır. Qurulubsa boz mətndə «Qurulub: &lt;ad&gt;», «Phone ID: …» və «Son
            yoxlama: …» göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yoxla</HelpKey> düyməsini basın. (Access token və ya nömrəni
            dəyişmək lazımdırsa, yanındakı <HelpKey>Qoşulma məlumatlarını redaktə et</HelpKey> sizi{" "}
            <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Kanallar</HelpKey> ekranına aparır.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yoxlama gedərkən «Yoxlanılır…» yazısına keçir. Uğurlu olanda aşağıda yaşıl zolaq
            çıxır: «Verified: &lt;ad&gt;» və «Phone: &lt;nömrə&gt;». Alınmasa, qırmızı zolaqda Meta-dan
            gələn xəta mətni göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: webhook URL-i Meta-ya qoş">
        <HelpStep n={1}>
          <p>
            <strong>Webhook URL</strong> kartında göstərilən ünvanın yanındakı kopyalama (sənəd
            ikonalı) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            URL təşkilat slug-ınızla birlikdə monospace mətn kimi göstərilir
            (məs. «…/api/v1/webhooks/whatsapp?t=&lt;tenant&gt;»). Kopyaladıqdan sonra düymədəki ikona
            qısa müddət yaşıl tik işarəsinə dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Kartdakı izahdakı <HelpKey>developers.facebook.com</HelpKey> linkini açın və oradan{" "}
            WhatsApp → Configuration → Webhook bölməsində kopyaladığınız URL-i yapışdırın. Verify
            token-i isə kanal parametrlərindəki ilə eyni qoyun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Link yeni nişanda Meta-nın developer panelini açır. Verify token-in harada təyin
            edildiyini izah «(bax /settings/channels)» qeydi ilə göstərir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Meta-dan şablonları sinxronlaşdır">
        <HelpStep n={1}>
          <p>
            Aşağıda <strong>Şablonlar</strong> kartına keçin. Sağ yuxarıdakı{" "}
            <HelpKey>Meta ilə sinxronlaşdır</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymədəki dairəvi ox ikonası fırlanmağa başlayır və mətn «Sinxronlaşdırılır…» olur.
            Bitəndə «Sinxronlaşdırıldı: N şablon» mesajı çıxır və başlıqdakı say (<HelpKey>Şablonlar
            (N)</HelpKey>) yenilənir. Başlığın altında «Son sinxronizasiya: …» vaxtı yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Siyahıdakı istənilən şablon sətrini açmaq üçün üzərinə klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə şablonun adı (monospace), dili, kateqoriyası və status nişanı görünür:{" "}
            <strong>approved</strong> (yaşıl), <strong>pending</strong> (sarı),{" "}
            <strong>rejected</strong> (qırmızı), <strong>disabled</strong> (boz) və ya{" "}
            <strong>paused</strong> (mavi). Dəyişəni varsa «N dəyişən» qeydi olur. Sətir açılanda
            Header, Body, Footer mətnləri, dəyişənlərin siyahısı ({"{{...}}"}) və varsa düymələrin
            JSON-u göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Heç bir şablon yoxdursa, kartda boş vəziyyət mətni görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Şablon yoxdur» başlığı və altında «Meta Business Manager-də şablonlar yaradın, sonra
            “Meta ilə sinxronizasiya” düyməsinə basın» ipucusu görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: avtomatik bildirişləri təyin et">
        <HelpStep n={1}>
          <p>
            <strong>Avtomatik bildirişlər</strong> kartına keçin. <strong>Tiket statusu dəyişikliyi
            bildirişləri</strong> bölməsində hər status (məs. <HelpKey>new</HelpKey>,{" "}
            <HelpKey>open</HelpKey>, <HelpKey>resolved</HelpKey>) qarşısındakı açılan siyahıdan bir
            təsdiqlənmiş şablon seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə solda status nişanı, sağda açılan siyahı var. Siyahıda yalnız{" "}
            <strong>approved</strong> şablonlar «ad (dil)» formatında görünür, ən üstdə isə{" "}
            «— göndərmə —» seçimi durur. Status üçün «— göndərmə —» qalsa, həmin statusda bildiriş
            getmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Aşağıdakı iki açılan siyahıdan istəyə bağlı olaraq <strong>Sorğu dəvəti şablonu</strong>{" "}
            (survey trigger WhatsApp ilə işə düşəndə) və <strong>Journey standart şablonu</strong>{" "}
            (send_whatsapp addımı öz şablonunu göstərməyəndə fallback) seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər birinin altında nə zaman işlədiyini izah edən kiçik mətn var. Bu siyahılar da yalnız
            approved şablonları və ən üstdə «— göndərmə —» seçimini göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sağ yuxarıdakı <HelpKey>Saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Saxlanılır...» yazısına keçir, sonra qısa müddət «Saxlanıldı» təsdiqi görünür və
            bir neçə saniyəyə yox olur. Kanal hələ qurulmayıbsa, <HelpKey>Saxla</HelpKey> düyməsi və
            bütün açılan siyahılar söndürülmüş qalır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Avtomatik bildiriş siyahılarında yalnız <strong>təsdiqlənmiş (approved)</strong> şablonlar
          görünür. Siyahılar boşdursa və ya «Təsdiqlənmiş şablon yoxdur» mətni çıxırsa, əvvəlcə{" "}
          <HelpKey>Meta ilə sinxronlaşdır</HelpKey> düyməsini basın — şablonlar gəlib təsdiq statusu
          aldıqdan sonra seçimə düşür.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bir status (və ya sorğu/journey) üçün «— göndərmə —» qalsa, həmin hadisədə WhatsApp bildirişi{" "}
          <strong>ümumiyyətlə getmir</strong> — bu, xəta deyil, müştəri üçün heç nə görünmür. Bildirişin
          getməsini istəyirsinizsə, mütləq bir approved şablon seçib <HelpKey>Saxla</HelpKey> ilə
          təsdiqləyin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün qoşulma məlumatları, şablonlar və bildiriş təyinatları təşkilatınızla məhdudlaşır — başqa
          tenant-ın WhatsApp konfiqurasiyasını görmür və dəyişə bilmirsiniz. Webhook URL-i sizin
          təşkilat slug-ınızı daşıyır, ona görə gələn mesajlar düzgün tenant-a yönəlir. Access
          token-in özü bu səhifədə göstərilmir — yalnız yoxlanır.
        </p>
      </HelpCallout>
    </div>
  )
}
