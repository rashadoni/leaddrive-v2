import {
  BarChart3, Users, TrendingUp, Zap, Mail, MessageSquare,
  Shield, Brain, DollarSign, Calculator, FileText, Target,
  Headphones, Globe, PieChart, Building2, UserCheck, Settings,
  Inbox, Bot, LineChart, Receipt, Briefcase, LayoutDashboard,
  Megaphone, Route, CalendarDays, Star, Gauge, BookOpen,
} from "lucide-react"

/* ────────────────────── STATS ────────────────────── */
export const stats = [
  { value: 128, label: "Funksiya", suffix: "+" },
  { value: 16, label: "Da Vinci inteqrasiya", suffix: "" },
  { value: 7, label: "Kommunikasiya kanalı", suffix: "" },
  { value: 500, label: "İstifadəçi şirkət", suffix: "+" },
]

/* ────────────────────── PAIN / SOLUTION ────────────────────── */
// Visual metadata only — title + description are translated via
// `marketing.problemSolution.p{N}_title/_description` and
// `marketing.problemSolution.s{N}_title/_description` in messages/{az,en,ru}.json.
// Array order MUST stay in sync with the locale keys (p1/p2/p3, s1/s2/s3).
export const painPoints = [
  { icon: Settings },
  { icon: DollarSign },
  { icon: FileText },
]

export const solutions = [
  { icon: LayoutDashboard },
  { icon: PieChart },
  { icon: Brain },
]

/* ────────────────────── MODULE SHOWCASE ────────────────────── */
export type ModuleGroup = {
  id: string
  title: string
  icon: typeof BarChart3
  description: string
  features: string[]
  screenshot: string
}

export const moduleGroups: ModuleGroup[] = [
  {
    id: "crm",
    title: "CRM",
    icon: Users,
    description: "Liddən sövdələşmənin bağlanmasına qədər tam satış dövrü idarəsi. Pipeline vizuallaşdırması, sövdələşmə izləməsi və Da Vinci ilə lid skorinqi.",
    features: ["İdarə paneli və KPI-lər", "Şirkətlər və Kontaktlar", "Sövdələşmələr və Pipeline", "Lidlər və Skorinq", "Da Vinci Satış Köməkçisi", "Tapşırıqlar və Təqvim", "Müqavilələr və Fakturalar", "Məhsul kataloqu"],
    screenshot: "/marketing/crm-dashboard.png",
  },
  {
    id: "marketing",
    title: "Marketinq",
    icon: Megaphone,
    description: "Çoxkanallı kampaniya avtomatlaşdırması: marşrut qurucusu, e-poçt ardıcıllıqları və ROI izləməsi.",
    features: ["Kampaniya meneceri", "E-poçt şablonları", "Marşrut qurucusu", "Seqmentlər", "Tədbirlər", "Da Vinci Skorinq", "Da Vinci Kopyraytinq", "Kampaniya ROI"],
    screenshot: "/marketing/marketing-campaigns.png",
  },
  {
    id: "communication",
    title: "Rabitə",
    icon: MessageSquare,
    description: "7 mesajlaşma kanalı bir vahid gələn qutusunda. E-poçt, SMS, Telegram, WhatsApp, Facebook, Instagram, VK.",
    features: ["Vahid gələn qutusu", "E-poçt", "SMS", "Telegram", "WhatsApp", "Facebook və Instagram", "VKontakte"],
    screenshot: "/marketing/inbox-channels.png",
  },
  {
    id: "support",
    title: "Dəstək",
    icon: Headphones,
    description: "SLA tətbiqi, agent iş masası, bilik bazası və müştəri özünə-xidmət portalı ilə tam helpdesk.",
    features: ["Tiket idarəsi", "SLA siyasətləri", "Agent iş masası", "Bilik bazası", "Müştəri portalı", "Portal chat"],
    screenshot: "/marketing/support-tickets.png",
  },
  {
    id: "analytics",
    title: "Analitika",
    icon: LineChart,
    description: "Gəlirlilik mühərriki, büdcələşdirmə və P&L, maliyyə idarəsi, dinamik qiymətləndirmə və Da Vinci hesabatları.",
    features: ["Xərc modeli mühərriki", "Büdcələşdirmə və P&L", "Maliyyə (Debitor, Kreditor, Fondlar)", "Dinamik qiymətləndirmə", "Hesabatlar", "Da Vinci təhlilləri"],
    screenshot: "/marketing/analytics-profitability.png",
  },
  {
    id: "erp",
    title: "ERP",
    icon: Briefcase,
    description: "Mərhələlər, komanda izləməsi, büdcə bölgüsü və tamamlanma analitikası ilə layihə idarəsi.",
    features: ["Layihələr", "Mərhələlər", "Komanda üzvləri", "Büdcə izləməsi", "Tamamlanma %"],
    screenshot: "/marketing/erp-projects.png",
  },
  {
    id: "settings",
    title: "Platforma",
    icon: Settings,
    description: "Korporativ səviyyəli konfiqurasiya: rollar, iş axınları, xüsusi sahələr, audit jurnalları və çox-kirayəçili SaaS arxitekturası.",
    features: ["İstifadəçilər və Rollar", "İş axınları", "Xüsusi sahələr", "Valyutalar", "Audit jurnalı", "Web-to-Lead", "API və Webhooklar"],
    screenshot: "/marketing/platform-settings.png",
  },
]

/* ────────────────────── UNIQUE ADVANTAGES ────────────────────── */
// Visual metadata only — title + description are translated via
// `marketing.advantages.a${N}_title/_description` in messages/{az,en,ru}.json.
// Array order MUST stay in sync with the locale keys (a1, a2, a3, a4).
// Architect M1-5b.6 follow-up: dropping the AZ duplicates here removes
// the two-sources-of-truth foot-gun for the next migration touch.
export const advantages = [
  { icon: Calculator, color: "#F97316", href: "/features/analytics" },
  { icon: Bot,        color: "#7c3aed", href: "/features/ai" },
  { icon: Inbox,      color: "#f59e0b", href: "/features/inbox" },
  { icon: Receipt,    color: "#ef4444", href: "/features/analytics" },
]

/* ────────────────────── PRICING PLANS ────────────────────── */
export type PlanTier = {
  id: string
  name: string
  tagline: string
  popular?: boolean
  features: string[]
  /** Total monthly cost in AZN (null = negotiable) */
  price: number | null
  /** Effective per-user price in AZN (null = negotiable) */
  pricePerUser: number | null
  /** Per-user price with annual billing (10% off, null = negotiable) */
  pricePerUserAnnual: number | null
  /** Max users included */
  maxUsers: number | null
}

export const plans: PlanTier[] = [
  {
    id: "starter",
    name: "Starter",
    tagline: "Kiçik komandalar üçün başlanğıc",
    price: 550,
    pricePerUser: 110,
    pricePerUserAnnual: 99,
    maxUsers: 5,
    features: [
      "companies_contacts",
      "deals_pipeline",
      "leads_scoring",
      "tasks_calendar",
      "product_catalog",
      "up_to_5",
    ],
  },
  {
    id: "business",
    name: "Business",
    tagline: "Böyüyən satış komandaları üçün",
    price: 990,
    pricePerUser: 99,
    pricePerUserAnnual: 89,
    maxUsers: 10,
    features: [
      "all_starter",
      "tickets_sla",
      "knowledge_base",
      "contracts",
      "agent_desktop",
      "roles_permissions",
      "up_to_10",
    ],
  },
  {
    id: "professional",
    name: "Professional",
    tagline: "Marketinq və satış komandaları üçün",
    popular: true,
    price: 2200,
    pricePerUser: 88,
    pricePerUserAnnual: 79,
    maxUsers: 25,
    features: [
      "all_business",
      "campaign_automation",
      "journey_builder",
      "invoices_recurring",
      "email_templates",
      "events_segments",
      "davinci_scoring",
      "projects_erp",
      "reports",
      "up_to_25",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "Məlumata əsaslanan təşkilatlar üçün",
    price: 3850,
    pricePerUser: 77,
    pricePerUserAnnual: 69,
    maxUsers: 50,
    features: [
      "all_professional",
      "cost_model",
      "budgeting_pl",
      "finance",
      "dynamic_pricing",
      "inbox_7ch",
      "davinci_center",
      "customer_portal",
      "custom_fields_workflows",
      "audit_log",
      "up_to_50",
    ],
  },
  {
    id: "custom",
    name: "Enterprise 50+",
    tagline: "50+ istifadəçi üçün fərdi həll",
    price: null,
    pricePerUser: null,
    pricePerUserAnnual: null,
    maxUsers: null,
    features: [
      "all_enterprise",
      "custom_pricing",
      "dedicated_support",
      "sla_priority",
      "unlimited_users",
    ],
  },
]

/* ────────────────────── TESTIMONIALS ────────────────────── */
export const testimonials = [
  {
    quote: "LeadDrive nəhayət bizə hansı müştərilərin gəlirli, hansıların isə resurslarımızı tükətdiyini göstərdi. Konsaltinq firmamız üçün dönüş nöqtəsi oldu.",
    name: "Elvin Məmmədov",
    title: "Baş Direktor",
    company: "AzərTech Həlləri",
    rating: 5,
  },
  {
    quote: "7 kanallı gələn qutusu bizi WhatsApp, Telegram və e-poçtu ayrı-ayrı idarə etməkdən xilas etdi. Cavab müddətimiz 60% azaldı.",
    name: "Aysəl Həsənova",
    title: "Dəstək rəhbəri",
    company: "BulutKöprü IT",
    rating: 5,
  },
  {
    quote: "Salesforce + HubSpot + P&L izləmə üçün cədvəli bir platforma ilə əvəz etdik. Bir platforma, bir həqiqət mənbəyi.",
    name: "Rüstəm Əliyev",
    title: "Əməliyyat Direktoru",
    company: "DataAxın Agentliyi",
    rating: 5,
  },
  {
    quote: "Da Vinci agenti dəstək tiketlərimizin 40%-ni avtomatik idarə edir. Xərc modeli isə marjalarımızın tam harada olduğunu göstərir.",
    name: "Nigar Kərimova",
    title: "Əməliyyat Meneceri",
    company: "İnnovasiya MSP",
    rating: 5,
  },
  {
    quote: "P&L izləməli büdcələmə modulu — bizə hər zaman lazım olan bu idi. Maliyyə analizi üçün artıq Excel-ə ixrac yoxdur.",
    name: "Fərid Hüseynov",
    title: "Maliyyə Direktoru",
    company: "YaşılTex Xidmətlər",
    rating: 4,
  },
  {
    quote: "Faktura xatırlatmaları üçün marşrut qurucusu gecikmiş ödənişlərimizi 45% azaltdı. Avtomatik təqiblər həqiqətən işləyir.",
    name: "Leyla İbrahimova",
    title: "Maliyyə Meneceri",
    company: "Nexus Konsaltinq",
    rating: 5,
  },
]

/* ────────────────────── FEATURE CARDS (Bento Grid) ────────────────────── */
export type FeatureCard = {
  id: string
  title: string
  description: string
  icon: typeof BarChart3
  features: string[]
  colSpan?: number
}

export const featureCards: FeatureCard[] = [
  {
    id: "crm",
    title: "CRM & Satış",
    description: "Liddən sövdələşmənin bağlanmasına qədər tam satış dövrü. Pipeline, skorinq və tapşırıqlar.",
    icon: Users,
    features: ["Pipeline vizuallaşdırması", "Lid skorinqi (A–F)", "Sövdələşmə izləməsi", "Tapşırıqlar və Təqvim"],
    colSpan: 2,
  },
  {
    id: "marketing",
    title: "Marketinq",
    description: "Kampaniya avtomatlaşdırması, e-poçt ardıcıllıqları və ROI izləməsi.",
    icon: Megaphone,
    features: ["Kampaniya meneceri", "E-poçt şablonları", "Marşrut qurucusu", "Seqmentasiya"],
    colSpan: 1,
  },
  {
    id: "inbox",
    title: "7-Kanal Gələn Qutusu",
    description: "E-poçt, SMS, Telegram, WhatsApp, Facebook, Instagram, VK — vahid qutu.",
    icon: Inbox,
    features: ["Vahid gələn qutusu", "Real-vaxt mesajlaşma", "Da Vinci cavablar"],
    colSpan: 1,
  },
  {
    id: "support",
    title: "Dəstək",
    description: "SLA, tiketlər, bilik bazası və müştəri özünə-xidmət portalı.",
    icon: Headphones,
    features: ["Tiket idarəsi", "SLA siyasətləri", "Bilik bazası"],
    colSpan: 1,
  },
  {
    id: "finance",
    title: "Maliyyə & Analitika",
    description: "Xərc modeli, büdcələşdirmə, P&L və gəlirlilik analizi.",
    icon: LineChart,
    features: ["Xərc modeli mühərriki", "Büdcələşdirmə & P&L", "Dinamik qiymətləndirmə"],
    colSpan: 1,
  },
  {
    id: "ai",
    title: "Da Vinci",
    description: "Daxili Da Vinci: hiss təhlili, lid skorinqi, e-poçt yaratma, avtomatik cavablar və analitika.",
    icon: Bot,
    features: ["Da Vinci lid skorinqi", "Da Vinci e-poçt generasiyası", "Da Vinci müştəri xidməti", "Da Vinci analitika"],
    colSpan: 3,
  },
]

/* ────────────────────── Da Vinci CAPABILITIES ────────────────────── */
export const aiCapabilities = [
  { title: "Avtomatik cavablar", description: "WhatsApp, Telegram və E-poçtda müştəri sorğularına Da Vinci cavab", icon: MessageSquare },
  { title: "Lid skorinqi", description: "Avtomatik A–F dərəcələndirmə və kvalifikasiya", icon: Target },
  { title: "E-poçt generasiyası", description: "Peşəkar mesaj və təklif yaratma — bir kliklə", icon: Mail },
  { title: "Gəlirlilik təhlili", description: "Xərc modelindən avtomatik büdcə və marja hesabatları", icon: LineChart },
  { title: "Bilik bazası", description: "Da Vinci müştəri portalında sualları avtomatik cavablandırır", icon: BookOpen },
]

// FAQ q/a pairs removed — JSON-LD structured data now reads from
// next-intl translations (marketing.faq.q1–q8 / a1–a8) in
// src/app/(marketing)/home/page.tsx. No runtime consumer remains.
