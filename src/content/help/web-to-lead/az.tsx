"use client"

/**
 * Web-to-Lead — help article (Azerbaijani).
 * Yalnız Tənzimləmələr → Web-to-Lead səhifəsini əhatə edir: forma
 * konfiqurasiyası (təşkilat slug-ı, forma başlığı, düymə mətni,
 * yönləndirmə URL-i, sahə badge-ləri), API endpoint kartı, embed
 * kodunun kopyalanması və canlı önizləmə. Səhifə forma qurucusudur —
 * burada saxlanılan lid və ya forma yoxdur, hər şey real vaxtda kod
 * yaradır.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function WebToLeadHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq və ya əməliyyat administratorusunuz"
        goal="Öz saytınıza yerləşdirmək üçün hazır əlaqə forması kodu yaratmaq — ziyarətçi formanı doldurduqda LeadDrive-da avtomatik lid yaransın"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Web-to-Lead</HelpKey> yolu ilə çatırsınız.
        Bu səhifə bir <strong>forma qurucusudur</strong>: soldakı parametrləri dəyişirsiniz, sağda kod
        və önizləmə dərhal yenilənir. Burada heç nə yadda saxlanılmır — yaratdığınız HTML kodunu kopyalayıb
        öz saytınıza yapışdırırsınız, lidlər isə sayt formasından birbaşa LeadDrive-a düşür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda qlobus ikonası ilə <HelpKey>Web-to-Lead</HelpKey> adı, altında «Lid toplama formalarını
          konfiqurasiya edin» izahı və «Sayt ziyarətçilərindən avtomatik lid yaradan veb formalar» ipucusu
          durur. Altda səhifə iki sütuna bölünür. Sol sütunda iki kart var:{" "}
          <strong>Form Configuration</strong> (forma parametrləri) və <strong>API Endpoint</strong>. Sağ
          sütunda yenə iki kart var: <strong>Embed Code</strong> (yerləşdiriləcək kod) və{" "}
          <strong>Preview</strong> (canlı önizləmə).
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Organization Slug">
            Lidin hansı təşkilata düşəcəyini bildirən qısa ad. LeadDrive siz sistemə daxil olanda bunu cari
            tenant-dan avtomatik doldurur; yalnız dəstək başqa tenant-a yönləndirməyi istəsə dəyişin.
          </HelpDef>
          <HelpDef term="Form Title">
            Formanın yuxarısında görünən başlıq. Standart olaraq <HelpKey>Contact Us</HelpKey>.
          </HelpDef>
          <HelpDef term="Submit Button Text">
            Göndər düyməsinin üzərindəki mətn. Standart olaraq <HelpKey>Submit</HelpKey>.
          </HelpDef>
          <HelpDef term="Redirect URL (optional)">
            İstəyə bağlı — forma uğurla göndəriləndən sonra ziyarətçinin yönləndiriləcəyi səhifə (məs.
            «təşəkkür» səhifəsi). Boş buraxılsa, ziyarətçiyə təşəkkür bildirişi göstərilir.
          </HelpDef>
          <HelpDef term="Fields">
            Forma sahələri badge-lər kimi göstərilir: <strong>Name *</strong> və <strong>Email *</strong>{" "}
            həmişə var (məcburi, söndürülmür), <strong>Phone</strong>, <strong>Company</strong> və{" "}
            <strong>Message</strong> isə klikləməklə əlavə/çıxarılır.
          </HelpDef>
          <HelpDef term="API Endpoint">
            Formanın məlumatı göndərdiyi ünvan — <HelpKey>POST</HelpKey> metodu ilə{" "}
            <code>/api/v1/public/leads</code>. CORS açıqdır, IP üzrə dəqiqədə 10 sorğu limiti var.
          </HelpDef>
          <HelpDef term="Embed Code">
            Avtomatik yaranan tam HTML + JavaScript kodu. Parametrləri dəyişdikcə bu kod canlı yenilənir.
          </HelpDef>
          <HelpDef term="Preview">
            Forma kodunun yox, real görünüşünün canlı önizləməsi — bütün sahələr söndürülmüş (disabled),
            yalnız nümayiş üçündür.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: formanı konfiqurasiya et">
        <HelpStep n={1}>
          <p>
            Sol yuxarıdakı <strong>Form Configuration</strong> kartında <HelpKey>Organization Slug</HelpKey>{" "}
            sahəsini yoxlayın. Orada cari tenant slug-u artıq görünməlidir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca sağdakı <strong>Embed Code</strong> içində <code>org_slug</code> dəyəri dərhal yazdığınız
            mətnə dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Form Title</HelpKey> sahəsinə formanın başlığını yazın (məs. «Bizimlə əlaqə»), sonra{" "}
            <HelpKey>Submit Button Text</HelpKey> sahəsində göndər düyməsinin mətnini təyin edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sağdakı <strong>Preview</strong> kartında forma başlığı və düymə mətni yazdıqca real vaxtda
            dəyişir; eyni dəyərlər <strong>Embed Code</strong> içinə də düşür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İstəsəniz <HelpKey>Redirect URL (optional)</HelpKey> sahəsinə tam ünvan yazın (məs.{" "}
            <HelpKey>https://yoursite.com/thank-you</HelpKey>). Boş buraxsanız, ziyarətçiyə təşəkkür
            bildirişi göstəriləcək.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yalnız <code>http://</code> və ya <code>https://</code> ilə başlayan ünvan qəbul edilir —
            düzgün URL yazılanda kodun göndərmə hissəsi avtomatik yönləndirmə sətrinə keçir, əks halda
            təşəkkür bildirişi sətri qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <HelpKey>Fields</HelpKey> bölməsində istəyə bağlı sahələri açıb-bağlamaq üçün badge-ləri
            klikləyin: <HelpKey>Phone</HelpKey>, <HelpKey>Company</HelpKey>, <HelpKey>Message</HelpKey>.
            (<strong>Name *</strong> və <strong>Email *</strong> badge-ləri həmişə aktivdir və
            söndürülmür.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Badge aktiv olanda dolu (default) görünür, söndürüləndə isə yalnız konturlu (outline) olur.
            Altda «Click badges to toggle optional fields» ipucusu var. Söndürdüyünüz sahə dərhal həm{" "}
            <strong>Preview</strong>-dən, həm də <strong>Embed Code</strong>-dan yox olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: kodu kopyala və saytına yerləşdir">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <strong>Embed Code</strong> kartında parametrlərin doğru olduğunu yoxlayın —
            kart kod ikonası ilə işarələnib və bütün HTML + JavaScript kodunu göstərir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kod sahəsi «&lt;!-- LeadDrive Web-to-Lead Form --&gt;» şərhi ilə başlayır, içində forma,
            seçdiyiniz sahələr və göndərmə skripti var. Soldakı parametrləri dəyişdikcə kod dərhal
            yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Kartın sağ yuxarısındakı <HelpKey>Copy</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə qısa müddətə <HelpKey>Copied!</HelpKey> mətninə (təsdiq işarəsi ilə) keçir, sonra təxminən
            iki saniyədən sonra yenidən <HelpKey>Copy</HelpKey> olur. Kod buferə kopyalanıb.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Kopyaladığınız kodu öz saytınızın HTML-ində formanın görünməsini istədiyiniz yerə yapışdırın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saytda forma <strong>Preview</strong>-dəki görünüşlə eyni çıxır. Ziyarətçi formanı doldurub
            göndərəndə məlumat <strong>API Endpoint</strong> kartındakı ünvana POST olunur və LeadDrive-da
            yeni lid yaranır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Bu səhifə heç nə yadda saxlamır — sadəcə kod yaradır. Konfiqurasiyanı dəyişib yenidən{" "}
          <HelpKey>Copy</HelpKey> etsəniz, köhnə kodu saytda yenisi ilə əvəz etməlisiniz. Düzgün başlıq,
          düymə mətni və sahələri əvvəlcədən qurun, sonra bir dəfəyə kopyalayın.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Kodu kopyalamazdan əvvəl <HelpKey>Organization Slug</HelpKey> dəyərinin öz təşkilatınıza uyğun
          olduğuna əmin olun. Həmçinin{" "}
          <strong>API Endpoint</strong> IP üzrə dəqiqədə cəmi <strong>10 sorğu</strong> qəbul edir; yüksək
          trafikli səhifələrdə bu limiti nəzərə alın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Endpoint ictimaidir (<HelpKey>POST /api/v1/public/leads</HelpKey>) və CORS açıqdır ki, forma
          istənilən saytdan işləsin — lakin sui-istifadəni məhdudlaşdırmaq üçün IP üzrə dəqiqədə 10 sorğu
          limiti tətbiq olunur. Forma başlığı, düymə mətni və slug kodu yaradılarkən HTML-də təhlükəsiz
          şəkildə «escape» edilir, yönləndirmə URL-i isə yalnız <code>http/https</code> protokollarına
          icazə verir — kod inyeksiyasının qarşısını alır.
        </p>
      </HelpCallout>
    </div>
  )
}
