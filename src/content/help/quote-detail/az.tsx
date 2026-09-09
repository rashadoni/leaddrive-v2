"use client"

/**
 * Quote detail / editor — help article (Azerbaijani).
 * Köhnə birləşik "quotes" məqaləsindən ayrılıb: yalnız tək təklif
 * səhifəsinin mövzusu — /quotes/[id] (sətirlər, endirim, qeydlər,
 * status keçidləri, PDF, izləmə pikseli, silmə). Təkliflər siyahısı
 * bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function quotedetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış nümayəndəsi və ya menecerisiniz"
        goal="Bir təklifi qurmaq, müştəriyə göndərmək və onun həyat dövrünü — baxıldı, qəbul, rədd — izləmək"
      >
        Bu səhifəyə təkliflər siyahısından (və ya sövdələşmə kartından)
        konkret bir təklifi açanda düşürsünüz. Açılanda səhifə həmin təklifi
        serverdən oxuyur. Bütün rəqəmlər və status yalnız öz təşkilatınızın
        məlumatından gəlir. <strong>Qeyd:</strong> təklif qəbul edilmiş, rədd
        edilmiş və ya müddəti bitmiş kimi sonlu (terminal) statusa düşəndə
        redaktə sahələri kilidlənir — bundan sonra yalnız baxa, PDF çıxara və
        ya silə bilərsiniz.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yüklənmə müddətində mərkəzdə fırlanan ikon və <HelpKey>Yüklənir…</HelpKey>{" "}
          yazısı çıxır. Təklif tapılmasa, <em>«Təklif tapılmadı.»</em> mesajı və{" "}
          <HelpKey>Təkliflərə qayıt</HelpKey> düyməsi göstərilir.
        </p>
        <p>
          Açıldıqda yuxarı solda <HelpKey>Bütün təkliflər</HelpKey> düyməsi
          (geri ox), altında təklifin nömrəsi, birdən böyük versiyalarda yanında{" "}
          <strong>v2</strong> kimi versiya nişanı və rəngli{" "}
          <strong>status nişanı</strong> (Qaralama / Göndərildi / Baxıldı /
          Qəbul edildi / Rədd edildi / Müddəti bitib) durur. Təklif bir
          sövdələşməyə bağlıdırsa, altında <em>«Sövdələşməyə bağlıdır:»</em> və
          klikləyiləbilən sövdə adı görünür.
        </p>
        <p>
          Sağ yuxarıda əməliyyat düymələri sırası var: cari statusa görə yalnız{" "}
          <strong>icazəli növbəti status</strong> düymələri (məs.{" "}
          <HelpKey>Göndərilmiş kimi işarələ</HelpKey>), sonra{" "}
          <HelpKey>Yadda saxla</HelpKey>, <HelpKey>PDF</HelpKey>, status
          «Göndərildi» olub izləmə tokeni varsa <HelpKey>Pikseli kopyala</HelpKey>,{" "}
          <HelpKey>Sil</HelpKey> və soru işarəli kömək düyməsi.
        </p>
        <p>
          Aşağıda <strong>Müştəri</strong> bloku (sövdələşmə seçici + PDF üçün
          müştəri adı), sonra <strong>Sətirlər</strong> cədvəli, onun altında{" "}
          <strong>Bütün təklif üzrə endirim</strong>, <strong>Etibarlılıq
          tarixi</strong> və <strong>Qeydlər</strong> blokları, sağda isə{" "}
          <strong>Yekun</strong> kartı (Aralıq cəm / Endirim / Cəmi və zaman
          xətti tarixləri) yerləşir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status nişanı">
            Təklifin cari mərhələsi: Qaralama, Göndərildi, Baxıldı, Qəbul
            edildi, Rədd edildi və ya Müddəti bitib. Hansı keçid düymələrinin
            görünəcəyini bu müəyyən edir.
          </HelpDef>
          <HelpDef term="Müştəri (sövdələşmə)">
            Təklifi mövcud bir sövdələşməyə bağlayan seçici. PDF-də «üçün»
            sətrini bu doldurur.
          </HelpDef>
          <HelpDef term="Müştəri adı (PDF)">
            Sərbəst mətn sahəsi — doldurulduqda PDF-də bağlı sövdələşmənin adını
            əvəz edir (məs. «ACME Corp»).
          </HelpDef>
          <HelpDef term="Sətir">
            Bir məhsul və ya xidmət sətri: məhsul/xidmət adı, növ, SKU, təsvir,
            miqdar, vahid qiymət, sətir endirimi və hesablanmış sətir cəmi.
          </HelpDef>
          <HelpDef term="Növ">
            Sətir tipi: Avadanlıq, Lisenziya, Abunəlik, Xidmət və ya Digər.
            Yalnız <strong>Xidmət</strong> kəsr miqdar qəbul edir (məs. saatlar);
            qalanları tam ədəd (≥1) tələb edir.
          </HelpDef>
          <HelpDef term="Bütün təklif üzrə endirim">
            Üç rejimli endirim: Yoxdur / Məbləğ / faiz (%). Yalnız biri eyni
            anda tətbiq olunur.
          </HelpDef>
          <HelpDef term="Etibarlılıq tarixi">
            Təklifin müştəri üçün etibarlı olduğu son tarix.
          </HelpDef>
          <HelpDef term="Yekun">
            Aralıq cəm, ümumi endirim və yekun cəm; altında yaradılma, göndərmə,
            baxılma, qəbul/rədd və etibarlılıq tarixlərindən mövcud olanlar.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: sətirləri redaktə et və yadda saxla">
        <HelpStep n={1}>
          <p>
            <strong>Sətirlər</strong> cədvəlində <HelpKey>Məhsul / Xidmət</HelpKey>{" "}
            xanasına yazın və ya açılan kataloq siyahısından bir məhsul seçin.
            Kataloqdan seçəndə qiymət, SKU və növ avtomatik dolur.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca kataloq təklifləri açılır. Məhsul seçiləndə həmin sətrin{" "}
            <strong>Vahid qiymət</strong>, <strong>SKU / Hissə №</strong> və{" "}
            <strong>Növ</strong> xanaları məhsulun məlumatı ilə dolur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Hər sətir üçün <HelpKey>Növ</HelpKey> seçin (Avadanlıq / Lisenziya /
            Abunəlik / Xidmət / Digər), <HelpKey>Miqdar</HelpKey>,{" "}
            <HelpKey>Vahid qiymət</HelpKey> və istəyə bağlı{" "}
            <HelpKey>Endirim</HelpKey> (sətir səviyyəsində məbləğ) daxil edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Xidmət</strong> növündə miqdar sahəsi kəsr dəyər qəbul edir;
            digər növlərdə isə tam ədəd (ən azı 1). <strong>Sətir cəmi</strong>{" "}
            sütununda hələ tire (—) görünə bilər — o, yadda saxlandıqdan sonra
            serverdə hesablanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Daha çox sətir lazımdırsa, cədvəlin altındakı{" "}
            <HelpKey>Sətir əlavə et</HelpKey> düyməsini basın. Sətri silmək üçün
            onun sonundakı zibil qutusu ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yeni boş sətir cədvəlin sonuna əlavə olunur. Cədvəldə yalnız bir
            sətir qalanda silmə ikonası deaktiv olur — ən azı bir sətir saxlanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            İstəyə bağlı olaraq <HelpKey>Bütün təklif üzrə endirim</HelpKey>{" "}
            blokunda <HelpKey>Yoxdur</HelpKey>, <HelpKey>Məbləğ</HelpKey> və ya{" "}
            <HelpKey>%</HelpKey> seçin və dəyər yazın;{" "}
            <HelpKey>Etibarlılıq tarixi</HelpKey> və <HelpKey>Qeydlər</HelpKey>{" "}
            (daxili) sahələrini doldurun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Məbləğ</strong> və ya <strong>%</strong> seçiləndə yanında
            rəqəm xanası peyda olur; <strong>Yoxdur</strong> seçimi onu gizlədir.
            Qeydlər sahəsi daxilidir — müştərinin gördüyü PDF-ə düşmür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yadda saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymədə fırlanan ikon görünür, sonra <em>«Təklif yadda saxlanıldı»</em>{" "}
            bildirişi çıxır. Səhifə yenidən yüklənir və{" "}
            <strong>Yekun</strong> kartında Aralıq cəm, Endirim və Cəmi yenidən
            hesablanmış rəqəmlərlə yenilənir. Adı və qiyməti olmayan natamam
            sətirlər yadda saxlanarkən nəzərə alınmır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: müştəri və status keçidi">
        <HelpStep n={1}>
          <p>
            <strong>Müştəri</strong> blokunda <HelpKey>Müştəri (sövdələşmə)</HelpKey>{" "}
            seçici ilə təklifi bir sövdələşməyə bağlayın və ya{" "}
            <HelpKey>Müştəri adı (PDF)</HelpKey> sahəsinə sərbəst ad yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sövdələşmə seçəndə başlıqdakı «Sövdələşməyə bağlıdır:» sətri yenilənir.
            Müştəri adı doldurulubsa, PDF-də sövdələşmə adı yerinə həmin ad çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Təklifi irəli aparmaq üçün sağ yuxarıdakı status düyməsini basın —
            yalnız cari statusdan icazəli olanlar görünür (məs. Qaralamada{" "}
            <HelpKey>Göndərilmiş kimi işarələ</HelpKey>, Göndəriləndə{" "}
            <HelpKey>Baxılmış kimi işarələ</HelpKey> / <HelpKey>Rədd edilmiş kimi
            işarələ</HelpKey>, Baxılandan sonra <HelpKey>Qəbul edilmiş kimi
            işarələ</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymədə fırlanan ikon görünür, sonra <em>«Təklif «…» kimi işarələndi»</em>{" "}
            bildirişi çıxır və status nişanı yeni rəngə keçir. Müvafiq zaman xətti
            tarixi (Göndərildi / Baxıldı / Qəbul edildi) <strong>Yekun</strong>{" "}
            kartında peyda olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Təklifi qəbul edilmiş kimi işarələdikdə sistem avtomatik olaraq
            müqavilə qaralaması yarada bilər.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Belə olduqda <em>«… nömrəli müqavilə qaralaması yaradıldı»</em>{" "}
            bildirişi çıxır və içində <HelpKey>Müqaviləyə bax</HelpKey> düyməsi
            olur — basanda birbaşa yeni müqaviləyə keçirsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Təklifi rədd etmək üçün <HelpKey>Rədd edilmiş kimi işarələ</HelpKey>{" "}
            düyməsini basın, açılan qırmızı paneldə səbəbi yazın və{" "}
            <HelpKey>Rəddi təsdiqlə</HelpKey> ilə təsdiqləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yuxarıda qırmızı fonlu panel açılır: «Rədd səbəbi (şifrələnir)»
            başlıqlı mətn sahəsi, <HelpKey>Rəddi təsdiqlə</HelpKey> və{" "}
            <HelpKey>Ləğv et</HelpKey> düymələri. Səbəb boş qaldıqca təsdiq
            düyməsi deaktiv olur və yanında «Səbəb göstərilməlidir.» yazısı durur.
            Təsdiqdən sonra status «Rədd edildi» olur və səbəb ayrıca blokda
            göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: PDF, izləmə pikseli və silmə">
        <HelpStep n={1}>
          <p>
            Müştəri üçün sənədi əldə etmək üçün <HelpKey>PDF</HelpKey> düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Təklifin PDF-i yeni brauzer vərəqində açılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Təklif <strong>«Göndərildi»</strong> statusunda olub izləmə tokeni
            varsa, <HelpKey>Pikseli kopyala</HelpKey> düyməsi görünür. Onu basıb
            piksel kodunu kopyalayın və göndərdiyiniz e-poçtun mətninə yapışdırın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <em>«İzləmə pikseli kopyalandı — onu məktubunuza yapışdırın»</em>{" "}
            bildirişi çıxır. Müştəri həmin məktubu açanda piksel yüklənir və
            təklif avtomatik olaraq «Baxıldı» statusuna keçir. (Bu düymə yalnız
            statusu «Göndərildi» olan və tokeni olan təkliflərdə görünür.)
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Təklifi silmək üçün sağ yuxarıdakı qırmızı{" "}
            <HelpKey>Sil</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Təklifi sil» təsdiq pəncərəsi açılır və sətirlərin də onunla birlikdə
            silinəcəyini xəbərdar edir. Təsdiqlədikdən sonra təkliflər siyahısına
            qaytarılırsınız.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Status irəli gedir, geri yox — qəbul/rədd/müddət-bitmə sonludur və
          qaralamaya qayıtmaq olmur. Buna görə işarələməzdən əvvəl sətirləri və
          rəqəmləri <HelpKey>Yadda saxla</HelpKey> ilə təsdiqləyin: sonlu statusda
          bütün redaktə sahələri kilidlənir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Silmə geri qaytarılmır və təklifin bütün <strong>sətirlərini də</strong>{" "}
          silir. Rədd səbəbi məcburidir və şifrələnmiş şəkildə audit izi üçün
          saxlanılır — onu mənalı yazın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Təklif, onun sətirləri və bağlı sövdələşmə yalnız öz təşkilatınıza
          aiddir — başqa tenant-ın təkliflərini aça bilmirsiniz. Rədd səbəbi
          serverdə şifrələnir; bu səhifə yalnız açıq mətni görür.
        </p>
      </HelpCallout>
    </div>
  )
}
