"use client"

/**
 * Portal Users — help article (Azerbaijani).
 * Yalnız Tənzimləmələr → Portal İstifadəçiləri səhifəsini əhatə edir:
 * müştəri portalına girişin idarəsi (aktiv/deaktiv, şifrə sıfırlama,
 * Da Vinci söhbət tarixçəsini silmə, portaldan çıxarma, kütləvi əməliyyatlar,
 * filtrlər, axtarış, statuslar). İlk dəfə yazılan məqalədir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function PortalUsersHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Administrator və ya müştəri xidməti rəhbərisiniz"
        goal="Hansı əlaqələrin müştəri portalına girə biləcəyini idarə etmək, girişi açıb-bağlamaq, şifrəni sıfırlamaq və lazım olduqda portaldan çıxarmaq"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Portal İstifadəçiləri</HelpKey> yolu ilə
        çatırsınız. Burada görünən bütün adlar sizin təşkilatınızın e-poçtu olan əlaqələridir — yeni
        istifadəçi yaratmırsınız, mövcud əlaqələrə portal girişi verirsiniz. Filtri, axtarışı və ya
        statusu dəyişdikcə yuxarıdakı statistika kartları və cədvəl dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Portal İstifadəçiləri</HelpKey> adı, altında «Müştəri portal girişini idarə
          edin» izahı və «Əlaqələr üçün müştəri portalına girişi idarə edin» ipucu sətri var. Onun
          altında dörd statistika kartı durur: <strong>E-poçtlu əlaqələr</strong>,{" "}
          <strong>Giriş aktivdir</strong>, <strong>Qeydiyyatdan keçib</strong> və{" "}
          <strong>Son 7 gün giriş</strong>. Daha aşağıda filtr düymələri, axtarış sahəsi və əlaqələr
          cədvəli gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="E-poçtlu əlaqələr">Təşkilatda e-poçt ünvanı olan əlaqələrin ümumi sayı — yalnız bunlara portal girişi verilə bilər.</HelpDef>
          <HelpDef term="Giriş aktivdir">Portala girişi açıq olan əlaqələrin sayı.</HelpDef>
          <HelpDef term="Qeydiyyatdan keçib">Artıq portalda şifrə təyin etmiş əlaqələrin sayı.</HelpDef>
          <HelpDef term="Son 7 gün giriş">Son yeddi gün ərzində portala daxil olmuş əlaqələrin sayı.</HelpDef>
          <HelpDef term="Portal statusu">Hər sətirdə nişan: <strong>Aktiv</strong> (giriş açıq + şifrə var, yaşıl), <strong>Gözləyir</strong> (giriş açıq, hələ şifrə təyin edilməyib, sarı) və ya <strong>Qeyri-aktiv</strong> (giriş bağlı).</HelpDef>
          <HelpDef term="Son giriş">Əlaqənin portala ən son daxil olduğu tarix və saat; heç vaxt girməyibsə «—» göstərilir.</HelpDef>
        </dl>
        <p>
          Cədvəlin sütunları: seçim qutusu, <strong>Tam ad</strong>, <strong>Email</strong>,{" "}
          <strong>Şirkət</strong>, <strong>Portal statusu</strong>, <strong>Son giriş</strong> və{" "}
          <strong>Əməliyyatlar</strong>. Hər sətrin sağında ikona düymələri olur: girişi aç/bağla
          (qalxan ikonası), <HelpKey>Şifrəni sıfırla</HelpKey> (açar ikonası — yalnız şifrəsi olan
          əlaqədə görünür), <HelpKey>Da Vinci söhbət tarixçəsini sil</HelpKey> (söhbət ikonası) və{" "}
          <HelpKey>Portaldan çıxar</HelpKey> (insan-minus ikonası — yalnız şifrəsi olan əlaqədə
          görünür). Heç bir uyğun əlaqə yoxdursa, cədvəlin yerinə «Təşkilatda e-poçtlu əlaqə yoxdur»
          (axtarış zamanı isə «Nəticə tapılmadı») mətni göstərilir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: əlaqəni filtrlə və tap">
        <HelpStep n={1}>
          <p>
            Filtr düymələrindən birini seçin: <HelpKey>Hamısı</HelpKey>, <HelpKey>Giriş aktiv</HelpKey>,{" "}
            <HelpKey>Qeydiyyatlı</HelpKey>, <HelpKey>Gözləyir</HelpKey> və ya <HelpKey>Deaktiv</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş düymə dolu rəngə keçir, qalanları boş çərçivəli qalır və cədvəl yalnız həmin
            kateqoriyaya uyğun əlaqələri göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Konkret adamı tapmaq üçün sağdakı <HelpKey>Axtar...</HelpKey> sahəsinə ad, e-poçt və ya
            şirkət yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca cədvəl avtomatik süzülür. Heç nə uyğun gəlməsə, cədvəl yerinə «Nəticə tapılmadı»
            mətni çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: bir əlaqəyə portal girişini aç və ya bağla">
        <HelpStep n={1}>
          <p>
            Əlaqənin sətrində sağdakı qalxan ikonalı düyməni basın — giriş bağlıdırsa yaşıl{" "}
            <HelpKey>Girişi aç</HelpKey>, giriş açıqdırsa qırmızı <HelpKey>Girişi bağla</HelpKey>{" "}
            görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düyməni basan kimi sətrin <strong>Portal statusu</strong> nişanı dəyişir: bağlananda{" "}
            <strong>Qeyri-aktiv</strong>, açılanda şifrəyə görə <strong>Aktiv</strong> və ya{" "}
            <strong>Gözləyir</strong> olur. Yuxarıdakı <strong>Giriş aktivdir</strong> kartındakı say da
            uyğun olaraq dəyişir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: bir neçə əlaqəni birdən idarə et">
        <HelpStep n={1}>
          <p>
            İdarə etmək istədiyiniz hər sətrin solundakı seçim qutusunu işarələyin (və ya başlıq
            sətrindəki qutu ilə hamısını seçin).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəlin üstündə boz zolaq peyda olur: solda «Seçildi: N» mətni, sağında isə{" "}
            <HelpKey>Girişi aktiv et</HelpKey> və <HelpKey>Girişi deaktiv et</HelpKey> düymələri.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Seçilmiş əlaqələrin hamısına girişi açmaq üçün <HelpKey>Girişi aktiv et</HelpKey>,
            bağlamaq üçün <HelpKey>Girişi deaktiv et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bütün seçilmiş sətirlərin statusu eyni anda yenilənir, seçim təmizlənir və zolaq itir.
            Statistika kartlarındakı saylar yeni vəziyyəti əks etdirir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: şifrəni sıfırla">
        <HelpStep n={1}>
          <p>
            Yalnız <strong>Aktiv</strong> statuslu (artıq şifrəsi olan) əlaqədə görünən açar ikonalı{" "}
            <HelpKey>Şifrəni sıfırla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Şifrəni sıfırla» başlıqlı təsdiq pəncərəsi açılır: «Bu əlaqənin portal şifrəsi
            sıfırlanacaq. Kontakt yenidən şifrə təyin etməli olacaq.» — və <HelpKey>Sıfırla</HelpKey>{" "}
            düyməsi.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Sıfırla</HelpKey> ilə təsdiqləyin (fikrinizi dəyişsəniz pəncərəni bağlayın).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Sıfırlanır...» yazısına keçir, sonra pəncərə bağlanır. Əlaqənin şifrəsi silinir, ona
            görə də statusu <strong>Gözləyir</strong> olur — istifadəçi növbəti girişdə yeni şifrə
            təyin etməlidir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Da Vinci söhbət tarixçəsini sil">
        <HelpStep n={1}>
          <p>
            Əlaqənin sətrindəki söhbət ikonalı <HelpKey>Da Vinci söhbət tarixçəsini sil</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Da Vinci söhbət tarixçəsini sil» başlıqlı pəncərə açılır və bu əlaqənin bütün Da Vinci
            söhbət tarixçəsinin silinəcəyini, əməliyyatın geri qaytarılmayacağını xəbərdar edir.
            Təsdiq düyməsi <HelpKey>Təmizlə</HelpKey> olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Təmizlə</HelpKey> ilə təsdiqləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Təmizlənir...» yazısına keçir, sonra pəncərə bağlanır. Əlaqənin portal girişi və
            statusu dəyişmir — yalnız onun keçmiş Da Vinci söhbətləri silinir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: əlaqəni portaldan çıxar">
        <HelpStep n={1}>
          <p>
            Yalnız şifrəsi olan əlaqədə görünən insan-minus ikonalı{" "}
            <HelpKey>Portaldan çıxar (yenidən qeydiyyat tələb olunacaq)</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Portaldan çıxar» başlıqlı təsdiq pəncərəsi açılır: «Bu əlaqənin portal girişi ləğv
            ediləcək və şifrəsi silinəcək. Yenidən qeydiyyatdan keçməli olacaq.» — və{" "}
            <HelpKey>Çıxar</HelpKey> düyməsi.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Çıxar</HelpKey> ilə təsdiqləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Pəncərə bağlanır. Əlaqənin girişi söndürülür və şifrəsi silinir, ona görə də statusu{" "}
            <strong>Qeyri-aktiv</strong> olur və açar/insan-minus düymələri sətirdən yox olur.
            Statistika kartları yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Status nişanları sürətli baxış üçündür: <strong>Gözləyir</strong> (sarı) o deməkdir ki, siz
          girişi açmısınız, amma əlaqə hələ portalda şifrə təyin etməyib; <strong>Aktiv</strong>{" "}
          (yaşıl) — əlaqə qeydiyyatdan keçib və daxil ola bilir. Şifrəni unutmuş müştəri üçün{" "}
          <HelpKey>Portaldan çıxar</HelpKey> əvəzinə <HelpKey>Şifrəni sıfırla</HelpKey> daha
          yumşaqdır — giriş açıq qalır, sadəcə yeni şifrə təyin etməsi istənilir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <HelpKey>Da Vinci söhbət tarixçəsini sil</HelpKey> və <HelpKey>Portaldan çıxar</HelpKey> geri
          qaytarılmır. Portaldan çıxarma şifrəni silir və əlaqənin sıfırdan yenidən qeydiyyatdan
          keçməsini tələb edir — sadəcə müvəqqəti bloklamaq istəyirsinizsə, qalxan düyməsi ilə{" "}
          <HelpKey>Girişi bağla</HelpKey> kifayətdir (şifrə qalır).
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Cədvəldə yalnız öz təşkilatınızın e-poçtu olan əlaqələri görünür və idarə edirsiniz — başqa
          tenant-ın portal istifadəçilərinə çıxışınız yoxdur. Giriş, şifrə və söhbət tarixçəsi
          əməliyyatları yalnız müştəri portalına aiddir; əlaqənin CRM-dəki məlumatlarına və ya sizin
          CRM giriş hesabınıza toxunmur.
        </p>
      </HelpCallout>
    </div>
  )
}
