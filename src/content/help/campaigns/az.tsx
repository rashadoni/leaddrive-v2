"use client"

/**
 * Campaigns — help article (Azerbaijani).
 * Köhnə birgə marketinq məqaləsindən ayrılıb: yalnız Kampaniyalar
 * səhifəsini əhatə edir (Siyahı/Analitika tabları, status kartları,
 * kampaniya yaratma, alıcı seçimi, A/B test, göndərmə, redaktə/sil).
 * Seqmentlər, şablonlar və avtomatlaşdırma kimi qonşu funksiyalar
 * bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function CampaignsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq və ya satış komandasının üzvüsünüz"
        goal="Kontaktlara və lidlərə kütləvi e-poçt və ya SMS kampaniyası yaratmaq, göndərmək və nəticələrini izləmək"
      >
        Səhifəyə yan menyudan <HelpKey>Kampaniyalar</HelpKey> ilə çatırsınız. Bütün kampaniyalar,
        alıcılar və statistika yalnız sizin təşkilatınız üçündür. Səhifə açılanda mövcud kampaniyalar
        avtomatik yüklənir; yüklənmə müddətində boz «pulsing» yer tutucuları görünür. E-poçt
        göndərmək üçün təşkilatınızda SMTP konfiqurasiyası tələb olunur.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Kampaniyalar</HelpKey> adı, onun altında ümumi kampaniya sayı yazılır.
          Sağ yuxarıda iki element var: <strong>tab keçidi</strong> (<HelpKey>Analitika</HelpKey> /{" "}
          <HelpKey>Siyahı</HelpKey>) və mavi <HelpKey>Yeni kampaniya</HelpKey> düyməsi. Onların altında
          beş status kartı durur: <strong>Qaralama</strong>, <strong>Planlaşdırılıb</strong>,{" "}
          <strong>Göndərilir</strong>, <strong>Göndərildi</strong> və <strong>Ləğv edildi</strong> —
          hər biri həmin statusda olan kampaniyaların sayını göstərir.
        </p>
        <p>
          <HelpKey>Siyahı</HelpKey> tabında status kartlarının altında bir axtarış sahəsi, sonra isə
          kampaniya kartları gəlir. Hər kart tıklananddır və açılışda həmin kampaniyanın detal
          səhifəsinə (<HelpKey>/campaigns/&lt;id&gt;</HelpKey>) keçir. Heç kampaniya yoxdursa
          «Kampaniya yoxdur. İlkini yaradın!», axtarış nəticə vermirsə isə «Heç nə tapılmadı» mətni
          göstərilir. <HelpKey>Analitika</HelpKey> tabı isə kartların yerinə KPI və qrafiklər panelini
          açır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Qaralama">Hələ göndərilməyən, redaktə edilə bilən kampaniya.</HelpDef>
          <HelpDef term="Planlaşdırılıb">Gələcək bir tarixə göndərmə üçün təyin edilmiş kampaniya.</HelpDef>
          <HelpDef term="Göndərilir">Hazırda alıcılara göndərilməkdə olan kampaniya.</HelpDef>
          <HelpDef term="Göndərildi">Göndərmə bitmiş kampaniya — bundan sonra kart yalnız oxunan icmal kimi açılır.</HelpDef>
          <HelpDef term="Ləğv edildi">Dayandırılmış və ya ləğv edilmiş kampaniya.</HelpDef>
          <HelpDef term="Növ">Kanal: <strong>Email</strong> (📧) və ya <strong>SMS</strong> (📱).</HelpDef>
          <HelpDef term="Alıcılar">Kampaniyanın hədəflədiyi kontakt/lid sayı (kartda insan ikonası ilə göstərilir).</HelpDef>
          <HelpDef term="A/B test">İki və ya daha çox variantı (mövzu, məzmun və ya göndərmə vaxtı) kiçik auditoriyada yoxlayıb qalibi seçmək imkanı.</HelpDef>
        </dl>
        <p>
          Hər kampaniya kartında ad, varsa təsvir (iki sətirə qədər), bir sətirdə status (rəngli),
          kanal növü ikonası, alıcı sayı və göndərilibsə göndərilmiş say görünür. Kartın sağında —
          əgər kampaniya göndərilibsə «göndərilən/alıcı» nisbəti (məs. <HelpKey>120/150</HelpKey>),
          əks halda büdcə (varsa) yazılır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni kampaniya yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni kampaniya</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni kampaniya» başlıqlı pəncərə açılır. İçində ardıcıl sahələr var:{" "}
            <strong>Ad *</strong>, <strong>Təsvir</strong>, bir sətirdə <strong>Növ</strong>{" "}
            (Email/SMS) və <strong>Email şablonu</strong>, sonra bir sətirdə{" "}
            <strong>E-poçt mövzusu</strong> və <strong>Göndərmə planla</strong>, daha sonra{" "}
            <strong>Büdcə</strong>, «A/B test aktiv et» çərçivəsi və <strong>Alıcılar</strong>{" "}
            açılan siyahısı.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Ad</strong> yazın — bu yeganə məcburi sahədir (məs. «Mart göndərişi»). İstəsəniz{" "}
            <strong>Təsvir</strong> əlavə edin və <strong>Növ</strong> sahəsindən{" "}
            <HelpKey>Email</HelpKey> və ya <HelpKey>SMS</HelpKey> seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sahənin altında boz izah mətni var («Kampaniyanın adı…», «Email və ya SMS göndəriş
            növü» və s.). Adı boş buraxıb yadda saxlamağa çalışsanız, formanın yuxarısında qırmızı
            fonda «Mütləq sahə» xətası çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İstəyə bağlı olaraq: <strong>Email şablonu</strong> seçin, <strong>E-poçt mövzusu</strong>{" "}
            yazın, <strong>Göndərmə planla</strong> sahəsində gələcək tarix-vaxt təyin edin və{" "}
            <strong>Büdcə</strong> daxil edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Şablon siyahısı yüklənənə qədər «Yüklənir...», sonra «— Şablonsuz —» və mövcud şablonlar
            görünür. «Göndərmə planla» sahəsi tarix-vaxt seçicisidir; büdcə yalnız rəqəm qəbul edir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <strong>Alıcılar</strong> açılan siyahısından kimə göndəriləcəyini seçin:{" "}
            <HelpKey>Bütün kontaktlar + lidlər</HelpKey>, <HelpKey>Yalnız kontaktlar</HelpKey>,{" "}
            <HelpKey>Yalnız lidlər</HelpKey>, <HelpKey>📊 Seqmentə görə</HelpKey>,{" "}
            <HelpKey>🔍 Mənbəyə görə</HelpKey> və ya <HelpKey>✋ Əl ilə seçmək</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahının altında dərhal «Göndəriləcək: N alıcıya» yazısı yenilənir. «Seqmentə
            görə» seçsəniz seqment seçici, «Mənbəyə görə» seçsəniz mənbə seçici, «Əl ilə seçmək»
            seçsəniz isə axtarışlı kontakt siyahısı (qeyd qutuları, «Hamısını seç» / «Hamısını
            təmizlə» düymələri ilə) görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Aşağıdakı <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> və ya sağ yuxarıdakı × ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yadda saxlanarkən «...» göstərir, sonra pəncərə bağlanır və yeni kampaniya siyahıda{" "}
            <strong>Qaralama</strong> statusu ilə peyda olur; <strong>Qaralama</strong> status
            kartının sayı bir vahid artır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: kampaniyanı göndər">
        <HelpStep n={1}>
          <p>
            Kampaniyanı redaktə pəncərəsində açın. Aşağıda yaşıl{" "}
            <HelpKey>Kampaniyanı göndər</HelpKey> düyməsi olur. (Yeni kampaniya yaradarkən eyni yaşıl
            düymə həm yaradır, həm dərhal göndərir.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yaşıl düymədə təyyarə (Send) ikonası var. Artıq göndərilmiş kampaniyanı açanda isə bu düymə
            yalnız oxunan icmal pəncərəsinin altında görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Kampaniyanı göndər</HelpKey> düyməsini basın və açılan brauzer təsdiqini
            qəbul edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Kampaniyanı göndər “&lt;ad&gt;”?» mətnli, alıcı sayını göstərən təsdiq dialoqu çıxır.
            Təsdiqlədikdən sonra nəticə bildirişi (toast) görünür: «N alıcıdan M nəfərə göndərildi».
            SMTP qurulmayıbsa, qırmızı «SMTP qurulmayıb!» bildirişi çıxır və göndərmə baş tutmur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: kampaniyanı axtar, redaktə et və ya sil">
        <HelpStep n={1}>
          <p>
            <HelpKey>Siyahı</HelpKey> tabında axtarış sahəsinə ad və ya təsvirin bir hissəsini yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart siyahısı yazdıqca dərhal süzülür. Uyğun nəticə yoxdursa «Heç nə tapılmadı» mətni
            göstərilir (heç kampaniya olmadıqda isə «Kampaniya yoxdur. İlkini yaradın!»).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Qaralama və ya planlaşdırılmış kampaniyanı dəyişmək üçün onu redaktə pəncərəsində açın,
            sahələri dəyişib aşağıdakı <HelpKey>Saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Kampaniyanı redaktə et» başlıqlı, mövcud dəyərlərlə doldurulmuş eyni forma açılır; başlıqda
            cari status nişanı görünür. Artıq <strong>Göndərildi</strong> statusunda olan kampaniya isə
            redaktə əvəzinə yalnız oxunan icmal (göndərilmə / açılma / klik göstəriciləri) kimi açılır —
            yenidən redaktə üçün ayrıca <HelpKey>Redaktə et</HelpKey> düyməsi var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Kampaniyanı silmək üçün redaktə pəncərəsinin solundakı qırmızı <HelpKey>Sil</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Kampaniyanı sil» təsdiq pəncərəsi silinəcək kampaniyanın adı ilə açılır. Təsdiqlədikdən
            sonra kampaniya siyahıdan çıxır və status kartları yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: A/B test qur">
        <HelpStep n={1}>
          <p>
            Kampaniya formasında «A/B test aktiv et» qeyd qutusunu işarələyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Çərçivə açılır: <strong>Test növü</strong> (Mövzu sətri / Məzmun / Göndərmə vaxtı),{" "}
            <strong>Qalib meyarı</strong> (Açılma faizi / Klik faizi), <strong>Test auditoriyası</strong>{" "}
            sürüşdürücüsü (10–50%) və <strong>Test müddəti</strong> seçicisi (1–24 saat).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Aşağıdakı <strong>Variant A</strong> və <strong>Variant B</strong> bloklarını doldurun;
            lazım olsa <HelpKey>+ Variant əlavə et</HelpKey> ilə yenisini əlavə edin (maksimum 4
            variant).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər variantda test növünə uyğun sahə görünür: «Mövzu sətri» və «Məzmun» üçün mövzu sahəsi
            (məzmunda əlavə şablon seçici), «Göndərmə vaxtı» üçün tarix-vaxt sahəsi. Hər variantın
            yanında faiz payı yazılır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Analitika tabı">
        <p>
          Sağ yuxarıdakı <HelpKey>Analitika</HelpKey> tabını basanda kampaniya kartları əvəzinə icmal
          paneli açılır. Yuxarıda altı KPI kartı durur: <strong>Göndərilib</strong>,{" "}
          <strong>Açılma</strong>, <strong>Klik</strong>, <strong>Bounce</strong>,{" "}
          <strong>Büdcə</strong> və <strong>ROI</strong>. Altda üç panel var:{" "}
          <strong>Aylıq göndərmə trendi</strong> (göndərilib / açılıb / kliklənib xətləri),{" "}
          <strong>Çatdırılma hunisi</strong> (göndərilib → açılıb → kliklənib → bounce) və{" "}
          <strong>Ən yaxşı kampaniyalar</strong>. Daha aşağıda <strong>Seqmentlər</strong>,{" "}
          <strong>Avtomatlaşdırma</strong> və <strong>Şablonlar</strong> ümumi panelləri yer alır.
        </p>
        <HelpCallout kind="see" label="Ekranda görəcəksiniz">
          KPI kartları və huni dəyərləri sizin kampaniyalarınızın faktiki göndərmə / açılma / klik
          cəmlərindən hesablanır. Hələ heç nə göndərilməyibsə bu göstəricilər 0%-ə yaxın görünür və
          «Ən yaxşı kampaniyalar» panelində «Hələ kampaniya yoxdur» yazılır.
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Göndərmədən əvvəl alıcı sahəsinin altındakı «Göndəriləcək: N alıcıya» sətrini yoxlayın — bu,
          mesajı kimin alacağını real vaxtda göstərir. Daha dəqiq nəzarət üçün{" "}
          <HelpKey>✋ Əl ilə seçmək</HelpKey> rejimində konkret kontaktları işarələyə, və ya öncə kiçik{" "}
          <HelpKey>📊 Seqmentə görə</HelpKey> auditoriyaya test mesajı göndərə bilərsiniz.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Kampaniyanın göndərilməsi geri qaytarılmır — təsdiq dialoqundakı alıcı sayını mütləq
          yoxlayın. Göndərildikdən sonra kampaniya yalnız oxunan icmal kimi açılır. E-poçt göndərmək
          üçün SMTP qurulmalıdır; əks halda «SMTP qurulmayıb!» xətası çıxacaq və heç bir mesaj
          getməyəcək.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün kampaniyalar və alıcı siyahıları təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın
          kontakt və lidlərinə göndərə bilərsiniz və başqa təşkilatın kampaniyalarını görmürsünüz.
          Alıcı, şablon və seqment seçiciləri də yalnız sizin təşkilatınızın məlumatlarından gəlir.
        </p>
      </HelpCallout>
    </div>
  )
}
