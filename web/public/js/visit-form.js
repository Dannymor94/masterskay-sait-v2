/**
 * visit-form.js — прогрессивное улучшение форм визита и события (#zayavka).
 *
 * Инвариант (CLAUDE.md §3): форма работает БЕЗ JS (нативный POST). Этот модуль —
 * только улучшение ПОВЕРХ рабочей формы. defer-модуль из public/, независим от
 * сборки. Если модуль не загрузился/упал — нативный POST остаётся рабочим.
 *
 * Общий для VisitForm.astro и EventForm.astro: обе формы используют .apply__form,
 * #name, #contact, #consent; событие дополнительно #count (number ≥1, max=мест).
 * Делает: мягкую валидацию на лету (те же сообщения, что у сервера leads.ts);
 * на submit — фокус на первое неверное поле; при сбое JS — деградация к POST.
 */
(function () {
  'use strict';

  var MSG = {
    name: 'Напишите, как к вам обращаться.',
    contactEmpty: 'Оставьте телефон или мессенджер — иначе мы не сможем ответить.',
    contactBad: 'Проверьте контакт: телефон или ник в мессенджере.',
    countMin: 'Укажите количество мест (минимум 1).',
    countMax: 'Свободных мест меньше, чем вы указали.',
    consent: 'Чтобы отправить заявку, отметьте согласие на обработку данных.',
  };

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
        field.setAttribute('aria-describedby', [describedby, el.id].filter(Boolean).join(' '));
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
    var countEl = form.querySelector('#count');
    var consentEl = form.querySelector('#consent');

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
        id: 'count',
        el: countEl,
        bad: function () {
          if (!countEl) return false;
          var n = parseInt(countEl.value, 10);
          if (!(n >= 1)) return true;
          var max = parseInt(countEl.getAttribute('max'), 10);
          if (!isNaN(max) && n > max) return true;
          return false;
        },
        msg: function () {
          if (!countEl) return MSG.countMin;
          var n = parseInt(countEl.value, 10);
          var max = parseInt(countEl.getAttribute('max'), 10);
          if (!isNaN(max) && n > max) return MSG.countMax;
          return MSG.countMin;
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

    checks.forEach(function (c) {
      if (!c.el) return;
      var ev = c.el.getAttribute('type') === 'checkbox' ? 'change' : 'blur';
      c.el.addEventListener(ev, function () {
        if (c.el.getAttribute('aria-invalid') === 'true') validateField(c);
      });
      c.el.addEventListener('input', function () {
        if (c.el.getAttribute('aria-invalid') === 'true') validateField(c);
      });
    });

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
      } catch (err) {
        /* JS упал — не блокируем нативную отправку */
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
    /* no-op */
  }
})();
