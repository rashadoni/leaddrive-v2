"use client"

/**
 * Loyalty Earn Rules — help article (Azerbaijani).
 * Cari qazanma-qaydası wizard-ını izah edir: biznes ssenarisi,
 * mükafat tipi, uyğun sahələr, canlı nümunə, geniş ayarlar və əməliyyatlar.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function loyaltyearnrulesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sadiqlik proqramını quran marketinq və ya əməliyyat administratorusunuz"
        goal="Daxili qayda terminlərini öyrənmədən sadə xal-qazanma qaydaları yaratmaq"
      >
        Bu səhifə qazanma qaydalarının kataloqudur. Hər qayda bir biznes sualına cavab verir:{" "}
        <strong>müştərinin hansı hərəkətinə görə xal verilsin?</strong> Normal yol qısa wizard-dır:
        ssenarini seçin, xalın necə veriləcəyini seçin, nümunəni yoxlayın və saxlayın. Texniki sahələr
        <HelpKey>Geniş ayarlar</HelpKey> altında qalır. Bütün qaydalar yalnız sizin təşkilatınıza aiddir;
        başqa tenant-ın qaydalarını görmürsünüz.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda sikkə ikonası ilə <HelpKey>Qazanma qaydaları</HelpKey> adı, altında «Əməliyyatların
          sadiqlik ballarına necə çevrildiyini müəyyən edir…» izahı var. Sağ yuxarıda iki düymə durur:{" "}
          <HelpKey>Yeni qayda</HelpKey> və yanında dairəvi <HelpKey>Yenilə</HelpKey> ikonası. Onların
          altında iki filtr — <HelpKey>Tetik:</HelpKey> və <HelpKey>Status:</HelpKey> — açılan siyahıları
          gəlir. Daha aşağıda qaydaların siyahısı; heç qayda yoxdursa, bunun yerinə boş vəziyyət göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Biznes ssenarisi">Mükafatlandırmaq istədiyiniz müştəri hərəkəti: alış, qeydiyyat, referal, ad günü, rəy, sorğu və ya xüsusi ssenari.</HelpDef>
          <HelpDef term="Alış məbləğinə görə xal">Alış qaydaları üçün istifadə edin, məsələn 1 AZN üçün 1 xal.</HelpDef>
          <HelpDef term="Sabit bonus">Hərəkət həmişə eyni xal verəndə istifadə edin, məsələn qeydiyyat üçün 100 xal.</HelpDef>
          <HelpDef term="Canlı nümunə">Formadakı nümunə bloku. Saxlamazdan əvvəl müştərinin nə qazanacağını göstərir.</HelpDef>
          <HelpDef term="Geniş ayarlar">Təcrübəli istifadəçilər üçün sahələr: prioritet, məhsul kateqoriyası, tarix aralığı və səviyyə bonusu davranışı.</HelpDef>
          <HelpDef term="Prioritet">Böyük rəqəm əvvəl yoxlanılır. Yalnız iki aktiv qayda eyni hərəkətə düşə bilərsə istifadə edin.</HelpDef>
        </dl>
        <p>
          Hər qayda kartında ad, yanında boz tetik nişanı, qeyri-aktivdirsə <strong>Söndürülüb</strong>{" "}
          nişanı görünür. Əsas xülasə cümlə kimi oxunur, məsələn{" "}
          <strong>Alış: 1 AZN üçün 1 xal, səviyyə bonusu tətbiq olunur</strong>. Sağda üç əməliyyat var:
          <HelpKey>Söndür</HelpKey>/<HelpKey>Yandır</HelpKey>, redaktə (qələm ikonası) və sil (qırmızı
          zibil qutusu ikonası).
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: wizard ilə qayda yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni qayda</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahının üstündə <strong>Qayda yarat</strong> forması açılır. İlk blok bütün texniki
            sahələri deyil, biznes ssenarisini seçməyi istəyir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Ssenarini seçin: <HelpKey>Alış</HelpKey>,{" "}
            <HelpKey>Qeydiyyat bonusu</HelpKey>, <HelpKey>Referal</HelpKey>,{" "}
            <HelpKey>Ad günü</HelpKey>, <HelpKey>Məhsul rəyi</HelpKey>,{" "}
            <HelpKey>Sorğu cavabı</HelpKey> və ya <HelpKey>Xüsusi</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilən ssenari çərçivə ilə vurğulanır, qayda adı avtomatik təklif olunur və uyğun olmayan
            sahələr gizlənir. Məsələn, qeydiyyat bonusu alış məbləği sahəsini göstərmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Mükafat tipini seçin: alışlar üçün <HelpKey>Alış məbləğinə görə xal</HelpKey>, qeydiyyat,
            referal, ad günü, rəy və ya sorğu üçün <HelpKey>Sabit bonus</HelpKey>. Sonra yalnız görünən
            sahələri doldurun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Önizləmə dərhal yenilənir. Alış qaydası üçün 100 AZN alışın 100 xal verdiyini göstərə
            bilər. Sabit bonus üçün müştərinin alacağı dəqiq xal göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Əlavə idarəetmə lazımdırsa <HelpKey>Geniş ayarlar</HelpKey> açın: məhsul kateqoriyası,
            prioritet, tarix aralığı və ya səviyyə bonusunun tətbiqi.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Geniş sahələr əsas formanın altında açılır. Mövcud qaydanı redaktə edəndə bu sahələr
            avtomatik açılır, çünki həmin halda adətən tam ayar lazımdır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Aşağı sağdakı <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> və ya × ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymədə indikator görünür, sonra forma bağlanır və yeni qayda siyahıda peyda olur. Həm
            məbləğə görə xal, həm də sabit bonus doludursa, xəbərdarlıq bunun artıq xal verə biləcəyini
            xatırladır. Heç biri dolu deyilsə, qayda saxlanmır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: qaydanı süz, redaktə et və ya söndür">
        <HelpStep n={1}>
          <p>
            Siyahını daraltmaq üçün yuxarıdakı <HelpKey>Tetik:</HelpKey> və <HelpKey>Status:</HelpKey>{" "}
            açılan siyahılarından seçim edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahı dərhal yenilənir — yalnız seçilən tetik və/və ya statusa uyğun qaydalar qalır. Hər
            iki süzgəcdə <strong>Hamısı</strong> seçimi süzgəci sıfırlayır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Qaydanı dəyişmək üçün kartdakı qələm ikonalı (<HelpKey>Redaktə et</HelpKey>) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Qaydanı redaktə et</strong> başlıqlı, mövcud qiymətlərlə əvvəlcədən doldurulmuş eyni
            forma açılır. <strong>Tetik</strong> sahəsi sönükdür və yanında «(dəyişmir)» yazısı var —
            tetiki sonradan dəyişmək olmur. Dəyişiklikləri edib <HelpKey>Yadda saxla</HelpKey> ilə təsdiqləyin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Qaydanı silmədən dayandırmaq üçün kartdakı <HelpKey>Söndür</HelpKey> düyməsini basın
            (söndürülmüş qaydada bu düymə <HelpKey>Yandır</HelpKey> olur).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kartda boz <strong>Söndürülüb</strong> nişanı görünür və ya yox olur. Söndürülmüş qayda
            qazanma hesablamasında nəzərə alınmır, lakin siyahıda və tarixçədə qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Qaydanı büsbütün silmək üçün qırmızı zibil qutusu ikonalı (<HelpKey>Sil</HelpKey>) düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «{"«{ad}»"} qaydasını sil?» mətni ilə brauzerin təsdiq pəncərəsi açılır və əvvəl bu qayda ilə
            verilmiş ballara toxunulmayacağını bildirir. Təsdiqlədikdən sonra qayda siyahıdan çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Başlamaq üçün adətən iki qayda kifayətdir: <strong>1 AZN alışa 1 xal</strong> və kiçik
          qeydiyyat bonusu. Prioritet və tarix aralığını real aktivlik göründükdən sonra əlavə etmək
          daha rahatdır.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bir qaydada nə dərəcə, nə də fiks ball doldurmasanız yadda saxlama alınmır — «Ən azı bir məbləğ
          tələb olunur» xətası çıxır. Qaydanı silmək geri qaytarılmır; müvəqqəti dayandırmaq üçün silmək
          yerinə <HelpKey>Söndür</HelpKey> istifadə edin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün qazanma qaydaları təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın qaydalarını görür və
          redaktə edirsiniz, başqa təşkilatın sadiqlik konfiqurasiyasına çıxışınız yoxdur.
        </p>
      </HelpCallout>
    </div>
  )
}
