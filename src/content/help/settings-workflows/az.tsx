"use client"

/**
 * Tənzimləmələr → İş axınları — kömək məqaləsi (Azərbaycanca).
 * en.tsx-in güzgüsü: «İş axınları» səhifəsi (/settings/workflows) +
 * «İş axını şablonları» (/settings/workflows/templates) — kodsuz
 * avtomatlaşdırma konstruktoru.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SettingsWorkflowsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="İş axınları nə edir">
        <p>
          <strong>İş axını</strong> — avtomatlaşdırma qaydasıdır: o, müəyyən tip qeydləri izləyir və
          onlarla nəsə baş verdikdə sizin əvəzinizə bir və ya bir neçə əməliyyatı özü icra edir —
          kodsuz. Quruluş həmişə eynidir: <em>nə vaxt</em> bir <strong>tetikleyici</strong>{" "}
          <strong>obyekt</strong> üzərində işə düşür (və istəyə bağlı <strong>şərtlər</strong> uyğun
          gəlir), <em>onda</em> <strong>əməliyyatlar</strong> siyahısı ardıcıllıqla icra olunur.
        </p>
        <p>
          Qaydaları <strong>İş axınları</strong> səhifəsində sıfırdan qura, ya da hazırını{" "}
          <strong>İş axını şablonları</strong> bölməsindən bir kliklə tətbiq edib sonra dəyişə
          bilərsiniz.
        </p>
      </HelpSection>

      <HelpSection title="İş axınları siyahısı">
        <p>
          Əsas səhifədə hər qaydanın kartının üstündə üç sayğac var — <HelpKey>Cəmi</HelpKey>,{" "}
          <HelpKey>Aktiv</HelpKey>, <HelpKey>Qeyri-aktiv</HelpKey>. Hər kart qaydanı sadə dillə
          təsvir edir, məsələn <em>«Lid Yaradıldıqda → E-poçt göndər»</em>, əməliyyat çiplərini
          göstərir və qayda qeyri-aktiv olanda solğunlaşır.
        </p>
        <HelpStep n={1}>
          <p>
            <HelpKey>İş axınlarını axtar…</HelpKey> siyahını yazdıqca qaydanın adına görə süzgəcləyir.
            (Yalnız ada görə uyğunlaşdırır, tetikleyicilərə və ya əməliyyatlara görə yox.)
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstənilən kartda: <HelpKey>Əməliyyatlar</HelpKey> əməliyyat redaktorunu açır,{" "}
            <HelpKey>qələm</HelpKey> tetikleyicini və şərtləri redaktə edir, <HelpKey>başlat / fasilə</HelpKey>{" "}
            düyməsi qaydanı yandırır və ya söndürür, <HelpKey>zibil qutusu</HelpKey> nişanı isə onu
            silir.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Fasilə dərhal işləyir — fasiləyə qoyulmuş qayda öz tərtibatını saxlayır, amma işə
            düşməyi dayandırır. Yalnız <strong>aktiv</strong> qaydalar işə düşür.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            İlk dəfədir? Birdəfəlik banner sizi şablon qalereyasına yönəldir, sağ yuxarıdakı{" "}
            <HelpKey>Şablonlara bax</HelpKey> düyməsi isə onu istənilən vaxt açır. Şablonlar işlək
            qaydaya çatmağın ən sürətli yoludur.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Qayda qurmaq — tetikleyici">
        <p>
          <HelpKey>Yeni iş axını</HelpKey> (və ya kartdakı qələm) qayda formasını açır. Burada
          qaydanın nəyi izlədiyini təyin edirsiniz; əməliyyatlar sonra, ayrıca redaktorda
          qurulur.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ad">Qaydanın etiketi — mütləqdir.</HelpDef>
          <HelpDef term="Obyekt">satış, lid, ticket, tapşırıq, kontakt və ya şirkət.</HelpDef>
          <HelpDef term="Tetikleyici">
            yaradıldı, yeniləndi, status&nbsp;dəyişdi, mərhələ&nbsp;dəyişdi, təyin edildi və ya
            müştərinin e-poçt cavabı.
          </HelpDef>
          <HelpDef term="Aktiv">Yadda saxlayan kimi qaydanın işləyib-işləməyəcəyi.</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            İstəyə görə <strong>şərtlər</strong> əlavə edin ki, qayda yalnız uyğun qeydlərdə işə
            düşsün. Hər şərt bir <em>sahə</em>, <em>operator</em> və <em>dəyər</em>-dən ibarətdir.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sahələr: status, mərhələ, mənbə, məsul şəxs, prioritet və məbləğ. Operatorlar:{" "}
            <em>bərabərdir</em>, <em>bərabər deyil</em>, <em>tərkibindədir</em>, <em>boş deyil</em>,{" "}
            <em>böyükdür</em> və <em>kiçikdir</em> (<em>boş deyil</em> üçün dəyər lazım deyil). Bir
            neçəsini əlavə edin — və <strong>hamısı</strong> uyğun gəlməlidir.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Şərtsiz qayda seçilmiş tetikleyici üçün həmin obyektin hər qeydində işə düşür — hər yeni lidə
            ümumi «xoş gəldin məktubu» üçün əlverişlidir, amma əhatəni daraltmaq istəyəndə şərt əlavə
            edin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Əməliyyatların əlavə edilməsi">
        <p>
          Kartda <HelpKey>Əməliyyatlar</HelpKey> düyməsini basıb axın redaktorunu açın. O, yuxarıda{" "}
          <strong>Tetikleyici</strong>-ni və onun altında hər əməliyyatı icra ardıcıllığında düzür.{" "}
          <HelpKey>Əməliyyat əlavə et</HelpKey> əlavə edir, qələm redaktə edir, zibil qutusu silir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="E-poçt göndər">Şablon adı və mövzu.</HelpDef>
          <HelpDef term="Tapşırıq yarat">Başlıq, təsvir, prioritet və icraçı (istifadəçi ID-si).</HelpDef>
          <HelpDef term="Sahəni yenilə">Sahə adı və yeni dəyər.</HelpDef>
          <HelpDef term="Bildiriş göndər">Komandanıza sistem daxili mesaj.</HelpDef>
          <HelpDef term="Vebhuk">URL və HTTP metodu (GET / POST / PUT).</HelpDef>
          <HelpDef term="Avtomatik təyinat">Qeydin təyin ediləcəyi istifadəçi ID-si.</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            Siyahını qurun, əməliyyatları əlavə etmə sırası ilə düzün, sonra{" "}
            <HelpKey>Yadda saxla</HelpKey>. Əməliyyatlar tetikleyici və şərtlər uyğun gələn hər dəfə
            yuxarıdan aşağıya icra olunur.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Əməliyyat redaktorunu yadda saxlamaq həmin qaydanın{" "}
            <strong>bütün əməliyyat siyahısını</strong> birdəfəyə əvəz edir — bu, qismən redaktə
            deyil. Yadda saxlamazdan əvvəl bütün zənciri yoxlayın və dəyişiksiz çıxmaq üçün{" "}
            <HelpKey>İmtina</HelpKey> istifadə edin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="İş axını şablonları — hazır qaydadan başlayın">
        <p>
          <HelpKey>Şablonlara bax</HelpKey> qalereyanı açır; o, kateqoriyalara bölünüb — bu gün
          hazır şablonlar <strong>Satış</strong>, <strong>Dəstək</strong> və{" "}
          <strong>Əməliyyatlar</strong> bölmələrinə aiddir (yalnız ən azı bir şablonu olan
          kateqoriyalar görünür). Hər kartda tetikleyici <code>entity.trigger</code> kimi və neçə
          əməliyyat olduğu göstərilir. Bu gün hazır olanlar arasında: yeni lidlərə xoş gəldin
          məktubu, lidlərin növbə ilə paylanması, udulmuş satışa görə təşəkkür, yeni ticketin
          təsdiqi və buraxılmış zəngdən sonra SMS var.
        </p>
        <HelpStep n={1}>
          <p>
            Önizləməni açmaq üçün <HelpKey>Önizlə və tətbiq et</HelpKey> düyməsini basın. Təhlükəsiz
            sahələr — mövzu, mətn, mesaj, başlıq və <strong>dəqiqələrlə gecikmə</strong> (0–1440) —
            tətbiq etməzdən əvvəl elə burada redaktə edilə bilər.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Şablonu tətbiq et</HelpKey> qaydanı yaradır və sizi iş axınları siyahısına
            qaytarır; orada onu istənilən başqası kimi cilalaya bilərsiniz.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>0</strong> gecikməsi əməliyyatı dərhal işə salır; müsbət dəyər isə həmin sayda
            dəqiqə gözləyir (buraxılmış zəng SMS şablonu kiçik gecikmə ilə gəlir ki, işçi əvvəlcə geri
            zəng vura bilsin).
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Artıq istifadə etdiyiniz şablonu yenidən tətbiq etsəniz, <strong>təkrar</strong> barədə
            xəbərdarlıq alacaqsınız; sayı <HelpKey>Tətbiq edilib (N)</HelpKey> nişanı izləyir. Davam
            etmək üçün yenidən tətbiq xanasını işarələyin — o, qəsdən ikinci nüsxə yaradır. SMS
            göndərən şablonlarda <HelpKey>SMS lazımdır</HelpKey> nişanı görünür və{" "}
            <strong>Tənzimləmələr → VoIP</strong> bölməsində provayder qoşana qədər bloklanmış qalır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Qaydalar nə vaxt və necə işə düşür">
        <p>
          Qaydalar uyğun CRM hadisəsində işə düşür — qeyd yaradılanda, yenilənəndə, təyin ediləndə və
          s. Mühərrik həmin obyekt və tetikleyici üçün <strong>aktiv</strong> qaydalarınızı tapır, şərtləri
          yoxlayır, sonra hər əməliyyatı <strong>əməliyyat sırası</strong> ilə icra edir.
        </p>
        <HelpStep n={1}>
          <p>
            Əksər əməliyyatlar yerindəcə işləyir. <strong>Gecikməsi</strong> olan əməliyyat isə
            növbəyə qoyulur və sonra fon icraçısı tərəfindən icra olunur — uğursuzluq olarsa, üç dəfəyə
            qədər təkrarlanır.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>SMS</strong> əməliyyatı (şablonlar vasitəsilə gəlir) göndərmə anında{" "}
            <code>{"{{field}}"}</code> əvəzləmələrini (məsələn, <code>{"{{firstName}}"}</code>)
            qeyddən doldurur. <strong>E-poçt göndər</strong> və <strong>bildiriş göndər</strong>{" "}
            mətni olduğu kimi göndərir, ona görə burada əvəzləmələrə bel bağlamaq əvəzinə konkret
            mövzu və mətn yazın.
          </p>
        </HelpStep>
        <HelpCallout kind="next">
          <p>
            Şablonlarda əl redaktorunda görünməyən əməliyyat tipləri də var — məsələn,{" "}
            <strong>SMS</strong> və <strong>Slack bildirişi</strong>. Onlardan istifadə edən şablonu
            tətbiq edin, sonra qalan sahələrini burada redaktə edin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          İş axınları təşkilatınızla məhdudlaşır — tətbiq etdiyiniz hər qayda, əməliyyat və şablon
          yalnız sizin tenant-ınıza aiddir, server isə təşkilatı sorğu başlığından yox, sessiyanızdan
          müəyyən edir. Təhlükəsizlik üçün <strong>Sahəni yenilə</strong> yalnız hər obyekt üçün
          sabit icazəli sahələr siyahısına toxuna bilir (telefon nömrələrini, zəng yazılarını və digər
          sistem dəyərlərini üzərinə yazmır), <strong>Vebhuk</strong> əməliyyatı isə şəxsi və ya daxili
          şəbəkə ünvanlarına müraciət edə bilmir.
        </p>
      </HelpCallout>
    </div>
  )
}
