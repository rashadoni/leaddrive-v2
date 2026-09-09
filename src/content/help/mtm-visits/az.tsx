"use client"

/**
 * MTM — Ziyarətlər (Visits) help article (Azerbaijani).
 * Yalnız Route & Field → Ziyarətlər səhifəsini əhatə edir:
 * ziyarət jurnalı (giriş/çıxış), statistika kartları, status
 * filtrləri, axtarış/sıralama, GPS-məsafə nişanı və ziyarət
 * qeyd/redaktə/silmə formaları. Marşrut, foto və
 * digər MTM bölmələri bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mtmvisitsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sahə əməliyyatları meneceri və ya MTM administratorusunuz"
        goal="Agentlərin müştəri nöqtələrinə girib-çıxmasını izləmək, ziyarət müddətini və GPS uyğunluğunu yoxlamaq, lazım olduqda ziyarəti əl ilə qeyd etmək və ya düzəltmək"
      >
        Səhifə <HelpKey>Route & Field</HelpKey> bölməsində <HelpKey>Ziyarətlər</HelpKey> kimi açılır.
        Bütün ziyarətlər yalnız sizin təşkilatınıza aiddir. Adətən girişləri agentlər mobil tətbiqdən
        edir; bu səhifə həmin jurnalı veb-də göstərir və zəruri hallarda əl ilə qeyd/düzəliş imkanı verir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Ziyarətlər</HelpKey> adı (yanında mötərizədə cari süzgəcə düşən ziyarət sayı),
          altında «Ziyarət jurnalı — giriş və çıxışlar» izahı, sağ yuxarıda isə{" "}
          <HelpKey>Ziyarət qeyd et</HelpKey> düyməsi var. Onun altında dörd statistika kartı durur:{" "}
          <strong>Cəmi ziyarət</strong>, <strong>Nöqtədə</strong>, <strong>Tamamlanmış</strong> və{" "}
          <strong>Ort. müddət</strong>. Kartlardan sonra status filtr düymələri, axtarış xanası ilə
          sıralama seçimi, ən sonda isə ziyarət cədvəli gəlir — hələ heç bir ziyarət yoxdursa, cədvəlin
          yerinə boş vəziyyət mətni göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Cəmi ziyarət">Qeydə alınmış bütün ziyarətlərin ümumi sayı.</HelpDef>
          <HelpDef term="Nöqtədə">Hazırda «CHECKED_IN» (giriş olub, çıxış olmayıb) vəziyyətindəki ziyarətlərin sayı.</HelpDef>
          <HelpDef term="Tamamlanmış">«CHECKED_OUT» (həm giriş, həm çıxış olub) vəziyyətindəki ziyarətlərin sayı.</HelpDef>
          <HelpDef term="Ort. müddət">Müddəti olan ziyarətlərin orta davametmə vaxtı, dəqiqələrlə.</HelpDef>
          <HelpDef term="GPS">Girişin koordinatları ilə müştəri nöqtəsinin koordinatları arasındakı məsafə — 100 m-ə qədər yaşıl, daha çox olduqda diqqət ikonalı sarı göstərilir.</HelpDef>
        </dl>
        <p>
          Cədvəlin sütunları: <strong>Agent</strong>, <strong>Müştəri</strong>, <strong>Status</strong>{" "}
          (rəngli nişan — «CHECKED_OUT» yaşıl, «CHECKED_IN» mavi), <strong>Giriş</strong>,{" "}
          <strong>Çıxış</strong> (yoxdursa «—»), <strong>Müddət</strong> (dəqiqələrlə, yoxdursa «—»),{" "}
          <strong>GPS</strong> məsafə nişanı və hər sətrin sağında iki əməliyyat düyməsi — redaktə (qələm
          ikonası) və sil (qırmızı zibil qutusu ikonası).
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: ziyarətləri süzgəcdən keçir və axtar">
        <HelpStep n={1}>
          <p>
            Status düymələrindən birini basın: <HelpKey>Hamısı</HelpKey>, <HelpKey>Nöqtədə</HelpKey> və ya{" "}
            <HelpKey>Tamamlanmış</HelpKey>. Hər düymənin yanında mötərizədə həmin statusdakı ziyarət sayı yazılıb.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş düymə dolu (vurğulanmış) görünür, cədvəl yalnız həmin statusdakı ziyarətləri göstərir.
            Başlıqdakı mötərizədə olan say da süzülmüş sıraya uyğunlaşır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Axtarış xanasına (<HelpKey>Ziyarətləri axtar...</HelpKey>) agentin və ya müştərinin adından bir
            hissə yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl yazdıqca anında daralır — yalnız agent adı və ya müştəri adı uyğun gələn sətirlər qalır.
            Heç nə uyğun gəlmirsə, cədvəlin yerinə «Ziyarət tapılmadı» mətni çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sağdakı sıralama siyahısından nizam seçin: <HelpKey>Əvvəlcə yeni</HelpKey>,{" "}
            <HelpKey>Əvvəlcə köhnə</HelpKey> və ya <HelpKey>Müddətə görə ↓</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sətirlərin sırası dərhal yenidən düzülür: tarixə görə (giriş vaxtına əsasən) və ya ən uzun
            ziyarətlər yuxarıda.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: ziyarəti əl ilə qeyd et">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Ziyarət qeyd et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Ziyarət qeyd et» başlıqlı pəncərə açılır. İçində yan-yana <strong>Agent *</strong> və{" "}
            <strong>Müştəri *</strong> açılan siyahıları, altında yan-yana <strong>Enlik</strong> və{" "}
            <strong>Uzunluq</strong> sahələri, ən sonda isə <strong>Qeydlər</strong> mətn sahəsi var.
            (Status seçimi yalnız mövcud ziyarəti redaktə edəndə görünür.)
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Agent</strong> açılan siyahısından nümayəndəni və <strong>Müştəri</strong> açılan
            siyahısından nöqtəni seçin — hər ikisi məcburidir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahılar standart olaraq «— Agent seçin —» və «— Müştəri seçin —» yazısı ilə gəlir və
            təşkilatınızın agentləri ilə müştəriləri ilə dolur. Hər ikisini seçmədən yadda saxlamaq mümkün deyil.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İstəyə bağlı olaraq <strong>Enlik</strong> və <strong>Uzunluq</strong> koordinatlarını və bir
            <strong>Qeyd</strong> daxil edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Enlik və uzunluq sahələri yalnız rəqəm qəbul edir (onluq kəsr daxil). Bu koordinatlar girişin yeri
            kimi saxlanılır və sonradan cədvəldəki <strong>GPS</strong> məsafə nişanını hesablamaq üçün istifadə olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Aşağıdakı <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yadda saxlanarkən «Saxlanılır...» yazısına keçir, sonra pəncərə bağlanır və yeni ziyarət
            cədvəlin yuxarısında peyda olur. <strong>Cəmi ziyarət</strong> kartındakı say bir vahid artır.
            Sahə doldurulmasa və ya server xəta qaytarsa, pəncərənin yuxarısında qırmızı xəta mesajı görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: ziyarəti redaktə et və ya sil">
        <HelpStep n={1}>
          <p>
            Ziyarəti dəyişmək üçün həmin sətirdəki qələm ikonalı (<HelpKey>Redaktə et</HelpKey>) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Ziyarəti redaktə et» başlıqlı, mövcud agent, müştəri, koordinat və qeydlərlə əvvəlcədən
            doldurulmuş eyni forma açılır. Yalnız redaktə rejimində əlavə bir <strong>Status</strong> açılan
            siyahısı çıxır — onunla ziyarəti <HelpKey>Nöqtədə</HelpKey> və ya <HelpKey>Tamamlanmış</HelpKey>{" "}
            kimi qeyd edə bilərsiniz. Dəyişikliyi <HelpKey>Yenilə</HelpKey> ilə təsdiqləyin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Ziyarəti silmək üçün sətirdəki qırmızı zibil qutusu ikonalı (<HelpKey>Sil</HelpKey>) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Ziyarəti sil» başlıqlı təsdiq pəncərəsi açılır və silinəcək ziyarətin müştəri adını qeyd edir.{" "}
            <HelpKey>Sil</HelpKey> ilə təsdiqlədikdən sonra ziyarət cədvəldən çıxır və statistika kartları
            yenilənir; əməliyyat alınmasa, pəncərədə qırmızı xəta mesajı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmə geri qaytarılmır — ziyarət jurnalından həmişəlik çıxır. Yanlış status və ya koordinatları
            sadəcə düzəltmək istəyirsinizsə, silmək yerinə <HelpKey>Redaktə et</HelpKey> ilə dəyişin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <strong>GPS</strong> nişanı işıqfor kimi işləyir: 100 metrə qədərki məsafə yaşıl (giriş müştəri
          nöqtəsində baş verib), daha böyük məsafə isə diqqət ikonası ilə sarı göstərilir. Nişan yalnız həm
          girişin, həm də müştərinin koordinatları məlum olduqda görünür — yoxdursa «—» qalır. Sarı nişanlar
          adətən saxta və ya nöqtədən kənar girişləri tutmağa kömək edir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün ziyarətlər, agent və müştəri siyahıları təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın
          ziyarətlərini görür, yalnız öz agentlərinizi və müştərilərinizi seçə bilirsiniz. Başqa təşkilatın
          ziyarət jurnalı sizə görünmür.
        </p>
      </HelpCallout>
    </div>
  )
}
