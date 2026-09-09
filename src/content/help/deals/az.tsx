"use client"

/**
 * Deals (Satış boru xətti) — help article (Azerbaijani).
 * Köhnə paylaşılan "list-power" məqaləsindən ayrılıb — yalnız Sövdələşmələr
 * səhifəsinə (Kanban / Siyahı / Analitika + Da Vinci AI) fokuslanır.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function DealsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış meneceri"
        goal="Sövdələşmələri liddən bağlanmaya qədər bir səhifədə idarə et"
      >
        Səhifə açılanda <strong>Kanban</strong> görünüşü gəlir. Yuxarıda üç
        nişan var — <HelpKey>Analitika</HelpKey>, <HelpKey>Kanban</HelpKey>,{" "}
        <HelpKey>Siyahı</HelpKey> — və başlığın altında neçə sövdələşməniz
        olduğu yazılır. Bütün məbləğlər ₼ ilə göstərilir. Yalnız öz
        təşkilatınızın sövdələşmələrini görürsünüz.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Üst sətir görünüşü dəyişir, sağ tərəf isə hərəkəti idarə edir. Birdən
          çox boru xəttiniz varsa, sağda <strong>boru xətti seçici</strong>{" "}
          görünür (defolt olan ★ ilə işarələnir); Kanban və Siyahıda{" "}
          <strong>sıralama</strong> menyusu və narıncı <HelpKey>Yeni
          sövdələşmə</HelpKey> düyməsi də sağdadır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Analitika">Sövdələşmələrin diaqram və göstəricilərlə icmalı.</HelpDef>
          <HelpDef term="Kanban">Mərhələ-sütunları; sövdələşmələri sürükləyib köçürün.</HelpDef>
          <HelpDef term="Siyahı">Cədvəl görünüşü — sahələri birbaşa redaktə edin, toplu əməliyyatlar.</HelpDef>
          <HelpDef term="Ehtimal">Sövdələşmənin bağlanma ehtimalı (%) — ≥70 yaşıl, ≥40 sarı.</HelpDef>
          <HelpDef term="Çəkili">Açıq sövdələrin öz ehtimalına vurulmuş cəmi.</HelpDef>
        </dl>
        <p>
          Nişanların altında <strong>Da Vinci</strong> AI düyməsi var: bütün
          boru xətti üzrə dil-əsaslı təhlil yaradır (boş boru xəttində passivdir).
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni sövdələşmə yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı narıncı <HelpKey>Yeni sövdələşmə</HelpKey> düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sövdələşmə forması açılır — ad, dəyər, mərhələ, ehtimal, gözlənilən
            bağlanma və əlaqəli şirkət üçün sahələr.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sahələri doldurub <HelpKey>Saxla</HelpKey> ilə təsdiqləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Forma bağlanır, yeni sövdələşmə dərhal cədvəldə / Kanban
            sütununda peyda olur, başlığın altındakı sayğac bir artır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Kanbanda mərhələni dəyiş">
        <HelpStep n={1}>
          <p>
            <HelpKey>Kanban</HelpKey> nişanına keçin. Yuxarıda dörd kart var —{" "}
            <strong>Cəmi sövdələşmə</strong>, <strong>Huni dəyəri</strong>,{" "}
            <strong>Qazanıldı</strong> və <strong>İtirildi</strong> — onların
            altında isə mərhələ üzrə rəngli <strong>Huni / Çəkili</strong> zolaq
            var (boru xəttində dəyər olduqda).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər mərhələ üçün bir sütun; kartlarda ad, şirkət, məbləğ və ehtimal,
            durğun sövdələrdə isə «{"{gün}"}g durğunluq» nişanı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bir kartı tutub başqa sütuna <strong>sürükləyin</strong> —
            mərhələ dəyişəcək. Sürətli baxış üçün kartdakı tapşırıq sahəsindən
            o sövdəyə <HelpKey>Tapşırıq</HelpKey> da əlavə edə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart yeni sütuna keçir; yuxarıdakı göstəricilər və zolaq yenilənir.
            Keçidə icazə yoxdursa, qırmızı banner səbəbi yazır və kart geri qayıdır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bir kartın üstünə <strong>klikləyin</strong> ki, həmin sövdənin tam
            səhifəsinə keçəsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sövdələşmənin detal səhifəsi açılır (məlumat, əlaqə, təkliflər,
            tarixçə və s.).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: axtar, süz və sırala">
        <HelpStep n={1}>
          <p>
            Kanban və ya Siyahıda axtarış xanasına yazın (<em>{"Sövdələşmə axtar…"}</em>).
            Axtarış ada, şirkətə və qeydlərə baxır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Nəticələr canlı süzülür; xananın yanında <strong>tapılan / cəmi</strong>{" "}
            sayğacı çıxır (məs. 8 / 42).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Axtarışın altındakı <strong>mərhələ qabarcıqları</strong>ndan birinə
            basın. <HelpKey>Hamısı</HelpKey> filtri sıfırlayır; hər qabarcıqda o
            mərhələdəki sövdə sayı mötərizədə göstərilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş qabarcıq tündləşir, yalnız həmin mərhələnin sövdələri qalır.
            Eyni qabarcığa təkrar basmaq filtri ləğv edir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sağdakı <strong>sıralama</strong> menyusundan birini seçin: ən
            yenilər, ən köhnələr, məbləğ ↓/↑, ad A→Z, ehtimal ↓ və ya gözlənilən
            bağlanma ↑.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sövdələşmələr seçilmiş qaydaya görə dərhal yenidən sıralanır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Siyahıda birbaşa redaktə et">
        <p>
          <HelpKey>Siyahı</HelpKey> görünüşü cədvəl verir: Ad, Şirkət,
          Sövdələşmə dəyəri, Status (mərhələ), Ehtimal və Gözlənilən bağlanma
          sütunları. Hüceyrələrin çoxu yerindəcə redaktə olunur.
        </p>
        <HelpStep n={1}>
          <p>
            Dəyər, ehtimal və ya tarix hüceyrəsinə basıb yeni dəyər yazın;
            adı dəyişmək üçün ada <strong>iki dəfə klikləyin</strong>, ada bir
            dəfə kliklə isə sövdə səhifəsi açılır. Mərhələni dəyişmək üçün
            Status hüceyrəsindəki rəngli nöqtəni basıb siyahıdan seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahə redaktə rejiminə keçir; saxlananda dəyər yenilənir. Səhv dəyər
            (boş və ya rəqəm deyil) qırmızı bildiriş verir və sahə əvvəlki
            dəyərinə qayıdır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sətir(lər) seçmək üçün sol kənardakı qutucuğu, hamısını seçmək üçün
            başlıqdakı qutucuğu işarələyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yuxarıda <strong>toplu əməliyyatlar paneli</strong> açılır: «Mərhələyə
            köçür…», məsul şəxs seçimi və <HelpKey>Sil</HelpKey>. Başlıq
            qutucuğu seçimə görə üç vəziyyət göstərir — boş / qismən / hamısı.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Paneldən mərhələ seçin, məsul şəxs təyin edin və ya silin. Toplu
            silmə təsdiq pəncərəsi açır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Əməliyyat bitəndə neçə sövdənin dəyişdiyini yazan toast çıxır, seçim
            təmizlənir, cədvəl yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Süzgəc dəstinizi saxlamaq üçün cədvəlin üstündəki{" "}
            <strong>saxlanmış görünüş</strong> zolağından istifadə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cari axtarış, mərhələ filtri, sıralama və boru xətti bir görünüşə
            yığılır; bir kliklə yenidən tətbiq olunur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Da Vinci AI təhlili">
        <HelpStep n={1}>
          <p>
            Nişanların altındakı <HelpKey>Da Vinci analitika</HelpKey> düyməsini
            basın (boru xəttində ən azı bir sövdə olmalıdır).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Aşağıda kart açılır və yüklənmə göstəricisi dönür, sonra boru
            xəttiniz üzrə mətn təhlili görünür. Şəbəkə xətası olarsa, kartda
            qırmızı xəbərdarlıq çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Oxuduqdan sonra kartı sağ yuxarıdakı <HelpKey>×</HelpKey> ilə bağlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Təhlil kartı yığışır; sövdələşmə görünüşünüz olduğu kimi qalır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <strong>Ehtimal</strong> və <strong>gözlənilən bağlanma</strong> ən
          təsirli sahələrdir: Kanbandakı <em>Çəkili</em> zolaq və Proqnoz
          səhifəsi onları oxuyur. Hər sövdədə bu ikisini dürüst saxlayın ki,
          proqnoz da dəqiq olsun.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Sürükləyib mərhələni dəyişmək boru xəttinin keçid qaydalarına tabedir —
          bəzi keçidlər bloklana bilər və qırmızı banner səbəbi yazır. Belə
          halda kart avtomatik əvvəlki sütununa qayıdır; məcbur etməyin,
          tələbləri tamamlayın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün sövdələşmələr təşkilatınızla məhdudlaşır — siz yalnız öz
          tenant-ınızın sövdələrini görür, redaktə edir və silirsiniz. Silmə
          əvvəlcə təsdiq pəncərəsi tələb edir; toplu silmə də seçilmiş sayı
          göstərən təsdiq verir.
        </p>
      </HelpCallout>
    </div>
  )
}
