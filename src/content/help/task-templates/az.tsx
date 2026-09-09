"use client"

/**
 * Task Templates — help article (Azerbaijani).
 * en.tsx-in güzgüsü: Tənzimləmələr → Tapşırıq şablonları (/settings/task-templates) —
 * yeni tapşırıq formasını əvvəlcədən dolduran təkrar istifadəli hazırlıqlar kitabxanası.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function TaskTemplatesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Tapşırıq şablonu nədir">
        <p>
          <strong>Tapşırıq şablonu</strong> — yeni tapşırıq formasını əvvəlcədən dolduran saxlanılmış
          hazırlıqdır. Hər dəfə eyni status hesabatını, müştəri qoşulması addımını və ya həftəlik
          yoxlamanı yenidən yazmaq əvəzinə, formanı bir dəfə saxlayır və tapşırığı iki kliklə
          yaradırsınız.
        </p>
        <p>
          Şablonlar <strong>Tənzimləmələr → Tapşırıq şablonları</strong> bölməsindədir. Hər biri
          tapşırıq başlığını, istəyə bağlı təsviri, prioriteti, istəyə bağlı son tarix sürüşməsini,
          istəyə bağlı bağlı qeyd tipini, fərdi sahə dəyərlərini və yoxlama siyahısını saxlayır — yeni
          tapşırığın yarı-hazır başlaması üçün lazım olan hər şeyi.
        </p>
      </HelpSection>

      <HelpSection title="Kitabxana səhifəsi">
        <p>
          Səhifə şablonlarınızı istifadə tezliyinə görə sıralanmış kartlar kimi göstərir (ən çox
          istifadə olunanlar yuxarı qalxır). Hər kartda şablonun adı, tapşırıq başlığı, prioritet, son
          tarix sürüşməsi və neçə yoxlama maddəsi daşıdığı göstərilir.
        </p>
        <HelpStep n={1}>
          <p>
            Redaktoru açmaq üçün <HelpKey>Yeni şablon</HelpKey> düyməsini basın (yuxarı sağda və ya boş
            vəziyyətdəki düymə).
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sahibi olduğunuz şablonda kartda qələm və zibil qutusu nişanları görünür — orada redaktə
            edin və ya silin.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Başqa komanda yoldaşının <strong>paylaşdığı</strong> şablon kiçik qlobus nişanı,{" "}
            <em>Paylaşan …</em> sətri və istifadə sayını göstərir. Onu görüb istifadə edə bilərsiniz,
            amma yalnız sahibi (və ya admin) redaktə edə və ya silə bilər.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Redaktordakı sahələr">
        <p>
          Redaktor şablonun öz kimliyinə və əvvəlcədən doldurduğu tapşırıq sahələrinə bölünür.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Şablon adı">Tələb olunur. Şablonun seçimdə necə göründüyü — məsələn, «Həftəlik status hesabatı».</HelpDef>
          <HelpDef term="Təsvir">Nə vaxt istifadə ediləcəyinə dair istəyə bağlı qeyd; seçim açılan siyahısında görünür.</HelpDef>
          <HelpDef term="Tapşırıq başlığı">Tələb olunur. Yeni tapşırığın alacağı başlıq — aşağıdakı dəyişənləri dəstəkləyir.</HelpDef>
          <HelpDef term="Tapşırıq təsviri">Tapşırığa köçürülən istəyə bağlı mətn.</HelpDef>
          <HelpDef term="Prioritet">aşağı, orta, yüksək və ya təcili.</HelpDef>
          <HelpDef term="Son tarix (gün)">Yaradılışdan sonrakı günlər. Yeni tapşırığın son tarixi bu qədər gün əlavə edilmiş bugün olur. Son tarixsiz başlamaq üçün boş buraxın. Aralıq 0–3650.</HelpDef>
          <HelpDef term="Qeydə bağla">İstəyə görə bağlı qeyd tipini əvvəlcədən təyin edin: şirkət, kontakt, sövdə, lid və ya ticket. Konkret qeydi tapşırığı yaradanda seçirsiniz.</HelpDef>
        </dl>
        <HelpCallout kind="tip">
          <p>
            Boş sahələr qəsdəndir — boş sahə «dəyəri məcbur etmə, yeni tapşırıq formasının öz
            standartını saxla» deməkdir. Yalnız hər nüsxənin miras almalı olduğunu doldurun.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Tapşırıq başlığı və təsvirindəki dəyişənlər">
        <p>
          Tapşırıq başlığına və ya təsvirinə bir yer-tutucu qoyun — tapşırığı yaratdığınız an o, canlı
          dəyərlə əvəzlənir:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term={"{{date}}"}>Lokalınızın formatında bugünkü tarix.</HelpDef>
          <HelpDef term={"{{user}}"}>Tapşırığı yaradan şəxsin adı.</HelpDef>
          <HelpDef term={"{{month}}"}>Cari ayın adı, məsələn «May».</HelpDef>
          <HelpDef term={"{{week}}"}>ISO həftə nömrəsi, məsələn «22».</HelpDef>
        </dl>
        <p>
          Beləliklə, <HelpKey>{"Status hesabatı — {{date}}"}</HelpKey> kimi başlıq istifadə günündə{" "}
          <em>Status hesabatı — 28.05.2026</em> olur. Tanınmayan yer-tutucu olduğu kimi qalır, ona görə
          səhv yazılış səssizcə yox olmur, tapşırıqda görünür.
        </p>
      </HelpSection>

      <HelpSection title="Yoxlama siyahısı">
        <p>
          Tapşırıq sahələrinin altında <strong>yoxlama siyahısı</strong> qura bilərsiniz — bu
          şablondan yaranan hər tapşırığın daşımalı olduğu alt-addımlar.
        </p>
        <HelpStep n={1}>
          <p>
            <HelpKey>Maddə əlavə et</HelpKey> düyməsini basın və görüləcək işi yazın. İstədiyiniz qədər
            əlavə edin.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Maddələrin sırasını hər sətirdəki yuxarı / aşağı oxları ilə dəyişin və ya{" "}
            <HelpKey>×</HelpKey> düyməsi ilə birini silin.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Şablon istifadə olunanda bu maddələr yeni tapşırığa təyin etdiyiniz sırada təzə, hamısı
            işarələnməmiş yoxlama yazıları kimi köçürülür.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Paylaşma və saxlama">
        <p>
          <HelpKey>Bütün komanda ilə paylaş</HelpKey> qeyd qutusu görünürlüyü idarə edir. İşarəsiz
          şablon yalnız sizindir. İşarəli olduqda təşkilatınızdakı hər kəs onu görüb istifadə edə bilər
          (paylaşılanlar qlobus nişanı ilə işarələnir).
        </p>
        <HelpStep n={1}>
          <p>
            Ən azı <strong>şablon adını</strong> və <strong>tapşırıq başlığını</strong> doldurun —
            ikisi də tələb olunur; onlarsız saxlamaq xəta göstərir.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Saxla</HelpKey> düyməsini basın. Mövcud şablonu redaktə etmək onu yerində
            yeniləyir; dəyişikliyi həmin şablonu görən hər kəs görür.
          </p>
        </HelpStep>
        <HelpCallout kind="next">
          <p>
            Şablonu həqiqətən tətbiq etmək üçün <strong>Tapşırıqlar → Yeni tapşırıq</strong> açın: ən
            azı bir şablon mövcud olanda <HelpKey>Şablondan…</HelpKey> seçimi görünür. Birini seçin —
            forma özü dolur: başlıq (dəyişənlər həll olunmuş), təsvir, prioritet, son tarix, məsul şəxs,
            bağlı tip, fərdi sahələr və yoxlama siyahısı. Saxlamadan əvvəl istənilən şeyi
            dəyişdirə bilərsiniz.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="İstifadə sayğacı">
        <p>
          Şablon yeni tapşırıq formasında hər seçiləndə onun <strong>istifadə sayğacı</strong> bir vahid
          artır. Kitabxananı məhz bu sayğac sıralayır — komandanızın çox işlətdiyi şablonlar əl ilə
          sıralamadan özü yuxarı qalxır. Paylaşılan şablonun istifadəsi yalnız sahibinə deyil, şablonun
          özünə yazılır.
        </p>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Şablonlar təşkilatınızla məhdudlaşır və bütün CRM-də işlənən eyni tapşırıq icazələri ilə
          qorunur — yalnız öz şablonlarınızı, üstəlik tenant-ınızda paylaşılanları görürsünüz. Redaktə
          və silmə yalnız <strong>sahibə</strong> və ya <strong>admin / superadmin</strong>-ə açıqdır,
          ona görə komanda yoldaşı sizin şablonu dəyişə bilməz, admin isə işdən ayrılan kimsənin
          ardınca səliqə yarada bilər. Yaratma, dəyişmə və silmə audit jurnalına yazılır; silmə
          geri dönməzdir (zibil qutusu yoxdur).
        </p>
      </HelpCallout>
    </div>
  )
}
