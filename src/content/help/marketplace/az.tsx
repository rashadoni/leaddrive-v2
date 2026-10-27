"use client"

import CapabilitiesHelp from "./content"

const copy = {
  "title": "İcmaldan istifadə",
  "intro": "Tapşırığı və modul kartını seçin. Təfərrüatlar modulun məqsədini, cari girişi və növbəti addımı göstərir.",
  "access": "Vəziyyət nə deməkdir",
  "accessText": "«Əlçatandır» modulu açmaq hüququnu bildirir. Xarici xidmətlərin bağlantısını parametrlərdə ayrıca yoxlayın. Bu səhifə modulları almır və aktivləşdirmir.",
  "next": "İşə necə başlamaq olar",
  "nextText": "«Bölməni aç» iş moduluna aparır. «Qur» mövcud quraşdırma formasını açır. Əlavə girişi administrator LeadDrive ilə müzakirə edə bilər; əməkdaş öz administratoruna müraciət edir.",
  "apps": "Əvvəl quraşdırılmış tətbiqlər",
  "appsText": "Əvvəl quraşdırılmış tətbiqlərin qurulması, müvəqqəti söndürülməsi və silinməsi ayrıca səhifədə saxlanılır. Hazır olmayan yeni paketlər icmalda təklif edilmir."
}

export default function CapabilitiesHelpAz() {
  return <CapabilitiesHelp copy={copy} />
}
