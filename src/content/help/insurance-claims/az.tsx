"use client"

/**
 * Insurance → Claims — help article (Azerbaijani).
 * Sığorta şaquli modulunun ümumi məqaləsindən ("insurance-detail") ayrılıb:
 * yalnız Sığorta → İddialar siyahı səhifəsini əhatə edir (status kartları,
 * status filtri, yeniləmə düyməsi, cədvəl sütunları, daha çox yüklə).
 * Bu səhifə yalnız OXUNUŞ üçündür — burada iddia yaratma/redaktə forması YOXDUR.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function insuranceclaimsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Sığorta əməliyyatçısı, zərər nizamlayıcısı (adjuster) və ya menecersiniz"
        goal="Bütün polislər üzrə açılmış sığorta iddialarına nəzər salmaq, statusa görə süzgəcdən keçirmək və açıq, təsdiqlənmiş və dələduzluq işarəli iddiaların sayını bir baxışda görmək"
      >
        Səhifəyə <HelpKey>Sığorta</HelpKey> → <HelpKey>İddialar</HelpKey> yolu ilə çatırsınız. Bu səhifə
        yalnız baxış üçündür — iddiaları izləyir və süzürsünüz, amma burada yeni iddia yaratma və ya
        redaktə forması yoxdur. Bütün iddialar yalnız sizin təşkilatınıza aiddir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Yuxarıda qalxan ikonalı başlıq <HelpKey>İddialar</HelpKey> və altında «Bütün polislər üzrə
          sığorta iddiaları.» izahı durur. Onun altında dörd statistika kartı, sonra status süzgəci ilə
          yeniləmə düyməsi, ən altda isə iddia cədvəli gəlir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi İddia">Hazırda yüklənmiş iddiaların sayı (aşağıdakı qeydə bax — yalnız ekrana gətirilən sətirlər sayılır).</HelpDef>
          <HelpDef term="Açıq">Statusu «Bildirilmiş» və ya «Araşdırılır» olan iddiaların sayı.</HelpDef>
          <HelpDef term="Təsdiqlənmiş / Həll edilmiş">Statusu «Təsdiqlənmiş» və ya «Həll edilmiş» olan iddiaların sayı.</HelpDef>
          <HelpDef term="Dələduzluq">Dələduzluq işarəsi qoyulmuş iddiaların sayı.</HelpDef>
          <HelpDef term="İddia №">Hər iddianın unikal nömrəsi (monospace şriftlə göstərilir).</HelpDef>
          <HelpDef term="Zərər Növü">Hadisənin növü — Toqquşma, Oğurluq, Yanğın, Hava şəraiti, Məsuliyyət, Tibbi, Əmlak Zərəri, Ölüm, Əlillik və ya Digər.</HelpDef>
          <HelpDef term="Status">İddianın mərhələsi: Bildirilmiş, Araşdırılır, Təsdiqlənmiş, Həll edilmiş, Rədd edilmiş və ya Bağlandı — hər biri öz rəngli nişanı ilə.</HelpDef>
          <HelpDef term="Ehtiyat">Cari ehtiyat məbləği (USD) — ödəniş üçün ayrılmış proqnozlaşdırılan vəsait.</HelpDef>
          <HelpDef term="Ödənilmiş">İndiyə qədər faktiki ödənilmiş məbləğ (USD).</HelpDef>
          <HelpDef term="Zərər Tarixi">Hadisənin baş verdiyi tarix (yoxdursa «—» göstərilir).</HelpDef>
        </dl>
        <p>
          Statusda yanında qırmızı üçbucaq (⚠) ikonası görünürsə, həmin iddiaya <strong>dələduzluq
          işarəsi</strong> qoyulub. Pul sütunlarında dəyər yoxdursa «—» yazılır. Cədvəlin bəzi
          sütunları (İddia №, Zərər Növü, Status, Ehtiyat, Zərər Tarixi) sıralanan başlıqlardır.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: iddiaları statusa görə süz">
        <HelpStep n={1}>
          <p>
            Süzgəc zolağındakı açılan <HelpKey>status</HelpKey> siyahısına basın. Standart vəziyyətdə
            orada <HelpKey>Bütün statuslar</HelpKey> seçilidir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Açılan siyahıda «Bütün statuslar» və ardınca altı status variantı çıxır: Bildirilmiş,
            Araşdırılır, Təsdiqlənmiş, Həll edilmiş, Rədd edilmiş və Bağlandı.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Bir status seçin (məsələn, <HelpKey>Araşdırılır</HelpKey>).</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl dərhal yenidən yüklənir və yalnız həmin statuslu iddiaları göstərir. Statistika
            kartlarındakı saylar da yalnız süzülmüş nəticəyə görə yenidən hesablanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Bütün iddialara qayıtmaq üçün açılan siyahıdan yenidən <HelpKey>Bütün statuslar</HelpKey>
            seçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Süzgəc götürülür və siyahı yenidən bütün statuslardan ilk dəstə iddianı yükləyir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: siyahını yenilə və daha çox yüklə">
        <HelpStep n={1}>
          <p>
            Status süzgəcinin yanındakı dairəvi ox ikonalı <HelpKey>Yenilə</HelpKey> düyməsini basın
            (bu düymənin yalnız ikonası var, mətni yoxdur).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Cədvəl cari süzgəclə yenidən sıfırdan yüklənir və statistika kartları yenilənmiş ilk
            dəstəyə əsasən yenidən hesablanır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Çox iddia varsa, cədvəlin altında <HelpKey>Daha çox yüklə</HelpKey> düyməsi peyda olur. Onu
            basaraq növbəti dəstəni gətirin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Növbəti iddialar mövcud sətirlərin ardına əlavə olunur (siyahı sıfırlanmır). Daha sətir
            qalmayanda «Daha çox yüklə» düyməsi yox olur.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Statistika kartlarındakı saylar bütün baza üzrə deyil — yalnız ekrana gətirilmiş iddialardan
          hesablanır və əsasən ilk dəstəyə (50 sətir) söykənir. «Daha çox yüklə» ilə əlavə sətir
          gətirsəniz də, kartlar yenidən hesablanmır; tam mənzərə üçün konkret statusu seçib süzün, ya
          da <HelpKey>Yenilə</HelpKey> ilə baxışı təzələyin.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu səhifədə axtarış qutusu yoxdur — iddiaları yalnız status açılan siyahısı ilə süzə
          bilərsiniz. İddialar zaman üzrə (ən yeni bildirilən əvvəldə) sıralanır.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bütün iddialar təşkilatınızla məhdudlaşır — başqa tenant-ın iddialarını görmürsünüz, baxış
          isə uyğunluq (compliance) audit jurnalına yazılır. İddianın azad mətnli təsviri kimi həssas
          sahələr bazada <strong>təşkilata bağlı şifrələmə</strong> ilə saxlanılır; bu səhifədəki cədvəl
          isə yalnız şifrələnməyən sahələri (iddia nömrəsi, zərər növü, status, məbləğlər, tarixlər)
          göstərir.
        </p>
      </HelpCallout>
    </div>
  )
}
