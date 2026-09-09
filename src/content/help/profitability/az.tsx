"use client"

/**
 * Gəlirlilik (Profitability) — video-dərslik formatında kömək məqaləsi (Azərbaycanca).
 * Mənbə səhifə: src/app/(dashboard)/profitability/page.tsx + alt tablar
 * (overhead-tab, employees-tab, parameters-tab, clients-tab, ai-observations).
 * Səhifə xərc modeli analitikasıdır: 6 tab — Analitika, Xidmətlər, Müştərilər,
 * Əlavə xərclər, İşçilər, Parametrlər. Analitika/Xidmətlər/Müştərilər oxunur,
 * Əlavə xərclər/İşçilər/Parametrlər redaktə olunur.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ProfitabilityHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Maliyyə və ya əməliyyat rəhbərisiniz"
        goal="Hər xidmətin və müştərinin əslində nəyə başa gəldiyini görmək, marjanı izləmək və xərc modelinin girişlərini (işçilər, əlavə xərclər, parametrlər) güncəl saxlamaq"
      >
        Səhifəyə sol menyudan <HelpKey>Gəlirlilik</HelpKey> ilə çatırsınız. Bütün rəqəmlər yalnız sizin
        təşkilatınızın məlumatından hesablanır. Səhifə açılan kimi bütün xərc modeli arxa planda hesablanır
        — qısa müddətli fırlanan göstərici görəcəksiniz, sonra rəqəmlər gəlir. Modelin girişlərini (işçi
        siyahısı, əlavə xərclər, parametrlər) dəyişdikcə bütün tablardakı rəqəmlər avtomatik yenidən
        hesablanır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda kalkulyator ikonası ilə <HelpKey>Gəlirlilik</HelpKey> adı, yanında turu yenidən
          izləmə düyməsi və bu kömək düyməsi durur; altında «Xərc modeli analitikası» izahı və səhifə
          təsviri var. Aşağıda altı tab sırası gəlir, hər tabın yanında kiçik «i» işarəsi (üstünə gəldikdə
          tabın nə etdiyini izah edir): <strong>Analitika</strong>, <strong>Xidmətlər</strong>,{" "}
          <strong>Müştərilər</strong>, <strong>Əlavə xərclər</strong>, <strong>İşçilər</strong> və{" "}
          <strong>Parametrlər</strong>. Standart olaraq <strong>Analitika</strong> tabı açıq olur.
        </p>
        <p>
          Məlumat yüklənə bilməsə, başlıq qalır və «Məlumatları yükləmək mümkün olmadı. Parametrləri və
          əlavə xərcləri yoxlayın.» mesajı çıxır — bu adətən parametrlər və ya əlavə xərclər boş olduqda
          baş verir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Sec F (Ümumi xərc)">
            Minimum xərc: Administrativ + Texnika + IT/InfoSec + Ezamiyyət + Risk ehtiyatı. Pasterdəki
            halqanın mərkəzində göstərilir.
          </HelpDef>
          <HelpDef term="Sec G (Tam xidmət dəyəri)">
            Tam xərc: bütün şöbələr + admin bölüşdürmə + texnika birbaşa. «XƏRCLƏR / AY» kartı bunu
            göstərir.
          </HelpDef>
          <HelpDef term="Marja">
            Gəlir mənfi xərc. Müsbətdirsə yaşıl, mənfidirsə qırmızı görünür.
          </HelpDef>
          <HelpDef term="Əlavə xərclər (Overhead)">
            Birbaşa bir xidmətə aid olmayan xərclər — ofis icarəsi, sığorta, lisenziyalar və s.{" "}
            <strong>Admin</strong> (işçi sayına görə bölünür) və <strong>Tech</strong> (birbaşa xidmətə
            yönəlir) olmaqla iki növə ayrılır.
          </HelpDef>
          <HelpDef term="Maya (Müştəri xərci)">
            Bir müştəriyə düşən sabit + dəyişən xərclərin cəmi.
          </HelpDef>
          <HelpDef term="Da Vinci Analiz">
            Süni intellektin cari tabın rəqəmlərinə baxıb hazırladığı qısa müşahidə və tövsiyələr.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: Analitika tabını oxu">
        <HelpStep n={1}>
          <p>
            <HelpKey>Analitika</HelpKey> tabında qalın (standart açıq tabdır). Yuxarıdakı beş rəngli
            göstərici kartına baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Beş kart: <strong>XƏRCLƏR / AY</strong> (Sec G), <strong>GƏLİR / AY</strong>,{" "}
            <strong>MARJA / AY</strong>, <strong>GƏLİRLİ MÜŞTƏRİLƏR</strong> (say) və{" "}
            <strong>XƏRC / 1 İSTİFADƏÇİ</strong>. Hər kartın küncündə uyğun ikona olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sol qrafikə — <HelpKey>Xərc strukturu</HelpKey> dairəvi (donut) diaqramına baxın. Onun
            altındakı kateqoriyaların hər birinin üstünə basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Donutun mərkəzində «Sec F» və min ilə yuvarlaqlaşdırılmış xərc məbləği yazılır. Altında beş
            kateqoriya faizlə sadalanır: Admin xərclər, Texniki infra, Birbaşa əmək, Ezamiyyət, Risk
            ehtiyatı. Daha aşağıda eyni kateqoriyalar siyahı kimi açılır — yanında üçbucaq (▸) olanlara
            basanda alt-maddələrə açılır (məs. admin əlavə xərcləri, bek-ofis maaşları). Ən altda{" "}
            <strong>Ümumi xərc (F)</strong> və <strong>Tam xidmət dəyəri (G)</strong>, daha sonra Sec F/Sec G
            izahları və bölüşdürmə nisbəti (sabit % + dəyişən %) göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sağ qrafikə — <HelpKey>Xidmət xərcləri vs Gəlir</HelpKey> üfüqi sütun diaqramına baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər xidmət üçün qırmızı (Xərc) və yaşıl (Gəlir) iki sütun. Diaqramın altında hər xidmətin
            balansı göstərilir — müsbətdirsə yaşıl «+», mənfidirsə qırmızı rəqəm.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            İstəsəniz, ən aşağıdakı <HelpKey>Da Vinci Analiz</HelpKey> kartında eyni adlı düyməni basın
            (bax: aşağıdakı «Da Vinci Analiz» bölməsi).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düyməni basana qədər kart «Da Vinci analizi hələ başlamayıb.» mətnini göstərir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Xidmətlər tabını oxu">
        <HelpStep n={1}>
          <p>
            Yuxarıdakı <HelpKey>Xidmətlər</HelpKey> tabına keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yuxarıda dörd cəm kart: <strong>Ümumi xərc</strong>, <strong>Ümumi gəlir</strong>,{" "}
            <strong>Ümumi balans</strong> və <strong>Gəlirli / Zərərli</strong> (məs. «5 / 3»).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Altdakı xidmət kartlarına baxın (Daimi IT, InfoSec, ERP, GRC, Layihələr (PM), HelpDesk, Bulud,
            WAF).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər kartda xidmət adı və sağında <strong>Mənfəət</strong> / <strong>Zərər</strong> nişanı,
            altında qırmızı Xərc və yaşıl Gəlir zolaqları, ən altda dörd rəqəm: <strong>MARJA</strong> (%),{" "}
            <strong>İŞÇİ</strong> (say), <strong>MÜŞTƏRİ</strong> (say) və <strong>XƏRC/İŞÇİ</strong>.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Müştərilər tabında axtar və sırala">
        <HelpStep n={1}>
          <p>
            <HelpKey>Müştərilər</HelpKey> tabına keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Dörd cəm kart (<strong>Ümumi xərc</strong>, <strong>Ümumi gəlir</strong>,{" "}
            <strong>Ümumi balans</strong>, <strong>Müştərilər</strong> — sonuncunun altında yaşıl
            «Mənfəətli» və qırmızı «Zərərli» sayları), altında isə <strong>Müştəri Mənfəətliliyi</strong>{" "}
            başlıqlı cədvəl.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sağ yuxarıdakı axtarış qutusuna müştərinin adını və ya kodunu yazın (<HelpKey>Ad və ya kod ilə
            axtar...</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl yazdıqca süzülür. Heç nə uyğun gəlməsə «Nəticə tapılmadı», ümumiyyətlə müştəri yoxdursa
            «Müştəri məlumatı yoxdur» mətni çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            İstənilən sütun başlığını basıb sıralayın (Müştəri, İst., Qiymət, HelpDesk, Əsas Gəlir, Maya,
            Əsas Marja, Tam Marja, %). Eyni başlığa təkrar basanda artan/azalan istiqamət dəyişir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər başlığın yanında iki istiqamətli ox nişanı (↕) var. Marja sütunları müsbətdə yaşıl «+»,
            mənfidə qırmızı görünür; <strong>Status</strong> sütununda rəngli nişan olur — yaşıl
            «Mənfəət», sarı «Aşağı», qırmızı «Zərər» və ya boz «Gəlir yoxdur». Müştəri adı keçiddir —
            üstünə basanda həmin müştərinin detal səhifəsinə aparır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: əlavə xərc əlavə et və ya redaktə et">
        <HelpStep n={1}>
          <p>
            <HelpKey>Əlavə xərclər</HelpKey> tabına keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Üç cəm kart: <strong>Administrativ əlavə xərclər</strong>, <strong>Texniki infrastruktur</strong>{" "}
            və <strong>Ümumi overkəd</strong> (aylıq cəmlər). Altında «Xərc maddələri (N)» başlıqlı cədvəl
            və sağ yuxarıda <HelpKey>Əlavə et</HelpKey> düyməsi. Cədvəl sütunları: Label, Kateqoriya,
            Məbləğ, Hesablama, ƏDV, Xidmət, Tip, Aylıq.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sağ yuxarıdakı <HelpKey>Əlavə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəldə yeni sətir dərhal redaktə rejimində açılır — Label «Yeni xərc», Məbləğ 0 ilə. Sütunlar
            giriş sahələrinə çevrilir: mətn (Label), açılan siyahı (Kateqoriya), rəqəm (Məbləğ), Hesablama
            (Aylıq / İllik÷12 / Amort÷ay), ƏDV qeyd qutusu və <strong>Xidmət</strong> açılan siyahısı.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sahələri doldurun. <strong>Xidmət</strong> açılan siyahısında «None (Admin)» seçsəniz xərc{" "}
            <strong>Admin</strong>, bir xidmət seçsəniz <strong>Tech</strong> olur. ƏDV qutusu işarələnsə
            məbləğ avtomatik 18% artırılır; «Amort÷ay» seçəndə yanında ay sayını yazırsınız.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Tip</strong> sütunundakı nişan «Admin» ↔ «Tech» arasında dəyişir; ən sağdakı{" "}
            <strong>Aylıq</strong> dəyər siz yazdıqca dərhal yenidən hesablanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Sətrin sağındakı yaşıl tik (✓) ilə yadda saxlayın. (Fikrinizi dəyişsəniz qırmızı × ilə ləğv
            edin.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxlanarkən tik fırlanan göstəriciyə keçir, sonra sətir adi (oxunan) görünüşə qayıdır.
            Yuxarıdakı üç cəm kart və Analitika tabındakı struktur dərhal yenilənir. Xəta olarsa, cədvəlin
            üstündə qırmızı çərçivədə mesaj çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Mövcud xərci dəyişmək üçün sətrin sağındakı qələm ikonasını, silmək üçün qırmızı zibil qutusu
            ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Qələm sətri yenidən redaktə rejiminə salır. Zibil qutusu sətri dərhal cədvəldən silir və cəmlər
            yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: işçi vəzifəsi əlavə et və ya redaktə et">
        <HelpStep n={1}>
          <p>
            <HelpKey>İşçilər</HelpKey> tabına keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Üç cəm kart: <strong>Ümumi Say</strong>, <strong>Əmək haqqı/ay</strong> və{" "}
            <strong>Şöbələr</strong>. Altında şöbə süzgəci düymələri (<HelpKey>All (N)</HelpKey> və hər
            şöbə üçün ayrıca düymə, yanında say), daha aşağıda «İşçi siyahısı (N vəzifə)» cədvəli. Cədvəl
            sütunları: Şöbə, Vəzifə, Say, Netto maaş, Qross, Super qross, Ümumi/ay.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Sağ yuxarıdakı <HelpKey>Vəzifə əlavə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəldə yeni sətir redaktə rejimində açılır (standart şöbə IT, vəzifə «New Position», say 1,
            netto 0). Şöbə açılan siyahı, Vəzifə mətn, Say və Netto maaş rəqəm sahəsidir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Şöbəni, vəzifəni, sayı və netto maaşı yazın. <strong>Qross</strong> və{" "}
            <strong>Super qross</strong> avtomatik hesablanır (gəlir vergisi 14% və işəgötürən vergisi
            əlavə olunur) — bunları əl ilə yazmırsınız.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Netto maaşı dəyişdikcə Qross, Super qross və ən sağdakı <strong>Ümumi/ay</strong> dərhal
            yenidən hesablanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Yaşıl tik (✓) ilə yadda saxlayın. Mövcud sətri qələm ikonası ilə redaktə edin, qırmızı zibil
            qutusu ilə silin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Saxladıqdan sonra sətir oxunan görünüşə qayıdır; şöbə rəngli nişanla göstərilir.{" "}
            <strong>Ümumi Say</strong>, <strong>Əmək haqqı/ay</strong>, süzgəc düymələrindəki saylar və
            Analitika tabındakı «Birbaşa əmək» dərhal yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            İstəsəniz şöbə süzgəci düymələri ilə cədvəli süzün — məsələn yalnız <HelpKey>InfoSec</HelpKey>{" "}
            vəzifələrini görmək üçün.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş şöbə düyməsi dolu rənglə işarələnir, cədvəl yalnız həmin şöbənin sətirlərini göstərir,
            başlıqdakı «(N vəzifə)» sayı uyğunlaşır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: parametrləri tənzimlə">
        <HelpStep n={1}>
          <p>
            <HelpKey>Parametrlər</HelpKey> tabına keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yuxarıda izah mətni və bölüşdürmə nisbəti (Sabit % + Dəyişən %), sağda <HelpKey>Sıfırla</HelpKey>{" "}
            və <HelpKey>Saxla</HelpKey> düymələri. Altda kart-kart sahələr: <strong>Ümumi Məlumat</strong>{" "}
            (Cəm İstifadəçi Sayı), <strong>İŞÇİ SAYI</strong>, <strong>VERGİLƏR</strong>,{" "}
            <strong>NİSBƏTLƏR</strong>, <strong>OVERHEAD PAYLAŞMASI</strong> və ən altda{" "}
            <strong>Hesablanan Dəyərlər</strong>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstənilən sahənin rəqəmini dəyişin. Faiz sahələrində dəyəri faiz kimi yazırsınız (yanında «%»),
            qalanlarda adi rəqəm.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İlk dəyişiklikdən sonra <HelpKey>Saxla</HelpKey> düyməsinin yanında qırmızı{" "}
            <strong>Dəyişiklik</strong> nişanı çıxır və <HelpKey>Sıfırla</HelpKey> aktivləşir. Faiz
            sahəsinin yanında «(raw: …)» kimi xam onluq dəyər göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <strong>Cəm İstifadəçi Sayı</strong> sahəsində məlumatınız şirkətlərdəki real saydan
            fərqlənirsə, yanındakı <HelpKey>Sinx. → N</HelpKey> düyməsi ilə bir kliklə uyğunlaşdırın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Fərq varsa narıncı «⚠ Real: N (şirkətlərdən)» xəbərdarlığı və «Sinx.» düyməsi görünür; uyğun
            olduqda yaşıl «✓ Şirkət məlumatları ilə uyğundur» yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Düzəlişlərə razısınızsa <HelpKey>Saxla</HelpKey> düyməsini basın. (Geri qaytarmaq üçün{" "}
            <HelpKey>Sıfırla</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymədə fırlanan göstərici çıxır, sonra «Dəyişiklik» nişanı yox olur. Bütün tablardakı xərc
            rəqəmləri yeni parametrlərə görə yenidən hesablanır; ən altdakı <strong>Hesablanan Dəyərlər</strong>{" "}
            (dəyişən overhead nisbəti, əmək haqqı yükü əmsalı və s.) də yenilənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: Da Vinci Analiz">
        <HelpStep n={1}>
          <p>
            Analitika, Xidmətlər, Müştərilər və ya Əlavə xərclər tabının ən altındakı{" "}
            <HelpKey>Da Vinci Analiz</HelpKey> kartında eyni adlı düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Basana qədər kartda beyin ikonası və «Da Vinci analizi hələ başlamayıb.» mətni durur. Basandan
            sonra «Da Vinci düşünür... (30-60 san.)» yazısı və canlı animasiya çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Hazır olanda müşahidələri oxuyun. İstəsəniz <HelpKey>Düşüncə prosesi</HelpKey> sətrini açıb
            modelin əsaslandırmasını görün; yenidən hesablamaq üçün <HelpKey>Yenilə</HelpKey> düyməsini
            basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Mətn analiz kimi görünür; «Düşüncə prosesi» üçbucağı açılıb-bağlanır. Nəticə keşdən gəlirsə
            başlıqda «Cached» nişanı olur. Xəta olarsa qırmızı mesaj və <HelpKey>Təkrar cəhd</HelpKey>{" "}
            düyməsi çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Rəqəmlər səhv görünürsə, çox vaxt səbəb giriş məlumatıdır: əvvəlcə <HelpKey>Parametrlər</HelpKey>{" "}
          tabında istifadəçi/işçi saylarının və dərəcələrin doğru olduğunu, sonra{" "}
          <HelpKey>Əlavə xərclər</HelpKey> və <HelpKey>İşçilər</HelpKey> siyahılarının tam olduğunu
          yoxlayın. Bütün analitika məhz bu üç tabdakı girişlərdən hesablanır.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Əlavə xərc və ya işçi sətrini <strong>silmə geri qaytarılmır</strong> — sətir dərhal yox olur.
          Müvəqqəti çıxarmaq üçün ayrıca bir mexanizm yoxdur, ona görə silmədən əvvəl əmin olun.
          Parametrlərdə isə yadda saxlamadan əvvəl həmişə <HelpKey>Sıfırla</HelpKey> ilə dəyişiklikləri
          ləğv edə bilərsiniz.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün xərc modeli məlumatı (işçilər, əlavə xərclər, parametrlər, müştəri marjaları) yalnız sizin
          təşkilatınıza aiddir — başqa təşkilatın rəqəmlərini görmürsünüz. Da Vinci Analiz yalnız öz
          təşkilatınızın bu səhifədəki məlumatına baxır.
        </p>
      </HelpCallout>
    </div>
  )
}
