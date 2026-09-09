"use client"

/**
 * Loyalty Builder — help article (Azerbaijani). REWRITE 2026-06-21.
 * Səhifə artıq altı tablı şeritdir (İcmal / Səviyyələr / Qazanma qaydaları /
 * Promo kodlar / Mükafatlar / İştirakçılar) — Səviyyə / Qazanma / Promo / Mükafat CRUD birbaşa bu
 * səhifədə, tab içində baş verir (köhnə «redaktə yalnız ayrıca səhifələrdə
 * olur» iddiası SƏHV idi və silindi). Səhifə həm də müştəri-portal açarını və
 * İcmal tabında canlı önizləməni əhatə edir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function loyaltybuilderHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq və ya loyallıq proqramına cavabdeh əməliyyat administratorusunuz"
        goal="Sadiqlik proqramının hamısını — səviyyələr, qazanma qaydaları, promo kodlar və iştirakçılar — bir səhifədən qurmaq və üzvlərin nə qazanacağını saxlamazdan əvvəl dəqiq görmək"
      >
        Səhifəyə <HelpKey>Loyallıq</HelpKey> → <HelpKey>Loyallıq Konstruktoru</HelpKey> yolu ilə
        çatırsınız. Bu, proqramın <strong>vahid idarəetmə ekranıdır</strong>: yuxarıdakı tab şeriti
        ilə bölmələr arasında keçirsiniz və hər bölmənin əlavə/redaktə işini elə burada, tabın içində
        görürsünüz — ayrı səhifəyə getməyə ehtiyac yoxdur. <HelpKey>İcmal</HelpKey> tabında isə canlı
        önizləmə durur. Bütün məlumat yalnız sizin təşkilatınız üçündür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda parıltı ikonası ilə <HelpKey>Loyallıq Konstruktoru</HelpKey> adı, altında
          «Sadiqlik proqramını qurun və üzvlərin nə qazanacağını — saxlamazdan əvvəl — dəqiq görün»
          izahı var. Başlığın altında <strong>altı tablı şerit</strong> gəlir:{" "}
          <HelpKey>İcmal</HelpKey>, <HelpKey>Səviyyələr</HelpKey>,{" "}
          <HelpKey>Qazanma qaydaları</HelpKey>, <HelpKey>Promo kodlar</HelpKey>,{" "}
          <HelpKey>Mükafatlar</HelpKey> və <HelpKey>İştirakçılar</HelpKey>. Hansı tabdasınızsa, onun
          məzmunu birbaşa altda açılır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="İcmal tabı">Başlanğıc görünüş: başlatma siyahısı, sürətli başlanğıc şablonları, «Proqramı idarə edin» keçidləri, müştəri portalı və avto-xal qərarları, sağda canlı önizləmə.</HelpDef>
          <HelpDef term="Səviyyələr tabı">Səviyyə nərdivanının tam idarəsi — burada (ayrıca səhifəyə getmədən) səviyyə yaradır, redaktə edir və silirsiniz.</HelpDef>
          <HelpDef term="Qazanma qaydaları tabı">Müştəri hərəkətlərinin xala necə çevrildiyini quran wizard və geniş ayarlar.</HelpDef>
          <HelpDef term="Promo kodlar tabı">Endirim kodlarının tam idarəsi — yaratma, redaktə, aktiv/qeyri-aktiv etmə, silmə və istifadə sayının izlənməsi.</HelpDef>
          <HelpDef term="Mükafatlar tabı">Müştərilərin xallarla ala biləcəyi mükafatlar, nümunələr və portal önizləməsi.</HelpDef>
          <HelpDef term="İştirakçılar tabı">Proqrama qoşulmuş bütün müştərilərin axtarıla bilən, səhifələnmiş siyahısı (ən çox ümumi xala görə sıralanıb).</HelpDef>
          <HelpDef term="Müştəri portalında göstər">İcmal tabındakı açar — loyallıq bölməsini müştəri portalında işə salır ki, müştərilər öz xal, səviyyə və mükafatlarını görsün.</HelpDef>
          <HelpDef term="Ödənişdə avtomatik xal">İnvoys avtomatlaşdırması qərarı. Ödənilmiş invoysların avtomatik xal verməsini istəyirsinizsə aktiv edin, yalnız POS ilə başlayırsınızsa başlatma üçün keçin.</HelpDef>
          <HelpDef term="Canlı önizləmə">İcmal tabının sağındakı panel: xal kalkulyatoru, səviyyə nərdivanı və promo test — proqramı dəyişəndə dərhal yenilənir.</HelpDef>
        </dl>
        <p>
          <HelpKey>İcmal</HelpKey> tabının sol sütununda <strong>Sürətli başlanğıc</strong> kartı
          (hazır şablonlar), <strong>Başlatma siyahısı</strong>, <strong>Proqramı idarə edin</strong>{" "}
          kartı və portal/avto-xal qərar kartları durur; sağ sütun isə geniş ekranlarda yapışıb qalan
          (sticky) canlı önizləmədir.
          Proqramda hələ heç bir səviyyə və qayda yoxdursa, sol sütunun başında{" "}
          <strong>«Proqramınız boşdur»</strong> məsləhət kartı görünür.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: tablar arasında keç">
        <HelpStep n={1}>
          <p>
            Başlığın altındakı tab şeritindən bir tab basın:{" "}
            <HelpKey>İcmal</HelpKey>, <HelpKey>Səviyyələr</HelpKey>,{" "}
            <HelpKey>Qazanma qaydaları</HelpKey>, <HelpKey>Promo kodlar</HelpKey>,{" "}
            <HelpKey>Mükafatlar</HelpKey> və ya <HelpKey>İştirakçılar</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz tab ağ fonla işıqlanır, qalanları sönük qalır, və həmin tabın məzmunu dərhal
            altda açılır. Səhifə yenilənmir — yalnız aşağıdakı bölmə dəyişir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: səviyyə yarat və redaktə et (Səviyyələr tabı)">
        <HelpStep n={1}>
          <p>
            <HelpKey>Səviyyələr</HelpKey> tabını açın. Proqramda hələ səviyyə yoxdursa,{" "}
            <HelpKey>Defoltları yarat (Bronze → Diamond)</HelpKey> düyməsi ilə hazır nərdivanı bir
            kliklə qura bilərsiniz; yoxsa <HelpKey>Yeni səviyyə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sağ yuxarıda <HelpKey>Yeni səviyyə</HelpKey> və yeniləmə düymələri görünür; səviyyə
            yoxdursa, yanında <HelpKey>Defoltları yarat</HelpKey> da olur. Səviyyələr varsa, hər biri
            kod nişanı, ad, eşik (Min ömürlük xal), multiplikator və aktiv/qeyri-aktiv statusu ilə
            sətir-sətir sadalanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Yeni səviyyə</HelpKey> basanda açılan formada sahələri doldurun:{" "}
            <strong>Kod</strong> (məs. <HelpKey>bronze</HelpKey> — yaradıldıqdan sonra dəyişməzdir),{" "}
            <strong>Ad</strong>, istəyə bağlı <strong>Təsvir</strong>,{" "}
            <strong>Min ömürlük xal</strong> (eşik) və <strong>Qazanma multiplikatoru</strong> (məs.
            1.5 = 50% çox). <strong>Aktiv</strong> qeyd qutusu standart işarələnib.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Forma cari bölmənin başında kart kimi açılır. Eşik və multiplikator yalnız rəqəm qəbul
            edir; düzgün olmayan dəyər saxlananda qırmızı xəbərdarlıq çıxır (məs. «Multiplikator
            &gt; 0 olmalıdır»).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Yarat</HelpKey> (redaktədə <HelpKey>Saxla</HelpKey>) düyməsini basın. Mövcud
            səviyyəni dəyişmək üçün sətrindəki qələm ikonasını, silmək üçün qırmızı zibil qutusu
            ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxlandıqda forma bağlanır və siyahı yenilənir. Redaktə formasında <strong>Kod</strong>{" "}
            sahəsi qıfıllı (dəyişməz) olur. Silməni təsdiq pəncərəsi xəbərdar edir ki, həmin
            səviyyədəki üzvlər avtomatik yenidən təyin olunacaq.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: qazanma qaydası yarat (Qazanma qaydaları tabı)">
        <HelpStep n={1}>
          <p>
            <HelpKey>Qazanma qaydaları</HelpKey> tabını açın, sonra sağ yuxarıdakı{" "}
            <HelpKey>Yeni qayda</HelpKey> düyməsini basın. İstəsəniz yuxarıdakı ssenari və status
            filtrləri ilə siyahını süzgəcdən keçirə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Filtrlər və <HelpKey>Yeni qayda</HelpKey> düyməsi görünür. Mövcud qaydalar qısa cümlə kimi
            oxunur, ona görə texniki sahələri açmadan müştərinin nə qazanacağını görürsünüz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Əvvəl biznes ssenarisini seçin: alış, qeydiyyat bonusu, referal, ad günü, məhsul rəyi,
            sorğu cavabı və ya xüsusi. Sonra <strong>Alış məbləğinə görə xal</strong> və ya{" "}
            <strong>Sabit bonus</strong> seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Forma lazımsız sahələri gizlədir və canlı nümunə göstərir, məsələn 100 AZN alış 100 xal
            verir. <HelpKey>Geniş ayarlar</HelpKey> yalnız məhsul kateqoriyası, prioritet, tarixlər və
            ya səviyyə bonusu davranışı üçün lazımdır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Yarat</HelpKey> düyməsini basın. Sonradan qaydanı sətrindəki{" "}
            <HelpKey>Söndür</HelpKey> / <HelpKey>Aktivləşdir</HelpKey> ilə açıb-bağlaya, qələmlə
            redaktə edə, zibil qutusu ilə silə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yeni qayda siyahıya əlavə olunur. Hər iki xal tipi doldurulubsa, forma müştərinin
            gözləniləndən çox xal ala biləcəyini xəbərdar edir. Saxlanmış qaydanı redaktə edəndə geniş
            sahələr dərhal açılır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: promo kod yarat (Promo kodlar tabı)">
        <HelpStep n={1}>
          <p>
            <HelpKey>Promo kodlar</HelpKey> tabını açıb sağ yuxarıdakı <HelpKey>Yeni kod</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Status</strong> filtri və <HelpKey>Yeni kod</HelpKey> düyməsi görünür. Mövcud
            kodlar böyük hərfli kod, faiz/sabit endirim nişanı, təsvir və istifadə sayı (məs.
            «İstifadə: 12/100») ilə sadalanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Formada <strong>Kod</strong> yazın (avtomatik böyük hərflərə çevrilir, məs.{" "}
            <HelpKey>SUMMER25</HelpKey> — sonradan dəyişməz), <strong>Endirim növü</strong> seçin
            (Faiz və ya Sabit məbləğ — bu da dəyişməz) və <strong>Endirim %</strong> / Sabit üçün{" "}
            <strong>Endirim məbləği</strong> + <strong>Valyuta</strong> daxil edin. İstəyə bağlı:{" "}
            <strong>Təsvir</strong>, <strong>Min sifariş məbləği</strong>,{" "}
            <strong>Ümumi istifadə limiti</strong>, <strong>Müştəri başına limit</strong>,{" "}
            <strong>Etibarlıdır: tarixdən / tarixə qədər</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Sabit məbləğ» seçəndə əlavə <strong>Valyuta</strong> sahəsi peyda olur. Faiz 100-dən
            böyük olsa və ya endirim 0-dan kiçik/bərabər olsa, saxlananda qırmızı xəbərdarlıq çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Yarat</HelpKey> düyməsini basın. Sonradan kodu sətrindəki{" "}
            <HelpKey>Söndür</HelpKey> / <HelpKey>Aktivləşdir</HelpKey> ilə dəyişə, qələmlə redaktə
            edə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yeni kod siyahıya düşür. Kod artıq istifadə olunubsa, sərt silmə bloklanır — bunun
            yerinə kodu söndürün (təsdiq pəncərəsi də bunu xəbərdar edir).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: iştirakçıları gör (İştirakçılar tabı)">
        <HelpStep n={1}>
          <p>
            <HelpKey>İştirakçılar</HelpKey> tabını açın. Yuxarıdakı axtarış qutusuna ad və ya e-poçt
            yazıb siyahını süzgəcdən keçirə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl açılır: <strong>İştirakçı</strong> (ad + e-poçt), <strong>Səviyyə</strong>{" "}
            (rəngli nişan), <strong>Xal</strong> və <strong>Ümumi</strong> (ömürlük xal) sütunları.
            Siyahı ən çox ümumi xala görə sıralanır. Hələ heç kim qoşulmayıbsa, «Hələ iştirakçı
            yoxdur» mesajı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Siyahının altındakı <HelpKey>Əvvəlki</HelpKey> / <HelpKey>Növbəti</HelpKey> düymələri ilə
            səhifələr arasında keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Aşağıda ümumi iştirakçı sayı və «Səhifə X / Y» göstəricisi durur; ilk/son səhifədə uyğun
            naviqasiya düyməsi sönük (deaktiv) olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: sürətli başlanğıc və canlı önizləmə (İcmal tabı)">
        <HelpStep n={1}>
          <p>
            <HelpKey>İcmal</HelpKey> tabında <strong>Sürətli başlanğıc</strong> kartındakı
            şablonlardan birinin <HelpKey>Tətbiq et</HelpKey> düyməsini basın — məs. «Alış başına
            xal», «Xoş gəlmisiniz bonusu», «Ad günü bonusu» və ya «Tövsiyə mükafatı».
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə qısaca «Tətbiq olunur…»a keçir, sonra yaşıl <strong>Tətbiq olunub</strong> nişanı
            ilə əvəzlənir. Proqramda hələ səviyyə yoxdursa, nərdivan da quran şablonların altında
            «Həmçinin Bronze→Diamond səviyyə nərdivanını qurur» qeydi olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sağdakı <HelpKey>Canlı önizləmə</HelpKey> panelində <strong>Xal kalkulyatoru</strong>na{" "}
            <strong>Sifariş məbləği</strong> yazın (və ya USD 10 / 50 / 250 düymələrini basın) və{" "}
            <strong>Hadisə</strong> seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Aşağıdakı cədvəl hər səviyyə üçün Multiplikator və qazanılacaq Xalı (məs. <strong>+50</strong>)
            dərhal göstərir. Heç bir aktiv qayda xal vermirsə, «Bu hadisə üçün hələ aktiv qayda xal
            vermir» yazısı çıxır. Aşağıda <strong>Səviyyə nərdivanı</strong> və{" "}
            <strong>Promo test</strong> bölmələri də var.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: müştəri portalını işə sal">
        <HelpStep n={1}>
          <p>
            <HelpKey>İcmal</HelpKey> tabında <strong>Müştəri portalında göstər</strong> kartındakı
            açarı basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açar dərhal vəziyyət dəyişir (yandırılmış vəziyyətdə dolur). Yandırıldıqdan sonra
            loyallıq bölməsi müştəri portalında görünür — müştərilər öz xal, səviyyə və mükafatlarına
            baxa bilir. Saxlama alınmasa, açar əvvəlki vəziyyətə qayıdır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Bütün əsas iş elə bu səhifədədir — səviyyələr, qaydalar və promo kodlar üçün tabı dəyişib
          məzmunu birbaşa burada əlavə edib redaktə edirsiniz; ayrıca səhifəyə getmək məcburi deyil
          («Proqramı idarə edin» keçidləri yalnız əlavə yoldur). Boş başlayırsınızsa, ən tez yol —{" "}
          <HelpKey>İcmal</HelpKey> tabındakı sürətli başlanğıc şablonunu tətbiq etməkdir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Önizləmə valyutası standart olaraq təşkilatınızın əsas valyutasıdır (məs. USD). Promo
          testdə kodun öz valyutası fərqlidirsə, hesablama həmin kodun valyutasında aparılır — sarı
          «Yanlış valyuta» mesajını görsəniz, kodun valyutasının sifarişlə uyğun olub-olmadığını
          yoxlayın. Promo kodun sərt silinməsi onun redempşinləri varsa bloklanır — bu halda kodu
          silmək yerinə söndürün.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün səviyyələr, qaydalar, promo kodlar, iştirakçılar və şablonlar təşkilatınızla
          məhdudlaşır — başqa tenant-ın loyallıq proqramını görmür və dəyişdirə bilmirsiniz.
          İştirakçılar siyahısı və müştəri-portal açarı yalnız sizin təşkilatınıza təsir edir.
        </p>
      </HelpCallout>
    </div>
  )
}
