"use client"

/**
 * Public Sector → Qrantlar (qrant reyestri) — help article (Azerbaijani).
 * Yalnız Dövlət sektoru → Qrantlar siyahı səhifəsini əhatə edir
 * (src/app/(dashboard)/public-sector/grants/page.tsx).
 * Səhifə YALNIZ oxumaq üçündür: stat kartları, axtarış + status filtri +
 * yeniləmə, cədvəl və «Daha çox yüklə». Burada qrant yaratma/redaktə YOXDUR.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function publicsectorgrantsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dövlət sektoru işçisi və ya proqram administratorusunuz"
        goal="Qrant müraciətlərinin reyestrinə baxmaq, onları statusa görə süzmək və konkret qrant nömrəsini tapmaq"
      >
        Səhifəyə <HelpKey>Dövlət sektoru</HelpKey> → <HelpKey>Qrantlar</HelpKey> yolu ilə
        çatırsınız. Bu səhifə <strong>yalnız oxumaq üçündür</strong> — qeydlərə baxır, axtarır və
        süzürsünüz, amma buradan qrant yaratmaq, redaktə etmək və ya silmək olmur. Bütün qrantlar
        yalnız sizin təşkilatınıza aiddir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Qrantlar</HelpKey> adı (yanında landmark/bina ikonası), altında «Dövlət
          qrant proqramları — müraciətlər, təsdiqlər və ödənişlər.» izahı var. Onun altında dörd
          statistika kartı durur: <strong>Ümumi Qrant</strong>, <strong>Aktiv</strong>,{" "}
          <strong>Ödənilmiş</strong> və <strong>Rədd / Ləğv edilmiş</strong>. Daha sonra süzgəc
          sətri (axtarış qutusu, status açılan siyahısı və yeniləmə düyməsi), onun altında isə qrant
          cədvəli gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi Qrant">Hazırda yüklənmiş qrantların sayı (cədvəldəki ilk dəstə).</HelpDef>
          <HelpDef term="Aktiv">Statusu «Təsdiqləndi» və ya «Ödənilir» olan qrantların sayı.</HelpDef>
          <HelpDef term="Ödənilmiş">Statusu «Ödənildi» olan qrantların sayı.</HelpDef>
          <HelpDef term="Rədd / Ləğv edilmiş">Statusu «Rədd edildi», «Ləğv edildi» və ya «Geri götürüldü» olan qrantların sayı.</HelpDef>
          <HelpDef term="Qrant №">Hər müraciətin unikal nömrəsi (monosahə şriftlə göstərilir).</HelpDef>
          <HelpDef term="Proqram">Qrantın aid olduğu proqramın adı (proqram açarı).</HelpDef>
          <HelpDef term="Məbləğ">Təsdiqlənmiş məbləğ — əgər hələ təsdiqlənməyibsə, tələb olunan məbləğ — valyuta ilə göstərilir.</HelpDef>
          <HelpDef term="Status">Qrantın mərhələsi (Təqdim edildi, Baxış altında, Təsdiqləndi, Ödənilir, Ödənildi, Rədd edildi, Geri götürüldü, Ləğv edildi) — rəngli nişanla.</HelpDef>
          <HelpDef term="Təqdim tarixi">Müraciətin təqdim olunduğu tarix.</HelpDef>
        </dl>
        <p>
          Statistika kartlarındakı saylar <strong>hazırda yüklənmiş ilk dəstəyə</strong> görə
          hesablanır. «Daha çox yüklə» ilə əlavə qrantlar gətirdikdə cədvəl uzanır, lakin kart
          sayları ilk dəstənin göstəricisi olaraq qalır. Status süzgəcini dəyişdikdə saylar yenidən
          hesablanır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: qrant nömrəsinə görə axtar">
        <HelpStep n={1}>
          <p>
            Süzgəc sətrindəki sol axtarış qutusuna (placeholder{" "}
            <HelpKey>ID və ya email ilə axtarın…</HelpKey>) axtardığınız qrantın nömrəsini yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazmağı dayandırdıqdan təqribən yarım saniyə sonra siyahı avtomatik yenilənir (sorğu
            qrant nömrəsi üzrə serverə gedir). Cədvəl yalnız nömrəsi uyğun gələn qrantları göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Axtarışı təmizləmək üçün qutudakı mətni silin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qutu boşaldıqdan sonra siyahı yenidən bütün qrantları (cari status süzgəcinə uyğun)
            göstərir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: statusa görə süz və siyahını yenilə">
        <HelpStep n={1}>
          <p>
            Axtarış qutusunun yanındakı status açılan siyahısını açın. Standart olaraq{" "}
            <HelpKey>Bütün statuslar</HelpKey> seçilidir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahıda «Bütün statuslar»dan əlavə bu seçimlər var: Təqdim edildi, Baxış altında,
            Təsdiqləndi, Ödənilir, Ödənildi, Rədd edildi, Geri götürüldü, Ləğv edildi.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bir status seçin (məs. <HelpKey>Ödənildi</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl dərhal yenilənir və yalnız seçilmiş statusdakı qrantları göstərir; dörd statistika
            kartının sayları da bu süzülmüş nəticəyə görə yenidən hesablanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Siyahını yenidən serverdən çəkmək üçün sağdakı dairəvi ox ikonalı{" "}
            <HelpKey>Yenilə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahı cari axtarış və status süzgəci ilə yenidən yüklənir; statistika kartları da ilk
            dəstəyə görə yenidən hesablanır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: cədvəllə işlə və daha çox yüklə">
        <HelpStep n={1}>
          <p>
            Cədvəl başlığında <strong>Qrant №</strong>, <strong>Proqram</strong>,{" "}
            <strong>Məbləğ</strong>, <strong>Status</strong> və <strong>Təqdim tarixi</strong>{" "}
            sütunları var. İstənilən sütun başlığına klikləyib sıralaya bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Başlığa klikləyəndə yanında yuxarı/aşağı ox işarəsi çıxır və sətirlər o sütuna görə artan,
            təkrar klikdə isə azalan qaydada düzülür. Qeyd YOXDURsa, cədvəldə «No data» (məlumat yoxdur)
            yazısı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Cədvəlin öz daxili axtarış qutusu da var (üst süzgəc sətrindən ayrı, cədvəlin
            yuxarısında). Onunla <strong>yalnız yüklənmiş sətirlər arasında</strong> hər sütun üzrə
            sürətli axtarış edə bilərsiniz.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəlin yuxarısında axtarış qutusu və sağında nəticə sayını göstərən yazı var. Burada
            yazdıqca cədvəl artıq ekranda olan sətirlərə görə süzülür — bu, serverə yeni sorğu
            göndərmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Daha çox qeyd varsa, cədvəlin altında <HelpKey>Daha çox yüklə</HelpKey> düyməsi görünür.
            Növbəti dəstəni gətirmək üçün onu basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yüklənərkən qısa müddət deaktiv olur, sonra yeni qrantlar mövcud siyahının sonuna
            əlavə olunur. Bütün qeydlər yükləndikdə düymə yox olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          İki ayrı axtarışı qarışdırmayın: <strong>üst süzgəc sətrindəki</strong> qutu bütün baza
          üzrə qrant nömrəsi ilə axtarır (serverə sorğu göndərir), <strong>cədvəlin öz</strong> qutusu
          isə yalnız artıq ekranda olan sətirləri süzür. Geniş axtarış üçün üst qutudan, sürətli
          süzgüc üçün cədvəlinkindən istifadə edin.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Statistika kartları və cədvəl <strong>ilk dəstəni</strong> əks etdirir. «Daha çox yüklə» ilə
          əlavə qrantlar gətirsəniz, kart sayları yenilənmir — onlar yalnız status süzgəci dəyişəndə
          (və ya yenilədikdə) yenidən hesablanır. Ümumi mənzərə üçün kartlara, dəqiq qeyd üçün isə
          cədvələ baxın.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün qrant qeydləri təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın qrantlarını
          görürsünüz. Səhifə yalnız oxumaq üçündür: buradan heç bir qrantı yaratmaq, dəyişmək və ya
          silmək mümkün deyil.
        </p>
      </HelpCallout>
    </div>
  )
}
