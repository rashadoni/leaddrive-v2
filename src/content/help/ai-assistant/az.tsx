"use client"

import {
  HelpCallout,
  HelpDef,
  HelpKey,
  HelpSection,
  HelpStep,
} from "@/components/help/help-content"

export default function AiAssistantHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Da Vinci-ni açın və bir dəqiq sual verin">
        <p>
          Da Vinci CRM məlumatlarını yoxlamağa, vəziyyəti təhlil etməyə, dəstəklənən qeydləri
          tapmağa və dəstəklənən əməliyyatları hazırlamağa kömək edir. Əlçatanlıq təşkilat
          parametrlərindən, aktiv modullardan və icazələrinizdən asılıdır.
        </p>
        <HelpStep n={1}>
          <p>
            Dashboard-dakı Da Vinci sahəsindən və ya mövcud <HelpKey>Da Vinci-dan soruş</HelpKey>
            əməliyyatından istifadə edin. Sualı yazıb <HelpKey>Enter</HelpKey> basın; yeni sətir üçün
            <HelpKey>Shift + Enter</HelpKey> istifadə edin.
          </p>
          <HelpCallout kind="see" label="Nə görəcəksiniz">
            Köməkçi sağda açılacaq və sizi CRM ekranından ayırmadan söhbətə başlayacaq.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Lazım olan obyekti, əhatəni və nəticəni qeyd edin. Keçmiş fəaliyyət barədə sualda dövrü
            göstərin, məsələn: «Bu ay itirilmiş sövdələşmələri sahibə görə göstər».
          </p>
          <HelpCallout kind="see" label="Nə görəcəksiniz">
            Dəqiq sorğu daha faydalı xülasə, yoxlanılan nəticə və ya vacib detal çatmırsa dəqiqləşdirici
            sual verəcək.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip" label="Məsləhət">
          Hesabat və «necə etməli» suallarını ayrı-ayrı verin. Beləliklə, Da Vinci təlimatı rəqəmli
          hesabatla qarışdırmadan tələb olunan CRM məlumatını yoxlaya bilər.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Cavabı və nəticə vəziyyətini oxuyun">
        <dl className="rounded-md border p-3">
          <HelpDef term="Cavab">Mövcud kontekstə əsaslanan qısa izah və ya təhlil.</HelpDef>
          <HelpDef term="Nəticələr">Dəstəklənən CRM axtarışı üçün yalnız oxunan cədvəl görünə bilər. CRM-də davam etmək üçün sətri və ya tam siyahını açın.</HelpDef>
          <HelpDef term="Yoxlanılmadı">Da Vinci CRM-dən etibarlı sübut əldə etməyib. Təxmini fakt saymaq əvəzinə obyekti, filtrləri və ya dövrü dəqiqləşdirin.</HelpDef>
          <HelpDef term="Əlçatan deyil">Sorğu üçün funksiya, modul, konfiqurasiya və ya lazımi icazə aktiv deyil.</HelpDef>
        </dl>
        <p>
          Panel cari səhifəni və son söhbəti kontekst kimi nəzərə ala bilər. Cədvəl və ya uzun cavab
          üçün daha çox yer lazım olanda paneli genişləndirin.
        </p>
      </HelpSection>

      <HelpSection title="CRM məlumatı dəyişməzdən əvvəl əməliyyatları yoxlayın">
        <HelpStep n={1}>
          <p>Cavabın altındakı əməliyyat kartını və onun statusunu oxuyun.</p>
          <HelpCallout kind="see" label="Nə görəcəksiniz">
            Yalnız oxunan nəticələr naviqasiya üçündür. İcazə verilən aşağı riskli əməliyyatlar dərhal
            tamamlana bilər; yüksək riskli əməliyyatlarda <HelpKey>Təsdiq gözləyir</HelpKey> görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Təsdiq et</HelpKey> seçməzdən əvvəl əməliyyat tipini, alıcını, qeydi və göstərilən
            sahələri yoxlayın. Nəsə səhv və ya aydın deyilsə, <HelpKey>İmtina et</HelpKey> seçin.
          </p>
          <HelpCallout kind="see" label="Nə görəcəksiniz">
            Təsdiqlənmiş əməliyyat bir dəfə icra olunur və «Tamamlandı» və ya «Xəta» statusu alır.
            İmtina edilmiş əməliyyat icra olunmur.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning" label="Vacibdir">
          Süni intellekt cavabı natamam və ya səhv ola bilər. Müştəri mesajlarını, maliyyə faktlarını,
          hüquqi öhdəlikləri, qeyd dəyişikliklərini və digər kritik qərarları icradan əvvəl yoxlayın.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Söhbəti idarə edin">
        <dl className="rounded-md border p-3">
          <HelpDef term="?">Bu təlimatı açmaq.</HelpDef>
          <HelpDef term="Genişləndir">Uzun cavablar və cədvəllər üçün paneli böyütmək.</HelpDef>
          <HelpDef term="Təmizlə">Görünən söhbəti paneldən silmək. CRM qeydləri silinmir.</HelpDef>
          <HelpDef term="Bağla">Paneli gizlətmək. Təlimat açıq deyilsə, Escape düyməsini də basa bilərsiniz.</HelpDef>
        </dl>
      </HelpSection>

      <HelpCallout kind="security" label="Təhlükəsizlik">
        Da Vinci təşkilatınız və icazələrinizlə məhdudlaşır, amma yenə də parolları, giriş tokenlərini,
        ödəniş kartı məlumatlarını və əlaqəsiz məxfi materialları daxil etməyin. Köməkçi qurulmadığını
        və ya girişiniz olmadığını bildirirsə, administratordan AI parametrlərini və rolunuzu yoxlamağı
        xahiş edin.
      </HelpCallout>
    </div>
  )
}
