"use client"

/**
 * «Təchizatçı sifarişləri» — təsdiq, göndərmə, çatdırılma və qəbul (Azərbaycan dili).
 */
import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function ProcurementOrdersHelpAz() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="Təchizat əməkdaşı, rəhbər və ya maliyyə" goal="Sifarişi təsdiqdən keçirmək, təchizatçıya göndərmək və malı qəbul etmək">
        Sifariş satınalma sorğusundakı təchizatçı təklifindən yaranır. Kimin təsdiqlədiyini «Təsdiq limitləri» müəyyən edir.
      </HelpScenario>

      <HelpSection title="Səhifədə nə var">
        <dl className="rounded-md border p-3">
          <HelpDef term="Siyahı">nömrə (PO-0001), təchizatçı, sövdələşmə, status, gözlənilən tarix və məbləğ.</HelpDef>
          <HelpDef term="Süzgəclər"><HelpKey>Açıq</HelpKey> və <HelpKey>Yalnız gecikənlər</HelpKey>.</HelpDef>
          <HelpDef term="Statuslar">Qaralama → Təsdiq gözləyir → Təsdiqlənib → Təchizatçıya göndərilib → İstehsaldadır → Yoldadır → Qismən qəbul edilib → Qəbul edilib; həmçinin Rədd edilib və Ləğv edilib.</HelpDef>
          <HelpDef term="Sifarişin səhifəsi"><HelpKey>Mövqelər</HelpKey> (miqdar, qiymət, məbləğ, nə qədər qəbul edilib), <HelpKey>Təsdiq</HelpKey> (kim, hansı addım) və <HelpKey>Tarixçə</HelpKey>.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Addım-addım: təsdiqdən göndərməyə">
        <HelpStep n={1}>
          <p>Qaralama sifarişi açın və <HelpKey>Təsdiqə göndər</HelpKey> basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Status «Təsdiq gözləyir» olur; «Təsdiq» bölməsində məbləğə görə qurulan zəncir görünür — məsələn, «1. Lalə Quliyeva».</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Təsdiqləyən <HelpKey>Təsdiqlə</HelpKey> basır və ya <HelpKey>Rədd et</HelpKey> ilə səbəb yazır.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Təsdiqlənəndə status «Təsdiqlənib» olur; rədd edilmiş sifariş düzəldilib yeni redaksiya kimi yenidən göndərilə bilər.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p><HelpKey>Təchizatçıya göndərildi</HelpKey> basın. Lazım olsa, <HelpKey>Sifarişin PDF-ini təchizatçıya e-poçtla göndər</HelpKey> işarəsini qoyun, ünvanı və PDF-in dilini seçin.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Status «Təchizatçıya göndərilib» olur; məktubun nəticəsi tarixçəyə yazılır. PDF-i istənilən vaxt <HelpKey>PDF</HelpKey> düyməsi ilə açmaq olar.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Addım-addım: çatdırılma və qəbul">
        <HelpStep n={1}>
          <p>Təchizatçı xəbər verdikcə <HelpKey>İstehsaldadır</HelpKey> və <HelpKey>Yoldadır</HelpKey> basın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Hər status dəyişikliyi tarixçədə qalır.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Müddət dəyişirsə — <HelpKey>Müddəti dəyiş</HelpKey>: yeni tarix və <HelpKey>Müddət niyə dəyişdi?</HelpKey>.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">Yeni gözlənilən tarix başlıqda görünür; səbəbsiz göndərilmiş sifarişin tarixini dəyişmək olmur.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Mal gələndə <HelpKey>Malı qəbul et</HelpKey> basın və hər mövqe üzrə indi gələn miqdarı yazın.</p>
          <HelpCallout kind="see" label="Ekranda görəcəksiniz">«Qəbul edilib» sütununda məsələn «8 / 12» görünür, status «Qismən qəbul edilib» olur; hamısı gəldikdə — «Qəbul edilib».</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">Tarixi keçmiş, amma hələ qəbul edilməmiş sifarişi sistem hər saat yoxlayır: «Gecikir» qeydi qoyur və sövdələşmənin sahibini, sorğunu yaradanı və təchizatı bir dəfə xəbərdar edir.</HelpCallout>

      <HelpCallout kind="warning">Sifarişdən artığını qəbul etmək mümkün deyil. Sövdələşmə göndərildikdən sonra dəyişərsə, sifariş «sövdələşmə dəyişib — yoxlayın» qeydi alır: təchizatçı ilə danışın və «Yoxlanıldı» basın.</HelpCallout>

      <HelpCallout kind="security">Sifarişi yaradan öz sifarişini təsdiqləyə bilməz; administrator istənilən addımı təsdiqləyə bilər. Satış sifarişin statusunu görür, qiymətləri görmür.</HelpCallout>
    </div>
  )
}
