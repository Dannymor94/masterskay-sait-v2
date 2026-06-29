# DEPLOY.md — Деплой «Мастерская» на тестовый / продовый сервер

> Деплой выполняет **человек** (Даниил). Агенты описывают шаги, не нажимают кнопки.
> Стек: Node.js 20+, Astro SSR (@astrojs/node standalone), SQLite (better-sqlite3).

---

## 1. Переменные окружения (web/.env на сервере)

Создай файл `/var/www/masterskaya/web/.env` (НЕ коммитить):

```env
# Обязательно
ADMIN_PASSWORD_HASH=scrypt$...   # node scripts/hash-password.mjs 'пароль'
SESSION_SECRET=...               # openssl rand -hex 32

# Опционально (дефолты работают без них)
ADMIN_USER=admin
DATABASE_URL=file:./db/masterskaya.db
PORT=4321
HOST=127.0.0.1
```

Как получить ADMIN_PASSWORD_HASH:
```bash
cd /var/www/masterskaya/web
node scripts/hash-password.mjs 'твой-пароль'
# Скопируй строку ADMIN_PASSWORD_HASH=scrypt$... в .env
```

---

## 2. Первый запуск на сервере

```bash
# 1. Клонировать репо
git clone https://github.com/Dannymor94/masterskay-sait-v2.git /var/www/masterskaya
cd /var/www/masterskaya/web

# 2. Установить зависимости
npm ci --omit=dev

# 3. Собрать (если не собирали локально)
npm run build

# 4. Создать .env (см. раздел 1)
nano .env

# 5. Засеять БД (один раз)
node scripts/seed.mjs
node scripts/load-content.mjs

# 6. Проверить healthcheck
node dist/server/entry.mjs &
curl http://localhost:4321/api/healthz
# Ожидаем: {"status":"ok","version":"1.0.0","db":"ok"}
```

---

## 3. systemd-юнит (рекомендуется)

Создай `/etc/systemd/system/masterskaya.service`:

```ini
[Unit]
Description=Masterskaya — центр практик (Astro SSR)
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/masterskaya/web
EnvironmentFile=/var/www/masterskaya/web/.env
ExecStart=/usr/bin/node dist/server/entry.mjs
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=masterskaya

# Безопасность
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable masterskaya
sudo systemctl start masterskaya
sudo systemctl status masterskaya

# Логи:
sudo journalctl -u masterskaya -f
```

---

## 4. pm2 (альтернатива systemd)

```bash
npm install -g pm2

# pm2.config.cjs в web/:
```

Создай `web/pm2.config.cjs`:
```js
module.exports = {
  apps: [{
    name: 'masterskaya',
    script: 'dist/server/entry.mjs',
    cwd: '/var/www/masterskaya/web',
    env_file: '.env',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    error_file: '/var/log/masterskaya/err.log',
    out_file: '/var/log/masterskaya/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
```

```bash
pm2 start pm2.config.cjs
pm2 save
pm2 startup   # следуй инструкциям для автозапуска
pm2 logs masterskaya
```

---

## 5. Nginx reverse-proxy + Let's Encrypt

### nginx: /etc/nginx/sites-available/masterskaya

```nginx
server {
    listen 80;
    server_name yoga-rostov-mst.ru www.yoga-rostov-mst.ru;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yoga-rostov-mst.ru www.yoga-rostov-mst.ru;

    ssl_certificate     /etc/letsencrypt/live/yoga-rostov-mst.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yoga-rostov-mst.ru/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # Безопасность
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    # Статика Astro (из dist/client/) — кэш 1 год для хешированных файлов
    location /_astro/ {
        alias /var/www/masterskaya/web/dist/client/_astro/;
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # Публичные файлы (шрифты, img, robots.txt, sitemap.xml)
    location /fonts/ {
        alias /var/www/masterskaya/web/dist/client/fonts/;
        expires 1y;
        add_header Cache-Control "public";
        access_log off;
    }

    location ~* \.(txt|xml|ico|webmanifest)$ {
        root /var/www/masterskaya/web/dist/client;
        expires 1d;
    }

    # SSR — проксируем на Node
    location / {
        proxy_pass http://127.0.0.1:4321;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 30s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/masterskaya /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Let's Encrypt (certbot):
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yoga-rostov-mst.ru -d www.yoga-rostov-mst.ru
```

---

## 6. Healthcheck и мониторинг

Эндпоинт: `GET /api/healthz` → `{"status":"ok","version":"1.0.0","db":"ok"}`

```bash
# Ручная проверка
curl https://yoga-rostov-mst.ru/api/healthz

# Cron-проверка каждые 5 минут (добавь в crontab):
*/5 * * * * curl -sf https://yoga-rostov-mst.ru/api/healthz || echo "FAIL $(date)" >> /var/log/masterskaya/healthcheck.log
```

Uptime-мониторинг: UptimeRobot (бесплатный план) — добавь HTTP-монитор на `/api/healthz`, интервал 5 мин, уведомление на email.

---

## 7. Прод-чеклист перед переводом с тестового на прод

- [ ] Заполнить `[ФИО оператора]` в `web/src/pages/privacy.astro`
- [ ] Заполнить реальные данные в `web/.env` (ADMIN_PASSWORD_HASH, SESSION_SECRET)
- [ ] Запустить `node scripts/seed.mjs` (только при первом запуске / сбросе БД)
- [ ] Запустить `node scripts/load-content.mjs` после редактирования .md-файлов
- [ ] Заполнить ставки аренды в `/admin/halls` (O2)
- [ ] Добавить резидентов-специалистов в `/admin/specialists` (O3)
- [ ] Заменить плейсхолдеры фото реальными снимками (O4): `data-photo-slot` — маркеры
- [ ] **robots.txt**: заменить тестовую версию (`Disallow: /`) на продовую (`Allow: /`, `Disallow: /admin/`)
- [ ] Проверить счётчик Яндекс.Метрики 91052806 — нажать «Принять» в баннере, убедиться что цели фиксируются
- [ ] Проверить форму аренды сквозным путём (реальная заявка → `/arenda/spasibo` → лид виден в `/admin/leads`)
- [ ] Дать Даниилу ссылку на /admin и убедиться что логин работает
- [ ] SSL-сертификат установлен, HTTPS работает
- [ ] `GET /api/healthz` возвращает 200

---

## 8. Обновление сайта

```bash
cd /var/www/masterskaya
git pull origin main
cd web
npm ci --omit=dev
npm run build
sudo systemctl restart masterskaya   # или: pm2 restart masterskaya
curl http://localhost:4321/api/healthz  # проверить
```

---

## 9. Резервное копирование БД

```bash
# Ежедневный бэкап БД (добавь в crontab www-data):
0 3 * * * cp /var/www/masterskaya/web/db/masterskaya.db \
             /var/backups/masterskaya/masterskaya-$(date +%Y%m%d).db

# Хранить последние 30 дней:
0 4 * * * find /var/backups/masterskaya/ -name "*.db" -mtime +30 -delete
```
