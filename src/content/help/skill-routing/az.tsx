"use client"

/**
 * Skill Routing (Bacarıq marşrutlaşdırması) — help article (Azerbaijani).
 * Dəstək modulundakı vahid hub: agent bacarıqları + tiket növbələri bir səhifədə,
 * gələn tiketi kateqoriyasına görə düzgün agentə yönəltmək üçün.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function SkillRoutingHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Dəstək rəhbəri"
        goal="Hansı agentin hansı tiketi götürəcəyini bir səhifədən qur"
      >
        Səhifə iki bölmədən ibarətdir: yuxarıda <strong>Agent bacarıqları</strong>{" "}
        (hər agent və onun bacarıqları), aşağıda <strong>Tiket Növbələri</strong>{" "}
        (kateqoriyaları agentlərə yönləndirən qaydalar). Yalnız öz təşkilatınızın
        agentləri və növbələri görünür.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          İki bölmə birlikdə işləyir: <strong>növbə</strong> kanon bacarıq
          siyahısını təyin edir, <strong>agent</strong> isə həmin siyahıdan{" "}
          <strong>seçir</strong> — yazmır. Buna görə «technical» / «texniki» /
          «tech» kimi fərqli yazılışlar yaranmır; bütün bacarıqlar kiçik hərflə
          saxlanır.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Bacarıq">Agentin götürə bildiyi tiket kateqoriyası (məs. technical, complaint).</HelpDef>
          <HelpDef term="Növbə">Bir və ya bir neçə bacarığı bir araya gətirən yönləndirmə qaydası.</HelpDef>
          <HelpDef term="Universal növbə">Bacarığı olmayan növbə — uyğun xüsusi növbə tapılmasa, tiketi tutur.</HelpDef>
          <HelpDef term="Metod">Ən Az Yüklü (ən az açıq tiketi olan agent) və ya Round Robin (növbə ilə).</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Necə işləyir: marşrutlaşdırma">
        <p>Yeni tiket gələndə sistem bu zənciri keçir:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Tiketin <strong>kateqoriyası</strong> götürülür (məs. technical).</li>
          <li>Bacarıqlarında bu kateqoriya olan <strong>növbə</strong> tapılır.</li>
          <li>Həmin növbə ilə üst-üstə düşən, <strong>əlçatan</strong> (mövcud, tiket limitini keçməmiş) agentlər seçilir.</li>
          <li>Növbənin <strong>metoduna</strong> görə biri təyin olunur.</li>
        </ol>
        <p>
          Heç bir bacarıq-növbəsi uyğun gəlməsə, tiket <strong>universal növbəyə</strong>{" "}
          düşür və ən az yüklü agentə gedir.
        </p>
        <HelpCallout kind="warning" label="Tələ">
          Agentin bacarığı boşdursa, o, bacarıq-növbələrinə heç vaxt düşmür —
          yalnız universal növbədən tiket alır. Marşrutlaşdırmanın işləməsi üçün{" "}
          <strong>həm növbədə bacarıq, həm də agentdə həmin bacarıq</strong> olmalıdır.
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Addım-addım: növbə qur">
        <HelpStep n={1}>
          <p>
            Aşağıdakı <strong>Tiket Növbələri</strong> bölməsində{" "}
            <HelpKey>Yeni Növbə</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Tiket Növbəsi Yarat</strong> pəncərəsi açılır: Növbə Adı,
            Bacarıqlar, Prioritet, Təyinat Metodu və «Tiketləri avtomatik təyin et» seçimi.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Bacarıqlar</HelpKey> sahəsində mövcud çipləri seçin; yeni
            bacarıq lazımdırsa «Add a skill…» sətrində yazıb əlavə edin. Bacarıq
            tiket kateqoriyası ilə eyni olmalıdır (məs. <em>technical</em>,{" "}
            <em>complaint</em>). Universal növbə üçün bu sahəni boş buraxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Seçilmiş bacarıqlar narıncı çip kimi işarələnir — bu, həmin növbənin
            kanon siyahısını təşkil edir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Prioritet</HelpKey> (yüksək = üstünlük) və{" "}
            <HelpKey>Təyinat Metodu</HelpKey> (<strong>Ən Az Yüklü</strong> və ya{" "}
            <strong>Round Robin</strong>) seçin. <HelpKey>Tiketləri avtomatik təyin et</HelpKey>{" "}
            qutusu defolt olaraq seçilidir (lazım deyilsə söndürün), sonra{" "}
            <HelpKey>Növbə Yarat</HelpKey> basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Növbə siyahıda görünür: Bacarıqlar (çiplər və ya boşdursa{" "}
            <strong>Universal</strong>), Metod, Prioritet və <strong>Status</strong>.
            Statusun üstünə basıb Aktiv/Deaktiv keçirə bilərsiniz.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: agentə bacarıq təyin et">
        <HelpStep n={1}>
          <p>
            Yuxarıdakı <strong>Agent bacarıqları</strong> bölməsində hər agent öz
            sətrində görünür — baş hərfləri, adı və rolu ilə.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Hər sətirdə çip seçici var; çiplər növbələrdə təyin etdiyiniz
            bacarıqlardan gəlir (agent yazmır, mövcud olanı seçir).
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Agentin götürəcəyi bacarıqların çiplərinə toxunun.{" "}
            <strong>«Yadda saxla» düyməsi yoxdur</strong> — hər toxunuş dərhal saxlanır.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Adın yanında qısa fırlanan işarə (saxlanır) → yaşıl ✓ (saxlanıldı)
            görünür. Şəbəkə xətası olarsa, qırmızı işarə çıxır və dəyişiklik geri
            qaytarılır (<strong>Yadda saxlanmadı</strong>).
          </HelpCallout>
        </HelpStep>
        <HelpCallout kind="tip" label="İpucu">
          Çiplər əvəzinə «Əvvəlcə aşağıdakı növbəyə bacarıq əlavə edin…» yazısı
          görünürsə, deməli hələ heç bir növbədə bacarıq yoxdur — əvvəlcə növbə qurun.
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security" label="Təhlükəsizlik">
        Həm agentlər, həm növbələr yalnız öz təşkilatınız daxilindədir; dəyişiklik
        etmək üçün parametrlər (settings) yazma icazəsi tələb olunur.
      </HelpCallout>

      <HelpCallout kind="next" label="Növbəti">
        Bacarıqlar və növbələr qurulandan sonra gələn WhatsApp/veb tiketləri
        kateqoriyasına görə avtomatik düzgün agentə düşür — nəticəni{" "}
        <strong>Tiketlər</strong> və <strong>Agent masaüstü</strong> bölmələrində izləyin.
      </HelpCallout>
    </div>
  )
}
