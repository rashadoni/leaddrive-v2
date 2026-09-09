"use client"

/**
 * MTM Marşrutlar — yardım məqaləsi (Azərbaycanca).
 * REWRITE: əvvəllər ziyarət və tapşırıqlarla birgə idi — onlar artıq
 * öz məqalələrinə ayrılıb. Bu məqalə YALNIZ /mtm/routes səhifəsini
 * (marşrut planlaşdırma + siyahı/təqvim görünüşü + detal paneli)
 * əhatə edir. Ziyarət və tapşırıq idarəetməsi bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MtmroutesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Saha əməliyyatları üzrə supervayzer və ya marşrut planlayıcısısınız"
        goal="Agentlər üçün günlük marşrutları planlaşdırmaq, hansı müştəri nöqtələrini ziyarət edəcəklərini düzmək və icranın necə getdiyini izləmək"
      >
        Səhifəyə <HelpKey>Marşrutlar</HelpKey> bölməsindən keçirsiniz. Dəyişiklik etməzdən əvvəl aylıq planı
        görə bilməyiniz üçün standart olaraq <HelpKey>Təqvim</HelpKey> görünüşü açılır. Görünən ay və həftə
        səlahiyyət dairəniz daxilində tam yüklənir, bütün marşrutlar isə yalnız təşkilatınıza aiddir. Axtarış
        və tarixçə üçün <HelpKey>Digər</HelpKey> menyusundan <HelpKey>Bütün marşrutlar</HelpKey> görünüşünü açın.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          <HelpKey>Təqvim</HelpKey> əsas görünüşdür. Menecerlər və yoxlayıcılar həmçinin{" "}
          <HelpKey>Komanda həftəsi</HelpKey> görünüşünü görürlər. <HelpKey>Digər</HelpKey> menyusunda{" "}
          <HelpKey>Bütün marşrutlar</HelpKey>, həftə planı və rolunuz imkan verirsə, təsdiqlər yerləşir.
          Agent həmin menyuda yalnız öz tarixçəsini <HelpKey>Mənim marşrutlarım</HelpKey> adı ilə görür.{" "}
          <HelpKey>Marşrut planlaşdır</HelpKey> düyməsi
          istənilən görünüşdən yeni marşrut yaradır. Yığcam aylıq xülasə <strong>Bu ay</strong>,{" "}
          <strong>Planlaşdırılmış</strong>, <strong>Davam edir</strong> və <strong>Tamamlanmış</strong>
          göstəricilərini planın özündən diqqəti yayındırmadan göstərir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Bu ay">Təqvimdə hazırda görünən ayın bütün marşrutları.</HelpDef>
          <HelpDef term="Planlaşdırılmış">Görünən ayda sahə icrasına hazır marşrutlar.</HelpDef>
          <HelpDef term="Davam edir">Görünən ayda agentlərin başladığı marşrutlar.</HelpDef>
          <HelpDef term="Tamamlanmış">Görünən ayda agentlərin tamamladığı marşrutlar.</HelpDef>
          <HelpDef term="Yarımçıq">Günü bitdiyi halda açıq qalmış marşrutlar. Sistem onları gecə yarısından bir neçə saat sonra bağlayır və ziyarət olunan hər şeyi saxlayır; heç kim onları ləğv etməyib.</HelpDef>
          <HelpDef term="Marşrut">Bir agent, bir tarix və sıralı müştəri nöqtələri olan günlük plan; status DRAFT / PLANNED / IN_PROGRESS / COMPLETED / INCOMPLETE / CANCELLED ola bilər.</HelpDef>
          <HelpDef term="Nöqtə">Marşruta daxil edilmiş müştəri; ziyarət vəziyyəti VISITED (yaşıl), SKIPPED (qırmızı) və ya neytral ola bilər.</HelpDef>
        </dl>
        <p>
          <HelpKey>Bütün marşrutlar</HelpKey> görünüşü axtarış və tarixçə üçün daha əlverişlidir. Hər marşrut kartında
          agentin adı, tarix, sağda status nişanı, redaktə (qələm)
          və sil (zibil qutusu) düymələri olur. Aşağıda nöqtə sayı, ziyarət edilmiş say, faiz göstərən
          tərəqqi zolağı və hər nöqtəni nömrələnmiş kiçik nişanlarla göstərən sətir var. Kartın özünə
          basanda yuxarıda detal paneli açılır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni marşrut yarat">
        <HelpStep n={1}>
          <p>
            Tapşırığınıza uyğun yerdən başlayın: <HelpKey>Marşrut planlaşdır</HelpKey> düyməsini basın,
            <HelpKey>Təqvim</HelpKey> görünüşündə boş tarixi və ya <HelpKey>Komanda həftəsi</HelpKey>
            görünüşündə boş «əməkdaş × tarix» xanasını seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Səhifədə tamölçülü marşrut konstruktoru açılır. Təqvimdən seçilən tarix avtomatik doldurulur;
            həftə xanası isə əməkdaşı da əvvəlcədən seçir. Saxlamazdan əvvəl hər iki dəyəri dəyişə bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Yuxarıda göstərilən ilk iki addımı tamamlayın: <HelpKey>Kim və nə vaxt</HelpKey>, sonra{" "}
            <HelpKey>Müştərilər</HelpKey>. Əməkdaşı və tarixi seçin, ardınca istiqamət bölmələri, axtarış və
            filtrlərlə təşkilatları, həkimləri və ya əlaqələri əlavə edin. Lazım olan qeyd namizədlərdə
            görünmürsə, menecer <HelpKey>Mövcud müştərini tap və təyin et</HelpKey> düyməsi ilə həmin
            səhifədən çıxmadan onu əməkdaşa bağlayıb marşruta əlavə edə bilər.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tamamlanan hər addım işarələnir. Axtarış edəndə, filtrləri dəyişəndə və ya müştəri qrupları
            arasında keçəndə seçilmiş müştərilər saxlanılır. Marşrut adı, iştirakçılar və qeydlər əlavə
            parametrlərdə yerləşir. Başqa əməkdaşa bağlı qeyd köçürülürsə, sistem ayrıca təsdiq istəyir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Seçilmiş dayanacaqları, onların sırasını və plan vaxtlarını yoxlayın. Sonra{" "}
            <HelpKey>Qaralamanı saxla</HelpKey> düyməsini basın və ya rolunuz icazə verirsə, marşrutu dərc
            edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Üçüncü addım əməkdaş, tarix və ən azı bir müştəri seçildikdən sonra aktiv olur. Saxladıqdan sonra
            konstruktoru açdığınız Təqvim, Bütün marşrutlar və ya Komanda həftəsi görünüşünə qayıdacaqsınız və yeni
            marşrut həmin görünüşdə seçiləcək.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: marşrutu axtar, filtrlə və sırala">
        <HelpStep n={1}>
          <p>
            <HelpKey>Digər</HelpKey> menyusundan <HelpKey>Bütün marşrutlar</HelpKey> görünüşünü açın və status
            filtr düymələrindən birini basın: <HelpKey>Hamısı</HelpKey>, <HelpKey>Qaralama</HelpKey>,{" "}
            <HelpKey>Planlaşdırılmış</HelpKey>, <HelpKey>Davam edir</HelpKey>,{" "}
            <HelpKey>Tamamlanmış</HelpKey>, <HelpKey>Yarımçıq</HelpKey> və ya{" "}
            <HelpKey>Ləğv edilmiş</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər düymənin yanında həmin statusdakı marşrutların sayı mötərizədə durur. Seçilmiş filtr
            işıqlanır və siyahı yalnız o statusdakı marşrutları göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Konkret marşrutu tapmaq üçün <HelpKey>Marşrutları axtar...</HelpKey> sahəsinə yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca siyahı dərhal süzülür — axtarış həm agentin adına, həm də marşrut adına baxır.
            Uyğun gələn yoxdursa «Marşrut tapılmadı», ümumiyyətlə marşrut yoxdursa «Hələ marşrut yoxdur»
            mesajı göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sağdakı açılan siyahıdan sıralamanı seçin: <HelpKey>Tarix ↓</HelpKey> (yenidən köhnəyə),{" "}
            <HelpKey>Tarix ↑</HelpKey> (köhnədən yeniyə) və ya <HelpKey>Statusa görə</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahı dərhal seçilmiş sıraya görə yenidən düzülür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: marşrutun detalına bax">
        <HelpStep n={1}>
          <p>
            Bütün marşrutlar görünüşündə hər hansı marşrut kartının üstünə basın (təqvim görünüşündə isə gündəki marşrut
            nişanına basın).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yuxarıda detal paneli açılır. Başlıqda marşrutun adı (və ya agentin adı) ilə tarix, sağda × ilə
            bağlama düyməsi var. Altında beş metrik xanası durur: <strong>Completed</strong>{" "}
            (ziyarət/cəmi), <strong>Execution</strong> (icra faizi), <strong>Duration</strong> (başlama və
            bitmə vaxtı varsa müddət), <strong>Points</strong> (nöqtə sayı) və <strong>Distance</strong>{" "}
            (məsafə, varsa).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Nöqtələrin koordinatları varsa, panelə baxmağa davam edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ən azı bir nöqtənin koordinatı varsa, metriklərin altında kiçik xəritə göstərilir. Daha aşağıda
            nöqtələr sıra nömrəsi (1, 2, 3 …), müştəri adı və status nişanı (VISITED / SKIPPED / digər) ilə
            sadalanır; ziyarət vaxtı varsa, sətrin sonunda göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bitirdikdə panelin sağ yuxarısındakı × ilə bağlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Detal paneli bağlanır və istifadə etdiyiniz Təqvim, Bütün marşrutlar və ya Komanda həftəsi görünüşündə
            qalırsınız.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: təqvim, komanda həftəsi, redaktə və silmə">
        <HelpStep n={1}>
          <p>
            Tarix üzrə planlaşdırmaq üçün standart <HelpKey>Təqvim</HelpKey> görünüşündən istifadə edin.
            Oxlarla ayı dəyişin, <HelpKey>Bu gün</HelpKey> düyməsi ilə cari tarixə qayıdın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kompüterdə ayın tam şəbəkəsi görünür. Telefon və planşetdə isə sıxılmış kompüter şəbəkəsi əvəzinə
            toxunmaq üçün rahat tarix seçimi və seçilmiş günün planı göstərilir. Marşrutda əməkdaş, qısa
            müştəri məlumatı, nöqtə sayı və status görünür. Marşrutu açmaq üçün ona, tarixi əvvəlcədən
            doldurulmuş yeni marşrut yaratmaq üçün isə boş günə toxunun.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Əməkdaşların yeddi günlük planını müqayisə etmək üçün <HelpKey>Komanda həftəsi</HelpKey>
            görünüşünü açın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Rolunuz komanda planlaşdırmasına icazə verirsə, əməkdaşlar sətirlərdə, tarixlər sütunlarda göstərilir. Səhifəni üfüqi sürüşdürəndə əməkdaş sütunu
            görünən qalır. Əməkdaş və tarixi avtomatik seçilmiş marşrut yaratmaq üçün boş xanaya toxunun.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Marşrutu dəyişmək üçün kartdakı qələm ikonalı (<HelpKey>Marşrutu redaktə et</HelpKey>) düyməni
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Konstruktor mövcud əməkdaş, tarix, müştərilər və qeydlərlə açılır. İcazə verilən dəyişiklikləri
            edin və saxlayın. Sahə tarixçəsinin dəyişməməsi üçün ziyarət edilmiş və buraxılmış dayanacaqlar
            kilidli qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Marşrutu silmək üçün kartdakı qırmızı zibil qutusu ikonalı (<HelpKey>Marşrutu sil</HelpKey>)
            düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Marşrut artıq dərc olunubsa, müştəri nöqtəsinin silinməsi dəyişiklik sorğusu yaradır. Menecer
            təsdiqləyənədək nöqtə marşrutda qalır; rədd edilmiş sorğu marşrutu dəyişmir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Marşrut və məlumatlar üçün Excel mübadiləsi">
        <p>
          Administratorlar və icazəli menecerlər <HelpKey>Excel mübadiləsi</HelpKey> bölməsini açıb
          müştərilər, marşrutlar, satış faktları və ya planı seçə, interfeys dilində şablon yükləyə bilərlər.
          Fayl yükləndikdə məlumat yazılmadan əvvəl yaradılacaq, yenilənəcək, dəyişməyəcək və səhv sətirlər
          ayrıca göstərilir.
        </p>
        <HelpCallout kind="tip">
          Sətir və sütunu göstərən səhv faylını yükləyib düzəliş edin. Marşrutun xarici ID-si, agent və
          müştəri kodları mövcud qeydləri təhlükəsiz yeniləyir; dublikat və konfliktlər səlahiyyətli
          yoxlayanın açıq təsdiqinədək bloklanır.
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          Tarixi keçmişdə olan marşrutu mobile tətbiqi göstərmir. Buna görə forma keçmiş tarix üçün
          xəbərdarlıq verir — agent marşrutu telefonunda görsün deyə tarixin bu gün və ya gələcək
          olduğuna əmin olun.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün marşrutlar, agentlər və müştərilər təşkilatınızla məhdudlaşır — siyahıya yalnız öz
          tenant-ınızın marşrutları yüklənir və formada yalnız öz təşkilatınızın agent və müştərilərini
          seçə bilərsiniz. Başqa təşkilatın marşrutlarını görmürsünüz.
        </p>
      </HelpCallout>
    </div>
  )
}
