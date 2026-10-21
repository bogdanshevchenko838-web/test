import React, { useEffect, useRef, useState } from 'react';
import { Activity, Upload, ArrowUpRight, Download, SlidersHorizontal, ShieldCheck, FileText, AlertTriangle, Info, CheckCircle2, LoaderCircle, Save, Trash2, BookOpen, ChevronRight, X, Plus } from 'lucide-react';
import Chart from './components/Chart.jsx';
import { MAX_FILE_BYTES, parseCli } from './lib/logs.js';
import { SOURCES, sourcesFor } from './lib/sources.js';
import AnalysisWorker from './analysis.worker.js?worker&inline';

const DEFAULTS = { name: '', style: 'balanced', payload: 'none', takeoffWeight: '', payloadWeight: '', frameSize: '' };
const STORAGE_KEY = 'flightlab.crafts.v1';
const STYLES = [{ id: 'smooth', title: 'Плавный', detail: 'Кино · мягкое управление' }, { id: 'balanced', title: 'Баланс', detail: 'Универсальный отклик' }, { id: 'sharp', title: 'Резкий', detail: 'Фристайл · быстрый отклик' }];
const fmt = (v, suffix = '') => Number.isFinite(v) ? `${v.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}${suffix}` : '—';

function readProfiles() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && p.name.length <= 80).slice(0, 20).map(p => ({ ...DEFAULTS, ...Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, typeof p[k] === 'string' ? p[k].slice(0, 80) : ''])), id: p.id })) : [];
  } catch { return []; }
}

function saveFile(name, data, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Recommendation({ item, index }) {
  const Icon = item.level === 'warning' ? AlertTriangle : item.level === 'ok' ? CheckCircle2 : Info;
  return <article className={`recommendation ${item.level}`}>
    <div className="recommendation-number">{String(index + 1).padStart(2, '0')}</div>
    <div className="recommendation-body">
      <div className="recommendation-title"><h3>{item.title}</h3><Icon size={17} /></div>
      <p className="evidence">{item.evidence}</p>
      <div className="action-label">Что сделать</div><p className="action">{item.action}</p>
      {item.candidate && <div className="candidate"><span>Кандидат для контрольного полёта</span><code>{item.candidate.parameter}</code><strong>{item.candidate.current} <span>→</span> {item.candidate.value} Гц</strong><small>{item.candidate.confidence}. Сохрани исходное значение для отката.</small></div>}
      <div className="recommendation-sources">Основание: {sourcesFor(item.id).map(s => <a key={s.id} href={s.url} target="_blank" rel="noreferrer">{s.title}<ArrowUpRight size={11} /></a>)}</div>
    </div>
  </article>;
}

export default function App() {
  const [preferences, setPreferences] = useState({ ...DEFAULTS });
  const [profiles, setProfiles] = useState(readProfiles);
  const [profileId, setProfileId] = useState('');
  const [notice, setNotice] = useState('');
  const [filename, setFilename] = useState('');
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState(0);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [cli, setCli] = useState(null);
  const [cliName, setCliName] = useState('');
  const [cliConfirmed, setCliConfirmed] = useState(false);
  const [range, setRange] = useState([0, 0]);
  const [rangeDraft, setRangeDraft] = useState(['0', '']);
  const [axisName, setAxisName] = useState('Roll');
  const [chartTab, setChartTab] = useState('flight');
  const worker = useRef(null), requestId = useRef(0), loadId = useRef(0);
  const fileInput = useRef(null), cliInput = useRef(null);
  const activeSession = sessions.find(s => s.id === sessionId);
  const axis = report?.axes.find(a => a.name === axisName) ?? report?.axes[0];

  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    if (!sessions.length || !worker.current) return;
    const id = ++requestId.current;
    setBusy(true);
    const timer = setTimeout(() => worker.current?.postMessage({ type: 'analyze', requestId: id, sessionId, options: { from: range[0], to: range[1], preferences, cli: cliConfirmed ? cli : null } }), 200);
    return () => clearTimeout(timer);
  }, [sessions, sessionId, range, preferences, cli, cliConfirmed]);

  async function load(file, demo = false) {
    const generation = ++loadId.current;
    setError(''); setBusy(true); setReport(null); setSessions([]); setCli(null); setCliName(''); setCliConfirmed(false);
    worker.current?.terminate(); worker.current = null;
    if (file && file.size > MAX_FILE_BYTES) { setError('Максимальный размер лога — 128 МБ. Раздели большой файл.'); setBusy(false); return; }
    if (file && !/\.(csv|bbl|bfl|txt)$/i.test(file.name)) { setError('Поддерживаются .bbl, .bfl и .csv. Архив сначала нужно распаковать.'); setBusy(false); return; }
    setFilename(demo ? 'demo-flight.bbl · синтетический пример' : file?.name ?? '');
    try {
      const buffer = demo ? null : await file.arrayBuffer();
      if (generation !== loadId.current) return;
      const w = new AnalysisWorker();
      worker.current = w;
      w.onmessage = ({ data }) => {
        if (generation !== loadId.current) return;
        if (data.type === 'loaded') {
          const first = data.sessions[0];
          setSessions(data.sessions); setSessionId(first.id); setRange([0, first.duration]); setRangeDraft(['0', first.duration.toFixed(3)]);
        } else if (data.type === 'report' && data.requestId === requestId.current) {
          setReport(data.report); setError(''); setBusy(false);
        } else if (data.type === 'error' && (!data.requestId || data.requestId === requestId.current)) { setError(data.message); setBusy(false); }
      };
      w.onerror = () => { if (generation === loadId.current) { setError('Ошибка обработчика лога. Попробуй меньший файл или другой экспорт.'); setBusy(false); } };
      w.postMessage(demo ? { type: 'demo' } : { type: 'load', buffer, name: file.name }, demo ? [] : [buffer]);
    } catch (e) { if (generation === loadId.current) { setError(`Не удалось прочитать файл: ${e.message}`); setBusy(false); } }
  }

  function update(key, value) { setPreferences(p => ({ ...p, [key]: value })); }
  function persistProfiles(next) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setProfiles(next); return true; }
    catch { setNotice('Хранилище браузера недоступно. Текущий профиль работает до закрытия страницы.'); return false; }
  }
  function saveProfile() {
    const name = preferences.name.trim();
    if (!name) { setNotice('Введи название борта, чтобы сохранить профиль.'); return; }
    if (!profileId && profiles.length >= 20) { setNotice('Можно сохранить до 20 бортов. Удали ненужный профиль.'); return; }
    const id = profileId || crypto.randomUUID(), profile = { ...preferences, name, id };
    const next = profiles.some(p => p.id === id) ? profiles.map(p => p.id === id ? profile : p) : [...profiles, profile];
    if (persistProfiles(next)) { setProfileId(id); setNotice('Профиль сохранён в этом браузере. Логи и CLI не сохраняются.'); }
  }
  function selectProfile(id) {
    setProfileId(id); setPreferences(id ? { ...DEFAULTS, ...profiles.find(p => p.id === id) } : { ...DEFAULTS });
    setCli(null); setCliName(''); setCliConfirmed(false); setNotice('Проверь, что загруженный полёт относится к выбранному борту.');
  }
  async function loadCli(file) {
    if (!file) return;
    setCliConfirmed(false);
    if (file.size > 2 * 1024 * 1024) { setError('CLI-конфигурация должна быть текстовым файлом меньше 2 МБ.'); return; }
    try {
      const config = parseCli(await file.text());
      if (!config.count) throw new Error('Не найдены команды set. Сохрани текст diff all или dump all из CLI Betaflight.');
      setCli(config); setCliName(file.name); setError('');
    } catch (e) { setCli(null); setCliName(''); setError(e.message); }
  }
  function applyRange(e) {
    e.preventDefault();
    const [from, to] = rangeDraft.map(Number);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to > (activeSession?.duration ?? 0) + 0.001) { setError('Укажи интервал внутри полёта: начало ≥ 0, конец > начала.'); return; }
    setError(''); setRange([from, to]);
  }
  const chartSeries = !axis ? [] : chartTab === 'spectrum' ? [{ name: 'Gyro', points: axis.spectrum?.points }, { name: 'До фильтра', points: axis.rawSpectrum?.points }]
    : chartTab === 'pid' ? [{ name: 'P-term', points: axis.pid?.map(r => [r[0], r[1]]) }, { name: 'D-term', points: axis.pid?.map(r => [r[0], r[2]]) }]
      : [{ name: 'Gyro', points: axis.traces.map(r => [r[0], r[1]]) }, { name: 'Setpoint', points: axis.traces.map(r => [r[0], r[2]]) }];

  return <div className="app-shell">
    <header className="header"><a className="brand" href="#"><span className="brand-icon"><Activity size={21} /></span>flightlab<span className="beta">BETA</span></a><nav><a href="#analysis">Анализ</a><a href="#craft">Профиль борта</a><a href="#method">Методика</a></nav><span className="local-badge"><span />Локальная обработка</span></header>
    <main>
      <section className="hero"><div><div className="eyebrow"><span /> BETAFLIGHT BLACKBOX ANALYZER</div><h1>Пойми свой полёт.<br /><span>Настрой точнее.</span></h1><p>От полётного лога — к понятным действиям.<br className="desktop-break" /> Шум, фильтры и PID с учётом твоего борта и стиля.</p></div><div className="hero-visual" aria-hidden="true"><div className="radar"><div className="radar-ring ring-one" /><div className="radar-ring ring-two" /><div className="radar-cross" /><svg viewBox="0 0 300 140"><path d="M0 75 L30 75 L38 67 L45 87 L52 54 L60 91 L69 43 L77 102 L86 30 L94 115 L103 23 L112 122 L122 44 L130 98 L140 62 L149 83 L160 68 L171 78 L188 73 L220 75 L300 75" /></svg><span className="radar-label label-top">SIGNAL / NOISE</span><span className="radar-label label-bottom">Чёткий сигнал. Осмысленная настройка.</span></div></div></section>

      <div className="workspace">
        <aside className="sidebar">
          <section className="panel craft-panel" id="craft"><div className="section-heading"><SlidersHorizontal size={18} /><h2>Твой борт</h2><span className="step-number">01</span></div>
            {profiles.length > 0 && <label className="field">Сохранённые борта<select aria-label="Сохранённые борта" value={profileId} onChange={e => selectProfile(e.target.value)}><option value="">Новый профиль</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
            <label className="field">Название<input value={preferences.name} maxLength={80} onChange={e => update('name', e.target.value)} placeholder="Например, Nazgul 5″" /></label>
            <div className="field"><span>Какой отклик хочешь?</span><div className="style-options">{STYLES.map(s => <button type="button" aria-pressed={preferences.style === s.id} className={`style-option ${preferences.style === s.id ? 'selected' : ''}`} key={s.id} onClick={() => update('style', s.id)}><span className="radio-dot" /><span><strong>{s.title}</strong><small>{s.detail}</small></span></button>)}</div></div>
            <div className="field"><span>Полезная нагрузка</span><div className="segmented"><button aria-pressed={preferences.payload === 'none'} className={preferences.payload === 'none' ? 'active' : ''} onClick={() => update('payload', 'none')}>Без груза</button><button aria-pressed={preferences.payload === 'loaded'} className={preferences.payload === 'loaded' ? 'active' : ''} onClick={() => update('payload', 'loaded')}>С грузом</button></div></div>
            <div className="field-grid"><label className="field">Взлётная масса, г<input type="number" min="1" max="50000" placeholder="С аккумулятором" value={preferences.takeoffWeight} onChange={e => update('takeoffWeight', e.target.value)} /></label><label className="field">Винты, дюймы<input type="number" min="0.5" max="40" step="0.1" placeholder="Например, 5" value={preferences.frameSize} onChange={e => update('frameSize', e.target.value)} /></label></div>
            {preferences.payload === 'loaded' && <label className="field">Масса груза, г<input type="number" min="1" max="50000" placeholder="Входит во взлётную массу" value={preferences.payloadWeight} onChange={e => update('payloadWeight', e.target.value)} /></label>}
            <div className="profile-actions"><button className="button secondary" onClick={saveProfile}><Save size={14} />Сохранить профиль</button>{profileId && <button className="icon-button" title="Удалить профиль" aria-label="Удалить профиль" onClick={() => { if (persistProfiles(profiles.filter(p => p.id !== profileId))) { setProfileId(''); setNotice('Профиль удалён.'); } }}><Trash2 size={16} /></button>}</div>
            <p className="hint">Профили хранятся только в твоём браузере. Масса и размер не превращаются в универсальные PID.</p>
          </section>
          <section className="privacy-card"><ShieldCheck size={22} /><div><strong>Твои логи — твои данные</strong><p>Анализ внутри браузера. Без аккаунта, облачной загрузки и общих пресетов.</p></div></section>
        </aside>

        <div className="main-column" id="analysis">
          <section className="panel upload-panel"><div className="section-heading"><Upload size={18} /><h2>Полётные данные</h2><span className="step-number">02</span></div>
            <input ref={fileInput} type="file" accept=".bbl,.bfl,.csv,.BBL,.BFL,.txt" hidden aria-label="Загрузить Blackbox" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) load(file); }} />
            <div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); }}>
              <span className="upload-icon"><Upload size={24} /></span><h3>{filename || 'Загрузи Blackbox полёта'}</h3><p>Перетащи файл сюда или выбери на устройстве</p><button className="button primary" onClick={() => fileInput.current?.click()}>Выбрать лог<ArrowUpRight size={16} /></button><span className="file-types">.BBL &nbsp; .BFL &nbsp; .CSV <span>·</span> до 128 МБ</span>
            </div>
            <div className="upload-bottom"><span>Пока нет лога под рукой?</span><button className="text-button" onClick={() => load(null, true)}>Открыть демо<ChevronRight size={14} /></button></div>
            <div className="config-upload"><div><FileText size={19} /><span><strong>{cliName || 'Добавь текущие настройки'}</strong><small>{cli ? `${cli.count} параметров · BF ${cli.version || 'версия не найдена'} · PID-профиль ${cli.activeProfile ?? 'не указан'}` : 'diff all / dump all из CLI — для конкретных изменений'}</small></span></div><button className="button secondary small" onClick={() => cliInput.current?.click()}><Plus size={14} />{cli ? 'Заменить' : 'Добавить'}</button></div>
            <input type="file" hidden ref={cliInput} accept=".txt,.config,.cli,.log" aria-label="Загрузить CLI конфигурацию" onChange={e => { loadCli(e.target.files?.[0]); e.target.value = ''; }} />
            {cli && <label className="checkbox-label"><input type="checkbox" checked={cliConfirmed} onChange={e => setCliConfirmed(e.target.checked)} />Это настройки того же борта и PID-профиля, что и выбранный полёт</label>}
          </section>

          {notice && <div className="notice" role="status"><Info size={16} /><span>{notice}</span><button aria-label="Закрыть сообщение" onClick={() => setNotice('')}><X size={14} /></button></div>}
          {error && <div className="error" role="alert"><AlertTriangle size={18} /><span>{error}</span></div>}
          {busy && <div className="processing" role="status"><LoaderCircle className="spin" size={18} />Обрабатываю данные полёта…</div>}

          {sessions.length > 0 && <div className="analysis-controls"><label className="inline-field">Полёт<select value={sessionId} aria-label="Полёт" onChange={e => { const id = Number(e.target.value), s = sessions.find(s => s.id === id); setSessionId(id); setRange([0, s.duration]); setRangeDraft(['0', s.duration.toFixed(3)]); setCliConfirmed(false); }} >{sessions.map(s => <option key={s.id} value={s.id}>#{s.id + 1} · {s.duration.toFixed(1)} с · BF {s.version || '?'}</option>)}</select></label><form className="range-form" onSubmit={applyRange}><span>Интервал, с</span><input aria-label="Начало интервала" type="number" step="0.001" min="0" value={rangeDraft[0]} onChange={e => setRangeDraft([e.target.value, rangeDraft[1]])} /><span>—</span><input aria-label="Конец интервала" type="number" step="0.001" min="0" value={rangeDraft[1]} onChange={e => setRangeDraft([rangeDraft[0], e.target.value])} /><button className="button secondary small" type="submit">Применить</button></form></div>}

          {report && <div className={busy ? 'results stale' : 'results'} aria-busy={busy}>
            {report.metadata.demo && <div className="demo-banner">ДЕМО · Синтетический сигнал с пиком 180 Гц. Рекомендации относятся к примеру.</div>}
            <div className="metrics"><div className="metric"><span>Длительность участка</span><strong>{fmt(report.duration)} <small>с</small></strong></div><div className="metric"><span>Частота записи</span><strong>{fmt(report.sampleRate)} <small>Гц</small></strong></div><div className="metric"><span>Кадры</span><strong>{fmt(report.count)}</strong></div><div className="metric"><span>Пик · {axis?.name}</span><strong>{fmt(axis?.spectrum?.peakHz)} <small>Гц</small></strong></div></div>
            <section className="panel chart-panel"><div className="chart-header"><h2>Сигнал под контролем</h2><div className="axis-tabs">{report.axes.map(a => <button key={a.name} aria-pressed={axis?.name === a.name} className={axis?.name === a.name ? 'active' : ''} onClick={() => setAxisName(a.name)}>{a.name}</button>)}</div></div><div className="chart-tabs">{[['flight', 'Gyro / Setpoint'], ['spectrum', 'Спектр вибраций'], ['pid', 'P / D-term']].map(([id, title]) => <button key={id} className={chartTab === id ? 'active' : ''} onClick={() => setChartTab(id)}>{title}</button>)}</div><Chart key={`${axis?.name}-${chartTab}`} series={chartSeries} xLabel={chartTab === 'spectrum' ? 'Частота, Гц' : 'Время, с'} yLabel={chartTab === 'spectrum' ? 'PSD, дБ' : chartTab === 'pid' ? 'Ед. PID' : '°/с'} /><div className="chart-footnote">{chartTab === 'spectrum' ? `Welch · окно Hann · Δf ${fmt(axis?.spectrum?.resolutionHz)} Гц · ${axis?.spectrum?.windows ?? 0} окон. Пики выше Найквиста не видны.` : axis?.tracking ? `RMS ошибки: ${axis.tracking.rmsError} °/с · активные команды: ${axis.tracking.activeSeconds} с. Задержка не компенсирована.` : 'Недостаточно активных команд setpoint для оценки ошибки отслеживания.'}</div></section>
            <section className="panel recommendations-panel"><div className="section-heading"><Activity size={18} /><h2>Что поправить</h2><span className="count-badge">{report.recommendations.length}</span><button className="text-button export-button" disabled={busy || !!error} onClick={() => saveFile('flightlab-report.json', JSON.stringify({ filename, craftName: preferences.name || null, generatedAt: new Date().toISOString(), ...report, sources: SOURCES }, null, 2))}><Download size={14} />Отчёт</button></div><p className="section-description">Сначала причины и качество данных, затем фильтры и отклик. По одному изменению за контрольный полёт.</p>{report.recommendations.map((r, i) => <Recommendation item={r} index={i} />)}</section>
            {report.warnings.length > 0 && <details className="warnings"><summary>Качество и ограничения данных ({report.warnings.length})</summary>{report.warnings.map((w, i) => <p key={i}>{w}</p>)}</details>}
          </div>}

          {!report && !busy && <section className="empty-state"><div className="empty-grid"><div><span>01 / ВИБРАЦИИ</span><h3>Найди источник шума</h3><p>Спектр гироскопа и пики, которые стоит проверить.</p></div><div><span>02 / ФИЛЬТРЫ</span><h3>Измени осмысленно</h3><p>Текущий параметр, причина и кандидат для проверки.</p></div><div><span>03 / ОТКЛИК</span><h3>Настрой под себя</h3><p>Плавный или резкий стиль, с учётом массы и груза.</p></div></div></section>}
        </div>
      </div>

      <section className="method-section" id="method"><div className="method-intro"><div className="eyebrow"><BookOpen size={14} /> ПРОЗРАЧНАЯ МЕТОДИКА</div><h2>Объяснение важнее<br />магических чисел.</h2><p>Мы отделяем измерения, твои предпочтения и пробные настройки. Текущие пороги — инженерные эвристики, а не экспертно проверенный автотюнер.</p><p>Декодер Betaflight · спектр Welch · сравнение Gyro/Setpoint. Численные кандидаты фильтров ограничены версиями 4.3–4.5; PID автоматически не рассчитывается.</p></div><div className="source-list">{SOURCES.map((s, i) => <a href={s.url} key={s.id} target="_blank" rel="noreferrer"><span className="source-index">0{i + 1}</span><div><h3>{s.title}</h3><p>{s.note}</p></div><ArrowUpRight size={18} /></a>)}</div></section>
    </main><footer><a className="brand" href="#"><Activity size={18} />flightlab</a><span>Для пилотов, которым важны данные.</span><span>Betaflight · GPL-3.0 · v0.1</span></footer>
  </div>;
}
