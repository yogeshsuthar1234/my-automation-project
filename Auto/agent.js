/**
 * Instagram automation agent - just-in-time account pipeline.
 *
 * Flow:
 *   1. Pick one active saved account, or create exactly one fresh account.
 *   2. Run that account through all configured websites.
 *   3. Mark it exhausted after the site pass.
 *   4. Create the next account only when the next cycle starts.
 */

const { chromium } = require('playwright');
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { createInstagramAccount: createFreshInstagramAccount } = require('./bootstrap');

// â”€â”€â”€ SCREENSHOT DIR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
const SITE_SCREENSHOT_LEVEL = (process.env.SITE_SCREENSHOT_LEVEL || 'minimal').toLowerCase(); // minimal | debug | off

// â”€â”€â”€ CONFIG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const CONFIG = {
  // Instagram account to boost (receives likes + followers)
  TARGET_INSTAGRAM: 'dadaji_furniture_vadodara',

  // Shared password used for ALL created accounts
  SHARED_PASSWORD: 'y@70164',

  // Gemini API key â€” optional, improves selector detection
  // Get free key: https://aistudio.google.com
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  // Just-in-time account pipeline: create/use one account, then move to the next.
  ACCOUNT_CYCLES: parseInt(process.env.ACCOUNT_CYCLES || '1', 10),
  MAX_USES_PER_ACCOUNT: parseInt(process.env.MAX_USES_PER_ACCOUNT || '1', 10),
  SITE_NAV_TIMEOUT: parseInt(process.env.SITE_NAV_TIMEOUT || '60000', 10),
  SITE_ACTION_TIMEOUT: parseInt(process.env.SITE_ACTION_TIMEOUT || '45000', 10),
  SITE_RESPONSE_WAIT: parseInt(process.env.SITE_RESPONSE_WAIT || '6000', 10),
  LOGIN_CHALLENGE_WAIT: parseInt(process.env.LOGIN_CHALLENGE_WAIT || '180000', 10),
  LOGIN_CHALLENGE_SETTLE_WAIT: parseInt(process.env.LOGIN_CHALLENGE_SETTLE_WAIT || '45000', 10),
  DISABLE_LOGIN_OTP: process.env.DISABLE_LOGIN_OTP === 'true',
  BETWEEN_SITE_DELAY: parseInt(process.env.BETWEEN_SITE_DELAY || '1200', 10),

  // File to persist the account pool
  ACCOUNTS_FILE: path.join(__dirname, 'accounts.json'),

  // Turkish SMM websites
  WEBSITES: [
    'https://takipcitime.com/login',
    'https://mixtakip.com/login',
    'https://birtakipci.com/member',
    'https://fastfollow.in/member',
    'https://takipcigen.com/login',
    'https://takip88.com/login',
    'https://takipcibase.com/login',
    'https://www.takipcimx.net/login',
    'https://www.takipciking.net/login',
    'https://takipcigir.com/login',
    'https://takipcifox.com/member',
    'https://takipstar.com/login',
    'https://takipcizen.com/login',
    'https://takipcikrali.com/login',
    'https://takipcitime.net/login',
  ],

  // Latest posts from dadaji_furniture_vadodara (updated 2026-07-27)
  FALLBACK_POSTS: [
    'https://www.instagram.com/reel/DVtNdQUE7ZV/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==',
    'https://www.instagram.com/p/Da7LhtLE7Dx/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==',
    'https://www.instagram.com/reel/DaqLI21Ie6P/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==',
    'https://www.instagram.com/p/DYMiiUoiFJ5/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==',
    'https://www.instagram.com/reel/DWUHJRBiJdx/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==',
    'https://www.instagram.com/reel/DVBX2SdEwws/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==',
    'https://www.instagram.com/reel/DWg9XR5DWT3/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==',
  ],
};

// â”€â”€â”€ HELPERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Visibly open browser on local desktop (headless: false), run headless in GitHub Actions (CI)
const HEADLESS = process.env.HEADLESS !== undefined 
  ? process.env.HEADLESS === 'true' 
  : !!process.env.CI;

function log(emoji, msg) {
  console.log(`${emoji}  ${msg}`);
}

// â”€â”€â”€ 1SECEMAIL OTP READER (used during takipci login challenge) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// If Instagram sends an OTP challenge when logging into a takipci site,
// this opens 1secemail.com via Playwright, sets the account's stored alias,
// and reads the 6-digit OTP from the inbox.
function matchInstagramOtp(text, skipOtp = null) {
  if (!text) return null;
  const candidates = [];
  const addMatches = (regex) => {
    for (const match of text.matchAll(regex)) candidates.push(match[1]);
  };

  // Login/security verification emails use body text like:
  // 'please use the following code to confirm your identity: 896417'.
  addMatches(/following\s+code[\s\S]{0,120}?(\d{6})/gi);
  addMatches(/confirm\s+your\s+identity[\s\S]{0,80}?(\d{6})/gi);
  addMatches(/security\s+code[\s:.-]*(\d{6})/gi);
  addMatches(/verification\s+code[\s:.-]*(\d{6})/gi);

  // Signup emails often put the code in the subject.
  addMatches(/(\d{6})\s+is\s+your\s+Instagram\s+code/gi);
  addMatches(/Instagram[\s\S]{0,260}?(\d{6})/gi);
  addMatches(/code[:\s]+(\d{6})/gi);
  addMatches(/\b(\d{6})\b/g);

  return candidates.find(code => !skipOtp || code !== skipOtp) || null;
}

async function returnToInboxIfNeeded(emailPage, emailLogin = null) {
  if (/\/view\//i.test(emailPage.url())) {
    await emailPage.goBack({ waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => null);
    await sleep(700);
  }

  const hasInbox = await emailPage.evaluate(() => /SENDER\s+SUBJECT\s+TIME|Verify your profile|Instagram code/i.test(document.body?.innerText || '')).catch(() => false);
  if (hasInbox) return;

  await emailPage.goto('https://www.1secemail.com/', { waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => null);
  await sleep(900);

  if (emailLogin) {
    const current = await emailPage.$eval('#mainEmail', el => el.value || el.textContent || '').catch(() => '');
    if (current && !current.toLowerCase().startsWith(emailLogin.toLowerCase() + '@')) {
      await emailPage.click('#change_email_btn', { timeout: 3000 }).catch(() => {});
      await sleep(400);
      for (const sel of ['input#name_email', 'input[name="name"]', '.modal-body input[type="text"]', '.modal input:not([type="hidden"])']) {
        try { await emailPage.waitForSelector(sel, { timeout: 1000 }); await emailPage.fill(sel, emailLogin); break; } catch {}
      }
      await emailPage.click('#change_email', { timeout: 3000 }).catch(() => {});
      await sleep(900);
    }
  }
}

async function clickMailByVisibleText(emailPage) {
  const textTargets = [
    /Verify your profile/i,
    /security@mail\.instagram\.com/i,
    /confirm your identity/i,
    /\d{6}\s+is\s+your\s+Instagram\s+code/i
  ];

  for (const target of textTargets) {
    try {
      const locator = emailPage.getByText(target).first();
      await locator.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
      await locator.click({ timeout: 1800 });
      await sleep(1200);
      const body = await emailPage.evaluate(() => document.body?.innerText || '').catch(() => '');
      if (/\/view\//i.test(emailPage.url()) || /following\s+code|confirm\s+your\s+identity/i.test(body)) {
        log('MAIL', `Opened email by text: ${String(target)}`);
        return true;
      }
    } catch {}
  }

  return false;
}

async function clickBestInstagramMail(emailPage) {
  if (await clickMailByVisibleText(emailPage)) return true;

  const handles = await emailPage.$$('a, button, [role="row"], [role="button"], tr, li, div').catch(() => []);
  const candidates = [];

  for (let i = 0; i < handles.length; i++) {
    const info = await handles[i].evaluate(el => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      return { text, visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0, area: rect.width * rect.height };
    }).catch(() => null);
    if (!info?.visible || !info.text || info.text.length < 5 || info.text.length > 500) continue;
    if (/SENDER\s+SUBJECT\s+TIME/i.test(info.text)) continue;

    let score = 0;
    if (/Verify your profile/i.test(info.text)) score += 120;
    if (/security@mail\.instagram/i.test(info.text)) score += 90;
    if (/confirm your identity/i.test(info.text)) score += 80;
    if (/Instagram/i.test(info.text)) score += 25;
    if (/\d{6}\s+is\s+your\s+Instagram\s+code|code/i.test(info.text)) score += 10;
    if (/New/i.test(info.text)) score += 5;
    if (score > 0) candidates.push({ handle: handles[i], text: info.text, score, area: info.area, index: i });
  }

  candidates.sort((a, b) => b.score - a.score || a.area - b.area || a.index - b.index);
  const chosen = candidates[0];
  if (!chosen) {
    log('WARN', 'No clickable Instagram mail card found in inbox DOM');
    return false;
  }

  log('MAIL', `Opening email card: ${chosen.text.slice(0, 140)}`);
  await chosen.handle.scrollIntoViewIfNeeded().catch(() => {});
  await chosen.handle.click({ timeout: 3000 });
  await sleep(1300);
  return true;
}

async function poll1secemailPage(emailPage, maxWait = 90000, skipOtp = null, emailLogin = null) {
  const deadline = Date.now() + maxWait;
  let pollCount = 0;

  while (Date.now() < deadline) {
    pollCount++;
    await emailPage.bringToFront().catch(() => {});

    if (/\/view\//i.test(emailPage.url())) {
      const bodyText = await emailPage.evaluate(() => document.body?.innerText || '').catch(() => '');
      const bodyOtp = matchInstagramOtp(bodyText, skipOtp);
      if (bodyOtp) return bodyOtp;
      await returnToInboxIfNeeded(emailPage, emailLogin);
    } else {
      await returnToInboxIfNeeded(emailPage, emailLogin);
    }

    const inboxText = await emailPage.evaluate(() => document.body?.innerText || '').catch(() => '');
    const hasVerifyMail = /Verify your profile|security@mail\.instagram/i.test(inboxText);
    let otp = null;

    if (hasVerifyMail) {
      const opened = await clickBestInstagramMail(emailPage);
      if (opened) {
        const bodyText = await emailPage.evaluate(() => document.body?.innerText || '').catch(() => '');
        otp = matchInstagramOtp(bodyText, skipOtp);
      }
    } else {
      otp = matchInstagramOtp(inboxText, skipOtp);
      if (!otp) {
        const opened = await clickBestInstagramMail(emailPage);
        if (opened) {
          const bodyText = await emailPage.evaluate(() => document.body?.innerText || '').catch(() => '');
          otp = matchInstagramOtp(bodyText, skipOtp);
        }
      }
    }

    if (otp) return otp;
    if (pollCount % 5 === 0) log('WAIT', 'Waiting for 1secemail auto-update or clickable verification email...');
    await sleep(1500);
  }

  return null;
}
async function readOTPFrom1secemail(accountOrLogin) {
  const account = typeof accountOrLogin === 'object' && accountOrLogin ? accountOrLogin : null;
  const emailLogin = account?.emailLogin || account?.email?.split('@')[0] || accountOrLogin;
  const liveSession = account?._emailSession;
  const skipOtp = liveSession?._lastOtp || null;

  if (!emailLogin) { log('WARN', 'No emailLogin stored; cannot read OTP'); return null; }

  if (liveSession?._page && !liveSession._page.isClosed?.()) {
    log('MAIL', `Reading fresh OTP from already-open inbox: ${emailLogin}...`);
    const otp = await poll1secemailPage(liveSession._page, CONFIG.LOGIN_CHALLENGE_WAIT, skipOtp, emailLogin);
    if (otp) {
      liveSession._lastOtp = otp;
      log('OK', `OTP from live 1secemail.com inbox: ${otp}`);
      return otp;
    }
    log('WARN', 'Live inbox did not show a fresh OTP; reopening mailbox as fallback...');
  }

  log('MAIL', `Opening 1secemail.com to read OTP for alias: ${emailLogin}...`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });
  const emailPage = await context.newPage();

  try {
    await emailPage.goto('https://www.1secemail.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await emailPage.locator('#change_email_btn').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

    await emailPage.click('#change_email_btn', { timeout: 7000 }).catch(() => {});
    await sleep(700);
    for (const sel of ['input#name_email', 'input[name="name"]', '.modal-body input[type="text"]', '.modal input:not([type="hidden"])']) {
      try { await emailPage.waitForSelector(sel, { timeout: 1200 }); await emailPage.fill(sel, emailLogin); break; } catch {}
    }
    await emailPage.click('#change_email', { timeout: 7000 }).catch(() => {});
    await sleep(1200);

    const otp = await poll1secemailPage(emailPage, CONFIG.LOGIN_CHALLENGE_WAIT, skipOtp, emailLogin);
    if (otp) {
      if (liveSession) liveSession._lastOtp = otp;
      log('OK', `OTP from 1secemail.com (login challenge): ${otp}`);
      await browser.close();
      return otp;
    }

    try {
      const screenshotDir = path.join(__dirname, 'screenshots');
      if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
      const sp = path.join(screenshotDir, `otp_login_challenge_timeout.png`);
      await emailPage.screenshot({ path: sp, fullPage: false });
      log('SHOT', `Timeout screenshot saved: screenshots/${path.basename(sp)}`);
    } catch {}

    log('WARN', 'OTP not received in 90s for login challenge; check screenshot');
  } catch (err) {
    log('WARN', `1secemail OTP reader error: ${err.message}`);
  }

  await browser.close();
  return null;
}
async function readOTPFromGuerrillaAccount(account, maxWait = CONFIG.LOGIN_CHALLENGE_WAIT) {
  const sid = account?.emailSid || account?.sid;
  const skipOtp = account?.emailLastOtp || null;
  if (!sid) { log('WARN', 'Guerrilla account has no sid token; cannot read verification OTP'); return null; }

  log('MAIL', `Reading fresh OTP from Guerrilla inbox: ${account.email}...`);
  const deadline = Date.now() + maxWait;
  let pollCount = 0;
  const seen = new Set();

  while (Date.now() < deadline) {
    pollCount++;
    try {
      const data = await httpGet(`https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=${encodeURIComponent(sid)}`);
      const mails = Array.isArray(data?.list) ? data.list : [];
      const scored = mails.map((mail, index) => {
        const summary = [mail.mail_from, mail.mail_subject, mail.mail_excerpt].filter(Boolean).join(' ');
        let score = 0;
        if (/security@mail\.instagram|Verify your profile|confirm your identity/i.test(summary)) score += 120;
        if (/Instagram/i.test(summary)) score += 30;
        if (/\d{6}\s+is\s+your\s+Instagram\s+code|code/i.test(summary)) score += 10;
        return { mail, index, score, summary };
      }).sort((a, b) => b.score - a.score || a.index - b.index);

      for (const item of scored) {
        const mail = item.mail;
        if (!mail?.mail_id || seen.has(mail.mail_id)) continue;
        seen.add(mail.mail_id);

        const full = await httpGet(`https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(mail.mail_id)}&sid_token=${encodeURIComponent(sid)}`);
        const text = [
          mail.mail_from,
          mail.mail_subject,
          mail.mail_excerpt,
          full.mail_subject,
          full.mail_from,
          full.mail_excerpt,
          full.mail_body
        ].filter(Boolean).join('\n').replace(/<[^>]+>/g, ' ');

        const otp = matchInstagramOtp(text, skipOtp);
        if (otp) {
          account.emailLastOtp = otp;
          log('OK', `OTP from Guerrilla verification email: ${otp}`);
          return otp;
        }
      }

      if (pollCount % 5 === 0) log('WAIT', 'Waiting for Guerrilla verification email...');
    } catch (err) {
      log('WARN', `Guerrilla OTP poll error: ${err.message}`);
    }
    await sleep(2500);
  }

  log('WARN', 'Guerrilla verification OTP timed out');
  return null;
}

async function readOTPFromAccountEmail(account) {
  const provider = (account?.emailProvider || account?.provider || '').toLowerCase();
  if (provider.includes('guerrilla')) return await readOTPFromGuerrillaAccount(account);
  return await readOTPFrom1secemail(account);
}
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    }).on('error', reject);
  });
}

// â”€â”€â”€ ACCOUNT POOL MANAGEMENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Account object shape:
 * {
 *   username: string,
 *   password: string,
 *   email: string,
 *   usageCount: number,       // how many full cycles completed
 *   status: 'active' | 'exhausted' | 'failed',
 *   createdAt: ISO string,
 *   lastUsedAt: ISO string | null
 * }
 */

function loadPool() {
  try {
    if (fs.existsSync(CONFIG.ACCOUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG.ACCOUNTS_FILE, 'utf8'));
    }
  } catch {}
  return [];
}

function savePool(pool) {
  fs.writeFileSync(CONFIG.ACCOUNTS_FILE, JSON.stringify(pool, null, 2));
  const active    = pool.filter(a => a.status === 'active').length;
  const exhausted = pool.filter(a => a.status === 'exhausted').length;
  log('ðŸ’¾', `Pool saved â€” active: ${active}  exhausted: ${exhausted}  total: ${pool.length}`);
}

function printPoolStatus(pool) {
  console.log('\n' + 'â”€'.repeat(60));
  console.log('ðŸ“Š  ACCOUNT POOL STATUS');
  console.log('â”€'.repeat(60));
  pool.forEach((acc, i) => {
    const bar = 'â–“'.repeat(acc.usageCount) + 'â–‘'.repeat(Math.max(0, CONFIG.MAX_USES_PER_ACCOUNT - acc.usageCount));
    const tag = acc.status === 'active'    ? 'âœ… active    ' :
                acc.status === 'exhausted' ? 'ðŸ”„ exhausted ' :
                                             'âŒ failed    ';
    console.log(`  ${String(i+1).padStart(2)}. ${tag} [${bar}] ${acc.usageCount}/${CONFIG.MAX_USES_PER_ACCOUNT}  ${acc.username}`);
  });
  console.log('â”€'.repeat(60) + '\n');
}

/** Mark account as used once. If limit reached â†’ exhausted */
function recordUsage(pool, username) {
  const acc = pool.find(a => a.username === username);
  if (!acc) return;
  acc.usageCount++;
  acc.lastUsedAt = new Date().toISOString();

  if (acc.usageCount >= CONFIG.MAX_USES_PER_ACCOUNT) {
    acc.status = 'exhausted';
    log('ðŸ”„', `Account "${username}" exhausted after ${acc.usageCount} uses â†’ will be replaced`);
  } else {
    log('ðŸ“ˆ', `Account "${username}" usage: ${acc.usageCount}/${CONFIG.MAX_USES_PER_ACCOUNT}`);
  }
}

/** Active accounts available for use */
function getActiveAccounts(pool) {
  return pool.filter(a => a.status === 'active');
}


// â”€â”€â”€ RANDOM GENERATORS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function generateUsername() {
  const prefixes = ['yogu', 'mast', 'cool', 'fast', 'nova', 'star', 'blaze', 'swift', 'flex', 'bolt'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const num    = Math.floor(Math.random() * 90000) + 10000;
  const sep    = ['', '.', '_'][Math.floor(Math.random() * 3)];
  return `${prefix}${sep}${num}`;
}

function generateFullName() {
  const first = ['Raj','Priya','Amit','Neha','Vikas','Pooja','Rohan','Simran','Arjun','Meera'];
  const last  = ['Sharma','Patel','Kumar','Singh','Verma','Gupta','Shah','Joshi','Nair','Reddy'];
  return `${first[Math.floor(Math.random() * first.length)]} ${last[Math.floor(Math.random() * last.length)]}`;
}

// â”€â”€â”€ TEMP EMAIL (GUERRILLA MAIL) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function createTempEmail() {
  try {
    const data = await httpGet('https://api.guerrillamail.com/ajax.php?f=get_email_address');
    log('ðŸ“§', `Temp email created: ${data.email_addr}`);
    return { email: data.email_addr, sid: data.sid_token };
  } catch (err) {
    log('âš ï¸', `Guerrilla Mail failed: ${err.message}`);
    return null;
  }
}

async function getOTPFromEmail(sid, maxWait = 120000) {
  log('â³', 'Waiting for OTP email (up to 2 min)...');
  const deadline = Date.now() + maxWait;

  while (Date.now() < deadline) {
    try {
      const data = await httpGet(
        `https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=${sid}`
      );
      for (const mail of (data.list || [])) {
        const full = await httpGet(
          `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${mail.mail_id}&sid_token=${sid}`
        );
        const body = (full.mail_body || '') + (full.mail_excerpt || '');
        const match = body.match(/\b(\d{6})\b/);
        if (match) {
          log('âœ…', `OTP received: ${match[1]}`);
          return match[1];
        }
      }
    } catch {}
    await sleep(5000);
  }

  log('âŒ', 'OTP timed out â€” email not received');
  return null;
}

// â”€â”€â”€ GEMINI AI SELECTOR DETECTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function aiDetectSelectors(pageHTML, task) {
  if (!CONFIG.GEMINI_API_KEY) return null;

  try {
    const prompt = `You are a web automation expert. Analyze this HTML and return ONLY a JSON object with CSS selectors.
Task: ${task}
HTML (first 6000 chars): ${pageHTML.slice(0, 6000)}
Return ONLY valid JSON like: {"username":"#id","password":"input[type=password]","submit":"button[type=submit]"}
If a field doesn't exist use null. No explanation.`;

    const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });

    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, (res) => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
      });
      req.on('error', reject);
      req.write(body); req.end();
    });

    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      const sel = JSON.parse(m[0]);
      log('ðŸ§ ', `AI selectors: ${JSON.stringify(sel)}`);
      return sel;
    }
  } catch (err) {
    log('âš ï¸', `Gemini error: ${err.message}`);
  }
  return null;
}

// â”€â”€â”€ INSTAGRAM ACCOUNT CREATOR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function createInstagramAccount() {
  log('NEW', 'Creating one fresh Instagram account for the next 15-site cycle...');
  const previousKeepEmailBrowser = process.env.KEEP_EMAIL_BROWSER;
  process.env.KEEP_EMAIL_BROWSER = 'true';

  let account;
  try {
    account = await createFreshInstagramAccount(1, 1);
  } finally {
    if (previousKeepEmailBrowser === undefined) delete process.env.KEEP_EMAIL_BROWSER;
    else process.env.KEEP_EMAIL_BROWSER = previousKeepEmailBrowser;
  }

  if (!account) {
    log('FAIL', 'Fresh account creation failed. No website cycle will start.');
    return null;
  }

  const normalized = {
    usageCount: 0,
    status: 'active',
    lastUsedAt: null,
    ...account,
    emailLogin: account.emailLogin || account.email?.split('@')[0],
    emailDomain: account.emailDomain || account.email?.split('@')[1],
    emailProvider: account.emailProvider || account.provider || '1secemail.com',
    emailSid: account.emailSid || account.sid || null,
    emailLastOtp: account.emailLastOtp || null
  };

  if (account._emailSession) {
    Object.defineProperty(normalized, '_emailSession', {
      value: account._emailSession,
      enumerable: false,
      configurable: true
    });
  }

  return normalized;
}
async function getInstagramPosts() {
  log('ðŸ“¸', `Fetching posts from: ${CONFIG.TARGET_INSTAGRAM}`);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page    = await browser.newPage();

  try {
    await page.goto(`https://www.instagram.com/${CONFIG.TARGET_INSTAGRAM}/`, {
      timeout: 30000, waitUntil: 'networkidle'
    });
    await page.waitForSelector('article a', { timeout: 15000 });

    const postLinks = new Set();
    let scrolls = 0;
    while (postLinks.size < 7 && scrolls < 5) {
      const links = await page.$$eval('article a', as =>
        as.map(a => a.href).filter(h => h.includes('/p/') || h.includes('/reel/'))
      );
      links.forEach(l => postLinks.add(l));
      if (postLinks.size >= 7) break;
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await sleep(700);
      scrolls++;
    }

    const posts = Array.from(postLinks).slice(0, 7);
    log('âœ…', `Found ${posts.length} posts`);
    await browser.close();
    return posts;
  } catch {
    log('âš ï¸', 'Post scraping failed â€” using fallback links');
    await browser.close();
    return CONFIG.FALLBACK_POSTS;
  }
}

// â”€â”€â”€ SCREENSHOT HELPER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function takeScreenshot(page, label) {
  try {
    if (SITE_SCREENSHOT_LEVEL === 'off') return;
    const important = /^site_|FAILED|ERROR|timeout|challenge/i.test(label);
    if (SITE_SCREENSHOT_LEVEL === 'minimal' && !important) return;

    const safeName = label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
    const filePath = path.join(SCREENSHOT_DIR, `${safeName}.png`);
    await page.screenshot({ path: filePath, fullPage: false });
    log('SHOT', `Screenshot: screenshots/${path.basename(filePath)}`);
  } catch (e) {
    log('WARN', `Screenshot failed: ${e.message}`);
  }
}

// Login validator
async function checkLoginSuccess(page) {
  const url       = page.url();
  const title     = await page.title().catch(() => '');
  const bodyText  = await page.evaluate(() => document.body?.innerText?.slice(0, 400) || '').catch(() => '');

  const successWords = ['tools', 'dashboard', 'panel', 'member', 'hesap', 'profil', 'logout', 'Ã§Ä±kÄ±ÅŸ'];
  const failWords    = ['login', 'giriÅŸ', 'sign in', 'hata', 'error', 'wrong', 'incorrect', 'invalid'];

  const all = (url + title + bodyText).toLowerCase();
  if (successWords.some(w => all.includes(w))) {
    log('âœ…', `LOGIN SUCCESS â€” URL: ${url}`);
    return true;
  }
  if (failWords.some(w => all.includes(w))) {
    log('âŒ', `LOGIN FAILED â€” still on login page. URL: ${url} | Title: ${title}`);
    return false;
  }
  log('âš ï¸', `LOGIN UNCERTAIN â€” URL: ${url} | Title: ${title}`);
  return null;
}

// â”€â”€â”€ TURKISH SITE AUTOMATION (with screenshots + validation + OTP handling) â”€â”€â”€

async function isAccountSuspendedPage(page) {
  const url = page.url();
  const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  return /appeal\/verification|account_appeal|suspend/i.test(url)
    || /your account is suspended|account has been suspended|start appeal|appealing account|provide your phone, ID and selfie/i.test(text);
}
async function isOtpChallengePage(page) {
  const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
  const url = page.url();
  const singleCodeInput = await page.isVisible('input[name="verificationCode"], input[aria-label*="code" i], input[name="code"], input[maxlength="6"]', { timeout: 800 }).catch(() => false);
  const digitInputCount = await page.locator('input').evaluateAll(inputs => inputs.filter(input => {
    const style = window.getComputedStyle(input);
    const rect = input.getBoundingClientRect();
    const type = (input.getAttribute('type') || 'text').toLowerCase();
    return type !== 'hidden' && style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0 && (input.maxLength === 1 || rect.width < 90);
  }).length).catch(() => 0);

  return /bloks\/verification|challenge|verification/i.test(url)
    || /verification code sent|enter the 6-digit code|security code|confirm.*code|enter.*code|confirm your identity|logging in/i.test(text)
    || singleCodeInput
    || digitInputCount >= 6;
}

async function getVisibleOtpInputs(page) {
  const handles = await page.$$('input');
  const items = [];

  for (const handle of handles) {
    const info = await handle.evaluate(input => {
      const style = window.getComputedStyle(input);
      const rect = input.getBoundingClientRect();
      const type = (input.getAttribute('type') || 'text').toLowerCase();
      const name = input.getAttribute('name') || '';
      const aria = input.getAttribute('aria-label') || '';
      const placeholder = input.getAttribute('placeholder') || '';
      return {
        visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
        disabled: input.disabled || input.readOnly,
        type, name, aria, placeholder,
        maxLength: input.maxLength || 0,
        inputMode: input.getAttribute('inputmode') || '',
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        value: input.value || ''
      };
    }).catch(() => null);

    if (!info?.visible || info.disabled || info.type === 'hidden' || info.type === 'password') continue;
    if (/user|login|email|password|search/i.test(`${info.name} ${info.aria} ${info.placeholder}`)) continue;

    const looksLikeOtp = info.maxLength === 1 || info.maxLength === 6 || info.width <= 120 || /numeric|decimal|tel|number/i.test(`${info.inputMode} ${info.type}`);
    if (looksLikeOtp) items.push({ handle, info });
  }

  items.sort((a, b) => a.info.y - b.info.y || a.info.x - b.info.x);
  return items.map(item => item.handle);
}

async function readOtpInputs(page, inputs) {
  const values = [];
  for (const input of inputs) values.push(await input.evaluate(el => el.value || '').catch(() => ''));
  return values.join('').replace(/\D/g, '').slice(0, 6);
}

async function setInputValueLikeUser(input, value) {
  await input.evaluate((el, val) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, val); else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: val }));
  }, value).catch(async () => {
    await input.fill(value).catch(() => {});
  });
}

async function fillOtpOnChallengePage(page, otp) {
  // Single-code input variants.
  for (const sel of ['input[name="verificationCode"]', 'input[aria-label*="code" i]', 'input[name="code"]', 'input[maxlength="6"]']) {
    try {
      const input = page.locator(sel).first();
      await input.waitFor({ state: 'visible', timeout: 1500 });
      const maxLength = await input.evaluate(el => el.maxLength || 0).catch(() => 0);
      if (maxLength !== 1) {
        await input.fill(otp);
        const value = await input.evaluate(el => el.value || '').catch(() => '');
        if (value.includes(otp)) return true;
      }
    } catch {}
  }

  const inputs = await getVisibleOtpInputs(page);
  if (inputs.length < 6) {
    log('DEBUG', `OTP inputs found: ${inputs.length}`);
    return false;
  }

  const boxes = inputs.slice(0, 6);

  // First try normal typing into the first box; many OTP widgets auto-advance.
  try {
    for (const box of boxes) await setInputValueLikeUser(box, '');
    await boxes[0].click();
    await page.keyboard.type(otp, { delay: 70 });
    await sleep(500);
    if ((await readOtpInputs(page, boxes)) === otp) return true;
  } catch {}

  // Guaranteed fallback: put one digit into each visible box and dispatch React-friendly events.
  for (let i = 0; i < 6; i++) {
    try {
      await boxes[i].click();
      await setInputValueLikeUser(boxes[i], otp[i]);
      await sleep(80);
    } catch {}
  }

  const actual = await readOtpInputs(page, boxes);
  log('DEBUG', `OTP boxes after fill: ${actual || '[empty]'}`);
  return actual === otp;
}
async function clickOtpConfirm(page) {
  const attempts = [
    () => page.getByRole('button', { name: /^Confirm$/i }).click({ timeout: 4000 }),
    () => page.getByRole('button', { name: /^(Verify|Continue|Next)$/i }).click({ timeout: 4000 }),
    () => page.locator('button').filter({ hasText: /^(Confirm|Verify|Continue|Next)$/i }).first().click({ timeout: 4000 }),
    () => page.locator('[role="button"]').filter({ hasText: /^(Confirm|Verify|Continue|Next)$/i }).first().click({ timeout: 4000 }),
    () => page.locator('input[type="submit"]').first().click({ timeout: 4000 })
  ];

  for (const attempt of attempts) {
    try { await attempt(); return true; } catch {}
  }
  return false;
}

async function handleLoginOtpChallenge(page, account, siteUrl) {
  let handled = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (!(await isOtpChallengePage(page))) return handled;

    log('LOCK', 'OTP challenge detected on ' + siteUrl + ' (attempt ' + attempt + ') - reading fresh code from email...');
    await takeScreenshot(page, 'challenge_visible_' + siteUrl.replace(/https?:\/\/(?:www\.)?/, '').split('/')[0].replace(/[^a-zA-Z0-9]/g, '_'));
    const otp = await readOTPFromAccountEmail(account);
    if (!otp) return handled;

    const filled = await fillOtpOnChallengePage(page, otp);
    log(filled ? 'OK' : 'FAIL', 'OTP code ' + (filled ? 'entered' : 'could not be entered') + ' on site challenge');
    if (!filled) return handled;

    const clicked = await clickOtpConfirm(page);
    log(clicked ? 'OK' : 'WARN', 'OTP confirm button ' + (clicked ? 'clicked' : 'not found'));
    handled = true;
    await sleep(CONFIG.LOGIN_CHALLENGE_SETTLE_WAIT);
  }

  return handled;
}

async function waitForAndHandleLoginChallenge(page, account, siteUrl) {
  const deadline = Date.now() + CONFIG.LOGIN_CHALLENGE_WAIT;
  let poll = 0;

  while (Date.now() < deadline) {
    poll++;
    if (await isAccountSuspendedPage(page)) return 'suspended';
    if (await isOtpChallengePage(page)) {
      if (CONFIG.DISABLE_LOGIN_OTP) return 'otp_required';
      const handled = await handleLoginOtpChallenge(page, account, siteUrl);
      if (!handled) return false;
      await sleep(CONFIG.LOGIN_CHALLENGE_SETTLE_WAIT);
      if (await isAccountSuspendedPage(page)) return 'suspended';
      if (!(await isOtpChallengePage(page))) return true;
      continue;
    }

    const loginState = await checkLoginSuccess(page);
    if (loginState === true) {
      const observeUntil = Date.now() + CONFIG.LOGIN_CHALLENGE_SETTLE_WAIT;
      while (Date.now() < observeUntil) {
        await sleep(3000);
        if (await isOtpChallengePage(page)) {
          if (CONFIG.DISABLE_LOGIN_OTP) return 'otp_required';
          const handled = await handleLoginOtpChallenge(page, account, siteUrl);
          if (!handled) return false;
          await sleep(CONFIG.LOGIN_CHALLENGE_SETTLE_WAIT);
          if (await isAccountSuspendedPage(page)) return 'suspended';
          return true;
        }
        if (await isAccountSuspendedPage(page)) return 'suspended';
      }
      return true;
    }

    if (loginState === false && poll >= 3) return false;
    if (poll % 5 === 0) log('WAIT', 'Waiting for login result or OTP challenge to appear...');
    await sleep(3000);
  }

  if (await isAccountSuspendedPage(page)) return 'suspended';
  if (await isOtpChallengePage(page)) {
    if (CONFIG.DISABLE_LOGIN_OTP) return 'otp_required';
    return await handleLoginOtpChallenge(page, account, siteUrl);
  }
  log('WARN', 'Login challenge wait expired; continuing with current page state');
  return null;
}

async function automateWebsite(siteUrl, account, postLink, siteIndex) {
  const { username, password, emailLogin } = account;
  // Fixed short name for this site slot (e.g. site_03_takipcitime)
  const shortName = siteUrl.replace(/https?:\/\/(?:www\.)?/, '').split('/')[0].replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
  const fixedSlot = `site_${String(siteIndex).padStart(2, '0')}_${shortName}`;
  const siteName  = shortName; // kept for internal use
  log('ðŸŒ', `Processing [${siteIndex}]: ${siteUrl}`);
  log('ðŸ“¸', `Screenshot slot: screenshots/${fixedSlot}.png (overwrites each run)`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page    = await context.newPage();
  page.setDefaultTimeout(CONFIG.SITE_ACTION_TIMEOUT);
  page.setDefaultNavigationTimeout(CONFIG.SITE_NAV_TIMEOUT);

  try {
    // Navigate
    await page.goto(siteUrl, { timeout: CONFIG.SITE_NAV_TIMEOUT, waitUntil: 'domcontentloaded' });
    await sleep(700);

    const html = await page.content();
    const ai   = await aiDetectSelectors(html, 'Login form: username or email field, password field, submit/login button');

    // Fill login fields
    log('ðŸ”', `Logging in as ${username}...`);
    let userFilled = false;
    for (const sel of [ai?.username, '#username', 'input[name="username"]', 'input[type="text"]', 'input[placeholder*="user" i]'].filter(Boolean)) {
      try { await page.waitForSelector(sel, { timeout: 5000 }); await page.fill(sel, username); userFilled = true; break; } catch {}
    }
    let passFilled = false;
    for (const sel of [ai?.password, 'input[name="password"]', 'input[type="password"]', 'input[placeholder*="pass" i]'].filter(Boolean)) {
      try { await page.waitForSelector(sel, { timeout: 5000 }); await page.fill(sel, password); passFilled = true; break; } catch {}
    }
    log(userFilled ? 'âœ…' : 'âŒ', `Username field ${userFilled ? 'filled' : 'NOT FOUND'}`);
    log(passFilled ? 'âœ…' : 'âŒ', `Password field ${passFilled ? 'filled' : 'NOT FOUND'}`);

    // Screenshot before clicking login
    // (removed â€” saving only post-login to keep just 15 files)

    // Click login
    let clicked = false;
    for (const sel of [ai?.submit, '#login_insta', 'button[type="submit"]', 'input[type="submit"]', 'button:has-text("GiriÅŸ")', 'button:has-text("Login")'].filter(Boolean)) {
      try { await page.click(sel); clicked = true; break; } catch {}
    }
    log(clicked ? 'âœ…' : 'âŒ', `Login button ${clicked ? 'clicked' : 'NOT FOUND'}`);

    await sleep(CONFIG.SITE_RESPONSE_WAIT);

    // Wait long enough for delayed verification pages before doing anything else.
    const loginFlowOk = await waitForAndHandleLoginChallenge(page, account, siteUrl);

    // â˜… KEY SCREENSHOT â€” after login (fixed filename, overwrites each run)
    // Shows whether login succeeded or failed
    await takeScreenshot(page, fixedSlot);
    log('ðŸ“¸', `Post-login state saved â†’ screenshots/${fixedSlot}.png`);

    // Validate login
    if (loginFlowOk === 'otp_required') {
      log('FAIL', `OTP/reverification required on ${siteUrl}; manual queue will count this as a failed cycle`);
      await takeScreenshot(page, `${fixedSlot}_OTP_REQUIRED`);
      return { success: false, reason: 'otp_required' };
    }

    if (loginFlowOk === 'suspended' || await isAccountSuspendedPage(page)) {
      log('FAIL', `Account suspended/appeal required on ${siteUrl}; stopping this account`);
      await takeScreenshot(page, `${fixedSlot}_ACCOUNT_SUSPENDED`);
      return { success: false, reason: 'account_suspended' };
    }

    const loginOk = loginFlowOk === false ? false : await checkLoginSuccess(page);
    if (loginOk === false) {
      log('âŒ', `Skipping ${siteUrl} â€” login failed (see ${fixedSlot}.png)`);
      await browser.close();
      return { success: false, reason: 'login_failed' };
    }

    // Close popup
    for (const sel of ['button.close', '.modal-close', '.btn-close', '[aria-label="close"]']) {
      try { await page.click(sel, { timeout: 1500 }); break; } catch {}
    }

    // Send Likes
    log('â¤ï¸', 'Sending likes...');
    let likesSent = false;
    try {
      await page.click('a[href="/tools/send-like"]', { timeout: 12000 });
      await sleep(700);
      await page.fill('input[name="mediaUrl"]', postLink);
      await page.click('button:has-text("GÃ¶nderiyi Bul")');
      await sleep(CONFIG.SITE_RESPONSE_WAIT);
      await takeScreenshot(page, `04_likes_form_${siteName}`);
      await page.fill('input[name="adet"]', '5000');
      await page.click('#formBegeniSubmitButton');
      await sleep(2500);
      await takeScreenshot(page, `05_likes_sent_${siteName}`);
      likesSent = true;
      log('âœ…', 'Likes sent âœ“');
    } catch (err) {
      log('âš ï¸', `Likes skipped: ${err.message.slice(0, 80)}`);
      await takeScreenshot(page, `04_likes_FAILED_${siteName}`);
    }

    // Send Followers
    log('ðŸ‘¥', 'Sending followers...');
    let followersSent = false;
    try {
      await page.click('a[href="/tools/send-follower"]', { timeout: 12000 });
      await sleep(700);
      await page.fill('input[name="username"]', CONFIG.TARGET_INSTAGRAM);
      await page.click('button:has-text("KullanÄ±cÄ±yÄ± Bul")');
      await sleep(CONFIG.SITE_RESPONSE_WAIT);
      await page.fill('input[name="adet"]', '49999');
      await page.click('#formTakipSubmitButton');
      await sleep(2500);
      followersSent = true;
      log('âœ…', 'Followers sent âœ“');
    } catch (err) {
      log('âš ï¸', `Followers skipped: ${err.message.slice(0, 80)}`);
    }

    log(likesSent || followersSent ? 'âœ…' : 'âš ï¸', `Done: ${siteUrl} | likes=${likesSent} followers=${followersSent}`);
    return { success: true, taskSuccess: likesSent || followersSent, likesSent, followersSent };

  } catch (err) {
    log('âŒ', `Fatal error on ${siteUrl}: ${err.message.slice(0, 80)}`);
    await takeScreenshot(page, `${fixedSlot}_ERROR`);
    throw err;
  } finally {
    await browser.close();
  }
}

// â”€â”€â”€ PROCESS ONE ACCOUNT THROUGH ALL SITES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function processAccount(account, posts) {
  log('????', `Running: ${account.username}  (use ${account.usageCount + 1}/${CONFIG.MAX_USES_PER_ACCOUNT})`);

  let postIndex = 0;
  let completed = 0;
  let stoppedReason = null;

  for (let i = 0; i < CONFIG.WEBSITES.length; i++) {
    const site      = CONFIG.WEBSITES[i];
    const post      = posts[postIndex % posts.length];
    const siteIndex = i + 1;

    try {
      const result = await automateWebsite(site, account, post, siteIndex);
      if (result?.reason === 'account_suspended') {
        account.status = 'failed';
        stoppedReason = 'account_suspended';
        log('FAIL', `Stopping ${account.username}: account suspended/appeal required`);
        break;
      }
      if (result?.success) completed++;
    } catch {}

    postIndex++;
    log('????', `Sites done: ${i + 1}/${CONFIG.WEBSITES.length} for ${account.username}`);
    await sleep(CONFIG.BETWEEN_SITE_DELAY);
  }

  log('????', `Finished ${account.username}: ${completed}/${CONFIG.WEBSITES.length} sites`);
  return { completed, stoppedReason };
}
// Just-in-time account pipeline

function pickNextAccount(pool) {
  return getActiveAccounts(pool).find(acc => (acc.usageCount || 0) < CONFIG.MAX_USES_PER_ACCOUNT) || null;
}

async function getOrCreateNextAccount(pool) {
  let account = pickNextAccount(pool);
  if (account) {
    log('ACCOUNT', `Using existing active account: ${account.username}`);
    return account;
  }

  account = await createInstagramAccount();
  if (!account) return null;

  pool.push(account);
  savePool(pool);
  log('ACCOUNT', `Fresh account ready: ${account.username} / ${account.email}`);
  return account;
}
async function closeAccountMailSession(account) {
  const session = account?._emailSession;
  if (!session?._browser) return;
  try {
    await session._browser.close();
    log('MAIL', 'Closed live inbox for ' + (account.email || account.emailLogin));
  } catch {}
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('INSTAGRAM AUTOMATION AGENT - JUST-IN-TIME ACCOUNT PIPELINE');
  console.log(`    Account cycles this run: ${CONFIG.ACCOUNT_CYCLES}`);
  console.log(`    Sites per account: ${CONFIG.WEBSITES.length}`);
  console.log('='.repeat(60));

  const pool = process.env.RESET_ACCOUNTS === 'true' ? [] : loadPool();
  if (process.env.RESET_ACCOUNTS === 'true') {
    log('POOL', 'RESET_ACCOUNTS=true, ignoring saved accounts for this run');
  }
  log('POOL', `Loaded ${pool.length} saved accounts (${getActiveAccounts(pool).length} active)`);

  const posts = await getInstagramPosts();
  log('POSTS', `Using ${posts.length} posts for automation`);

  for (let cycle = 1; cycle <= CONFIG.ACCOUNT_CYCLES; cycle++) {
    console.log('\n' + '='.repeat(60));
    console.log(`ACCOUNT CYCLE ${cycle}/${CONFIG.ACCOUNT_CYCLES} - one account across ${CONFIG.WEBSITES.length} sites`);
    console.log('='.repeat(60));

    const account = await getOrCreateNextAccount(pool);
    if (!account) {
      log('FAIL', 'No account available. Stopping pipeline.');
      break;
    }

    await processAccount(account, posts);
    if (account.status === 'failed') {
      log('POOL', `Account ${account.username} marked failed; not reusing it`);
    } else {
      recordUsage(pool, account.username);
    }
    savePool(pool);
    await closeAccountMailSession(account);

    if (cycle < CONFIG.ACCOUNT_CYCLES) {
      log('WAIT', 'Waiting 10s before creating/using the next account...');
      await sleep(10000);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('JUST-IN-TIME PIPELINE COMPLETE');
  console.log('='.repeat(60));
  printPoolStatus(pool);
}
// Graceful shutdown
process.on('SIGINT',  () => { log('STOP', 'Stopped by user.'); process.exit(0); });
process.on('SIGTERM', () => { log('STOP', 'Terminated.');      process.exit(0); });

module.exports = {
  CONFIG,
  sleep,
  log,
  getInstagramPosts,
  automateWebsite,
  processAccount,
  printPoolStatus
};

if (process.env.AGENT_IMPORT_ONLY !== 'true') {
  main().catch(err => { console.error('FATAL:', err); process.exit(1); });
}
