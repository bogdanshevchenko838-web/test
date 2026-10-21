export const SOURCES = [
  { id: 'filters', title: 'Betaflight: PID Tuning / Filters', url: 'https://betaflight.com/docs/wiki/app/pid-tuning-tab', note: 'Назначение PID-слайдеров, RC smoothing, D-term фильтров, RPM и dynamic notch. Названия и поведение зависят от версии.' },
  { id: 'rpm', title: 'Betaflight: DShot RPM Filtering', url: 'https://betaflight.com/docs/wiki/guides/current/DSHOT-RPM-Filtering', note: 'RPM требует исправной двунаправленной телеметрии и верного числа полюсов. RPM не устраняет все резонансы рамы.' },
  { id: 'sliders', title: 'Betaflight 4.3: Tuning Notes', url: 'https://betaflight.com/docs/wiki/tuning/4-3-Tuning-Notes', note: 'Ручные значения и включённые слайдеры могут конфликтовать. Для настройки фильтров рекомендована запись около 2 кГц; 500 Гц — лишь минимальный порог этого инструмента.' },
  { id: 'style', title: 'Freestyle Tuning Principles', url: 'https://betaflight.com/docs/wiki/guides/current/Freestyle-Tuning-Principles', note: 'Авторы: Elia Palme, Daniel Appel, Hugo Chiang, Mark Spatz и соавторы. Документ в работе, численные примеры относятся к конкретным 5″ сборкам; это не универсальный пресет.' },
];

export function sourcesFor(id) {
  const ids = id.startsWith('peak-') ? ['rpm', 'filters'] : id.startsWith('dterm-') ? ['filters', 'sliders'] : id.startsWith('style-') ? ['filters', 'style'] : id === 'payload' || id === 'motors' || id.startsWith('tracking-') ? ['filters', 'style'] : ['sliders'];
  return SOURCES.filter(s => ids.includes(s.id));
}
