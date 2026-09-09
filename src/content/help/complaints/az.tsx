"use client"

/**
 * Complaints — help article (Azerbaijani).
 * Video-skript formatı: Şikayət və təkliflər reyestri səhifəsini (ticketlər
 * üzərində qurulub) addım-addım göstərir — reyestr görünüşü, yeni qeyd, AI
 * təsnifatı, qeyd üzərində iş və xlsx idxal/ixrac. en.tsx + ru.tsx güzgüsüdür.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ComplaintsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Keyfiyyət, dəstək və ya müştəri xidmətləri əməkdaşısınız"
        goal="Hər müştəri şikayətini və ya təklifini bir reyestrdə qeyd etmək, ona cavab vermək və köhnə xlsx jurnalını yeni sistemə köçürmək"
      >
        Səhifəyə sol menyudan <HelpKey>Şikayət və təkliflər reyestri</HelpKey> ilə çatırsınız.
        Arxa planda hər qeyd tam hüquqlu <strong>ticketdir</strong> — ona görə onu işə götürmək,
        cavab vermək və tam dəyişiklik tarixçəsi ilə həll etmək olur. Bütün qeydlər yalnız sizin
        təşkilatınıza aiddir; ekranda nə görürsünüzsə — saylar, süzgəclər, cədvəl — hamısı eyni
        siyahıdan oxunur, ona görə dəyişiklik etdikcə yuxarıdakı sayğaclar dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Şikayət və təkliflər reyestri</HelpKey> adı (yanında xəbərdarlıq ikonası),
          altında izah sətri durur. Sağ yuxarıda üç düymə var: <HelpKey>xlsx idxal</HelpKey>,{" "}
          <HelpKey>xlsx ixrac</HelpKey> və <HelpKey>Yeni şikayət</HelpKey>. Onların altında dörd
          sayğac kartı, sonra bir sıra süzgəc, ən altda isə qeydlərin cədvəli gəlir — hələ heç qeyd
          yoxdursa, cədvəlin yerinə boş vəziyyət göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi">Hazırda görünən bütün qeydlərin sayı.</HelpDef>
          <HelpDef term="Açıq">Statusu «Açıq» və ya «İşdədir» olan qeydlərin cəmi — indi diqqət tələb edən.</HelpDef>
          <HelpDef term="Yüksək risk">Yalnız risk səviyyəsi «Yüksək» olaraq işarələnmiş qeydlər.</HelpDef>
          <HelpDef term="Həll olundu">Statusu «Həll olundu» olan qeydlərin sayı.</HelpDef>
          <HelpDef term="№">Xarici reyestr nömrəsi varsa onu, yoxsa ticket nömrəsini göstərir.</HelpDef>
          <HelpDef term="Risk">aşağı, orta və ya yüksək — cədvəldə rəngli nişanla göstərilir.</HelpDef>
          <HelpDef term="Status">açıq, işdədir, həll olundu, bağlı (qeyd özündə eskalasiya da ola bilər).</HelpDef>
        </dl>
        <p>
          Süzgəclər sırasında iki sərbəst mətn xanası (<strong>Marka</strong> və{" "}
          <strong>Məhsul</strong>) və iki açılan siyahı (<strong>Risk</strong> və{" "}
          <strong>Status</strong>) var. Cədvəl sütunları: №, Müştəri, Tarix, Mənbə, Marka, Məhsul,
          Obyekt, Şöbə, Risk və Status. Cədvəlin yuxarısındakı axtarış mövzuya görə süzür, sətrə
          klikləmək isə həmin qeydi tam açır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni şikayət və ya təklif qeyd et">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni şikayət</HelpKey> düyməsini basın. (Reyestr boşdursa, boş
            vəziyyətin ortasındakı <HelpKey>Yarat</HelpKey> düyməsi də sizi eyni formaya aparır.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni şikayət / təklif» başlıqlı səhifə açılır. Yuxarıda <HelpKey>Reyestrə qayıt</HelpKey>{" "}
            keçidi, altında dörd bölmə var: <strong>Müştəri</strong>, <strong>Müraciət</strong>,{" "}
            <strong>Məhsul və obyekt</strong>, <strong>Məsul və prioritet</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Müştəri</strong> bölməsində <strong>Ad Soyad</strong> və <strong>Telefon</strong>{" "}
            yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Telefon xanasında <HelpKey>055 XXX XX XX</HelpKey> nümunə mətni durur. Bu sahələrin heç
            biri məcburi deyil.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Müraciət</strong> bölməsində <strong>Mənbə</strong> və <strong>Növ</strong>{" "}
            seçin, sonra <strong>Məzmunu</strong> yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mənbə açılan siyahısında Qaynar xətt, E-mail, Satış nümayəndəsi, WhatsApp, Instagram,
            Facebook və Portal / çat seçimləri var; Növ açılan siyahısında Şikayət və Təklif. Məzmun
            sahəsi məcburidir — başlığında qırmızı ulduz (<strong>*</strong>) var və boş qalsa qeyd
            yadda saxlanmır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <strong>Məhsul və obyekt</strong> bölməsini doldurun: Marka, İstehsal sahəsi, Məhsul
            kateqoriyası, Şikayət obyekti və Şikayət obyekti 2.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bu sahələrə yazdıqca əvvəl işlətdiyiniz dəyərlər avtomatik tamamlama siyahısı kimi açılır.
            «Yuxarı» sahəni dəyişəndə (məsələn Markanı) ondan asılı sahələr (İstehsal sahəsi, Məhsul
            kateqoriyası, Şikayət obyekti) təmizlənir ki, zəncir uyğun qalsın.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            <strong>Məsul və prioritet</strong> bölməsində <strong>Məsul şöbə</strong> və{" "}
            <strong>Risk səviyyəsi</strong>ni təyin edin, sonra aşağıdakı <HelpKey>Yarat</HelpKey>{" "}
            düyməsini basın. (Fikrinizi dəyişsəniz — <HelpKey>Ləğv et</HelpKey> reyestrə qaytarır.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Risk səviyyəsi açılan siyahısında Aşağı / Orta / Yüksək riskli seçimləri var (standart
            olaraq Orta). <HelpKey>Yarat</HelpKey> düyməsi Məzmun boş olduqda qeyri-aktiv qalır;
            saxlanarkən «Saxlanılır…» yazısına keçir, sonra sizi həmin qeydin tam səhifəsinə aparır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: boşluqları AI doldursun">
        <HelpStep n={1}>
          <p>
            Müraciət bölməsində məzmunu yazdıqdan sonra həmin bölmənin altındakı{" "}
            <HelpKey>AI məsləhəti</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yanında parıltı (sparkle) ikonası ilə görünür. Məzmun çox qısadırsa düymə
            qeyri-aktiv qalır — kifayət qədər mətn yazılanda aktivləşir. Basanda «Analiz…» yazısına
            keçir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Analiz bitənə qədər gözləyin — AI yazdığınız məzmunu oxuyub sahələri özü doldurur.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Risk səviyyəsi</strong>, <strong>Məsul şöbə</strong> və <strong>Növ</strong>{" "}
            (şikayət ya təklif) sahələri AI-nın təklifi ilə yenilənir. Yadda saxlamazdan əvvəl bu
            dəyərləri yoxlayın və lazım gəlsə əl ilə düzəldin.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            <HelpKey>AI məsləhəti</HelpKey> yalnız köməkçidir — son söz sizdədir. Təklif olunan şöbə
            və ya risk yanlışdırsa, sadəcə həmin xananı dəyişin; düymə nə vaxt istəsəniz yenidən
            basıla bilər.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: qeyd üzərində işlə">
        <HelpStep n={1}>
          <p>
            Reyestrdə istənilən sətrə klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qeydin tam səhifəsi açılır: yuxarıda № və mövzu, altında status nişanı, varsa risk nişanı
            və təklif olduqda «təklif» nişanı. Sağ yuxarıda əməliyyat düymələri, aşağıda isə Müştəri,
            Müraciət, Məhsul və Təyinat kartları, ardınca Məzmun (Şikayət məzmunu), Dəyişiklik
            tarixçəsi və Cavab bölmələri durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Qeydi irəli aparmaq üçün əməliyyat düymələrindən birini basın: <HelpKey>İşə götür</HelpKey>,{" "}
            <HelpKey>Bağla ok</HelpKey> və ya <HelpKey>not ok</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <HelpKey>İşə götür</HelpKey> statusu «İşdədir» edir, <HelpKey>Bağla ok</HelpKey> «Həll
            olundu» kimi işarələyir, <HelpKey>not ok</HelpKey> isə eskalasiya edir. Düymələr cari
            statusa görə görünür — məsələn qeyd artıq həll olunubsa, «Bağla ok» düyməsi göstərilmir.
            Status nişanı dərhal yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Müştəriyə cavab vermək üçün aşağıdakı <strong>Cavab</strong> sahəsinə yazıb{" "}
            <HelpKey>Göndər</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Göndərilən cavab həmin bölmədə əvvəlki cavabların yanında ad və tarixlə görünür. Hələ
            cavab yoxdursa «Hələ cavab yoxdur» mətni durur. Boş sahə ilə düymə qeyri-aktivdir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <strong>Dəyişiklik tarixçəsi</strong> kartını yoxlayın — kimin nəyi və nə vaxt dəyişdiyini
            göstərir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə tarix, əməliyyatı edən şəxs və status / risk / şöbə kimi dəyişikliklər
            «əvvəl → sonra» şəklində göstərilir, beləliklə reyestr yoxlanıla bilən qalır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Sağ yuxarıdakı qırmızı zibil qutusu düyməsi qeydi <strong>birdəfəlik silir</strong> —
            «Bu qeydi birdəfəlik silmək?» təsdiqindən sonra meta məlumatı da onunla gedir və geri
            qaytarma yoxdur. Sadəcə bitirmək istədiyiniz qeydlər üçün silmək yerinə{" "}
            <HelpKey>Bağla ok</HelpKey> (həll olundu) seçimi daha təhlükəsizdir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: xlsx idxal və ixrac">
        <HelpStep n={1}>
          <p>
            Köhnə jurnalı köçürmək üçün reyestrdə <HelpKey>xlsx idxal</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İdxal səhifəsi açılır — başlıq «Şikayətlər reyestrinin idxalı (xlsx)» və altında
            müştərinin Azərbaycanca sütun formatının dəstəkləndiyini izah edən mətn. Ortada cədvəl
            ikonası ilə sürüşdür-burax sahəsi və <HelpKey>Fayl seç</HelpKey> düyməsi var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <code>.xlsx</code> faylını sahəyə sürüşdürün və ya <HelpKey>Fayl seç</HelpKey> ilə
            seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Emal olunur…» görünür, sonra <strong>Ön baxış</strong> kartı açılır: oxunan sətirlərin
            sayı, xəta sayı (varsa) və ilk bir neçə sətrin № / Sıra / Müştəri / Tarix / Marka / Risk /
            Status sütunlu cədvəli. Oxuna bilməyən sətirlər «Xəbərdarlıqlar» altında sadalanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Ön baxış düzgündürsə, kartın yuxarısındakı <HelpKey>{`{count} qeydi idxal et`}</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İdxal bitəndə nəticə kartı görünür — yaşıl təsdiq və ya qırmızı xəta ikonası ilə «İdxal
            tamamlandı» və neçə qeydin yaradıldığı. Buradan <HelpKey>Reyestri aç</HelpKey> və ya{" "}
            <HelpKey>Daha idxal et</HelpKey> seçə bilərsiniz. «Sıra» sütunundakı nömrələr reyestr
            nömrəsi kimi saxlanılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Bütün qeydləri faylda yükləmək üçün reyestrdə <HelpKey>xlsx ixrac</HelpKey> düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Brauzer tarixli <code>CRM-hesabat-…xlsx</code> kitabını avtomatik endirir — müştəriyə
            qaytarmaq və ya arxivləşdirmək üçün hazır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Süzgəcləri birləşdirə bilərsiniz — məsələn Status «Açıq» və Risk «Yüksək» seçib indi ən
          vacib qeydlərə baxa, sonra cədvəlin yuxarısındakı axtarışla mövzuya görə daha da
          daralta bilərsiniz. Sayğac kartları həmişə cari görünüşü əks etdirir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Buradakı hər şey təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın reyestrini görüb
          redaktə edirsiniz, başqa təşkilatın qeydləri görünmür. Bu bölmə yalnız <em>şikayət</em>{" "}
          qeydlərinə çıxış verir; adi dəstək ticketlərini reyestr vasitəsilə açmaq, dəyişmək və ya
          silmək olmaz.
        </p>
      </HelpCallout>
    </div>
  )
}
