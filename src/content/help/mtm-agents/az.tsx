"use client"

/**
 * Field Agents (MTM) — help article (Azerbaijani).
 * en.tsx-in güzgüsü: «Marşrutlar və sahə» modulunun sahə agentləri reyestri —
 * rollar, status, rəhbər iyerarxiyası, mobil tətbiqə giriş.
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MtmAgentsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Bu nə üçün vacibdir">
        <p>
          <strong>Sahə agentləri</strong> — «Marşrutlar və sahə» modulunu telefonlarından işlədən
          insanların reyestridir: müştəri nöqtələrini gəzən, vizitləri qeyd edən, vizit fotoları
          çəkən və sahə tapşırıqlarını yerinə yetirən sahə əməkdaşları və supervayzerlər. Həmin agentlərin
          mobil tətbiqdə etdiyi hər şey burada yaratdığınız qeydə bağlıdır.
        </p>
        <p>
          Bu səhifə veb admin görünüşüdür: agentləri əlavə edir, onlara giriş məlumatları verir,{" "}
          <strong>rolunu</strong> və <strong>statusunu</strong> təyin edir və{" "}
          <strong>rəhbər</strong> sahəsi vasitəsilə tabeçilik xəttinə düzürsünüz. Bu siyahını
          düzgün qurun — modulun qalan hissəsi (marşrutlar, vizitlər, ərazi görünmə dairəsi) onun
          arxasında düzülür.
        </p>
      </HelpSection>

      <HelpSection title="Reyestrə bir baxışda">
        <p>
          Yuxarıda yüklənmiş agentlərə görə yenidən hesablanan dörd sayğac yerləşir:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ümumi agentlər">Təşkilatınızdakı bütün agent qeydləri.</HelpDef>
          <HelpDef term="Aktiv">Statusu <em>Aktiv</em> olan agentlər.</HelpDef>
          <HelpDef term="Onlayn">Hazırda mobil tətbiqə daxil olmuş agentlər (real vaxt mövcudluq əlaməti).</HelpDef>
          <HelpDef term="Rəhbərlər">Rolu <em>Menecer</em> və ya <em>Supervayzer</em> olan agentlər.</HelpDef>
        </dl>
        <p>
          Sayğacların altında hər agent kart kimi göstərilir: avatarda inisial, canlı{" "}
          <strong>onlayn nöqtəsi</strong> ilə adı (agent daxil olduqda nəbz vuran yaşıl halqa,
          oflayn olduqda boz), e-poçt və ya telefon, həmçinin <strong>rol</strong> və{" "}
          <strong>status</strong> nişanları. Agentin rəhbəri varsa, onun adı da kartda görünür.
        </p>
      </HelpSection>

      <HelpSection title="Axtarış, süzgəc və ixrac">
        <HelpStep n={1}>
          <p>
            Reyestri statusa görə <HelpKey>Hamısı</HelpKey> / <HelpKey>Aktiv</HelpKey> /{" "}
            <HelpKey>Qeyri-aktiv</HelpKey> / <HelpKey>Bloklanmış</HelpKey> düymələri ilə
            süzgəcləyin — hər birinin öz sayğacı var.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Axtarış</HelpKey> agentin adı <em>və ya</em> e-poçtu üzrə uyğunlaşdırır. Sonra{" "}
            <HelpKey>Sıralama</HelpKey> nəticəni ada görə (A → Z və ya Z → A), rola görə və ya
            statusa görə nizamlayır.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>İxrac</HelpKey> cari süzülmüş siyahını ad, e-poçt, telefon, rol və statusla{" "}
            <HelpKey>field-agents.csv</HelpKey> faylı kimi endirir — sürətli oflayn say üçün və ya
            kadrlar şöbəsi ilə paylaşmaq üçün əlverişlidir.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Agent əlavə etmək və redaktə">
        <p>
          Yeni qeyd üçün <HelpKey>Agent əlavə et</HelpKey> düyməsini, mövcudunu redaktə etmək üçün
          isə kartdakı qələm nişanını basın. Hər iki halda forma eynidir:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Ad">Mütləqdir.</HelpDef>
          <HelpDef term="E-poçt / Telefon">Hər ikisi istəyə bağlıdır. E-poçt təşkilat daxilində unikaldır — onu eyni tenant-da iki agentdə təkrar istifadə etmək olmaz.</HelpDef>
          <HelpDef term="Parol">Agentin mobil tətbiqə girişi. Yaradılarkən mütləqdir (ən azı 12 simvol, böyük və kiçik hərf, rəqəm və xüsusi simvol); redaktədə cari parolu saxlamaq üçün boş buraxın.</HelpDef>
          <HelpDef term="Rol">Agent, Supervayzer və ya Menecer.</HelpDef>
          <HelpDef term="Status">Aktiv, Qeyri-aktiv və ya Bloklanmış.</HelpDef>
          <HelpDef term="Rəhbər">Agentin kimə tabe olduğu — mövcud reyestrdən seçilir (agent öz rəhbəri ola bilməz).</HelpDef>
        </dl>
        <HelpCallout kind="tip">
          <p>
            Parol agentin mobil tətbiqə daxil olmaq üçün yazdığıdır — bu e-poçt dəvəti deyil, ona
            görə onu təyin edin və agentə birbaşa verin. O, heş şəklində saxlanılır, heç vaxt açıq
            mətndə deyil, və saxlandıqdan sonra sizə geri göstərilmir.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Rollar və tabeçilik xətti">
        <p>
          <strong>Rəhbər</strong> sahəsi tabeçilik iyerarxiyası qurur: supervayzer və ya menecer
          bir qrup agentin üstündə dayanır. Bu zəncir sadəcə bəzək deyil — mobil tətbiqdə{" "}
          <strong>ərazi görünmə dairəsini</strong> idarə edir.
        </p>
        <HelpStep n={1}>
          <p>
            <strong>Veb admin panelində</strong> (indi olduğunuz yer) rolundan asılı olmayaraq
            təşkilatınızın <em>bütün</em> agentlərini görürsünüz.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Mobildə</strong> görünmə dairəsi rola görə daralır: <em>menecer</em> və ya{" "}
            <em>supervayzer</em> öz komandasını və ya regionunu, <em>agent</em> isə yalnız özünü
            görür. Burada qurduğunuz zəncir məhz bunu müəyyən edir.
          </p>
        </HelpStep>
        <HelpCallout kind="next">
          <p>
            Agentlər «Marşrutlar və sahə» modulunun başqa yerlərində <strong>komandalara</strong>{" "}
            (komandalar isə regionlara) qruplaşdırılır. Agentin arxasındakı komanda və region
            rəhbərin mobil görünmə dairəsinin oxuduğu mənbədir — beləliklə, burada qurduğunuz təşkilat
            sxemi orada özünü doğruldur.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Status və silmə">
        <p>
          <strong>Status</strong> agentin aktiv rotasiyada olub-olmadığını idarə edir:
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Aktiv">Sıradadır — «Aktiv» sayğacına daxil olur və normal işləyir.</HelpDef>
          <HelpDef term="Qeyri-aktiv">Saxlanılıb — reyestrdə qalır, lakin aktiv növbədə deyil.</HelpDef>
          <HelpDef term="Bloklanmış">Qeyd silinmədən işdən kənarlaşdırılıb.</HelpDef>
        </dl>
        <HelpCallout kind="warning">
          <p>
            <strong>Agentin silinməsi geri dönməzdir</strong> — zibil nişanı qeydi tamamilə silir
            (arxiv və ya geri qaytarma yoxdur). Kimisə rotasiyadan çıxarıb tarixçəsini saxlamaq üçün
            silmək əvəzinə statusunu <em>Qeyri-aktiv</em> və ya <em>Bloklanmış</em> təyin edin.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Buradakı hər agent təşkilatınızla məhdudlaşır — yalnız öz tenant-ınızın reyestrini görüb
          idarə edirsiniz və agentin e-poçtu onun daxilində unikal olmalıdır. Parollar heş şəklində
          saxlanılır, heç vaxt geri göstərilmir və audit jurnalında gizlədilir. Hər yaratma, redaktə
          və silmə həmin jurnala yazılır, ona görə kimin daxil ola biləcəyinə dair dəyişikliklər
          həmişə hesabatlıdır.
        </p>
      </HelpCallout>
    </div>
  )
}
