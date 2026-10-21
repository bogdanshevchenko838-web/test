import FFT from 'fft.js';

export const AXES = ['Roll', 'Pitch', 'Yaw'];
const rms = values => values.length ? Math.sqrt(values.reduce((s, x) => s + x * x, 0) / values.length) : null;
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
const round = (v, places = 2) => Number.isFinite(v) ? Number(v.toFixed(places)) : null;

/** One-sided Welch PSD, Hann window, 50% overlap. Gaps are never bridged. */
export function spectrum(times, values, sampleRate) {
  const segments = [];
  let start = 0;
  for (let i = 1; i <= times.length; i++) {
    if (i === times.length || Math.abs((times[i] - times[i - 1]) * sampleRate - 1) > 0.2) {
      segments.push([start, i]); start = i;
    }
  }
  const longest = segments.reduce((max, [s, e]) => Math.max(max, e - s), 0);
  if (longest < 64) return null;
  // Prefer several independent windows over maximum resolution on short logs.
  const n = 2 ** Math.floor(Math.log2(Math.min(2048, Math.max(64, longest / 4))));
  const fft = new FFT(n), result = fft.createComplexArray(), input = new Float64Array(n);
  const window = Array.from({ length: n }, (_, i) => 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1))));
  const normalization = sampleRate * window.reduce((s, x) => s + x * x, 0);
  const starts = [];
  for (const [s, e] of segments) for (let j = s; j + n <= e; j += n / 2) starts.push(j);
  // Spread a bounded amount of work over the entire selected interval.
  const selected = starts.length > 96 ? Array.from({ length: 96 }, (_, i) => starts[Math.round(i * (starts.length - 1) / 95)]) : starts;
  const power = new Float64Array(n / 2 + 1);
  let windows = 0;
  for (const offset of selected) {
    let mean = 0, valid = true;
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(values[offset + i])) { valid = false; break; }
      mean += values[offset + i] / n;
    }
    if (!valid) continue;
    for (let i = 0; i < n; i++) input[i] = (values[offset + i] - mean) * window[i];
    fft.realTransform(result, input);
    for (let k = 0; k <= n / 2; k++) power[k] += (result[2 * k] ** 2 + result[2 * k + 1] ** 2) * (k === 0 || k === n / 2 ? 1 : 2) / normalization;
    windows++;
  }
  if (!windows) return null;
  for (let i = 0; i < power.length; i++) power[i] /= windows;
  const df = sampleRate / n, high = [], control = [];
  let peak = -1;
  for (let k = 1; k < power.length; k++) {
    if (k * df >= 20) control.push(power[k]);
    if (k * df >= 100) {
      high.push(power[k]);
      if (peak === -1 || power[k] > power[peak]) peak = k;
    }
  }
  const highPower = high.reduce((s, x) => s + x, 0) * df;
  const totalPower = control.reduce((s, x) => s + x, 0) * df;
  const floor = median(high) || 1e-20;
  return {
    points: Array.from(power, (p, k) => [round(k * df, 3), round(10 * Math.log10(Math.max(p, 1e-12)), 3)]),
    peakHz: peak >= 0 && highPower > 1e-10 ? round(peak * df, 1) : null,
    prominenceDb: peak >= 0 ? round(10 * Math.log10(Math.max(power[peak], 1e-20) / floor), 1) : null,
    highRms: round(Math.sqrt(highPower)), highFraction: totalPower > 1e-10 ? round(highPower / totalPower, 3) : 0,
    resolutionHz: round(df, 2), windows, n,
  };
}

function downsample(rows, indices, start, maxPoints = 1200) {
  if (rows.length <= maxPoints) return rows.map(r => [r[0] - start, ...indices.map(i => i < 0 ? null : r[i])]);
  const out = [], primary = indices[0];
  // Preserve both extrema of each bucket, including brief oscillations.
  for (let s = 0, step = rows.length / (maxPoints / 2); s < rows.length; s += step) {
    const a = Math.floor(s), end = Math.min(rows.length, Math.floor(s + step));
    let lo = a, hi = a;
    for (let i = a; i < end; i++) { if (rows[i][primary] < rows[lo][primary]) lo = i; if (rows[i][primary] > rows[hi][primary]) hi = i; }
    for (const i of [...new Set([lo, hi])].sort((x, y) => x - y)) out.push([rows[i][0] - start, ...indices.map(index => index < 0 ? null : rows[i][index])]);
  }
  return out;
}

function makeRecommendations(report, cli) {
  const list = [];
  const add = (id, level, title, evidence, action, extra = {}) => list.push({ id, level, title, evidence, action, ...extra });
  const version = report.metadata.version;
  const versionConflict = cli?.version && version && cli.version.split('.').slice(0, 2).join('.') !== version.split('.').slice(0, 2).join('.');
  const knownVersion = /^4\.[345]\./.test(version ?? '');
  if (versionConflict) add('version', 'warning', 'Версия конфигурации отличается от лога', `Лог: ${version}, CLI: ${cli.version}.`, 'Загрузи diff all, снятый на той же прошивке и в том же PID-профиле. Численные изменения отключены.');
  if (!report.reliable) add('quality', 'warning', 'Данных недостаточно для настройки', `${report.count} кадров; ${report.duration.toFixed(2)} с; неравномерных интервалов ${(report.irregularFraction * 100).toFixed(1)}%.`, 'Запиши минимум несколько секунд с ровной частотой от 500 Гц и подтверждённой шкалой гироскопа. Здесь остаются только описательные метрики.');
  for (const axis of report.axes) {
    const gyro = axis.spectrum, d = axis.dSpectrum;
    if (!gyro || !report.reliable) continue;
    if (gyro.highRms > 5 && gyro.prominenceDb > 8) {
      add(`peak-${axis.name}`, 'warning', `${axis.name}: выраженный пик ${gyro.peakHz} Гц`, `Gyro выше 100 Гц: RMS ${gyro.highRms} °/с; пик выше медианного спектра на ${gyro.prominenceDb} дБ.`, 'Проверь пропеллеры, крепёж и мягкий подвес FC. Сопоставь пик с RPM и гармониками, затем проверь RPM filter и диапазон dynamic notch. Одного спектра недостаточно, чтобы назвать источник вибрации.');
    }
    if (d && d.highFraction > 0.5 && d.highRms > 3) {
      let candidate = null;
      const settings = cli?.settings ?? {};
      const cutoff = Number(settings.dterm_lpf1_dyn_min_hz), maximum = Number(settings.dterm_lpf1_dyn_max_hz);
      const manual = /^(OFF|0)$/i.test(settings.simplified_dterm_filter ?? '');
      const filterEnabled = /^(PT1|BIQUAD|PT2|PT3)$/i.test(settings.dterm_lpf1_type ?? '');
      if (knownVersion && !versionConflict && cli?.version && manual && filterEnabled && cutoff >= 50 && cutoff <= 200 && maximum >= cutoff && !report.metadata.demo) {
        candidate = { parameter: 'dterm_lpf1_dyn_min_hz', current: cutoff, value: Math.round(cutoff * 0.9), confidence: 'Пробное изменение; эффект ещё не измерен' };
      }
      add(`dterm-${axis.name}`, 'warning', `${axis.name}: высокая частота в D-term`, `На частоты выше 100 Гц приходится ${(d.highFraction * 100).toFixed(0)}% мощности D-term в диапазоне 20 Гц…Найквист.`, candidate ? 'Попробуй уменьшить нижний срез динамического D-term LPF1 на 10%. Изменяй один параметр и сравни повторный лог: шум D-term и отслеживание setpoint. Это эвристический кандидат, не оптимизированная настройка.' : 'Проверь D-term lowpass и текущий профиль фильтров. Для численного кандидата нужны совпадающий diff all Betaflight 4.3–4.5 и ручные D-term фильтры; значения по умолчанию не подставляются.', { candidate });
    }
    if (axis.tracking && axis.tracking.relativeError > 0.25) {
      add(`tracking-${axis.name}`, 'info', `${axis.name}: проверь отслеживание команды`, `RMS ошибки ${axis.tracking.rmsError} °/с при |setpoint| > 30 °/с; отношение к RMS команды ${(axis.tracking.relativeError * 100).toFixed(0)}%.`, 'Выдели одинаковые резкие манёвры и сравни setpoint, gyro, P/D и feedforward. Ошибка включает задержку; она сама по себе не доказывает нехватку P. Автоматические значения PID пока не выдаются.');
    }
  }
  if (!report.axes.some(a => a.tracking)) add('missing-sp', 'info', 'Оценка PID ограничена', 'Нет достаточных пар gyro и setpoint на участках с |setpoint| > 30 °/с.', 'Для оценки PID запиши setpoint и axisP/I/D/F и несколько контролируемых манёвров. rcCommand не заменяет setpoint в °/с.');
  if (!report.axes.some(a => a.rawSpectrum)) add('missing-raw', 'info', 'Не измерено ослабление фильтра', 'Доступен только отфильтрованный gyro; нет gyroUnfilt.', 'Не ослабляй фильтры только из-за чистого gyro. Для сравнения до/после нужен нефильтрованный сигнал с известным масштабом.');
  if (!cli?.count) add('config', 'info', 'Добавь текущую конфигурацию', 'В полёте есть измерения, но нет полного контекста настроек.', 'В CLI Betaflight выполни diff all и загрузи сохранённый текст. Без текущих значений численные изменения фильтров не предлагаются.');
  const p = report.preferences;
  if (p.style === 'smooth') add('style-smooth', 'info', 'Цель: плавный отклик', 'Выбран плавный стиль. Это предпочтение пилота, а не обнаруженная неисправность.', 'В Rates уменьши максимальную скорость Roll/Pitch на 10% относительно текущей и проверь те же движения стиков. Затем отдельно подбирай expo. PID не уменьшай ради плавности: сначала устрани диагностированный шум.');
  if (p.style === 'sharp') add('style-sharp', 'info', 'Цель: резкий отклик', 'Выбран резкий стиль. Отслеживание setpoint и шум оцениваются отдельно.', 'После устранения вибраций запиши короткие резкие команды Roll/Pitch. Если gyro запаздывает, сравни feedforward и RC smoothing. Повышение P/D без проверки отклика не предлагается.');
  if (p.payload === 'loaded') add('payload', 'info', 'Настраивай в рабочей конфигурации с грузом', `Выбран полёт с грузом${p.takeoffWeight ? `; взлётная масса ${p.takeoffWeight} г` : ''}${p.payloadWeight ? `; масса груза ${p.payloadWeight} г` : ''}.`, 'Закрепи груз без люфта, проверь центр тяжести и запиши тест с той же массой. Сначала проверь запас тяги и насыщение моторов; одинаковая масса не задаёт универсальную прибавку PID.');
  if (report.motors?.saturationFraction > 0.05) add('motors', 'warning', 'Проверь запас тяги', `Хотя бы один мотор находится в верхних 2% диапазона на ${(report.motors.saturationFraction * 100).toFixed(1)}% кадров выбранного участка.`, 'Выдели участок без полного газа. Если насыщение сохраняется на коррекциях, проверь массу, центр тяжести, питание и винтомоторную группу до повышения PID.');
  if (!knownVersion) add('firmware', 'info', 'Численные кандидаты для этой прошивки отключены', `Версия: ${version ?? 'не указана'}. Правила параметров ограничены Betaflight 4.3–4.5.`, 'Спектр и метрики доступны. Для другой версии сначала нужно проверить названия, диапазоны и взаимодействие параметров.');
  if (!list.some(item => item.level === 'warning')) add('no-flags', 'ok', 'Пороговые проверки не выявили явных проблем', 'В доступных каналах не сработали диагностические пороги.', 'Это не подтверждает оптимальность PID. Проверь графики на нужных манёврах и сравни следующий полёт в тех же условиях.');
  return list.sort((a, b) => ({ warning: 0, info: 1, ok: 2 }[a.level] - { warning: 0, info: 1, ok: 2 }[b.level]));
}

export function analyze(session, options = {}) {
  const inputPreferences = options.preferences ?? {};
  const preferences = {
    style: ['smooth', 'sharp', 'balanced'].includes(inputPreferences.style) ? inputPreferences.style : 'balanced',
    payload: inputPreferences.payload === 'loaded' ? 'loaded' : 'none',
    takeoffWeight: Number(inputPreferences.takeoffWeight) > 0 ? Number(inputPreferences.takeoffWeight) : null,
    payloadWeight: inputPreferences.payload === 'loaded' && Number(inputPreferences.payloadWeight) > 0 ? Number(inputPreferences.payloadWeight) : null,
    frameSize: Number(inputPreferences.frameSize) > 0 ? Number(inputPreferences.frameSize) : null,
  };
  if (preferences.payloadWeight && preferences.takeoffWeight && preferences.payloadWeight >= preferences.takeoffWeight) throw new Error('Масса груза должна быть меньше полной взлётной массы.');
  const timeIndex = session.fields.indexOf('time');
  const from = Math.max(0, Number(options.from) || 0), to = Number.isFinite(Number(options.to)) && Number(options.to) > from ? Number(options.to) : session.end - session.start;
  // Put time first internally so plotting remains independent of CSV column order.
  const indices = [timeIndex, ...session.fields.map((_, i) => i).filter(i => i !== timeIndex)];
  const fields = indices.map(i => session.fields[i]);
  const rows = session.rows.filter(r => r[timeIndex] >= session.start + from && r[timeIndex] <= session.start + to).map(r => indices.map(i => r[i]));
  if (rows.length < 64) throw new Error('В выбранном интервале меньше 64 кадров. Расширь диапазон.');
  const times = rows.map(r => r[0]), deltas = times.slice(1).map((t, i) => t - times[i]);
  const dt = median(deltas), fs = 1 / dt;
  const irregular = deltas.filter(d => Math.abs(d / dt - 1) > 0.2).length / deltas.length;
  const duration = times.at(-1) - times[0];
  const axes = [];
  for (let a = 0; a < 3; a++) {
    const gi = fields.indexOf(`gyroADC[${a}]`);
    if (gi < 0) continue;
    const si = fields.indexOf(`setpoint[${a}]`), di = fields.indexOf(`axisD[${a}]`), pi = fields.indexOf(`axisP[${a}]`), ri = fields.indexOf(`gyroUnfilt[${a}]`);
    const gyro = rows.map(r => r[gi]);
    const active = si < 0 ? [] : rows.filter(r => Number.isFinite(r[si]) && Math.abs(r[si]) > 30);
    const activeDuration = active.length / fs;
    const tracking = active.length >= 64 && activeDuration >= 0.25 ? { rmsError: round(rms(active.map(r => r[gi] - r[si]))), relativeError: round(rms(active.map(r => r[gi] - r[si])) / rms(active.map(r => r[si])), 3), activeSeconds: round(activeDuration) } : null;
    const spec = spectrum(times, gyro, fs);
    axes.push({
      name: AXES[a], rms: round(rms(gyro)), tracking, spectrum: spec,
      dSpectrum: di < 0 ? null : spectrum(times, rows.map(r => r[di]), fs),
      rawSpectrum: ri < 0 ? null : spectrum(times, rows.map(r => r[ri]), fs),
      traces: downsample(rows, [gi, si], session.start),
      pid: di < 0 && pi < 0 ? null : downsample(rows, [di >= 0 ? di : pi, pi, di], session.start).map(r => [r[0], r[2], r[3]]),
      hasSetpoint: si >= 0,
    });
  }
  const motorIndices = fields.map((n, i) => /^motor\[\d+\]$/.test(n) ? i : -1).filter(i => i >= 0);
  const range = Array.isArray(session.metadata.motorOutput) ? session.metadata.motorOutput : String(session.metadata.motorOutput ?? '').split(',').map(Number);
  const motors = motorIndices.length && Number.isFinite(range[0]) && Number.isFinite(range[1]) && range[1] > range[0]
    ? { saturationFraction: round(rows.filter(r => motorIndices.some(i => Number.isFinite(r[i]) && r[i] >= range[1] - 0.02 * (range[1] - range[0]))).length / rows.length, 4) } : null;
  const report = {
    sessionId: session.id, metadata: session.metadata, count: rows.length,
    sampleRate: round(fs, 1), duration: round(duration, 3), from, to,
    irregularFraction: round(irregular, 4), warnings: [...session.warnings], axes,
    reliable: duration >= 2 && fs >= 500 && irregular < 0.01 && session.metadata.scaleVerified === true && axes.every(a => (a.spectrum?.windows ?? 0) >= 4),
    preferences, motors,
    method: 'Welch PSD; Hann; overlap 50%; at most 96 windows spread over the interval; no interpolation across gaps; high-frequency band ≥100 Hz. Tracking: unaligned RMS on |setpoint| >30 °/s. Heuristic thresholds, not an optimizer.',
  };
  if (irregular >= 0.01) report.warnings.push('Неравномерная запись: спектр рассчитан только по непрерывным окнам, рекомендации ограничены.');
  report.recommendations = makeRecommendations(report, options.cli);
  report.configuration = options.cli ? { version: options.cli.version, activeProfile: options.cli.activeProfile, settings: options.cli.settings } : null;
  return report;
}
