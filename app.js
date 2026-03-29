/* ═══════════════════════════════════════════
   ESP32 LED CONTROL DASHBOARD — app.js
   ═══════════════════════════════════════════ */

// ── SUPABASE CONFIG (edit these two values) ─────────────────────
const SB_URL     = "https://smjagmrdwkjdstipxfvd.supabase.co";
const SB_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNtamFnbXJkd2tqZHN0aXB4ZnZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1OTM4NzcsImV4cCI6MjA5MDE2OTg3N30.77N8ecwRidtqJ4kw0q9BrGzltpoOKJl5wnxKsNgY-fU";


// ─────────────────────────────────────────────────────────────────

// ESP32 is considered offline if no heartbeat within this many ms
const ESP32_TIMEOUT_MS = 12000;  // 12 seconds
// ─────────────────────────────────────────────────────────────────
 
const state = {
  blue: { on: false, mode: 'solid', speed: 1 },
  red:  { on: false, mode: 'solid', speed: 1 }
};
 
let sb              = null;
let esp32LastSeen   = null;   // timestamp of last ESP32 heartbeat
let esp32Online     = false;
let espCheckTimer   = null;
 
const t0 = Date.now();
 
// ── SESSION UPTIME ────────────────────────────────────────────────
setInterval(() => {
  const s = Math.floor((Date.now() - t0) / 1000);
  document.getElementById('s-up').textContent =
    [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60]
      .map(v => String(v).padStart(2, '0'))
      .join(':');
}, 1000);
 
// ── BOOT ─────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js');
 
  sb = window.supabase.createClient(SB_URL, SB_ANON_KEY);
 
  // Ensure DB rows exist
  await sb.from('led_control').upsert([
    { led: 'blue', state: 'OFF', mode: 'solid', blink_speed_hz: 1, pin: 2 },
    { led: 'red',  state: 'OFF', mode: 'solid', blink_speed_hz: 1, pin: 4 }
  ], { onConflict: 'led' });
 
  // Dashboard is connected to Supabase
  setDashboardConnected(true);
 
  // Pull last known ESP32 heartbeat from DB
  await checkInitialEsp32Status();
 
  // Subscribe to realtime — ESP32 writes updated_at on every poll
  // which triggers a DB change we can listen to
  sb.channel('esp32-heartbeat')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'led_control'
    }, payload => {
      // ESP32 touches the row every poll cycle — treat as heartbeat
      if (payload.new && payload.new.updated_at) {
        onEsp32Heartbeat(payload.new.updated_at);
      }
    })
    .subscribe();
 
  // Periodically check if ESP32 has gone silent
  espCheckTimer = setInterval(checkEsp32Timeout, 3000);
});
 
// ── ESP32 HEARTBEAT LOGIC ────────────────────────────────────────
 
async function checkInitialEsp32Status() {
  const { data } = await sb
    .from('led_control')
    .select('updated_at')
    .eq('led', 'blue')
    .single();
 
  if (data && data.updated_at) {
    onEsp32Heartbeat(data.updated_at);
  } else {
    setEsp32Status('searching');
  }
}
 
function onEsp32Heartbeat(updatedAtISO) {
  const ts = new Date(updatedAtISO).getTime();
  const now = Date.now();
 
  // If updated_at is a placeholder/very old, don't count it
  if (now - ts > ESP32_TIMEOUT_MS) {
    setEsp32Status('offline');
    return;
  }
 
  esp32LastSeen = ts;
  setEsp32Status('online');
  updatePingDisplay(ts);
}
 
function checkEsp32Timeout() {
  if (!esp32LastSeen) { setEsp32Status('searching'); return; }
  const age = Date.now() - esp32LastSeen;
  if (age > ESP32_TIMEOUT_MS) {
    setEsp32Status('offline');
  }
}
 
function updatePingDisplay(ts) {
  const diff = Math.round((Date.now() - ts) / 1000);
  const ping = diff < 2 ? 'just now' : `${diff}s ago`;
  document.getElementById('esp-ping').textContent = ping;
}
 
// Update ping display every second
setInterval(() => {
  if (esp32LastSeen) updatePingDisplay(esp32LastSeen);
}, 1000);
 
// ── STATUS SETTERS ────────────────────────────────────────────────
 
function setDashboardConnected(on) {
  const ring = document.getElementById('status-ring');
  const text = document.getElementById('status-text');
  ring.classList.toggle('connected', on);
  text.textContent = on ? 'Connected' : 'Disconnected';
}
 
function setEsp32Status(status) {
  const dot   = document.getElementById('esp-dot');
  const label = document.getElementById('esp-label');
  const sub   = document.getElementById('esp-sub');
  const upEl  = document.getElementById('esp-uptime');
 
  dot.className = 'esp-dot';  // reset
 
  if (status === 'online') {
    esp32Online = true;
    dot.classList.add('online');
    label.textContent = 'Online';
    sub.textContent   = 'ESP32 is connected';
    upEl.textContent  = 'Active';
  } else if (status === 'offline') {
    esp32Online = false;
    dot.classList.add('offline');
    label.textContent = 'Offline';
    sub.textContent   = 'ESP32 not responding';
    upEl.textContent  = '—';
    document.getElementById('esp-ping').textContent = '—';
  } else {
    // searching
    esp32Online = false;
    dot.classList.add('searching');
    label.textContent = 'Searching…';
    sub.textContent   = 'Waiting for ESP32';
    upEl.textContent  = '—';
  }
}
 
// ── SUPABASE PUSH ────────────────────────────────────────────────
async function push(led) {
  if (!sb) return;
  const d = state[led];
  await sb.from('led_control').upsert({
    led,
    state:          d.on ? 'ON' : 'OFF',
    mode:           d.mode,
    blink_speed_hz: d.speed,
    pin:            led === 'blue' ? 2 : 4,
    updated_at:     new Date().toISOString()
  }, { onConflict: 'led' });
}
 
// ── EVENT HANDLERS ────────────────────────────────────────────────
function handleToggle(led) {
  state[led].on = !state[led].on;
  const btn = document.getElementById(`tog-${led}`);
  btn.setAttribute('aria-checked', state[led].on ? 'true' : 'false');
  updateUI(led);
  push(led);
}
 
function setMode(led, mode) {
  state[led].mode = mode;
  const spd = document.getElementById(`${led}-spd`);
  spd.disabled = (mode !== 'blink');
  document.getElementById(`${led}-solid`).classList.toggle('active', mode === 'solid');
  document.getElementById(`${led}-blink`).classList.toggle('active', mode === 'blink');
  if (mode === 'blink') updateFill(led);
  updateUI(led);
  push(led);
}
 
function handleSpeed(led, val) {
  state[led].speed = parseInt(val);
  updateFill(led);
  updateUI(led);
  push(led);
}
 
// ── UI ────────────────────────────────────────────────────────────
function updateFill(led) {
  const el  = document.getElementById(`${led}-spd`);
  const pct = ((state[led].speed - 1) / 9 * 100).toFixed(1) + '%';
  el.style.setProperty('--pct', pct);
}
 
function updateUI(led) {
  const d    = state[led];
  const card = document.getElementById(`card-${led}`);
 
  card.classList.toggle('on', d.on);
 
  if (d.on && d.mode === 'blink') {
    card.classList.add('blink-mode');
    card.style.setProperty('--bs', (1000 / d.speed).toFixed(0) + 'ms');
  } else {
    card.classList.remove('blink-mode');
    card.style.removeProperty('--bs');
  }
 
  // Labels
  const stateWord = d.on ? 'On' : 'Off';
  document.getElementById(`${led}-state-label`).textContent = stateWord;
  document.getElementById(`${led}-hz`).textContent          = d.speed + ' Hz';
 
  // Status strip
  document.getElementById(`s-${led}-state`).textContent = stateWord;
  document.getElementById(`s-${led}-mode`).textContent  = d.mode.charAt(0).toUpperCase() + d.mode.slice(1);
  document.getElementById(`s-${led}-hz`).textContent    = (d.on && d.mode === 'blink') ? d.speed + ' Hz' : '—';
}
 
// ── UTIL ─────────────────────────────────────────────────────────
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}