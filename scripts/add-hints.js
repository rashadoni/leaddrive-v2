// Script to add hint translation keys to all 3 language files
const fs = require("fs");
const path = require("path");

const MESSAGES_DIR = path.join(__dirname, "..", "messages");

// All hint keys organized by namespace
const hints = {
  dashboard: {
    pageDescription: {
      en: "Overview of your CRM: key metrics, charts and recent activity",
      ru: "Обзор вашей CRM: ключевые метрики, графики и последняя активность",
      az: "CRM-in ümumi görünüşü: əsas göstəricilər, qrafiklər və son fəaliyyət",
    },
    hintTotalCompanies: {
      en: "Total number of companies in your CRM",
      ru: "Общее количество компаний в CRM",
      az: "CRM-dəki ümumi şirkət sayı",
    },
    hintTotalContacts: {
      en: "Total number of contacts across all companies",
      ru: "Общее количество контактов во всех компаниях",
      az: "Bütün şirkətlərdəki ümumi əlaqə sayı",
    },
    hintTotalDeals: {
      en: "Number of deals at all stages of the pipeline",
      ru: "Количество сделок на всех этапах воронки",
      az: "Boru xəttinin bütün mərhələlərindəki sövdələşmə sayı",
    },
    hintTotalLeads: {
      en: "Total leads currently being tracked",
      ru: "Общее количество отслеживаемых лидов",
      az: "Hal-hazırda izlənilən ümumi lidlər",
    },
    hintTotalTickets: {
      en: "Number of support tickets across all statuses",
      ru: "Количество тикетов по всем статусам",
      az: "Bütün statuslardakı dəstək biletlərinin sayı",
    },
    hintOpenTasks: {
      en: "Tasks that are not yet completed",
      ru: "Задачи, которые ещё не завершены",
      az: "Hələ tamamlanmamış tapşırıqlar",
    },
    hintPendingTickets: {
      en: "Tickets waiting for response or action",
      ru: "Тикеты, ожидающие ответа или действия",
      az: "Cavab və ya əməliyyat gözləyən biletlər",
    },
    hintRevenueForecast: {
      en: "Projected revenue based on deal pipeline and probabilities",
      ru: "Прогноз выручки на основе воронки сделок и вероятностей",
      az: "Sövdələşmə boru xətti və ehtimallara əsaslanan gəlir proqnozu",
    },
    hintDealPipelineValue: {
      en: "Total value of all deals currently in the pipeline",
      ru: "Общая стоимость всех сделок в воронке",
      az: "Boru xəttindəki bütün sövdələşmələrin ümumi dəyəri",
    },
    hintRevenueTrend: {
      en: "Revenue change compared to previous period",
      ru: "Изменение выручки по сравнению с предыдущим периодом",
      az: "Əvvəlki dövrə nisbətən gəlir dəyişikliyi",
    },
    hintTaskCompletion: {
      en: "Percentage of tasks completed on time",
      ru: "Процент задач, завершённых вовремя",
      az: "Vaxtında tamamlanan tapşırıqların faizi",
    },
    hintSupportQuality: {
      en: "Overall support quality score based on SLA and resolution metrics",
      ru: "Общая оценка качества поддержки на основе SLA и метрик решения",
      az: "SLA və həll göstəricilərinə əsaslanan ümumi dəstək keyfiyyəti",
    },
    hintLeadFunnel: {
      en: "Visual breakdown of leads by stage from new to converted",
      ru: "Визуальная разбивка лидов по этапам — от нового до конвертированного",
      az: "Yeni-dən çevrilmişə qədər mərhələlərə görə lidlərin vizual bölgüsü",
    },
    hintDealPipeline: {
      en: "Distribution of deals across pipeline stages",
      ru: "Распределение сделок по этапам воронки",
      az: "Sövdələşmələrin boru xətti mərhələlərinə görə paylanması",
    },
    hintActivityFeed: {
      en: "Recent actions: calls, emails, meetings, and notes",
      ru: "Последние действия: звонки, письма, встречи и заметки",
      az: "Son əməliyyatlar: zənglər, e-poçtlar, görüşlər və qeydlər",
    },
  },

  companies: {
    pageDescription: {
      en: "Manage your client companies: track status, contacts, deals and activity",
      ru: "Управляйте компаниями-клиентами: статус, контакты, сделки и активность",
      az: "Müştəri şirkətlərinizi idarə edin: status, əlaqələr, sövdələşmələr və fəaliyyət",
    },
    hintActiveClients: {
      en: "Companies with active status — your current customers",
      ru: "Компании с активным статусом — ваши текущие клиенты",
      az: "Aktiv statuslu şirkətlər — cari müştəriləriniz",
    },
    hintTotalContacts: {
      en: "Total number of contact persons across all companies",
      ru: "Общее число контактных лиц во всех компаниях",
      az: "Bütün şirkətlərdəki ümumi əlaqə şəxsləri sayı",
    },
    hintTotalUsers: {
      en: "Number of CRM users linked to companies",
      ru: "Количество пользователей CRM, привязанных к компаниям",
      az: "Şirkətlərə bağlı CRM istifadəçilərinin sayı",
    },
    hintCompaniesCount: {
      en: "Total number of companies in the database",
      ru: "Общее количество компаний в базе данных",
      az: "Verilənlər bazasındakı ümumi şirkət sayı",
    },
    hintColName: {
      en: "Legal or trade name of the company",
      ru: "Юридическое или торговое название компании",
      az: "Şirkətin hüquqi və ya ticarət adı",
    },
    hintColIndustry: {
      en: "Business sector or industry vertical",
      ru: "Отрасль или сектор деятельности",
      az: "İş sahəsi və ya sənaye sektoru",
    },
    hintColCategory: {
      en: "Company status: Active (customer), Prospect (potential), Inactive",
      ru: "Статус компании: Активный (клиент), Потенциальный, Неактивный",
      az: "Şirkət statusu: Aktiv (müştəri), Potensial, Qeyri-aktiv",
    },
    hintColLocation: {
      en: "City or region where the company is located",
      ru: "Город или регион, где расположена компания",
      az: "Şirkətin yerləşdiyi şəhər və ya bölgə",
    },
    hintColContacts: {
      en: "Number of contact persons associated with this company",
      ru: "Число контактных лиц, связанных с компанией",
      az: "Bu şirkətlə əlaqəli əlaqə şəxslərinin sayı",
    },
    hintColDeals: {
      en: "Number of deals associated with this company",
      ru: "Число сделок, связанных с компанией",
      az: "Bu şirkətlə əlaqəli sövdələşmələrin sayı",
    },
    hintColScore: {
      en: "Lead scoring value — higher means more likely to convert",
      ru: "Оценка лида — чем выше, тем вероятнее конверсия",
      az: "Lid balı — nə qədər yüksəkdirsə, çevrilmə ehtimalı bir o qədər yüksəkdir",
    },
    hintColTemperature: {
      en: "Lead temperature: Hot (ready to buy), Warm (interested), Cold (early stage)",
      ru: "Температура лида: Горячий (готов к покупке), Тёплый (заинтересован), Холодный (ранний этап)",
      az: "Lid temperaturu: İsti (almağa hazır), Ilıq (maraqlı), Soyuq (erkən mərhələ)",
    },
  },

  contacts: {
    pageDescription: {
      en: "Your contact database: track people, their companies, and communication history",
      ru: "База контактов: отслеживайте людей, их компании и историю коммуникаций",
      az: "Əlaqə bazanız: insanları, şirkətlərini və ünsiyyət tarixçəsini izləyin",
    },
    hintTotalContacts: {
      en: "Total number of contacts in the system",
      ru: "Общее количество контактов в системе",
      az: "Sistemdəki ümumi əlaqə sayı",
    },
    hintActiveContacts: {
      en: "Contacts who have been active recently",
      ru: "Контакты, проявившие активность недавно",
      az: "Son vaxtlarda aktiv olan əlaqələr",
    },
    hintPortalAccess: {
      en: "Contacts with access to the self-service client portal",
      ru: "Контакты с доступом к клиентскому порталу самообслуживания",
      az: "Özünəxidmət müştəri portalına girişi olan əlaqələr",
    },
    hintColName: {
      en: "Full name of the contact person",
      ru: "Полное имя контактного лица",
      az: "Əlaqə şəxsinin tam adı",
    },
    hintColEmail: {
      en: "Primary email address for communication",
      ru: "Основной email для связи",
      az: "Ünsiyyət üçün əsas e-poçt ünvanı",
    },
    hintColPhone: {
      en: "Phone number of the contact",
      ru: "Телефонный номер контакта",
      az: "Əlaqənin telefon nömrəsi",
    },
    hintColPosition: {
      en: "Job title or role at the company",
      ru: "Должность или роль в компании",
      az: "Şirkətdəki vəzifəsi və ya rolu",
    },
    hintColCompany: {
      en: "Company the contact is associated with",
      ru: "Компания, к которой привязан контакт",
      az: "Əlaqənin aid olduğu şirkət",
    },
    hintColSource: {
      en: "How this contact was acquired (website, referral, event, etc.)",
      ru: "Источник привлечения контакта (сайт, рекомендация, мероприятие и т.д.)",
      az: "Bu əlaqənin necə əldə edildiyi (sayt, tövsiyə, tədbir və s.)",
    },
    hintColPortal: {
      en: "Whether this contact can log into the client portal",
      ru: "Может ли контакт входить в клиентский портал",
      az: "Bu əlaqənin müştəri portalına daxil ola bilib-bilməyəcəyi",
    },
  },

  deals: {
    pageDescription: {
      en: "Sales pipeline: track deals from lead to close, manage stages and values",
      ru: "Воронка продаж: отслеживайте сделки от лида до закрытия, управляйте этапами",
      az: "Satış boru xətti: sövdələşmələri liddən bağlanmaya qədər izləyin",
    },
    hintTotalDeals: {
      en: "Total number of deals at all stages",
      ru: "Общее количество сделок на всех этапах",
      az: "Bütün mərhələlərdəki ümumi sövdələşmə sayı",
    },
    hintPipelineValue: {
      en: "Sum of all deal values currently in the pipeline",
      ru: "Сумма всех сделок, находящихся в воронке",
      az: "Boru xəttindəki bütün sövdələşmələrin ümumi məbləği",
    },
    hintWonValue: {
      en: "Total value of deals closed as won",
      ru: "Общая стоимость выигранных сделок",
      az: "Uğurla bağlanmış sövdələşmələrin ümumi dəyəri",
    },
    hintLostCount: {
      en: "Number of deals that were lost",
      ru: "Количество проигранных сделок",
      az: "İtirilmiş sövdələşmələrin sayı",
    },
    hintStageLead: {
      en: "Initial stage — a new opportunity has been identified",
      ru: "Начальный этап — выявлена новая возможность",
      az: "Başlanğıc mərhələ — yeni imkan müəyyən edilib",
    },
    hintStageQualified: {
      en: "Lead has been qualified as a real opportunity",
      ru: "Лид квалифицирован как реальная возможность",
      az: "Lid real imkan kimi təsdiqlənib",
    },
    hintStageProposal: {
      en: "A proposal or offer has been sent to the client",
      ru: "Клиенту отправлено предложение или оффер",
      az: "Müştəriyə təklif və ya offər göndərilib",
    },
    hintStageNegotiation: {
      en: "Terms are being negotiated with the client",
      ru: "Идут переговоры об условиях с клиентом",
      az: "Müştəri ilə şərtlər müzakirə edilir",
    },
    hintStageWon: {
      en: "Deal successfully closed — revenue confirmed",
      ru: "Сделка успешно закрыта — выручка подтверждена",
      az: "Sövdələşmə uğurla bağlanıb — gəlir təsdiqlənib",
    },
    hintStageLost: {
      en: "Deal was lost — analyze reason to improve future sales",
      ru: "Сделка проиграна — проанализируйте причины для улучшения",
      az: "Sövdələşmə itirildi — gələcək satışları yaxşılaşdırmaq üçün səbəbi təhlil edin",
    },
    hintColName: {
      en: "Name or title of the deal",
      ru: "Название сделки",
      az: "Sövdələşmənin adı",
    },
    hintColValue: {
      en: "Monetary value of the deal",
      ru: "Денежная стоимость сделки",
      az: "Sövdələşmənin pul dəyəri",
    },
    hintColStage: {
      en: "Current stage in the sales pipeline",
      ru: "Текущий этап в воронке продаж",
      az: "Satış boru xəttindəki cari mərhələ",
    },
    hintColProbability: {
      en: "Estimated probability of closing the deal (%)",
      ru: "Оценочная вероятность закрытия сделки (%)",
      az: "Sövdələşmənin bağlanma ehtimalı (%)",
    },
    hintColCompany: {
      en: "Company associated with this deal",
      ru: "Компания, связанная с этой сделкой",
      az: "Bu sövdələşmə ilə əlaqəli şirkət",
    },
  },

  leads: {
    pageDescription: {
      en: "Lead management: track, score and convert potential customers",
      ru: "Управление лидами: отслеживайте, оценивайте и конвертируйте потенциальных клиентов",
      az: "Lid idarəetməsi: potensial müştəriləri izləyin, qiymətləndirin və çevirin",
    },
    hintTotalLeads: {
      en: "Total number of leads in the system",
      ru: "Общее количество лидов в системе",
      az: "Sistemdəki ümumi lid sayı",
    },
    hintHotLeads: {
      en: "High-probability leads ready for conversion (score 80+)",
      ru: "Лиды с высокой вероятностью конверсии (оценка 80+)",
      az: "Çevrilmə ehtimalı yüksək olan lidlər (bal 80+)",
    },
    hintWarmLeads: {
      en: "Engaged leads showing interest (score 40-79)",
      ru: "Заинтересованные лиды (оценка 40-79)",
      az: "Maraq göstərən lidlər (bal 40-79)",
    },
    hintColdLeads: {
      en: "Early-stage leads requiring nurturing (score below 40)",
      ru: "Лиды на раннем этапе, требующие работы (оценка ниже 40)",
      az: "İşlənməsi lazım olan erkən mərhələ lidləri (bal 40-dan aşağı)",
    },
    hintColGrade: {
      en: "Lead grade A-F based on scoring model",
      ru: "Грейд лида A-F на основе модели оценки",
      az: "Qiymətləndirmə modelinə əsaslanan A-F lid dərəcəsi",
    },
    hintColContact: {
      en: "Contact person associated with this lead",
      ru: "Контактное лицо, связанное с лидом",
      az: "Bu lidlə əlaqəli əlaqə şəxsi",
    },
    hintColSource: {
      en: "Channel through which the lead was acquired",
      ru: "Канал, через который был получен лид",
      az: "Lidin əldə edildiyi kanal",
    },
    hintColStatus: {
      en: "Current status: New → Contacted → Qualified → Converted or Lost",
      ru: "Текущий статус: Новый → Связались → Квалифицирован → Конвертирован или Потерян",
      az: "Cari status: Yeni → Əlaqə saxlanıldı → Təsdiqləndi → Çevrildi və ya İtirildi",
    },
    hintColPriority: {
      en: "Priority level based on potential value and urgency",
      ru: "Приоритет на основе потенциальной ценности и срочности",
      az: "Potensial dəyər və təcililiyə əsaslanan prioritet səviyyəsi",
    },
    hintColScore: {
      en: "Numerical score (0-100) based on lead scoring rules",
      ru: "Числовая оценка (0-100) на основе правил скоринга",
      az: "Lid qiymətləndirmə qaydalarına əsaslanan rəqəmsal bal (0-100)",
    },
    hintColTemperature: {
      en: "Visual indicator: 🔥 Hot, 🟡 Warm, 🔵 Cold",
      ru: "Визуальный индикатор: 🔥 Горячий, 🟡 Тёплый, 🔵 Холодный",
      az: "Vizual göstərici: 🔥 İsti, 🟡 Ilıq, 🔵 Soyuq",
    },
  },

  tasks: {
    pageDescription: {
      en: "Task management: create, assign and track tasks across your team",
      ru: "Управление задачами: создавайте, назначайте и отслеживайте задачи команды",
      az: "Tapşırıq idarəetməsi: komanda tapşırıqlarını yaradın, təyin edin və izləyin",
    },
    hintTotalTasks: {
      en: "Total number of tasks in the system",
      ru: "Общее количество задач в системе",
      az: "Sistemdəki ümumi tapşırıq sayı",
    },
    hintOverdueTasks: {
      en: "Tasks past their due date that need attention",
      ru: "Просроченные задачи, требующие внимания",
      az: "Vaxtı keçmiş və diqqət tələb edən tapşırıqlar",
    },
    hintCompletedWeek: {
      en: "Tasks completed during the current week",
      ru: "Задачи, завершённые на текущей неделе",
      az: "Cari həftə ərzində tamamlanan tapşırıqlar",
    },
    hintCompletionRate: {
      en: "Percentage of all tasks that have been completed",
      ru: "Процент всех завершённых задач",
      az: "Tamamlanmış tapşırıqların ümumi faizi",
    },
    hintColTitle: {
      en: "Short description of what needs to be done",
      ru: "Краткое описание того, что нужно сделать",
      az: "Nə edilməli olduğunun qısa təsviri",
    },
    hintColStatus: {
      en: "Current progress: Not Started, In Progress, or Completed",
      ru: "Текущий прогресс: Не начато, В работе, Завершено",
      az: "Cari irəliləyiş: Başlanmayıb, Davam edir, Tamamlanıb",
    },
    hintColPriority: {
      en: "Urgency level: Low, Medium, High, or Urgent",
      ru: "Уровень срочности: Низкий, Средний, Высокий, Срочный",
      az: "Təcililik səviyyəsi: Aşağı, Orta, Yüksək, Təcili",
    },
    hintColDueDate: {
      en: "Deadline for completing this task",
      ru: "Крайний срок выполнения задачи",
      az: "Tapşırığın tamamlanma son tarixi",
    },
    hintColAssigned: {
      en: "Team member responsible for this task",
      ru: "Ответственный сотрудник за эту задачу",
      az: "Bu tapşırığa məsul olan komanda üzvü",
    },
    hintColRelated: {
      en: "Linked entity: deal, contact, company, or ticket",
      ru: "Связанная сущность: сделка, контакт, компания или тикет",
      az: "Əlaqəli obyekt: sövdələşmə, əlaqə, şirkət və ya bilet",
    },
  },

  tickets: {
    pageDescription: {
      en: "Support desk: manage customer issues, track SLA compliance and resolution times",
      ru: "Служба поддержки: управляйте обращениями клиентов, отслеживайте SLA и время решения",
      az: "Dəstək masası: müştəri problemlərini idarə edin, SLA uyğunluğunu və həll vaxtlarını izləyin",
    },
    hintTotalTickets: {
      en: "Total number of support tickets",
      ru: "Общее количество тикетов поддержки",
      az: "Ümumi dəstək biletlərinin sayı",
    },
    hintSlaBreached: {
      en: "Tickets that exceeded the SLA response or resolution time",
      ru: "Тикеты, превысившие время ответа или решения по SLA",
      az: "SLA cavab və ya həll vaxtını aşmış biletlər",
    },
    hintFirstResponseRate: {
      en: "Percentage of tickets that received first response within SLA",
      ru: "Процент тикетов с первым ответом в рамках SLA",
      az: "SLA çərçivəsində ilk cavab alan biletlərin faizi",
    },
    hintAvgResolution: {
      en: "Average time to resolve a ticket from creation to closure",
      ru: "Среднее время решения тикета от создания до закрытия",
      az: "Biletin yaradılmasından bağlanmasına qədər orta həll vaxtı",
    },
    hintColNumber: {
      en: "Unique ticket identifier",
      ru: "Уникальный идентификатор тикета",
      az: "Unikal bilet identifikatoru",
    },
    hintColSubject: {
      en: "Brief description of the issue",
      ru: "Краткое описание проблемы",
      az: "Problemin qısa təsviri",
    },
    hintColPriority: {
      en: "Issue severity: Critical, High, Medium, Low",
      ru: "Серьёзность проблемы: Критический, Высокий, Средний, Низкий",
      az: "Problemin ciddiliyi: Kritik, Yüksək, Orta, Aşağı",
    },
    hintColStatus: {
      en: "Ticket lifecycle: New → Open → In Progress → Waiting → Resolved → Closed",
      ru: "Жизненный цикл: Новый → Открыт → В работе → Ожидание → Решён → Закрыт",
      az: "Həyat dövrü: Yeni → Açıq → Davam edir → Gözləmədə → Həll edilib → Bağlanıb",
    },
    hintColSla: {
      en: "Time remaining until SLA deadline. Red = breached, yellow = warning",
      ru: "Время до дедлайна SLA. Красный = нарушен, жёлтый = предупреждение",
      az: "SLA son tarixinə qədər qalan vaxt. Qırmızı = pozulub, sarı = xəbərdarlıq",
    },
    hintColCompany: {
      en: "Client company that reported the issue",
      ru: "Компания-клиент, сообщившая о проблеме",
      az: "Problemi bildirən müştəri şirkəti",
    },
    hintColAssigned: {
      en: "Support agent handling this ticket",
      ru: "Агент поддержки, работающий с тикетом",
      az: "Bu biletlə məşğul olan dəstək agenti",
    },
  },

  offers: {
    pageDescription: {
      en: "Commercial offers: create, send and track proposals to clients",
      ru: "Коммерческие предложения: создавайте, отправляйте и отслеживайте офферы",
      az: "Kommersiya təklifləri: müştərilərə təkliflər yaradın, göndərin və izləyin",
    },
    hintColNumber: {
      en: "Unique offer reference number",
      ru: "Уникальный номер предложения",
      az: "Unikal təklif referans nömrəsi",
    },
    hintColTitle: {
      en: "Title or subject of the commercial offer",
      ru: "Заголовок коммерческого предложения",
      az: "Kommersiya təklifinin başlığı",
    },
    hintColAmount: {
      en: "Total monetary value of the offer",
      ru: "Общая денежная сумма предложения",
      az: "Təklifin ümumi pul dəyəri",
    },
    hintColStatus: {
      en: "Offer status: Draft → Sent → Accepted/Rejected",
      ru: "Статус: Черновик → Отправлен → Принят/Отклонён",
      az: "Status: Qaralama → Göndərilib → Qəbul edilib/Rədd edilib",
    },
    hintColValidUntil: {
      en: "Expiration date — after this the offer is no longer valid",
      ru: "Дата истечения — после неё предложение недействительно",
      az: "Son tarix — bundan sonra təklif etibarsızdır",
    },
  },

  contracts: {
    pageDescription: {
      en: "Contract management: track agreements, renewals and expiration dates",
      ru: "Управление контрактами: отслеживайте соглашения, продления и сроки",
      az: "Müqavilə idarəetməsi: razılaşmaları, yeniləmələri və son tarixləri izləyin",
    },
    hintTotalContracts: {
      en: "Total number of contracts in the system",
      ru: "Общее количество контрактов в системе",
      az: "Sistemdəki ümumi müqavilə sayı",
    },
    hintActiveContracts: {
      en: "Currently active and signed contracts",
      ru: "Активные подписанные контракты",
      az: "Hal-hazırda aktiv və imzalanmış müqavilələr",
    },
    hintExpiringSoon: {
      en: "Contracts expiring within the next 30 days",
      ru: "Контракты, истекающие в ближайшие 30 дней",
      az: "Yaxın 30 gün ərzində bitəcək müqavilələr",
    },
    hintContractValue: {
      en: "Total monetary value of all contracts",
      ru: "Общая стоимость всех контрактов",
      az: "Bütün müqavilələrin ümumi pul dəyəri",
    },
    hintColNumber: {
      en: "Unique contract identifier",
      ru: "Уникальный идентификатор контракта",
      az: "Unikal müqavilə identifikatoru",
    },
    hintColType: {
      en: "Contract type: Service Agreement, NDA, Maintenance, License, SLA",
      ru: "Тип контракта: Сервисный, NDA, Поддержка, Лицензия, SLA",
      az: "Müqavilə növü: Xidmət, NDA, Texniki dəstək, Lisenziya, SLA",
    },
    hintColStatus: {
      en: "Lifecycle: Draft → Sent → Signed → Active → Expiring → Expired/Renewed",
      ru: "Цикл: Черновик → Отправлен → Подписан → Активен → Истекает → Истёк/Продлён",
      az: "Dövrü: Qaralama → Göndərilib → İmzalanıb → Aktiv → Bitir → Bitib/Yenilənib",
    },
    hintColDates: {
      en: "Start and end dates of the contract period",
      ru: "Даты начала и окончания срока контракта",
      az: "Müqavilə müddətinin başlanğıc və bitmə tarixləri",
    },
    hintColAmount: {
      en: "Monetary value of the contract",
      ru: "Денежная стоимость контракта",
      az: "Müqavilənin pul dəyəri",
    },
  },

  products: {
    pageDescription: {
      en: "Product & service catalog: manage your offerings, prices and categories",
      ru: "Каталог продуктов и услуг: управляйте предложениями, ценами и категориями",
      az: "Məhsul və xidmət kataloqu: təkliflərinizi, qiymətləri və kateqoriyaları idarə edin",
    },
    hintTotalProducts: {
      en: "Total number of products and services",
      ru: "Общее количество продуктов и услуг",
      az: "Ümumi məhsul və xidmət sayı",
    },
    hintActiveProducts: {
      en: "Products currently available for sale",
      ru: "Продукты, доступные для продажи",
      az: "Hal-hazırda satışda olan məhsullar",
    },
    hintTotalRevenue: {
      en: "Total revenue generated from all products",
      ru: "Общая выручка от всех продуктов",
      az: "Bütün məhsullardan əldə edilən ümumi gəlir",
    },
    hintAvgPrice: {
      en: "Average price across all active products",
      ru: "Средняя цена по всем активным продуктам",
      az: "Bütün aktiv məhsulların orta qiyməti",
    },
    hintColName: {
      en: "Product or service name",
      ru: "Название продукта или услуги",
      az: "Məhsul və ya xidmət adı",
    },
    hintColCategory: {
      en: "Type: Service, Product, Add-on, or Consulting",
      ru: "Тип: Услуга, Продукт, Дополнение или Консалтинг",
      az: "Növ: Xidmət, Məhsul, Əlavə və ya Konsaltinq",
    },
    hintColPrice: {
      en: "Unit price of the product or service",
      ru: "Цена за единицу продукта или услуги",
      az: "Məhsul və ya xidmətin vahid qiyməti",
    },
    hintColActive: {
      en: "Whether this product is currently available",
      ru: "Доступен ли продукт в данный момент",
      az: "Bu məhsulun hal-hazırda mövcud olub-olmadığı",
    },
  },

  invoices: {
    pageDescription: {
      en: "Invoice management: create, send and track payments from clients",
      ru: "Управление счетами: создавайте, отправляйте и отслеживайте оплаты клиентов",
      az: "Faktura idarəetməsi: müştərilərdən ödənişləri yaradın, göndərin və izləyin",
    },
    hintTotalInvoiced: {
      en: "Total amount invoiced to all clients",
      ru: "Общая сумма, выставленная всем клиентам",
      az: "Bütün müştərilərə hesablanmış ümumi məbləğ",
    },
    hintTotalPaid: {
      en: "Total amount received from clients",
      ru: "Общая сумма, полученная от клиентов",
      az: "Müştərilərdən alınmış ümumi məbləğ",
    },
    hintTotalOutstanding: {
      en: "Unpaid invoices — amount still owed by clients",
      ru: "Неоплаченные счета — сумма задолженности клиентов",
      az: "Ödənilməmiş fakturalar — müştərilərin hələ borclu olduğu məbləğ",
    },
    hintTotalOverdue: {
      en: "Invoices past their due date that remain unpaid",
      ru: "Просроченные неоплаченные счета",
      az: "Son tarixi keçmiş ödənilməmiş fakturalar",
    },
    hintColNumber: {
      en: "Unique invoice number",
      ru: "Уникальный номер счёта",
      az: "Unikal faktura nömrəsi",
    },
    hintColAmount: {
      en: "Total amount on the invoice",
      ru: "Общая сумма счёта",
      az: "Fakturanın ümumi məbləği",
    },
    hintColStatus: {
      en: "Payment status: Draft → Sent → Viewed → Paid/Overdue",
      ru: "Статус оплаты: Черновик → Отправлен → Просмотрен → Оплачен/Просрочен",
      az: "Ödəniş statusu: Qaralama → Göndərilib → Baxılıb → Ödənilib/Gecikib",
    },
    hintColDueDate: {
      en: "Payment deadline — invoice becomes overdue after this date",
      ru: "Срок оплаты — после этой даты счёт считается просроченным",
      az: "Ödəniş son tarixi — bu tarixdən sonra faktura gecikmiş sayılır",
    },
    hintColBalance: {
      en: "Remaining balance to be paid",
      ru: "Оставшаяся сумма к оплате",
      az: "Ödənilməli qalan məbləğ",
    },
  },

  campaigns: {
    pageDescription: {
      en: "Marketing campaigns: send emails and SMS, track open and click rates",
      ru: "Маркетинговые кампании: отправляйте email и SMS, отслеживайте открытия и клики",
      az: "Marketinq kampaniyaları: e-poçt və SMS göndərin, açılma və klik dərəcələrini izləyin",
    },
    hintTotalCampaigns: {
      en: "Total number of marketing campaigns",
      ru: "Общее количество маркетинговых кампаний",
      az: "Ümumi marketinq kampaniyalarının sayı",
    },
    hintSentMonth: {
      en: "Campaigns sent during the current month",
      ru: "Кампании, отправленные в текущем месяце",
      az: "Cari ayda göndərilmiş kampaniyalar",
    },
    hintOpenRate: {
      en: "Percentage of recipients who opened the message",
      ru: "Процент получателей, открывших сообщение",
      az: "Mesajı açan alıcıların faizi",
    },
    hintClickRate: {
      en: "Percentage of recipients who clicked a link in the message",
      ru: "Процент получателей, кликнувших на ссылку в сообщении",
      az: "Mesajdakı linkə kliklənmiş alıcıların faizi",
    },
    hintColName: {
      en: "Campaign name or title",
      ru: "Название кампании",
      az: "Kampaniyanın adı",
    },
    hintColType: {
      en: "Channel type: Email or SMS",
      ru: "Тип канала: Email или SMS",
      az: "Kanal növü: E-poçt və ya SMS",
    },
    hintColStatus: {
      en: "Campaign status: Draft → Scheduled → Sending → Sent",
      ru: "Статус: Черновик → Запланирован → Отправляется → Отправлен",
      az: "Status: Qaralama → Planlaşdırılıb → Göndərilir → Göndərilib",
    },
    hintColRecipients: {
      en: "Number of target recipients",
      ru: "Количество целевых получателей",
      az: "Hədəf alıcıların sayı",
    },
    hintColOpened: {
      en: "Number of recipients who opened the message",
      ru: "Количество получателей, открывших сообщение",
      az: "Mesajı açan alıcıların sayı",
    },
    hintColClicked: {
      en: "Number of recipients who clicked a link",
      ru: "Количество получателей, кликнувших на ссылку",
      az: "Linkə klik edən alıcıların sayı",
    },
  },

  segments: {
    pageDescription: {
      en: "Audience segments: group contacts by criteria for targeted campaigns",
      ru: "Сегменты аудитории: группируйте контакты по критериям для таргетированных кампаний",
      az: "Auditoriya seqmentləri: hədəfli kampaniyalar üçün əlaqələri meyarlara görə qruplaşdırın",
    },
    hintTotalSegments: {
      en: "Total number of defined segments",
      ru: "Общее количество определённых сегментов",
      az: "Müəyyən edilmiş ümumi seqment sayı",
    },
    hintDynamic: {
      en: "Segments that auto-update based on matching criteria",
      ru: "Сегменты, автоматически обновляющиеся по критериям",
      az: "Meyarlara uyğun avtomatik yenilənən seqmentlər",
    },
    hintStatic: {
      en: "Manually curated segments with fixed contact lists",
      ru: "Вручную составленные сегменты с фиксированным списком контактов",
      az: "Əl ilə tərtib edilmiş sabit əlaqə siyahılı seqmentlər",
    },
    hintContactCount: {
      en: "Total contacts across all segments",
      ru: "Общее число контактов во всех сегментах",
      az: "Bütün seqmentlərdəki ümumi əlaqə sayı",
    },
  },

  journeys: {
    pageDescription: {
      en: "Customer journeys: automate multi-step workflows triggered by events",
      ru: "Пути клиента: автоматизируйте многошаговые сценарии по событиям",
      az: "Müştəri yolları: hadisələrlə işə salınan çoxaddımlı iş axınlarını avtomatlaşdırın",
    },
    hintTotalJourneys: {
      en: "Total number of customer journeys",
      ru: "Общее количество путей клиента",
      az: "Ümumi müştəri yollarının sayı",
    },
    hintActiveJourneys: {
      en: "Journeys currently running and processing contacts",
      ru: "Пути, которые сейчас работают и обрабатывают контакты",
      az: "Hal-hazırda işləyən və əlaqələri emal edən yollar",
    },
    hintTotalEntries: {
      en: "Total contacts that entered all journeys",
      ru: "Общее число контактов, вошедших во все пути",
      az: "Bütün yollara daxil olan ümumi əlaqə sayı",
    },
    hintCompletionRate: {
      en: "Percentage of contacts who completed the full journey",
      ru: "Процент контактов, прошедших полный путь",
      az: "Tam yolu tamamlayan əlaqələrin faizi",
    },
  },

  emailTemplates: {
    pageDescription: {
      en: "Email templates: reusable message templates with variables for campaigns and notifications",
      ru: "Шаблоны писем: переиспользуемые шаблоны сообщений с переменными",
      az: "E-poçt şablonları: kampaniyalar və bildirişlər üçün dəyişənlərlə təkrar istifadə olunan mesaj şablonları",
    },
    hintTotalTemplates: {
      en: "Total number of email templates",
      ru: "Общее количество шаблонов писем",
      az: "Ümumi e-poçt şablonlarının sayı",
    },
    hintColName: {
      en: "Template name for internal reference",
      ru: "Название шаблона для внутреннего использования",
      az: "Daxili istifadə üçün şablon adı",
    },
    hintColSubject: {
      en: "Email subject line that recipients will see",
      ru: "Тема письма, которую увидит получатель",
      az: "Alıcıların görəcəyi e-poçt mövzusu",
    },
    hintColCategory: {
      en: "Template category: Welcome, Onboarding, Marketing, Follow-up, etc.",
      ru: "Категория шаблона: Приветственный, Онбординг, Маркетинг, Фоллоу-ап и т.д.",
      az: "Şablon kateqoriyası: Xoş gəldin, Onboarding, Marketinq, Təqib və s.",
    },
    hintColLanguage: {
      en: "Language of the template content",
      ru: "Язык содержимого шаблона",
      az: "Şablon məzmununun dili",
    },
  },

  emailLog: {
    pageDescription: {
      en: "Email log: history of all sent and received emails with delivery status",
      ru: "Журнал email: история всех отправленных и полученных писем со статусом доставки",
      az: "E-poçt jurnalı: göndərilmiş və alınmış bütün e-poçtların çatdırılma statusu ilə tarixçəsi",
    },
    hintTotalEmails: {
      en: "Total number of email records in the log",
      ru: "Общее количество записей в журнале email",
      az: "E-poçt jurnalındakı ümumi qeyd sayı",
    },
    hintOutbound: {
      en: "Emails sent from the system to external recipients",
      ru: "Письма, отправленные из системы внешним получателям",
      az: "Sistemdən xarici alıcılara göndərilmiş e-poçtlar",
    },
    hintInbound: {
      en: "Emails received from external senders",
      ru: "Письма, полученные от внешних отправителей",
      az: "Xarici göndərənlərdən alınmış e-poçtlar",
    },
    hintSentCount: {
      en: "Successfully delivered emails",
      ru: "Успешно доставленные письма",
      az: "Uğurla çatdırılmış e-poçtlar",
    },
    hintFailedCount: {
      en: "Emails that failed to deliver",
      ru: "Письма, которые не удалось доставить",
      az: "Çatdırılması uğursuz olan e-poçtlar",
    },
    hintColStatus: {
      en: "Delivery status: Pending, Sent, Delivered, Failed, Bounced",
      ru: "Статус доставки: Ожидает, Отправлено, Доставлено, Ошибка, Отклонено",
      az: "Çatdırılma statusu: Gözləyir, Göndərilib, Çatdırılıb, Uğursuz, Geri qaytarılıb",
    },
  },

  inbox: {
    pageDescription: {
      en: "Unified inbox: all conversations across Email, Telegram, WhatsApp, SMS in one place",
      ru: "Единый инбокс: все диалоги из Email, Telegram, WhatsApp, SMS в одном месте",
      az: "Vahid gələnlər: E-poçt, Telegram, WhatsApp, SMS-dən bütün söhbətlər bir yerdə",
    },
    hintTotalMessages: {
      en: "Total number of messages across all channels",
      ru: "Общее количество сообщений по всем каналам",
      az: "Bütün kanallardakı ümumi mesaj sayı",
    },
    hintInbound: {
      en: "Messages received from clients",
      ru: "Сообщения, полученные от клиентов",
      az: "Müştərilərdən alınan mesajlar",
    },
    hintOutbound: {
      en: "Messages sent to clients",
      ru: "Сообщения, отправленные клиентам",
      az: "Müştərilərə göndərilən mesajlar",
    },
    hintConversations: {
      en: "Unique conversation threads with contacts",
      ru: "Уникальные ветки диалогов с контактами",
      az: "Əlaqələrlə unikal söhbət mövzuları",
    },
  },

  notifications: {
    pageDescription: {
      en: "Notifications: system alerts about deals, tasks, tickets and other events",
      ru: "Уведомления: системные оповещения о сделках, задачах, тикетах и других событиях",
      az: "Bildirişlər: sövdələşmələr, tapşırıqlar, biletlər və digər hadisələr haqqında sistem xəbərdarlıqları",
    },
    hintTotal: {
      en: "Total number of notifications",
      ru: "Общее количество уведомлений",
      az: "Ümumi bildiriş sayı",
    },
    hintUnread: {
      en: "Notifications you haven't read yet",
      ru: "Уведомления, которые вы ещё не прочитали",
      az: "Hələ oxumadığınız bildirişlər",
    },
  },

  events: {
    pageDescription: {
      en: "Events: manage conferences, webinars, workshops and other gatherings",
      ru: "Мероприятия: управляйте конференциями, вебинарами, воркшопами",
      az: "Tədbirlər: konfransları, vebinarları, seminarları idarə edin",
    },
    hintTotalEvents: {
      en: "Total number of events in the system",
      ru: "Общее количество мероприятий",
      az: "Sistemdəki ümumi tədbir sayı",
    },
    hintPlanned: {
      en: "Events that are scheduled or accepting registrations",
      ru: "Запланированные мероприятия или с открытой регистрацией",
      az: "Planlaşdırılmış və ya qeydiyyat qəbul edən tədbirlər",
    },
    hintCompleted: {
      en: "Events that have already taken place",
      ru: "Мероприятия, которые уже прошли",
      az: "Artıq keçirilmiş tədbirlər",
    },
    hintCancelled: {
      en: "Events that were cancelled",
      ru: "Отменённые мероприятия",
      az: "Ləğv edilmiş tədbirlər",
    },
    hintColType: {
      en: "Event type: Conference, Webinar, Workshop, Meetup, Exhibition",
      ru: "Тип: Конференция, Вебинар, Воркшоп, Митап, Выставка",
      az: "Növ: Konfrans, Vebinar, Seminar, Görüş, Sərgi",
    },
    hintColStatus: {
      en: "Event status: Planned, Registration Open, In Progress, Completed, Cancelled",
      ru: "Статус: Запланировано, Регистрация открыта, Идёт, Завершено, Отменено",
      az: "Status: Planlaşdırılıb, Qeydiyyat açıq, Davam edir, Tamamlanıb, Ləğv edilib",
    },
  },

  projects: {
    pageDescription: {
      en: "Project management: track budgets, timelines, tasks and team assignments",
      ru: "Управление проектами: бюджеты, сроки, задачи и команда",
      az: "Layihə idarəetməsi: büdcələr, vaxt qrafikləri, tapşırıqlar və komanda təyinatları",
    },
    hintTotalProjects: {
      en: "Total number of projects",
      ru: "Общее количество проектов",
      az: "Ümumi layihə sayı",
    },
    hintActiveProjects: {
      en: "Projects currently in progress",
      ru: "Проекты, которые сейчас в работе",
      az: "Hal-hazırda davam edən layihələr",
    },
    hintTotalBudget: {
      en: "Sum of all project budgets",
      ru: "Сумма бюджетов всех проектов",
      az: "Bütün layihə büdcələrinin cəmi",
    },
    hintActualCost: {
      en: "Total actual spending across all projects",
      ru: "Фактические расходы по всем проектам",
      az: "Bütün layihələr üzrə faktiki xərclər",
    },
    hintBudgetRemaining: {
      en: "Remaining budget = Total Budget - Actual Cost",
      ru: "Остаток бюджета = Бюджет - Факт. расходы",
      az: "Qalan büdcə = Ümumi büdcə - Faktiki xərc",
    },
    hintColStatus: {
      en: "Project status: Planning, Active, On Hold, Completed, Cancelled",
      ru: "Статус: Планирование, Активный, На паузе, Завершён, Отменён",
      az: "Status: Planlaşdırma, Aktiv, Gözləmədə, Tamamlanıb, Ləğv edilib",
    },
    hintColCompletion: {
      en: "Progress percentage — how much of the project is done",
      ru: "Процент завершённости проекта",
      az: "İrəliləyiş faizi — layihənin nə qədəri tamamlanıb",
    },
    hintColPriority: {
      en: "Project priority level",
      ru: "Уровень приоритета проекта",
      az: "Layihənin prioritet səviyyəsi",
    },
  },

  profitability: {
    pageDescription: {
      en: "Profitability analytics: cost structure, margins and service-level analysis",
      ru: "Аналитика рентабельности: структура затрат, маржи и анализ по услугам",
      az: "Rentabellik analitikası: xərc strukturu, marjalar və xidmət səviyyəsində təhlil",
    },
    hintTabCostBreakdown: {
      en: "Detailed breakdown of all company costs by category",
      ru: "Детальная разбивка всех затрат компании по категориям",
      az: "Bütün şirkət xərclərinin kateqoriyalara görə ətraflı bölgüsü",
    },
    hintTabServices: {
      en: "Revenue, cost and margin analysis per service",
      ru: "Анализ выручки, затрат и маржи по каждой услуге",
      az: "Hər xidmət üzrə gəlir, xərc və marja təhlili",
    },
    hintTabOverhead: {
      en: "Administrative and infrastructure overhead costs",
      ru: "Административные и инфраструктурные накладные расходы",
      az: "İnzibati və infrastruktur əlavə xərcləri",
    },
    hintTabClients: {
      en: "Per-client profitability analysis",
      ru: "Анализ рентабельности по каждому клиенту",
      az: "Hər müştəri üzrə rentabellik təhlili",
    },
    hintTabEmployees: {
      en: "Employee cost and utilization analysis",
      ru: "Анализ затрат и загрузки сотрудников",
      az: "İşçi xərci və istifadə təhlili",
    },
    hintTabParams: {
      en: "Cost model parameters and rates",
      ru: "Параметры и ставки модели затрат",
      az: "Xərc modeli parametrləri və dərəcələri",
    },
    hintTabAi: {
      en: "AI-generated insights and recommendations on profitability",
      ru: "AI-генерированные наблюдения и рекомендации по рентабельности",
      az: "Rentabellik üzrə AI tərəfindən hazırlanmış müşahidələr və tövsiyələr",
    },
  },

  pricing: {
    pageDescription: {
      en: "Pricing model: configure service pricing, cost structure and margins",
      ru: "Модель ценообразования: настройте цены услуг, структуру затрат и маржи",
      az: "Qiymət modeli: xidmət qiymətlərini, xərc strukturunu və marjaları konfiqurasiya edin",
    },
    hintTabPricing: {
      en: "View current pricing model with revenue, cost and margin breakdown",
      ru: "Текущая модель ценообразования с разбивкой по выручке, затратам и марже",
      az: "Gəlir, xərc və marja bölgüsü ilə cari qiymət modeli",
    },
    hintTabEdit: {
      en: "Adjust prices, costs and margins with sliders",
      ru: "Корректируйте цены, затраты и маржи с помощью ползунков",
      az: "Sürüşdürücülərlə qiymətləri, xərcləri və marjaları tənzimləyin",
    },
    hintTabSales: {
      en: "Sales performance and campaign analytics",
      ru: "Показатели продаж и аналитика кампаний",
      az: "Satış performansı və kampaniya analitikası",
    },
  },

  reports: {
    pageDescription: {
      en: "Reports & analytics: key metrics, pipeline analysis, and performance dashboards",
      ru: "Отчёты и аналитика: ключевые метрики, анализ воронки и дашборды",
      az: "Hesabatlar və analitika: əsas göstəricilər, boru xətti təhlili və performans panelləri",
    },
    hintRevenueOverview: {
      en: "Total revenue, number of won deals, and average deal size",
      ru: "Общая выручка, количество выигранных сделок и средний размер сделки",
      az: "Ümumi gəlir, uğurlu sövdələşmələr sayı və orta sövdələşmə həcmi",
    },
    hintPipelineStages: {
      en: "Distribution of deals by pipeline stage with values",
      ru: "Распределение сделок по этапам воронки с суммами",
      az: "Dəyərlərlə boru xətti mərhələsinə görə sövdələşmələrin paylanması",
    },
    hintTaskSummary: {
      en: "Task completion rate and status breakdown",
      ru: "Процент завершения задач и разбивка по статусам",
      az: "Tapşırıq tamamlanma dərəcəsi və status bölgüsü",
    },
    hintTicketSummary: {
      en: "Ticket resolution rate and status breakdown",
      ru: "Процент решения тикетов и разбивка по статусам",
      az: "Bilet həll dərəcəsi və status bölgüsü",
    },
    hintLeadFunnel: {
      en: "Lead conversion funnel from new to converted",
      ru: "Воронка конверсии лидов: от нового до конвертированного",
      az: "Yenidən çevrilmişə qədər lid çevrilmə hunisi",
    },
    hintTopCompanies: {
      en: "Companies ranked by revenue generated",
      ru: "Компании, ранжированные по выручке",
      az: "Əldə edilən gəlirə görə sıralanan şirkətlər",
    },
  },

  ai: {
    pageDescription: {
      en: "AI Command Center: manage AI agents, chat sessions and interaction analytics",
      ru: "AI Командный центр: управляйте AI-агентами, сессиями и аналитикой",
      az: "AI Əmr Mərkəzi: AI agentlərini, söhbət sessiyalarını və qarşılıqlı əlaqə analitikasını idarə edin",
    },
    hintTotalSessions: {
      en: "Total number of AI chat sessions",
      ru: "Общее количество AI чат-сессий",
      az: "Ümumi AI söhbət sessiyalarının sayı",
    },
    hintActiveSessions: {
      en: "Currently active AI conversations",
      ru: "Активные AI-разговоры в данный момент",
      az: "Hal-hazırda aktiv AI söhbətləri",
    },
    hintDeflectionRate: {
      en: "Percentage of issues resolved by AI without human escalation",
      ru: "Процент проблем, решённых AI без эскалации на человека",
      az: "İnsan eskalasiyası olmadan AI tərəfindən həll edilən problemlərin faizi",
    },
    hintCsat: {
      en: "Customer satisfaction score for AI interactions",
      ru: "Оценка удовлетворённости клиентов AI-взаимодействием",
      az: "AI qarşılıqlı əlaqəsi üçün müştəri məmnuniyyəti balı",
    },
    hintFcr: {
      en: "First Contact Resolution — issues resolved in the first interaction",
      ru: "Решение с первого контакта — проблемы, решённые при первом обращении",
      az: "İlk əlaqədə həll — ilk qarşılıqlı əlaqədə həll edilən problemlər",
    },
    hintAvgResolution: {
      en: "Average time for AI to resolve an issue (minutes)",
      ru: "Среднее время решения проблемы AI (в минутах)",
      az: "AI-nin problemi həll etmək üçün orta vaxtı (dəqiqə)",
    },
    hintTabDashboard: {
      en: "Overview of AI performance metrics and KPIs",
      ru: "Обзор метрик производительности AI и KPI",
      az: "AI performans göstəriciləri və KPI-ların icmalı",
    },
    hintTabAgentConstructor: {
      en: "Configure AI agent models, prompts, tools and behavior",
      ru: "Настройте модели AI-агентов, промпты, инструменты и поведение",
      az: "AI agent modellərini, promptları, alətləri və davranışı konfiqurasiya edin",
    },
    hintTabSessions: {
      en: "Browse AI chat session history and transcripts",
      ru: "Просматривайте историю и транскрипты AI чат-сессий",
      az: "AI söhbət sessiyası tarixçəsinə və transkripsiyalara baxın",
    },
    hintTabLogs: {
      en: "Detailed interaction logs with API calls and responses",
      ru: "Подробные логи взаимодействий с API-запросами и ответами",
      az: "API zəngləri və cavabları ilə ətraflı qarşılıqlı əlaqə jurnalları",
    },
    hintTabGuardrails: {
      en: "Safety rules and prompt injection protection",
      ru: "Правила безопасности и защита от prompt injection",
      az: "Təhlükəsizlik qaydaları və prompt injection qorunması",
    },
    hintScoringPageDescription: {
      en: "AI-powered lead scoring: automatic evaluation of lead quality and conversion probability",
      ru: "AI-скоринг лидов: автоматическая оценка качества и вероятности конверсии",
      az: "AI ilə lid qiymətləndirmə: lid keyfiyyətinin və çevrilmə ehtimalının avtomatik qiymətləndirilməsi",
    },
    hintLeadScoringPageDescription: {
      en: "Visual lead scoring dashboard: leads grouped by grade (A-F) with scores and conversion data",
      ru: "Визуальный дашборд скоринга: лиды сгруппированы по грейдам (A-F)",
      az: "Vizual lid qiymətləndirmə paneli: lidlər dərəcə (A-F) üzrə qruplaşdırılıb",
    },
  },

  campaignRoi: {
    pageDescription: {
      en: "Campaign ROI analysis: measure return on investment for each marketing campaign",
      ru: "Анализ ROI кампаний: измеряйте возврат инвестиций по каждой кампании",
      az: "Kampaniya ROI təhlili: hər marketinq kampaniyası üçün investisiya gəlirini ölçün",
    },
    hintTotalRevenue: {
      en: "Total revenue attributed to marketing campaigns",
      ru: "Общая выручка, относимая к маркетинговым кампаниям",
      az: "Marketinq kampaniyalarına aid edilən ümumi gəlir",
    },
    hintTotalCost: {
      en: "Total spending on all marketing campaigns",
      ru: "Общие затраты на все маркетинговые кампании",
      az: "Bütün marketinq kampaniyalarına çəkilən ümumi xərc",
    },
    hintRoi: {
      en: "Return on Investment = (Revenue - Cost) / Cost × 100%",
      ru: "Возврат инвестиций = (Выручка - Затраты) / Затраты × 100%",
      az: "İnvestisiya gəliri = (Gəlir - Xərc) / Xərc × 100%",
    },
    hintSendRate: {
      en: "Percentage of messages successfully delivered to recipients",
      ru: "Процент сообщений, успешно доставленных получателям",
      az: "Alıcılara uğurla çatdırılmış mesajların faizi",
    },
    hintOpenRate: {
      en: "Percentage of delivered messages that were opened",
      ru: "Процент доставленных сообщений, которые были открыты",
      az: "Çatdırılmış mesajların açılma faizi",
    },
    hintClickRate: {
      en: "Percentage of opened messages where a link was clicked",
      ru: "Процент открытых сообщений, в которых кликнули ссылку",
      az: "Açılmış mesajlarda linkə klik faizi",
    },
  },

  kb: {
    pageDescription: {
      en: "Knowledge Base: articles and guides for customers and support team",
      ru: "База знаний: статьи и руководства для клиентов и команды поддержки",
      az: "Bilik Bazası: müştərilər və dəstək komandası üçün məqalələr və bələdçilər",
    },
    hintTotalArticles: {
      en: "Total number of knowledge base articles",
      ru: "Общее количество статей в базе знаний",
      az: "Bilik bazasındakı ümumi məqalə sayı",
    },
    hintPublished: {
      en: "Articles visible to portal users and customers",
      ru: "Статьи, видимые пользователям портала и клиентам",
      az: "Portal istifadəçiləri və müştərilər üçün görünən məqalələr",
    },
    hintDraft: {
      en: "Articles still being written — not visible to customers",
      ru: "Статьи в процессе написания — не видны клиентам",
      az: "Hələ yazılan məqalələr — müştərilərə görünmür",
    },
    hintViews: {
      en: "Number of times articles have been viewed",
      ru: "Количество просмотров статей",
      az: "Məqalələrin baxılma sayı",
    },
  },

  settings: {
    pageDescription: {
      en: "System settings: configure users, roles, integrations and CRM behavior",
      ru: "Настройки системы: пользователи, роли, интеграции и поведение CRM",
      az: "Sistem parametrləri: istifadəçilər, rollar, inteqrasiyalar və CRM davranışı",
    },
    hintUsers: {
      en: "Manage CRM user accounts, roles and access permissions",
      ru: "Управляйте учётными записями, ролями и правами доступа пользователей",
      az: "CRM istifadəçi hesablarını, rolları və giriş icazələrini idarə edin",
    },
    hintRoles: {
      en: "Define user roles and their permissions for each CRM module",
      ru: "Определяйте роли пользователей и их разрешения для каждого модуля CRM",
      az: "Hər CRM modulu üçün istifadəçi rollarını və icazələrini müəyyən edin",
    },
    hintSecurity: {
      en: "Two-factor authentication, password policies and security settings",
      ru: "Двухфакторная аутентификация, политика паролей и настройки безопасности",
      az: "İki faktorlu autentifikasiya, parol siyasətləri və təhlükəsizlik parametrləri",
    },
    hintCurrencies: {
      en: "Configure currencies and exchange rates for multi-currency deals",
      ru: "Настройте валюты и курсы обмена для мультивалютных сделок",
      az: "Çoxvalyutalı sövdələşmələr üçün valyutaları və məzənnələri konfiqurasiya edin",
    },
    hintCustomFields: {
      en: "Add custom fields to companies, contacts, deals and other entities",
      ru: "Добавляйте пользовательские поля к компаниям, контактам, сделкам",
      az: "Şirkətlərə, əlaqələrə, sövdələşmələrə xüsusi sahələr əlavə edin",
    },
    hintWorkflows: {
      en: "Automation rules: auto-assign, notify, and update records on triggers",
      ru: "Правила автоматизации: автоназначение, уведомления, обновление записей",
      az: "Avtomatlaşdırma qaydaları: avtomatik təyinat, bildiriş, qeydlərin yenilənməsi",
    },
    hintSla: {
      en: "SLA policies: define response and resolution time targets for tickets",
      ru: "SLA-политики: определяйте целевые сроки ответа и решения для тикетов",
      az: "SLA siyasətləri: biletlər üçün cavab və həll vaxtı hədəflərini müəyyən edin",
    },
    hintChannels: {
      en: "Communication channels: Email, Telegram, WhatsApp, SMS configuration",
      ru: "Каналы связи: настройка Email, Telegram, WhatsApp, SMS",
      az: "Ünsiyyət kanalları: E-poçt, Telegram, WhatsApp, SMS konfiqurasiyası",
    },
    hintAuditLog: {
      en: "History of all changes made in the system by users",
      ru: "История всех изменений, сделанных пользователями в системе",
      az: "İstifadəçilər tərəfindən sistemdə edilən bütün dəyişikliklərin tarixçəsi",
    },
    hintBilling: {
      en: "Subscription plan, usage limits and billing information",
      ru: "План подписки, лимиты использования и платёжная информация",
      az: "Abunə planı, istifadə limitləri və ödəniş məlumatları",
    },
    hintBudgetConfig: {
      en: "Budget planning configuration: fiscal year, categories, approval rules",
      ru: "Настройка бюджетирования: финансовый год, категории, правила согласования",
      az: "Büdcə planlaşdırma konfiqurasiyası: maliyyə ili, kateqoriyalar, təsdiq qaydaları",
    },
    hintDashboardSettings: {
      en: "Customize dashboard widgets, layout and visible metrics",
      ru: "Настройте виджеты дашборда, макет и отображаемые метрики",
      az: "Panel vidgetlərini, düzeni və görünən göstəriciləri fərdiləşdirin",
    },
    hintEmailTemplatesSettings: {
      en: "Configure default email templates for system notifications",
      ru: "Настройте шаблоны писем по умолчанию для системных уведомлений",
      az: "Sistem bildirişləri üçün standart e-poçt şablonlarını konfiqurasiya edin",
    },
    hintInvoiceSettings: {
      en: "Invoice numbering, default terms, payment details and branding",
      ru: "Нумерация счетов, условия по умолчанию, реквизиты и брендинг",
      az: "Faktura nömrələməsi, standart şərtlər, ödəniş detalları və brendinq",
    },
    hintLeadRules: {
      en: "Lead scoring rules: define criteria and weights for automatic scoring",
      ru: "Правила скоринга лидов: критерии и веса для автоматической оценки",
      az: "Lid qiymətləndirmə qaydaları: avtomatik qiymətləndirmə üçün meyarlar və çəkilər",
    },
    hintPortalUsers: {
      en: "Manage customer portal access for contacts",
      ru: "Управляйте доступом контактов к клиентскому порталу",
      az: "Əlaqələr üçün müştəri portalına girişi idarə edin",
    },
    hintSalesForecast: {
      en: "Sales forecast configuration: periods, targets, and pipeline weights",
      ru: "Настройка прогноза продаж: периоды, цели и веса воронки",
      az: "Satış proqnozu konfiqurasiyası: dövrlər, hədəflər və boru xətti çəkiləri",
    },
    hintSmtp: {
      en: "SMTP server configuration for sending emails from the system",
      ru: "Настройка SMTP-сервера для отправки писем из системы",
      az: "Sistemdən e-poçt göndərmək üçün SMTP server konfiqurasiyası",
    },
    hintWebToLead: {
      en: "Web forms that automatically create leads from your website visitors",
      ru: "Веб-формы, автоматически создающие лидов из посетителей сайта",
      az: "Sayt ziyarətçilərindən avtomatik lid yaradan veb formalar",
    },
  },
};

// Read all 3 files
for (const lang of ["en", "ru", "az"]) {
  const filePath = path.join(MESSAGES_DIR, `${lang}.json`);
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

  for (const [namespace, keys] of Object.entries(hints)) {
    // Handle campaignRoi -> it might not exist as a namespace yet
    if (!data[namespace]) {
      data[namespace] = {};
    }

    for (const [key, translations] of Object.entries(keys)) {
      data[namespace][key] = translations[lang];
    }
  }

  // Write back with formatting
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`Updated ${lang}.json`);
}

console.log("Done! All hint keys added.");
