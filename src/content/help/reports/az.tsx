"use client"

/**
 * Reports & Analytics — kömək məqaləsi (Azərbaycan), video-skript formatı.
 * Yalnız REAL səhifəni təsvir edir: /reports — yalnız-oxu analitik panel
 * (6 KPI kartı + 10 qrafik kartı + AI şərhi + lid hunisi drill-down dialoqu).
 * QEYD: səhifədə "New report" / No-Code Report Builder / Export / Schedule YOXDUR —
 * köhnə məqalə bunları uydurmuşdu, ona görə tam yenidən yazılıb.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ReportsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış rəhbəri, əməliyyat administratoru və ya komanda lideri"
        goal="Bütün biznesin nəbzini bir ekranda oxumaq — gəlir, boru xətti, lidlər, tapşırıqlar, tiketlər və proqnoz"
      >
        Səhifəyə soldakı menyudan <HelpKey>Hesabatlar</HelpKey> bölməsi ilə çatırsınız. Bu — yalnız-oxu
        analitik paneldir: heç nə yaratmırsınız, sadəcə oxuyursunuz. Bütün rəqəmlər səhifəyə girdiyiniz
        anda canlı çəkilir və yalnız sizin təşkilatınıza aiddir. Açılanda göstəricilər bir neçə saniyə
        yüklənə bilər — bu vaxt boz «yüklənir» kartları görünür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Hesabatlar və Analitika</HelpKey> adı (yanında turu yenidən oynatma və kömək
          düymələri), altında «Biznes analitikası və proqnozlar» izahı durur. Onun ardınca bir izah zolağı
          və <strong>«Bilirdinizmi?»</strong> məsləhət bloku gəlir. Sonra üst hissədə altı rəngli{" "}
          <strong>KPI kartı</strong> bir sıraya düzülür, onların altında isə on <strong>qrafik kartı</strong>{" "}
          tor şəklində yerləşir. Hər kartın yuxarı küncündə kiçik ikon var; bəzilərinin başlığının yanında
          siçanı saxlayanda izah verən <strong>ⓘ</strong> işarəsi (info-ipucu) görünür.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Müştərilər">Təşkilatınızdakı şirkətlərin (müştərilərin) ümumi sayı.</HelpDef>
          <HelpDef term="Kontaktlar">Bütün kontakt şəxslərin sayı.</HelpDef>
          <HelpDef term="Sövdələşmələr">Bütün sövdələşmələrin sayı.</HelpDef>
          <HelpDef term="Lidlər (yeni)">Yeni lidlərin sayı.</HelpDef>
          <HelpDef term="Tapşırıqlar (gecikmiş)">Vaxtı keçmiş tapşırıqların sayı.</HelpDef>
          <HelpDef term="Tiketlər">Dəstək tiketlərinin ümumi sayı.</HelpDef>
          <HelpDef term="Maliyyə icmalı">Qazanılmış gəlir, aylıq kontraktlar, ümumi huni dəyəri və kontrakt sayları.</HelpDef>
          <HelpDef term="Sövdələşmə boru xətti">Sövdələşmələrin mərhələlərə görə dəyər və sayı — hər mərhələ üfüqi zolaqla.</HelpDef>
          <HelpDef term="Lid hunisi">Yeni → əlaqə → kvalifikasiya → konvertasiya piramidası; mərhələ klikləniləndir.</HelpDef>
          <HelpDef term="Tapşırıq xülasəsi">Dairəvi göstərici (tamamlanma %) + statuslar üzrə bölgü + gecikmiş say.</HelpDef>
          <HelpDef term="Top-10 Müştəri">Gəlirə görə sıralanmış ən yaxşı şirkətlər; məlumat yoxdursa «Məlumat yoxdur».</HelpDef>
          <HelpDef term="Satış proqnozu">Faktiki (boz) + proqnoz (mavi, kəsik-kəsik) sütun qrafiki + AI şərhi.</HelpDef>
          <HelpDef term="Bilet SLA">Dairəvi göstərici (həll %) + tiket statuslarının bölgüsü.</HelpDef>
          <HelpDef term="Lid konversiyası">Konversiya faizi + statuslara görə lid sayı.</HelpDef>
          <HelpDef term="Müştəri məmnuniyyəti (CSAT)">Orta bal (… / 5) + ulduzlara görə qiymət bölgüsü.</HelpDef>
          <HelpDef term="Sövdələşmə gəliri">Qazanılmış gəlir, qazanılmış sövdələşmə sayı və orta sövdələşmə ölçüsü.</HelpDef>
        </dl>
        <p>
          Bütün pul dəyərləri manatla (<strong>₼</strong>) göstərilir. Bu səhifədə heç nə redaktə edilmir —
          rəqəmləri dəyişmək üçün müvafiq modulda (sövdələşmələr, lidlər, tiketlər) qeydləri yeniləyirsiniz,
          burada isə nəticəni oxuyursunuz.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: paneli oxu">
        <HelpStep n={1}>
          <p>
            Soldakı menyudan <HelpKey>Hesabatlar</HelpKey> bölməsinə keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Səhifə açılarkən başlıq görünür, altında isə qısa müddət boz, «nəbz» effekti ilə titrəyən altı
            kart yer alır — bu, məlumatın yükləndiyini bildirir. Yükləmə bitən kimi onlar real KPI kartları
            ilə əvəzlənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Üst sıradakı altı <strong>KPI kartına</strong> baxın: <HelpKey>Müştərilər</HelpKey>,{" "}
            <HelpKey>Kontaktlar</HelpKey>, <HelpKey>Sövdələşmələr</HelpKey>, <HelpKey>Lidlər (yeni)</HelpKey>,{" "}
            <HelpKey>Tapşırıqlar (gecikmiş)</HelpKey> və <HelpKey>Tiketlər</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kartda bir rəqəm və izah etiketi, solda isə kiçik ikon (bina, insanlar, dollar, hədəf, qeyd,
            saat) olur. Bunlar bütün biznesin ümumi mənzərəsidir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Aşağıdakı qrafik kartlarını oxuyun. Başlığın yanındakı <strong>ⓘ</strong> işarəsinin üzərinə
            siçanı gətirin — həmin kartın nəyi göstərdiyi qısaca izah olunur.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Maliyyə icmalı</strong> kartında «Gəlir (qazanılmış)» yaşıl rəqəmlə, «Aylıq (kontraktlar)»,
            «Huni (ümumi)», aşağıda isə xətlə ayrılmış «Cəmi kontraktlar» və «Aktiv» sətirləri görünür.{" "}
            <strong>Sövdələşmə boru xətti</strong> kartında yuxarıda ümumi huni dəyəri, altında hər mərhələ
            («Lid», «Kvalifikasiya», «Təklif», «Danışıqlar», «Qazandı», «Uduzdu») say · dəyər və dolan zolaqla
            göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <strong>Tapşırıq xülasəsi</strong> və <strong>Bilet SLA</strong> kartlarındakı dairəvi
            göstəricilərə baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Solda dairəvi diaqram faizi göstərir (tapşırıqda yaşıl «Tamamlandı», tiketdə bənövşəyi «Həll
            olundu»), sağda isə statuslar üzrə sayma sətirləri sıralanır. Tapşırıq kartında ən altda qırmızı
            rənglə «Gecikmiş» sayı vurğulanır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: lid hunisindən konkret lidlərə keç (drill-down)">
        <HelpStep n={1}>
          <p>
            <strong>Lid hunisi</strong> kartında piramidanın hər hansı mərhələ zolağına (məsələn{" "}
            <HelpKey>Yeni</HelpKey>, <HelpKey>Əlaqə saxlanıldı</HelpKey>, <HelpKey>Kvalifikasiya</HelpKey>,{" "}
            <HelpKey>Konvertasiya</HelpKey>) klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər zolaq fərqli rənglə işarələnir, ad və say yanında yazılır, mərhələlər arasında kiçik «… %
            konversiya» göstəricisi olur. Zolağın üzərinə siçanı gətirəndə «… lidlərə baxmaq üçün klikləyin»
            ipucu çıxır; klikləyəndə zolaq bir az böyüyür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Açılan pəncərədə həmin mərhələnin lidlərinin siyahısını oxuyun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «&lt;mərhələ&gt; lidlər (&lt;say&gt;)» başlıqlı dialoq açılır. Əvvəlcə fırlanan yükləmə ikonası
            görünür; lidlər yoxdursa «Lid tapılmadı» yazısı çıxır; varsa cədvəl gəlir — sütunlar:{" "}
            <strong>Ad</strong>, <strong>Şirkət</strong>, <strong>Bal</strong>, <strong>Mənbə</strong>. Bal
            rənglə kodlaşır: yüksək — yaşıl, orta — sarı, aşağı — qırmızı.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Cədvəldə hər hansı lid sətrinə klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Brauzer həmin lidin tam kartına (<HelpKey>/leads/&lt;id&gt;</HelpKey>) keçir — beləcə paneldəki
            ümumi rəqəmdən birbaşa konkret qeydə düşürsünüz. Dialoqu bağlamaq üçün kənara klikləyin və ya × ilə
            örtün.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: satış proqnozu və AI şərhi">
        <HelpStep n={1}>
          <p>
            <strong>Satış proqnozu</strong> kartını tapın (yuxarı yön ikonası ilə).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sütun qrafiki: boz sütunlar keçmiş ayları (<strong>Faktiki</strong>), mavi kəsik-kəsik kənarlı
            sütunlar isə gələcək ayları (<strong>Proqnoz</strong>) göstərir. Aşağıda ay adları, daha altda
            isə əfsanə (legend) və «6m total: …k ₼» yekun rəqəmi durur. Artım müsbətdirsə başlıqda yaşıl «+…%»
            nişanı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Kartın altındakı <HelpKey>AI Şərh</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə əvvəlcə «Analitika yaradılır…» vəziyyətinə keçir, sonra bənövşəyi qutuda süni intellektin
            proqnoz üzrə qısa izahı görünür. Xəta olarsa qırmızı «Yükləmə xətası — yenidən cəhd edin» yazısı
            çıxır; onu yenidən basaraq təkrar cəhd edə bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Qalan kartları oxuyun: <strong>Top-10 Müştəri</strong>, <strong>Lid konversiyası</strong>,{" "}
            <strong>Müştəri məmnuniyyəti (CSAT)</strong> və <strong>Sövdələşmə gəliri</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Top-10 kartında şirkətlər nömrələnir, gəlir məbləği və miqyas zolağı ilə düzülür (boşdursa «Məlumat
            yoxdur»). CSAT kartında orta bal «… / 5» kimi, altında 5-dən 1-ə qədər ulduz sətirləri göstərilir.
            Sövdələşmə gəliri kartında qazanılmış gəlir, qazanılmış müqavilə sayı və orta ölçü durur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Rəqəm gözlənildiyindən fərqlidirsə, onu burada düzəltməyə çalışmayın — bu səhifə yalnız oxumaq
          üçündür. Mənbəyə keçin: lid hunisindəki zolağa klikləyib konkret lidlərə baxın, ya da müvafiq modulda
          (sövdələşmələr / tiketlər / tapşırıqlar) qeydi yeniləyin; sonra bu səhifəni yenidən açın və rəqəm
          özü yenilənəcək.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Proqnozun mavi sütunları <strong>təxminidir</strong> — keçmiş gəlirə əsaslanan sadə artım
          modelidir, zəmanətli plan deyil. Onu istiqamət kimi qəbul edin, taxmin, məbləğ kimi yox. «AI Şərh»
          mətni də köməkçi izahdır; mühüm qərarlardan əvvəl əsas rəqəmlərlə tutuşdurun.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün göstəricilər təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın məlumatını görürsünüz, başqa
          təşkilatın rəqəmləri bu panelə düşmür. Lid drill-down dialoqu və açılan lid kartı da eyni təşkilat
          əhatəsi daxilindədir.
        </p>
      </HelpCallout>
    </div>
  )
}
