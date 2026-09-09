"use client"

/**
 * Insurance — Policy-Holder detail — help article (Azerbaijani).
 * Mənbə səhifə: src/app/(dashboard)/insurance/[id]/page.tsx
 * Bu səhifə BİR sığortalının (policy holder) yalnız-oxunan kartıdır:
 * başlıq kartı (ad + status nişanı + kontakt sətri), iki tab
 * (Ümumi baxış / Polislər) və polis siyahısı. Redaktə, status
 * dəyişmə, silmə əməliyyatı YOXDUR — buna görə uydurulmamışdır.
 * Polislər tabı /api/v1/policies?policyHolderId=...-dən tələb üzrə yüklənir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InsuranceDetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sığorta agenti, anderrayter və ya müştəri xidməti üzrə əməkdaşsınız"
        goal="Bir sığortalının (policy holder) bütün məlumatını — şəxsi və əlaqə detalları, statusu və ona bağlı polisləri — bir ekranda nəzərdən keçirmək"
      >
        Bu səhifəyə <HelpKey>Sığorta</HelpKey> siyahısından bir sığortalının üzərinə keçərək çatırsınız.
        Bu, <strong>yalnız-oxunan</strong> kartdır — burada məlumata baxırsınız, redaktə etmirsiniz.
        Yuxarı solda <HelpKey>Sığortalılara qayıt</HelpKey> düyməsi sizi siyahıya qaytarır. Bütün məlumat
        yalnız sizin təşkilatınıza aiddir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda bənövşəyi çətir (umbrella) ikonu olan <strong>başlıq kartı</strong> durur: sığortalının
          tam adı, yanında rəngli <strong>status nişanı</strong> və bir sətirdə əsas kontakt məlumatı —{" "}
          <strong>Sığortalı №</strong> (monospace şriftlə), varsa doğum tarixi, email və telefon. Başlığın
          altında iki <strong>tab</strong> gəlir: <HelpKey>Ümumi baxış</HelpKey> və <HelpKey>Polislər</HelpKey>.
          Aktiv tab bənövşəyi alt-xətt ilə işarələnir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status nişanı">Sığortalının vəziyyəti: Potensial, Aktiv, Qeyri-aktiv və ya Vəfat edib — hər biri öz rəngində.</HelpDef>
          <HelpDef term="Sığortalı №">Dəyişməz identifikator nömrəsi (monospace şriftlə göstərilir).</HelpDef>
          <HelpDef term="Ümumi baxış tabı">İki kart: «Şəxsi məlumat» və «Əlaqə və ünvan».</HelpDef>
          <HelpDef term="Polislər tabı">Bu sığortalıya bağlı polislərin siyahısı (tələb üzrə yüklənir).</HelpDef>
          <HelpDef term="Polis">Müqavilə: nömrə, sığorta növü, status, illik haqq və qüvvədə olma tarixləri.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: sığortalının ümumi məlumatına bax">
        <HelpStep n={1}>
          <p>
            Səhifə açılanda standart olaraq <HelpKey>Ümumi baxış</HelpKey> tabındasınız. Yüklənmə zamanı
            qısa müddət fırlanan göstərici görünür, sonra başlıq kartı və tablar yüklənir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Başlıq kartında ad, status nişanı və kontakt sətri; altda isə yan-yana iki kart —{" "}
            <strong>Şəxsi məlumat</strong> (insan ikonu) və <strong>Əlaqə və ünvan</strong> (xəritə nişanı
            ikonu).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Soldakı <strong>Şəxsi məlumat</strong> kartına baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sətir-sətir: <strong>Sığortalı №</strong>, <strong>Status</strong>, varsa{" "}
            <strong>Doğum tarixi</strong>, <strong>Peşə</strong>, <strong>Aktivləşdirildi</strong>,{" "}
            <strong>Deaktivləşdirildi</strong> və <strong>Vəfat tarixi</strong>. Yalnız dolu olan
            sahələr göstərilir — boş sahələr ümumiyyətlə görünmür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sağdakı <strong>Əlaqə və ünvan</strong> kartına baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Varsa <strong>Email</strong>, <strong>Telefon</strong> və <strong>Poçt ünvanı</strong> (ünvan
            sətri, şəhər, poçt indeksi və ölkə bir sətirdə birləşdirilir). Kartın altında bütün eni
            tutan <HelpKey>Polislər</HelpKey> düyməsi var.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: sığortalının polislərini gör">
        <HelpStep n={1}>
          <p>
            Başlıqdakı <HelpKey>Polislər</HelpKey> tabına keçin — ya da Ümumi baxış kartının altındakı{" "}
            <HelpKey>Polislər</HelpKey> düyməsini basın (hər ikisi eyni tabı açır).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tab ilk dəfə açılanda polislər tələb üzrə yüklənir; bu zaman mərkəzdə qısa fırlanan göstərici
            görünür. Bu sığortalının ən son 50 polisi gətirilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Polis siyahısına baxın. Hər polis ayrıca kart kimi göstərilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kartda: sənəd ikonu, monospace <strong>polis nömrəsi</strong>, <strong>sığorta növü</strong>{" "}
            (Avto / Əmlak / Həyat / Sağlamlıq və s.) və sağda rəngli <strong>status nişanı</strong> (Qiymət,
            Bağlanmış, Aktiv, Müddəti bitmiş, Vaxtı keçmiş və ya Ləğv edilmiş). Aşağı sətirdə{" "}
            <strong>İllik Sığorta Haqqı</strong>, varsa <strong>Qüvvəyə giriş</strong> və{" "}
            <strong>Bitmə tarixi</strong>, həmçinin ödəniş tezliyi göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bu sığortalıya hələ heç bir polis bağlanmayıbsa, siyahı yerinə boş vəziyyət mətni çıxır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mərkəzdə boz «<strong>Bu sığortalı üçün polis tapılmadı</strong>» mətni. Yükləmə uğursuz olarsa
            isə qırmızı «Polislər yüklənə bilmədi» xətası göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: siyahıya qayıt">
        <HelpStep n={1}>
          <p>
            İşiniz bitdikdə yuxarı soldakı <HelpKey>Sığortalılara qayıt</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sığorta sığortalıları siyahısı səhifəsinə qayıdırsınız.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Polislər tabı <strong>yalnız ona keçəndə</strong> yüklənir, ona görə səhifənin ilk açılışı sürətli
          olur. Polisin tarixləri və haqqı dəyişibsə, kartdan çıxıb yenidən girmək (və ya səhifəni yeniləmək)
          ən son məlumatı gətirir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu səhifə <strong>yalnız-oxunandır</strong>: burada sığortalını redaktə etmək, statusunu dəyişmək,
          yeni polis açmaq və ya silmək düyməsi <strong>yoxdur</strong>. Bu əməliyyatlar sığortanın digər
          ekranlarında aparılır — bura yalnız nəzərdən keçirmək üçündür.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Sığortalı və onun polisləri təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın qeydlərini
          görürsünüz. Səhifə fəaliyyəti zamanı <code>x-organization-id</code> başlığı ötürülür; başqa
          təşkilatın sığortalısına çıxış icazəniz yoxdur. Doğum tarixi, vergi nömrəsi və ünvan kimi həssas
          şəxsi məlumatlar tenant səviyyəsində qorunur.
        </p>
      </HelpCallout>
    </div>
  )
}
