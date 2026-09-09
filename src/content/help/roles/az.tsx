"use client"

/**
 * Roles & Permissions — help article (Azerbaijani).
 * Tənzimləmələr → Rollar və İcazələr səhifəsini əhatə edir:
 * mövcud rollar (sistem + özəl), rol əlavə etmə/silmə, və modul-üzrə
 * icazə matrisi (Tam / Redaktə / Baxış / Yoxdur dövrü ilə dəyişən).
 * Səhifənin ilk help məqaləsidir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function RolesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Təşkilat administratorusunuz"
        goal="Komandanın hansı rollara bölündüyünü təyin etmək və hər rolun CRM modullarına giriş səviyyəsini idarə etmək"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Rollar və İcazələr</HelpKey> yolu ilə
        çatırsınız. Bütün rollar və icazələr yalnız sizin təşkilatınız üçündür. Rol əlavə etmək, silmək
        və icazələri yadda saxlamaq Tənzimləmələrə yazma hüququ olan administratorlar üçün açıqdır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Rollar və İcazələr</HelpKey> adı, altında «Rol icazələrini və giriş
          səviyyələrini modullar üzrə baxın» izahı, onun da altında «Hər CRM modulu üçün istifadəçi
          rollarını və icazələrini müəyyən edin» ipucusu var. Sağ yuxarıda <HelpKey>Yadda saxla</HelpKey>{" "}
          düyməsi durur — siz matrisdə nəyisə dəyişənə qədər söndürülmüş qalır. Hər hansı dəyişiklik
          edən kimi yanında <HelpKey>Ləğv et</HelpKey> düyməsi peyda olur.
        </p>
        <p>
          Aşağıda iki kart var. Birinci kart — <strong>Mövcud rollar</strong>: bütün rolların rəngli
          nişanları, hər birinin yanında istifadəçi sayı, sağ yuxarısında isə{" "}
          <HelpKey>Rol əlavə et</HelpKey> düyməsi. İkinci kart — icazə matrisi: solda modul sətirləri,
          yuxarıda rol sütunları, kəsişmədə isə dəyişdirilə bilən giriş səviyyəsi düymələri. Matrisin
          başında «Dəyişmək üçün giriş səviyyəsinə klikləyin» qeydi durur.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Rol">Adlı icazə dəsti (məs. Admin, Manager, Agent). Hər istifadəçi bir rola təyin edilir.</HelpDef>
          <HelpDef term="Sistem rolu">Əvvəlcədən qurulmuş rol (Admin, Manager, Agent, Viewer) — yanında qıfıl nişanı olur və silinə bilməz.</HelpDef>
          <HelpDef term="Özəl rol">Sizin əlavə etdiyiniz rol — yanında zibil qutusu nişanı olur və silinə bilər.</HelpDef>
          <HelpDef term="Modul">CRM-in bir bölməsi (Şirkətlər, Sövdələşmələr, Tiketlər, Hesabatlar və s.) — matrisdə hər biri bir sətirdir.</HelpDef>
          <HelpDef term="Giriş səviyyəsi">Bir rolun bir modula icazəsi: Tam, Redaktə, Baxış və ya Yoxdur.</HelpDef>
          <HelpDef term="istifadəçi sayı">Hazırda həmin rola təyin edilmiş istifadəçilərin sayı — rol nişanının yanında göstərilir.</HelpDef>
        </dl>
        <p>
          Giriş səviyyələri dörd dəyər alır: <strong>Tam</strong> (yaşıl, ✓), <strong>Redaktə</strong>{" "}
          (mavi, qələm), <strong>Baxış</strong> (kəhrəba, göz) və <strong>Yoxdur</strong> (boz, ×). Hər
          səviyyə düyməsinə kliklədikcə dəyər bu sıra ilə növbəti dəyərə keçir və <strong>Yoxdur</strong>
          -dan sonra yenidən <strong>Tam</strong>-a qayıdır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: icazələri dəyişib yadda saxla">
        <HelpStep n={1}>
          <p>
            İcazə matrisində dəyişmək istədiyiniz rol sütunu ilə modul sətrinin kəsişməsindəki giriş
            səviyyəsi düyməsini tapın (məs. <strong>Agent</strong> × <strong>Sövdələşmələr</strong>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymənin üstünə gələndə kursor dəyişir və «Dəyişmək üçün giriş səviyyəsinə klikləyin»
            izahı görünür. Düymədə cari səviyyənin ikonası və adı (Tam / Redaktə / Baxış / Yoxdur)
            yazılıb.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Düyməyə klikləyin. Hər klik səviyyəni növbəti dəyərə keçirir: <strong>Tam → Redaktə →
            Baxış → Yoxdur → Tam</strong>. İstədiyiniz səviyyəyə çatana qədər təkrar klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymənin rəngi və ikonası dərhal dəyişir (məs. yaşıl ✓-dən mavi qələmə). Sağ yuxarıdakı{" "}
            <HelpKey>Yadda saxla</HelpKey> düyməsi aktivləşir və yanında <HelpKey>Ləğv et</HelpKey>{" "}
            düyməsi peyda olur — bu, yadda saxlanmamış dəyişikliyiniz olduğunu bildirir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bütün dəyişiklikləri etdikdən sonra sağ yuxarıdakı <HelpKey>Yadda saxla</HelpKey> düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə əvvəlcə «Saxlanılır...», sonra qısa müddətə «Saxlanıldı» ✓ yazısına keçir, ardından
            yenidən söndürülür. Saxlama uğursuz olarsa, səhifənin yuxarısında qırmızı xəta zolağı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Yadda saxlamadan əvvəl fikrinizi dəyişsəniz, <HelpKey>Ləğv et</HelpKey> düyməsini basın — bu,
            matrisi son yadda saxlanmış vəziyyətə qaytarır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bütün dəyişdirilmiş düymələr əvvəlki dəyərlərinə qayıdır, <HelpKey>Ləğv et</HelpKey> düyməsi
            yox olur və <HelpKey>Yadda saxla</HelpKey> yenidən söndürülür.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Admin</strong> rolunun <strong>Parametrlər</strong> moduluna girişi həmişə{" "}
            <strong>Tam</strong>-dır və dəyişdirilə bilməz. Bu xananın üstünə gələndə qıfıl ikonası və
            «Admin həmişə Parametrlərə tam girişə malikdir» izahı görünür — klik işləmir. Bu, özünüzü
            təsadüfən sistemdən kənarlaşdırmağınızın qarşısını alır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni rol əlavə et">
        <HelpStep n={1}>
          <p>
            <strong>Mövcud rollar</strong> kartının sağ yuxarısındakı <HelpKey>Rol əlavə et</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Rol əlavə et» başlıqlı pəncərə açılır. İçində <strong>Rol adı</strong> sahəsi («məs. HR,
            DevOps, Dəstək...» göstərişi ilə) və <strong>Rəng</strong> bölməsi — seçilə bilən rəngli
            nişanlar (Qırmızı, Mavi, Bənövşəyi, Boz, Yaşıl, Çəhrayı, Kəhrəba, Göy-mavi, İndiqo,
            Göl-yaşıl, Narıncı, Kül rəngi) var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Rol adı</strong> yazın və istəsəniz bir <strong>rəng</strong> nişanına klikləyərək
            seçin (standart olaraq Kül rəngi seçilidir).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz rəng nişanının ətrafında halqa görünür. Ad boş və ya çox qısa olduqda aşağıdakı{" "}
            <HelpKey>Rol əlavə et</HelpKey> düyməsi söndürülmüş qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pəncərənin aşağısındakı <HelpKey>Rol əlavə et</HelpKey> düyməsini basın. (Fikrinizi
            dəyişsəniz <HelpKey>Ləğv et</HelpKey> ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Pəncərə bağlanır və yeni rol həm <strong>Mövcud rollar</strong> kartında (yanında «0
            istifadəçi» və zibil qutusu nişanı ilə), həm də matrisdə yeni sütun kimi peyda olur. Yeni
            rol bütün modullara <strong>Baxış</strong> səviyyəsi ilə başlayır (Parametrlər istisna —
            o, <strong>Yoxdur</strong> olur).
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Rol əlavə etmək dərhal yadda saxlanır — bunun üçün ayrıca <HelpKey>Yadda saxla</HelpKey>{" "}
            düyməsinə basmaq lazım deyil. Yeni rolun icazələrini dəqiqləşdirmək üçün isə matrisdə onun
            sütununu redaktə edin və <HelpKey>Yadda saxla</HelpKey> ilə təsdiqləyin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: rolu sil">
        <HelpStep n={1}>
          <p>
            <strong>Mövcud rollar</strong> kartında silmək istədiyiniz özəl rolun yanındakı zibil qutusu
            ikonasına klikləyin. (Sistem rollarında zibil qutusu yerinə qıfıl ikonası olur — onlar
            silinmir.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Rolu sil» başlıqlı təsdiq pəncərəsi açılır və «Bu əməliyyat geri qaytarıla bilməz. &lt;rol
            adı&gt; həmişəlik silinəcək.» mətnini göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Silməni təsdiqləmək üçün <HelpKey>Sil</HelpKey> düyməsini basın (və ya <HelpKey>Ləğv et</HelpKey>{" "}
            ilə imtina edin).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Silinir...» yazısına keçir, sonra pəncərə bağlanır və rol həm kartdan, həm də
            matrisin sütunlarından yox olur.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Hələ də həmin rola təyin edilmiş istifadəçilər varsa, silmə baş tutmur — təsdiq pəncərəsində
            «həmin roldakı N istifadəçi» barədə qırmızı xəta görünür. Əvvəlcə həmin istifadəçiləri{" "}
            <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>İstifadəçilər</HelpKey> bölməsində başqa rola
            keçirin, sonra rolu silin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          İcazə matrisi modullar üzrə qruplaşdırılıb (CRM, Satış, Marketinq, Kommunikasiya, Dəstək,
          Maliyyə və s.) — soldakı sütun bütün modul sətirlərini, yuxarıdakı sətir isə bütün rolları
          göstərir. Bir rolun hansı modula nə qədər giriş verdiyini bir baxışda görmək üçün həmin rolun
          sütununu yuxarıdan aşağı izləyin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün rollar və icazələr təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın rollarını
          görür və dəyişirsiniz. Rol əlavə etmə, silmə və icazələrin yadda saxlanması Tənzimləmələrə
          yazma hüququ olan administratorlar tərəfindən aparılır; bu hüquq olmadan dəyişikliklər
          serverdə qəbul edilmir.
        </p>
      </HelpCallout>
    </div>
  )
}
