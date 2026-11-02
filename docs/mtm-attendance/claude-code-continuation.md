# Передача Claude Code — MTM attendance, 2026-10-14

Передача явно запрошена пользователем: «у тебя уже мало лимитов передай работу клауд код». Claude Code открыт у пользователя в терминале **Mac**. На `remote-alt` команды `claude` нет. Codex не запускал Claude и не утверждает, что передача уже принята. Этот файл — ручная передача по прямому поручению, исключение из обычного auto-handoff OFF. Историю и прежние записи не удалять.

## Начать здесь

С Mac использовать уже настроенный SSH alias `remote-alt`. Работа выполняется на Contabo как `codex-alt`, не на Mac и не на production. Продолжать **в существующем рабочем каталоге**, не в грязном каноническом checkout:

```text
/home/codex-alt/.codex/worktrees/mtm-attendance-approval/leaddrive-v2
branch: codex/mtm-attendance-overtime
origin: https://github.com/rashadoni/leaddrive-v2.git
```

Запустить `codex-project-context`, прочитать AGENTS.md, CLAUDE.md, этот файл и последние записи §10 `docs/mtm-attendance/README.md`. Финальный commit передачи найти через `git log -1`; предыдущий checkpoint был `7a43315b0`. Основной журнал append-only. Не переносить работу в `/home/codex-alt/projects/leaddrive-v2`: он содержит чужие изменения.

## Точная точка остановки

- В 06:41:57 UTC Codex завершил управление телефоном: **официальный 3.8.6 / 1477**, язык **az**, экран завершённого дня **Fictional office employee**. Тестовый пользователь ещё вошёл. Новых отметок при подготовке передачи не сделано.
- Ни одного работающего драйвера UI больше нет. Последний драйвер локалей остановлен по запросу передачи; эксклюзивный lock освобождён. Не запускать два UI-драйвера одновременно.
- Уже физически PASS все семь старых уведомлений на **az, ru и en**, с сохранением read/unread. AZ PASS 06:23:13 и 06:28:09, RU 06:37:19, EN 06:40:06. Все три экрана просмотрены Codex. Обратное переключение на AZ выполнено, но **холодный перезапуск на AZ и финальное побайтовое сравнение серверных уведомлений/дней/заявок после обновления ещё НЕ завершены**.
- **Выход OFFICE, восстановление сети/исходных разрешений/питания и окончательная сводка наблюдения ещё НЕ выполнены.** Не заявлять обратное.
- В финальный checkpoint передачи добавлены пять уже полученных результатов (два AZ, RU, EN и остановка управления телефоном) и просмотренные снимки RU/EN. Файл `evidence/device/s23-acceptance.json` сохраняет статус `IN_PROGRESS` и всю прежнюю историю. Не импортировать эти результаты повторно; для следующих использовать пару `(name, at)`.
- CRM PR757 слит обычным exact-head merge; deployment **38521796585** на **0c57db3af92c1c9558c466a59c9403bae5a936d6** ещё выполнялся. Последний snapshot: Quality & security SUCCESS 06:40:49 UTC; Production build — `Build Next.js standalone`. Новый runtime SHA ещё не подтверждён. GitHub workflow продолжает работать самостоятельно. Read-only монитор Codex остановлен.
- До этого последний подтверждённый production SHA — **8c54afe632181b15d4bb4cb88ee1953a6a72cd4f**. Не путать merge с развёртыванием.

## Пользовательские решения и вопросы

- Работать автономно до завершения, исправлять найденное, проходить проверки и нормальный выпуск. Прежнее ожидание «давай» для макетов заменено более поздним прямым поручением работать автономно.
- Все активные пользователи CRM автоматически участвуют в учёте; выборочные исключения допустимы. Не требовать ручного создания 300 карточек и причины для обычного включения.
- HR раздел слева, без стены оранжевых ссылок. Уже реализован и проверен.
- Email-получателей по умолчанию нет; добавление опционально. Внешних писем не отправлять без адресата.
- Утверждённого геосогласия нет: **сбор места выключен**. Не утверждать текст самостоятельно.
- Оставить Excel/PDF; специальный бухгалтерский формат клиент согласует позже.
- На телефоне идёт тест в отдельной вымышленной компании. Реальный рабочий день пользователя **не завершать**; рабочая учётная запись пользователя была предварительно синхронизирована и разлогинена, её роль не менялась.
- Последние вопросы пользователя: будет ли два приложения, почему на телефоне нет маршрутов/задач, как отличать полевого от обычного работника, если он не ходит по филиалам. Ответ: **одно LeadDrive MTM**, разные экраны по роли; сейчас открыт тестовый OFFICE, поэтому полевых экранов нет. Обычный работник может быть в офисе, одном филиале или удалённо, филиал необязателен. Перемещение между филиалами само по себе не делает его полевым. Основной филиал: `Kadr uçotu → Filiallar → Əməkdaşların əsas filialı`. Участие в табеле и роль MTM независимы; в кадровом списке отдельного переключателя office/field пока нет. Роли AGENT/SUPERVISOR/MANAGER доступны в AgentForm. **Нового поручения менять модель ролей/делать второе приложение не было.**

## Что уже выпущено и проверено

### Mobile

- Репозиторий `rashadoni/leaddrive-mtm`. Последняя правка уведомлений PR131: https://github.com/rashadoni/leaddrive-mtm/pull/131.
- Worktree `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/mtm-inbox-language`, branch `codex/mtm-inbox-language`, reviewed head **120a3cf997a865d65ea42f253891cc355616fdb0**. Не вносить новые source changes без реальной причины.
- Main merge **41be7fd45c9033062509eee22a6cbf31fcffeb9c**, official release **38520367175 SUCCESS**, tag **v3.8.6-build477**, code **1477**. PR CI38519311958 и candidate APK38519311797 SUCCESS; main повторил **224 suites / 1890 PASS / 1 existing TODO**, TypeScript и проверку установленного release certificate APK/AAB.
- Установленный APK `/tmp/mtm-s23-release477/leaddrive-mtm-v3.8.6.apk`, **46743455 bytes**, SHA256 **fde8f10acfd8a6d0eac99722b953a53cdef1559e27373190be8a814a74407ef5**. Установлен `install -r`, appdata не очищались.
- Публичный файл: https://github.com/rashadoni/leaddrive-mtm/releases/download/v3.8.6-build477/leaddrive-mtm-v3.8.6.apk.
- Правка: server сохраняет заголовок на языке профиля получателя, mobile имеет независимый язык. DTO теперь выводит finite presentation keys из whitelisted metadata; экран локализует по текущему языку, raw stored text остаётся fallback. APPROVED нейтральный, потому что metadata также используется HR_RECORD. Guard/read права, сами уведомления и решения не переписывались.
- Ранее PR130 / main d8bf95c5 / official3.8.5 исправил цикл Android permission prompts: фактические пять HOME/foreground циклов при запрещённых GPS PASS. PR129 исправил автоматический повтор очереди в foreground; исходный START был принят с исходным временем после CRM UTC fix. Старые FAIL сохранены.

### CRM

- PR757 https://github.com/rashadoni/leaddrive-v2/pull/757, exact reviewed **a311e3adfbb87b4995f50f9c9226f16083a2437d**. Все пять required checks SUCCESS, плюс новый E2E **38519179501: 62 PASS / 0 FAIL / 5 NOT_RUN**. Artifact11874230197, manifest SHA256 **ac862142ce4ea5cf3a82c65daf97cd0c58b0387f95ca44737404b149e19e5fe7**. Safe receipt в репозитории `evidence/e2e/release-757-hosted-run.json` и `/tmp/mtm-physical-s23/release757-hosted-review.json`.
- Normal merge06:22:06UTC→**0c57db3af92c1c9558c466a59c9403bae5a936d6**. Release **38521796585** ещё надо проверить.
- Acceptance worktree `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/mtm-attendance-acceptance-evidence`, branch `codex/mtm-attendance-acceptance-evidence`, head a311e3adf. Код: единственный formatter change в `src/lib/mtm/attendance-risk-table.ts` — существующий `formatDateTime` вместо native az Intl, исправляет `2026 M10 14`; шесть новых meaningful tests, суммарно56targetedPASS/lint. Эти два source/test файла НЕ представлены в старой continuation branch; source truth — merged main/acceptance worktree. Не мержить весь старый continuation branch заново.
- PR756 ранее исправил UTC date-инвариант и bounded formatter cache для annual leave. Main8c54, deployment38504073106SUCCESS и production smokePASS. Exact32b E2E38501754397:62PASS; nonUTC38501754422: две ожидаемые baseline failures, затем53fixedPASS.

## Фактическая бизнес-проверка S23

Все записи принадлежат вымышленной компании; повторять мутации **не нужно**.

- FIELD и OFFICE: START, PAUSE, cold restart сохранил паузу, RESUME, отмена FINISH, offline FINISH + cold restart + автоматическая доставка исходного времени, REOPEN/RESUME и последний FINISH. По **семь канонических событий**; нет дублей, VALID, без координат.
- FIELD day `wd-1791935425480-lssidppb`, исходный START 2026-10-13T23:50:25.480Z принят автоматически позже без новой отметки. После HR correction03:50–08:25Baku, worked16203s, pause297s.
- OFFICE day `wd-1791953007238-vybecqgr`, originalSTART04:43:27.238Z; после correction08:43–08:49Baku, worked241s, pause119s.
- **16 уникальных заявок, по8типов на роль**: annual leave, sick leave, time off, hourly absence, business trip, remote work, overtime, time correction. Итог12APPROVED/2REJECTED/2CANCELLED. Реальные формы телефона и HR браузер; даты/часы/ownership/notes/reviewer/cancellation сверены.
- По одной REQUEST_APPROVAL correction, все оригинальные события и паузы сохранены. После исправления повторное открытие дня отказано; **не повторять этот мутирующий сценарий**, markers уже есть.
- Actual HR report Excel/PDF обоих сотрудников совпадает; PDF визуально просмотрены. Реальный общий S23 породил6SHARED_INSTALLATION findings, проверены фильтры и все строки. Их даты до PR757 показывалиM10; после release проверить снова.
- FIELD SyncCentre0pending/0conflicts/0media, cancel logout и actuallogout PASS. OFFICE общего счётчика очереди **нет: NOT_OBSERVABLE**, перед выходом сверить все покрытые действия, не утверждать скрытый total0.
- OFFICE inbox read persisted после перезапуска; seven notices unchanged read flags на3.8.6AZ/RU/EN PASS. Финальный upgrade readback/coldrestart пока pending.
- **3.8.5** endurance05:27:40–05:53:04UTC,1524seconds,5HOME/foreground cycles,5реальных inboxrefreshes и канонических сравненийPASS. Это bounded25минут, **не непрерывное функциональное тестирование всю ночь**, и не relabel as3.8.6.

## Телефон и приватное окружение

- ADB: `adb -H 127.0.0.1 -P 35037`; SamsungSM-S918B/Android16/1080×2316; package`com.mtmobileapp/.MainActivity`. Серийный номер не публиковать.
- На Mac уже работает туннель `adb start-server && caffeinate -i ssh -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -N -R 127.0.0.1:35037:127.0.0.1:5037 remote-alt`. Пока продолжаете тесты, его не закрывать. Mac productionSSH не требуется.
- Все private helpers/state: `/tmp/mtm-physical-s23` (0700). Credentials/auth state0600; читать локально по необходимости, **не выводить/не копировать в Git/чат**. Не импортировать целую папку: там есть старые личные screenshots/logs. Опубликовывать только просмотренные fictional evidence и finite receipts.
- Fixture origin`https://mtm-attendance-phone.leaddrivecrm.org`, tenant`mtm-attendance-phone-v1`, slug`mtm-attendance-phone`. Три fictionaluserId: mtm-phone-admin-v1, mtm-phone-office-v1, mtm-phone-field-v1. Auto-created OFFICEcard **e01fd028-d0a9-4f78-879b-bdfc7517d0f1**, не выдумывать seedID. FIELDcardmtm-phone-field-card-v1.
- Fixture markers/private auth уже настроены. `web_fixture.mjs context()` проверяет exacttenant/admin. Если sessionпротухла, `node web_fixture.mjs login`; пароль не нужен от пользователя и не печатать. Сборместа/QR/reminders/emailRecipientsOFF. Все реальные бизнес-данные вне scope.
- Текущее питание: stay_on_while_plugged_in15, screen_off_timeout1800000. Оригинал **2/30000**. PIN/биометрия не менялись.
- Fine/coarse/backgroundGPS **временно DENIED** для теста; originalpermissions-before.json содержит исходныеgrants(true). CAMERA/POST_NOTIFICATIONS не менялись. Не выдавать GPS обратно до logoutfictionalaccount.
- Сеть исходноwifi1/data1/airplane0, сейчасonline. `network-before.json` — baseline.
- `mtm-s23-power-watch.service` активен до **07:10UTC2026-10-14**, read-only polling, app-absence допустима. После deadline наблюдение прекращается, но **настройки телефона автоматически не восстанавливаются**. При необходимости продлить bounded transientservice, не изменять systemd-generatedfile. Исторические gaps23:16–23:23 и03:47–03:56UTC сохранить в отчёте.

## Оставшиеся действия в порядке

1. Принять эксклюзивное владение, проверить device connected/currentfictionalAZcompleted; не выполнять никаких новых START/FINISH/request/correction/HRdecisions. Все они уже завершены.
2. Завершить **только** недостающую часть3.8.6: coldrestartAZ, проверить readstate/locale; read-only `node inbox_snapshot.mjs after-locale-upgrade` и `node fixture_snapshot.mjs after-locale-upgrade`, сравнить с `inbox-before-locale-upgrade.json` и `snapshot-before-locale-upgrade.json` (исключить только top-levelat). Baseline7notices и16requests; не изменять readflags. `verify_inbox_locales.py` содержит все assertions и уже исправленное нажатие radio above fixednavbar, но **полный AZ/RU/EN обход заново не нужен**. Он был прерван при возвратеAZ после всех трёхPASS. Создать маленький readonlyfinishhelper на основе его конца или выполнить эту часть вручную; не помечать unrun coldrestartPASS.
3. Последовательно после финального сравнения:

```text
python3 -u /tmp/mtm-physical-s23/office_clean_logout.py
python3 -u /tmp/mtm-physical-s23/final_network_restore.py
python3 -u /tmp/mtm-physical-s23/restore_device_settings.py
python3 /tmp/mtm-physical-s23/summarize_power_endurance.py
```

   Каждый следующий только после успешного предыдущего. Logouthelper сверяет все8OFFICErequests/correctedday, тестируетcancel и единственный confirm с marker. FullprivatequeueNOT_OBSERVABLE. Networkhelper требуетGPSdenied, проверяет wifi/data/airplane. Restorehelper требуетlogoutPASS+fixtureloginform, возвращает только исходные3GPSgrants, camera/notificationsunchanged,2/30000, останавливаетobserver; PIN не трогает. Перед повтором после ошибки прочитатьmarker/currentstate, не делать второйconfirm вслепую.
4. Проверить completedSUCCESS **deploy38521796585** и exact0c57db3a. Никакого manualSSHdeploy. После resourcecheck запустить narrow readonlysmokes (это одна страница, не fullE2E):

```text
node /tmp/mtm-physical-s23/final_release_smoke.mjs 0c57db3af92c1c9558c466a59c9403bae5a936d6
node /tmp/mtm-physical-s23/verify_live_date_fix.mjs 0c57db3af92c1c9558c466a59c9403bae5a936d6
```

   Первый проверяет exactartifactSHA+ping+leavebalances+3automaticemployees. Второй realAZriskpage, actualfilters,6sharedfindings, каждую дату/claimed/receivedclock (`14 okt 2026`, безM10), ready screenshot. Просмотреть `/tmp/mtm-physical-s23/physical-shared-phone-review-after-date-fix.png` прежде чем публиковать/утверждатьvisualPASS.
5. Append fresh finite cases к `evidence/device/s23-acceptance.json`, не стирать семь старыхFAIL/прочуюисторию; импортировать только safe reviewedimages/receipts. Сейчас statusIN_PROGRESS — заменить только после реального завершения с явнымиlimits. Power summary отдельно отfunctionalendurance. Обновить §10README иe2e-scenarios/quick-start при необходимости, checkpointexplicitpaths. Поздние checkpoints root отсутствуют в mergedPR757; не переписывать старуюисторию и не мержить весьстарыйbranch. Если нужнаremoteпубликацияфинальныхdocs — новый cleanmainworktree/PR черезgates; помнить каждыйmainmerge запускаетdeploy, не создавать бессмысленный бесконечный цикл docs-onlydeployment.
6. Обновить descriptions mergedPR131/757 точными фактическими release/phone/smokeresults (ghRESTPATCH сJSONbodyfile; `gh pr edit` в этой среде иногда падает из-за Projectsclassic). Не обещать pendingresults какPASS.
7. Кратко объяснить пользователю: одно приложение; он теперь может выбрать свою компанию и войти под своей рабочейучёткой, refreshCRM; после завершения телефонныхтестов закрыть MacтуннельCtrl+C. В финале дать localguide/journal и видимый continuityblock (статус,последнеедействие,точкаостановки,следующийшаг).

## Важные детали драйверов и границы

- `device_ui.py` берёт flock; не импортировать одновременно в двухпроцессах. `python3 -u` полезен для progress. Нельзя использовать staleuiautomatorXML — helperудаляет только свойscratchпередdump.
- Общий `reveal` допускает textboundsподfixedbottomnavbar. Для Profilelanguage использовать actual`android.widget.RadioButton` с `content-desc` и полностью видимыми bounds выше1900; успешный пример в verify_inbox_locales.py. Первые подвисания/неподтверждённое переключение были driverpremises, не доказанная ошибкапродукта. Положительные title/readassertions не ослаблялись.
- ДляRUrejected сохранённыйservertext законно равенновомупереводу: требоватьtranslatedtitlealways, отрицатьstoredtitle толькоеслиразличаются. Unknownnoticefallbackсохраняется.
- Requestverifier прежнийFAIL:15attemptlogs/16requests, первыйFIELDannualдоattemptlogger. Исправленный verifierстрогоразрешает ровноэтот legacycase поoriginalPASS/snapshot, остальные15строгие. Не дописывать выдуманную историю. Поздний16requestPASSужеесть.
- Helpers fixture_snapshot используют текущийBakuдень. Если продолжение будет после2026-10-14, привязать readonlyсверку к исходнойдате14октября; не создавать новыйдень/не сбрасыватьfixture радиassertion.
- Не повторять field_actions/office_actions/request/review/correction/return-locked helpers. Markers`office-corrected-return-attempted` и`field-corrected-return-attempted` ужеесть. FIELDlogoutвыполнен; старыйFIELDhelper содержитversion3.8.5, его не запускатьна3.8.6.
- NOT_RUN: физическаяcameraQR/document, внешняяпочта/provider/cron, реальныеGPSбезapprovedconsent, нагрузка300сотрудников, полныйcross-productконтролов/ролей/сетей, непрерывнаяфункциональнаяночь, полныйproductionbuildbrowser/productionRedisadmission. Hosted58peoplepagination не300load. Настраиваемыепраздники/нормы невыдаватьзаутверждённые; customaccountingformatотложен; сложнаястатистикапо4.8отложенапланомдонакопленияданных.

## Host/release ограничения

Production единственный registered **13.140.132.245:/opt/leaddrive-v2**, разрешённый путь reviewedfeature→verifiedmain→GitHubActions→SHAartifact→smoke. Читать currentdocs/registry; устаревшиеHetzner/owner/SSHroutesнеиспользовать. MacproductionSSHне нужен. Никакого directservercopy/deploy, forcepush/reset/cleanup. На Contabo не делать fullbuild/fullbrowserE2E/Androidbuild/fulltsc/массовуюиндексацию; тяжёлое толькоhostedCI/разрешённыйephemeralworker. Перед targetedcheck RAM/disk/PSI, один за раз. Только явныепутиstage, checkpointcommits, без`git add .`/`-A`. Не трогать `.codex/sessions`, чужиеworktrees/dirtycanonical. Новыепользовательскиевопросы отвечатьпо-русски, продолжаяавторизованнуюработу; не объявлятьитограньшерезультата.
