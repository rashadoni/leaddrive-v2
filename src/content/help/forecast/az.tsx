"use client"

/**
 * Satış proqnozu — yardım məqaləsi (Azərbaycanca).
 * Mənbə səhifə: src/app/(dashboard)/forecast/page.tsx
 * Real UI: rüb seçici (Q1–Q4), 4 KPI kartı (Təsdiqlənmiş / Ən yaxşı ssenari /
 * Huni (çəkili) / Kvota), Gəlir proqnozu qrafiki (6 ay), Menecerlər üzrə
 * (kvota qarşı fakt), Hunilər üzrə kartları.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ForecastHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="satış rəhbəri və ya menecersiniz"
        goal="bu rübdə nə qədər gəlir gözlədiyinizi bir baxışda görmək və komandanın kvotaya nə qədər yaxın olduğunu yoxlamaq"
      >
        Bu səhifə yalnız açıq sövdələrinizdən oxuyur — ayrıca heç nə doldurmaq lazım deyil.
        Rəqəmlərin mənalı olması üçün sövdələrdə <strong>ehtimal</strong> və{" "}
        <strong>gözlənilən bağlanma tarixi</strong> dolu olmalıdır. Yalnız öz təşkilatınızın
        sövdələrini görürsünüz.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Səhifə cari rübdə açılır. Yuxarıda <HelpKey>Q1</HelpKey> … <HelpKey>Q4</HelpKey> rüb
          düymələri, altında dörd KPI kartı, sonra <strong>Gəlir proqnozu</strong> qrafiki, daha sonra
          (məlumat varsa) <strong>Menecerlər üzrə</strong> və <strong>Hunilər üzrə</strong> bölmələri
          görünür.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Təsdiqlənmiş">
            İrəliyə yönəlik aylarda təsdiqlənmiş gəlir cəmi — bağlanmağa ən yaxın sövdələr.
          </HelpDef>
          <HelpDef term="Ən yaxşı ssenari">
            Hər şey alınsa gəlin biləcək gəlir — təsdiqlənmişdən daha geniş, daha optimist rəqəm.
          </HelpDef>
          <HelpDef term="Huni (çəkili)">
            İrəliyə yönəlik bütün açıq huni, hər sövdə öz qazanma ehtimalına vurulmuş halda.
          </HelpDef>
          <HelpDef term="Kvota Q{quarter}">
            Seçilmiş rübdə icra faizi — faktiki qazanılan ÷ kvota hədəfi; altında fakt / hədəf məbləği.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: rübün proqnozunu oxumaq">
        <HelpStep n={1}>
          <p>
            Yuxarı sağda rübü seçin — <HelpKey>Q1 {"{year}"}</HelpKey> … <HelpKey>Q4 {"{year}"}</HelpKey>.
            Seçilmiş düymə vurğulanır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Kvota</strong> kartı və (varsa) <strong>Menecerlər üzrə</strong> bölməsi seçilmiş
            rübə uyğunlaşır. Dörd KPI kartından digər üçü (Təsdiqlənmiş, Ən yaxşı ssenari, Huni) və
            gəlir qrafiki rübdən asılı deyil — onlar irəliyə yönəlik 6 aylıq proqnozu göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Dörd KPI kartına baxın: <strong>Təsdiqlənmiş</strong> (yaşıl), <strong>Ən yaxşı ssenari</strong>{" "}
            (bənövşəyi), <strong>Huni (çəkili)</strong> və <strong>Kvota</strong> faizi.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kart bir məbləğ göstərir; Kvota kartı isə faizlə yanaşı altında{" "}
            <em>fakt / hədəf</em> kompakt məbləğini də verir (məs. «42K / 60K»).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Gəlir proqnozu (6 ay)</strong> qrafikini oxuyun. Dörd sahə xətti var: Fakt
            (bütöv yaşıl), Təsdiqlənmiş (mavi), Ən yaxşı (bənövşəyi punktir) və Huni (boz incə punktir).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər ayın üzərinə kursoru gətirdikdə tooltip o ay üçün dörd dəyəri — Fakt, Təsdiql.,
            Ən yaxşı, Huni — ayrıca göstərir. Ay adları aktiv dilinizdə yazılır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: kvotaya qarşı icranı yoxlamaq">
        <HelpStep n={1}>
          <p>
            Qrafikin altına diyirlədin və <strong>Menecerlər üzrə</strong> bölməsini tapın. O,
            yalnız seçilmiş rüb üçün kvota təyin edilmiş işçilər olduqda görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Başlıq «<strong>Menecerlər üzrə — Q{"{quarter}"} {"{year}"}</strong>» kimi yazılır, altında
            hər işçi üçün bir sətir: ad, doldurulmuş zolaq, faiz və sağda <em>fakt / kvota</em> məbləği.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Zolağın rənginə baxın: 100%+-də yaşıl, 70%-dən mavi, 40%-dən sarı, aşağıda qırmızı.
            Kvotanı keçən işçilərdə 100% nişanından kənara çıxan daha açıq yaşıl quyruq görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sağdakı faiz də eyni rənglə işarələnir (yaşıl / mavi), kvotanın altında olanlar isə solğun
            rənglə. Bir işçinin kvotası yoxdursa, həmin rübdə sətri ümumiyyətlə görünməyəcək.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: hunilər üzrə açıq dəyəri görmək">
        <HelpStep n={1}>
          <p>
            Daha aşağı diyirlədin və <strong>Hunilər üzrə</strong> bölməsini tapın. Hər kart açıq
            sövdəsi olan bir satış boru xəttini (huni) təmsil edir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kartda huninin adı, açıq sövdə sayı («N sövdələşmə»), <strong>Cəmi</strong> açıq məbləğ,
            <strong>Çəkili</strong> dəyər və altda çəkili/cəmi nisbətini göstərən nazik zolaq olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Cəmi ilə Çəkili arasındakı fərqi müqayisə edin: Çəkili nə qədər Cəmiyə yaxındırsa, həmin
            huninin sövdələri o qədər yüksək ehtimallıdır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Nazik zolaq nə qədər dolu olarsa, çəkili dəyər cəmi məbləğin o qədər böyük hissəsini təşkil
            edir. Açıq sövdəsi olmayan hunilər ümumiyyətlə siyahıda görünmür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Bu səhifədə ən böyük lever <strong>sövdə ehtimalı</strong> və{" "}
          <strong>gözlənilən bağlanma tarixidir</strong>. Sövdə yalnız gözlənilən bağlanma tarixi həmin
          aya düşəndə həmin ayın proqnozuna girir, ehtimalı isə çəkili dəyərini həll edir. Hər sövdədə
          hər iki sahəni dürüst saxlayın — proqnoz özü öz qayğısına qalar.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <strong>Menecerlər üzrə</strong> və <strong>Hunilər üzrə</strong> bölmələri yalnız məlumat
          olduqda görünür: kvota təyin edilməyibsə menecer bölməsi, açıq sövdəsi olan huni yoxdursa
          huni bölməsi görünməyəcək. Bölmənin yoxluğu xəta deyil — sadəcə hələ göstəriləcək məlumat
          yoxdur.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Buradakı hər şey təşkilatınızla məhdudlaşır — proqnoz, kvotalar və huni dəyərləri yalnız öz
          tenant-ınızın sövdələrini oxuyur. Kvota məbləğləri ayrıca «Kvotalar və ərazilər» bölməsində
          təyin olunur; bu səhifə onları yalnız faktla müqayisə edib göstərir.
        </p>
      </HelpCallout>
    </div>
  )
}
