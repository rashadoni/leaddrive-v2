import { describe, expect, it } from "vitest"

import { mentionSourceLabel, publisherHostFromUrl } from "@/lib/social/mention-source-label"

describe("mentionSourceLabel", () => {
  it("берёт страницу Facebook из ссылки на пост и из ссылки на комментарий", () => {
    expect(mentionSourceLabel({
      platform: "facebook",
      url: "https://www.facebook.com/ObaMarket/posts/pfbid123",
    })).toEqual({
      label: "ObaMarket",
      handle: "ObaMarket",
      url: "https://www.facebook.com/ObaMarket",
      kind: "page",
    })

    // У комментария собственный URL ведёт на комментарий, а площадку несёт
    // только ссылка на родительский пост.
    expect(mentionSourceLabel({
      platform: "facebook",
      url: "https://www.facebook.com/permalink.php?story_fbid=1&id=2",
      parentPostUrl: "https://www.facebook.com/BravoSupermarket/posts/9",
      authorName: "Комментатор",
    })).toMatchObject({ label: "BravoSupermarket", kind: "page" })
  })

  it("различает группу и страницу Facebook", () => {
    expect(mentionSourceLabel({
      platform: "facebook",
      url: "https://www.facebook.com/groups/885544/permalink/77/",
    })).toEqual({
      label: "facebook.com/groups/885544",
      handle: "885544",
      url: "https://www.facebook.com/groups/885544",
      kind: "group",
    })
  })

  it("не выдаёт служебные разделы Facebook за страницу", () => {
    // Разбор идёт по белому списку ФОРМЫ имени: чёрного списка мало, потому
    // что точкой входа служит ссылка на пост, а не корень страницы.
    for (const url of [
      "https://www.facebook.com/watch/?v=123",
      "https://www.facebook.com/marketplace/item/9",
      "https://www.facebook.com/profile.php?id=100",
      "https://www.facebook.com/login/?next=x",
      "https://www.facebook.com/l.php?u=https%3A%2F%2Fexample.com",
      "https://www.facebook.com/sharer.php?u=x",
      "https://www.facebook.com/plugins/post.php?href=x",
      "https://www.facebook.com/photos/1",
      "https://www.facebook.com/help/contact/123",
      "https://www.facebook.com/business/help/1",
    ]) {
      expect(mentionSourceLabel({ platform: "facebook", url })).toBeNull()
    }
  })

  // /p/{Название}-{id}/ — современный корень страницы без короткого имени.
  // Без отдельной ветки он деградировал бы до буквы «p».
  it("разбирает современную ссылку вида /p/{name}-{id}", () => {
    expect(mentionSourceLabel({
      platform: "facebook",
      url: "https://www.facebook.com/p/Oba-Market-100063123456789/",
    })).toMatchObject({ label: "Oba-Market-100063123456789", kind: "page" })

    expect(mentionSourceLabel({
      platform: "facebook",
      url: "https://www.facebook.com/pg/ObaMarket/posts/",
    })).toMatchObject({ label: "ObaMarket", kind: "page" })
  })

  // WHATWG URL кодирует всё вне ASCII: без декодирования азербайджанское или
  // русское имя страницы попало бы в отчёт как %D0%9E%D0%B1%D0%B0…
  it("декодирует не-ASCII имя страницы", () => {
    expect(mentionSourceLabel({
      platform: "facebook",
      url: "https://www.facebook.com/Оба-Маркет-100063/posts/1",
    })).toMatchObject({ label: "Оба-Маркет-100063", kind: "page" })

    expect(mentionSourceLabel({
      platform: "facebook",
      url: "https://www.facebook.com/Şəkərçörək/posts/1",
    })).toMatchObject({ label: "Şəkərçörək", kind: "page" })
  })

  // У поста автор И ЕСТЬ площадка, у комментария — посторонний человек.
  it("не выдаёт автора комментария за площадку", () => {
    const comment = {
      isComment: true,
      authorName: "Elvin Məmmədov",
      authorHandle: "100004567890123",
      url: "https://www.facebook.com/permalink.php?story_fbid=1&id=2",
    }
    expect(mentionSourceLabel({ platform: "facebook", ...comment })).toBeNull()
    expect(mentionSourceLabel({
      platform: "instagram",
      isComment: true,
      authorHandle: "random_person",
      url: "https://www.instagram.com/p/abc/",
    })).toBeNull()
    expect(mentionSourceLabel({
      platform: "tiktok",
      isComment: true,
      authorHandle: "random_person",
      url: "https://www.tiktok.com/",
    })).toBeNull()

    // Для поста тот же автор — законный источник: это сама страница.
    expect(mentionSourceLabel({
      platform: "facebook",
      isComment: false,
      authorName: "Oba Market",
      authorHandle: "ObaMarket",
      url: "https://www.facebook.com/permalink.php?story_fbid=1&id=2",
    })).toMatchObject({ label: "ObaMarket", kind: "page" })
  })

  it("берёт аккаунт TikTok из ссылки на видео", () => {
    expect(mentionSourceLabel({
      platform: "tiktok",
      url: "https://www.tiktok.com/@obamarket/video/7412",
    })).toMatchObject({ label: "@obamarket", handle: "obamarket", kind: "account" })
  })

  it("молчит про владельца поста Instagram, когда в ссылке его нет", () => {
    // /p/{shortcode}/ не содержит аккаунта — подставлять что-либо нельзя.
    expect(mentionSourceLabel({
      platform: "instagram",
      url: "https://www.instagram.com/p/abc123/",
      parentPostUrl: "https://www.instagram.com/p/abc123/",
      authorName: "Комментатор",
    })).toBeNull()

    expect(mentionSourceLabel({
      platform: "instagram",
      url: "https://www.instagram.com/obamarket/",
    })).toMatchObject({ label: "@obamarket", kind: "account" })
  })

  it("показывает издание для web-новостей", () => {
    expect(mentionSourceLabel({
      platform: "web",
      url: "https://report.az/iqtisadiyyat/xeber/",
      authorName: "Report.az",
      authorHandle: "report.az",
    })).toEqual({
      label: "Report.az",
      handle: "report.az",
      url: "https://report.az",
      kind: "publisher",
    })

    // Адаптер мог не проставить издание — тогда честно берём хост.
    expect(mentionSourceLabel({
      platform: "web",
      url: "https://www.banker.az/news/1",
    })).toMatchObject({ label: "banker.az", kind: "publisher" })
  })

  it("возвращает null, когда достоверных признаков источника нет", () => {
    expect(mentionSourceLabel({ platform: "facebook", url: null, parentPostUrl: null })).toBeNull()
    expect(mentionSourceLabel({ platform: "web", url: "not-a-url" })).toBeNull()
    // javascript:-ссылка не должна превращаться в «издание».
    expect(mentionSourceLabel({ platform: "web", url: "javascript:alert(1)" })).toBeNull()
  })
})

describe("publisherHostFromUrl", () => {
  it("нормализует хост и отбрасывает не-http схемы", () => {
    expect(publisherHostFromUrl("https://WWW.Report.AZ/a/b")).toBe("report.az")
    expect(publisherHostFromUrl("javascript:alert(1)")).toBeNull()
    expect(publisherHostFromUrl(null)).toBeNull()
  })
})
