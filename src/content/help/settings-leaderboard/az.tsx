"use client"

/**
 * KPI Arena tənzimləməsi — help article (Azerbaijani).
 * Tənzimləmələr → Leaderboard (KPI Arena tənzimləməsi) səhifəsini əhatə edir:
 * MTM çəkiləri (task/photo/route sürgüləri), status həddləri (4 ədəd sahə +
 * canlı önizləmə), yadda saxla / defolta qaytar. Arena lövhəsinin özü (qabarcıq
 * reytinqi) bura DAXİL DEYİL — bu məqalə yalnız idarəçi tənzimləmə ekranıdır.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function settingsleaderboardHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Təşkilat administratoru və ya əməliyyat rəhbərisiniz"
        goal="KPI Arena lövhələrinin agentləri necə qiymətləndirdiyini tənzimləmək — sahə (MTM) çəkilərini və status rənglərinin hansı faizdə dəyişdiyini təyin etmək"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>KPI Arena tənzimləməsi</HelpKey> yolu ilə
        çatırsınız. Bütün dəyişikliklər yalnız sizin təşkilatınıza tətbiq olunur. Bu səhifə Arena
        lövhəsinin <em>özü</em> deyil — burada qaydaları qoyursunuz, lövhələr isə həmin qaydalarla
        qabarcıqları rəngləyir. Yadda saxladıqdan sonra dəyişikliklər MTM, dəstək, layihə və tapşırıq
        lövhələrinə <strong>dərhal</strong> tətbiq olunur (satış lövhəsi öz kvota məntiqindən istifadə
        edir və buradakı çəkilərdən təsirlənmir).
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda kubok (trophy) ikonası, <HelpKey>KPI Arena tənzimləməsi</HelpKey> başlığı və qısa
          izah var. Altında iki kart gəlir: birincisi <strong>MTM çəkiləri</strong>, ikincisi{" "}
          <strong>Status həddləri</strong> (içində canlı önizləmə ilə). Ən aşağıda{" "}
          <HelpKey>Yadda saxla</HelpKey> düyməsi durur; əgər artıq dəyişiklik etmisinizsə, yanında{" "}
          <HelpKey>Defolta qaytar</HelpKey> düyməsi, etməmisinizsə «Daxili defolt istifadə olunur»
          yazısı görünür. Səhifə açılarkən bir an yüklənmə dövrəsi (spinner) görünə bilər.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="MTM çəkiləri">
            Sahə agentinin KPI faizinin neçə hissədən yığıldığını göstərən üç amil:{" "}
            <strong>Tapşırıq icrası</strong>, <strong>Foto təsdiqi</strong> və{" "}
            <strong>Marşrut icrası</strong>. Hər biri 0–1 arası sürgü ilə qoyulur, sistem isə onları
            avtomatik 100%-ə normallaşdırır — yəni mütləq rəqəm yox, nisbi balans önəmlidir.
          </HelpDef>
          <HelpDef term="Status həddləri">
            Hər status üçün minimum KPI faizi. Beş status var: <strong>Üstələyir</strong>,{" "}
            <strong>Qrafikdə</strong>, <strong>Geri qalır</strong>, <strong>Risk altında</strong> və
            ən aşağıdakı <strong>Kritik</strong> (onun ayrıca həddi yoxdur — qalan hamısının altındakı
            agentlər ora düşür).
          </HelpDef>
          <HelpDef term="Canlı önizləmə">
            Status həddləri kartının içində bir neçə nümunə qabarcıq (130%, 100%, 80%, 60%, 40%, 15%)
            — siz rəqəmləri dəyişdikcə onların rəngi və status etiketi dərhal yenilənir, beləliklə
            yadda saxlamadan əvvəl lövhənin necə görünəcəyini görürsünüz.
          </HelpDef>
          <HelpDef term="Defolt">
            Heç nə dəyişməsəniz işləyən daxili dəyərlər: çəkilər <strong>0.50 / 0.30 / 0.20</strong>{" "}
            (tapşırıq / foto / marşrut) və həddlər <strong>110 / 90 / 70 / 50</strong>.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: MTM çəkilərini tənzimlə">
        <HelpStep n={1}>
          <p>
            Birinci kartı (<HelpKey>MTM çəkiləri</HelpKey>) tapın. İçində üç sürgü var:{" "}
            <strong>Tapşırıq icrası</strong>, <strong>Foto təsdiqi</strong> və{" "}
            <strong>Marşrut icrası</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sürgünün sağında iki rəqəm yazılır: cari çəki (məs. <HelpKey>0.50</HelpKey>) və onun
            ümumi cəmdəki faizi (məs. <HelpKey>50%</HelpKey>). Kartın başında bu amillərin KPI%-nə nə
            qədər təsir etdiyini izah edən kiçik mətn durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstədiyiniz sürgünü sola-sağa sürüşdürün. Hər addım <strong>0.05</strong>-dir, ən aşağı{" "}
            <strong>0</strong>, ən yuxarı <strong>1</strong>-dir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sürüşdürdükcə yandakı rəqəm dəyişir, qonşu sürgülərin <strong>%</strong> dəyəri də
            yenidən hesablanır (çünki faizlər həmişə cəmin 100%-i kimi göstərilir). Kartın altında
            «Cari cəm: …» sətri sürgülərin toplamını əks etdirir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Balansı istədiyiniz kimi qoyun — məsələn fotonu marşruta görə daha vacib sayırsınızsa,
            <strong> Foto təsdiqi</strong> sürgüsünü yuxarı, <strong>Marşrut icrası</strong>-nı aşağı
            sürün.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bütün üç sürgünü <strong>0</strong>-a endirsəniz, cəm 0 olur və aşağıdakı{" "}
            <HelpKey>Yadda saxla</HelpKey> düyməsi qeyri-aktiv olur — ən azı bir amilin çəkisi
            olmalıdır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: status həddlərini qoy və önizlə">
        <HelpStep n={1}>
          <p>
            İkinci kartda (<HelpKey>Status həddləri</HelpKey>) dörd rəqəm sahəsi var — hər status üçün
            bir: <strong>Üstələyir</strong>, <strong>Qrafikdə</strong>, <strong>Geri qalır</strong>,{" "}
            <strong>Risk altında</strong>. Hər sahənin solunda statusun rəngli nöqtəsi, sağında{" "}
            <strong>%</strong> işarəsi var.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sahə yalnız rəqəm qəbul edir (0–200 arası). Məsələn <strong>Qrafikdə</strong> 90
            yazsanız, KPI-si 90%-dən böyük (lakin «Üstələyir» həddindən kiçik) olan agentlər
            «Qrafikdə» sayılacaq.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Rəqəmləri <strong>azalan</strong> sırada qoyun: Üstələyir ≥ Qrafikdə ≥ Geri qalır ≥ Risk
            altında.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sıra pozulsa (məs. «Geri qalır» «Qrafikdə»-dən böyük olsa), sahələrin altında qırmızı
            xəbərdarlıq çıxır: «Həddlər azalmalıdır: Üstələyir ≥ Qrafikdə ≥ Geri qalır ≥ Risk
            altında.» və <HelpKey>Yadda saxla</HelpKey> düyməsi qeyri-aktiv qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Kartın aşağısındakı <strong>Canlı önizləmə</strong> sırasına baxın — orada bir neçə nümunə
            qabarcıq var (130%, 100%, 80%, 60%, 40%, 15%).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər nümunə qabarcıq içində faizi, altında isə hazırkı həddlərə görə status etiketini
            (məs. «Üstələyir», «Qrafikdə») göstərir. Rəqəmləri dəyişdikcə bu qabarcıqların rəngi
            (qırmızı → narıncı → yaşıl) və etiketləri dərhal yenilənir — bu, lövhənin yadda
            saxlamadan sonra necə görünəcəyinin eynisidir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: yadda saxla və ya defolta qaytar">
        <HelpStep n={1}>
          <p>
            Hər şey hazırdırsa, ən aşağıdakı <HelpKey>Yadda saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə qısa müddət fırlanan ikona göstərir, sonra «Tənzimləmə yadda saxlanıldı» bildirişi
            (toast) çıxır. Bundan sonra düymənin yanında <HelpKey>Defolta qaytar</HelpKey> düyməsi
            peyda olur — bu, tənzimləmənin artıq fərdiləşdirildiyini bildirir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Daxili dəyərlərə qayıtmaq istəsəniz, <HelpKey>Defolta qaytar</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Defolta qaytarıldı» bildirişi çıxır, sürgülər və həddlər standart dəyərlərə (0.50 / 0.30
            / 0.20 və 110 / 90 / 70 / 50) qayıdır, <HelpKey>Defolta qaytar</HelpKey> düyməsi yox olur
            və yenidən «Daxili defolt istifadə olunur» yazısı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <HelpKey>Defolta qaytar</HelpKey> təşkilatınızın bütün fərdi çəki və hədd ayarlarını
            silir və daxili standartları bərpa edir. Bu, dərhal qüvvəyə minir — yalnız hansısa amili
            müvəqqəti dəyişmək istəyirsinizsə, sıfırlamaq əvəzinə sadəcə sürgü/rəqəmi dəyişib yenidən
            yadda saxlayın.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Çəkilər <strong>avtomatik normallaşır</strong>, ona görə mütləq rəqəmləri «düzgün» qoymağa
          çalışmayın — vacib olan nisbətdir. Məsələn 0.5 / 0.3 / 0.2 ilə 5 / 3 / 2 eyni nəticəni
          verir. Sadəcə hansı amilin digərindən neçə dəfə vacib olduğunu düşünün.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bu tənzimləmə bütöv təşkilat üçündür və <HelpKey>settings:write</HelpKey> icazəsi tələb
          edir — adi agent onu dəyişə bilməz. Dəyişikliklər yalnız sizin tenant-ınızın lövhələrinə
          təsir edir, başqa təşkilatlar görmür. Qeyd: çəkilər həm də dəstək, layihə və tapşırıq
          lövhələrindəki statusları tənzimləyir, təkcə MTM-i deyil; satış lövhəsi isə öz kvota
          məntiqi ilə işləyir.
        </p>
      </HelpCallout>
    </div>
  )
}
