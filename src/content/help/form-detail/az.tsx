"use client"

/**
 * P8 No-Code Form Builder — forma redaktoru səhifəsi help məqaləsi (Azərbaycan).
 * `/forms/[id]` — metaməlumat + sahə siyahısı + dərc. Yalnız bu redaktor
 * səhifəsini əhatə edir (forma adı/status başlığı, metaməlumat bloku,
 * sahələr bloku + «Sahə əlavə et» pəncərəsi, qaralama yadda saxlama və
 * dərc axını). Sürükle-burax YOXDUR — sahələr yuxarı/aşağı düymələri ilə
 * tərtiblənir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function FormDetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq və ya əməliyyat administratorusunuz"
        goal="Lid toplayan ictimai formanı qurmaq: sahələri əlavə etmək, parametrləri tənzimləmək, qaralama kimi yadda saxlamaq və hazır olduqda dərc etmək"
      >
        Bu səhifəyə formalar siyahısından bir formanın üzərinə klikləyərək çatırsınız (URL{" "}
        <HelpKey>/forms/&lt;id&gt;</HelpKey>). Forma və onun bütün sahələri yalnız sizin
        təşkilatınıza aiddir. Yadda saxlamadan sahə tərtibatını dəyişsəniz, dəyişikliklər yalnız{" "}
        <HelpKey>Qaralamanı yadda saxla</HelpKey> və ya <HelpKey>Dərc et</HelpKey> basanda
        serverdə saxlanır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda solda <HelpKey>← Formalara qayıt</HelpKey> keçidi, altında forma adı (başlıq)
          və bir sətirlik xülasə durur: status nişanı (<strong>Qaralama</strong> /{" "}
          <strong>Dərc edilib</strong> / <strong>Arxivlənib</strong>), ictimai keçid yolu{" "}
          <HelpKey>/f/&lt;slug&gt;</HelpKey>, sonra baxış və göndərmə sayları. Sağ yuxarıda iki
          düymə var: <HelpKey>Qaralamanı yadda saxla</HelpKey> və{" "}
          <HelpKey>Dərc et</HelpKey> (forma artıq dərc edilibsə{" "}
          <HelpKey>Yenidən dərc et</HelpKey>). Altda iki blok gəlir:{" "}
          <strong>Metaməlumat</strong> və <strong>Sahələr</strong>. Bir xəta baş verərsə,
          blokların üstündə qırmızı xəta zolağı görünür.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status">Formanın vəziyyəti — Qaralama (heç kim görmür), Dərc edilib (ictimai keçid canlıdır) və ya Arxivlənib.</HelpDef>
          <HelpDef term="/f/&lt;slug&gt;">Formanın ictimai ünvanı — dərc edildikdən sonra ziyarətçilər bu keçid üzərindən doldurur.</HelpDef>
          <HelpDef term="Baxış / Göndərmə">Forma neçə dəfə açılıb (baxış) və neçə dəfə doldurulub-göndərilib (göndərmə).</HelpDef>
          <HelpDef term="Metaməlumat">Formanın adı, təsviri, uğur mesajı, yönləndirmə URL-i, bildiriş e-poçtları, kampaniya bağlantısı və avtomatik Lid yaratma seçimi.</HelpDef>
          <HelpDef term="Sahə">Ziyarətçinin dolduracağı bir giriş (mətn, e-poçt, açılan siyahı və s.) — açar, etiket, növ və məcburilik xüsusiyyəti olan.</HelpDef>
          <HelpDef term="Açar (key)">Sahənin verilənlər açarı (məs. email, phone, name) — göndərilən cavabda dəyər bu açar altında saxlanır. Avtomatik Lid yaratma email / phone / name açarlarını tələb edir.</HelpDef>
        </dl>
        <p>
          <strong>Sahələr</strong> blokunda hər sahə bir sətir kimi göstərilir: solda yuxarı/aşağı
          ox düymələri (tərtib üçün), ortada etiket və açar + növ, sağda zibil qutusu (sil)
          ikonası. Hələ sahə yoxdursa, «Hələ sahə yoxdur. Başlamaq üçün bir sahə əlavə edin.»
          mətni görünür. Sahə tərtibatı sürükle-burax DEYİL — yalnız oxlarla yuxarı/aşağı köçürülür.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: forma sahələrini qur">
        <HelpStep n={1}>
          <p>
            <strong>Sahələr</strong> blokunun sağ üstündəki <HelpKey>Sahə əlavə et</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Sahə əlavə et» başlıqlı pəncərə açılır. İçində <strong>Açar (forma verilənləri
            açarı)</strong>, <strong>Növ</strong> (açılan siyahı), <strong>Etiket (istifadəçiyə
            görünür)</strong> sahələri, <strong>Məcburi</strong> qeyd qutusu və aşağıda{" "}
            <HelpKey>Ləğv et</HelpKey> ilə <HelpKey>Sahə əlavə et</HelpKey> düymələri var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Açar</strong> yazın — hərflə başlamalı, 1–64 simvol, yalnız hərf, rəqəm,{" "}
            <HelpKey>_</HelpKey> və <HelpKey>-</HelpKey> ola bilər (məs. <HelpKey>email</HelpKey>).
            Sonra <strong>Növ</strong> seçin və istifadəçiyə görünən <strong>Etiket</strong>{" "}
            yazın (məs. «E-poçtunuz»). Lazımdırsa <strong>Məcburi</strong> qutusunu işarələyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Növ siyahısında 11 növ var: <strong>Mətn</strong>, <strong>E-poçt</strong>,{" "}
            <strong>Telefon</strong>, <strong>URL</strong>, <strong>Mətn sahəsi</strong>,{" "}
            <strong>Rəqəm</strong>, <strong>Açılan siyahı</strong>, <strong>Radio düymə</strong>,{" "}
            <strong>İşarə qutusu</strong>, <strong>Tarix</strong> və <strong>Gizli</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Əgər növ <strong>Açılan siyahı</strong>, <strong>Radio düymə</strong> və ya{" "}
            <strong>İşarə qutusu</strong> seçilibsə, əlavə olaraq <strong>Variantlar</strong>{" "}
            sahəsi peyda olur. Variantları vergüllə yazın — format{" "}
            <HelpKey>Label=value, Label2=value2</HelpKey> (məs. <HelpKey>Red=r, Blue=b, Green=g</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Variant sahəsi yalnız bu üç növ üçün görünür. Yer tutucu mətn{" "}
            <HelpKey>Red=r, Blue=b, Green=g</HelpKey> formatı göstərir. Bu növlərdə ən azı bir
            variant olmasa, pəncərədə qırmızı xəbərdarlıq çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Pəncərənin altındakı <HelpKey>Sahə əlavə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açar yanlış formatdadırsa, artıq istifadə olunubsa və ya etiket boşdursa, pəncərənin
            içində qırmızı xəta mesajı çıxır və pəncərə bağlanmır. Hər şey düzgündürsə pəncərə
            bağlanır və yeni sahə <strong>Sahələr</strong> siyahısının sonuna əlavə olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Sahənin yerini dəyişmək üçün sətrin solundakı yuxarı/aşağı ox düymələrini basın. Sahəni
            silmək üçün sağdakı zibil qutusu ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahə siyahıda yuxarı/aşağı sürüşür. İlk sahədə yuxarı ox, sonuncu sahədə aşağı ox sönük
            (deaktiv) olur. Silmə sahəni dərhal siyahıdan çıxarır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Sahə əlavə etmək, köçürmək və ya silmək yalnız ekranda dəyişiklikdir — serverdə hələ
            saxlanmır. Dəyişiklikləri itirməmək üçün <HelpKey>Qaralamanı yadda saxla</HelpKey> və ya{" "}
            <HelpKey>Dərc et</HelpKey> basmadan səhifəni tərk etməyin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: metaməlumatı tənzimlə">
        <HelpStep n={1}>
          <p>
            <strong>Metaməlumat</strong> blokunda <strong>Ad</strong> və <strong>Təsvir</strong>{" "}
            sahələrini doldurun. Ad başlıqdakı forma adını dəyişir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ad bir sətirlik giriş, Təsvir isə iki sətirlik mətn sahəsidir. Yazdıqca mətn dərhal
            görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Uğur mesajı</strong> (göndərişdən sonra göstərilən mətn) və istəyə bağlı{" "}
            <strong>Yönləndirmə URL-i</strong> yazın. URL boşdursa, göndərişdən sonra uğur mesajı
            göstərilir; URL varsa ziyarətçi həmin ünvana yönləndirilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Uğur mesajı sahəsində «Müraciətiniz üçün təşəkkür edirik!» yer tutucu mətni, URL
            sahəsində isə <HelpKey>https://…/thank-you</HelpKey> nümunəsi durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Bildiriş e-poçtları</strong> sahəsinə vergüllə ayrılmış ünvanlar yazın — hər
            göndərişdə bu ünvanlara xəbər gedir (məs. <HelpKey>alice@org.com, bob@org.com</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahə yer tutucu kimi <HelpKey>alice@org.com, bob@org.com</HelpKey> göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            İstəyə bağlı olaraq <strong>Marketinq kampaniyası</strong> açılan siyahısından bir
            kampaniya seçin. Bağlamaq istəmirsinizsə <HelpKey>— Kampaniya yoxdur —</HelpKey>{" "}
            qalsın. Sonda <strong>Hər göndərmədə avtomatik Lid yarat</strong> qutusunu işarələmək
            istəyib-istəmədiyinizə qərar verin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kampaniya siyahısının altında izah var: tanınan kontaktın göndərişi çoxtəmaslı
            atribusiya təması qeyd edir. Avtomatik Lid yaratma qeydinin yanında qeyd: bu seçim{" "}
            <HelpKey>email</HelpKey>, <HelpKey>phone</HelpKey>, <HelpKey>name</HelpKey> sahə
            açarlarını tələb edir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: yadda saxla və dərc et">
        <HelpStep n={1}>
          <p>
            Dəyişiklikləri formanı canlıya çıxarmadan saxlamaq üçün sağ yuxarıdakı{" "}
            <HelpKey>Qaralamanı yadda saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Yadda saxlanılır…» yazısına keçir və müvəqqəti deaktiv olur. Server bir şeyi
            rədd etsə (məs. yanlış sahə tərtibatı), blokların üstündə qırmızı zolaqda səbəb
            göstərilir. Uğurlu olarsa səhifə yenilənmiş forma ilə qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Formanı canlıya çıxarmaq üçün <HelpKey>Dərc et</HelpKey> düyməsini basın (artıq dərc
            edilibsə düymə <HelpKey>Yenidən dərc et</HelpKey> adlanır). Bu düymə forma heç bir
            sahəsi olmayanda deaktivdir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Brauzerin təsdiq pəncərəsi çıxır: «Bu forma dərc edilsin? İctimai keçid dərhal aktiv
            olacaq.» Təsdiqlədikdən sonra düymə «Dərc edilir…» yazısına keçir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Təsdiqi gözləyin — dərc etmədən əvvəl sistem cari dəyişiklikləri avtomatik yadda saxlayır,
            yalnız ondan sonra dərc edir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yadda saxlama uğursuz olarsa, dərc DAYANDIRILIR və qırmızı xəta zolağı görünür — köhnə
            versiya yanlışlıqla dərc olunmur. Hər şey uğurlu olarsa status nişanı{" "}
            <strong>Dərc edilib</strong> olur və başlıqdakı <HelpKey>/f/&lt;slug&gt;</HelpKey>{" "}
            keçidi artıq canlıdır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Dərc et eyni anda iki iş görür: əvvəlcə yadda saxlayır, sonra dərc edir. Buna görə dərc
            etməzdən əvvəl ayrıca <HelpKey>Qaralamanı yadda saxla</HelpKey> basmağa ehtiyac yoxdur —
            amma sadəcə işi qoruyub canlıya çıxarmaq istəmirsinizsə qaralama saxlama faydalıdır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          <HelpKey>Dərc et</HelpKey> ictimai keçidi (<HelpKey>/f/&lt;slug&gt;</HelpKey>) dərhal
          canlı edir — keçidi olan hər kəs formanı doldura bilər. Buna görə dərc etməzdən əvvəl
          məcburi sahələri, etiketləri və variantları yoxlayın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Forma və onun bütün sahələri təşkilatınızla məhdudlaşır — başqa təşkilatın formalarını
          görmür və redaktə edə bilmirsiniz. Kampaniya açılan siyahısı yalnız sizin təşkilatınızın
          kampaniyalarından gəlir. Avtomatik Lid yaratma da Lidi sizin təşkilatınızda yaradır.
        </p>
      </HelpCallout>
    </div>
  )
}
