"use client"

import {
  HelpCallout,
  HelpDef,
  HelpKey,
  HelpSection,
  HelpStep,
} from "@/components/help/help-content"

export default function HelpCenterHelpAz() {
  return (
    <div className="space-y-6">
      <HelpSection title="Cari ekranın təlimatını açın">
        <p>
          Kömək iş ekranınızın yanında qalır. O, açıq bölməni izah edir, sizi ayrıca sayta aparmır
          və CRM məlumatlarını dəyişmir.
        </p>
        <HelpStep n={1}>
          <p>
            Səhifə başlığının və ya əməliyyat panelinin yanındakı narıncı <HelpKey>?</HelpKey> və ya
            <HelpKey>Kömək</HelpKey> düyməsini seçin.
          </p>
          <HelpCallout kind="see" label="Nə görəcəksiniz">
            Təlimat sağdan açılacaq. Başlıq və altbaşlıq hansı bölmənin izah edildiyini göstərir.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Addımları, sahə izahlarını, məsləhətləri və təhlükəsizlik qeydlərini oxuyun.</p>
          <HelpCallout kind="see" label="Nə görəcəksiniz">
            CRM ekranı təlimatın arxasında qalır; Köməyi bağlayıb dayandığınız yerdən davam edə
            bilərsiniz.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            <HelpKey>Video</HelpKey> düyməsi varsa, bölmənin təsdiqlənmiş video izahını açmaq üçün
            onu seçin.
          </p>
          <HelpCallout kind="see" label="Nə görəcəksiniz">
            Video düyməsinin olmaması həmin bölmə üçün hazırda yalnız mətn təlimatının olduğunu
            bildirir.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Bölmə təlimatı ilə bu təlimat arasında keçin">
        <HelpStep n={1}>
          <p>
            Bölmə təlimatında bu ümumi təlimatı açmaq üçün <HelpKey>Kömək haqqında</HelpKey>
            düyməsini seçin.
          </p>
          <HelpCallout kind="see" label="Nə görəcəksiniz">
            Panel açıq qalacaq və yalnız məqalə dəyişəcək; iş səhifəsi yerindən tərpənməyəcək.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Başladığınız məqaləyə qayıtmaq üçün <HelpKey>Bölmə təlimatına qayıt</HelpKey> düyməsini
            seçin.
          </p>
          <HelpCallout kind="see" label="Nə görəcəksiniz">
            İlkin bölmənin başlığı və göstərişləri eyni paneldə yenidən görünəcək.
          </HelpCallout>
        </HelpStep>
        <p>
          Kömək LeadDrive dilinizə uyğun açılır. Düymələr və nümunələr rolunuza, aktiv modullara,
          təşkilat parametrlərinə və ekran ölçüsünə görə fərqlənə bilər.
        </p>
      </HelpSection>

      <HelpSection title="Düzgün kömək növünü seçin">
        <dl className="rounded-md border p-3">
          <HelpDef term="Kömək">Hazırda işlədiyiniz ekran üçün təlimat.</HelpDef>
          <HelpDef term="Tur">Ekranda qısa tanışlıq. Düymə mövcuddursa, «Turu təkrarla» funksiyasından istifadə edin.</HelpDef>
          <HelpDef term="Da Vinci">Dəqiq CRM sualları, təhlil, axtarış və dəstəklənən əməliyyatlar üçün süni intellekt köməkçisi.</HelpDef>
        </dl>
        <HelpCallout kind="tip" label="Məsləhət">
          Ekran məqalə ilə uyğun gəlmirsə, əvvəlcə rolunuzu və aktiv modulları yoxlayın. Sonra
          təşkilatınızda hansı konfiqurasiyanın aktiv olduğunu administratordan dəqiqləşdirin.
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security" label="Təhlükəsizlik">
        Köməyi açmaq, oxumaq və bağlamaq heç bir qeydi redaktə etmir. Məlumatları yalnız CRM iş
        ekranında qəsdən etdiyiniz əməliyyatlar dəyişir.
      </HelpCallout>
    </div>
  )
}
