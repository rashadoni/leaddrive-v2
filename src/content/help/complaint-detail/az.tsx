"use client"

/**
 * Şikayət kartı (detal səhifəsi) — help article (Azerbaijani).
 * Reyestrdəki bir qeydi açanda görünən səhifə: başlıqdakı status/risk
 * nişanları, statusu dəyişən əməliyyat düymələri (İşə götür / Bağla ok /
 * not ok / sil), müştəri-müraciət-məhsul-təyinat info kartları, məzmun,
 * dəyişiklik tarixçəsi və müştəriyə cavab bloku. Reyestr siyahısı,
 * yeni qeyd yaratma və idxal bura DAXİL DEYİL (onlar ayrı məqalələrdir).
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ComplaintDetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Müştəri xidməti və ya keyfiyyət nəzarəti əməkdaşısınız"
        goal="Bir şikayət/təklif qeydini açıb statusunu dəyişmək, məlumatları yoxlamaq və müştəriyə cavab yazmaq"
      >
        Bu səhifəyə şikayət reyestrindən (<HelpKey>Şikayət və təkliflər reyestri</HelpKey>) bir
        sətirə basanda keçirsiniz. Yuxarı solda <HelpKey>Reyestrə qayıt</HelpKey> keçidi var. Bütün
        məlumatlar yalnız sizin təşkilatınıza aiddir. Səhifə yalnız oxuyub-redaktə deyil — burada
        statusu birbaşa dəyişir və müştəriyə cavab göndərirsiniz.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlığın üstündə monospace formatında qeyd nömrəsi durur — köhnə reyestrdən gələn{" "}
          <strong>№</strong> varsa o, yoxdursa daxili bilet nömrəsi göstərilir. Altda şikayətin
          mövzusu iri başlıq kimi, onun altında isə nişanlar sırası gəlir: cari <strong>status</strong>{" "}
          nişanı, varsa rəngli <strong>risk: …</strong> nişanı (yüksək — qırmızı, orta — sarı, aşağı —
          yaşıl) və qeyd təklifdirsə <strong>təklif</strong> nişanı. Sağ tərəfdə əməliyyat düymələri
          dayanır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status nişanı">Qeydin cari vəziyyəti: Açıq, İşdədir, Həll olundu və ya Bağlı.</HelpDef>
          <HelpDef term="risk: …">Risk səviyyəsi nişanı — yalnız risk təyin edilibsə görünür; rəng səviyyəni bildirir.</HelpDef>
          <HelpDef term="təklif">Qeyd şikayət yox, təklif növündədirsə əlavə olunan nişan.</HelpDef>
          <HelpDef term="Müştəri kartı">Müraciət edən şəxsin Ad Soyad, Telefon və E-mail-i.</HelpDef>
          <HelpDef term="Müraciət kartı">Mənbə, qeydin yaradılma tarixi və Məsul şəxs.</HelpDef>
          <HelpDef term="Məhsul kartı">Marka, İstehsal sahəsi, Kateqoriya, Obyekt və Obyekt 2.</HelpDef>
          <HelpDef term="Təyinat kartı">Məsul şöbə, Prioritet və Risk səviyyəsi.</HelpDef>
          <HelpDef term="Məzmun">Müştərinin müraciətinin tam mətni (Şikayət məzmunu).</HelpDef>
          <HelpDef term="Dəyişiklik tarixçəsi">Qeyd üzərində kim nə vaxt nə dəyişib — yalnız tarixçə varsa görünür.</HelpDef>
          <HelpDef term="Cavab">Müştəriyə yönəlik (daxili olmayan) cavablar və yeni cavab yazma sahəsi.</HelpDef>
        </dl>
        <p>
          Məlumat kartları iki sütunlu şəbəkə kimi düzülür: <strong>Müştəri</strong>,{" "}
          <strong>Müraciət</strong>, <strong>Məhsul</strong> və <strong>Təyinat</strong>. Hər sətirdə
          solda etiket, sağda dəyər var; dəyər boşdursa «—» tire görünür. Onların altında tam enli{" "}
          <strong>Məzmun (Şikayət məzmunu)</strong> kartı, sonra (varsa) <strong>Dəyişiklik tarixçəsi</strong>,
          ən sonda isə <strong>Cavab</strong> bloku gəlir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: statusu dəyiş">
        <HelpStep n={1}>
          <p>
            Qeyd üzərində işə başladığınızı bildirmək üçün sağ yuxarıdakı{" "}
            <HelpKey>İşə götür</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Status nişanı <strong>İşdədir</strong>-ə dəyişir və səhifə yenilənir. Bu düymə yalnız qeyd
            hələ işdə və ya həll olunmamışkən görünür — onsuz da işdədirsə, düymə artıq göstərilmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Şikayət uğurla həll olunubsa <HelpKey>Bağla ok</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Status nişanı <strong>Həll olundu</strong>-a keçir. Qeyd onsuz da həll olunubsa, bu düymə
            görünmür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Məsələ daha yuxarı səviyyəyə qaldırılmalıdırsa (eskalasiya) <HelpKey>not ok</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qeyd eskalasiya vəziyyətinə keçir və səhifə yenidən yüklənir. Bu düymə yalnız qeyd hələ
            eskalasiya olunmayıbsa görünür.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Hansı düymələrin göründüyü cari statusdan asılıdır — sistem yalnız məntiqli keçidləri
            təklif edir. Məsələn, qeyd artıq «Həll olundu»dursa, nə <HelpKey>İşə götür</HelpKey>, nə də{" "}
            <HelpKey>Bağla ok</HelpKey> görünmür.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: müştəriyə cavab yaz">
        <HelpStep n={1}>
          <p>
            Səhifənin sonundakı <HelpKey>Cavab</HelpKey> blokuna keçin. Başlıqda hazırkı cavabların
            sayı göstərilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Əvvəlki cavablar hər biri ayrı çərçivədə — müəllifin adı, tarix və mətnlə — sadalanır.
            Hələ cavab yoxdursa «Hələ cavab yoxdur» mətni görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Aşağıdakı mətn sahəsinə («Cavab yazın…» göstərişli) cavabınızı yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mətn sahəsi dörd sətir hündürlüyündədir və yazdıqca genişlənir. Sahə boş olduğu müddətcə
            aşağıdakı göndərmə düyməsi qeyri-aktiv qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sağ altdakı <HelpKey>Göndər</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə qısa müddət <strong>Göndərilir…</strong> yazısına keçir, sonra mətn sahəsi
            təmizlənir və yeni cavab yuxarıdakı siyahıya əlavə olunur. Başlıqdakı cavab sayı bir vahid
            artır.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Bu blokda göndərilən cavablar <strong>daxili olmayan</strong> cavablardır, yəni müştəri
            ünsiyyətinin bir hissəsi kimi nəzərdə tutulur. Yalnız komanda üçün qeyd saxlamaq
            istəyirsinizsə, bunu burada yazmayın.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: qeydi sil">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı qırmızı <HelpKey>zibil qutusu</HelpKey> ikonalı düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Bu qeydi birdəfəlik silmək?» təsdiq pəncərəsi açılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Təsdiqləsəniz qeyd silinir və avtomatik olaraq reyestrə qaytarılırsınız. Ləğv etsəniz heç
            nə dəyişmir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Təsdiqdən sonra səhifə bağlanır və <HelpKey>Şikayət və təkliflər reyestri</HelpKey>{" "}
            siyahısına qayıdırsınız; həmin qeyd artıq siyahıda olmur.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmə <strong>geri qaytarılmır</strong> («birdəfəlik»). Qeydi sadəcə bağlamaq
            istəyirsinizsə, silmək yerinə <HelpKey>Bağla ok</HelpKey> ilə statusu «Həll olundu»
            edin — qeyd reyestrdə qalır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <strong>Dəyişiklik tarixçəsi</strong> kartı yalnız qeyd üzərində dəyişiklik olduqda
          görünür. Hər sətirdə tarix, dəyişikliyi edən şəxs və nəyin nəyə dəyişdiyi (köhnə dəyər
          üstündən xətt çəkilmiş şəkildə → yeni dəyər) göstərilir — kimin nə vaxt status dəyişdiyini
          buradan izləyə bilərsiniz.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Qeyd, kartlar, tarixçə və cavablar təşkilatınızla məhdudlaşır — başqa təşkilatın
          şikayətlərini aça bilməzsiniz. Status dəyişiklikləri və cavablar dərhal yadda saxlanılır və
          tarixçədə qeydə alınır.
        </p>
      </HelpCallout>
    </div>
  )
}
