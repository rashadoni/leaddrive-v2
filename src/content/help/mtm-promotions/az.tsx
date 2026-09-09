"use client"

/** Aptek aksiyaları — fakt, yoxlama və konfiqurasiya üçün rol əsaslı kömək. */
import {
  HelpCallout,
  HelpDef,
  HelpKey,
  HelpScenario,
  HelpSection,
  HelpStep,
} from "@/components/help/help-content"

export default function MtmPromotionsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Siz sahə agenti, yoxlayıcı, menecer və ya MTM administratorusunuz"
        goal="İlkin hesablamanı yazılmış ballarla qarışdırmadan aptek aksiyası faktını qeyd və yoxlama mərhələlərindən keçirmək"
      >
        <HelpKey>Marşrutlar və sahə</HelpKey> → <HelpKey>Aptek aksiyaları</HelpKey> bölməsini açın.
        Səhifə yalnız rolunuza icazə verilən görünüşləri və əməliyyatları göstərir.
      </HelpScenario>

      <HelpSection title="Rolunuza uyğun başlayın">
        <dl className="rounded-md border p-3">
          <HelpDef term="Sahə agenti">
            <strong>Reyestr</strong> bölməsində təyin olunmuş apteki özünüz seçin, tələb edilirsə
            tamamlanmış ziyarəti bağlayın, faktiki miqdarı daxil edib təsdiqləyin.
          </HelpDef>
          <HelpDef term="Yoxlayıcı və ya menecer">
            <strong>Yoxlama növbəsi</strong> ilə başlayın. Cari L1 və ya L2 mərhələsini server seçir;
            siz qərarı seçir və onun ilkin nəticəsini təsdiqləyirsiniz.
          </HelpDef>
          <HelpDef term="Administrator">
            İmzalanmış təriflər və kampaniya versiyaları üçün <strong>Kampaniyalar</strong> bölməsindən
            istifadə edin. Əməliyyat qərarları <strong>Yoxlama növbəsi</strong>ndə qalır.
          </HelpDef>
          <HelpDef term="Yalnız oxuma icazəsi olan istifadəçi">
            <strong>Reyestr</strong> bölməsində faktları, sübutları, yoxlama statuslarını və növbəti
            məsul rolu dəyişiklik etmədən izləyin.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Sahə agenti: bir faktı qeyd edin">
        <HelpStep n={1}>
          <HelpKey>Planlaşdırılmış aptek</HelpKey>i özünüz seçin. Heç nə avtomatik seçilmir və siyahıda
          yalnız hesabınıza icazə verilən təyinatlar göstərilir.
        </HelpStep>
        <HelpStep n={2}>
          İmzalanmış uyğunluq qaydası tələb edirsə, müvafiq{" "}
          <HelpKey>Tamamlanmış vizit</HelpKey>i seçin, sonra <HelpKey>Faktiki miqdar</HelpKey>ı daxil
          edin. Səhifə tələb olunan ziyarətin çatışmadığını bildirir, lakin özü istisna yaratmır.
        </HelpStep>
        <HelpStep n={3}>
          <HelpKey>Faktı saxla</HelpKey> düyməsini basın, təsdiq pəncərəsində apteki, ziyarəti, planı
          və faktı yoxlayıb təsdiqləyin. Əməliyyat əvvəlcə cihaz növbəsində saxlanılır, sinxronizasiya
          zamanı isə server onu yenidən yoxlayır.
        </HelpStep>
        <HelpCallout kind="tip" label="Məsləhət">
          İnternet kəsilərsə, əməliyyatı növbədə saxlayın. Şəbəkə bərpa olunanda{" "}
          <HelpKey>Sinxronlaşdır</HelpKey> onu göndərəcək. Müvəqqəti xəta üçün{" "}
          <HelpKey>Təkrar et</HelpKey> seçin; yalnız göndərmək istəmədiyiniz əməliyyatı silin.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Yoxlayıcı: serverin təyin etdiyi mərhələdə qərar verin">
        <HelpStep n={1}>
          <HelpKey>Yoxlama növbəsi</HelpKey>ni açın və apteki, plan/faktı, sübutları, L1/L2
          statuslarını, siyasət bloklarını və növbəti məsul rolu yoxlayın. Tam audit tarixçəsi üçün
          sətri açın.
        </HelpStep>
        <HelpStep n={2}>
          <HelpKey>Yoxla</HelpKey> düyməsini basın. Pəncərədə cari L1 və ya L2 mərhələsi göstərilir;
          onu seçmək və ya ötürmək olmur. <HelpKey>Təsdiqlə</HelpKey>,{" "}
          <HelpKey>Düzəlişə qaytar</HelpKey> və ya <HelpKey>Rədd et</HelpKey> qərarını seçin. Geri
          qaytarma və rədd üçün səbəb tələb olunur.
        </HelpStep>
        <HelpStep n={3}>
          <HelpKey>Server ön baxışını yarat</HelpKey> düyməsini basın. Serverin hesabladığı dəyərləri
          və növbəti statusu yoxlayın, sonra qərarı tətbiq edin. Qərar və ya səbəb dəyişdikdə köhnə
          ilkin nəticə ləğv edilir; tətbiqdən əvvəl server hüquqlarınızı, versiyaları və dəqiq heşi
          yenidən yoxlayır.
        </HelpStep>
        <HelpCallout kind="warning" label="Vacib">
          Kütləvi yoxlama yalnız eyni cari mərhələdə açıq şəkildə seçilmiş sətirlər üçün mümkündür.
          Sətirdə «Yoxla» əməliyyatı yoxdursa, həmin sətir sizin rolunuz üçün hələ hazır deyil.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Menecer: balları düzgün oxuyun">
        <dl className="rounded-md border p-3">
          <HelpDef term="İlkin hesablama">
            Cari fakt və sabitlənmiş qayda versiyası üzrə server hesablamasıdır. Bu, hələ yazılmış bal
            balansı deyil.
          </HelpDef>
          <HelpDef term="Jurnala yazılmış bal">
            Tələb olunan qərarlar və bal yazma icazəsi uğurla tamamlandıqdan sonra yaranan qeyddir.
            Yazılmanı və ya sonrakı düzəlişi yoxlamaq üçün detal tarixçəsini açın.
          </HelpDef>
          <HelpDef term="Bal yazılması bloklanıb">
            Fakt saxlanılır və yoxlama üçün qalır, lakin imzalanmış konfiqurasiya və təşkilat icazəsi
            hazır olmayana qədər jurnal qeydi yaranmır. Bloklanma <strong>sıfır bal demək deyil</strong>.
          </HelpDef>
        </dl>
        <p>
          Komanda, menecer, kampaniya və ya yoxlama mərhələsini izləmək üçün reyestr filtrlərindən və
          şəxsi saxlanılmış görünüşdən istifadə edin. Yazılmış balların mənbəyi jurnaldır; düzəlişlər
          məbləğin səssiz dəyişdirilməsi deyil, ayrıca audit olunan qeydlərdir.
        </p>
      </HelpSection>

      <HelpSection title="Administrator: sazlayın, imzalayın, sonra dərc edin">
        <HelpStep n={1}>
          <HelpKey>İmzalanmış təriflər kataloqu</HelpKey>nda aksiya növləri, formulalar və L1/L2
          siyasətləri üçün qaralamaları yalnız təsdiqlənmiş mənbədən yaradın. Formula və siyasəti
          aktivləşdirməzdən əvvəl server heşini sənədlə müqayisə edin və təsdiq istinadını daxil edin.
        </HelpStep>
        <HelpStep n={2}>
          <HelpKey>Kampaniya versiyaları</HelpKey>nda kampaniya və aktiv imzalanmış təriflərə əsaslanan
          dəyişməz versiya yaradın. Təsdiqlənmiş dövrü, saat qurşağını, uyğunluq tərifini və mənbə
          məlumatını daxil edin; dərc etməzdən əvvəl versiya heşini və təsdiq istinadlarını yoxlayın.
        </HelpStep>
        <HelpStep n={3}>
          Versiyanın dərc edilməsi ilə balların yazılmasına icazə ayrı nəzarətlərdir.
          Səhifə bal yazılmasının bloklandığını deyirsə, göstərilən imzalanmış qayda və ya təşkilat
          sazlamasını tamamlayın; çatışmayan qaydanı təxmin etməyin.
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="security" label="Təsdiqlənmiş qaydalar">
        Formula, uyğunluq meyarı, L1/L2 rolu, təsdiq istinadı, dövr və ya saat qurşağı uydurmayın.
        İnterfeys təsdiqlənməmiş biznes dəyərlərini bilərəkdən boş saxlayır və təsdiqlənmiş mənbə
        təqdim olunana qədər prosesi bağlı saxlayır.
      </HelpCallout>
    </div>
  )
}
