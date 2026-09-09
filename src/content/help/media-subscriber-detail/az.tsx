"use client"

/**
 * Media Cloud — abunəçi kartı (detal səhifəsi) — kömək məqaləsi (Azərbaycanca).
 * Mənbə: src/app/(dashboard)/media/[id]/page.tsx
 * Yalnız oxunan abunəçi qeydidir: başlıq kartı (bənövşəyi TV ikonası, ad,
 * status nişanı, abunəçi nömrəsi, email, plan) və iki məlumat kartı —
 * «Abunəlik məlumatı» (sol) və «Ödəniş və gəlir» (sağ). Bu səhifədə
 * redaktə/status/silmə düyməsi YOXDUR — qeyd burada yaradılmır, sadəcə baxılır.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function mediadetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Media Buludu operatoru və ya hesab menecerisiniz"
        goal="Bir abunəçinin tam kartını açıb statusunu, planını və gəlirini bir baxışda yoxlamaq"
      >
        Bu səhifəyə <HelpKey>Media Buludu</HelpKey> abunəçilər siyahısından bir sətrə klikləməklə
        gəlirsiniz. Səhifə <strong>yalnız oxunan qeyddir</strong> — burada heç nə dəyişmir, sadəcə
        bir abunəçinin bütün təfərrüatına baxırsınız. Bütün məlumat təşkilatınızla məhdudlaşır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Ən yuxarıda <HelpKey>Abunəçilərə qayıt</HelpKey> düyməsi var — onu basanda Media Buludu
          abunəçilər siyahısına qayıdırsınız. Altında bənövşəyi televizor ikonalı{" "}
          <strong>başlıq kartı</strong> gəlir: abunəçinin adı, yanında rəngli{" "}
          <strong>status nişanı</strong>, və bir sətirdə üç qısa məlumat — abunəçi nömrəsi
          (# ikonası, monospace yazı), email (varsa) və plan (tarifin adı, defislər boşluqla əvəz
          olunmuş halda).
        </p>
        <p>
          Başlığın altında yan-yana iki <strong>məlumat kartı</strong> durur:{" "}
          <strong>Abunəlik məlumatı</strong> (sol, # ikonası) və <strong>Ödəniş və gəlir</strong>{" "}
          (sağ, $ ikonası). Bəzi sətirlər yalnız uyğun məlumat varsa görünür — məsələn aktivləşmə
          tarixi yalnız abunəçi aktivləşibsə, qadağa səbəbi isə yalnız abunəçi bloklanıbsa çıxır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status nişanı">
            Abunəçinin cari vəziyyəti: <strong>Sınaq</strong> (mavi), <strong>Aktiv</strong> (yaşıl),{" "}
            <strong>Dayandırıldı</strong> (sarı), <strong>Ayrıldı</strong> (boz) və ya{" "}
            <strong>Bloklandı</strong> (qırmızı).
          </HelpDef>
          <HelpDef term="Abunəçi №">
            Bu abunəçinin unikal nömrəsi — monospace (sabit enli) şriftlə göstərilir.
          </HelpDef>
          <HelpDef term="Plan">
            Abunəçinin tarifi (slug formasından oxunaqlı mətnə çevrilir — defislər boşluqla əvəz
            olunur).
          </HelpDef>
          <HelpDef term="Abunəlik məlumatı">
            Sol kart: abunəçi nömrəsi, plan, status, və varsa aktivləşmə / dayandırılma / çıxma /
            qadağa tarixləri.
          </HelpDef>
          <HelpDef term="Ödəniş və gəlir">
            Sağ kart: email (varsa), ödəniş bölgəsi (varsa), <strong>ümumi gəlir</strong> (dollarla)
            və qadağa səbəbi (yalnız bloklanmış abunəçidə).
          </HelpDef>
          <HelpDef term="Ümumi gəlir">
            Abunəçinin bütün dövr ərzində gətirdiyi ümumi gəlir — sentlərdən dollara çevrilib iki
            onluq rəqəmlə göstərilir.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: abunəçi kartını açmaq və oxumaq">
        <HelpStep n={1}>
          <p>
            <HelpKey>Media Buludu</HelpKey> abunəçilər siyahısında istədiyiniz abunəçinin sətrinə
            klikləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Səhifə açılarkən qısa müddət fırlanan yükləmə işarəsi (spinner) görünür, sonra abunəçinin
            başlıq kartı və iki məlumat kartı yüklənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Başlıq kartında abunəçinin <strong>adını</strong> və yanındakı rəngli{" "}
            <strong>status nişanını</strong> yoxlayın. Altdakı sətirdən nömrəni, emaili (varsa) və
            planı oxuyun.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Status nişanının rəngi vəziyyətə uyğun gəlir: yaşıl = Aktiv, mavi = Sınaq, sarı =
            Dayandırıldı, boz = Ayrıldı, qırmızı = Bloklandı. Nömrə monospace şriftlə, plan isə baş
            hərflə (defislər boşluğa çevrilmiş) yazılır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sol <HelpKey>Abunəlik məlumatı</HelpKey> kartında abunəçi nömrəsini, planı, statusu və
            varsa tarix sətirlərini (Aktivləşdirildi, Dayandırıldı, Çıxdı, Qadağan edildi) gözdən
            keçirin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Tarix sətirləri yalnız o hadisə baş veribsə görünür — məsələn heç dayandırılmamış
            abunəçidə «Dayandırıldı» sətri ümumiyyətlə çıxmır. Tarixlər yerli formatda göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Sağ <HelpKey>Ödəniş və gəlir</HelpKey> kartında emaili, ödəniş bölgəsini (varsa) və{" "}
            <strong>Ümumi gəlir</strong> sətrini yoxlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Ödəniş bölgəsi yanında qlobus ikonası ilə göstərilir (yalnız təyin edilibsə). Ümumi gəlir
            həmişə görünür və <strong>$</strong> işarəsi ilə, iki onluq rəqəmlə formatlanır (məs.
            $1,250.00). Abunəçi bloklanıbsa, kartın altında qırmızı rəngdə qadağa səbəbi əlavə
            olunur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            İşiniz bitəndə yuxarıdakı <HelpKey>Abunəçilərə qayıt</HelpKey> düyməsi ilə siyahıya
            qayıdın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Media Buludu abunəçilər siyahısı yenidən açılır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Bu səhifə qeydi yalnız <strong>göstərir</strong> — burada redaktə, status dəyişmə və ya
          silmə düyməsi yoxdur. Boş görünən sətirlər səhv deyil: aktivləşmə tarixi, ödəniş bölgəsi
          və ya qadağa səbəbi kimi sahələr yalnız uyğun məlumat olduqda peyda olur.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Abunəçi tapılmasa və ya yükləmə alınmasa, səhifədə <HelpKey>Abunəçilərə qayıt</HelpKey>{" "}
          düyməsi ilə birlikdə qırmızı «Abunəçi yüklənə bilmədi» mesajı göstərilir. Bu zaman siyahıya
          qayıdıb yenidən cəhd edin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Yalnız öz təşkilatınızın abunəçilərini görürsünüz — kart məlumatı təşkilat (tenant)
          səviyyəsində məhdudlaşdırılır. Başqa təşkilatın abunəçi qeydlərinə bu səhifədən çıxış yoxdur.
        </p>
      </HelpCallout>
    </div>
  )
}
