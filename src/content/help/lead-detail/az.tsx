"use client"

/**
 * Lead detail (record) page — help article (Azerbaijani).
 * Yalnız tək lid kartını əhatə edir: /leads/[id] — başlıq və əməliyyat
 * düymələri, status zolağı (pipeline), KPI kartları və yeddi tab
 * (Detallar / Fəaliyyətlər / Qarşılıqlı əlaqələr / Tonallıq / Tapşırıqlar /
 * Da Vinci Mətn / Da Vinci Reytinq). Lid siyahısı bura DAXİL DEYİL —
 * onun üçün ayrıca "Lidlər" məqaləsi var.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function LeadDetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış nümayəndəsi və ya menecersiniz"
        goal="Bir lidin kartını açıb məlumatlarını oxumaq, statusunu irəlilətmək, qeyd və fəaliyyət əlavə etmək, Da Vinci ilə mətn yazıb göndərmək və lazım olanda sövdələşməyə çevirmək"
      >
        Bu səhifəyə lid siyahısında istənilən lidin üzərinə basanda çatırsınız.
        Açılan kart yalnız sizin təşkilatınızın lididir. Burada gördüyünüz hər şey —
        status, bal, fəaliyyətlər — eyni qeyddən oxunur, ona görə dəyişiklik etdikcə
        başlıqdakı nişanlar və KPI kartları dərhal yenilənir. Bəzi sahələr (məs. e-poçt,
        telefon, təxmini dəyər) rolunuzdan asılı olaraq gizli ola bilər.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Ən yuxarıda geri (<HelpKey>←</HelpKey>) düyməsi, yanında lidin baş hərflərindən
          ibarət dəyirmi nişan, sonra lidin adı, status və prioritet nişanları durur.
          Ad varsa, altında şirkət adı və e-poçt göstərilir. Sağ küncdə üç düymə var:{" "}
          <HelpKey>Sövdələşməyə çevir</HelpKey> (yaşıl — yalnız lid hələ çevrilməyibsə görünür),{" "}
          <HelpKey>Redaktə et</HelpKey> və <HelpKey>Sil</HelpKey>.
        </p>
        <p>
          Altda <strong>status zolağı</strong> (pipeline) var — beş mərhələ:{" "}
          <strong>Yeni → Əlaqə quruldu → Kvalifikasiya edildi → Çevrildi → İtirildi</strong>.
          Daha aşağıda dörd <strong>KPI kartı</strong>, onların altında isə yeddi <strong>tab</strong> gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status zolağı">Beş kliklənən mərhələ. Cari mərhələ vurğulanır; hər hansı birinə basmaq lidin statusunu dərhal həmin mərhələyə dəyişir.</HelpDef>
          <HelpDef term="Bal / Dərəcə">0–100 aralığında lid balı və ona uyğun hərf dərəcəsi (A=80+, B=60+, C=40+, D=20+, F=20-dən aşağı).</HelpDef>
          <HelpDef term="Yaradılandan bəri günlər">Lidin sistemə düşməsindən keçən gün sayı.</HelpDef>
          <HelpDef term="Təxmini dəyər">Lidin potensial pul dəyəri (rolunuza görə gizli ola bilər).</HelpDef>
          <HelpDef term="Detallar">Lidin bütün məlumatları (ad, şirkət, əlaqə kanalları, mənbə, tarixlər) + redaktə oluna bilən Qeydlər bölməsi.</HelpDef>
          <HelpDef term="Fəaliyyətlər">Bu lid üçün əl ilə əlavə etdiyiniz qeyd/zəng/email/görüş/tapşırıq jurnalı.</HelpDef>
          <HelpDef term="Qarşılıqlı əlaqələr">Bütün kanallar üzrə birləşmiş zaman cədvəli (avtomatik toplanan ünsiyyət tarixçəsi).</HelpDef>
          <HelpDef term="Tonallıq">Da Vinci-nin lid haqqında məlumata əsasən hesabladığı emosional ovqat və risk.</HelpDef>
          <HelpDef term="Tapşırıqlar">Da Vinci-nin təklif etdiyi növbəti addımlar (bir kliklə əsl tapşırığa çevrilir).</HelpDef>
          <HelpDef term="Da Vinci Mətn">Email / SMS / WhatsApp / Telegram üçün mətn yaradıb birbaşa buradan göndərmə.</HelpDef>
          <HelpDef term="Da Vinci Reytinq">Balın izahı, dərəcə, konversiya ehtimalı və qiymətləndirmə faktorları + yenidən hesablama düyməsi.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: statusu irəlilət">
        <HelpStep n={1}>
          <p>
            Status zolağında lidin keçdiyi mərhələyə basın — məsələn, yeni lidə zəng
            etdinizsə <HelpKey>Əlaqə quruldu</HelpKey> mərhələsinə.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Basdığınız mərhələ rəngli (vurğulanmış) hala keçir, ondan əvvəlki mərhələlər
            də «keçilmiş» kimi açıq rənglə işarələnir. Yenilənmə anında həmin düymədə
            kiçik fırlanan göstərici görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Lid uğurla bağlanmadısa, <HelpKey>İtirildi</HelpKey> mərhələsinə basın;
            satışa hazır olubsa, <HelpKey>Çevrildi</HelpKey> seçimi var (lakin bunun üçün
            aşağıdakı «Sövdələşməyə çevir» axını daha tam variantdır).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>İtirildi</strong> qırmızı, <strong>Çevrildi</strong> isə yaşıl rənglə
            vurğulanır. Eyni anda başlıqdakı status nişanı da yeni vəziyyəti əks etdirir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: detalları oxu və qeyd əlavə et">
        <HelpStep n={1}>
          <p>
            <HelpKey>Detallar</HelpKey> tabında qalın (ilk tab açıq olur). «Lid məlumatları»
            kartında ad, şirkət, e-poçt, telefon, varsa WhatsApp və Telegram, mənbə, brend,
            kateqoriya və tarixlər sadalanır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            E-poçt və telefon kliklənən keçidlərdir (e-poçt poçt proqramını, telefon zəngi
            açır). Telefonun yanında varsa <HelpKey>Zəng et</HelpKey> düyməsi göstərilir.
            «---» işarəsi həmin sahənin boş olduğunu bildirir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Kartın altındakı <HelpKey>Qeydlər</HelpKey> bölməsinə basın — boşdursa{" "}
            «Qeyd əlavə etmək üçün basın», doludursa mətnin özünə (və ya yanındakı qələm
            ikonasına) basmaqla redaktə açılır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Çoxsətirli mətn sahəsi açılır, altında <HelpKey>Ləğv et</HelpKey> və{" "}
            <HelpKey>Saxla</HelpKey> düymələri görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Qeydi yazıb <HelpKey>Saxla</HelpKey> basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Saxlanılır...» halına keçir, sonra «Qeydlər saxlanıldı» bildirişi çıxır
            və qeyd adi (redaktə olunmayan) mətn kimi görünür. Xəta olarsa «Qeydləri saxlamaq
            alınmadı» bildirişi göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: fəaliyyət əlavə et">
        <HelpStep n={1}>
          <p>
            <HelpKey>Fəaliyyətlər</HelpKey> tabına keçin, sağ yuxarıdakı{" "}
            <HelpKey>Fəaliyyət əlavə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Fəaliyyət əlavə et» başlıqlı pəncərə açılır: <strong>Növ</strong> açılan siyahısı
            (📝 Note, 📞 Call, 📧 Email, 🤝 Meeting, ✅ Task, 📌 Other), məcburi{" "}
            <strong>Mövzu *</strong> sahəsi və istəyə bağlı <strong>Təsvir</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Növü seçin, <strong>Mövzu</strong> yazın (məs. «Salam zəngi») və lazımdırsa təfərrüat
            əlavə edin, sonra <HelpKey>Yarat</HelpKey> basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mövzu boşdursa «Mövzu tələb olunur» xəbərdarlığı çıxır və düymə qeyri-aktiv olur.
            Saxlandıqdan sonra «Fəaliyyət əlavə edildi» bildirişi gəlir, pəncərə bağlanır və
            yeni yazı zaman cədvəlinin başında növə uyğun ikonayla peyda olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Avtomatik toplanan tam ünsiyyət tarixçəsini görmək üçün isə{" "}
            <HelpKey>Qarşılıqlı əlaqələr</HelpKey> tabına keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bütün kanallar üzrə birləşmiş zaman cədvəli yüklənir; əl ilə əlavə etdiyiniz
            fəaliyyətlərdən fərqli olaraq bu jurnal sistem tərəfindən doldurulur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Da Vinci ilə mətn yarat və göndər">
        <HelpStep n={1}>
          <p>
            <HelpKey>Da Vinci Mətn</HelpKey> tabına keçin. <HelpKey>Mətn növü</HelpKey>{" "}
            açılan siyahısından kanal seçin: Email, SMS, WhatsApp və ya Telegram.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Email / SMS / Telegram seçəndə <strong>Mövzu</strong>, <strong>Ton</strong> və{" "}
            <strong>Əlavə göstərişlər</strong> sahələri açılır. WhatsApp seçəndə isə bunun
            yerinə şablon seçici görünür (Meta cold-outreach üçün təsdiqlənmiş şablon tələb edir).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            (Email/SMS/Telegram üçün) Mövzu (məs. Tanışlıq, Follow-up, Kommersiya təklifi), Ton
            (Peşəkar, Dostcanlı, Rəsmi, İnandırıcı) seçin, istəsəniz Əlavə göstərişlər yazın və{" "}
            <HelpKey>Mətn yarat</HelpKey> basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Yaradılır...» halına keçir, sonra altda redaktə oluna bilən nəticə çərçivəsi
            çıxır: Email üçün ayrıca <strong>Mövzu</strong> sahəsi və <strong>Mətn</strong> sahəsi.
            Mətni birbaşa burada düzəldə bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Hazır mətni <HelpKey>Kopyala</HelpKey> ilə kopyalaya, <HelpKey>Yenidən yarat</HelpKey>{" "}
            ilə təzələyə və ya birbaşa göndərə bilərsiniz: <HelpKey>Email göndər</HelpKey> /{" "}
            <HelpKey>SMS göndər</HelpKey> / <strong>Send Telegram</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Göndərmə düyməsi yalnız uyğun ünvan (e-poçt/telefon/Telegram handle) dolu olanda
            görünür. Göndərildikdən sonra düymə «Göndərildi» olur; xəta olsa, qırmızı mesaj çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            WhatsApp üçün: təsdiqlənmiş <strong>Şablon</strong> seçin, dəyişən parametrləri doldurun
            (lazım olsa <HelpKey>AI suggest</HelpKey> ilə Da Vinci təklif edir), önizləməyə baxın və{" "}
            <strong>Send WhatsApp</strong> basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Təsdiqlənmiş şablon yoxdursa «Təsdiqlənmiş WhatsApp şablonu yoxdur» yazısı və{" "}
            <strong>WhatsApp Settings</strong> keçidi göstərilir. Şablon seçəndə parametr
            sahələri və canlı önizləmə görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Da Vinci ilə tonallıq, tapşırıq və reytinq">
        <HelpStep n={1}>
          <p>
            <HelpKey>Tonallıq</HelpKey> tabında <HelpKey>Tonallığı təhlil et</HelpKey> basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Dairəvi göstərici (faiz + emoji), tonallıq adı və üç kart — <strong>Trend</strong>,{" "}
            <strong>Risk</strong>, <strong>Etibar</strong> — və altda <strong>Xülasə</strong> mətni çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Tapşırıqlar</HelpKey> tabında <HelpKey>Tapşırıqlar yarat</HelpKey> basın;
            təkliflər çıxandan sonra <HelpKey>Bütün tapşırıqları yarat</HelpKey> ilə hamısını
            əsl tapşırığa çevirin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sarı «Strategiya» bloku və prioritet/növ/son tarix nişanları olan tapşırıq kartları
            görünür. Yaradıldıqdan sonra düymə «Tapşırıqlar yaradıldı» halına keçir;{" "}
            <HelpKey>Yenidən yarat</HelpKey> ilə yeni təkliflər ala bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Da Vinci Reytinq</HelpKey> tabında balın izahını görün; yeniləmək üçün{" "}
            <HelpKey>Da Vinci ilə yenidən hesabla</HelpKey> basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İzah mətni, üç böyük rəqəm — <strong>Dərəcə</strong>, <strong>Bal</strong>,{" "}
            <strong>Konversiya</strong> — və altda faiz zolaqları ilə qiymətləndirmə faktorları
            (Yaxınlıq, Sövdələşmə potensialı, Mənbə keyfiyyəti, Əlaqə səviyyəsi, Əlaqə tamlığı) göstərilir.
            Yenidən hesablama bitəndə KPI kartındakı bal da yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: lidi çevir, redaktə et və ya sil">
        <HelpStep n={1}>
          <p>
            Lid satışa hazırdırsa, sağ yuxarıdakı yaşıl <HelpKey>Sövdələşməyə çevir</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Çevirmə pəncərəsi açılır. Təsdiqlədikdən sonra lid sövdələşmə kimi davam edir;
            kartda artıq «çevrilmə» tarixi görünür və <strong>Sövdələşməyə çevir</strong> düyməsi yox olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bütün sahələri dəyişmək üçün <HelpKey>Redaktə et</HelpKey> (qələm ikonası) basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mövcud dəyərlərlə əvvəlcədən doldurulmuş lid forması açılır. Saxladıqdan sonra
            pəncərə bağlanır və kart yenilənmiş məlumatları göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Lidi silmək üçün qırmızı <HelpKey>Sil</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Lidin adını göstərən təsdiq pəncərəsi açılır. Təsdiqlədikdən sonra lid silinir və
            siz lid siyahısına qaytarılırsınız.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Status zolağındakı mərhələ düymələri bir kliklə işləyir — pəncərə açmadan. Tez iş axını:
          lidə zəng et → <HelpKey>Əlaqə quruldu</HelpKey> bas → <HelpKey>Fəaliyyətlər</HelpKey>-də
          zəngi qeyd et → <HelpKey>Da Vinci Mətn</HelpKey>-də follow-up email yarat və göndər.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Silmə geri qaytarılmır. Lidi sadəcə uğursuz saymaq istəyirsinizsə, silmək yerinə status
          zolağında <HelpKey>İtirildi</HelpKey> seçin — qeyd və tarixçə qalır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bu kart yalnız sizin təşkilatınızın lididir — başqa tenant-ın lidlərini görə bilməzsiniz.
          E-poçt, telefon və təxmini dəyər kimi sahələr rolunuzun icazələrindən asılı olaraq gizlədilə
          bilər; görmədiyiniz sahə sizdə həmin icazənin olmamasını bildirir. WhatsApp ilə cold-outreach
          yalnız Meta-da əvvəlcədən təsdiqlənmiş şablonla mümkündür.
        </p>
      </HelpCallout>
    </div>
  )
}
