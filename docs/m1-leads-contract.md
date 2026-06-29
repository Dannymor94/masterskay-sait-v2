# M1 — Контракт заявки на аренду (backend ↔ frontend)

> Общий контракт для T1-1 (backend) и T1-2…T1-5 (frontend). Источник: SPEC §4/§4.1/§5,
> CLAUDE.md §1 (идемпотентность, формы без JS), docs/arenda-ia.md §5.
> Цель: одна заявка = один лид; повтор того же ключа НЕ создаёт второй лид; форма
> работает с ОТКЛЮЧЁННЫМ JavaScript.

## Эндпоинт
`POST /api/leads/arenda` — Astro-эндпоинт, `export const prerender = false`.
Принимает `application/x-www-form-urlencoded` (нативный submit формы, без JS).
Без персональных данных в URL — всё в теле POST.

## Поля формы (из ArendaForm.astro — не переименовывать)
Служебные (hidden):
- `idempotency_key` — UUID, генерится при РЕНДЕРЕ страницы /arenda (SSR), ДО отправки.
  Становится `lead.id`. НЕ выводить из ответа внешней системы.
- `form_rendered_at` — ISO-таймстемп рендера формы (антиспам: слишком быстрая отправка = бот).
- `source_page` — `/arenda`.
- `cta_origin` — необязательно (какой CTA привёл).
- `company` — **honeypot**. Реальный пользователь не заполняет. Непусто → бот.

Видимые:
- `name` (обязательно), `contact` (обязательно), `activity` (обязательно, select),
  `activity_other` (если activity=Другое), `hall` (radio: big-70|small-30|tea-45|none),
  `format` (обязательно: regular|onetime), `schedule`, `start`, `comment`,
  `consent` (обязательно, =yes).

## Модель lead (SPEC §5, Postgres-ready)
```
lead(
  id          TEXT PRIMARY KEY,   -- = idempotency_key (UUID)
  type        TEXT NOT NULL,      -- 'arenda'
  name        TEXT NOT NULL,
  contact     TEXT NOT NULL,
  payload     TEXT NOT NULL,      -- JSON: activity, activity_other, hall, format,
                                  --       schedule, start, comment, cta_origin
  status      TEXT NOT NULL DEFAULT 'new',
  source_page TEXT,
  created_at  TEXT NOT NULL       -- ISO-8601 (PG: timestamptz default now())
)
```
SQLite сейчас; схема портируемая на Postgres (payload→jsonb, created_at→timestamptz).

## Поведение эндпоинта
1. **Honeypot:** `company` непусто → НЕ создавать лид, тихо ответить как успехом
   (303 → `/arenda/spasibo`). Бот не должен понять, что отсечён.
2. **Время-на-форме:** если `form_rendered_at` отсутствует или (now − rendered) < 2 сек →
   считать ботом, тот же тихий путь, лид не создавать. (Верхний предел не критичен в M1.)
3. **Валидация:** обязательны `name`, `contact`, `activity`, `format`, `consent=yes`;
   при `format=regular` — `schedule` непусто; при `activity=Другое` — `activity_other` непусто;
   `idempotency_key` — непустой UUID.
   - **Ошибка:** ставим flash-cookie `mst_flash` (httpOnly, SameSite=Lax, Path=/, Max-Age=300)
     с JSON `{ errors: {field: msg}, values: {…введённые значения…} }` и делаем
     303 → `/arenda#zayavka`. Страница /arenda читает cookie, восстанавливает значения,
     показывает сообщения у полей + сводку. Cookie очищается после прочтения (ставим пустую).
     ПДн — в cookie (same-origin, кратко живёт), НЕ в URL.
4. **Успех:** `INSERT` лида с `id = idempotency_key`. Дедуп: `INSERT … ON CONFLICT(id) DO NOTHING`
   (или INSERT OR IGNORE). Повтор того же ключа → строка не добавляется (noop), ответ всё равно
   успешный (идемпотентно). Затем 303 → `/arenda/spasibo`.

## PRG (Post/Redirect/Get)
Всегда отвечаем 303-редиректом (успех → /arenda/spasibo; ошибка → /arenda#zayavka).
Защищает от повторной отправки по F5 и даёт корректную цель Метрики на GET /arenda/spasibo.

## Границы владения
- **backend (T1-1):** `web/db/schema.sql` + `web/db/migrations/**`; модуль данных
  `web/src/server/db.ts` (открытие SQLite, инициализация схемы) и `web/src/server/leads.ts`
  (insertArendaLead/getLead/listLeads + дедуп); эндпоинт `web/src/pages/api/leads/arenda.ts`;
  тесты `tests/web/leads-*.test.ts`; вспомогательный `web/scripts/list-leads.mjs` (просмотр лидов
  локально — без публичного GET, чтобы не светить ПДн).
- **frontend (T1-2…T1-5):** `web/src/pages/arenda.astro` (SSR: prerender=false, генерит
  idempotency_key+form_rendered_at, читает flash-cookie, репопуляция+ошибки),
  `web/src/components/ArendaForm.astro` (значения/ошибки), `web/src/pages/arenda/spasibo.astro`
  (страница «спасибо» + цель Метрики), прогрессивный JS-скрипт поверх рабочей формы.
- **НЕ** делать: админку (M2), уведомления/CRM (внешние системы — отдельно, HITL), оплату.

## Метрика (T1-4)
Счётчик 91052806. Цель `arenda_lead` срабатывает на странице `/arenda/spasibo` (GET после успеха).
⚠️ 152-ФЗ: Метрика ставит куки → нужен баннер согласия + /privacy (SPEC §7). В M1 поставить
цель и счётчик; баннер согласия и /privacy — отметить как долг (M3) или согласовать с Даниилом.

## DB-путь
`DATABASE_URL` (формат `file:./db/masterskaya.db`) или дефолт `web/db/masterskaya.db`.
`.db` уже в .gitignore. `.env` создаёт человек (CLAUDE.md §2) — модуль работает и без него по дефолту.
Примечание: `.env.example` сейчас указывает на старый путь `./api/db/…` — обновить (человек).
