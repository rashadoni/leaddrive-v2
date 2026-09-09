"use client"

/**
 * Energy & Utilities → Qəzalar (Outages) — help article (Azerbaijani).
 * Ümumi «energy» vertical məqaləsindən ayrılıb: yalnız
 * /energy/outages səhifəsini əhatə edir (qəza siyahısı, 4 statistika
 * kartı, status filtri, «Daha çox yüklə» səhifələmə). Səhifə yalnız
 * oxunandır — burada qəza yaratma/redaktə forması YOXDUR.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function energyoutagesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Şəbəkə dispetçeri və ya kommunal əməliyyat operatorusunuz"
        goal="Şəbəkə qəzalarının cari vəziyyətinə baxmaq, aktiv və kritik hadisələri tez seçmək və qəza tarixçəsini nəzərdən keçirmək"
      >
        Səhifəyə <HelpKey>Energetika və JKT</HelpKey> → <HelpKey>Qəzalar</HelpKey> yolu ilə çatırsınız.
        Bütün qəzalar yalnız sizin təşkilatınıza aiddir. Bu səhifə <strong>yalnız oxunan</strong> siyahıdır —
        baxış, filtr və səhifələmə üçündür; qəza yaratmaq və ya redaktə etmək üçün düymə burada yoxdur.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda alov ikonası ilə <HelpKey>Qəzalar</HelpKey> adı və altında «Şəbəkə qəzaları — aktiv
          hadisələr və tarix.» izahı var. Onun altında dörd statistika kartı, sonra bir filtr sətri
          (axtarış sahəsi, status seçimi və yeniləmə düyməsi), daha aşağıda qəzalar cədvəli, lazım gəldikdə
          isə cədvəlin altında <HelpKey>Daha çox yüklə</HelpKey> düyməsi gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi qəzalar">Hazırda yüklənmiş səhifədəki qəzaların sayı.</HelpDef>
          <HelpDef term="Aktiv">Yüklənmiş qəzalardan statusu «Aktiv» olanların sayı.</HelpDef>
          <HelpDef term="Aradan qaldırıldı">Yüklənmiş qəzalardan statusu «Aradan qaldırıldı» olanların sayı.</HelpDef>
          <HelpDef term="Kritik">Yüklənmiş qəzalardan ciddiliyi «critical» olanların sayı.</HelpDef>
          <HelpDef term="Qəza / Səbəb">Cədvəlin birinci sütunu: yuxarıda qəza nömrəsi (məs. monospasiya ilə), altında səbəb (Planlı texniki xidmət, Avadanlıq sıradan çıxması, Hava şəraiti, Üçüncü tərəf zərəri, Həddindən artıq yük və ya Naməlum).</HelpDef>
          <HelpDef term="Status">Qəzanın vəziyyəti — rəngli nişanla: Gözlənilir, Aktiv, Aradan qaldırıldı və ya Ləğv edildi.</HelpDef>
          <HelpDef term="Ciddilik">minor / moderate / major / critical səviyyəsi, rəngli nişanla.</HelpDef>
          <HelpDef term="Təsirlənən sayğaclar">Qəzadan təsirlənən sayğacların sayı (rəqəm).</HelpDef>
          <HelpDef term="Başlama vaxtı">Qəzanın faktiki başlama tarixi və saatı; qeyd yoxdursa «—» göstərilir.</HelpDef>
        </dl>
        <p>
          Statistika kartlarındakı saylar <strong>bütün qəzalar üzrə deyil</strong>, hazırda yüklənmiş
          siyahıya əsaslanır — siz <HelpKey>Daha çox yüklə</HelpKey> ilə əlavə qəza çəkdikcə və ya status
          filtrini dəyişdikcə bu saylar uyğun olaraq dəyişir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: qəza siyahısına bax və yenilə">
        <HelpStep n={1}>
          <p>
            Səhifəni açın. Sistem avtomatik olaraq ən son yaradılan qəzaları (ilk 50 qədər) çəkir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl ən yeni qəzalardan başlayaraq dolur (sıralama yaradılma tarixinə görə, azalan). Heç qəza
            yoxdursa cədvəl boş qalır. Dörd statistika kartı yüklənmiş bu siyahıya görə hesablanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Siyahını yeniləmək üçün filtr sətrindəki yeniləmə (dairəvi ox) ikonalı düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Siyahı sıfırlanır və serverdən yenidən çəkilir; statistika kartları da təzələnir. Bu, başqası
            yeni qəza qeyd edibsə onu görmək üçün ən sürətli yoldur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Cədvəlin altında <HelpKey>Daha çox yüklə</HelpKey> düyməsi varsa, onu basaraq növbəti hissəni çəkin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Növbəti qəzalar cari siyahının sonuna əlavə olunur (mövcudları əvəz etmir). Daha çox qeyd
            qalmayıbsa, <HelpKey>Daha çox yüklə</HelpKey> düyməsi görünmür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: statusa görə filtrlə">
        <HelpStep n={1}>
          <p>
            Filtr sətrindəki status açılan siyahısını açın. Seçimlər: <HelpKey>Bütün statuslar</HelpKey>,{" "}
            <strong>Gözlənilir</strong>, <strong>Aktiv</strong>, <strong>Aradan qaldırıldı</strong> və{" "}
            <strong>Ləğv edildi</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahıda yuxarıda <HelpKey>Bütün statuslar</HelpKey> durur, ardınca dörd status seçimi gəlir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Bir status seçin (məs. <strong>Aktiv</strong>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl dərhal sıfırlanıb yalnız seçilmiş statusa uyğun qəzalarla yenidən dolur; statistika
            kartları da bu süzülmüş nəticəyə görə yenidən hesablanır. <HelpKey>Bütün statuslar</HelpKey>{" "}
            seçərək filtri ləğv edə bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="warning">
        <p>
          Filtr sətrindəki axtarış sahəsi («Hesab nömrəsi ilə axtar…» göstərişi ilə) bu səhifədə{" "}
          <strong>hələ nəticəni süzmür</strong> — yazdığınız mətn cədvələ təsir etmir. Qəzaları daraltmaq üçün
          yuxarıdakı <strong>status</strong> açılan siyahısından istifadə edin. Qəza nömrəsinə görə tez
          tapmaq lazımdırsa, status filtri ilə birlikdə brauzerin öz səhifədaxili axtarışını (Cmd/Ctrl+F)
          işlədin.
        </p>
      </HelpCallout>

      <HelpCallout kind="tip">
        <p>
          Aktiv hadisələrə cəld baxış üçün statusu <strong>Aktiv</strong> qoyub yeniləmə düyməsi ilə
          dövri olaraq təzələyin — kart sayları və cədvəl o anda kimin reaksiya tələb etdiyini göstərir.
          <strong> Kritik</strong> kartındakı say sıfırdan böyükdürsə, ciddilik sütununda qırmızı «critical»
          nişanlı sətirlərə diqqət yetirin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün qəzalar təşkilatınızla məhdudlaşır — başqa tenant-ın qəzalarını görmürsünüz, və siyahıya
          hər baxış audit jurnalına (PII/əməliyyat girişi) yazılır. Qəzaların ictimai və daxili qeydləri
          (publicSummary / internalNotes) məlumat bazasında <strong>təşkilata bağlı şifrələnmiş</strong>{" "}
          saxlanılır; məhz buna görə də mətnə görə axtarış bu sahələri tapa bilməz — bu səhifə yalnız
          qəza nömrəsi, səbəb, status, ciddilik, təsirlənən sayğac və başlama vaxtı kimi şifrələnməmiş
          sahələri göstərir.
        </p>
      </HelpCallout>
    </div>
  )
}
