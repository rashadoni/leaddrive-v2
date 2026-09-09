"use client"

/**
 * Offer detail (record) — help article (Azerbaijani).
 * Tək təklif kartını əhatə edir: /offers/[id] səhifəsi.
 * Status boru xətti (Qaralama → Göndərilib → Təsdiqlənib), KPI kartları,
 * mövqe cədvəli + yekun, detal/müştəri kartları, və əsas əməliyyatlar:
 * Göndər (e-poçt), PDF, Hesab-fakturaya çevir, Redaktə et, Sil.
 * Təklif siyahısı (offers) AYRI məqalədir — bura DAXİL DEYİL.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function OfferDetailHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Satış nümayəndəsi və ya təklif hazırlayan əməkdaşsınız"
        goal="Bir kommersiya təklifini açmaq, məbləğini və mövqelərini yoxlamaq, müştəriyə göndərmək və təsdiqlənəndən sonra hesab-fakturaya çevirmək"
      >
        Bu səhifəyə <HelpKey>Təkliflər</HelpKey> siyahısından bir təklifin üzərinə klikləməklə
        çatırsınız. Bütün təklif məlumatları yalnız sizin təşkilatınız üçündür. Səhifədəki məbləğlər —
        ara cəm, endirim, ƏDV və yekun — mövqe cədvəlindən real vaxtda hesablanır, ona görə təklifi
        redaktə edib mövqeləri dəyişdikcə bütün rəqəmlər avtomatik yenilənir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda geri qayıtma oxu (<HelpKey>←</HelpKey>), təklifin başlığı, altında təklif nömrəsi
          və rəngli <strong>status nişanı</strong> durur; növü kommersiyadan fərqlidirsə yanında
          növ etiketi (məs. <strong>Avadanlıq</strong>, <strong>Xidmətlər</strong>) görünür. Sağ
          yuxarıda əməliyyat düymələri sırası var. Onun altında status boru xətti, dörd KPI kartı,
          (mövqe varsa) mövqe cədvəli + yekun bloku, ən altda isə iki kart: <strong>Təklif detalları</strong>{" "}
          və <strong>Müştəri məlumatları</strong>.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Status nişanı">Təklifin cari vəziyyəti: Qaralama, Göndərilib, Təsdiqlənib və ya Rədd edilib — hər biri öz rəngi ilə.</HelpDef>
          <HelpDef term="Status boru xətti">Qaralama → Göndərilib → Təsdiqlənib mərhələlərini göstərən üfüqi zolaq; cari mərhələ vurğulanır. Rədd edilibsə sonda qırmızı «Rədd edilib» bloku əlavə olunur.</HelpDef>
          <HelpDef term="YEKUNİ">Endirim və ƏDV nəzərə alınmaqla təklifin ümumi pul dəyəri (valyuta ilə birlikdə).</HelpDef>
          <HelpDef term="Mövqelər">Təklifdəki sətirlərin (məhsul/xidmət) sayı.</HelpDef>
          <HelpDef term="Etibarlıdır">Etibarlılıq tarixinə qədər qalan günlər; tarix keçibsə «Müddəti bitib» yazılır.</HelpDef>
          <HelpDef term="Açıq günlər">Təklifin yaradılmasından bəri keçən gün sayı.</HelpDef>
          <HelpDef term="Mövqe cədvəli">Hər sətir: ad, miqdar, vahid qiymət, endirim %, və sətir cəmi; altında ara cəm, endirim, ƏDV (18%) və YEKUNİ.</HelpDef>
        </dl>
        <p>
          Əməliyyat düymələri statusdan asılıdır: təklif <strong>Qaralama</strong> ikən{" "}
          <HelpKey>Göndər</HelpKey> düyməsi, təklif <strong>Təsdiqlənib</strong> (və ya qəbul edilib)
          olduqda <HelpKey>Hesab-fakturaya çevir</HelpKey> düyməsi görünür. <HelpKey>PDF</HelpKey>,{" "}
          <HelpKey>Redaktə et</HelpKey> və <HelpKey>Sil</HelpKey> düymələri həmişə mövcuddur.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: təklifi e-poçtla göndər">
        <HelpStep n={1}>
          <p>
            Təklif <strong>Qaralama</strong> vəziyyətindədirsə, sağ yuxarıdakı <HelpKey>Göndər</HelpKey>{" "}
            düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Təklifi göndər» başlıqlı pəncərə açılır. <strong>Alıcının emaili *</strong>,{" "}
            <strong>Mövzu</strong> və <strong>Mesaj</strong> sahələri əvvəlcədən doldurulmuş gəlir —
            mövzuda «Kommersiya təklifi» + nömrə, mesajda salam, təklif nömrəsi və hesablanmış yekun
            məbləğ olur.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Alıcının emaili</strong> sahəsini yoxlayın (məcburidir), lazım gəlsə{" "}
            <strong>Mövzu</strong> və <strong>Mesaj</strong> mətnini redaktə edin, sonra aşağıdakı{" "}
            <HelpKey>Göndər</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            E-poçt boş buraxılsa qırmızı «Email tələb olunur» xəbərdarlığı çıxır. Göndərmə gedərkən
            düymə «…» göstərir; uğurlu olduqda yaşıl «Təklif uğurla göndərildi» mesajı görünür və bir
            neçə saniyədən sonra pəncərə bağlanır. Xəta olarsa qırmızı xəta mesajı göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Pəncərə bağlandıqdan sonra səhifəyə qayıdın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Təklif detalları</strong> kartında <strong>Göndərilib</strong> sahəsi göndərmə
            tarixi ilə doldurulur; status boru xəttində <strong>Göndərilib</strong> mərhələsi aktiv
            mərhələ kimi vurğulanır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: təklifi PDF kimi yüklə">
        <HelpStep n={1}>
          <p>
            Sağ yuxarıdakı <HelpKey>PDF</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Brauzerin yeni nişanında təklifin PDF sənədi açılır — mövqelər, məbləğlər və müştəri
            məlumatları ilə. Buradan onu çap edə və ya yadda saxlaya bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: təklifi hesab-fakturaya çevir">
        <HelpStep n={1}>
          <p>
            Təklif <strong>Təsdiqlənib</strong> olduqda sağ yuxarıda <HelpKey>Hesab-fakturaya çevir</HelpKey>{" "}
            düyməsi peyda olur. Onu basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə qısa müddət «…» göstərir, sonra sistem təklifin mövqeləri və məbləğləri əsasında yeni
            hesab-faktura yaradır və sizi birbaşa həmin hesab-fakturanın səhifəsinə yönləndirir. Xəta
            baş verərsə, ekranda xəbərdarlıq mesajı görünür.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Bu düymə yalnız təklif <strong>təsdiqlənmiş</strong> mərhələdə görünür. Hələ qaralama və ya
            göndərilmiş təklifi birbaşa hesab-fakturaya çevirə bilməzsiniz — əvvəlcə təklifin
            təsdiqlənməsini gözləyin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: təklifi redaktə et və ya sil">
        <HelpStep n={1}>
          <p>
            Məzmunu dəyişmək üçün <HelpKey>Redaktə et</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Təklif forması mövcud başlıq, növ, valyuta, müştəri, mövqelər, endirim və ƏDV
            parametrləri ilə əvvəlcədən doldurulmuş açılır. Dəyişiklikləri edib saxladıqdan sonra
            KPI kartları, mövqe cədvəli və yekun məbləğ avtomatik yenilənir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Təklifi silmək üçün qırmızı <HelpKey>Sil</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            «Təklifi sil» təsdiq pəncərəsi açılır və hansı təklifin silinəcəyini adı ilə göstərir.
            Təsdiqlədikdən sonra təklif silinir və siz <HelpKey>Təkliflər</HelpKey> siyahısına geri
            yönləndirilirsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Silmə geri qaytarılmır. Hesab-fakturaya çevrilmiş və ya müştəriyə göndərilmiş bir təklifi
            silməzdən əvvəl iki dəfə fikirləşin — sənəd qeydiniz itir. Sadəcə artıq aktual deyilsə,
            saxlayıb statusda dəyişiklik etməyi düşünün.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Yekun məbləğ heç vaxt əl ilə yazılmır — o, mövqe sətirlərindən (miqdar × qiymət − sətir
          endirimi), sonra ümumi endirim və 18% ƏDV (yalnız ƏDV daxildirsə) tətbiq olunaraq hesablanır.
          Rəqəmi dəyişmək istəyirsinizsə, mövqeləri və ya endirim/ƏDV parametrlərini redaktə edin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Təklif yalnız öz təşkilatınıza aiddir — başqa tenant-ın təkliflərini görə və ya aça
          bilməzsiniz. Göndərmə, PDF, çevirmə və silmə əməliyyatlarının hamısı təşkilat kontekstinizlə
          məhdudlaşır.
        </p>
      </HelpCallout>
    </div>
  )
}
