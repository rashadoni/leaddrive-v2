"use client"

/**
 * Sales Forecast (Tənzimləmələr → Satış Proqnozu) — help article (Azerbaijani).
 * Real UI: Tənzimləmələr → Satış Proqnozu səhifəsi — gəlirli xidmət
 * (şöbə) sətirləri × 12 ay redaktə edilən cədvəl, ƏDV (18%) keçidi,
 * il seçici, Excel ixrac/idxal və Saxla. Dəyərlər ƏDV-siz saxlanır.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function salesforecastsettingsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Maliyyə və ya əməliyyat administratorusunuz"
        goal="Hər gəlirli xidmət üzrə il boyu aylıq satış proqnozunu daxil etmək, ƏDV ilə/ƏDV-siz görmək və Excel-lə mübadilə etmək"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Satış Proqnozu</HelpKey> yolu ilə çatırsınız
        (başlıqdakı geri ox <HelpKey>Büdcə konfiqurasiyası</HelpKey> səhifəsinə qaytarır). Cədvəlin sətirləri
        büdcə şöbələrindən gəlir — yalnız <strong>gəlirli</strong> və <strong>aktiv</strong> olan şöbələr
        burada xidmət sətri kimi görünür. Bütün proqnoz məbləğləri yalnız sizin təşkilatınız üçündür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda yüksələn ox ikonası ilə yanaşı <HelpKey>Satış Proqnozu</HelpKey> adı və qısa izah durur.
          Sağ yuxarıda dörd idarəetmə var: <HelpKey>ƏDV ilə (18%)</HelpKey> qeyd qutusu, il seçici
          (2025–2028), <strong>endirmə</strong> (Excel-ə ixrac) və <strong>yükləmə</strong> (Excel-dən idxal)
          ikon düymələri, və <HelpKey>Saxla</HelpKey> düyməsi. Başlığın altında «ƏDV-siz saxlanır — keçiş
          zamanı 18% ƏDV ilə göstərilir» qeydi var.
        </p>
        <p>
          Əsas hissə bir cədvəldir: sol sütun <strong>Xidmət</strong> (şöbə adları), sonra <strong>12 ay</strong>{" "}
          (Yan, Fev, …) sütunu, ən sağda isə <strong>Cəmi</strong> sütunu. Hər ay xanası rəqəm daxil edilən
          xanadır. Cədvəlin altında iki yekun sətri gəlir: sarımtıl <strong>ƏDV (18%)</strong> sətri və boz{" "}
          <strong>CƏMİ</strong> sətri.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Xidmət (şöbə)">Gəlirli və aktiv büdcə şöbəsi — hər biri cədvəldə bir sətir. Şöbələr Büdcə konfiqurasiyasında idarə olunur, bu səhifədə yaradılmır.</HelpDef>
          <HelpDef term="Aylıq xana">Həmin şöbə üçün həmin aydakı proqnoz məbləği. Boş = 0.</HelpDef>
          <HelpDef term="Cəmi (sətir)">Bir şöbənin 12 ay üzrə cəmi.</HelpDef>
          <HelpDef term="ƏDV (18%) sətri">Hər ay sütunu üzrə hesablanan ƏDV məbləği (məbləğin 18%-i). Yalnız oxunur, redaktə edilmir.</HelpDef>
          <HelpDef term="CƏMİ sətri">Bütün şöbələr üzrə ay-ay və ümumi yekun. Başlığı keçidə görə «CƏMİ (ƏDV ilə)» və ya «CƏMİ (ƏDV-siz)» olur.</HelpDef>
          <HelpDef term="ƏDV ilə (18%) keçidi">Yalnız göstərişi dəyişir: işarələnəndə xanalar 18% ƏDV ilə görünür. Saxlama həmişə ƏDV-siz olur.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: il üçün proqnoz daxil et və saxla">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı il seçicidən proqnoz qurmaq istədiyiniz ili seçin (<HelpKey>2025</HelpKey>–
            <HelpKey>2028</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl seçilmiş ilin saxlanmış dəyərləri ilə yenidən yüklənir. Kart başlığı «{"{il}"} ili üçün
            proqnoz — N xidmət» kimi yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Hər xidmət sətrində uyğun ay xanasına klikləyib aylıq məbləği yazın. Sətir boyu hərəkət etdikcə
            sağdakı <strong>Cəmi</strong> dərhal hesablanır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Xana yalnız rəqəm qəbul edir (artırma/azaltma oxları gizlidir). Yazdıqca həmin sətrin{" "}
            <strong>Cəmi</strong>, alt hissədəki <strong>ƏDV (18%)</strong> və <strong>CƏMİ</strong>{" "}
            sətirləri ay-ay yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İstəsəniz <HelpKey>ƏDV ilə (18%)</HelpKey> qeyd qutusunu işarələyin ki, məbləğləri ƏDV daxil
            görəsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart başlığının yanındakı kiçik etiket «ƏDV-siz məbləğlər (netto)» ilə «ƏDV 18% ilə məbləğlər»
            arasında keçir, bütün xanalar və yekunlar isə 18% artırılmış göstərilir. Bu yalnız görüntüdür —
            saxlanan rəqəmlər dəyişmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Bitirdikdə sağ yuxarıdakı <HelpKey>Saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə saxlanarkən fırlanan ikona göstərir, uğurlu olanda qısa müddətə <HelpKey>Saxlanıldı</HelpKey>{" "}
            yazısına keçir, sonra yenidən <HelpKey>Saxla</HelpKey> olur. Bütün 12 ay × bütün xidmətlər ƏDV-siz
            saxlanılır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Excel-ə ixrac və Excel-dən idxal">
        <HelpStep n={1}>
          <p>
            Cari ili Excel faylına çıxarmaq üçün <HelpKey>Excel-ə ixrac</HelpKey> (endirmə oxu) ikon düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Brauzer <code>sales-forecast-{"{il}"}.xlsx</code> adlı faylı endirir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Excel-dən geri yükləmək üçün <HelpKey>Excel-dən idxal</HelpKey> (yükləmə oxu) ikon düyməsini basıb
            <code>.xlsx</code> və ya <code>.xls</code> fayl seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Fayl seçildikdən sonra cədvəl idxal olunmuş dəyərlərlə yenidən yüklənir. İdxal cari il üçün
            tətbiq olunur — saxlamadan əvvəl rəqəmləri yoxlayın.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Cədvəldə xidmət sətri görmürsünüzsə, bu o deməkdir ki, hələ <strong>gəlirli</strong> və{" "}
          <strong>aktiv</strong> büdcə şöbəniz yoxdur. Başlıqdakı geri ox ilə <HelpKey>Büdcə konfiqurasiyası</HelpKey>{" "}
          səhifəsinə keçib şöbələri orada qurun — sonra bura qayıdanda onlar sətir kimi görünəcək.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          ƏDV keçidi yalnız <strong>göstərişdir</strong>: işarələnsə də, işarələnməsə də saxlama həmişə ƏDV-siz
          (netto) gedir. ƏDV ilə görünən böyük rəqəmləri «ƏDV ilə» rejimdə yazsanız, sistem onları avtomatik
          ƏDV-siz dəyərə çevirib saxlayır — qarışdırmamaq üçün məbləğləri daxil edərkən keçidin vəziyyətinə
          fikir verin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün proqnoz məlumatları təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın şöbələrini və
          proqnozunu görürsünüz, başqa təşkilatın rəqəmlərinə çıxışınız yoxdur. İxrac/idxal da yalnız sizin
          təşkilatınızın seçilmiş ili üzərində işləyir.
        </p>
      </HelpCallout>
    </div>
  )
}
