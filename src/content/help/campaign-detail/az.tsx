"use client"

/**
 * Campaign detail (kampaniya kartı) — help article (Azerbaijani).
 * Yalnız tək kampaniyanın detal səhifəsini əhatə edir:
 * /campaigns/[id] — başlıq + status, KPI kartları, Yazmaq (Compose),
 * Nəticələr, Flow, Detallar və A/B test tabları, göndər/redaktə/sil
 * əməliyyatları. Kampaniya siyahısı və yaratma bura DAXİL DEYİL
 * (onlar "campaigns" məqaləsindədir).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CampaigndetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq və ya satış komandasının üzvüsünüz"
        goal="Konkret bir kampaniyanın kartını açıb məzmununu hazırlamaq, göndərmək və nəticələrini izləmək"
      >
        Bu səhifəyə kampaniya siyahısında (<HelpKey>Kampaniyalar</HelpKey>) hər hansı bir
        kampaniyanın üzərinə klikləməklə düşürsünüz. Səhifə bir kampaniyaya aiddir və hər şey
        sizin təşkilatınızla məhdudlaşır. Burada görəcəyiniz düymələr və tablar kampaniyanın
        <strong> statusundan</strong> asılıdır: məsələn, <HelpKey>Yazmaq</HelpKey> tabı və{" "}
        <HelpKey>Kampaniyanı göndər</HelpKey> düyməsi yalnız kampaniya hələ qaralama (və ya
        planlaşdırılmış) vəziyyətdə olanda görünür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda geri (<HelpKey>←</HelpKey>) düyməsi sizi siyahıya qaytarır, yanında reproduktor
          ikonası, kampaniyanın adı, altında isə iki nişan durur: <strong>status</strong> (Qaralama,
          Planlaşdırılıb, Göndərilir, Göndərildi, Ləğv edildi və s.) və kampaniyanın{" "}
          <strong>növü</strong> (məsələn email). Sağ yuxarıda əməliyyat düymələri var:{" "}
          <HelpKey>Kampaniyanı göndər</HelpKey> (yalnız qaralama/planlaşdırılmış statusda),{" "}
          <HelpKey>Redaktə et</HelpKey> və qırmızı <HelpKey>Sil</HelpKey>.
        </p>
        <p>
          Başlığın altında iki sıra rəqəm kartı var. Birinci sıra dörd rəngli kartdır:{" "}
          <strong>Göndərildi</strong> (çatdırılmış say — göndərilən minus geri dönmələr),{" "}
          <strong>Bounces</strong> (geri dönmələr), <strong>Unsubscribes</strong> (abunəlikdən
          çıxanlar) və <strong>Spam</strong>. İkinci sıra: <strong>Açılışlar</strong>,{" "}
          <strong>Açılma faizi</strong>, <strong>Kliklər</strong> və <strong>Klik faizi</strong> —
          hər birinin üzərinə gələndə qısa izah görünür.
        </p>
        <p>
          Daha aşağıda tablar gəlir: <HelpKey>Yazmaq</HelpKey> (yalnız qaralamada),{" "}
          <HelpKey>Nəticələr</HelpKey> (standart açıq olan), <HelpKey>Flow</HelpKey>,{" "}
          <HelpKey>Detallar</HelpKey> və A/B test kampaniyalarında əlavə{" "}
          <HelpKey>A/B test nəticələri</HelpKey> tabı.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Göndərildi (yaşıl kart)">Çatdırılmış mesajların sayı — göndərilən ümumi saydan geri dönmələr çıxılmaqla.</HelpDef>
          <HelpDef term="Bounces">Geri dönmüş (çatdırıla bilməyən) mesajların sayı.</HelpDef>
          <HelpDef term="Unsubscribes">Bu kampaniyadan sonra abunəlikdən çıxan alıcıların sayı.</HelpDef>
          <HelpDef term="Spam">Spam kimi işarələnmiş mesajların sayı.</HelpDef>
          <HelpDef term="Açılma faizi">Mesajı açan alıcıların faizi (açılış ÷ göndərilən).</HelpDef>
          <HelpDef term="Klik faizi">Mesajdakı linkə klikləyən alıcıların faizi.</HelpDef>
          <HelpDef term="Status">Kampaniyanın mərhələsi — düymələrin və tabların hansının görünməsini müəyyən edir.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: kampaniyanı yaz və göndər (Yazmaq tabı)">
        <HelpStep n={1}>
          <p>
            Kampaniya qaralama statusundadırsa, <HelpKey>Yazmaq</HelpKey> tabına keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yazmaq» başlıqlı kart açılır: <strong>Mövzu</strong> sahəsi, <strong>E-poçt məzmunu
            (HTML)</strong> üçün böyük mətn sahəsi, onun altında «Şablon dəyişənləri:{" "}
            <HelpKey>{"{{client_name}}"}</HelpKey>, <HelpKey>{"{{company}}"}</HelpKey>» ipucu, sonra
            alıcı sayını göstərən boz qutu və ən altda planlaşdırma/göndərmə hissəsi.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Mövzu</strong> sətrini yazın, sonra <strong>E-poçt məzmunu (HTML)</strong>{" "}
            sahəsinə məktubun mətnini və ya HTML kodunu yapışdırın. Şablon dəyişənlərindən{" "}
            (<HelpKey>{"{{client_name}}"}</HelpKey>, <HelpKey>{"{{company}}"}</HelpKey>) istifadə edə
            bilərsiniz — göndərilərkən hər alıcı üçün avtomatik doldurulur.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mövzu sahəsi kampaniyanın mövcud mövzusu ilə əvvəlcədən dolu gələ bilər. Məzmun sahəsi
            monospace (kod) şriftindədir. Boz qutuda <strong>Alıcılar</strong> sayı, varsa seqment və
            alıcı rejimi nişanları görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İndi göndərmək üçün aşağıdakı <HelpKey>İndi göndər</HelpKey> düyməsini basın və çıxan
            təsdiq sualını qəbul edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Bu kampaniyanı indi göndərmək istəyirsiniz?» təsdiqi çıxır. Təsdiqlədikdən sonra düymə
            fırlanan göstərici ilə gözləmə vəziyyətinə keçir, sonra «Göndərildi: X / Y» şəklində
            nəticə bildirişi göstərilir (X — göndərilən, Y — ümumi alıcı). KPI kartlarındakı rəqəmlər
            yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Dərhal göndərmək əvəzinə gələcəyə planlaşdırmaq üçün aşağıdakı{" "}
            <HelpKey>Planlaşdırmaq (istəyə bağlı)</HelpKey> tarix-saat sahəsini doldurun — yalnız
            onda <HelpKey>Planlaşdır</HelpKey> düyməsi peyda olur — və ona basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tarix seçilən kimi <HelpKey>İndi göndər</HelpKey> düyməsinin yanında ikinci{" "}
            <HelpKey>Planlaşdır</HelpKey> düyməsi görünür. Basdıqdan sonra kampaniya yadda saxlanır,
            statusu <strong>Planlaşdırılıb</strong> olur və seçilmiş vaxtda avtomatik göndərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: nəticələri oxu (Nəticələr tabı)">
        <HelpStep n={1}>
          <p>
            <HelpKey>Nəticələr</HelpKey> tabına keçin (səhifə açılanda standart olaraq bu tab seçilir).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yan-yana iki kart açılır: <strong>Delivery Rates</strong> (çatdırılma faizləri) və{" "}
            <strong>Financial</strong> (maliyyə).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Delivery Rates</strong> kartında üç göstəricinin faizini və rəngli zolaqlarını
            görürsünüz: <strong>Açılma faizi</strong>, <strong>Klik faizi</strong> və{" "}
            <strong>Geri dönmə</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə adın yanında faiz rəqəmi və altında dolma zolağı var — açılma mavi, klik yaşıl,
            geri dönmə qırmızı rəngdə.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Financial</strong> kartına baxın — burada büdcə və xərc göstəriciləri ₼ ilə verilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sətirlərdə <strong>Büdcə</strong> və <strong>Xərc</strong> (həmçinin göndərilənə və klikə
            düşən orta xərc) dəyərləri görünür. Göndəriş və ya klik yoxdursa, hesablanan dəyər «—» kimi
            göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Flow və Detallar tabları">
        <HelpStep n={1}>
          <p>
            <HelpKey>Flow</HelpKey> tabına keçin — burada kampaniyanın addımlarını vizual axın
            (flow) redaktorunda tənzimləyə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Axın redaktoru yüklənir. Kampaniya artıq göndərilib və ya tamamlanıbsa, redaktor yalnız
            oxuma rejimində açılır (dəyişiklik etmək olmur). Dəyişiklik etdikdə redaktor avtomatik
            yadda saxlayır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Detallar</HelpKey> tabına keçin — kampaniyanın əsas məlumatlarına bir baxışda.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sətir-sətir <strong>Mövzu</strong>, <strong>Növ</strong>, <strong>Alıcılar</strong>,{" "}
            <strong>Göndərildi</strong>, planlaşdırılan və faktiki göndəriş <strong>tarixi</strong>,{" "}
            <strong>Yaradıldı</strong> dəyərləri görünür; təsvir varsa, ayrıca altda göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: A/B test nəticələri (yalnız A/B kampaniyalarda)">
        <HelpStep n={1}>
          <p>
            Kampaniya A/B test kimi qurulubsa, əlavə <HelpKey>A/B test nəticələri</HelpKey> tabı
            görünür. Ona keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Variantların cədvəli açılır: <strong>Variant</strong>, <strong>Mövzu</strong>,{" "}
            <strong>Göndərildi</strong>, <strong>Açıldı</strong>, <strong>Açılma faizi</strong>,{" "}
            <strong>Kliklər</strong>, <strong>CTR</strong> və <strong>Qalib</strong> sütunları. Hələ
            variant yoxdursa «Variantlar quraşdırılmayıb» mətni göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İki və daha çox variant varsa, cədvəlin altında <strong>Nəticələrin müqayisəsi</strong>{" "}
            adlı vizual zolaq qrafiki görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər variant üçün açılma (mavi) və CTR (yaşıl) zolaqları yan-yana göstərilir; qalib variant
            adının yanında ★ ilə işarələnir və cədvəldə yaşıl <strong>Qalib</strong> nişanı alır. Test
            hələ davam edirsə «Test davam edir. Qalib seçiləcək … saat» mesajı görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: kampaniyanı redaktə et, göndər və ya sil">
        <HelpStep n={1}>
          <p>
            Kampaniyanın parametrlərini dəyişmək üçün sağ yuxarıdakı <HelpKey>Redaktə et</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kampaniya forması mövcud ad, növ, status, mövzu, alıcılar, büdcə və A/B test
            parametrləri ilə əvvəlcədən dolu açılır. Dəyişiklikləri edib yadda saxladıqdan sonra
            səhifə yenilənmiş məlumatla təzələnir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Qaralama və ya planlaşdırılmış kampaniyanı tez göndərmək üçün başlıqdakı{" "}
            <HelpKey>Kampaniyanı göndər</HelpKey> düyməsindən də istifadə edə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Təsdiq sualı çıxır; təsdiqlədikdən sonra «Göndərildi: X / Y» bildirişi göstərilir və status
            <strong> Göndərildi</strong> olur (KPI kartları yenilənir).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Kampaniyanı silmək üçün qırmızı <HelpKey>Sil</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Silməni təsdiqləmək üçün kampaniyanın adını göstərən təsdiq pəncərəsi açılır. Təsdiqlədikdən
            sonra kampaniya silinir və siz kampaniya siyahısına qaytarılırsınız.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Göndərmə geri qaytarılmır — düyməni basmazdan əvvəl mövzu, məzmun və alıcı sayının düz
            olduğuna əmin olun. Silmə də qəti və geri qaytarılmazdır. Kampaniyanı sadəcə dayandırmaq
            istəyirsinizsə, onu silmək yerinə redaktə edib statusunu dəyişin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <HelpKey>Yazmaq</HelpKey> tabı və <HelpKey>Kampaniyanı göndər</HelpKey> düyməsi yalnız
          kampaniya qaralama (və ya planlaşdırılmış) vəziyyətdə olanda görünür. Kampaniya artıq
          göndərilibsə, diqqəti <HelpKey>Nəticələr</HelpKey> və <HelpKey>Detallar</HelpKey>{" "}
          tablarında — açılış, klik və geri dönmə göstəricilərində — saxlayın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Kampaniya və bütün statistikası təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın
          kampaniyalarını görür və göndərirsiniz, başqa təşkilatın kampaniyalarına çıxışınız yoxdur.
        </p>
      </HelpCallout>
    </div>
  )
}
