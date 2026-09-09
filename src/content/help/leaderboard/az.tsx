"use client"

/**
 * KPI Arena (leaderboard) — help article (Azerbaijani).
 * Yalnız /leaderboard səhifəsini əhatə edir: şöbə tabları, dövr seçici,
 * Qabarcıqlar/Siyahı görünüş keçidi, leqenda, agent detal paneli (sürüşən
 * çekmece). Lövhələrin necə hesablandığını tənzimləyən səhifə AYRIDIR
 * (Tənzimləmələr → KPI Arena tənzimləməsi) və bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function LeaderboardHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Komanda rəhbəri, satış və ya əməliyyat menecerisiniz"
        goal="Komandanın canlı KPI mənzərəsini görmək — kim hədəfini üstələyir, kim geri qalır — və bir agentin rəqəminin arxasında duran işi açıb baxmaq"
      >
        Səhifə <HelpKey>KPI Arena</HelpKey> adlanır və tam qara fonda canlı «qabarcıq»
        reytinqi göstərir. Hansı şöbə tablarını görəcəyiniz icazələrinizdən asılıdır:
        menecer bütün lövhələri görə bilər, adi istifadəçi isə yalnız öz şöbəsini.
        Bütün rəqəmlər yalnız sizin təşkilatınız üzrədir və canlı yenilənir — heç nə
        əl ilə yadda saxlanmır, açıb baxmaq üçün səhifədir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda kubok ikonası ilə <HelpKey>KPI Arena</HelpKey> adı və altında qısa
          izah durur. Altında bir-bir aşağıdakı idarəetmə zolaqları gəlir:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Şöbə tabları">
            Lövhəni dəyişən seqment düymələr — <strong>Satış</strong>,{" "}
            <strong>Sahə agentləri</strong>, <strong>Dəstək</strong>,{" "}
            <strong>Layihələr</strong>, <strong>Tapşırıqlar</strong>. Yalnız sizə
            açıq olan şöbələr görünür; əgər heç biri açıq deyilsə, bu zolaq ümumiyyətlə
            görünmür.
          </HelpDef>
          <HelpDef term="Dövr seçici">
            Vaxt pəncərəsini dəyişir: <strong>Gün</strong>, <strong>Həftə</strong>,{" "}
            <strong>Ay</strong> (standart), <strong>Rüb</strong>, <strong>İl</strong>,{" "}
            <strong>Bütün vaxt</strong>.
          </HelpDef>
          <HelpDef term="Leqenda">
            Rəng və ölçünün nə demək olduğunu izah edir: «Rəng + ölçü = KPI %», status
            çalarları (Üstələyir → Qrafikdə → Geri qalır → Risk altında → Kritik) və
            «daha böyük = 100%-ə yaxın» ipucusu. Yalnız qabarcıq görünüşündə çıxır.
          </HelpDef>
          <HelpDef term="Görünüş keçidi">
            <strong>Qabarcıqlar</strong> ↔ <strong>Siyahı</strong> arasında keçir. Hər
            təzə açılışda səhifə həmişə Qabarcıqlardan başlayır.
          </HelpDef>
          <HelpDef term="Qabarcıq">
            Bir agent. Ölçü = iş həcmi, rəng və içindəki rəqəm = agentin KPI hədəfinə
            neçə faiz çatdığı.
          </HelpDef>
          <HelpDef term="KPI %">
            Agentin hədəfə nə qədər çatdığını bildirən baş rəqəm. Satışda bu kvota
            icrası, sahə agentlərində uyğunluq, dəstəkdə SLA, layihə və tapşırıqlarda
            vaxtında çatdırılma deməkdir.
          </HelpDef>
        </dl>
        <p>
          Lövhədə hələ məlumat yoxdursa, qabarcıq sahəsinin yerinə kubok ikonası ilə
          «Bu qrup və dövr üçün hələ məlumat yoxdur.» mətni göstərilir. Satış tabı
          seçildikdə dövr zolağının yanında «Satış rüb üzrə hesablanır» qeydi çıxır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: lövhəni oxu və agentə bax">
        <HelpStep n={1}>
          <p>
            Yuxarıdakı şöbə tablarından birini basın (məs.{" "}
            <HelpKey>Satış</HelpKey> və ya <HelpKey>Sahə agentləri</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş tab vurğulanır və qabarcıq sahəsi həmin şöbənin agentləri ilə
            yenidən yüklənir. Məlumat gələnə qədər qısa müddət skelet (yüklənmə)
            görüntüsü çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Dövr seçicidən bir vaxt pəncərəsi seçin — məsələn{" "}
            <HelpKey>Ay</HelpKey> və ya <HelpKey>Rüb</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qabarcıqlar yeni dövrə görə yenidən hesablanır; ölçü və rənglər dəyişir.
            Satış tabında dövrün yanında «Satış rüb üzrə hesablanır» qeydi qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Agentin təfərrüatını görmək üçün onun qabarcığına klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sağdan açıq (işıqlı) bir panel sürüşüb gəlir. Yuxarıda agentin avatarı,
            adı, «#sıra · status» sətri; altında böyük <strong>KPI %</strong> və «KPI
            hədəfindən» yazısı durur. Onun altında «niyə bu %» sətri sürücü metrikanı
            adlandırır (satışda əlavə olaraq «sövdə məbləği / kvota» rəqəmi göstərilir).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Panelin içində aşağıya enin — metrika gridi və onun altında bu faizin
            arxasında duran tamamlanmış iş siyahısı var.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İki sütunlu metrika gridi (məs. sövdə məbləği, kvota, icra; və ya
            ziyarətlər, foto təsdiqi, marşrut icrası). Altda işin özü sadalanır —
            sövdələr / müraciətlər / tapşırıqlar / layihələr; hər sətirdə başlıq, varsa
            məbləğ, vaxtında üçün yaşıl <strong>✓</strong>, gecikmiş üçün sarı saat
            ikonası və tarix. Çox elementdirsə, başlıqda say yanında «+» işarəsi olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Paneli bağlamaq üçün × ikonasını basın, kənardakı tutqun sahəyə klikləyin
            və ya <HelpKey>Esc</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Panel sağa sürüşüb gizlənir və yenidən tam lövhəni görürsünüz. Başqa
            qabarcığa klikləsəniz, panel həmin yeni agentin məlumatı ilə yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Siyahı görünüşünə keç və sırala">
        <HelpStep n={1}>
          <p>
            Sağdakı görünüş keçidində <HelpKey>Siyahı</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Üzən qabarcıqlar sıralı cədvəllə əvəz olunur. Sütunlar:{" "}
            <strong>#</strong> (sıra), <strong>Agent</strong> (avatar + ad),{" "}
            <strong>KPI</strong> (faiz), <strong>Status</strong> (nişan + ad) və{" "}
            <strong>Həcm</strong>. Yuxarıda «Agent axtar…» sahəsi də var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstənilən sütunun başlığına klikləyərək sıralayın və ya axtarış sahəsinə
            ad yazaraq filtrlə­yin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sətirlər seçdiyiniz sütuna görə yenidən düzülür; axtarış yazdıqca cədvəl
            yalnız uyğun agentləri saxlayır. Cədvəl səhifələnir (səhifədə 20 agent).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bir agentin sətrinə klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qabarcıqlardakı ilə eyni sağ panel açılır — eyni KPI %, metrika gridi və
            iş siyahısı. Geri Qabarcıqlara qayıtmaq üçün keçiddə{" "}
            <HelpKey>Qabarcıqlar</HelpKey> düyməsini basın.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Lövhə özü canlıdır: hər 30 saniyədən bir səssiz yenilənir, həm də başqa
          tabda iş bitirib bu səhifəyə qayıdanda dərhal təzələnir. Beləliklə təzələmək
          üçün səhifəni yeniləməyə ehtiyac yoxdur — rəqəmlər öz-özünə dəyişir.
        </p>
      </HelpCallout>

      <HelpCallout kind="tip">
        <p>
          Rəngləri belə oxuyun: yaşıla yaxın = hədəfi üstələyir, qırmızıya yaxın = çox
          geri qalır. Ölçü isə həcmdir — böyük qabarcıq çox iş, kiçik qabarcıq az iş
          deməkdir. Tam izah üçün qabarcıq görünüşündə soldakı leqendaya baxın.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu səhifə yalnız <strong>baxış</strong> üçündür — burada KPI-ləri necə
          hesablandığını dəyişə bilməzsiniz. Çəkiləri və status həddlərini tənzimləmək
          istəyirsinizsə, ayrıca <HelpKey>KPI Arena tənzimləməsi</HelpKey> səhifəsinə
          keçin (Tənzimləmələr bölməsində). Satış lövhəsi həmişə öz kvota məntiqi ilə
          işləyir və oradan dəyişmir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün reytinq yalnız sizin təşkilatınızın məlumatından qurulur. Hansı şöbə
          tablarının görünməsi icazələrinizlə (RBAC + modul) müəyyən olunur: menecer
          olmayan istifadəçi yalnız öz şöbəsini görür, başqa təşkilatın agentlərini isə
          ümumiyyətlə görmür.
        </p>
      </HelpCallout>
    </div>
  )
}
