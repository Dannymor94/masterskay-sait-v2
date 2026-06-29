/**
 * arenda-form.js — прогрессивное улучшение формы заявки (#zayavka).
 *
 * Инвариант (CLAUDE.md §3): форма работает БЕЗ JS (нативный POST). Этот модуль —
 * только улучшение ПОВЕРХ рабочей формы. Подключён как defer-модуль из public/,
 * чтобы быть полностью независимым от сборки (на SSR-странице это надёжнее, чем
 * hoisted-скрипты Astro). Если модуль не загрузился или упал — форма остаётся
 * рабочей и отправляется нативным POST.
 *
 * Делает:
 *  - показ поля «activity_other» только при выборе «Другое» (без JS оно видно всегда);
 *  - мягкую валидацию на лету (required + грубый формат контакта) с теми же
 *    сообщениями, что у сервера (leads.ts) и в arenda.md;
 *  - на submit: при ошибках фокус на первое поле и preventDefault; при сбое JS —
 *    деградация к нативному POST (try/catch вокруг обработчика submit).
 */
(function () {
  'use strict';

  // Сообщения совпадают с серверными (leads.ts) и микрокопи из arenda.md.
  var MSG = {
    name: 'Напишите, как к вам обращаться.',
    contactEmpty: 'Оставьте телефон или мессенджер — иначе мы не сможем ответить.',
    contactBad: 'Проверьте контакт: телефон или ник в мессенджере.',
    activity: 'Выберите, чем вы занимаетесь, — или отметьте «Другое».',
    activityOther: 'Напишите коротко, чем вы занимаетесь.',
    format: 'Выберите формат: регулярная или разовая аренда.',
    schedule: 'Напишите, какие дни и время вам удобны.',
    consent: 'Чтобы отправить заявку, отметьте согласие на обработку данных.',
  };

  // Грубая, НЕ строгая проверка контакта: телефон (≥5 цифр) ИЛИ ник мессенджера.
  function looksLikeContact(v) {
    var s = (v || '').trim();
    if (!s) return false;
    var digits = s.replace(/\D/g, '');
    if (/^[+()\d\s-]+$/.test(s) && digits.length >= 5) return true;
    if (/^@?[a-zA-Z0-9._]{3,}$/.test(s)) return true;
    return false;
  }

  function init() {
    var form = document.querySelector('.apply__form');
    if (!form) return;

    var activity = form.querySelector('#activity');
    var otherWrap = form.querySelector('[data-other-field]');
    var otherInput = form.querySelector('#activity-other');

    // --- 1. Показ поля «Другое» ---------------------------------------------
    function syncOther() {
      if (!otherWrap) return;
      var isOther = activity && activity.value === 'Другое';
      var forced = otherInput && otherInput.getAttribute('aria-invalid') === 'true';
      otherWrap.hidden = !(isOther || forced);
    }
    if (activity && otherWrap) {
      syncOther();
      activity.addEventListener('change', syncOther);
    }

    // --- 2. Мягкая валидация -------------------------------------------------
    function errEl(id) {
      return form.querySelector('#err-' + id);
    }

    function setError(fieldId, field, msg) {
      field.setAttribute('aria-invalid', 'true');
      var el = errEl(fieldId);
      if (!el) {
        el = document.createElement('p');
        el.className = 'field__error';
        el.id = 'err-' + fieldId;
        field.insertAdjacentElement('afterend', el);
        var describedby = field.getAttribute('aria-describedby');
        field.setAttribute(
          'aria-describedby',
          [describedby, el.id].filter(Boolean).join(' '),
        );
      }
      el.textContent = msg;
    }

    function clearError(fieldId, field) {
      field.removeAttribute('aria-invalid');
      var el = errEl(fieldId);
      if (el) el.textContent = '';
    }

    var nameEl = form.querySelector('#name');
    var contactEl = form.querySelector('#contact');
    var scheduleEl = form.querySelector('#schedule');
    var consentEl = form.querySelector('#consent');
    var formatRegular = form.querySelector('#format-regular');

    function formatChecked() {
      return form.querySelector('input[name="format"]:checked');
    }
    function isRegular() {
      var f = formatChecked();
      return f ? f.value === 'regular' : false;
    }

    var checks = [
      {
        id: 'name',
        el: nameEl,
        bad: function () {
          return !(nameEl && nameEl.value.trim());
        },
        msg: function () {
          return MSG.name;
        },
      },
      {
        id: 'contact',
        el: contactEl,
        bad: function () {
          return !looksLikeContact(contactEl && contactEl.value);
        },
        msg: function () {
          return contactEl && contactEl.value.trim() ? MSG.contactBad : MSG.contactEmpty;
        },
      },
      {
        id: 'activity',
        el: activity,
        bad: function () {
          return !(activity && activity.value);
        },
        msg: function () {
          return MSG.activity;
        },
      },
      {
        id: 'activity-other',
        el: otherInput,
        bad: function () {
          return (
            activity && activity.value === 'Другое' && !(otherInput && otherInput.value.trim())
          );
        },
        msg: function () {
          return MSG.activityOther;
        },
      },
      {
        id: 'format-regular',
        el: formatRegular,
        bad: function () {
          return !formatChecked();
        },
        msg: function () {
          return MSG.format;
        },
      },
      {
        id: 'schedule',
        el: scheduleEl,
        bad: function () {
          return isRegular() && !(scheduleEl && scheduleEl.value.trim());
        },
        msg: function () {
          return MSG.schedule;
        },
      },
      {
        id: 'consent',
        el: consentEl,
        bad: function () {
          return !(consentEl && consentEl.checked);
        },
        msg: function () {
          return MSG.consent;
        },
      },
    ];

    function validateField(c) {
      if (!c.el) return true;
      if (c.bad()) {
        setError(c.id, c.el, c.msg());
        return false;
      }
      clearError(c.id, c.el);
      return true;
    }

    // Снимаем ошибку по мере исправления (только если она уже была показана).
    checks.forEach(function (c) {
      if (!c.el) return;
      var ev =
        c.el.tagName === 'SELECT' || c.el.getAttribute('type') === 'checkbox'
          ? 'change'
          : 'blur';
      c.el.addEventListener(ev, function () {
        if (c.el.getAttribute('aria-invalid') === 'true') validateField(c);
      });
      c.el.addEventListener('input', function () {
        if (c.el.getAttribute('aria-invalid') === 'true') validateField(c);
      });
    });

    // Формат — слушаем оба радио (revalidate схему регулярности).
    Array.prototype.forEach.call(
      form.querySelectorAll('input[name="format"]'),
      function (r) {
        r.addEventListener('change', function () {
          var fmt = checks.filter(function (c) {
            return c.id === 'format-regular';
          })[0];
          var sch = checks.filter(function (c) {
            return c.id === 'schedule';
          })[0];
          if (fmt) validateField(fmt);
          if (sch && scheduleEl && scheduleEl.getAttribute('aria-invalid') === 'true') {
            validateField(sch);
          }
        });
      },
    );

    // --- 3. Submit: мягко валидируем; ошибки → фокус; сбой JS → нативный POST -
    form.addEventListener('submit', function (e) {
      try {
        var firstBad = null;
        for (var i = 0; i < checks.length; i++) {
          var ok = validateField(checks[i]);
          if (!ok && !firstBad) firstBad = checks[i].el;
        }
        if (firstBad) {
          e.preventDefault();
          firstBad.focus();
          if (firstBad.scrollIntoView) {
            firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }
        // ошибок нет → форма уходит нативным POST (ничего не делаем)
      } catch (err) {
        // JS упал — НЕ блокируем отправку, форма работает нативно.
      }
    });
  }

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
      init();
    }
  } catch (e) {
    /* no-op: нативная форма не пострадает */
  }
})();
