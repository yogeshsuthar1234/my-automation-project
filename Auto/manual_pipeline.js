/**
 * Manual username queue runner.
 * Uses usernames supplied in manual_usernames.json and skips account creation/OTP inbox flow.
 */

process.env.AGENT_IMPORT_ONLY = 'true';
process.env.DISABLE_LOGIN_OTP = 'true';

const fs = require('fs');
const path = require('path');
const { CONFIG, sleep, log, getInstagramPosts, automateWebsite } = require('./agent');

const QUEUE_FILE = path.join(__dirname, 'manual_usernames.json');
const DEFAULT_PASSWORD = 'y@70164';
const MAX_CONSECUTIVE_FAILS = parseInt(process.env.MANUAL_REMOVE_AFTER_FAILS || '7', 10);
const RUN_MINUTES = parseFloat(process.env.MANUAL_RUN_MINUTES || '100');
const MAX_CYCLES = parseInt(process.env.MANUAL_MAX_CYCLES || '0', 10);
const BETWEEN_USERNAME_DELAY = parseInt(process.env.MANUAL_BETWEEN_USERNAME_DELAY || '5000', 10);

function cleanUsername(value) {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/[^a-zA-Z0-9._]/g, '')
    .slice(0, 60);
}

function normalizeQueue(raw) {
  const queue = Array.isArray(raw) ? { usernames: raw } : (raw && typeof raw === 'object' ? raw : {});
  const seen = new Set();
  const usernames = [];

  for (const item of queue.usernames || []) {
    const entry = typeof item === 'string' ? { username: item } : { ...item };
    const username = cleanUsername(entry.username);
    if (!username || seen.has(username.toLowerCase())) continue;
    seen.add(username.toLowerCase());
    usernames.push({
      username,
      status: entry.status === 'paused' ? 'paused' : 'active',
      consecutiveFails: Number.isFinite(Number(entry.consecutiveFails)) ? Number(entry.consecutiveFails) : 0,
      cyclesCompleted: Number.isFinite(Number(entry.cyclesCompleted)) ? Number(entry.cyclesCompleted) : 0,
      totalTaskSuccesses: Number.isFinite(Number(entry.totalTaskSuccesses)) ? Number(entry.totalTaskSuccesses) : 0,
      lastRunAt: entry.lastRunAt || null,
      lastSuccessAt: entry.lastSuccessAt || null,
      lastFailureAt: entry.lastFailureAt || null,
      lastReason: entry.lastReason || null
    });
  }

  return {
    password: queue.password || DEFAULT_PASSWORD,
    nextIndex: Number.isFinite(Number(queue.nextIndex)) ? Number(queue.nextIndex) : 0,
    usernames,
    removed: Array.isArray(queue.removed) ? queue.removed : [],
    updatedAt: queue.updatedAt || null
  };
}

function loadQueue() {
  if (!fs.existsSync(QUEUE_FILE)) return normalizeQueue({ usernames: [] });
  try {
    return normalizeQueue(JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8').replace(/^\uFEFF/, '')));
  } catch (err) {
    log('FAIL', 'Could not read manual queue: ' + err.message);
    return normalizeQueue({ usernames: [] });
  }
}

function saveQueue(queue) {
  queue.updatedAt = new Date().toISOString();
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
  log('QUEUE', 'Saved manual queue: active=' + queue.usernames.filter(u => u.status === 'active').length + ', removed=' + queue.removed.length);
}

function activeEntries(queue) {
  return queue.usernames.filter(entry => entry.status === 'active' && entry.consecutiveFails < MAX_CONSECUTIVE_FAILS);
}

function pickNextEntry(queue) {
  const active = activeEntries(queue);
  if (!active.length) return null;
  const picked = active[queue.nextIndex % active.length];
  queue.nextIndex = (queue.nextIndex + 1) % active.length;
  return picked;
}

function removeIfFailedTooMuch(queue, entry) {
  if (entry.consecutiveFails < MAX_CONSECUTIVE_FAILS) return false;
  queue.usernames = queue.usernames.filter(item => item.username.toLowerCase() !== entry.username.toLowerCase());
  queue.removed.push({
    username: entry.username,
    removedAt: new Date().toISOString(),
    reason: 'consecutive_failed_cycles_' + entry.consecutiveFails,
    cyclesCompleted: entry.cyclesCompleted,
    totalTaskSuccesses: entry.totalTaskSuccesses,
    lastReason: entry.lastReason
  });
  log('QUEUE', 'Removed ' + entry.username + ' after ' + entry.consecutiveFails + ' consecutive failed cycles');
  return true;
}

async function runUsernameCycle(entry, queue, posts) {
  const account = {
    username: entry.username,
    password: queue.password || DEFAULT_PASSWORD,
    usageCount: 0,
    status: 'active',
    manual: true
  };

  log('USER', 'Starting 15-site cycle for ' + entry.username);
  let taskSuccesses = 0;
  let loginSuccesses = 0;
  let attempted = 0;
  let stopReason = null;

  for (let i = 0; i < CONFIG.WEBSITES.length; i++) {
    const site = CONFIG.WEBSITES[i];
    const post = posts[i % posts.length];
    attempted++;

    try {
      const result = await automateWebsite(site, account, post, i + 1);
      if (result && result.reason) {
        stopReason = result.reason;
        if (result.reason === 'otp_required' || result.reason === 'account_suspended') break;
      }
      if (result && result.success) loginSuccesses++;
      if (result && result.taskSuccess) taskSuccesses++;
    } catch (err) {
      stopReason = err.message.slice(0, 120);
    }

    log('USER', entry.username + ': site ' + (i + 1) + '/' + CONFIG.WEBSITES.length + ', taskSuccesses=' + taskSuccesses);
    await sleep(CONFIG.BETWEEN_SITE_DELAY);
  }

  const completedFullCycle = attempted >= CONFIG.WEBSITES.length && !stopReason;
  const cycleOk = completedFullCycle && taskSuccesses > 0;
  const now = new Date().toISOString();

  entry.lastRunAt = now;
  entry.totalTaskSuccesses += taskSuccesses;

  if (cycleOk) {
    entry.consecutiveFails = 0;
    entry.cyclesCompleted += 1;
    entry.lastSuccessAt = now;
    entry.lastReason = 'cycle_ok_task_successes_' + taskSuccesses;
    log('OK', entry.username + ' completed cycle: taskSuccesses=' + taskSuccesses + ', loginSuccesses=' + loginSuccesses);
  } else {
    entry.consecutiveFails += 1;
    entry.lastFailureAt = now;
    entry.lastReason = stopReason || ('cycle_failed_attempted_' + attempted + '_task_successes_' + taskSuccesses);
    log('WARN', entry.username + ' failed cycle ' + entry.consecutiveFails + '/' + MAX_CONSECUTIVE_FAILS + ': ' + entry.lastReason);
  }

  removeIfFailedTooMuch(queue, entry);
  saveQueue(queue);
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('MANUAL USERNAME TAKIP PIPELINE');
  console.log('    Sites per username: ' + CONFIG.WEBSITES.length);
  console.log('    Remove after consecutive failed cycles: ' + MAX_CONSECUTIVE_FAILS);
  console.log('    Run window: ' + RUN_MINUTES + ' minutes');
  console.log('='.repeat(60));

  const queue = loadQueue();
  saveQueue(queue);

  if (!activeEntries(queue).length) {
    log('FAIL', 'No active manual usernames found in manual_usernames.json');
    return;
  }

  const posts = await getInstagramPosts();
  const deadline = Date.now() + Math.max(1, RUN_MINUTES) * 60 * 1000;
  let cycles = 0;

  while (Date.now() < deadline && (MAX_CYCLES === 0 || cycles < MAX_CYCLES)) {
    const entry = pickNextEntry(queue);
    if (!entry) {
      log('FAIL', 'No active usernames remain. Stopping manual pipeline.');
      break;
    }

    await runUsernameCycle(entry, queue, posts);
    cycles++;
    await sleep(BETWEEN_USERNAME_DELAY);
  }

  log('DONE', 'Manual pipeline finished after ' + cycles + ' username cycle(s)');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
