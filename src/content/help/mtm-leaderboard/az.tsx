"use client"

/**
 * MTM Reytinq (Leaderboard) — help article (Azerbaijani).
 * Yalnız Marşrut & Sahə (MTM) → Reytinq səhifəsini əhatə edir:
 * dövr seçimi (həftəlik/aylıq/bütün vaxt), tam reytinq siyahısı,
 * nailiyyətlər paneli (lider agentin) və Həftəlik Top 3 kartı.
 * Bu səhifə yalnız OXUNUR — burada heç nə yaradılmır və ya redaktə
 * edilmir; bütün rəqəmlər vizit, tapşırıq və foto verilənlərindən hesablanır.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mtmleaderboardHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sahə əməliyyatları rəhbəri və ya MTM administratorusunuz"
        goal="Agentlərin performansını bir baxışda müqayisə etmək — kim daha çox vizit edib, tapşırıqları tamamlayıb və foto təsdiqlədib — və lideri görmək"
      >
        Səhifəyə <HelpKey>Marşrut & Sahə</HelpKey> → <HelpKey>Reytinq</HelpKey> yolu ilə çatırsınız. Bu
        səhifə tamamilə oxunaqlıdır: burada düymə basıb məlumat yaratmırsınız, sadəcə agentlərin
        nəticələrini izləyirsiniz. Bütün reytinq yalnız sizin təşkilatınızın agentləri üçün hesablanır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda kubok ikonası ilə <HelpKey>Reytinq</HelpKey> adı və altında «Agent performans
          reytinqi və nailiyyətləri» izahı var. Sağ yuxarıda üç dövr düyməsi durur:{" "}
          <HelpKey>Həftəlik</HelpKey>, <HelpKey>Aylıq</HelpKey> və <HelpKey>Bütün vaxt</HelpKey> —
          standart olaraq <strong>Aylıq</strong> seçilidir. Aşağıda səhifə üç sütuna bölünür: solda
          (geniş hissədə) <strong>Tam reytinq</strong> siyahısı, sağda isə <strong>Nailiyyətlər</strong>{" "}
          paneli və onun altında <strong>Həftəlik Top 3</strong> kartı.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Dövr (Həftəlik / Aylıq / Bütün vaxt)">Reytinqin hansı vaxt aralığı üzrə hesablandığını seçir; düyməyə basanda siyahı dərhal yenidən yüklənir.</HelpDef>
          <HelpDef term="Tam reytinq">Agentlərin xala görə sıralanmış siyahısı — sıra nömrəsi, ad, nəticə zolağı, vizit/tapşırıq/foto sayları və ümumi xal.</HelpDef>
          <HelpDef term="Xal">Agentin həmin dövrdəki ümumi balı; sətrin sağında «xal» qeydi ilə göstərilir.</HelpDef>
          <HelpDef term="Nailiyyətlər">Birinci yerdəki (lider) agentin qazandığı nişanlar — hər biri ad, təsvir və irəliləyiş zolağı ilə.</HelpDef>
          <HelpDef term="Həftəlik Top 3">İlk üç agentin qısa siyahısı (yalnız ən azı üç agent olduqda görünür).</HelpDef>
        </dl>
        <p>
          Tam reytinqdə hər sətir belə oxunur: solda dairəvi <strong>sıra nömrəsi</strong> (1-ci sarı,
          2-ci boz, 3-cü narıncı fonla seçilir), yanında agentin adının ilk hərfi ilə dairə, sonra ad
          və altında nəticə zolağı. Sağda üç kiçik göstərici durur: <HelpKey>👁</HelpKey> vizitlər,{" "}
          <HelpKey>✓</HelpKey> tamamlanmış tapşırıqlar və <HelpKey>📷</HelpKey> təsdiqlənmiş fotolar;
          ən sağda isə xal. Heç agent yoxdursa, siyahının yerinə «Agent tapılmadı» yazısı çıxır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: reytinqi dövrə görə oxu">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı dövr düymələrindən birini seçin: <HelpKey>Həftəlik</HelpKey>,{" "}
            <HelpKey>Aylıq</HelpKey> və ya <HelpKey>Bütün vaxt</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz düymə dolu (vurğulanmış), digər ikisi isə konturlu görünür. Siyahı qısa müddət
            yenilənir və <strong>Tam reytinq</strong> həmin dövrün nəticələrini göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sol tərəfdəki <HelpKey>Tam reytinq</HelpKey> siyahısına baxın və agentləri yuxarıdan aşağı
            (1-ci yerdən başlayaraq) müqayisə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə sıra nömrəsi, adın ilk hərfi olan dairə, ad və nəticə zolağı görünür. Zolağın
            uzunluğu agentin xalını siyahıdakı ən yüksək xalla nisbətdə göstərir — lider tam dolu olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bir agentin nəyə görə bu sırada olduğunu anlamaq üçün sağdakı kiçik göstəricilərin
            üzərinə kursoru gətirin: <HelpKey>👁</HelpKey>, <HelpKey>✓</HelpKey> və <HelpKey>📷</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər ikonun üstündə izah açılır: «Vizitlər», «Tapşırıqlar» və «Fotolar». Rəqəmlər müvafiq
            olaraq vizit, tamamlanmış tapşırıq və təsdiqlənmiş foto saylarını bildirir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: nailiyyətlərə və Top 3-ə bax">
        <HelpStep n={1}>
          <p>
            Sağdakı <HelpKey>Nailiyyətlər</HelpKey> panelinə baxın — burada birinci yerdəki (lider)
            agentin nişanları göstərilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər nişanın yanında ikon, adı (məs. «Sürət ustası», «Foto çempionu», «Ardıcıl uğur»,
            «Müştəri dostu», «Mükəmməl həftə»), bir sətirlik təsvir, irəliləyiş zolağı və sağda{" "}
            <strong>cari/hədəf</strong> şəklində say durur. Tamamlanmış nişanın zolağı yaşıl, davam
            edənin isə sarı olur. Hələ heç agent yoxdursa, panelin yerinə «Nailiyyətləri görmək üçün
            agent seçin» mesajı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Nailiyyətlər panelinin altındakı <HelpKey>Həftəlik Top 3</HelpKey> kartına nəzər salın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İlk üç agent qısa siyahı kimi sıralanır: hər sətirdə rəng kodlu <strong>#sıra</strong>{" "}
            (1-ci sarı, 2-ci boz, 3-cü narıncı), ad və xal göstərilir. Bu kart yalnız reytinqdə ən azı
            üç agent olduqda peyda olur — daha az agent varsa, ümumiyyətlə görünmür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Reytinq özü dəyişdirilə bilməyən hesablama nəticəsidir — burada agent əlavə etmir, xalı
          əllə düzəltmirsiniz. Sıralamaya təsir etmək üçün mənbə işlərə qayıdın: vizitləri tamamlatdırın,
          tapşırıqları bağlatdırın və foto təsdiqlərini sürətləndirin. Müqayisəni ədalətli saxlamaq üçün
          əvvəlcə <HelpKey>Bütün vaxt</HelpKey> ilə uzunmüddətli mənzərəni, sonra <HelpKey>Həftəlik</HelpKey>{" "}
          ilə cari templə baxın.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <strong>Nailiyyətlər</strong> paneli yalnız hazırda birinci yerdə olan agentin nişanlarını
          göstərir, bütün komandanın yox. Dövrü dəyişəndə və ya sıralama yeniləndikdə lider dəyişə
          bilər — bu zaman paneldəki nişanlar da yeni liderə uyğun yenilənir. <HelpKey>Həftəlik Top 3</HelpKey>{" "}
          kartı isə üç agentdən azı olduqda heç görünmür, ona görə kiçik komandalarda onu axtarmayın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Reytinq yalnız sizin təşkilatınızın agentləri üzrə hesablanır — başqa tenant-ın nəticələrini
          görmürsünüz. Səhifə tələbi cari təşkilatınızla məhdudlaşdırılır; məlumat gəlməsə, yuxarıda
          xəbərdarlıq bildirişi çıxır və siyahı boş qalır.
        </p>
      </HelpCallout>
    </div>
  )
}
