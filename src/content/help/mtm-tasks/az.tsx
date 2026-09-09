"use client"

/**
 * MTM Sahə tapşırıqları — help article (Azerbaijani).
 * Yalnız Route & Field → Sahə tapşırıqları səhifəsini əhatə edir
 * (Kanban / siyahı görünüşləri, statistika kartları, axtarış/çeşidləmə/filtr,
 * tapşırıq yaratma-redaktə forması, status dəyişmə düymələri, silmə).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MtmTasksHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sahə əməliyyatları üzrə supervizor və ya sahə komandasının menecerisiniz"
        goal="Sahə agentlərinə tapşırıqlar vermək, onların gedişatını Kanban lövhəsində izləmək və status üzrə bağlamaq"
      >
        Səhifəyə <HelpKey>Route &amp; Field</HelpKey> → <HelpKey>Sahə tapşırıqları</HelpKey> yolu ilə
        çatırsınız. Bütün tapşırıqlar, agentlər və müştərilər yalnız sizin təşkilatınız üçündür.
        Səhifə açılanda son 200 tapşırıq yüklənir; statistika kartları və Kanban sütunları hamısı
        eyni siyahıdan oxunur, ona görə də tapşırığı dəyişdikcə saylar dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Sahə tapşırıqları</HelpKey> adı yanında mötərizədə cari göstərilən
          tapşırıq sayı, altında «Sahə agentlərinə verilmiş tapşırıqlar» izahı var. Sağ yuxarıda iki
          element durur: görünüş keçidi (yan-yana iki düymə — <strong>kataloq/Kanban</strong> və{" "}
          <strong>siyahı</strong> ikonaları) və <HelpKey>Tapşırıq əlavə et</HelpKey> düyməsi. Altda
          dörd statistika kartı gəlir, sonra axtarış sətri, ən aşağıda isə seçilmiş görünüşə görə ya
          Kanban lövhəsi, ya da cədvəl.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Cəmi tapşırıq">Bütün tapşırıqların ümumi sayı.</HelpDef>
          <HelpDef term="Gözləyən">Status «Gözləyir» olan, hələ başlanmamış tapşırıqlar.</HelpDef>
          <HelpDef term="İcrada">Hazırda icra olunan tapşırıqlar.</HelpDef>
          <HelpDef term="Tamamlanmış">Bağlanmış (tamamlanmış) tapşırıqlar.</HelpDef>
          <HelpDef term="Kanban görünüşü">Tapşırıqları üç sütunda göstərir: Görüləcək, Davam edir, Tamamlandı. Standart görünüş budur.</HelpDef>
          <HelpDef term="Siyahı görünüşü">Eyni tapşırıqları cədvəl şəklində, status filtrləri və çeşidləmə ilə göstərir.</HelpDef>
          <HelpDef term="Prioritet">Tapşırığın təcililiyi: Aşağı, Orta, Yüksək, Təcili — kartda rəngli nişanla göstərilir.</HelpDef>
        </dl>
        <p>
          Kanban kartında tapşırığın başlığı, sağda prioritet nişanı, varsa təsvir, altında agentin
          adı, son tarix və (varsa) müştərinin adı görünür. Kartın aşağısında bir tərəfdə status
          irəliləmə düymələri, digər tərəfdə isə qələm (redaktə) və zibil qutusu (sil) ikonaları olur.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni tapşırıq yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Tapşırıq əlavə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Tapşırıq əlavə et» başlıqlı pəncərə açılır. İçində <strong>Başlıq *</strong> sahəsi, bir
            sətirdə <strong>Agent *</strong> və <strong>Müştəri</strong> açılan siyahıları, növbəti
            sətirdə <strong>Prioritet</strong>, <strong>Status</strong> və <strong>Son tarix</strong>{" "}
            sahələri, ən altda isə <strong>Təsvir</strong> mətn sahəsi var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Başlıq</strong> yazın (məs. «Nöqtənin fasad fotosunu çək») və <strong>Agent</strong>{" "}
            açılan siyahısından bir nümayəndə seçin. Bu iki sahə məcburidir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Agent açılan siyahısında standart olaraq «— Agent seçin —» yazısı durur və təşkilatınızın
            sahə agentləri sadalanır. Məcburi sahələrdən birini boş buraxsanız, brauzer formanı yadda
            saxlamağa qoymur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İstəyə bağlı olaraq <strong>Müştəri</strong> təyin edin, <strong>Prioritet</strong>{" "}
            (Aşağı / Orta / Yüksək / Təcili — standart Orta) və <strong>Status</strong> (standart
            Gözləyir) seçin, <strong>Son tarix</strong> təqvimini doldurun və lazım gəlsə{" "}
            <strong>Təsvir</strong> əlavə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Müştəri açılan siyahısında standart «— Yoxdur —» seçimi var, yəni müştəri vacib deyil. Son
            tarix sahəsi təqvim seçicisi açır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Aşağıdakı <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə saxlanarkən «Saxlanılır...» yazısına keçir, sonra pəncərə bağlanır və yeni tapşırıq
            statusuna uyğun Kanban sütununda peyda olur. Başlıqdakı say və <strong>Cəmi tapşırıq</strong>{" "}
            (və uyğun status) kartı bir vahid artır. Saxlama alınmasa, formanın yuxarısında qırmızı
            xəta mesajı görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Kanban lövhəsində tapşırığı irəlilət">
        <HelpStep n={1}>
          <p>
            Başlanğıcda Kanban görünüşündəsiniz. Üç sütun var: <HelpKey>Görüləcək</HelpKey>,{" "}
            <HelpKey>Davam edir</HelpKey> və <HelpKey>Tamamlandı</HelpKey>. Hər sütunun başlığında
            rəngli nöqtə və o sütundakı tapşırıqların sayı göstərilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tapşırıqlar statuslarına görə sütunlara paylanır və hər sütunda prioritetə görə düzülür.
            Bir sütun boşdursa, içində kəsik xətli çərçivədə «No tasks» yazısı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Tapşırığı növbəti mərhələyə keçirmək üçün kartın aşağısındakı status düyməsini basın:
            «Görüləcək» sütununda <HelpKey>Start →</HelpKey>, «Davam edir» sütununda{" "}
            <HelpKey>Done ✓</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tapşırıq dərhal yeni sütuna keçir, hər iki sütunun say nişanı yenilənir və yuxarıdakı
            statistika kartları (Gözləyən / İcrada / Tamamlanmış) uyğun olaraq dəyişir. Qısa təsdiq
            bildirişi çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Tapşırığı geri qaytarmaq üçün «Davam edir» və ya «Tamamlandı» sütunundakı kartda{" "}
            <HelpKey>← To Do</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tapşırıq yenidən «Görüləcək» sütununa qayıdır və saylar uyğunlaşır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: siyahı görünüşü ilə filtrlə və çeşidlə">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı görünüş keçidində siyahı ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Lövhə cədvələ çevrilir. Sütunlar: <strong>Başlıq</strong>, <strong>Agent</strong>,{" "}
            <strong>Müştəri</strong>, <strong>Prioritet</strong>, <strong>Status</strong>,{" "}
            <strong>Son tarix</strong> və hər sətirdə redaktə/sil ikonaları. Cədvəlin üstündə status
            filtr düymələri (Hamısı, Gözləyir, İcrada, Tamamlanmış, Ləğv edilmiş — hər birində say),
            axtarış sətrinin yanında isə çeşidləmə açılan siyahısı peyda olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Axtarış sətrinə tapşırıq başlığı və ya agent adı yazın; status üzrə daraltmaq üçün filtr
            düymələrindən birini basın; sıralamanı dəyişmək üçün çeşidləmə siyahısından{" "}
            <HelpKey>Son tarix ↓</HelpKey>, <HelpKey>Son tarix ↑</HelpKey>,{" "}
            <HelpKey>Prioritetə görə</HelpKey> və ya <HelpKey>Ada görə</HelpKey> seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl yazdıqca süzülür, başlıqdakı say uyğunlaşır. Filtrə heç nə düşmürsə «Tapşırıq
            tapılmadı», ümumiyyətlə tapşırıq yoxdursa «Hələ tapşırıq yoxdur» mesajı göstərilir.
            Çeşidləmə açılan siyahısı yalnız siyahı görünüşündə görünür (Kanban-da yoxdur).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: tapşırığı redaktə et və ya sil">
        <HelpStep n={1}>
          <p>
            Tapşırığı dəyişmək üçün kartda (Kanban) və ya sətirdə (siyahı) qələm ikonalı{" "}
            <HelpKey>redaktə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Tapşırığı redaktə et» başlıqlı, mövcud başlıq, agent, müştəri, prioritet, status, son
            tarix və təsvir ilə əvvəlcədən doldurulmuş eyni forma açılır. Dəyişiklikləri edib aşağıdakı{" "}
            <HelpKey>Yenilə</HelpKey> düyməsi ilə təsdiqləyin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Tapşırığı silmək üçün qırmızı zibil qutusu ikonalı <HelpKey>sil</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tapşırığın adını göstərən təsdiq pəncərəsi açılır. <HelpKey>Ləğv et</HelpKey> ilə imtina
            edə, qırmızı təsdiq düyməsi ilə silə bilərsiniz; təsdiqlədikdən sonra tapşırıq siyahıdan
            çıxır və saylar yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Status düymələri yalnız bir addım irəli/geri aparır (Görüləcək → Davam edir → Tamamlandı).
          Tapşırığı birbaşa «Ləğv edilmiş» etmək və ya araya bir status atlamaq üçün qələm ikonası ilə
          formanı açıb <strong>Status</strong> sahəsini dəyişin — orada Gözləyir, İcrada, Tamamlandı və
          Ləğv edildi variantları var.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Silmə təsdiq tələb edir, lakin geri qaytarılmır. Tapşırığı yaddaşda saxlamaq, amma aktiv
          saymamaq istəyirsinizsə, silmək yerinə statusunu <strong>Ləğv edildi</strong> edin — onda
          tapşırıq qeydlərdə qalır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün tapşırıqlar, agentlər və müştərilər təşkilatınızla məhdudlaşır — yalnız öz
          tenant-ınızın agentlərinə tapşırıq verə bilərsiniz və başqa təşkilatın tapşırıqlarını
          görmürsünüz. Agent və müştəri açılan siyahıları təşkilatınızın məlumatlarından gəlir.
        </p>
      </HelpCallout>
    </div>
  )
}
