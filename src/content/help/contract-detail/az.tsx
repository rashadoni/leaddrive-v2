"use client"

/**
 * Contract detail (record) page — help article (Azerbaijani).
 * Müqavilə kartının (bir müqavilənin) iş axınını əhatə edir:
 * başlıq + əməliyyat düymələri, statistika kartları, Detallar,
 * Razılaşma zənciri, Versiya tarixi + AI Redlayn, Elektron imza,
 * Kənarlaşmalar, Gəlirin tanınması, AI Analizi + Risk, Mərhələlər,
 * Sənədə bax / Düzəliş dialoqları. SİYAHI səhifəsi (contracts) bura
 * DAXİL DEYİL — o ayrı "contracts" məqaləsidir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ContractDetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış, hüquq və ya maliyyə üzrə işçisiniz və konkret bir müqavilə ilə işləyirsiniz"
        goal="Bir müqavilə kartını açmaq, bütün bölmələri oxumaq və əsas əməliyyatları aparmaq: razılaşmaya göndərmək, imza üçün göndərmək, düzəliş etmək, mərhələ və risk izləmək"
      >
        Bu səhifəyə müqavilələr siyahısında bir sətrə klikləməklə (və ya birbaşa
        müqavilə linkindən) düşürsünüz. Yuxarı sol küncdə geriyə (<HelpKey>←</HelpKey>) düyməsi
        sizi siyahıya qaytarır. Bütün məlumat və əməliyyatlar yalnız sizin təşkilatınıza aiddir;
        bəzi panellər (Gəlirin tanınması, Hesab-faktura yaratma, Yenidən indeksləmə) yalnız
        <strong> admin / superadmin / menecer</strong> rollarına görünür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda sənəd ikonası, müqavilənin başlığı, altında müqavilə nömrəsi və rəngli{" "}
          <strong>status nişanı</strong> (məs. <em>Qaralama</em>, <em>Təsdiqlənmə gözlənilir</em>,{" "}
          <em>Aktiv</em>) durur. Müqavilə qəbul edilmiş təklifdən avtomatik yaradılıbsa, nömrənin
          altında yaşıl «mənbəyə bax» çipi görünür. Sağ yuxarıda əməliyyat düymələri var: status
          uyğundursa <HelpKey>Razılaşmaya göndər</HelpKey>, redaktə üçün <HelpKey>Redaktoru aç</HelpKey>,{" "}
          <HelpKey>Sənədə bax</HelpKey> və üç nöqtəli (<HelpKey>⋯</HelpKey>) «Digər əməliyyatlar» menyusu.
        </p>
        <p>
          Başlığın altında dörd statistika kartı sıralanır: <strong>Aktiv günlər</strong>,{" "}
          <strong>Dəyər</strong>, <strong>Növ</strong> və <strong>Qalan günlər</strong>. Daha aşağıda
          bir-bir kartlar (panellər) gəlir: <strong>Detallar</strong>, varsa{" "}
          <strong>Razılaşma zənciri</strong>, <strong>Versiya Tarixi</strong>, iki+ versiya olduqda{" "}
          <strong>AI Redlayn</strong>, <strong>Elektron İmza</strong>, <strong>Kənarlaşmalar</strong>,
          (maliyyə istifadəçilərinə) <strong>Gəlirin tanınması</strong>, <strong>AI Analizi</strong>,{" "}
          <strong>Playbuk üzrə Risk Qiymətləndirməsi</strong>, (maliyyəyə){" "}
          <strong>AI Axtarış İndeksi</strong> və <strong>Mərhələlər</strong>.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status nişanı">Müqavilənin mərhələsini göstərir (Qaralama, Təsdiqlənmə gözlənilir, Aktiv, Müddəti bitib və s.) — başlıqda və Detallar kartında təkrarlanır.</HelpDef>
          <HelpDef term="Razılaşma zənciri">Müqaviləni təsdiqdən keçirmək üçün mərhələlər — yalnız siz müqaviləni razılaşmaya göndərdikdən sonra peyda olur.</HelpDef>
          <HelpDef term="Versiya">Müqavilə mətninin saxlanmış bir anlıq surəti (nömrə, mənbə, tarix, məzmun heşi). Düzəliş və imza yeni versiya yaradır.</HelpDef>
          <HelpDef term="AI Redlayn">İki versiya arasında bənd səviyyəsində dəyişikliklərin AI ilə müqayisəsi (əlavə / silinmiş / dəyişdirilmiş).</HelpDef>
          <HelpDef term="Konvert (Elektron imza)">İmzalayanlara göndərilən imza paketi — hər imzalayanın öz statusu olur.</HelpDef>
          <HelpDef term="Kənarlaşma">Müqavilə bəndinin standartdan (playbukdan) sapması — kritik / xəbərdarlıq / məlumat səviyyəli bayraq.</HelpDef>
          <HelpDef term="İcra öhdəliyi (Gəlirin tanınması)">Müqavilə üzrə çatdırılacaq element və onun gəlirinin necə tanınması (müəyyən anda, bərabər, mərhələlərlə, istifadəyə görə).</HelpDef>
          <HelpDef term="Mərhələ">Müqavilənin son tarixli çatdırılma və ya ödəniş nöqtəsi — status və məsulu olan.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: müqaviləni razılaşmaya göndər">
        <HelpStep n={1}>
          <p>
            Müqavilə <strong>Qaralama</strong> statusundadırsa, sağ yuxarıda mavi{" "}
            <HelpKey>Razılaşmaya göndər</HelpKey> düyməsi görünür — onu basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Razılaşmaya göndər» başlıqlı pəncərə açılır. Yuxarıda «Razılaşma mərhələlərini əlavə
            edin. Hər mərhələ ardıcıl keçiriləcək» izahı, altında isə bir mərhələ bloku var. Mətndə
            hələ doldurulmamış <HelpKey>{"{{dəyişən}}"}</HelpKey> qalıbsa, düymə pəncərə yerinə qırmızı
            xəbərdarlıq göstərir və əvvəlcə həmin dəyişənləri doldurmağı tələb edir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Hər mərhələdə <strong>ad</strong> yazın (məs. «Menecer, Hüquqşünas, CFO»), istəsəniz{" "}
            <strong>SLA saat</strong> sahəsini doldurun, və <strong>rejim</strong> seçin:{" "}
            <HelpKey>Hamı təsdiqləməlidir</HelpKey>, <HelpKey>Biri kifayətdir</HelpKey> və ya{" "}
            <HelpKey>Kvorum</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Kvorum» seçəndə yanında neçə təsdiqin kifayət etdiyini soruşan kiçik rəqəm sahəsi açılır
            (1-dən təsdiqləyənlərin sayına qədər). Mərhələ daxilində <HelpKey>Təsdiqdən əlavə et</HelpKey>{" "}
            ilə rol (məs. <em>admin / manager</em>) əlavə edə bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Lazım olsa aşağıdakı <HelpKey>Mərhələ əlavə et</HelpKey> ilə daha çox mərhələ (5-ə qədər)
            əlavə edin, sonra alt sağda <HelpKey>Razılaşmaya göndər</HelpKey> düyməsi ilə təsdiqləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Göndərilir…» yazısına keçir, pəncərə bağlanır və səhifədə yeni{" "}
            <strong>Razılaşma zənciri</strong> kartı peyda olur — hər mərhələ rejimi, SLA-sı və
            statusu (gözləyir / təsdiqlənib / rədd) ilə. Müqavilənin statusu da yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Siz təsdiqləyici rolundasınızsa və mərhələ növbədədirsə, həmin sətirdə yaşıl{" "}
            <HelpKey>Təsdiqlə</HelpKey> və qırmızı <HelpKey>Rədd et</HelpKey> düymələri görünür — uyğun
            olanını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qərardan sonra həmin sətrin statusu yenilənir; zəncir növbəti mərhələyə keçir. Növbəsi
            çatmamış mərhələdə düymələr görünmür — üzərinə gələndə «növbəsini gözləyir» izahı çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: imza üçün göndər (elektron imza)">
        <HelpStep n={1}>
          <p>
            <strong>Elektron İmza</strong> kartında sağ yuxarıdakı <HelpKey>İmza üçün göndər</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «İmza üçün göndər» pəncərəsi açılır. <strong>Mövzu</strong> sahəsi müqavilə başlığı ilə
            əvvəlcədən doldurulur, altında istəyə bağlı <strong>Mesaj</strong> və{" "}
            <strong>İmzalayanlar</strong> siyahısı var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Hər imzalayan üçün <strong>ad</strong>, <strong>e-poçt</strong> yazın və rol seçin:{" "}
            <HelpKey>İmzalayan</HelpKey> və ya <HelpKey>Surət</HelpKey>. Daha çox şəxs üçün{" "}
            <HelpKey>İmzalayan əlavə et</HelpKey> ilə sətir əlavə edin (10-a qədər).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Pəncərənin altında «İmza linkləri növbəti addımda göstəriləcək — birbaşa kopyalaya
            bilərsiniz. E-poçt çatdırılması zəmanətsizdir» qeydi durur. Ad və ya e-poçt boş qalsa,
            qırmızı xəta mesajı göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Alt sağdakı <HelpKey>İmza üçün göndər</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «İmza üçün göndərildi» bildirişi çıxır, ardınca <strong>İmza Linkləri</strong> pəncərəsi
            açılır — hər imzalayan üçün <HelpKey>Linki kopyala</HelpKey> düyməsi ilə. Bağladıqdan sonra
            yeni konvert <strong>Elektron İmza</strong> kartında status və imzalayan siyahısı ilə görünür.
            Konvertləri <HelpKey>↻</HelpKey> (yenilə) düyməsi ilə təzələyə bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: müqaviləyə düzəliş et (yeni versiya)">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıda üç nöqtəli <HelpKey>⋯</HelpKey> menyusunu açın və <HelpKey>Düzəliş</HelpKey>{" "}
            seçin. (Bu seçim yalnız uyğun statuslarda — qaralama, təsdiq gözləyən, aktiv, təsdiqlənmiş,
            imzalanmış — görünür.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Müqaviləyə düzəliş et» pəncərəsi açılır; mətn sahəsi cari sənədlə doludur. Yuxarıda izah
            var: cari imzalanmış versiya tarixdə saxlanılır; düzəliş kanonik olması üçün sonradan təsdiq
            və yenidən imza tələb olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Düzəldilmiş sənəd</strong> mətnini redaktə edin; istəsəniz başlığı və ya bir sətirlik{" "}
            <strong>Dəyişiklik qeydi</strong> əlavə edin. Sonra <HelpKey>Yadda saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yadda saxlandıqdan sonra pəncərə bağlanır və <strong>Versiya Tarixi</strong> kartında yeni
            versiya (mənbə: <em>amendment / düzəliş</em>) əlavə olunur. Mətn boş buraxılarsa yadda
            saxlama bloklanır və qırmızı xəbərdarlıq çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: versiyaları müqayisə et və AI redlayn yarat">
        <HelpStep n={1}>
          <p>
            <strong>Versiya Tarixi</strong> kartında ən azı iki versiya varsa, aşağıda{" "}
            <HelpKey>Dən</HelpKey> və <HelpKey>A</HelpKey> açılan siyahıları görünür. İki müxtəlif versiya
            seçib <HelpKey>Müqayisə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sətir-sətir fərq pəncərəsi açılır: silinənlər qırmızı «−», əlavələr yaşıl «+» kimi
            işarələnir. Sənəd çox böyükdürsə, «çox böyük» mesajı və əvəzində <HelpKey>PDF yüklə</HelpKey>{" "}
            təklifi göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Daha dərin təhlil üçün <strong>AI Redlayn</strong> kartında iki versiya seçin (standart
            olaraq ən son ikisi seçilir) və <HelpKey>AI Redlayn Yarat</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Yaradılır…» rejiminə keçir, sonra ümumi qiymətləndirmə və «Bənd dəyişiklikləri»
            siyahısı çıxır — hər biri əlavə / silinmiş / dəyişdirilmiş və ciddilik rəngi ilə. Fərq
            yoxdursa «maddi fərq aşkar edilmədi» mesajı görünür; altda model adı, dəyər və tarix qeyd olunur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: AI analizi və playbuk üzrə risk">
        <HelpStep n={1}>
          <p>
            <strong>AI Analizi</strong> kartında <HelpKey>Bəndləri və öhdəlikləri çıxar</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Çıxarılır…» gözləmə vəziyyətindən sonra <strong>Bəndlər</strong> və{" "}
            <strong>Öhdəliklər</strong> siyahıları görünür — hər bənddə kateqoriya və risk nişanı, hər
            öhdəlikdə tərəf, son tarix və şərt. Üstdə model, vaxt və token məlumatı qeyd olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Çıxarılma tamamlandıqdan sonra <strong>Playbuk üzrə Risk Qiymətləndirməsi</strong> kartında{" "}
            <HelpKey>Playbuk üzrə riski qiymətləndir</HelpKey> düyməsi aktivləşir — onu basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Başlıqda ümumi risk nişanı (aşağı / orta / yüksək) və bənd-bənd risk qiymətləri çıxır.
            Yeni kənarlaşma bayraqları yaranıbsa, onların sayı göstərilir və «yuxarıdakı Kənarlaşmalar
            panelini görün» ipucusu əlavə olunur. Düymə çıxarılma tamamlanmayınca söndürülü qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Kənarlaşmalar</strong> kartında bayraqlanmış bəndlər siyahısında{" "}
            <HelpKey>Təsdiqlə</HelpKey> (qəbul et) və ya <HelpKey>Riski qəbul et</HelpKey> düymələrindən
            birini basın. <HelpKey>Yenidən skan et</HelpKey> bayraqları yeniləyir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Riski qəbul et» basanda səbəb soruşan kiçik pəncərə açılır. Qərardan sonra bayrağın
            statusu (bayraqlandı → təsdiqləndi / qəbul edildi) dəyişir. Heç kənarlaşma yoxdursa
            «kənarlaşma aşkar edilmədi» mesajı göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: mərhələ izlə (və sənədə bax)">
        <HelpStep n={1}>
          <p>
            <strong>Mərhələlər</strong> kartında <HelpKey>Mərhələ əlavə et</HelpKey> düyməsini basın, sonra{" "}
            <strong>Ad</strong> və <strong>Son tarix</strong> (məcburi), istəyə bağlı təsvir, status və
            məsul yazıb <HelpKey>Yadda saxla</HelpKey> ilə təsdiqləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yeni mərhələ kartda görünür; son tarixi keçmiş və tamamlanmamış mərhələ qırmızı «Vaxtı
            keçib» nişanı alır. Hər mərhələdə <HelpKey>Tamamlandı kimi işarələ</HelpKey>,{" "}
            <HelpKey>Redaktə et</HelpKey> və <HelpKey>Sil</HelpKey> düymələri var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Müqavilə mətnini oxumaq üçün sağ yuxarıdakı <HelpKey>Sənədə bax</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tam mətn pəncərədə göstərilir; altda <HelpKey>PDF yüklə</HelpKey> düyməsi var. Mətn hələ
            yoxdursa «Bu müqavilənin hələ mətni yoxdur. Şablondan yaradın və ya fayl yükləyin» qeydi çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Maliyyə istifadəçiləri (admin / superadmin / menecer) əlavə olaraq{" "}
          <strong>Gəlirin tanınması</strong> panelini görür: orada <HelpKey>Öhdəlik əlavə et</HelpKey> ilə
          icra öhdəliyi (təsvir, tanınma metodu, dövr, lazımdırsa mərhələlər) yaradır,{" "}
          <HelpKey>Bölgüsü yenidən hesabla</HelpKey> ilə cədvəli yeniləyirsiniz. Eyni istifadəçilər ⋯
          menyusundan <HelpKey>Hesab-faktura yarat</HelpKey> və <strong>AI Axtarış İndeksi</strong>{" "}
          panelindən <HelpKey>AI Axtarışı üçün Yenidən İndekslə</HelpKey> əməliyyatlarına çıxış əldə edir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          ⋯ menyusundakı <HelpKey>Kontraktı sil</HelpKey> geri qaytarılmır və müqavilə ilə bağlı bütün
          məlumatı (versiyalar, konvertlər, mərhələlər) aparır. Müqaviləni sadəcə dayandırmaq
          istəyirsinizsə, silmək yerinə statusu redaktə edin və ya razılaşma/imza axınını ləğv edin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün müqavilə məlumatı təşkilatınızla məhdudlaşır — başqa tenant-ın müqaviləsini görmür və
          dəyişə bilmirsiniz. Razılaşma təsdiqi üçün yalnız uyğun rol və ya təyinatlı istifadəçilər
          təsdiq/rədd düymələrini görür; server hər qərarı yenidən yoxlayır. Gəlirin tanınması,
          Hesab-faktura yaratma və Yenidən indeksləmə yalnız admin / superadmin / menecer rollarına açıqdır.
        </p>
      </HelpCallout>
    </div>
  )
}
