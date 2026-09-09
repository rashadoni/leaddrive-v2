"use client"

/**
 * Custom Fields — help article (Azerbaijani).
 * Yalnız Tənzimləmələr → Xüsusi sahələr səhifəsini əhatə edir:
 * sahə yaratma, redaktə, silmə, obyektə görə filtr və admin-only
 * giriş məhdudiyyəti. Sahə dəyərlərinin obyekt formalarında necə
 * doldurulması (Kontakt/Sövdələşmə formaları) bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CustomFieldsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Administrator və ya superadmin-siniz"
        goal="CRM-in standart obyektlərinə (Kontakt, Sövdələşmə, Lid, Şirkət) öz xüsusi sahələrinizi əlavə etmək — beləliklə komandanın yığdığı məlumat sizin biznesinizə uyğunlaşır"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Xüsusi sahələr</HelpKey> yolu ilə
        çatırsınız. Bütün sahələr yalnız sizin təşkilatınız üçündür. Sahələri{" "}
        <strong>yaratmaq, redaktə etmək və silmək</strong> yalnız administrator və superadmin
        rolundadır — başqa rollar səhifəni aça bilir, amma yalnız mövcud sahələrə baxır, dəyişiklik
        edə bilmir. Səhifədə nə görürsünüzsə dərhal eyni siyahıdan oxunur, ona görə sahə əlavə
        etdikcə və ya sildikcə qruplar dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Xüsusi sahələr</HelpKey> adı (qığılcım ikonası ilə), altında «Companies,
          Contacts, Deals və Leads-ə öz sahələrinizi əlavə edin» izahı durur. Administratorsunuzsa,
          sağ yuxarıda <HelpKey>Sahə əlavə et</HelpKey> düyməsi görünür; deyilsinizsə, onun yerinə
          sarı rəngli «Yalnız administrator xüsusi sahələri idarə edə bilər» xəbərdarlıq zolağı çıxır.
          Aşağıda <HelpKey>Obyektə görə filtr</HelpKey> açılan siyahısı var. Sahələr obyekt növünə
          görə qruplaşdırılır — hər qrupun başlığında ikonası, adı və mötərizədə sayı olur.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Xüsusi sahə">Standart formaya əlavə etdiyiniz sahə — adı, görünən adı, növü, məcburi olub-olmaması və standart dəyəri olan.</HelpDef>
          <HelpDef term="Sahə adı">Sistemin daxili açarı (məs. custom_source) — kod kimi göstərilir, workflow şərtlərində bu adla istinad edilir.</HelpDef>
          <HelpDef term="Görünən ad">Formalarda istifadəçiyə göstərilən etiket (məs. «Lead Source»).</HelpDef>
          <HelpDef term="Obyekt növü">Sahənin hansı obyektə bağlandığı: Kontakt, Sövdələşmə, Lid, Şirkət (səhifədə həmçinin Tasks qrupu görünə bilər).</HelpDef>
          <HelpDef term="Sahə növü">Sahənin tipi: Mətn, Rəqəm, Tarix, Açılan siyahı, Bəli/Xeyr və ya Uzun mətn.</HelpDef>
          <HelpDef term="Məcburi">Qırmızı «Məcburi» nişanı — bu sahə doldurulmadan obyekt yadda saxlanmır.</HelpDef>
          <HelpDef term="Deaktiv">Boz «Deaktiv» nişanı — sahə qalır, amma formalarda aktiv işlənmir.</HelpDef>
        </dl>
        <p>
          Hər sahə kartında soldan-sağa: <strong>görünən ad</strong>, monospace kod çərçivəsində{" "}
          <strong>sahə adı</strong>, sahə növü nişanı, lazım gəlirsə qırmızı{" "}
          <strong>Məcburi</strong> və boz <strong>Deaktiv</strong> nişanları görünür. Sahə növü
          «Açılan siyahı»dırsa, altında ilk səkkiz seçim kiçik nişanlar kimi sıralanır (qalanı «+N»
          kimi yığcamlaşdırılır). Standart dəyər təyin edilibsə, ayrıca bir sətirdə göstərilir.
          Administratorsunuzsa, sağda iki düymə olur: <strong>redaktə</strong> (qələm ikonası) və{" "}
          <strong>sil</strong> (qırmızı zibil qutusu ikonası).
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni xüsusi sahə yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Sahə əlavə et</HelpKey> düyməsini basın. (Hələ heç sahə yoxdursa,
            boş vəziyyətin ortasındakı eyni adlı düymə də işləyir.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni xüsusi sahə» başlıqlı pəncərə açılır. İçində iki sütunda <strong>Sahə adı *</strong>{" "}
            və <strong>Görünən ad *</strong>, altında <strong>Obyekt növü</strong> və{" "}
            <strong>Sahə növü</strong> açılan siyahıları, daha sonra <strong>Standart dəyər</strong>{" "}
            sahəsi və <strong>Mütləq sahə</strong> qeyd qutusu var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Sahə adı</strong> yazın — sistemin daxili açarı (məs. <HelpKey>custom_source</HelpKey>).
            Sonra <strong>Görünən ad</strong> yazın — formalarda göstəriləcək etiket (məs. «Lead
            Source»). Hər ikisi məcburidir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahələrin yer-tutucularında nümunə dəyərlər görünür: solda <HelpKey>custom_source</HelpKey>,
            sağda <HelpKey>Lead Source</HelpKey>. İkisindən biri boş qalsa, brauzer formanı təqdim
            etməyə qoymur (sahə tələb olunan kimi işarələnir).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Obyekt növü</strong> seçin: Kontakt, Sövdələşmə, Lid və ya Şirkət (standart olaraq
            Kontakt seçilidir). Sonra <strong>Sahə növü</strong> seçin: Mətn, Rəqəm, Tarix, Açılan
            siyahı, Bəli/Xeyr və ya Uzun mətn.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Sahə növü</strong> kimi «Açılan siyahı» seçən kimi aşağıda yeni{" "}
            <strong>Seçimlər (vergüllə ayrılmış)</strong> mətn sahəsi peyda olur (yer-tutucu: «Option
            1, Option 2, Option 3»). Digər növlərdə bu sahə görünmür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            İstəyə bağlı olaraq <strong>Standart dəyər</strong> yazın və sahəni hər zaman doldurulması
            tələb olunan etmək istəyirsinizsə <HelpKey>Mütləq sahə</HelpKey> qeyd qutusunu işarələyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qeyd qutusu işarələnmiş vəziyyətə keçir. (Bu, siyahıda sahə kartında qırmızı «Məcburi»
            nişanı kimi əks olunacaq.)
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Aşağıdakı <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> düyməsi ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yadda saxlanarkən «Saxlanılır...» yazısına keçir, sonra pəncərə bağlanır və yeni
            sahə öz obyekt qrupunun altında peyda olur; həmin qrupun başlığındakı say bir vahid artır.
            Saxlama alınmasa, pəncərənin yuxarısında qırmızı fonda xəta mesajı göstərilir və pəncərə
            açıq qalır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: sahəni redaktə et və ya sil">
        <HelpStep n={1}>
          <p>
            Sahəni dəyişmək üçün kartın sağındakı qələm ikonalı (<HelpKey>Redaktə et</HelpKey>) düyməni
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Xüsusi sahəni redaktə et» başlıqlı, mövcud dəyərlərlə əvvəlcədən doldurulmuş eyni forma
            açılır. Dəyişiklikləri edib aşağıdakı <HelpKey>Yenilə</HelpKey> düyməsi ilə təsdiqləyin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sahəni silmək üçün qırmızı zibil qutusu ikonalı (<HelpKey>Sil</HelpKey>) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Brauzerin təsdiq pəncərəsi çıxır: «&lt;sahə adı&gt; sahəsi silinsin? Bütün saxlanılan
            dəyərlər tamamilə silinəcək.» <HelpKey>OK</HelpKey> təsdiqlədikdən sonra silmə gedərkən
            zibil qutusu düyməsi müvəqqəti deaktiv olur, sonra sahə siyahıdan çıxır və qrup sayı yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmə geri qaytarılmır və bu sahənin bütün obyektlərdə{" "}
            <strong>saxlanılmış dəyərlərini də tamamilə silir</strong>. Sahəni müvəqqəti istifadədən
            çıxarmaq istəyirsinizsə, silmək yerinə onu redaktə edib deaktiv vəziyyətə salmaq daha
            təhlükəsizdir — sahə və dəyərləri qalır, sadəcə formalarda aktiv işlənmir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: obyektə görə filtr">
        <HelpStep n={1}>
          <p>
            Yalnız bir obyektin sahələrini görmək üçün <HelpKey>Obyektə görə filtr</HelpKey> açılan
            siyahısından obyekt seçin (məs. Sövdələşmə).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahı yalnız seçilmiş obyektin qrupunu göstərir, digər qruplar gizlənir. Hamısına geri
            qayıtmaq üçün açılan siyahıdan <HelpKey>Bütün obyektlər</HelpKey> seçin.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <strong>Sahə adı</strong> ilə <strong>Görünən ad</strong>-ı qarışdırmayın. Sahə adı
          sistemin daxili açarıdır və workflow şərtlərində bu adla istinad olunur — qısa, ingilis
          dilində və alt-xətli yazmaq (məs. <HelpKey>custom_source</HelpKey>) ən rahatıdır. Görünən
          ad isə formalarda komandanın gördüyü etiketdir və istənilən dildə, boşluqlu ola bilər.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün xüsusi sahələr təşkilatınızla məhdudlaşır — başqa təşkilatların sahələrini görmürsünüz.
          Sahə yaratmaq, redaktə etmək və silmək yalnız <strong>administrator</strong> və{" "}
          <strong>superadmin</strong> rollarına açıqdır; digər rollar bu səhifəni yalnız oxumaq üçün
          görür (yuxarıda sarı xəbərdarlıq zolağı çıxır, əlavə et / redaktə / sil düymələri isə
          görünmür).
        </p>
      </HelpCallout>
    </div>
  )
}
