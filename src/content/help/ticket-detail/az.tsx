"use client"

/**
 * Ticket detail (Agent Desktop) — help article (Azerbaijani).
 * Tək bir biletin açılış səhifəsini əhatə edir: başlıq və əməliyyat düymələri,
 * status borusu, KPI kartları, SLA xəbərdarlıqları, əsas məzmun (mövzu/təsvir
 * inline redaktə + şərh lenti + Da Vinci köməkçiləri + status/təyinat) və sağ
 * yan paneldəki Müştəri 360 + Detallar/İnsanlar/SLA/CSAT/Bilik bazası kartları.
 * Bilet siyahısı (/tickets) bura DAXİL DEYİL — yalnız bir biletin idarəsi.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ticketdetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dəstək agenti və ya komanda rəhbərisiniz"
        goal="Bir müştəri biletini açıb oxumaq, müştəriyə cavab vermək və ya daxili qeyd yazmaq, statusu və agenti dəyişmək, SLA-ya nəzarət etmək və lazım olduqda eskalasiya etmək"
      >
        Bu səhifəyə bilet siyahısından (<HelpKey>Tiketlər</HelpKey>) bir bileti açanda
        düşürsünüz. Səhifə yalnız sizin təşkilatınızın biletlərini göstərir. Şərh lenti hər
        8 saniyədən bir səssiz yenilənir (başqa agentin və ya müştərinin cavabı avtomatik
        görünür), SLA sayğacları isə hər saniyə geri sayır — ona görə açıq saxlasanız
        ekrandakı rəqəmlər canlı dəyişir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda başlıq sətri durur: solda <HelpKey>geri</HelpKey> oxu və biletlər
          arasında keçid üçün <HelpKey>‹</HelpKey> / <HelpKey>›</HelpKey> oxları, ortada
          biletin <strong>mövzusu</strong>, bilet nömrəsi (məs. <HelpKey>#1234</HelpKey>),
          işlənmə vaxtı sayğacı (saat ikonası) və altında <strong>status</strong>,{" "}
          <strong>prioritet</strong>, <strong>kateqoriya</strong> nişanları. Sağda
          əməliyyat düymələri: <HelpKey>Eskalasiya</HelpKey>, <HelpKey>Mənə təyin et</HelpKey>,{" "}
          <HelpKey>Şikayətlərə</HelpKey>, varsa <HelpKey>Makrolar</HelpKey>,{" "}
          <HelpKey>360</HelpKey> açar-düyməsi və klaviatura qısayolları üçün ikona.
        </p>
        <p>
          Başlığın altında altı mərhələli rəngli <strong>status borusu</strong>{" "}
          (Yeni → Açıq → İcrada → Gözləyir → Həll edildi → Bağlı) və dörd{" "}
          <strong>KPI kartı</strong> var. SLA pozulanda və ya bitməyə az qalanda lentlər
          (qırmızı/sarı/narıncı xəbərdarlıqlar) görünür. Aşağıda iki sütun: solda əsas məzmun
          (bilet məlumatı, şərhlər, status/təyinat), sağda yan panel kartları.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status borusu">Biletin keçdiyi altı mərhələ; istənilən mərhələyə tıklayaraq statusu dərhal dəyişə bilərsiniz. Cari mərhələ rəngli işıqlanır.</HelpDef>
          <HelpDef term="Açıq günlər">Bilet yaranandan neçə gün keçdiyini göstərən kart.</HelpDef>
          <HelpDef term="SLA (Həll müddəti)">Biletin həll olunması üçün son tarixə qədər qalan vaxt; 2 saatdan az qalanda sarı, keçəndə qırmızı olur.</HelpDef>
          <HelpDef term="İlk cavab">Müştəriyə ilk cavabın verilməsi üçün SLA; cavab verilibsə nə qədər vaxta verildiyini göstərir.</HelpDef>
          <HelpDef term="Şərh">Bilet lentindəki mesaj — ya müştəriyə görünən cavab, ya da yalnız komandaya görünən daxili qeyd.</HelpDef>
          <HelpDef term="Daxili qeyd">Müştəriyə GÖRÜNMƏYƏN, yalnız agentlər üçün qeyd (sarı haşiyə + kilid nişanı ilə işarələnir).</HelpDef>
          <HelpDef term="Da Vinci">Süni intellekt köməkçisi — cavab layihəsi yazır, biletin xülasəsini çıxarır və ya həll addımlarını təklif edir.</HelpDef>
          <HelpDef term="Müştəri 360">Sağ paneldə müştərinin əlaqəsi, şirkəti, LTV-si, son tiketləri, açıq sövdələşmələri və son fəaliyyəti.</HelpDef>
        </dl>
        <p>
          Sağ yan paneldə (yuxarıdan aşağı): <HelpKey>Müştəri 360</HelpKey> (yığıla bilən),{" "}
          <HelpKey>Detallar</HelpKey> (status/prioritet/kateqoriya/tarixlər/teqlər),{" "}
          <HelpKey>İnsanlar</HelpKey> (təyin edilmiş agent, şirkət, əlaqə),{" "}
          <HelpKey>SLA</HelpKey> (son tarix və qalan vaxt), <HelpKey>CSAT</HelpKey>{" "}
          (müştəri məmnuniyyət ulduzları) və varsa <HelpKey>Bilik bazası məqalələri</HelpKey>{" "}
          kartları gəlir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: müştəriyə cavab ver">
        <HelpStep n={1}>
          <p>
            <HelpKey>Şərhlər</HelpKey> kartına enin. Lentdə əvvəlki mesajlar tarix sırası ilə
            düzülür; ən altda mətn yazma sahəsi var.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kartın başlığında «Şərhlər (N)» — mötərizədəki N hazırda görünən mesaj sayıdır.
            Hələ heç mesaj yoxdursa, «Şərh yoxdur» yazısı göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Aşağıdakı mətn sahəsinə cavabınızı yazın («Müştəriyə cavab ver...» placeholder-i
            ilə), sonra narıncı <HelpKey>Cavab ver</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Göndərilərkən düymədə fırlanan ikon görünür; uğurlu olanda mətn sahəsi boşalır və
            yeni mesaj lentin sonunda peyda olur. Bu, biletin <strong>ilk</strong> cavabıdırsa,
            <strong>İlk cavab</strong> KPI kartı yaşıla dönür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Yalnız komanda üçün qeyd yazmaq istəyirsinizsə, göndərmədən əvvəl{" "}
            <HelpKey>Daxili qeyd</HelpKey> düyməsini basın (düymə sarı haşiyə alır), sonra
            mətni yazıb <HelpKey>Cavab ver</HelpKey> ilə saxlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Daxili rejim aktivdirsə, sahənin placeholder-i «Daxili qeyd əlavə et...»-ə dəyişir
            və altda «Daxili qeyd — müştəriyə görünmür» xəbərdarlığı çıxır. Saxlanan daxili
            qeyd lentdə sarı fon + kilidli <strong>Daxili</strong> nişanı ilə görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Daxili qeydləri gizlətmək/göstərmək üçün kart başlığındakı{" "}
            <HelpKey>Daxili gizlət</HelpKey> / <HelpKey>Daxili göstər</HelpKey> açar-düyməsini
            işlədin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Gizlədəndə yalnız müştəriyə görünən mesajlar qalır və başlıqdakı say uyğun olaraq
            azalır; yenidən göstərəndə daxili qeydlər geri qayıdır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Da Vinci ilə cavab, xülasə və ya addımlar">
        <HelpStep n={1}>
          <p>
            Şərh sahəsinin altındakı düymələr sırasında, ayırıcıdan sonra dil seçicisi var
            (<HelpKey>RU</HelpKey> / <HelpKey>AZ</HelpKey> / <HelpKey>EN</HelpKey>). Da Vinci-nin
            hansı dildə yazacağını buradan seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş dil açılan siyahıda qalır; bütün Da Vinci nəticələri həmin dildə qaytarılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Müştəriyə cavab qaralaması üçün yaşıl <HelpKey>Da Vinci Cavab</HelpKey> düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymədə fırlanan ikon görünür, sonra hazırlanan mətn birbaşa yuxarıdakı{" "}
            <strong>cavab sahəsinə</strong> yerləşir. Mətni oxuyun/redaktə edin, sonra adi qaydada{" "}
            <HelpKey>Cavab ver</HelpKey> ilə göndərin — avtomatik göndərilmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Biletin qısa xülasəsi üçün <HelpKey>Xülasə</HelpKey>, addım-addım həll planı üçün{" "}
            <HelpKey>Addımlar</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Nəticə düymələrin altında ayrıca paneldə açılır — başlıqda «Da Vinci Xülasə» və ya
            «Da Vinci Addımlar» yazır, sağ küncdə isə bağlamaq üçün × var. Bu mətn cavab sahəsinə
            yazılmır; sırf oxumaq üçündür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: statusu və agenti dəyiş">
        <HelpStep n={1}>
          <p>
            Statusu tez dəyişmək üçün başlığın altındakı <strong>status borusunda</strong>{" "}
            istədiyiniz mərhələyə (məs. <HelpKey>İcrada</HelpKey> və ya{" "}
            <HelpKey>Həll edildi</HelpKey>) tıklayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz mərhələ rəngli işıqlanır, başlıqdakı status nişanı yenilənir. Bilet «Həll
            edildi» və ya «Bağlı» olanda SLA sayğacları geri saymağı dayandırır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Alternativ olaraq, aşağıdakı əməliyyat kartında status açılan siyahısından dəyər
            seçib mavi <HelpKey>Statusu yenilə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yalnız status həqiqətən dəyişəndə aktiv olur; yenilədikdən sonra həm bu siyahı,
            həm status borusu, həm də başlıq nişanı eyni dəyəri göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bileti başqa agentə vermək üçün təyinat açılan siyahısından istifadəçi seçin və
            narıncı <HelpKey>Yenidən təyin et</HelpKey> düyməsini basın. Özünüzə götürmək üçün
            başlıqdakı <HelpKey>Mənə təyin et</HelpKey>, sistemə avtomatik seçdirmək üçün isə{" "}
            <HelpKey>Avto</HelpKey> düyməsini işlədin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Təyinat dəyişəndən sonra sağ paneldəki <HelpKey>İnsanlar</HelpKey> kartında «Təyin
            edilib» sahəsi yeni agentin adını göstərir; siyahıda «— Təyin edilməyib —» seçilsə,
            bilet təyinatdan çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: mövzu və təsviri inline redaktə et">
        <HelpStep n={1}>
          <p>
            Solda əsas məzmun kartında <strong>mövzu başlığına</strong> tıklayın (üzərinə
            gələndə rəngi dəyişir, «Redaktə etmək üçün basın» ipucusu çıxır).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Başlıq mətn sahəsinə çevrilir, yanında <HelpKey>Saxla</HelpKey> və{" "}
            <HelpKey>Ləğv et</HelpKey> düymələri görünür. <kbd>Enter</kbd> saxlayır,{" "}
            <kbd>Esc</kbd> ləğv edir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Təsviri dəyişmək üçün təsvir blokuna tıklayın; açılan mətn sahəsində mətni
            düzəldib <HelpKey>Saxla</HelpKey> basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Təsvir avtomatik WhatsApp/veb-söhbət transkriptidirsə, adi mətn yerinə söhbət
            balonları (kanal + AI nişanları ilə) göstərilir; redaktə etmək üçün sağ üstdəki
            qələm ikonalı <HelpKey>Redaktə et</HelpKey> düyməsini basın.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: eskalasiya və ya şikayətə çevir">
        <HelpStep n={1}>
          <p>
            Prioriteti təcili etmək üçün başlıqdakı kəhrəba rəngli{" "}
            <HelpKey>Eskalasiya</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Prioritet «Kritik»-ə qalxır, prioritet KPI kartı qırmızıya dönür. Bilet artıq
            kritikdirsə (və ya həll edilib/bağlanıbsa) düymə deaktiv olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bileti rəsmi şikayət reyestrinə köçürmək üçün <HelpKey>Şikayətlərə</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Təsdiq pəncərəsi açılır; təsdiqlədikdən sonra şikayət səhifəsinə keçirilirsiniz.
            Bilet artıq şikayətdirsə, bunun yerinə <HelpKey>Şikayətlər reyestrindədir</HelpKey>{" "}
            keçidi görünür.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Şikayətə çevirmə <strong>geri qaytarılmazdır</strong> — bayrağı sonradan silmək
            mümkün olmayacaq. Yalnız bilet həqiqətən rəsmi şikayət reyestrinə düşməlidirsə bu
            əməliyyatı edin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: kontekst və qısayollardan istifadə et">
        <HelpStep n={1}>
          <p>
            Müştərinin tam mənzərəsini görmək üçün başlıqdakı <HelpKey>360</HelpKey>{" "}
            açar-düyməsini işlədin (yanıb-sönür).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sağ panelin başında <strong>Müştəri 360</strong> kartı açılır: əlaqə, şirkət və
            LTV, son tiketlər, açıq sövdələşmələr və son fəaliyyət. Kart başlığına tıklayaraq onu
            yığıb-aça bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sürətli işləmək üçün başlıqdakı klaviatura ikonasını basıb qısayollar panelini açın
            (və ya istənilən vaxt <kbd>?</kbd> düyməsini basın).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Klaviatura qısayolları» paneli açılır: <kbd>R</kbd> cavab, <kbd>N</kbd> daxili
            qeyd, <kbd>A</kbd> mənə təyin et, <kbd>E</kbd> eskalasiya, <kbd>X</kbd> bileti bağla,{" "}
            <kbd>J / →</kbd> növbəti bilet, <kbd>K / ←</kbd> əvvəlki bilet, <kbd>C</kbd> nömrəni
            kopyala, <kbd>Ctrl+1-9</kbd> makro tətbiq et.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Şərh lenti hər 8 saniyədən bir özü yenilənir — müştəri və ya başqa agent cavab
          yazanda səhifəni təzələmədən görəcəksiniz. Mətn sahəsinə yazdığınız hələ
          göndərilməmiş cavab bu zaman silinmir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bu səhifədə yalnız öz təşkilatınızın biletlərini, agentlərini və müştəri kontekstini
          görürsünüz — Müştəri 360, təyinat siyahısı və bilik bazası məqalələri hamısı sizin
          tenant-ınızla məhdudlaşır. <strong>Daxili qeydlər müştəriyə heç vaxt göndərilmir</strong>;
          müştəriyə yalnız adi cavablar (və e-poçt/messenger inteqrasiyaları) çatır.
        </p>
      </HelpCallout>
    </div>
  )
}
