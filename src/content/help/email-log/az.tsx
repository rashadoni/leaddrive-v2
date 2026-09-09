"use client"

/**
 * Email Log — help article (Azerbaijani).
 * Köhnə birgə e-poçt məqaləsindən ayrılıb: yalnız Email Jurnalı səhifəsini
 * əhatə edir (göndərilmiş/alınmış e-poçtların yalnız-oxu tarixçəsi, statistika
 * kartları, axtarış/filtr, sətrin açılması, Da Vinci analitikası, səhifələmə).
 * Səhifə heç bir e-poçtu redaktə və ya göndərmir — sadəcə göstərir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function EmailLogHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış, marketinq və ya dəstək komandasında işləyirsiniz"
        goal="Sistemdən hansı e-poçtların gedib-gəldiyini, çatdırılıb-çatdırılmadığını yoxlamaq və problemli göndərişləri tapmaq"
      >
        Bu səhifə yalnız-oxu jurnaldır: burada e-poçt yazmırsınız və göndərmirsiniz, sadəcə
        təşkilatınızdan çıxan və ona gələn bütün e-poçtların tarixçəsini görürsünüz. Hər qeyd —
        kim kimə, hansı mövzu, hansı status — birbaşa sistemin e-poçt jurnalından oxunur, ona görə
        filtr və ya axtarış tətbiq etdikcə nəticələr və yuxarıdakı saylar dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Email Jurnalı</HelpKey> adı, altında «Bütün göndərilmiş və alınmış
          emaillərin tarixi» izahı, sağ yuxarıda isə <HelpKey>Yenilə</HelpKey> düyməsi var. Onun
          altında bənövşəyi-mavi <HelpKey>Da Vinci analitika</HelpKey> düyməsi durur. Sonra altı
          statistika kartı sıralanır: <strong>Cəmi</strong>, <strong>Gedən</strong>,{" "}
          <strong>Gələn</strong>, <strong>Göndərilmiş</strong>, <strong>Xəta</strong> və{" "}
          <strong>Geri döndü</strong>. Onların altında axtarış sahəsi və iki filtr (istiqamət və
          status), daha sonra isə e-poçt siyahısı gəlir. Heç qeyd yoxdursa, siyahının yerinə boş
          vəziyyət göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Cəmi">Jurnaldakı bütün e-poçt qeydlərinin ümumi sayı.</HelpDef>
          <HelpDef term="Gedən">Sistemdən xarici alıcılara göndərilmiş e-poçtlar (çıxan).</HelpDef>
          <HelpDef term="Gələn">Xarici göndərənlərdən alınmış e-poçtlar.</HelpDef>
          <HelpDef term="Göndərilmiş">Uğurla çatdırılmış e-poçtların sayı.</HelpDef>
          <HelpDef term="Xəta">Çatdırılması uğursuz olan e-poçtlar.</HelpDef>
          <HelpDef term="Geri döndü">Alıcı serveri tərəfindən geri qaytarılmış (bounced) e-poçtlar.</HelpDef>
          <HelpDef term="Status">Bir e-poçtun vəziyyəti: Gözləyir, Göndərildi, Çatdırıldı, Xəta və ya Geri döndü.</HelpDef>
          <HelpDef term="İstiqamət">E-poçtun yönü — «Gedən» (çıxan) və ya «Gələn» (daxil olan).</HelpDef>
        </dl>
        <p>
          Hər e-poçt sətrində soldan başlayaraq istiqamət nişanı (yaşıl <strong>Gedən</strong> ya
          mavi <strong>Gələn</strong>), mövzu (boşdursa «(mövzu yoxdur)»), rəngli status nişanı,
          altında <strong>Kimdən</strong> və <strong>Kimə</strong>, daha aşağıda tarix, varsa{" "}
          <strong>Göndərən</strong> və kampaniyaya bağlıdırsa «Kampaniya» işarəsi görünür. Sağda
          böyük boz nömrə (jurnal nömrəsi) və açıb-bağlamaq üçün ox işarəsi durur. Xətalı sətirlər
          qırmızıya, geri dönənlər narıncıya çalır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: jurnalı yenilə və oxu">
        <HelpStep n={1}>
          <p>
            Səhifə açılanda son e-poçtlar avtomatik yüklənir. Ən təzə vəziyyəti görmək üçün sağ
            yuxarıdakı <HelpKey>Yenilə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Bir anlıq boz «skelet» sətirlər yanıb-sönür, sonra ən son e-poçtlar siyahıya gəlir və
            yuxarıdakı altı statistika kartındakı saylar yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bir e-poçtun tam məzmununu görmək üçün onun sətrinə basın (istənilən yerinə — sağdakı
            ox da bunu bildirir).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sətir aşağı açılır. Varsa qırmızı çərçivədə <strong>Xəta</strong> mesajı, sonra{" "}
            <strong>Message-ID</strong> sətri, daha sonra «Mesaj önizləməsi» altında e-poçtun
            mətni göstərilir. Mətn saxlanmayıbsa «Məzmun saxlanılmayıb» yazısı çıxır. Yenidən
            basanda sətir bağlanır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: axtar və filtrlə">
        <HelpStep n={1}>
          <p>
            Konkret e-poçtu tapmaq üçün axtarış sahəsinə («Email axtar...») mətn yazın — məsələn
            alıcının ünvanı və ya mövzudan bir söz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahı yazdığınız sorğuya uyğun qeydlərə daralır və avtomatik birinci səhifəyə qayıdır.
            Heç nə tapılmazsa, boş vəziyyət (poçt ikonası ilə «Email yoxdur») görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Yalnız çıxan və ya yalnız daxil olan e-poçtları görmək üçün huni ikonasının yanındakı
            birinci açılan siyahıdan <HelpKey>Gedən</HelpKey> ya <HelpKey>Gələn</HelpKey> seçin
            (standart <HelpKey>Hamısı</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahı seçdiyiniz istiqamətə uyğun süzülür və yenə birinci səhifəyə qayıdır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Çatdırılma vəziyyətinə görə süzmək üçün ikinci açılan siyahıdan status seçin:{" "}
            <HelpKey>Göndərildi</HelpKey>, <HelpKey>Çatdırıldı</HelpKey>, <HelpKey>Xəta</HelpKey>,{" "}
            <HelpKey>Geri döndü</HelpKey> və ya <HelpKey>Gözləyir</HelpKey> (standart{" "}
            <HelpKey>Bütün statuslar</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahı yalnız seçilmiş statusdakı e-poçtları göstərir. İstiqamət və status filtrləri,
            axtarışla birlikdə eyni anda işləyir — hamısı bir-birinin üstünə düşür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Da Vinci analitikası ilə xülasə al">
        <HelpStep n={1}>
          <p>
            Süni intellektin e-poçt fəaliyyətinizi şərh etməsi üçün üstdəki{" "}
            <HelpKey>Da Vinci analitika</HelpKey> düyməsini basın. (Jurnalda heç qeyd yoxdursa düymə
            sönük olur.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymədə fırlanan göstərici çıxır, aşağıda «Da Vinci — Email Jurnalı» başlıqlı kart
            açılır və içində «Yüklənir...» göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Təhlilin tamamlanmasını gözləyin.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Kartda hazırkı interfeys dilində mətn şəklində xülasə görünür. Nəsə alınmasa, qırmızı
            çərçivədə xəta mesajı çıxır. Kartı sağ yuxarıdakı × ilə bağlaya bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: səhifələr arasında keç">
        <HelpStep n={1}>
          <p>
            Bir səhifədə 30 qeyd göstərilir. Daha çox qeyd varsa, siyahının altında səhifələmə
            zolağı görünür; növbəti hissəyə keçmək üçün <HelpKey>İrəli</HelpKey>, geriyə qayıtmaq
            üçün <HelpKey>Geri</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Solda «Göstərilir 1–30 / N» kimi yazı, sağda isə «cari / ümumi» səhifə sayğacı durur.
            Birinci səhifədə <HelpKey>Geri</HelpKey>, sonuncuda <HelpKey>İrəli</HelpKey> düyməsi
            sönük olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Çatdırılma problemlərini tez tapmaq üçün status filtrini <HelpKey>Xəta</HelpKey> və ya{" "}
          <HelpKey>Geri döndü</HelpKey> qoyun, sonra sətri açıb qırmızı <strong>Xəta</strong>{" "}
          mesajını oxuyun — orada poçt serverinin qaytardığı səbəb yazılır. Bu sətirlər siyahıda
          onsuz da qırmızı/narıncı fonla seçilir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu səhifə yalnız tarixçəni göstərir — buradan e-poçt yenidən göndərə, redaktə edə və ya
          silə bilməzsiniz. «Mesaj önizləməsi» yalnız jurnala mətn saxlanıbsa görünür; bəzi
          qeydlərdə yalnız başlıq və status olur və məzmun «Məzmun saxlanılmayıb» kimi qalır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Jurnal təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın göndərdiyi və aldığı
          e-poçtları görürsünüz, başqa təşkilatların yazışmaları sizə görünmür. Da Vinci təhlili də
          yalnız sizin təşkilatınızın e-poçt məlumatları üzərində aparılır.
        </p>
      </HelpCallout>
    </div>
  )
}
