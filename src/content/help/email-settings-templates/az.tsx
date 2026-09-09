"use client"

/**
 * Email şablonları — help article (Azerbaijani).
 * Tənzimləmələr → Email şablonları səhifəsini əhatə edir:
 * şablon siyahısı, statistika kartları, şablon yaratma/redaktə forması
 * (HTML və Vizual redaktor, bloklar, formatlama paneli, dəyişənlər) və silmə.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function emailsettingstemplatesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq və ya əməliyyat administratorusunuz"
        goal="Kampaniyalar və bildirişlər üçün təkrar istifadə olunan email şablonları yaratmaq və idarə etmək — dəyişənlərlə fərdiləşdirilən, dilə görə bölünən"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Email şablonları</HelpKey> yolu ilə
        çatırsınız. Bütün şablonlar yalnız sizin təşkilatınız üçündür. Statistika kartları, cədvəl
        və axtarış — hamısı eyni şablon siyahısından oxunur, ona görə şablon əlavə edib silmək
        statistikanı dərhal yeniləyir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Email şablonları</HelpKey> adı, altında «Kampaniyalar üçün çoxdəfəli
          email şablonları yaradın» izahı və bir sətirlik «Sistem bildirişləri üçün standart e-poçt
          şablonlarını konfiqurasiya edin» qeydi var. Sağ yuxarıda <HelpKey>Yeni şablon</HelpKey>{" "}
          düyməsi durur. Altda üç statistika kartı gəlir: <strong>Cəmi şablonlar</strong>,{" "}
          <strong>Dillər</strong> və <strong>Kateqoriyalar</strong>. Onların altında şablon cədvəli
          və yuxarısında «Şablon axtar...» qutusu var.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Cəmi şablonlar">Yaratdığınız bütün email şablonlarının ümumi sayı.</HelpDef>
          <HelpDef term="Dillər">Şablonlarda istifadə olunan fərqli dillərin sayı (EN, RU, AZ).</HelpDef>
          <HelpDef term="Kateqoriyalar">Şablonlarda istifadə olunan fərqli kateqoriyaların sayı.</HelpDef>
          <HelpDef term="Şablon">Adı, mövzusu, məzmunu, kateqoriyası və dili olan təkrar istifadə üçün email qaralaması.</HelpDef>
          <HelpDef term="Dəyişən">{`Mətnə qoyduğunuz {{client_name}} kimi yer-tutucu — göndərildikdə real müştəri məlumatı ilə əvəzlənir.`}</HelpDef>
          <HelpDef term="Kateqoriya">Şablonun məqsəd təsnifatı: Ümumi, Xoş gəldiniz, Onboarding, Bildiriş, Marketinq, Təkrar əlaqə, Təklif.</HelpDef>
        </dl>
        <p>
          Cədvəldə hər sətir bir şablondur. Sütunlar: <strong>Ad</strong> (qalın adın altında boz
          rəngdə mövzu), <strong>Kateqoriya</strong> (nişan kimi), <strong>Dil</strong> (EN / RU / AZ),{" "}
          <strong>Yaradılıb</strong> (tarix) və sağda iki əməliyyat düyməsi: qələm ikonası (redaktə)
          və qırmızı zibil qutusu ikonası (sil). Cədvəl səhifələnir (hər səhifədə 10 sətir).
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni şablon yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni şablon</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Demək olar bütün ekranı tutan böyük pəncərə açılır. Başlığında «Yeni şablon» yazır,
            yuxarıda <strong>Ad</strong>, <strong>Kateqoriya</strong>, <strong>Mövzu</strong> və{" "}
            <strong>Dil</strong> sahələri bir sırada durur. Altda redaktor hissəsi gəlir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Ad</strong> və <strong>Mövzu</strong> yazın — bunlar məcburidir. Ad daxili
            istinad üçündür, mövzu isə alıcının görəcəyi email başlığıdır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca mətn sahələrdə görünür. Ad və ya mövzu boş ikən yadda saxlamağa çalışsanız,
            redaktorun üstündə qırmızı «Ad və mövzu tələb olunur» xəbərdarlığı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Kateqoriya</strong> açılan siyahısından bir seçim edin (Ümumi, Xoş gəldiniz,
            Onboarding, Bildiriş, Marketinq, Təkrar əlaqə, Təklif) və <strong>Dil</strong> seçin
            (🇷🇺 RU, 🇦🇿 AZ, 🇬🇧 EN).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Standart olaraq kateqoriya «Ümumi», dil isə RU gəlir. Seçim cədvəldəki uyğun sütunlara
            və <strong>Kateqoriyalar</strong> / <strong>Dillər</strong> statistikasına təsir edir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <HelpKey>Məzmun</HelpKey> hissəsində redaktor növünü seçin: <HelpKey>✏️ HTML</HelpKey>{" "}
            (standart, formatlama paneli ilə) və ya <HelpKey>🎨 Visual</HelpKey> (sürüklə-burax
            vizual redaktor).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            HTML rejimində formatlama paneli, blok palitrası və <strong>Redaktor</strong> /{" "}
            <strong>Baxış</strong> / <strong>Split</strong> tabları görünür. Visual rejimə ilk dəfə
            keçəndə hazır şablon seçmək üçün «Şablon kitabxanası» açılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            HTML rejimində mətni yazmağa başlayın. Yuxarıdakı blok palitrasından (<HelpKey>🧱 Bloklar</HelpKey>)
            hazır bloka klikləyin — o, kursorun olduğu yerə əlavə olunur (Hero / Başlıq, Mətn bloku,
            CTA düyməsi və s.). Formatlama panelindəki düymələrlə (qalın, kursiv, ölçü, rəng, sıralama,
            keçid, şəkil) mətni tərtib edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Boş kanvas «Şablon mətnini yazmağa başlayın...» yer-tutucusu göstərir. Blok kliklədikcə
            hazır tərtibatlı parça kanvasa düşür və orada birbaşa redaktə oluna bilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Fərdiləşdirmə üçün <HelpKey>Müştəri məlumatları</HelpKey> sətrindən dəyişən düyməsini
            basın (məs. 👤 Müştəri adı, 📧 Müştəri emaili, 🏢 Şirkət, 📅 Tarix). Düymə mətnə{" "}
            <HelpKey>{`{{client_name}}`}</HelpKey> kimi etiket qoyur.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Etiket kursorun olduğu yerə daxil olur. <strong>Baxış</strong> tabına keçdikdə bu
            dəyişənlər nümunə dəyərlərlə (məs. «İvan İvanov») sarı fonla işıqlanır ki, alıcının nə
            görəcəyini təsəvvür edəsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={7}>
          <p>
            Aşağıda sağdakı <HelpKey>Saxla</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> və ya sağ yuxarıdakı × ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə saxlanarkən «Saxlanılır...» yazısına keçir, sonra pəncərə bağlanır və yeni şablon
            cədvəldə peyda olur. <strong>Cəmi şablonlar</strong> kartındakı say bir vahid artır;
            yeni dil və ya kateqoriya əlavə olunubsa, uyğun kartlar da yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: şablonu redaktə et və ya sil">
        <HelpStep n={1}>
          <p>
            Şablonu dəyişmək üçün onun sətrindəki qələm ikonalı düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Başlığında «Şablonu redaktə et» yazan eyni pəncərə açılır — ad, mövzu, kateqoriya, dil və
            məzmun mövcud dəyərlərlə əvvəlcədən doldurulur. Yuxarıda sağda <strong>Aktiv</strong> /{" "}
            <strong>Qeyri-aktiv</strong> keçidi də görünür. Dəyişiklikləri edib{" "}
            <HelpKey>Saxla</HelpKey> ilə təsdiqləyin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Cədvəldə tez axtarmaq üçün üstdəki «Şablon axtar...» qutusuna ad yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl yazdıqca süzülür və yalnız adı uyğun gələn şablonları göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Şablonu silmək üçün onun sətrindəki qırmızı zibil qutusu ikonalı düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Şablonu sil» təsdiq pəncərəsi açılır və silinəcək şablonun adını göstərir. Təsdiqlədikdən
            sonra şablon cədvəldən çıxır və statistika kartları yenilənir. Silmə alınmasa, qırmızı
            xəta mesajı göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmə geri qaytarılmır. Şablonu sonra bərpa etmək olmur — kampaniya və ya bildiriş hələ
            ona istinad edirsə, əvvəlcə həmin istifadəni dəyişin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Dəyişənlər şablonu təkrar istifadəyə yararlı edir: bir dəfə{" "}
          <HelpKey>{`{{client_name}}`}</HelpKey> qoyursunuz, hər göndərişdə avtomatik real adla
          dolur. Göndərməzdən əvvəl <strong>Baxış</strong> tabında nümunə dəyərlərlə yoxlayın ki,
          boş və ya yanlış etiket qalmasın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün şablonlar təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın şablonlarını
          görürsünüz, redaktə və silə bilirsiniz. Başqa təşkilatın şablonları sizə görünmür.
        </p>
      </HelpCallout>
    </div>
  )
}
