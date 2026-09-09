# LeadDrive Cloud — Site Audit Plan (25 задач)
> Создан: 2026-03-29 | Автор: Claude + Rashad

## Статус: 0/25 выполнено

---

### БЛОК A: КРИТИЧНЫЕ — Битые страницы и ссылки (1-8)

#### 1. Создать страницу /contact (Əlaqə)
- **Проблема:** Navbar, Footer и Plans ссылаются на /contact → 404
- **Решение:** Создать страницу с формой обратной связи, контактами (email, телефон), адресом офиса
- **Файл:** `src/app/(marketing)/contact/page.tsx`
- [ ] Выполнено

#### 2. Создать страницу /about (Haqqımızda)
- **Проблема:** Footer ссылается → 404
- **Решение:** Страница о компании — LeadDrive Inc., миссия, команда, Warsaw
- **Файл:** `src/app/(marketing)/about/page.tsx`
- [ ] Выполнено

#### 3. Создать /legal/privacy (Məxfilik Siyasəti)
- **Проблема:** Footer ссылается → 404, GDPR упоминается в hero
- **Решение:** Политика конфиденциальности на азербайджанском
- **Файл:** `src/app/(marketing)/legal/privacy/page.tsx`
- [ ] Выполнено

#### 4. Создать /legal/terms (İstifadə Şərtləri)
- **Проблема:** Footer ссылается → 404
- **Решение:** Условия использования SaaS-продукта
- **Файл:** `src/app/(marketing)/legal/terms/page.tsx`
- [ ] Выполнено

#### 5. Добавить favicon + apple-touch-icon
- **Проблема:** Дефолтная иконка во вкладке браузера
- **Решение:** Создать favicon.ico, apple-touch-icon.png, manifest.json из логотипа LeadDrive
- **Файлы:** `public/favicon.ico`, `public/apple-touch-icon.png`, `src/app/layout.tsx`
- [ ] Выполнено

#### 6. Кастомная 404 страница
- **Проблема:** Голый "404 This page could not be found" без навигации
- **Решение:** Стилизованная 404 с кнопкой "Ana səhifəyə qayıt"
- **Файл:** `src/app/not-found.tsx`
- [ ] Выполнено

#### 7. Исправить соцсети в Footer
- **Проблема:** LinkedIn → linkedin.com, Twitter → twitter.com (generic)
- **Решение:** Либо поставить реальные ссылки, либо убрать фейковые
- **Файл:** `src/components/marketing/footer.tsx`
- [ ] Выполнено

#### 8. Исправить sitemap.xml
- **Проблема:** Содержит /contact и /about которых не было
- **Решение:** После создания страниц — проверить что все URL в sitemap реальны
- **Файл:** `public/sitemap.xml`
- [ ] Выполнено

---

### БЛОК B: ТЕКСТ И КОПИРАЙТИНГ (9-13)

#### 9. Hero бейдж: "süni intellekt" → "AI"
- **Проблема:** "AI-native CRM — 16 süni intellekt inteqrasiyası" — непрофессионально
- **Решение:** "AI-native CRM — 16 AI inteqrasiya"
- **Файл:** `src/components/marketing/hero-section.tsx`
- [ ] Выполнено

#### 10. Meta description — убрать "Süni intellektli"
- **Проблема:** Уже частично исправлено, проверить все meta-тексты
- **Решение:** Аудит всех meta description, keywords, OG tags — унифицировать тон
- **Файлы:** `src/app/(marketing)/layout.tsx`, `src/app/layout.tsx`
- [ ] Выполнено

#### 11. StatsCounter — проверить цифры "500+ istifadəçi şirkət"
- **Проблема:** Если не реальная цифра — может вызвать недоверие
- **Решение:** Согласовать с Rashad — реальные или маркетинговые цифры
- **Файл:** `src/components/marketing/stats-counter.tsx`
- [ ] Выполнено

#### 12. Pricing — показать реальные цены
- **Проблема:** Все 4 плана показывают "Satışla əlaqə" вместо цен 9₼/29₼/59₼/99₼
- **Решение:** Добавить цены как на v2.leaddrivecrm.org/settings/billing
- **Файл:** `src/app/(marketing)/plans/page.tsx`
- [ ] Выполнено

#### 13. Testimonials — анонимизация проверка
- **Проблема:** Фейковые компании (AzərTech, BulutKöprü) — ок для MVP
- **Решение:** Пометить как демо-данные или подготовить механизм для реальных отзывов
- **Файл:** `src/components/marketing/testimonial-carousel.tsx`
- [ ] Выполнено

---

### БЛОК C: ТЕХНИЧЕСКИЕ УЛУЧШЕНИЯ (14-19)

#### 14. Google Analytics / Plausible
- **Проблема:** Cookie consent есть, но аналитики нет
- **Решение:** Подключить GA4 или Plausible, связать с cookie consent
- **Файлы:** `src/app/layout.tsx`, `src/components/marketing/cookie-consent.tsx`
- [ ] Выполнено

#### 15. Error boundary (error.tsx)
- **Проблема:** При JS ошибке — белый экран
- **Решение:** Стилизованная error page с кнопкой retry
- **Файл:** `src/app/error.tsx`
- [ ] Выполнено

#### 16. Theme-color meta tag
- **Проблема:** Нет theme-color для мобильного браузера
- **Решение:** Добавить `<meta name="theme-color" content="#0f172a" />`
- **Файл:** `src/app/layout.tsx`
- [ ] Выполнено

#### 17. DNS prefetch + preconnect
- **Проблема:** Нет оптимизации загрузки
- **Решение:** Добавить preconnect для внешних ресурсов
- **Файл:** `src/app/layout.tsx`
- [ ] Выполнено

#### 18. Hero carousel — расширить превью
- **Проблема:** Только 3 превью (Invoice, Dashboard, Deals)
- **Решение:** Добавить Marketing, Support, AI превью в ротацию
- **Файл:** `src/components/marketing/hero-section.tsx`
- [ ] Выполнено

#### 19. Demo page — анонимизация скриншотов
- **Проблема:** Скриншоты могут содержать реальные данные с ₼
- **Решение:** Проверить все 20 скриншотов в /public/marketing/
- **Файлы:** `public/marketing/*.png`
- [ ] Выполнено

---

### БЛОК D: UX И ДИЗАЙН (20-23)

#### 20. Floating buttons — проверить WhatsApp ссылку
- **Проблема:** WhatsApp кнопка может вести на неправильный номер
- **Решение:** Проверить что ведёт на +994 10 531 30 65
- **Файл:** `src/components/marketing/floating-buttons.tsx`
- [ ] Выполнено

#### 21. Mobile responsive — аудит модулей
- **Проблема:** Module showcase с AppShell превью может плохо выглядеть на мобильных
- **Решение:** Проверить все 11 модулей на мобильном разрешении
- **Файл:** `src/components/marketing/module-showcase.tsx`
- [ ] Выполнено

#### 22. CTA consistency
- **Проблема:** Разные CTA: "Demo tələb et", "Pulsuz sınaq başlat", "Başla", "Satışla əlaqə"
- **Решение:** Унифицировать primary/secondary CTA по всему сайту
- **Файлы:** hero, pricing, cta-banner, footer
- [ ] Выполнено

#### 23. Loading states
- **Проблема:** Нет skeleton/loading при навигации между страницами
- **Решение:** Добавить loading.tsx для маркетинг layout
- **Файл:** `src/app/(marketing)/loading.tsx`
- [ ] Выполнено

---

### БЛОК E: SEO И РОСТ (24-25)

#### 24. Structured Data — расширить
- **Проблема:** Есть SoftwareApplication, но нет Organization, FAQ, BreadcrumbList
- **Решение:** Добавить FAQ schema на /home, Organization на /about
- **Файлы:** home/page.tsx, about/page.tsx
- [ ] Выполнено

#### 25. Open Graph — для каждой страницы
- **Проблема:** OG image только одна общая
- **Решение:** Уникальные OG title/description для /demo, /plans, /contact, /about
- **Файлы:** Каждый page.tsx
- [ ] Выполнено

---

## Порядок выполнения (рекомендуемый)

**Волна 1 (критичные):** 1 → 2 → 3 → 4 → 6 → 5 → 7 → 8
**Волна 2 (текст):** 9 → 10 → 12 → 11 → 13
**Волна 3 (техническое):** 14 → 15 → 16 → 17 → 18 → 19
**Волна 4 (UX):** 20 → 21 → 22 → 23
**Волна 5 (SEO):** 24 → 25
