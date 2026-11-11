# Звонки WhatsApp на линию заказов (2026-11-12)

Владелец: «звонить на WhatsApp и делать заказы, как по SIP-номеру, тем же ИИ».

```
аптека (WhatsApp) → Meta SIP (TLS, SRTP SDES, Opus)
   → wa-sip.leaddrivecrm.org:5061 — Asterisk на проде (13.140.132.245), Opus → PCMA
   → станция Зейтуна (сама регистрируется на проде по TLS, из-за NAT)
   → [from-wa-relay] → копия маршрута линии с DID 994995111103 → тот же ИИ, перевод, запись, заказ
```

## Что где

| Где | Что |
|---|---|
| прод `/etc/asterisk/*` | копия в `prod/` (пароли — `__SECRET__`; настоящие в `/etc/asterisk-secrets/`, root 0600) |
| прод ufw | 5061/tcp и 20000–20398/udp |
| прод сертификат | Let's Encrypt `wa-sip.leaddrivecrm.org`, продление — certbot, хук `prod/certbot-deploy-hook.sh` |
| DNS | `wa-sip` A 13.140.132.245, **DNS only** (через прокси Cloudflare SIP не ходит) |
| станция | `install.sh` (пакет в `~/wa-relay`): транк `wa-relay`, маршрут `dialplan-wa-relay.conf`, `/run/fanum-whatsapp-calls` |
| Meta | номер: `calling.sip` = ENABLED, сервер `wa-sip.leaddrivecrm.org:5061`, `srtp_key_exchange_protocol` = SDES |

## Правила

- **Маршрут WhatsApp на станции — копия маршрута линии**, сделанная `make-wa-dialplan.py`:
  общий `fanum-inbound-browser.conf` установщик сверяет построчно, править его нельзя.
  Поменяли общий маршрут — пересоберите копию (`make-wa-dialplan.py fanum-inbound-browser.conf >
  dialplan-wa-relay.conf`) и поставьте `install.sh`; тест `WhatsAppMarkTests` краснеет, если забыть.
- **Пометка звонка WhatsApp**: ИИ-нога копии пишет `/run/fanum-whatsapp-calls/<callId>` до
  AudioSocket, ядро (`zeytun_whatsapp_call`) читает её и **не выбрасывает речь звонящего, пока
  говорит ИИ**: эхо гасит само приложение WhatsApp. Звонок владельца 2026-11-12: фильтр речи
  выбросил 1,3 с его слов поверх ИИ; с пометкой — 0.
- **Meta входит без пароля, только из сетей Meta** (`meta-identify`): на наш digest-вызов Meta
  отвечает подписью, которая не сходится при верном пароле (`Failed to authenticate`), а сам вызов
  Meta называет необязательным. Пароль Meta лежит в `meta-auth` для исходящих.
- **Станция ходит на прод по IP, а не по имени**: свой DNS Asterisk на станции отвечает
  «No answer record» на `wa-sip.leaddrivecrm.org`. Поэтому `verify_server=no`; учётку держит пароль.
- **Номер в режиме SIP не работает с Graph API**: пока SIP включён, звонки WhatsApp этого номера не
  приходят в браузер CRM и не набираются из «Входящих». Выключить — `calling.sip.status` = DISABLED
  (сервер Meta сохраняет).
- **Номер Зейтуна (+994 99 301 29 14)** звонки пока не может: лимит 250, Meta отвечает
  138015 «Calling cannot be enabled». Нужна верификация компании Зейтуна в Meta Business.
- Замер 2026-11-12 (звонок владельца, запись на проде): потерь RTP 0 на обоих участках, голос из
  WhatsApp распознаётся дословно — путь звук не портит.
