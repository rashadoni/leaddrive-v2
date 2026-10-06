"use client"

// Current compact list, detail panel and draft-first workflow. No video regenerated.
import { HelpScenario, HelpSection, HelpStep, HelpCallout } from "@/components/help/help-content"

export default function EntitlementsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="Siz dəstək meneceri və ya administratorsunuz" goal="Müştərinin şərtlərini tapmaq, riskləri yoxlamaq və müqaviləni aktivləşdirməyə hazırlamaq">
        Dəstək → Dəstək şərtləri bölməsini açın. Şərt şirkəti SLA siyasəti, dəstək səviyyəsi, qüvvədəolma müddəti və mərhələ qaydaları ilə əlaqələndirir. Siyahı yalnız təşkilatınıza aiddir.
      </HelpScenario>
      <HelpCallout kind="tip"><p>Məsələn: müştəri üçün şərtlərin qaralamasını yaradın, SLA siyasətini seçin, mərhələ qaydalarını köçürmək üçün şablonu tətbiq edin, nüsxəni yoxlayın, sonra şərtləri aktivləşdirin. Şablonun sonrakı dəyişiklikləri köçürülmüş qaydaları yeniləmir. SLA siyasəti cavab və həll hədəflərini, şərtlər isə əlavə mərhələ qaydalarını müəyyən edir.</p></HelpCallout>
      <HelpSection title="Lazımi şərtləri tapın">
        <HelpStep n={1}>
          <p>Yığcam xülasədə 30 gün ərzində bitən şərtlər, diqqət tələb edən mərhələlər və əhatəsi olmayan aktiv şirkətlər göstərilir. Müvafiq risk filtrini tətbiq etmək üçün bitmə və ya diqqət göstəricisinə basın.</p>
        </HelpStep>
        <HelpStep n={2}>
          <p>Siyahını şirkət, status, dəstək səviyyəsi, SLA siyasəti və risk üzrə süzün. Dar ekranda əvvəlcə filtrləri açın. Uyğun nəticə yoxdursa, filtrləri sıfırlayın; bu, təşkilatda heç bir şərtin olmamasından fərqlidir.</p>
        </HelpStep>
        <HelpStep n={3}>
          <p>Geniş ekranda şirkət, səviyyə, SLA, müddət, mərhələlərin vəziyyəti və status cədvəldə göstərilir. Dar ekranda eyni şərtlər yığcam sətirlərdə görünür. Təfərrüatları yan paneldə açmaq üçün şirkətin adına və ya baxış əməliyyatına basın.</p>
        </HelpStep>
      </HelpSection>
      <HelpSection title="Təfərrüatları oxuyun">
        <HelpStep n={1}>
          <p>Paneldə şirkət, səviyyə və status, SLA siyasəti, müddət, qaydaların sayı və mərhələlərin vəziyyəti göstərilir. Bitmə tarixi yoxdursa, şərt müddətsizdir. Aşağıda mərhələ qaydaları və doldurulmuş qeydlər yerləşir.</p>
        </HelpStep>
        <HelpStep n={2}>
          <p>Gecikmə sayı son 30 gündə vaxtı keçmiş açıq mərhələləri əhatə edir. Risk altında olan mərhələ isə növbəti 24 saatda tamamlanmalı olan açıq mərhələdir. Təkcə rəngə deyil, vəziyyət mətninə də baxın. Araşdırma üçün müştərinin əlaqəli tiketlərini və ya SLA ayarlarını açın.</p>
        </HelpStep>
        <HelpStep n={3}>
          <p>Siyahıya qayıtmaq üçün paneli bağlayın. Təfərrüatlara baxmaq şərti dəyişmir.</p>
        </HelpStep>
      </HelpSection>
      <HelpSection title="Qaralama yaradın və qaydaları qurun">
        <HelpStep n={1}>
          <p>Yazma icazəniz varsa, ayrıca forma panelini açmaq üçün “Dəstək şərti yarat” düyməsinə basın. Şirkət, SLA siyasəti və dəstək səviyyəsini seçin, başlanğıc tarixini daxil edin. Lazım olduqda bitmə tarixi və qeydlər əlavə edin. Şirkət və ya siyasət yoxdursa, əvvəlcə onları müvafiq bölmələrdə hazırlayın.</p>
        </HelpStep>
        <HelpStep n={2}>
          <p>“Qaralama yarat” düyməsinə basın. Şərt əvvəlcə qaralama kimi saxlanır. Təfərrüatlarda “Qaydaları qur” bölməsini açıb mövcud şablondan istifadə edin və ya lazımi mərhələləri, müddətləri və əhatə dairəsini əlavə edin. Qaralama aktiv əhatə demək deyil.</p>
        </HelpStep>
        <HelpStep n={3}>
          <p>Qaydaları yoxladıqdan sonra mövcud aktivləşdirmə əməliyyatını seçin və dialoqda təsdiqləyin. Aktivləşdirmə üçün ən azı bir mərhələ qaydası tələb olunur. Mövcud əməliyyatlar icazələrinizdən və cari statusdan asılıdır.</p>
        </HelpStep>
      </HelpSection>
      <HelpSection title="Dəyişikliklər və xətadan sonra davam">
        <HelpStep n={1}>
          <p>Yazma icazəsi ilə sahələri və qaydaları yalnız qaralama və dayandırılmış şərtlərdə redaktə etmək olar. Aktiv şərt üçün əvvəlcə icazə verilən status keçidi lazımdır; paneldə təklif olunan əməliyyatlardan istifadə edin.</p>
        </HelpStep>
        <HelpStep n={2}>
          <p>Dayandırma, davam etdirmə, müddəti bitirmə və ləğv statusdan və ayrıca icazələrdən asılıdır. Keçid dialoqunu oxuyun və tələb olunduqda səbəb yazın. Qaydanın silinməsi də təsdiq tələb edir.</p>
        </HelpStep>
        <HelpStep n={3}>
          <p>Saxlama uğursuz olarsa, göstərilən xətanı aradan qaldırıb yenidən cəhd edin. Dəyişdirilmiş formanı bağlayarkən saxlanmamış dəyişikliklərdən imtinanı təsdiqləyin. Yükləmə xətasında mövcud olduqda təkrar cəhd düyməsindən istifadə edin; təkrar sorğu giriş qadağasını aradan qaldırmır.</p>
        </HelpStep>
      </HelpSection>
      <HelpCallout kind="warning">
        <p>Mərhələ qaydaları SLA siyasətini tamamlayır. Qaralama yaratmaq və ya xülasəyə baxmaq əhatəni aktivləşdirmir və gecikmiş işi avtomatik həll etmir.</p>
      </HelpCallout>
      <HelpCallout kind="security">
        <p>Baxış, yazma, aktivləşdirmə və ləğv icazələri ayrıca yoxlanılır. Yalnız oxuma girişində dəyişiklik əməliyyatları göstərilmir. Yalnız təşkilatınızın şərtləri ilə işləyin.</p>
      </HelpCallout>
    </div>
  )
}
