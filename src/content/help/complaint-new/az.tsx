"use client"

/**
 * New complaint / suggestion — help article (Azerbaijani).
 * Yalnız Şikayətlər → Yeni şikayət / təklif səhifəsini əhatə edir
 * (src/app/(dashboard)/complaints/new/page.tsx): dörd bölməli forma
 * (Müştəri / Müraciət / Məhsul və obyekt / Məsul və prioritet),
 * AI məsləhəti düyməsi, datalist avtotamamlama (facets) və yadda saxlama.
 * Reyestr siyahısı və şikayət detal səhifəsi bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function complaintnewHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Qaynar xətt operatoru, müştəri xidməti əməkdaşı və ya keyfiyyət nəzarətçisisiniz"
        goal="Müştəridən gələn şikayət və ya təklifi sistemdə qeyd edib məsul şöbəyə yönləndirmək"
      >
        Səhifəyə <HelpKey>Şikayətlər</HelpKey> reyestrindən <HelpKey>Yeni şikayət / təklif</HelpKey>{" "}
        ilə, və ya birbaşa <HelpKey>/complaints/new</HelpKey> ünvanı ilə çatırsınız. Forma boş açılır;
        yeganə məcburi sahə <strong>Məzmun</strong>dur. Bütün məlumat sizin təşkilatınız üçün qeyd
        olunur. Yuxarıda <HelpKey>Reyestrə qayıt</HelpKey> linki sizi yadda saxlamadan geri qaytarır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda <HelpKey>Reyestrə qayıt</HelpKey> linki, altında <strong>Yeni şikayət / təklif</strong>{" "}
          başlığı var. Forma dörd çərçivəli bölmədən ibarətdir:{" "}
          <strong>Müştəri</strong>, <strong>Müraciət</strong>, <strong>Məhsul və obyekt</strong> və{" "}
          <strong>Məsul və prioritet</strong>. Ən aşağıda <HelpKey>Ləğv et</HelpKey> və{" "}
          <HelpKey>Yarat</HelpKey> düymələri durur. Marka, sahə, kateqoriya, obyekt və şöbə sahələri
          siz yazdıqca əvvəlki qeydlərdən avtomatik təklif (datalist) verir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Müştəri">Müraciət edənin Ad Soyad və Telefon məlumatları (hər ikisi istəyə bağlı).</HelpDef>
          <HelpDef term="Mənbə">Müraciətin haradan gəldiyi: Qaynar xətt, E-mail, Satış nümayəndəsi, WhatsApp, Instagram, Facebook və ya Portal / çat.</HelpDef>
          <HelpDef term="Növ">Müraciətin Şikayət, yoxsa Təklif olduğu.</HelpDef>
          <HelpDef term="Məzmun">Müştərinin müraciətinin mətni — yeganə məcburi sahə.</HelpDef>
          <HelpDef term="AI məsləhəti">Məzmuna baxıb risk səviyyəsi, məsul şöbə və növü avtomatik təklif edən düymə (məzmun ən azı 20 simvol olduqda aktivləşir).</HelpDef>
          <HelpDef term="Marka / İstehsal sahəsi / Məhsul kateqoriyası / Şikayət obyekti">Müraciətin hansı məhsula aid olduğunu daralda biləcəyiniz iyerarxik sahələr; yuxarı sahəni dəyişəndə alt sahələr sıfırlanır.</HelpDef>
          <HelpDef term="Məsul şöbə">Müraciəti emal edəcək daxili şöbə (məs. Keyfiyyət nəzarət şöbəsi).</HelpDef>
          <HelpDef term="Risk səviyyəsi">Müraciətin təcililiyi: Aşağı riskli, Orta riskli və ya Yüksək riskli.</HelpDef>
        </dl>
        <p>
          Sahələrin çoxu istəyə bağlıdır — yalnız <strong>Məzmun</strong> doldurulmayınca{" "}
          <HelpKey>Yarat</HelpKey> düyməsi qeyri-aktiv qalır. Qalanları sonradan şikayət detal
          səhifəsindən də tamamlaya bilərsiniz.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: müştəri və müraciəti qeyd et">
        <HelpStep n={1}>
          <p>
            <strong>Müştəri</strong> bölməsində <HelpKey>Ad Soyad</HelpKey> və{" "}
            <HelpKey>Telefon</HelpKey> sahələrini doldurun (məcburi deyil).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İki sahə yan-yana durur. Telefon sahəsində <HelpKey>055 XXX XX XX</HelpKey> nümunə mətni
            (placeholder) görünür — bu sahə boş qalsa, şikayət yenə də yaranır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Müraciət</strong> bölməsində <HelpKey>Mənbə</HelpKey> və <HelpKey>Növ</HelpKey>{" "}
            açılan siyahılarını seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mənbə siyahısında yeddi seçim var (standart — <strong>Qaynar xətt</strong>); Növ siyahısında
            isə <strong>Şikayət</strong> (standart) və <strong>Təklif</strong> seçimləri.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Məzmun</HelpKey> sahəsinə müştərinin müraciətini yazın. Bu, yeganə məcburi
            sahədir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Beş sətirlik mətn sahəsidir, içində «Müştərinin müraciətini təsvir edin…» nümunə mətni var.
            Sahənin altında, sağda <HelpKey>AI məsləhəti</HelpKey> düyməsi durur — məzmun 20 simvoldan az
            olduqda boz/qeyri-aktiv görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: AI ilə şöbə və riski təklif et (istəyə bağlı)">
        <HelpStep n={1}>
          <p>
            Məzmunu yazandan sonra <HelpKey>AI məsləhəti</HelpKey> düyməsini basın (qığılcım ikonalı).
            Düymə yalnız məzmun ən azı 20 simvol olduqda aktiv olur.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymənin yazısı təhlil zamanı <strong>Analiz…</strong> olur. Üzərinə gəldikdə «Şöbə və risk
            səviyyəsini avtomatik təklif et» izahı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Təhlil bitdikdə nəticə avtomatik olaraq formaya yerləşdirilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Risk səviyyəsi</strong>, <strong>Məsul şöbə</strong> və <strong>Növ</strong> sahələri
            AI-nın təklifi ilə yenilənir. AI bir şöbə təyin edə bilməsə, mövcud dəyər olduğu kimi qalır —
            təklifləri əl ilə dəyişə bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: məhsul və məsulu təyin et">
        <HelpStep n={1}>
          <p>
            <strong>Məhsul və obyekt</strong> bölməsində <HelpKey>Marka</HelpKey>,{" "}
            <HelpKey>İstehsal sahəsi</HelpKey>, <HelpKey>Məhsul kateqoriyası</HelpKey>,{" "}
            <HelpKey>Şikayət obyekti</HelpKey> və <HelpKey>Şikayət obyekti 2</HelpKey> sahələrini
            doldurun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bu sahələrə yazmağa başladıqda əvvəlki şikayətlərdən gələn təkliflər açılan siyahı kimi
            görünür. <strong>Marka</strong>nı dəyişsəniz, altdakı sahə, kateqoriya və obyekt sahələri
            avtomatik təmizlənir (iyerarxiya pozulmasın deyə).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Məsul və prioritet</strong> bölməsində <HelpKey>Məsul şöbə</HelpKey>ni yazın və{" "}
            <HelpKey>Risk səviyyəsi</HelpKey>ni seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Məsul şöbə sahəsində «Marketing departamenti, Keyfiyyət nəzarət şöbəsi…» nümunə mətni və
            təklif siyahısı var. Risk siyahısında üç seçim durur: <strong>Aşağı riskli</strong>,{" "}
            <strong>Orta riskli</strong> (standart) və <strong>Yüksək riskli</strong>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: yadda saxla">
        <HelpStep n={1}>
          <p>
            Formanın altındakı <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> sizi reyestrə qaytarır.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə <strong>Saxlanılır…</strong> yazısına keçir. Uğurlu olduqda avtomatik olaraq yeni
            şikayətin detal səhifəsinə (<HelpKey>/complaints/&lt;id&gt;</HelpKey>) keçirsiniz. Xəta olarsa,
            düymələrin üstündə qırmızı çərçivədə xəta mesajı (məs. «Yadda saxlanılmadı» və ya «Şəbəkə
            xətası») görünür və forma açıq qalır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <HelpKey>Yarat</HelpKey> düyməsi yalnız <strong>Məzmun</strong> dolu olanda işə düşür — qalan
          bütün sahələr istəyə bağlıdır. Tez qeyd lazımdırsa, sadəcə məzmunu yazıb yadda saxlayın;
          marka, şöbə və riski sonradan şikayət detal səhifəsindən dəqiqləşdirə bilərsiniz.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          AI məsləhəti yalnız <strong>təklifdir</strong> — risk səviyyəsi, şöbə və növü avtomatik
          doldurur, amma yadda saxlamadan əvvəl onları yoxlayıb düzəltmək sizin məsuliyyətinizdədir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün şikayətlər təşkilatınızla məhdudlaşır — yaratdığınız müraciət yalnız sizin tenant-ınızda
          görünür. Avtotamamlama təklifləri (marka, sahə, şöbə və s.) də yalnız öz təşkilatınızın əvvəlki
          qeydlərindən gəlir.
        </p>
      </HelpCallout>
    </div>
  )
}
