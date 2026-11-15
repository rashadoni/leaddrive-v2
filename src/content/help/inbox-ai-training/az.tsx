"use client"

import { HelpCallout, HelpKey, TrainingGuide } from "./guide"

export default function InboxAiTrainingHelpAz() {
  return (
    <TrainingGuide
      persona="Siz müştərilərə kimin cavab verəcəyinə qərar verən administratorsunuz"
      goal="AI-ı əməkdaşlarınız kimi cavab verməyə öyrədin və hazır olanda kanalı ona ötürün"
      tocTitle="Ekranda nə haradadır"
      intro={
        <>
          Bölmə <HelpKey>Omni-Channel → AI-ın öyrədilməsi</HelpKey>. Kanal öyrənmədə olarkən əməkdaşlar cavab verir,
          AI isə səssizcə onların cavablarını oxuyur və öyrənir: necə yazırlar (xarakter) və nə deyirlər (biliklər).
          Müştərilər heç nə hiss etmir.
        </>
      }
      parts={[
        {
          id: "channels",
          title: "Yuxarıda kanallar",
          body: (
            <>
              <p>
                Hər kart bir kanaldır — Instagram, Facebook, WhatsApp, Telegram, TikTok. Kartda indi kimin cavab
                verdiyi (<HelpKey>Öyrənmə · N-ci gün</HelpKey>, <HelpKey>AI cavab verir</HelpKey>,{" "}
                <HelpKey>Əməkdaşlar cavab verir</HelpKey>) və hazırlıq faizi görünür. Karta basın — aşağıda bu kanal
                haqqında hər şey açılacaq.
              </p>
              <p>
                Başlamaq üçün kanalı seçin və <HelpKey>Öyrənməyə başla</HelpKey> düyməsini basın. Eyni ayar{" "}
                <HelpKey>AI agent → Hər kanalda kim cavab verir</HelpKey> bölməsində, <HelpKey>Öyrənmə</HelpKey>{" "}
                variantıdır. AI dərhal son 7 günün yazışmalarını oxuyacaq.
              </p>
            </>
          ),
        },
        {
          id: "readiness",
          title: "Hazırlıq: rəqəmi necə oxumaq",
          body: (
            <>
              <p>
                Dairədəki böyük rəqəm — son müştəri suallarının neçəsində AI mənaca əməkdaş kimi cavab verərdi. Hər
                ikinci suala AI səssizcə öz cavabını yazır, heç kimə göndərmir və əməkdaşın cavabı ilə müqayisə edir.
              </p>
              <p>
                Aşağıdakı zolaq: <HelpKey>Eyni</HelpKey>, <HelpKey>Demək olar ki, eyni</HelpKey>, <HelpKey>Fərqli</HelpKey>,{" "}
                <HelpKey>İnsana ötürərdi</HelpKey>. Daha aşağıda — günlərə görə artım və ikinci rəqəm: AI müştərilərin
                tez-tez soruşduğu mövzulardan neçəsini bilir. Yaşıl — bilir, sarı — təsdiqinizi gözləyir, qırıq xətt —
                hələ bilmir.
              </p>
              <p>
                Eyni kartda öyrənmənin gedişi görünür: AI həftə ərzində neçə əməkdaş cavabı və yazışma tapıb və
                neçəsini oxuyub, rəqəm üçün neçə səssiz yoxlama toplanıb, son və növbəti keçid nə vaxtdır. AI
                oxuyarkən səhifə özü yenilənir.
              </p>
              <HelpCallout kind="tip" label="Nə vaxt ötürmək">
                Rəqəm 30 müqayisədən sonra görünür, adətən 4–8 gün ərzində. Kanalı 80%-dən ötürməyi tövsiyə edirik.
              </HelpCallout>
            </>
          ),
        },
        {
          id: "differences",
          title: "«AI harada fərqli cavab verərdi»",
          body: (
            <p>
              Hazırlığın yanında — AI-ın əməkdaşdan fərqli cavab verəcəyi suallar: sual, əməkdaşın və AI-ın cavabı
              yan-yana. <HelpKey>Əməkdaşın cavabını yadda saxla</HelpKey> — cavab biliyə çevrilir;{" "}
              <HelpKey>AI-ın cavabı da uyğundur</HelpKey> — «eyni» kimi sayılır; <HelpKey>Yazışmanı aç</HelpKey> — inboksda
              həmin mesaja keçid. Hazırlıq yenidən hesablanır.
            </p>
          ),
        },
        {
          id: "bar",
          title: "Bölmələr zolağı və axtarış",
          body: (
            <p>
              Aşağı sürüşdürəndə yuxarıda nazik zolaq qalır: <HelpKey>Hazırlıq</HelpKey>, <HelpKey>Təsdiq gözləyir</HelpKey>,{" "}
              <HelpKey>Xarakter</HelpKey>, <HelpKey>Biliklər</HelpKey> — basın, ekran bölməyə keçəcək. Sağda axtarış:
              «qiymət», «ünvan», «çatdırılma» yazın — yalnız uyğun qeydlər qalacaq.
            </p>
          ),
        },
        {
          id: "prices",
          title: "Qiymətlər və endirimlər sizin «Təsdiqlə» düymənizi gözləyir",
          body: (
            <>
              <p>
                Yazışmadan öyrənilmiş istənilən qiyməti, endirimi, «pulsuz» sözünü və ya promokodu AI siz{" "}
                <HelpKey>Təsdiqlə</HelpKey> düyməsini basana qədər müştərilərə demir. O vaxta qədər qiymət sualını
                əməkdaşa ötürür.
              </p>
              <p>
                Əməkdaşlar fərqli qiymətlər deyibsə, kartda <HelpKey>Fərqli qiymətlər</HelpKey> yazılır: hazırda
                düzgün olanı seçin. Qiymət dəyişib əməkdaş yenisini deyəndə kart sizdən yenidən soruşacaq.
              </p>
            </>
          ),
        },
        {
          id: "character",
          title: "Xarakter",
          body: (
            <p>
              Əməkdaşlar necə yazır: ton, müraciət, cavabın uzunluğu, dil, emoji, tipik ifadələr, nə etmirlər. Hər
              sətri <HelpKey>Dəyiş</HelpKey> və ya <HelpKey>Çıxar</HelpKey> — sizin dəyişdiyinizi AI artıq yenidən
              yazmır. Kartların üstündə <HelpKey>AI indi necə cavab verərdi</HelpKey> sahəsi: müştəri sualını yazın və{" "}
              <HelpKey>AI-ın cavabını göstər</HelpKey> basın, cavab heç yerə getmir.
            </p>
          ),
        },
        {
          id: "knowledge",
          title: "Biliklər",
          body: (
            <>
              <p>
                AI müştərilərə nə deyir: qiymətlər, xidmətlər, ünvanlar, iş saatları, tez-tez verilən suallara
                cavablar, qaydalar. Növə və mənbəyə görə filtr: <HelpKey>AI öyrənib</HelpKey> və ya{" "}
                <HelpKey>Siz əlavə etmisiniz</HelpKey>.
              </p>
              <p>
                Hər qeyddə <HelpKey>Dəyiş</HelpKey> və <HelpKey>Sil</HelpKey> var; silinəni <HelpKey>Geri qaytar</HelpKey>{" "}
                ilə qaytarmaq olar, AI onu özü yenidən əlavə etməyəcək. <HelpKey>… ilə yazışmadan</HelpKey> keçidi
                qeydin götürüldüyü yazışmanı açır. Öz biliyinizi <HelpKey>Bilik əlavə et</HelpKey> ilə əlavə edin —
                AI ondan dərhal istifadə edir.
              </p>
            </>
          ),
        },
        {
          id: "inbox",
          title: "Öyrənmə birbaşa yazışmada",
          body: (
            <p>
              İnboksda öyrənmədə olan kanalın söhbət başlığının altında zolaq görünür —{" "}
              <HelpKey>AI burada susur və öyrənir…</HelpKey> — bu bölməyə keçidlə. Əməkdaşın cavablarının altında:{" "}
              <HelpKey>AI eyni cavab verərdi</HelpKey>, <HelpKey>AI fərqli cavab verərdi</HelpKey> (basın — AI-ın cavabı
              açılacaq) və <HelpKey>Buradan öyrənilib: …</HelpKey> — keçid biliklərdə həmin qeydi açır.
            </p>
          ),
        },
        {
          id: "handover",
          title: "Kanalı AI-a ötürmək",
          body: (
            <>
              <p>
                Hazırlığın altında <HelpKey>Kanalı AI-a ötür</HelpKey> düyməsi. İki variant:{" "}
                <HelpKey>AI qaralama yazır, əməkdaş göndərir</HelpKey> — təhlükəsiz ilk addım, və{" "}
                <HelpKey>AI özü cavab verir</HelpKey>. Cavabı bilmirsə və ya şikayət görürsə, söhbəti əməkdaşa ötürür.
              </p>
              <p><HelpKey>Öyrənməyə qaytar</HelpKey> kanalı öyrənməyə qaytarır; öyrənilənlər saxlanılır.</p>
            </>
          ),
        },
        {
          id: "cost",
          title: "Bu neçəyə başa gəlir",
          body: (
            <p>
              Hər səssiz yoxlama və hər «AI-ın cavabını göstər» ödənişli AI çağırışıdır. Öyrənmə şirkətin gündəlik AI
              limiti daxilində gedir; xərclər <HelpKey>Parametrlər → AI və xərclər</HelpKey> bölməsində «Yazışma — AI-ın
              öyrədilməsi» sətrində görünür.
            </p>
          ),
        },
      ]}
    />
  )
}
