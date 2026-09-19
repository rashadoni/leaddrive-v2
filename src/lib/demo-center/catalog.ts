export const DEMO_MODULE_IDS = [
  "crm",
  "sales",
  "contracts",
  "marketing",
  "loyalty",
  "omnichannel",
  "support",
  "finance",
  "analytics",
  "mtm",
  "health",
  "insurance",
  "public-sector",
  "media",
  "energy",
  "settings",
  "ai",
  "voip",
  "sms-otp",
] as const

export type DemoModuleId = (typeof DEMO_MODULE_IDS)[number]
export type DemoTone = "neutral" | "info" | "positive" | "attention"
export type DemoAccent = "orange" | "blue" | "emerald" | "violet" | "amber" | "rose"

export interface DemoMetric {
  label: string
  value: string
  detail: string
  tone?: DemoTone
}

export interface DemoRecord {
  title: string
  meta: string
  value: string
  status: string
  tone: DemoTone
}

export interface DemoStep {
  id: string
  stageLabel: string
  title: string
  description: string
  actionLabel: string
  outcomeTitle: string
  outcome: string
  metrics: readonly [DemoMetric, DemoMetric, DemoMetric]
  records: readonly [DemoRecord, DemoRecord, DemoRecord]
}

export interface DemoModuleManifest {
  id: DemoModuleId
  shortTitle: string
  title: string
  summary: string
  accent: DemoAccent
  steps: readonly [DemoStep, DemoStep, DemoStep]
}

/**
 * Curated, fully synthetic content for the external Demo Center.
 *
 * This catalog is intentionally independent from tenant data and tenant APIs.
 * Every company, identifier, amount, person-like label and operational result
 * below exists only to demonstrate the interface.
 */
export const DEMO_MODULE_CATALOG = [
  {
    id: "crm",
    shortTitle: "CRM",
    title: "Müştəri münasibətlərinin idarə edilməsi",
    summary: "Şirkətləri, əlaqələri və bütün qarşılıqlı münasibət tarixçəsini vahid iş məkanında idarə edin.",
    accent: "orange",
    steps: [
      {
        id: "customer-overview",
        stageLabel: "Vahid profil",
        title: "Müştərini 360° görünüşdə tanıyın",
        description: "Əlaqələri, açıq imkanları və son ünsiyyəti bir ekranda birləşdirərək komandanı tam kontekstlə təmin edin.",
        actionLabel: "Demo profilini aç",
        outcomeTitle: "Kontekst hazırdır",
        outcome: "Demo Şirkət A üzrə əlaqələr, satış imkanları və son yazışmalar vahid profildə toplandı.",
        metrics: [
          { label: "Aktiv əlaqə", value: "18", detail: "+3 bu ay", tone: "positive" },
          { label: "Açıq imkan", value: "4", detail: "₼128 min potensial", tone: "info" },
          { label: "Son təmas", value: "2 saat", detail: "E-poçt cavabı", tone: "neutral" },
        ],
        records: [
          { title: "Demo Şirkət A", meta: "Korporativ hesab · Bakı", value: "₼128 000", status: "Aktiv", tone: "positive" },
          { title: "Kontakt #C-1042", meta: "Satınalma qərarvericisi", value: "3 açıq iş", status: "İzlənilir", tone: "info" },
          { title: "Görüş qeydi", meta: "Məhsul təqdimatı · bu gün", value: "32 dəq", status: "Tamamlandı", tone: "neutral" },
        ],
      },
      {
        id: "relationship-priorities",
        stageLabel: "Prioritetlər",
        title: "Növbəti ən faydalı işi seçin",
        description: "Gecikən təmasları və yüksək dəyərli hesabları görün, məsul şəxsi və son tarixi birbaşa təyin edin.",
        actionLabel: "Prioritetləri sırala",
        outcomeTitle: "Günün planı yeniləndi",
        outcome: "Üç vacib müştəri işi dəyər və son tarixə görə önə çəkildi, məsul şəxslər xəbərdar edildi.",
        metrics: [
          { label: "Bu gün", value: "7 iş", detail: "3 yüksək prioritet", tone: "attention" },
          { label: "Vaxtında təmas", value: "94%", detail: "+8 faiz bəndi", tone: "positive" },
          { label: "Riskli hesab", value: "2", detail: "İzləmə tələb edir", tone: "attention" },
        ],
        records: [
          { title: "Demo Hesab B", meta: "Təklifdən sonra geri əlaqə", value: "Bu gün, 14:30", status: "Yüksək", tone: "attention" },
          { title: "Demo Hesab C", meta: "Yeni ehtiyacların dəqiqləşdirilməsi", value: "Sabah", status: "Planlı", tone: "info" },
          { title: "Demo Hesab D", meta: "Rüblük münasibət icmalı", value: "Cümə", status: "Hazır", tone: "positive" },
        ],
      },
      {
        id: "shared-history",
        stageLabel: "Komanda işi",
        title: "Heç bir müştəri tarixçəsini itirməyin",
        description: "Zəng, e-poçt, görüş və tapşırıqlar eyni zaman xəttinə düşür; əməkdaş dəyişsə belə kontekst qorunur.",
        actionLabel: "Zaman xəttini birləşdir",
        outcomeTitle: "Tarixçə sinxronlaşdırıldı",
        outcome: "Son 30 günün bütün demo qarşılıqlı əlaqələri vahid xronologiyada birləşdirildi.",
        metrics: [
          { label: "Fəaliyyət", value: "46", detail: "Son 30 gün", tone: "info" },
          { label: "Cavab müddəti", value: "1s 18d", detail: "Orta göstərici", tone: "positive" },
          { label: "Açıq tapşırıq", value: "5", detail: "Hamısının sahibi var", tone: "neutral" },
        ],
        records: [
          { title: "E-poçt cavabı alındı", meta: "Təklif şərtləri təsdiqləndi", value: "10:42", status: "Yeni", tone: "info" },
          { title: "Demo zəng qeydi", meta: "Növbəti addım razılaşdırıldı", value: "Dünən", status: "Qeyd edildi", tone: "positive" },
          { title: "Tapşırıq ötürüldü", meta: "Hüquq komandasına baxış", value: "2 gün əvvəl", status: "İcrada", tone: "attention" },
        ],
      },
    ],
  },
  {
    id: "sales",
    shortTitle: "Satış",
    title: "Satışların idarə edilməsi",
    summary: "İmkanları ilk maraqdan müqaviləyə qədər izləyin, proqnozu görün və satış prosesini standartlaşdırın.",
    accent: "blue",
    steps: [
      {
        id: "pipeline-focus",
        stageLabel: "Satış hunisi",
        title: "İmkanları real mərhələlər üzrə idarə edin",
        description: "Hər sövdələşmənin dəyərini, ehtimalını, növbəti addımını və məsul satış əməkdaşını eyni görünüşdə izləyin.",
        actionLabel: "Huni görünüşünü aç",
        outcomeTitle: "Satış hunisi fokuslandı",
        outcome: "Yaxın 30 gündə bağlanma ehtimalı yüksək olan üç demo imkanı önə çıxarıldı.",
        metrics: [
          { label: "Aktiv huni", value: "₼486 min", detail: "12 demo imkanı", tone: "info" },
          { label: "Çəkili proqnoz", value: "₼214 min", detail: "+14% əvvəlki aya", tone: "positive" },
          { label: "Orta dövr", value: "26 gün", detail: "Hədəfdən 3 gün tez", tone: "positive" },
        ],
        records: [
          { title: "Demo Logistika Paketi", meta: "Təklif mərhələsi · 70%", value: "₼96 000", status: "Bu ay", tone: "positive" },
          { title: "Demo Pərakəndə Layihəsi", meta: "Danışıqlar · 55%", value: "₼74 000", status: "İzlənilir", tone: "info" },
          { title: "Demo Xidmət Paketi", meta: "Kəşf mərhələsi · 30%", value: "₼41 000", status: "Yeni", tone: "neutral" },
        ],
      },
      {
        id: "guided-offer",
        stageLabel: "Təklif",
        title: "Səhvsiz kommersiya təklifi hazırlayın",
        description: "Təsdiqlənmiş məhsul və qiymət qaydalarından istifadə edin, endirim həddini avtomatik yoxlayın.",
        actionLabel: "Demo təklifi hesabla",
        outcomeTitle: "Təklif yoxlamadan keçdi",
        outcome: "Qiymət, vergi və 8% demo endirimi siyasətə uyğun hesablandı; təklif təsdiq üçün hazırdır.",
        metrics: [
          { label: "Təklif məbləği", value: "₼82 800", detail: "ƏDV xaric", tone: "info" },
          { label: "Endirim", value: "8%", detail: "Səlahiyyət daxilində", tone: "positive" },
          { label: "Marja", value: "31%", detail: "Hədəfdən +4 bənd", tone: "positive" },
        ],
        records: [
          { title: "Enterprise lisenziyası", meta: "12 aylıq demo ssenarisi", value: "₼72 000", status: "Təsdiqli", tone: "positive" },
          { title: "Quraşdırma xidməti", meta: "Birdəfəlik xidmət", value: "₼9 000", status: "Daxildir", tone: "info" },
          { title: "Təlim paketi", meta: "2 onlayn sessiya", value: "₼1 800", status: "Opsional", tone: "neutral" },
        ],
      },
      {
        id: "forecast-confidence",
        stageLabel: "Proqnoz",
        title: "Rübün nəticəsini əvvəlcədən görün",
        description: "Komanda öhdəliklərini faktiki fəaliyyətlə müqayisə edin və riskli proqnozları bağlanmadan əvvəl müəyyənləşdirin.",
        actionLabel: "Proqnozu yenilə",
        outcomeTitle: "Proqnoz yenidən hesablandı",
        outcome: "Demo rübü üçün hədəfə çatma ehtimalı 87% olaraq hesablandı və iki riskli imkan qeyd edildi.",
        metrics: [
          { label: "Rüb hədəfi", value: "₼600 min", detail: "87% proqnoz", tone: "info" },
          { label: "Öhdəlik", value: "₼522 min", detail: "+₼38 min bu həftə", tone: "positive" },
          { label: "Risk", value: "2 imkan", detail: "₼61 min təsir", tone: "attention" },
        ],
        records: [
          { title: "Sentyabr öhdəliyi", meta: "7 bağlanacaq imkan", value: "₼188 000", status: "Etibarlı", tone: "positive" },
          { title: "Oktyabr proqnozu", meta: "5 imkan üzrə", value: "₼164 000", status: "İzlənilir", tone: "info" },
          { title: "Risk korreksiyası", meta: "Gecikən qərar prosesi", value: "−₼24 000", status: "Diqqət", tone: "attention" },
        ],
      },
    ],
  },
  {
    id: "contracts",
    shortTitle: "Müqavilələr",
    title: "Müqavilələrə nəzarət",
    summary: "Şablondan imzaya, öhdəlikdən yenilənməyə qədər müqavilə dövrünü nəzarətdə saxlayın.",
    accent: "violet",
    steps: [
      {
        id: "contract-draft",
        stageLabel: "Hazırlıq",
        title: "Təsdiqlənmiş şablonla sürətli başlayın",
        description: "Müştəri və təklif məlumatlarını şablona avtomatik yerləşdirin, məcburi bəndləri dəyişiklikdən qoruyun.",
        actionLabel: "Demo müqavilə yarat",
        outcomeTitle: "Qaralama yaradıldı",
        outcome: "Demo müqavilə təsdiqlənmiş B2B şablonu və sintetik satış məlumatları ilə hazırlandı.",
        metrics: [
          { label: "Şablon", value: "B2B v4", detail: "Son təsdiq: bu ay", tone: "positive" },
          { label: "Doldurulan sahə", value: "24/24", detail: "Eksik məlumat yoxdur", tone: "positive" },
          { label: "Riskli dəyişiklik", value: "0", detail: "Standart bəndlər qorunur", tone: "neutral" },
        ],
        records: [
          { title: "Tərəflər və rekvizitlər", meta: "Sintetik təşkilat məlumatları", value: "Tam", status: "Hazır", tone: "positive" },
          { title: "Xidmət əhatəsi", meta: "Enterprise demo paketi", value: "12 ay", status: "Hazır", tone: "positive" },
          { title: "Ödəniş cədvəli", meta: "Rüblük hesablaşma", value: "4 mərhələ", status: "Yoxlanıb", tone: "info" },
        ],
      },
      {
        id: "approval-route",
        stageLabel: "Təsdiq",
        title: "Təsdiq marşrutunu avtomatlaşdırın",
        description: "Məbləğ, endirim və xüsusi bəndlərə görə düzgün hüquq və maliyyə təsdiqçilərini avtomatik seçin.",
        actionLabel: "Təsdiqə göndər",
        outcomeTitle: "Marşrut işə salındı",
        outcome: "Demo müqavilə əvvəlcə hüquq, sonra maliyyə təsdiqinə yönləndirildi; bütün addımlar tarixçədə saxlanıldı.",
        metrics: [
          { label: "Təsdiq mərhələsi", value: "2", detail: "Hüquq → Maliyyə", tone: "info" },
          { label: "Orta müddət", value: "6 saat", detail: "Hədəfdən 2 saat tez", tone: "positive" },
          { label: "Gözləyən", value: "1", detail: "Maliyyə baxışı", tone: "attention" },
        ],
        records: [
          { title: "Hüquqi baxış", meta: "Standartdan 1 fərqli bənd", value: "18 dəq", status: "Təsdiq", tone: "positive" },
          { title: "Maliyyə baxışı", meta: "Ödəniş qrafiki", value: "Gözləyir", status: "Növbədə", tone: "attention" },
          { title: "Rəhbər təsdiqi", meta: "Məbləğ həddindən aşağı", value: "Tələb deyil", status: "Keçildi", tone: "neutral" },
        ],
      },
      {
        id: "renewal-control",
        stageLabel: "Yenilənmə",
        title: "Son tarixləri fürsətə çevirin",
        description: "Yenilənmə pəncərəsini, qiymət dəyişikliyini və açıq öhdəlikləri əvvəlcədən görün.",
        actionLabel: "Yenilənmə planı qur",
        outcomeTitle: "Yenilənmə işi açıldı",
        outcome: "Bitmə tarixindən 90 gün əvvəl satış və hüquq komandaları üçün koordinasiyalı demo plan yaradıldı.",
        metrics: [
          { label: "90 günə bitən", value: "6", detail: "₼244 min dəyər", tone: "attention" },
          { label: "Yenilənmə nisbəti", value: "92%", detail: "+5 faiz bəndi", tone: "positive" },
          { label: "Açıq öhdəlik", value: "3", detail: "Hamısı təyin edilib", tone: "info" },
        ],
        records: [
          { title: "Demo Müqavilə #CT-2408", meta: "Bitmə: 28 noyabr", value: "₼84 000", status: "Planlandı", tone: "positive" },
          { title: "Demo Müqavilə #CT-2411", meta: "Qiymət baxışı tələb olunur", value: "₼62 000", status: "Diqqət", tone: "attention" },
          { title: "Demo Müqavilə #CT-2420", meta: "Avtomatik yenilənmə", value: "₼41 000", status: "Hazır", tone: "info" },
        ],
      },
    ],
  },
  {
    id: "marketing",
    shortTitle: "Marketinq",
    title: "Marketinq avtomatlaşdırması",
    summary: "Auditoriyanı dəqiq seçin, çoxkanallı kampaniyalar qurun və nəticəni gəlirlə əlaqələndirin.",
    accent: "rose",
    steps: [
      {
        id: "audience-builder",
        stageLabel: "Auditoriya",
        title: "Doğru auditoriyanı saniyələrdə qurun",
        description: "Davranış, sektor və satış mərhələsinə görə dinamik seqment yaradın; yalnız razılığı olan kontaktları daxil edin.",
        actionLabel: "Demo seqmenti qur",
        outcomeTitle: "Auditoriya hazırdır",
        outcome: "Korporativ proqramla maraqlanan 1 248 sintetik kontakt seçildi, razılığı olmayan qeydlər avtomatik çıxarıldı.",
        metrics: [
          { label: "Uyğun kontakt", value: "1 248", detail: "3 dinamik qayda", tone: "info" },
          { label: "Marketinq razılığı", value: "96%", detail: "48 qeyd çıxarıldı", tone: "positive" },
          { label: "Təxmini əhatə", value: "1 198", detail: "E-poçt kanalı", tone: "neutral" },
        ],
        records: [
          { title: "Sektor", meta: "Pərakəndə və logistika", value: "642 kontakt", status: "Daxildir", tone: "positive" },
          { title: "Maraq siqnalı", meta: "Son 30 gündə məhsul səhifəsi", value: "811 kontakt", status: "Daxildir", tone: "positive" },
          { title: "Razılıq filtri", meta: "Aktiv opt-in tələb olunur", value: "48 çıxarıldı", status: "Qorunur", tone: "info" },
        ],
      },
      {
        id: "campaign-journey",
        stageLabel: "Kampaniya",
        title: "Çoxkanallı müştəri yolu yaradın",
        description: "E-poçt, SMS və satış tapşırığını vahid axında birləşdirin; cavaba görə növbəti addımı dəyişin.",
        actionLabel: "Sınaq axınını başlat",
        outcomeTitle: "Sınaq uğurla keçdi",
        outcome: "Demo kontakt e-poçtu açdıqdan sonra SMS addımı dayandırıldı və satış əməkdaşına isti lead tapşırığı yaradıldı.",
        metrics: [
          { label: "Axın addımı", value: "5", detail: "3 kanal", tone: "info" },
          { label: "Gözlənən müddət", value: "4 gün", detail: "Davranışa görə dəyişir", tone: "neutral" },
          { label: "Sınaq kontaktı", value: "100%", detail: "Bütün şərtlər keçdi", tone: "positive" },
        ],
        records: [
          { title: "1. Tanışlıq e-poçtu", meta: "Dərhal göndərilir", value: "Açıldı", status: "Keçdi", tone: "positive" },
          { title: "2. Davranış şərti", meta: "Link klikini yoxla", value: "Klik var", status: "Keçdi", tone: "positive" },
          { title: "3. Satış tapşırığı", meta: "Məsul şəxsə yönləndir", value: "Yaradıldı", status: "Hazır", tone: "info" },
        ],
      },
      {
        id: "campaign-attribution",
        stageLabel: "Nəticə",
        title: "Kampaniyanın gəlir təsirini ölçün",
        description: "Açılış və klikdən əlavə, kampaniyanın yaratdığı imkanları və faktiki gəliri izləyin.",
        actionLabel: "Atribusiyanı hesabla",
        outcomeTitle: "Gəlir əlaqəsi quruldu",
        outcome: "Demo kampaniya ilə 18 satış imkanı və ₼46 000 çəkili gəlir əlaqələndirildi.",
        metrics: [
          { label: "Açılma", value: "42,8%", detail: "+6,2 bənd benchmark", tone: "positive" },
          { label: "Yaranan imkan", value: "18", detail: "₼93 min huni", tone: "info" },
          { label: "Çəkili gəlir", value: "₼46 min", detail: "4,1× ROI", tone: "positive" },
        ],
        records: [
          { title: "E-poçt kanalı", meta: "12 əlaqələndirilmiş imkan", value: "₼31 000", status: "Aparıcı", tone: "positive" },
          { title: "SMS kanalı", meta: "4 əlaqələndirilmiş imkan", value: "₼10 000", status: "Səmərəli", tone: "info" },
          { title: "Satış tapşırığı", meta: "2 əlaqələndirilmiş imkan", value: "₼5 000", status: "İzlənilir", tone: "neutral" },
        ],
      },
    ],
  },
  {
    id: "loyalty",
    shortTitle: "Loyallıq",
    title: "Loyallıq proqramı",
    summary: "Üzvləri davranışa görə seqmentləşdirin, xal qaydaları qurun və mükafatların biznes təsirini ölçün.",
    accent: "amber",
    steps: [
      {
        id: "member-segments",
        stageLabel: "Üzvlər",
        title: "Ən dəyərli üzvləri müəyyən edin",
        description: "Alış tezliyi, xərcləmə və aktivlik üzrə üzvləri avtomatik seqmentlərə ayırın.",
        actionLabel: "Seqmentləri yenilə",
        outcomeTitle: "Üzvlər yenidən qruplaşdırıldı",
        outcome: "128 sintetik üzv VIP, 342 üzv isə yenidən aktivləşdirmə seqmentinə daxil edildi.",
        metrics: [
          { label: "Aktiv üzv", value: "4 820", detail: "+7% bu rüb", tone: "positive" },
          { label: "VIP üzv", value: "128", detail: "Gəlirin 31%-i", tone: "info" },
          { label: "Riskli üzv", value: "342", detail: "60 gündür aktiv deyil", tone: "attention" },
        ],
        records: [
          { title: "VIP", meta: "12+ alış və ₼1 500+ xərcləmə", value: "128 üzv", status: "Yüksək dəyər", tone: "positive" },
          { title: "Aktiv", meta: "Son 30 gündə alış", value: "2 946 üzv", status: "Sabit", tone: "info" },
          { title: "Geri qazanılacaq", meta: "60+ gündür alış yoxdur", value: "342 üzv", status: "Diqqət", tone: "attention" },
        ],
      },
      {
        id: "earning-rules",
        stageLabel: "Qaydalar",
        title: "Xal qazanma qaydalarını çevik qurun",
        description: "Kateqoriya, kanal və kampaniya müddətinə görə fərqli xal əmsalları tətbiq edin.",
        actionLabel: "Demo qaydanı aktivləşdir",
        outcomeTitle: "Qayda aktivdir",
        outcome: "Mobil kanal üzrə həftəsonu alışlarına 2× demo xal qaydası tətbiq edildi.",
        metrics: [
          { label: "Aktiv qayda", value: "6", detail: "Toqquşma yoxdur", tone: "positive" },
          { label: "Xal öhdəliyi", value: "1,2 mln", detail: "₼18 min ekvivalent", tone: "info" },
          { label: "Müddət", value: "2 gün", detail: "Həftəsonu kampaniyası", tone: "neutral" },
        ],
        records: [
          { title: "Standart alış", meta: "Hər ₼1 üçün 1 xal", value: "1×", status: "Daimi", tone: "neutral" },
          { title: "Mobil həftəsonu", meta: "Şənbə və bazar", value: "2×", status: "Aktiv", tone: "positive" },
          { title: "VIP bonusu", meta: "VIP seqmenti üçün əlavə", value: "+25%", status: "Aktiv", tone: "info" },
        ],
      },
      {
        id: "reward-impact",
        stageLabel: "Mükafatlar",
        title: "Mükafatın real təsirini görün",
        description: "İstifadə edilən xalları, təkrar alışları və kampaniyanın artan gəlirini vahid hesabatda müqayisə edin.",
        actionLabel: "Təsiri hesabla",
        outcomeTitle: "Mükafat nəticəsi hazırdır",
        outcome: "Demo kuponunu istifadə edən üzvlərdə təkrar alış tezliyi 18% daha yüksək oldu.",
        metrics: [
          { label: "İstifadə nisbəti", value: "36%", detail: "+9 bənd", tone: "positive" },
          { label: "Təkrar alış", value: "+18%", detail: "Nəzarət qrupu ilə müqayisə", tone: "positive" },
          { label: "Artan gəlir", value: "₼27 min", detail: "Demo hesablaması", tone: "info" },
        ],
        records: [
          { title: "₼10 kupon", meta: "2 000 xal qarşılığında", value: "462 istifadə", status: "Lider", tone: "positive" },
          { title: "Pulsuz çatdırılma", meta: "1 200 xal qarşılığında", value: "318 istifadə", status: "Sabit", tone: "info" },
          { title: "VIP erkən giriş", meta: "Yalnız VIP seqmenti", value: "74 istifadə", status: "Eksklüziv", tone: "neutral" },
        ],
      },
    ],
  },
  {
    id: "omnichannel",
    shortTitle: "Omnikanal",
    title: "Vahid kommunikasiya mərkəzi",
    summary: "E-poçt, mesajlaşma və digər kanallardan gələn müraciətləri vahid növbədə birləşdirin.",
    accent: "emerald",
    steps: [
      {
        id: "unified-inbox",
        stageLabel: "Vahid inbox",
        title: "Bütün dialoqları bir növbədə görün",
        description: "Kanal dəyişsə də müştəri konteksti və əvvəlki yazışmalar eyni dialoqda qalır.",
        actionLabel: "Demo dialoqu aç",
        outcomeTitle: "Dialoq konteksti yükləndi",
        outcome: "E-poçt və mesajlaşma tarixçəsi bir sintetik müştəri dialoqunda birləşdirildi.",
        metrics: [
          { label: "Açıq dialoq", value: "23", detail: "4 kanal üzrə", tone: "info" },
          { label: "İlk cavab", value: "48 san", detail: "SLA daxilində", tone: "positive" },
          { label: "Gözləyən", value: "3", detail: "2 dəqiqədən az", tone: "neutral" },
        ],
        records: [
          { title: "Dialoq #OM-2041", meta: "Veb çat · məhsul sualı", value: "42 san", status: "Yeni", tone: "info" },
          { title: "Dialoq #OM-2038", meta: "E-poçt · sifariş dəyişikliyi", value: "3 dəq", status: "Cavablandı", tone: "positive" },
          { title: "Dialoq #OM-2032", meta: "Mesajlaşma · texniki sorğu", value: "8 dəq", status: "İcrada", tone: "attention" },
        ],
      },
      {
        id: "smart-routing",
        stageLabel: "Yönləndirmə",
        title: "Müraciəti düzgün komandaya yönləndirin",
        description: "Dil, mövzu, prioritet və iş yükünə görə dialoqları uyğun əməkdaşa avtomatik təyin edin.",
        actionLabel: "Yönləndirməni sına",
        outcomeTitle: "Sorğu düzgün növbəyə düşdü",
        outcome: "Azərbaycan dilindəki yüksək prioritetli demo sorğu boş operatora 0,4 saniyədə təyin edildi.",
        metrics: [
          { label: "Avtomatik təyinat", value: "91%", detail: "Əl ilə ötürmə azalıb", tone: "positive" },
          { label: "Orta növbə", value: "1,4 dəq", detail: "−32% bu ay", tone: "positive" },
          { label: "Aktiv operator", value: "8", detail: "72% orta yük", tone: "info" },
        ],
        records: [
          { title: "Dil qaydası", meta: "Azərbaycan dili", value: "AZ komandası", status: "Uyğundur", tone: "positive" },
          { title: "Mövzu qaydası", meta: "Ödəniş və hesablaşma", value: "Maliyyə növbəsi", status: "Uyğundur", tone: "positive" },
          { title: "Yük balansı", meta: "Ən az aktiv dialoq", value: "Operator D-07", status: "Təyin edildi", tone: "info" },
        ],
      },
      {
        id: "conversation-control",
        stageLabel: "SLA nəzarəti",
        title: "Cavab keyfiyyətini real vaxtda qoruyun",
        description: "SLA risklərini, köçürmələri və həll olunmamış dialoqları növbə rəhbəri üçün görünən edin.",
        actionLabel: "Riskləri prioritetləşdir",
        outcomeTitle: "Növbə optimallaşdırıldı",
        outcome: "SLA həddinə yaxın iki demo dialoq siyahının əvvəlinə çəkildi və rəhbərə bildiriş hazırlandı.",
        metrics: [
          { label: "SLA daxilində", value: "96,4%", detail: "+2,1 bənd", tone: "positive" },
          { label: "Riskli dialoq", value: "2", detail: "5 dəqiqədən az qalıb", tone: "attention" },
          { label: "Bir toxunuşda həll", value: "71%", detail: "+6 bənd", tone: "info" },
        ],
        records: [
          { title: "Dialoq #OM-2027", meta: "SLA bitməsinə 03:18", value: "Ödəniş sorğusu", status: "Təcili", tone: "attention" },
          { title: "Dialoq #OM-2029", meta: "SLA bitməsinə 04:52", value: "Çatdırılma", status: "Diqqət", tone: "attention" },
          { title: "Dialoq #OM-2030", meta: "SLA bitməsinə 18:40", value: "Ümumi sual", status: "Normal", tone: "positive" },
        ],
      },
    ],
  },
  {
    id: "support",
    shortTitle: "Dəstək",
    title: "Müştəri dəstəyi",
    summary: "Sorğuları SLA ilə idarə edin, bilik bazasından istifadə edin və həll keyfiyyətini ölçün.",
    accent: "blue",
    steps: [
      {
        id: "ticket-triage",
        stageLabel: "Sorğu qəbulu",
        title: "Hər müraciətə düzgün prioritet verin",
        description: "Mövzu, müştəri səviyyəsi və təsir dairəsinə görə ticket prioritetini və sahibini avtomatik müəyyənləşdirin.",
        actionLabel: "Demo sorğunu təsnif et",
        outcomeTitle: "Sorğu təsnif edildi",
        outcome: "Demo sorğu “Yüksək” prioritetlə texniki dəstək növbəsinə yönləndirildi və 4 saatlıq SLA başladı.",
        metrics: [
          { label: "Açıq ticket", value: "31", detail: "5 yüksək prioritet", tone: "info" },
          { label: "SLA riski", value: "3", detail: "Rəhbər izləyir", tone: "attention" },
          { label: "Avtomatik təsnifat", value: "88%", detail: "+11 bənd", tone: "positive" },
        ],
        records: [
          { title: "Ticket #SP-3108", meta: "İnteqrasiya bağlantısı", value: "4 saat SLA", status: "Yüksək", tone: "attention" },
          { title: "Ticket #SP-3106", meta: "Hesabat filtri", value: "8 saat SLA", status: "Normal", tone: "info" },
          { title: "Ticket #SP-3101", meta: "İstifadəçi sualı", value: "24 saat SLA", status: "Aşağı", tone: "neutral" },
        ],
      },
      {
        id: "knowledge-assist",
        stageLabel: "Bilik bazası",
        title: "Operatora cavab zamanı kömək edin",
        description: "Ticket mövzusuna uyğun təsdiqlənmiş məqalələri tapın və cavab layihəsinə təhlükəsiz şəkildə əlavə edin.",
        actionLabel: "Uyğun cavabı tap",
        outcomeTitle: "Bilik məqaləsi tapıldı",
        outcome: "Demo sorğuya uyğun iki təsdiqlənmiş məqalə göstərildi; operator son cavabı özü təsdiqləyəcək.",
        metrics: [
          { label: "Uyğun məqalə", value: "2", detail: "90%+ uyğunluq", tone: "positive" },
          { label: "Orta axtarış", value: "0,8 san", detail: "Bilik bazası daxilində", tone: "info" },
          { label: "Özünəxidmət", value: "34%", detail: "+5 bənd", tone: "positive" },
        ],
        records: [
          { title: "İnteqrasiya bağlantısını yeniləmək", meta: "KB-118 · son baxış bu ay", value: "96% uyğun", status: "Təsdiqli", tone: "positive" },
          { title: "Giriş məlumatlarını yoxlamaq", meta: "KB-074 · təhlükəsizlik addımları", value: "91% uyğun", status: "Təsdiqli", tone: "positive" },
          { title: "Əl ilə diaqnostika", meta: "KB-031 · əlavə yoxlama", value: "68% uyğun", status: "Alternativ", tone: "neutral" },
        ],
      },
      {
        id: "service-insights",
        stageLabel: "Keyfiyyət",
        title: "Xidmət keyfiyyətini davamlı yaxşılaşdırın",
        description: "Həll müddəti, təkrar açılma və məmnunluq siqnallarını mövzu və komanda üzrə müqayisə edin.",
        actionLabel: "Keyfiyyət icmalı yarat",
        outcomeTitle: "İnkişaf sahəsi müəyyənləşdi",
        outcome: "Demo analiz giriş mövzusunda təkrar açılmaların artdığını göstərdi və bilik məqaləsi yeniləmə işi yaratdı.",
        metrics: [
          { label: "Orta həll", value: "5s 12d", detail: "−48 dəqiqə", tone: "positive" },
          { label: "Təkrar açılma", value: "4,2%", detail: "+0,8 bənd", tone: "attention" },
          { label: "Məmnunluq", value: "4,7/5", detail: "286 demo cavab", tone: "positive" },
        ],
        records: [
          { title: "Giriş və təhlükəsizlik", meta: "12 təkrar açılma", value: "7,1%", status: "Araşdırılır", tone: "attention" },
          { title: "Hesabatlar", meta: "4 təkrar açılma", value: "3,0%", status: "Sabit", tone: "positive" },
          { title: "İnteqrasiyalar", meta: "6 təkrar açılma", value: "4,4%", status: "İzlənilir", tone: "info" },
        ],
      },
    ],
  },
  {
    id: "finance",
    shortTitle: "Maliyyə",
    title: "Maliyyə idarəetməsi",
    summary: "Hesab-fakturaları, büdcəni, pul axınını və gəlirliliyi satış məlumatları ilə əlaqəli idarə edin.",
    accent: "emerald",
    steps: [
      {
        id: "invoice-control",
        stageLabel: "Hesab-faktura",
        title: "Debitor borclarını bir baxışda izləyin",
        description: "Ödəniş statuslarını, gecikmələri və məsul müştəri menecerini vahid cədvəldə görün.",
        actionLabel: "Gecikənləri filtrlə",
        outcomeTitle: "Toplama siyahısı hazırdır",
        outcome: "Məbləği ₼5 000-dan yüksək olan üç gecikmiş demo hesab prioritetləşdirildi.",
        metrics: [
          { label: "Debitor borcu", value: "₼184 min", detail: "42 açıq hesab", tone: "info" },
          { label: "Gecikmiş", value: "₼31 min", detail: "Ümumi məbləğin 17%-i", tone: "attention" },
          { label: "Orta yığım", value: "24 gün", detail: "−3 gün", tone: "positive" },
        ],
        records: [
          { title: "INV-D-1048", meta: "Demo Şirkət B · 8 gün gecikib", value: "₼12 400", status: "Gecikib", tone: "attention" },
          { title: "INV-D-1052", meta: "Demo Şirkət C · bu gün", value: "₼9 800", status: "Ödənəcək", tone: "info" },
          { title: "INV-D-1057", meta: "Demo Şirkət D · 6 gün qalıb", value: "₼7 250", status: "Vaxtında", tone: "positive" },
        ],
      },
      {
        id: "budget-visibility",
        stageLabel: "Büdcə",
        title: "Plan və faktı vaxtında müqayisə edin",
        description: "Şöbə və xərc kateqoriyaları üzrə kənarlaşmaları görün, səbəb və düzəliş proqnozunu qeyd edin.",
        actionLabel: "Kənarlaşmanı analiz et",
        outcomeTitle: "Büdcə səbəbi qeyd edildi",
        outcome: "Demo marketinq xərcindəki 6% artım kampaniya vaxtının dəyişməsi ilə əlaqələndirildi və proqnoz yeniləndi.",
        metrics: [
          { label: "Aylıq plan", value: "₼240 min", detail: "8 xərc mərkəzi", tone: "neutral" },
          { label: "Fakt", value: "₼232 min", detail: "Planın 96,7%-i", tone: "positive" },
          { label: "Ən böyük fərq", value: "+6%", detail: "Marketinq", tone: "attention" },
        ],
        records: [
          { title: "Satış", meta: "Plan ₼64 000", value: "₼61 400", status: "−4,1%", tone: "positive" },
          { title: "Marketinq", meta: "Plan ₼38 000", value: "₼40 280", status: "+6,0%", tone: "attention" },
          { title: "Əməliyyat", meta: "Plan ₼71 000", value: "₼69 900", status: "−1,5%", tone: "positive" },
        ],
      },
      {
        id: "profitability-view",
        stageLabel: "Gəlirlilik",
        title: "Gəliri müştəri və məhsul üzrə ölçün",
        description: "Gəlir, birbaşa xərc və xidmət yükünü birləşdirərək real marjanı görün.",
        actionLabel: "Marjanı hesabla",
        outcomeTitle: "Gəlirlilik görünür",
        outcome: "Demo Enterprise paketinin 34% marja ilə portfeldə ən gəlirli təklif olduğu hesablandı.",
        metrics: [
          { label: "Ümumi gəlir", value: "₼418 min", detail: "Demo rübü", tone: "info" },
          { label: "Brüt marja", value: "29,6%", detail: "+2,4 bənd", tone: "positive" },
          { label: "Aşağı marjalı", value: "2 hesab", detail: "Fəaliyyət tələb edir", tone: "attention" },
        ],
        records: [
          { title: "Enterprise demo paketi", meta: "24 sintetik müqavilə", value: "34% marja", status: "Güclü", tone: "positive" },
          { title: "Business demo paketi", meta: "38 sintetik müqavilə", value: "27% marja", status: "Sabit", tone: "info" },
          { title: "Xüsusi xidmətlər", meta: "9 sintetik layihə", value: "18% marja", status: "Baxış", tone: "attention" },
        ],
      },
    ],
  },
  {
    id: "analytics",
    shortTitle: "Analitika",
    title: "Analitika və hesabatlar",
    summary: "Əsas göstəriciləri canlı izləyin, səbəbə qədər dərinləşin və qərar verənlərə hazır hesabat çatdırın.",
    accent: "violet",
    steps: [
      {
        id: "executive-kpis",
        stageLabel: "İdarəetmə paneli",
        title: "Biznesin nəbzini vahid paneldə görün",
        description: "Satış, xidmət və maliyyə göstəricilərini eyni dövr və məqsədlərlə müqayisə edin.",
        actionLabel: "Demo panelini yenilə",
        outcomeTitle: "Göstəricilər yeniləndi",
        outcome: "Bütün sintetik mənbələr eyni hesabat dövrünə gətirildi və rəhbərlik paneli yeniləndi.",
        metrics: [
          { label: "Gəlir", value: "₼418 min", detail: "+12% illik", tone: "positive" },
          { label: "Huni çevrilməsi", value: "28,4%", detail: "+3,1 bənd", tone: "positive" },
          { label: "Müştəri sağlamlığı", value: "86/100", detail: "2 riskli hesab", tone: "info" },
        ],
        records: [
          { title: "Satış hədəfi", meta: "Rüblük məqsəd", value: "87%", status: "Yoldadır", tone: "positive" },
          { title: "Dəstək SLA", meta: "Aylıq məqsəd ≥95%", value: "96,4%", status: "Üstündə", tone: "positive" },
          { title: "Debitor gecikməsi", meta: "Məqsəd ≤15%", value: "17%", status: "Diqqət", tone: "attention" },
        ],
      },
      {
        id: "root-cause",
        stageLabel: "Dərin analiz",
        title: "Rəqəmdən səbəbə qədər dərinləşin",
        description: "Göstəricini region, məhsul, komanda və dövr üzrə parçalayaraq fərqin mənbəyini tapın.",
        actionLabel: "Səbəbi araşdır",
        outcomeTitle: "Əsas səbəb tapıldı",
        outcome: "Demo çevrilmə azalmasının bir məhsul qrupunda gecikən follow-up fəaliyyəti ilə əlaqəli olduğu göstərildi.",
        metrics: [
          { label: "Analiz ölçüsü", value: "4", detail: "Dövr, məhsul, region, komanda", tone: "info" },
          { label: "Əsas təsir", value: "−4,2 bənd", detail: "Demo məhsul qrupu C", tone: "attention" },
          { label: "İzah olunan fərq", value: "82%", detail: "Məlumatla əsaslandırılıb", tone: "positive" },
        ],
        records: [
          { title: "Demo məhsul qrupu C", meta: "Follow-up 2,6 gün gecikib", value: "−4,2 bənd", status: "Əsas səbəb", tone: "attention" },
          { title: "Demo region B", meta: "Huni həcmi azalıb", value: "−1,1 bənd", status: "İkinci təsir", tone: "info" },
          { title: "Qiymət dəyişikliyi", meta: "Statistik təsir aşağıdır", value: "−0,2 bənd", status: "Zəif", tone: "neutral" },
        ],
      },
      {
        id: "scheduled-story",
        stageLabel: "Paylaşım",
        title: "Hesabatı qərara hazır şəkildə çatdırın",
        description: "Filtrləri, dövrü və qısa şərhi saxlayın; rəhbərlik üçün eyni versiyanı planlı göndərin.",
        actionLabel: "Demo hesabatını planla",
        outcomeTitle: "Hesabat planlandı",
        outcome: "Rüblük demo icmalı hər bazar ertəsi saat 09:00 üçün planlandı və qəbul edənlər təsdiqləndi.",
        metrics: [
          { label: "Planlı hesabat", value: "7", detail: "3 rəhbərlik qrupu", tone: "info" },
          { label: "Son çatdırılma", value: "100%", detail: "Uğurlu", tone: "positive" },
          { label: "Məlumat vaxtı", value: "08:55", detail: "5 dəq əvvəl yenilənir", tone: "neutral" },
        ],
        records: [
          { title: "Rüblük icmal", meta: "Bazar ertəsi · 09:00", value: "PDF + link", status: "Planlı", tone: "positive" },
          { title: "Satış proqnozu", meta: "Hər iş günü · 08:30", value: "Link", status: "Aktiv", tone: "info" },
          { title: "SLA istisnaları", meta: "Yalnız risk yarandıqda", value: "Bildiriş", status: "Şərtli", tone: "neutral" },
        ],
      },
    ],
  },
  {
    id: "mtm",
    shortTitle: "Sahə işi",
    title: "Sahə komandaları və marşrutlar",
    summary: "Marşrutları planlayın, ziyarət icrasını təsdiqləyin və sahədən gələn nəticələri mərkəzdə görün.",
    accent: "orange",
    steps: [
      {
        id: "route-planning",
        stageLabel: "Marşrut",
        title: "Günün marşrutunu ağıllı planlayın",
        description: "Prioritet ziyarətləri, vaxt pəncərələrini və məsafəni nəzərə alaraq balanslı marşrut yaradın.",
        actionLabel: "Demo marşrutu optimallaşdır",
        outcomeTitle: "Marşrut optimallaşdırıldı",
        outcome: "Səkkiz sintetik ziyarət yenidən sıralandı, ümumi məsafə 18 km və plan vaxtı 34 dəqiqə azaldı.",
        metrics: [
          { label: "Ziyarət", value: "8", detail: "2 yüksək prioritet", tone: "info" },
          { label: "Məsafə", value: "64 km", detail: "−18 km", tone: "positive" },
          { label: "Plan vaxtı", value: "6s 20d", detail: "−34 dəqiqə", tone: "positive" },
        ],
        records: [
          { title: "Demo Nöqtə 01", meta: "09:00–09:30 · prioritet", value: "4,2 km", status: "1-ci", tone: "attention" },
          { title: "Demo Nöqtə 02", meta: "10:00–11:00", value: "7,8 km", status: "2-ci", tone: "info" },
          { title: "Demo Nöqtə 03", meta: "11:30–12:00", value: "5,1 km", status: "3-cü", tone: "neutral" },
        ],
      },
      {
        id: "visit-execution",
        stageLabel: "Ziyarət",
        title: "Sahə işini standart ssenari ilə aparın",
        description: "Check-in, tapşırıq siyahısı, foto sübut və nəticəni eyni mobil axında tamamlayın.",
        actionLabel: "Demo ziyarəti tamamla",
        outcomeTitle: "Ziyarət qeydə alındı",
        outcome: "Sintetik check-in, üç yoxlama addımı və demo nəticəsi vaxt möhürü ilə təhlükəsiz qeydə alındı.",
        metrics: [
          { label: "Check-in", value: "09:04", detail: "Plan daxilində", tone: "positive" },
          { label: "Tapşırıq", value: "3/3", detail: "Hamısı tamamlandı", tone: "positive" },
          { label: "Müddət", value: "24 dəq", detail: "Plan: 30 dəq", tone: "info" },
        ],
        records: [
          { title: "Məkan təsdiqi", meta: "Demo koordinat · 35 m dəqiqlik", value: "09:04", status: "Təsdiq", tone: "positive" },
          { title: "Yoxlama siyahısı", meta: "3 məcburi bənd", value: "3/3", status: "Tam", tone: "positive" },
          { title: "Nəticə qeydi", meta: "Növbəti ziyarət 30 günə", value: "Saxlanıldı", status: "Hazır", tone: "info" },
        ],
      },
      {
        id: "field-performance",
        stageLabel: "Nəticə",
        title: "Sahə icrasını faktlarla ölçün",
        description: "Plan-fakt, ziyarət keyfiyyəti və komanda yükünü region və əməkdaş üzrə müqayisə edin.",
        actionLabel: "İcra hesabatını qur",
        outcomeTitle: "Sahə hesabatı hazırdır",
        outcome: "Demo region üzrə planlanan ziyarətlərin 93%-i tamamlanıb, iki gecikmənin səbəbi qeyd edilib.",
        metrics: [
          { label: "Tamamlama", value: "93%", detail: "+4 bənd", tone: "positive" },
          { label: "Vaxtında başlama", value: "89%", detail: "Hədəf 90%", tone: "attention" },
          { label: "Sübut tamlığı", value: "97%", detail: "Foto və checklist", tone: "positive" },
        ],
        records: [
          { title: "Demo Region A", meta: "42 planlı ziyarət", value: "95%", status: "Hədəfdə", tone: "positive" },
          { title: "Demo Region B", meta: "37 planlı ziyarət", value: "91%", status: "İzlənilir", tone: "info" },
          { title: "Demo Region C", meta: "28 planlı ziyarət", value: "86%", status: "Diqqət", tone: "attention" },
        ],
      },
    ],
  },
  {
    id: "health",
    shortTitle: "Səhiyyə",
    title: "Səhiyyə buludu",
    summary: "Pasiyent xidmətini koordinasiya edin, qayğı planını izləyin və həssas məlumatlara nəzarətli giriş yaradın.",
    accent: "rose",
    steps: [
      {
        id: "patient-coordination",
        stageLabel: "Koordinasiya",
        title: "Pasiyent yolunu vahid baxışda koordinasiya edin",
        description: "Görüşləri, yönləndirmələri və açıq qayğı tapşırıqlarını sintetik pasiyent profili ətrafında birləşdirin.",
        actionLabel: "Demo qayğı profilini aç",
        outcomeTitle: "Qayğı konteksti hazırdır",
        outcome: "Demo Pasiyent #P-1042 üçün görüş, yönləndirmə və iki açıq tapşırıq vahid görünüşdə toplandı.",
        metrics: [
          { label: "Növbəti görüş", value: "24 sent", detail: "10:30 · Demo klinika", tone: "info" },
          { label: "Açıq tapşırıq", value: "2", detail: "Sahibləri təyin edilib", tone: "attention" },
          { label: "Qayğı planı", value: "82%", detail: "5/6 addım tamam", tone: "positive" },
        ],
        records: [
          { title: "Demo Pasiyent #P-1042", meta: "Tamamilə sintetik qeyd", value: "Aktiv plan", status: "Koordinasiya", tone: "info" },
          { title: "Laboratoriya yönləndirməsi", meta: "Demo nəticə gözlənilir", value: "1 gün", status: "Gözləyir", tone: "attention" },
          { title: "Nəzarət görüşü", meta: "Video konsultasiya", value: "24 sent", status: "Təsdiqli", tone: "positive" },
        ],
      },
      {
        id: "care-plan",
        stageLabel: "Qayğı planı",
        title: "Qayğı addımlarını vaxtında izləyin",
        description: "Klinik olmayan koordinasiya tapşırıqlarını son tarix, məsul rol və tamamlanma sübutu ilə idarə edin.",
        actionLabel: "Növbəti addımı təyin et",
        outcomeTitle: "Qayğı tapşırığı yaradıldı",
        outcome: "Demo pasiyent üçün 48 saatlıq nəzarət zəngi qayğı koordinatoruna təyin edildi.",
        metrics: [
          { label: "Plan addımı", value: "6", detail: "5 tamamlandı", tone: "positive" },
          { label: "Gecikən", value: "0", detail: "Bütün SLA-lar qorunur", tone: "positive" },
          { label: "Növbəti yoxlama", value: "48 saat", detail: "Koordinator zəngi", tone: "info" },
        ],
        records: [
          { title: "İlkin konsultasiya", meta: "Demo klinik axın", value: "18 sent", status: "Tamam", tone: "positive" },
          { title: "Nəticə izahı", meta: "Təsdiqlənmiş skript", value: "20 sent", status: "Tamam", tone: "positive" },
          { title: "Nəzarət zəngi", meta: "Qayğı koordinatoru", value: "22 sent", status: "Planlı", tone: "info" },
        ],
      },
      {
        id: "privacy-audit",
        stageLabel: "Məxfilik",
        title: "Həssas məlumat girişini izləyin",
        description: "Rol əsaslı icazələri və hər baxışın səbəbini dəyişdirilməz audit tarixçəsində görün.",
        actionLabel: "Giriş auditini yoxla",
        outcomeTitle: "Girişlər siyasətə uyğundur",
        outcome: "Demo profilinə son baxışların hamısı icazəli rol və iş məqsədi ilə uyğunlaşdırıldı.",
        metrics: [
          { label: "Yoxlanan giriş", value: "18", detail: "Son 7 gün", tone: "info" },
          { label: "Siyasət pozuntusu", value: "0", detail: "Uyğunsuz giriş yoxdur", tone: "positive" },
          { label: "Məhdud sahə", value: "7", detail: "Rol əsasında gizlidir", tone: "neutral" },
        ],
        records: [
          { title: "Qayğı koordinatoru", meta: "Plan tapşırığına baxış", value: "Bu gün 09:42", status: "İcazəli", tone: "positive" },
          { title: "Görüş operatoru", meta: "Cədvəl məlumatına baxış", value: "Dünən 16:18", status: "İcazəli", tone: "positive" },
          { title: "Demo audit qaydası", meta: "Həssas sahə ixracı", value: "Bloklanıb", status: "Qorunur", tone: "info" },
        ],
      },
    ],
  },
  {
    id: "insurance",
    shortTitle: "Sığorta",
    title: "Sığorta buludu",
    summary: "Polis, iddia və yenilənmə proseslərini müştəri konteksti və nəzarət qaydaları ilə idarə edin.",
    accent: "blue",
    steps: [
      {
        id: "policy-overview",
        stageLabel: "Polis",
        title: "Polis portfelini vahid görünüşdə izləyin",
        description: "Əhatə, ödəniş, risk və yenilənmə tarixlərini bir müştəri profili ətrafında birləşdirin.",
        actionLabel: "Demo polisi aç",
        outcomeTitle: "Polis konteksti hazırdır",
        outcome: "Demo Polis #PL-2048 üzrə əhatə, ödəniş və açıq iddia məlumatları vahid baxışda göstərildi.",
        metrics: [
          { label: "Aktiv polis", value: "1 842", detail: "+6% illik", tone: "positive" },
          { label: "90 günə yenilənən", value: "214", detail: "₼390 min premium", tone: "info" },
          { label: "Ödəniş riski", value: "18", detail: "İzləmə tələb edir", tone: "attention" },
        ],
        records: [
          { title: "Demo Polis #PL-2048", meta: "Korporativ əmlak · sintetik", value: "₼24 000", status: "Aktiv", tone: "positive" },
          { title: "Ödəniş qrafiki", meta: "4 rüblük ödəniş", value: "3/4", status: "Vaxtında", tone: "positive" },
          { title: "Yenilənmə pəncərəsi", meta: "65 gün qalıb", value: "22 noyabr", status: "Planlı", tone: "info" },
        ],
      },
      {
        id: "claim-workflow",
        stageLabel: "İddia",
        title: "İddianı şəffaf mərhələlərlə idarə edin",
        description: "Sənədləri, ekspert baxışını, rezervi və müştəri məlumatlandırmasını vahid prosesdə izləyin.",
        actionLabel: "Demo iddianı yönləndir",
        outcomeTitle: "İddia iş axını başladı",
        outcome: "Sintetik iddia ekspert baxışına təyin edildi, sənəd checklisti və 2 günlük SLA yaradıldı.",
        metrics: [
          { label: "Açıq iddia", value: "46", detail: "6 yüksək prioritet", tone: "info" },
          { label: "Orta həll", value: "8,4 gün", detail: "−1,2 gün", tone: "positive" },
          { label: "Sənəd çatışmazlığı", value: "7", detail: "Avtomatik bildiriş", tone: "attention" },
        ],
        records: [
          { title: "Demo İddia #CL-1108", meta: "Sənədlər tamdır", value: "₼8 600 rezerv", status: "Ekspertdə", tone: "info" },
          { title: "Demo İddia #CL-1102", meta: "1 sənəd gözlənilir", value: "₼4 200 rezerv", status: "Gözləyir", tone: "attention" },
          { title: "Demo İddia #CL-1094", meta: "Ödəniş təsdiqlənib", value: "₼6 150", status: "Bağlanır", tone: "positive" },
        ],
      },
      {
        id: "renewal-retention",
        stageLabel: "Yenilənmə",
        title: "Yenilənməni riskə görə prioritetləşdirin",
        description: "Müştəri davranışı, iddia tarixçəsi və qiymət dəyişikliyini nəzərə alaraq doğru əlaqə planı qurun.",
        actionLabel: "Yenilənmə siyahısını qur",
        outcomeTitle: "Yenilənmə planı hazırdır",
        outcome: "Yüksək dəyərli 12 demo polis satış komandasına fərdiləşdirilmiş əlaqə planı ilə ötürüldü.",
        metrics: [
          { label: "Yenilənmə nisbəti", value: "89%", detail: "+3 bənd", tone: "positive" },
          { label: "Riskli polis", value: "28", detail: "₼74 min premium", tone: "attention" },
          { label: "Əlaqə planı", value: "100%", detail: "Sahibi təyin edilib", tone: "positive" },
        ],
        records: [
          { title: "Yüksək dəyər", meta: "12 demo polis", value: "₼48 000", status: "Fərdi əlaqə", tone: "positive" },
          { title: "Qiymət həssas", meta: "9 demo polis", value: "₼17 000", status: "Təklif baxışı", tone: "attention" },
          { title: "Standart yenilənmə", meta: "193 demo polis", value: "₼325 000", status: "Avtomatik", tone: "info" },
        ],
      },
    ],
  },
  {
    id: "public-sector",
    shortTitle: "Dövlət sektoru",
    title: "Dövlət sektoru buludu",
    summary: "Vətəndaş müraciətlərini, xidmət müddətlərini və qərar tarixçəsini şəffaf proseslə idarə edin.",
    accent: "violet",
    steps: [
      {
        id: "citizen-request",
        stageLabel: "Müraciət",
        title: "Müraciəti bir dəfə qəbul edin, tam izləyin",
        description: "Kanal, kateqoriya, tələb olunan sənədlər və razılıq məlumatlarını vahid sintetik işdə toplayın.",
        actionLabel: "Demo müraciəti qeyd et",
        outcomeTitle: "Müraciət qəbul edildi",
        outcome: "Demo Müraciət #PS-24019 düzgün xidmət kateqoriyası və 10 iş günlük cavab müddəti ilə qeydə alındı.",
        metrics: [
          { label: "Açıq müraciət", value: "126", detail: "14 xidmət kateqoriyası", tone: "info" },
          { label: "Sənədi tam", value: "91%", detail: "+8 bənd", tone: "positive" },
          { label: "Bu gün son tarix", value: "7", detail: "Hamısı təyin edilib", tone: "attention" },
        ],
        records: [
          { title: "Demo Müraciət #PS-24019", meta: "Elektron kanal · sintetik qeyd", value: "10 iş günü", status: "Qəbul edildi", tone: "info" },
          { title: "Sənəd yoxlaması", meta: "3 məcburi sənəd", value: "3/3", status: "Tam", tone: "positive" },
          { title: "Razılıq qeydi", meta: "Məlumat emalı bildirişi", value: "Təsdiq", status: "Qeyd edildi", tone: "positive" },
        ],
      },
      {
        id: "case-routing",
        stageLabel: "İcra",
        title: "İşi səlahiyyət və müddətə görə yönləndirin",
        description: "Müraciəti uyğun şöbəyə verin, asılı tapşırıqları və qanuni cavab müddətini avtomatik izləyin.",
        actionLabel: "İcra planını başlat",
        outcomeTitle: "İş icraya verildi",
        outcome: "Demo işi bir aparıcı və iki iştirakçı şöbə arasında ardıcıl tapşırıqlarla planlandı.",
        metrics: [
          { label: "İcra addımı", value: "4", detail: "2 şöbə iştirak edir", tone: "info" },
          { label: "Qalan müddət", value: "8 gün", detail: "SLA daxilində", tone: "positive" },
          { label: "Asılı tapşırıq", value: "2", detail: "Ardıcıllıq qorunur", tone: "neutral" },
        ],
        records: [
          { title: "İlkin hüquqi yoxlama", meta: "Aparıcı şöbə", value: "1 iş günü", status: "Tamam", tone: "positive" },
          { title: "Texniki rəy", meta: "İştirakçı şöbə", value: "3 iş günü", status: "İcrada", tone: "info" },
          { title: "Rəsmi cavab", meta: "Rəy tamamlandıqdan sonra", value: "2 iş günü", status: "Gözləyir", tone: "neutral" },
        ],
      },
      {
        id: "service-transparency",
        stageLabel: "Şəffaflıq",
        title: "Hər qərarı əsaslandırılmış saxlayın",
        description: "Status dəyişikliklərini, rəy mənbələrini və vətəndaşa göndərilən cavabı tam audit tarixçəsi ilə qoruyun.",
        actionLabel: "Audit xülasəsini yarat",
        outcomeTitle: "Qərar tarixçəsi hazırdır",
        outcome: "Demo müraciətin qəbuldan cavaba qədər bütün addımları vaxt və rol məlumatı ilə xülasələndi.",
        metrics: [
          { label: "Audit hadisəsi", value: "12", detail: "Tam zaman xətti", tone: "info" },
          { label: "SLA uyğunluğu", value: "97,8%", detail: "+1,4 bənd", tone: "positive" },
          { label: "İzahı olmayan dəyişiklik", value: "0", detail: "Tam əsaslandırma", tone: "positive" },
        ],
        records: [
          { title: "Qəbul", meta: "Elektron kanal", value: "12 sent · 09:14", status: "Qeyd edildi", tone: "positive" },
          { title: "Texniki rəy", meta: "Səlahiyyətli rol", value: "14 sent · 15:38", status: "Əlavə edildi", tone: "positive" },
          { title: "Rəsmi cavab", meta: "Təsdiqlənmiş şablon", value: "16 sent · 11:02", status: "Göndərildi", tone: "info" },
        ],
      },
    ],
  },
  {
    id: "media",
    shortTitle: "Media",
    title: "Media monitorinqi",
    summary: "Seçilmiş açıq mənbələrdə brend siqnallarını izləyin, sübutu yoxlayın və cavab işini koordinasiya edin.",
    accent: "rose",
    steps: [
      {
        id: "source-coverage",
        stageLabel: "Əhatə",
        title: "Nəyin həqiqətən izlənildiyini görün",
        description: "Hər açıq mənbə, profil və sorğu pəncərəsi üzrə hazır, məhdud və quraşdırılmamış imkanları dürüst göstərin.",
        actionLabel: "Demo əhatəni yoxla",
        outcomeTitle: "Əhatə vəziyyəti aydındır",
        outcome: "Üç sintetik mənbə hazır, bir mənbə isə provider icazəsi tələb edən məhdud vəziyyətdə göstərildi.",
        metrics: [
          { label: "Seçilmiş mənbə", value: "4", detail: "Yalnız açıq mənbələr", tone: "info" },
          { label: "Hazır", value: "3", detail: "Son yoxlama uğurlu", tone: "positive" },
          { label: "Məhdud", value: "1", detail: "Provider tələb olunur", tone: "attention" },
        ],
        records: [
          { title: "Demo xəbər mənbəsi", meta: "Açıq RSS və məqalə səhifələri", value: "5 dəq əvvəl", status: "Hazır", tone: "positive" },
          { title: "Demo video profili", meta: "Seçilmiş açıq profil", value: "12 dəq əvvəl", status: "Hazır", tone: "positive" },
          { title: "Demo sosial mənbə", meta: "Provider girişi yoxdur", value: "Yoxlanmayıb", status: "Məhdud", tone: "attention" },
        ],
      },
      {
        id: "evidence-review",
        stageLabel: "Sübut",
        title: "Siqnalı mənbə sübutu ilə yoxlayın",
        description: "Başlıq, örtük mətni, transkript və uyğun gələn sözləri ayrı-ayrı mərhələlər kimi nəzərdən keçirin.",
        actionLabel: "Demo sübutu təhlil et",
        outcomeTitle: "Uyğunluq əsaslandırıldı",
        outcome: "Sintetik materialda monitorinq termini örtük mətnində və transkriptdə tapıldı; mənbə linki qorundu.",
        metrics: [
          { label: "Tapılan siqnal", value: "2", detail: "Örtük + transkript", tone: "info" },
          { label: "Uyğunluq", value: "94%", detail: "Dəqiq termin tapılıb", tone: "positive" },
          { label: "Bloklanan mərhələ", value: "0", detail: "Sübut tamdır", tone: "positive" },
        ],
        records: [
          { title: "Örtük OCR", meta: "Demo brend termini tapıldı", value: "1 uyğunluq", status: "Tamam", tone: "positive" },
          { title: "Transkript", meta: "Termin 00:18-də səslənir", value: "1 uyğunluq", status: "Tamam", tone: "positive" },
          { title: "Kadr OCR", meta: "Əlavə mətn tapılmadı", value: "0 uyğunluq", status: "Tamam", tone: "neutral" },
        ],
      },
      {
        id: "response-workflow",
        stageLabel: "Reaksiya",
        title: "Tapıntını idarə olunan işə çevirin",
        description: "Risk səviyyəsini təyin edin, hüquq və kommunikasiya komandalarına tapşırıq verin, qərarı auditlə qoruyun.",
        actionLabel: "Demo cavab işi yarat",
        outcomeTitle: "Cavab işi koordinasiya edildi",
        outcome: "Orta riskli sintetik tapıntı kommunikasiya baxışına göndərildi və 4 saatlıq cavab SLA-sı başladı.",
        metrics: [
          { label: "Açıq tapıntı", value: "8", detail: "2 orta risk", tone: "info" },
          { label: "İlk baxış", value: "22 dəq", detail: "Hədəfdən 8 dəq tez", tone: "positive" },
          { label: "SLA riski", value: "1", detail: "Rəhbər xəbərdar edilib", tone: "attention" },
        ],
        records: [
          { title: "Demo Tapıntı #MD-082", meta: "Kommunikasiya baxışı", value: "4 saat SLA", status: "İcrada", tone: "info" },
          { title: "Demo Tapıntı #MD-079", meta: "Sübut qeyri-kafidir", value: "Əlavə yoxlama", status: "Gözləyir", tone: "attention" },
          { title: "Demo Tapıntı #MD-074", meta: "Cavab tələb olunmadı", value: "Qərar qeydli", status: "Bağlı", tone: "positive" },
        ],
      },
    ],
  },
  {
    id: "energy",
    shortTitle: "Enerji",
    title: "Enerji və kommunal xidmətlər",
    summary: "Aktivləri, kəsintiləri və istehlak məlumatlarını xidmət prosesləri ilə əlaqəli idarə edin.",
    accent: "amber",
    steps: [
      {
        id: "asset-health",
        stageLabel: "Aktivlər",
        title: "Şəbəkə aktivlərinin vəziyyətini izləyin",
        description: "Yoxlama tarixini, risk siqnalını və planlı texniki xidməti hər aktiv üzrə vahid görünüşdə saxlayın.",
        actionLabel: "Riskli aktivləri göstər",
        outcomeTitle: "Baxış siyahısı hazırdır",
        outcome: "Risk balı yüksələn üç sintetik aktiv növbəti texniki xidmət planına əlavə edildi.",
        metrics: [
          { label: "İzlənən aktiv", value: "1 284", detail: "6 aktiv kateqoriyası", tone: "info" },
          { label: "Sağlamlıq", value: "91/100", detail: "+2 bal", tone: "positive" },
          { label: "Yüksək risk", value: "3", detail: "Planlı baxış tələb edir", tone: "attention" },
        ],
        records: [
          { title: "Demo Aktiv #EN-208", meta: "Transformator · son baxış 28 gün", value: "72/100", status: "Baxış", tone: "attention" },
          { title: "Demo Aktiv #EN-184", meta: "Paylayıcı xətt · normal yük", value: "94/100", status: "Sağlam", tone: "positive" },
          { title: "Demo Aktiv #EN-166", meta: "Sayğac qovşağı · yeni servis", value: "98/100", status: "Sağlam", tone: "positive" },
        ],
      },
      {
        id: "outage-response",
        stageLabel: "Kəsinti",
        title: "Kəsinti cavabını koordinasiya edin",
        description: "Təsir zonasını, sahə briqadasını və müştəri bildirişlərini bir operativ iş axınında birləşdirin.",
        actionLabel: "Demo cavab planını başlat",
        outcomeTitle: "Bərpa işi başladıldı",
        outcome: "Sintetik kəsinti üçün yaxın briqada təyin edildi və 184 demo abonentə status bildirişi hazırlandı.",
        metrics: [
          { label: "Təsirlənən abonent", value: "184", detail: "Demo zona A", tone: "attention" },
          { label: "Briqada çatma vaxtı", value: "18 dəq", detail: "SLA daxilində", tone: "positive" },
          { label: "Təxmini bərpa", value: "42 dəq", detail: "İlkin qiymətləndirmə", tone: "info" },
        ],
        records: [
          { title: "Hadisə #EN-OUT-42", meta: "Demo zona A · 09:12", value: "Orta təsir", status: "Aktiv", tone: "attention" },
          { title: "Sahə briqadası #B-06", meta: "6,4 km məsafədə", value: "18 dəq", status: "Yoldadır", tone: "info" },
          { title: "Müştəri bildirişi", meta: "SMS və portal", value: "184 qəbul edən", status: "Hazır", tone: "positive" },
        ],
      },
      {
        id: "consumption-insight",
        stageLabel: "İstehlak",
        title: "İstehlak anomaliyasını erkən görün",
        description: "Tarixi profil ilə cari istehlakı müqayisə edin və qeyri-adi dəyişiklikləri yoxlama üçün qeyd edin.",
        actionLabel: "Anomaliyaları yoxla",
        outcomeTitle: "Qeyri-adi dəyişiklik aşkarlandı",
        outcome: "İki sintetik hesab üzrə mövsümi normadan yüksək istehlak aşkarlandı və yoxlama işi yaradıldı.",
        metrics: [
          { label: "Analiz edilən hesab", value: "8 420", detail: "Son 24 saat", tone: "info" },
          { label: "Anomaliya", value: "2", detail: "0,02% hesab", tone: "attention" },
          { label: "Təsdiqli ölçüm", value: "99,6%", detail: "Keyfiyyət yoxlaması", tone: "positive" },
        ],
        records: [
          { title: "Demo Hesab #UT-884", meta: "Tarixi profildən +38%", value: "1 248 kVt·s", status: "Yoxlama", tone: "attention" },
          { title: "Demo Hesab #UT-901", meta: "Tarixi profildən +29%", value: "984 kVt·s", status: "Yoxlama", tone: "attention" },
          { title: "Demo Hesab #UT-916", meta: "Mövsümi diapazonda", value: "612 kVt·s", status: "Normal", tone: "positive" },
        ],
      },
    ],
  },
  {
    id: "settings",
    shortTitle: "Ayarlar",
    title: "Sistem ayarları və idarəetmə",
    summary: "Rolları, iş axınlarını və audit siyasətlərini mərkəzləşdirilmiş, idarə olunan şəkildə konfiqurasiya edin.",
    accent: "blue",
    steps: [
      {
        id: "role-access",
        stageLabel: "Giriş nəzarəti",
        title: "Hər rola yalnız lazım olan girişi verin",
        description: "Modul və əməl səviyyəsində icazələri rol üzrə müəyyənləşdirin, dəyişiklikdən əvvəl təsiri görün.",
        actionLabel: "Demo rolu yoxla",
        outcomeTitle: "Giriş siyasəti təsdiqləndi",
        outcome: "Demo “Satış meneceri” rolunun maliyyə ixracına çıxışı olmadığı və satış əməliyyatları ilə məhdudlaşdığı yoxlanıldı.",
        metrics: [
          { label: "Aktiv rol", value: "8", detail: "Standart + xüsusi", tone: "info" },
          { label: "İcazə qaydası", value: "46", detail: "Əməl səviyyəsində", tone: "neutral" },
          { label: "Riskli kombinasiya", value: "0", detail: "Toqquşma tapılmadı", tone: "positive" },
        ],
        records: [
          { title: "Satış meneceri", meta: "CRM və satış əməliyyatları", value: "14 icazə", status: "Aktiv", tone: "positive" },
          { title: "Maliyyə analitiki", meta: "Maliyyə və hesabat oxuma", value: "11 icazə", status: "Aktiv", tone: "positive" },
          { title: "Məhdud operator", meta: "Yalnız təyin olunan qeydlər", value: "6 icazə", status: "Məhdud", tone: "info" },
        ],
      },
      {
        id: "workflow-builder",
        stageLabel: "Avtomatlaşdırma",
        title: "Kod yazmadan idarə olunan iş axını qurun",
        description: "Başlanğıc şərtini, yoxlamaları və məsul addımları vizual ardıcıllıqla yaradın.",
        actionLabel: "Demo axınını sına",
        outcomeTitle: "Sınaq uğurla tamamlandı",
        outcome: "Yüksək məbləğli demo endirimi satış rəhbəri və maliyyə təsdiqindən ardıcıl keçdi.",
        metrics: [
          { label: "Aktiv iş axını", value: "12", detail: "5 modul üzrə", tone: "info" },
          { label: "Aylıq icra", value: "3 842", detail: "99,7% uğurlu", tone: "positive" },
          { label: "Əl işi qənaəti", value: "74 saat", detail: "Demo hesablaması", tone: "positive" },
        ],
        records: [
          { title: "Endirim təsdiqi", meta: "Endirim >10% olduqda", value: "2 mərhələ", status: "Aktiv", tone: "positive" },
          { title: "SLA eskalasiyası", meta: "Vaxtın 80%-i keçdikdə", value: "1 mərhələ", status: "Aktiv", tone: "positive" },
          { title: "Müqavilə yenilənməsi", meta: "Bitməyə 90 gün qaldıqda", value: "4 mərhələ", status: "Aktiv", tone: "info" },
        ],
      },
      {
        id: "audit-governance",
        stageLabel: "Audit",
        title: "Kritik dəyişiklikləri sübutla qoruyun",
        description: "Kim, nəyi, nə vaxt və hansı səbəblə dəyişib sualına tam tarixçə ilə cavab verin.",
        actionLabel: "Demo auditini filtrlə",
        outcomeTitle: "Audit izi hazırdır",
        outcome: "Son 24 saatdakı üç yüksək təsirli demo dəyişiklik istifadəçi rolu və əvvəlki dəyərlə göstərildi.",
        metrics: [
          { label: "Audit hadisəsi", value: "1 284", detail: "Son 30 gün", tone: "info" },
          { label: "Yüksək təsir", value: "3", detail: "Hamısı əsaslandırılıb", tone: "attention" },
          { label: "Saxlanma", value: "365 gün", detail: "Demo siyasəti", tone: "neutral" },
        ],
        records: [
          { title: "Rol icazəsi dəyişdi", meta: "Əvvəlki və yeni dəyər saxlanılıb", value: "Bu gün 11:08", status: "Əsaslandırılıb", tone: "positive" },
          { title: "İş axını yayımlandı", meta: "Versiya 7 → 8", value: "Bu gün 09:42", status: "Təsdiqli", tone: "positive" },
          { title: "İxrac cəhdi bloklandı", meta: "Məhdud rol", value: "Dünən 17:26", status: "Qorundu", tone: "info" },
        ],
      },
    ],
  },
  {
    id: "ai",
    shortTitle: "Da Vinci AI",
    title: "Da Vinci süni intellekt köməkçisi",
    summary: "Komandaya izah edilə bilən tövsiyələr verin, amma kritik əməliyyatları insan təsdiqində saxlayın.",
    accent: "violet",
    steps: [
      {
        id: "lead-scoring",
        stageLabel: "Prioritetləşdirmə",
        title: "Ən perspektivli imkanları izahla seçin",
        description: "Fəaliyyət, uyğunluq və satış siqnallarını birləşdirin; balın səbəbini satış əməkdaşına açıq göstərin.",
        actionLabel: "Demo imkanları qiymətləndir",
        outcomeTitle: "Prioritet siyahısı hazırdır",
        outcome: "Üç sintetik imkan yüksək niyyət və uyğunluq siqnallarına görə önə çəkildi; hər balın səbəbi göstərildi.",
        metrics: [
          { label: "Qiymətləndirilən", value: "126", detail: "Son 24 saat", tone: "info" },
          { label: "Yüksək bal", value: "14", detail: "80 baldan yuxarı", tone: "positive" },
          { label: "İzah əhatəsi", value: "100%", detail: "Hər tövsiyəyə səbəb", tone: "positive" },
        ],
        records: [
          { title: "Demo İmkan #AI-104", meta: "Təkrar baxış + qərarverici aktivliyi", value: "92/100", status: "Yüksək", tone: "positive" },
          { title: "Demo İmkan #AI-098", meta: "Uyğun sektor + qiymət sorğusu", value: "87/100", status: "Yüksək", tone: "positive" },
          { title: "Demo İmkan #AI-091", meta: "Məzmun aktivliyi, qərar siqnalı zəif", value: "68/100", status: "Orta", tone: "info" },
        ],
      },
      {
        id: "next-best-action",
        stageLabel: "Tövsiyə",
        title: "Növbəti addımı kontekstlə təklif edin",
        description: "Açıq işləri və münasibət tarixçəsini nəzərə alaraq konkret, icra oluna bilən addım hazırlayın.",
        actionLabel: "Növbəti addımı hazırla",
        outcomeTitle: "Tövsiyə yaradıldı",
        outcome: "Demo hesab üçün qərarvericiyə qısa follow-up və texniki sualları cavablandırmaq tövsiyə edildi.",
        metrics: [
          { label: "Hazır tövsiyə", value: "18", detail: "Komanda növbəsində", tone: "info" },
          { label: "Qəbul nisbəti", value: "64%", detail: "+9 bənd", tone: "positive" },
          { label: "Orta qənaət", value: "11 dəq", detail: "Hər fəaliyyətə", tone: "positive" },
        ],
        records: [
          { title: "Follow-up e-poçtu", meta: "Qərarverici son təklifə baxıb", value: "Bu gün", status: "Tövsiyə", tone: "positive" },
          { title: "Texniki cavab", meta: "2 açıq sual qalıb", value: "30 dəq", status: "Sonrakı", tone: "info" },
          { title: "Endirim təklifi", meta: "Hələ qiymət etirazı yoxdur", value: "Tövsiyə deyil", status: "Dayandırılıb", tone: "neutral" },
        ],
      },
      {
        id: "human-approval",
        stageLabel: "Nəzarət",
        title: "Kritik əməliyyatı insan təsdiqində saxlayın",
        description: "AI layihəni hazırlayır, səlahiyyətli əməkdaş isə alıcı, məzmun və təsiri yoxladıqdan sonra icazə verir.",
        actionLabel: "Demo təsdiqini yoxla",
        outcomeTitle: "Təhlükəsiz təsdiq tamamlandı",
        outcome: "Sintetik e-poçt layihəsi alıcı və məzmun yoxlamasından keçdi; göndəriş bu demoda icra edilmir.",
        metrics: [
          { label: "Gözləyən təsdiq", value: "4", detail: "2 yüksək təsir", tone: "attention" },
          { label: "Orta baxış", value: "6 dəq", detail: "Tam audit izi", tone: "info" },
          { label: "Avtomatik göndəriş", value: "0", detail: "İnsan təsdiqi məcburidir", tone: "positive" },
        ],
        records: [
          { title: "Demo e-poçt layihəsi", meta: "Xarici alıcı · məzmun baxışı", value: "1 təsdiq", status: "Hazır", tone: "positive" },
          { title: "Məlumat ixracı", meta: "Həssas sahələr daxildir", value: "2 təsdiq", status: "Gözləyir", tone: "attention" },
          { title: "Kütləvi yeniləmə", meta: "126 sintetik qeyd", value: "Admin təsdiqi", status: "Məhdud", tone: "info" },
        ],
      },
    ],
  },
  {
    id: "voip",
    shortTitle: "VoIP",
    title: "Bulud telefoniya",
    summary: "Zəngləri müştəri konteksti ilə qarşılayın, nəticəni qeyd edin və xidmət keyfiyyətini ölçün.",
    accent: "emerald",
    steps: [
      {
        id: "incoming-call",
        stageLabel: "Gələn zəng",
        title: "Zəngi tam müştəri konteksti ilə qarşılayın",
        description: "Nömrə uyğunlaşdıqda CRM profili, açıq işlər və son əlaqə operatora avtomatik göstərilir.",
        actionLabel: "Demo zəngi qəbul et",
        outcomeTitle: "Müştəri konteksti açıldı",
        outcome: "Sintetik zəng Demo Hesab B ilə uyğunlaşdırıldı və operatora iki açıq iş göstərildi.",
        metrics: [
          { label: "Növbədə", value: "3 zəng", detail: "Ən uzun gözləmə 42 san", tone: "info" },
          { label: "Nömrə uyğunluğu", value: "94%", detail: "CRM profili tapılıb", tone: "positive" },
          { label: "Cavab müddəti", value: "18 san", detail: "Hədəfdən 12 san tez", tone: "positive" },
        ],
        records: [
          { title: "+994 00 000 00 01", meta: "Tamamilə sintetik nömrə", value: "Demo Hesab B", status: "Uyğunlaşdı", tone: "positive" },
          { title: "Açıq ticket #SP-3108", meta: "İnteqrasiya bağlantısı", value: "Yüksək", status: "Kontekst", tone: "attention" },
          { title: "Son əlaqə", meta: "E-poçt cavabı", value: "2 saat əvvəl", status: "Kontekst", tone: "info" },
        ],
      },
      {
        id: "call-disposition",
        stageLabel: "Zəng nəticəsi",
        title: "Zəng nəticəsini bir toxunuşla qeyd edin",
        description: "Standart nəticə kodu, qeyd və follow-up tapşırığı ilə CRM tarixçəsini avtomatik tamamlayın.",
        actionLabel: "Demo nəticəni qeyd et",
        outcomeTitle: "Zəng nəticəsi saxlanıldı",
        outcome: "Demo zəng “Texniki follow-up” kimi qeyd edildi və sabah üçün məsul tapşırıq yaradıldı.",
        metrics: [
          { label: "Zəng müddəti", value: "06:24", detail: "Demo sessiyası", tone: "neutral" },
          { label: "Nəticə", value: "Follow-up", detail: "Texniki komanda", tone: "info" },
          { label: "Növbəti iş", value: "Sabah", detail: "Sahibi təyin edilib", tone: "positive" },
        ],
        records: [
          { title: "Nəticə kodu", meta: "Standart siyahıdan seçilib", value: "Texniki follow-up", status: "Qeyd edildi", tone: "positive" },
          { title: "Zəng qeydi", meta: "Həssas məlumat daxil deyil", value: "148 simvol", status: "Saxlanıldı", tone: "positive" },
          { title: "Follow-up tapşırığı", meta: "Texniki komanda", value: "Sabah 10:00", status: "Yaradıldı", tone: "info" },
        ],
      },
      {
        id: "call-quality",
        stageLabel: "Keyfiyyət",
        title: "Zəng performansını komanda üzrə ölçün",
        description: "Cavab sürəti, buraxılmış zəng və nəticə keyfiyyətini növbə və vaxt intervalı üzrə müqayisə edin.",
        actionLabel: "Keyfiyyət icmalını aç",
        outcomeTitle: "Keyfiyyət siqnalı tapıldı",
        outcome: "Demo analiz nahar intervalında buraxılmış zəng nisbətinin artdığını göstərdi və növbə düzəlişi təklif etdi.",
        metrics: [
          { label: "Cavablanan", value: "93,6%", detail: "+2,8 bənd", tone: "positive" },
          { label: "Buraxılmış", value: "6,4%", detail: "Hədəf ≤5%", tone: "attention" },
          { label: "Orta danışıq", value: "5s 18d", detail: "Normal diapazon", tone: "info" },
        ],
        records: [
          { title: "09:00–12:00", meta: "86 demo zəng", value: "96% cavab", status: "Güclü", tone: "positive" },
          { title: "12:00–14:00", meta: "42 demo zəng", value: "88% cavab", status: "Diqqət", tone: "attention" },
          { title: "14:00–18:00", meta: "104 demo zəng", value: "94% cavab", status: "Sabit", tone: "info" },
        ],
      },
    ],
  },
  {
    id: "sms-otp",
    shortTitle: "SMS OTP",
    title: "SMS ilə birdəfəlik kod",
    summary: "Həssas giriş və əməliyyatları qısaömürlü, tək istifadəli SMS kodu və audit izi ilə qoruyun.",
    accent: "orange",
    steps: [
      {
        id: "otp-policy",
        stageLabel: "Siyasət",
        title: "OTP tələb olunan halları dəqiq seçin",
        description: "Rol, risk və əməliyyat növünə görə ikinci təsdiqi məcburi edin; adi işi lazımsız yerə ləngitməyin.",
        actionLabel: "Demo siyasəti qiymətləndir",
        outcomeTitle: "Əlavə təsdiq tələb olunur",
        outcome: "Sintetik yeni cihaz girişi risk qaydasına uyğun olaraq SMS OTP mərhələsinə yönləndirildi.",
        metrics: [
          { label: "Aktiv qayda", value: "4", detail: "Giriş və kritik əməliyyat", tone: "info" },
          { label: "Riskli cəhd", value: "3", detail: "Son 24 saat", tone: "attention" },
          { label: "Qorunan əməliyyat", value: "100%", detail: "Qayda əhatəsində", tone: "positive" },
        ],
        records: [
          { title: "Yeni cihaz girişi", meta: "Tanınmayan cihaz izi", value: "OTP tələb et", status: "Aktiv", tone: "positive" },
          { title: "Həssas ixrac", meta: "500+ qeyd olduqda", value: "OTP tələb et", status: "Aktiv", tone: "positive" },
          { title: "Adi profil baxışı", meta: "Aşağı riskli əməliyyat", value: "OTP tələb deyil", status: "Standart", tone: "neutral" },
        ],
      },
      {
        id: "otp-challenge",
        stageLabel: "Təsdiq",
        title: "Qısaömürlü kodla istifadəçini yoxlayın",
        description: "Kodun müddətini və cəhd sayını məhdudlaşdırın; telefon nömrəsini interfeysdə maskalayın.",
        actionLabel: "Demo kodu yoxla",
        outcomeTitle: "Kod birdəfəlik təsdiqləndi",
        outcome: "Yalnız demo üçün yaradılmış maskalı nömrəyə aid sintetik kod müddət daxilində qəbul edildi və dərhal etibarsızlaşdı.",
        metrics: [
          { label: "Kod müddəti", value: "10 dəq", detail: "Qısaömürlü", tone: "info" },
          { label: "Qalan cəhd", value: "4", detail: "Maksimum 5", tone: "neutral" },
          { label: "Təkrar istifadə", value: "Bloklu", detail: "Tək istifadəli", tone: "positive" },
        ],
        records: [
          { title: "Qəbul edən", meta: "+994 •• ••• •• 01 · sintetik", value: "Maskalanıb", status: "Qorunur", tone: "positive" },
          { title: "Demo challenge", meta: "Yeni cihaz girişi", value: "6 rəqəm", status: "Yoxlanıldı", tone: "positive" },
          { title: "Kod vəziyyəti", meta: "Uğurlu istifadədən sonra", value: "Etibarsız", status: "İstifadə edildi", tone: "info" },
        ],
      },
      {
        id: "otp-audit",
        stageLabel: "Audit",
        title: "Təsdiq cəhdlərini təhlükəsiz izləyin",
        description: "Kodun özünü saxlamadan göndəriş, uğur, bloklama və müddət bitməsi hadisələrini araşdırın.",
        actionLabel: "Demo auditini aç",
        outcomeTitle: "Təsdiq tarixçəsi hazırdır",
        outcome: "Son demo challenge üzrə göndəriş və uğurlu təsdiq hadisələri göstərildi; kod dəyəri heç yerdə açıqlanmadı.",
        metrics: [
          { label: "Təsdiq uğuru", value: "98,2%", detail: "Demo dövrü", tone: "positive" },
          { label: "Bloklanan cəhd", value: "7", detail: "Limit aşımı", tone: "attention" },
          { label: "Kod dəyəri", value: "Saxlanmır", detail: "Yalnız təhlükəsiz hash", tone: "positive" },
        ],
        records: [
          { title: "Challenge yaradıldı", meta: "Yeni cihaz girişi", value: "10:14:02", status: "Qeyd edildi", tone: "info" },
          { title: "SMS çatdırıldı", meta: "Provider statusu", value: "10:14:05", status: "Çatdı", tone: "positive" },
          { title: "Kod təsdiqləndi", meta: "1-ci cəhd", value: "10:14:41", status: "Uğurlu", tone: "positive" },
        ],
      },
    ],
  },
] as const satisfies readonly DemoModuleManifest[]

const DEMO_MODULE_ID_SET: ReadonlySet<string> = new Set(DEMO_MODULE_IDS)

export function isDemoModuleId(value: string): value is DemoModuleId {
  return DEMO_MODULE_ID_SET.has(value)
}

export function getDemoModules(moduleIds: readonly string[]): DemoModuleManifest[] {
  const seen = new Set<DemoModuleId>()
  const result: DemoModuleManifest[] = []

  for (const value of moduleIds) {
    if (!isDemoModuleId(value) || seen.has(value)) continue

    const demoModule = DEMO_MODULE_CATALOG.find((item) => item.id === value)
    if (!demoModule) continue

    seen.add(value)
    result.push(demoModule)
  }

  return result
}
