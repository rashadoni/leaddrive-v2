"use client"

/**
 * Deal Velocity — help article (Azerbaijani).
 * Köhnə birləşik "forecast" məqaləsindən ayrılıb: yalnız
 * /forecast/velocity səhifəsinin mövzusu — sövdələrin hər
 * mərhələdə nə qədər ilişdiyini və darboğazları oxumaq.
 * Bu səhifə yalnız OXUNUR — heç nə yaradılmır/silinmir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function forecastvelocityHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış meneceri və ya rəhbərisən"
        goal="Sövdələrin hər mərhələdə nə qədər vaxt keçirdiyini görmək və harada ilişib qaldıqlarını (darboğazları) aşkar etmək"
      >
        Səhifə avtomatik açılır və təşkilatının sövdə hərəkətlərini son seçilmiş
        dövr üzrə oxuyur. Burada heç nə yaratmaq və ya silmək yoxdur — bu, yalnız
        oxunan analitik səhifədir. Bütün rəqəmlər yalnız öz tenant-ının
        sövdələrindən gəlir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda <strong>Sövdələşmə Sürəti</strong> başlığı (ölçü-ibrəsi ikonu
          ilə) və altında qısa izah durur: sövdələrin hər mərhələdə nə qədər vaxt
          keçirdiyini, darboğazların (p90 &gt; 30 gün) isə yuxarı qalxdığını
          bildirir. Başlığın sağında dövr seçən düymələr cərgəsi var:{" "}
          <HelpKey>Son 30 gün</HelpKey>, <HelpKey>Son 90 gün</HelpKey>,{" "}
          <HelpKey>Son 180 gün</HelpKey>, <HelpKey>Son 365 gün</HelpKey> — seçili
          olan dolu rənglə işıqlanır. Aşağıda hər mərhələ üçün ayrıca kart gəlir;
          ən altda isə üç sətirlik izahat sütunların necə hesablandığını açıqlayır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Mərhələ">
            Kartın başlığı — sövdə huninizin mərhələsidir (məs. Lid,
            Kvalifikasiya, Təklif, Danışıqlar). Standart mərhələ adları tərcümə
            olunur; xüsusi adlar olduğu kimi qalır.
          </HelpDef>
          <HelpDef term="Orta">
            Sövdələrin bu mərhələdə keçirdiyi orta vaxt (məs. «5g 3h»). Məlumat
            yoxdursa «—» göstərilir.
          </HelpDef>
          <HelpDef term="p50">
            Mərhələdə qalma vaxtının medianı — sövdələrin yarısı bundan tez,
            yarısı bundan yavaş keçir.
          </HelpDef>
          <HelpDef term="p90">
            Ən yavaş 10% sövdə ən azı bu qədər çəkir. Bu rəqəm 30 günü keçəndə
            mərhələ darboğaz sayılır və kart sarı işarələnir.
          </HelpDef>
          <HelpDef term="İrəliləmə dərəcəsi">
            İrəlilədi ÷ çıxdı — bu mərhələdən irəliyə (növbəti mərhələyə) keçmiş
            sövdələrin payı. ≥50% yaşıl, ≥25% sarı, daha aşağı qırmızı rənglə və
            yuxarı/aşağı trend oxu ilə göstərilir.
          </HelpDef>
          <HelpDef term="Darboğaz">
            p90 &gt; 30 gün olan mərhələ — huninin ən yavaş hissəsi. Belə
            kartlarda sarı üçbucaq xəbərdarlıq ikonu çıxır.
          </HelpDef>
        </dl>
        <p>
          Hər kartda mərhələ adının altında <strong>çıxdı / daxil oldu</strong>{" "}
          sayğacları, sonra <strong>Orta</strong>, <strong>p50</strong> və{" "}
          <strong>p90</strong> müddətləri, ayırıcı xəttin altında{" "}
          <strong>İrəliləmə dərəcəsi</strong>, ən altda isə kiçik mətnlə dörd
          sayğac olur: <strong>↑</strong> irəlilədi, <strong>↓</strong> geri
          getdi, yaşıl <strong>✓</strong> qazanıldı, qırmızı <strong>✗</strong>{" "}
          itirildi.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: sürəti və darboğazları oxu">
        <HelpStep n={1}>
          <p>
            Başlığın sağındakı dövr düymələrindən birini seç —{" "}
            <HelpKey>Son 30 gün</HelpKey>, <HelpKey>Son 90 gün</HelpKey>,{" "}
            <HelpKey>Son 180 gün</HelpKey> və ya <HelpKey>Son 365 gün</HelpKey>.
            Səhifə ilk açılanda <HelpKey>Son 30 gün</HelpKey> seçilidir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyin düymə dolu rənglə işıqlanır, qısa müddət fırlanan ikon və{" "}
            <strong>Yüklənir…</strong> yazısı çıxır, sonra kartlar həmin dövr üzrə
            yenidən hesablanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Səhifənin yuxarısında darboğaz xəbərdarlığı varsa, onu oxu. O, yalnız
            ən azı bir mərhələ darboğaz olduqda çıxır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sarı lövhədə üçbucaq ikonu ilə{" "}
            <em>«N darboğaz diqqət tələb edir»</em> yazılır, altında isə bunların
            p90 &gt; 30 gün olan, huninin ən yavaş mərhələləri olduğu və prosesi
            yenidən nəzərdən keçirmək lazım gəldiyi izah olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Mərhələ kartlarına bax. Darboğaz mərhələlər yuxarıda gəlir, ona görə
            ilk gördüklərin ən çox diqqət istəyən mərhələlərdir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kartda mərhələ adı, çıxdı/daxil oldu sayğacları, Orta, p50, p90
            müddətləri və İrəliləmə dərəcəsi görünür. Darboğaz kartın çərçivəsi
            sarıya boyanır, küncündə sarı üçbucaq ikonu olur, p90 sətri qalın
            yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Kartın altındakı kiçik sayğaclara bax — bu mərhələdə neçə sövdənin
            irəlilədiyini, geri getdiyini, qazanıldığını və itirildiyini göstərir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bir sətirdə <strong>↑</strong> (irəlilədi), <strong>↓</strong> (geri
            getdi), yaşıl <strong>✓</strong> (qazanıldı) və qırmızı{" "}
            <strong>✗</strong> (itirildi) saylar yan-yana durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Hələ kifayət qədər hərəkət yoxdursa, kartların yerinə boş vəziyyət
            görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mərkəzdə saat ikonu ilə <em>«Sürət məlumatı hələ yoxdur.»</em> mesajı,
            altında isə sövdələr mərhələlər arasında hərəkət etdikcə səhifənin
            dolacağı izahı çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Əvvəlcə yuxarıdakı darboğaz kartlarına diqqət et — p90-ı yüksək olan
          mərhələ huninizi ən çox ləngidən yerdir. İrəliləmə dərəcəsi həmin
          mərhələdə aşağıdırsa (qırmızı), problem həm yavaşlıq, həm də sövdələrin
          itirilməsidir. Dövrü dəyişərək (məs. 90 günə) eyni mərhələnin sabit
          darboğaz olub-olmadığını yoxla.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Aşağıdakı izahata diqqət et: <strong>p50</strong> medianadır,{" "}
          <strong>p90</strong> isə ən yavaş 10%-i təsvir edir — orta rəqəm aldadıcı
          ola bilər. Həmçinin keçidi qeyd olunmamış sövdə daxil/çıxış sayğaclarının
          hər ikisində görünə bilər, ona görə tək bir karta yox, tendensiyaya
          bax.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün sürət rəqəmləri təşkilatınla məhdudlaşır — yalnız öz tenant-ının
          sövdə hərəkətlərini oxuyur və başqa təşkilatların heç bir məlumatını
          göstərmir.
        </p>
      </HelpCallout>
    </div>
  )
}
