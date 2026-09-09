"use client"

/**
 * S6 CPQ — «Təkliflər» bölməsi üzrə kömək məqaləsi (Azərbaycan dili).
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function QuotesHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Təklif nədir?">
        <p>
          <strong>Təklif</strong> (quote, kommersiya təklifi) — açıq sövdələşmə ilə imzalanmış
          müqavilə arasında müştəriyə göndərdiyiniz sənəddir. Burada <em>nəyi</em> satdığınız,
          <em> hansı qiymətə</em> və qiymətin <em>nə qədər müddət</em> qüvvədə olduğu qeyd olunur.
        </p>
        <p>
          Hər təklifin versiyası, statusu var və əsas sövdələşmə ilə əlaqəlidir — bütün dəyişikliklər,
          göndərmələr, baxışlar və imtinalar Excel-də ayrıca cədvəllər olmadan avtomatik CRM-də qeydə alınır.
        </p>
      </HelpSection>

      <HelpSection title="Nə vaxt istifadə etməli">
        <ul className="list-disc pl-5 space-y-1">
          <li>Müştəri &laquo;bunun qiyməti nə qədərdir?&raquo; soruşdu — əldən yazılmış məktub yox, təklif göndərin.</li>
          <li>Bir neçə mövqedən ibarət paket toplayırsınız (məsələn <em>3× abunəlik + 1× setup + 10% endirim</em>).</li>
          <li>Sövdələşmə son mərhələdədir və işə başlamazdan əvvəl sizə imzalanmış sənəd lazımdır.</li>
        </ul>
      </HelpSection>

      <HelpSection title="Təklif necə yaradılır">
        <HelpStep n={1}>
          <p>
            Quotes səhifəsində (yuxarı sağda) <HelpKey>New Quote</HelpKey> düyməsini basın.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <strong>Təklif nömrəsini</strong> (məsələn <code>Q-2026-001</code>),{" "}
            <strong>valyutanı</strong> (defolt olaraq AZN — ISO-4217 formatı, üç böyük hərf) göstərin,
            lazım gələrsə — <strong>qüvvədəolma müddətini</strong> (<em>Valid until</em>).
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Sətirlər əlavə edin: məhsulun/xidmətin adı, miqdar, vahidin qiyməti, istəyə görə —
            sətir üzrə endirim. <HelpKey>Add line</HelpKey> düyməsi daha bir sətir əlavə edir.
          </p>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            İstəyə görə — təklif üzrə ümumi endirim: <em>None / Amount / %</em> keçidi. Eyni anda
            yalnız bir rejimdən istifadə etmək olar.
          </p>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            <HelpKey>Create draft</HelpKey> düyməsini basın. Dərhal redaktor açılacaq, orada
            mövqeləri dəqiqləşdirə, endirimi dəyişə və statuslar üzrə keçidləri həyata keçirə bilərsiniz.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Həyat dövrü (statuslar)">
        <p>
          Hər təklif ciddi sonlu avtomatdan keçir — interfeysdə yalnız icazə verilən növbəti
          addımlar göstərilir.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="draft">
            Qaralama, hələ göndərilməyib. Sonra: <em>sent</em> və ya <em>expired</em>.
          </HelpDef>
          <HelpDef term="sent">
            Müştəriyə göndərdiniz (məktubla, PDF, link ilə). Sonra: <em>viewed</em>,{" "}
            <em>rejected</em> və ya <em>expired</em>.
          </HelpDef>
          <HelpDef term="viewed">
            Müştəri açdı. Sonra: <em>accepted</em>, <em>rejected</em> və ya <em>expired</em>.
          </HelpDef>
          <HelpDef term="accepted">Müştəri imzaladı. Terminal vəziyyət — redaktə etmək olmaz, yalnız silmək.</HelpDef>
          <HelpDef term="rejected">
            Müştəri imtina etdi. <em>Səbəb məcburidir</em> (təhlükəsizlik bloku ilə tanış olun). Terminaldır.
          </HelpDef>
          <HelpDef term="expired">
            <strong>Valid until</strong> müddəti qəbuldan əvvəl bitdi. Terminaldır.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Riyaziyyat: yekunlar necə hesablanır">
        <p>
          Məbləğ hər yadda saxlamada serverdə yenidən hesablanır — sətirləri və sağdakı «Summary»
          panelini təsadüfən desinxronlaşdırmaq mümkün deyil.
        </p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Hər sətir üzrə: <code>qty × unitPrice − lineDiscountAmount = lineTotal</code></li>
          <li>Subtotal: bütün <code>lineTotal</code> dəyərlərinin cəmi</li>
          <li>
            Yekun: <code>subtotal − discountAmount</code> <em>və ya</em>{" "}
            <code>subtotal × (1 − discountPct / 100)</code>, heç vaxt hər iki variant eyni anda
          </li>
          <li>&lt; 0 olan istənilən dəyər 0-a yuvarlaqlaşdırılır. Bütün pul dəyərləri vergüldən sonra 4 rəqəmlə saxlanılır.</li>
        </ol>
      </HelpSection>

      <HelpSection title="İmtina səbəbi">
        <HelpCallout kind="security" label="Təhlükəsizlik">
          <p>
            Təklif <strong>rejected</strong> statusuna keçirilərkən «imtina səbəbi» sahəsi{" "}
            <strong>məcburidir</strong>. Mətn verilənlər bazasında təşkilatınıza <em>və</em> konkret
            sütuna bağlı açarla şifrələnir — bazanın tam dampına çıxışınız olsa belə, dəyərin{" "}
            <code>quotes.rejected_reason</code> sütunundan olduğunu bilmədən onu oxumaq mümkün deyil.
          </p>
          <p className="mt-2">
            Bu, qəsdən belə edilib: imtina səbəbləri çox vaxt kommersiya baxımından həssas detalları
            (müştərinin büdcə dövrü, daxili bloker, rəqibin adı) ehtiva edir ki, bunlar hər operator
            tərəfindən bazaya sorğu ilə sorğulanmamalıdır.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Redaktə qaydaları">
        <HelpCallout kind="warning" label="Diqqət">
          <p>
            Təklif terminal statusa (<em>accepted</em>, <em>rejected</em>,{" "}
            <em>expired</em>) çatan kimi bloklanır: sətirlər, endirimlər, qeydlər və qüvvədəolma
            müddəti read-only olur, <strong>Save</strong> düyməsi qeyri-aktivdir.
          </p>
          <p className="mt-2">
            Qəbul edilmiş/rədd edilmiş təklifə yenidən baxmaq üçün yenisi yaradılır (<em>version</em>{" "}
            sayğacı gələcəkdə «yenidən baxış» rejimində onları bir nömrə altında qruplaşdırmağa imkan verəcək).
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Növbəti addımlar">
        <HelpCallout kind="next" label="Növbəti addımlar">
          <p>
            Builder UI — CPQ-nin ilk hissəsidir. İşdə olanlar:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-0.5">
            <li><strong>PDF-render</strong> — brendlənmiş PDF-in bir düymə ilə endirilməsi.</li>
            <li><strong>Email-trekinq</strong> — müştəri məktubu açdıqda <em>sent</em> → <em>viewed</em> avtomatik keçidi.</li>
            <li><strong>Avto-müqavilə</strong> — təklif qəbul edildikdə məbləğləri artıq doldurulmuş müqavilə qaralaması yaradılır.</li>
          </ul>
        </HelpCallout>
      </HelpSection>
    </div>
  )
}
