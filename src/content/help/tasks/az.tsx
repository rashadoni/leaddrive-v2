"use client"

/**
 * Tasks — tapşırıqlar üzrə kömək (Azərbaycan).
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function TasksHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Burada nə edə bilərsiniz">
        <p>
          Tapşırıqlar bölməsi — <strong>üzərinizdə olan hər şeyi</strong> saxladığınız yerdir: zənglər,
          məktublar, sənədlər. Adi to-do siyahısından əlavə, burada iki güclü funksiya var:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Təkrarlanan ardıcıllıqlar</strong> — hər N gün/həftə/ay növbəti tapşırığın avtomatik yaradılması.</li>
          <li><strong>Şablonlar</strong> — yoxlama siyahısını bir dəfə yaddaşa verdiniz, hər yeni sövdələşməyə tətbiq etdiniz.</li>
        </ul>
      </HelpSection>

      <HelpSection title="Bir tapşırıq yaratmaq">
        <HelpStep n={1}>
          <p>Səhifənin yuxarısında <HelpKey>New Task</HelpKey> düyməsini sıxın.</p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Adı doldurun, istəsəniz sövdələşmə / kontakt / şirkətə bağlayın,
            son tarix, prioritet və icraçı təyin edin.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Yadda saxlayın. Tapşırıq siyahıda <strong>Pending (Gözləmə)</strong> statusu ilə görünəcək.
            <em>Completed</em> statusuna keçirmək — qeyd nişanı ilə və ya detal səhifəsindən.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Təkrarlanan ardıcıllıqlar (avtomatik izləmə)">
        <p>
          Həftəlik / aylıq / rüblük yerinə yetirdiyiniz tapşırıqlar üçün — ardıcıllığı
          bir dəfə qurun, sonra cari tapşırığı bağladıqda sistem növbəti nüsxəni özü yaradır.
        </p>
        <HelpStep n={1}>
          <p>Tapşırığın detal səhifəsində <strong>Recurring</strong> panelini açın.</p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Qaydanı seçin. Dəstəklənən qısayollar: <em>daily</em>, <em>weekly</em>,{" "}
            <em>monthly</em>, <em>yearly</em>. İxtiyari intervallar üçün —{" "}
            <code>every:N:day</code>, <code>every:N:week</code>, <code>every:N:month</code>{" "}
            (məsələn <code>every:3:day</code> = hər 3 gün). Monthly qaydası ayın gününü
            başlanğıcdakı kimi saxlayır; 31 yanvar → 28 fevral (clamped).
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Yadda saxlayın. İndi tapşırığı bağlamaq avtomatik olaraq son tarixi sürüşdürülmüş növbəti
            tapşırığı yaradacaq. Ardıcıllığı dayandırmaq — <HelpKey>Stop series</HelpKey> düyməsi.
            Artıq yaradılmış tapşırıqlar qalır, yeniləri görünməyəcək. Sistem qaydanı parent VƏ bütün
            children üçün atomar şəkildə təmizləyir, beləliklə &laquo;stop&raquo; həqiqətən stop deməkdir.
          </p>
        </HelpStep>
        <HelpCallout kind="tip" label="Məsləhət">
          <p>
            Ardıcıllıqlar <em>recurrenceParentId</em> vasitəsilə bağlıdır, beləliklə orijinaldan
            gələn hər nüsxəni görmək olur. Çoxdan ləğv edilməli olan köhnəlmiş izləmələri tutmaq
            üçün əlverişlidir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Tapşırıq şablonları (tez-tez yaradılan tapşırığı saxlamaq)">
        <p>
          Eyni tapşırıq həftə-həftə ortaya çıxdıqda —{" "}
          <em>&laquo;həftəlik status hesabatı&raquo;</em>,{" "}
          <em>&laquo;yeni müştəri üçün welcome&raquo;</em>,{" "}
          <em>&laquo;rüblük baxışa hazırlıq&raquo;</em> — onu şablon kimi saxlayın,
          nüsxəni bir kliklə yaradın.
        </p>
        <HelpStep n={1}>
          <p>
            <HelpKey>Settings → Task Templates</HelpKey>. <HelpKey>New template</HelpKey> sıxın.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Şablonu adlandırın, tapşırığın başlığını yazın (pleysholderlər dəstəklənir:{" "}
            <code>{`{{date}}`}</code>, <code>{`{{user}}`}</code>, <code>{`{{month}}`}</code>,{" "}
            <code>{`{{week}}`}</code> — avtomatik doldurulur). Prioritet,{" "}
            opsional <em>son tarix sürüşməsi</em> (məsələn <em>yaradılmadan +3 gün</em>), defolt
            icraçı və opsional altpunktların <strong>yoxlama siyahısını</strong> təyin edin.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <em>Share with team</em> keçidi — əgər həmkarlarınızın da şablondan istifadə edə
            bilməsini istəyirsinizsə (defolt olaraq söndürülüb — fərdi şablonlar).
          </p>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Yadda saxlayın. İstənilən tapşırıq yaratma formasında <HelpKey>From template</HelpKey>
            sıxın, şablonu seçin — tapşırıq artıq doldurulmuş sahələr və yoxlama siyahısı ilə yaradılır.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Statuslar və həyat dövrü">
        <dl className="rounded-md border p-3">
          <HelpDef term="Pending">Defolt status. Alətlər panelində filtrlənir.</HelpDef>
          <HelpDef term="In progress">İşə başladığınızda təyin edin. Menecerə &laquo;aktiv yük&raquo; kimi görünür.</HelpDef>
          <HelpDef term="Completed">Terminal — tapşırığı kilidləyir. Tapşırıq ardıcıllıqdadırsa — növbətinin yaradılması üçün triggerdir.</HelpDef>
          <HelpDef term="Cancelled">Terminal — növbəti nüsxə yaradılMAyacaq, zəncir qırılır.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Məsləhətlər">
        <HelpCallout kind="tip" label="Məsləhət">
          <p>
            Ardıcıllıqları şablonlarla birləşdirin: &laquo;Quarterly Business Review&raquo; şablonunu saxlayın,
            sonra ilk nüsxəyə <code>every:90:day</code> təyin edin — hər 90 gün
            yoxlama siyahısı ilə doldurulmuş təzə tapşırıq alırsınız.
          </p>
        </HelpCallout>
        <HelpCallout kind="warning" label="Diqqət">
          <p>
            Ardıcıllıqdakı tapşırığın ləğvi (<em>Cancelled</em>) <strong>zənciri dayandırır</strong> —
            növbəti nüsxələr OLMAYACAQ. Sadəcə bir nüsxəni ötürmək istəyirsinizsə —
            onu <em>Completed</em> kimi bağlayın, onda növbəti normal şəkildə yaradılacaq.
          </p>
        </HelpCallout>
      </HelpSection>
    </div>
  )
}
