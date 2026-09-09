"use client"

/**
 * Contract Milestones — help article (Azerbaijani).
 *
 * Köhnə birgə "contracts" məqaləsindən AYRILIB: yalnız
 * Müqavilələr → Mərhələlər səhifəsini (/contracts/milestones) əhatə edir —
 * bütün müqavilələr üzrə təşkilat əhatəli, YALNIZ-OXUNAN mərhələ siyahısı,
 * status/gecikmiş/yaxınlaşan filtrləri və səhifələmə.
 * Müqavilə reyestri (yaratma/redaktə) bura DAXİL DEYİL — mərhələ yaratmaq
 * və ya dəyişmək müqavilə detalında (/contracts/[id]) olur.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function contractsmilestonesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Müqavilələri izləyən hüquq, satış əməliyyatları və ya layihə menecerisiniz"
        goal="Bütün müqavilələr üzrə öhdəlikləri bir yerdə görmək — nə vaxt çatdığını, kimin məsul olduğunu və hansının gecikdiyini"
      >
        Səhifəyə <HelpKey>Müqavilələr</HelpKey> → <HelpKey>Mərhələlər</HelpKey> yolu ilə çatırsınız.
        Bu səhifə <strong>yalnız-oxunan icmaldır</strong>: bütün müqavilələrinizdəki mərhələləri bir
        cədvəldə birləşdirir. Burada mərhələ <strong>yaratmaq, redaktə etmək və ya silmək olmur</strong> —
        bunlar konkret müqavilənin detal səhifəsində (mərhələnin yanındakı müqavilə nömrəsinə klikləyib
        keçirsiniz) edilir. Bütün sətirlər yalnız sizin təşkilatınızın müqavilələrindən oxunur.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda mavi qeyd ikonası ilə <HelpKey>Müqavilə Mərhələləri</HelpKey> adı, altında «Bütün
          müqavilələr üzrə təşkilat əhatəli mərhələlər — son tarixlər və statuslar» izahı durur.
          Başlığın altında bir <strong>filtr paneli</strong>, sonra <strong>mərhələ cədvəli</strong>,
          nəticələr çoxdursa isə aşağıda <strong>səhifələmə</strong> idarələri gəlir.
        </p>
        <p>
          Filtr panelində soldan sağa: <strong>Status</strong> açılan siyahısı, <strong>Gecikmiş</strong>{" "}
          keçid düyməsi, <strong>Yaxınlaşan (gün)</strong> rəqəm sahəsi, sonra <HelpKey>Tətbiq et</HelpKey>{" "}
          və <HelpKey>Sıfırla</HelpKey> düymələri var. Panelin sağ kənarında ümumi sayğac — məsələn
          «12 mərhələ» — görünür.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Mərhələ">
            Müqavilənin bir öhdəliyi və ya nəzarət nöqtəsi — adı, varsa qısa təsviri, son tarixi və
            statusu olan. Cədvəlin hər sətri bir mərhələdir.
          </HelpDef>
          <HelpDef term="Status">
            Mərhələnin vəziyyəti: <strong>Gözləyir</strong>, <strong>İcrada</strong>,{" "}
            <strong>Tamamlandı</strong> və ya <strong>Ləğv edildi</strong> — rəngli nişan kimi göstərilir.
          </HelpDef>
          <HelpDef term="Gecikmiş">
            Son tarixi keçmiş, hələ tamamlanmamış mərhələ. Sətrin əvvəlində qırmızı xəbərdarlıq üçbucağı
            çıxır və son tarix qırmızı yazılır.
          </HelpDef>
          <HelpDef term="Yaxınlaşan (gün)">
            Yalnız növbəti N gün içində son tarixi çatan mərhələləri göstərmək üçün filtr (məs. 30).
          </HelpDef>
          <HelpDef term="Müqavilə">
            Mərhələnin aid olduğu sənəd — cədvəldə müqavilə nömrəsi (mono şriftlə) və başlığı kimi
            göstərilir; üstünə klikləməklə həmin müqavilənin detal səhifəsinə keçirsiniz.
          </HelpDef>
          <HelpDef term="Məsul şəxs">
            Mərhələyə təyin edilmiş istifadəçi; təyin olunmayıbsa tire (—) görünür.
          </HelpDef>
        </dl>
        <p>
          Cədvəlin sütunları: <strong>Mərhələ</strong> (ad + varsa təsvir), <strong>Müqavilə</strong>{" "}
          (klikləyə bilən keçid), <strong>Məsul şəxs</strong>, <strong>Son tarix</strong> və{" "}
          <strong>Status</strong>. Heç bir mərhələ filtrlərə uyğun gəlmirsə, cədvəlin yerinə qeyd
          ikonası ilə «Filtrlərə uyğun mərhələ tapılmadı» mesajı göstərilir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: mərhələləri statusa görə filtrlə">
        <HelpStep n={1}>
          <p>
            Filtr panelindəki <HelpKey>Status</HelpKey> açılan siyahısını açın və bir status seçin —
            <strong>Bütün statuslar</strong>, <strong>Gözləyir</strong>, <strong>İcrada</strong>,{" "}
            <strong>Tamamlandı</strong> və ya <strong>Ləğv edildi</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Status seçən kimi cədvəl avtomatik yenilənir — əlavə düyməyə basmaq lazım deyil — və yalnız
            həmin statusdakı mərhələlər qalır. Sağ kənardakı sayğac yeni nəticə sayına uyğunlaşır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstəsəniz <HelpKey>Tətbiq et</HelpKey> düyməsi ilə filtrləri əlllə yenidən işə sala
            bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yüklənərkən düymədə fırlanan dairə (spinner) görünür və yenidən siyahının birinci
            səhifəsindən başlanır. Yükləmə bitincə cədvəl yenilənmiş nəticələri göstərir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: yalnız gecikmiş və ya yaxınlaşan mərhələləri göstər">
        <HelpStep n={1}>
          <p>
            Yalnız vaxtı keçmiş mərhələləri görmək üçün <HelpKey>Gecikmiş</HelpKey> keçid düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə dolu (aktiv) vəziyyətə keçir və cədvəldə yalnız gecikmiş mərhələlər qalır — hər biri
            sətrin əvvəlində qırmızı üçbucaq və qırmızı son tarixlə. Eyni zamanda yanındakı{" "}
            <strong>Yaxınlaşan (gün)</strong> sahəsi söndürülür (deaktiv olur), çünki iki vaxt filtri
            birlikdə işləmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bunun əvəzinə yaxın günlərdə çatacaq mərhələləri görmək istəyirsinizsə, əvvəlcə{" "}
            <HelpKey>Gecikmiş</HelpKey> sönülü olduğundan əmin olun, sonra <HelpKey>Yaxınlaşan (gün)</HelpKey>{" "}
            sahəsinə gün sayı yazın (məs. <HelpKey>30</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahə yalnız 1–365 aralığında rəqəm qəbul edir («məs. 30» mətni göstərici olaraq durur).
            Rəqəm daxil etdikcə cədvəl avtomatik daralır və yalnız həmin müddətdə son tarixi olan
            mərhələlər qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bütün filtrləri başlanğıc vəziyyətə qaytarmaq üçün <HelpKey>Sıfırla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Status «Bütün statuslar»a qayıdır, <strong>Gecikmiş</strong> sönür,{" "}
            <strong>Yaxınlaşan (gün)</strong> sahəsi boşalır, siyahı birinci səhifədən tam siyahıya
            qayıdır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: bir mərhələdən müqaviləyə keç">
        <HelpStep n={1}>
          <p>
            İstənilən sətirdə <HelpKey>Müqavilə</HelpKey> sütunundakı keçidə — sənəd ikonası ilə yanaşı
            duran müqavilə nömrəsi və başlığına — klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Həmin müqavilənin detal səhifəsi açılır. Mərhələni məhz orada — müqavilə daxilində —
            yaradır, redaktə edir, tamamlanmış işarələyir və ya silirsiniz. Mərhələlər siyahısı özü
            yalnız-oxunandır, ona görə dəyişikliklər həmişə müqavilə detalından keçir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Nəticələr bir səhifəyə sığmırsa, cədvəlin altında <HelpKey>‹</HelpKey> və <HelpKey>›</HelpKey>{" "}
            ox düymələri ilə səhifələr arasında keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Solda «1–50 / 120» kimi diapazon, ortada «Səhifə 1 / 3» göstəricisi durur. Birinci
            səhifədə geri oxu, son səhifədə isə irəli oxu deaktiv olur. Səhifələmə yalnız birdən çox
            səhifə olduqda görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Həftəlik baxışın ən sürətli yolu: <HelpKey>Gecikmiş</HelpKey> ilə dərhal vaxtı keçənləri
          yığın, sonra <HelpKey>Sıfırla</HelpKey> edib <HelpKey>Yaxınlaşan (gün)</HelpKey> sahəsinə 7
          və ya 14 yazaraq qarşıdakı öhdəliklərə baxın. Status filtri ilə isə yalnız{" "}
          <strong>İcrada</strong> olanları seçib komandanın əlindəki işi görə bilərsiniz.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          <strong>Gecikmiş</strong> və <strong>Yaxınlaşan (gün)</strong> eyni vaxtda işləmir —{" "}
          <strong>Gecikmiş</strong> aktiv olanda gün sahəsi söndürülür. Birini istifadə etmək üçün
          digərini söndürün. Məlumat yüklənməsə, qırmızı «Məlumatlar yüklənmədi. Yenidən cəhd edin»
          xəbərdarlığı çıxır — şəbəkəni yoxlayıb <HelpKey>Tətbiq et</HelpKey> ilə təkrar cəhd edin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Cədvəl yalnız sizin təşkilatınızın müqavilələrindəki mərhələləri göstərir — başqa tenant-ın
          məlumatı buraya düşmür. Səhifə yalnız-oxunandır; mərhələ üzərində hər hansı dəyişiklik (yaratma,
          redaktə, silmə) müqavilə detal səhifəsində aparılır və oradakı icazələrinizə tabedir.
        </p>
      </HelpCallout>
    </div>
  )
}
