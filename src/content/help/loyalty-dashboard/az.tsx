"use client"

/**
 * Loyalty Dashboard — help article (Azerbaijani).
 * Yalnız Sadiqlik proqramı icmal səhifəsini əhatə edir:
 * KPI kartları, səviyyə paylanması, top üzvlər və son əməliyyatlar
 * axını. Bu səhifə yalnız oxunur — burada hesab yaradılmır,
 * redaktə edilmir və ya bal tənzimlənmir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function LoyaltyDashboardHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq və ya əməliyyat üzrə məsulsunuz"
        goal="Sadiqlik proqramının sağlamlığını bir ekranda görmək: neçə üzv var, hansı səviyyələrdə paylanıb, kim ən çox bal qazanıb və son 30 gündə nə qədər bal qazanılıb/istifadə olunub"
      >
        Səhifə <HelpKey>Sadiqlik proqramı</HelpKey> başlığı ilə açılır və yalnız
        <strong> oxumaq</strong> üçündür — burada bir şey yaratmırsınız, sadəcə proqramın vəziyyətini
        izləyirsiniz. Bütün rəqəmlər yalnız sizin təşkilatınızın sadiqlik hesablarından oxunur. Hesablar
        özləri inteqrasiyalar və ya idxal ilə əlavə olunur; bu səhifə onları yığcam şəkildə göstərir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda <HelpKey>Sadiqlik proqramı</HelpKey> başlığı (mükafat ikonası ilə) və altında qısa
          izah durur. Başlığın sağında <HelpKey>Turu təkrar oynat</HelpKey> və <HelpKey>Kömək</HelpKey>{" "}
          düymələri var. Onların altında bilik kartı («Bilirdinizmi…»), sonra isə beş KPI kartı sırası
          gəlir: <strong>Üzvlər</strong>, <strong>30g qazanıldı</strong>, <strong>30g geri alındı</strong>,{" "}
          <strong>30g yandı</strong> və <strong>Əməliyyatlar</strong>.
        </p>
        <p>
          KPI kartlarının altında məzmun proqramda hesab olub-olmamasından asılıdır. Heç hesab yoxdursa,
          «Sadiqlik hesabı hələ yoxdur.» boş vəziyyəti göstərilir. Hesab varsa, iki sütunlu blok açılır:
          solda <strong>Səviyyə paylanması</strong>, sağda <strong>Ümumi ballar üzrə top üzvlər</strong>.
          Daha aşağıda — son əməliyyatlar varsa — <strong>Son əməliyyatlar</strong> axını gəlir. Ən altda
          isə balların və 30 günlük cəmlərin nə demək olduğunu izah edən iki sətirlik qeyd durur.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Üzvlər">Təşkilatınızdakı sadiqlik hesablarının ümumi sayı.</HelpDef>
          <HelpDef term="30g qazanıldı">Son 30 gündə qazanılan balların cəmi (yaşıl, «+» ilə).</HelpDef>
          <HelpDef term="30g geri alındı">Son 30 gündə istifadə (geri alınma) edilən balların cəmi (mavi, «−» ilə).</HelpDef>
          <HelpDef term="30g yandı">Son 30 gündə vaxtı bitib yanan balların cəmi (boz, «−» ilə).</HelpDef>
          <HelpDef term="Əməliyyatlar">Son 30 gündəki bütün bal hərəkətlərinin sayı.</HelpDef>
          <HelpDef term="Səviyyə">Üzvün dərəcəsi — Bürünc, Gümüş, Qızıl, Platin, Almaz və ya «Təyin edilməyib». Ümumi ballarla təyin olunur.</HelpDef>
          <HelpDef term="Ballar">Hazırda istifadə üçün mövcud balans (azalıb-arta bilər).</HelpDef>
          <HelpDef term="Ümumi ballar">Bütün dövr ərzində qazanılmış cəm — səviyyəni təyin edir; yalnız artır, heç vaxt azalmır.</HelpDef>
        </dl>
        <p>
          Hər səviyyə kartında rəngli səviyyə nişanı (məs. <strong>Qızıl</strong>), o səviyyədəki hesab
          sayı, ümumi üzvlərə görə faiz, sağda «… ümumi» bal göstəricisi və altda nazik tərəqqi xətti
          olur. Top üzvlər siyahısında hər sətir nömrələnir (#1, #2, …), adın (yoxdursa e-poçtun) yanında
          səviyyə nişanı, sağda isə ümumi bal və «… mövcud» balansı görünür — sətrə kliklədikdə həmin
          üzvün hesab səhifəsinə keçirsiniz.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: proqramın sağlamlığını oxu">
        <HelpStep n={1}>
          <p>
            Səhifəni açın və əvvəlcə yuxarıdakı beş KPI kartına baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Soldan sağa: <strong>Üzvlər</strong> (insan ikonası, ümumi say), <strong>30g qazanıldı</strong>{" "}
            (yaşıl rəqəm, önündə «+»), <strong>30g geri alındı</strong> (mavi rəqəm, önündə «−»),{" "}
            <strong>30g yandı</strong> (boz rəqəm, önündə «−») və <strong>Əməliyyatlar</strong> (son 30 günün
            say cəmi). Böyük rəqəmlər qısaldılır — məsələn 12 500 əvəzinə <HelpKey>12.5K</HelpKey>, 2 000 000
            əvəzinə <HelpKey>2.0M</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Solda <HelpKey>Səviyyə paylanması</HelpKey> blokunu oxuyun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər səviyyə üçün ayrıca kart: rəngli nişan (Bürünc / Gümüş / Qızıl / Platin / Almaz / Təyin
            edilməyib), o səviyyədəki hesab sayı, ümumi üzvlərə nisbətdə faiz (məs. <HelpKey>42%</HelpKey>),
            sağda «… ümumi» bal göstəricisi və altında həmin faizi əks etdirən rəngli tərəqqi xətti.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sağda <HelpKey>Ümumi ballar üzrə top üzvlər</HelpKey> siyahısına baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ən çox ümumi bala görə sıralanmış üzvlər: hər sətirdə nömrə (#1, #2, …), ad (yoxdursa e-poçt,
            o da yoxdursa «Naməlum üzv»), varsa rəngli səviyyə nişanı, sağda isə ümumi bal və altında
            «… mövcud» cari balans. Heç kim bal qazanmayıbsa, «Bal qazanan hesab hələ yoxdur.» mətni
            göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Konkret üzvün təfərrüatına keçmək üçün top siyahıdakı sətrə klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siçanı sətrin üstünə gətirdikdə çərçivəsi işıqlanır (klik edilə biləndir); klikləyəndə həmin
            üzvün sadiqlik hesabı səhifəsi açılır. Bu səhifədə isə yalnız oxunan icmal qalır — heç nə
            dəyişmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Aşağı sürüşdürüb <HelpKey>Son əməliyyatlar</HelpKey> axınına baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə əməliyyat növü (Qazanma — yaşıl, İstifadə — mavi, Vaxt bitməsi — boz, Düzəliş
            (artırma) — yaşıl, Düzəliş (azaltma) — qırmızı), hesab identifikatorunun son 8 simvolu,
            işarəli bal dəyişikliyi (artımda yaşıl «+», azalmada qırmızı) və nisbi vaxt (məs. «2 saat
            əvvəl»). Pəncərə həddi aşılıbsa, altda «30 gün pəncərəsində … əməliyyata kəsilib.» qeydi
            görünür. Heç əməliyyat yoxdursa, bu blok ümumiyyətlə göstərilmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Ən altdakı iki sətirlik izahı oxuyun ki, rəqəmləri düzgün şərh edəsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Birinci sətir: <strong>Ballar</strong> = indi istifadəyə mövcud balans, <strong>Ümumi ballar</strong>{" "}
            = bütün dövr ərzində qazanılan cəm (səviyyəni təyin edir, yalnız artır). İkinci sətir: KPI
            kartlarının son 30 günün qazanma, istifadə, vaxt bitməsi və düzəliş cəmlərini əks etdirdiyini
            xatırladır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <strong>Ballar</strong> ilə <strong>Ümumi ballar</strong> fərqlidir: ballar üzvün hazırda
          xərcləyə biləcəyi balansdır (istifadə etdikcə azalır), ümumi ballar isə bütün vaxt ərzində
          qazanılan cəmdir və üzvün səviyyəsini məhz bu rəqəm təyin edir. Top siyahısı ümumi ballara görə
          sıralanır, ona görə oradakı liderlik «sədaqət tarixçəsini» göstərir, cari balansı yox.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bütün rəqəmlər səhifə açılan an çəkilir — canlı yenilənmə yoxdur. Yeni bir əməliyyatdan sonra
          dəyərləri görmək üçün səhifəni yeniləyin. Həmçinin <strong>30g</strong> kartları yalnız son 30
          günün pəncərəsini əhatə edir; əməliyyat axını da bu pəncərə daxilində müəyyən sayda kəsilə bilər
          (altdakı kəsilmə qeydi bunu bildirir).
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Səhifə yalnız oxunur və yalnız öz təşkilatınızın sadiqlik hesablarını göstərir — başqa tenant-ın
          məlumatı görünmür. Buradan hesab yaratmaq, bal əlavə etmək və ya düzəliş etmək mümkün deyil; o
          əməliyyatlar inteqrasiyalar/idxal və üzvün öz hesab səhifəsi vasitəsilə baş verir.
        </p>
      </HelpCallout>
    </div>
  )
}
