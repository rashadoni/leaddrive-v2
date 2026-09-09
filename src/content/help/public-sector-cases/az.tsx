"use client"

/**
 * Public Sector → Cases — help article (Azerbaijani).
 * Public Sector alt-bölməsi "İşlər" (cases register) öz məqaləsi olaraq ayrılıb:
 * yalnız Dövlət sektoru → İşlər səhifəsini əhatə edir (statistika kartları,
 * axtarış, status filtri, yenilə, cədvəl, daha çox yüklə). Səhifə yalnız oxu/
 * baxış üçündür — burada yeni iş yaratma düyməsi YOXDUR.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function publicsectorcasesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dövlət qurumunda iş üzrə əməkdaş və ya nəzarətçisiniz"
        goal="Müraciətlər reyestrini — müavinət, şikayət, apellyasiya işlərini — açıb status, prioritet və son tarixlərinə görə nəzərdən keçirmək"
      >
        Səhifəyə <HelpKey>Dövlət sektoru</HelpKey> → <HelpKey>İşlər</HelpKey> yolu ilə çatırsınız. Bütün
        işlər yalnız sizin təşkilatınız üçündür. Bu səhifə baxış üçündür — siyahını axtarır, süzgəcdən
        keçirir və yeniləyirsiniz; iş kartına klikləyəndə isə həmin işin detallarına keçirsiniz. Səhifədə
        yeni iş yaratma düyməsi yoxdur.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda teal rəngli landmark (qurum) ikonası ilə <HelpKey>İşlər</HelpKey> adı, altında
          «Dövlət sektoru iş idarəetməsi — müavinətlər, şikayətlər, apellyasiyalar və s.» izahı durur.
          Altda dörd statistika kartı gəlir: <strong>Ümumi İş</strong>, <strong>Açıq</strong>,{" "}
          <strong>Həll edilmiş</strong> və <strong>Qapalı</strong>. Onların altında axtarış + filtr
          sətri, daha sonra işlərin cədvəli, ən altda isə (əgər daha çox iş varsa){" "}
          <HelpKey>Daha çox yüklə</HelpKey> düyməsi olur.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi İş">Cari yüklənmiş siyahıdakı işlərin sayı.</HelpDef>
          <HelpDef term="Açıq">
            Hələ icradakı işlər — status «Təqdim edildi», «Qəbul», «Təyin edildi», «İcra olunur» və ya
            «Eskalasiya» olanlar.
          </HelpDef>
          <HelpDef term="Həll edilmiş">Statusu «Həll edildi» olan işlərin sayı.</HelpDef>
          <HelpDef term="Qapalı">Statusu «Rədd edildi» və ya «Geri götürüldü» olan işlərin sayı.</HelpDef>
          <HelpDef term="İş №">Hər işin unikal nömrəsi (monospace yazı ilə göstərilir).</HelpDef>
          <HelpDef term="Mövzu">İşin qısa təsviri; altında kiçik mətnlə qurum (agency) göstərilir.</HelpDef>
          <HelpDef term="Status">
            İşin mərhələsi — rəngli nişanla: Təqdim edildi, Qəbul, Təyin edildi, İcra olunur, Eskalasiya,
            Həll edildi, Rədd edildi, Geri götürüldü.
          </HelpDef>
          <HelpDef term="Prioritet">
            İşin təcililiyi — rəngli nişanla: Standart, Yüksəlmiş, Təcili, Fövqəladə.
          </HelpDef>
          <HelpDef term="Təyin edilmiş">İşə cavabdeh məmurun identifikatoru; təyin yoxdursa «—».</HelpDef>
          <HelpDef term="Son tarix">Qanunla müəyyən son tarix; yoxdursa «—».</HelpDef>
        </dl>
        <p>
          Cədvəl sütunları — <strong>İş №</strong>, <strong>Mövzu</strong>, <strong>Status</strong>,{" "}
          <strong>Prioritet</strong>, <strong>Təyin edilmiş</strong> və <strong>Son tarix</strong>. İş №,
          Mövzu, Status, Prioritet və Son tarix sütunlarını başlığına klikləməklə çeşidləyə bilərsiniz.
          Heç iş tapılmadıqda cədvəldə <strong>Məlumat yoxdur</strong> mətni görünür.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: işləri axtar və süz">
        <HelpStep n={1}>
          <p>
            Filtr sətrinin solundakı axtarış qutusuna mətn yazın. Yer tutucu mətn{" "}
            <HelpKey>ID və ya email ilə axtarın…</HelpKey> yazır; axtarış iş nömrəsi üzrə işləyir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazmağı dayandırdıqdan təxminən yarım saniyə sonra cədvəl avtomatik yenilənir (hər hərfdə
            deyil). Uyğun iş yoxdursa cədvəldə <strong>Məlumat yoxdur</strong> qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Status üzrə süzmək üçün axtarışın yanındakı açılan siyahıdan birini seçin. Standart variant{" "}
            <HelpKey>Bütün statuslar</HelpKey>-dır; digər variantlar: Təqdim edildi, Qəbul, Təyin edildi,
            İcra olunur, Eskalasiya, Həll edildi, Rədd edildi, Geri götürüldü.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçim dəyişən kimi siyahı yenidən yüklənir və yalnız həmin statusdakı işlər qalır.{" "}
            <strong>Bütün statuslar</strong>-a qaytarsanız, süzgəc götürülür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Siyahını yenidən çəkmək üçün sağdakı dairəvi ox ikonalı{" "}
            <HelpKey>Yenilə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl cari axtarış və status süzgəci ilə bağ saxlayaraq yenidən oxunur; statistika kartları
            yüklənmiş siyahıya uyğun yenidən hesablanır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: işi oxu və əlavə işləri yüklə">
        <HelpStep n={1}>
          <p>
            Cədvəldə bir işin sətrinə baxın: <strong>İş №</strong>, <strong>Mövzu</strong> (altında
            qurum), rəngli <strong>Status</strong> və <strong>Prioritet</strong> nişanları,{" "}
            <strong>Təyin edilmiş</strong> və <strong>Son tarix</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Status nişanının rəngi mərhələni bildirir (məs. «İcra olunur» kəhrəba, «Həll edildi» yaşıl,
            «Rədd edildi» qırmızı). Prioritet nişanı isə «Fövqəladə»də qırmızı, «Standart»da boz olur.
            Təyin və ya son tarix yoxdursa, həmin xanada «—» görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bir sütun başlığına (məs. <HelpKey>Son tarix</HelpKey> və ya <HelpKey>Prioritet</HelpKey>)
            klikləməklə cədvəli o sütun üzrə çeşidləyin; təkrar klik istiqaməti tərsinə çevirir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Başlığın yanında yuxarı/aşağı ox ikonası çıxır və sətirlər ona uyğun yenidən düzülür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Cədvəlin altında <HelpKey>Daha çox yüklə</HelpKey> düyməsi görünürsə, onu basaraq növbəti
            işlər dəstini gətirin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yeni işlər mövcud siyahının sonuna əlavə olunur (siyahı sıfırlanmır). Yükləmə müddətində
            düymə müvəqqəti deaktiv olur. Daha iş qalmadıqda düymə yox olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Statistika kartları yalnız <strong>cari yüklənmiş</strong> səhifədəki işlərə görə hesablanır —
          ona görə <HelpKey>Daha çox yüklə</HelpKey> ilə əlavə dəstlər gətirsəniz, saylar bütöv reyestri
          deyil, ekrandakı siyahını əks etdirir. Bütün açıq işlərə cəld baxmaq üçün statusu{" "}
          <HelpKey>İcra olunur</HelpKey> və ya <HelpKey>Eskalasiya</HelpKey> ilə süzün.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Axtarış qutusunun yer tutucu mətni «ID və ya email ilə axtarın…» desə də, axtarış əslində
          <strong> iş nömrəsi</strong> üzrə işləyir. Tam iş nömrəsini və ya onun bir hissəsini yazın;
          e-poçtla axtarış burada nəticə verməyə bilər.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün işlər təşkilatınızla məhdudlaşır — sorğu sizin tenant identifikatorunuzla göndərilir, ona
          görə başqa qurumun işlərini görmürsünüz. Səhifə yalnız oxu üçündür: burada iş yaratmaq, statusu
          dəyişmək və ya işi silmək mümkün deyil.
        </p>
      </HelpCallout>
    </div>
  )
}
