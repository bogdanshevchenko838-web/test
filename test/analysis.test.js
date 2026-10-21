import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBinary, parseCsv, parseCli, demoSession, readLog } from '../src/lib/logs.js';
import { analyze, spectrum } from '../src/lib/analysis.js';
import { binaryFlight, csvFlight } from './fixtures.js';

test('native Blackbox decodes signed frames, gyro scale and high-resolution setpoints', () => {
  const normal = parseBinary(binaryFlight().buffer)[0];
  const high = parseBinary(binaryFlight({ highResolution: true }).buffer)[0];
  assert.equal(normal.count, 4096);
  assert.equal(normal.metadata.version, '4.5.2');
  const gi = normal.fields.indexOf('gyroADC[0]'), si = normal.fields.indexOf('setpoint[0]');
  assert.ok(normal.rows.some(r => r[gi] < 0));
  assert.ok(Math.abs(normal.rows[201][gi] - high.rows[201][gi]) < 0.0001);
  assert.equal(normal.rows[201][si], high.rows[201][si]);
  const report = analyze(normal);
  assert.equal(report.reliable, true);
  assert.ok(Math.abs(report.axes[0].spectrum.peakHz - 180) < 1);
});

test('native Blackbox separates multiple flights with independent timestamps', () => {
  const a = binaryFlight({ frames: 1024 }), b = binaryFlight({ frames: 2048 });
  const data = new Uint8Array(a.length + b.length); data.set(a); data.set(b, a.length);
  const sessions = parseBinary(data.buffer);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].count, 1024);
  assert.equal(sessions[1].count, 2048);
});

test('CSV metadata, explicit units and time scaling yield a meaningful analysis', () => {
  const [session] = parseCsv(csvFlight());
  const report = analyze(session);
  assert.equal(report.sampleRate, 1000);
  assert.ok(Math.abs(report.duration - 4.999) < 0.001);
  assert.ok(Math.abs(report.axes[0].spectrum.peakHz - 180) < 1);
  assert.ok(report.axes[0].tracking.rmsError > 8 && report.axes[0].tracking.rmsError < 9);
});

test('CSV accepts time in seconds in a non-first column', () => {
  const data = ['gyroADC[0] (deg/s);time (s);setpoint[0] (deg/s)'];
  for (let i = 0; i < 1000; i++) data.push(`${Math.sin(i)};${i / 1000};0`);
  const r = analyze(parseCsv(data.join('\n'))[0]);
  assert.equal(r.sampleRate, 1000);
  assert.equal(r.axes[0].traces[0][0], 0);
});

test('Welch resolves a known sine and its PSD integral recovers RMS', () => {
  const fs = 1000, times = Array.from({ length: 8192 }, (_, i) => i / fs);
  const result = spectrum(times, times.map(t => 10 * Math.sin(2 * Math.PI * 180 * t)), fs);
  assert.ok(Math.abs(result.peakHz - 180) < result.resolutionHz);
  assert.ok(Math.abs(result.highRms - 10 / Math.sqrt(2)) < 0.05);
});

test('gaps are never bridged by a spectrum window', () => {
  const times = Array.from({ length: 500 }, (_, i) => Math.floor(i / 10) + i % 10 / 1000);
  assert.equal(spectrum(times, times.map(t => Math.sin(t)), 1000), null);
});

test('bad, nonmonotone, and empty samples are rejected rather than zero-filled', () => {
  const lines = csvFlight({ seconds: 1 }).split('\n');
  lines[30] = '27000,,0,0';
  const session = parseCsv(lines.join('\n'))[0];
  assert.equal(session.rejected, 1);
  assert.equal(session.count, 999);
  assert.throws(() => parseCsv('time,gyroADC[0]\n0,0'), /64/);
  assert.throws(() => parseCsv('x,y\n1,2'), /не найдены/);
  assert.throws(() => readLog(new ArrayBuffer(0), 'empty.bbl'), /пуст/);
});

test('diff all uses the restored active PID profile; rate settings do not overwrite it', () => {
  const cli = parseCli('# Betaflight / STM32F405 4.5.2\nset dyn_notch_q = 500\nprofile 0\nset p_roll = 40\nprofile 1\nset p_roll = 70\nrateprofile 1\nset p_roll = 999\nprofile 0');
  assert.equal(cli.version, '4.5.2');
  assert.equal(cli.settings.p_roll, '40');
  assert.equal(cli.settings.dyn_notch_q, '500');
  assert.equal(cli.activeProfile, 0);
});

const cli = parseCli('# Betaflight / STM32F405 4.5.2\nset simplified_dterm_filter = OFF\nset dterm_lpf1_type = PT1\nset dterm_lpf1_dyn_min_hz = 100\nset dterm_lpf1_dyn_max_hz = 200');
test('a filter candidate requires current manual settings, verified scale and matched firmware', () => {
  const session = parseCsv(csvFlight())[0];
  const r = analyze(session, { cli });
  const candidate = r.recommendations.find(x => x.candidate)?.candidate;
  assert.deepEqual(candidate && [candidate.current, candidate.value], [100, 90]);
  const mismatch = analyze(session, { cli: { ...cli, version: '4.4.3' } });
  assert.ok(mismatch.recommendations.some(x => x.id === 'version'));
  assert.ok(mismatch.recommendations.every(x => !x.candidate));
  const sliders = analyze(session, { cli: { ...cli, settings: { ...cli.settings, simplified_dterm_filter: 'ON' } } });
  assert.ok(sliders.recommendations.every(x => !x.candidate));
  const unknownScale = analyze(parseCsv(csvFlight({ gyroUnit: '' }))[0], { cli });
  assert.equal(unknownScale.reliable, false);
  assert.ok(unknownScale.recommendations.every(x => !x.candidate));
  const newFirmware = analyze({ ...session, metadata: { ...session.metadata, version: '2026.6.0' } }, { cli: { ...cli, version: '2026.6.0' } });
  assert.ok(newFirmware.recommendations.every(x => !x.candidate));
});

test('pilot preference and payload affect advice, never fabricate different measurements', () => {
  const session = demoSession();
  const a = analyze(session, { preferences: { style: 'sharp', payload: 'none' } });
  const b = analyze(session, { preferences: { style: 'smooth', payload: 'loaded', takeoffWeight: '900', payloadWeight: '200' } });
  assert.deepEqual(a.axes.map(x => x.spectrum), b.axes.map(x => x.spectrum));
  assert.ok(a.recommendations.some(x => x.id === 'style-sharp'));
  assert.ok(!a.recommendations.some(x => x.id === 'payload'));
  assert.ok(b.recommendations.some(x => x.id === 'style-smooth'));
  assert.ok(b.recommendations.find(x => x.id === 'payload').evidence.includes('900'));
  assert.ok(b.recommendations.every(x => !x.candidate));
  assert.throws(() => analyze(session, { preferences: { payload: 'loaded', takeoffWeight: 500, payloadWeight: 600 } }), /Масса/);
});

test('too short and low-rate flights do not receive tuning candidates', () => {
  for (const options of [{ seconds: 1 }, { sampleRate: 250 }]) {
    const r = analyze(parseCsv(csvFlight(options))[0], { cli });
    assert.equal(r.reliable, false);
    assert.ok(r.recommendations.every(x => !x.candidate));
  }
});

test('missing setpoint is not substituted by rcCommand or a zero trace', () => {
  const session = demoSession();
  const si = session.fields.indexOf('setpoint[0]');
  session.fields[si] = 'rcCommand[0]';
  const r = analyze(session);
  assert.equal(r.axes[0].tracking, null);
  assert.ok(r.axes[0].traces.every(p => p[2] === null));
});
