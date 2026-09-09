"use client"

/**
 * Satış nöqtələri (MTM) — help məqaləsi (Azərbaycanca).
 * en.tsx-in güzgüsü: «Marşrutlar və sahə» modulunun ziyarət, marşrut və
 * tapşırığı bağladığı satış nöqtələri kataloqu.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MtmCustomersHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Bu nə üçün vacibdir">
        <p>
          <strong>Satış nöqtələri</strong> — sahə əməkdaşlarınızın həqiqətən ziyarət etdiyi
          nöqtələrin kataloqudur: mağazalar, köşklər, filiallar, satış nöqtələri. «Marşrutlar və
          sahə» modulundakı hər ziyarət, marşrut və tapşırıq buradakı nöqtə qeydinə bağlıdır,
          ona görə düzgün siyahı modulun qalan işinin dayağıdır.
        </p>
        <p>
          Hər sətirdə kimlik (kod, ad), səviyyə (<strong>kateqoriya</strong> A–D), harada olduğu
          (ünvan, şəhər, rayon və xəritədə nişan) və kimə zəng etmək (əlaqə şəxsi, telefon) var.
        </p>
      </HelpSection>

      <HelpSection title="Siyahıya ilk baxış">
        <p>
          Başlıqda ad və cari süzgəclərə uyğun gələn sətirlərin canlı sayğacı göstərilir. Yuxarıdakı
          dörd kart bütün kataloqu ümumiləşdirir:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Cəmi">Təşkilatınızdakı bütün nöqtələr.</HelpDef>
          <HelpDef term="Kateqoriya A">Neçəsi ən yüksək səviyyə kimi işarələnib.</HelpDef>
          <HelpDef term="Kateqoriya B">Neçəsi ikinci səviyyədədir.</HelpDef>
          <HelpDef term="Aktiv">Statusu <em>Aktiv</em> olan nöqtələr.</HelpDef>
        </dl>
        <p>
          Cədvəldə <strong>Kod</strong>, <strong>Ad</strong>, <strong>Kateqoriya</strong>{" "}
          (rəngli nişan: A yaşıl, B mavi, C kəhrəba, D qırmızı), <strong>Şəhər</strong>,{" "}
          <strong>Ünvan</strong>, <strong>Əlaqə</strong> və <strong>Telefon</strong> var, hər sətrin
          sonunda isə redaktə və silmə düymələri.
        </p>
      </HelpSection>

      <HelpSection title="Nöqtə tap">
        <HelpStep n={1}>
          <p>
            <HelpKey>kateqoriya düymələri</HelpKey> (Hamısı / A / B / C / D) ilə siyahını bir
            səviyyəyə daraldın — hər düymənin öz sayğacı var.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Axtarış</HelpKey> sahəsinə yazın — axtarış <em>ad</em>, <em>kod</em> və{" "}
            <em>şəhər</em> üzrə işləyir. Süzgəc və axtarış birlikdə işləyir, beləcə bir kateqoriyanın
            içində axtara bilərsiniz.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sıralamanı açılan siyahı ilə dəyişin: <HelpKey>Ad (A–Z)</HelpKey>,{" "}
            <HelpKey>Ad (Z–A)</HelpKey> və ya <HelpKey>Kateqoriya</HelpKey>.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Boş ekran hansı vəziyyətdə olduğunuzu göstərir: «hələ nöqtə yoxdur» — kataloq boşdur,
            «nəticə yoxdur» isə süzgəc və ya axtarış hər şeyi gizlədib; tam siyahını yenidən görmək
            üçün axtarışı təmizləyin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Nöqtə əlavə et və ya redaktə et">
        <p>
          Yaratmaq üçün <HelpKey>Əlavə et</HelpKey>, redaktə etmək üçün isə sətirdəki{" "}
          <HelpKey>qələm</HelpKey> düyməsini basın. Forma bunları toplayır:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Kod">Öz nöqtə kodunuz. İstəyə bağlıdır, lakin təşkilat daxilində unikal olmalıdır.</HelpDef>
          <HelpDef term="Ad">Məcburi — nöqtənin adı.</HelpDef>
          <HelpDef term="Kateqoriya">A, B, C və ya D (standart B).</HelpDef>
          <HelpDef term="Status">Aktiv və ya Qeyri-aktiv.</HelpDef>
          <HelpDef term="Əlaqə">Əlaqə şəxsi və telefon.</HelpDef>
          <HelpDef term="Yer">Ünvan, şəhər, rayon və xəritə nişanı.</HelpDef>
          <HelpDef term="Qeydlər">Qalan hər şey üçün sərbəst mətn.</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            Məlumatları doldurun. <strong>Ad</strong> yeganə məcburi sahədir, qalanı istəyə bağlıdır.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Yer nişanını qoyun: xəritə önizləməsinə klikləyib tamekran seçicini açın, sonra nöqtəni
            qoymaq üçün xəritənin istənilən yerinə klikləyin. En və uzunluq avtomatik doldurulur
            (onları əllə də yaza bilərsiniz). Seçicini bağlamaq üçün <HelpKey>Hazırdır</HelpKey>{" "}
            düyməsini basın.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Saxlamaq üçün <HelpKey>Yarat</HelpKey> (redaktədə isə <HelpKey>Yenilə</HelpKey>)
            düyməsini basın.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Kod unikal olmalıdır.</strong> Eyni təşkilatdakı iki nöqtə eyni kodu paylaşa
            bilməz — təkrar etsəniz, saxlama xəta ilə bitir. Nöqtə kodlarından istifadə etmirsinizsə,
            sahəni boş buraxın.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Xəritə nişanı və geofencing">
        <p>
          Xəritədə qoyduğunuz en / uzunluq sadəcə görüntü üçün deyil: bu, modulun əməkdaşın gəliş
          qeydiyyatı zamanı fiziki olaraq nöqtədə olduğunu təsdiqlədiyi dayaq nöqtəsidir. Nişan əsl
          qapıya nə qədər yaxındırsa, gəliş yoxlaması bir o qədər etibarlıdır.
        </p>
        <HelpCallout kind="tip">
          <p>
            Gəliş yoxlaması bu nişandan olan məsafəni <strong>geofence radiusu</strong> ilə müqayisə
            edir. Standart olaraq radius təşkilat üzrə tənzimləmədən götürülür; ayrıca nöqtə üçün
            qeyddə öz dəyəri saxlanıla bilər — onda bir nöqtə qalanlarından daha sərt və ya daha
            yumşaq ola bilər. Buradakı forma nişanı təyin edir, radiusun özü isə bu ekranda redaktə
            olunan sahə deyil.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="İxrac və silmə">
        <HelpStep n={1}>
          <p>
            <HelpKey>İxrac</HelpKey> hazırda göstərilən sətirlərin CSV faylını yükləyir (süzgəc və
            axtarışı nəzərə alır) — Kod, Ad, Kateqoriya, Şəhər, Ünvan, Əlaqə və Telefon sütunları
            ilə.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>zibil qutusu</HelpKey> düyməsi təsdiqdən sonra nöqtəni silir.
          </p>
        </HelpStep>
        <HelpCallout kind="security">
          <p>
            Silmə <strong>yumşaq silmədir</strong> — qeyd silinmiş kimi işarələnir və bütün
            siyahılardan çıxır, lakin fiziki olaraq pozulmur, ona görə ona istinad edən ziyarətlər
            tarixçəsini saxlayır. Yaratma, redaktə və silmə MTM audit jurnalına yazılır,
            bütün kataloq isə təşkilatınızla məhdudlaşır: yalnız öz tenant-ınızın nöqtələrini görüb
            dəyişirsiniz.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="«Marşrutlar və sahə» moduluna necə uyğunlaşır">
        <ol className="list-decimal pl-5 space-y-1">
          <li>Burada hər nöqtədə nişanı olan <strong>Satış nöqtələri</strong> kataloqunu qurursunuz.</li>
          <li>Marşrutlar bu nöqtələri əməkdaşın günlük planına düzür.</li>
          <li>Hər dayanacaqda əməkdaş gəlişi qeyd edir — nişan (və geofence radiusu) onun orada olduğunu təsdiqləyir.</li>
          <li>Ziyarətlər, tapşırıqlar və fotolar yaratdığınız nöqtə qeydinə bağlanır.</li>
        </ol>
      </HelpSection>
    </div>
  )
}
