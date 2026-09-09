"use client"

/**
 * MTM Şəkillər — help article (Azerbaijani).
 * Yalnız Marşrut və Saha → Şəkillər səhifəsini əhatə edir
 * (qalereya, status filtrləri, axtarış/çeşidləmə, görünüş rejimləri
 * — qalereya / müqayisə / toplu, şəkil təsdiqi/rəddi, silmə).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mtmphotosHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Saha supervayzeri və ya saha əməliyyatları administratorusunuz"
        goal="Saha agentlərinin yüklədiyi vizit şəkillərini yoxlamaq — təsdiqləmək, rədd etmək, müqayisə etmək və lazımsızları silmək"
      >
        Səhifəyə <HelpKey>Marşrut və Saha</HelpKey> → <HelpKey>Şəkillər</HelpKey> yolu ilə çatırsınız.
        Bütün şəkillər yalnız sizin təşkilatınıza aiddir və agentlərin ziyarətlər zamanı çəkdiyi
        şəkillərdir. Səhifə açılanda son şəkillər (200-ə qədər) yüklənir; siz yalnız yoxlayır və idarə
        edirsiniz — şəkilləri buradan yükləmirsiniz.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Şəkillər</HelpKey> adı (yanında mötərizədə cari süzgəcdən sonra görünən
          şəkil sayı) və altında «Şəkil qalereyası və yoxlama sistemi» izahı var. Sağ yuxarıda üç ikonlu
          görünüş keçidi (qalereya, müqayisə, toplu) və <HelpKey>Export</HelpKey> düyməsi durur. Altda
          dörd statistika kartı gəlir: <strong>Cəmi şəkil</strong>, <strong>Yoxlamada</strong>,{" "}
          <strong>Təsdiqlənmiş</strong> və <strong>Rədd edilmiş</strong>. Onların altında status
          süzgəcləri (sayları ilə), axtarış sahəsi və çeşidləmə siyahısı, ən altda isə şəkil qalereyası
          yerləşir — heç şəkil yoxdursa «Hələ şəkil yoxdur» yazısı çıxır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Cəmi şəkil">Yüklənmiş bütün şəkillərin ümumi sayı (statusdan asılı olmayaraq).</HelpDef>
          <HelpDef term="Yoxlamada">Hələ yoxlanmamış, qərar gözləyən şəkillər (PENDING status).</HelpDef>
          <HelpDef term="Təsdiqlənmiş">Sizin təsdiq etdiyiniz şəkillər (APPROVED).</HelpDef>
          <HelpDef term="Rədd edilmiş">Sizin rədd etdiyiniz şəkillər (REJECTED).</HelpDef>
          <HelpDef term="Status nişanı">Hər şəkil kartında rəngli etiket — yoxlamada (sarı), təsdiqlənmiş (yaşıl), rədd edilmiş (qırmızı).</HelpDef>
          <HelpDef term="Görünüş rejimi">Qalereya (standart şəbəkə), Müqayisə (yan-yana iki şəkil) və Toplu (çoxlu seçim ilə kütləvi əməliyyat) arasında keçid.</HelpDef>
        </dl>
        <p>
          Hər şəkil kartında üstdə şəkilin özü (yoxdursa kamera ikonası), altında agentin adı, müştərinin
          adı, status nişanı və bəyənmə/bəyənməmə sayğacları (<strong>baş barmaq yuxarı/aşağı</strong>)
          olur. Şəkil hələ yoxlamadadırsa, kartda <HelpKey>Təsdiq et</HelpKey> və <HelpKey>Rədd et</HelpKey>{" "}
          düymələri görünür; sağ aşağıda isə hər zaman qırmızı zibil qutusu ikonalı silmə düyməsi durur.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: şəkil tap və süz">
        <HelpStep n={1}>
          <p>
            Status üzrə daraltmaq üçün statistika kartlarının altındakı süzgəc düymələrindən birini
            basın: <HelpKey>Hamısı</HelpKey>, <HelpKey>Yoxlamada</HelpKey>, <HelpKey>Təsdiqlənmiş</HelpKey>{" "}
            və ya <HelpKey>Rədd edilmiş</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz düymə tünd (aktiv) rəngə keçir, qalereya yalnız həmin statusdakı şəkilləri
            göstərir, başlıqdakı say isə süzülmüş nəticəyə uyğun yenilənir. Hər süzgəc düyməsinin
            yanında mötərizədə həmin statusdakı şəkillərin sayı yazılıdır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Konkret agentin şəkillərini tapmaq üçün axtarış sahəsinə («Agentə görə axtar...») agentin
            adını yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca qalereya dərhal daralır — yalnız adı yazdığınız mətnə uyğun gələn agentlərin
            şəkilləri qalır. Heç nə uyğun gəlmirsə «Şəkil tapılmadı» mesajı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sıranı dəyişmək üçün axtarışın yanındakı çeşidləmə siyahısından <HelpKey>Əvvəlcə yeni</HelpKey>{" "}
            (tarixə görə, yenidən köhnəyə) və ya <HelpKey>Statusa görə</HelpKey> seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qalereyadakı şəkillərin düzülüşü seçiminizə uyğun yenidən sıralanır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: bir şəkli təsdiqlə və ya rədd et">
        <HelpStep n={1}>
          <p>
            Yoxlamada olan (sarı status nişanlı) şəkil kartını tapın. Yalnız bu cür şəkillərdə təsdiq/rədd
            düymələri görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kartın altında yaşıl <HelpKey>Təsdiq et</HelpKey> və qırmızı <HelpKey>Rədd et</HelpKey>{" "}
            düymələri yan-yana durur (artıq təsdiqlənmiş və ya rədd edilmiş şəkillərdə bu düymələr olmur).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Şəkil qaydasındadırsa <HelpKey>Təsdiq et</HelpKey>, problemlidirsə <HelpKey>Rədd et</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qısa təsdiq bildirişi (toast) çıxır, şəkilin status nişanı yenilənir, təsdiq/rədd düymələri
            yox olur və yuxarıdakı <strong>Yoxlamada</strong> / <strong>Təsdiqlənmiş</strong> /{" "}
            <strong>Rədd edilmiş</strong> kartlarındakı saylar uyğun olaraq dəyişir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: toplu (kütləvi) təsdiq/rədd">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı görünüş keçidində üçüncü ikona — <HelpKey>Toplu</HelpKey> (qeyd qutusu
            ikonası) — basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Toplu rejim aktivləşir və əvvəlki seçim sıfırlanır. Şəkil kartlarının sol yuxarı küncündə
            kiçik qeyd qutusu görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Əməliyyat aparmaq istədiyiniz şəkillərə bir-bir toxunaraq onları seçin.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş kart mavi çərçivə (ring) ilə işarələnir, küncündəki qeyd qutusunda işarə görünür.
            Ən az bir şəkil seçiləndə yuxarıda toplu əməliyyat paneli açılır və «Seçildi: N» yazır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Toplu panelindən <HelpKey>Hamısını təsdiq et</HelpKey> və ya <HelpKey>Hamısını rədd et</HelpKey>{" "}
            düyməsini basın. Seçimi ləğv etmək üçün <HelpKey>Təmizlə</HelpKey> istifadə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz bütün şəkillərin statusu eyni anda dəyişir, seçim sıfırlanır və statistika kartları
            yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: iki şəkli müqayisə et">
        <HelpStep n={1}>
          <p>
            Görünüş keçidində ikinci ikona — <HelpKey>Müqayisə</HelpKey> (sütunlar ikonası) — basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qalereyanın üstündə iki paneldən ibarət müqayisə sahəsi açılır: <strong>Sol</strong> və{" "}
            <strong>Sağ</strong>. Hələ şəkil seçilməyibsə hər panel «Aşağıdakı şəkillərdən birini seçin»
            ipucusunu göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Aşağıdakı qalereyadan bir şəklə, sonra ikincisinə toxunun.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Birinci şəkil <strong>Sol</strong> panelə, ikincisi <strong>Sağ</strong> panelə düşür; hər
            panelin başında agentin adı və statusu yazılır. Hər iki panel dolu ikən növbəti toxunuş
            sağdakını sola sürüşdürür və yeni şəkli sağa qoyur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: şəkli sil">
        <HelpStep n={1}>
          <p>
            Silmək istədiyiniz şəkil kartının sağ aşağı küncündəki qırmızı zibil qutusu ikonalı düyməni
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Şəkili sil» təsdiq pəncərəsi açılır və hansı şəkili (agentin adı, yoxdursa «bu şəkil»)
            silməyə çalışdığınızı göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Pəncərədə silməni təsdiqləyin (fikrinizi dəyişsəniz ləğv edin).</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Təsdiqdən sonra şəkil qalereyadan çıxır və statistika kartlarındakı saylar yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmə geri qaytarılmır — şəkil təşkilatınızın qalereyasından tamamilə çıxır. Şəkili sadəcə
            yanlış hesab edirsinizsə, silmək yerinə <HelpKey>Rədd et</HelpKey> ilə qeyd etmək daha
            təhlükəsizdir: o, qalereyada qalır, amma «Rədd edilmiş» kimi işarələnir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Süzgəc, axtarış və çeşidləmə bir-biri ilə birgə işləyir: əvvəlcə <HelpKey>Yoxlamada</HelpKey>{" "}
          süzgəcini seçib, sonra konkret agenti axtararaq qısa müddətdə yalnız yoxlanması lazım olan
          şəkilləri görə bilərsiniz. Çoxlu şəkil yoxlamalı olduqda <HelpKey>Toplu</HelpKey> rejimi ən
          sürətli yoldur.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün şəkillər təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın agentlərinin yüklədiyi
          şəkilləri görür, təsdiqləyir, rədd edir və silirsiniz. Başqa təşkilatın şəkilləri burada
          görünmür.
        </p>
      </HelpCallout>
    </div>
  )
}
