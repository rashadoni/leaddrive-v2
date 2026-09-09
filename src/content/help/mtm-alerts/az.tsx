"use client"

/**
 * MTM Xəbərdarlıqlar — help article (Azerbaijani).
 * Yalnız MTM → Xəbərdarlıqlar səhifəsini əhatə edir (GPS anomaliyaları,
 * gecikmələr, buraxılmış ziyarətlər). Xəbərdarlıqlar sistem tərəfindən
 * yaradılır — burada yalnız onları SÜZÜR, OXUYUR, HƏLL EDİR və ya SİLİRSİNİZ;
 * səhifədə əl ilə xəbərdarlıq yaratma YOXDUR.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mtmalertsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sahə əməliyyatları üzrə nəzarətçi və ya MTM administratorusunuz"
        goal="Marşrut üzrə yaranan problemləri — GPS anomaliyaları, gec başlamalar, buraxılmış ziyarətlər — bir yerdə görmək, vacib olanları süzmək və həll edildikcə işarələmək"
      >
        Səhifəyə <HelpKey>MTM</HelpKey> → <HelpKey>Xəbərdarlıqlar</HelpKey> yolu ilə çatırsınız.
        Xəbərdarlıqları siz yaratmırsınız — onları sistem nümayəndələrin marşrut fəaliyyətinə
        əsasən özü yaradır. Bütün xəbərdarlıqlar yalnız sizin təşkilatınıza aiddir. Süzmə, axtarış
        və sıralama hamısı eyni siyahı üzərində işləyir, ona görə filtri dəyişdikcə yuxarıdakı
        statistika kartları və başlıqdakı say dərhal uyğunlaşır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda <HelpKey>Xəbərdarlıqlar</HelpKey> adı və mötərizədə süzülmüş nəticələrin sayı
          ((N) şəklində) durur, altında «GPS anomaliyaları, gecikmələr, buraxılmış ziyarətlər»
          izahı var. Sağ yuxarıda <HelpKey>Hamısını göstər</HelpKey> / <HelpKey>Həll edilmişləri gizlə</HelpKey>{" "}
          düyməsi durur — bu, həll edilmiş xəbərdarlıqların siyahıya daxil edilib-edilməyəcəyini
          idarə edir. Altda dörd statistika kartı, sonra kateqoriya süzgəc düymələri, axtarış
          sahəsi ilə sıralama seçimi və ən aşağıda xəbərdarlıq siyahısı gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Cəmi xəbərdarlıq">Hazırda yüklənmiş xəbərdarlıqların ümumi sayı.</HelpDef>
          <HelpDef term="Kritik">CRITICAL kateqoriyalı xəbərdarlıqların sayı (qırmızı).</HelpDef>
          <HelpDef term="Xəbərdarlıq">WARNING kateqoriyalı xəbərdarlıqların sayı (sarı/kəhrəba).</HelpDef>
          <HelpDef term="Həll edilmiş">Artıq həll edilmiş kimi işarələnmiş xəbərdarlıqların sayı.</HelpDef>
          <HelpDef term="Kateqoriya">Hər xəbərdarlığın səviyyəsi: Kritik, Xəbərdarlıq və ya Məlumat (Info) — kart rəngi buna görə dəyişir.</HelpDef>
          <HelpDef term="Nümayəndə">Xəbərdarlığın aid olduğu sahə işçisinin adı (sətirdə sağda göstərilir).</HelpDef>
          <HelpDef term="Tip">Xəbərdarlığın texniki növü (sətrin altında monospace yazı ilə) — məs. hansı qayda işə düşüb.</HelpDef>
        </dl>
        <p>
          Hər xəbərdarlıq sətri kateqoriyasına görə rənglənir: kritik — qırmızı, xəbərdarlıq —
          kəhrəba, məlumat — mavi. Sətrin solunda üçbucaq ikonası və xəbərdarlığın başlığı, sağında
          nümayəndənin adı və tarix-vaxt durur. Xəbərdarlıq hələ həll edilməyibsə, sağda{" "}
          <HelpKey>Həll et</HelpKey> düyməsi görünür; artıq həll edilibsə, onun yerində yaşıl{" "}
          <strong>Həll edilib</strong> nişanı olur. Ən sağda zibil qutusu ikonalı silmə düyməsi
          durur. Varsa, başlığın altında bir sətirlik təsvir, lap altda isə xəbərdarlığın tipi
          göstərilir.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: xəbərdarlıqları süz və tap">
        <HelpStep n={1}>
          <p>
            Yalnız müəyyən səviyyəni görmək üçün kateqoriya düymələrindən birini basın:{" "}
            <HelpKey>Hamısı</HelpKey>, <HelpKey>Kritik</HelpKey>, <HelpKey>Xəbərdarlıq</HelpKey> və ya{" "}
            <HelpKey>Məlumat</HelpKey>. Hər düymənin yanında mötərizədə həmin kateqoriyadakı sayı yazılır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş düymə dolu (vurğulanmış) görünür, qalanları cizgili qalır. Siyahı dərhal yalnız
            həmin kateqoriyaya uyğun sətirləri göstərir, başlıqdakı (N) sayı da yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Konkret bir xəbərdarlığı tapmaq üçün <HelpKey>Xəbərdarlıqları axtar...</HelpKey> sahəsinə yazın.
            Axtarış həm xəbərdarlığın başlığına, həm də nümayəndənin adına baxır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca siyahı canlı şəkildə süzülür — yalnız başlığında və ya nümayəndə adında həmin
            mətn olan sətirlər qalır. Heç nə uyğun gəlmirsə, «Xəbərdarlıq tapılmadı» mətni görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sırasını dəyişmək üçün sağdakı açılan siyahıdan <HelpKey>Əvvəlcə yeni</HelpKey> və ya{" "}
            <HelpKey>Kateqoriyaya görə</HelpKey> seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Əvvəlcə yeni» seçimində ən son yaranan xəbərdarlıqlar yuxarıda durur. «Kateqoriyaya görə»
            seçimində sətirlər əvvəl Kritik, sonra Xəbərdarlıq, sonra Məlumat ardıcıllığı ilə düzülür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Həll edilmiş xəbərdarlıqları da görmək üçün sağ yuxarıdakı <HelpKey>Hamısını göstər</HelpKey>{" "}
            düyməsini basın. Yenidən gizlətmək üçün eyni düymə artıq <HelpKey>Həll edilmişləri gizlə</HelpKey>{" "}
            yazılı olur — onu basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Hamısını göstər» basıldıqda siyahıya həll edilmiş xəbərdarlıqlar da əlavə olunur (yanında
            yaşıl <strong>Həll edilib</strong> nişanı ilə). Standart vəziyyətdə yalnız həll edilməmiş
            xəbərdarlıqlar göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: xəbərdarlığı həll et və ya sil">
        <HelpStep n={1}>
          <p>
            Probleme baxıb həll etmisinizsə, həmin sətirdəki <HelpKey>Həll et</HelpKey> düyməsini basın
            (yanında təsdiq ikonası olan kiçik düymə).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Alert resolved» bildirişi çıxır, siyahı yenilənir. Standart süzgəcdə xəbərdarlıq siyahıdan
            yox olur (artıq həll edilmiş sayılır); <strong>Həll edilmiş</strong> statistika kartındakı say
            bir vahid artır. «Hamısını göstər» rejimindəsinizsə, sətir qalır, amma <HelpKey>Həll et</HelpKey>{" "}
            düyməsinin yerini yaşıl <strong>Həll edilib</strong> nişanı tutur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Xəbərdarlığı büsbütün silmək üçün sətrin sağındakı zibil qutusu ikonalı düyməni basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Xəbərdarlığı sil» təsdiq pəncərəsi açılır və hansı xəbərdarlığın silinəcəyini (başlığı ilə)
            göstərir. Təsdiqlədikdən sonra sətir siyahıdan çıxır və <strong>Cəmi xəbərdarlıq</strong>{" "}
            kartındakı say azalır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          <HelpKey>Həll et</HelpKey> xəbərdarlığı silmir — onu sadəcə həll edilmiş kimi işarələyir, beləliklə
          standart siyahıdan çıxır, amma <HelpKey>Hamısını göstər</HelpKey> ilə geri tapılır və qeyd olaraq
          qalır. Sənədli iz saxlamaq istəyirsinizsə, silmək yerinə <HelpKey>Həll et</HelpKey> seçin.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Silmə geri qaytarılmır — silinmiş xəbərdarlıq siyahıdan birdəfəlik çıxır. Yalnız siyahını
          təmizləmək istəyirsinizsə, problemi əvvəlcə <HelpKey>Həll et</HelpKey> ilə bağlamaq daha
          təhlükəsizdir.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün xəbərdarlıqlar təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın nümayəndələrinə
          aid xəbərdarlıqları görürsünüz və başqa təşkilatın xəbərdarlıqlarına çıxışınız yoxdur.
        </p>
      </HelpCallout>
    </div>
  )
}
