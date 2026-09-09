"use client"

/**
 * CDP — Profil birləşdirmə növbəsi (Identity Merge Queue) help article (Azerbaijani).
 * Köhnə birgə "cdp" məqaləsindən ayrılıb: YALNIZ
 * CDP → Profil birləşdirmə növbəsi səhifəsini əhatə edir
 * (ehtimal olunan dublikat cütlüklər, uyğunluq balı və bölünməsi,
 * yan-yana profil müqayisəsi, Birləşdir / Rədd et qərarı).
 * CDP-nin digər səhifələri (profil siyahısı, seqmentlər və s.) bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function cdpmergequeueHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Data administratoru və ya CRM/CDP-ya cavabdeh əməliyyat mütəxəssisisiniz"
        goal="Sistemin ehtimal olunan dublikat hesab etdiyi profil cütlüklərini yoxlamaq və hər biri üçün «birləşdir» və ya «rədd et» qərarı vermək"
      >
        Səhifə avtomatik aşkarlanan, bir-birinə oxşayan profil cütlüklərini göstərir. Burada heç nə
        özbaşına birləşmir — hər cütlük sizin təsdiqinizi gözləyir. Gündəlik skan oxşar email, telefon
        və ya ada görə ehtimal olunan dublikatları işarələyir; siz isə hansı iki profilin əslində eyni
        insan olduğunu təsdiqləyirsiniz. Bütün profillər və namizədlər yalnız sizin təşkilatınıza aiddir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda iki-ox ikonası ilə <HelpKey>Profil birləşdirmə növbəsi</HelpKey> adı və altında
          «Avtomatik aşkarlanan ehtimal olunan dublikat profil cütlükləri…» izahı durur. Altında dörd
          statistika kartı var: <strong>Yoxlama gözləyir</strong>, <strong>Ümumi aşkarlanıb</strong>,{" "}
          <strong>Əllə</strong> və <strong>Rədd edildi</strong>. Onların altında namizəd cütlüklərinin
          siyahısı gəlir — heç biri yoxdursa, yaşıl onay ikonası ilə boş vəziyyət göstərilir. Səhifənin
          altında isə hədlər və «gündəlik yenidən skan» haqqında iki kiçik qeyd var.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Profil (CDP profili)">Bir müştərinin müxtəlif kanallardan toplanmış vahid görüntüsü — ad, email, telefon, xərc və sifariş tarixçəsi ilə.</HelpDef>
          <HelpDef term="Namizəd (cütlük)">Sistemin «bəlkə eyni insandır» deyə işarələdiyi iki profil. Hər namizəd bir karta düşür və sizin qərarınızı gözləyir.</HelpDef>
          <HelpDef term="Uyğunluq balı">0–100% arası ümumi oxşarlıq göstəricisi; kartın solunda iri rəqəmlə göstərilir. Email, telefon və ad oxşarlığından hesablanır.</HelpDef>
          <HelpDef term="Yüksək etibarlılıq / Əl ilə yoxlama / Zəif uyğunluq">Balın səviyyəsini bildirən rəngli nişan (tier): yüksək bal yaşıl, orta sarı, aşağı boz.</HelpDef>
          <HelpDef term="Bölünmə (Email / Telefon / Ad)">Ümumi balın hansı hissədən gəldiyini ayrı-ayrı faizlərlə göstərir; məlumat yoxdursa «—» yazılır.</HelpDef>
          <HelpDef term="Əsas (qalib)">Birləşmədə saxlanılacaq profil — solda göstərilir.</HelpDef>
          <HelpDef term="İkincil (birləşdiriləcək)">Əsas profilə qatılacaq profil — sağda göstərilir.</HelpDef>
        </dl>
        <p>
          Hər statistika kartı belə oxunur: <strong>Yoxlama gözləyir</strong> — qərarınızı gözləyən
          cütlüklərin sayı (0-dan çox olduqda sarı rənglə vurğulanır); <strong>Ümumi aşkarlanıb</strong>{" "}
          — indiyə qədər işarələnmiş bütün cütlüklər; <strong>Əllə</strong> — sizin əllə birləşdirdiyiniz
          cütlüklər; <strong>Rədd edildi</strong> — rədd etdiyiniz cütlüklər.
        </p>
        <p>
          Hər namizəd kartında solda iri faizlə <strong>uyğunluq balı</strong>, yanında rəngli{" "}
          <strong>səviyyə nişanı</strong> və «işarələndi …» mətni (varsa səbəb də), sağ yuxarıda isə{" "}
          <strong>Email / Telefon / Ad</strong> bölünməsi durur. Altda yan-yana iki profil kartı və
          aralarında iki-ox ikonası var: solda <strong>Əsas (qalib)</strong>, sağda{" "}
          <strong>İkincil (birləşdiriləcək)</strong>. Hər profil kartında ad, email, telefon, ID-nin son
          8 simvolu, <strong>Xərclənib</strong> və <strong>Sifarişlər</strong> rəqəmləri, sonuncu
          görünmə tarixi və aktiv kanal sayı göstərilir. Kartın aşağısında sağda iki düymə var:{" "}
          <HelpKey>Rədd et</HelpKey> və <HelpKey>Birləşdir</HelpKey>.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: namizəd cütlüyünü yoxla">
        <HelpStep n={1}>
          <p>
            Yuxarıdakı statistika kartlarına nəzər salın və <strong>Yoxlama gözləyir</strong> sayının
            neçə olduğunu görün. Sonra siyahıdan ilk namizəd kartına baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Yoxlama gözləyir</strong> sıfırdan böyükdürsə, rəqəm sarı rənglə vurğulanır. Hər
            namizəd kart şəklində ayrıca göstərilir; növbə təmizdirsə, bunun yerinə yaşıl onay ikonası
            ilə «Növbədə namizəd yoxdur — təmizdir.» mesajı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Kartın solundakı iri faizə — <strong>uyğunluq balına</strong> — və yanındakı rəngli səviyyə
            nişanına baxın: <HelpKey>Yüksək etibarlılıq</HelpKey>, <HelpKey>Əl ilə yoxlama</HelpKey> və
            ya <HelpKey>Zəif uyğunluq</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Nişanın altında «işarələndi &lt;vaxt&gt;» (məs. «bu gün», «3 gün əvvəl») yazısı görünür; bal
            üçün səbəb saxlanıbsa, onun yanında nöqtə ilə əlavə olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sağ yuxarıdakı bölünməyə baxın: <strong>Email</strong>, <strong>Telefon</strong> və{" "}
            <strong>Ad</strong> oxşarlığının hər biri ayrıca faizlə göstərilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər üç dəyər faizlə (məs. «Email 96%»), uyğun məlumat olmadıqda isə «—» kimi göstərilir.
            Bu, ümumi balın əsasən hansı sahədən gəldiyini başa düşməyə kömək edir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Aşağıdakı iki profil kartını yan-yana müqayisə edin: solda{" "}
            <strong>Əsas (qalib)</strong>, sağda <strong>İkincil (birləşdiriləcək)</strong>. Ad, email,
            telefon, xərc, sifariş sayı və sonuncu görünmə tarixinə diqqət edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kartda ad, varsa email (zərf ikonası) və telefon (telefon ikonası), sağ yuxarıda ID-nin
            son 8 simvolu, <strong>Xərclənib</strong> və <strong>Sifarişlər</strong> rəqəmləri, altda
            isə sonuncu görünmə və aktiv kanal sayı görünür. Profillərdən biri yoxlamadan əvvəl
            silinibsə, onun yerində «Profil yoxdur (yoxlamadan əvvəl silinib)» yazısı durur. Adı olmayan
            profil «Adsız» kimi göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: cütlüyü birləşdir və ya rədd et">
        <HelpStep n={1}>
          <p>
            İki profilin həqiqətən eyni insan olduğuna əmin olduqda kartın aşağı-sağındakı{" "}
            <HelpKey>Birləşdir</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə qısa müddətə fırlanan ikonaya keçir (emal gedir), sonra kart siyahıdan çıxır.{" "}
            <strong>Yoxlama gözləyir</strong> sayı bir azalır, <strong>Əllə</strong> sayı isə bir artır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İki profilin fərqli insanlar olduğunu düşünürsünüzsə, əvəzinə <HelpKey>Rədd et</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart siyahıdan çıxır; <strong>Yoxlama gözləyir</strong> sayı bir azalır,{" "}
            <strong>Rədd edildi</strong> sayı isə bir artır. Profillər toxunulmaz qalır — heç nə
            birləşmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Növbəti namizəd kartına keçin və qərar verə biləcəyiniz cütlük qalmayana qədər prosesi təkrar
            edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bütün cütlükləri emal etdikdən sonra siyahı yaşıl onay ikonalı «Növbədə namizəd yoxdur —
            təmizdir.» boş vəziyyətinə keçir. Onun altında həddləri izah edən qısa mətn də görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Qərar verməkdə çətinlik çəkirsinizsə, profil kartlarındakı <strong>Xərclənib</strong>,{" "}
          <strong>Sifarişlər</strong> və <strong>sonuncu görünmə</strong> rəqəmlərinə güvənin: real
          tarixçəsi olan profil adətən saxlanmağa layiq «qalib»dir. Yüksək <strong>Email</strong> və ya{" "}
          <strong>Telefon</strong> bölünməsi adətən güclü siqnaldır; yalnız <strong>Ad</strong> üzrə
          oxşarlıq isə təsadüfi ola bilər — belə cütlüklərə daha diqqətlə baxın.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Səhifənin yuxarısında sarı zolaq görsəniz, növbə kəsilib — yalnız bal üzrə ilk bir neçə yüz
          namizəd göstərilir. Bu o deməkdir ki, ən yüksək ballı (ən çox oxşar) cütlükləri əvvəl
          yoxlayın; onları emal etdikcə qalanları da görünəcək. Səhifənin altındakı qeydə görə{" "}
          <strong>{"<"} {"{manual}"}%</strong>-dən aşağı ballar ümumiyyətlə göstərilmir (atılır), dəqiq
          dublikatlar (eyni email və ya telefon) isə avtomatik birləşir və bura heç düşmür.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün profillər və namizəd cütlüklər təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın
          profillərini görür və birləşdirirsiniz; başqa təşkilatın məlumatları bu növbədə görünmür.
        </p>
      </HelpCallout>
    </div>
  )
}
