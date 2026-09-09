"use client"

/**
 * Contract Editor — help article (Azerbaijani).
 * Yalnız müqavilə mətn redaktoru səhifəsini (/contracts/[id]/editor) əhatə edir:
 * 3 panelli görünüş (sol Mündəricat, mərkəz mətn kətanı, sağ Dəyişənlər),
 * formatlama paneli, avtomatik saxlama, dəyişən doldurma, PDF ixracı, .docx idxalı,
 * yalnız-oxu vəziyyətləri (terminal status / imzalama gedir). Müqavilə kartının
 * özünün (status dəyişmə, imzalama başlatma) idarəsi bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ContractEditorHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Müqavilələrlə işləyən hüquqşünas, satış və ya əməliyyat işçisisiniz"
        goal="Müqavilə mətnini birbaşa brauzerdə yazmaq, formatlamaq, yer tutucu dəyişənləri doldurmaq və PDF kimi ixrac etmək"
      >
        Bu səhifəyə müqavilə kartından — <HelpKey>Redaktə et</HelpKey> (mətn redaktoru)
        düyməsi ilə çatırsınız; ünvanı <HelpKey>/contracts/&lt;id&gt;/editor</HelpKey> kimidir.
        Yazdığınız hər şey təşkilatınıza aiddir. <strong>Heç bir «Saxla» düyməsi yoxdur</strong>:
        dayanan kimi mətn avtomatik saxlanılır. Müqavilə artıq qəti statusdadırsa (məs. «İcra
        olunub») və ya imzalama gedirsə, kətan yalnız-oxu olur — yuxarıda sarı zolaq bunu bildirir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Səhifə tam ekranlı redaktordur, üç hissədən ibarətdir. <strong>Yuxarı zolaqda</strong>{" "}
          sola ox (<HelpKey>Müqaviləyə qayıt</HelpKey>), müqavilənin başlığı, status nişanı,
          (varsa) sarı «doldurulmayıb» nişanı, saxlama göstəricisi, <HelpKey>Hazır</HelpKey>{" "}
          düyməsi və üç nöqtəli <HelpKey>Əlavə əməliyyatlar</HelpKey> menyusu durur. Altda{" "}
          <strong>formatlama paneli</strong>, daha aşağıda isə üç panel var:{" "}
          <strong>Mündəricat</strong> (sol), <strong>mətn kətanı</strong> (mərkəz) və{" "}
          <strong>Dəyişənlər</strong> (sağ). Sol və sağ panellər yalnız geniş ekranda görünür;
          dar ekranda sadəcə kətan qalır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Saxlama göstəricisi">
            Yuxarıdakı kiçik mətn: yazarkən «Saxlanılır…», dayananda «Bütün dəyişikliklər
            saxlanıldı», nasazlıqda isə qırmızı «Saxlanılmadı».
          </HelpDef>
          <HelpDef term="Mündəricat">
            Sol panel — mətndəki başlıqların (H1/H2/H3) siyahısı. Hər birinə basanda kətan həmin
            başlığa sıçrayır. Başlıq yoxdursa «Mündəricat üçün başlıqlar əlavə edin.» yazılır.
          </HelpDef>
          <HelpDef term="Dəyişənlər (yer tutucular)">
            Sağ panel — mətndəki doldurulmamış <HelpKey>{"{{ad}}"}</HelpKey> kimi tokenlər. Hər
            birinə dəyər yazıb birdəfəlik əvəz edə bilərsiniz. Belə token yoxdursa panel boş izah
            göstərir.
          </HelpDef>
          <HelpDef term="«doldurulmayıb» nişanı">
            Başlıqdakı sarı nişan və sağ paneldəki say — neçə dəyişənin hələ doldurulmadığını
            göstərir. Doldurulmamış dəyişənlər «Təsdiqə göndər» əməliyyatını bloklayır.
          </HelpDef>
          <HelpDef term="Formatlama paneli">
            Geri al/təkrarla, qalın/kursiv/altıxətli, başlıqlar, siyahılar, sitat, kod, ayırıcı,
            düzləmə, alt/üst indeks, keçid, marker, şəkil, formatı təmizlə və cədvəl alətləri; sağ
            kənarda söz/simvol sayğacı.
          </HelpDef>
          <HelpDef term="Yalnız-oxu zolağı">
            Kilid ikonalı sarı zolaq — müqavilə qəti statusdadırsa və ya imzalama gedirsə çıxır;
            bu halda kətan və alətlər redaktə üçün bağlı olur.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: mətni yazmaq və formatlamaq">
        <HelpStep n={1}>
          <p>
            Mərkəzdəki ağ vərəqə (kətana) klikləyib mətni yazmağa başlayın. Boş kətanda «Müqavilə
            mətnini yazmağa başlayın…» yazısı görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca yuxarıdakı göstərici «Saxlanılır…» olur, bir-iki saniyə dayandıqdan sonra isə
            yaşıl tik ilə «Bütün dəyişikliklər saxlanıldı»ya keçir. Sağdakı söz/simvol sayğacı da
            yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Mətni seçib formatlama panelindən düymələrlə bəzəyin:{" "}
            <HelpKey>Qalın</HelpKey>, <HelpKey>Kursiv</HelpKey>, <HelpKey>Altıxətli</HelpKey>,{" "}
            <HelpKey>Başlıq 1/2/3</HelpKey>, markerli/nömrəli siyahı, <HelpKey>Sitat</HelpKey>,
            düzləmə və s. Səhv etsəniz <HelpKey>Geri al (⌘Z)</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Aktiv format düyməsi vurğulanır (mavi fonla). Başlıq əlavə edən kimi o, sol{" "}
            <strong>Mündəricat</strong> siyahısında peyda olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Cədvəl lazımdırsa <HelpKey>Cədvəl əlavə et</HelpKey> ikonasını basın (3×3 başlıq
            sətirli cədvəl qoyulur). Sonra <HelpKey>Cədvəl seçimləri</HelpKey> menyusu ilə sətir/sütun
            əlavə edin və ya silin — bu menyu yalnız kursor cədvəlin içində olanda aktivdir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kətana 3 sətir × 3 sütunluq cədvəl daxil olur. <HelpKey>Cədvəl seçimləri</HelpKey>{" "}
            açanda «Aşağıya sətir əlavə et», «Sağa sütun əlavə et», «Cədvəli sil» kimi seçimlər
            görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Keçid əlavə etmək üçün mətni seçib <HelpKey>Keçid</HelpKey> ikonasını basın, açılan
            balaca pəncərədə ünvanı (<HelpKey>https://…</HelpKey>) yazıb <HelpKey>Tətbiq et</HelpKey>{" "}
            edin. Şəkil üçün isə <HelpKey>Şəkil əlavə et</HelpKey> ilə kompüterdən fayl seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Keçid pəncərəsinin altında «İcazə verilən: http, https, mailto — qalanı yadda saxlanarkən
            silinir» ipucusu durur; başqa protokol yazsanız «Yalnız http(s) və mailto keçidlərinə
            icazə verilir» xətası çıxır. Şəkil 5 MB-dan böyükdürsə «Şəkil çox böyükdür. Maks. 5MB»
            mesajı göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: dəyişənləri (yer tutucuları) doldurmaq">
        <HelpStep n={1}>
          <p>
            Şablon mətndə <HelpKey>{"{{müştəri_adı}}"}</HelpKey> kimi tokenlər varsa, onlar sağdakı{" "}
            <strong>Dəyişənlər</strong> panelində avtomatik sadalanır. Hər tokenin altındakı sahəyə
            uyğun dəyəri yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Başlıqda və sağ panelin başında neçə dəyişənin doldurulmadığını göstərən nişan var.
            Belə token yoxdursa, panel «Bu müqavilədə yoxdur — doldurulacaq bir şey yoxdur.» yazır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bir neçə dəyər yazdıqdan sonra panelin altındakı <HelpKey>Doldur</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Dəyər yazılmış tokenlər mətndə həqiqi dəyərlərlə əvəz olunur və paneldən yox olur; saxlama
            göstəricisi yenidən işə düşür. Token format (məs. yarısı qalın) ilə bölünübsə, «Avtodoldurma
            alınmadı (bölünmüş format?)» xəbərdarlığı çıxır və həmin dəyəri əlbəəl yerləşdirmək lazım gəlir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: ixrac, idxal və naviqasiya">
        <HelpStep n={1}>
          <p>
            Sol <strong>Mündəricat</strong> siyahısında istənilən başlığa basın — uzun müqavilədə
            tez naviqasiya üçün.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kətan həmin başlığa sürüşür və kursor oraya keçir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sağ yuxarıdakı üç nöqtəli (<HelpKey>Əlavə əməliyyatlar</HelpKey>) menyunu açın. İçində{" "}
            <HelpKey>Müqaviləni aç</HelpKey>, <HelpKey>PDF ixrac et</HelpKey> və{" "}
            <HelpKey>.docx idxal et</HelpKey> var.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>PDF ixrac et</HelpKey> serverdə hazırlanan PDF-i yeni nişanda açır. Brauzer
            pop-up-u bloklayırsa, «Brauzer PDF pəncərəsini blokladı — pop-up-lara icazə verin və
            yenidən cəhd edin.» mesajı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Hazır Word sənədindən başlamaq üçün <HelpKey>.docx idxal et</HelpKey> seçin və faylı
            göstərin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Müqavilə mətni əvəz edilsin?» təsdiq pəncərəsi açılır — idxalın cari mətni əvəz edəcəyini,
            cari versiyanın isə tarixçədə qalacağını izah edir. Təsdiqlədikdən sonra «İdxal edilir…»
            göstərilir, sonra yeni mətn kətana yüklənir və «İdxal edildi — versiya N» bildirişi çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Bitirdikdə <HelpKey>Hazır</HelpKey> düyməsi (və ya sola ox) ilə müqavilə kartına qayıdın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sistem əvvəlcə son dəyişiklikləri saxlayır, sonra müqavilə səhifəsinə qaytarır. Son saxlama
            alınmasa, «Dəyişikliklər saxlanılmayıb» pəncərəsi çıxır: <HelpKey>Qal</HelpKey> (səhifədə
            qal) və ya <HelpKey>Yenə də çıx</HelpKey> (düzəlişləri itirərək çıx) seçimləri verir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          «Saxla» düyməsi axtarmayın — yazmağı dayandıran kimi avtomatik saxlanılır. Yuxarıdakı yaşıl
          tik və «Bütün dəyişikliklər saxlanıldı» mətni işin saxlandığını təsdiqləyir. Brauzer
          nişanının başlığı da müqavilənin nömrəsini (varsa) göstərir ki, bir neçə nişanda işləyəndə
          dolaşmayasınız.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <HelpKey>.docx idxal et</HelpKey> <strong>cari mətni tamamilə əvəz edir</strong> (köhnə
          versiya tarixçədə qalır). Doldurulmamış dəyişənlər qalıbsa, müqaviləni{" "}
          <strong>«Təsdiqə göndər»</strong> əməliyyatı bloklanır — əvvəlcə hamısını doldurun. Saxlama
          göstəricisi qırmızı «Saxlanılmadı» olarsa, çıxmazdan əvvəl problemi həll edin; əks halda son
          düzəlişlər itə bilər.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün müqavilə mətni, versiyalar və yüklənən şəkillər təşkilatınızla məhdudlaşır — başqa
          tenant-ın məzmununu görmürsünüz. Keçidlərdə yalnız <HelpKey>http</HelpKey>,{" "}
          <HelpKey>https</HelpKey> və <HelpKey>mailto</HelpKey> protokollarına icazə verilir; digərləri
          yadda saxlanarkən silinir. Müqavilə qəti statusda olanda və ya imzalama gedəndə kətan
          avtomatik kilidlənir — bu, imzalanmış mətnin təsadüfən dəyişməsinin qarşısını alır.
        </p>
      </HelpCallout>
    </div>
  )
}
