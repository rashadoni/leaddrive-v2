"use client"

/**
 * D8 Loyalty — fərdi hesab səhifəsi (Azərbaycanca).
 * Sadiqlik proqramı idarə panelindəki top siyahıdan açılan drill-down:
 * üzv başlığı (ad, e-poçt, telefon, səviyyə nişanı, mövcud + ümumi
 * ballar), iki admin əməliyyatı (əl ilə bal yazma və silmə, böyük
 * əməliyyat üçün təsdiq kartı ilə) və tam əməliyyat tarixçəsi («Daha
 * çox» səhifələmə ilə). Bu səhifənin ilk help məqaləsidir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function loyaltyaccountdetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sadiqlik proqramı administratoru və ya müştəri xidməti operatorusunuz"
        goal="Bir üzvün bal balansına baxmaq, əl ilə bal yazmaq və ya silmək və hər dəyişikliyin əməliyyat tarixçəsində iz buraxdığını yoxlamaq"
      >
        Bu səhifəyə Sadiqlik proqramının idarə panelindəki üzv siyahısından bir adın üstünə klikləməklə
        çatırsınız (URL-də hesabın id-si olur). Yuxarı solda{" "}
        <HelpKey>Sadiqlik proqramına qayıt</HelpKey> keçidi sizi idarə panelinə geri qaytarır. Bütün hesab,
        balans və əməliyyatlar yalnız sizin təşkilatınıza aiddir. Etdiyiniz hər bal yazma/silmə dərhal
        yadda saxlanır və yuxarıdakı balans rəqəmləri ilə aşağıdakı tarixçə avtomatik yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Səhifə üç hissədən ibarətdir. Yuxarıda <strong>üzv başlığı kartı</strong>: solda mükafat
          ikonası ilə üzvün adı (ad yoxdursa «Naməlum üzv»), altında e-poçt və telefon, sağda isə varsa
          rəngli <strong>səviyyə nişanı</strong> (məs. <em>gold</em>, <em>silver</em>). Kartın aşağısında
          iki böyük rəqəm: <strong>Mövcud ballar</strong> və <strong>Ümumi ballar</strong>. Ortada iki
          əməliyyat kartı — solda <strong>Bal yaz</strong>, sağda <strong>Bal sil</strong>. Ən altda{" "}
          <strong>Əməliyyat tarixçəsi</strong> siyahısı.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Səviyyə nişanı">
            Üzvün cari səviyyəsi (bronze/silver/gold/platinum/diamond) — yalnız təyin olunubsa görünür;
            altında «Səviyyə yüksəldi …» qeydi ola bilər.
          </HelpDef>
          <HelpDef term="Mövcud ballar">
            Üzvün hazırda sərf edə biləcəyi (silinə bilən) balans. Bal silmə bundan çıxır.
          </HelpDef>
          <HelpDef term="Ümumi ballar">
            Üzvün bütün vaxt ərzində qazandığı cəm — silmə bunu azaltmır, yalnız səviyyəni müəyyən edir.
          </HelpDef>
          <HelpDef term="Bal yaz">
            Hesaba əl ilə bal əlavə etmə forması (yaşıl). Həm mövcud, həm ümumi balansı artırır.
          </HelpDef>
          <HelpDef term="Bal sil">
            Mövcud balansdan bal çıxma forması (mavi). Yalnız mövcud balans qədər silə bilərsiniz.
          </HelpDef>
          <HelpDef term="Əməliyyat tarixçəsi">
            Hər dəyişikliyin sətri: növ (yaz/sil/bitmə/düzəliş), səbəb, ±dəyişiklik və nə qədər əvvəl
            olduğu.
          </HelpDef>
        </dl>
        <p>
          Hər iki əməliyyat formasında bir <strong>Ballar</strong> sahəsi (yalnız müsbət tam ədəd), bir{" "}
          <strong>Səbəb (məcburi deyil)</strong> sahəsi və göndərmə düyməsi var. Tarixçə sətrində dəyişiklik
          müsbətdirsə yaşıl «+», mənfidirsə qırmızı göstərilir; bəzi sətirlərdə yanında <HelpKey>(LT +N)</HelpKey>{" "}
          (ümumi balansa təsir) qeydi olur. Tarixçə altında, daha köhnə əməliyyatlar varsa,{" "}
          <HelpKey>Daha çox əməliyyat yüklə</HelpKey> düyməsi çıxır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: üzvə əl ilə bal yaz">
        <HelpStep n={1}>
          <p>
            Sol əməliyyat kartında (<strong>Bal yaz</strong>) <strong>Ballar</strong> sahəsinə müsbət bir
            rəqəm yazın — məsələn 250.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahə yalnız tam ədəd qəbul edir (mono şriftlə). Boş, sıfır və ya kəsr rəqəm yazıb göndərsəniz,
            altında qırmızı «Müsbət tam ədəd daxil edin» mesajı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstəyə bağlı olaraq <strong>Səbəb (məcburi deyil)</strong> sahəsinə qısa izah yazın (məs.
            «doğum günü bonusu»). Bu mətn tarixçədə qalır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Səbəb sahəsi 500 simvola qədər qəbul edir. Yazdıqca mətn sahədə görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Yaşıl <HelpKey>Yaz</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymədə fırlanan göstərici görünür, sonra sahələr təmizlənir; <strong>Mövcud ballar</strong> və{" "}
            <strong>Ümumi ballar</strong> rəqəmləri artır və aşağıdakı tarixçənin başında yeni yaşıl «+N»
            sətri peyda olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: üzvün balını sil">
        <HelpStep n={1}>
          <p>
            Sağ əməliyyat kartında (<strong>Bal sil</strong>) <strong>Ballar</strong> sahəsinə silinəcək
            rəqəmi yazın. İstəsəniz <strong>Səbəb</strong> də əlavə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mövcud baldan çox rəqəm yazıb göndərsəniz, «N silə bilmərik — yalnız M mövcuddur» qırmızı
            xəbərdarlığı çıxır və əməliyyat icra olunmur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Mavi <HelpKey>Sil</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Uğurlu olduqda sahələr təmizlənir, <strong>Mövcud ballar</strong> azalır (<strong>Ümumi
            ballar</strong> dəyişmir) və tarixçədə qırmızı «−N» sətri görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Əgər rəqəm böyükdürsə (1000 və daha çox bal), göndərəndə dərhal icra olunmur — əvvəlcə təsdiq
            kartı açılır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Forma yerinə «Böyük əməliyyatı təsdiqləyin» kartı çıxır: «Siz N bal üçün … əməliyyatını icra
            etmək üzrəsiniz» mətni, yazmışsınızsa səbəb, və iki düymə — <HelpKey>Ləğv et</HelpKey> (formaya
            qayıdır) və <HelpKey>Təsdiqlə</HelpKey> (əməliyyatı icra edir). Bu, bir hərflik səhvlə böyük
            balansın silinməsinin qarşısını alır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: əməliyyat tarixçəsinə bax">
        <HelpStep n={1}>
          <p>
            Səhifənin aşağısındakı <strong>Əməliyyat tarixçəsi</strong> bölməsinə baxın. Hər sətirdə soldan
            sağa: əməliyyatın növü, səbəb, ±dəyişiklik və nə qədər əvvəl olduğu göstərilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Növ rənglə fərqlənir: <em>earn</em> və kredit düzəlişi yaşıl, <em>redeem</em> mavi, <em>expire</em>{" "}
            boz, debet düzəlişi qırmızı. Dəyişiklik müsbətdirsə yaşıl «+», mənfidirsə qırmızı, bəzən yanında{" "}
            <HelpKey>(LT +N)</HelpKey> qeydi. Heç əməliyyat yoxdursa «Əməliyyat hələ yoxdur.» yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Köhnə əməliyyatları görmək üçün siyahının altındakı <HelpKey>Daha çox əməliyyat yüklə</HelpKey>{" "}
            düyməsini basın (yalnız daha köhnə qeydlər varsa görünür).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə fırlanan göstəriciyə keçir və mövcud siyahının altına daha köhnə sətirlər əlavə olunur.
            Daha qalmadıqda düymə yox olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Bal yazma və silmə həmişə tarixçədə <strong>səbəb</strong> ilə birlikdə qalır. Səbəb məcburi
          olmasa da, hər əl əməliyyatına qısa izah yazın — sonradan «niyə bu üzvə +500 verilib?» sualına
          cavabı tarixçədə oxumaq asanlaşır.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <strong>Mövcud ballar</strong> ilə <strong>Ümumi ballar</strong> fərqlidir: silmə yalnız mövcud
          balansı azaldır, ümumi balans isə dəyişmir (səviyyə ona görə qalır). Mövcuddan çox sil mümkün
          deyil — sistem buna icazə vermir. 1000 və daha çox ballıq əməliyyatda mütləq təsdiq tələb olunur.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bu hesab, balans və əməliyyatlar yalnız sizin təşkilatınıza məxsusdur — başqa təşkilatın
          üzvlərini görə və ya dəyişə bilməzsiniz. Bal yazma/silmə eyni anda iki dəfə icra olunmaqdan
          qorunur (server tərəfdə təhlükəsiz balans yeniləməsi), yenə də böyük əməliyyatlarda təsdiq
          kartından keçin.
        </p>
      </HelpCallout>
    </div>
  )
}
