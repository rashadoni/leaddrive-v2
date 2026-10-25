# Task → meeting browser evidence

The real TaskForm and TaskMeetingNotice were mounted in an isolated Vite harness.
Session, Next link navigation and API responses are synthetic adapters; no
customer data or external sends were used. Fixture PATCH replies409 and does
not reach a real backend. The preview binds only127.0.0.1:4181 and was stopped.

browser-result.json records1440px and390px, desktop and dark mobile, keyboard
focus/44px action, authorized exact meeting navigation/closing the edit form,
localized conflict keeping the dialog open, denied identity absent and503retry.
The three screenshots were inspected as component evidence. The assertions
cover the new notice/navigation and form overflow, not a full contrast review
of every existing form control. Full app/production role browser E2E, screen
reader/axe and live provider/customer writes are NOT RUN.
