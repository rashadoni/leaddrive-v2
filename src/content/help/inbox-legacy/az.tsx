"use client"

/**
 * Inbox (Gələn qutusu) — help article (Azerbaijani).
 * Köhnə birgə "inbox" məqaləsindən ayrılıb: yalnız
 * Gələn qutusu → /inbox/legacy omni-channel söhbət ekranını əhatə edir
 * (kanal filtrləri, söhbət siyahısı, mesaj lenti, cavab, yeni mesaj,
 * canlı/dayandırılıb rejimi, oxundu/sil). Yeni inbox variantı bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InboxlegacyHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış və ya dəstək əməkdaşısınız"
        goal="Email, Telegram, SMS, WhatsApp və sosial kanallardan gələn bütün söhbətləri bir ekranda izləmək və cavablandırmaq"
      >
        Bu səhifə <HelpKey>Gələn qutusu</HelpKey> (Omni-Channel) ekranıdır — başlığın altında
        «bütün kanallar bir yerdə» izahı durur. Bütün söhbətlər və mesajlar yalnız sizin
        təşkilatınıza aiddir. Ekran hər 15 saniyədə avtomatik yenilənir (canlı rejim), ona görə
        yeni mesajlar siz heç nə etmədən siyahıda peyda olur.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Sol yuxarıda gələn qutusu ikonası, <HelpKey>Gələn qutusu</HelpKey> başlığı və altında
          «Omni-Channel — bütün kanallar bir yerdə» yarımbaşlığı var. Sağ yuxarıda iki element durur:
          yaşıl nöqtəli <HelpKey>Aktiv</HelpKey> / <HelpKey>Dayandırılıb</HelpKey> keçidi (avtomatik
          yenilənməni söndürür/açır) və <HelpKey>Yeni mesaj</HelpKey> düyməsi. Onların altında dörd
          statistika kartı: <strong>Mesajlar</strong>, <strong>Gələn</strong>, <strong>Gedən</strong>,{" "}
          <strong>Söhbətlər</strong>.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Mesajlar">Bütün kanallardakı ümumi mesaj sayı.</HelpDef>
          <HelpDef term="Gələn">Müştərilərdən alınan (inbound) mesajlar.</HelpDef>
          <HelpDef term="Gedən">Müştərilərə göndərilən (outbound) mesajlar.</HelpDef>
          <HelpDef term="Söhbətlər">Əlaqələrlə unikal söhbət mövzularının sayı.</HelpDef>
          <HelpDef term="Kanal filtrləri">Statistikanın altındakı zolaq: Hamısı, Email, Telegram, SMS, WhatsApp, Facebook, Instagram, TikTok, VoIP.</HelpDef>
          <HelpDef term="Söhbət siyahısı">Sol sütun — axtarış sahəsi və hər biri bir əlaqəyə aid kartlardan ibarət siyahı.</HelpDef>
          <HelpDef term="Mesaj lenti">Sağ panel — seçilmiş söhbətin bütün mesajları və altda cavab sahəsi.</HelpDef>
          <HelpDef term="Aktiv / Dayandırılıb">Avtomatik yenilənmə açarı — aktivdirsə hər 15 saniyədə siyahı təzələnir.</HelpDef>
        </dl>
        <p>
          Səhifə iki sütundan ibarətdir. Solda axtarış sahəsi (<HelpKey>Söhbət axtar...</HelpKey>) və
          onun altında söhbət kartları. Hər kartda əlaqənin baş hərfli dairəsi, adı, varsa e-poçtu, son
          mesajın bir sətirlik parçası, kanal nişanları, vaxt və oxunmamış mesaj sayını göstərən qırmızı
          rəqəm olur. Sağda isə seçilmiş söhbətin lenti durur — mesaj seçilməyibsə, ortada gələn qutusu
          ikonası ilə <strong>«Söhbət seçin»</strong> (və ya heç mesaj yoxdursa <strong>«Mesaj yoxdur»</strong>)
          mətni göstərilir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: söhbəti aç və cavab ver">
        <HelpStep n={1}>
          <p>
            Lazım gələrsə yuxarıdakı kanal zolağından bir kanal seçin (məs.{" "}
            <HelpKey>Telegram</HelpKey>) və ya hamısına baxmaq üçün <HelpKey>Hamısı</HelpKey> seçili
            qalsın. Konkret söhbəti tapmaq üçün sol yuxarıdakı <HelpKey>Söhbət axtar...</HelpKey>{" "}
            sahəsinə ad, e-poçt və ya mətn yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş kanal düyməsi rənglənir, söhbət siyahısı yalnız həmin kanala aid söhbətləri
            göstərir. Axtarış yazdıqca siyahı dərhal süzgəcdən keçir; uyğun gəlmirsə{" "}
            <strong>«Heç nə tapılmadı»</strong> görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Sol siyahıdan bir söhbət kartına klikləyin.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart işıqlanır, sağ panel həmin əlaqənin lenti ilə dolur. Yuxarıda əlaqənin adı, e-poçtu/
            telefonu, mesaj sayı və iştirak edən kanalların nişanları, gövdədə isə baloncuqlar şəklində
            mesajlar görünür — gedən mesajlar sağda rəngli, gələn mesajlar solda boz. Söhbətdə oxunmamış
            gələn mesaj varsa, onlar avtomatik «oxundu» kimi işarələnir və soldakı qırmızı rəqəm yox olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Lentin altındakı sahədə soldakı kanal seçicisindən cavab kanalını seçin (Email, Telegram,
            SMS, WhatsApp, Facebook, Instagram, TikTok), <HelpKey>Mesaj yazın...</HelpKey> sahəsinə
            mətnini yazın və göndərmə (təyyarə) düyməsini basın və ya <HelpKey>Enter</HelpKey> vurun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Söhbəti açanda kanal seçicisi avtomatik olaraq son işlədilən kanalı götürür. Göndərmə
            zamanı düymə fırlanan göstəriciyə keçir; mesaj sağda yeni baloncuq kimi lentin sonunda peyda
            olur və lent aşağı sürüşür. Sahə boş olanda göndərmə düyməsi sönük (deaktiv) qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Göndərilmiş mesajın çatma vəziyyətini baloncuğun altındakı kiçik nişandan izləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Gedən mesajın yanında ✓ (<strong>Çatdırıldı</strong>), ✗ (<strong>Çatdırılmadı</strong>) və ya
            ⏳ (<strong>Göndərilir…</strong>) nişanı çıxır — üzərinə kursoru aparanda izahı görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni mesaj başlat">
        <HelpStep n={1}>
          <p>Sağ yuxarıdakı <HelpKey>Yeni mesaj</HelpKey> düyməsini basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni mesaj» başlıqlı pəncərə açılır. İçində <strong>Kontakt</strong> açılan siyahısı,{" "}
            <strong>Kanal</strong> seçicisi, ünvan sahəsi, e-poçt seçiləndə əlavə <strong>Mövzu</strong>{" "}
            sahəsi və <strong>Mesaj</strong> mətn sahəsi var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Kontakt</strong> açılan siyahısından bir əlaqə seçin (istəyə bağlı), sonra{" "}
            <strong>Kanal</strong> seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahıda təşkilatınızın kontaktları ad, e-poçt və telefonu ilə görünür. Kontakt
            seçəndə ünvan sahəsi avtomatik dolur: Email üçün e-poçt, SMS/Telegram üçün telefon. Kanalı
            dəyişsəniz, ünvan həmin kanala uyğun yenidən doldurulur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Ünvan sahəsini yoxlayın (lazım olsa əl ilə yazın), Email seçmisinizsə{" "}
            <strong>Mövzu</strong> əlavə edin və <strong>Mesaj</strong> mətnini yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ünvan etiketi kanala görə dəyişir: Email-də «E-poçt ünvanı», SMS-də «Telefon», Telegram-da
            «Chat ID / Telefon». Mövzu sahəsi yalnız Email kanalında görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Aşağıdakı <HelpKey>Göndər</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ünvan və ya mesaj boş olanda <HelpKey>Göndər</HelpKey> deaktiv qalır. Göndərmə zamanı düymə
            «Göndərilir...» yazısına və fırlanan göstəriciyə keçir; uğurlu olanda pəncərə bağlanır,
            sahələr təmizlənir və söhbət siyahısı yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: söhbəti idarə et (oxundu, sil, canlı rejim)">
        <HelpStep n={1}>
          <p>
            Avtomatik yenilənməni dayandırmaq üçün sağ yuxarıdakı yaşıl <HelpKey>Aktiv</HelpKey>{" "}
            keçidini basın; yenidən basanda canlı rejimə qayıdır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Keçid <strong>Dayandırılıb</strong> vəziyyətinə düşür, yaşıl yanıb-sönən nöqtə boz olur və
            siyahı artıq hər 15 saniyədə özü təzələnmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Söhbəti silmək üçün ya söhbət kartının üzərinə kursoru aparıb görünən zibil qutusu ikonasını
            basın, ya da söhbəti açıb sağ yuxarıdakı zibil qutusu düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Bu söhbəti və bütün mesajları silmək istəyirsiniz?» təsdiq pəncərəsi çıxır. Təsdiqlədikdən
            sonra söhbət siyahıdan çıxır, açıq idisə sağ panel boşalır və statistika kartları yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Söhbətin silinməsi geri qaytarılmır — həmin əlaqə ilə bağlı{" "}
            <strong>bütün mesajlar (gələn və gedən) silinir</strong>. Yalnız diqqətdən çıxarmaq
            istəyirsinizsə, silmək yerinə sadəcə başqa söhbətə keçin; mesaj heç yerə yox olmur.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <HelpKey>VoIP</HelpKey> kanalını seçəndə bu ekranda söhbət göstərilmir — yerinə «Zəng
          jurnalları Kontaktlar → Zənglər tabında mövcuddur» qeydi çıxır. Telefon zəngləri burada deyil,
          əlaqə kartının zəng tarixçəsində saxlanılır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün söhbətlər, mesajlar və statistika təşkilatınızla məhdudlaşır — başqa təşkilatın gələn
          qutusunu görmürsünüz. Yeni mesaj pəncərəsindəki kontakt siyahısı da yalnız sizin tenant-ınızın
          kontaktlarından gəlir.
        </p>
      </HelpCallout>
    </div>
  )
}
