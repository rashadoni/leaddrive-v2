"use client"

/**
 * Kanban lövhəsi — help article (Azerbaijani).
 * Yalnız /boards/[divisionId] səhifəsini əhatə edir: lövhə/siyahı/hesabat
 * tabları, sürüklə-burax köçürmə, kart ⋯ menyusu, filtrlər, yeni tapşırıq
 * yaratma və DONE sütununun pəncərələnmiş görünüşü. Lövhə YARATMA və sütun
 * konfiqurasiyası ayrı səhifələrdir (Lövhələr siyahısı + lövhə tənzimləmələri) —
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

export default function BoardViewHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Komanda lideri və ya tapşırıqlar üzərində işləyən nümayəndəsiniz"
        goal="Bir lövhənin işini Kanban kimi idarə etmək — tapşırıqları sütunlar üzrə hərəkət etdirmək, filtrləmək, yeni tapşırıq yaratmaq və hesabatlara baxmaq"
      >
        Səhifəyə <HelpKey>Lövhələr</HelpKey> siyahısından konkret lövhəni açmaqla
        çatırsınız. Yalnız sizə giriş verilmiş lövhələri görürsünüz — lövhə sizin üçün
        açıq deyilsə, açmağa çalışanda «Bu lövhəyə girişiniz yoxdur» mesajı çıxır. Burada
        nə görürsünüzsə — sütunlar, kartlar, saylar — hamısı bu lövhənin tapşırıqlarından
        oxunur, ona görə bir kartı köçürdükdə və ya redaktə etdikdə dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda lövhənin adı və yanında qısa <strong>açar</strong> nişanı durur (məs.
          KHS), onun üstündə isə geriyə <HelpKey>Lövhələr</HelpKey> siyahısına keçid var.
          Birdən çox lövhəniz varsa, adın yanında lövhədən-lövhəyə keçmək üçün açılan
          siyahı görünür. Sağ yuxarıda əməliyyat düymələri durur:{" "}
          <HelpKey>Yenilə</HelpKey> (dairəvi ox ikonası), yalnız adminlərə görünən{" "}
          <HelpKey>Konfiqurasiya</HelpKey> (dişli çarx ikonası), ixrac menyusu və narıncı{" "}
          <HelpKey>Yeni Tapşırıq</HelpKey> düyməsi.
        </p>
        <p>
          Başlığın altında üç tab var: <HelpKey>Lövhə</HelpKey>, <HelpKey>Siyahı</HelpKey>{" "}
          və <HelpKey>Hesabatlar</HelpKey>. <strong>Lövhə</strong> tabında üstdə yapışqan
          alət zolağı (filtrlər), altında isə sütunlar gəlir. Hər sütunun başında ad,
          yanında tapşırıq sayı və üst kənarında rəngli zolaq olur; içində tapşırıq
          kartları düzülür.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Lövhə (tab)">Kanban görünüşü — tapşırıqlar sütunlar üzrə kartlar kimi; sürüklə-burax ilə köçürülür.</HelpDef>
          <HelpDef term="Siyahı (tab)">Eyni tapşırıqların cədvəl görünüşü — sütunlar üzrə qruplaşmış sətirlər, sahələri sətir daxilində redaktə etmək olur.</HelpDef>
          <HelpDef term="Hesabatlar (tab)">Bu lövhənin tapşırıqları üzrə hesabatlar və operativ hesabat.</HelpDef>
          <HelpDef term="Sütun">Mərhələ (məs. BACKLOG, TO DO, IN PROGRESS, TESTING, REVIEW, DONE). Lövhənin sütunları fərdiləşdirilə bilər; başlıqdakı say o sütundakı tapşırıqların sayıdır.</HelpDef>
          <HelpDef term="Kart">Bir tapşırıq. Üstündə başlıq, tip nişanı, açar (məs. KHS-12), prioritet nişanı, varsa son tarix və icraçının avatarı görünür.</HelpDef>
          <HelpDef term="Açar (kartdakı)">Tapşırığın qısa kodu (məs. KHS-12) — onu sürətli axtarmaq və istinad etmək üçündür.</HelpDef>
          <HelpDef term="Rüb nişanı (Q1–Q4)">Karta rüb təyin edilibsə, üstündə narıncı Q nişanı çıxır və kart sarımtıl haşiyə ilə fərqlənir.</HelpDef>
        </dl>
        <p>
          Hər kartın üst-sağ küncündə üç-nöqtə (<HelpKey>⋯</HelpKey>) menyusu var — kartı
          açmadan status, prioritet, tip və icraçını dəyişmək üçün. Karta tapşırıq
          siyahısı (checklist) əlavə edilibsə, kartın altında faiz göstərən nazik tərəqqi
          zolağı görünür. <strong>DONE</strong> sütunu standart olaraq yalnız son 14 günün
          maksimum 10 tapşırığını göstərir; qalanı «+N daha çox tamamlanmış» düyməsi
          altında gizlənir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: tapşırığı sütundan-sütuna köçür">
        <HelpStep n={1}>
          <p>
            <HelpKey>Lövhə</HelpKey> tabında olduğunuzdan əmin olun. Köçürmək istədiyiniz
            kartı siçanla tutub başqa sütuna sürükləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sürükləyərkən kartın «qaldırılmış» surəti bir az əyilmiş halda kursoru izləyir,
            mənbə kart isə solğunlaşır. Üstündə dayandığınız sütun tündləşir və kənarı
            kəsik-kəsik haşiyə ilə işarələnir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Kartı hədəf sütunun üstündə buraxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart yeni sütuna yumşaq animasiya ilə oturur, hər iki sütunun başlığındakı say
            uyğun olaraq dəyişir. Bu mərhələ keçidi üçün icazəniz yoxdursa, kart əvvəlki
            yerinə qayıdır və aşağıda «Bu status keçidi üçün icazəniz yoxdur» bildirişi çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Kartı sadəcə <strong>kliklədikdə</strong> (sürükləmədən) tam tapşırıq pəncərəsi
            açılır. Köçürmə yalnız kartı bir az (təxminən 8 piksel) sürüklədikdən sonra
            başlayır — ona görə təsadüfi kliklə tapşırıq yerini dəyişməyəcək.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: kartı tez dəyiş (⋯ menyusu)">
        <HelpStep n={1}>
          <p>
            Kartın üst-sağ küncündəki üç-nöqtə (<HelpKey>⋯</HelpKey>) düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kiçik açılan menyu çıxır. Bölmələrə görə düzülür: <strong>Status</strong>{" "}
            (lövhənin sütunları), <strong>Priority</strong>, lövhədə tiplər varsa{" "}
            <strong>Type</strong>, event tipləri varsa <strong>Event type</strong> və{" "}
            <strong>Assignee</strong>. Cari seçimin yanında yaşıl ✓ işarəsi olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstədiyiniz dəyəri seçin — məsələn yeni prioritet və ya icraçı. İcraçı siyahısı
            ilk dəfə açılanda yüklənir; təyinatı götürmək üçün <HelpKey>Unassigned</HelpKey>
            seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçimdən sonra menyu bağlanır və kart yeni dəyəri əks etdirir (status seçsəniz,
            kart uyğun sütuna keçir). İcazəniz çatmasa, aşağıda «Bu tapşırığı redaktə etmək
            üçün icazəniz yoxdur» bildirişi çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni tapşırıq yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı narıncı <HelpKey>Yeni Tapşırıq</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni Tapşırıq» başlıqlı pəncərə açılır. İçində <strong>Başlıq</strong> sahəsi
            («Tapşırığın başlığı» köməkçi mətni ilə), yan-yana <strong>Tip</strong> və{" "}
            <strong>Prioritet</strong> açılan siyahıları, <strong>Təyin olunan</strong> və{" "}
            <strong>Rüb</strong> açılan siyahıları, sonda isə <strong>Son tarix</strong>{" "}
            tarix seçici var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Başlıq</strong> yazın — bu yeganə məcburi sahədir (ən azı 3, ən çox 200
            simvol). İstəyə bağlı olaraq tip, prioritet, icraçı, rüb və son tarix seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Başlıq çox qısa olduqca aşağıdakı <strong>Yarat</strong> düyməsi solğun və
            qeyri-aktiv qalır. Prioritet standart olaraq «Medium»dur. İcraçı və rüb siyahısı
            «—» (boş) ilə başlayır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Aşağıdakı <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey>, sağ yuxarıdakı × və ya pəncərədən kənara klik ilə
            bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Yaradılır…» yazısına keçir, sonra pəncərə bağlanır və yeni tapşırıq
            lövhədə <strong>BACKLOG</strong> sütununda peyda olur (yeni tapşırıqlar bu
            mərhələdə başlayır). Server xəta qaytarsa, pəncərənin içində qırmızı izah mətni
            görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: filtrlə və axtar">
        <HelpStep n={1}>
          <p>
            <HelpKey>Lövhə</HelpKey> tabında alət zolağındakı{" "}
            <HelpKey>Mənə təyin olunanlar</HelpKey> və ya{" "}
            <HelpKey>Mənim yaratdıqlarım</HelpKey> pillələrini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Aktiv pillə narıncı çərçivə ilə işıqlanır və sütunlar yalnız sizə təyin olunmuş
            (və ya sizin yaratdığınız) tapşırıqları göstərir; sütun saylarınız da uyğun
            azalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Adına və ya açarına görə süzmək üçün <HelpKey>Axtar</HelpKey> qutusuna yazın.
            Daha dəqiq süzmək üçün <HelpKey>Tip</HelpKey>, <HelpKey>Event</HelpKey>,{" "}
            <HelpKey>Prioritet</HelpKey> və <HelpKey>Təyin olunan</HelpKey> açılan
            siyahılarından dəyər seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Lövhə yazdıqca dərhal süzülür. <strong>Təyin olunan</strong> siyahısında yalnız
            bu lövhənin tapşırıqlarında icraçı olan istifadəçilər çıxır. Seçdiyiniz filtrlər
            ünvan sətrində saxlanır — linki paylaşsanız və ya səhifəni yeniləsəniz, eyni
            filtrlər qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Filtri götürmək üçün açılan siyahını ilk («Tip», «Prioritet» və s. yazan boş)
            variantına qaytarın, axtarış qutusunu təmizləyin və ya pillələri yenidən basıb
            söndürün.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Süzgəc götürüldükcə gizlənmiş kartlar geri qayıdır və sütun sayları bütün
            tapşırıqları əks etdirir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: tapşırığı aç və DONE sütununu genişləndir">
        <HelpStep n={1}>
          <p>
            İstənilən kartı bir dəfə basın (sürükləmədən).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Lövhənin üstündə tam tapşırıq pəncərəsi açılır — orada başlıq, status, icraçı və
            digər sahələri redaktə edə bilərsiniz. Pəncərəni × ilə və ya kənara klik ilə
            bağladıqda lövhə son dəyişiklikləri əks etdirir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>DONE</strong> sütununda daha çox tamamlanmış tapşırıq görmək üçün{" "}
            <HelpKey>+N daha çox tamamlanmış — hamısını göstər ↓</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sütun yerindəcə açılır və bütün tamamlanmış tapşırıqları göstərir; düymə{" "}
            <HelpKey>Yığ ↑</HelpKey> formasına keçir, onunla yenidən son 14 günün
            görünüşünə qayıdırsınız.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Lövhə və Siyahı tabları eyni tapşırıqları göstərir — sadəcə fərqli baxışdır.
          Kartları sürükləməyi sevmirsinizsə, <HelpKey>Siyahı</HelpKey> tabına keçin və
          statusu cədvəlin içində dəyişin; tapşırıq lövhədə də uyğun sütuna keçəcək.
          Lövhə fokusunu itirib geri qayıdanda tapşırıqlar avtomatik yenilənir, amma əmin
          olmaq üçün istənilən vaxt <HelpKey>Yenilə</HelpKey> düyməsini basa bilərsiniz.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Köçürmə və ya redaktə bəzən geri qaytarıla bilər: server icazə vermirsə (məsələn
          o status keçidi sizə qadağandırsa), dəyişiklik avtomatik geri alınır və ekranın
          aşağısında qısa bildiriş göstərilir. Belə olduqda dəyişikliyin tətbiq olunduğunu
          düşünməyin — bildirişi oxuyun.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Yalnız sizə giriş verilmiş lövhələri görürsünüz; başqa lövhənin tapşırıqları sizə
          görünmür. <strong>Konfiqurasiya</strong> (dişli çarx) düyməsi yalnız lövhə
          adminlərinə — menecer, admin və superadmin rollarına — göstərilir. Sütunlar arası
          köçürmə və redaktə də serverdə icazəyə görə yoxlanılır, ona görə düymə görünsə
          belə, icazəniz çatmayan dəyişiklik rədd edilir.
        </p>
      </HelpCallout>
    </div>
  )
}
