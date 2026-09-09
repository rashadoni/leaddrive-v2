"use client"

/**
 * Project detail — help article (Azerbaijani).
 * Layihə kartı səhifəsini (/projects/[id]) əhatə edir: başlıq + status/prioritet
 * nişanları, sol panel (icmal göstəriciləri), 6 tab (İcmal · Tapşırıqlar ·
 * CRM aktivliyi · İştirakçılar · Mərhələlər · Büdcə) və redaktə/silmə düymələri.
 * Əsas iş axını: tapşırıqları, mərhələləri və komandanı idarə etmək.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ProjectDetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Layihə meneceri və ya komanda üzvüsünüz"
        goal="Bir layihənin gedişatını izləmək — tapşırıqları, mərhələləri, komandanı və büdcəni bir ekranda idarə etmək"
      >
        Bu səhifəyə <HelpKey>Layihələr</HelpKey> siyahısından hər hansı layihənin adına klikləməklə
        çatırsınız. Bütün məlumatlar yalnız sizin təşkilatınıza aiddir. Səhifə açılanda yuxarıda
        layihənin adı, statusu və prioriteti, solda icmal paneli, sağda isə tablar görünür. Burada
        etdiyiniz hər dəyişiklik (tapşırıq əlavə etmək, mərhələni bitirmək, üzv qoşmaq) layihənin
        <strong> tamamlanma faizinə</strong> təsir edir və göstəricilər dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarı sol küncdə geri qayıtmaq üçün ox düyməsi (<HelpKey>Layihələrə qayıt</HelpKey>), yanında
          rəngli nöqtə və layihənin adı durur. Adın yanında iki nişan var: <strong>status</strong>{" "}
          (Planlaşdırma / Aktiv / Gözləmədə / Tamamlanıb / Ləğv edilib) və <strong>prioritet</strong>{" "}
          (Aşağı / Orta / Yüksək / Kritik). Varsa, altında layihə kodu, təsviri və teqlər göstərilir.
          Sağ yuxarıda <HelpKey>Redaktə et</HelpKey> və <HelpKey>Sil</HelpKey> düymələri var.
        </p>
        <p>
          Aşağıda səhifə iki sütuna bölünür. Solda <strong>icmal paneli</strong> durur: tamamlanma
          zolağı və faizi, gecikibsə qırmızı «Overdue» xəbərdarlığı, sonra status, prioritet, menecer,
          şirkət, başlanğıc/bitmə tarixləri, büdcə, faktiki xərc və yaradılma tarixi. Sağda altı tabdan
          ibarət bölmə var.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="İcmal">Göstərici kartları, tapşırıqların statusa görə bölgüsü, büdcə xülasəsi və mərhələ zaman xətti.</HelpDef>
          <HelpDef term="Tapşırıqlar">Layihənin öz tapşırıq siyahısı — Siyahı və ya Kanban görünüşündə, status/mərhələ/icraçı filtrləri ilə. Mötərizədə say göstərilir.</HelpDef>
          <HelpDef term="CRM aktivliyi">CRM tərəfindən bu layihəyə bağlanmış tapşırıqlar (Açıq və Tamamlanmış kimi qruplaşdırılır); kliklədikdə həmin tapşırığa keçirsiniz.</HelpDef>
          <HelpDef term="İştirakçılar">Layihə komandası — rol (Menecer / İştirakçı / Baxıcı), işlənmiş saatlar, saatlıq dərəcə və qoşulma tarixi. Mötərizədə say göstərilir.</HelpDef>
          <HelpDef term="Mərhələlər">Layihənin etapları (milestone) — son tarix, rəng və tapşırıqlara görə irəliləyiş. Mötərizədə say göstərilir.</HelpDef>
          <HelpDef term="Büdcə">Büdcə, faktiki xərc, qalan vəsait, istifadə zolağı və saatlıq dərəcəsi olan üzvlərin xərc cədvəli.</HelpDef>
        </dl>
        <p>
          Hər tabın başlığında say mötərizədə göstərilir (məs. <HelpKey>Tapşırıqlar (8)</HelpKey>),
          ona görə tabı açmadan da nə qədər element olduğunu görürsünüz.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: tapşırıq əlavə et və idarə et">
        <HelpStep n={1}>
          <p>
            Sağdakı tablardan <HelpKey>Tapşırıqlar</HelpKey> tabını açın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yuxarıda <HelpKey>List</HelpKey> / <HelpKey>Kanban</HelpKey> görünüş keçidi, yanında status,
            mərhələ və icraçı üzrə açılan filtrlər, sağda isə <HelpKey>Tapşırıq əlavə et</HelpKey> düyməsi
            görünür. Tapşırıq yoxdursa, mərkəzdə «Tapşırıq tapılmadı» mətni durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Tapşırıq əlavə et</HelpKey> düyməsini basın və açılan formada <strong>Ad</strong>{" "}
            yazın (məcburidir). İstəyə bağlı olaraq status, prioritet, icraçı, mərhələ, son tarix və
            təxmini saatları seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahının üstündə forma açılır: ad sahəsi, dörd açılan siyahı (status, prioritet, təyin
            edilib, mərhələ), tarix seçici və «Təxmini saatlar» sahəsi. Ad boş olduqda{" "}
            <HelpKey>Yarat</HelpKey> düyməsi qeyri-aktiv qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Yarat</HelpKey> düyməsini basın. Mövcud tapşırığı dəyişmək üçün onun sətrindəki
            qələm ikonasını, silmək üçün zibil qutusu ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yeni tapşırıq cədvəldə peyda olur (ad, status, prioritet, icraçı, son tarix, mərhələ
            sütunları ilə). Tapşırıq sayı tab başlığında və <HelpKey>İcmal</HelpKey> tabındakı
            göstəricilərdə yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Görünüşü <HelpKey>Kanban</HelpKey>-a keçirin — tapşırıqları sütunlar arasında sürüşdürərək
            statusunu dəyişin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Dörd sütun çıxır: <strong>Ediləcək</strong>, <strong>Davam edir</strong>,{" "}
            <strong>Yoxlama</strong>, <strong>Bitib</strong>. Kartı tutub başqa sütuna buraxanda onun
            statusu avtomatik yenilənir və sütun saylarına əks olunur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: mərhələ (milestone) yarat">
        <HelpStep n={1}>
          <p>
            <HelpKey>Mərhələlər</HelpKey> tabını açın və sağ yuxarıdakı{" "}
            <HelpKey>Mərhələ əlavə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Forma açılır: <strong>Ad</strong> sahəsi, son tarix seçici və rəng seçici (standart
            bənövşəyi, kodu yanında göstərilir). Hələ mərhələ yoxdursa, bundan əvvəl «Hələ mərhələ
            yoxdur» mətni görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Adı yazın, lazım olsa son tarix və rəng seçin, sonra <HelpKey>Yarat</HelpKey> düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mərhələ kart kimi siyahıya əlavə olunur — sol kənarı seçdiyiniz rəngdə, altında son tarix,
            «X/Y tapşırıq» sayı, status nişanı və irəliləyiş zolağı ilə. İrəliləyiş həmin mərhələyə
            bağlı tamamlanmış tapşırıqlara görə hesablanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Tapşırıqları mərhələyə bağlamaq üçün <HelpKey>Tapşırıqlar</HelpKey> tabında tapşırığı
            redaktə edin və «Mərhələ» açılan siyahısından bu mərhələni seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tapşırığın <strong>Mərhələ</strong> sütununda mərhələ adı və rəngli nöqtə görünür; mərhələ
            kartındakı «X/Y tapşırıq» sayı və irəliləyiş zolağı uyğun olaraq yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: komandaya üzv əlavə et">
        <HelpStep n={1}>
          <p>
            <HelpKey>İştirakçılar</HelpKey> tabını açın və sağ yuxarıdakı{" "}
            <HelpKey>İştirakçı əlavə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İki açılan siyahılı forma açılır: birincidən istifadəçi (artıq üzv OLMAYANLAR sadalanır),
            ikincidən rol — <strong>Menecer</strong>, <strong>İştirakçı</strong> və ya{" "}
            <strong>Baxıcı</strong> seçilir. Hələ üzv yoxdursa, «Hələ üzv yoxdur» mətni görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstifadəçini və rolu seçin, sonra <HelpKey>Yarat</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Üzv cədvələ əlavə olunur: ad baş hərfli avatar, rol (rəngli nöqtə + dəyişdirilə bilən
            açılan siyahı), işlənmiş saatlar (varsa saatlıq dərəcə ilə) və qoşulma tarixi sütunları ilə.
            <HelpKey>İştirakçılar</HelpKey> tab başlığındakı say bir vahid artır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Üzvün rolunu dəyişmək üçün onun sətrindəki rol açılan siyahısından yeni rol seçin; üzvü
            çıxarmaq üçün sətrin sonundakı zibil qutusu ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Rol dərhal yenilənir. Çıxarılan üzv cədvəldən yox olur və <HelpKey>İştirakçı əlavə et</HelpKey>{" "}
            formasındakı açılan siyahıda yenidən mövcud olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: büdcə və icmalı oxu">
        <HelpStep n={1}>
          <p>
            <HelpKey>İcmal</HelpKey> tabını açın — layihənin ümumi vəziyyətinə baxış üçün.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yuxarıda dörd göstərici kartı: <strong>Tapşırıqlar</strong>, <strong>İştirakçılar</strong>,{" "}
            <strong>Mərhələlər</strong> və <strong>Tamamlanma</strong>. Altında tapşırıqların statusa
            görə bölgüsü (Ediləcək / Davam edir / Yoxlama / Bitib), büdcə xülasəsi və mərhələ zaman xətti
            (mərhələ varsa) görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Maliyyə təfərrüatları üçün <HelpKey>Büdcə</HelpKey> tabını açın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Üç kart: <strong>Büdcə</strong>, <strong>Faktiki xərc</strong> və qalan büdcə. Altında
            rəngli istifadə zolağı (90%-dən çox qırmızı, 70%-dən çox sarı, qalanı yaşıl) və «X% used»
            yazısı durur. Saatlıq dərəcəsi olan üzvlər varsa, onların saat × dərəcə = xərc cədvəli və
            <strong> Cəmi</strong> sətri göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: layihəni redaktə et və ya sil">
        <HelpStep n={1}>
          <p>
            Layihənin əsas məlumatlarını dəyişmək üçün sağ yuxarıdakı <HelpKey>Redaktə et</HelpKey>{" "}
            (qələm ikonası) düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Layihəni redaktə et» pəncərəsi mövcud dəyərlərlə əvvəlcədən doldurulmuş açılır: ad, təsvir,
            status, prioritet, başlanğıc/bitmə tarixi, menecer, şirkət, sövdələşmə (deal), valyuta,
            büdcə, rəng və teqlər. Dəyişiklikləri edib <HelpKey>Saxla</HelpKey> ilə təsdiqləyin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Layihəni silmək üçün <HelpKey>Sil</HelpKey> (qırmızı zibil qutusu ikonası) düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Layihənin adı ilə birlikdə təsdiq pəncərəsi açılır. Təsdiqlədikdən sonra layihə silinir və
            sizi <HelpKey>Layihələr</HelpKey> siyahısına qaytarır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmə geri qaytarılmır — layihə ilə birlikdə onun tapşırıqları, mərhələləri və üzv
            təyinatları da gedir. Layihəni sadəcə müvəqqəti dayandırmaq istəyirsinizsə, silmək yerinə{" "}
            <HelpKey>Redaktə et</HelpKey> ilə statusu <strong>Gözləmədə</strong> və ya{" "}
            <strong>Ləğv edilib</strong> edin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <strong>Tapşırıqlar</strong> tabı layihənin öz tapşırıq siyahısıdır;{" "}
          <strong>CRM aktivliyi</strong> tabı isə CRM tərəfindən (/tasks səhifəsindən) bu layihəyə
          bağlanmış tapşırıqları göstərir. Hər ikisi tamamlanma faizinə təsir edir. Bağlı CRM tapşırığı
          yoxdursa, tabda «Bu layihəyə hələ bağlı CRM tapşırığı yoxdur» mətni görünür.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün layihə məlumatları, tapşırıqlar, üzvlər və büdcə təşkilatınızla məhdudlaşır — yalnız öz
          tenant-ınızın istifadəçilərini üzv kimi əlavə edə bilərsiniz və başqa təşkilatın layihələrini
          görmürsünüz. Üzv və menecer açılan siyahıları təşkilatınızın istifadəçilərindən gəlir.
        </p>
      </HelpCallout>
    </div>
  )
}
