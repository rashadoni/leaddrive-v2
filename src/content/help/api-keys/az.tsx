"use client"

/**
 * API Keys — help article (Azerbaijani).
 * Tənzimləmələr → API Açarları səhifəsini əhatə edir: açar yaratma,
 * scope (icazə) seçimi, etibarlılıq müddəti, birdəfəlik açar göstərimi
 * və açarın ləğvi. Təhlükəsizlik vurğusu — xam açar yalnız BİR DƏFƏ
 * göstərilir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function apikeysHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Administrator və ya inteqrasiya qururan texniki məsulsunuz"
        goal="Xarici sistemin LeadDrive API-yə proqramatik giriş üçün açar yaratmaq, ona düzgün icazələr (scope) vermək və lazım olanda açarı ləğv etmək"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>API Açarları</HelpKey> yolu ilə çatırsınız.
        Bütün açarlar yalnız sizin təşkilatınız üçündür. <strong>Açar yaratmaq və ləğv etmək yalnız
        admin (və ya superadmin) rolundakı istifadəçilərə açıqdır</strong> — başqa rollar siyahını
        görür, lakin <HelpKey>Açar Yarat</HelpKey> düyməsi və zibil qutusu düyməsi onlara görünmür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda açar ikonası ilə <HelpKey>API Açarları</HelpKey> adı və altında «LeadDrive API-yə
          proqramatik giriş üçün açarlar…» izahı durur. Sağ yuxarıda (yalnız adminlərdə){" "}
          <HelpKey>Açar Yarat</HelpKey> düyməsi var. Altda mövcud açarların siyahısı gəlir — hələ heç biri
          yoxdursa, bunun yerinə açar ikonası ilə boş vəziyyət göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ad">İnteqrasiyanı tanımaq üçün daxili ad (məs. «İstehsal inteqrasiyası»). Açarın özü deyil.</HelpDef>
          <HelpDef term="Açar prefiksi">Açarın yalnız əvvəlindəki bir neçə simvol, kod kimi göstərilir (məs. ld_… formasında, sonunda «…»). Tam açar saxlanmır, ona görə siyahıda yalnız prefiks görünür.</HelpDef>
          <HelpDef term="Aktiv / ləğv edilib">Açarın vəziyyəti — yaşıl «Aktiv» nişanı və ya qırmızı «ləğv edilib» nişanı.</HelpDef>
          <HelpDef term="İcazə (scope)">Açarın API-də nəyə icazə verdiyini təyin edən hüquq. Kartda qalxan ikonası ilə icazələrin sayı, altda isə ilk altı icazənin adı göstərilir.</HelpDef>
          <HelpDef term="Son istifadə / Bitmə tarixi / Yaradılıb">Açarın ən son nə vaxt işləndiyi, nə vaxt etibardan düşdüyü (təyin olunubsa, saat ikonası ilə) və nə vaxt yaradıldığı.</HelpDef>
        </dl>
        <p>
          Hər açar kartında solda açar ikonası, ortada ad + prefiks kodu + vəziyyət nişanı, onun altında
          icazə sayı və tarixlər, daha altda isə icazə adlarının kiçik nişanları (altıdan çoxdursa «+N»
          kimi qısaldılır) olur. Sağda — yalnız adminlərdə — qırmızı zibil qutusu düyməsi açarı ləğv edir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni API açarı yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Açar Yarat</HelpKey> düyməsini basın. (Heç açar yoxdursa, boş
            vəziyyətdəki <HelpKey>İlk Açarı Yarat</HelpKey> düyməsi də eyni işi görür.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni API Açarı» başlıqlı pəncərə açılır. İçində <strong>Ad</strong> sahəsi,{" "}
            <strong>Etibarlılıq müddəti</strong> açılan siyahısı və <strong>Giriş icazələri (scopes)</strong>{" "}
            adlı qeyd qutuları siyahısı var. Aşağıda <HelpKey>Ləğv et</HelpKey> və <HelpKey>Yarat</HelpKey>{" "}
            düymələri durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Ad</strong> yazın — bu daxili addır, açarları bir-birindən ayırmaq üçündür (məs.
            «İstehsal inteqrasiyası»). Sahə altında «Daxili ad — müxtəlif inteqrasiyalar üçün açarları
            fərqləndirmək üçün» ipucusu göstərilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mətn sahədə görünür. Sahə boşdursa standart mətn (placeholder) kimi «məs. İstehsal
            inteqrasiyası» yazısı solğun şəkildə durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İstəyə bağlı olaraq <strong>Etibarlılıq müddəti</strong> seçin: <HelpKey>Limitsiz</HelpKey>,{" "}
            <HelpKey>30 gün</HelpKey>, <HelpKey>90 gün</HelpKey> və ya <HelpKey>1 il</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahıda dörd seçim çıxır. Standart olaraq <strong>Limitsiz</strong> seçilidir — yəni
            açar siz onu ləğv edənə qədər işləyir. Müddət seçsəniz, açar kartında sonradan saat ikonası
            ilə «Bitmə tarixi» göstəriləcək.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <strong>Giriş icazələri (scopes)</strong> bölməsində açara verəcəyiniz hüquqları işarələyin.
            Hər sətirdə bir icazə qeyd qutusu kimi durur; bəzilərinin altında qısa izahı da var.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sürüşən (scrollable) çərçivədə icazələr kod-adı ilə sadalanır. Üstündə «Yalnız inteqrasiyanın
            həqiqətən ehtiyac duyduğunu seçin — minimum icazə prinsipi» ipucusu durur. İcazələr hələ
            yüklənirsə «İcazələr yüklənir…» mətni görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Aşağıdakı <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> basın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ad boşdursa və ya heç bir icazə seçilməyibsə, pəncərənin içində qırmızı «Ad və ən azı bir
            icazə tələb olunur.» xəbərdarlığı çıxır və açar yaradılmır. Hər şey düzgündürsə düymə yaradılma
            müddətində «Yüklənir...» yazısına keçir, sonra yaratma pəncərəsi bağlanır və açar yaradıldı
            pəncərəsi açılır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: xam açarı bir dəfə kopyala və saxla">
        <HelpStep n={1}>
          <p>
            Açar uğurla yaradıldıqda yaşıl təsdiq ikonası ilə «Açar Yaradıldı» başlıqlı pəncərə açılır.
            Burada açarın tam (xam) mətni göstərilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yuxarıda sarı xəbərdarlıq qutusu durur: «Açarı indi kopyalayın — pəncərəni bağladıqdan sonra
            bir daha göstərilməyəcək. Onu təhlükəsiz yerdə saxlayın (məs. şifrə menecerində).» Altda açarın
            adı, sonra «API Açarı» sahəsində tam açar yalnız oxunan (read-only) mətn sahəsində görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Açarın yanındakı kopyalama (copy) düyməsini basaraq onu mübadilə yaddaşına (clipboard) götürün
            və dərhal təhlükəsiz yerə — şifrə menecerinə və ya inteqrasiyanın gizli parametrlərinə —
            yapışdırın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kopyalama uğurlu olduqda düymədəki ikona qısa müddətə (təxminən 2 saniyə) yaşıl təsdiq
            işarəsinə dəyişir, sonra yenidən adi kopyalama ikonasına qayıdır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Pəncərənin altında həm də hazır <strong>İstifadə nümunəsi</strong> verilir — açarı necə
            işlədəcəyinizi göstərən curl əmri. Saxlamağı bitirdikdə aşağıdakı <HelpKey>Hazır</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «İstifadə nümunəsi» bölməsində <code>Authorization: Bearer …</code> başlığı ilə nümunə əmr
            görünür. <HelpKey>Hazır</HelpKey> basıldıqda pəncərə bağlanır və yeni açar siyahıda peyda olur.
            Siyahıda yalnız açarın prefiksi (məs. ld_…) görünür — tam açar bir daha göstərilmir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: açarı ləğv et (revoke)">
        <HelpStep n={1}>
          <p>
            Ləğv etmək istədiyiniz açarın kartında sağdakı qırmızı zibil qutusu düyməsini basın (bu düymə
            yalnız adminlərə görünür).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Brauzerin təsdiq pəncərəsi çıxır: «"&lt;açar adı&gt;" açarını ləğv edin? Bu açarla
            inteqrasiyalar işləməyəcək.»
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Təsdiqlədikdən sonra açar ləğv edilir. Fikrinizi dəyişsəniz təsdiq pəncərəsində ləğv edin —
            heç nə dəyişmir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Təsdiqdən sonra siyahı yenilənir. Silmə icra olunarkən həmin kartın düyməsi qısa müddətə qeyri-
            aktiv olur. Açar artıq bu açarla edilən bütün API sorğularını rədd edir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Açarı ləğv etmək <strong>dərhal təsir göstərir və geri qaytarılmır</strong> — bu açardan
            istifadə edən bütün inteqrasiyalar işləməyi dayandırır. Əvəzini yaratmaq lazımdırsa, əvvəlcə
            yeni açar yaradıb inteqrasiyada onu işlədin, yalnız bundan sonra köhnəni ləğv edin ki, fasilə
            olmasın.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Minimum icazə prinsipinə əməl edin: açara yalnız inteqrasiyanın həqiqətən ehtiyac duyduğu
          scope-ları verin. Hər inteqrasiya üçün ayrıca, fərqli adlı açar yaradın — beləliklə biri ifşa
          olarsa, yalnız onu ləğv edib qalanları toxunmadan saxlaya bilərsiniz.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Xam açar <strong>yalnız bir dəfə</strong> — yaradılma anında — göstərilir və sistemdə açıq mətnlə
          saxlanmır; siyahıda yalnız prefiks qalır. Pəncərəni bağlamazdan əvvəl mütləq kopyalayın.
          Açarı heç vaxt koda, repozitoriyaya və ya ümumi mesajlara yazmayın — şifrə menecerində və ya
          mühit dəyişənlərində (environment variables) saxlayın. Açar təşkilat çərçivəsindədir: yaradılması/
          ləğvi admin hüququ tələb edir və başqa təşkilatın açarlarını görə bilməzsiniz. İfşa şübhəsi varsa
          dərhal ləğv edin.
        </p>
      </HelpCallout>
    </div>
  )
}
