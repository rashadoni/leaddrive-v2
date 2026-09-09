"use client"

/**
 * Notifications — help article (Azerbaijani).
 * Əvvəllər dashboard məqaləsini paylaşırdı; indi yalnız
 * Bildirişlər siyahısının özünü əhatə edir: oxuma, filtr (Hamısı /
 * Oxunmamış), tək və ya hamısını oxunmuş işarələmə, daha çox yükləmə.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function NotificationsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="CRM-dən gündəlik istifadə edən satış nümayəndəsi, menecer və ya administratorsunuz"
        goal="Sövdələşmələr, tapşırıqlar, biletlər və digər hadisələr haqqında sistem xəbərdarlıqlarını bir yerdə görmək, oxumaq və oxunmuş kimi işarələmək"
      >
        Səhifə sol menyudakı <HelpKey>Bildirişlər</HelpKey> bölməsidir. Burada göstərilən bütün
        bildirişlər yalnız sizin təşkilatınıza aiddir və açılarkən serverdən avtomatik yüklənir.
        Bildirişlər səhifədə öz-özünə yaranmır — onları sövdələşmə, tapşırıq, bilet kimi başqa
        hadisələr sistemə əlavə edir; bu səhifə isə onları oxumaq və idarə etmək üçündür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda solda <HelpKey>Bildirişlər</HelpKey> başlığı, altında «{"{"}cəm{"}"} bildiriş»
          şəklində ümumi say yazısı, sağ yuxarıda isə{" "}
          <HelpKey>Hamısını oxunmuş kimi işarələ</HelpKey> düyməsi durur. Başlığın altında səhifə
          təsviri — «Bildirişlər: sövdələşmələr, tapşırıqlar, biletlər və digər hadisələr haqqında
          sistem xəbərdarlıqları» — gəlir. Sonra üç statistika kartı, onların altında iki filtr
          düyməsi, ən altda isə bildiriş siyahısı yerləşir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Cəmi">Bütün bildirişlərin (oxunmuş və oxunmamış birlikdə) ümumi sayı; zəng ikonası ilə.</HelpDef>
          <HelpDef term="Oxunmamış">Hələ oxumadığınız bildirişlərin sayı; üstündən xətt çəkilmiş zəng ikonası ilə.</HelpDef>
          <HelpDef term="Oxunmuş">Artıq oxunmuş bildirişlərin sayı (cəmidən oxunmamışlar çıxılmaqla); ikiqat işarə ikonası ilə.</HelpDef>
          <HelpDef term="Hamısı (filtr)">Bütün bildirişləri göstərən filtr düyməsi; yanında ümumi say göstərilir.</HelpDef>
          <HelpDef term="Oxunmamış (filtr)">Yalnız oxunmamış bildirişləri göstərən filtr düyməsi; yanında oxunmamış say göstərilir.</HelpDef>
          <HelpDef term="Bildiriş kartı">Bir hadisə sətri — solda növə uyğun rəngli ikon, başlıq, mətn və sağda nə qədər əvvəl yarandığını göstərən vaxt.</HelpDef>
        </dl>
        <p>
          Hər bildiriş kartında solda növünə görə rəngli bir ikon olur: məlumat (mavi), xəbərdarlıq
          (sarı), uğur (yaşıl), sövdələşmə (bənövşəyi dollar işarəsi), lid (narıncı), mesaj (göy söhbət
          ikonası); tanınmayan növdə adi zəng ikonası göstərilir. Oxunmamış bildiriş seçilib göstərilir —
          solunda nazik rəngli zolaq, açıq fon, qalın başlıq və başlığın yanında kiçik dolu nöqtə olur.
          Oxunmuş bildirişdə isə bunlar olmur.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: bildirişləri oxu və tək-tək oxunmuş işarələ">
        <HelpStep n={1}>
          <p>
            Sol menyudan <HelpKey>Bildirişlər</HelpKey> bölməsini açın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Səhifə yüklənərkən qısa müddət boz boş zolaqlar (skelet) görünür, sonra üç statistika kartı,
            filtr düymələri və bildiriş siyahısı gəlir. Heç bildiriş yoxdursa, siyahının yerində kart
            içində «Bildiriş yoxdur» mətni göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Maraqlandığınız bildiriş kartının üstünə baxın — başlıq, altında mətn, sağda isə «5 dəq
            əvvəl», «2 saat əvvəl» və ya «3 gün əvvəl» kimi vaxt yazısı var (bir həftədən köhnə olanda
            tam tarix göstərilir).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siçanı kartın üstünə aparanda fon bir az işıqlanır — bu kartların basıla biləcəyini bildirir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Oxunmamış bir bildirişi oxunmuş etmək üçün sadəcə kartın üstünə basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kart adi görünüşə keçir — soldakı rəngli zolaq və açıq fon yox olur, başlığın yanındakı dolu
            nöqtə itir. <strong>Oxunmamış</strong> kartındakı say bir vahid azalır, <strong>Oxunmuş</strong>{" "}
            kartındakı say isə bir vahid artır. (Onsuz da oxunmuş kartı basanda heç nə dəyişmir.)
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: filtr et — Hamısı və ya Oxunmamış">
        <HelpStep n={1}>
          <p>
            Statistika kartlarının altındakı iki düymədən birini seçin:{" "}
            <HelpKey>Hamısı</HelpKey> (yanında ümumi say) və ya <HelpKey>Oxunmamış</HelpKey> (yanında
            oxunmamış say).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçili filtr düyməsi dolu (vurğulanmış), digəri isə konturlu görünür. <HelpKey>Oxunmamış</HelpKey>{" "}
            seçəndə siyahı yalnız hələ oxunmamış bildirişlərə daralır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Oxunmamış</HelpKey> filtrində heç nə qalmayıbsa, siyahının yerində «Oxunmamış
            bildiriş yoxdur» mətni çıxır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Boş vəziyyət kartı «Oxunmamış bildiriş yoxdur» yazısı ilə göstərilir; <HelpKey>Hamısı</HelpKey>{" "}
            filtrinə qayıtsanız, bütün bildirişlər yenidən görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: hamısını oxunmuş işarələ və daha çox yüklə">
        <HelpStep n={1}>
          <p>
            Bütün oxunmamış bildirişləri bir dəfəyə oxunmuş etmək üçün sağ yuxarıdakı{" "}
            <HelpKey>Hamısını oxunmuş kimi işarələ</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bütün kartlar oxunmuş görünüşə keçir, <strong>Oxunmamış</strong> sayı sıfıra düşür və düymənin
            özü deaktiv olur. (Onsuz da oxunmamış bildiriş yoxdursa, düymə əvvəldən deaktiv — boz və
            basılmaz — olur.)
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Siyahı uzundursa, ən altda <HelpKey>Daha çox yüklə</HelpKey> düyməsi olur (yalnız{" "}
            <HelpKey>Hamısı</HelpKey> filtrində). Köhnə bildirişləri də görmək üçün onu basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yüklənərkən «Yüklənir...» yazısına keçir, sonra növbəti bildirişlər mövcudların altına
            əlavə olunur. Daha köhnə bildiriş qalmayanda <HelpKey>Daha çox yüklə</HelpKey> düyməsi yox olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Kart başlanğıcdakı rəngli ikonu bildirişin haradan gəldiyini tez tutmağa kömək edir: bənövşəyi
          dollar = sövdələşmə, narıncı = lid, göy söhbət = mesaj, sarı üçbucaq = xəbərdarlıq. Yalnız işə
          aid olanları görmək üçün <HelpKey>Oxunmamış</HelpKey> filtrini açıq saxlayın və oxuduqca
          siyahının boşalmasını izləyin.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Kartı bir dəfə basmaq onu birbaşa <strong>oxunmuş</strong> edir — ayrıca təsdiq pəncərəsi
          yoxdur. «Oxunmuş» işarəsini geri qaytaran düymə bu səhifədə yoxdur, ona görə bildirişi diqqətlə
          nəzərdən keçirməmiş tələsik basmayın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bildirişlər təşkilatınızla məhdudlaşır — yalnız öz tenant-ınıza aid xəbərdarlıqları görürsünüz
          və başqa təşkilatın bildirişlərini açıb oxuya bilmirsiniz. Siyahı serverdən sizin təşkilat
          kontekstinizlə yüklənir.
        </p>
      </HelpCallout>
    </div>
  )
}
