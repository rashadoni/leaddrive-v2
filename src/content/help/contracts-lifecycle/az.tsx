"use client"

/**
 * Contract Lifecycle — help article (Azerbaijani).
 *
 * Köhnə birgə "contracts" məqaləsindən ayrılıb. Köhnə məqalə müqavilə
 * reyestrini izah edirdi, ona görə bu səhifə (Müqavilə həyat dövrü —
 * yenilənmə alertləri + təsdiq növbəsi) üçün real kömək yox idi. Bu
 * məqalə YALNIZ /contracts/lifecycle səhifəsini əhatə edir: iki axınlı
 * idarə paneli — yenilənmə alertləri (qarşıdan/gecikmiş) və təsdiqdə
 * ilişmiş müqavilələr (darboğaz mərhələsinə görə qruplaşdırılmış),
 * mərhələni təsdiq/rədd etmə təsdiq pəncərəsi ilə. Reyestr (müqavilə
 * siyahısı/yaratma) bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ContractsLifecycleHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış əməliyyatları və ya müqavilə menecerisiniz"
        goal="Hansı müqavilələrin yenilənmə vaxtının yaxınlaşdığını və hansılarının təsdiqdə ilişdiyini bir ekranda görmək, ilişmiş mərhələləri təsdiq və ya rədd etmək"
      >
        Səhifə <HelpKey>Müqavilə həyat dövrü</HelpKey> adlanır. Bu, reyestr
        (müqavilə siyahısı) deyil — burada müqavilə yaratmırsınız. Bu səhifə
        iki şeyi izləyir: <strong>yenilənmə alertləri</strong> (vaxtı bitən
        müqavilələr) və <strong>təsdiq növbəsi</strong> (təsdiqdə gözləyən
        müqavilələr). Açılışda məlumat avtomatik yüklənir; bütün rəqəmlər və
        sətirlər yalnız sizin təşkilatınıza aiddir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda sənəd ikonası ilə <HelpKey>Müqavilə həyat dövrü</HelpKey> adı,
          altında qısa izah durur. Onun altında dörd statistika (KPI) kartı, daha
          sonra iki sütun gəlir: solda <strong>Yenilənmə alertləri</strong>,
          sağda <strong>Təsdiq növbəsi</strong>. Səhifənin ən altında iki sətir
          izahedici qeyd var. Yüklənərkən fırlanan ikonalı «Yüklənir…» mesajı,
          xəta olduqda isə qırmızı çərçivəli xəbərdarlıq görünür.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Yenilənmə alertləri (90g)">
            Növbəti 90 gündə yenilənmə alerti olan müqavilələrin ümumi sayı.
          </HelpDef>
          <HelpDef term="Gecikmiş yenilənmələr">
            Yenilənmə vaxtı artıq keçmiş alertlərin sayı; sıfırdan böyükdürsə
            rəqəm qırmızı olur.
          </HelpDef>
          <HelpDef term="Təsdiq gözləyir">
            Hazırda təsdiqdə ilişmiş müqavilələrin ümumi sayı.
          </HelpDef>
          <HelpDef term="Darboğaz mərhələsi">
            Ən çox müqavilənin ilişdiyi mərhələnin adı; basıldıqda aşağıda həmin
            mərhələ qrupuna keçir.
          </HelpDef>
          <HelpDef term="Yenilənmə alerti">
            Müqavilə bitməzdən əvvəl planlaşdırılan xatırlatma — burada şirkət
            adı, müqavilə nömrəsi/başlığı, məbləğ və vaxta neçə gün qaldığı
            göstərilir.
          </HelpDef>
          <HelpDef term="Təsdiq mərhələsi">
            Müqavilənin təsdiq zəncirindəki addım. Mərhələlər ardıcıldır — biri
            yalnız əvvəlki təsdiqləndikdən sonra açılır.
          </HelpDef>
          <HelpDef term="Yaş">
            Bir müqavilənin cari mərhələdə nə qədər gözlədiyi (məs. «3g», «2mo»);
            7 gündən sonra qırmızı, 3 gündən sonra narıncı olur.
          </HelpDef>
        </dl>
        <p>
          <strong>Yenilənmə alertləri</strong> sütununda hər kart şirkət adını,
          müqavilə nömrəsi və başlığını, məbləği və «{"{gün}"}g alert» qeydini,
          eləcə də müqaviləni açan <HelpKey>Müqaviləni aç</HelpKey> keçidini
          göstərir. Sağ tərəfdə vaxta nə qədər qaldığı (məs. «Bu gün», «Sabah»,
          «3g sonra» və ya «5g gecikmiş») və bitmə tarixi yazılır. Gecikmiş
          kartlar qırmızı, 14 gün və ya az qalanlar narıncı haşiyə ilə işarələnir.
          Heç alert yoxdursa yaşıl işarə ilə «Növbəti 90 gündə yenilənmə alerti
          yoxdur.» göstərilir.
        </p>
        <p>
          <strong>Təsdiq növbəsi</strong> sütununda müqavilələr cari mərhələnin
          adına görə qruplara bölünür. Hər qrupun başlığında mərhələ adı və
          «{"{say}"} gözləyir» nişanı (3 və daha çox olduqda narıncı) var. Hər
          sətirdə müqavilə nömrəsi, şirkət adı, başlıq, məbləğ, sağda yaş, altda
          isə <HelpKey>Təsdiq et</HelpKey> və <HelpKey>Rədd et</HelpKey> düymələri
          olur. Növbə boşdursa yaşıl işarə ilə «Təsdiqdə ilişmiş müqavilə yoxdur.»
          görünür.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yenilənmə alertlərini oxu və müqaviləyə keç">
        <HelpStep n={1}>
          <p>
            Səhifəni açın. Yuxarıdakı dörd KPI kartına baxın — xüsusilə{" "}
            <HelpKey>Gecikmiş yenilənmələr</HelpKey> rəqəminə.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yüklənmə bitdikdən sonra kartlarda faktiki saylar görünür. Gecikmiş
            sayı sıfırdan böyükdürsə həmin rəqəm qırmızı rəngdə olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Solda <HelpKey>Yenilənmə alertləri</HelpKey> sütununa keçin və
            yuxarıdakı (ən təcili) kartlara baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kartda şirkət, müqavilə nömrəsi/başlığı, məbləğ və sağ tərəfdə
            vaxta qalan müddət var. Gecikmişlər qırmızı, 14 günə qədər qalanlar
            narıncı haşiyəlidir. Siyahıda 20-dən çox alert varsa, sonda
            «+{"{say}"} daha çox» yazısı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Müqaviləni yeniləmək və ya dəyişmək üçün kartdakı{" "}
            <HelpKey>Müqaviləni aç</HelpKey> keçidini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Həmin müqavilənin detal səhifəsi açılır. Bu səhifədə yenilənmə
            əməliyyatı yoxdur — yenilə/dəyiş işini müqavilənin öz səhifəsində
            görürsünüz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: darboğaz mərhələsinə keç">
        <HelpStep n={1}>
          <p>
            <HelpKey>Darboğaz mərhələsi</HelpKey> KPI kartına baxın — orada ən çox
            müqavilənin ilişdiyi mərhələnin adı və «{"{say}"} gözləyir» yazılır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Heç ilişmiş müqavilə yoxdursa, kartda mərhələ adı yerinə «—» işarəsi
            durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Mərhələ adının üstünə basın (kart düymə kimi işləyir, üstünə
            gələndə altı xətlənir).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Səhifə hamar şəkildə aşağıya — sağ sütunda həmin mərhələnin qrup
            kartına sürüşür, beləcə ilişmiş müqavilələri dərhal görürsünüz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: bir mərhələni təsdiq və ya rədd et">
        <HelpStep n={1}>
          <p>
            Sağdakı <HelpKey>Təsdiq növbəsi</HelpKey> sütununda lazımi müqavilə
            sətrini tapın. Növbəti mərhələni qəbul etmək üçün yaşıl{" "}
            <HelpKey>Təsdiq et</HelpKey>, müqaviləni dayandırmaq üçün qırmızı{" "}
            <HelpKey>Rədd et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bir təsdiq pəncərəsi (dialoq) açılır — heç bir qərar tək kliklə dərhal
            tətbiq olunmur. Başlıqda «Bu mərhələ təsdiqlənsin?» və ya «Bu mərhələ
            rədd edilsin?» yazılır, altda şirkət, müqavilə nömrəsi/başlığı, məbləğ
            və <HelpKey>Müqaviləni aç</HelpKey> keçidi göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Qərar qeydi</strong> sahəsinə qeyd yazın. Təsdiq üçün bu
            istəyə bağlıdır; <strong>rədd</strong> üçün isə səbəb məcburidir
            (etiketdə qırmızı * görünür).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahədə «Səbəb? (rədd üçün tələb olunur)» göstərici mətni var. Rədd
            seçmisinizsə və sahə boşdursa, təsdiq düyməsi qeyri-aktiv qalır və
            basıla bilmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Aşağıdakı düymə ilə qərarı təsdiqləyin — təsdiq üçün{" "}
            <HelpKey>Təsdiq et</HelpKey>, rədd üçün qırmızı{" "}
            <HelpKey>Rədd et</HelpKey>. Fikrinizi dəyişsəniz{" "}
            <HelpKey>Ləğv et</HelpKey> basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymədəki yazı müvəqqəti «…» işarəsinə keçir, pəncərə bağlanır və
            məlumat yenidən yüklənir. Təsdiq edilmiş müqavilə zəncirdə bir mərhələ
            irəli gedir; rədd edilmiş isə növbədən çıxır. KPI kartları
            («Təsdiq gözləyir», «Darboğaz mərhələsi») müvafiq olaraq yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Hər qrupda yalnız ilk 5 müqavilə, hər sütunda isə ilk 20 alert göstərilir;
          qalanı «+{"{say}"} daha çox» kimi yığılır. Çox sayda müqavilə varsa,
          sistem məlumatın bir hissəsini gətirir və yuxarıda narıncı «İlk {"{say}"}
          {" "}… göstərilir.» banneri çıxır — bu, hər şeyin gəlmədiyini bildirir,
          ona görə ən təcili işləri əvvəl bağlayın.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <strong>Rədd</strong> bütün müqaviləni rədd edir və təsdiq zəncirini
          dayandırır — bu sadəcə bir addımı atlamaq deyil. Ona görə dialoqda səbəb
          məcburidir. Təsdiqdən və ya rəddən əvvəl mütləq{" "}
          <HelpKey>Müqaviləni aç</HelpKey> ilə müqaviləyə baxın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün yenilənmə alertləri, təsdiq sətirləri və qərarlar təşkilatınızla
          məhdudlaşır — yalnız öz tenant-ınızın müqavilələrini görür və yalnız
          onların mərhələlərini təsdiq/rədd edə bilərsiniz. Təsdiq/rədd əməliyyatı
          müqavilənin öz təsdiq qaydalarına tabedir.
        </p>
      </HelpCallout>
    </div>
  )
}
