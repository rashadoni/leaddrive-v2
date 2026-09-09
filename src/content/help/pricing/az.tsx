"use client"

/**
 * IT Xidmətləri Qiymət Modeli — help article (Azerbaijani).
 * Köhnə birgə "profitability" məqaləsindən ayrılıb: YALNIZ
 * Qiymət Modeli səhifəsini (/pricing) əhatə edir — üç tab
 * (Qiymət Modeli / Qiymətləri Redaktə Et / Əlavə Satışlar),
 * düzəliş sürüşdürücüləri, qrafiklər, şirkət cədvəli, Excel
 * ixracı və qazanılmış sövdələşmələrin satışlara köçürülməsi.
 * Xərc/gəlirlilik (profitability) hissəsi bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function PricingHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Maliyyə və ya əməliyyat administratorusunuz, yaxud satış rəhbərisiniz"
        goal="İT xidmətlərinin qiymət modelini izləmək, faiz düzəlişləri ilə gəlir ssenariləri qurmaq, ayrı-ayrı şirkətlərin qiymətlərini redaktə etmək, əlavə satışları idarə etmək və hamısını Excel-ə ixrac etmək"
      >
        Səhifə <HelpKey>İT Xidmətləri Qiymət Modeli</HelpKey> başlığı altında açılır. Bütün rəqəmlər —
        gəlir, şirkətlər, kateqoriyalar və satışlar — yalnız sizin təşkilatınıza aiddir. Sürüşdürücülərlə
        etdiyiniz düzəlişlər <strong>ssenari</strong>dir: real qiymətlər yalnız <HelpKey>Qiymətləri
        Redaktə Et</HelpKey> tabında saxladıqda dəyişir. Səhifə ilk açılanda qiymət məlumatı yoxdursa,
        cədvəllərin yerinə «Qiymət məlumatı yoxdur» yazısı görünür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda başlıq və onun altında qısa izah var. Başlığın sağında dörd düymə bir sırada durur:{" "}
          <HelpKey>Qiymət Modeli</HelpKey>, <HelpKey>Qiymətləri Redaktə Et</HelpKey>,{" "}
          <HelpKey>Əlavə Satışlar</HelpKey> tabları və <HelpKey>Excel-ə İxrac</HelpKey> düyməsi. Hər
          tabın yanında kiçik «i» (məlumat) işarəsi var — üstünə gələndə həmin tabın nə üçün olduğunu
          izah edir. Açıq olan tab tünd (dolu) rəngdə, qalanları çərçivəli görünür.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Qiymət Modeli tabı">Cari modelin oxu-rejimli mənzərəsi: dörd KPI kartı, düzəliş sürüşdürücüləri, qrafiklər və şirkət cədvəli.</HelpDef>
          <HelpDef term="Qiymətləri Redaktə Et tabı">Hər şirkətin kateqoriya və xidmət qiymətlərini həqiqətən dəyişdiyiniz yer — burada saxlanan dəyişikliklər qalıcıdır.</HelpDef>
          <HelpDef term="Əlavə Satışlar tabı">Aylıq (MRR) və birdəfəlik əlavə satışların siyahısı; qazanılmış sövdələşmələri bir kliklə buraya köçürmək də olur.</HelpDef>
          <HelpDef term="Düzəliş (Adjustment)">−50%-dən +50%-ə qədər faiz sürüşdürücüsü. Gəliri hesablama məqsədilə artırıb-azaldır; bu, ssenaridir, saxlanılan qiymət deyil.</HelpDef>
          <HelpDef term="Baza / Yeni">Baza = cari saxlanan aylıq gəlir; Yeni = sürüşdürücü düzəlişlərindən sonrakı proqnoz.</HelpDef>
          <HelpDef term="Qrup">Şirkətlərin aid olduğu seqment — sürüşdürücülər və qrafiklər bu qruplara görə bölünür.</HelpDef>
          <HelpDef term="Kateqoriya / Xidmət">Kateqoriya — qiymət maddələrinin qrupu; içində ayrı-ayrı xidmət sətirləri (vahid, miqdar, qiymət) olur.</HelpDef>
        </dl>
        <p>
          <HelpKey>Qiymət Modeli</HelpKey> tabında yuxarıda dörd KPI kartı durur:{" "}
          <strong>Ümumi Aylıq Gəlir</strong>, <strong>Proqnozlaşdırılmış Aylıq Gəlir</strong>,{" "}
          <strong>İllik Effekt</strong> və <strong>Orta Düzəliş</strong>. Altda iki sütun var: solda
          düzəliş sürüşdürücüləri (Ümumi Düzəliş, Qruplar üzrə, Kateqoriyalar üzrə, Şirkətlər üzrə),
          sağda isə qrafiklər («Qruplar üzrə Gəlir» sütun diaqramı, «Kateqoriyalar üzrə Gəlir» dairə
          diaqramı, «Top 15 Şirkət» diaqramı) və ən altda axtarış sahəsi olan «Şirkətlər Cədvəli».
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: faiz düzəlişləri ilə gəlir ssenarisi qur">
        <HelpStep n={1}>
          <p>
            Açıq tab <HelpKey>Qiymət Modeli</HelpKey> olsun. Solda yuxarıdakı kartda{" "}
            <HelpKey>Ümumi Düzəliş</HelpKey> sürüşdürücüsünü tutub sağa və ya sola çəkin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sürüşdürücünün sağındakı faiz dəyəri yenilənir — müsbət olanda yaşıl, mənfi olanda qırmızı,
            sıfırda boz görünür. Yuxarıdakı <strong>Proqnozlaşdırılmış Aylıq Gəlir</strong>,{" "}
            <strong>İllik Effekt</strong> və <strong>Orta Düzəliş</strong> kartları, eləcə də qrafiklər
            və cədvəldəki «Yeni» rəqəmləri dərhal dəyişir. <strong>Ümumi Aylıq Gəlir</strong> (baza) isə
            olduğu kimi qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Daha dəqiq düzəliş üçün aşağıdakı qatlanan bölmələri açın:{" "}
            <HelpKey>Qruplar üzrə Düzəliş</HelpKey>, <HelpKey>Kateqoriyalar üzrə Düzəliş</HelpKey> və ya{" "}
            <HelpKey>Şirkətlər üzrə Düzəliş</HelpKey>. Başlığa basaraq açıb-bağlayın, sonra istədiyiniz
            sətir üçün sürüşdürücünü çəkin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər bölmə başlığında mötərizədə say göstərilir (neçə qrup, neçə kateqoriya, neçə şirkət).
            Qrup, kateqoriya və şirkət sürüşdürücülərinin altında bir tarix sahəsi (gg.aa.iiii) var —
            düzəlişin nə vaxtdan qüvvəyə minəcəyini qeyd etmək üçün. «Şirkətlər üzrə Düzəliş» bölməsində
            yuxarıda «Şirkət axtar...» qutusu da var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Ssenarini sıfırdan başlamaq istəsəniz, Ümumi Düzəliş kartının altındakı{" "}
            <HelpKey>Sıfırla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bütün sürüşdürücülər (ümumi, qrup, kateqoriya və şirkət) 0%-ə qayıdır, tarix sahələri
            təmizlənir; «Yeni» rəqəmləri yenidən baza ilə üst-üstə düşür və <strong>İllik Effekt</strong>{" "}
            0 olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Nəticəni şirkət-şirkət yoxlamaq üçün aşağıdakı <HelpKey>Şirkətlər Cədvəli</HelpKey>nə baxın.
            Sütun başlıqlarına (<HelpKey>Şirkət</HelpKey>, <HelpKey>Qrup</HelpKey>,{" "}
            <HelpKey>Baza</HelpKey>, <HelpKey>Yeni</HelpKey>, <HelpKey>Fərq</HelpKey>, <HelpKey>%</HelpKey>)
            basaraq sıralaya bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə şirkət kodu, qrupu, baza və yeni məbləğ, fərq (müsbətdə yaşıl «+», mənfidə qırmızı)
            və faiz var. Sağ sütunda hər şirkət üçün ayrıca kiçik bənövşəyi sürüşdürücü durur — onu
            çəkəndə həmin şirkətin düzəlişi soldakı «Şirkətlər üzrə Düzəliş» ilə eyni anda dəyişir.
            Sıraladığınız sütunun başlığında ↑ və ya ↓ oxu çıxır. Yuxarıdakı axtarış qutusuna ad
            yazsanız, cədvəl süzülür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: bir şirkətin qiymətlərini redaktə et və saxla">
        <HelpStep n={1}>
          <p>
            Yuxarıdan <HelpKey>Qiymətləri Redaktə Et</HelpKey> tabına keçin. Solda axtarış qutusu ilə
            şirkət siyahısı görünəcək.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sol sütunda şirkətlər qruplara görə qruplaşdırılır (hər qrup başlığında mötərizədə say var),
            hər şirkətin altında onun aylıq məbləği yazılır. Sağ tərəfdə isə hələ heç nə seçilmədiyindən
            «Qiymətləri redaktə etmək üçün şirkət seçin» mesajı durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Siyahıdan bir şirkəti basın (lazımsa yuxarıdakı <HelpKey>Şirkət axtar...</HelpKey> qutusu ilə
            tapın).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş şirkət mavi fonla işarələnir. Sağda redaktor açılır: yuxarıda şirkət kodu, qrup
            nişanı və qırmızı zibil ikonası (şirkəti silmək), sağ yuxarıda <strong>Cəmi Aylıq</strong> və{" "}
            altında illik məbləğ. Onun altında <HelpKey>Saxla</HelpKey>, <HelpKey>Ləğv et</HelpKey>,{" "}
            <HelpKey>Sıfırla</HelpKey> düymələri və kateqoriya sətirləri görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bir kateqoriyanın başlığına basıb açın, sonra içindəki xidmət sətirlərində{" "}
            <strong>Miqdar</strong> və <strong>Vahid qiyməti</strong> xanalarını dəyişin. Yeni xidmət
            əlavə etmək üçün kateqoriya sətrindəki <HelpKey>+</HelpKey> ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kateqoriya açılanda xidmət cədvəli görünür: Xidmət, Vahid, Miqdar, Vahid qiyməti, Cəmi.
            Rəqəmləri dəyişdikcə sətrin və kateqoriyanın «Cəmi» dəyəri, eləcə də yuxarıdakı{" "}
            <strong>Cəmi Aylıq</strong> dərhal yenidən hesablanır. Yuxarıda kəhrəba rəngli «Saxlanmamış
            dəyişikliklər var» xəbərdarlığı çıxır. <HelpKey>+</HelpKey> basanda mavi «Yeni xidmət» forması
            açılır (ad, vahid, miqdar, qiymət).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Yeni kateqoriya lazımdırsa, ən altdakı <HelpKey>Kateqoriya əlavə et</HelpKey> düyməsini basın,
            ad yazıb <HelpKey>Əlavə et</HelpKey> ilə təsdiqləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yaşıl «Yeni kateqoriya» forması açılır. Ad daxil edib təsdiqlədikdə boş kateqoriya siyahıya
            əlavə olunur (içinə xidmət əlavə edənə qədər «Xidmət yoxdur» yazısı durur).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Bütün dəyişiklikləri yadda saxlamaq üçün yuxarıdakı <HelpKey>Saxla</HelpKey> düyməsini basın.
            (Fikrinizi dəyişsəniz — <HelpKey>Ləğv et</HelpKey> son saxlanmış vəziyyətə,{" "}
            <HelpKey>Sıfırla</HelpKey> isə ilkin yüklənmiş məlumata qaytarır.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxlama zamanı başlıqda fırlanan yükləmə ikonası görünür; bitəndə «Saxlanmamış dəyişikliklər
            var» xəbərdarlığı yox olur. Dəyişikliklər artıq <strong>real qiymət</strong>dir və{" "}
            <HelpKey>Qiymət Modeli</HelpKey> tabındakı baza rəqəmlərinə də əks olunur.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Qiymət Modeli tabındakı sürüşdürücülər real qiyməti <strong>dəyişmir</strong> — onlar sadəcə
            ssenaridir. Real, qalıcı dəyişiklik yalnız bu tabdakı <HelpKey>Saxla</HelpKey> ilə baş verir.
            Redaktor başlığındakı qırmızı zibil ikonası isə <strong>bütün şirkəti</strong> silir — bu,
            geri qaytarılmır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: əlavə satış yarat və qazanılmış sövdələşməni köçür">
        <HelpStep n={1}>
          <p>
            <HelpKey>Əlavə Satışlar</HelpKey> tabına keçin. Yuxarıda axtarış qutusu, növ və status
            süzgəcləri, sağda isə <HelpKey>Satış əlavə et</HelpKey> düyməsi var.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Növ süzgəcində «Bütün növlər / Aylıq (MRR) / Birdəfəlik», status süzgəcində «Bütün statuslar /
            Aktiv / Ləğv edilmiş / Tamamlanmış» seçimləri var. Altda dörd KPI kartı (Cəmi Satışlar, Satış
            MRR, Birdəfəlik, Aktiv) və satış cədvəli görünür. Heç satış yoxdursa, cədvəlin yerinə «Satış
            yoxdur. İlk satışı yaratmaq üçün "Satış əlavə et" düyməsinə basın.» yazısı durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Satış əlavə et</HelpKey> düyməsini basın və «Yeni satış» formasını doldurun:{" "}
            <strong>Şirkət *</strong>, <strong>Növ *</strong> (Aylıq MRR və ya Birdəfəlik),{" "}
            <strong>Ad *</strong>, istəyə bağlı kateqoriya, <strong>Vahid</strong>,{" "}
            <strong>Miqdar</strong>, <strong>Vahid qiyməti</strong> və <strong>Başlama tarixi *</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Forma açılır. Miqdar və qiymət sıfırdan böyük olanda sağda «Cəmi:» avtomatik hesablanır;
            növ «Aylıq (MRR)» olduqda yanında yaşıl «/ay» yazısı çıxır. Məcburi sahələr (Şirkət, Ad)
            doldurulmayana qədər <HelpKey>Yarat</HelpKey> düyməsi sönük qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Yarat</HelpKey> düyməsini basın (vaz keçmək üçün <HelpKey>Ləğv et</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymədə qısa fırlanan ikona görünür, sonra forma bağlanır və yeni satış cədvələ əlavə olunur.
            Növə görə yaşıl <strong>MRR</strong> və ya mavi <strong>Birdəfəlik</strong> nişanı, statusa
            görə isə rəngli status nişanı görünür. Yuxarıdakı KPI kartları (Cəmi Satışlar, Satış MRR və s.)
            yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Hələ satışlara köçürülməyən qazanılmış sövdələşmələr varsa, cədvəlin üstündə yaşıl{" "}
            <HelpKey>Qazanılmış Sövdələşmələr</HelpKey> kartı çıxır. Köçürmək istədiyiniz sətirdə{" "}
            <HelpKey>Satışlara əlavə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart sövdələşmənin adını, şirkətini, məbləğini və tarixini sadalayır. Düymə basılanda qısa
            fırlanma görünür, sonra sövdələşmə aylıq (recurring) satış kimi cədvələ köçür və yaşıl
            kartdan çıxır. Sövdələşmənin əlaqəli şirkəti yoxdursa, düymənin yerinə sönük «Şirkət yoxdur»
            görünür və köçürmə mümkün olmur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Yanlış əlavə olunmuş satışı silmək üçün satış cədvəlində həmin sətrin sağındakı qırmızı zibil
            ikonasını basın və təsdiq pəncərəsini qəbul edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Bu satışı silmək?» təsdiqi çıxır; təsdiqlədikdə sətir cədvəldən çıxır və yuxarıdakı KPI
            kartları yenidən hesablanır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: modeli Excel-ə ixrac et">
        <HelpStep n={1}>
          <p>
            Başlığın sağındakı <HelpKey>Excel-ə İxrac</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymənin altında kiçik pəncərə açılır. İçində <strong>Şablon</strong> açılan siyahısı
            («Template 1 — SALES», «Template 2 — CFO Report», «Budget P&amp;L»), <strong>Qüvvəyə minmə
            tarixi</strong> sahəsi və <HelpKey>Yüklə</HelpKey> düyməsi var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Şablonu seçin, lazımsa qüvvəyə minmə tarixini təyin edin və <HelpKey>Yüklə</HelpKey> düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yükləmə müddətində düymədə fırlanan ikona görünür, sonra brauzer .xlsx faylını endirir və
            pəncərə bağlanır. İxrac edilən fayl həmin anda tətbiq etdiyiniz <strong>düzəlişləri</strong>{" "}
            (sürüşdürücü ssenarisini) də nəzərə alır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            İxrac sürüşdürücü düzəlişlərini «şəkil» kimi götürür: əvvəlcə Qiymət Modeli tabında istədiyiniz
            ssenarini qurun, sonra ixrac edin — beləcə Excel faylı baza yox, məhz proqnoz rəqəmlərini əks
            etdirir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          İki müxtəlif «düzəliş» var və onları qarışdırmayın. <strong>Qiymət Modeli</strong> tabındakı
          sürüşdürücülər müvəqqəti ssenaridir — gəliri hesablama məqsədilə artırıb-azaldır, real qiyməti
          dəyişmir və <HelpKey>Sıfırla</HelpKey> ilə tamamilə geri qaytarılır. <strong>Qiymətləri Redaktə
          Et</strong> tabındakı dəyişikliklər isə <HelpKey>Saxla</HelpKey> basıldıqda qalıcı olur.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün qiymət məlumatı, şirkətlər, satışlar və qazanılmış sövdələşmələr təşkilatınızla
          məhdudlaşır — sorğular sizin tenant başlığınızla (organization id) göndərilir, ona görə başqa
          təşkilatın rəqəmlərini görmürsünüz. Şirkəti və ya satışı silmək geri qaytarılmır; ixrac edilən
          Excel faylında həssas qiymət məlumatı olur, ona görə onu paylaşarkən diqqətli olun.
        </p>
      </HelpCallout>
    </div>
  )
}
