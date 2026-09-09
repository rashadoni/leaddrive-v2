"use client"

/**
 * Inbox AI agent — help article (Azerbaijani).
 * Yalnız Tənzimləmələr → Kommunikasiya qrupunun AI agent bölməsini
 * (AI agent: Omni-channel) əhatə edir: dörd kart — persona redaktoru
 * + əsas açar, kanallar üzrə "AI vs agent" matrisi, 24-saatlıq
 * avto-xatırlatma və operatora eskalasiya açar sözləri.
 * İnboksun özü (söhbət siyahısı) bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InboxaiagentHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="İnboksa cavabdeh administrator və ya kommunikasiya komandasının rəhbərisiniz"
        goal="Gələn sosial mesajlara AI-ın hansı xarakterlə, hansı kanallarda cavab verdiyini tənzimləmək, susan müştərini geri qaytarmaq və lazım gələndə söhbəti operatora ötürmək"
      >
        Səhifə <HelpKey>AI agent: Omni-channel</HelpKey> adlanır və yalnız İnboks (kommunikasiya)
        modulunun AI parametrlərinə aiddir — biletlərə və ya satışa keçmir, çünki hər modul qrupunun
        öz ayrıca agenti var. Burada gördüyünüz hər şey yalnız sizin təşkilatınıza tətbiq olunur.
        Səhifə dörd müstəqil kartdan ibarətdir; hər kart öz parametrini ayrıca yadda saxlayır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda bənövşəyi qığılcım ikonası ilə <HelpKey>AI agent: Omni-channel</HelpKey> adı, altında
          isə qısa izah durur. Aşağıda yuxarıdan-aşağıya dörd kart var:{" "}
          <strong>AI agentin personası</strong>, <strong>Kanallar üzrə AI cavablar</strong>,{" "}
          <strong>Avto-xatırlatma (24 saat sükut)</strong> və <strong>Operatora eskalasiya</strong>.
          AI-ın bir kanalda real cavab verməsi üçün üç şərt birlikdə lazımdır: persona kartındakı əsas
          açar açıq olsun, matrisdə həmin kanal <HelpKey>AI</HelpKey> rejiminə qoyulsun və (istəyə bağlı)
          xarakter yazılsın.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="AI agentin personası">
            AI-ın xarakteri (sistem promptu), modeli, temperaturu, salamlaması və insana ötürmə davranışı.
            Yuxarısında AI-ın ümumiyyətlə cavab verib-verməyəcəyini idarə edən əsas açar var.
          </HelpDef>
          <HelpDef term="AI avtomatik cavab verir">
            Əsas açar. Bağlı olsa, matrisdə hər hansı kanal «AI» seçilsə belə AI cavab vermir.
          </HelpDef>
          <HelpDef term="Kanallar üzrə AI cavablar">
            Hər kanal üçün kimin cavab verdiyini seçən matris: <HelpKey>Agent</HelpKey> (insan) yoxsa{" "}
            <HelpKey>AI</HelpKey>. Yalnız dəstəklənən kanallar dəyişdirilə bilir; qalanları «tezliklə»
            nişanı ilə qeyri-aktiv görünür.
          </HelpDef>
          <HelpDef term="Avto-xatırlatma (24 saat sükut)">
            Müştəri sizin cavabınızdan sonra 24 saat susarsa, sistem onu dialoqa qaytarmaq üçün bir dəfə
            mülayim xatırlatma göndərir (yalnız 09:00–21:00 Bakı vaxtı, dialoqa bir dəfə).
          </HelpDef>
          <HelpDef term="Operatora eskalasiya">
            Açar sözlər siyahısı. Gələn mesajda bu sözlərdən biri olarsa, AI cavab vermir — dialoq
            operatora ötürülür və komanda bildiriş alır.
          </HelpDef>
        </dl>
        <p>
          Kartların hər birinin sağ alt küncündə öz yadda-saxlama düyməsi var; uğurla saxlananda qısa{" "}
          <strong>Yadda saxlanıldı</strong> / <strong>Saxlanıldı</strong> təsdiqi yanır. TikTok kanalı
          qoşulmayıbsa, avto-xatırlatma və eskalasiya kartları «Hələ TikTok kanalı qoşulmayıb» kimi
          xəbərdarlıq göstərir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: AI-ı aç və xarakterini yaz">
        <HelpStep n={1}>
          <p>
            Birinci kartda — <strong>AI agentin personası</strong> — yuxarıdakı{" "}
            <HelpKey>AI avtomatik cavab verir</HelpKey> açarını açın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açarın altındakı «Əsas açar. AI aşağıdakı matrisdə «AI» seçilmiş kanallarda cavab verir»
            ipucusu durur. Açar dərhal vəziyyətini dəyişir; saxlamaq üçün ayrıca düymə lazım deyil.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Sistem promptu (xarakter və qaydalar)</HelpKey> sahəsində AI-ın necə danışacağını
            yazın — məsələn dili, tonu və qaydaları. Boş buraxsanız, standart prompt işləyir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Çoxsətirli mətn sahəsində nümunə ipucu görünür: «Sən AAC ayaqqabı mağazasının nəzakətli
            köməkçisisən. Azərbaycanca qısa cavab ver…».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Model</HelpKey> açılan siyahısından modeli seçin və yanındakı{" "}
            <HelpKey>Temperatur (yaradıcılıq)</HelpKey> sürgüsü ilə yaradıcılığı tənzimləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Modellər üç variantdır: «Haiku — sürətli və ucuz», «Sonnet — balans» və «Opus — ən ağıllı».
            Temperatur etiketinin yanında cari qiymət (0.0–1.0) göstərilir və sürgünü çəkdikcə dərhal
            yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            İstəyə bağlı olaraq <HelpKey>Salamlama (ilk mesaj)</HelpKey> sahəsinə ilk avtomatik mesajı
            yazın və <HelpKey>İnsana ötür</HelpKey> açarının vəziyyətini seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Salamlama sahəsində «Salam! AAC-yə xoş gəldiniz.» nümunəsi var. «İnsana ötür» açarının altında
            «Şikayət / insan istəyi / qaytarma zamanı AI operatoru çağırır» izahı durur (standart olaraq
            açıqdır).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Kartın altındakı <HelpKey>Personanı yadda saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə saxlanarkən fırlanan ikona göstərir, sonra yanında yaşıl <strong>Yadda saxlanıldı</strong>{" "}
            təsdiqi (işarə ilə) bir neçə saniyə görünür. Xəta olarsa, düymənin üstündə qırmızı «Dəyişikliklər
            yadda saxlanmadı» mesajı çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: kanal üzrə cavab verən tərəfi seç">
        <HelpStep n={1}>
          <p>
            İkinci kartda — <strong>Kanallar üzrə AI cavablar</strong> — dəyişmək istədiyiniz kanalın
            sətrini tapın (məs. TikTok). Hər sətirdə kanal adı, altında konfiqurasiya adı və sağda açılan
            siyahı var.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Dəstəklənməyən kanalların yanında boz <HelpKey>tezliklə</HelpKey> nişanı durur və onların açılan
            siyahısı qeyri-aktiv (basılmayan) olur. Heç bir kanal qurulmayıbsa, «Konfiqurasiya edilmiş kanal
            yoxdur» mətni göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sağdakı açılan siyahıdan <HelpKey>Agent</HelpKey> (insan cavab verir) və ya <HelpKey>AI</HelpKey>
            {" "}(AI cavab verir) seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçim dərhal yadda saxlanır — ayrıca düymə yoxdur. <HelpKey>AI</HelpKey> seçildikdə açılan
            siyahının mətni bənövşəyi rəngə keçir. Saxlama anında siyahı bir anlıq qeyri-aktiv olur; xəta
            olarsa, seçim əvvəlki dəyərinə qayıdır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Kartın altındakı kiçik bot ikonalı qeyd xatırladır: «AI rejimi təşkilatda AI-assistentin aktiv
            olmasını tələb edir (əks halda gələn mesajlar agenti gözləyir)». Yəni kanalı{" "}
            <HelpKey>AI</HelpKey>-ya qoymaqdan əvvəl birinci kartdakı <HelpKey>AI avtomatik cavab verir</HelpKey>
            {" "}əsas açarı açıq olmalıdır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: 24 saatlıq avto-xatırlatmanı qur">
        <HelpStep n={1}>
          <p>
            Üçüncü kartda — <strong>Avto-xatırlatma (24 saat sükut)</strong> — yuxarıdakı{" "}
            <HelpKey>Avto-xatırlatmanı aktiv et</HelpKey> açarını açın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açarın altında dəyişməz qaydalar göstərilir: «Hər dialoqa bir xatırlatma · 24 saat sükutdan sonra
            · yalnız 09:00–21:00 (Bakı)». Açar bağlı qalarkən aşağıdakı mətn sahəsi və düymə qeyri-aktivdir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Xatırlatma mətni</HelpKey> sahəsinə göndəriləcək mesajı yazın (boş buraxsanız standart
            mətn istifadə olunur), sonra <HelpKey>Yadda saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mətn sahəsində «Salam! 👋 Sualınız hələ də aktualdırsa…» nümunəsi var və altında «Boş buraxsanız,
            defolt mətn istifadə olunacaq» qeydi durur. Saxlanandan sonra düymə qısa müddət{" "}
            <strong>Saxlanıldı</strong> təsdiqinə keçir. TikTok kanalı yoxdursa, «Hələ TikTok kanalı
            qoşulmayıb — xatırladılacaq kimsə yoxdur» xəbərdarlığı göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: operatora eskalasiya açar sözlərini təyin et">
        <HelpStep n={1}>
          <p>
            Dördüncü kartda — <strong>Operatora eskalasiya</strong> — <HelpKey>Açar sözlər (vergüllə
            ayrılmış)</HelpKey> sahəsinə AI-ın cavab verməməli olduğu sözləri vergüllə ayıraraq yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahədə nümunə ipucu var: «şikayət, menecer, operator, complaint». Altında «AI belə mesajları
            ötürür — operator cavab verir» izahı durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Yadda saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxlama zamanı sözlər avtomatik təmizlənir — təkrarlananlar silinir və artıq boşluqlar atılır,
            sonra düymə qısa <strong>Saxlanıldı</strong> təsdiqinə keçir. TikTok kanalı qoşulmayıbsa,
            sarı «Hələ TikTok kanalı qoşulmayıb» xəbərdarlığı göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Dörd kart bir-birini tamamlayır: persona <em>necə</em> cavab verildiyini, matris <em>harada</em>{" "}
          (hansı kanalda) cavab verildiyini, avto-xatırlatma susan müştərini geri qaytarmağı, eskalasiya isə
          AI-ın <em>nə vaxt</em> susub işi insana verməsini idarə edir. Hər kartı ayrıca yadda saxlayın —
          birində dəyişiklik digərini avtomatik saxlamır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün bu parametrlər təşkilatınızla məhdudlaşır — persona, kanal rejimləri, xatırlatma mətni və
          eskalasiya sözləri yalnız sizin tenant-ınıza tətbiq olunur və başqa təşkilatın inboksuna təsir
          etmir. Eskalasiya açar sözləri və avto-xatırlatma hazırda TikTok kanalına bağlıdır; kanal
          qoşulmayanadək onlar saxlanılsa da real fəaliyyət göstərmir.
        </p>
      </HelpCallout>
    </div>
  )
}
