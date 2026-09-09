"use client"

/**
 * Offers (Kommersiya təklifləri) — help article (Azerbaijani).
 * Yalnız Təkliflər siyahı səhifəsini əhatə edir:
 * KPI kartları, status tabları, axtarış/cədvəl, yeni təklif forması
 * (növ/başlıq, müştəri CRM-dən və ya əl ilə, mövqe cədvəli, valyuta/ƏDV/endirim,
 * yekun hesablama), redaktə və silmə. Təklif detalı səhifəsi bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function OffersHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış nümayəndəsi və ya satış menecerisiniz"
        goal="Müştəriyə kommersiya təklifi (qiymət təklifi) hazırlamaq, mövqeləri, valyutanı, ƏDV və endirimi düzgün hesablamaq və təklifi statusuna görə izləmək"
      >
        Səhifəyə sol menyudan <HelpKey>Təkliflər</HelpKey> bölməsi ilə çatırsınız. Bütün təkliflər yalnız
        sizin təşkilatınıza aiddir. Səhifə açılarkən siyahı serverdən yüklənir; yüklənənə qədər boz
        «skelet» kartlar görünür. Statistika kartları, status tabları və mövqe cədvəlindəki yekun — hamısı
        eyni siyahıdan hesablanır, ona görə təklif əlavə edib/silib statusu dəyişdikcə saylar dərhal
        yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Təkliflər</HelpKey> adı (yanında turu yenidən oynatmaq düyməsi), altında
          «Kommersiya təkliflərini yaradın və izləyin» izahı, sağ yuxarıda isə <HelpKey>Yeni təklif</HelpKey>{" "}
          düyməsi var. Aşağıda səhifə təsviri və «Bilirdinizmi?» ipucu zolağı gəlir. Sonra dörd KPI kartı
          sırası, status filtri tabları, üstündə axtarış sahəsi olan cədvəl və ən altda forma/silmə
          pəncərələri durur.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Cəmi">Cari siyahıdakı bütün təkliflərin sayı (KPI kartı və «Hamısı» tabında eyni rəqəm).</HelpDef>
          <HelpDef term="Məbləğ">Bütün təkliflərin ümumi pul dəyərinin cəmi, ilk təklifin valyutası ilə göstərilir.</HelpDef>
          <HelpDef term="Təsdiqlənib">Statusu «Təsdiqlənib» (və ya qəbul edilmiş) olan təkliflərin sayı.</HelpDef>
          <HelpDef term="Rədd edilib">Statusu «Rədd edilib» olan təkliflərin sayı.</HelpDef>
          <HelpDef term="Status">Təklifin gedişatı: Qaralama → Göndərilib → Təsdiqlənib / Rədd edilib.</HelpDef>
          <HelpDef term="Təklif növü">Kommersiya, Hesab-faktura, Avadanlıq və ya Xidmətlər — təklifin tipi.</HelpDef>
          <HelpDef term="Etibarlıdır">Təklifin son tarixi; tarix keçibsə, cədvəldə qırmızı rəng və «Müddəti bitib» qeydi ilə göstərilir.</HelpDef>
          <HelpDef term="Mövqe">Təklif daxilindəki sətir — ad, miqdar, qiymət və endirimlə birlikdə bir məhsul/xidmət.</HelpDef>
        </dl>
        <p>
          Cədvəl sütunları: <strong>Nömrə</strong> (klik edilə bilən, təklifi açır),{" "}
          <strong>Başlıq</strong>, <strong>Təklif növü</strong>, <strong>Məbləğ</strong>,{" "}
          <strong>Status</strong> (rəngli nişan), <strong>Etibarlıdır</strong> və ən sağda iki əməliyyat
          düyməsi — redaktə (qələm ikonası) və sil (qırmızı zibil qutusu ikonası). Sütun başlıqlarının
          çoxu çeşidlənə bilir və başlıqların yanında izahedici ipucu nişanları var. Sətrin istənilən
          yerinə (və ya nömrəyə) klik təklifin detal səhifəsini açır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: təklifləri statusa görə süz və axtar">
        <HelpStep n={1}>
          <p>
            KPI kartlarının altındakı status tablarından birini seçin:{" "}
            <HelpKey>Hamısı</HelpKey>, <HelpKey>Qaralama</HelpKey>, <HelpKey>Göndərilib</HelpKey>,{" "}
            <HelpKey>Təsdiqlənib</HelpKey> və ya <HelpKey>Rədd edilib</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər tabın yanında o statusdakı təkliflərin sayı dairəvi nişanda görünür. Seçilmiş tab dolu
            (rəngli) görünür, cədvəl isə yalnız həmin statusdakı təkliflərə süzülür. Süzgəc serverdən
            yenidən sorğu göndərir, ona görə siyahı qısa anlıq yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Konkret təklifi tapmaq üçün cədvəlin üstündəki <HelpKey>Təklif axtar...</HelpKey> sahəsinə
            başlıqdan bir hissə yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca cədvəl başlığa görə süzülür və yalnız uyğun gələn sətirlər qalır. Bu axtarış status
            filtri ilə birgə işləyir — əvvəl tab statusa görə daraldır, sonra mətn başlığa görə.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni təklif yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni təklif</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni təklif» başlıqlı pəncərə açılır. Yuxarıda <strong>Təklif növü</strong> açılan siyahısı və
            yanında <strong>Təklifin adı *</strong> sahəsi, altında «Müştəri məlumatları», «Mövqelər» və
            yekun bölmələri olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Təklif növü</strong>-nü seçin (<HelpKey>Kommersiya</HelpKey>, <HelpKey>Hesab-faktura</HelpKey>,{" "}
            <HelpKey>Avadanlıq</HelpKey> və ya <HelpKey>Xidmətlər</HelpKey>) və <strong>Təklifin adı</strong>{" "}
            yazın — bu yeganə məcburi sahədir (məs. «Kommersiya təklifi»).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ad sahəsində «Kommersiya təklifi...» nümunə mətni durur. Adı boş buraxıb yadda saxlamağa
            çalışsanız, pəncərənin yuxarısında qırmızı «Təklifin adı tələb olunur» xəbərdarlığı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            «Müştəri məlumatları» çərçivəsində mənbəni seçin: <HelpKey>CRM-dən</HelpKey> (standart) və ya{" "}
            <HelpKey>Əl ilə daxil et</HelpKey>. CRM rejimində <strong>Şirkət seçin</strong> açılan
            siyahısından şirkəti, sonra <strong>Əlaqədar şəxs</strong>-i seçin. Əl ilə rejimində{" "}
            <strong>Müştəri adı</strong>, <strong>VÖEN</strong>, <strong>Əlaqədar şəxs</strong> və{" "}
            <strong>Müqavilə №</strong> sahələri açılır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Çərçivənin sağ küncündə <HelpKey>CRM-dən</HelpKey> / <HelpKey>Əl ilə daxil et</HelpKey> iki
            kiçik düymə var — seçilmiş rejim dolu görünür. CRM rejimində şirkət seçilənə qədər «Əlaqədar
            şəxs» siyahısı qeyri-aktivdir; şirkət seçdikdən sonra onun kontaktları ilə dolur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            «Mövqelər» bölməsində sətirləri doldurun. Hazır məhsuldan əlavə etmək üçün sağ yuxarıdakı{" "}
            <HelpKey>Məhsullardan seç</HelpKey> düyməsini (məhsullar varsa görünür), əl ilə sətir əlavə
            etmək üçünsə <HelpKey>Əlavə et</HelpKey> düyməsini basın. Hər sətirdə <strong>Ad</strong>,{" "}
            <strong>Miqdar</strong>, <strong>Qiymət</strong> və <strong>Endirim %</strong> daxil edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəlin başlığı rəngli zolaqdır: <strong>Ad · Miqdar · Qiymət · Endirim % · Cəmi</strong>. Hər
            sətrin sonunda avtomatik hesablanmış <strong>Cəmi</strong> və silmək üçün zibil qutusu ikonası
            görünür (yalnız bir sətir qalanda silmə düyməsi sönük olur). <HelpKey>Məhsullardan seç</HelpKey>{" "}
            basıldıqda məhsul və qiyməti olan açılan siyahı düşür; məhsulu seçəndə yeni sətir kimi əlavə
            olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Alt hissədə təklif parametrlərini təyin edin: <strong>Valyuta</strong>,{" "}
            <strong>Etibarlıdır</strong> (son tarix), <strong>ƏDV 18%</strong> qeyd qutusu,{" "}
            <strong>Ümumi endirim</strong> faizi və <strong>Qeydlər</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sağda canlı yekun paneli durur: <strong>Ara cəm</strong>, endirim qoyulubsa narıncı rəngdə{" "}
            <strong>Endirim (faiz)</strong> sətri, ƏDV işarələnibsə <strong>ƏDV (18%)</strong> sətri və ən
            altda iri <strong>YEKUNİ</strong> məbləği. Hər dəyişiklik (miqdar, qiymət, endirim, ƏDV) bu
            rəqəmləri dərhal yeniləyir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Aşağıdakı <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>İmtina</HelpKey> ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yadda saxlanarkən «Saxlanılır...» yazısına keçir, sonra pəncərə bağlanır və yeni təklif
            siyahıda peyda olur. <strong>Cəmi</strong> KPI kartındakı say bir vahid artır. Yeni təklif
            standart olaraq «Qaralama» statusunda yaranır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: təklifi redaktə et və ya sil">
        <HelpStep n={1}>
          <p>
            Mövcud təklifi dəyişmək üçün cədvəlin sağındakı qələm ikonalı (<HelpKey>Redaktə et</HelpKey>)
            düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Təklifi redaktə et» başlıqlı, mövcud növ, ad, müştəri, mövqelər, valyuta, ƏDV, endirim və
            qeydlərlə əvvəlcədən doldurulmuş eyni forma açılır. Dəyişiklik edib <HelpKey>Saxla</HelpKey>{" "}
            ilə təsdiqləyin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Təklifi silmək üçün onun sətrindəki qırmızı zibil qutusu ikonalı (<HelpKey>Sil</HelpKey>)
            düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Təklifi sil» təsdiq pəncərəsi açılır və hansı təklifin (başlığı ilə) silinəcəyini soruşur.
            Təsdiqlədikdən sonra təklif siyahıdan çıxır və KPI kartları ilə tab sayları yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmə geri qaytarılmır — təklif və onun bütün mövqeləri birdəfəlik itir. Təklifi sadəcə işdən
            kənarlaşdırmaq istəyirsinizsə, silmək yerinə statusunu izləyin: artıq lazım olmayan təklifləri
            «Rədd edilib» kimi işarələyib siyahıda saxlaya bilərsiniz.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Eyni məhsulları tez-tez təklif edirsinizsə, onları əvvəlcədən Məhsullar bölməsində saxlayın —
          onda təklif formasında <HelpKey>Məhsullardan seç</HelpKey> ilə adı və qiyməti bir kliklə əlavə
          edib əl ilə yazmaqdan qurtulursunuz. <strong>Etibarlıdır</strong> tarixini həmişə doldurun:
          tarix keçəndə cədvəldə təklif qırmızı «Müddəti bitib» qeydi ilə işarələnir və köhnə təklifləri
          asanca seçirsiniz.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün təkliflər təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın təkliflərini görür,
          redaktə və silə bilirsiniz, başqa təşkilatın təkliflərini görmürsünüz. Müştəri formasındakı
          şirkət və əlaqədar şəxs siyahıları da yalnız sizin CRM məlumatlarınızdan gəlir.
        </p>
      </HelpCallout>
    </div>
  )
}
