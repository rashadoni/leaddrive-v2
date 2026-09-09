"use client"

/**
 * Web Chat Inbox — help article (Azerbaijani).
 * Video-ssenari formatına keçirilib (territories/az.tsx qızıl standartı).
 * Yalnız İnbox → Veb-çat səhifəsini əhatə edir: sessiya siyahısı + filtrlər,
 * söhbətin oxunması, AI-dan öz üzərinə götürmə (take over/release), cavab
 * göndərmə, biletə eskalasiya və söhbətin bağlanması. Çat vidjetinin
 * tənzimlənməsi (salamlama, rəng, domenlər) bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function WebChatHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dəstək agenti və ya satış nümayəndəsisiniz"
        goal="Saytdakı canlı çatdan gələn söhbəti AI köməkçidən öz üzərinizə götürüb cavablamaq, lazım olanda biletə çevirmək və bitirib bağlamaq"
      >
        Səhifəyə <HelpKey>İnbox</HelpKey> → <HelpKey>Veb-çat</HelpKey> yolu ilə çatırsınız. Bütün çat
        sessiyaları yalnız sizin təşkilatınız üçündür. Ekran iki sütundur: solda{" "}
        <strong>sessiya siyahısı</strong>, sağda isə <strong>söhbətin özü</strong>. Siyahı hər bir neçə
        saniyədən bir özü yenilənir, ona görə yeni söhbətlər səhifəni yeniləmədən peyda olur.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Sol sütunun başında söhbət ikonası, <HelpKey>Veb-çat inbox</HelpKey> adı və sağ küncdə bu
          köməyi açan düymə var. Onun altında üç status filtri durur:{" "}
          <strong>açıq</strong>, <strong>eskalasiya</strong> və <strong>bağlı</strong> (standart olaraq{" "}
          <strong>açıq</strong> seçilir). Daha aşağıda sessiya siyahısı gəlir — heç sessiya yoxdursa,
          bunun yerinə «Sessiya yoxdur» mətni göstərilir. Sağ sütun siz bir sessiya seçənə qədər boşdur
          və «Söhbəti görmək üçün bir çatı seçin» yazısını göstərir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="açıq">Hələ davam edən canlı söhbətlər — standart görünüş.</HelpDef>
          <HelpDef term="eskalasiya">Artıq dəstək biletinə çevrilmiş sessiyalar.</HelpDef>
          <HelpDef term="bağlı">Bitmiş kimi işarələdiyiniz söhbətlər (yalnız oxumaq üçün).</HelpDef>
          <HelpDef term="Sessiya">Bir ziyarətçinin çat söhbəti — adı, e-poçtu, baxdığı səhifə, statusu və bütün mesajları ilə.</HelpDef>
          <HelpDef term="Rol">Hər mesaj göndərənə görə işarələnir: ziyarətçi, bot (AI) və ya agent (siz).</HelpDef>
          <HelpDef term="AI aktiv / AI pauzada">Çatı kimin apardığını göstərən nişan — AI avtomatik cavab verir, yoxsa siz öz üzərinizə götürmüsünüz.</HelpDef>
        </dl>
        <p>
          Siyahıdakı hər sətirdə ziyarətçinin adı (yoxdursa e-poçtu, o da yoxdursa{" "}
          <em>Anonim ziyarətçi</em>), açıq olmayan sessiyalarda status nişanı, mesaj sayı və son mesajın
          vaxtı görünür. Bir sessiyaya kliklədikdə sağ tərəfdə həmin söhbət açılır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: sessiyanı tapıb söhbəti oxu">
        <HelpStep n={1}>
          <p>
            Sol sütunun yuxarısındakı filtrlərdən birini seçin —{" "}
            <HelpKey>açıq</HelpKey>, <HelpKey>eskalasiya</HelpKey> və ya <HelpKey>bağlı</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş filtr rəngli (dolğun) görünür, siyahı isə yalnız o statusdakı sessiyaları göstərir.
            Heç sessiya yoxdursa «Sessiya yoxdur» mətni çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Siyahıdan bir sessiya sətrinə klikləyin.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş sətir vurğulanır, sağ sütunda söhbət açılır. Başlıqda ziyarətçinin adı (yoxdursa{" "}
            <em>Anonim ziyarətçi</em>) və e-poçtu görünür. Ziyarətçi CRM qeydi ilə uyğunlaşdırılıbsa,{" "}
            <HelpKey>↗ bağlı əlaqə</HelpKey> nişanı çıxır (kliklədikdə əlaqəni yeni tabda açır); baxdığı
            səhifə ünvanı isə adın altında qlobus ikonası ilə göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Mesaj lentinə baxın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mesajlar göndərənə görə yerləşir: <strong>ziyarətçi</strong> baloncuqları solda,{" "}
            <strong>agent</strong> və <strong>bot</strong> cavabları sağda — hər baloncuğun üstündə
            kiçik hərflərlə rolu yazılır. Ziyarətçinin göndərdiyi şəkillər önizləmə kimi, digər fayllar
            isə 📎 yükləmə linki kimi açılır. Ziyarətçi cavab yazarkən aşağıda «ziyarətçi yazır…»
            göstəricisi peyda olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: AI-dan öz üzərinə götür və cavab ver">
        <HelpStep n={1}>
          <p>
            Söhbət başlığında <HelpKey>Özünə götür</HelpKey> düyməsini basın (yanında robot ikonası
            olur). İstəsəniz başlıqdakı icraçı açılan siyahısından özünüzü də seçə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Çat sizə təyin olunur, düymə əl ikonalı <HelpKey>Burax</HelpKey> halına keçir və AI nişanı
            yaşıl <strong>AI aktiv</strong>-dən sarı <strong>AI pauzada</strong> halına dəyişir — yəni
            AI artıq avtomatik cavab vermir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Aşağıdakı cavab xanasına mətni yazın və <HelpKey>Enter</HelpKey> (və ya{" "}
            <HelpKey>Göndər</HelpKey> düyməsi) ilə göndərin. Yeni sətir üçün <HelpKey>Shift+Enter</HelpKey>{" "}
            işlədin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mesajınız söhbətdə sağda <strong>agent</strong> baloncuğu kimi peyda olur, xana boşalır və
            siyahıdakı sessiyanın son-mesaj vaxtı yenilənir. Boş mesaj göndərmək olmur —{" "}
            <HelpKey>Göndər</HelpKey> düyməsi xana boş olanda qeyri-aktivdir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bitirdikdə çatı geri vermək üçün <HelpKey>Burax</HelpKey> basın. İstəsəniz icraçı açılan
            siyahısından başqa həmkarınızı seçə və ya <HelpKey>Təyin olunmayıb</HelpKey> halına qaytara
            bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yenidən <HelpKey>Özünə götür</HelpKey> halına qayıdır və nişan{" "}
            <strong>AI aktiv</strong> olur — AI çatı yenidən aparmağa başlayır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Çatı götürməsəniz belə cavab göndərmək onu öz üzərinizə alır və AI-nı pauzaya keçirir —
            beləcə siz və AI eyni anda cavab yazmırsınız. Yenidən AI cavab versin istəyirsinizsə,{" "}
            <HelpKey>Burax</HelpKey> basın.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: biletə eskalasiya et">
        <HelpStep n={1}>
          <p>
            Söhbət başlığındakı <HelpKey>Biletə eskalasiya</HelpKey> düyməsini basın (yuxarı-sağa ox
            ikonası ilə).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Söhbətdən dəstək bileti yaradılır: mövzu ziyarətçinin ilk mesajı, məzmunu isə bütün
            yazışma transkripti, ad, e-poçt, telefon və səhifə ünvanı olur. Çata həmçinin biletin
            yaradıldığını bildirən bir bot mesajı əlavə olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Eskalasiyadan sonra başlığa baxın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sessiya statusu <strong>eskalasiya</strong> olur (siyahıda da nişanla görünür) və düymə{" "}
            <HelpKey>Bileti aç</HelpKey> halına dəyişir — basdıqda bileti yeni tabda açır. Ziyarətçi
            avtomatik CRM əlaqəsinə bağlanır (mövcud bağlantı, sonra e-poçt/telefon uyğunluğu, heç biri
            olmasa yeni əlaqə yaradılır).
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Eskalasiya <strong>birdəfəlikdir</strong>. Artıq bileti olan sessiya ikincisini yaratmır —
            düymə artıq <HelpKey>Bileti aç</HelpKey>-a çevrildiyi üçün sizi sadəcə mövcud biletə yönəldir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: söhbəti bağla">
        <HelpStep n={1}>
          <p>
            Söhbət bitdikdə başlıqdakı <HelpKey>Bağla</HelpKey> düyməsini basın (təsdiq işarəsi ikonası
            ilə).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sessiya <strong>bağlı</strong> statusuna keçir və <HelpKey>bağlı</HelpKey> filtrində
            sadalanır. Cavab xanası və <HelpKey>Göndər</HelpKey> düyməsi qeyri-aktivləşir — yəni
            tarixçəyə baxa bilərsiniz, amma yeni mesaj yaza bilməzsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpDef term="Status axını">açıq → eskalasiya (bilet yaradıldı) → bağlı</HelpDef>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Həqiqətən yeni mesaj gələndə yumşaq səs siqnalı eşidir və ekranda <HelpKey>Aç</HelpKey>{" "}
          düyməsi olan bir bildiriş görürsünüz. Tab arxa fonda və ya fokussuzdursa, brauzerin sistem
          bildirişi də gəlir (brauzer icazəni tətbiqdə ilk kliklədikdə bir dəfə soruşur).
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Buradakı hər şey təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın çat sessiyalarını
          görür və orada cavablayırsınız. Agent cavabları sizin istifadəçinizlə imzalanır, ona görə hər
          mesajın məsul müəllifi olur. İcraçı açılan siyahısı təşkilatınızın istifadəçilərindən gəlir;
          çat vidjetinin özü (salamlama, rəng, icazəli domenlər) isə ayrıca <em>Parametrlər → Veb-çat</em>{" "}
          bölməsində tənzimlənir.
        </p>
      </HelpCallout>
    </div>
  )
}
