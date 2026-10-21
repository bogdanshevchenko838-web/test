import { readLog, demoSession } from './lib/logs.js';
import { analyze } from './lib/analysis.js';

let sessions = [];
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'load' || data.type === 'demo') {
      sessions = data.type === 'demo' ? [demoSession()] : readLog(data.buffer, data.name);
      self.postMessage({ type: 'loaded', sessions: sessions.map(s => ({ id: s.id, count: s.count, duration: s.end - s.start, version: s.metadata.version })) });
    } else if (data.type === 'analyze') {
      const session = sessions.find(s => s.id === data.sessionId);
      if (!session) throw new Error('Сначала загрузи полёт.');
      self.postMessage({ type: 'report', requestId: data.requestId, report: analyze(session, data.options) });
    }
  } catch (error) { self.postMessage({ type: 'error', requestId: data.requestId, message: String(error.message || error) }); }
};
