/** 截止前通知:横幅已在页面内,这里补 WebAudio 提示音 + 系统通知 */
let audioCtx: AudioContext | null = null;

export function beep() {
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    for (const start of [0, 0.25]) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      osc.connect(gain); gain.connect(audioCtx.destination);
      const t0 = audioCtx.currentTime + start;
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
      osc.start(t0); osc.stop(t0 + 0.2);
    }
  } catch { /* 无声环境忽略 */ }
}

export async function ensureNotifyPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* 忽略 */ }
  }
}

export function sysNotify(title: string, body: string) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification(title, { body }); } catch { /* 忽略 */ }
  }
}
