/**
 * Skrip yang disuntikkan (addInitScript) ke setiap halaman saat merekam.
 * Menangkap interaksi user dan mengirimnya ke server lewat binding
 * RECORDER_BINDING. Ditulis sebagai JavaScript biasa (bukan fungsi TS yang
 * di-serialize) agar tidak tercampur helper hasil transpile.
 *
 * Aturan penting:
 * - Hanya frame utama yang direkam.
 * - Isian teks digabung jadi satu step "fill" (dikirim saat change/blur/Enter/klik berikutnya,
 *   atau setelah user berhenti mengetik ~1 detik — penting untuk kolom pencarian yang langsung
 *   menampilkan hasil tanpa klik).
 * - Klik pada input teks/select/checkbox tidak direkam sebagai klik (isian & change yang direkam).
 * - Toolbar perekam berada di Shadow DOM dan diabaikan oleh perekam.
 */
/** Nama fungsi yang di-expose ke halaman untuk mengirim aksi ke server. */
export const RECORDER_BINDING = '__testoraRecord';
/** Fungsi di halaman yang mencari form login (untuk login otomatis sebelum merekam). */
export const LOGIN_PROBE = '__testoraFindLogin';

export const RECORDER_SCRIPT = String.raw`
(() => {
  if (window.top !== window || window.__testoraRecorder) return;
  window.__testoraRecorder = true;

  const HOST_ID = '__testora-recorder';
  const TEST_ATTRS = ['data-testid', 'data-test', 'data-test-id', 'data-cy', 'data-qa'];
  const TEXT_INPUTS = ['text', 'email', 'password', 'search', 'tel', 'url', 'number', 'date', 'datetime-local', 'month', 'time', 'week', 'color', ''];
  let mode = 'record'; // record | assertText | assertVisible
  let pending = null; // isian teks yang belum dikirim
  let host = null;
  let counter = null;

  const q = (v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const short = (t, n) => { t = clean(t); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const isOwn = (el) => !!(el && el.closest && el.closest('#' + HOST_ID));
  // Id buatan framework berubah saat urutan render berubah (mis. setelah deploy): React useId
  // (_r_0_, :r0:, «r0»), Radix, Headless UI, MUI, React Aria, dll. Tidak dipakai sebagai selector.
  const looksDynamic = (v) =>
    /\d{4,}|[0-9a-f]{8,}|^(ember|react|mui|radix|headlessui|react-aria|chakra|mantine)[-_:]/i.test(v) ||
    /^(_r_[0-9a-z]+_|:[rR][0-9a-zA-Z]*:|«[rR][0-9a-zA-Z]*»)$/.test(v);

  function roleOf(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || (tag === 'input' && ['button', 'submit', 'reset'].includes(el.type))) return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'input' && el.type === 'checkbox') return 'checkbox';
    if (tag === 'input' && el.type === 'radio') return 'radio';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea' || (tag === 'input' && TEXT_INPUTS.includes(el.type))) return 'textbox';
    return '';
  }

  function accessibleName(el) {
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    // aria-labelledby (dropdown kustom): nama tetap walau isi tombolnya berubah setelah memilih.
    const labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map((id) => { const ref = id && document.getElementById(id); return ref ? ref.innerText : ''; })
      .filter(Boolean).join(' ');
    if (labelledBy) return clean(labelledBy);
    if (el.labels && el.labels[0]) return clean(el.labels[0].innerText);
    if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type)) return clean(el.value);
    if (['BUTTON', 'A'].includes(el.tagName) || el.getAttribute('role')) return clean(el.innerText);
    return clean(el.getAttribute('title') || el.getAttribute('placeholder') || '');
  }

  function cssPath(el) {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.body && parts.length < 6; node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id && !looksDynamic(node.id)) { parts.unshift('#' + CSS.escape(node.id)); break; }
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
    }
    return parts.join(' > ');
  }

  function selectorsFor(el) {
    const out = [];
    const tag = el.tagName.toLowerCase();
    for (const a of TEST_ATTRS) { const v = el.getAttribute(a); if (v) out.push('[' + a + '=' + q(v) + ']'); }
    if (el.id && !looksDynamic(el.id)) out.push('#' + CSS.escape(el.id));
    const name = el.getAttribute('name');
    if (name && ['input', 'select', 'textarea', 'button'].includes(tag)) out.push(tag + '[name=' + q(name) + ']');
    const role = roleOf(el);
    const accName = accessibleName(el);
    if (tag === 'input' && el.type === 'password') {
      // Kolom password tidak punya role "textbox": pakai type-nya (dibatasi ke dialog bila ada).
      const scope = el.closest('[role=dialog]');
      const inScope = (scope || document).querySelectorAll('input[type=password]').length;
      if (inScope === 1) out.push((scope ? '[role=dialog] ' : '') + 'input[type="password"]');
    } else if (role && accName && accName.length <= 80) out.push('role=' + role + '[name=' + q(accName) + ']');
    const aria = el.getAttribute('aria-label');
    if (aria) out.push('[aria-label=' + q(aria) + ']');
    const ph = el.getAttribute('placeholder');
    if (ph) out.push(tag + '[placeholder=' + q(ph) + ']');
    const text = clean(el.innerText);
    if (!role && text && text.length <= 50) {
      // Teks tanpa elemen anak → text="…"; dengan anak (mis. nama + badge "Sistem") → tag:has-text("…").
      out.push(el.children.length === 0 ? 'text=' + q(text) : tag + ':has-text(' + q(text) + ')');
    }
    out.push(cssPath(el));
    return Array.from(new Set(out));
  }

  function label(el) {
    const name = accessibleName(el) || clean(el.innerText) || el.getAttribute('name') || el.tagName.toLowerCase();
    return short(name, 50);
  }

  function kindOf(el) {
    const role = roleOf(el);
    return role === 'textbox' ? 'field' : role === 'combobox' ? 'dropdown' : role || el.tagName.toLowerCase();
  }

  // at = kapan aksi terjadi (ms epoch). Browser & server di mesin yang sama,
  // jadi server bisa menghitung jeda antar step untuk pemutaran "as recorded".
  function send(step) {
    const binding = window.${RECORDER_BINDING};
    if (!binding) return;
    if (!step.at) step.at = Date.now();
    Promise.resolve(binding(step)).then((count) => { if (counter && typeof count === 'number') counter.textContent = count + ' steps'; }).catch(() => {});
  }

  // Berhenti mengetik selama ini = isian dianggap selesai (kolom pencarian "live").
  const TYPING_PAUSE_MS = 1000;
  let pauseTimer = null;

  function flushFill() {
    clearTimeout(pauseTimer);
    if (!pending) return;
    const { el, startedAt, lastAt } = pending;
    pending = null;
    const sensitive = el.type === 'password';
    send({ type: 'fill', selectors: selectorsFor(el), value: el.value, sensitive, description: 'Type into "' + label(el) + '" ' + kindOf(el), at: startedAt, typingMs: lastAt - startedAt });
  }

  const LARGE_CONTAINER_AREA = 120000; // px², mis. kartu 800 × 150
  const isLargeContainer = (el) => {
    const r = el.getBoundingClientRect();
    // Tetap direkam: wadah yang memang bisa diklik (kursor tangan) dan area gambar/peta/grafik.
    if (/^(CANVAS|IMG|SVG|VIDEO|IFRAME)$/i.test(el.tagName) || getComputedStyle(el).cursor === 'pointer') return false;
    return r.width * r.height > LARGE_CONTAINER_AREA;
  };

  const isTextField = (el) =>
    el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && TEXT_INPUTS.includes(el.type)) || el.isContentEditable);

  const ACTIONABLE = 'button,a,input,select,textarea,label,summary,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],[role=checkbox],[role=switch],[onclick]';

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (isOwn(el) || !isTextField(el) || el.isContentEditable) return;
    if (pending && pending.el !== el) flushFill();
    const now = Date.now();
    pending = pending ? { ...pending, lastAt: now } : { el, startedAt: now, lastAt: now };
    clearTimeout(pauseTimer);
    pauseTimer = setTimeout(flushFill, TYPING_PAUSE_MS);
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (isOwn(el)) return;
    if (isTextField(el)) { if (pending && pending.el === el) flushFill(); return; }
    // Isian di field lain yang belum terkirim harus tercatat lebih dulu (urutan step tetap benar).
    flushFill();
    if (el.tagName === 'SELECT') {
      const opt = el.options[el.selectedIndex];
      send({ type: 'select', selectors: selectorsFor(el), value: el.value, description: 'Choose "' + short(opt ? opt.text : el.value, 40) + '" in "' + label(el) + '"' });
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      const checked = el.checked;
      send({ type: checked || el.type === 'radio' ? 'check' : 'uncheck', selectors: selectorsFor(el), value: '', description: (checked ? 'Tick' : 'Untick') + ' "' + label(el) + '"' });
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    const el = e.target;
    if (isOwn(el) || e.key !== 'Enter' || el.tagName === 'TEXTAREA' || !isTextField(el)) return;
    flushFill();
    send({ type: 'press', selectors: selectorsFor(el), value: 'Enter', description: 'Press Enter in "' + label(el) + '"' });
  }, true);

  // Dropdown kustom (Radix, Headless UI, dsb.) memilih opsi saat pointerup lalu
  // langsung menutup daftarnya, sehingga event "click" jatuh ke <body>. Opsi
  // direkam di pointerup; klik susulan ke opsi yang sama diabaikan.
  const OPTION_ROLES = '[role=option],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox]';
  let lastOption = null;

  // Tombol dropdown kustom sering terbuka saat pointerdown dan daftarnya langsung
  // menutupi tombol, sehingga "click" tidak pernah sampai ke tombol. Tombolnya
  // direkam di pointerdown.
  const TRIGGERS = '[role=combobox],[aria-haspopup=listbox],[aria-haspopup=menu],[aria-haspopup=true]';
  let lastTrigger = null;
  let press = null; // tekanan mouse yang sedang berlangsung
  document.addEventListener('pointerdown', (e) => {
    if (mode !== 'record' || e.button !== 0) return;
    const raw = e.target;
    if (!(raw instanceof Element) || isOwn(raw)) return;
    const trigger = raw.closest(TRIGGERS);
    press = { onTrigger: !!trigger, x: e.clientX, y: e.clientY };
    // Combobox berupa input teks (autocomplete) direkam sebagai isian, bukan klik.
    if (!trigger || isTextField(trigger) || trigger.tagName === 'SELECT' || trigger.disabled) return;
    flushFill();
    lastTrigger = { el: trigger, at: Date.now() };
    send({ type: 'click', selectors: selectorsFor(trigger), value: '', description: 'Click "' + label(trigger) + '" ' + kindOf(trigger) });
  }, true);

  document.addEventListener('pointerup', (e) => {
    if (mode !== 'record' || e.button !== 0) return;
    const raw = e.target;
    if (!(raw instanceof Element) || isOwn(raw)) return;
    const option = raw.closest(OPTION_ROLES);
    if (!option || option.tagName === 'OPTION') return;
    // Lepas tombol mouse dari tekanan yang baru membuka dropdown: opsi di bawah kursor
    // tidak dipilih (kecuali pointer diseret ke opsi).
    const dragged = press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10;
    if (press && press.onTrigger && !dragged) return;
    flushFill();
    lastOption = { el: option, at: Date.now() };
    send({ type: 'click', selectors: selectorsFor(option), value: '', description: 'Click "' + label(option) + '" ' + kindOf(option) });
  }, true);

  document.addEventListener('click', (e) => {
    const raw = e.target;
    if (!(raw instanceof Element) || isOwn(raw)) return;
    const el = raw.closest(ACTIONABLE) || raw;

    if (mode !== 'record') {
      e.preventDefault();
      e.stopPropagation();
      const target = raw;
      if (mode === 'assertText') {
        const text = short(target.innerText || target.value, 80);
        send({ type: 'assertText', selectors: selectorsFor(target), value: text, description: 'Check "' + short(text, 40) + '" is shown' });
      } else {
        send({ type: 'assertVisible', selectors: selectorsFor(target), value: '', description: 'Check "' + label(target) + '" is visible' });
      }
      setMode('record');
      return;
    }

    // Fokus ke field / checkbox / select tidak direkam sebagai klik.
    if (isTextField(el) || el.tagName === 'SELECT') return;
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) return;
    if (el.tagName === 'LABEL' && el.control && ['checkbox', 'radio'].includes(el.control.type)) return;
    if (el.tagName === 'OPTION') return;
    // Klik ke latar halaman tidak bermakna & tidak bisa diputar ulang (sering sisa dari dropdown yang baru tertutup).
    if (el === document.body || el === document.documentElement) return;
    // Klik di area kosong wadah besar (kartu, panel) juga tidak bermakna — dan berbahaya saat diputar
    // ulang, karena klik dilakukan di TENGAH wadah dan bisa mengenai baris/tombol yang kebetulan di sana.
    if (!raw.closest(ACTIONABLE) && isLargeContainer(el)) return;
    // Opsi dropdown sudah direkam saat pointerup, tombol dropdown saat pointerdown.
    const recent = lastOption && Date.now() - lastOption.at < 1000;
    if (recent && (el === lastOption.el || !el.isConnected || el.closest(OPTION_ROLES) === lastOption.el)) return;
    if (lastTrigger && Date.now() - lastTrigger.at < 1000 && el.closest(TRIGGERS) === lastTrigger.el) return;

    flushFill();
    send({ type: 'click', selectors: selectorsFor(el), value: '', description: 'Click "' + label(el) + '" ' + kindOf(el) });
  }, true);

  window.addEventListener('pagehide', flushFill, true);
  window.addEventListener('blur', flushFill, true);

  /* ------------------------------ login otomatis ------------------------------ */

  // Dipanggil server (page.evaluate) sebelum merekam. Mengembalikan selector +
  // deskripsi field username, password, dan tombol login — atau null bila belum ada.
  const isVisible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const before = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  const describeField = (el) => el && { selectors: selectorsFor(el), description: 'Type into "' + label(el) + '" ' + kindOf(el) };
  const describeButton = (el) => el && { selectors: selectorsFor(el), description: 'Click "' + label(el) + '" ' + kindOf(el) };
  const USERNAME_HINT = /user|email|e-mail|login|account|nik|phone|username/i;
  const SUBMIT_TEXT = /log ?in|sign ?in|masuk|submit|continue|lanjut|next/i;

  window.${LOGIN_PROBE} = () => {
    const password = Array.from(document.querySelectorAll('input[type=password]')).find((el) => isVisible(el) && !isOwn(el));
    if (!password) return null;
    const scope = password.form || document;
    const fields = Array.from(scope.querySelectorAll('input,textarea'))
      .filter((el) => el !== password && !isOwn(el) && isVisible(el) && isTextField(el) && el.type !== 'password' && before(el, password));
    const hint = (el) => [el.type, el.name, el.id, el.autocomplete, el.placeholder, accessibleName(el)].join(' ');
    const username =
      fields.find((el) => el.autocomplete === 'username' || el.type === 'email') ||
      [...fields].reverse().find((el) => USERNAME_HINT.test(hint(el))) ||
      fields[0] || null;
    const buttons = Array.from(scope.querySelectorAll('button,input[type=submit],input[type=button],[role=button]'))
      .filter((el) => isVisible(el) && !isOwn(el) && !el.disabled);
    const submit =
      buttons.find((el) => el.type === 'submit' && SUBMIT_TEXT.test(accessibleName(el) || el.innerText || el.value)) ||
      buttons.find((el) => el.type === 'submit') ||
      buttons.find((el) => SUBMIT_TEXT.test(accessibleName(el) || el.innerText || el.value)) ||
      (password.form && buttons.length === 1 ? buttons[0] : null);
    return { username: describeField(username), password: describeField(password), submit: describeButton(submit) };
  };

  /* ---------------------------- toolbar & highlight ---------------------------- */

  let outline = null;
  function highlight(el) {
    if (!outline) return;
    if (!el || isOwn(el)) { outline.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    Object.assign(outline.style, { display: 'block', left: r.left - 2 + 'px', top: r.top - 2 + 'px', width: r.width + 4 + 'px', height: r.height + 4 + 'px' });
  }
  document.addEventListener('mouseover', (e) => { if (mode !== 'record') highlight(e.target); }, true);

  function setMode(next) {
    mode = next;
    if (!host) return;
    host.shadowRoot.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    host.shadowRoot.querySelector('.hint').textContent =
      mode === 'record' ? 'Use the site normally — every action becomes a step.' : 'Click the element you want to check…';
    if (mode === 'record') highlight(null);
  }

  function mountToolbar() {
    if (document.getElementById(HOST_ID) || !document.body) return;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; right: 16px; bottom: 16px;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      '.bar{font:13px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;background:#0b1a33;color:#fff;border-radius:12px;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.3);display:grid;gap:8px;min-width:260px}' +
      '.top{display:flex;align-items:center;gap:8px}.dot{width:9px;height:9px;border-radius:50%;background:#ee6069;animation:p 1.2s infinite}' +
      '@keyframes p{50%{opacity:.35}}.count{margin-left:auto;color:#aab4c8;font-variant-numeric:tabular-nums}' +
      '.row{display:flex;gap:6px;flex-wrap:wrap}button{font:inherit;font-size:12px;border:1px solid #33415f;background:#17223a;color:#fff;border-radius:7px;padding:5px 8px;cursor:pointer}' +
      'button:hover{border-color:#7b93ff}button.on{background:#2f4fe0;border-color:#2f4fe0}.stop{background:#cf3b45;border-color:#cf3b45}' +
      '.hint{color:#aab4c8;font-size:11.5px}' +
      '</style>' +
      '<div class="bar"><div class="top"><span class="dot"></span><b>Recording</b><span class="count">…</span></div>' +
      '<div class="row"><button data-mode="assertText" title="Then click an element whose text must be shown">✓ Check text</button>' +
      '<button data-mode="assertVisible" title="Then click an element that must be visible">👁 Check visible</button>' +
      '<button data-act="url" title="Check the current page address">🔗 Check URL</button>' +
      '<button data-act="stop" class="stop">■ Stop</button></div><div class="hint"></div></div>';
    counter = root.querySelector('.count');
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.mode) setMode(mode === b.dataset.mode ? 'record' : b.dataset.mode);
      else if (b.dataset.act === 'url') {
        flushFill();
        send({ type: 'assertUrl', selectors: [], value: location.pathname + location.search, description: 'Check page URL contains "' + location.pathname + '"' });
      } else if (b.dataset.act === 'stop') { flushFill(); send({ type: '__stop' }); }
    });
    outline = document.createElement('div');
    outline.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #2f4fe0;background:rgba(47,79,224,.12);border-radius:4px;display:none;z-index:2147483646';
    root.appendChild(outline);
    document.documentElement.appendChild(host);
    setMode(mode);
    send({ type: '__hello' });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountToolbar);
  else mountToolbar();
  // Beberapa SPA mengganti <body>; pasang ulang toolbar bila hilang.
  setInterval(() => { if (!document.getElementById(HOST_ID)) mountToolbar(); }, 1500);
})();
`;
