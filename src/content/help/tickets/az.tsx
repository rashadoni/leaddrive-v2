"use client"

/**
 * Dəstək Mərkəzi (Tickets) — help article (Azerbaijani).
 * Köhnə birgə "support" slug-undan ayrılıb: yalnız /tickets
 * səhifəsini əhatə edir — bilet siyahısı/kanban, statistika kartları,
 * status və eskalasiya filtrləri, bilet yaratma/redaktə forması (Da Vinci
 * avto-təsnif, şikayət bayrağı daxil), SLA göstəriciləri və silmə.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function TicketsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dəstək agenti və ya dəstək komandasının rəhbərisiniz"
        goal="Müştəri müraciətlərini bilet kimi qeydə almaq, prioritet və SLA üzrə izləmək, agentlərə paylamaq və həll edilənə qədər vəziyyətini idarə etmək"
      >
        Səhifə soldakı menyudan <HelpKey>Dəstək Mərkəzi</HelpKey> bölməsidir. Bütün biletlər yalnız
        sizin təşkilatınıza aiddir. Səhifə hər 20 saniyədən bir özünü yeniləyir — siz baxarkən gələn
        yeni bilet siyahıda narıncı vurğu ilə yanıb-sönür və yalnız onu açanda vurğu sönür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Dəstək Mərkəzi</HelpKey> adı, altında «SLA izləmə ilə dəstək biletlərini
          idarə et» izahı var. Sağ yuxarıda iki idarəetmə durur: <HelpKey>Siyahı</HelpKey> /{" "}
          <HelpKey>Kanban</HelpKey> görünüş açarı və <HelpKey>Yeni bilet</HelpKey> düyməsi. Onların
          altında beş statistika kartı, sonra status filtr düymələri, ən altda isə bilet cədvəli (və
          ya kanban lövhəsi) gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Cəmi">Bütün biletlərin sayı (bütün statuslar daxil).</HelpDef>
          <HelpDef term="Açıq">Hələ həll edilməmiş və ya bağlanmamış biletlərin sayı.</HelpDef>
          <HelpDef term="Təyin edilməyib">Heç bir agentə təyin olunmamış biletlərin sayı.</HelpDef>
          <HelpDef term="SLA pozulub">SLA son tarixini keçmiş, açıq qalan biletlərin sayı.</HelpDef>
          <HelpDef term="Həll edilmiş">Statusu «Həll edildi» olan biletlərin sayı.</HelpDef>
          <HelpDef term="SLA">Son tarixə qədər qalan vaxt: yaşıl = vaxt var, sarı = 2 saatdan az qalıb, qırmızı = pozulub.</HelpDef>
          <HelpDef term="Eskalasiya (L1–L5)">Biletin neçə dəfə yuxarı qaldırıldığını göstərən səviyyə nişanı; səviyyə yüksəldikcə rəng tündləşir.</HelpDef>
          <HelpDef term="Cavab">İlk cavabın bileti yaranandan nə qədər sonra verildiyi.</HelpDef>
        </dl>
        <p>
          Beş kart: <strong>Cəmi</strong>, <strong>Açıq</strong>, <strong>Təyin edilməyib</strong>,{" "}
          <strong>SLA pozulub</strong> və <strong>Həll edilmiş</strong>. Cədvəl sütunları:{" "}
          <strong>#</strong> (bilet nömrəsi), <strong>Mövzu</strong>, <strong>Prioritet</strong>,{" "}
          <strong>Şirkət</strong>, <strong>Status</strong>, <strong>SLA</strong>,{" "}
          <strong>Eskalasiya</strong>, <strong>Cavab</strong>, <strong>Təyin edilib</strong> və hər
          sətrin sonunda redaktə (qələm) ilə sil (zibil qutusu) düymələri. Sətrin özünə klikləyəndə
          bilet tam açılır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni bilet yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni bilet</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni bilet» başlıqlı pəncərə açılır. İçində <strong>Mövzu *</strong> sahəsi,{" "}
            <strong>Prioritet</strong> və <strong>Kateqoriya</strong> açılan siyahıları, «Bu müştəri
            şikayəti / təklifidir» qeyd qutusu, <strong>Şirkət</strong>, <strong>Contact</strong>,{" "}
            <strong>Təyin edilib</strong> seçimləri və <strong>Təsvir</strong> sahəsi var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Mövzu</strong> yazın — bu yeganə məcburi sahədir (məs. «Faktura PDF açılmır»).
            Yazıb sahədən çıxanda Da Vinci avtomatik olaraq kateqoriya və prioriteti təklif edə bilər.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mövzu 5 simvoldan uzun olub fokus itirəndə qısa müddət «AI təsnif edir...» yazısı yanıb-sönür,
            sonra <strong>Kateqoriya</strong> və <strong>Prioritet</strong> avtomatik dolur. Hər ikisini
            əl ilə dəyişə bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Lazımdırsa <strong>Prioritet</strong>i (<HelpKey>Aşağı</HelpKey>, <HelpKey>Orta</HelpKey>,{" "}
            <HelpKey>Yüksək</HelpKey>, <HelpKey>Kritik</HelpKey>) və <strong>Kateqoriya</strong>nı
            (Ümumi, Texniki, Fakturalaşma, Funksiya sorğusu) əl ilə seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçimləriniz açılan siyahılarda dərhal görünür. «Bu müştəri şikayəti / təklifidir» qeyd
            qutusu işarələnsə, Kateqoriya seçimi kilidlənir və avtomatik <strong>Şikayət</strong> olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            İstəyə bağlı olaraq <strong>Şirkət</strong>, <strong>Contact</strong> və{" "}
            <strong>Təyin edilib</strong> (agent) seçin, sonra <strong>Təsvir</strong>də problemi
            ətraflı yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Şirkət, Contact və Təyin edilib açılan siyahıları təşkilatınızın mövcud şirkət, əlaqə və
            istifadəçilərindən dolur; standart olaraq hər biri «— None —» / «— Unassigned —» kimi boş
            qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Aşağıdakı <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Saxlanılır...»a keçir, pəncərə bağlanır və yeni bilet siyahının başında peyda olur.{" "}
            <strong>Cəmi</strong> və <strong>Açıq</strong> kartlarındakı saylar uyğun olaraq artır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: şikayət/təklif kimi qeyd et">
        <HelpStep n={1}>
          <p>
            Yeni bilet formasında <HelpKey>Bu müştəri şikayəti / təklifidir</HelpKey> qeyd qutusunu
            işarələyin. (Bu seçim yalnız bilet yaradılarkən mövcuddur, mövcud biletin redaktəsində yox.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Aşağıda sarı çərçivəli əlavə panel açılır: <strong>Növ</strong> (Şikayət / Təklif),{" "}
            <strong>Risk səviyyəsi</strong> (Aşağı / Orta / Yüksək), <strong>Brend</strong>,{" "}
            <strong>Məhsul kateqoriyası</strong>, <strong>Şikayət obyekti</strong> və{" "}
            <strong>Məsul şöbə</strong> sahələri görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bildiyiniz sahələri doldurub <HelpKey>Yarat</HelpKey> ilə yadda saxlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Panelin altında «İstehsal sahəsi və ikinci obyekt şikayət kartında sonra doldurula bilər»
            ipucusu durur. Bilet yarandıqdan sonra şikayət reyestrinə də əlavə olunur və kateqoriyası
            <strong> Şikayət</strong> kimi qalır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: biletləri filtrlə və axtar">
        <HelpStep n={1}>
          <p>
            Statistika kartlarının altındakı status düymələrindən birini seçin:{" "}
            <HelpKey>Hamısı</HelpKey>, <HelpKey>Yeni</HelpKey>, <HelpKey>Açıq</HelpKey>,{" "}
            <HelpKey>İcrada</HelpKey>, <HelpKey>Gözləyir</HelpKey>, <HelpKey>Həll edildi</HelpKey>,{" "}
            <HelpKey>Bağlı</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər düymənin yanında həmin statusdakı biletlərin sayı mötərizədə yazılır. Yalnız ən azı bir
            bileti olan statuslar göstərilir (<strong>Hamısı</strong> həmişə görünür); seçilən düymə
            vurğulanır və cədvəl yalnız o statusu süzür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Eskalasiya edilmiş biletlər varsa, sol tərəfdə qırmızı{" "}
            <HelpKey>Eskalasiya edilmiş</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bu düymə yalnız eskalasiya səviyyəsi 0-dan böyük açıq bilet olanda görünür və yanında onların
            sayı durur. Basanda cədvəl yalnız eskalasiya olunmuş biletləri göstərir; təkrar basanda söndürülür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Cədvəlin yuxarısındakı axtarış xanasına (<HelpKey>Bilet axtar...</HelpKey>) mövzu üzrə söz
            yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca cədvəl yalnız mövzusu axtarış mətninə uyğun gələn sətirləri saxlayır. Sütun başlığına
            klikləməklə (məs. <strong>Prioritet</strong> və ya <strong>SLA</strong>) sıralaya bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: kanban görünüşünə keç">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı görünüş açarında <HelpKey>Kanban</HelpKey> düyməsini basın (geri qayıtmaq
            üçün <HelpKey>Siyahı</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəlin yerinə üfüqi sürüşən sütunlar gəlir: <strong>Yeni</strong>, <strong>Açıq</strong>,{" "}
            <strong>İcrada</strong>, <strong>Gözləyir</strong> və <strong>Həll edildi</strong>. Hər
            sütunun başlığında həmin statusdakı biletlərin sayı durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstənilən bilet kartına klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart bilet nömrəsini, prioritet nişanını, mövzunu, şirkəti və kiçik SLA göstəricisini əks
            etdirir; klikləyəndə bilet tam açılır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: bileti redaktə et və ya sil">
        <HelpStep n={1}>
          <p>
            Siyahıda bilet sətrinin sonundakı qələm ikonalı (<HelpKey>Redaktə et</HelpKey>) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Bileti redaktə et» başlıqlı, mövcud dəyərlərlə dolu eyni forma açılır. Redaktə rejimində əlavə
            olaraq <strong>Status</strong> açılan siyahısı görünür; dəyişiklikləri edib{" "}
            <HelpKey>Yenilə</HelpKey> ilə təsdiqləyin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bileti silmək üçün sətrin sonundakı qırmızı zibil qutusu ikonalı (<HelpKey>Sil</HelpKey>) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Bileti sil» təsdiq pəncərəsi açılır və biletin mövzusunu göstərir. Təsdiqlədikdən sonra bilet
            siyahıdan çıxır və statistika kartları yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Sürətli iş üçün <strong>Mövzu</strong> sahəsini aydın yazın və sahədən çıxın — Da Vinci
          kateqoriya və prioriteti özü təklif edir, siz isə yalnız lazım olanda düzəliş edirsiniz. SLA
          sütununda sarı vurğu «2 saatdan az qalıb» deməkdir; qırmızı isə artıq pozulub — onları birinci
          götürün.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bileti silmək geri qaytarılmır. Müraciəti sadəcə bağlamaq istəyirsinizsə, silmək yerinə onu
          redaktə edib statusunu <HelpKey>Həll edildi</HelpKey> və ya <HelpKey>Bağlı</HelpKey> edin —
          bilet tarixçəsi qalır. «Bu müştəri şikayəti / təklifidir» yalnız yaradılış mərhələsində seçilə
          bilər; mövcud bileti sonradan bu formadan şikayətə çevirmək mümkün deyil.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün biletlər təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın biletlərini görür, yalnız
          öz şirkət, əlaqə və istifadəçilərinizi seçə bilərsiniz. Yeni gələn biletlərin narıncı vurğusu
          bu brauzerdə yerli olaraq saxlanılır və siz bileti açana qədər qalır.
        </p>
      </HelpCallout>
    </div>
  )
}
