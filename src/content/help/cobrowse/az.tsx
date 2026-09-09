"use client"

/**
 * Cobrowse (T8) — köməkçi/dəstək agenti üçün help məqaləsi (Azərbaycan dili).
 * /cobrowse səhifəsini əhatə edir: sessiya siyahısı, «Yeni sessiya başlat»
 * dialoqu (istəyə bağlı Contact ID), və /cobrowse/[id] baxış panelinin
 * (qoşulma linki, Pause/Resume/End, canlı video) iş axını.
 * Müştəri tərəfi (/c/<token>) ayrıca səhifədir — burada yalnız agentin
 * gördüyü hissə təsvir olunur.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CobrowseHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dəstək və ya satış agentisiniz"
        goal="Müştərinin ekranını canlı izləyərək ona kömək etmək — özü nəyi paylaşacağını seçir, siz yalnız onun göstərdiyini görürsünüz"
      >
        Səhifə <HelpKey>Cobrowse</HelpKey> bölməsidir. Burada təşkilatınızın aktiv və son sessiyaları sadalanır,
        həmçinin yeni sessiya başlada bilərsiniz. İş prinsipi belədir: siz sessiya yaradırsınız, sistem müştəri
        üçün <strong>qoşulma linki</strong> verir, siz onu söhbət/e-poçt/SMS ilə göndərirsiniz; müştəri linki
        açıb <strong>nəyi paylaşacağını özü seçəndən</strong> sonra onun ekranı sizin panelinizdə canlı görünür.
        Heç nə yazılıb saxlanmır və səs heç vaxt ötürülmür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Cobrowse</HelpKey> adı, altında «Dəstək zamanı müştərinin ekranını izləyin — nəyi
          paylaşacağını özü seçir, siz yalnız onun göstərdiyini görürsünüz» izahı, sağ yuxarıda isə{" "}
          <HelpKey>Yeni sessiya başlat</HelpKey> düyməsi var. Altda vəziyyətə görə üç görünüş ola bilər: sessiyalar
          yüklənərkən «Sessiyalar yüklənir…» yazısı; heç bir sessiya yoxdursa boş vəziyyət; varsa isə sessiya cədvəli.
        </p>
        <p>
          Cədvəldə dörd sütun olur: <strong>Sessiya</strong> (qısa identifikator, monospace; altında müştərinin
          contact-ı və ya «anonim»), <strong>Status</strong> (rəngli nişan), <strong>Başlandı</strong> (nə qədər
          əvvəl — məs. «5d əvvəl») və sağda <strong>Aç</strong> linki. Sətrə və ya identifikatora kliklədikdə həmin
          sessiyanın baxış panelinə (<HelpKey>/cobrowse/&lt;id&gt;</HelpKey>) keçirsiniz.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Sessiya">Bir cobrowse görüşü — kim bağlanır, statusu və başlama vaxtı ilə. Sıranı açıb canlı paneli görürsünüz.</HelpDef>
          <HelpDef term="Qoşulma linki (join URL)">Müştəriyə göndərdiyiniz ünvan (/c/&lt;token&gt;). Açanda ondan ekran/tab/pəncərə paylaşmaq icazəsi soruşulur.</HelpDef>
          <HelpDef term="Contact ID (istəyə bağlı)">Sessiyanı mövcud kontakt qeydinə bağlayır ki, həmin kontaktın zaman lentində «cobrowse» fəaliyyəti görünsün. Boş buraxsanız sessiya «anonim» olur.</HelpDef>
          <HelpDef term="Status — pending / awaiting_consent">Sessiya yaradılıb, müştəri hələ qoşulmayıb və ya icazə verməyib (boz nişan).</HelpDef>
          <HelpDef term="Status — active">Müştəri qoşulub və ekran canlı paylaşılır (yaşıl nişan).</HelpDef>
          <HelpDef term="Status — paused">Siz paylaşmanı müvəqqəti dayandırmısınız (sarı nişan).</HelpDef>
          <HelpDef term="Status — ended">Sessiya bitib (qırmızı nişan).</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni sessiya başlat və linki müştəriyə göndər">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni sessiya başlat</HelpKey> düyməsini basın. (Heç sessiya yoxdursa, boş
            vəziyyətin ortasındakı <HelpKey>İlk cobrowse sessiyanı başlat</HelpKey> düyməsi də eyni işi görür.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Cobrowse sessiyasını başlat» başlıqlı kiçik pəncərə açılır. İçində izah mətni, <strong>Contact ID
            (istəyə bağlı)</strong> sahəsi (placeholder: «cln… (anonim üçün boş buraxın)»), altında{" "}
            <HelpKey>Ləğv et</HelpKey> və <HelpKey>Sessiya yarat</HelpKey> düymələri var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstəsəniz <strong>Contact ID</strong> daxil edin — sessiyanı mövcud kontaktla bağlamaq üçün. Sırf tez
            kömək lazımdırsa, sahəni boş buraxın (sessiya «anonim» olur).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahənin altında «Sessiyanı bir Kontakt qeydinə bağlayın ki, zaman lentinə "cobrowse" fəaliyyəti
            düşsün» ipucusu durur. Yazdıqca mətn sahədə görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Sessiya yarat</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Yaradılır…» yazısına keçir. Uğurlu olduqda pəncərə bağlanır, sizi avtomatik həmin sessiyanın
            baxış panelinə yönləndirir və yeni sıra siyahının başına düşür. Alınmasa, pəncərədə qırmızı xəta
            mesajı (məs. server cavabı) göstərilir və pəncərə açıq qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Baxış panelində <strong>Müştəri qoşulma linki</strong> bölməsindəki ünvanı{" "}
            <HelpKey>Kopyala</HelpKey> düyməsi ilə götürün (və ya yalnız-oxunan sahəyə klikləyib özünüz seçin),
            sonra müştəriyə söhbət/e-poçt/SMS ilə göndərin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yuxarıda <HelpKey>← Sessiyalara qayıt</HelpKey> düyməsi və monospace başlıqda qısa sessiya nömrəsi
            görünür, yanında vəziyyət nişanı (məs. <strong>Müştəri gözlənilir</strong>) və başlama vaxtı. Kopyala
            düyməsi basılanda qısa müddətə təsdiq nişanına (<strong>Kopyalandı</strong>) keçir. Altda «Bunu müştəriyə
            söhbət, e-poçt və ya SMS ilə göndərin…» izahı durur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: müştəri qoşulanda sessiyanı idarə et">
        <HelpStep n={1}>
          <p>
            Müştəri qoşulana qədər panel <strong>gözləmə</strong> rejimindədir. Statusun dəyişib-dəyişmədiyini dərhal
            yoxlamaq üçün video sahəsindəki <HelpKey>İndi yoxla</HelpKey> düyməsini basa bilərsiniz (panel onsuz da hər
            5 saniyədən bir avtomatik yoxlayır).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qara video sahəsinin ortasında «Müştərinin qoşulması gözlənilir…» yazısı və altında <HelpKey>İndi
            yoxla</HelpKey> düyməsi durur. Müştəri qoşulmağa razı olanda yazı «Müştəri razı oldu — bağlantı qurulur…»
            şəklinə keçir, status nişanı isə <strong>Qoşulur…</strong> olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Müştəri nəyi paylaşacağını seçəndən sonra onun ekranı sahədə canlı görünür və status{" "}
            <strong>Canlı</strong> olur. Lazım gəlsə yuxarı sağdakı <HelpKey>Fasilə</HelpKey> düyməsi ilə paylaşmanı
            müvəqqəti dayandırın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qara sahədə müştərinin paylaşdığı ekran/tab/pəncərə oynamağa başlayır. Status nişanı yaşıl{" "}
            <strong>Canlı</strong> olur; <HelpKey>Fasilə</HelpKey> və <HelpKey>Bitir</HelpKey> düymələri yuxarı sağda
            görünür. Fasiləyə keçirsənsə, status sarı <strong>Fasilə</strong> olur və düymə{" "}
            <HelpKey>Davam et</HelpKey> görünüşünə keçir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İş bitəndə yuxarı sağdakı qırmızı <HelpKey>Bitir</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Video dayanır, status qırmızı <strong>Bitdi</strong> olur və «Sessiya bitdi.» yazısı görünür. Qoşulma
            linki bölməsi gizlənir. <HelpKey>← Sessiyalara qayıt</HelpKey> ilə siyahıya dönsəniz, həmin sıranın
            statusu <strong>ended</strong> kimi görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Müştəri linki itirsə (məs. tabı bağlasa), baxış panelindəki <strong>Müştəri qoşulma linki</strong> bölməsi
          sessiya bitənə qədər açıq qalır — eyni linki yenidən <HelpKey>Kopyala</HelpKey> ilə götürüb göndərə
          bilərsiniz. Bir neçə sessiya arasında gəzişmək üçün <HelpKey>← Sessiyalara qayıt</HelpKey> istifadə edin —
          bu, canlı sessiyanı bitirmir, sadəcə siyahıya qaytarır.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Canlı və ya fasilədəki sessiyada brauzer tabını birbaşa bağlamayın — bunu etsəniz, brauzer «səhifədən
          çıxmaq istəyirsiniz?» xəbərdarlığı verir və sessiya avtomatik <strong>bitmiş</strong> sayıla bilər. Müştəri
          ilə işi davam etdirmək istəyirsinizsə, tabı bağlamaq əvəzinə açıq saxlayın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Cobrowse tam müştəri-razılığı əsaslıdır: siz hər hansı ekranı «zorla» görə bilmirsiniz — müştəri linki açıb{" "}
          <strong>özü nəyi (ekran/tab/pəncərə) paylaşacağını seçir</strong>, istənilən an paylaşmanı dayandıra bilir,
          heç nə yazılıb saxlanmır və səs heç vaxt ötürülmür. Bütün sessiyalar yalnız sizin təşkilatınıza aiddir;
          qoşulma token-i təhlükəsizlik üçün sessiya siyahısının JSON-una daxil edilmir — yalnız baxış panelini
          açanda ayrıca yüklənir.
        </p>
      </HelpCallout>
    </div>
  )
}
