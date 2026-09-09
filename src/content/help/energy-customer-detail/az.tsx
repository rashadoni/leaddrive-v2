"use client"

/**
 * Energy & Utilities — kommunal müştəri kartı (detal səhifəsi) — kömək məqaləsi (Azərbaycanca).
 * Səhifə: src/app/(dashboard)/energy/[id]/page.tsx
 * Bu yalnız oxunan kartdır: başlıq kartı (ad, status, hesab №, xidmət ünvanı) +
 * üç tab — Ümumi baxış / Sayğaclar / Xidmət müraciətləri. Redaktə, status dəyişdirmə
 * və ya silmə düymələri YOXDUR — kart məlumat oxumaq üçündür.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function energydetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Enerji və kommunal əməliyyat işçisi və ya dispetçersiniz"
        goal="Konkret kommunal müştərinin tam mənzərəsini görmək — hesab məlumatları, xidmət ünvanı, ona bağlı sayğaclar və xidmət müraciətləri"
      >
        Bu səhifəyə <HelpKey>Enerji və Kommunal</HelpKey> bölməsindəki müştəri siyahısından
        bir müştərini açmaqla gəlirsiniz. Bu, <strong>yalnız oxuma</strong> kartıdır — burada məlumat
        izləyirsiniz, redaktə etmirsiniz. Bütün məlumat yalnız sizin təşkilatınıza aiddir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Ən yuxarıda <HelpKey>Müştərilərə qayıt</HelpKey> düyməsi var — onunla müştəri siyahısına
          qayıdırsınız. Altında başlıq kartı durur: solda alov ikonalı sarı dairə, sağında müştərinin
          adı və yanında rəngli <strong>status</strong> nişanı, bir sətir aşağıda isə hesab nömrəsi
          (<HelpKey>#</HelpKey> ikonası ilə) və xidmət ünvanı (<HelpKey>📍</HelpKey> ikonası ilə) bir
          sətirdə yığılmış şəkildə göstərilir.
        </p>
        <p>
          Başlıq kartının altında üç tab var: <HelpKey>Ümumi baxış</HelpKey>,{" "}
          <HelpKey>Sayğaclar</HelpKey> və <HelpKey>Xidmət müraciətləri</HelpKey>. Aktiv tab sarı alt
          xətt ilə işarələnir. <strong>Sayğaclar</strong> və <strong>Xidmət müraciətləri</strong>{" "}
          tablarının məlumatı yalnız siz həmin taba keçəndə yüklənir — keçid anında qısa fırlanan
          yükləmə nişanı görünə bilər.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status nişanı">
            Müştərinin vəziyyəti: <strong>Potensial</strong> (mavi), <strong>Aktiv</strong> (yaşıl),{" "}
            <strong>Dayandırıldı</strong> (kəhrəba) və ya <strong>Xitam verildi</strong> (qırmızı).
          </HelpDef>
          <HelpDef term="Hesab №">Müştərinin unikal hesab nömrəsi — başlıqda və «Hesab məlumatları» kartında təkrarlanır.</HelpDef>
          <HelpDef term="Xidmət ünvanı">Ünvan sətirləri, şəhər, poçt indeksi və ölkədən vergüllə birləşdirilmiş tam ünvan.</HelpDef>
          <HelpDef term="Sayğac (Metering point)">Müştəriyə quraşdırılmış ölçü cihazı — sayğac nömrəsi, resurs növü (məs. elektrik, qaz, su) və öz statusu olan.</HelpDef>
          <HelpDef term="Xidmət müraciəti (Service call)">Müştəri üzrə qeydə alınmış xidmət/qəza çağırışı — çağırış nömrəsi, növü, statusu və tarixləri ilə.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: müştərinin əsas məlumatlarını oxu (Ümumi baxış)">
        <HelpStep n={1}>
          <p>
            Kart açılanda standart olaraq <HelpKey>Ümumi baxış</HelpKey> tabında olursunuz. Heç nə
            basmadan əsas məlumatlar göz önündədir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yan-yana iki kart: solda <strong>Hesab məlumatları</strong> (<HelpKey>Hesab №</HelpKey>,{" "}
            <HelpKey>Kateqoriya</HelpKey>, <HelpKey>Status</HelpKey> və dolu olduqca{" "}
            <strong>Aktivləşdirildi</strong> / <strong>Dayandırıldı</strong> /{" "}
            <strong>Xitam verildi</strong> tarixləri), sağda isə <strong>Xidmət ünvanı</strong>{" "}
            (<HelpKey>Şəhər</HelpKey>, ünvan sətirləri, <HelpKey>Poçt indeksi</HelpKey>,{" "}
            <HelpKey>Ölkə</HelpKey>). Boş olan sahələr ümumiyyətlə göstərilmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sayğaclara və ya xidmət müraciətlərinə tez keçmək üçün sağdakı «Xidmət ünvanı» kartının
            altındakı iki sürətli düymədən birini basın: <HelpKey>Sayğaclar</HelpKey> və ya{" "}
            <HelpKey>Xidmət müraciətləri</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Səhifə uyğun taba keçir — eyni nəticəni yuxarıdakı tab başlıqlarını basmaqla da almaq olar.
            Düymə basılan kimi aktiv tab dəyişir və həmin tabın məlumatı yüklənməyə başlayır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: müştərinin sayğaclarına bax">
        <HelpStep n={1}>
          <p>
            Yuxarıdakı <HelpKey>Sayğaclar</HelpKey> tabını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qısa yükləmə nişanından sonra müştəriyə bağlı sayğacların siyahısı gəlir. Hər sətirdə
            sayğac ikonası, monospace yazıyla <strong>sayğac nömrəsi</strong>, yanında resurs növü və
            sağda rəngli status nişanı (<strong>Quraşdırma gözlənilir</strong>,{" "}
            <strong>Aktiv</strong>, <strong>Ayrıldı</strong> və ya <strong>Silinib</strong>) olur.
            Quraşdırma tarixi varsa, sətirin altında <HelpKey>Quraşdırma tarixi</HelpKey> kimi görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bu müştərinin heç bir sayğacı yoxdursa, siyahı yerinə boş vəziyyət mesajı çıxır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mərkəzdə soluq «Sayğac tapılmadı» mətni göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: xidmət müraciətlərinə bax">
        <HelpStep n={1}>
          <p>
            Yuxarıdakı <HelpKey>Xidmət müraciətləri</HelpKey> tabını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yükləmədən sonra çağırış sətirləri gəlir. Hər sətirdə telefon ikonası, monospace yazıyla{" "}
            <strong>çağırış nömrəsi</strong>, yanında çağırış növü və sağda rəngli status nişanı
            (<strong>Qəbul edildi</strong>, <strong>Göndərildi</strong>, <strong>İcrada</strong>,{" "}
            <strong>Tamamlandı</strong> və ya <strong>Ləğv edildi</strong>) görünür. Aşağıda — varsa —
            <HelpKey>Planlaşdırıldı</HelpKey> və <HelpKey>Həll edildi</HelpKey> tarixləri durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bu müştəri üzrə heç bir çağırış qeydə alınmayıbsa, boş vəziyyət göstərilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mərkəzdə soluq «Xidmət müraciəti tapılmadı» mətni çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Sayğaclar və xidmət müraciətləri tabları yalnız siz onlara keçdiyiniz an yüklənir, ona görə
          ilk keçiddə qısa bir gözləmə normaldır. Hər tab ən çox 50 sətir göstərir — bu, ən aktual
          məlumata baxmaq üçün kifayət edir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu kartda <strong>redaktə, status dəyişmə və ya silmə düyməsi yoxdur</strong> — yalnız
          oxumaq üçündür. Müştəri yüklənə bilməsə (məs. yanlış keçid və ya icazə problemi), kartın
          yerinə qırmızı «Müştəri yüklənə bilmədi» mesajı və <HelpKey>Müştərilərə qayıt</HelpKey>{" "}
          düyməsi göstərilir; tablardan biri yüklənməsə, həmin tabın yerində «Məlumatlar yüklənə
          bilmədi» yazısı çıxır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün məlumatlar təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızdakı kommunal
          müştəriləri, sayğacları və xidmət müraciətlərini görürsünüz. Başqa təşkilatın kartını
          birbaşa keçidlə açmaq mümkün deyil.
        </p>
      </HelpCallout>
    </div>
  )
}
