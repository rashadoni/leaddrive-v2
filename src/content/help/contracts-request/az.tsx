"use client"

/**
 * Müqavilə sorğusu — kömək məqaləsi (Azərbaycan dili).
 * Yalnız Müqavilələr → Müqavilə sorğusu səhifəsini əhatə edir
 * (/contracts/request): sorğu formasının seçilməsi və doldurulması,
 * göndərmə, uğur ekranı və rola bağlı «Sorğular növbəsi» nişanı.
 * Müqavilə yaratma/redaktə və ya admin form-builder bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ContractsRequestHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Müqaviləyə ehtiyacı olan əməkdaşsınız (satış, alış və ya əməliyyat) və ya sorğuları emal edən menecer/administratorsunuz"
        goal="Hazır sorğu formasını doldurub qaralama müqavilə yaratmaq və komandaya bildiriş göndərmək"
      >
        Səhifəyə <HelpKey>Müqavilələr</HelpKey> siyahısından açılan{" "}
        <HelpKey>Müqavilə sorğusu</HelpKey> səhifəsi ilə çatırsınız. Sol yuxarıdakı geri ox müqavilələr
        siyahısına qaytarır. Doldurduğunuz formanın özünü administrator əvvəlcədən qurur — siz yalnız
        mövcud formalardan birini seçib suallara cavab verirsiniz. Bütün formalar və göndərilən sorğular
        yalnız sizin təşkilatınıza aiddir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda fayl-giriş ikonası ilə <HelpKey>Müqavilə sorğusu</HelpKey> adı, altında isə «Formu
          doldurun, komanda bildiriş alacaq və müraciəti emal edəcək» izahı durur. Adi istifadəçi üçün
          səhifə birbaşa sorğu formasını göstərir. Əgər roluunz <strong>superadmin</strong>,{" "}
          <strong>admin</strong> və ya <strong>menecer</strong>dirsə, başlığın altında iki nişanlı zolaq
          görünür: <HelpKey>Sorğu göndər</HelpKey> və <HelpKey>Sorğular növbəsi</HelpKey>.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Sorğu növü">Açılan siyahı — administratorun yaratdığı aktiv sorğu formalarından birini seçirsiniz; ad yanında, varsa, mötərizədə müqavilə tipi göstərilir.</HelpDef>
          <HelpDef term="Sual">Seçdiyiniz formanın hər bir sahəsi — mətn, uzun mətn, rəqəm, tarix və ya açılan seçim ola bilər. Məcburi sual adının yanında qırmızı ulduz (*) olur.</HelpDef>
          <HelpDef term="Sorğu göndər">Cavabları təqdim edən düymə — qaralama müqavilə yaradır və komandaya bildiriş göndərir.</HelpDef>
          <HelpDef term="Qaralama müqavilə">Sorğunuzdan avtomatik yaranan müqavilə qeydi; uğur ekranından birbaşa açıla bilər.</HelpDef>
          <HelpDef term="Sorğular növbəsi">Yalnız menecer/admin görür — təşkilatda göndərilmiş bütün sorğuların siyahısı, vəziyyət nişanı ilə.</HelpDef>
        </dl>
        <p>
          Aktiv forma yoxdursa, formanın yerinə «Aktiv sorğu forması yoxdur. İdarəçiyə müraciət edin.»
          mesajı göstərilir. Bu halda administratordan ən azı bir aktiv forma qurmasını xahiş edin.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: sorğu göndər">
        <HelpStep n={1}>
          <p>
            (Menecer/admininizsə) yuxarıdakı zolaqda <HelpKey>Sorğu göndər</HelpKey> nişanının seçili
            olduğuna əmin olun. Adi istifadəçi üçün forma onsuz da birbaşa açıqdır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kartın yuxarısında <strong>Sorğu növü</strong> başlıqlı açılan siyahı görünür, içində «Sorğu
            növünü seçin...» yazısı durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Sorğu növü</strong> açılan siyahısından bir forma seçin (məs. uyğun müqavilə tipinə
            görə adlandırılmış forma).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Formanın altında, varsa, qısa izahı çıxır, ardınca həmin formaya aid suallar bir-bir
            görünür. Hər sualın növünə uyğun sahə yaranır: adi mətn xanası, çoxsətirli xana, yalnız rəqəm
            qəbul edən xana, tarix seçici və ya «Seçin...» ilə başlayan açılan siyahı.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sualları doldurun. Adının yanında qırmızı <strong>*</strong> olan sahələr məcburidir; açılan
            seçim sualında variantlardan birini seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca cavablar müvafiq sahələrdə görünür. Rəqəm sualı yalnız ədəd, tarix sualı isə tarix
            seçicisini qəbul edir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Aşağıdakı tam enli <HelpKey>Sorğu göndər</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymədə fırlanan göstərici (spinner) yaranır və düymə müvəqqəti deaktiv olur. Uğurlu olarsa,
            səhifə yaşıl təsdiq işarəli uğur ekranına keçir; xəta olarsa, yuxarıda qırmızı «Göndərmə
            xətası. Cavablarınızı yoxlayın.» zolağı çıxır və forma açıq qalır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: göndərmədən sonra nə olur">
        <HelpStep n={1}>
          <p>
            Sorğu uğurla göndəriləndən sonra uğur ekranına baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ortada yaşıl təsdiq dairəsi, altında «Sorğu göndərildi!» başlığı və «Qaralama müqavilə
            yaradıldı və komanda bildirildi.» mətni görünür. Sorğu avtomatik təsdiqə yönləndirilibsə,
            əlavə bir sətirdə neçə mərhələyə göndərildiyi yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İki düymədən birini seçin: <HelpKey>Bütün müqavilələr</HelpKey> siyahıya qaytarır,{" "}
            <HelpKey>Qaralamaya bax</HelpKey> isə yeni yaranan qaralama müqaviləni açır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Qaralamaya bax</HelpKey> sizi həmin müqavilənin səhifəsinə aparır;{" "}
            <HelpKey>Bütün müqavilələr</HelpKey> isə müqavilələr siyahısını açır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: sorğular növbəsini yoxla (menecer/admin)">
        <HelpStep n={1}>
          <p>
            Yuxarıdakı zolaqda <HelpKey>Sorğular növbəsi</HelpKey> nişanını (gələnlər qutusu ikonası)
            basın. Bu nişan yalnız superadmin, admin və menecerlərə görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Forma əvəzinə göndərilmiş sorğuların kart-siyahısı yüklənir (ən son 50 ədəd). Hələ heç bir
            sorğu yoxdursa, «Hələ sorğu yoxdur.» mesajı görünür; yükləmə alınmasa, qırmızı xəta zolağı
            çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Hər kartı oxuyun: forma adı (varsa mötərizədə müqavilə tipi), göndərilmə tarix-saatı və kim
            tərəfindən göndərildiyi göstərilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kartın sağında vəziyyət nişanı durur — <strong>pending</strong> (gözləmədə),{" "}
            <strong>processing</strong> (emalda), <strong>completed</strong> (tamamlandı) və ya{" "}
            <strong>rejected</strong> (rədd edildi). Nişanın rəngi vəziyyətə görə dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bağlı müqavilə varsa, kartdakı düymə ilə ona keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Müqavilə yaradılıbsa, kartda onun nömrəsini göstərən düymə (nömrə yoxdursa «Qaralamaya bax»)
            olur; basanda həmin müqavilənin səhifəsi açılır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Sorğunun mahiyyəti odur ki, müqaviləni sıfırdan qurmaq əvəzinə hazır formanı doldurursunuz —
          sistem qalanını avtomatik edir: qaralama müqaviləni yaradır, komandaya bildiriş göndərir və
          forma belə qurulubsa onu təsdiq mərhələlərinə yönləndirir. Doğru formanı tapa bilmirsinizsə,
          administratordan sizə uyğun forma əlavə etməsini xahiş edin.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <HelpKey>Sorğu göndər</HelpKey> yalnız siz <strong>Sorğu növü</strong> seçdikdən sonra
          görünür — forma seçilməyincə suallar və göndərmə düyməsi gəlmir. Göndərmə xətası alsanız,
          məcburi (*) sahələrin doldurulduğunu və cavabların düzgün olduğunu yoxlayıb yenidən cəhd edin;
          forma və yazdıqlarınız itmir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün sorğu formaları və göndərilən sorğular təşkilatınızla məhdudlaşır — başqa tenant-ın
          formalarını və ya sorğularını görmürsünüz. <HelpKey>Sorğular növbəsi</HelpKey> nişanı yalnız
          superadmin, admin və menecer rollarına açıqdır; adi istifadəçi yalnız formanı görür və öz
          sorğusunu göndərir.
        </p>
      </HelpCallout>
    </div>
  )
}
