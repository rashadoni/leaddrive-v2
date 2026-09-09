"use client"

/**
 * Campaign ROI — help article (Azerbaijani).
 * Köhnə birgə "kampaniya analitikası" məqaləsindən ayrılıb: yalnız
 * Kampaniyalar ROI səhifəsini əhatə edir (xülasə kartları, atribusiya
 * örtüyü, göndərmə/açılma/klik xülasə zolağı, açıla bilən kampaniya
 * kartları — konversiya hunisi, faiz müqayisəsi, əlaqəli sövdələr).
 * Kampaniya yaratma/göndərmə bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CampaignroiHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq və ya satış üzrə menecersiniz"
        goal="Hər email/SMS kampaniyasının nə qədər gəlir gətirdiyini və xərcə görə investisiya gəlirini (ROI) görmək"
      >
        Bu səhifə yalnız oxumaq üçündür — burada heç nə yaratmırsınız, sadəcə artıq göndərilmiş
        kampaniyaların nəticələrini təhlil edirsiniz. Rəqəmlər kampaniyaya bağlanmış sövdələrdən və
        göndərmə statistikasından avtomatik hesablanır, ona görə kampaniyalar göndərildikcə və sövdələr
        bağlandıqca özü-özünə yenilənir. Bütün məlumat yalnız sizin təşkilatınıza aiddir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda qrafik ikonu ilə birlikdə <HelpKey>Kampaniyalar ROI</HelpKey> adı və altında
          «Kütləvi email/SMS kampaniyaları yaradın və göndərin» izahı var. Bunun altında bir sətirlik
          səhifə təsviri («Kampaniya ROI təhlili: hər marketinq kampaniyası üçün investisiya gəlirini
          ölçün») durur. Sonra dörd rəngli xülasə kartı, opsional atribusiya örtüyü, bir göndərmə/açılma/
          klik xülasə zolağı və ən altda kampaniya siyahısı gəlir. Heç kampaniya yoxdursa, siyahının
          yerində «Təhlil üçün kampaniya yoxdur» mətni göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Gəlir">Marketinq kampaniyalarına aid edilən ümumi gəlir (bütün kampaniyalar üzrə cəm).</HelpDef>
          <HelpDef term="Xərc">Bütün kampaniyalara çəkilən ümumi xərc — hər kampaniyanın büdcəsindən toplanır.</HelpDef>
          <HelpDef term="ROI">İnvestisiya gəliri = (Gəlir − Xərc) / Xərc × 100%. Faizlə göstərilir.</HelpDef>
          <HelpDef term="Kampaniyalar">Təhlilə daxil olan kampaniyaların sayı (dördüncü kart).</HelpDef>
          <HelpDef term="Atribusiya gəliri">Çoxtəmaslı bölgü — hər udulmuş sövdənin dəyəri ona toxunan bütün kampaniyalar arasında standart model üzrə bölünür. «Gəlir» isə yalnız sövdəyə birbaşa bağlı kampaniyanı sayır.</HelpDef>
          <HelpDef term="Konversiya hunisi">Alıcılar → Göndərildi → Açılıb → Kliklənib → Sövdələr → Qazanılmış — kampaniyanın hər mərhələdə neçə nəfəri keçirdiyini göstərən zolaqlar.</HelpDef>
        </dl>
        <p>
          Xülasə zolağında üç göstərici var: <strong>Göndərildi</strong> (alıcılara uğurla çatdırılmış
          mesajların faizi), <strong>Açılma faizi</strong> və <strong>Klik faizi</strong> — bunlar bütün
          kampaniyaların ortalamasıdır. Hər göstəricinin yanındakı kiçik «i» nişanına gətirdikdə nəyin
          hesablandığını izah edən ipucu çıxır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: ümumi mənzərəni oxu">
        <HelpStep n={1}>
          <p>
            Səhifə açılan kimi yuxarıdakı dörd kartı oxuyun: <HelpKey>Gəlir</HelpKey>,{" "}
            <HelpKey>Xərc</HelpKey>, <HelpKey>ROI</HelpKey> və <HelpKey>Kampaniyalar</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yüklənmə zamanı qısa müddət boz «skelet» blok görünür, sonra dörd kart dolur. Hər kartın
            yanında «i» ipucu nişanı var; üzərinə gətirdikdə düsturu və izahı açır (məsələn ROI üçün
            «(Gəlir − Xərc) / Xərc × 100%»). Rəqəmlər dollar (<HelpKey>$</HelpKey>) işarəsi ilə
            formatlanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Kartların altında atribusiya örtüyü varsa, onu oxuyun. Bu zolaq <strong>yalnız</strong>{" "}
            təşkilatınızda bir atribusiya modeli quraşdırılıbsa görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yaşıl çərçivəli zolaqda trend ikonu ilə birlikdə «Çoxtəmaslı atribusiya (model: …) — $…
            kampaniyalar arasında bölündü, …% qarışıq ROI» kimi cümlə çıxır. Model yoxdursa bu zolaq
            ümumiyyətlə görünmür — narahat olmayın, bu normaldır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Növbəti xülasə zolağında orta <HelpKey>Göndərildi</HelpKey>, <HelpKey>Açılma faizi</HelpKey>{" "}
            və <HelpKey>Klik faizi</HelpKey> göstəricilərinə baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Boz çərçivəli bir sətirdə üç faiz dəyəri qalın rənglə durur, hər birinin yanında kiçik «i»
            nişanı. Nişana gətirdikdə həmin faizin nə demək olduğunu izah edən ipucu açılır (məs.
            «Çatdırılmış mesajların açılma faizi»).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: bir kampaniyanı dərindən təhlil et">
        <HelpStep n={1}>
          <p>
            Siyahıda istənilən kampaniya kartına baxın. Hər kart bir sətirdə əsas rəqəmləri göstərir:
            ad, növ nişanı (email/SMS), status nişanı, <HelpKey>Gəlir</HelpKey>, varsa{" "}
            <HelpKey>Atribusiya</HelpKey>, <HelpKey>Xərc</HelpKey>, <HelpKey>Sövdələşmələr</HelpKey>,{" "}
            <HelpKey>Qazanılmış</HelpKey>, <HelpKey>Lidlər</HelpKey> və sağda böyük ROI faizi.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Müsbət ROI yaşıl, mənfi ROI qırmızı rənglə yazılır; büdcə sıfırdırsa ROI yerinə «—» tire
            görünür. Sağda chevron (aşağı ox) ikonu kartın açıla biləcəyini bildirir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Detalları görmək üçün kartın özünə basın — bütün başlıq sahəsi düymədir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Chevron yuxarı çevrilir və kartın altında genişlənmiş bölmə açılır. İçində <strong>Konversiya
            hunisi</strong>, <strong>Açılma/klik faizi müqayisəsi</strong>, <strong>tarix sətri</strong>{" "}
            və <strong>əlaqəli sövdələr</strong> cədvəli yer alır. Yenidən basanda kart bağlanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Açılan bölmədə əvvəlcə <HelpKey>Konversiya hunisi</HelpKey> zolaqlarını oxuyun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Altı zolaq görünür: <strong>Alıcılar</strong>, <strong>Göndərildi</strong>,{" "}
            <strong>Açılıb</strong>, <strong>Kliklənib</strong>, <strong>Sövdələşmələr</strong>,{" "}
            <strong>Qazanılmış</strong>. Hər zolağın üstündə dəqiq say və faiz yazılır (alıcıların
            sayına nisbətən); zolağın uzunluğu həmin faizi əks etdirir, rəng addımdan-addıma dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Hunidən aşağı, bu kampaniyanın <HelpKey>Açılma faizi</HelpKey> və{" "}
            <HelpKey>Klik faizi</HelpKey> göstəricilərini bütün kampaniyaların ortalaması ilə müqayisə
            edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yan-yana iki kart: hər birində bu kampaniyanın faizi qalın rəqəmlə və qalın rəngli zolaqla,
            altında isə «Bütün kampaniyaların ortalaması» nazik boz zolaqla göstərilir. Beləcə bu
            kampaniyanın ortalamadan yuxarı yoxsa aşağı olduğunu dərhal görürsünüz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Tarix sətrində kampaniyanın <HelpKey>Yaradıldı</HelpKey> və (varsa){" "}
            <HelpKey>Göndərilmə tarixi</HelpKey> dəyərlərini yoxlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bir sətirdə «Yaradıldı: gün ay il» və göndərilibsə «Göndərilmə tarixi: gün ay il» tarixləri
            durur. Kampaniya hələ göndərilməyibsə, ikinci tarix ümumiyyətlə görünmür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Ən altda <HelpKey>Əlaqəli sövdələşmələr</HelpKey> cədvəlinə baxın — hansı sövdələrin bu
            kampaniyaya bağlandığını burada görürsünüz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəldə <strong>Ad</strong>, <strong>Mərhələ</strong> və <strong>Məbləğ</strong> sütunları
            olur; başlıqda mötərizədə sövdə sayı yazılır. Sövdə adı linkdir — yanındakı kiçik ikona ilə
            basanda həmin sövdənin səhifəsinə keçirsiniz. Bağlı sövdə yoxdursa, «Bu kampaniyaya bağlı
            sövdələşmə yoxdur» qutusu görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          ROI sütununda «—» tire görsəniz, deməli həmin kampaniyaya büdcə (xərc) daxil edilməyib —
          xərc olmadan investisiya gəlirini hesablamaq mümkün deyil. Düzgün ROI görmək üçün
          kampaniyanın büdcəsini doldurun. <strong>Gəlir</strong> və <strong>Atribusiya</strong>{" "}
          fərqini yadda saxlayın: birincisi yalnız sövdəyə birbaşa bağlı kampaniyanı sayır, ikincisi
          isə dəyəri sövdəyə toxunan bütün kampaniyalar arasında bölür.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu səhifə tam <strong>yalnız-oxu</strong> təhlildir — burada kampaniya yaratmaq, redaktə
          etmək və ya göndərmək olmaz. Rəqəmlər kampaniyaların öz statistikasından və onlara bağlanmış
          sövdələrdən hesablanır, ona görə bir kampaniya boş və ya sıfır görünürsə, problem adətən
          burada deyil — yoxlanılmalı olan kampaniya göndərilibmi və sövdələr ona bağlanıbmı.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün rəqəmlər təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın kampaniyalarını və
          sövdələrini görürsünüz, başqa təşkilatın məlumatı bu səhifəyə qarışmır. Atribusiya örtüyü
          yalnız təşkilatınızın standart atribusiya modeli varsa görünür.
        </p>
      </HelpCallout>
    </div>
  )
}
