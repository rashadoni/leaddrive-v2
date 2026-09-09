"use client"

/**
 * Inbox Automation — help article (Azerbaijani).
 * Source script for the route-aware help video on /inbox/automation.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InboxAutomationHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Canlı inbox söhbətlərini idarə edirsiniz"
        goal="Müştərilərə təsadüfi cavab göndərmədən bir təhlükəsiz marşrut qurmaq"
      >
        <HelpKey>Omni-Channel</HelpKey> → <HelpKey>Avtomatlaşdırma</HelpKey> bölməsini açın. Səhifə
        tapşırığa görə bölünüb: icmal, qurucu, saxlanmış ssenarilər və son icralar. Əvvəl{" "}
        <HelpKey>Qurucu</HelpKey> ilə başlayın; vizual canvas ilk quraşdırma üçün yox, saxlanmış
        ssenariləri redaktə etmək üçündür.
      </HelpScenario>

      <HelpSection title="Bu səhifə nə edir">
        <p>
          Inbox avtomatlaşdırması gələn mesajlar üçün ssenarilər yaradır. Ssenari söhbəti növbəyə
          təyin edə, sabit cavab göndərə, AI cavabı verə, agentə ötürə, kontakt sahəsini yeniləyə,
          komandaya bildiriş göndərə və ya söhbəti bağlaya bilər.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Növbə">Söhbətin düşəcəyi komanda qutusu: məsələn satış, dəstək, VIP və ya TikTok leads.</HelpDef>
          <HelpDef term="Ssenari">Seçilmiş kanallardan yeni mesaj gələndə işləyən qayda.</HelpDef>
          <HelpDef term="Əməliyyatlar">Trigger-dən sonra LeadDrive-ın ardıcıl icra etdiyi addımlar.</HelpDef>
          <HelpDef term="İcralar">Kontrollu test zamanı realda nə baş verdiyini yoxlamaq üçün jurnal.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: ilk marşrutu yaradın">
        <HelpStep n={1}>
          <p>
            <HelpKey>Qurucu</HelpKey> düyməsinə basın. İş xəritəsində ilk çatışmayan addıma baxın.
            Əgər hələ növbə yoxdursa, <HelpKey>Komanda növbələri</HelpKey> bölməsində bir növbə
            yaradın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Quraşdırma zolağı <HelpKey>Növbə yaradın</HelpKey> addımını növbəti iş kimi göstərir.
            Növbə saxlandıqdan sonra birinci əməliyyat onu təyinat kimi seçə bilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Ssenariyə aydın ad verin və hazırlıq zamanı statusu <HelpKey>Qaralama</HelpKey> və ya{" "}
            <HelpKey>Fasilə</HelpKey> saxlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İş xəritəsi ssenari adının hazır olduğunu göstərir, amma canlı trafik hələ də qorunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Marşrutun işləyəcəyi kanalları seçin: TikTok, WhatsApp, Telegram, email, SMS, Facebook,
            Instagram, VKontakte və ya web chat.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş kanal chip-ləri dolu görünür. <HelpKey>Cavab göndər</HelpKey> və ya{" "}
            <HelpKey>AI cavabı</HelpKey> əlavə etsəniz, dəstəklənməyən kanallar saxlamadan əvvəl
            xəbərdarlıq göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Əməliyyatları ardıcıllıqla əlavə edin. İlk təhlükəsiz marşrut üçün{" "}
            <HelpKey>Növbəyə təyin et</HelpKey> istifadə edin. Cavab əməliyyatlarını yalnız seçilmiş
            kanalın göndərməyi dəstəklədiyini təsdiqləyəndən sonra əlavə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ssenari preview-i <HelpKey>message_inbound</HelpKey> node-undan əməliyyatlara, sonra{" "}
            <HelpKey>end</HelpKey> node-una yenilənir. Boş növbə və ya boş cavab mətni saxlamanı
            bloklayır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Ssenarini saxlayın, bir kontrollu test mesajı göndərin, sonra <HelpKey>İcralar</HelpKey>{" "}
            bölməsini açıb dəqiq yolu yoxlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Son icralar ssenari adını, söhbəti, statusu, cari node-u və addım sayını göstərir.
            Yalnız bu yoxlamadan sonra live flaqı və Aktiv statusunu birlikdə istifadə edin.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="warning" label="Təhlükəsizlik qaydası">
        Ssenarini saxlamaq yalnız konfiqurasiyadır. Bu, real müştərilərə öz-özünə cavab göndərməyə
        başlamamalıdır. Live aktivləşdirməni uğurlu testdən sonra ayrıca kontrollu addım kimi edin.
      </HelpCallout>

      <HelpCallout kind="tip" label="Ən təhlükəsiz başlanğıc">
        Əvvəl <HelpKey>Mesajları komandaya yönləndir</HelpKey> şablonundan istifadə edin. Bu,
        “gələn mesaj → növbə” tipli sadə qaralama yaradır və AI cavabından daha asan yoxlanır.
      </HelpCallout>
    </div>
  )
}
