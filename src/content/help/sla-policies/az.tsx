"use client"

/**
 * SLA Policies — help article (Azerbaijani).
 * Yalnız Tənzimləmələr → SLA Siyasətləri səhifəsini əhatə edir
 * (siyasət siyahısı / cədvəl, yeni siyasət yaratma, cavab və həll
 * müddəti hədəfləri, prioritet, yalnız iş saatları, aktiv/qeyri-aktiv,
 * redaktə və silmə). Biletlərin özü bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SlaPoliciesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dəstək rəhbəri və ya əməliyyat administratorusunuz"
        goal="Biletlər üçün cavab və həll müddəti hədəfləri qoyub onları prioritetə görə bölmək"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>SLA Siyasətləri</HelpKey> yolu ilə
        çatırsınız. Bütün siyasətlər yalnız sizin təşkilatınız üçündür. Hər siyasət bir prioritet
        səviyyəsi (kritik, yüksək, orta, aşağı) üçün iki hədəf saxlayır: komandanın <strong>ilk cavab
        verməsi</strong> üçün vaxt və biletin <strong>tam həll olunması</strong> üçün vaxt.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda saat ikonası ilə <HelpKey>SLA Siyasətləri</HelpKey> adı, altında «Cavab və həll
          müddəti hədəfləri» izahı və «SLA siyasətləri: biletlər üçün cavab və həll vaxtı hədəflərini
          müəyyən edin» ipucusu var. Sağ yuxarıda <HelpKey>Əlavə et Policy</HelpKey> düyməsi durur.
          Altda <HelpKey>SLA Siyasətləri</HelpKey> başlıqlı kart gəlir və onun içində siyasətlər
          cədvəli yerləşir. Hələ heç bir siyasət yoxdursa, cədvəlin yerində «Məlumat yoxdur» sətri
          görünür.
        </p>
        <p>
          Cədvəlin üstündə axtarış sahəsi (<HelpKey>Axtar...</HelpKey>) və nəticə sayğacı var; axtarış
          siyasət adına görə süzür. Cədvəlin sütunları:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Siyasət adı">Siyasətin adı (məs. «Kritik SLA»).</HelpDef>
          <HelpDef term="Prioritet">Rəngli nişan — <strong>Kritik</strong> (qırmızı), <strong>Yüksək</strong> (narıncı), <strong>Orta</strong> (sarı), <strong>Aşağı</strong> (yaşıl). Bu siyasətin hansı prioritetli biletlərə aid olduğunu göstərir.</HelpDef>
          <HelpDef term="İlk cavab">Komandanın biletə ilk dəfə cavab verməsi üçün hədəf vaxt, «4s 30d» formatında (saat və dəqiqə).</HelpDef>
          <HelpDef term="Həll">Biletin tam bağlanması üçün hədəf vaxt, eyni «saat dəqiqə» formatında.</HelpDef>
          <HelpDef term="İş saatları">«Bəli» olarsa, hədəf yalnız iş saatları sayılır; «Xeyr» olarsa, vaxt fasiləsiz (24/7) sayılır.</HelpDef>
          <HelpDef term="Status">Siyasətin <strong>Aktiv</strong> (mavi nişan) və ya <strong>Qeyri-aktiv</strong> (boz nişan) olması.</HelpDef>
        </dl>
        <p>
          Hər sətrin sonunda iki əməliyyat düyməsi var: qələm ikonası (<HelpKey>Redaktə et</HelpKey>)
          və qırmızı zibil qutusu ikonası (<HelpKey>Sil</HelpKey>). Sütun başlıqlarına basıb cədvəli
          sıralaya bilərsiniz; aşağıda səhifə ölçüsü düymələri (20 / 50 / 100 / Hamısı) durur.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni SLA siyasəti yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Əlavə et Policy</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni SLA siyasəti» başlıqlı pəncərə açılır. İçində bu sahələr olur: <strong>Siyasət adı *</strong>,{" "}
            <strong>Prioritet</strong> açılan siyahısı, <strong>Cavab müddəti (saat) *</strong> və{" "}
            <strong>Həll müddəti (saat) *</strong> üçün hər birində <em>s</em> (saat) və <em>d</em> (dəqiqə)
            xanaları, həmçinin <strong>Yalnız iş saatları</strong> və <strong>Aktiv</strong> qeyd qutuları.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Siyasət adı</strong> yazın — bu yeganə mətn sahəsidir və məcburidir (xanada nümunə
            kimi «Critical SLA» göstərilir).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca mətn xanada görünür. Ad sahəsi məcburidir, ona görə boş buraxsanız brauzer onu
            doldurmağı tələb edir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Prioritet</strong> seçin — <HelpKey>Kritik</HelpKey>, <HelpKey>Yüksək</HelpKey>,{" "}
            <HelpKey>Orta</HelpKey> və ya <HelpKey>Aşağı</HelpKey> (standart olaraq <strong>Orta</strong>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahı seçdiyiniz dəyəri göstərir. Bu dəyər sonradan cədvəldə rəngli prioritet
            nişanı kimi əks olunacaq.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <strong>Cavab müddəti (saat)</strong> qoyun: <em>s</em> xanasına saat, <em>d</em> xanasına
            dəqiqə (standart 4 saat 0 dəqiqə). Eyni qaydada <strong>Həll müddəti (saat)</strong>
            xanalarını doldurun (standart 24 saat 0 dəqiqə).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər iki sahə yalnız rəqəm qəbul edir; dəqiqə xanası 0–59 ilə məhdudlaşır. Hər iki hədəf üçün
            ən azı 1 dəqiqə tələb olunur — saat və dəqiqə birlikdə sıfır qalsa, yadda saxlayanda yuxarıda
            qırmızı «Minimum 1 minute — set hours and/or minutes.» xəbərdarlığı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            İstəyə görə <HelpKey>Yalnız iş saatları</HelpKey> qutusunu işarələyin (standart olaraq
            işarələnmiş) və <HelpKey>Aktiv</HelpKey> qutusunu lazım gəldikdə açıb-bağlayın (standart
            olaraq işarələnmiş).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yalnız iş saatları» işarələnəndə hədəf yalnız iş saatlarına görə hesablanır. «Aktiv»
            işarəsini götürsəniz, siyasət cədvəldə <strong>Qeyri-aktiv</strong> kimi görünəcək.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Aşağıdakı <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yadda saxlanarkən <strong>Saxlanılır...</strong> yazısına keçir, sonra pəncərə bağlanır
            və yeni siyasət cədvəldə peyda olur — adı, rəngli prioritet nişanı, «saat dəqiqə» formatında
            iki hədəfi, iş saatları üçün Bəli/Xeyr və status nişanı ilə.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: siyasəti redaktə et və ya sil">
        <HelpStep n={1}>
          <p>
            Siyasəti dəyişmək üçün onun sətrindəki qələm ikonalı (<HelpKey>Redaktə et</HelpKey>) düyməni
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «SLA siyasətini redaktə et» başlıqlı, mövcud ad, prioritet, hədəflər, iş saatları və status
            ilə əvvəlcədən doldurulmuş eyni forma açılır. Dəyişiklikləri edib aşağıdakı{" "}
            <HelpKey>Yenilə</HelpKey> düyməsi ilə təsdiqləyin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Siyasəti silmək üçün onun sətrindəki qırmızı zibil qutusu ikonalı (<HelpKey>Sil</HelpKey>)
            düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Sil SLA Policy» başlıqlı təsdiq pəncərəsi açılır və «Bu əməliyyat geri qaytarıla bilməz.
            &lt;siyasət adı&gt; həmişəlik silinəcək.» mesajını göstərir. <HelpKey>Sil</HelpKey> ilə
            təsdiqlədikdən sonra siyasət cədvəldən çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmə geri qaytarılmır. Siyasəti müvəqqəti söndürmək istəyirsinizsə, silmək yerinə onu
            redaktə edib <HelpKey>Aktiv</HelpKey> qutusunun işarəsini götürün — bu zaman siyasət qalır,
            sadəcə cədvəldə <strong>Qeyri-aktiv</strong> kimi göstərilir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Adətən hər prioritet üçün bir siyasət qurulur: kritik biletlərə qısa cavab/həll hədəfi, aşağı
          prioritetli biletlərə daha geniş. «Yalnız iş saatları» seçimi gecə və həftəsonu vaxtının hədəfə
          sayılmamasını təmin edir — 24/7 dəstək vəd etmirsinizsə, bunu işarəli saxlayın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün SLA siyasətləri təşkilatınızla məhdudlaşır — başqa təşkilatın siyasətlərini görmür və
          dəyişdirə bilmirsiniz. Cədvəl və forma yalnız öz tenant-ınızın məlumatları ilə işləyir.
        </p>
      </HelpCallout>
    </div>
  )
}
