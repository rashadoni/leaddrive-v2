"use client"

/**
 * AI Automation — help article (Azerbaijani).
 * en.tsx-in güzgüsü: üç avtomatlaşdırma səviyyəsi, ssenari üzrə açarlar,
 * gündəlik AI büdcəsi, çatdırılma kanalları, xülasə abunələri və
 * təsdiq üçün shadow-əməliyyat növbəsi.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function AiAutomationHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Bu nə üçün vacibdir">
        <p>
          AI Avtomatlaşdırma CRM-in təkrarlanan işini — xatırlatma qaralamaları, ticketlərin
          çeşidlənməsi, durğun sövdələşmələrin aşkarı — sükanı təhvil vermədən ötürməyə imkan verir.
          Hər funksiya ayrıca aktivləşir və əksər avtomatlaşdırmalar əvvəlcə{" "}
          <strong>baxış</strong> rejimində işləyir: orada AI əməliyyatı yalnız{" "}
          <em>qaralama kimi hazırlayır</em>, siz isə təsdiqləyirsiniz.
        </p>
        <p>
          Bütün səhifə bir ideya üzərində qurulub: funksiyaları tədricən açırsınız, AI-nın nə
          edəcəyini izləyirsiniz və ona güvənəndə tam avtomatik rejimə keçirsiniz.
        </p>
      </HelpSection>

      <HelpSection title="Üç avtomatlaşdırma səviyyəsi">
        <p>
          Səhifədəki hər funksiya üç səviyyədən birinə aiddir — onlar səhifənin yuxarısında{" "}
          <strong>Necə işləyir</strong> blokunda göstərilir:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Analitika">
            <strong>Yalnız oxuma.</strong> AI səhər xülasəsi göndərir, anomaliyaları aşkarlayır və
            lidləri qiymətləndirir. Məlumatlarınıza dəyişiklik etmir.
          </HelpDef>
          <HelpDef term="Baxış">
            AI əməliyyatı <strong>qaralama kimi hazırlayır</strong> — xatırlatma, follow-up, cavab —
            amma siz təsdiqləməyincə sistemdən heç nə çıxmır.
          </HelpDef>
          <HelpDef term="Avtopilot">
            AI mesajları göndərir və tapşırıqları <strong>avtomatik</strong> yaradır. Bunu yalnız
            eyni ssenarini baxış rejimində yoxladıqdan sonra aktivləşdirin.
          </HelpDef>
        </dl>
        <HelpCallout kind="tip">
          <p>
            Açdığınız hər açar təşkilatınız üçün funksiya bayrağı kimi saxlanılır. Funksiyanı açmaq
            və ya bağlamaq dərhal qüvvəyə minir — naviqasiya və AI işçiləri onu səhifəni yeniləmədən
            yenidən yoxlayır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Analitika — yalnız izləyən AI">
        <p>
          <HelpKey>Analitika</HelpKey> qrupunda üç «yalnız oxuma» funksiyası var, hər biri sadə
          aç/bağla açarıdır:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Səhər xülasəsi">Durğun sövdələşmələrin, SLA risklərinin və vaxtı keçmiş hesab-fakturaların yığcamı.</HelpDef>
          <HelpDef term="Anomaliya aşkarı">Ticket sıçrayışları, qeyri-adi hesab-fakturalar və cəlbetmə düşüşləri barədə xəbərdarlıq.</HelpDef>
          <HelpDef term="Lid qiymətləndirməsi">Hər lidə e-poçt keyfiyyəti, vəzifə, mənbə və cəlbetməyə görə 0–100 bal.</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            Açarı aktivləşdirin. Hər funksiyanın altındakı <HelpKey>Nümunə</HelpKey> linki
            aktivləşdirmədən əvvəl xülasənin, xəbərdarlığın və ya balın necə görünəcəyini göstərir.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Onlar qeydlərinizi heç vaxt dəyişmədiyi üçün açıq saxlamaq təhlükəsizdir — üzərlərində{" "}
            <strong>Yalnız oxuma</strong> nişanı var.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Avtomatik əməliyyatlar — Baxış və Avtopilot">
        <p>
          <HelpKey>Avtomatik əməliyyatlar</HelpKey> qrupunda hər ssenari yan-yana{" "}
          <strong>iki</strong> açarı olan kartdır: <strong>Baxış</strong> (AI qaralama hazırlayır,
          siz təsdiqləyirsiniz) və <strong>Avtopilot</strong> (AI avtomatik göndərir). Buradakı
          ssenarilərə daxildir: SLA üzrə avto-cavab, durğun sövdələşmələr üçün follow-up, ödəniş
          xatırlatmaları, müqavilə yeniləmələri, isti lidlərin eskalasiyası, ticketlərin
          çeşidlənməsi, sövdələşmənin mərhələ üzrə irəliləməsi, mənfi ton zamanı eskalasiya, bilik
          bazasına görə avto-bağlama, dublikat kontaktların birləşdirilməsi, kredit limiti
          xəbərdarlıqları, görüş xülasələri, sosial şəbəkələrdə AI cavabları və viral qeyd
          xəbərdarlıqları.
        </p>
        <HelpStep n={1}>
          <p>
            <strong>Baxış</strong> ilə başlayın. AI əməliyyatı yaradır və onu{" "}
            <em>shadow-əməliyyat</em> kimi saxlayır — o, heç vaxt göndərilmir. Onun nə edəcəyini
            görürsünüz.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Təkliflər ardıcıl olaraq düzgün görünəndə həmin ssenari üçün <strong>Avtopilot</strong>-u
            aktivləşdirin ki, AI təsdiq gözləmədən icra etsin.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Avtopilot real fəaliyyət göstərir.</strong> Canlı rejim real e-poçtlar göndərir,
            tapşırıqlar yaradır, lidləri yenidən təyin edir və ticket sahələrini avtomatik dəyişir.
            Əvvəlcə ssenarini baxış rejimində yoxlayın — baxış rejimi məhz bunun üçündür.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Shadow-əməliyyatlar — təsdiq növbəsi">
        <p>
          AI-nın baxış rejimində hazırladığı hər şey <strong>Shadow-əməliyyatlar</strong> növbəsində
          toplanır — ona səhifənin altındakı kartdan keçmək olar (o, gözləyənlərin sayını göstərir).
          Hər qeyd AI-nın konkret sövdələşmə, ticket, hesab-faktura, lid, kontakt və ya müqavilə üzrə
          nə <em>edəcəyini</em> qeydə alır.
        </p>
        <HelpStep n={1}>
          <p>
            Gözləyən əməliyyatı açın, təklifi və əsaslandırmanı oxuyun, sonra icra üçün{" "}
            <HelpKey>Təsdiqlə</HelpKey> və ya ləğv etmək üçün <HelpKey>Rədd et</HelpKey> düyməsini
            basın.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Əməliyyata yalnız bir dəfə baxmaq olar — təsdiqlənəndən və ya rədd ediləndən sonra o,
            gözləyənlər siyahısından çıxır və bir daha icra olunmur.
          </p>
        </HelpStep>
        <HelpCallout kind="next">
          <p>
            Yuxarıdakı <strong>AI bu ay nə etdi</strong> bloku <em>təsdiqlənən</em>,{" "}
            <em>rədd edilən</em> və <em>gözləyən</em> sayları, həmçinin{" "}
            <strong>qənaət edilən vaxt</strong> təxminini cəmləyir — avtomatlaşdırmanın özünü
            doğruldub-doğrultmadığını tez başa düşmək üçün.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="AI büdcəsi — gündəlik xərc limiti">
        <p>
          AI funksiyaları pullu dil modellərinə müraciət edir, ona görə hər təşkilatın{" "}
          <strong>dollarla gündəlik büdcəsi</strong> var. Büdcə kartı bugünkü xərci limitə nisbətən
          göstərir: irəliləyiş zolağı limitə yaxınlaşanda sarıya, limit dolanda isə qırmızıya çevrilir.
        </p>
        <HelpStep n={1}>
          <p>
            <HelpKey>Gündəlik limit</HelpKey>-i dollarla təyin edin və <HelpKey>Saxla</HelpKey>{" "}
            düyməsini basın. Standart <strong>gündə $5</strong>-dır; adi istifadə təxminən gündə
            $0.50–$5 olur.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Günün xərci limitə çatanda AI avtomatlaşdırmaları növbəti günə qədər dayanır — beləliklə,
            «idarədən çıxan» proses heç vaxt gözlənilməz hesab yaratmır.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Çatdırılma kanalları və xülasə dili">
        <p>
          <strong>Çatdırılma kanalları</strong> kartı xülasələrin və xəbərdarlıqların hara gəldiyini
          idarə edir:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Email">Avtomatik — bütün admin və menecer istifadəçilərə göndərilir; konfiqurasiya tələb olunmur.</HelpDef>
          <HelpDef term="Telegram">Bot Token və Chat ID daxil edin (yardım balonu @BotFather və @userinfobot üzrə yol göstərir).</HelpDef>
          <HelpDef term="Slack">Slack tətbiqinizdən gələn Webhook URL-ni daxil edin.</HelpDef>
          <HelpDef term="Dil">Xülasə dilini seçin: rus, ingilis və ya Azərbaycan.</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            İstədiyiniz sahələri doldurun və <HelpKey>Saxla</HelpKey> düyməsini basın. Telegram və ya
            Slack lazımi dəyərləri alandan sonra yaşıl <strong>Konfiqurasiya edilib</strong> nişanı
            görünür.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Xülasə abunələri — kim nə alır">
        <p>
          Kanalların altında <strong>Xülasə abunələri</strong> matrisi hər istifadəçi üçün hansı
          yığcamı aldığını, nə tezliklə və hansı kanallarla aldığını müəyyən edir. Üç yığcam:{" "}
          <strong>Səhər xülasəsi</strong>, <strong>Anomaliya xəbərdarlığı</strong> və{" "}
          <strong>Yeniləmə xatırlatması</strong>.
        </p>
        <HelpStep n={1}>
          <p>
            Hər istifadəçi və yığcam üçün tezlik seçin — <em>Söndürülüb</em>, <em>Gündəlik</em>,{" "}
            <em>2 gündən bir</em>, <em>Həftəlik</em> və ya <em>Aylıq</em> — və kanalları işarələyin
            (Email, Tətbiqdə, Telegram, Slack). Email və «tətbiqdə» adminlər və menecerlər üçün
            standart olaraq açıqdır.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Test</HelpKey> düyməsi ilə həmin istifadəçiyə yığcamın nümunəsini göndərin və
            hər kanalın həqiqətən çatdırdığını yoxlayın, sonra{" "}
            <HelpKey>Abunələri saxla</HelpKey> düyməsini basın.
          </p>
        </HelpStep>
        <HelpCallout kind="security">
          <p>
            Abunə matrisini yalnız <strong>adminlər</strong> redaktə edə bilər — digər rollar onu
            yalnız oxuma rejimində görür. Səhifədəki hər şey təşkilatınızla məhdudlaşır: funksiya
            bayraqları, büdcə, çatdırılma sirləri və shadow-əməliyyatlar yalnız sizin tenant-ınıza
            aiddir. Avtopilot cədvəl üzrə fon prosesi kimi işləyir və yalnız bayrağı açıq olan
            ssenariləri, özü də siz gündəlik büdcə daxilində olduğunuz müddətcə icra edir.
          </p>
        </HelpCallout>
      </HelpSection>
    </div>
  )
}
