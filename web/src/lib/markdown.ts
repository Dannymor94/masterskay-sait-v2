/**
 * markdown.ts — рендер markdown-тела контент-страниц (content_page.body) в HTML.
 *
 * Используется страницами /napravleniya, /praktiki, /chaynaya, /tury, /psiholog
 * (T2-3): тело хранится в БД как markdown, на сервере (SSR) превращаем в HTML и
 * выводим через set:html. Контент заводит администратор/копирайтер (доверенный
 * источник), поэтому HTML рендерим как есть — внешний пользовательский ввод сюда
 * не попадает.
 *
 * marked в синхронном режиме (без async-расширений) — детерминированный код
 * (CLAUDE.md §1: «определённость прежде магии»).
 */
import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: false,
});

/** markdown → HTML. null/пустое → пустая строка. */
export function renderMarkdown(md: string | null | undefined): string {
  if (!md || !md.trim()) return '';
  return marked.parse(md, { async: false }) as string;
}
