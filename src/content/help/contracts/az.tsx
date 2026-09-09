"use client"

/**
 * Contracts (Müqavilələr) — help article (Azerbaijani), video-script format.
 * REAL UI mənbəyi: src/app/(dashboard)/contracts/page.tsx + messages/az.json → "contracts".
 * Yalnız siyahı səhifəsini əhatə edir: statistika kartları, status filtrləri,
 * çeşidləmə, teqlər, ətraflı filtrlər, AI (semantik) axtarış, yeni müqavilə
 * (boşdan və şablondan), tez baxış paneli (faktura/tarixçə/fayllar/PDF/razılaşma),
 * XLSX ixrac. Müqavilə detal səhifəsi (/contracts/[id]) ayrı mövzudur.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ContractsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış, hüquq və ya əməliyyat üzrə işləyirsiniz"
        goal="Müştəri müqavilələrini bir yerdə toplamaq, statuslarına və bitmə tarixlərinə görə izləmək, yeni müqavilə yaratmaq və hər birinə faktura, fayl və tarixçə ilə tez baxmaq"
      >
        Səhifəyə <HelpKey>Müqavilələr</HelpKey> bölməsindən çatırsınız. Bütün müqavilələr, teqlər və
        fayllar yalnız sizin təşkilatınıza aiddir. Səhifədə görünən hər şey — statistika kartları,
        status filtrləri və siyahı — eyni siyahıdan oxunur, ona görə müqavilə əlavə edib və ya
        statusunu dəyişdikcə yuxarıdakı saylar dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Müqavilələr</HelpKey> adı və altında «Müştəri müqavilələrini idarə et»
          izahı durur. Sağ yuxarıda dörd idarəetmə var: <HelpKey>XLSX İxrac</HelpKey>,{" "}
          <HelpKey>Şablondan yeni</HelpKey> və <HelpKey>Yeni kontrakt</HelpKey> düymələri, üstəlik
          yardım («?») düyməsi. Altda altı statistika kartı sıralanır: <strong>Cəmi</strong>,{" "}
          <strong>Aktiv</strong>, <strong>Ümumi məbləğ</strong>, <strong>MRR</strong>,{" "}
          <strong>Ort. dəyər</strong> və <strong>Tezliklə bitəcək</strong>.
        </p>
        <p>
          Kartların altında status filtr düymələri (yalnız mövcud statuslar göstərilir, hər birində
          say), sağda çeşidləmə açılan siyahısı, «Saxlanmış görünüşlər» zolağı, teq filtri zolağı,{" "}
          <HelpKey>Ətraflı filtrlər</HelpKey> ilə <HelpKey>Teqləri idarə et</HelpKey> düymələri və{" "}
          <HelpKey>AI Axtarış</HelpKey> açarı durur. Ən altda müqavilələrin cədvəli gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Cəmi">Filtrlərə uyğun gələn bütün müqavilələrin sayı.</HelpDef>
          <HelpDef term="Aktiv">Statusu «Aktiv» və ya «İmzalandı» olan müqavilələrin sayı.</HelpDef>
          <HelpDef term="Ümumi məbləğ">Aktiv və imzalanmış müqavilələrin pul dəyərinin cəmi (₼ ilə göstərilir).</HelpDef>
          <HelpDef term="MRR">Aylıq təkrarlanan gəlir — aktiv müqavilələrin dəyəri müddətə (aylara) bölünüb cəmlənir.</HelpDef>
          <HelpDef term="Ort. dəyər">Aktiv müqavilələrin orta pul dəyəri.</HelpDef>
          <HelpDef term="Tezliklə bitəcək">Yaxın 90 gün ərzində bitəcək (hələ bitməyən) müqavilələrin sayı.</HelpDef>
          <HelpDef term="Status">Müqavilənin dövrü: Qaralama → Göndərildi → İmzalandı → Aktiv → Bitir → Bitib/Yeniləndi (təsdiq mərhələləri də var: Təsdiqlənmə gözlənilir, Təsdiqləndi, Rədd edildi).</HelpDef>
          <HelpDef term="Teq">Müqavilələri qruplaşdırmaq üçün öz adı və rəngi olan etiket (məs. NDA, Prioritet, Yenilənmə).</HelpDef>
          <HelpDef term="Kənarlaşma">Müqavilə bəndinin standartdan fərqi — AI risk qiymətləndirməsi tərəfindən qaldırılan açıq işarə; siyahıda kiçik rəngli nişanla görünür.</HelpDef>
        </dl>
        <p>
          Cədvəldə sütunlar: <strong>Kontrakt #</strong>, <strong>Ad</strong>, <strong>Şirkət</strong>,{" "}
          <strong>Növ</strong>, <strong>Məbləğ</strong>, <strong>Status</strong>, kənarlaşma nişanı,{" "}
          <strong>Bitmə tarixi</strong> və sağda əməliyyat düymələri. Bitməyə 90 gün və az qalmış sətirlər
          narıncı, vaxtı keçmişlər qırmızı rənglə işarələnir. Sətrə klikləməklə tam müqavilə səhifəsinə
          keçirsiniz; sağdakı göz ikonası isə yan paneldə tez baxış açır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: müqavilələri tap və filtrlə">
        <HelpStep n={1}>
          <p>
            Yalnız bir statusu görmək üçün yuxarıdakı status filtr düymələrindən birini basın (məs.{" "}
            <HelpKey>Aktiv</HelpKey> və ya <HelpKey>İmzalandı</HelpKey>). Hamısına qayıtmaq üçün{" "}
            <HelpKey>Hamısı</HelpKey> düyməsini seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş düymə dolu (vurğulanmış) görünür, cədvəl yalnız həmin statusdakı müqavilələri
            göstərir. Hər düymənin yanındakı mötərizədə həmin statusdakı müqavilə sayı yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bitməyə az qalanları görmək üçün narıncı <HelpKey>90 gündə bitən</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl yalnız yaxın 90 gün ərzində bitəcək (hələ bitməyən) müqavilələrə daralır. Bu
            sətirlərdə bitmə tarixi yanında üçbucaq xəbərdarlıq ikonası və qalan günlərin sayı («(12d)»
            kimi) görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sıranı dəyişmək üçün sağdakı çeşidləmə açılan siyahısından seçim edin:{" "}
            <HelpKey>Ən yenilər</HelpKey>, <HelpKey>Ən köhnələr</HelpKey>, <HelpKey>Məbləğ ↓ / ↑</HelpKey>,{" "}
            <HelpKey>Bitmə tarixinə görə</HelpKey> və ya <HelpKey>Şirkətə görə</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl seçilmiş qaydaya görə dərhal yenidən sıralanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Müqavilə adı, nömrəsi, mətni və ya şirkətə görə axtarmaq üçün cədvəlin üstündəki axtarış
            sahəsindən (<HelpKey>Axtarış (ad, nömrə, mətn, şirkət)</HelpKey>) istifadə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca cədvəl yalnız uyğun gələn sətirləri saxlayır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: teqlər və ətraflı filtrlər">
        <HelpStep n={1}>
          <p>
            Teq yaratmaq üçün <HelpKey>Teqləri idarə et</HelpKey> düyməsini basın, açılan paneldə yeni
            teqin adını yazın, istəsəniz rəng seçin və <HelpKey>Teq yarat</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Teqləri idarə et» paneli açılır. Yeni teq yaradıldıqdan sonra mövcud teqlər siyahısında
            rəngli nöqtə ilə peyda olur; «Teq yaradıldı» bildirişi çıxır. Hər teqin yanındakı × ilə onu
            silə bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Müqavilələri teqə görə süzmək üçün teq filtr zolağındakı teq düymələrindən birini basın
            (zolaq yalnız ən azı bir teq varsa görünür).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş teq vurğulanır və cədvəl yalnız həmin teqi daşıyan müqavilələrə daralır. Bir neçə
            teq seçə bilərsiniz; seçimi ləğv etmək üçün zolağın sonundakı <HelpKey>Sıfırla</HelpKey>{" "}
            düyməsini basın.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Daha dəqiq süzgəc üçün <HelpKey>Ətraflı filtrlər</HelpKey> düyməsini basın və açılan paneldə
            məbləğ aralığı (<HelpKey>Min məbləğ</HelpKey>, <HelpKey>Maks məbləğ</HelpKey>), başlama və
            bitmə tarix aralıqları, <HelpKey>Müqavilə növü</HelpKey> seçin, lazımdırsa{" "}
            <HelpKey>Açıq kənarlaşmalar var</HelpKey> qutusunu işarələyin, sonra <HelpKey>Tətbiq et</HelpKey>{" "}
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Panel bağlanır və cədvəl seçdiyiniz şərtlərə görə süzülür. Aktiv filtr varsa,{" "}
            <HelpKey>Ətraflı filtrlər</HelpKey> düyməsi vurğulanır və yanında aktiv filtr sayını göstərən
            balaca rəqəm görünür. Hamısını təmizləmək üçün <HelpKey>Sıfırla</HelpKey> basın.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: AI (semantik) axtarış">
        <HelpStep n={1}>
          <p>
            Açar sözlər yerinə məna ilə axtarmaq üçün ulduz ikonalı <HelpKey>AI Axtarış</HelpKey>{" "}
            açarını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bir axtarış paneli açılır. İçində izah («müqavilələri yalnız açar sözlərə görə deyil, məna
            əsasında tapın»), axtarış sahəsi və <HelpKey>Axtar</HelpKey> düyməsi var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sahəyə adi dildə sorğu yazın (məs. «Almaniyada məhdudiyyətsiz məsuliyyətli müqavilələr»)
            və <HelpKey>Axtar</HelpKey> basın və ya Enter düyməsinə vurun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Nəticələr siyahı şəklində gəlir; hər sətirdə müqavilə adı, nömrəsi, statusu və faiz olaraq
            uyğunluq dərəcəsi göstərilir. Sətrə kliklədikdə həmin müqavilənin tez baxış paneli açılır.
            Heç nə tapılmasa «Oxşarlıq həddinin üzərində heç bir müqavilə tapılmadı» yazısı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            AI axtarış təşkilatınız üçün AI funksiyası aktiv olduqda işləyir. Aktiv deyilsə və ya
            büdcə bitibsə, panelin altında qırmızı xəta mesajı görünür — bu halda adi status/teq/ətraflı
            filtrlərdən istifadə edin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: sıfırdan yeni müqavilə yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni kontrakt</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Müqavilə forması açılır. Burada müqavilə nömrəsi, ad, şirkət, sövdələşmə, kontakt, növ,
            status, başlama/bitmə tarixləri, məbləğ, valyuta və qeydlər kimi sahələri doldura
            bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sahələri doldurub formanı yadda saxlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Forma bağlanır, yeni müqavilə cədvəlin başında görünür və yuxarıdakı statistika kartları
            (<strong>Cəmi</strong>, statusuna görə isə <strong>Aktiv</strong>/<strong>Ümumi məbləğ</strong>)
            uyğun olaraq yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: şablondan müqavilə yarat">
        <HelpStep n={1}>
          <p>
            Hazır mətnlə sürətli yaratmaq üçün <HelpKey>Şablondan yeni</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Şablondan yeni» pəncərəsi açılır və yuxarıda <HelpKey>Şablon seçin</HelpKey> açılan siyahısı
            yüklənir. Şablonlar gələnə qədər qısa «Yüklənir…» yazısı görünə bilər.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Açılan siyahıdan bir şablon seçin. Şablonda dəyişənlər varsa, onları doldurun; istəyə bağlı
            olaraq müqavilə nömrəsi, ad, şirkət, sövdələşmə, kontakt, tarixlər, məbləğ və valyuta əlavə
            edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Şablon seçildikdə «Dəyişənlər» və «Əlavə sahələr» bölmələri görünür. Hər dəyişənin altında
            onun {"{{ad}}"} kodu göstərilir ki, hansını doldurduğunuzu biləsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Aşağıdakı <HelpKey>Müqavilə yarat</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Müqavilə uğurla yaradıldı» bildirişi çıxır, pəncərə bağlanır və yeni müqavilə siyahıda
            görünür. Tələb olunan dəyişən boş qalıbsa, pəncərənin altında çatışmayan dəyişənləri sadalayan
            qırmızı xəta görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: tez baxış paneli (faktura, tarixçə, fayllar, PDF)">
        <HelpStep n={1}>
          <p>
            Cədvəldə müqavilə sətrinin sağındakı göz ikonalı (<HelpKey>Tez baxış</HelpKey>) düyməni basın.
            (Bütün sətrə kliklə isə tam müqavilə səhifəsinə keçirsiniz.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sağdan yan panel açılır. Yuxarıda müqavilə adı, şirkət, varsa əlaqəli sövdələşmə və kontakt,
            altında status, növ, məbləğ və tarix qutuları, sonra varsa qeydlər göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Aşağıya doğru sürüşdürün: <strong>Hesab-fakturalar</strong>, <strong>Tarixçə</strong> və{" "}
            fayllar bölmələrinə baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Fakturalar bölməsində bu müqaviləyə bağlı fakturalar (nömrə, məbləğ, status) sıralanır; heç
            nə yoxdursa «Əlaqəli hesab-faktura yoxdur» yazısı görünür. Tarixçə bölməsi hər dəyişikliyi —
            köhnə dəyər üstündən xətlə, yeni dəyər yaşıl rənglə — göstərir. Fayllar bölməsində yükləmə
            düyməsi var; üzərinə gəldikdə hər faylın yanında yüklə və sil ikonaları görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Panelin altındakı düymələrdən istifadə edin: status qaralamadırsa{" "}
            <HelpKey>Razılaşmaya göndər</HelpKey>, <HelpKey>PDF yüklə</HelpKey>,{" "}
            <HelpKey>Kontraktı redaktə et</HelpKey> və ya <HelpKey>Kontraktı sil</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Razılaşmaya göndər</HelpKey> mərhələ qurmaq üçün ayrıca pəncərə açır (hər mərhələnin
            adı mütləqdir, rol isə istəyə bağlı). <HelpKey>PDF yüklə</HelpKey> müqaviləni yeni
            vərəqdə hazırlayır. Redaktə formanı, silmə isə təsdiq pəncərəsini açır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: müqavilələri XLSX kimi ixrac et">
        <HelpStep n={1}>
          <p>
            Əvvəlcə istədiyiniz filtrləri (status, teq, ətraflı filtrlər) tətbiq edin, sonra sağ
            yuxarıdakı <HelpKey>XLSX İxrac</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Brauzer hazırkı filtrlərə uyğun müqavilələrlə bir XLSX faylını yükləyir. Yəni nə görürsünüzsə,
            onu da ixrac edirsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Cədvəldəki kiçik rəngli nişan (amber və ya qırmızı dairə içində rəqəm) müqavilədə açıq{" "}
          <strong>kənarlaşmalar</strong> olduğunu bildirir — qırmızı kritik, amber isə adi
          xəbərdarlıqdır. Yalnız belə müqavilələri görmək üçün <HelpKey>Ətraflı filtrlər</HelpKey>{" "}
          panelində <HelpKey>Açıq kənarlaşmalar var</HelpKey> qutusunu işarələyin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün müqavilələr, teqlər və yüklənmiş fayllar təşkilatınızla məhdudlaşır — başqa təşkilatın
          müqavilələrini görmürsünüz və axtarış, ixrac, fakturalar da yalnız sizin tenant-ınızın
          məlumatları üzərində işləyir.
        </p>
      </HelpCallout>
    </div>
  )
}
