"use client"

/**
 * Audit Log — help article (Azerbaijani).
 * Tənzimləmələr → Audit Jurnalı səhifəsini əhatə edir: yalnız oxunan
 * fəaliyyət cədvəli (tarix, əməliyyat, obyekt, ad, istifadəçi),
 * axtarış, sütun üzrə sıralama, səhifələmə və boş vəziyyət.
 * Səhifədə yaratma/redaktə/silmə YOXDUR — burada heç nə dəyişmirsiniz.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function AuditLogHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Administrator və ya təşkilat sahibisiniz"
        goal="Sistemdə kimin nəyi və nə vaxt dəyişdiyini izləmək — yaradılan, yenilənən və silinən qeydlərin tarixçəsinə baxmaq"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Audit Jurnalı</HelpKey> yolu ilə
        çatırsınız. Bu səhifə tam <strong>yalnız-oxunandır</strong> — burada heç nə yaratmırsınız,
        redaktə və ya silmirsiniz. Sadəcə sistemdə baş vermiş hadisələrin siyahısına baxır,
        axtarış edir və sıralayırsınız. Bütün qeydlər yalnız sizin təşkilatınıza aiddir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda qalxan ikonası ilə <HelpKey>Audit Jurnalı</HelpKey> adı, yanında jurnal turunu
          yenidən oynatmaq düyməsi, altında «Bütün sistem fəaliyyətinə baxın» izahı və bir sətirlik
          ipucu — «İstifadəçilər tərəfindən sistemdə edilən bütün dəyişikliklərin tarixçəsi» — durur.
          Aşağıda axtarış sahəsi və beş sütunlu bir cədvəl gəlir. Cədvəl yüklənərkən qısa müddət{" "}
          <HelpKey>Yüklənir...</HelpKey> mətni görünür.
        </p>
        <p>
          Cədvəlin sütunları: <strong>Tarix</strong>, <strong>Əməliyyat</strong>,{" "}
          <strong>Obyekt</strong>, <strong>Ad</strong> və <strong>İstifadəçi</strong>. Hər sütun
          başlığına basıb sıralaya bilərsiniz. Qeydlər ən yenidən ən köhnəyə doğru gəlir. Axtarış
          sahəsi <strong>Ad</strong> sütunu üzrə süzgəcdən keçirir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Tarix">Hadisənin baş verdiyi an — sizin yerli vaxtınızla göstərilir.</HelpDef>
          <HelpDef term="Əməliyyat">Nə baş verdi — rəngli nişan kimi göstərilir: <em>create</em> (yaratma), <em>update</em> (yeniləmə), <em>delete</em> (silmə), <em>login</em> (giriş), <em>export</em> (ixrac).</HelpDef>
          <HelpDef term="Obyekt">Hadisənin hansı növ qeydə aid olduğu (məsələn lid, sövdələşmə, istifadəçi).</HelpDef>
          <HelpDef term="Ad">Təsirə məruz qalan konkret qeydin adı; ad yoxdursa boş qalır.</HelpDef>
          <HelpDef term="İstifadəçi">Hadisəni törədən istifadəçi. Hadisəni sistem özü törədibsə, burada <strong>Sistem</strong> yazılır.</HelpDef>
        </dl>
        <p>
          <strong>Əməliyyat</strong> nişanları əməliyyata görə rənglənir: silmə qırmızı, yeniləmə boz,
          yaratma əsas rəngdə, giriş və ixrac isə konturlu nişanla göstərilir — beləcə cədvələ baxan
          kimi nə baş verdiyini ayırd edirsiniz.
        </p>
      </HelpSection>

      <HelpSection title="Addım-addım: jurnala bax və axtar">
        <HelpStep n={1}>
          <p>
            <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Audit Jurnalı</HelpKey> səhifəsini açın və
            cədvəlin yüklənməsini gözləyin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Əvvəlcə qısa <HelpKey>Yüklənir...</HelpKey> mətni, sonra beş sütunlu cədvəl gəlir. Hər
            sətir bir hadisədir; ən yeni qeyd yuxarıda durur. Axtarış sahəsinin yanında neçə nəticə
            tapıldığını göstərən say (məsələn «50 nəticə») görünür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Konkret bir qeydi tapmaq üçün yuxarıdakı axtarış sahəsinə (lupa ikonalı,{" "}
            <HelpKey>Axtar...</HelpKey> yazılı) yazmağa başlayın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca cədvəl dərhal süzülür və yalnız <strong>Ad</strong> sütununda yazdığınız mətnə
            uyğun gələn sətirlər qalır. Yanındakı nəticə sayı da uyğun olaraq dəyişir. Heç nə tapılmasa,
            cədvəlin ortasında <HelpKey>Məlumat yoxdur</HelpKey> mətni göstərilir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sıralamaq üçün istənilən sütun başlığına — məsələn <HelpKey>Tarix</HelpKey> və ya{" "}
            <HelpKey>İstifadəçi</HelpKey> — basın. Eyni başlığa təkrar bassanız, sıralama
            istiqaməti tərsinə çevrilir.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Başlığın yanında kiçik yuxarı (artan) və ya aşağı (azalan) ox işarəsi peyda olur və
            sətirlər ona görə yenidən düzülür.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Səhifə altındakı say düymələri ilə bir səhifədə neçə sətir görünəcəyini seçin:{" "}
            <HelpKey>20</HelpKey>, <HelpKey>50</HelpKey>, <HelpKey>100</HelpKey> və ya{" "}
            <HelpKey>Hamısı</HelpKey>. Bir səhifəyə sığmırsa, sağ tərəfdəki sol/sağ oxlarla səhifələr
            arasında keçin.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçdiyiniz say düyməsi vurğulanır. Birdən çox səhifə varsa, altda «Səhifə 1/3» tipli
            göstərici və naviqasiya oxları görünür; tək səhifə qalanda oxlar gizlənir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Bir hadisəni törədənin kim olduğunu öyrənmək üçün <strong>İstifadəçi</strong> sütununa baxın.
          Orada <strong>Sistem</strong> yazılıbsa, dəyişikliyi insan deyil, avtomatik proses (məsələn
          fon işi və ya inteqrasiya) etmişdir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Bu səhifə yalnız baxış üçündür — burada heç bir qeyd yaratmaq, redaktə etmək və ya silmək
          mümkün deyil, ona görə «Yeni» və ya «Sil» düyməsi axtarmayın. Axtarış yalnız{" "}
          <strong>Ad</strong> sütunu üzrə işləyir: əməliyyat növünə və ya obyektə görə tapmaq
          istəyirsinizsə, həmin sütuna görə sıralamaqdan istifadə edin.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Jurnal təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızda baş verən hadisələri görürsünüz,
          başqa təşkilatların fəaliyyəti heç vaxt burada görünmür.
        </p>
      </HelpCallout>
    </div>
  )
}
