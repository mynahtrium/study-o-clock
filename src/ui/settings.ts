import { listModels, type OpenRouterModel } from '../coach/openrouter';
import { saveSettings, type Settings } from './storage';
import { STATIC_THEMES } from '../theme/palettes';

export interface SettingsHandle {
  element: HTMLElement;
  toggle: () => void;
  close: () => void;
  isOpen: () => boolean;
}

export function createSettings(
  settings: Settings,
  onChange: (next: Settings) => void,
): SettingsHandle {
  let current = { ...settings };
  let open = false;

  const root = document.createElement('aside');
  root.className = 'settings scrollable';
  root.setAttribute('aria-label', 'Ayarlar');
  root.setAttribute('aria-hidden', 'true');

  const header = document.createElement('div');
  header.className = 'settings__header';
  const heading = document.createElement('h2');
  heading.className = 'settings__title';
  heading.textContent = 'Ayarlar';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'settings__close';
  closeBtn.textContent = '\u00d7';
  closeBtn.setAttribute('aria-label', 'Ayarları kapat');
  header.append(heading, closeBtn);

  const commit = (patch: Partial<Settings>): void => {
    current = { ...current, ...patch };
    saveSettings(current);
    onChange(current);
  };

  const section = (title: string): HTMLElement => {
    const el = document.createElement('section');
    el.className = 'settings__section';
    const h = document.createElement('h3');
    h.className = 'settings__section-title';
    h.textContent = title;
    el.append(h);
    return el;
  };

  const toggleRow = (label: string, key: keyof Settings, hint?: string): HTMLElement => {
    const row = document.createElement('label');
    row.className = 'settings__row';
    const text = document.createElement('span');
    text.className = 'settings__label';
    text.textContent = label;
    if (hint) {
      const h = document.createElement('span');
      h.className = 'settings__hint';
      h.textContent = hint;
      text.append(h);
    }
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'settings__checkbox';
    input.checked = Boolean(current[key]);
    input.addEventListener('change', () => commit({ [key]: input.checked } as Partial<Settings>));
    row.append(text, input);
    return row;
  };

  // ---- display ----
  const display = section('Görünüm');
  display.append(
    toggleRow('24 saat biçimi', 'use24h'),
    toggleRow('Saniyeler', 'showSeconds'),
    toggleRow('Saat dilimi', 'showTimezone'),
    toggleRow('Güneş konumu', 'showSun', 'Konum ayarlanmadan gizli kalır'),
    toggleRow('Çalışma serisi', 'showStreak'),
  );

  // ---- theme ----
  const theme = section('Tema');
  const themeHint = document.createElement('p');
  themeHint.className = 'settings__hint settings__hint--block';
  themeHint.textContent =
    'Tüm temalar koyu. Dinamik mod yalnızca şafak ve gün batımında renk katar; gün ortasında nötr kalır.';

  const modeRow = document.createElement('div');
  modeRow.className = 'settings__row';

  const modeLabel = document.createElement('span');
  modeLabel.className = 'settings__label';
  modeLabel.textContent = 'Mod';

  const segmented = document.createElement('div');
  segmented.className = 'segmented';

  const staticBtn = document.createElement('button');
  staticBtn.type = 'button';
  staticBtn.className = 'segmented__btn';
  staticBtn.textContent = 'Sabit';
  staticBtn.dataset.active = String(current.themeMode === 'static');

  const dynamicBtn = document.createElement('button');
  dynamicBtn.type = 'button';
  dynamicBtn.className = 'segmented__btn';
  dynamicBtn.textContent = 'Dinamik';
  dynamicBtn.dataset.active = String(current.themeMode === 'dynamic');

  const syncMode = (): void => {
    staticBtn.dataset.active = String(current.themeMode === 'static');
    dynamicBtn.dataset.active = String(current.themeMode === 'dynamic');
    swatches.dataset.disabled = String(current.themeMode !== 'static');
  };

  staticBtn.addEventListener('click', () => {
    commit({ themeMode: 'static' });
    syncMode();
  });
  dynamicBtn.addEventListener('click', () => {
    commit({ themeMode: 'dynamic' });
    syncMode();
  });

  segmented.append(staticBtn, dynamicBtn);
  modeRow.append(modeLabel, segmented);

  const swatches = document.createElement('div');
  swatches.className = 'theme-swatches';

  for (const spec of STATIC_THEMES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-swatch';
    btn.dataset.active = String(current.staticTheme === spec.name);
    btn.title = spec.label;

    const dot = document.createElement('span');
    dot.className = 'theme-swatch__dot';
    // Show the actual gradient, not a flattened average.
    dot.style.background = `linear-gradient(150deg, ${spec.palette.top}, ${spec.palette.bottom})`;

    const label = document.createElement('span');
    label.textContent = spec.label;

    btn.append(dot, label);
    btn.addEventListener('click', () => {
      commit({ themeMode: 'static', staticTheme: spec.name });
      for (const other of swatches.querySelectorAll('.theme-swatch')) {
        (other as HTMLElement).dataset.active = String(other === btn);
      }
      syncMode();
    });
    swatches.append(btn);
  }

  theme.append(themeHint, modeRow, swatches);

  // ---- pomodoro ----
  const pomo = section('Pomodoro');
  const pomoHint = document.createElement('p');
  pomoHint.className = 'settings__hint settings__hint--block';
  pomoHint.textContent = 'P başlat/duraklat \u00b7 Shift+P sıfırla. Saat çalışırken halka ilerlemeyi gösterir.';

  const minutesRow = (label: string, key: keyof typeof current.pomodoro): HTMLElement => {
    const row = document.createElement('label');
    row.className = 'settings__row';
    const text = document.createElement('span');
    text.className = 'settings__label';
    text.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = '180';
    input.className = 'settings__input settings__input--small';
    input.value = String(current.pomodoro[key]);
    input.addEventListener('change', () => {
      const value = Math.max(1, Math.min(180, Number(input.value) || 1));
      input.value = String(value);
      commit({ pomodoro: { ...current.pomodoro, [key]: value } });
    });
    row.append(text, input);
    return row;
  };

  const soundRow = document.createElement('label');
  soundRow.className = 'settings__row';
  const soundLabel = document.createElement('span');
  soundLabel.className = 'settings__label';
  soundLabel.textContent = 'Bitiş sesi';
  const soundInput = document.createElement('input');
  soundInput.type = 'checkbox';
  soundInput.className = 'settings__checkbox';
  soundInput.checked = current.pomodoro.sound;
  soundInput.addEventListener('change', () => {
    commit({ pomodoro: { ...current.pomodoro, sound: soundInput.checked } });
  });
  soundRow.append(soundLabel, soundInput);

  pomo.append(
    pomoHint,
    minutesRow('Odak (dk)', 'workMin'),
    minutesRow('Kısa mola (dk)', 'shortBreakMin'),
    minutesRow('Uzun mola (dk)', 'longBreakMin'),
    minutesRow('Uzun mola sıklığı', 'longBreakEvery'),
    soundRow,
  );

  // ---- location ----
  const loc = section('Konum');
  const locHint = document.createElement('p');
  locHint.className = 'settings__hint settings__hint--block';
  locHint.textContent =
    'Dinamik temada renk gerçek güneş konumuna göre değişir. Konum yalnızca bu cihazda saklanır.';

  const locRow = document.createElement('div');
  locRow.className = 'settings__row settings__row--wrap';

  const geoBtn = document.createElement('button');
  geoBtn.type = 'button';
  geoBtn.className = 'settings__btn';
  geoBtn.textContent = 'Konumumu kullan';

  const latInput = document.createElement('input');
  latInput.type = 'number';
  latInput.step = '0.0001';
  latInput.className = 'settings__input settings__input--num';
  latInput.placeholder = 'Enlem';
  latInput.value = current.latitude !== null ? String(current.latitude) : '';

  const lonInput = document.createElement('input');
  lonInput.type = 'number';
  lonInput.step = '0.0001';
  lonInput.className = 'settings__input settings__input--num';
  lonInput.placeholder = 'Boylam';
  lonInput.value = current.longitude !== null ? String(current.longitude) : '';

  const applyCoords = (): void => {
    const lat = Number(latInput.value);
    const lon = Number(lonInput.value);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      commit({ latitude: lat, longitude: lon });
    }
  };
  latInput.addEventListener('change', applyCoords);
  lonInput.addEventListener('change', applyCoords);

  geoBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      locHint.textContent = 'Bu tarayıcı konum servisini desteklemiyor.';
      return;
    }
    geoBtn.disabled = true;
    locHint.textContent = 'Konum alınıyor…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        latInput.value = latitude.toFixed(4);
        lonInput.value = longitude.toFixed(4);
        commit({ latitude, longitude });
        locHint.textContent = 'Konum alındı.';
        geoBtn.disabled = false;
      },
      () => {
        locHint.textContent = 'Konum alınamadı. Enlem ve boylamı elle girebilirsiniz.';
        geoBtn.disabled = false;
      },
      { timeout: 10000 },
    );
  });

  locRow.append(geoBtn, latInput, lonInput);
  loc.append(locHint, locRow);

  // ---- model ----
  const api = section('Model');
  const apiHint = document.createElement('p');
  apiHint.className = 'settings__hint settings__hint--block';
  apiHint.textContent =
    'Anahtar yalnızca bu tarayıcıda saklanır (localStorage). Asla sunucuya gönderilmez — doğrudan OpenRouter\u2019a gider.';

  const keyInput = document.createElement('input');
  keyInput.type = 'password';
  keyInput.className = 'settings__input';
  keyInput.placeholder = 'sk-or-v1-…';
  keyInput.value = current.apiKey;
  keyInput.autocomplete = 'off';
  keyInput.spellcheck = false;
  keyInput.addEventListener('change', () => commit({ apiKey: keyInput.value.trim() }));

  const modelInput = document.createElement('input');
  modelInput.type = 'search';
  modelInput.className = 'settings__input';
  modelInput.placeholder = 'Model ara…';
  modelInput.setAttribute('aria-label', 'Model ara');

  const modelList = document.createElement('div');
  modelList.className = 'settings__models scrollable scrollable--inset';

  const status = document.createElement('p');
  status.className = 'settings__status';

  const testBtn = document.createElement('button');
  testBtn.type = 'button';
  testBtn.className = 'settings__btn';
  testBtn.textContent = 'Bağlantıyı test et';

  let models: OpenRouterModel[] = [];

  const renderModels = (filter: string): void => {
    modelList.replaceChildren();
    const needle = filter.trim().toLowerCase();
    const shown = models
      .filter((m) => !needle || m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle))
      .slice(0, 40);

    if (!shown.length) {
      const p = document.createElement('p');
      p.className = 'settings__hint';
      p.textContent = models.length ? 'Eşleşen model yok.' : 'Model listesi yüklenmedi.';
      modelList.append(p);
      return;
    }

    for (const model of shown) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'model-option';
      btn.dataset.active = String(model.id === current.model);

      const name = document.createElement('span');
      name.className = 'model-option__name';
      name.textContent = model.name;

      const meta = document.createElement('span');
      meta.className = 'model-option__meta';
      const ctx = model.contextLength >= 1000 ? `${Math.round(model.contextLength / 1000)}k` : String(model.contextLength);
      meta.textContent = `${ctx} \u00b7 $${model.promptPrice.toFixed(2)}/$${model.completionPrice.toFixed(2)}`;

      btn.append(name, meta);
      btn.addEventListener('click', () => {
        commit({ model: model.id });
        for (const other of modelList.querySelectorAll('.model-option')) {
          (other as HTMLElement).dataset.active = String(other === btn);
        }
      });
      modelList.append(btn);
    }
  };

  const loadModels = async (): Promise<void> => {
    status.textContent = 'Model listesi yükleniyor…';
    try {
      models = await listModels();
      status.textContent = `${models.length} model bulundu.`;
      renderModels(modelInput.value);
    } catch (err) {
      status.textContent = `Model listesi yüklenemedi: ${(err as Error).message}`;
    }
  };

  modelInput.addEventListener('input', () => renderModels(modelInput.value));

  testBtn.addEventListener('click', async () => {
    status.textContent = 'Test ediliyor…';
    try {
      const res = await fetch('https://openrouter.ai/api/v1/key', {
        headers: { Authorization: `Bearer ${current.apiKey}` },
      });
      if (res.ok) {
        status.textContent = 'Bağlantı başarılı. Anahtar geçerli.';
      } else if (res.status === 401) {
        status.textContent = 'Anahtar geçersiz (401).';
      } else {
        status.textContent = `Beklenmeyen yanıt (${res.status}).`;
      }
    } catch {
      status.textContent = 'Bağlantı kurulamadı.';
    }
  });

  api.append(apiHint, keyInput, testBtn, modelInput, modelList, status);

  root.append(header, display, theme, pomo, loc, api);

  closeBtn.addEventListener('click', () => setOpen(false));

  const setOpen = (next: boolean): void => {
    open = next;
    root.classList.toggle('settings--open', open);
    root.setAttribute('aria-hidden', String(!open));
    if (open) {
      if (keyInput.value !== current.apiKey) keyInput.value = current.apiKey;
      syncMode();
      if (!models.length) void loadModels();
      else renderModels(modelInput.value);
    }
  };

  return {
    element: root,
    toggle: () => setOpen(!open),
    close: () => setOpen(false),
    isOpen: () => open,
  };
}
