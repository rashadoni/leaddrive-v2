"use client"

/**
 * App Marketplace — help article (Azerbaijani).
 * `/marketplace` səhifəsini əhatə edir: kataloqdakı tətbiqlərə baxış,
 * quraşdırma (Install), söndürmə/aktiv etmə (Power) və silmə (Uninstall).
 * Bütün təsvirlər real UI-dan götürülüb: kateqoriya üzrə qruplaşmış kart
 * şəbəkəsi, kart üzərindəki vəziyyət nişanları və düymələr, boş vəziyyət.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MarketplaceHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Administrator və ya əməliyyat məsulusunuz"
        goal="LeadDrive-ı əlavə tətbiqlərlə — xüsusi sahələr, inteqrasiyalar və avtomatlaşdırmalarla — genişləndirmək: kataloqdan tətbiq seçib quraşdırmaq, lazım gəldikdə söndürmək və ya silmək"
      >
        Səhifə <HelpKey>Tətbiq Mağazası</HelpKey> adlanır. Burada görünən bütün tətbiqlər ümumi kataloqdan
        gəlir, lakin quraşdırma vəziyyəti — yəni nəyin <strong>Quraşdırılıb</strong> və ya{" "}
        <strong>Söndürülüb</strong> olması — yalnız sizin təşkilatınıza aiddir. Tətbiqi quraşdırdıqda və ya
        sildikdə kartlar dərhal yenidən yüklənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Tətbiq Mağazası</HelpKey> adı, altında isə «LeadDrive-ı xüsusi sahələr,
          inteqrasiyalar və avtomatlaşdırmalarla genişləndirən tətbiqləri nəzərdən keçirin və quraşdırın»
          izahı var. Səhifə açılarkən bir müddət <strong>Kataloq yüklənir…</strong> yazısı görünür. Kataloq
          boşdursa, ortada bağlama (paket) ikonası ilə <strong>Kataloq boşdur.</strong> mesajı göstərilir.
          Tətbiqlər varsa, onlar <strong>kateqoriyalar üzrə</strong> bölünür: hər kateqoriyanın adı (kateqoriyası
          olmayanlar üçün <strong>Digər</strong>) bölmə başlığı olur, altında isə tətbiq kartları şəbəkə şəklində düzülür.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Tətbiq kartı">Bir tətbiqi təmsil edir: ikon, ad, təchizatçı, versiya, qısa təsvir və əməliyyat düymələri.</HelpDef>
          <HelpDef term="Rəsmi">Tətbiq LeadDrive tərəfindən təqdim olunubsa, ad yanında bu nişan görünür (birinci tərəf tətbiqi).</HelpDef>
          <HelpDef term="Təchizatçı · v…">Kartda adın altında təchizatçının adı və tətbiqin versiyası göstərilir.</HelpDef>
          <HelpDef term="Quraşdırılıb">Yaşıl nişan — tətbiq təşkilatınızda quraşdırılıb və aktivdir.</HelpDef>
          <HelpDef term="Söndürülüb">Sarı nişan — tətbiq quraşdırılıb, amma müvəqqəti olaraq söndürülüb.</HelpDef>
          <HelpDef term="Sənədlər">Tətbiqin sənəd səhifəsinə açıq linkdir (varsa) — yeni nişanda açılır.</HelpDef>
        </dl>
        <p>
          Hər kartın aşağı hissəsində vəziyyətdən asılı düymələr olur. Tətbiq <strong>quraşdırılmayıbsa</strong>,{" "}
          <HelpKey>Quraşdır</HelpKey> düyməsi (plus ikonası ilə) görünür. Tətbiq{" "}
          <strong>quraşdırılıbsa</strong>, kartda vəziyyət nişanı (yaşıl <strong>Quraşdırılıb</strong> və ya
          sarı <strong>Söndürülüb</strong>) və yanında iki ikon düyməsi olur: güc (power) ikonası ilə
          aktiv et / söndür və qırmızı zibil qutusu ikonası ilə sil. Kartda təchizatçı sənəd ünvanı təyin
          edibsə, sağ tərəfdə <HelpKey>Sənədlər</HelpKey> linki görünür.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: tətbiqi quraşdır">
        <HelpStep n={1}>
          <p>
            Kataloqu nəzərdən keçirin və istədiyiniz tətbiqi tapın. Kartlar kateqoriyalar üzrə qruplaşdığı üçün
            müvafiq bölmə başlığının altına baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kateqoriya başlığının altında tətbiq kartları görünür. Hər kartda ikon, tətbiqin adı,
            təchizatçı və versiya, varsa iki sətirlik qısa təsvir, aşağıda isə əməliyyat düymələri olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Quraşdırılmamış tətbiqin kartındakı <HelpKey>Quraşdır</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə fırlanan ikon və <strong>Quraşdırılır…</strong> yazısına keçir. Quraşdırma uğurla bitdikdə
            kart yenilənir: <HelpKey>Quraşdır</HelpKey> düyməsinin yerinə yaşıl <strong>Quraşdırılıb</strong>{" "}
            nişanı, güc ikonalı söndürmə düyməsi və qırmızı silmə düyməsi gəlir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Tətbiq əlavə parametr (konfiqurasiya) tələb edirsə, quraşdırma alınmayacaq və yuxarıda xəta mesajı çıxacaq.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Səhifənin yuxarısında qırmızı zolaqda <strong>Quraşdırma alınmadı</strong> mesajı, lazım gələrsə
            yanında <strong>(çatışmır: …)</strong> şəklində çatışmayan parametrlərin siyahısı göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: tətbiqi söndür və ya yenidən aktiv et">
        <HelpStep n={1}>
          <p>
            Quraşdırılmış tətbiqin kartında güc (power) ikonalı düyməni basın. Tətbiq aktivdirsə bu düymə{" "}
            <HelpKey>Söndür</HelpKey>, söndürülübsə <HelpKey>Aktiv et</HelpKey> funksiyasını yerinə yetirir
            (düymənin üzərinə gətirdikdə bu ad ipucu kimi görünür).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Əməliyyat icra olunarkən düymələr müvəqqəti bağlanır. Sonra kartdakı nişan yaşıl{" "}
            <strong>Quraşdırılıb</strong> ilə sarı <strong>Söndürülüb</strong> arasında keçir. Tətbiq silinmir —
            yalnız aktiv/söndürülmüş vəziyyəti dəyişir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: tətbiqi sil">
        <HelpStep n={1}>
          <p>
            Quraşdırılmış tətbiqin kartında qırmızı zibil qutusu ikonalı (<HelpKey>Sil</HelpKey>) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Brauzerin təsdiq pəncərəsi açılır: «&lt;tətbiq adı&gt; silinsin? Parametrlər audit üçün saxlanılır.»
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Təsdiq edin (<HelpKey>OK</HelpKey>). Fikrinizi dəyişsəniz <HelpKey>Ləğv et</HelpKey> seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Təsdiqdən sonra kart yenidən «quraşdırılmamış» vəziyyətə qayıdır: vəziyyət nişanı yox olur və yerinə
            <HelpKey>Quraşdır</HelpKey> düyməsi gəlir. Silinmə alınmasa, yuxarıda <strong>Silinmə alınmadı</strong>{" "}
            mesajı göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmə təsdiq pəncərəsinin xəbərdar etdiyi kimi <strong>parametrlər audit üçün saxlanılır</strong> —
            yəni tətbiq silinir, lakin əvvəlki konfiqurasiya tarixçə kimi qalır. Tətbiqi sadəcə müvəqqəti dayandırmaq
            istəyirsinizsə, silmək yerinə güc düyməsi ilə <HelpKey>Söndür</HelpKey> seçin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Quraşdırılmış tətbiqin versiyası kataloqdakı versiyadan geri qalırsa, kartda adın altında sarı rəngdə{" "}
          <strong>(kataloqda: v…)</strong> qeydi görünür — bu, daha yeni versiyanın mövcud olduğunu bildirir.
          Tətbiq haqqında ətraflı məlumat üçün varsa <HelpKey>Sənədlər</HelpKey> linkindən istifadə edin (yeni
          nişanda açılır).
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Kataloq bütün tenant-lar üçün ortaq olsa da, quraşdırma vəziyyəti təşkilatınızla məhdudlaşır: bir
          tətbiqi quraşdırmaq, söndürmək və ya silmək yalnız sizin təşkilatınıza təsir edir, başqa təşkilatların
          quraşdırmalarını görmür və dəyişdirmirsiniz.
        </p>
      </HelpCallout>
    </div>
  )
}
