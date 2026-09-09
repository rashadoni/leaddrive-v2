"use client"

/**
 * Energy & Utilities → Xidmət Çağırışları — help article (Azerbaijani).
 * Energy & Utilities vertikalının ümumi məqaləsindən ayrılıb: yalnız
 * /energy/service-calls səhifəsini əhatə edir (çağırış siyahısı / cədvəl,
 * dörd statistika kartı, status filtri, çağırış nömrəsi axtarışı,
 * yenilə və daha çox yüklə). Səhifə YALNIZ oxu üçündür — burada yeni
 * çağırış yaratma və ya redaktə forması YOXDUR.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function energyservicecallsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Kommunal xidmət dispetçeri və ya əməliyyat administratorusunuz"
        goal="Sahə xidmət çağırışlarına — dispetçerləşmə, yoxlamalar və müştəri müraciətlərinə — baxmaq, onları status üzrə süzgəcdən keçirmək və çağırış nömrəsi ilə tapmaq"
      >
        Səhifəyə <HelpKey>Energy &amp; Utilities</HelpKey> → <HelpKey>Xidmət Çağırışları</HelpKey> yolu ilə
        çatırsınız. Bütün çağırışlar yalnız sizin təşkilatınıza aiddir. Bu səhifə yalnız oxu üçün
        nəzərdə tutulub: çağırışları görür, süzgəcdən keçirir və axtarırsınız — burada yeni çağırış
        yaratmaq və ya çağırışı redaktə etmək forması yoxdur.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda alov ikonası ilə <HelpKey>Xidmət Çağırışları</HelpKey> adı, altında «Sahə xidmət
          çağırışları — dispetçerləşmə, yoxlamalar və müştəri müraciətləri» izahı durur. Altda dörd
          statistika kartı var: <strong>Ümumi çağırışlar</strong>, <strong>Açıq</strong>,{" "}
          <strong>Tamamlandı</strong> və <strong>Təcili / Fövqəladə</strong>. Onların altında bir
          süzgəc zolağı (axtarış xanası, status açılan siyahısı və yenilə düyməsi), sonra isə çağırış
          cədvəli gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi çağırışlar">Hazırda yüklənmiş çağırışların sayı.</HelpDef>
          <HelpDef term="Açıq">Yüklənmişlər arasında «Qəbul edildi», «Göndərildi» və ya «İcrada» statusunda olanların sayı.</HelpDef>
          <HelpDef term="Tamamlandı">Yüklənmişlər arasında «Tamamlandı» statusunda olanların sayı.</HelpDef>
          <HelpDef term="Təcili / Fövqəladə">Yüklənmişlər arasında prioriteti təcili və ya fövqəladə olanların sayı.</HelpDef>
          <HelpDef term="Çağırış №">Çağırışın nömrəsi — cədvəldə kiçik monoşrift mətnlə göstərilir; axtarış məhz bu sahə üzrə işləyir.</HelpDef>
          <HelpDef term="Növ">Çağırışın növü (məsələn, kəsinti hesabatı, yeni qoşulma, sayğac yoxlaması, hesablaşma mübahisəsi).</HelpDef>
          <HelpDef term="Status">Çağırışın mərhələsi — rəngli nişanla göstərilir: Qəbul edildi, Göndərildi, İcrada, Tamamlandı, Ləğv edildi.</HelpDef>
          <HelpDef term="Planlaşdırıldı">Varsa, çağırış üçün planlaşdırılmış tarix; yoxdursa tire (—) görünür.</HelpDef>
          <HelpDef term="Texnik">Çağırışa təyin edilmiş istifadəçinin identifikatoru; təyinat yoxdursa tire (—) görünür.</HelpDef>
        </dl>
        <p>
          Cədvəlin sütunları bunlardır: <strong>Çağırış №</strong>, <strong>Növ</strong>,{" "}
          <strong>Status</strong>, <strong>Planlaşdırıldı</strong> və <strong>Texnik</strong>. İlk üç
          sütunu başlığa toxunaraq çeşidləyə bilərsiniz. Cədvəl çoxlu nəticəni səhifələrlə yükləyir;
          daha çox sətir varsa, aşağıda <HelpKey>Daha çox yüklə</HelpKey> düyməsi peyda olur.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: status üzrə süzgəcdən keçir">
        <HelpStep n={1}>
          <p>
            Süzgəc zolağındakı status açılan siyahısını açın (standart olaraq{" "}
            <HelpKey>Bütün statuslar</HelpKey> seçilidir).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahıda beş status variantı görünür: <strong>Qəbul edildi</strong>,{" "}
            <strong>Göndərildi</strong>, <strong>İcrada</strong>, <strong>Tamamlandı</strong> və{" "}
            <strong>Ləğv edildi</strong> — üstündə isə <strong>Bütün statuslar</strong> variantı.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Bir status seçin (məsələn, <HelpKey>İcrada</HelpKey>).</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl dərhal yenidən yüklənir və yalnız seçdiyiniz statusdakı çağırışları göstərir.
            Statistika kartları da indi yüklənmiş bu süzülmüş nəticəyə görə yenidən hesablanır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: çağırış nömrəsi ilə axtar">
        <HelpStep n={1}>
          <p>
            Süzgəc zolağının solundakı axtarış xanasına (içində lupa ikonası var) çağırış nömrəsinin
            bir hissəsini yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca mətn xanada görünür. Bir az gözlədikdən sonra (təxminən saniyənin yarısı) cədvəl
            avtomatik yenilənir — axtarış üçün ayrıca düymə basmaq lazım deyil. Axtarış nəticə vermək
            üçün ən azı iki simvol tələb edir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Nəticələrə baxın; axtarışı təmizləmək üçün xananı boşaldın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl yalnız nömrəsi yazdığınız mətni ehtiva edən çağırışları göstərir (böyük-kiçik hərf
            fərqi nəzərə alınmır). Xananı boşaltdıqda tam siyahı geri qayıdır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Axtarış <strong>yalnız çağırış nömrəsi</strong> üzrə işləyir. Çağırışın mövzusu və təsviri
            bazada şifrələnmiş saxlanılır, ona görə də mətn üzrə (mövzu, müştəri adı və s.) axtarış
            etmək mümkün deyil — axtarış xanasına çağırış nömrəsini yazın, başqa sahəni deyil.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: yenilə və daha çox yüklə">
        <HelpStep n={1}>
          <p>
            Siyahını ən son vəziyyətə gətirmək üçün süzgəc zolağının sağındakı dönən ox ikonalı{" "}
            <HelpKey>Yenilə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl cari süzgəc və axtarış parametrlərini saxlayaraq baş tərəfdən yenidən yüklənir;
            statistika kartları da yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Cədvəlin altında <HelpKey>Daha çox yüklə</HelpKey> düyməsi varsa, növbəti hissəni gətirmək
            üçün onu basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Növbəti çağırışlar mövcud siyahının ardına əlavə olunur. Daha sətir qalmayanda{" "}
            <strong>Daha çox yüklə</strong> düyməsi yox olur. (Diqqət: statistika kartları yalnız ilk
            yüklənmiş hissəyə görə hesablanır, ona görə əlavə hissələr gətirildikdə dəyişmir.)
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Cədvəldə <strong>Çağırış №</strong>, <strong>Növ</strong> və <strong>Status</strong>{" "}
          sütunlarını başlığa toxunaraq çeşidləyə bilərsiniz. Status nişanlarının rəngi vəziyyəti tez
          tanımağa kömək edir — «Tamamlandı» yaşıl, «İcrada» firuzəyi, «Göndərildi» kəhrəba, «Qəbul
          edildi» mavi, «Ləğv edildi» isə bozdur.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün çağırışlar təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın çağırışlarını
          görürsünüz. Çağırışın mövzusu və təsviri kimi şəxsi məlumatlar bazada sütun-bağlı
          şifrələmə ilə qorunur, hər baxış isə uyğunluq jurnalında qeydə alınır.
        </p>
      </HelpCallout>
    </div>
  )
}
