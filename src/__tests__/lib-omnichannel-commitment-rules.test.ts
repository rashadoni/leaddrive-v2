import { describe, expect, it } from "vitest"
import {
  detectOmnichannelReplyLocale,
  guardOmnichannelCommitments,
} from "@/lib/inbox/omnichannel-commitment-rules"

describe("guardOmnichannelCommitments", () => {
  it("blocks a Russian callback-time promise and removes the original text", () => {
    const original = "Наш менеджер перезвонит вам сегодня в 15:00."
    const result = guardOmnichannelCommitments(original, {
      customerText: "Когда вы мне позвоните?",
    })

    expect(result).toEqual({
      text: "Точное время связи не подтверждено. Для уточнения нужен менеджер.",
      violations: ["unconfirmed_time"],
      forceHandoff: true,
    })
    expect(result.text).not.toContain("15:00")
    expect(result.text).not.toContain("перезвонит")
  })

  it.each([
    "Ожидайте звонка завтра в 10:00.",
    "Наш консультант наберёт вас завтра в 10:00.",
    "Доставка завтра в 10:00.",
    "Курьер приедет завтра в 10:00.",
    "Менеджер выйдет на связь завтра в 10:00.",
    "Звонить будем завтра в 10:00.",
    "Expect a call tomorrow at 10:00.",
    "Delivery is tomorrow at 10:00.",
    "The courier will arrive tomorrow at 10:00.",
    "Your appointment is tomorrow at 10:00.",
    "We will be in touch tomorrow at 10:00.",
    "You will hear from us tomorrow at 10:00.",
    "I will phone you tomorrow at 10:00.",
    "Our manager will ring you tomorrow.",
    "Expect a message tomorrow.",
    "We will email you tomorrow at 10:00.",
    "Менеджер вам отпишется завтра.",
    "Сообщение завтра в 10:00.",
    "Звонок 14 августа.",
    "Доставка 14 августа.",
    "Your call is August 14.",
    "Delivery August 14.",
    "Delivery is August the 14th.",
    "Доставка 14-го августа.",
    "Çatdırılma 14 avqustda olacaq.",
    "Позвоним через час.",
    "Перезвоним через час.",
    "Свяжемся через час.",
    "Напишем через час.",
    "Ответим через час.",
    "Ожидайте звонка через час.",
    "Ожидайте звонка через полчаса.",
    "Ответим в течение пары часов.",
    "Sabah saat 10:00-da zəng gözləyin.",
    "Menecer sabah sizinlə danışacaq.",
    "Çatdırılma sabah saat 10:00-da olacaq.",
    "Kuryer sabah saat 10:00-da gələcək.",
    "Zəng avqustun 14-də.",
    "Someone will be reaching out tomorrow.",
    "Our support team will be responding tomorrow.",
    "Менеджер выйдет на связь завтра.",
    "Menecer sizə sabah geri dönəcək.",
  ])("blocks callback-time promises that avoid the original future verbs: %s", (text) => {
    const result = guardOmnichannelCommitments(text, { locale: "ru" })
    expect(result.forceHandoff).toBe(true)
    expect(result.violations).toContain("unconfirmed_time")
    expect(result.text).not.toContain("10:00")
  })

  it.each([
    "Ваша заявка уже заведена.",
    "Your request has been logged.",
    "Müraciətiniz artıq yaradılıb.",
    "Передано менеджеру.",
    "Escalated to a manager.",
    "Менеджер получил ваш запрос.",
    "Менеджер уже уведомлен.",
    "Ваш запрос обработан.",
    "Тикет готов.",
    "Ожидайте звонка.",
    "Ожидайте нашего звонка.",
    "Ожидайте ответа.",
    "Ваш вопрос уже у менеджера.",
    "Ваш запрос у менеджера.",
    "Your request is with a manager.",
    "The manager has your request.",
    "Sorğunuz menecerdədir.",
    "Menecer sorğunuzu alıb.",
    "Ваш запрос дошёл до менеджера.",
    "Ваше обращение поступило оператору.",
    "Запрос попал к специалисту.",
    "Your request reached the manager.",
    "Your case has made it to our team.",
    "Müraciətiniz menecerə çatıb.",
    "Мы взяли заявку в работу.",
    "Я взял обращение в работу.",
    "Мы берём ваш запрос в работу.",
    "Ваша заявка взята в работу.",
    "Мы приняли тикет в работу.",
    "Your request is being handled.",
    "Your case is being handled.",
    "Sorğunuz icraya qəbul edilib.",
    "Müraciətiniz icraya götürülüb.",
    "Your ticket is in progress.",
    "Your case is currently being processed.",
    "We are working on your request.",
    "We're currently handling your case.",
    "Ваша заявка в работе.",
    "Мы работаем над вашим запросом.",
    "Sorğunuz icradadır.",
    "Biz sizin müraciətiniz üzərində işləyirik.",
    "Your request is queued.",
    "Your ticket is under review.",
    "I have passed this to the team.",
    "We handed your case on to our support department.",
    "A callback has been arranged.",
    "We have notified the manager.",
    "Your manager has been notified.",
    "Заявка в очереди.",
    "Ваш запрос на рассмотрении.",
    "Я зафиксировал обращение.",
    "Передал коллегам.",
    "Менеджер уже проинформирован.",
    "Sorğunuz növbəyə alınıb.",
    "Müraciətiniz qeydiyyata alınıb.",
    "Sorğunuz baxışdadır.",
    "Biz müraciətinizi qeydə aldıq.",
    "This has been passed to the team.",
    "Your request awaits review.",
    "The manager is reviewing your request.",
    "Заявка поставлена в очередь.",
    "Ваш запрос рассматривается.",
    "Мы рассматриваем ваш запрос.",
    "Sorğunuz nəzərdən keçirilir.",
  ])("blocks unsupported completed-action wording: %s", (text) => {
    const result = guardOmnichannelCommitments(text, { locale: "ru" })
    expect(result.forceHandoff).toBe(true)
    expect(result.violations).toContain("unsupported_completion")
  })

  it.each([
    "Вам наберут.",
    "С вами поговорят.",
    "Менеджер вас уведомит.",
    "Sizə zəng edəcəklər.",
    "Menecer sizinlə danışacaq.",
    "Sizə məlumat veriləcək.",
    "Someone will call you.",
    "A colleague will call you.",
    "We’ll be in touch.",
    "You’ll hear from us.",
    "Our consultant will speak with you.",
    "Our representative will call you.",
    "A representative will contact you.",
    "You will be contacted.",
    "You’ll be notified.",
    "Представитель свяжется с вами.",
    "Наши представители вам позвонят.",
    "Nümayəndə sizinlə əlaqə saxlayacaq.",
    "Sizinlə əlaqə saxlanacaq.",
    "Customer service will get back to you.",
    "Customer support will get back to you.",
    "The customer service team will contact you.",
    "We will follow up with you.",
    "We’ll follow up with you.",
    "Our team member will follow up with you.",
    "A team member will reach out to you.",
    "Служба поддержки свяжется с вами.",
    "Наша служба клиентской поддержки свяжется с вами.",
    "Ожидайте обратной связи.",
    "Ждите обратной связи.",
    "Sizə geri dönüş ediləcək.",
    "Sizə geri dönüş olunacaq.",
    "Our support team will reply.",
    "Our technical support agent will contact you.",
    "The support representative will reach out to you.",
    "Support will respond.",
    "The billing department will contact you.",
    "Our customer care desk will get back to you.",
    "Отдел продаж свяжется с вами.",
    "Наш департамент сопровождения позвонит вам.",
    "Satış şöbəsi sizinlə əlaqə saxlayacaq.",
    "Техподдержка ответит вам.",
    "Наша техподдержка напишет вам.",
    "Бухгалтерия свяжется с вами.",
    "Бухгалтерия вам перезвонит.",
    "You will hear from our sales team.",
    "You’ll hear from the billing department.",
    "You are going to hear from our customer success team.",
    "You shall hear from a support representative.",
    "Support will be responding.",
    "Our team will get in touch.",
    "A colleague is going to call you.",
    "Someone from billing will contact you.",
    "Our office will contact you.",
    "Expect to hear from our manager.",
    "Менеджер выйдет на связь.",
    "Коллеги свяжутся с вами.",
    "Menecer sizə geri dönəcək.",
    "You’ll be hearing from our team.",
    "Staff will call you.",
  ])("blocks definite company-side contact promises without a time: %s", (text) => {
    const result = guardOmnichannelCommitments(text, { locale: "en" })
    expect(result.forceHandoff).toBe(true)
    expect(result.violations).toContain("unsupported_completion")
  })

  it("blocks an Azerbaijani relative-time promise with an Azerbaijani fallback", () => {
    const result = guardOmnichannelCommitments(
      "Menecer sizinlə 20 dəqiqə sonra əlaqə saxlayacaq.",
      { customerText: "Mənimlə nə vaxt əlaqə saxlayacaqsınız?" },
    )

    expect(result.forceHandoff).toBe(true)
    expect(result.violations).toContain("unconfirmed_time")
    expect(result.text).toBe(
      "Əlaqə vaxtı təsdiqlənməyib. Dəqiqləşdirmə üçün menecerin cavabı lazımdır.",
    )
    expect(result.text).not.toContain("20")
  })

  it("blocks an unsupported English completion claim", () => {
    const result = guardOmnichannelCommitments(
      "I have created your ticket and forwarded it to our manager.",
      { customerText: "Please help with my request." },
    )

    expect(result).toEqual({
      text: "I cannot confirm that this action has been completed. A manager needs to verify it.",
      violations: ["unsupported_completion"],
      forceHandoff: true,
    })
    expect(result.text).not.toContain("created")
    expect(result.text).not.toContain("forwarded")
  })

  it("blocks an unsupported handoff claim even without a time or marker", () => {
    const result = guardOmnichannelCommitments("Передаю ваш вопрос менеджеру.", {
      locale: "ru",
    })

    expect(result.forceHandoff).toBe(true)
    expect(result.violations).toEqual(["unsupported_completion"])
    expect(result.text).not.toContain("Передаю")
  })

  it("does not block an explicit uncertainty statement that mentions a date", () => {
    const text = "Я не могу подтвердить, что менеджер позвонит завтра в 10:00."
    expect(guardOmnichannelCommitments(text, { locale: "ru" })).toEqual({
      text,
      violations: [],
      forceHandoff: false,
    })
  })

  it("does not let an uncertainty disclaimer hide a later affirmative promise", () => {
    for (const text of [
      "Время не подтверждено и менеджер позвонит завтра в 10:00.",
      "Время не подтверждено, менеджер позвонит завтра в 10:00.",
      "The time is not confirmed but we will call tomorrow at 10:00.",
      "Vaxt təsdiqlənməyib amma menecer sabah saat 10:00-da zəng edəcək.",
      "The time is not confirmed — we will call tomorrow at 10:00.",
      "Время не подтверждено: менеджер позвонит завтра в 10:00.",
      "Vaxt təsdiqlənməyib — menecer sabah saat 10:00-da zəng edəcək.",
      "Время не подтверждено - менеджер позвонит завтра.",
      "Время не подтверждено (менеджер позвонит завтра).",
      "The time is not confirmed - we will call tomorrow.",
      "The time is not confirmed (we will call tomorrow).",
      "Vaxt təsdiqlənməyib - menecer sabah zəng edəcək.",
    ]) {
      const result = guardOmnichannelCommitments(text, { locale: "ru" })
      expect(result.forceHandoff, text).toBe(true)
      expect(result.violations, text).toContain("unconfirmed_time")
    }
  })

  it("keeps a subordinate uncertainty clause safe even with a comma", () => {
    const text = "Я не могу подтвердить, что менеджер позвонит завтра в 10:00."
    expect(guardOmnichannelCommitments(text, { locale: "ru" })).toEqual({
      text,
      violations: [],
      forceHandoff: false,
    })
  })

  it.each([
    "I cannot confirm whether the manager will call tomorrow and whether the delivery will arrive Friday.",
    "Не могу подтвердить дату и позвонит ли менеджер завтра.",
  ])("keeps coordinated uncertainty safe: %s", (text) => {
    expect(guardOmnichannelCommitments(text, { locale: "en" })).toEqual({
      text,
      violations: [],
      forceHandoff: false,
    })
  })

  it.each([
    "Call center hours on August 14 are 09:00-18:00.",
    "The Callback API release is August 14.",
    "Рабочие часы 14 августа: 09:00-18:00.",
  ])("does not treat informational schedules as a customer promise: %s", (text) => {
    expect(guardOmnichannelCommitments(text, { locale: "en" })).toEqual({
      text,
      violations: [],
      forceHandoff: false,
    })
  })

  it.each([
    "Модель 4o стоит 2,50 USD и поддерживает 128K токенов.",
    "Рабочие часы сегодня: 09:00–18:00. Колл-центр открыт.",
    "Model 4o costs $2.50 and supports 128K tokens.",
    "Business hours today are 09:00–18:00. The call center is open.",
    "Bu modelin qiyməti 25 AZN-dir. İş saatları 09:00–18:00-dır.",
    "The Callback API calls the configured webhook and returns a response.",
    "Our representative office is open from 09:00 to 18:00.",
    "График работы представительства: 09:00–18:00.",
    "Customer service hours are 09:00–18:00.",
    "The Customer Service API will get back the ticket status.",
    "The Follow-up API returns the callback status.",
    "Customer support service hours are 09:00–18:00.",
    "Команда поддержки работает с 09:00 до 18:00.",
    "The team member field is returned by the API.",
    "Our support team API will reply with the current ticket status.",
    "The Support API will respond with HTTP 200.",
    "The billing department field is returned by the API.",
    "Отдел продаж работает с 09:00 до 18:00.",
    "Your API request is in progress.",
    "The import task is in progress.",
    "We are working on the Request API documentation.",
    "Техподдержка работает с 09:00 до 18:00.",
    "API техподдержки возвращает текущий статус.",
    "Бухгалтерия работает по будням.",
    "Поле «Бухгалтерия» доступно через API.",
    "You can hear from our sales team in the recorded webinar.",
    "The API returns the hearFromSalesTeam field.",
    "The Support API will be responding with HTTP 200.",
    "Your API request is queued.",
    "The callback field has been arranged alphabetically.",
    "Поле «заявка в очереди» описано в API.",
    "The Staff API will call the callback endpoint.",
    "The requestAwaitingReview field is returned by the API.",
    "Поле «запрос рассматривается» описано в API.",
  ])("does not block benign product numbers or business hours: %s", (text) => {
    expect(guardOmnichannelCommitments(text, { locale: "en" })).toEqual({
      text,
      violations: [],
      forceHandoff: false,
    })
  })

  it("detects fallback languages from the customer message", () => {
    expect(detectOmnichannelReplyLocale("Когда вы ответите?")).toBe("ru")
    expect(detectOmnichannelReplyLocale("Nə vaxt zəng edəcəksiniz?")).toBe("az")
    expect(detectOmnichannelReplyLocale("When will you reply?")).toBe("en")
  })
})

describe("the guard keeps the answer and removes only the promise", () => {
  // Before this, any offending clause replaced the ENTIRE reply with a
  // one-line fallback. Once a customer had given their phone number, the agent
  // acknowledged it in every subsequent reply — and "получен"/"qeydə alınıb"
  // is a completion verb — so a customer who asked for a price received
  // "I cannot confirm that this action has been completed" and nothing else.
  it("answers the question and drops the sentence that promised", () => {
    const reply = [
      "60x25x20 ölçülü blokun qiyməti 3.10 AZN-dir.",
      "Sorğunuz menecerə yönləndirilib.",
      "Dəqiq hesablama üçün kalkulyatordan istifadə edə bilərsiniz.",
    ].join(" ")
    const result = guardOmnichannelCommitments(reply, { locale: "az" })
    expect(result.violations).toContain("unsupported_completion")
    // The price and the calculator survive.
    expect(result.text).toContain("3.10 AZN")
    expect(result.text).toContain("kalkulyator")
    // The claim does not.
    expect(result.text).not.toContain("yönləndirilib")
    // And nothing else is added. Appending "I cannot confirm that this action
    // has been completed" to an answer that no longer contains a promise reads
    // as a malfunction; the hand-off below is what actually protects anyone.
    expect(result.text).not.toContain("təsdiqləyə bilmirəm")
    expect(result.forceHandoff).toBe(true)
  })

  it("falls back to the bare sentence when the reply WAS the promise", () => {
    const result = guardOmnichannelCommitments("Sorğunuz menecerə yönləndirilib.", { locale: "az" })
    expect(result.text).toBe("Bu əməliyyatın tamamlandığını təsdiqləyə bilmirəm. Yoxlama üçün menecerin cavabı lazımdır.")
  })

  it("leaves a clean reply exactly as written", () => {
    const clean = "60x25x20 blokun qiyməti 3.10 AZN-dir. Ölçüləri dəqiqləşdirə bilərsinizmi?"
    const result = guardOmnichannelCommitments(clean, { locale: "az" })
    expect(result.text).toBe(clean)
    expect(result.violations).toEqual([])
    expect(result.forceHandoff).toBe(false)
  })
})

describe("our own rules must not ask for a sentence this guard rejects", () => {
  // The engine appends lead-collection rules to every tenant prompt. When those
  // rules asked the assistant to acknowledge a captured phone number, the
  // natural wording — "we received your number, a manager will contact you" —
  // paired a completion verb with an internal object and was rejected, taking
  // the rest of the reply with it. Two rule sets of our own, contradicting.
  const REJECTED_BY_DESIGN = [
    "Nömrənizi aldıq, satış menecerimiz sizinlə əlaqə saxlayacaq.",
    "Sorğunuz menecerə ötürülüb.",
  ]
  const MUST_PASS = [
    "60x25x20 ölçülü blokun qiyməti 3.10 AZN-dir.",
    "Bunu satış menecerimiz dəqiqləşdirəcək.",
    "Sizi satış menecerinə yönləndirirəm.",
    "Hesablama üçün kalkulyator bölməsinə keçə bilərsiniz.",
  ]

  it.each(REJECTED_BY_DESIGN)("still rejects %s", (text) => {
    expect(guardOmnichannelCommitments(text, { locale: "az" }).violations).toContain("unsupported_completion")
  })

  it.each(MUST_PASS)("leaves %s alone", (text) => {
    const r = guardOmnichannelCommitments(text, { locale: "az" })
    expect(r.violations).toEqual([])
    expect(r.text).toBe(text)
  })

  it("does not instruct the assistant to write the rejected wording", async () => {
    const rules = await import("fs").then(fs => fs.readFileSync("src/lib/social/ai-autoreply.ts", "utf8"))
    const block = rules.slice(rules.indexOf("AUTONOMOUS_SALES_RULES"), rules.indexOf("Escalation directive"))
    expect(block).toContain("PHONE_COLLECTED=true")
    // It must warn about the pairing rather than ask for it.
    expect(block).toMatch(/НЕ пиши|не утверждай/)
  })
})


describe("the fallback speaks the language of the conversation", () => {
  // Its language used to be read from the customer's message alone. That fails
  // exactly when the customer sends no words: a phone number carries no
  // language and the detector's last resort is English, so an assistant talking
  // Azerbaijani all conversation answered a bare number in English.
  it("uses the discarded reply when the customer sent only digits", () => {
    const result = guardOmnichannelCommitments("Sorğunuz menecerə ötürülüb.", { customerText: "0773201000" })
    expect(result.text).toBe("Bu əməliyyatın tamamlandığını təsdiqləyə bilmirəm. Yoxlama üçün menecerin cavabı lazımdır.")
  })

  it("still follows the customer when they actually wrote something", () => {
    const result = guardOmnichannelCommitments("Sorğunuz menecerə ötürülüb.", { customerText: "Здравствуйте, какая цена?" })
    expect(result.text).toBe("Я не могу подтвердить, что это действие уже выполнено. Для проверки нужен менеджер.")
  })

  it("an emoji is not a language either", () => {
    const result = guardOmnichannelCommitments("Sorğunuz menecerə ötürülüb.", { customerText: "👍" })
    expect(result.text).toContain("təsdiqləyə bilmirəm")
  })
})
