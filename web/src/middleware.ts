/**
 * middleware.ts — гейт админки /admin/** (одна роль).
 *
 * Логика:
 *  - Не /admin/** → пропускаем.
 *  - Авторизация не настроена (нет ADMIN_PASSWORD_HASH/SESSION_SECRET) → 503
 *    «настройте доступ» (НЕ 500, публичный сайт не страдает). Исключение — сам
 *    /admin/login, чтобы человек видел инструкцию.
 *  - /admin/login и POST на /admin/login/logout — без проверки сессии.
 *  - Остальное /admin/** → нужна валидная подписанная сессия, иначе 303 на /admin/login.
 *
 * Секреты НЕ создаём здесь (CLAUDE.md §2) — только проверяем env.
 */
import { defineMiddleware } from 'astro:middleware';
import { isAuthConfigured, verifySession, SESSION_COOKIE } from './server/auth.ts';

const LOGIN = '/admin/login';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (!pathname.startsWith('/admin')) return next();

  // Страница логина доступна всегда (на ней же — инструкция при 503).
  const isLoginRoute = pathname === LOGIN || pathname.startsWith('/admin/logout');

  if (!isAuthConfigured()) {
    if (isLoginRoute) return next(); // покажет «настройте доступ»
    return new Response(
      'Доступ в админку не настроен. Откройте /admin/login для инструкции.',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', Location: LOGIN } },
    );
  }

  if (isLoginRoute) return next();

  const session = verifySession(context.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return context.redirect(LOGIN, 303);
  }
  context.locals.adminUser = session.u;
  return next();
});
