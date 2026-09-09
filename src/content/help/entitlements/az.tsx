"use client"

/**
 * Entitlements — help article (Azerbaijani), video-tutorial script format.
 * /support/entitlements səhifəsini əhatə edir: müştəri dəstək şərti
 * yaratma, 5 KPI plitəsi, şərt kartları və mərhələ sağlamlığı monitorinqi.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function EntitlementsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dəstək rəhbəri və ya əməliyyat administratorusunuz"
        goal="Hansı müştərinin hansı dəstək müqaviləsi olduğunu və hansı müqavilələrin SLA-nı pozmaq təhlükəsində olduğunu bir baxışda görmək"
      >
        Səhifəyə <HelpKey>Dəstək</HelpKey> → <HelpKey>Müştəri dəstək şərtləri</HelpKey> yolu ilə
        çatırsınız. Burada dəstək rəhbəri əvvəlcə müştəri səviyyəli şərt yaradır, sonra onun SLA və
        mərhələ sağlamlığını izləyir. Bütün siyahı yalnız sizin təşkilatınız üçündür və açıldıqda
        avtomatik yüklənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda qalxan ikonu ilə <HelpKey>Müştəri dəstək şərtləri</HelpKey> adı, kömək düyməsi və
          əsas <HelpKey>Dəstək şərti yarat</HelpKey> əməliyyatı görünür. Onun altında beş{" "}
          <strong>KPI plitəsi</strong>, izah checklist-i, yaratma forması və hər müştəri üzrə bir{" "}
          <strong>şərt kartı</strong> şəbəkəsi var. Səhifənin ən altında iki kiçik izah sətri var.
          Hələ heç bir şərt yoxdursa, boş vəziyyət sizi yaratma formasına yönləndirir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Hüquq (entitlement)">
            Bir müştərinin dəstək müqaviləsi — şirkəti müəyyən dəstək səviyyəsində bir SLA
            siyasətinə bağlayır.
          </HelpDef>
          <HelpDef term="Dəstək səviyyəsi">
            Rəngli nişan: Korporativ (bənövşəyi), Premium (mavi), Standart və Baza (boz).
          </HelpDef>
          <HelpDef term="Status">
            Həyat dövrü vəziyyəti: Aktiv, Qaralama, Dayandırılıb, Müddəti bitib, Ləğv edilib.
          </HelpDef>
          <HelpDef term="SLA siyasəti">
            Cavab və həll taymerlərini tətbiq edən, hüquqa bağlanmış siyasətin adı.
          </HelpDef>
          <HelpDef term="Etibarlıdır">
            Başlama tarixindən bitmə tarixinə qədər; sonu yoxdursa «açıq» yazılır.
          </HelpDef>
          <HelpDef term="Mərhələ">
            İki əsas SLA taymerindən kənar detallı addımlar: ilk cavab, problem aşkar edildi,
            müvəqqəti həll, həll, eskalasiya.
          </HelpDef>
        </dl>
        <p>
          Hər kartda yuxarıda şirkət adı (yanında bina ikonu) və iki nişan — <strong>dəstək
          səviyyəsi</strong> ilə <strong>status</strong> — durur. Sağ yuxarı küncdə{" "}
          <strong>qalxan ikonu</strong> kartın sağlamlıq siqnalıdır. Ortada SLA siyasəti,
          etibarlılıq müddəti və mərhələ tərifləri sayğacı sadalanır. Altda dörd rəqəm mərhələ
          sağlamlığını bölür: <strong>Gecikmiş</strong>, <strong>&lt;24s</strong>,{" "}
          <strong>Görüldü 7g</strong> və <strong>Buraxıldı 30g</strong>.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: səhifəni açıb yuxarı zolağı oxu">
        <HelpStep n={1}>
          <p>
            Yan paneldən <HelpKey>Dəstək</HelpKey> bölməsini açıb <HelpKey>Dəstək hüquqları</HelpKey>{" "}
            səhifəsinə keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Səhifə yüklənərkən mərkəzdə fırlanan ikon və <strong>Yüklənir…</strong> yazısı çıxır.
            Məlumat gəldikdən sonra yuxarıda beş KPI plitəsi və altında hüquq kartları görünür.
            Yükləmə alınmasa, yuxarıda qırmızı çərçivəli xəta mesajı göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Beş <strong>KPI plitəsini</strong> soldan sağa oxuyun: <HelpKey>Aktiv</HelpKey>,{" "}
            <HelpKey>30g-də bitir</HelpKey>, <HelpKey>Gecikmiş</HelpKey>, <HelpKey>Risk &lt;24s</HelpKey>{" "}
            və <HelpKey>Buraxılmış 30g</HelpKey>. Bunlar bütün siyahını bir baxışda yekunlaşdırır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər plitədə kiçik başlıq və altında böyük rəqəm var. <strong>30g-də bitir</strong> sıfırdan
            böyük olanda sarı, <strong>Gecikmiş</strong> və <strong>Buraxılmış 30g</strong> sıfırdan
            böyük olanda qırmızı, <strong>Risk &lt;24s</strong> isə sarı rəngə keçir. Hamısı sıfırdırsa
            rəqəmlər adi rəngdə qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Heç bir hüquq yoxdursa, kartlar yerinə boş vəziyyəti yoxlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mərkəzdə bina ikonu, altında <strong>«Müştəri dəstək şərti hələ yoxdur.»</strong>, qısa
            izah və <HelpKey>Dəstək şərti yarat</HelpKey> düyməsi görünür. KPI plitələri yenə
            görünür, sadəcə hamısı sıfır olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: bir hüquq kartını oxu">
        <HelpStep n={1}>
          <p>
            Kartın yuxarısına baxın: <strong>şirkət adı</strong> və yanında iki nişan —{" "}
            rəngli <HelpKey>dəstək səviyyəsi</HelpKey> və <HelpKey>status</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Səviyyə nişanı dolu rəngdə (Korporativ — bənövşəyi, Premium — mavi, Standart/Baza — boz),
            status nişanı isə daha açıq fonludur (Aktiv — yaşıl, Qaralama — kəhrəba, Dayandırılıb —
            narıncı, Müddəti bitib — boz, Ləğv edilib — qırmızı). Şirkət adı tanınmırsa «Naməlum
            şirkət» yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Kartın sağ yuxarı küncündəki <strong>qalxan ikonuna</strong> baxın — bu, sağlamlıq
            siqnalıdır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Gecikmiş mərhələ varsa <strong>qırmızı xəbərdarlıqlı qalxan</strong> (üstündə neçə mərhələ
            gecikdiyini deyən izah), tezliklə çatan mərhələ varsa <strong>sarı qalxan</strong>, hüquq
            aktivdir və hər şey qaydasındadırsa <strong>yaşıl təsdiqli qalxan</strong>. Aktiv olmayan
            və problemsiz hüquqlarda qalxan ümumiyyətlə görünmür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Orta bloku oxuyun: <HelpKey>SLA siyasəti</HelpKey>, <HelpKey>Etibarlıdır</HelpKey> müddəti
            və <HelpKey>Mərhələ tərifləri</HelpKey> sayğacı.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Etibarlıdır» sətri başlama tarixi → bitmə tarixi formatındadır; sonu yoxdursa «açıq»
            yazılır. Müqavilə tezliklə bitirsə, kəhrəba rəngli saat ikonlu «{`{N}`}g-də bitir — yenilə»
            sətri əlavə olunur. «Mərhələ tərifləri» bu hüquqa bağlı mərhələlərin sayını göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Kartın altındakı dörd rəqəmi oxuyun: <HelpKey>Gecikmiş</HelpKey>, <HelpKey>&lt;24s</HelpKey>,{" "}
            <HelpKey>Görüldü 7g</HelpKey> və <HelpKey>Buraxıldı 30g</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Gecikmiş</strong> və <strong>Buraxıldı 30g</strong> sıfırdan böyük olanda qırmızı,{" "}
            <strong>&lt;24s</strong> sarı, <strong>Görüldü 7g</strong> həmişə yaşıl rəngdədir. Hər şey
            təmiz olub bu həftə mərhələ görülübsə, kartın altında yaşıl onay işarəli «Cədvəldə — bu
            həftə {`{N}`} mərhələ görüldü» sətri çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Kartın bütün <strong>fon rənginə</strong> diqqət edin — o, prioriteti çatdırır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Gecikmiş mərhələ olan kart qırmızı haşiyə və açıq qırmızı fon, tezliklə bitən kart sarı
            haşiyə və açıq sarı fon alır. Beləcə diqqət tələb edən müştərilər rəqəmlərə baxmadan
            görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="«Gecikmiş» və «Risk &lt;24s» nə deməkdir">
        <p>
          Bu iki tərif həm rəngləri, həm KPI plitələrini, həm də diqqət sırasını idarə edir — ona
          görə dəqiq başa düşməyə dəyər. İzahları səhifənin ən altındakı iki sətirdə də oxuya
          bilərsiniz.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Gecikmiş">
            Açıq, lakin vaxtı artıq keçmiş mərhələ — səssiz SLA-pozulma riski.
          </HelpDef>
          <HelpDef term="Risk &lt;24s">
            Açıq və növbəti 24 saat ərzində vaxtı çatmalı olan mərhələ.
          </HelpDef>
        </dl>
        <HelpCallout kind="tip">
          <p>
            Səhifənin altındakı ikinci sətir xatırladır ki, hər hüquq SLA taymerinin üstünə detallı
            mərhələlər (ilk cavab, problem aşkar edildi, müvəqqəti həll, həll, eskalasiya) əlavə edir
            — yəni siz yalnız iki ümumi taymeri deyil, müqavilənin tam sağlamlığını izləyirsiniz.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          Yeni dəstək şərti <strong>qaralama</strong> kimi başlayır. Canlı tiket müddətləri üçün ona
          güvənməzdən əvvəl mərhələ qaydalarını əlavə edib aktivləşdirin. Qırmızı qalxan və ya
          qırmızı KPI rəqəmi gördükdə, müvafiq müştərinin tiketlərinə və ya SLA siyasətinə keçib
          problemli mərhələni həll edin. Rəqəmlər səhifəni yenidən açanda yenilənir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün dəstək şərtləri təşkilatınızla məhdudlaşır və giriş tələb edir — yalnız öz
          tenant-ınızın şərtlərini görürsünüz, başqa təşkilatınkini yox. Bu şərtləri yalnız tiket və
          dəstək idarəetmə icazəsi olan istifadəçilər yaratmalı və dəyişməlidir.
        </p>
      </HelpCallout>
    </div>
  )
}
