"use client"

/**
 * Loyalty Tiers — help article (Azerbaijani).
 * Köhnə birgə sadiqlik məqaləsindən ayrılıb: yalnız
 * Sadiqlik səviyyələri səhifəsini əhatə edir (səviyyə pilləkəni —
 * kod, ad, hədd, qazanma əmsalı, aktiv/söndürülmüş vəziyyət;
 * standart səviyyələrin yaradılması, yaratma/redaktə/silmə).
 * Qazanma qaydaları, hesablar və ballar bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function LoyaltytiersHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sadiqlik proqramının administratoru və ya əməliyyat menecerisiniz"
        goal="Üzvlərin topladıqları ümumi ballara görə qalxdığı səviyyə pilləkənini qurmaq — hər səviyyəyə ad, hədd və qazanma əmsalı təyin etmək"
      >
        Bu səhifə sadiqlik <strong>səviyyə pilləkənini</strong> idarə edir: hansı səviyyələrin
        olduğunu, onlara qalxmaq üçün neçə ümumi bal lazım olduğunu və hər səviyyədə balların
        hansı əmsalla qazanıldığını siz təyin edirsiniz. Üzvün topladığı ümumi ballar bir həddi
        keçdikcə o, avtomatik olaraq növbəti səviyyəyə qalxır. Bütün səviyyələr yalnız sizin
        təşkilatınız üçündür və dəyişiklik etdikcə siyahı dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda tac ikonası ilə <HelpKey>Sadiqlik səviyyələri</HelpKey> adı, altında qısa izah
          durur. Sağ yuxarıda əməliyyat düymələri var: hələ heç bir səviyyə yoxdursa{" "}
          <HelpKey>Standart səviyyələri yarat (Bronze → Diamond)</HelpKey> düyməsi (yalnız boş
          siyahıda görünür), həmişə görünən <HelpKey>Yeni səviyyə</HelpKey> düyməsi və yenidən
          yükləmə (dairəvi ox) düyməsi. Altda səviyyə siyahısı gəlir; hələ heç biri yoxdursa, onun
          yerinə mükafat ikonası ilə boş vəziyyət göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Kod">
            Səviyyənin daxili açarı (məs. <HelpKey>bronze</HelpKey>). Üzvlər məhz bu kodla səviyyəyə
            bağlanır. Yazarkən avtomatik kiçik hərflərə çevrilir və yaradıldıqdan sonra
            <strong> dəyişdirilə bilmir</strong>.
          </HelpDef>
          <HelpDef term="Ad">İstifadəçilərə göstərilən səviyyə adı (məs. «Bronze»).</HelpDef>
          <HelpDef term="Hədd (Min. ümumi ballar)">
            Bu səviyyəyə qalxmaq üçün lazım olan minimal ümumi (toplam) bal. Mənfi olmayan tam ədəd.
          </HelpDef>
          <HelpDef term="Qazanma əmsalı">
            Bu səviyyədəki üzvün balları hansı əmsalla qazandığı (məs. ×1.50). 0-dan böyük olmalıdır.
          </HelpDef>
          <HelpDef term="Status">
            Səviyyənin aktiv olub-olmaması — <strong>Aktiv</strong> və ya <strong>Söndürülüb</strong>.
          </HelpDef>
        </dl>
        <p>
          Hər səviyyə kartında solda rəngli kod nişanı, ad və varsa təsvir; sağda üç sütun —{" "}
          <strong>Hədd</strong>, <strong>Əmsal</strong> (×0.00 formatında), <strong>Status</strong>{" "}
          (aktiv yaşıl, söndürülmüş boz) — və onların yanında iki əməliyyat düyməsi: redaktə (qələm
          ikonası) və sil (qırmızı zibil qutusu ikonası) olur.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: standart səviyyələri bir kliklə qur">
        <HelpStep n={1}>
          <p>
            Səhifə boşdursa, ortada mükafat ikonalı «Hələ səviyyə qurulmayıb.» mesajı görəcəksiniz.
            Sağ yuxarıdakı <HelpKey>Standart səviyyələri yarat (Bronze → Diamond)</HelpKey> düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yalnız siyahı tam boş olduqda görünür. Basdıqdan sonra hazır pilləkən —
            <strong> Bronze, Silver, Gold, Platinum, Diamond</strong> — siyahıda peyda olur və boş
            vəziyyət əvəzlənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Yaranan səviyyələrə baxın və lazımdırsa hər birini redaktə düyməsi ilə öz proqramınıza
            uyğunlaşdırın (hədd və əmsalları dəyişin).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Beş kart bir-birinin altında, hər birinin öz rəngli kod nişanı (bronze, silver, gold,
            platinum, diamond) ilə düzülür. Hər kartda hədd, əmsal və status sütunları doldurulmuş
            olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni səviyyə yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni səviyyə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahının üstündə «Səviyyə yarat» başlıqlı forma kartı açılır. İçində <strong>Kod</strong>
            , <strong>Ad</strong>, <strong>Təsvir</strong>, <strong>Min. ümumi ballar</strong>,{" "}
            <strong>Qazanma əmsalı</strong> sahələri və <strong>Aktiv</strong> qeyd qutusu (standart
            olaraq işarələnmiş) var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Kod</strong> yazın (məs. <HelpKey>bronze</HelpKey>). Sonra istifadəçilərə
            görünəcək <strong>Ad</strong>ı doldurun. İstəsəniz bir sətirlik <strong>Təsvir</strong> də
            əlavə edin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kod sahəsinə yazdıqca hərflər avtomatik kiçik hərfə çevrilir. <strong>Ad</strong> sahəsi
            boş qaldıqca aşağıdakı təsdiq düyməsi sönük (deaktiv) qalır; yeni səviyyədə kod da boş
            olmamalıdır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Min. ümumi ballar</strong> sahəsinə bu səviyyəyə qalxmaq üçün lazım olan həddi
            (məs. 0, 500, 1000) və <strong>Qazanma əmsalı</strong> sahəsinə əmsalı (məs. 1.0, 1.25)
            yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər iki sahə yalnız rəqəm qəbul edir. Hədd ox düymələri ilə bir-bir, əmsal isə 0.05
            addımlarla artıb-azalır. Düzgün olmayan dəyər (mənfi və ya kəsr hədd, 0 və ya 10-dan böyük
            əmsal) yadda saxlanarkən yuxarıda qırmızı xəta mesajı verir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Aşağıdakı <HelpKey>Yarat</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> və ya sağ yuxarıdakı × ilə formanı bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxlanarkən düymənin yanında fırlanan göstərici çıxır, sonra forma bağlanır və yeni
            səviyyə siyahıda peyda olur. Xəta olarsa, forma açıq qalır və yuxarıda qırmızı zolaqlı
            mesaj göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: səviyyəni redaktə et və ya sil">
        <HelpStep n={1}>
          <p>
            Səviyyəni dəyişmək üçün onun kartındakı qələm ikonalı (<HelpKey>Redaktə et</HelpKey>)
            düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Səviyyəni redaktə et» başlıqlı, mövcud dəyərlərlə əvvəlcədən doldurulmuş eyni forma
            açılır. <strong>Kod</strong> sahəsi yanında «(dəyişmir)» qeydi ilə sönük (redaktə
            olunmayan) görünür — qalan sahələri dəyişə bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Lazım olan dəyişiklikləri edin (ad, təsvir, hədd, əmsal və ya <strong>Aktiv</strong> qeyd
            qutusu) və <HelpKey>Yadda saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Forma bağlanır və kartdakı dəyərlər yenilənir. <strong>Aktiv</strong> qutusunun
            işarəsini götürsəniz, status sütunu yaşıl <strong>Aktiv</strong>dən boz{" "}
            <strong>Söndürülüb</strong>ə keçir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Səviyyəni silmək üçün kartdakı qırmızı zibil qutusu ikonalı (<HelpKey>Sil</HelpKey>)
            düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Brauzerin təsdiq pəncərəsi açılır: «&lt;səviyyə adı&gt; səviyyəsini sil? Bu səviyyədəki
            üzvlər avtomatik yenidən təyin olunacaq.» Təsdiqlədikdən sonra səviyyə siyahıdan çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Pilləkəni sıfırdan qurmaq əvəzinə <HelpKey>Standart səviyyələri yarat</HelpKey> ilə hazır
          Bronze→Diamond setini bir kliklə alıb sonra hədd və əmsalları öz proqramınıza
          uyğunlaşdırmaq daha sürətlidir. Bu düymə yalnız siyahı tam boş olanda görünür.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <strong>Kod yaradıldıqdan sonra dəyişmir</strong> — üzvlər məhz həmin kodla səviyyəyə
          bağlanır. Səviyyəni silsəniz, onu seçmiş üzvlər toxunulmamış qalır, lakin növbəti yenidən
          qiymətləndirmədə avtomatik başqa səviyyəyə təyin olunur. Səviyyəni müvəqqəti gizlətmək
          istəyirsinizsə, silmək yerinə redaktədə <strong>Aktiv</strong> qutusunun işarəsini götürün.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün səviyyələr təşkilatınızla məhdudlaşır — başqa təşkilatın səviyyə pilləkənini görmür
          və dəyişə bilmirsiniz. Əmsal üçün təhlükəsizlik tavanı var (10-dan böyük dəyər qəbul
          olunmur) ki, yazı səhvi bütün proqramın bal öhdəliyini partlatmasın.
        </p>
      </HelpCallout>
    </div>
  )
}
