"use client"

/**
 * Sequences — help article (Azerbaijani).
 * en.tsx-in güzgüsü: təqib zəncirinin qurulması (e-poçt / zəng / tapşırıq),
 * hər addımın nə etdiyi, runner-in iştirakçıları necə irəlilətdiyi, həyat dövrü.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SequencesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Bu nə üçün vacibdir">
        <p>
          <strong>Zəncir</strong> — avtomatik təqib ardıcıllığıdır: lid və ya kontakt zəncirə əlavə
          olunduqdan sonra gün-gün cədvəllə işə düşən sıralı addımlar (e-poçt, zəng, tapşırıq).
          Zənciri bir dəfə qurursunuz, runner isə hər iştirakçını onunla aparır — heç kim
          təmaslar arasında itmir.
        </p>
        <p>
          Bu səhifədə zəncirləri <strong>yaradır və idarə edirsiniz</strong>. Konkret lid və ya
          kontaktın əlavə edilməsi başqa yerlərdə baş verir — burada addımları yazır, iştirakçı
          sayını izləyir və zənciri açıb-bağlayırsınız.
        </p>
      </HelpSection>

      <HelpSection title="Panel bir baxışda">
        <p>
          Yuxarı sıra bütün zəncirləriniz üzrə üç canlı sayğac göstərir:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi zəncirlər">neçə zəncir mövcuddur</HelpDef>
          <HelpDef term="Aktiv">hazırda neçəsi açıqdır</HelpDef>
          <HelpDef term="Ümumi iştirakçılar">bütün zəncirlərə əlavə olunmuş lid və kontaktlar</HelpDef>
        </dl>
        <p>
          Aşağıda hər zəncir bir kartdır: üzərində <HelpKey>Aktiv</HelpKey> və ya{" "}
          <HelpKey>Qeyri-aktiv</HelpKey> nişanı, addım sayı və iştirakçı sayı olur. Axtarış xanası
          siyahını <strong>ad</strong> və ya <strong>təsvir</strong> üzrə süzgəcləyir. Addımları
          sırayla oxumaq üçün kartdakı oxa basıb onu açın.
        </p>
      </HelpSection>

      <HelpSection title="Zəncir qur">
        <p>
          Zəncirin <strong>adı</strong>, istəyə bağlı <strong>təsviri</strong>,{" "}
          <strong>Aktiv</strong> bayrağı və sıralı <strong>addımlar</strong> siyahısı var.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Addım tipi">e-poçt, zəng və ya tapşırıq</HelpDef>
          <HelpDef term="Gecikmə">bu addımdan əvvəl neçə tam gün gözləmək (1-ci&nbsp;addımda standart 0 — həmin gün)</HelpDef>
          <HelpDef term="Mövzu">e-poçt mövzusu və ya zəng / tapşırıq addımının başlığı</HelpDef>
          <HelpDef term="Mətn">e-poçt mətni və ya zəng / tapşırıq addımının təsviri</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            <HelpKey>Yeni zəncir</HelpKey> düyməsini basın, ad verin və istəyə görə təsvir əlavə
            edin. Zəncirin işə başlaması üçün <HelpKey>Aktiv</HelpKey> qeydini açıq saxlayın.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Hər təmas üçün <HelpKey>Addım əlavə et</HelpKey> düyməsini basın. Tipi seçin,{" "}
            <strong>gecikməni gün ilə</strong> təyin edin, mövzu və mətni doldurun. Addımlar
            göstərilən sıra ilə işləyir (№1, №2, №3…); gecikmə əvvəlki addımdan sayılır.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Zənciri saxla</HelpKey> düyməsini basın. Ad mütləqdir, qalanı istəyə bağlıdır.
            Addımsız zəncirə icazə verilir, lakin addım əlavə edənə qədər heç nə etmir.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Hər addım əslində nə edir">
        <p>
          Addımın vaxtı çatanda tipi əlavə olunmuş lid və ya kontakt üçün nəyin yaradılacağını
          müəyyən edir:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="zəng / tapşırıq">lid və ya kontakta bağlı <strong>tapşırıq</strong> yaradır (status <em>gözləyir</em>, prioritet <em>orta</em>, son tarix həmin gün); addımın mövzusu başlıq, mətni təsvir olur.</HelpDef>
          <HelpDef term="e-poçt">lid və ya kontaktın lentində addımın mövzusu və mətni ilə <strong>e-poçt fəaliyyəti</strong> qeyd edir.</HelpDef>
        </dl>
        <HelpCallout kind="warning">
          <p>
            E-poçt <strong>addımı təqib fəaliyyəti qeyd edir</strong> — bu, lentdə e-poçtun vaxtının
            çatdığını bildirən xatırlatmadır, avtomatik göndərmə deyil. Zəng, tapşırıq və e-poçt
            addımlarını menecerin yerinə yetirdiyi planlaşdırılmış işlər kimi qəbul edin, özü-özünə
            gedən mesaj kimi yox.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="İştirakçılar və zəncirin necə getməsi">
        <p>
          Kartdakı <strong>iştirakçı sayı</strong> zəncirə neçə lid və kontaktın bağlandığını
          göstərir. Runner hamını sabit cədvəllə avtomatik emal edir — təxminən hər{" "}
          <strong>15&nbsp;dəqiqədən</strong> bir növbəti addımının vaxtı çatmış iştirakçıları
          götürür, onu işə salır və sonrakını planlaşdırır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="active">hazırda addımlarla irəliləyir</HelpDef>
          <HelpDef term="paused">müvəqqəti dayandırılıb; davam etdirildikdə növbəti addım dərhal vaxtı çatmış olur</HelpDef>
          <HelpDef term="completed">son addım işə düşüb</HelpDef>
          <HelpDef term="stopped">bitirmədən çıxarılıb</HelpDef>
        </dl>
        <HelpCallout kind="tip">
          <p>
            Hər lid və ya kontaktın <strong>bir zəncirdə bir iştirakı</strong> ola bilər. Şəxsi
            yenidən əlavə etmək yalnız əvvəlki gedişi <em>dayandırıldıqdan</em> və ya{" "}
            <em>tamamlandıqdan</em> sonra mümkündür — onsuz da aktiv olan iştirak yenidən
            başladılmır, olduğu kimi qalır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Aktivləşdir, redaktə et və sil">
        <HelpStep n={1}>
          <p>
            Kartdakı oynat / dayandır düyməsi zənciri <HelpKey>Aktiv</HelpKey> və{" "}
            <HelpKey>Qeyri-aktiv</HelpKey> arasında dəyişir. Onu söndürmək bütün iştirakçıları üçün
            <strong> emalı dayandırır</strong> — runner qeyri-aktiv zənciri ötürür və hər şəxsə
            toxunmağa ehtiyac qalmır.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Karandaş redaktoru açır. Addımları saxlamaq <strong>bütün addım siyahısını</strong>{" "}
            ekrandakı ilə əvəz edir, ona görə diqqətlə yenidən sıralayın və ya azaldın — əvvəlki
            addımlar qarışdırılmır.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Zibil qutusu işarəsi təsdiqdən sonra zənciri silir. Onun <em>aktiv</em> və ya{" "}
            <em>dayandırılmış</em> iştirakları <strong>əvvəlcə dayandırılır</strong>, sonra zəncir
            və onun addımları silinir.
          </p>
        </HelpStep>
        <HelpCallout kind="next">
          <p>
            Zəncir daxilində qeyri-aktiv işarələdiyiniz addımlar canlı ardıcıllıqdan gizlədilir —
            siyahı və runner yalnız <strong>aktiv</strong> addımlarla, sıra ilə işləyir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Hər zəncir, addım və iştirak təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın
          zəncirlərini görüb işə salırsınız. Zənciri silmək onun yarımçıq iştiraklarını ortada
          buraxmaq əvəzinə dayandırır, addımları redaktə etmək isə onları bütünlüklə əvəz edir —
          ona görə saxlamazdan əvvəl dəyişiklikləri yoxlayın.
        </p>
      </HelpCallout>
    </div>
  )
}
