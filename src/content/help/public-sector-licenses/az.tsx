"use client"

/**
 * Public Sector — Lisenziyalar reyestri — help article (Azerbaijani).
 * Yalnız Dövlət sektoru → Lisenziyalar səhifəsini əhatə edir: lisenziya
 * reyestri, statistika kartları, axtarış/status filtri, cədvəl və «Daha çox
 * yüklə». Səhifə YALNIZ oxumaq üçündür — burada lisenziya yaratma/redaktə
 * forması YOXDUR.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function publicsectorlicensesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dövlət sektoru xidmət əməkdaşı və ya inzibatçısısınız"
        goal="Təşkilatın verdiyi lisenziyaların reyestrini gözdən keçirmək, statusa görə süzgəcdən keçirmək və konkret lisenziya nömrəsini tapmaq"
      >
        Səhifəyə <HelpKey>Dövlət sektoru</HelpKey> → <HelpKey>Lisenziyalar</HelpKey> yolu ilə
        çatırsınız. Bu səhifə yalnız oxumaq üçündür — lisenziyaları nəzərdən keçirir və süzgəcdən
        keçirirsiniz, amma buradan yeni lisenziya yaratmırsınız. Bütün reyestr yalnız sizin
        təşkilatınız üçündür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda firuzəyi <HelpKey>Landmark</HelpKey> ikonası və <HelpKey>Lisenziyalar</HelpKey>{" "}
          adı, altında «Lisenziya reyestri — sürücülük vəsiqələri, biznes icazələri, peşə
          lisenziyaları və s.» izahı var. Altda dörd statistika kartı durur:{" "}
          <strong>Ümumi Lisenziya</strong>, <strong>Verilmiş</strong>,{" "}
          <strong>Müddəti bitmiş</strong> və <strong>Ləğv edilmiş</strong>. Onların altında süzgəc
          zolağı (axtarış sahəsi, status seçimi, yeniləmə düyməsi), daha aşağıda isə lisenziya
          cədvəli gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi Lisenziya">Hazırda cədvələ yüklənmiş lisenziyaların sayı.</HelpDef>
          <HelpDef term="Verilmiş">Statusu «Verildi» olan lisenziyaların sayı.</HelpDef>
          <HelpDef term="Müddəti bitmiş">Statusu «Müddəti bitdi» olan lisenziyaların sayı.</HelpDef>
          <HelpDef term="Ləğv edilmiş">Statusu «Ləğv edildi» olan lisenziyaların sayı.</HelpDef>
          <HelpDef term="Lisenziya №">Hər lisenziyanın unikal nömrəsi (monospace şriftlə göstərilir).</HelpDef>
          <HelpDef term="Növ">Lisenziyanın növü — alt xətlər boşluqla əvəz edilir və baş hərflə göstərilir (məs. «business permit»).</HelpDef>
          <HelpDef term="Status">Rəngli nişan — Müraciət edildi, Baxış altında, Verildi, Rədd edildi, Müddəti bitdi, Dayandırıldı və ya Ləğv edildi.</HelpDef>
          <HelpDef term="Verilmə tarixi">Lisenziyanın verildiyi tarix; boşdursa «—» göstərilir.</HelpDef>
          <HelpDef term="Bitmə tarixi">Lisenziyanın müddətinin bitdiyi tarix; boşdursa «—» göstərilir.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: reyestri oxu və statistikanı anla">
        <HelpStep n={1}>
          <p>
            Səhifə açılanda lisenziyalar avtomatik yüklənir. Üstdəki dörd kartla başlayın:{" "}
            <strong>Ümumi Lisenziya</strong>, <strong>Verilmiş</strong>,{" "}
            <strong>Müddəti bitmiş</strong>, <strong>Ləğv edilmiş</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kart bir say göstərir. Bu saylar yüklənmiş ilk dəstə üzərində hesablanır, ona görə
            ilk açılışdakı vəziyyəti əks etdirir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Cədvələ baxın — hər sətir bir lisenziyadır, beş sütun var.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sütunlar: <strong>Lisenziya №</strong>, <strong>Növ</strong>, <strong>Status</strong>{" "}
            (rəngli nişan), <strong>Verilmə tarixi</strong> və <strong>Bitmə tarixi</strong>. Tarix
            yoxdursa xanada «—» durur. Heç bir lisenziya yoxdursa, cədvəl boş vəziyyət göstərir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: lisenziya axtar və süzgəcdən keçir">
        <HelpStep n={1}>
          <p>
            Süzgəc zolağında axtarış sahəsinə («ID və ya email ilə axtarın…» yer tutucusu)
            lisenziya nömrəsini yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca cədvəl təxminən yarım saniyə fasilə ilə özü yenilənir (hər hərfdə dərhal yox).
            Cədvəldə yalnız axtarışa uyğun lisenziyalar qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Status açılan siyahısından bir status seçin (məs. <HelpKey>Verildi</HelpKey> və ya{" "}
            <HelpKey>Müddəti bitdi</HelpKey>). Hamısını görmək üçün <HelpKey>Bütün statuslar</HelpKey>{" "}
            seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahıda yeddi status var: Müraciət edildi, Baxış altında, Verildi, Rədd edildi, Müddəti
            bitdi, Dayandırıldı, Ləğv edildi. Seçimdən dərhal sonra cədvəl həmin statuslu
            lisenziyalarla yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Cədvəli yenidən yükləmək üçün süzgəc zolağının sağındakı dairəvi ox ikonalı{" "}
            <HelpKey>yeniləmə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl baxdan yenidən yüklənir və cari axtarış ilə status seçimi qüvvədə qalır;
            statistika kartlarındakı saylar da yenidən hesablanır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: daha çox lisenziya yüklə">
        <HelpStep n={1}>
          <p>
            Cədvəldə göstəriləndən artıq lisenziya varsa, aşağıda <HelpKey>Daha çox yüklə</HelpKey>{" "}
            düyməsi peyda olur. Onu basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Növbəti dəstə lisenziya mövcud sətirlərin sonuna əlavə edilir. Yükləmə gedərkən düymə
            müvəqqəti deaktiv olur. Daha yüklənəcək lisenziya qalmayanda düymə yox olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Statistika kartlarındakı saylar yalnız ilk yüklənmiş dəstə üzərində hesablanır — «Daha çox
          yüklə» ilə əlavə sətirlər gətirsəniz, kartlar onları avtomatik saymır. Tam mənzərə üçün
          status süzgəcindən istifadə edin və ya yeniləmə düyməsini basın.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu səhifə yalnız oxumaq üçündür: lisenziyaya baxır, axtarır və süzgəcdən keçirirsiniz, amma
          buradan lisenziya yaratmır, redaktə etmir və ya silmirsiniz. Lisenziya nömrəsi, növü və
          statusu kimi məlumatlar yalnız nümayiş üçündür.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün lisenziya reyestri təşkilatınızla məhdudlaşır — sorğu sizin tenant-ınızın
          identifikatoru ilə göndərilir, ona görə başqa təşkilatların lisenziyalarını görmürsünüz.
        </p>
      </HelpCallout>
    </div>
  )
}
