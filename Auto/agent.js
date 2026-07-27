/**
 * 🤖 AI-Powered Instagram Automation Agent — Rotating Pool Edition
 *
 * POOL LOGIC:
 *   - Maintains a pool of 10–15 active Instagram accounts
 *   - Each account is used MAX_USES_PER_ACCOUNT times (default: 3)
 *   - After 3 successful runs → account is marked "exhausted" and replaced
 *   - New accounts are auto-created via Instagram signup + Guerrilla Mail OTP
 *   - Pool always stays topped up to POOL_SIZE accounts
 *
 * RUN FLOW PER CYCLE:
 *   Pool (10 accounts) → each account → 15 Turkish sites → likes + followers
 *   → usageCount++ → if usageCount >= 3 → replace with new account
 */

const { chromium } = require('playwright');
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const CONFIG = {
  // Instagram account to boost (receives likes + followers)
  TARGET_INSTAGRAM: 'dadaji_furniture_vadodara',

  // Shared password used for ALL created accounts
  SHARED_PASSWORD: 'y@70164',

  // Gemini API key — optional, improves selector detection
  // Get free key: https://aistudio.google.com
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',

  // ── POOL SETTINGS ──────────────────────────────────────────────────────────
  POOL_SIZE: 12,              // target number of active accounts in pool
  MAX_USES_PER_ACCOUNT: 3,   // each account is used this many times, then replaced

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

  // Fallback Instagram post links if scraping fails
  FALLBACK_POSTS: [
    'https://www.instagram.com/reel/DNQk3AVzDUt/?igsh=MXQwb3E2bmw2Yjg2bw==',
    'https://www.instagram.com/reel/DNDkhsxzOAw/?igsh=dHF1YmpnaHAza3lz',
    'https://www.instagram.com/reel/DPqbwQgiHME/?igsh=MXJnZnY1c253bHlkbA==',
    'https://www.instagram.com/reel/DPtEcwmiL0t/?igsh=MTIzYW1tNWt2MGx4OA==',
    'https://www.instagram.com/reel/DPvh0PhiETV/?igsh=MTBsamxiNW15eGNueA==',
    'https://www.instagram.com/reel/DPv7AVgE5Fm/?igsh=MWw4eHlwYzk3YWs3cw==',
    'https://www.instagram.com/reel/DPyHOu9E8IZ/?igsh=MTg5eTd2Y2hzeWdicA==',
  ],
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function log(emoji, msg) {
  console.log(`${emoji}  ${msg}`);
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

// ─── ACCOUNT POOL MANAGEMENT ─────────────────────────────────────────────────

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
  log('💾', `Pool saved — active: ${active}  exhausted: ${exhausted}  total: ${pool.length}`);
}

function printPoolStatus(pool) {
  console.log('\n' + '─'.repeat(60));
  console.log('📊  ACCOUNT POOL STATUS');
  console.log('─'.repeat(60));
  pool.forEach((acc, i) => {
    const bar = '▓'.repeat(acc.usageCount) + '░'.repeat(Math.max(0, CONFIG.MAX_USES_PER_ACCOUNT - acc.usageCount));
    const tag = acc.status === 'active'    ? '✅ active    ' :
                acc.status === 'exhausted' ? '🔄 exhausted ' :
                                             '❌ failed    ';
    console.log(`  ${String(i+1).padStart(2)}. ${tag} [${bar}] ${acc.usageCount}/${CONFIG.MAX_USES_PER_ACCOUNT}  ${acc.username}`);
  });
  console.log('─'.repeat(60) + '\n');
}

/** Mark account as used once. If limit reached → exhausted */
function recordUsage(pool, username) {
  const acc = pool.find(a => a.username === username);
  if (!acc) return;
  acc.usageCount++;
  acc.lastUsedAt = new Date().toISOString();

  if (acc.usageCount >= CONFIG.MAX_USES_PER_ACCOUNT) {
    acc.status = 'exhausted';
    log('🔄', `Account "${username}" exhausted after ${acc.usageCount} uses → will be replaced`);
  } else {
    log('📈', `Account "${username}" usage: ${acc.usageCount}/${CONFIG.MAX_USES_PER_ACCOUNT}`);
  }
}

/** Active accounts available for use */
function getActiveAccounts(pool) {
  return pool.filter(a => a.status === 'active');
}

/** How many new accounts we need to top up the pool */
function accountsNeeded(pool) {
  const active = getActiveAccounts(pool).length;
  return Math.max(0, CONFIG.POOL_SIZE - active);
}

// ─── RANDOM GENERATORS ───────────────────────────────────────────────────────

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

// ─── TEMP EMAIL (GUERRILLA MAIL) ─────────────────────────────────────────────

async function createTempEmail() {
  try {
    const data = await httpGet('https://api.guerrillamail.com/ajax.php?f=get_email_address');
    log('📧', `Temp email created: ${data.email_addr}`);
    return { email: data.email_addr, sid: data.sid_token };
  } catch (err) {
    log('⚠️', `Guerrilla Mail failed: ${err.message}`);
    return null;
  }
}

async function getOTPFromEmail(sid, maxWait = 120000) {
  log('⏳', 'Waiting for OTP email (up to 2 min)...');
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
          log('✅', `OTP received: ${match[1]}`);
          return match[1];
        }
      }
    } catch {}
    await sleep(5000);
  }

  log('❌', 'OTP timed out — email not received');
  return null;
}

// ─── GEMINI AI SELECTOR DETECTION ────────────────────────────────────────────

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
      log('🧠', `AI selectors: ${JSON.stringify(sel)}`);
      return sel;
    }
  } catch (err) {
    log('⚠️', `Gemini error: ${err.message}`);
  }
  return null;
}

// ─── INSTAGRAM ACCOUNT CREATOR ───────────────────────────────────────────────

async function createInstagramAccount() {
  log('🆕', 'Creating new Instagram account...');

  const username = generateUsername();
  const fullName = generateFullName();
  const password = CONFIG.SHARED_PASSWORD;

  const emailData = await createTempEmail();
  if (!emailData) {
    log('❌', 'Cannot create account — temp email failed');
    return null;
  }
  const { email, sid } = emailData;

  log('👤', `Username: ${username}  |  Email: ${email}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  try {
    await page.goto('https://www.instagram.com/accounts/signup/', {
      waitUntil: 'networkidle', timeout: 60000
    });
    await sleep(3000);

    const html = await page.content();
    const ai   = await aiDetectSelectors(html, 'Instagram signup: email/phone, full name, username, password, submit button');

    // Fill email
    for (const sel of [ai?.email, 'input[name="emailOrPhone"]', 'input[type="email"]', 'input[aria-label*="email" i]'].filter(Boolean)) {
      try { await page.waitForSelector(sel, { timeout: 4000 }); await page.fill(sel, email); log('✅', `Email → ${sel}`); break; } catch {}
    }
    // Fill full name
    for (const sel of [ai?.name, 'input[name="fullName"]', 'input[aria-label*="name" i]'].filter(Boolean)) {
      try { await page.waitForSelector(sel, { timeout: 3000 }); await page.fill(sel, fullName); log('✅', `Name  → ${sel}`); break; } catch {}
    }
    // Fill username
    for (const sel of [ai?.username, 'input[name="username"]', 'input[aria-label*="username" i]'].filter(Boolean)) {
      try { await page.waitForSelector(sel, { timeout: 3000 }); await page.fill(sel, username); log('✅', `User  → ${sel}`); break; } catch {}
    }
    // Fill password
    for (const sel of [ai?.password, 'input[name="password"]', 'input[type="password"]'].filter(Boolean)) {
      try { await page.waitForSelector(sel, { timeout: 3000 }); await page.fill(sel, password); log('✅', `Pass  → ${sel}`); break; } catch {}
    }

    await sleep(1000);

    // Submit
    for (const sel of [ai?.submit, 'button[type="submit"]', 'button:has-text("Next")', 'button:has-text("Sign up")'].filter(Boolean)) {
      try { await page.click(sel); log('✅', `Submit → ${sel}`); break; } catch {}
    }
    await sleep(4000);

    // Birthday page
    try {
      if (await page.isVisible('select[title*="Month"]', { timeout: 3000 })) {
        await page.selectOption('select[title*="Month"]', '6');
        await page.selectOption('select[title*="Day"]',   '15');
        await page.selectOption('select[title*="Year"]',  '1995');
        await page.click('button[type="submit"]');
        await sleep(2000);
        log('✅', 'Birthday filled');
      }
    } catch {}

    // Wait for OTP
    const otp = await getOTPFromEmail(sid, 120000);
    if (!otp) {
      log('❌', 'No OTP — account creation failed');
      await browser.close();
      return null;
    }

    // Fill OTP
    for (const sel of ['input[name="confirmationCode"]', 'input[aria-label*="code" i]', 'input[maxlength="6"]', 'input[name="code"]'].filter(Boolean)) {
      try { await page.waitForSelector(sel, { timeout: 5000 }); await page.fill(sel, otp); log('✅', `OTP → ${sel}`); break; } catch {}
    }
    await sleep(1000);
    try { await page.click('button[type="submit"]'); await sleep(5000); } catch {}

    const url = page.url();
    if (url.includes('instagram.com') && !url.includes('signup')) {
      log('🎉', `Account created! → ${username}`);
      await browser.close();
      return {
        username,
        password,
        email,
        usageCount: 0,
        status: 'active',
        createdAt: new Date().toISOString(),
        lastUsedAt: null
      };
    } else {
      log('⚠️', `Signup result uncertain (URL: ${url}) — saving anyway`);
      await browser.close();
      return {
        username, password, email,
        usageCount: 0, status: 'active',
        createdAt: new Date().toISOString(), lastUsedAt: null
      };
    }

  } catch (err) {
    log('❌', `Account creation error: ${err.message}`);
    await browser.close();
    return null;
  }
}

// ─── INSTAGRAM POST SCRAPER ──────────────────────────────────────────────────

async function getInstagramPosts() {
  log('📸', `Fetching posts from: ${CONFIG.TARGET_INSTAGRAM}`);
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
      await sleep(1500);
      scrolls++;
    }

    const posts = Array.from(postLinks).slice(0, 7);
    log('✅', `Found ${posts.length} posts`);
    await browser.close();
    return posts;
  } catch {
    log('⚠️', 'Post scraping failed — using fallback links');
    await browser.close();
    return CONFIG.FALLBACK_POSTS;
  }
}

// ─── TURKISH SITE AUTOMATION ─────────────────────────────────────────────────

async function automateWebsite(siteUrl, username, password, postLink) {
  log('🌐', `Processing: ${siteUrl}`);
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page    = await context.newPage();
  page.setDefaultTimeout(30000);

  try {
    await page.goto(siteUrl, { timeout: 30000, waitUntil: 'domcontentloaded' });
    await sleep(2000);

    const html = await page.content();
    const ai   = await aiDetectSelectors(html, 'Login form: username or email field, password field, submit/login button');

    // Login
    log('🔐', `Logging in as ${username}...`);
    for (const sel of [ai?.username, '#username', 'input[name="username"]', 'input[type="text"]'].filter(Boolean)) {
      try { await page.waitForSelector(sel, { timeout: 3000 }); await page.fill(sel, username); break; } catch {}
    }
    for (const sel of [ai?.password, 'input[name="password"]', 'input[type="password"]'].filter(Boolean)) {
      try { await page.waitForSelector(sel, { timeout: 3000 }); await page.fill(sel, password); break; } catch {}
    }
    for (const sel of [ai?.submit, '#login_insta', 'button[type="submit"]', 'button:has-text("Giriş")', 'button:has-text("Login")'].filter(Boolean)) {
      try { await page.click(sel); break; } catch {}
    }
    await sleep(5000);

    // Close popup
    for (const sel of ['button.close', '.modal-close', '.btn-close', '[aria-label="close"]']) {
      try { await page.click(sel, { timeout: 2000 }); break; } catch {}
    }

    // Send Likes
    log('❤️', 'Sending likes...');
    try {
      await page.click('a[href="/tools/send-like"]', { timeout: 8000 });
      await sleep(1500);
      await page.fill('input[name="mediaUrl"]', postLink);
      await page.click('button:has-text("Gönderiyi Bul")');
      await sleep(3000);
      await page.fill('input[name="adet"]', '5000');
      await page.click('#formBegeniSubmitButton');
      await sleep(3000);
      log('✅', 'Likes sent');
    } catch (err) { log('⚠️', `Likes skipped: ${err.message.slice(0, 60)}`); }

    // Send Followers
    log('👥', 'Sending followers...');
    try {
      await page.click('a[href="/tools/send-follower"]', { timeout: 8000 });
      await sleep(1500);
      await page.fill('input[name="username"]', CONFIG.TARGET_INSTAGRAM);
      await page.click('button:has-text("Kullanıcıyı Bul")');
      await sleep(3000);
      await page.fill('input[name="adet"]', '49999');
      await page.click('#formTakipSubmitButton');
      await sleep(3000);
      log('✅', 'Followers sent');
    } catch (err) { log('⚠️', `Followers skipped: ${err.message.slice(0, 60)}`); }

    log('✅', `Done: ${siteUrl}`);
  } catch (err) {
    log('❌', `Failed: ${siteUrl} — ${err.message.slice(0, 80)}`);
    throw err;
  } finally {
    await browser.close();
  }
}

// ─── PROCESS ONE ACCOUNT THROUGH ALL SITES ───────────────────────────────────

async function processAccount(account, posts) {
  log('👤', `Running: ${account.username}  (use ${account.usageCount + 1}/${CONFIG.MAX_USES_PER_ACCOUNT})`);

  let postIndex = 0;
  let completed = 0;

  for (let i = 0; i < CONFIG.WEBSITES.length; i++) {
    const site = CONFIG.WEBSITES[i];
    const post = posts[postIndex % posts.length];

    try {
      await automateWebsite(site, account.username, account.password, post);
      completed++;
    } catch {}

    postIndex++;
    log('📊', `Sites done: ${i + 1}/${CONFIG.WEBSITES.length} for ${account.username}`);
    await sleep(3000);
  }

  log('🎉', `Finished ${account.username}: ${completed}/${CONFIG.WEBSITES.length} sites`);
  return completed;
}

// ─── TOP UP POOL WITH NEW ACCOUNTS ───────────────────────────────────────────

async function topUpPool(pool) {
  const needed = accountsNeeded(pool);
  if (needed <= 0) return;

  log('🏭', `Need ${needed} new accounts to fill pool to ${CONFIG.POOL_SIZE}`);

  for (let i = 0; i < needed; i++) {
    log('─', `Creating account ${i + 1}/${needed}...`);
    const newAcc = await createInstagramAccount();

    if (newAcc) {
      pool.push(newAcc);
      savePool(pool);
      log('✅', `Pool now has ${getActiveAccounts(pool).length} active accounts`);
    } else {
      log('⚠️', `Account ${i + 1} creation failed — continuing`);
    }

    // Pause between creations to avoid Instagram rate limiting
    if (i < needed - 1) {
      log('⏳', 'Waiting 30s before next account creation...');
      await sleep(30000);
    }
  }
}

// ─── MAIN AGENT ──────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('🤖  INSTAGRAM AI AUTOMATION AGENT — ROTATING POOL');
  console.log(`    Pool size: ${CONFIG.POOL_SIZE}  |  Max uses per account: ${CONFIG.MAX_USES_PER_ACCOUNT}`);
  console.log('═'.repeat(60));

  // ── Step 1: Load pool ──────────────────────────────────────────────────────
  const pool = loadPool();
  log('📋', `Loaded ${pool.length} accounts (${getActiveAccounts(pool).length} active)`);

  // ── Step 2: Top up pool if needed ─────────────────────────────────────────
  await topUpPool(pool);

  if (getActiveAccounts(pool).length === 0) {
    log('❌', 'No active accounts available. Exiting.');
    process.exit(1);
  }

  // ── Step 3: Get Instagram posts once ──────────────────────────────────────
  const posts = await getInstagramPosts();
  log('📸', `Using ${posts.length} posts for automation`);

  // ── Step 4: Infinite cycling loop ─────────────────────────────────────────
  let cycleCount = 0;

  while (true) {
    cycleCount++;
    const activeAccounts = getActiveAccounts(pool);

    console.log('\n' + '═'.repeat(60));
    console.log(`🔄  CYCLE ${cycleCount}  |  ${activeAccounts.length} active accounts  |  ${CONFIG.WEBSITES.length} sites each`);
    console.log('═'.repeat(60));
    printPoolStatus(pool);

    // Process each active account
    for (const account of activeAccounts) {
      await processAccount(account, posts);

      // Record usage and check if exhausted
      recordUsage(pool, account.username);
      savePool(pool);

      await sleep(5000);
    }

    // ── After each cycle: replace exhausted accounts ──────────────────────
    const exhausted = pool.filter(a => a.status === 'exhausted');
    if (exhausted.length > 0) {
      log('🔄', `${exhausted.length} accounts exhausted — creating replacements...`);
      await topUpPool(pool);
    }

    console.log(`\n✅  CYCLE ${cycleCount} COMPLETE`);
    printPoolStatus(pool);

    log('⏳', 'Waiting 10s before next cycle...');
    await sleep(10000);
  }
}

// Graceful shutdown
process.on('SIGINT',  () => { log('🛑', 'Stopped by user.'); process.exit(0); });
process.on('SIGTERM', () => { log('🛑', 'Terminated.');      process.exit(0); });

main().catch(err => { console.error('💥 Fatal:', err); process.exit(1); });
