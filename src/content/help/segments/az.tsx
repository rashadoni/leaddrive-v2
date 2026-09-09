"use client"

/**
 * Seqmentlər — yardım məqaləsi (Azərbaycanca).
 * Köhnə birgə məqalədən ayrılıb: yalnız Seqmentlər səhifəsini əhatə edir
 * (seqment yaratma, dinamik/statik tip, filtrlər və davranış filtrləri,
 * önizləmə, redaktə, axtarış/tip süzgəci, silmə). Kampaniya, jurnal və
 * sair qonşu funksiyalar bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SegmentsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Marketinq və ya satış əməliyyatları ilə məşğul olursunuz"
        goal="Kontaktlarınızı meyarlara görə adlı qruplara — seqmentlərə — bölmək, ki sonra hədəfli kampaniyalar göndərə və analitika apara biləsiniz"
      >
        Səhifə <HelpKey>Seqmentlər</HelpKey> bölməsində açılır. Bütün seqmentlər və onlara uyğun
        gələn kontaktların sayı yalnız sizin təşkilatınız üçündür. Burada gördüyünüz hər şey —
        saylar, kartlar, faizlər — eyni siyahıdan oxunur, ona görə seqment əlavə edib sildikcə
        yuxarıdakı statistika kartları dərhal yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Seqmentlər</HelpKey> adı və «Hədəfli kampaniyalar və analitika üçün
          kontakt qrupları» izahı var; sağ yuxarıda <HelpKey>Yeni seqment</HelpKey> düyməsi durur.
          Aşağıda izahedici sətir və «Bilirdinizmi?» ipucu kartı gəlir. Onların altında üç
          statistika kartı var: <strong>Cəmi seqmentlər</strong>, <strong>Dinamik</strong> və{" "}
          <strong>Statik</strong> — bu kartlar həm say göstərir, həm də süzgəc kimi işləyir
          (üstünə basanda siyahını həmin tipə görə süzür). Seqmentiniz varsa, kartların altında
          axtarış sahəsi və «{"{süzülən}"} / {"{ümumi}"}» sayğacı, daha sonra isə seqment kartları
          iki sütunlu şəbəkədə göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Seqment">Meyarlara görə birləşdirilmiş adlı kontakt qrupu — kampaniya hədəfləmək və analitika üçün.</HelpDef>
          <HelpDef term="Cəmi seqmentlər">Yaratdığınız bütün seqmentlərin sayı (dinamik və statik birlikdə).</HelpDef>
          <HelpDef term="Dinamik">Filtr meyarlarına uyğun olaraq avtomatik yenilənən seqment — kontakt bazası dəyişdikcə tərkibi öz-özünə yenilənir. Kartda yaşıl «Auto» nişanı ilə işarələnir.</HelpDef>
          <HelpDef term="Statik">Sabit tərkibli seqment — əl ilə tərtib olunmuş, avtomatik yenilənmir. Kartda «Sabit» nişanı ilə işarələnir.</HelpDef>
          <HelpDef term="Filtrlər (meyarlar)">Şirkət, mənbə, vəzifə, etiket, tarix, e-poçt/telefonun olması və s. şərtlər — hansı kontaktların seqmentə uyğun gəldiyini təyin edir.</HelpDef>
          <HelpDef term="Davranış filtrləri">Cəlbetmə balı, cəlbetmə səviyyəsi (isti/ılıq/soyuq), qeyri-aktiv günlər, son aktivlik tarixi və hadisə tipi üzrə əlavə şərtlər.</HelpDef>
          <HelpDef term="Önizləmə">Yadda saxlamadan, cari filtrlərə neçə kontaktın uyğun gəldiyini sayan funksiya.</HelpDef>
        </dl>
        <p>
          Hər seqment kartında ad və yanında <strong>Auto</strong> (dinamik) və ya{" "}
          <strong>Sabit</strong> (statik) nişanı, varsa təsvir, böyük rəqəmlə kontakt sayı və
          «{"{faiz}"}% bazadan» göstəricisi olan nazik dolma zolağı, aşağıda isə ilk dörd filtr
          şərti kiçik nişanlar (chip) kimi görünür (dörddən çox şərt varsa «+N» yazılır). Kartın
          üstünə gələndə sağ küncdə qələm (redaktə) və zibil qutusu (sil) ikonaları peyda olur;
          kartın özünə basmaq da seqmenti redaktə üçün açır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: yeni seqment yarat">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>Yeni seqment</HelpKey> düyməsini basın. (Heç seqment yoxdursa,
            boş vəziyyətin ortasındakı <HelpKey>Seqment yarat</HelpKey> düyməsi də eyni işi görür.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Yeni seqment» başlıqlı pəncərə açılır (bənövşəyi insan ikonası ilə), altında «Kontaktları
            qruplaşdırmaq üçün filtrləri konfiqurasiya edin» izahı. İçində ad sahəsi, təsvir sahəsi,
            tip seçici və filtrlər bölməsi var.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Yuxarıdakı <strong>Seqment adı</strong> sahəsini doldurun — bu yeganə məcburi sahədir
            (yanında <HelpKey>*</HelpKey> işarəsi var, məs. «VIP müştərilər»). İstəsəniz altdakı{" "}
            <strong>Təsvir (istəyə bağlı)</strong> sahəsinə qısa izah da yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca mətn sahələrdə görünür. Adı boş buraxıb yadda saxlamağa çalışsanız, pəncərənin
            yuxarısında qırmızı «Seqment adını daxil edin» xəbərdarlığı çıxır və yadda saxlama dayanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Tip seçicisində seqmentin <HelpKey>Dinamik</HelpKey> (ildırım ikonası) və ya{" "}
            <HelpKey>Statik</HelpKey> (arxiv ikonası) olacağını seçin. Standart olaraq{" "}
            <strong>Dinamik</strong> seçilidir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            İki düyməli kapsul keçidi var; seçilmiş tərəf ağ fonla işıqlanır (dinamikdə yaşıl mətnlə).
            Dinamik seqment meyarlara uyğun avtomatik yenilənir; statik isə sabit qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            <strong>Filtrlər</strong> bölməsində kontaktları seçən şərtləri doldurun. Şəbəkədə bu
            sahələr var: <strong>Şirkət</strong>, <strong>Mənbə</strong> (açılan siyahı),{" "}
            <strong>Brend</strong>, <strong>Kateqoriya</strong> (açılan siyahı),{" "}
            <strong>SMS kampaniyası aldı</strong> keçidi ilə <strong>SMS son (gün)</strong>,{" "}
            <strong>Vəzifə</strong>, <strong>Etiket</strong>, <strong>Kontakt adı</strong>,{" "}
            <strong>Sonra/Əvvəl yaradılıb</strong> tarixləri və <strong>Email var</strong> /{" "}
            <strong>Telefon var</strong> qutuları.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər doldurduğunuz şərt üçün «Filtrlər» başlığının yanındakı sayğac bir vahid artır və
            yuxarıda həmin şərt silinə bilən bənövşəyi nişan (chip) kimi görünür. <strong>Hamısını
            sıfırla</strong> düyməsi bütün şərtləri təmizləyir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            İstəyə bağlı olaraq aşağıdakı sarı <strong>Davranış filtrləri</strong> çərçivəsindən
            əlavə şərtlər seçin: <strong>Min/Maks cəlbetmə balı</strong>,{" "}
            <strong>Cəlbetmə səviyyəsi</strong> (İsti/Ilıq/Soyuq), <strong>Qeyri-aktiv gün</strong>,{" "}
            <strong>Sonra aktiv</strong> tarixi və <strong>Hadisə var</strong> (məs. Email açıldı,
            Sövdələşmə yaradıldı).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Davranış filtrləri» başlıqlı sarımtıl çərçivə iki sütunda sahələri göstərir; bal sahələri
            yalnız rəqəm (0–100) qəbul edir, səviyyə və hadisə isə açılan siyahıdan seçilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>
            Yadda saxlamadan əvvəl, pəncərənin altındakı solda yerləşən <HelpKey>Önizləmə</HelpKey>{" "}
            düyməsini basıb cari filtrlərə neçə kontaktın uyğun gəldiyini yoxlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə «Sayılır...» yazısına keçir, sonra yaşıl qutu çıxır: böyük rəqəm və altında
            «kontakt uyğundur» yazısı. Şərtləri dəyişsəniz, yenidən önizləmə etmək lazımdır
            (nəticə sıfırlanır).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={7}>
          <p>
            Aşağı sağdakı <HelpKey>Saxla</HelpKey> düyməsini basın. (Fikrinizi dəyişsəniz —{" "}
            <HelpKey>Ləğv et</HelpKey> və ya sağ yuxarıdakı × ilə bağlayın.)
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yadda saxlanarkən «Saxlanılır...» yazısına keçir, sonra pəncərə bağlanır və yeni
            seqment kartı siyahıda peyda olur. <strong>Cəmi seqmentlər</strong> kartındakı say (və
            tipinə görə <strong>Dinamik</strong> və ya <strong>Statik</strong> kartı) bir vahid artır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: seqmentləri tap və süz">
        <HelpStep n={1}>
          <p>
            Müəyyən tipdəki seqmentləri görmək üçün yuxarıdakı statistika kartlarından birini
            basın: <HelpKey>Dinamik</HelpKey> və ya <HelpKey>Statik</HelpKey>. Yenidən basanda və ya{" "}
            <HelpKey>Cəmi seqmentlər</HelpKey> kartını basanda süzgəc götürülür.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş kart rəngli haşiyə ilə işıqlanır (dinamik — yaşıl, statik — boz), siyahıda yalnız
            həmin tipdəki kartlar qalır. Heç biri uyğun gəlmirsə «Heç nə tapılmadı» mesajı çıxır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Ada və ya təsvirə görə axtarmaq üçün kartların altındakı{" "}
            <HelpKey>Seqment axtar...</HelpKey> sahəsinə yazın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca siyahı dərhal süzülür və yanındakı sayğac «{"{süzülən}"} / {"{ümumi}"}» şəklində
            uyğun gələn seqmentlərin sayını göstərir. (Axtarış sahəsi yalnız ən azı bir seqment
            olduqda görünür.)
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: seqmenti redaktə et və ya sil">
        <HelpStep n={1}>
          <p>
            Seqmenti dəyişmək üçün kartın özünə basın və ya üstünə gələndə görünən qələm
            (<HelpKey>Seqmenti redaktə et</HelpKey>) ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Seqmenti redaktə et» başlıqlı, mövcud ad, təsvir, tip və filtrlərlə əvvəlcədən doldurulmuş
            eyni forma açılır. Dəyişiklikləri edib (istəsəniz yenidən <HelpKey>Önizləmə</HelpKey> ilə
            yoxlayıb) <HelpKey>Saxla</HelpKey> ilə təsdiqləyin.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Seqmenti silmək üçün kartın üstünə gələndə sağ küncdə görünən zibil qutusu
            (<HelpKey>Seqmenti sil</HelpKey>) ikonasını basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Seqmenti sil» başlıqlı təsdiq pəncərəsi açılır (qırmızı xəbərdarlıq ikonası ilə) və
            seqmentin adını göstərir. <HelpKey>Sil</HelpKey> ilə təsdiqlədikdən sonra seqment
            siyahıdan çıxır və yuxarıdakı statistika kartları yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Seqmentin silinməsi geri qaytarılmır. Diqqət: silinən seqment kontaktların özünü silmir
            — yalnız qrupu (seqmenti) aradan götürür, kontaktlar öz yerində qalır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Dinamik seqment seçin ki tərkibi avtomatik yenilənsin — meyarlara uyğun yeni kontaktlar
          əlavə olunduqca özü-özünə daxil olurlar. Sabit (statik) tipi yalnız bir dəfəlik, dəyişməyən
          siyahı lazım olanda seçin. Yadda saxlamadan əvvəl həmişə <HelpKey>Önizləmə</HelpKey> edin —
          beləliklə seqmentin boş və ya gözlədiyinizdən çox böyük çıxmadığını qabaqcadan görürsünüz.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün seqmentlər və onlara uyğun gələn kontaktlar təşkilatınızla məhdudlaşır — yalnız öz
          tenant-ınızın kontaktları sayılır və başqa təşkilatın seqmentlərini görmürsünüz. Önizləmə və
          kontakt sayları da yalnız sizin təşkilatınızın bazasından hesablanır.
        </p>
      </HelpCallout>
    </div>
  )
}
