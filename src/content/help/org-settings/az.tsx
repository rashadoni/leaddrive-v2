"use client"

/**
 * Organization Settings — help article (Azerbaijani).
 * Yalnız Tənzimləmələr → Təşkilat səhifəsini əhatə edir:
 * şirkət adı və loqo URL-nin redaktəsi (redaktə oluna bilən hissə)
 * + tarif planı, istifadəçi/kontakt limitləri və slug (yalnız oxunan
 * məlumat). Bu məlumat-kartı redaktə OLUNMUR.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function OrgSettingsHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Təşkilat administratorusunuz"
        goal="Şirkətin CRM-də görünən adını və loqosunu yeniləmək, eyni zamanda cari tarif planını və istifadəçi/kontakt limitlərini bir yerdə görmək"
      >
        Səhifəyə <HelpKey>Tənzimləmələr</HelpKey> → <HelpKey>Təşkilat</HelpKey> yolu ilə çatırsınız.
        Bütün dəyişikliklər yalnız sizin təşkilatınıza (tenant) aiddir. Səhifə iki kartdan ibarətdir:
        biri redaktə oluna bilən (ad və loqo), digəri yalnız oxunan tarif məlumatıdır.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <p>
          Başlıqda bina ikonası ilə <HelpKey>Təşkilat</HelpKey> adı, altında «Şirkət adı, loqo və
          tarif planı» izahı var. Aşağıda iki kart durur. Birinci kart{" "}
          <strong>Şirkət məlumatları</strong> — burada <strong>Təşkilat adı</strong> və{" "}
          <strong>Loqo URL</strong> sahələri, altında <HelpKey>Saxla</HelpKey> düyməsi var. İkinci
          kart <strong>Tarif və limitlər</strong> — burada üç xana (cari tarif, maks. istifadəçilər,
          maks. kontaktlar) və slug göstərilir; bu kart yalnız məlumat verir, redaktə olunmur.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Təşkilat adı">CRM boyu görünən şirkət adı. Saxlamaq üçün boş ola bilməz.</HelpDef>
          <HelpDef term="Loqo URL">Şirkət loqosunun şəklinə birbaşa keçid (PNG, JPG və ya SVG). Daxil etdikdə altında canlı önizləmə görünür.</HelpDef>
          <HelpDef term="Cari tarif">Təşkilatınızın tarif planı — Starter, Business, Professional və ya Enterprise — rəngli nişan kimi göstərilir.</HelpDef>
          <HelpDef term="Maks. istifadəçilər">Tarifin icazə verdiyi istifadəçi limiti; limitsizdirsə ∞ işarəsi görünür.</HelpDef>
          <HelpDef term="Maks. kontaktlar">Tarifin icazə verdiyi kontakt limiti; limitsizdirsə ∞ işarəsi görünür.</HelpDef>
          <HelpDef term="Slug">Təşkilatın sistemdəki unikal qısa adı (subdomen üçün istifadə olunur). Yalnız oxunan, monospace mətnlə göstərilir.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: şirkət adını və loqonu yenilə">
        <HelpStep n={1}>
          <p>
            <strong>Şirkət məlumatları</strong> kartında <HelpKey>Təşkilat adı</HelpKey> sahəsinə
            şirkətin adını yazın (məs. «My Company LLC»).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Yazdıqca mətn sahədə görünür. Sahə boş olarsa, aşağıdakı <HelpKey>Saxla</HelpKey> düyməsi
            söndürülmüş (basıla bilməyən) qalır.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            İstəyə bağlı olaraq <HelpKey>Loqo URL</HelpKey> sahəsinə loqo şəklinin birbaşa
            ünvanını yapışdırın (məs. <HelpKey>https://example.com/logo.png</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Sahənin altında «Loqo şəklinə birbaşa keçid (PNG, JPG, SVG)» ipucusu durur. Etibarlı URL
            daxil edildikdə dərhal altında kiçik çərçivədə loqonun canlı önizləməsi açılır. Şəkil
            yüklənmirsə (URL səhvdirsə), önizləmə sadəcə göstərilmir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Saxla</HelpKey> düyməsini basın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            Düymə yadda saxlanarkən fırlanan ikona ilə <strong>Saxlanılır...</strong> yazısına keçir.
            Uğurlu olduqda yaşıl təsdiq zolağı və yanında <strong>Təşkilat parametrləri uğurla
            saxlanıldı</strong> mesajı görünür. Xəta olarsa, qırmızı zolaqda xəta mətni çıxır.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Tarif və limitləri yoxla">
        <HelpStep n={1}>
          <p>
            İkinci kart — <strong>Tarif və limitlər</strong> — yalnız məlumat üçündür; burada redaktə
            ediləsi heç nə yoxdur. Üç xanaya baxın.
          </p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">
            <strong>Cari tarif</strong> xanasında tac ikonası və rəngli nişan (məs. Enterprise — kəhrəba
            rəngdə). <strong>Maks. istifadəçilər</strong> və <strong>Maks. kontaktlar</strong> xanalarında
            iri rəqəm görünür; limit qoyulmayıbsa rəqəm yerinə ∞ işarəsi durur. Aşağıda təşkilatın{" "}
            <strong>Slug</strong>-ı monospace şriftlə göstərilir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          Loqo sahəsi şəkli yükləmir — yalnız mövcud şəklin URL-ni qəbul edir. Loqonuz hələ internetdə
          deyilsə, əvvəlcə onu bir yerə yerləşdirin (məsələn, fayl saxlama xidmətinə), sonra birbaşa
          keçidi bura yapışdırın. Yapışdırdıqdan sonra canlı önizləmə düzgün şəkli göstərdiyini təsdiq
          edir.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Tarif, istifadəçi və kontakt limitləri bu səhifədən <strong>dəyişdirilmir</strong> — onlar
          təşkilatınızın planı ilə təyin olunur. Limiti artırmaq və ya tarifi yüksəltmək lazımdırsa,
          bu, hesab/satış prosesi ilə həll olunur, səhifədə düymə yoxdur.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Bu səhifə yalnız öz təşkilatınızın məlumatını göstərir və dəyişir; başqa tenant-ın adını,
          loqosunu və ya planını görə bilməzsiniz. Ad/loqo dəyişiklikləri saxlanıldıqdan sonra
          təşkilatınızın bütün istifadəçilərinə təsir edir.
        </p>
      </HelpCallout>
    </div>
  )
}
