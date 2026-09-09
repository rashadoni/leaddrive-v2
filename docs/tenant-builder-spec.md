# LeadDrive CRM — Tenant Builder (Client Provisioning System)

## Цель
Автоматическое создание нового клиента SaaS за 30 секунд через админ-панель.

## Пользовательский сценарий

1. Админ (Rashad) заходит на `admin.leaddrivecrm.org`
2. Нажимает "New Client"
3. Заполняет форму:
   - **Company Name**: Acme Corp
   - **Slug**: `acme` → `acme.leaddrivecrm.org`
   - **Admin Email**: admin@acme.com
   - **Admin Name**: John Doe
   - **Plan**: Basic / Pro / Enterprise
   - **Branding** (optional): logo, primary color
   - **Features** (optional): какие модули включены
4. Нажимает **"Build"**
5. Система автоматически:
   - Создаёт `Organization` в БД
   - Создаёт admin-пользователя (временный пароль)
   - Создаёт MTM агента (если включён MTM модуль)
   - Добавляет DNS A-запись `acme.leaddrivecrm.org` через Cloudflare API
   - SSL покрывается wildcard `*.leaddrivecrm.org`
   - Отправляет welcome-email клиенту с логином
6. `acme.leaddrivecrm.org` работает через 30 секунд

---

## Архитектура

### Вариант А — Shared Server (для старта)
```
*.leaddrivecrm.org → 13.140.132.245 → Nginx → Next.js (один инстанс)
```
- Все клиенты на одном сервере, одной БД
- Изоляция через `organizationId` (уже есть)
- Middleware определяет org по субдомену из `Host` header
- Деплой один раз = все клиенты обновились
- Дёшево, просто, масштабируется до ~50 клиентов

### Вариант Б — Dedicated Servers (для крупных клиентов)
```
bigcorp.leaddrivecrm.org → отдельный VDS → свой Next.js + своя БД
```
- Полная изоляция данных
- Builder поднимает Docker-контейнер или VDS
- Дороже, но для enterprise клиентов

### Гибридный подход (рекомендуемый)
- Мелкие клиенты (Basic/Pro) → Shared server
- Крупные клиенты (Enterprise) → Dedicated server
- Builder поддерживает оба режима

---

## Необходимые изменения

### 1. DNS — Wildcard запись
```
*.leaddrivecrm.org → A → 13.140.132.245
```
- Настроить в Cloudflare один раз
- Или автоматизировать через Cloudflare API (zone_id + API token)

### 2. Nginx — Wildcard vhost
```nginx
server {
    listen 443 ssl;
    server_name ~^(?<subdomain>.+)\.leaddrivecrm\.org$;
    
    ssl_certificate     /etc/letsencrypt/live/leaddrivecrm.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/leaddrivecrm.org/privkey.pem;
    
    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Subdomain $subdomain;
    }
}
```

### 3. SSL — Wildcard сертификат
```bash
certbot certonly --dns-cloudflare \
  -d "leaddrivecrm.org" \
  -d "*.leaddrivecrm.org" \
  --dns-cloudflare-credentials /etc/cloudflare.ini
```

### 4. Middleware — Subdomain routing
```typescript
// src/middleware.ts
function getSubdomain(host: string): string | null {
  const match = host.match(/^(\w+)\.leaddrivecrm\.org$/)
  return match ? match[1] : null
}

// В middleware:
const subdomain = getSubdomain(req.headers.get('host') || '')
if (subdomain && subdomain !== 'app') {
  // Найти org по subdomain slug
  // Подставить orgId в контекст
}
```

### 5. Prisma Schema — Дополнения
```prisma
model Organization {
  // Уже есть:
  id        String
  name      String
  features  Json
  branding  Json
  
  // Добавить:
  slug         String   @unique  // "leaddrive", "acme"
  subdomain    String   @unique  // "leaddrive.leaddrivecrm.org"
  plan         String   @default("basic")  // basic, pro, enterprise
  isActive     Boolean  @default(true)
  provisionedAt DateTime?
  
  // Для dedicated серверов:
  serverType   String   @default("shared")  // shared, dedicated
  serverIp     String?
  serverDomain String?  // Для клиентов со своим доменом (fanum.tech)
}
```

### 6. Admin Panel — страницы
```
/admin/tenants              — список клиентов
/admin/tenants/new          — форма создания
/admin/tenants/[id]         — детали клиента
/admin/tenants/[id]/edit    — редактирование
```

### 7. API endpoints
```
POST   /api/v1/admin/tenants          — создать клиента
GET    /api/v1/admin/tenants          — список клиентов
GET    /api/v1/admin/tenants/:id      — детали
PUT    /api/v1/admin/tenants/:id      — обновить
DELETE /api/v1/admin/tenants/:id      — деактивировать
POST   /api/v1/admin/tenants/:id/dns  — создать DNS запись
```

### 8. Provisioning Script (что делает "Build")
```typescript
async function provisionTenant(data: TenantInput) {
  // 1. Создать Organization в БД
  const org = await prisma.organization.create({
    data: {
      name: data.companyName,
      slug: data.slug,
      subdomain: `${data.slug}.leaddrivecrm.org`,
      plan: data.plan,
      features: getDefaultFeatures(data.plan),
      branding: { primaryColor: data.color || '#6C63FF', logo: null },
      provisionedAt: new Date(),
    }
  })
  
  // 2. Создать admin-пользователя
  const tempPassword = generatePassword()
  const user = await prisma.user.create({
    data: {
      name: data.adminName,
      email: data.adminEmail,
      passwordHash: await hash(tempPassword, 12),
      role: 'admin',
      organizationId: org.id,
    }
  })
  
  // 3. DNS (Cloudflare API) — только если shared server
  if (data.serverType === 'shared') {
    await cloudflareApi.createDnsRecord({
      type: 'A',
      name: `${data.slug}.leaddrivecrm.org`,
      content: process.env.SHARED_SERVER_IP,
      proxied: true,
    })
  }
  
  // 4. Welcome email
  await sendEmail({
    to: data.adminEmail,
    subject: `Your LeadDrive CRM is ready!`,
    body: `
      Login: ${data.slug}.leaddrivecrm.org
      Email: ${data.adminEmail}
      Password: ${tempPassword}
      
      Please change your password after first login.
    `
  })
  
  // 5. Обновить registry.json (для скриптов)
  await updateRegistry(org)
  
  return { org, user, url: `https://${data.slug}.leaddrivecrm.org` }
}
```

---

## Plan-based Features

```typescript
const PLAN_FEATURES = {
  basic: {
    maxUsers: 5,
    maxContacts: 1000,
    modules: ['companies', 'contacts', 'deals', 'tasks'],
    ai: false,
    whatsapp: false,
    mtm: false,
  },
  pro: {
    maxUsers: 25,
    maxContacts: 10000,
    modules: ['companies', 'contacts', 'deals', 'tasks', 'tickets', 'finance', 'campaigns'],
    ai: true,
    whatsapp: true,
    mtm: false,
  },
  enterprise: {
    maxUsers: -1, // unlimited
    maxContacts: -1,
    modules: 'all',
    ai: true,
    whatsapp: true,
    mtm: true,
    customDomain: true,
    dedicatedServer: true,
  }
}
```

---

## Безопасность

- Admin panel доступен ТОЛЬКО для super-admin (role: 'superadmin')
- Slug валидация: только `[a-z0-9-]`, 3-30 символов
- Проверка уникальности slug перед созданием
- Rate limiting на provisioning (не более 10 клиентов в час)
- Tenant isolation: middleware ВСЕГДА проверяет orgId
- Reserved slugs: `app`, `admin`, `api`, `www`, `mail`, `ftp`, `static`

---

## Зависимости

- **Cloudflare API**: npm `cloudflare` — для DNS управления
- **Wildcard SSL**: certbot + cloudflare plugin
- **Email**: nodemailer (уже есть в проекте)

---

## Порядок реализации

### Phase 1: Инфраструктура
1. Wildcard DNS в Cloudflare (`*.leaddrivecrm.org`)
2. Wildcard SSL сертификат
3. Nginx wildcard vhost
4. Добавить `slug` и `subdomain` в Organization модель
5. Middleware: subdomain → orgId routing

### Phase 2: Admin Panel
6. Super-admin роль и guard
7. `/admin/tenants` — CRUD страницы
8. API endpoints для управления клиентами
9. Provisioning script

### Phase 3: Автоматизация
10. Cloudflare API интеграция
11. Welcome email шаблон
12. Автоматическое обновление registry.json
13. Dashboard: статус клиентов, usage metrics

### Phase 4: Billing интеграция
14. Stripe подписки per tenant
15. Plan upgrade/downgrade
16. Usage-based billing (контакты, пользователи)
17. Auto-suspend при неоплате

---

## Миграция текущих клиентов

1. LeadDrive → добавить `slug: "leaddrive"` в Organization
2. Создать DNS: `leaddrive.leaddrivecrm.org → 13.140.132.245`
3. `app.leaddrivecrm.org` остаётся как golden image / demo
4. Fanum → `serverType: "dedicated"`, `serverDomain: "fanum.tech"`
