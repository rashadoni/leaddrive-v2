"use client"

/**
 * Invoices — help article (Azerbaijani).
 * Video-skript formatı. Yalnız REAL Hesab-fakturalar siyahı səhifəsini əhatə edir
 * (src/app/(dashboard)/invoices/page.tsx): başlıq düymələri, Analitika/Siyahı tabları,
 * dörd maliyyə kartı, analitika plitələri + ödəniş zolağı, status süzgəci, cədvəl
 * sütunları və sətir əməliyyatları (Bax / Redaktə / PDF / Sil) + Sil təsdiqi.
 * Faktura yaratma, təkrarlanan qaydalar və faktura detalı ayrı səhifələrdir — bura
 * yalnız oradan keçən düymələr daxil edilib, onların öz ekranı DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InvoicesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış, maliyyə və ya əməliyyat üzrə işçisiniz"
        goal="Müştərilərə kəsilmiş hesab-fakturaları bir yerdə görmək, status üzrə süzmək, pulun nə qədərinin yığıldığını izləmək və ayrı-ayrı fakturalara bax/redaktə/PDF/sil əməliyyatları etmək"
      >
        Səhifəyə yan paneldən <HelpKey>Hesab-fakturalar</HelpKey> bölməsi ilə çatırsınız. Burada
        görünən hər şey — yekun rəqəmlər, plitələr və siyahı sətirləri — yalnız sizin təşkilatınızın
        məlumatından oxunur. Faktura yaratmaq, təkrarlanan qaydalar və ayrıca fakturanın özü başqa
        ekranlardadır; bu səhifə onlara aparan düymələri saxlayır, amma əsasən siyahı və icmal mərkəzidir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Hesab-fakturalar</HelpKey> adı və altında «Hesab-fakturaları yaradın,
          göndərin və izləyin» izahı var. Başlığın yanında turu yenidən oynatma düyməsi və bu kömək
          düyməsi durur. Sağ yuxarıda üç element var: <strong>Analitika / Siyahı</strong> tab keçidi,{" "}
          <HelpKey>Təkrarlanan hesab-fakturalar</HelpKey> düyməsi (təkrar ikonası) və mavi{" "}
          <HelpKey>Yeni hesab-faktura</HelpKey> düyməsi (plus ikonası).
        </p>
        <p>
          Aşağıda səhifə təsviri sətri, sonra «Bunu bilirdinizmi?» ipucu kartı gəlir. Onların altında
          <strong> dörd maliyyə kartı həmişə görünür</strong>: <strong>Ümumi faktura</strong>,{" "}
          <strong>Ödənilib</strong>, <strong>Gözləyir</strong> və <strong>Gecikdirilmiş</strong>. Bundan
          sonrakı hissə hansı tabda olduğunuzdan asılıdır: <strong>Siyahı</strong> tabında status süzgəci
          və faktura cədvəli, <strong>Analitika</strong> tabında isə əlavə plitələr, ödəniş zolağı və
          qrafiklər göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi faktura">Bütün müştərilərə hesablanmış ümumi məbləğ.</HelpDef>
          <HelpDef term="Ödənilib">Müştərilərdən faktiki alınmış ümumi məbləğ.</HelpDef>
          <HelpDef term="Gözləyir">Ödənilməmiş fakturalar — müştərilərin hələ borclu olduğu qalıq.</HelpDef>
          <HelpDef term="Gecikdirilmiş">Son ödəniş tarixi keçmiş, hələ ödənilməmiş fakturalar.</HelpDef>
          <HelpDef term="Status">Fakturanın halı: Qaralama → Göndərilib → Baxılıb → Ödənilib; ya da Qismən ödənilib, Gecikdirilmiş, Ləğv edilib, Geri qaytarılıb.</HelpDef>
          <HelpDef term="Qalıq borc">Qeyd olunmuş ödənişlərdən sonra fakturada hələ ödənilməli qalan məbləğ.</HelpDef>
        </dl>
        <p>
          Siyahı cədvəlinin sütunları soldan sağa: sıra nömrəsi (#), <strong>Nömrə</strong>,{" "}
          <strong>Şirkət</strong>, <strong>Başlıq</strong>, <strong>Məbləğ</strong>,{" "}
          <strong>Status</strong>, <strong>Ödəniş tarixi</strong>, <strong>Qalıq borc</strong> və sağ
          kənarda əməliyyat ikonaları. Statusu rəngli nişan, məbləğləri isə iki onluq dəqiqliklə valyuta
          ilə göstərilir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: tablar arasında keçid və yekunları oxumaq">
        <HelpStep n={1}>
          <p>
            Səhifə standart olaraq <HelpKey>Siyahı</HelpKey> tabında açılır. Yuxarıdakı dörd maliyyə
            kartına baxın — bunlar tabdan asılı deyil, həmişə görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Ümumi faktura</strong>, <strong>Ödənilib</strong>, <strong>Gözləyir</strong> və{" "}
            <strong>Gecikdirilmiş</strong> kartları — hər biri öz ikonası, məbləği və üstündə dayananda
            izah verən ipucu ilə. Məbləğlər iki onluqla, təşkilatın valyutası ilə göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sağ yuxarıdakı keçiddə <HelpKey>Analitika</HelpKey> tabına basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Maliyyə kartlarının altında <strong>altı plitə</strong> peyda olur: <strong>Bu ay</strong>,{" "}
            <strong>Bu il</strong>, <strong>Göndərildi</strong>, <strong>Qaralamalar</strong>,{" "}
            <strong>Orta faktura</strong> və <strong>Qismən / Ləğv</strong>. Hər plitədə say və altında
            qısa açıqlama olur (məsələn bu ayın məbləği, ümumidən neçəsinin göndərildiyi).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Plitələrin altındakı <strong>ödəniş zolağına</strong> baxın (yalnız ümumi fakturalanmış
            məbləğ sıfırdan böyükdürsə görünür).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Ödəniş progressi» başlığı, yanında ödənilən / yekun məbləğ və yaşıl faiz; altında dolu
            zolaq; daha aşağıda rəngli nöqtələrlə say bölgüsü — <strong>Ödənilib</strong> (yaşıl),{" "}
            <strong>Gözləyir</strong> (narıncı), <strong>Gecikdirilmiş</strong> (qırmızı) və{" "}
            <strong>Qismən ödənilib</strong> (sarı). Daha aşağıda gəlir, ödəniş statusu və debitor borcu
            kimi qrafiklər gəlir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Cədvələ qayıtmaq üçün yenidən <HelpKey>Siyahı</HelpKey> tabına basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Plitələr və qrafiklər gizlənir; yerinə status süzgəci və faktura cədvəli qayıdır. Dörd
            maliyyə kartı yerində qalır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: siyahını süz və faktura tap">
        <HelpStep n={1}>
          <p>
            <HelpKey>Siyahı</HelpKey> tabında cədvəlin üstündəki açılan status süzgəcini açın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Variantlar: <strong>Hamısı</strong>, <strong>Qaralama</strong>, <strong>Göndərilib</strong>,{" "}
            <strong>Ödənilib</strong>, <strong>Gecikdirilmiş</strong>, <strong>Qismən ödənilib</strong> və{" "}
            <strong>Ləğv edilib</strong>. Birini seçən kimi cədvəl yalnız həmin statusdakı fakturalara
            daralır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Konkret bir faktura tapmaq üçün cədvəlin axtarış sahəsinə yazın (axtarış faktura
            nömrəsinə görə işləyir).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Hesab-faktura axtar...» mətnli sahə; yazdıqca cədvəl uyğun nömrələrə süzülür. Sətirlər
            statusa görə rənglənir: <strong>gecikdirilmiş</strong> qırmızımtıl, <strong>ödənilib</strong>{" "}
            yaşılımtıl, <strong>qismən ödənilib</strong> sarımtıl fonla.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Cədvəlin <strong>Nömrə</strong> sütununda təkrarlanan qaydadan yaranmış fakturanın
            nömrəsinin yanında kiçik təkrar nişanı (↻) olur.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Adi fakturada belə nişan olmur; təkrarlanan qaydadan gələn fakturada nömrədən sonra mavi
            rəngli kiçik ↻ etiketi görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Fakturanın detallarını açmaq üçün cədvəlin istənilən sətrinə (əməliyyat ikonalarından
            kənar yerə) klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Həmin fakturanın detal səhifəsi açılır. (Bu kömək məqaləsi siyahı səhifəsini əhatə edir;
            detal səhifəsinin öz tab və düymələri var.)
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: bir faktura üzrə əməliyyatlar (sətir ikonaları)">
        <HelpStep n={1}>
          <p>
            Cədvəlin sağ kənarında, hər sətirdə dörd ikonalı düymə var. Birincisi göz ikonalı{" "}
            <HelpKey>Bax</HelpKey> düyməsidir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Göz ikonasına klik fakturanın detal səhifəsini açır — sətrin özünə klikləməklə eyni nəticə.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İkinci, qələm ikonalı <HelpKey>Redaktə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Həmin fakturanın redaktə səhifəsi açılır (başlıq, ödəniş tarixi, ödəniş şərtləri, valyuta,
            qeydlər və sair burada dəyişilir).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Üçüncü, endirmə ikonalı <HelpKey>PDF yüklə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Fakturanın möhürlü PDF versiyası yeni brauzer tabında açılır — onu yadda saxlaya və ya çap
            edə bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Fakturanı silmək üçün sağdakı qırmızı zibil qutusu ikonalı <HelpKey>Sil</HelpKey> düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Faktura nömrəsini göstərən təsdiq pəncərəsi açılır. Təsdiqlədikdən sonra faktura siyahıdan
            çıxır və yuxarıdakı maliyyə kartları yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <HelpKey>Sil</HelpKey> təsdiqlədikdən sonra faktura siyahıdan birdəfəlik çıxır. Müştəriyə
            artıq aktual olmayan fakturanı saxlamaq istəyirsinizsə, onu silmək yerinə fakturanı açıb
            <strong> Ləğv edilib</strong> statusuna keçirmək daha təhlükəsizdir — qeyd qalır, ancaq
            gözlənilən borca daxil edilmir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni və ya təkrarlanan fakturaya keçid">
        <HelpStep n={1}>
          <p>
            Yeni faktura kəsmək üçün sağ yuxarıdakı mavi <HelpKey>Yeni hesab-faktura</HelpKey> düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Faktura yaratma səhifəsi açılır (müştəri, sətir elementləri, məbləğ, valyuta, ödəniş tarixi
            və sair orada doldurulur). Bu, bu məqalənin əhatəsindən kənar ayrı ekrandır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Hər dövr təkrarlanan fakturaları idarə etmək üçün <HelpKey>Təkrarlanan hesab-fakturalar</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Təkrarlanan qaydaların idarəetmə səhifəsi açılır (tezlik, başlama tarixi, növbəti işə düşmə
            və sair). Bu da ayrıca ekrandır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Status pulun arxasınca gedir. Fakturanın <strong>Ödənilib</strong> və ya{" "}
          <strong>Qismən ödənilib</strong> statusunu burada əllə qoymursunuz — fakturanı açıb ödənişi
          qeyd etdikdə status və <strong>Qalıq borc</strong> avtomatik yenilənir, yuxarıdakı{" "}
          <strong>Ödənilib</strong> / <strong>Gözləyir</strong> kartları da uyğunlaşır.
        </p>
      </HelpCallout>

      <HelpCallout kind="tip">
        <p>
          <HelpKey>Analitika</HelpKey> tabındakı <strong>Göndərildi</strong>, <strong>Qaralamalar</strong>{" "}
          və <strong>Qismən / Ləğv</strong> plitələri klik oluna bilir — onlara basanda siyahı süzgəci
          avtomatik həmin statusa keçir, yenidən basanda süzgəc götürülür.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün hesab-fakturalar və yekun rəqəmlər təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın
          fakturalarını görür, redaktə edir, PDF yükləyir və silirsiniz; başqa təşkilatın fakturaları
          burada görünmür. Maliyyə kartları və analitika eyni təşkilat məlumatından hesablanır.
        </p>
      </HelpCallout>
    </div>
  )
}
