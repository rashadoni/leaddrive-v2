"use client"

/**
 * Users — help article (Azerbaijani).
 * "users-permissions" birgə məqaləsindən ayrılıb: yalnız
 * Tənzimləmələr → İstifadəçilər səhifəsini əhatə edir
 * (hesab yaratma/redaktə, rol, şöbə, telefon, statistika kartları,
 * cədvəl sütunları, aktivlik/mövcudluq açarları, 2FA pilləri, silmə).
 * "Sahə icazələri" (rol üzrə sahə matrisi) bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function UsersHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Administrator və ya komanda rəhbərisiniz"
        goal="CRM-ə kimin daxil olduğunu idarə etmək — yeni hesab yaratmaq, rol və şöbə təyin etmək, hesabı aktiv/qeyri-aktiv etmək, 2FA və dəstək parametrlərini tənzimləmək"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>İstifadəçilər</HelpKey> yolu ilə çatırsınız.
        Bütün hesablar yalnız sizin təşkilatınıza aiddir. Başlıqda istifadəçilərin cari sayı mötərizədə
        göstərilir, altında isə «CRM istifadəçi hesablarını, rolları və giriş icazələrini idarə edin»
        izahı durur. Dəyişiklik etdikcə yuxarıdakı statistika kartları dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>İstifadəçilər ({"{"}count{"}"})</HelpKey> (mötərizədə cari say), sağ yuxarıda{" "}
          <HelpKey>Əlavə et</HelpKey> düyməsi var. Altda dörd statistika kartı durur: <strong>Cəmi</strong>,{" "}
          <strong>Aktiv</strong>, <strong>Qeyri-aktiv</strong> və <strong>Adminlər</strong>. Onların
          altında axtarış sahəsi olan istifadəçi cədvəli gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Cəmi">Təşkilatdakı bütün istifadəçilərin sayı.</HelpDef>
          <HelpDef term="Aktiv">Hesabı aktiv olan (daxil ola bilən) istifadəçilərin sayı.</HelpDef>
          <HelpDef term="Qeyri-aktiv">Hesabı söndürülmüş istifadəçilərin sayı.</HelpDef>
          <HelpDef term="Adminlər">Rolu «Admin» olan istifadəçilərin sayı.</HelpDef>
          <HelpDef term="Rol">İstifadəçinin icazə səviyyəsi — sistem rolları: Admin, Menecer, Agent, Müşahidəçi; təşkilatınızın yaratdığı xüsusi rollar da siyahıda görünə bilər.</HelpDef>
          <HelpDef term="Mövcud (Available)">Dəstək agentinin yeni bilet qəbul edib-etmədiyini göstərən yaşıl/boz açar — avtomatik bilet yönləndirməsi üçündür.</HelpDef>
          <HelpDef term="Status">Hesabın aktiv/qeyri-aktiv vəziyyəti — nişana klikləməklə dərhal dəyişir.</HelpDef>
          <HelpDef term="2FA">İki mərhələli doğrulama vəziyyəti — TOTP və SMS pilləri (✓ = qurulub) və «2FA tələb et» açarı.</HelpDef>
        </dl>
        <p>
          Cədvəlin sütunları: <strong>İstifadəçi</strong> (ad və altında e-poçt), <strong>Rol</strong>{" "}
          (rəngli nişan + ikona), <strong>Şöbə</strong>, <strong>Bacarıqlar</strong> (yoxdursa «—»),{" "}
          <strong>Max</strong> (eyni vaxtda maks. bilet sayı), <strong>Mövcud</strong> (açar),{" "}
          <strong>Status</strong> (Aktiv/Qeyri-aktiv nişanı), <strong>Son giriş</strong> (tarix-saat və ya
          «Heç vaxt»), <strong>2FA</strong> (TOTP/SMS pilləri + tələb açarı) və sonda redaktə (qələm) ilə
          sil (zibil qutusu) düymələri. Yuxarıda <strong>«İstifadəçi axtar…»</strong> sahəsi ad üzrə
          süzgəcdən keçirir; sütun başlıqlarına klikləməklə çeşidləmək olur.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni istifadəçi əlavə et">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Əlavə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «İstifadəçi əlavə et» başlıqlı pəncərə açılır. İçində <strong>Ad *</strong>,{" "}
            <strong>Email *</strong>, <strong>Şifrə *</strong>, <strong>Rol</strong>, <strong>Şöbə</strong>,{" "}
            <strong>Telefon</strong> sahələri və ən altda <strong>Aktiv</strong> qeyd qutusu (standart
            olaraq işarələnmiş) var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Ad</strong>, <strong>Email</strong> və <strong>Şifrə</strong> yazın — bu üçü
            məcburidir. Şifrə ən azı 12 simvoldan, böyük və kiçik hərfdən, rəqəmdən və xüsusi simvoldan
            ibarət olmalıdır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Şifrə sahəsi yazdıqca nöqtələrlə örtülü qalır. Məcburi sahələrdən biri boş olarsa, brauzer
            həmin sahəni doldurmağı tələb edir və forma yadda saxlanmır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Rol</strong> açılan siyahısından icazə səviyyəsini seçin (standart{" "}
            <HelpKey>Müşahidəçi</HelpKey>). İstəsəniz <strong>Şöbə</strong> də yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Rol siyahısında sistem rolları lokallaşdırılmış adla (Admin, Menecer, Agent, Müşahidəçi)
            görünür; təşkilatınız xüsusi rollar yaradıbsa, onlar da öz adı ilə siyahıda olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            İstəyə bağlı olaraq <strong>Telefon</strong> yazın — beynəlxalq formatda, <HelpKey>+</HelpKey>{" "}
            və ölkə kodu ilə (məs. <HelpKey>+994501234567</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahənin altında «Beynəlxalq format — + və ölkə kodu ilə başlayın…» ipucusu var. Boşluq,
            mötərizə və tire siz yazdıqca avtomatik silinir; format yanlışdırsa sahə qırmızı çərçivəyə
            düşür və «Yanlış format: + ilə başlamalı, sonra 7–15 rəqəm.» yazısı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Aşağıdakı <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Saxlanılır…» yazısına keçir, sonra pəncərə bağlanır və yeni istifadəçi cədvəldə peyda
            olur. <strong>Cəmi</strong> (aktivdirsə <strong>Aktiv</strong>, rolu admindirsə{" "}
            <strong>Adminlər</strong>) kartındakı say artır. E-poçt artıq mövcuddursa, formada qırmızı
            xəta mesajı görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: istifadəçini redaktə et (şifrə, dəstək, dil)">
        <HelpStep n={1}>
          <p>
            İstifadəçinin adının yanındakı <HelpKey>Redaktə et</HelpKey> düyməsini basın. Cədvəl ekrandan
            geniş olsa da əməliyyat görünən qalır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «İstifadəçini redaktə et» başlıqlı, mövcud məlumatlarla doldurulmuş eyni forma açılır. Şifrə
            sahəsinin etiketi indi <strong>«Yeni şifrə (boş buraxın)»</strong> olur — boş buraxsanız
            mövcud şifrə dəyişmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Redaktə rejimində yalnız əlavə sahələr görünür: <strong>İcmal dili</strong> (gündəlik AI
            icmalının dili), bir <strong>Dəstək parametrləri</strong> bölməsi və orada{" "}
            <strong>Maks. eyni vaxtda bilet sayı</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İcmal dili siyahısında <strong>Təşkilat standartı</strong>, Русский, English və Azərbaycan
            variantları var; altında «Gündəlik AI icmalının dili…» izahı durur. «Dəstək parametrləri»
            başlığının altında bilet sayı sahəsi 1–100 aralığında rəqəm qəbul edir (standart 20).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Lazımi dəyişiklikləri edib aşağıdakı <HelpKey>Yenilə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Saxlanılır…» göstərir, sonra pəncərə bağlanır və cədvəldəki sətir yenilənmiş
            məlumatları əks etdirir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: status, mövcudluq və 2FA-nı cədvəldən idarə et">
        <HelpStep n={1}>
          <p>
            İstifadəçini söndürmək/aktivləşdirmək üçün <strong>Status</strong> sütununda{" "}
            <HelpKey>Aktiv</HelpKey> / <HelpKey>Qeyri-aktiv</HelpKey> nişanına birbaşa klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Nişan yaşıl <strong>Aktiv</strong> ilə boz <strong>Qeyri-aktiv</strong> arasında dərhal
            keçir; yuxarıdakı <strong>Aktiv</strong> və <strong>Qeyri-aktiv</strong> statistika kartları
            uyğun olaraq dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Mövcud</strong> sütunundakı açarla dəstək agentinin yeni bilet qəbul edib-etmədiyini
            tənzimləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açar yaşıl (mövcud) ilə boz (mövcud deyil) arasında sürüşür. Bu, avtomatik bilet
            yönləndirməsində istifadə olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>2FA</strong> sütununda üç element var: <HelpKey>TOTP</HelpKey> pilli,{" "}
            <HelpKey>SMS</HelpKey> pilli və bir <HelpKey>2FA tələb et</HelpKey> açarı. Pildəki ✓ həmin
            üsulun qurulduğunu bildirir; qurulu pillə klikləməklə onu sıfırlaya bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qurulu TOTP pilini bassanız «Bu istifadəçi üçün TOTP 2FA sıfırlansın?…» təsdiq pəncərəsi
            çıxır; SMS üçün isə oxşar mesaj. Tələb açarını yandırmaq «Girişdə 2FA tələb et (istənilən
            üsul)» deməkdir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            2FA pilini sıfırlamaq həmin istifadəçinin iki mərhələli doğrulamasını söndürür — o, yenidən
            qurana qədər <strong>kodsuz daxil ola bilər</strong>. Bunu yalnız istifadəçi cihazını itirib
            sistemdən çıxa bilmədikdə edin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: istifadəçini sil">
        <HelpStep n={1}>
          <p>
            İstifadəçinin sətrində sağdakı qırmızı zibil qutusu ikonalı (<HelpKey>Sil</HelpKey>) düyməni
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «İstifadəçini sil» təsdiq pəncərəsi açılır və silinəcək istifadəçinin adını göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Silinməni təsdiqləyin və ya pəncərəni bağlayıb imtina edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Təsdiqlədikdən sonra istifadəçi cədvəldən çıxır və statistika kartları yenilənir. Silmə
            alınmasa (məs. son admini silmək cəhdi) qırmızı xəta mesajı göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            İstifadəçini büsbütün silmək yerinə çox vaxt sadəcə <strong>Status</strong> nişanı ilə
            qeyri-aktiv etmək daha təhlükəsizdir — hesab və onunla bağlı tarixçə qalır, istifadəçi
            sadəcə daxil ola bilmir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <strong>Bacarıqlar</strong> sütunu yalnız oxunur — onu bu formadan dəyişmirsiniz; bacarıqlar
          istifadəçinin profilinə ayrıca təyin olunur və avtomatik bilet yönləndirməsində istifadə edilir.
          Cədvəlin yuxarısındakı axtarış yalnız <strong>ad</strong> üzrə süzgəcdən keçirir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün istifadəçi hesabları təşkilatınızla məhdudlaşır — başqa təşkilatın istifadəçilərini
          görmür və idarə etmirsiniz. İstifadəçinin <strong>Rol</strong>-u onun bütün CRM-də nə görüb nə
          edə biləcəyini müəyyən edir, ona görə Admin rolunu yalnız etibar etdiyiniz şəxslərə verin.
        </p>
      </HelpCallout>
    </div>
  )
}
