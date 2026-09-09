"use client"

/**
 * Macros — T7 üzrə yardım (Azərbaycan dili).
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MacrosHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Makro nə edir">
        <p>
          <strong>Makro</strong> — bir kliklə tiketə tətbiq etdiyiniz yadda saxlanmış
          əməliyyatlar ardıcıllığıdır. Hər dəfə{" "}
          <em>statusu dəyiş → prioriteti dəyiş → yenidən təyin et → cavab əlavə et → teq</em>{" "}
          addımlarını ayrıca etmək əvəzinə, bir makro işə salırsınız və bütün zəncir
          atomar şəkildə icra olunur.
        </p>
        <p>
          Təkrarlanan iş axını ilə yüksək tiket axınında çalışan support / ops komandaları
          üçün hazırlanıb: <em>&laquo;billing kimi triaj et&raquo;</em>,{" "}
          <em>&laquo;tier-2-yə eskalasiya et&raquo;</em>, <em>&laquo;dublikat kimi bağla&raquo;</em>.
        </p>
      </HelpSection>

      <HelpSection title="Makro yarat">
        <HelpStep n={1}>
          <p>
            <HelpKey>Settings → Macros</HelpKey>. <HelpKey>New macro</HelpKey> düyməsinə basın.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Ad verin (məsələn <em>&laquo;Triage as billing&raquo;</em>), kateqoriya seçin{" "}
            (<em>general / billing / technical / onboarding / sales</em>), istəsəniz
            təsvir və qısayol klavişi əlavə edin.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Əməliyyatları</strong> ardıcıllıqla əlavə edin. Makro onları yuxarıdan
            aşağıya icra edir. Mövcud növlər:
          </p>
          <dl className="rounded-md border p-3 mt-2">
            <HelpDef term="set_status">Statusu dəyiş: new / in_progress / waiting / resolved / closed.</HelpDef>
            <HelpDef term="set_priority">Prioriteti dəyiş: low / medium / high / critical.</HelpDef>
            <HelpDef term="set_assignee">Tiketi istifadəçiyə yenidən təyin et.</HelpDef>
            <HelpDef term="add_comment">Publik cavab əlavə et (müştəriyə görünür).</HelpDef>
            <HelpDef term="add_internal_note">Şəxsi qeyd əlavə et (yalnız daxili).</HelpDef>
            <HelpDef term="add_tag">Teq əlavə et.</HelpDef>
            <HelpDef term="remove_tag">Teqi sil.</HelpDef>
          </dl>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            İstəyə bağlı — <strong>qaynar klaviş</strong> (məsələn <code>cmd+shift+1</code>),
            beləliklə makronu istənilən tiketdən menyunu açmadan işə salasınız.{" "}
            <em>Active</em> aktiv olaraq yadda saxlayın.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Tiketdə makronu işə sal">
        <HelpStep n={1}>
          <p>
            Tiketin detal səhifəsini açın. Makro işəsalıcısını tapın{" "}
            (<HelpKey>Macros</HelpKey> ikonu/düyməsi alətlər panelində).
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Makronu adına görə seçin və ya tiket səhifəsinin istənilən yerindən onun qaynar
            klavişinə basın. Bütün əməliyyatlar növbə ilə icra olunur, tiket tətbiq edilmiş
            dəyişikliklərlə yenidən render olunur.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Makronun <em>usageCount</em> sayğacı artır — populyar makrolar növbəti dəfə
            işəsalıcıda daha yuxarıda görünür.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Faydalı şablonlar">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Triage as billing</strong> — <em>set_priority=medium</em>,{" "}
            <em>add_tag=billing</em>, <em>set_assignee=billing-team-lead</em>,{" "}
            <em>add_internal_note=&laquo;Routed via macro&raquo;</em>.
          </li>
          <li>
            <strong>Close as duplicate</strong> — <em>set_status=closed</em>,{" "}
            <em>add_tag=duplicate</em>, <em>add_comment=&laquo;#XYZ-in dublikatı — orijinala baxın.&raquo;</em>.
          </li>
          <li>
            <strong>Escalate to tier-2</strong> — <em>set_priority=high</em>,{" "}
            <em>set_assignee=tier2-lead</em>, <em>add_tag=escalated</em>,{" "}
            <em>add_internal_note=&laquo;Kontekst üçün mövzuya baxın.&raquo;</em>.
          </li>
          <li>
            <strong>Awaiting customer</strong> — <em>set_status=waiting</em>,{" "}
            <em>add_tag=awaiting-customer</em>,{" "}
            <em>add_comment=&laquo;Bir az daha çox məlumat lazımdır...&raquo;</em>.
          </li>
        </ul>
      </HelpSection>

      <HelpSection title="Məsləhətlər və məhdudiyyətlər">
        <HelpCallout kind="tip" label="Məsləhət">
          <p>
            <strong>Ardıcıllıq vacibdir.</strong> Əməliyyatlar yuxarıdan aşağıya gedir — əgər{" "}
            <em>set_status=closed</em> birinci, <em>add_comment</em> isə ikinci olsa, şərh
            bağlanmadan sonra gəlir (yenə də görünür, lakin timestamp bağlanışdan sonrakını
            göstərir). Audit-treyl üçün vacibdirsə, ardıcıllığı dəyişin.
          </p>
        </HelpCallout>
        <HelpCallout kind="warning" label="Diqqət">
          <p>
            Makroları geri qaytarmaq olmaz. &laquo;undo macro&raquo; düyməsi yoxdur. Əgər makro
            səhv işləsə (səhv müştəri, səhv teq) — hər əməliyyatı əl ilə geri alın. Riskli
            makrolar üçün test tiketində sınaqdan keçirməyincə <em>Active</em>-i söndürülmüş
            saxlayın.
          </p>
        </HelpCallout>
        <HelpCallout kind="security" label="Təhlükəsizlik">
          <p>
            Makro <strong>çağıran istifadəçinin sessiyasında</strong> icra olunur — makronun
            özünün daxilində imtiyaz sərhədi yoxdur. Makronun effekti = həmin istifadəçinin
            tiketi əl ilə redaktə edərək edə biləcəyi şeydir, sadəcə bir klikə paketlənmişdir.
            Ümumi makroları kimin yaratdığına şüurlu yanaşın: tiketləri bağlayan makronu ümumiyyətlə
            makro işə salmaq hüququ olan istənilən şəxs işə sala bilər.
          </p>
        </HelpCallout>
      </HelpSection>
    </div>
  )
}
