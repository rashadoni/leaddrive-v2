"use client"

/**
 * Integrations & API Keys — help article (Azerbaijani).
 * en.tsx-in güzgüsü: Tənzimləmələr → İnteqrasiyalar (webhook-lar, Google
 * Calendar, Slack, Zapier) + Tənzimləmələr → API açarları (Bearer-token ilə
 * proqram girişi).
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function IntegrationsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Bu nə üçün vacibdir">
        <p>
          İki tənzimləmə səhifəsi CRM-inizi xarici dünya ilə bağlayır.{" "}
          <strong>İnteqrasiyalar</strong> məlumatı <em>çölə</em> ötürür — webhook-lar
          hadisələrdə işə düşür, Google Calendar sinxronlaşır, Slack bildiriş alır.{" "}
          <strong>API açarları</strong> isə xarici sistemlərə REST API vasitəsilə
          məlumatınızı <em>içəri</em> oxuyub yazmağa imkan verir.
        </p>
        <p>
          Buradakı hər şey təşkilatınızla məhdudlaşır. Webhook yalnız öz tenant-ınızın
          hadisələrini görür, API açarı isə yalnız öz tenant-ınızın məlumatına toxunur.
        </p>
      </HelpSection>

      <HelpSection title="Webhook-lar — hadisələri istənilən URL-ə göndər">
        <p>
          Webhook seçilmiş hadisə baş verən kimi nəzarət etdiyiniz URL-ə JSON göndərir.
          Maraqlandığınız hadisələri seçirsiniz — çağırışı LeadDrive özü edir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Kontaktlar">contact.created, contact.updated, contact.deleted</HelpDef>
          <HelpDef term="Sövdələr">deal.created, deal.updated, deal.stage_changed</HelpDef>
          <HelpDef term="Lidlər">lead.created, lead.updated</HelpDef>
          <HelpDef term="Ticketlər">ticket.created, ticket.updated, ticket.resolved</HelpDef>
          <HelpDef term="Şirkətlər">company.created, company.updated</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            <HelpKey>Webhook əlavə et</HelpKey> düyməsini basın, təyinat URL-ini yapışdırın
            və onu işə salmalı hadisələri seçin (ən azı bir). <HelpKey>Webhook yarat</HelpKey>{" "}
            ilə saxlayın.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Yaradılışda bir dəfə göstərilən <strong>imza sirri</strong> alırsınız — onu
            kopyalayın. Webhook-un yanındakı yaşıl / boz nöqtə onu <em>aktiv</em> ya{" "}
            <em>passiv</em> edir; zibil işarəsi onu silir.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Hər çatdırılma <code>{`{ event, timestamp, organizationId, data }`}</code>{" "}
            JSON gövdəsi və üç başlıqla bir <HelpKey>POST</HelpKey>-dur:{" "}
            <HelpKey>X-Webhook-Signature</HelpKey> (gövdənin HMAC-SHA256-sı, sizin sirrlə),{" "}
            <HelpKey>X-Webhook-Event</HelpKey> və <HelpKey>X-Webhook-Attempt</HelpKey>.
          </p>
        </HelpStep>
        <HelpCallout kind="security">
          <p>
            Məlumata güvənməzdən əvvəl həmişə <strong>imzanı yoxlayın</strong>: xam gövdənin
            HMAC-SHA256-sını sirrinizlə yenidən hesablayıb{" "}
            <HelpKey>X-Webhook-Signature</HelpKey> ilə müqayisə edin. Çatdırılma şəbəkə
            xətaları və ya 5xx / 429 zamanı gecikmə ilə (1s, 4s, 16s) 3 dəfəyədək təkrarlanır;
            4xx cavabı (429 istisna) qəti uğursuzluq sayılır və təkrarlanmır. Şəxsi / daxili
            URL-lərə sorğular bloklanır (SSRF qoruması), ona görə təyinat ünvanı internetdən
            əlçatan olmalıdır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Zapier və no-code alətləri">
        <p>
          Ayrıca Zapier qurğusu yoxdur — webhook-u Zapier-in (və ya Make, n8n, istənilən
          catch-hook alətinin) verdiyi URL-ə yönəldin, hər uyğun hadisə düz ora axsın. Eyni
          şey HTTP POST qəbul edə bilən hər platformaya aiddir.
        </p>
        <HelpCallout kind="tip">
          <p>
            Webhook URL sahəsi hətta ipucu kimi{" "}
            <HelpKey>https://hooks.zapier.com/…</HelpKey> nümunəsini öncədən doldurur. Oraya
            real catch-hook URL-ini yapışdırın.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Google Calendar — ikitərəfli sinxronizasiya">
        <p>
          Google Calendar-ı qoşmaq <em>sizin</em> Google hesabınızı OAuth vasitəsilə
          LeadDrive-a bağlayır — təqvim hadisələrini oxumaq və yazmaq icazəsi ilə.
        </p>
        <HelpStep n={1}>
          <p>
            Google Calendar kartında <HelpKey>Qoşul</HelpKey> düyməsini basın. Google-un
            razılıq ekranına yönləndirilirsiniz; təsdiqləyin və kartı{" "}
            <em>Qoşulub</em> vəziyyətində göstərən bu səhifəyə qayıdırsınız.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Ayır</HelpKey> (təsdiq sorğusu ilə) saxlanılan icazəni silir. Qoşulma{" "}
            <strong>istifadəçi üzrədir</strong> — hər komanda üzvü öz təqvimini qoşur.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Google Calendar üçün serverdə Google OAuth giriş məlumatları qurulmalıdır. Onlar
            qurulmayıbsa, <HelpKey>Qoşul</HelpKey> tamamlanmaz və kart{" "}
            <em>Qoşulmayıb</em> qalar — administratorunuzla əlaqə saxlayın.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Slack — kanala bildirişlər">
        <p>
          Slack, Slack iş sahənizdə yaratdığınız <strong>gələn webhook URL-indən</strong>{" "}
          istifadə edir. LeadDrive həmin URL-in hədəflədiyi kanala mesaj göndərir.
        </p>
        <HelpStep n={1}>
          <p>
            Slack-də gələn webhook yaradın, sonra burada{" "}
            <HelpKey>Slack webhook əlavə et</HelpKey> düyməsini basın, ad verin,{" "}
            <HelpKey>https://hooks.slack.com/services/…</HelpKey> URL-ini yapışdırın və{" "}
            <HelpKey>İnteqrasiya əlavə et</HelpKey> ilə saxlayın.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Test</HelpKey> kanala birdəfəlik yoxlama mesajı göndərir —{" "}
            <em>Test göndərildi!</em> URL-in işlədiyini təsdiqləyir. Zibil işarəsi
            konfiqurasiyanı silir.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Bir neçə Slack konfiqurasiyası əlavə edə bilərsiniz (məsələn, bir kanal sövdələr,
            başqası ticketlər üçün). Hər biri sadəcə adı olan gələn-webhook URL-idir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="API açarları — proqram girişi">
        <p>
          API açarı — xarici sistemə LeadDrive REST API-ni təşkilatınız adından çağırmağa
          imkan verən <strong>Bearer-token</strong>-dur. Hər açarın nə edə biləcəyini
          məhdudlaşdıran bir dəst <strong>scope</strong> (icazə) var.
        </p>
        <HelpStep n={1}>
          <p>
            <HelpKey>Açar yarat</HelpKey> düyməsini basın, daxili ad verin, istəyə görə
            müddət təyin edin (<em>Heç vaxt</em>, 30, 90 və ya 365 gün) və inteqrasiyaya
            lazım olan scope-ları seçin. Ad və ən azı bir scope tələb olunur.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Scope-lar hər modul üzrə <HelpKey>read:&lt;modul&gt;</HelpKey> və{" "}
            <HelpKey>write:&lt;modul&gt;</HelpKey> şəklindədir (kontaktlar, sövdələr, lidlər,
            ticketlər, fakturalar və s.). <em>write</em> scope eyni modulun <em>read</em>-ini
            də əhatə edir. Yalnız lazım olanı verin — <strong>minimal səlahiyyət</strong>.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Tam açar (<HelpKey>ld_</HelpKey> prefiksli) yaradılışdan dərhal sonra{" "}
            <strong>bir dəfə</strong> göstərilir — kopyalama düyməsi və hazır{" "}
            <code>curl -H &quot;Authorization: Bearer ld_…&quot;</code> nümunəsi ilə. Onu
            sorğularınızda <HelpKey>Authorization: Bearer</HelpKey> başlığında işlədin.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Pəncərəni bağlamazdan əvvəl açarı kopyalayın</strong> — yalnız qısa
            prefiks saxlanılır, tam açar heşlənir və bir daha göstərilmir. İtirsəniz, yenisini
            yaratmalı olacaqsınız.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Açarların idarəsi və ləğvi">
        <p>
          Siyahıda hər açar üçün prefiks, <em>Aktiv</em> və ya <em>ləğv edilib</em> nişanı,
          scope sayı, sonuncu nə vaxt istifadə olunduğu, nə vaxt bitdiyi və nə vaxt
          yaradıldığı görünür.
        </p>
        <HelpStep n={1}>
          <p>
            Zibil işarəsi açarı <strong>ləğv edir</strong> (təsdiqdən sonra). Ləğv dərhaldır —
            həmin açarı işlədən hər inteqrasiya o anda işləməyi dayandırır.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Açar <strong>vaxtı keçibsə</strong> və ya çağırılan modul və metod üçün scope-u
            yoxdursa, sorğu da uğursuz olur. <HelpKey>Sonuncu istifadə</HelpKey> markeri hər
            uğurlu çağırışda yenilənir, beləcə köhnəlmiş və ya gözlənilməz aktiv açarları
            görə bilərsiniz.
          </p>
        </HelpStep>
        <HelpCallout kind="security">
          <p>
            API açarlarını yalnız <strong>administratorlar</strong> (və superadminlər)
            yarada və ləğv edə bilər; digər rollar yaratma dialoqunu açıb belə bilməz. Ləğv
            edilmiş açarı geri qaytarmaq olmaz — yenisini buraxıb inteqrasiyanı yeniləyin.
            Açarlara parol kimi yanaşın: sirr menecerində saxlayın, heç vaxt versiya
            nəzarəti sistemində yox.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Hamısı necə bir yerdə işləyir">
        <ol className="list-decimal pl-5 space-y-1">
          <li>Sövdə mərhələ dəyişir → <strong>webhook</strong> hadisəni URL-inizə POST edir.</li>
          <li>Avtomatlaşdırma alətiniz (Zapier / Make / öz həllər) onu alıb reaksiya verir.</li>
          <li>Geri yazmaq üçün — qeyd yaratmaq, kontaktı yeniləmək — o, yalnız həmin modula scope-u olan <strong>API açarı</strong> ilə REST API-ni çağırır.</li>
          <li>Bu vaxt <strong>Slack</strong> və <strong>Google Calendar</strong> komandanızın kanalını və cədvəlini xəbərdar saxlayır.</li>
        </ol>
      </HelpSection>
    </div>
  )
}
