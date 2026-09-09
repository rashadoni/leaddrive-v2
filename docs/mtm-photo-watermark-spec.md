# MTM Photo Watermark + EXIF — Спецификация

> **Версия:** 1.0 draft, 2026-05-21
> **Цель:** каждое фото от агента содержит видимый watermark и EXIF метаданные с timestamp + GPS + agent + customer — как доказательство визита.

---

## 1. Контекст

Сейчас (v1.1.2) `MTMobileApp/src/components/PhotoCaptureModal.tsx` снимает фото и загружает на сервер без watermark и без записи координат в EXIF.

effie это делает — на каждом фото видны метаданные (proof of visit). Это базовая функция «легального подтверждения визита» — без этого supervisor не может верить, что агент реально был в магазине.

---

## 2. Что должно быть на фото

### Видимый watermark (правый нижний угол)
- **1-я строка:** дата + время (e.g., `21.05.2026 10:42`)
- **2-я строка:** имя агента + ID (e.g., `Айдын Мамедов (#A042)`)
- **3-я строка:** название магазина (e.g., `Bravo Supermarket #15`)
- **4-я строка:** координаты (e.g., `40.4093°N 49.8671°E`)

Цвет: белый текст с тёмной полупрозрачной подложкой (RGBA 0,0,0,0.6). Размер 14pt на оригинальном разрешении.

### EXIF тэги
- `DateTimeOriginal`: timestamp
- `GPSLatitude`, `GPSLongitude`, `GPSLatitudeRef`, `GPSLongitudeRef`
- `Make`: `LeadDrive MTM`
- `Model`: `v1.1.2`
- `Software`: `LeadDrive MTM Mobile`
- `ImageDescription`: JSON-string `{"agentId":"...","visitId":"...","customerId":"..."}`

---

## 3. Реализация (mobile)

### Библиотека
**`react-native-image-marker`** (v3.x):
- Умеет накладывать текст и shapes на изображение
- Поддерживает background для текста
- Открытая, активная

Альтернатива: `@react-native-community/photo-view` — но он только для view, не для редактирования.

### Workflow в `PhotoCaptureModal.tsx`

```typescript
import ImageMarker from 'react-native-image-marker';
import ExifReader from 'react-native-exif';  // или piexif

async function captureAndProcess() {
  // 1. Take photo via VisionCamera
  const photo = await camera.current.takePhoto({ flash: 'auto' });

  // 2. Get current GPS (we already track via background)
  const location = await getCurrentLocation();

  // 3. Get current agent + visit + customer from store
  const { agent, currentVisit, currentCustomer } = useVisitStore.getState();

  // 4. Compose watermark text
  const now = new Date();
  const watermarkText = [
    `${formatDate(now)} ${formatTime(now)}`,
    `${agent.name} (#${agent.code})`,
    currentCustomer?.name || 'No customer',
    `${location.latitude.toFixed(4)}°N ${location.longitude.toFixed(4)}°E`
  ].join('\n');

  // 5. Apply watermark
  const watermarkedPath = await ImageMarker.markText({
    backgroundImage: { src: { uri: `file://${photo.path}` } },
    watermarkTexts: [{
      text: watermarkText,
      position: { position: 'bottomRight' },
      style: {
        color: '#FFFFFF',
        fontSize: 14,
        fontName: 'Arial',
        textBackgroundStyle: {
          paddingX: 8,
          paddingY: 6,
          color: 'rgba(0,0,0,0.6)'
        }
      }
    }],
    quality: 90,
    saveFormat: 'jpg'
  });

  // 6. Write EXIF
  await writeExif(watermarkedPath, {
    DateTimeOriginal: now.toISOString(),
    GPSLatitude: location.latitude,
    GPSLongitude: location.longitude,
    Make: 'LeadDrive MTM',
    Model: 'v1.1.2',
    Software: 'LeadDrive MTM Mobile',
    ImageDescription: JSON.stringify({
      agentId: agent.id,
      visitId: currentVisit?.id,
      customerId: currentCustomer?.id,
      watermarked: true
    })
  });

  // 7. Upload to server (existing logic in api.uploadPhoto)
  await api.uploadPhoto(watermarkedPath, {
    agentId: agent.id,
    visitId: currentVisit?.id,
    customerId: currentCustomer?.id,
    category: photoCategory,
    latitude: location.latitude,
    longitude: location.longitude
  });
}
```

### Производительность
- Watermarking + EXIF на средне-современном Android ≤2 сек на фото 4032×3024
- Если позже понадобится — компрессия до 1920×1080 → ~500KB вместо ~3MB

---

## 4. Backend валидация

В `src/app/api/v1/mtm/photos/route.ts` POST:
1. Принять file
2. Прочитать EXIF через `exifr` или `sharp.metadata()`
3. Проверить:
   - GPS координаты совпадают с `req.body.latitude/longitude` ± 50 метров (anti-tampering)
   - `Software` = `LeadDrive MTM Mobile`
   - `ImageDescription` содержит agentId который соответствует authenticated user
4. Если проверка не прошла:
   - В `MtmPhoto.status = 'PENDING'` (требует ручной проверки)
   - В `MtmPhoto.reviewNote = 'EXIF mismatch'`
   - Log в `MtmAuditLog`

5. Если прошла:
   - `MtmPhoto.status = 'APPROVED'`
   - `MtmPhoto.hasWatermark = true`

### Изменения в `MtmPhoto`
```prisma
model MtmPhoto {
  // ... существующие поля ...

  // Уже есть:
  // hasWatermark Boolean @default(false)

  // Добавить:
  exifData      Json?    // полный EXIF для аудита
  watermarkedAt DateTime?
  gpsMatchedAt  DateTime?  // когда verified GPS совпадает с claim
  tamperingDetected Boolean @default(false)
}
```

---

## 5. Edge cases

### GPS недоступен в момент съёмки (в подвале, без сигнала)
- Использовать last known location если ≤ 5 минут назад
- Иначе — watermark показывает `GPS unavailable`, EXIF записывает только timestamp
- Backend принимает но помечает `hasWatermark: true, gpsMatchedAt: null`
- Supervisor видит в UI badge «GPS не зафиксирован»

### Time на устройстве неправильное
- Сравнить device clock с server time при authentication
- Если разница > 5 минут — UI предупреждение «Часы не синхронизированы», предлагает поправить через NTP
- Backend перезаписывает EXIF DateTimeOriginal с server-side timestamp если drift > 5 мин

### Фото добавлено из галереи (не свежее)
- На старте — запретить добавление из галереи (только VisionCamera)
- В будущем — детектить через EXIF.DateTimeDigitized vs current и помечать как «archive»

---

## 6. Acceptance criteria

- [ ] Каждое новое фото от агента содержит watermark в правом нижнем углу
- [ ] EXIF содержит все 7 ключевых тегов
- [ ] Backend валидация работает: фото без watermark/правильного EXIF попадает в PENDING
- [ ] При отсутствии GPS — watermark с `GPS unavailable`, фото проходит без блокировки
- [ ] Watermark не теряется при последующих изменениях фото на сервере
- [ ] Тесты:
  - Snapshot тест watermark layout
  - Unit test EXIF validator с 5 примерами (valid, invalid GPS, invalid software, tampered, missing)

---

## 7. Production deployment

- Apk minor bump: v1.1.2 → v1.2.0 (новая фича)
- Backend: backward-compatible — старые фото без watermark остаются как есть
- Migration: добавить поля в `MtmPhoto` через миграцию (default values for existing rows)

---

## История изменений

| Дата | Изменение |
|---|---|
| 2026-05-21 | Создан v1 |
