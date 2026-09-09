"use client"

/**
 * Social Monitoring — help article (Azerbaijani).
 * Video-script format. Yalnız Sosial Monitorinq səhifəsini əhatə edir:
 * hesab əlavə etmə/qoşma, sorğu (poll), qeydlər lentinin idarəsi (ton,
 * status, cavab), qeydi bilet/lid/tapşırığa çevirmə və FB/IG inbox qoşma.
 * Səhifə komponenti: src/app/(dashboard)/social-monitoring/page.tsx
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SocialMonitoringHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="SMM mütəxəssisi, dəstək və ya satış komandasısınız"
        goal="Sosial şəbəkələrdə brendinizin qeydlərini bir lentdə toplamaq, tonunu qiymətləndirmək, cavab vermək və lazım olanı biletə, lidə və ya tapşırığa çevirmək"
      >
        Səhifə sol menyudakı <HelpKey>Sosial Monitorinq</HelpKey> bölməsindən açılır. Bütün hesablar,
        qeydlər və statistika yalnız sizin təşkilatınıza aiddir. Lent canlıdır — siz hesab qoşduqca,
        sorğu etdikcə və ya bir qeydi emal etdikcə yuxarıdakı statistika kartları və lent dərhal
        yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda narıncı radio ikonası ilə <HelpKey>Sosial Monitorinq</HelpKey> adı və altında
          «Sosial şəbəkələrdə brend qeydlərini izləyin» izahı var. Sağ yuxarıda bir neçə düymə durur:{" "}
          <HelpKey>AI</HelpKey> (AI avtomatlaşdırma tənzimləmələrinə keçid), <HelpKey>Hamısını yenilə</HelpKey>{" "}
          (bütün hesabları bir dəfəyə sorğu edir), <HelpKey>Twitter-i qoş</HelpKey> və{" "}
          <HelpKey>Hesab əlavə et</HelpKey>. Bağlı Facebook/Instagram hesabı varsa, əlavə olaraq{" "}
          <HelpKey>Inbox-a əlavə et</HelpKey> və <HelpKey>Söhbətləri idxal et</HelpKey> düymələri də görünür.
        </p>
        <p>
          Aşağıda sırayla: (lazım olduqda) Facebook/Instagram birbaşa mesaj problemini bildirən sarı{" "}
          <strong>yenidən qoş</strong> banneri, onboarding addımları siyahısı, «Bilirsinizmi?» ipucu kartı,
          AI avtomatlaşdırmaya keçid kartı, beş statistika kartı, analitika paneli,{" "}
          <strong>İzlənən hesablar</strong> bloku, filtrlər sətri və ən altda qeydlər lenti gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Hesab (handle)">İzlədiyiniz platforma profili və ya səhifə — platforma nişanı, adı və açar sözləri ilə.</HelpDef>
          <HelpDef term="Qeyd (mention)">Brendinizin və ya açar sözünüzün keçdiyi post/şərh — müəllif, mətn, ton, əhatə və cəlb göstəriciləri ilə lentdə bir kart kimi görünür.</HelpDef>
          <HelpDef term="Ton (sentiment)">Qeydin müsbət, neytral və ya mənfi qiymətləndirilməsi — baş barmaq yuxarı/aşağı və ya tire ikonası ilə göstərilir.</HelpDef>
          <HelpDef term="Status">Qeydin emal vəziyyəti: Yeni, Baxıldı, Cavab verildi, Nəzərə alınmadı və ya çevrilmiş (Bilet/Lid/Tapşırıq).</HelpDef>
          <HelpDef term="Açar sözlər (keywords)">Hesaba bağlı vergüllə ayrılmış sözlər; şərh və ya tag olunmuş post bunlardan birini ehtiva edirsə, qeyd onlarla işarələnir.</HelpDef>
          <HelpDef term="Sorğu (poll)">Platformadan yeni şərh və qeydləri çəkib lentə yükləyən əməliyyat.</HelpDef>
          <HelpDef term="Əhatə / Cəlb">Qeydin neçə nəfərə çatdığı (əhatə) və neçə reaksiya/şərh aldığı (cəlb) göstəriciləri.</HelpDef>
        </dl>
        <p>
          Beş statistika kartı bunlardır: <strong>Ümumi qeydlər</strong>, <strong>Yeni</strong>,{" "}
          <strong>Müsbət</strong>, <strong>Mənfi</strong> və <strong>Yaradılan biletlər</strong>. Filtrlər
          sətrində üç açılan siyahı var — platforma, ton və status üzrə süzgəc.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: izləmək üçün hesab əlavə et">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Hesab əlavə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Hesab əlavə et» başlıqlı pəncərə açılır. İçində <strong>Platforma</strong> açılan siyahısı
            var (X, Instagram, Facebook, Telegram, VK, YouTube, TikTok).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Platformanı seçin. <strong>X</strong>, <strong>Telegram</strong> və{" "}
            <strong>VK</strong> kimi açıq axtarış platformaları üçün <HelpKey>Hesab / səhifə *</HelpKey>{" "}
            sahəsinə @brend və ya səhifə adını yazın, istəsəniz <HelpKey>Əlavə açar sözlər (vergüllə)</HelpKey>{" "}
            sahəsini doldurun, sonra <HelpKey>Əlavə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hesab adını yazana qədər <HelpKey>Əlavə et</HelpKey> düyməsi qeyri-aktiv qalır. Əlavə
            etdikdən sonra pəncərə bağlanır və hesab aşağıdakı <strong>İzlənən hesablar</strong> blokunda
            platforma nişanı ilə peyda olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Facebook</strong>, <strong>Instagram</strong>, <strong>TikTok</strong> və{" "}
            <strong>YouTube</strong> seçsəniz, hesab adı sahəsi yerinə sarı izah qutusu və qoşulma düyməsi
            çıxır (məsələn <HelpKey>Facebook Səhifəni qoş</HelpKey>) — çünki bu platformalarda yalnız öz
            hesablarınızı, OAuth ilə daxil olaraq izləyə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bu platformalar üçün adi <HelpKey>Əlavə et</HelpKey> düyməsi göstərilmir; yalnız sarı qeyd və
            qoşulma düyməsi olur. Düyməni bassanız müvafiq platformanın giriş səhifəsinə yönləndirilirsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: hesabı sorğula və açar sözlərini düzəlt">
        <HelpStep n={1}>
          <p>
            <strong>İzlənən hesablar</strong> blokunda hər hesab kiçik bir nişan kimi görünür: platforma
            etiketi, adı, açar söz düyməsi və silmə (✕) düyməsi. X/Facebook/Instagram kimi qoşulmuş
            hesablarda əlavə olaraq <HelpKey>İndi sorğu et</HelpKey> (↻) ikonası da olur.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Heç hesab yoxdursa, blokda «Hələ hesab yoxdur. Başlamaq üçün əlavə edin.» mətni durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bir hesabın yeni qeydlərini çəkmək üçün onun ↻ <HelpKey>İndi sorğu et</HelpKey> ikonasını
            basın. Bütün hesabları birdən sorğulamaq üçünsə yuxarıdakı <HelpKey>Hamısını yenilə</HelpKey>{" "}
            düyməsindən istifadə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sorğu gedərkən düymədəki ikona fırlanır və mətn «Sorğu…»-ya keçir. Bitdikdə neçə qeyd
            yükləndiyini bildirən bir bildiriş (alert) çıxır, sonra lent və statistika kartları yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Hesabın açar sözlərini dəyişmək üçün nişandakı açar söz düyməsini basın (açar söz yoxdursa{" "}
            <HelpKey>+ açar</HelpKey>, varsa <HelpKey>+ N açar</HelpKey> kimi görünür).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Açar sözləri redaktə et» pəncərəsi açılır; vergüllə ayrılmış açar sözləri daxil edib{" "}
            <HelpKey>Yadda saxla</HelpKey> basın. Altda izah var: bu sözlərdən biri şərh və ya tag olunmuş
            postda keçdikdə qeyd «matchedTerm» kimi işarələnir və analitikada görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Hesabı izləmədən silmək üçün nişanın sonundakı ✕ düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Bu hesabı izlənmədən silmək?» təsdiq sorğusu çıxır. Təsdiqlədikdən sonra hesab blokdan çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: qeydi emal et (ton, status, cavab)">
        <HelpStep n={1}>
          <p>
            Lentdə hər qeyd bir kart kimi görünür: müəllif adı/handle-ı, platforma nişanı, ton ikonası,
            (yeni deyilsə) status nişanı, mətn, əhatə/cəlb göstəriciləri, dərc tarixi və varsa{" "}
            <HelpKey>Aç</HelpKey> linki.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Heç qeyd yoxdursa, «Hələ qeyd yoxdur» başlıqlı boş vəziyyət göstərilir. Filtrlər sətrindəki üç
            açılan siyahı (platforma, ton, status) ilə lenti süzgəcdən keçirə bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Kartın altındakı əməliyyat sətrində <HelpKey>Baxıldı</HelpKey> və <HelpKey>İgnor</HelpKey>{" "}
            düymələri ilə statusu dəyişin. Sağ tərəfdə üç ton düyməsi (baş barmaq yuxarı, tire, baş barmaq
            aşağı) ilə qeydi müsbət / neytral / mənfi kimi işarələyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Status dəyişdikdə kartda uyğun nişan görünür (məs. «Baxıldı»). Seçilmiş ton düyməsi rənglənir
            (müsbət — yaşıl, mənfi — qırmızı), <strong>Müsbət</strong>/<strong>Mənfi</strong> statistika
            kartları isə uyğun olaraq dəyişir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            X, Facebook və Instagram qeydlərində <HelpKey>Cavab ver</HelpKey> düyməsi olur — basın,
            açılan mətn sahəsinə cavabınızı yazıb <HelpKey>Göndər</HelpKey> düyməsini basın. Digər
            platformalarda bunun yerinə qeydi əl ilə «Cavab verildi» kimi işarələyən düymə olur.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kartın altında cavab mətn qutusu açılır. Mətn boş olduqda <HelpKey>Göndər</HelpKey> qeyri-aktiv
            qalır; göndərilərkən «Göndərilir…»-ə keçir. Uğurlu olduqda qutu bağlanır və lent yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: qeydi biletə, lidə və ya tapşırığa çevir">
        <HelpStep n={1}>
          <p>
            Qeyd bir dəstək problemidirsə, əməliyyat sətrindəki <HelpKey>→ Bilet</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bilet yaradıldıqda nömrəsini bildirən bildiriş çıxır və düymə yaşıl <HelpKey>Bilet ↗</HelpKey>{" "}
            keçidinə çevrilir; basanda bilet yeni tabda açılır. <strong>Yaradılan biletlər</strong>{" "}
            statistika kartındakı say bir vahid artır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Qeyd potensial müştəridirsə, <HelpKey>→ Lid</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Redaktə oluna bilən lid forması açılır — müəllif adı, mənbə (məs. <code>social:twitter</code>),
            prioritet və qeyddən gələn mətn əvvəlcədən doldurulur. Çatışmayan əlaqə məlumatını əlavə edib
            yadda saxladıqda qeyd «→ Lid» statusuna keçir və düymə <HelpKey>Lid ↗</HelpKey> keçidinə çevrilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Daxili izləmə lazımdırsa, <HelpKey>→ Tapşırıq</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tapşırığın yaradıldığını bildirən bildiriş çıxır və düymə <HelpKey>Tapşırıq ↗</HelpKey>{" "}
            keçidinə çevrilir; basanda tapşırıq yeni tabda açılır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Facebook/Instagram birbaşa mesajlarını inbox-a qoş">
        <HelpStep n={1}>
          <p>
            Bağlı Facebook və ya Instagram hesabınız olduqda sağ yuxarıda <HelpKey>Inbox-a əlavə et</HelpKey>{" "}
            düyməsi görünür — basın ki, səhifələrinizin birbaşa mesajları omni-channel inbox-a düşsün.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə işləyərkən ikona pulsasiya edir. Bitdikdə neçə səhifənin qoşulduğunu bildirən bildiriş
            çıxır. Bəzi səhifələrdə icazə çatışmırsa, qismən qoşulma barədə xəbərdarlıq verilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Köhnə yazışmaları da gətirmək üçün <HelpKey>Söhbətləri idxal et</HelpKey> düyməsini basın — bu,
            mövcud Messenger və Instagram Direct söhbət tarixçəsini bir dəfəlik inbox-a yükləyir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İdxal gedərkən ikona pulsasiya edir, sonra neçə söhbət və mesajın idxal olunduğunu bildirən
            bildiriş çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Səhifələr qoşulub, amma Meta birbaşa mesajları çatdırmırsa, yuxarıda sarı{" "}
            <strong>«Facebook/Instagram birbaşa mesajları aktiv deyil»</strong> banneri çıxır — oradakı{" "}
            <HelpKey>Yenidən qoş</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə sizi Facebook giriş axınına yönləndirir. Yenidən qoşulma uğurlu olduqda banner yox olur
            (tabı yenidən fokuslayanda status avtomatik yenilənir).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Açar sözlər ən faydalı süzgəcdir: hesaba məhsul adlarını və kampaniya heşteqlərini əlavə edin —
          bu sözlərdən biri keçən qeydlər işarələnir və analitikada «Top açar sözlər»də görünür. AI ilə
          cavab layihələrini və viral xatırlatmaları avtomatlaşdırmaq üçün yuxarıdakı <HelpKey>AI</HelpKey>{" "}
          düyməsi və ya AI avtomatlaşdırma kartı ilə tənzimləmələrə keçin.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Facebook, Instagram, TikTok və YouTube üçün hesab adını əl ilə daxil edə bilməzsiniz — yalnız
          OAuth ilə daxil olub idarə etdiyiniz hesabları izləyə bilərsiniz. Tərtibatçı/test rejimində yalnız
          Meta App testerləri qoşula bilər; tam çıxışdan sonra istənilən istifadəçi öz Facebook-unu qoşa bilər.
          Hesabı ✕ ilə silmək onu izlənmədən çıxarır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün hesablar, qeydlər və statistika təşkilatınızla məhdudlaşır — başqa təşkilatın məlumatlarını
          görmürsünüz. Hesab qoşmaq üçün OAuth icazələri yalnız sizin admin olduğunuz səhifələrə şamil olunur,
          birbaşa mesaj çatdırılması isə Meta-nın verdiyi mesaj icazələrindən asılıdır.
        </p>
      </HelpCallout>
    </div>
  )
}
