/**
 * hash-password.mjs — генерация scrypt-хэша пароля админки.
 *
 * СЕКРЕТ ЗАВОДИТ ЧЕЛОВЕК (CLAUDE.md §2): агент НЕ создаёт пароли/секреты и НЕ
 * трогает .env. Этот скрипт запускает Даниил, печатает строку для .env вручную.
 *
 * Запуск (из каталога web/):
 *   node scripts/hash-password.mjs 'ваш-пароль'
 *   # или интерактивно (без эха в большинстве терминалов через stdin):
 *   node scripts/hash-password.mjs
 *
 * Вывод — строка вида 'scrypt$<salt>$<hash>'. Положите её в web/.env:
 *   ADMIN_PASSWORD_HASH=scrypt$....
 * И задайте остальное:
 *   ADMIN_USER=admin            (необязательно; дефолт 'admin')
 *   SESSION_SECRET=<длинная случайная строка>   (например: openssl rand -hex 32)
 */
import { scryptSync, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';

const KEYLEN = 64;

function hash(password) {
  const salt = randomBytes(16);
  const h = scryptSync(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}

function output(password) {
  if (!password || password.length < 6) {
    console.error('Ошибка: пароль не задан или короче 6 символов.');
    process.exit(1);
  }
  const line = hash(password);
  console.log('\nДобавьте в web/.env (НЕ коммитьте файл):\n');
  console.log(`ADMIN_PASSWORD_HASH=${line}`);
  console.log('ADMIN_USER=admin');
  console.log('SESSION_SECRET=<сгенерируйте: openssl rand -hex 32>\n');
}

const argPw = process.argv[2];
if (argPw) {
  output(argPw);
} else {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  rl.question('Пароль администратора: ', (pw) => {
    rl.close();
    output(pw.trim());
  });
}
