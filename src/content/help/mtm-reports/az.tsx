"use client"

/**
 * MTM → Hesabatlar — kömək məqaləsi (Azərbaycan dili).
 * Yalnız Marşrut & Sahə (MTM) modulunun Hesabatlar səhifəsini əhatə edir:
 * dövr seçici (Bu gün / Bu həftə / Bu ay), İxrac düyməsi, altı hesabat növü
 * kartı, kartı açıb cədvəl görünüşünə keçmə və Hesabatlara qayıt.
 * Səhifə t("mtmReports") açarlarından oxuyur.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MtmreportsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sahə əməliyyatları meneceri və ya MTM administratorusunuz"
        goal="Komandanın sahə aktivliyini — vizitlər, agent performansı, marşrut icrası, GPS və fotolar — seçilmiş dövr üzrə tez nəzərdən keçirmək"
      >
        Səhifəyə <HelpKey>MTM</HelpKey> → <HelpKey>Hesabatlar</HelpKey> yolu ilə çatırsınız. Bütün
        rəqəmlər yalnız sizin təşkilatınız üçündür. Səhifə açılanda standart olaraq{" "}
        <strong>Bu həftə</strong> dövrü götürülür və hər hesabat növü üçün qeyd sayları yüklənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Sol yuxarıda sənəd ikonası ilə <HelpKey>Hesabatlar</HelpKey> başlığı və «Müxtəlif hesabat
          növlərini nəzərdən keçirin və ixrac edin» izahı var. Sağ yuxarıda üç dövr düyməsi —{" "}
          <HelpKey>Bu gün</HelpKey>, <HelpKey>Bu həftə</HelpKey>, <HelpKey>Bu ay</HelpKey> — və
          yanında <HelpKey>İxrac</HelpKey> düyməsi durur. Hazırda seçili dövr düyməsi tünd (dolu)
          görünür. Altında altı hesabat növü kartı şəbəkəsi göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Dövr düymələri">Bu gün / Bu həftə / Bu ay — kartlardakı qeyd saylarını və açdığınız hesabat cədvəlini hansı zaman aralığı üçün göstərəcəyini təyin edir.</HelpDef>
          <HelpDef term="İxrac">Hesabatları çıxarmaq üçün düymə (yuxarı sağda, yükləmə ikonası ilə).</HelpDef>
          <HelpDef term="Gündəlik hesabat">Gündəlik vizit və tapşırıq nəticələrinin təhlili.</HelpDef>
          <HelpDef term="Agent performansı">Agent aktivliyi və performans göstəriciləri — agent, rol, vizitlər, tapşırıqlar, fotolar.</HelpDef>
          <HelpDef term="Marşrut icra">Marşrut planının icrası və sapma təhlili.</HelpDef>
          <HelpDef term="Müştəri vizitləri">Müştəri vizitlərinin tezliyi və müddəti — agent, müştəri, status, check-in.</HelpDef>
          <HelpDef term="GPS və lokasiya">Agent GPS statusu və cihaz batareyası monitorinqi.</HelpDef>
          <HelpDef term="Foto hesabat">Foto keyfiyyəti və metadata auditi.</HelpDef>
        </dl>
        <p>
          Hər kart bir rəngli ikona, sağ yuxarı küncündə <strong>{"{say}"} qeyd</strong> nişanı,
          növün adı və qısa təsviri, aşağıda isə «Son yaradılma: &lt;tarix&gt;» qeydi və{" "}
          <HelpKey>Bax</HelpKey> bağlantısı (sağ ox ikonası ilə) saxlayır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: dövr seç və hesabatlara bax">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdan dövr seçin: <HelpKey>Bu gün</HelpKey>, <HelpKey>Bu həftə</HelpKey> və ya{" "}
            <HelpKey>Bu ay</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz düymə tünd (dolu) vəziyyətə keçir, qalan ikisi xətli (outline) qalır. Kartlar
            yenidən yüklənir və sağ yuxarı küncdəki <strong>qeyd</strong> sayları yeni dövrü əks
            etdirir. Əgər artıq bir hesabat cədvəli açıq idisə, dövr dəyişəndə yenidən kart
            şəbəkəsinə qaytarılırsınız.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Maraqlandığınız kartda sağ aşağıdakı <HelpKey>Bax</HelpKey> bağlantısını basın (məsələn{" "}
            <strong>Agent performansı</strong> və ya <strong>Müştəri vizitləri</strong>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart şəbəkəsi əvəzlənir: yuxarıda <HelpKey>← Hesabatlara qayıt</HelpKey> düyməsi və yanında
            seçdiyiniz hesabatın adı, altında isə həmin növün məlumat cədvəli görünür. Yükləmə zamanı
            qısa müddət gözləmə vəziyyəti ola bilər.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Cədvəlin sütunlarını oxuyun — sütunlar hesabat növündən asılıdır.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Agent performansı</strong> üçün sütunlar: <HelpKey>Agent</HelpKey>,{" "}
            <HelpKey>Rol</HelpKey>, <HelpKey>Vizitlər</HelpKey>, <HelpKey>Tapşırıqlar</HelpKey>,{" "}
            <HelpKey>Fotolar</HelpKey>. <strong>Müştəri vizitləri</strong> üçün:{" "}
            <HelpKey>Agent</HelpKey>, <HelpKey>Müştəri</HelpKey>, <HelpKey>Status</HelpKey>,{" "}
            <HelpKey>Check-in</HelpKey>. Qalan növlərdə (gündəlik, marşrut, GPS, foto) ümumi sütunlar
            işləyir: <HelpKey>Tarix</HelpKey>, <HelpKey>Agent</HelpKey>,{" "}
            <HelpKey>Təfərrüatlar</HelpKey>, <HelpKey>Status</HelpKey>. Status dəyərləri boz dairəvi
            nişan kimi göstərilir; ən çoxu ilk 50 sətir göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Başqa hesabata keçmək üçün <HelpKey>← Hesabatlara qayıt</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl bağlanır və yenidən altı kartlıq şəbəkəyə qayıdırsınız. Buradan başqa bir kartın{" "}
            <HelpKey>Bax</HelpKey> bağlantısını seçə bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="İdarəetmə hesabatları və Excel">
        <p>
          Menecer üçün «Marşrut planı və icra», «Məcburi fəaliyyətlər», «Açıq növbəti fəaliyyətlər»,
          «Qalıq dəyişikliyi» və «Satış plan/fakt» hesabatları da mövcuddur. Onlar seçilmiş dövrü və
          menecerə icazə verilmiş agent qrupunu nəzərə alır. <HelpKey>Eksport</HelpKey> eyni filtrlənmiş
          sətirləri XLSX faylı kimi yükləyir.
        </p>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Boş cədvəl səhvə dəlalət etmir — sadəcə həmin dövrdə həmin növ üzrə qeyd yoxdur. Belə halda
          «Bu hesabat növü üçün məlumat yoxdur» mesajı göstərilir. Daha geniş aralıq görmək üçün
          dövrü <HelpKey>Bu ay</HelpKey>-a keçirin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün hesabat məlumatları təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın sahə
          aktivliyini görürsünüz, başqa təşkilatların qeydləri burada görünmür.
        </p>
      </HelpCallout>
    </div>
  )
}
