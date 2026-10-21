import Papa from 'papaparse';
import { FlightLogParser } from '../vendor/betaflight/flightlog_parser.js';

export const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_FRAMES = 1_000_000;
const SIGNAL = /^(time|gyroADC\[[0-2]\]|gyroUnfilt\[[0-2]\]|setpoint\[[0-3]\]|axis[PIDF]\[[0-2]\]|motor\[[0-7]\]|rcCommand\[3\])$/;
const numeric = value => value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : null;
const canonical = name => name.trim().replace(/\s*\([^)]*\)\s*$/, '').replace(/^gyroData/, 'gyroADC');

export function parseCli(text) {
  const profiles = {}, global = {};
  let profile = null, activeProfile = null;
  for (const line of text.split(/\r?\n/)) {
    const p = line.match(/^\s*profile\s+(\d+)\s*$/);
    if (p) { profile = Number(p[1]); activeProfile = profile; continue; }
    if (/^\s*rateprofile\s+\d+/.test(line)) { profile = 'rate'; continue; }
    const m = line.match(/^\s*set\s+([a-z][a-z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (m) {
      const target = profile === null ? global : profile === 'rate' ? null : (profiles[profile] ??= {});
      if (target) target[m[1]] = m[2];
    }
  }
  const version = text.match(/#\s*Betaflight[^\n]*?\b(\d+\.\d+(?:\.\d+)?)\b/i)?.[1] ?? null;
  return { version, activeProfile, settings: { ...global, ...(profiles[activeProfile] ?? {}) }, count: Object.keys(global).length + Object.keys(profiles[activeProfile] ?? {}).length };
}

function finishSession({ fields, rows, metadata, warnings = [], id = 0, rejected = 0 }) {
  const t = fields.indexOf('time'), gyro = [0, 1, 2].map(a => fields.indexOf(`gyroADC[${a}]`));
  if (t < 0 || !gyro.some(i => i >= 0)) throw new Error('Нужны поле time и хотя бы одна ось gyroADC[0…2].');
  let previous = -Infinity;
  const clean = [];
  for (const row of rows) {
    if (!Number.isFinite(row[t]) || row[t] <= previous || gyro.some(i => i >= 0 && !Number.isFinite(row[i]))) { rejected++; continue; }
    clean.push(row);
    previous = row[t];
  }
  if (clean.length < 64) throw new Error('В полёте меньше 64 корректных отсчётов. Нужен более длинный лог.');
  if (rejected) warnings.push(`Пропущено некорректных или немонотонных кадров: ${rejected}. Спектр не вычисляется через разрывы.`);
  return { id, fields, rows: clean, metadata, warnings, rejected, start: clean[0][t], end: clean.at(-1)[t], count: clean.length };
}

export function parseCsv(text) {
  const parsed = Papa.parse(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy', delimitersToGuess: [',', ';', '\t'] });
  if (parsed.errors.some(e => e.type === 'Quotes')) throw new Error('Незакрытые кавычки в CSV. Экспортируй файл заново.');
  const headerIndex = parsed.data.findIndex(row => row.some(c => canonical(c) === 'time') && row.some(c => /^gyroADC\[[0-2]\]$/.test(canonical(c))));
  if (headerIndex < 0) throw new Error('Это не CSV Blackbox: не найдены time и gyroADC. Загрузи .bbl/.bfl или CSV с исходными полями Betaflight.');
  const metadata = {};
  for (const row of parsed.data.slice(0, headerIndex)) if (row.length >= 2) metadata[row[0].replace(/^H\s+/, '').replace(/:$/, '').trim()] = row.slice(1).join(',').trim();
  const headers = parsed.data[headerIndex], names = headers.map(canonical);
  if (new Set(names).size !== names.length) throw new Error('В CSV повторяются имена полей. Нужен однозначный экспорт.');
  const selected = names.map((name, i) => SIGNAL.test(name) ? i : -1).filter(i => i >= 0);
  const fields = selected.map(i => names[i]), timeIndex = names.indexOf('time');
  const timeHeader = headers[timeIndex].toLowerCase();
  const timeScale = /\((s|sec)\)/.test(timeHeader) ? 1 : /\((ms)\)/.test(timeHeader) ? 1e-3 : 1e-6;
  const highRes = Number(metadata.blackbox_high_resolution) > 0 ? 10 : 1;
  let gyroScale = numeric(metadata.gyroScale);
  gyroScale = gyroScale !== null ? gyroScale * 1e6 / (Math.PI / 180) : 1;
  const warnings = ['CSV: time без единицы считается микросекундами, gyroADC без gyroScale — °/с. Проверь формат экспорта.'];
  const rows = [];
  let rejected = 0;
  for (const row of parsed.data.slice(headerIndex + 1)) {
    if (rows.length >= MAX_FRAMES) throw new Error('Больше 1 000 000 кадров. Экспортируй более короткий полёт.');
    if (row.length !== headers.length) { rejected++; continue; }
    rows.push(selected.map(i => {
      let value = numeric(row[i]);
      if (value === null) return null;
      if (i === timeIndex) value *= timeScale;
      else if (/^gyro(ADC|Unfilt)/.test(names[i]) && !/deg|°/.test(headers[i])) value *= gyroScale / highRes;
      else if (/^setpoint\[[0-2]\]$/.test(names[i]) && !/deg|°/.test(headers[i])) value /= highRes;
      return value;
    }));
  }
  const version = metadata.firmwareVersion || metadata['Firmware revision']?.match(/\b\d+\.\d+\.\d+\b/)?.[0] || null;
  const scaleVerified = numeric(metadata.gyroScale) > 0 || selected.filter(i => /^gyroADC/.test(names[i])).every(i => /deg|°/.test(headers[i]));
  return [finishSession({ fields, rows, rejected, warnings, metadata: { ...metadata, version, scaleVerified, format: 'CSV' } })];
}

export function parseBinary(buffer) {
  const data = new Uint8Array(buffer), marker = FlightLogParser.prototype.FLIGHT_LOG_START_MARKER;
  const starts = [];
  for (let i = 0; i <= data.length - marker.length; i++) {
    if (data[i] === marker[0] && marker.every((b, j) => data[i + j] === b)) { starts.push(i); i += marker.length - 1; }
  }
  if (!starts.length) throw new Error('Заголовок Blackbox не найден. Нужен .bbl/.bfl Betaflight, а не видео или архив.');
  if (starts.length > 100) throw new Error('В файле больше 100 полётов. Раздели лог перед загрузкой.');
  const sessions = [], failures = [];
  let totalFrames = 0;
  for (let id = 0; id < starts.length; id++) {
    const parser = new FlightLogParser(data), rows = [];
    let limitReached = false;
    try {
      parser.parseHeader(starts[id], starts[id + 1] ?? data.length);
      if (parser.sysConfig.firmwareType !== 3) throw new Error('В этой версии поддерживается только Betaflight.');
      // Defaults live on the prototype: copy only headers actually present in the file.
      const config = { ...parser.sysConfig };
      const names = parser.frameDefs.I.name;
      const selected = names.map((n, i) => SIGNAL.test(n) ? i : -1).filter(i => i >= 0);
      const fields = selected.map(i => names[i]);
      const hasScale = Object.hasOwn(config, 'gyroScale') && Number.isFinite(config.gyroScale) && config.gyroScale > 0;
      const scale = hasScale ? config.gyroScale * 1e6 / (Math.PI / 180) : 1;
      const highRes = config.blackbox_high_resolution > 0 ? 10 : 1;
      let rejected = 0;
      parser.onFrameReady = (valid, frame, type) => {
        if (type !== 'I' && type !== 'P') return;
        if (!valid) { rejected++; return; }
        if (++totalFrames > MAX_FRAMES) { limitReached = true; throw new Error('Больше 1 000 000 кадров во всём файле. Раздели лог на меньшие части.'); }
        rows.push(selected.map(i => {
          if (names[i] === 'time') return frame[i] / 1e6;
          if (/^gyro(ADC|Unfilt)/.test(names[i])) return frame[i] * scale / highRes;
          if (/^setpoint\[[0-2]\]$/.test(names[i])) return frame[i] / highRes;
          return Number.isFinite(frame[i]) ? frame[i] : null;
        }));
      };
      parser.parseLogData(false);
      const warnings = hasScale ? [] : ['В заголовке нет gyro_scale. Принята шкала 1 °/с на единицу; проверь лог перед оценкой PID.'];
      sessions.push(finishSession({ id, fields, rows, rejected, warnings, metadata: { ...config, version: config.firmwareVersion ?? null, scaleVerified: hasScale, format: 'Blackbox' } }));
    } catch (error) {
      if (limitReached) throw error;
      failures.push(`Полёт ${id + 1}: ${String(error.message || error)}`);
    }
  }
  if (!sessions.length) throw new Error(failures.join('\n'));
  for (const session of sessions) session.warnings.push(...failures);
  return sessions;
}

export function readLog(buffer, name) {
  if (!buffer.byteLength) throw new Error('Файл пуст. Выбери записанный полёт.');
  if (buffer.byteLength > MAX_FILE_BYTES) throw new Error('Максимальный размер — 128 МБ. Раздели большой лог.');
  return /\.csv$/i.test(name) ? parseCsv(new TextDecoder().decode(buffer)) : parseBinary(buffer);
}

export function demoSession() {
  const fields = ['time', ...[0, 1, 2].map(i => `gyroADC[${i}]`), ...[0, 1, 2].map(i => `setpoint[${i}]`), ...[0, 1, 2].map(i => `axisD[${i}]`)];
  const rows = [];
  for (let i = 0; i < 16000; i++) {
    const t = i / 1000;
    const sp = [0, 1, 2].map(a => 110 * Math.sin(2 * Math.PI * (0.45 + a * 0.12) * t) + 30 * Math.sin(2 * Math.PI * 1.8 * t));
    const gyro = sp.map((v, a) => v * 0.92 + (a === 0 ? 18 : 4) * Math.sin(2 * Math.PI * (180 + a * 30) * t) + 2 * Math.cos(2 * Math.PI * 67 * t));
    const d = [0, 1, 2].map(a => (a === 0 ? 12 : 2) * Math.sin(2 * Math.PI * 180 * t) + 4 * Math.cos(2 * Math.PI * 8 * t));
    rows.push([t, ...gyro, ...sp, ...d]);
  }
  return finishSession({ fields, rows, metadata: { version: '4.5.2', format: 'Демонстрация', demo: true, scaleVerified: true }, warnings: ['Синтетический полёт с намеренно добавленной вибрацией 180 Гц. Это пример, а не данные твоего коптера.'] });
}
