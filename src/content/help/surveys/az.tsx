"use client"

/**
 * Surveys & NPS — help article (Azerbaijani), video-script format.
 * Yalnız siyahı səhifəsini (src/app/(dashboard)/surveys/page.tsx) əhatə edir:
 * sorğu yaratma, status keçidi, ictimai link, dəvət göndərmə, silmə.
 * Sorğunun detal/analitika alt-səhifəsi (/surveys/[id]) bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SurveysHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Müştəri uğuru, dəstək və ya marketinq məsulusunuz"
        goal="Müştərilərdən rəy toplamaq — NPS, CSAT və ya CES sorğusu yaratmaq, paylaşmaq və cavabları toplamaq"
      >
        Səhifə sol menyudakı <HelpKey>Sorğular</HelpKey> bölməsindədir. Bütün sorğular və cavablar
        yalnız sizin təşkilatınız üçündür. Hər sorğunun ictimai linki var — onu kopyalayıb
        paylaşa, və ya birbaşa email/SMS ilə dəvət göndərə bilərsiniz. Statistika kartları
        (cavablar, promouterlər, NPS) cavablar gəldikcə yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda ulduz ikonası ilə <HelpKey>Sorğular</HelpKey> adı, altında «NPS, CSAT, CES və
          xüsusi sorğularla rəy toplayın» izahı, sağ yuxarıda isə <HelpKey>Yeni sorğu</HelpKey>{" "}
          düyməsi var. Altda sorğular iki sütunlu kart şəbəkəsi kimi göstərilir. Hələ heç bir
          sorğu yoxdursa, onun yerinə boş vəziyyət (ulduz ikonası + «Hələ sorğu yoxdur» mesajı +{" "}
          <HelpKey>Yeni sorğu</HelpKey> düyməsi) görünür.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="NPS">Net Promoter Score — 0–10 şkalası; müştərinin sizi tövsiyə etmə ehtimalını ölçür.</HelpDef>
          <HelpDef term="CSAT">Customer Satisfaction — 1–5 şkalası; konkret təcrübədən məmnunluğu ölçür.</HelpDef>
          <HelpDef term="CES">Customer Effort Score — 1–7 şkalası; müştərinin sərf etdiyi səyi ölçür.</HelpDef>
          <HelpDef term="Xüsusi">Hazır şkala olmayan sərbəst tipli sorğu.</HelpDef>
          <HelpDef term="Promouterlər">NPS-də yüksək bal verən, sizi tövsiyə edən respondentlərin sayı.</HelpDef>
          <HelpDef term="İctimai link">/s/... ünvanı — autentifikasiya tələb etmədən hər kəsin sorğunu cavablandıra biləcəyi səhifə.</HelpDef>
          <HelpDef term="Dəvət">Sorğu linkinin email və ya SMS ilə alıcılara göndərilməsi.</HelpDef>
        </dl>
        <p>
          Hər sorğu kartında üstdə ad (kliklədikdə sorğunun detal səhifəsinə aparır), yanında{" "}
          <strong>status</strong> nişanı (<HelpKey>Aktiv</HelpKey>, <HelpKey>Pauza</HelpKey>,{" "}
          <HelpKey>Qaralama</HelpKey> və ya <HelpKey>Bağlı</HelpKey>) və <strong>tip</strong>{" "}
          nişanı (NPS / CSAT / CES / Xüsusi) olur; təsvir varsa altında göstərilir. Ortada üç
          göstərici durur: <strong>Cavablar</strong>, <strong>Promouterlər</strong> (yaşıl) və{" "}
          <strong>NPS</strong> (bal yoxdursa «—»). Aşağıda əməliyyat düymələri var:{" "}
          <HelpKey>İctimai linki kopyala</HelpKey>, <HelpKey>Aç</HelpKey>, status keçidi düyməsi,
          sorğu aktivdirsə <HelpKey>Dəvət göndər</HelpKey>, sağda isə qırmızı <HelpKey>Sil</HelpKey>.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni sorğu yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni sorğu</HelpKey> düyməsini basın. (Heç sorğu yoxdursa, boş
            vəziyyətin ortasındakı eyni adlı düymə də işləyir.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni sorğu yarat» başlıqlı pəncərə açılır. İçində <strong>Sorğunun adı *</strong>{" "}
            sahəsi, <strong>Tip</strong> açılan siyahısı, <strong>Təsvir (istəyə bağlı)</strong>{" "}
            sahəsi və aşağıda iki qeyd qutusu var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Sorğunun adı</strong> yazın — bu yeganə məcburi sahədir (məs. «Dəstəkdən sonra
            CSAT»).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca mətn sahədə görünür. Ad boş qaldıqca aşağıdakı <HelpKey>Yarat</HelpKey>{" "}
            düyməsi qeyri-aktiv (kliklənməz) qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Tip</strong> açılan siyahısından sorğu növünü seçin:{" "}
            <HelpKey>NPS (0–10)</HelpKey>, <HelpKey>CSAT (1–5)</HelpKey>,{" "}
            <HelpKey>CES (1–7)</HelpKey> və ya <HelpKey>Xüsusi</HelpKey>. İstəsəniz{" "}
            <strong>Təsvir</strong> də əlavə edin — bu mətn respondentə göstərilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilən tip açılan siyahıda göstərilir; standart olaraq NPS seçili gəlir. Şkala
            diapazonu (məs. 0–10) tip adının yanında görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Aşağıdakı qeyd qutularını istəyə görə işarələyin: <HelpKey>Email</HelpKey> kanalı
            (standart olaraq işarələnmiş) və{" "}
            <HelpKey>Bilet həll olunduqdan sonra avtomatik göndər</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər qutu işarələndikcə kvadratda işarə görünür. <strong>Email</strong> kanalı
            sorğunun email vasitəsilə göndərilə biləcəyini bildirir; ikinci qutu isə dəstək bileti
            «resolved»-ə keçdikdə sorğunu avtomatik göndərmə tetikini açır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Aşağıda <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>İmtina</HelpKey> ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yaradılarkən <HelpKey>Yadda saxlanılır…</HelpKey> yazısına keçir, sonra pəncərə
            bağlanır və yeni sorğu kart kimi siyahıda peyda olur — başlanğıc göstəriciləri sıfır,
            NPS isə «—» olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: linki paylaş və ya dəvət göndər">
        <HelpStep n={1}>
          <p>
            Sorğu kartında <HelpKey>İctimai linki kopyala</HelpKey> düyməsini basın ki, /s/...
            ünvanını panoya köçürəsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Link panoya kopyalanır — istənilən yerə (mesaj, sənəd) yapışdıra bilərsiniz. Bu ünvanı
            açan hər kəs giriş etmədən sorğunu cavablandıra bilər.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sorğunun necə göründüyünü yoxlamaq üçün <HelpKey>Aç</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İctimai sorğu səhifəsi yeni nişanda (tab) açılır — respondentin görəcəyi forma.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Linki birbaşa göndərmək üçün <HelpKey>Dəvət göndər</HelpKey> düyməsini basın.{" "}
            <strong>Diqqət:</strong> bu düymə yalnız sorğu <HelpKey>Aktiv</HelpKey> olduqda görünür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Sorğu dəvətləri göndər» başlıqlı pəncərə açılır. Yuxarıda <HelpKey>Email</HelpKey> /{" "}
            <HelpKey>SMS</HelpKey> keçid düymələri, altda mətn sahəsi, bir qeyd qutusu və
            izahedici mətn var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Kanalı seçin. <HelpKey>Email</HelpKey> seçilibsə email ünvanlarını, <HelpKey>SMS</HelpKey>{" "}
            seçilibsə telefon nömrələrini mətn sahəsinə yazın — hər birini vergül və ya yeni
            sətirlə ayırın. Bütün təşkilat üzrə göndərmək istəyirsinizsə{" "}
            <HelpKey>Təşkilatdakı bütün aktiv kontaktlara göndər</HelpKey> qutusunu işarələyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kanal düyməsi seçildikdə mətn sahəsinin etiketi (Email-lər / Telefonlar) və nümunə
            yer-tutucu mətn (məs. <code>user1@example.com</code> və ya <code>+994501234567</code>)
            dəyişir. Aşağıda imtina (unsubscribe) edənlərin atlanacağına dair qeyd görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Aşağıdakı <HelpKey>Göndər</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə göndərmə zamanı yüklənmə vəziyyətinə keçir, sonra pəncərədə nəticə zolağı çıxır:
            uğurda yaşıl (neçəsi göndərildi / cəmi / atlanan / uğursuz), xətada isə qırmızı
            mesaj. Mətn sahəsi və «bütün kontaktlar» qutusu boşdursa, <HelpKey>Göndər</HelpKey>{" "}
            düyməsi qeyri-aktiv qalır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: sorğunu dayandır, davam etdir və ya sil">
        <HelpStep n={1}>
          <p>
            Sorğunu müvəqqəti dayandırmaq və ya yenidən işə salmaq üçün kartdakı status keçidi
            düyməsini basın. Aktiv sorğuda düymədə <HelpKey>Pauza</HelpKey>, dayandırılmış sorğuda
            isə <HelpKey>Aktiv</HelpKey> yazır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kartın üst hissəsindəki status nişanı dəyişir (məs. <HelpKey>Aktiv</HelpKey> ↔{" "}
            <HelpKey>Pauza</HelpKey>). Sorğu pauzada olduqda <HelpKey>Dəvət göndər</HelpKey>{" "}
            düyməsi kartdan yox olur, çünki yalnız aktiv sorğular üçün mövcuddur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sorğunu büsbütün silmək üçün sağdakı qırmızı <HelpKey>Sil</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sorğunun adı ilə bir təsdiq pəncərəsi açılır. Təsdiqlədikdən sonra sorğu siyahıdan
            çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmə geri qaytarılmır. Sorğunu yenidən işlədə biləcəyinizi düşünürsünüzsə, silmək
            yerinə status keçidi ilə <HelpKey>Pauza</HelpKey>-ya keçirin — sorğu və topladığı
            cavablar qalır, sadəcə yeni dəvət göndərilmir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Tip ad seçimini deyil, şkalanı təyin edir: <HelpKey>NPS</HelpKey> ehtimal sualıdır
          (0–10), <HelpKey>CSAT</HelpKey> məmnunluqdur (1–5), <HelpKey>CES</HelpKey> sərf olunan
          səydir (1–7). Düzgün tip seçimi kart üzərindəki <strong>NPS</strong> və{" "}
          <strong>Promouterlər</strong> göstəricilərinin mənalı çıxmasını təmin edir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Sorğu <HelpKey>Pauza</HelpKey> və ya <HelpKey>Qaralama</HelpKey> vəziyyətindədirsə,{" "}
          <HelpKey>Dəvət göndər</HelpKey> düyməsi görünmür. Dəvət göndərmədən əvvəl sorğunu status
          keçidi ilə <HelpKey>Aktiv</HelpKey>-ə keçirin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün sorğular, cavablar və kontakt siyahıları təşkilatınızla məhdudlaşır — yalnız öz
          tenant-ınızın sorğularını görür və yalnız öz aktiv kontaktlarınıza toplu dəvət göndərə
          bilərsiniz. İctimai link autentifikasiya tələb etmir, ona görə onu yalnız nəzərdə tutulan
          alıcılarla paylaşın. İmtina (unsubscribe) edən alıcılar toplu göndərişdə avtomatik atlanır.
        </p>
      </HelpCallout>
    </div>
  )
}
