"use client"

/**
 * Chatbot auto-reply — help article (Azerbaijani).
 * /inbox/chatbot-rules səhifəsinin ilk yardım məqaləsidir: təşkilat üzrə əsas
 * açar (chatbotAutoReply flag), cümlə-üslublu qayda yaradıcı (nə vaxt → nə cavab
 * → hansı kanal → prioritet), qaydaların siyahısı və status idarəetməsi.
 * Yalnız REAL UI: «chatbotRules» mesaj namespace-i + chatbot-engine sabitləri.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ChatbotRulesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Müştəri dəstəyi və ya marketinq məsulusunuz"
        goal="Müştərilərin sosial kanallarda göndərdiyi mesajlara proqramlaşdırma olmadan avtomatik cavab qurmaq"
      >
        Səhifə <HelpKey>Çatbot avtomatik cavab</HelpKey> adlanır. Bot hər gələn mesajı oxuyur və əgər o,
        qaydalarınızdan birinə uyğun gəlirsə, sizin yerinizə dərhal cavab verir. İki şey lazımdır:
        təşkilat üçün əsas açarı <strong>aktiv</strong> etmək və ən azı bir <strong>Aktiv</strong> qayda
        yaratmaq. Bütün qaydalar yalnız sizin təşkilatınız üçündür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda robot ikonası ilə <HelpKey>Çatbot avtomatik cavab</HelpKey> adı, altında qısa izah,
          sağ yuxarıda isə <HelpKey>Tur</HelpKey> (təlimat) düyməsi var. Altında dörd blok ardıcıl gəlir:
          açılan <strong>«Necə işləyir»</strong> bələdçisi, təşkilat üzrə <strong>əsas açar</strong>,
          <strong>«Yeni qayda»</strong> formu və ən aşağıda yaratdığınız <strong>qaydaların siyahısı</strong>.
          Form ilə siyahı arasında sarı <strong>«Bilirsinizmi?»</strong> məsləhət lövhəsi durur.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Əsas açar">Bütün təşkilat üçün avtomatik cavabı işə salan/söndürən düymə. Söndürülübsə, «Aktiv» qaydalar belə cavab vermir.</HelpDef>
          <HelpDef term="Qayda">Bir şərt + bir cavab: «mesaj filana uyğun gələndə bot bunu desin». Hər qaydanın adı, statusu, tetikleyicisi və cavab mətni var.</HelpDef>
          <HelpDef term="Tetikleyici (nə vaxt)">Qaydanın işə düşmə şərti: sözləri ehtiva edir / tam bərabərdir / ilə başlayır / istənilən mesaj.</HelpDef>
          <HelpDef term="Status">Qaydanın vəziyyəti: Aktiv, Qaralama və ya Fasilə. Yalnız <strong>Aktiv</strong> qaydalar cavab verir.</HelpDef>
          <HelpDef term="Kanallar">Qaydanın işlədiyi sosial kanallar: Telegram, WhatsApp, Facebook, Instagram, VKontakte. Boş = bütün kanallar.</HelpDef>
          <HelpDef term="Prioritet">Bir neçə qayda eyni mesaja uyğun gələndə əvvəl hansının cavab verdiyini həll edir — böyük rəqəm öndədir.</HelpDef>
        </dl>
        <p>
          Hər qayda sətrində ad, yanında rəngli status nişanı (Aktiv yaşıl, Qaralama narıncı, Fasilə boz),
          prioritet 0-dan fərqlidirsə onun göstəricisi, bir sətirdə tetikleyici → cavabın başlanğıcı, altda
          isə kanallar və <HelpKey>{"{say}× cavab verdi"}</HelpKey> sayğacı var. Sağda status açılan siyahısı
          və qırmızı zibil qutusu (sil) ikonu durur. Hələ qayda yoxdursa «Hələ qayda yoxdur — yuxarıda yaradın.»
          mətni göstərilir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: avtomatik cavabı aktivləşdir">
        <HelpStep n={1}>
          <p>
            Səhifənin ortasındakı əsas açar kartına baxın. Söndürülübsə başlıq{" "}
            <HelpKey>Bu təşkilat üçün avtomatik cavab SÖNDÜRÜLÜB</HelpKey> yazır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Boz güc (power) ikonu, «Bunu aktivləşdirməyincə heç nə cavab verməyəcək — «Aktiv» qaydalar belə.»
            izahı və sağda <HelpKey>Aktivləşdir</HelpKey> düyməsi.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Aktivləşdir</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart yaşıl fona keçir, ikon yaşıllaşır, başlıq{" "}
            <HelpKey>Bu təşkilat üçün avtomatik cavab AKTİVDİR</HelpKey> olur və düymə{" "}
            <HelpKey>Söndür</HelpKey> halına gəlir. İndi «Aktiv» qaydalar uyğun mesajlara cavab verəcək.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni qayda yarat">
        <HelpStep n={1}>
          <p>
            <HelpKey>Yeni qayda</HelpKey> bölməsində <HelpKey>Qaydanın adı (özünüz üçün)</HelpKey> sahəsinə
            ad yazın — məsələn «Qiymət sualı». Bu ad yalnız sizin üçündür, müştəri görmür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahədə «məs. Qiymət sualı» nümunə mətni var; yazdıqca mətn görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Bot nə vaxt cavab versin?</HelpKey> sətrində açılan siyahıdan tetikleyici seçin:{" "}
            <HelpKey>sözləri ehtiva edir</HelpKey>, <HelpKey>tam bərabərdir</HelpKey>,{" "}
            <HelpKey>ilə başlayır</HelpKey> və ya <HelpKey>istənilən mesaj</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahının solunda «Mesaj» sözü durur. «istənilən mesaj»dan başqa bütün variantlarda
            yanında mətn sahəsi peyda olur. «sözləri ehtiva edir» seçiləndə altda «Sözləri vergüllə ayırın
            — mesajda onlardan hər hansı biri olarsa bot cavab verir.» ipucusu çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Tetikleyici dəyər tələb edirsə, mətn sahəsini doldurun: «sözləri ehtiva edir» üçün
            vergüllə ayrılmış açar sözlər (məs. <HelpKey>qiymət, neçəyə, dəyər</HelpKey>), digərləri üçün
            isə dəqiq mətn. <HelpKey>istənilən mesaj</HelpKey> seçsəniz, dəyər lazım deyil — bot hər mesaja
            cavab verir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «sözləri ehtiva edir» üçün sahədə «qiymət, neçəyə, dəyər» nümunəsi, digər tetikleyicilər üçün
            «dəqiq mətn» nümunəsi görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <HelpKey>Bot nə cavab versin?</HelpKey> mətn qutusuna botun göndərəcəyi cavabı yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Botun göndərəcəyi cavabı yazın…» nümunəli, çoxsətrli mətn sahəsi; yazdığınız mətn buraya düşür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            <HelpKey>Hansı kanallarda?</HelpKey> sətrində istədiyiniz kanal nişanlarını basaraq seçin:{" "}
            <HelpKey>Telegram</HelpKey>, <HelpKey>WhatsApp</HelpKey>, <HelpKey>Facebook</HelpKey>,{" "}
            <HelpKey>Instagram</HelpKey>, <HelpKey>VKontakte</HelpKey>. Heç birini seçməsəniz qayda bütün
            kanallarda işləyir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş kanal nişanı dolu rəngə keçir. Heç biri seçilməyibsə yanında «Boş = bütün kanallar»
            yazısı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            İstəyə bağlı olaraq aşağıda <HelpKey>Prioritet</HelpKey> rəqəmini təyin edin (standart 0). Sonra
            <HelpKey>Qayda yarat</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ad, cavab və (lazımdırsa) tetikleyici dəyər doldurulana qədər <HelpKey>Qayda yarat</HelpKey>
            düyməsi sönük qalır. Basıldıqdan sonra form təmizlənir və yeni qayda aşağıdakı{" "}
            <HelpKey>Qaydalar</HelpKey> siyahısının başında peyda olur; başlıqdakı qaydaların sayı bir artır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: qaydanı idarə et və ya sil">
        <HelpStep n={1}>
          <p>
            Qaydanın statusunu dəyişmək üçün onun sağındakı açılan siyahıdan{" "}
            <HelpKey>Aktiv</HelpKey>, <HelpKey>Qaralama</HelpKey> və ya <HelpKey>Fasilə</HelpKey> seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sətrdəki rəngli status nişanı dərhal yenilənir. Yalnız <strong>Aktiv</strong> qaydalar cavab
            verir; <strong>Qaralama</strong> və <strong>Fasilə</strong> isə cavab vermir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Qaydanı tamamilə silmək üçün sətrin sağındakı qırmızı zibil qutusu ikonunu (<HelpKey>Sil</HelpKey>)
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qayda siyahıdan dərhal yox olur və başlıqdakı say bir azalır. Bütün qaydaları silsəniz, yenidən
            «Hələ qayda yoxdur — yuxarıda yaradın.» mətni göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Açılan <HelpKey>Necə işləyir</HelpKey> bələdçisini basaraq dörd addımlıq xülasəni və bir canlı
          nümunəni görə bilərsiniz. Sarı <HelpKey>Bilirsinizmi?</HelpKey> lövhəsində <HelpKey>Növbəti məsləhət</HelpKey>
          ilə faydalı incəlikləri gəzə bilərsiniz — məsələn, bot eyni söhbətə 5 dəqiqə ərzində iki dəfə cavab
          verməz ki, spam olmasın.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Əsas açar SÖNDÜRÜLÜB, amma <strong>Aktiv</strong> qaydalarınız varsa, səhifənin altında sarı
          xəbərdarlıq çıxır: «Aktiv qaydalarınız var, lakin avtomatik cavab SÖNDÜRÜLÜB…». Bu halda qaydalar
          heç bir mesaja cavab vermir — onları işə salmaq üçün yuxarıdakı əsas açarı aktivləşdirin. Həmçinin
          heç bir qayda uyğun gəlməsə, mesaj komandanızın cavablandırması üçün qalır — avtomatik cavab canlı
          söhbətə əngəl olmur.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün qaydalar və əsas açar yalnız sizin təşkilatınızla məhdudlaşır — başqa təşkilatın qaydalarını
          görmürsünüz və dəyişə bilmirsiniz. Əsas açar bütün təşkilat üçün ümumidir, ona görə onu söndürmək
          komandanızın bütün avtomatik cavablarını dayandırır.
        </p>
      </HelpCallout>
    </div>
  )
}
