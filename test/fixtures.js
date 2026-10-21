export function binaryFlight({ highResolution = false, frames = 4096, offset = 0 } = {}) {
  const names = ['loopIteration', 'time', 'gyroADC[0]', 'gyroADC[1]', 'gyroADC[2]', 'setpoint[0]', 'setpoint[1]', 'setpoint[2]', 'axisD[0]'];
  const header = [
    'H Product:Blackbox flight data recorder by Nicholas Sherlock',
    'H Data version:2', 'H Firmware type:Cleanflight', 'H Firmware revision:Betaflight 4.5.2 (test)',
    'H I interval:1', 'H P interval:1/1', 'H gyro_scale:3f800000',
    `H blackbox_high_resolution:${highResolution ? 1 : 0}`,
    `H Field I name:${names.join(',')}`,
    `H Field I signed:${names.map((_, i) => i < 2 ? 0 : 1).join(',')}`,
    `H Field I predictor:${names.map(() => 0).join(',')}`,
    `H Field I encoding:${names.map((_, i) => i < 2 ? 1 : 0).join(',')}`,
    `H Field P predictor:${names.map(() => 0).join(',')}`,
    `H Field P encoding:${names.map((_, i) => i < 2 ? 1 : 0).join(',')}`,
  ].join('\n') + '\n';
  const bytes = [...new TextEncoder().encode(header)];
  const unsigned = v => { do { let b = v & 127; v >>>= 7; if (v) b |= 128; bytes.push(b); } while (v); };
  const signed = v => unsigned((v << 1) ^ (v >> 31));
  const multiplier = highResolution ? 10 : 1;
  for (let i = 0; i < frames; i++) {
    bytes.push(73); unsigned(i); unsigned(offset + i * 1000);
    const sp = Math.round(100 * Math.sin(2 * Math.PI * i / 1000));
    const gyro = Math.round(sp + 12 * Math.sin(2 * Math.PI * 180 * i / 1000));
    [gyro, sp, -sp, sp, sp, -sp].forEach(v => signed(v * multiplier));
    signed(Math.round(10 * Math.sin(2 * Math.PI * 180 * i / 1000)));
  }
  return new Uint8Array(bytes);
}

export function csvFlight({ seconds = 5, sampleRate = 1000, gyroUnit = ' (deg/s)', includeD = true, gap = false } = {}) {
  const lines = ['firmwareVersion,4.5.2', 'time (us),gyroADC[0]' + gyroUnit + ',setpoint[0] (deg/s)' + (includeD ? ',axisD[0]' : '')];
  for (let i = 0; i < seconds * sampleRate; i++) {
    const t = i / sampleRate, sp = 100 * Math.sin(2 * Math.PI * 2 * t);
    const gyro = sp + 12 * Math.sin(2 * Math.PI * 180 * t), d = 14 * Math.sin(2 * Math.PI * 180 * t);
    lines.push([Math.round(t * 1e6) + (gap && i >= seconds * sampleRate / 2 ? 200000 : 0), gyro, sp, ...(includeD ? [d] : [])].join(','));
  }
  return lines.join('\n');
}
