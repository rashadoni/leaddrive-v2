"use client"

/**
 * Da Vinci Lid Qiymətləndirməsi (AI scoring) — help article (Azerbaijani).
 * Video-skript formatına yenidən yazılıb. Yalnız "/ai-scoring" səhifəsini əhatə edir:
 * lidlərin Da Vinci ilə qiymətləndirilməsi (bal, qrad, çevrilmə ehtimalı, izah),
 * nəticə cədvəli, sıralama, "Hamısını qiymətləndir" və sətir üzrə "Yenidən hesabla".
 * Faktlar src/app/(dashboard)/ai-scoring/page.tsx + src/app/api/v1/lead-scoring/route.ts
 * ilə üz-üzə yoxlanıb (getGrade həddləri, qayda əsaslı amil çəkiləri, conversionProb =
 * score * 0.85, PiiMasker mask/unmask). Agent konfiqurasiyası bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function AiScoringHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış meneceri və ya komanda rəhbərisiniz"
        goal="Lidləri keyfiyyətinə görə avtomatik sıralamaq — hansının daha çox çevriləcəyini Da Vinci hesablasın, siz isə əvvəlcə ən isti lidlərlə işləyəsiniz"
      >
        Səhifə <HelpKey>Da Vinci İdarəetmə Mərkəzi</HelpKey> başlığı ilə açılır. Bütün lidlər və
        balları yalnız sizin təşkilatınızdandır. Qiymətləndirmə avtomatik baş vermir — düyməni siz
        basırsınız; nəticələr lidin üzərində saxlanılır, ona görə səhifə artıq bala görə sıralanmış
        açılır və hesablama bitən kimi kartlar ilə sətirlər dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda beyin ikonalı başlıq kartı durur: solda <HelpKey>Da Vinci İdarəetmə Mərkəzi</HelpKey>{" "}
          adı və altında «Da Vinci ilə lid qiymətləndirmə: lid keyfiyyətinin və çevrilmə ehtimalının
          avtomatik qiymətləndirilməsi» izahı, sağda isə <HelpKey>Hamısını qiymətləndir</HelpKey>{" "}
          düyməsi. Başlığın altında həmin izah bir də ayrıca məlumat zolağında təkrarlanır.
        </p>
        <p>
          Sonra beş <strong>qrad kartı</strong> bir cərgədə gəlir — <strong>A</strong>,{" "}
          <strong>B</strong>, <strong>C</strong>, <strong>D</strong>, <strong>F</strong> — hər biri
          böyük hərf, altında həmin qrada düşən lidlərin sayı və «Lidlər» yazısı ilə. Onların altında
          xülasə zolağı durur: <strong>Ort. bal</strong>, <strong>Ehtimal</strong> və{" "}
          <strong>Cəmi sessiyalar</strong>. Ən aşağıda <strong>Lidlər</strong> cədvəli yerləşir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Bal (Score)">0–100 arası tam ədəd — lidin keyfiyyət qiyməti. Cədvəldə «Bal» sütununda qalın görünür.</HelpDef>
          <HelpDef term="Qrad (A–F)">Balın hərf qarşılığı sabit həddlərlə: A = 80–100, B = 60–79, C = 40–59, D = 20–39, F = 20-dən aşağı. Rəngli dairə kimi göstərilir (A yaşıl, B mavi, C sarı, D narıncı, F qırmızı).</HelpDef>
          <HelpDef term="Konversiya">Lidin satışa çevrilmə ehtimalı (%). 50%+ yaşıl, 30–49% sarı, aşağısı qırmızı rənglənir.</HelpDef>
          <HelpDef term="Statistika">Da Vinci-nin bal üçün verdiyi qısa izah (mətn) — balı qaldıran güclü tərəflər və onu saxlayan boşluqlar. Yanında bənövşəyi parıltı ikonası olur; izah yoxdursa «—» görünür.</HelpDef>
          <HelpDef term="Ort. bal">Bütün lidlərin orta balı, 100-dən. Lid yoxdursa 0.</HelpDef>
          <HelpDef term="Ehtimal">Bütün lidlər üzrə orta çevrilmə ehtimalı (%).</HelpDef>
          <HelpDef term="Cəmi sessiyalar">İndiyə qədər ən azı bir dəfə həqiqətən qiymətləndirilmiş lidlərin sayı.</HelpDef>
          <HelpDef term="Da Vinci nişanı">Başlıq altında parıltı ikonalı «Da Vinci» nişanı — yalnız son hesablama əsl AI açarı ilə aparılanda görünür; əks halda şəffaf qayda əsaslı formul işləyir.</HelpDef>
        </dl>
        <p>
          Cədvəlin sütunları: <strong>Bal</strong> (qrad dairəsi), <strong>Bal</strong> (rəqəm),{" "}
          <strong>Lid</strong> (əlaqə adı), <strong>Şirkət</strong>, <strong>Mənbə</strong>,{" "}
          <strong>Konversiya</strong>, <strong>Statistika</strong> və <strong>Əməliyyatlar</strong>.
          Hər sətrin sonunda yeniləmə ikonalı <HelpKey>Yenidən hesabla</HelpKey> düyməsi var. Hələ heç
          lid yoxdursa, cədvəlin yerinə «Hələ lid yoxdur. Birincini yaradın!» mətni göstərilir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: bütün lidləri qiymətləndir">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Hamısını qiymətləndir</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə içindəki beyin ikonası fırlanan dairəyə (spinnerə) keçir və yazı{" "}
            <strong>Yüklənir...</strong> olur; hesablama bitənə qədər düymə deaktiv qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Hesablamanın bitməsini gözləyin — təşkilatınızın bütün lidləri bir keçidlə qiymətləndirilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bitəndə cədvəl yenilənmiş bal, qrad, konversiya və <strong>Statistika</strong> izahları ilə
            dolur. Beş qrad kartındakı saylar və alt zolaqdakı <strong>Ort. bal</strong> /{" "}
            <strong>Ehtimal</strong> / <strong>Cəmi sessiyalar</strong> dəyərləri yeni nəticələri əks
            etdirir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Başlıq altında <HelpKey>Da Vinci</HelpKey> nişanının görünüb-görünmədiyinə baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Nişan görünürsə, ballar əsl Da Vinci AI ilə hesablanıb — model kontakt tamlığını, mənbə
            keyfiyyətini, cəlbolunmanı, satış potensialını və təzəliyi ölçür. Nişan yoxdursa, AI açarı
            əlçatan olmayıb və sistem ehtiyat qayda əsaslı formula keçib — ballar yenə görünür, sadəcə
            izahlar daha sadə olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: tək lidi yenidən hesabla">
        <HelpStep n={1}>
          <p>
            Cədvəldə istədiyiniz lidin sətrini tapın və sonundakı <HelpKey>Yenidən hesabla</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yalnız həmin düymədəki ikona fırlanan spinnerə çevrilir və düymə deaktiv olur; cədvəlin
            qalan sətirləri toxunulmaz qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Hesablama bitənədək gözləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Həmin sətrin <strong>Bal</strong>, qrad dairəsi, <strong>Konversiya</strong> faizi və{" "}
            <strong>Statistika</strong> izahı yenilənir. Dəyişiklik xülasə zolağındakı orta göstəricilərə
            də təsir edə bilər.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: lidləri sırala">
        <HelpStep n={1}>
          <p>
            Cədvəldə sıralamaq istədiyiniz sütun başlığını basın:{" "}
            <strong>Bal</strong> (qrad), <strong>Bal</strong> (rəqəm), <strong>Lid</strong>,{" "}
            <strong>Şirkət</strong>, <strong>Mənbə</strong> və ya <strong>Konversiya</strong>. (Standart
            olaraq cədvəl bala görə yüksəkdən aşağıya sıralıdır.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Aktiv sütunun başlığında yuxarı və ya aşağı ox ikonası yanır, sətirlər həmin sütuna görə
            yenidən düzülür. <strong>Statistika</strong> və <strong>Əməliyyatlar</strong> sütunları
            sıralanmır — onlarda ox ikonası olmur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Eyni başlığa təkrar basaraq istiqaməti dəyişin (azalan ↔ artan).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Başlıqdakı ox yuxarıdan aşağıya (və əksinə) çevrilir və sətirlərin ardıcıllığı dərhal tərsinə
            düzülür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          İş axınınız: əvvəlcə <HelpKey>Hamısını qiymətləndir</HelpKey> ilə hər kəsi hesablayın, sonra{" "}
          <strong>Bal</strong> sütununu yüksəkdən aşağıya sıralayın və ən yuxarıdakı <strong>A</strong>{" "}
          / <strong>B</strong> qradlı lidlərlə başlayın. Lidin e-poçtunu, telefonunu və ya qeydini
          əlavə edəndən sonra yalnız onun sətrindəki <HelpKey>Yenidən hesabla</HelpKey> ilə balı
          təzələyin — bütün siyahını yenidən qiymətləndirməyə ehtiyac yoxdur. Cədvəldəki «—» sadəcə o
          sahənin boş olduğunu bildirir; onu doldurmaq adətən növbəti balı qaldırır.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <strong>Da Vinci</strong> nişanı görünmürsə, ballar ehtiyat qayda əsaslı formul ilə
          hesablanıb — bu da etibarlıdır və şəffaf çəkilərə əsaslanır: e-poçt (+15), telefon (+10),
          şirkət (+10), mənbə (referans +20 / sayt +15 / e-poçt +10 / digər +5), prioritet (yüksək +15
          / orta +10 / digər +5), status (çevrilib +20 / kvalifikasiya +15 / əlaqə qurulub +10),
          təxmini dəyər (+10) və 10 simvoldan uzun qeyd (+5); cəm 100 ilə məhdudlaşır, konversiya isə
          baldan (balın ~85%-i) çıxarılır. Fərq sadəcə <strong>Statistika</strong> izahlarının daha
          qısa olmasındadır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Yalnız öz təşkilatınızın lidlərini görür və qiymətləndirirsiniz — başqa təşkilatın lidləri bu
          siyahıya düşmür. Lid Da Vinci-yə göndərilməzdən əvvəl e-poçt və telefon nömrələri kimi şəxsi
          məlumatlar <strong>maskalanır</strong>, orijinal dəyərlər isə yalnız sizə göstərilən nəticədə
          bərpa olunur.
        </p>
      </HelpCallout>
    </div>
  )
}
