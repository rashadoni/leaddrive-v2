"use client"

/**
 * Field Permissions — help article (Azerbaijani).
 * "users-permissions" birgə məqaləsindən ayrılıb: yalnız
 * Tənzimləmələr → Sahə İcazələri səhifəsini əhatə edir
 * (sahə icazələri matrisi: rol × sahə üzrə Redaktə/Görünür/Gizli,
 * və paylaşma qaydaları). İstifadəçi/rol idarəetməsi bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function FieldPermissionsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Administrator və ya təhlükəsizlik üzrə məsulsunuz"
        goal="Hansı rolun hansı sahəni görəcəyini və ya redaktə edəcəyini təyin etmək, eləcə də qeydlərin rollar arasında paylaşılması qaydalarını qurmaq"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Sahə İcazələri</HelpKey> yolu ilə
        çatırsınız. Bütün icazələr və paylaşma qaydaları yalnız sizin təşkilatınız üçündür.{" "}
        <strong>Admin</strong> rolu həmişə tam giriş hüququna malikdir və onu dəyişmək olmur —
        siz qalan rolları (Menecer, Satış, Dəstək, İzləyici) tənzimləyirsiniz.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Sahə İcazələri</HelpKey> adı və altında «Hər rola görə sahələrin
          görünüşünü və redaktə imkanını idarə edin. Admin həmişə tam giriş hüququna malikdir»
          izahı var. Aşağıda iki kart durur: əvvəlcə{" "}
          <strong>Sahə İcazələri Matrisi</strong>, sonra <strong>Paylaşma Qaydaları</strong>.
        </p>
        <p>
          Matris kartının başında qalxan ikonası ilə «Sahə İcazələri Matrisi» başlığı, sağında isə
          obyekt növünü seçmək üçün açılan siyahı var (Şirkətlər, Kontaktlar, Sövdələşmələr, Lidlər,
          Müraciətlər). Cədvəlin sol sütunu <strong>Sahə</strong> adlarını, qalan sütunlar isə beş
          rolu göstərir: <strong>Admin</strong>, <strong>Menecer</strong>, <strong>Satış</strong>,{" "}
          <strong>Dəstək</strong>, <strong>İzləyici</strong>. Hər xananın içində o rolun həmin sahəyə
          girişini göstərən rəngli düymə durur.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Obyekt növü">İcazələrin tənzimləndiyi qeyd tipi — açılan siyahıdan seçilir (Şirkətlər, Kontaktlar, Sövdələşmələr, Lidlər, Müraciətlər). Hər növün öz sahə dəsti var.</HelpDef>
          <HelpDef term="Sahə">Seçilmiş obyektin bir məlumat sahəsi (məs. Telefon, E-poçt, İllik gəlir). Cədvəlin hər sətri bir sahədir.</HelpDef>
          <HelpDef term="Redaktə">Yaşıl düymə — rol bu sahəni görür VƏ dəyişə bilər.</HelpDef>
          <HelpDef term="Görünür">Mavi düymə — rol bu sahəni yalnız oxuya bilir, dəyişə bilmir.</HelpDef>
          <HelpDef term="Gizli">Qırmızı düymə — rol bu sahəni ümumiyyətlə görmür.</HelpDef>
          <HelpDef term="həssas">Bəzi sahələrin yanındakı kiçik nişan — bu sahənin həssas məlumat olduğunu bildirir (məs. Telefon, E-poçt, İllik gəlir, VÖEN).</HelpDef>
          <HelpDef term="Paylaşma Qaydası">Bir rolun qeydlərinin başqa bir rola (və ya bütün istifadəçilərə) hansı səviyyədə açılacağını təyin edən qayda. Defolt olaraq istifadəçilər yalnız öz qeydlərini görür.</HelpDef>
        </dl>
        <p>
          Paylaşma Qaydaları kartının başında «Paylaşma Qaydaları» başlığı və sağda{" "}
          <HelpKey>Yeni Qayda</HelpKey> düyməsi var. Hələ qayda yoxdursa, kartda «Paylaşma qaydası
          konfiqurasiya edilməyib. Defolt olaraq istifadəçilər yalnız öz qeydlərini görürlər» mətni
          göstərilir. Qaydalar əlavə edildikdə hər biri ad, obyekt növü → rol-rol → giriş səviyyəsi
          xülasəsi və sağda üç idarəetmə ilə sıralanır: aktiv/qeyri-aktiv açarı, redaktə (qalxan
          ikonası) və sil (zibil qutusu ikonası).
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: sahə icazəsini dəyiş">
        <HelpStep n={1}>
          <p>
            Matris kartının sağ yuxarısındakı açılan siyahıdan <HelpKey>Obyekt növü</HelpKey> seçin
            (məs. <HelpKey>Şirkətlər</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl seçdiyiniz növün sahələri ilə yenidən yüklənir. Yüklənərkən qısa müddət fırlanan
            yükləmə nişanı görünür, sonra hər sətirdə bir sahə adı və beş rol sütunu peyda olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Dəyişmək istədiyiniz <strong>sahə</strong> sətrini və <strong>rol</strong> sütununu
            tapın, sonra həmin xanadakı rəngli düyməni basın. Hər basışda giriş səviyyəsi növbə ilə
            dəyişir: <strong>Redaktə</strong> → <strong>Görünür</strong> → <strong>Gizli</strong> →
            yenidən Redaktə.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymənin yazısı və rəngi dərhal dəyişir (yaşıl «Redaktə», mavi «Görünür», qırmızı
            «Gizli»). Dəyişdirdiyiniz xana ətrafında nazik çərçivə (ring) görünür ki, hələ yadda
            saxlanmamış dəyişiklikləri seçə biləsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Ən azı bir dəyişiklik edən kimi kartın yuxarısında, obyekt seçimi yanında iki düymə
            görünür: <HelpKey>Defoltları bərpa et</HelpKey> və <HelpKey>Yadda saxla</HelpKey>.
            Dəyişiklikləri saxlamaq üçün <HelpKey>Yadda saxla</HelpKey> basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Yadda saxla</HelpKey> düyməsi yadda saxlanarkən fırlanan nişana keçir. Bitdikdə
            xanaların ətrafındakı çərçivələr yox olur — yəni dəyişikliklər artıq qeydə alınıb.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Etdiyiniz seçimləri yadda saxlamadan ləğv etmək istəsəniz,{" "}
            <HelpKey>Defoltları bərpa et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxlanmamış bütün dəyişikliklər ləğv olunur, xanalar əvvəlki vəziyyətə qayıdır və hər iki
            düymə (Bərpa et / Yadda saxla) yenidən gizlənir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Admin</strong> sütunu həmişə tam giriş hüququndadır və onun xanaları sönükdür —
            onlara klik etmək mümkün deyil. İcazələri yalnız Menecer, Satış, Dəstək və İzləyici
            rolları üçün dəyişə bilərsiniz.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: paylaşma qaydası yarat">
        <HelpStep n={1}>
          <p>
            Paylaşma Qaydaları kartının sağ yuxarısındakı <HelpKey>Yeni Qayda</HelpKey> düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni Paylaşma Qaydası» başlıqlı pəncərə açılır. İçində <strong>Ad</strong>,{" "}
            <strong>Obyekt növü</strong>, <strong>Qayda növü</strong>, <strong>Giriş səviyyəsi</strong>{" "}
            və <strong>Təsvir</strong> sahələri var; hər sahənin altında qısa izah göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Ad</strong> yazın (məs. «Menecerlər satış sövdələşmələrini görür») və{" "}
            <strong>Obyekt növü</strong> seçin — bu qaydanın hansı tipli qeydlərə tətbiq olunacağını
            bildirir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ad sahəsində yazdıqca mətn görünür. Ad boşdursa, aşağıdakı <HelpKey>Yadda saxla</HelpKey>{" "}
            düyməsi sönük qalır və qaydanı saxlamağa imkan vermir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Qayda növü</strong> seçin: <HelpKey>Yalnız sahib</HelpKey> (hər kəs yalnız öz
            qeydini görür), <HelpKey>Rol → Rol</HelpKey> (bir rolun qeydləri başqa rola açılır) və ya{" "}
            <HelpKey>Bütün istifadəçilər</HelpKey> (qeydlər hamıya görünür).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>Rol → Rol</HelpKey> seçdikdə pəncərədə iki əlavə sahə peyda olur:{" "}
            <strong>Mənbə Rol</strong> («Kimin qeydləri paylaşılacaq?») və <strong>Hədəf Rol</strong>{" "}
            («Kim giriş əldə edəcək?»). Hər iki açılan siyahıda Admin-dən başqa rollar sadalanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <strong>Giriş səviyyəsi</strong> seçin — <HelpKey>Yalnız oxu</HelpKey> və ya{" "}
            <HelpKey>Oxu və yaz</HelpKey>. İstəsəniz qısa <strong>Təsvir</strong> də əlavə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər seçimin altında izahedici mətn dəyişir. Təsvir sahəsi istəyə bağlıdır və boş qala
            bilər.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Pəncərənin altındakı <HelpKey>Yadda saxla</HelpKey> düyməsini basın. (Fikrinizi
            dəyişsəniz — <HelpKey>Ləğv et</HelpKey> ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Pəncərə bağlanır və yeni qayda Paylaşma Qaydaları siyahısında peyda olur — adı, obyekt
            növü, rol-rol (və ya «Bütün istifadəçilər») və giriş səviyyəsi xülasəsi ilə.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: qaydanı aktivləşdir, redaktə et və ya sil">
        <HelpStep n={1}>
          <p>
            Qaydanı müvəqqəti söndürmək və ya yenidən işə salmaq üçün onun sətrindəki{" "}
            <HelpKey>aktiv/qeyri-aktiv açarını</HelpKey> basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açar vəziyyəti dəyişir — aktiv olduqda yaşıl rəngdə sağa, qeyri-aktiv olduqda boz rəngdə
            sola çevrilmiş görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Qaydanı dəyişmək üçün sətirdəki qalxan ikonalı (<HelpKey>Redaktə</HelpKey>) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Qaydanı redaktə et» başlıqlı, mövcud ad, obyekt növü, qayda növü, rollar, giriş səviyyəsi
            və təsvir ilə əvvəlcədən doldurulmuş eyni forma açılır. Dəyişikliyi edib{" "}
            <HelpKey>Yadda saxla</HelpKey> ilə təsdiqləyin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Qaydanı silmək üçün sətirdəki qırmızı zibil qutusu ikonalı (<HelpKey>Sil</HelpKey>)
            düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Qaydanı sil» təsdiq pəncərəsi açılır və «Bu paylaşma qaydasını silmək istədiyinizə
            əminsiniz?» soruşulur. Təsdiqlədikdən sonra qayda siyahıdan çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Matris dəyişiklikləri yalnız <HelpKey>Yadda saxla</HelpKey> basanda qeydə alınır — bir neçə
          sahəni bir-bir vurub topluca saxlaya bilərsiniz. Səhv etsəniz, hələ saxlamadan{" "}
          <HelpKey>Defoltları bərpa et</HelpKey> ilə hər şeyi geri qaytarın. Obyekt növünü dəyişsəniz
          də, saxlanmamış dəyişikliklər ləğv olunur.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün sahə icazələri və paylaşma qaydaları təşkilatınızla məhdudlaşır — yalnız öz
          tenant-ınızın rollarına təsir edir. <strong>Admin</strong> rolu bütün sahələrə həmişə tam
          giriş hüququndadır və matrisdə dəyişdirilə bilməz; <strong>həssas</strong> nişanlı sahələrə
          (Telefon, E-poçt, İllik gəlir, VÖEN və s.) icazə verərkən xüsusilə diqqətli olun. Heç bir
          paylaşma qaydası qurulmasa, defolt davranış belədir: istifadəçilər yalnız öz qeydlərini
          görür.
        </p>
      </HelpCallout>
    </div>
  )
}
