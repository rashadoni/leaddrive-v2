"use client"

/**
 * Survey detail — help article (Azerbaijani).
 * Sorğunun açıq səhifəsi (/surveys/[id]): analitika paneli, NPS bal kartı,
 * NPS dinamikası, sual konstruktoru (QuestionBuilder), avtomatlaşdırma
 * tetikləri, abunəlikdən imtina paneli, son cavablar siyahısı və CSV ixrac.
 * Sorğunun YARADILMASI bura DAXİL DEYİL — o, sorğular siyahısı səhifəsindədir.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function surveydetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dəstək, müştəri uğuru və ya əməliyyat üzrə menecersiniz"
        goal="Bir sorğunun nəticələrini oxumaq, suallarını və avtomatik göndərmə qaydalarını tənzimləmək, abunəlikdən imtina edənləri idarə etmək və cavabları CSV kimi ixrac etmək"
      >
        Bu səhifəyə sorğular siyahısından bir sorğunun adına klikləməklə çatırsınız (ünvan{" "}
        <HelpKey>/surveys/&lt;id&gt;</HelpKey>). Bütün məlumat — cavablar, analitika, abunəlikdən
        imtina edənlər — yalnız sizin təşkilatınıza aiddir. Səhifə açılanda yuxarıda qısa müddət
        boz «yüklənmə» bloku görünür, sonra sorğunun real məzmunu gəlir. Sorğunun özünü burada
        yaratmırsınız — yaratma siyahı səhifəsindədir; burada mövcud sorğunu izləyir və konfiqurasiya
        edirsiniz.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Ən yuxarıda <HelpKey>Geri</HelpKey> düyməsi (sizi sorğular siyahısına qaytarır),
          yanında sorğunun adı, adın altında iki nişan — <strong>status</strong> (məs. Aktiv,
          Qaralama, Pauza, Bağlı) və <strong>tip</strong> (böyük hərflərlə NPS / CSAT / CES /
          Xüsusi) — və sağ tərəfdə <HelpKey>CSV ixrac</HelpKey> düyməsi durur. Aşağıda bir-birinin
          ardınca bloklar gəlir:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Analitika paneli">
            Yuxarıda gün aralığı seçicisi (<strong>7d</strong>, <strong>30d</strong>,{" "}
            <strong>90d</strong>, <strong>1y</strong>) və beş xülasə kafeli: NPS, Orta bal, Cavablar,
            Göndərildi, Cavab faizi. Altında qrafiklər: vaxt üzrə cavablar, NPS paylanması (dairə),
            NPS dinamikası, kanallar, AI şərh tonu və şərhlərdəki top sözlər.
          </HelpDef>
          <HelpDef term="Avtomatlaşdırma tetikləri">
            Hadisə baş verəndə sorğunu avtomatik göndərmək üçün qeyd qutuları: bilet həll olunduqda,
            sövdələşmə qazanıldıqda, lid konvertasiya olunduqda, hesab-faktura ödənildikdə və SMS
            dublyaj.
          </HelpDef>
          <HelpDef term="Abunəlikdən imtina">
            Bu sorğudan və ya bütün sorğulardan imtina etmiş alıcıların siyahısı; əl ilə email/telefon
            əlavə edə bilərsiniz.
          </HelpDef>
          <HelpDef term="NPS bal kartı">
            Yalnız hesablanmış NPS varsa görünür — böyük rəqəm və 0–10 aralığında bal paylanma
            zolaqları (qırmızı 0–6, sarı 7–8, yaşıl 9–10).
          </HelpDef>
          <HelpDef term="NPS dinamikası (son 12 həftə)">
            Yalnız NPS tipli sorğularda və məlumat olduqda görünən həftəlik sütun qrafiki.
          </HelpDef>
          <HelpDef term="Bal paylanması / sual konstruktoru">
            Bu blokun içində <strong>sual konstruktoru</strong> durur — sorğunun suallarını burada
            əlavə edir, sıralayır və yenidən yadda saxlayırsınız.
          </HelpDef>
          <HelpDef term="Son cavablar">
            Hər cavabın bal dairəsi (kateqoriya rənginə görə), kateqoriya/kanal nişanları, kontakt
            və bilet bağlantısı, şərh və açıla bilən cavab detalları ilə siyahısı.
          </HelpDef>
        </dl>
        <p>
          Sorğu tapılmasa, səhifə sadəcə «Survey not found» mətnini göstərir. Cavab hələ yoxdursa, bir
          çox blok boş vəziyyət mətni ilə gəlir (məs. «Hələ cavab yoxdur.»).
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: nəticələri oxu və aralığı dəyiş">
        <HelpStep n={1}>
          <p>
            Analitika panelinin sağ yuxarısındakı aralıq düymələrindən birini seçin:{" "}
            <HelpKey>7d</HelpKey>, <HelpKey>30d</HelpKey>, <HelpKey>90d</HelpKey> və ya{" "}
            <HelpKey>1y</HelpKey>. Standart olaraq 30d seçilidir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş düymə dolu (vurğulu) görünür; beş xülasə kafeli (NPS, Orta bal, Cavablar,
            Göndərildi, Cavab faizi) və bütün qrafiklər həmin aralığa görə yenidən yüklənir. Həmin
            aralıqda heç cavab yoxdursa, qrafiklərin yerinə «Son N gündə cavab yoxdur.» mətni çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Aşağı sürüşdürüb qrafiklərə baxın: <strong>Vaxt üzrə cavablar</strong> (mavi xətt =
            hamısı, qırmızı = detraktorlar), <strong>NPS paylanması</strong> dairəsi (yaşıl
            promouterlər, sarı neytrallar, qırmızı detraktorlar), <strong>NPS dinamikası</strong>{" "}
            (bənövşəyi xətt) və <strong>Kanallar</strong> sütun qrafiki.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər nöqtənin üzərinə gələndə dəqiq rəqəmlərlə tooltip çıxır. Kanal məlumatı yoxdursa,
            kanal blokunda «Kanal məlumatı yoxdur.» yazısı görünür. NPS dairəsi yalnız dəyəri sıfırdan
            böyük olan kateqoriyaları göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Daha aşağıda <strong>Şərh tonu (AI)</strong> blokuna baxın — müsbət, neytral, mənfi və
            işlənir (pending) saylarını göstərir — və <strong>Şərhlərdəki top sözlər</strong> bulud
            şəklində ən çox təkrarlanan sözləri verir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            AI tonu bloku yalnız ən azı bir şərh tonu hesablandıqda peyda olur. Top sözlər daha çox
            təkrarlandıqca bir az daha böyük şriftlə yazılır və yanında say göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: avtomatik göndərmə tetiklərini quraşdır">
        <HelpStep n={1}>
          <p>
            <HelpKey>Avtomatlaşdırma tetikləri</HelpKey> blokunda istədiyiniz hadisənin qeyd qutusunu
            işarələyin: <strong>Bilet həll olunduqdan sonra</strong>, <strong>Sövdələşmə
            qazanıldıqdan sonra</strong>, <strong>Lid konvertasiyadan sonra</strong>,{" "}
            <strong>Hesab-faktura ödənildikdən sonra</strong> və ya <strong>SMS ilə də göndər</strong>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətrin altında nəyi işə saldığını izah edən kiçik mətn var. Qeyd qutusunu işarələyəndə
            o dərhal aktiv görünür, amma hələ yaddaşa yazılmır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Blokun aşağısındakı <HelpKey>Tetikləri yadda saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yadda saxlanarkən «Yadda saxlanılır…» mətninə keçir, sonra düymənin yanında «Saat
            HH:MM-də yadda saxlanıldı» yazısı görünür. Artıq həmin hadisə baş verəndə bu sorğu
            avtomatik göndəriləcək (əvvəl cavab vermiş alıcılar atlanılır).
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            «Hesab-faktura ödənildikdən sonra» tetikinin izahı qeyd edir ki, o hələ hesab-faktura
            axınına qoşulmayıb — qeyd qutusu yadda saxlanılır, lakin hələ heç nə göndərmir. Onu
            indidən işarələyə bilərsiniz, amma real göndərmə yalnız inteqrasiya hazır olanda işləyəcək.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: sorğunun suallarını dəyiş">
        <HelpStep n={1}>
          <p>
            <HelpKey>Bal paylanması</HelpKey> başlıqlı blokun içindəki sual konstruktoruna baxın. Yeni
            sual əlavə etmək üçün aşağıdakı düymələrdən birini basın:{" "}
            <HelpKey>NPS</HelpKey>, <HelpKey>Rating</HelpKey>, <HelpKey>Text</HelpKey>,{" "}
            <HelpKey>Choice</HelpKey> və ya <HelpKey>Yes/No</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Heç sual yoxdursa «No questions yet. Add one below.» mətni durur. Düyməni basanda yuxarıda
            yeni sual kartı peyda olur — tip seçicisi, sual mətni sahəsi və «Required» (məcburi) qeyd
            qutusu ilə. Rating tipində əlavə «Max» sahəsi, Choice tipində isə variant sətirləri və
            «Add option» düyməsi görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Hər kartda sual mətnini yazın, lazım olduqda tipi dəyişin, «Required» işarələyin. Sual
            sırasını dəyişmək üçün kartın solundakı tutacaq ikonasını, silmək üçün isə sağdakı qırmızı
            zibil qutusu ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tutacaq ikonasını basanda sual bir mövqe yuxarı/aşağı sürüşür (ən üstdəki sualda yuxarı
            keçid söndürülmüş olur). Zibil qutusu sualı dərhal siyahıdan çıxarır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Blokun sağ yuxarısındakı disket ikonalı <HelpKey>Tetikləri yadda saxla</HelpKey> düyməsini
            basın (bu düymə sualları da yadda saxlayır).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Yadda saxlanılır…» mətninə keçir; uğurlu olduqda yanında qısa müddət yaşıl «Saat
            HH:MM-də yadda saxlanıldı» yazısı göstərilir (təxminən 2 saniyə sonra itir).
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: abunəlikdən imtina edəni əlavə et və ya sil">
        <HelpStep n={1}>
          <p>
            <HelpKey>Abunəlikdən imtina</HelpKey> blokunda <strong>Email</strong> və/və ya{" "}
            <strong>Telefon</strong> yazın, <strong>Əhatə</strong> seçicisindən{" "}
            <HelpKey>Yalnız bu sorğu</HelpKey> və ya <HelpKey>Bütün sorğular (təşkilat)</HelpKey>{" "}
            seçin, sonra <HelpKey>Əlavə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Email və telefonun ikisi də boşdursa <HelpKey>Əlavə et</HelpKey> düyməsi söndürülü qalır.
            Əlavə etdikdən sonra siyahı yenilənir və yeni sətir görünür — solunda «sorğu» və ya
            «təşkilat» nişanı, yanında email/telefon, sağında tarix və silmə (zibil qutusu) ikonası.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Siyahıdan birini çıxarmaq üçün həmin sətrin sağındakı zibil qutusu ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «İmtina siyahısından silmək?» təsdiq pəncərəsi çıxır; təsdiqlədikdən sonra sətir siyahıdan
            yox olur. Siyahı boşalanda «Siyahıda yoxdur.» mətni görünür.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: cavabları gözdən keçir və CSV ixrac et">
        <HelpStep n={1}>
          <p>
            Səhifənin sonundakı <HelpKey>Son cavablar</HelpKey> blokuna baxın — başlıqda mötərizədə
            cavab sayı yazılır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər cavab sətrində soldakı dairədə bal (promouter yaşıl, neytral sarı, detraktor qırmızı,
            bal yoxdursa «—»), kateqoriya və kanal nişanları, cavab tarixi, varsa kontakt adı (klik
            ediləndir), e-poçt/telefon və bağlı bilet nömrəsi olur. Şərh varsa ayrıca boz qutuda, yanında
            mümkünsə AI tonu nişanı ilə göstərilir. Heç cavab yoxdursa «Hələ cavab yoxdur.» mətni durur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Tam cavab detallarını görmək üçün cavab sətrindəki <HelpKey>Show N answer(s)</HelpKey>{" "}
            (cavabları göstər) açıla bilən başlığını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sual identifikatoru və respondentin cavabı sətir-sətir açılır. Yenidən basanda yığılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bütün cavabları yükləmək üçün səhifənin yuxarısındakı <HelpKey>CSV ixrac</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Brauzer yeni nişanda ixrac ünvanını açır və CSV faylının yüklənməsi başlayır. Fayl bu
            sorğunun cavablarını saxlayır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Səhifədə suallar üçün ayrıca disket düyməsi yoxdur — sual konstruktorunun üstündəki{" "}
          <HelpKey>Tetikləri yadda saxla</HelpKey> düyməsi həm dəyişdirdiyiniz sualları, həm də sual
          blokunu birlikdə yaddaşa yazır. Avtomatlaşdırma blokunun öz ayrıca yadda saxlama düyməsi var,
          ona görə tetikləri ayrıca saxlamağı unutmayın.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          NPS bal kartı və NPS dinamikası qrafiki yalnız müvafiq məlumat olduqda görünür — yəni
          hesablanmış NPS varsa və (dinamika üçün) tip <strong>NPS</strong>-dirsə. Onları görmürsünüzsə,
          səbəb hələ kifayət qədər cavabın olmaması və ya sorğunun NPS tipində olmamasıdır, nasazlıq deyil.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün cavablar, analitika və abunəlikdən imtina qeydləri təşkilatınızla məhdudlaşır — başqa
          tenant-ın sorğularını görmürsünüz. Cavablardakı kontakt və bilet bağlantıları yalnız öz
          təşkilatınızdakı qeydlərə aparır. CSV ixrac da yalnız bu sorğuya aid cavabları əhatə edir.
        </p>
      </HelpCallout>
    </div>
  )
}
