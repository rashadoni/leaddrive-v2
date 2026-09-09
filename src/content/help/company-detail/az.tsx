"use client"

/**
 * Company Detail (Şirkət kartı) — help article (Azerbaijani).
 * companies/[id] səhifəsini əhatə edir: başlıq + Redaktə düyməsi,
 * 4 KPI kartı, əlaqə məlumatı sətri, 6 tab (İcmal, Kontaktlar,
 * Sövdələşmələr, Xronologiya, Zənglər, Qiymətləndirmə) və
 * CompanyForm redaktə pəncərəsi. Şirkət SİYAHISI bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CompanydetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış meneceri, hesab meneceri və ya əməliyyat administratorusunuz"
        goal="Bir şirkətin tam kartını açıb onun əlaqələrini, sövdələşmələrini, fəaliyyət tarixçəsini və qiymət profilini bir yerdə görmək, lazım olduqda məlumatları redaktə etmək"
      >
        Bu səhifəyə <HelpKey>Şirkətlər</HelpKey> siyahısında istənilən sətrə klikləməklə çatırsınız.
        Bütün məlumatlar — kontaktlar, sövdələşmələr, zənglər, qiymət profili — yalnız sizin
        təşkilatınıza aiddir. Bəzi sahələr (məs. veb-sayt, telefon, e-poçt, illik gəlir) sizin
        rolunuzun sahə icazələrindən asılı olaraq gizlədilə bilər — görmədiyiniz sahə yox deyil,
        sadəcə sizin üçün bağlıdır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda geriyə qayıt oxu (←), şirkət adının baş hərfi olan rəngli nişan, şirkətin{" "}
          <strong>adı</strong>, yanında sahə (sənaye) və <strong>status</strong> nişanı (məs. yaşıl{" "}
          <em>active</em>), sağ küncdə isə <HelpKey>Redaktə et</HelpKey> düyməsi durur. Onun altında
          dörd rəngli KPI kartı, sonra əlaqə məlumatı sətri (veb-sayt, telefon, e-poçt, şəhər/ölkə),
          ən altda isə tablı bölmə gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Kontaktlar (KPI)">Bu şirkətə bağlı əlaqə şəxslərinin ümumi sayı.</HelpDef>
          <HelpDef term="Aktiv sövdələşmələr (KPI)">Hazırda davam edən sövdələşmələr — Qazanılmış (WON) və İtirilmiş (LOST) xaricdə.</HelpDef>
          <HelpDef term="Huni (KPI)">Aktiv sövdələşmələrin ümumi dəyəri, manatla (₼).</HelpDef>
          <HelpDef term="Müştəri günləri (KPI)">Şirkətin CRM-ə əlavə olunmasından keçən gün sayı.</HelpDef>
          <HelpDef term="Əlaqə məlumatı sətri">Veb-sayt, telefon, e-poçt və yer (şəhər, ölkə) kartları; məlumat yoxdursa «—» göstərilir.</HelpDef>
          <HelpDef term="Tablar">İcmal, Kontaktlar, Sövdələşmələr, Xronologiya, Zənglər (Calls) və Qiymətləndirmə.</HelpDef>
          <HelpDef term="Vahid xronologiya">Fəaliyyət, sövdələşmə, bilet, zəng, e-poçt və mesajların vahid, tarixə görə düzülmüş lenti.</HelpDef>
        </dl>
        <p>
          Hər tabın başlığının yanında balaca <strong>?</strong> ikonası (ipucu) var — üstünə gələndə
          həmin tabın nə göstərdiyini izah edir. Kontaktlar və Sövdələşmələr tablarının adında mötərizədə
          say göstərilir (məs. «Kontaktlar (3)»).
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: şirkəti oxu (İcmal və KPI-lar)">
        <HelpStep n={1}>
          <p>
            Səhifə açılan kimi yuxarıdakı dörd KPI kartına baxın: <HelpKey>Kontaktlar</HelpKey>,{" "}
            <HelpKey>Aktiv sövdələşmələr</HelpKey>, <HelpKey>Huni</HelpKey> və{" "}
            <HelpKey>Müştəri günləri</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Dörd rəngli kart yan-yana durur, hər birində ikona, rəqəm və ad. Huni kartı dəyəri manatla
            (₼) göstərir. Hər kartın üstünə gələndə nəyi saydığını izah edən ipucu çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>İcmal</HelpKey> tabı standart olaraq açıqdır. Solda <strong>Haqqında</strong>{" "}
            kartı, sağda <strong>Son fəaliyyət</strong> kartı durur.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Haqqında» kartında təsvir (yoxdursa «Təsvir yoxdur»), altında Sənaye, İşçilər, Ölkə və
            İllik gəlir cütlükləri görünür. «Son fəaliyyət» kartında axırıncı beş fəaliyyət ikonası ilə
            (🤝 görüş, 📧 e-poçt, 📞 zəng, 📝 qeyd, ✅ tapşırıq) və tarixi ilə sadalanır; heç nə yoxdursa
            «Fəaliyyət yoxdur» yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Şirkətin əlaqə kanallarını yoxlamaq üçün KPI-ların altındakı əlaqə məlumatı sətrinə baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Veb-sayt, telefon, e-poçt və yer (şəhər, ölkə) kartları görünür. Veb-sayt klikləndikdə yeni
            tabda açılır; telefon nömrəsinin yanında zəng ikonası (kliklə-zəng et) var. Boş sahələrdə
            «—» durur. Rolunuza icazə verilmirsə, müvafiq kart ümumiyyətlə görünmür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: kontaktlar, sövdələşmələr və xronologiya">
        <HelpStep n={1}>
          <p>
            <HelpKey>Kontaktlar</HelpKey> tabını açın — bu şirkətə bağlı insanların siyahısıdır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kontakt baş hərfli dairəvi nişan, ad, vəzifə (yoxdursa «—»), sağda isə e-poçt və telefonla
            sətir kimi göstərilir. Sətrə klikləsəniz, həmin kontaktın səhifəsinə keçirsiniz. Kontakt yoxdursa
            «Kontakt yoxdur» yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Sövdələşmələr</HelpKey> tabına keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sövdələşmə adı, mərhələ nişanı (LEAD, QUALIFIED, PROPOSAL, NEGOTIATION, WON, LOST — rəngli),
            sağda dəyəri (məbləğ + valyuta) və yaranma tarixi ilə sadalanır. Sətrə klik həmin sövdələşmənin
            səhifəsinə aparır. Boşdursa «Sövdələşmə yoxdur» göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Xronologiya</HelpKey> tabını açın — bu, bütün qarşılıqlı əlaqələrin vahid lentidir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Şaquli xətt boyunca tarixə görə düzülmüş hadisələr: fəaliyyət, sövdələşmə (🤝), bilet (✓),
            zəng (📞), e-poçt (📧) və mesaj (💬) — hər birinin öz ikonası. Sövdələşmə hadisəsinə klik onun
            səhifəsinə aparır. Məlumat yüklənərkən fırlanan göstərici, heç nə yoxdursa «Xronologiyada hadisə
            yoxdur» mesajı çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: zənglər və qiymət profili">
        <HelpStep n={1}>
          <p>
            <HelpKey>Calls</HelpKey> (Zənglər) tabını açın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bu tab ilk dəfə açılanda zəng tarixçəsi yüklənir (fırlanan göstərici). Sonra cədvəl görünür:
            Tarix, İstiqamət (gələn/gedən), Müddət, Status və Kontakt sütunları. Tamamlanmış zəng yaşıl,
            uğursuz/cavabsız zəng qırmızı işarələnir. Zəng yoxdursa «No calls recorded» yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Qiymətləndirmə</HelpKey> tabını açın — şirkətin qiymət profilini göstərir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Profil varsa, yuxarıda dörd xülasə kartı (Kod, Qrup, Aylıq, İllik) durur, altda
            «Kateqoriyalar üzrə xidmətlər» bloku. Profil yoxdursa «Bu şirkət üçün qiymətləndirmə məlumatı
            yoxdur.» mesajı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Hər kateqoriya sətrinə klikləyib açın — içindəki xidmətlərin təfərrüatını görmək üçün.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kateqoriya genişlənir (ox işarəsi aşağı çevrilir) və xidmət cədvəli açılır: Xidmət, Vahid,
            Miqdar, Qiymət, Cəmi sütunları. Əlavə satışlar varsa, ən altda «Əlavə satışlar» cədvəli (MRR /
            Birdəfəlik növ, ad, cəmi, tarix, status nişanları ilə) göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: şirkət məlumatlarını redaktə et">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Redaktə et</HelpKey> düyməsini (qələm ikonası) basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Şirkəti redaktə et» başlıqlı pəncərə mövcud dəyərlərlə əvvəlcədən doldurulmuş halda açılır:{" "}
            <strong>Ad *</strong>, Sənaye, Status (açılan siyahı), E-poçt, Telefon, Veb-sayt, Şəhər, Ölkə,
            Ünvan, SLA siyasəti, kredit limiti və valyuta, ən altda Təsvir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Lazımi sahələri dəyişin. <strong>Ad</strong> yeganə məcburi sahədir (* ilə işarələnib).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca dəyişikliklər sahələrdə görünür. Status açılan siyahısında Aktiv / Perspektiv /
            Qeyri-aktiv variantları var. Veb-sayt sahəsində «https://» nümunə mətni durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Aşağıdakı yadda saxla düyməsini basın (fikrinizi dəyişsəniz — Ləğv et və ya × ilə bağlayın).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Pəncərə bağlanır, şirkət kartı yenidən yüklənir və dəyişiklikləriniz dərhal başlıqda, KPI-larda
            və müvafiq bölmələrdə əks olunur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Tez səyahət üçün: Kontaktlar tabında istənilən kontakt sətrinə, Sövdələşmələr tabında istənilən
          sövdələşmə sətrinə, Xronologiyada isə sövdələşmə hadisəsinə klikləmək sizi birbaşa həmin yazının
          səhifəsinə aparır — geriyə qayıt oxu (←) sizi şirkət siyahısına qaytarır.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Telefon nömrəsi yanındakı zəng ikonası real zəng başladır — yanlışlıqla basmayın. Zəng tarixçəsi
          yalnız <HelpKey>Calls</HelpKey> tabını açanda yüklənir, ona görə cədvəl ilk anda boş görünə bilər.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün məlumatlar təşkilatınızla məhdudlaşır — başqa tenant-ın şirkətlərini görmürsünüz.
          Əlavə olaraq, sahə səviyyəsində icazələr tətbiq olunur: rolunuza görə bəzi sahələr (veb-sayt,
          telefon, e-poçt, sənaye, işçilər, ölkə, illik gəlir, təsvir) ya gizli, ya da yalnız oxunaqlı
          ola bilər. Görmədiyiniz və ya redaktə edə bilmədiyiniz sahə icazə məhdudiyyətidir, qüsur deyil.
        </p>
      </HelpCallout>
    </div>
  )
}
