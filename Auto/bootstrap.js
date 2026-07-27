/**
 * 🏭 bootstrap.js — Fresh Account Creator
 *
 * This script ONLY creates Instagram accounts and saves them to accounts.json.
 * Run this FIRST before the main agent.js automation.
 *
 * Usage:
 *   node bootstrap.js          → creates 15 accounts (default)
 *   node bootstrap.js 10       → creates 10 accounts
 *   node bootstrap.js --reset  → clears old accounts first, then creates 15
 */

const { chromium } = require('playwright');
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const ACCOUNTS_FILE    = path.join(__dirname, 'accounts.json');
const SHARED_PASSWORD  = 'y@70164';
const TARGET_COUNT     = parseInt(process.argv[2]) || 15; // default 15
const RESET_MODE       = process.argv.includes('--reset');
const DELAY_BETWEEN    = 25000; // 25 seconds between account creations

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log   = (e, m) => console.log(`${e}  ${m}`);

function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  } catch {}
  return [];
}

function saveAccounts(accounts) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

function generateUsername() {
  const prefixes = ['yogu','mast','cool','fast','nova','star','blaze','swift','flex','bolt','apex','vibe'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const num    = Math.floor(Math.random() * 90000) + 10000;
  const sep    = ['', '.', '_'][Math.floor(Math.random() * 3)];
  return `${prefix}${sep}${num}`;
}

function generateFullName() {
  const first = ['Raj','Priya','Amit','Neha','Vikas','Pooja','Rohan','Simran','Arjun','Meera','Dev','Ananya'];
  const last  = ['Sharma','Patel','Kumar','Singh','Verma','Gupta','Shah','Joshi','Nair','Reddy','Mehta','Iyer'];
  return `${first[Math.floor(Math.random() * first.length)]} ${last[Math.floor(Math.random() * last.length)]}`;
}

// ─── GUERRILLA MAIL ───────────────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    }).on('error', reject);
  });
}

async function createTempEmail() {
  try {
    const data = await httpGet('https://api.guerrillamail.com/ajax.php?f=get_email_address');
    log('📧', `Temp email: ${data.email_addr}`);
    return { email: data.email_addr, sid: data.sid_token };
  } catch (err) {
    log('❌', `Guerrilla Mail failed: ${err.message}`);
    return null;
  }
}

async function getOTPFromEmail(sid, maxWait = 120000) {
  log('⏳', 'Waiting for Instagram OTP email (up to 2 min)...');
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
          log('✅', `OTP: ${match[1]}`);
          return match[1];
        }
      }
    } catch {}
    await sleep(5000);
  }
  log('❌', 'OTP timed out');
  return null;
}

// ─── CREATE ONE INSTAGRAM ACCOUNT ────────────────────────────────────────────
async function createInstagramAccount(index, total) {
  const username = generateUsername();
  const fullName = generateFullName();
  const password = SHARED_PASSWORD;

  log('─', `[${index}/${total}] Creating: ${username}`);

  const emailData = await createTempEmail();
  if (!emailData) return null;
  const { email, sid } = emailData;

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

    // Fill email
    for (const sel of ['input[name="emailOrPhone"]', 'input[type="email"]', 'input[aria-label*="email" i]']) {
      try { await page.waitForSelector(sel, { timeout: 4000 }); await page.fill(sel, email); log('✅', `Email → ${sel}`); break; } catch {}
    }
    // Fill full name
    for (const sel of ['input[name="fullName"]', 'input[aria-label*="name" i]']) {
      try { await page.waitForSelector(sel, { timeout: 3000 }); await page.fill(sel, fullName); log('✅', `Name  → ${sel}`); break; } catch {}
    }
    // Fill username
    for (const sel of ['input[name="username"]', 'input[aria-label*="username" i]']) {
      try { await page.waitForSelector(sel, { timeout: 3000 }); await page.fill(sel, username); log('✅', `User  → ${sel}`); break; } catch {}
    }
    // Fill password
    for (const sel of ['input[name="password"]', 'input[type="password"]']) {
      try { await page.waitForSelector(sel, { timeout: 3000 }); await page.fill(sel, password); log('✅', `Pass  → ${sel}`); break; } catch {}
    }

    await sleep(1000);

    // Click Next
    for (const sel of ['button[type="submit"]', 'button:has-text("Next")', 'button:has-text("Sign up")']) {
      try { await page.click(sel); log('✅', `Submit clicked`); break; } catch {}
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

    // Get OTP
    const otp = await getOTPFromEmail(sid, 120000);
    if (!otp) {
      log('❌', `No OTP for ${username} — account creation failed`);
      await browser.close();
      return null;
    }

    // Enter OTP
    for (const sel of ['input[name="confirmationCode"]', 'input[aria-label*="code" i]', 'input[maxlength="6"]', 'input[name="code"]']) {
      try { await page.waitForSelector(sel, { timeout: 5000 }); await page.fill(sel, otp); log('✅', `OTP entered`); break; } catch {}
    }
    await sleep(1000);
    try { await page.click('button[type="submit"]'); await sleep(5000); } catch {}

    const finalUrl = page.url();
    const success  = finalUrl.includes('instagram.com') && !finalUrl.includes('signup');

    await browser.close();

    if (success || !finalUrl.includes('signup')) {
      log('🎉', `Account created! ${username} / ${password} (email: ${email})`);
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
      log('⚠️', `Result uncertain for ${username} — saving anyway (URL: ${finalUrl})`);
      return {
        username, password, email,
        usageCount: 0, status: 'active',
        createdAt: new Date().toISOString(), lastUsedAt: null
      };
    }

  } catch (err) {
    log('❌', `Error creating ${username}: ${err.message}`);
    await browser.close();
    return null;
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log(`🏭  INSTAGRAM ACCOUNT BOOTSTRAP`);
  console.log(`    Target: ${TARGET_COUNT} fresh accounts`);
  console.log(`    Reset mode: ${RESET_MODE}`);
  console.log('═'.repeat(60));

  // Load existing accounts
  let accounts = RESET_MODE ? [] : loadAccounts();
  const existing = accounts.filter(a => a.status === 'active').length;

  if (RESET_MODE) {
    log('🗑️', 'Reset mode — cleared all existing accounts');
  } else {
    log('📋', `Existing active accounts: ${existing}`);
  }

  const needed = Math.max(0, TARGET_COUNT - existing);
  log('🎯', `Need to create: ${needed} new accounts`);

  if (needed === 0) {
    log('✅', `Already have ${existing} active accounts — nothing to do!`);
    return;
  }

  let created = 0;
  let failed  = 0;

  for (let i = 1; i <= needed; i++) {
    console.log('\n' + '─'.repeat(50));
    const account = await createInstagramAccount(i, needed);

    if (account) {
      accounts.push(account);
      saveAccounts(accounts);
      created++;
      log('💾', `Saved! Total accounts: ${accounts.filter(a => a.status === 'active').length}`);
    } else {
      failed++;
      log('⚠️', `Failed (${failed} fails so far)`);
    }

    // Wait between creations (except after last)
    if (i < needed) {
      log('⏳', `Waiting ${DELAY_BETWEEN/1000}s before next account...`);
      await sleep(DELAY_BETWEEN);
    }
  }

  // Final summary
  console.log('\n' + '═'.repeat(60));
  console.log(`✅  BOOTSTRAP COMPLETE`);
  console.log(`    Created: ${created}  |  Failed: ${failed}  |  Total active: ${accounts.filter(a => a.status === 'active').length}`);
  console.log('═'.repeat(60));

  // Print all accounts
  console.log('\n📋 Account List:');
  accounts.filter(a => a.status === 'active').forEach((a, i) => {
    console.log(`   ${i + 1}. ${a.username} / ${a.password}`);
  });

  process.exit(created > 0 ? 0 : 1);
}

process.on('SIGINT',  () => { log('🛑', 'Stopped.'); process.exit(0); });
process.on('SIGTERM', () => { log('🛑', 'Terminated.'); process.exit(0); });

main().catch(err => { console.error('💥 Fatal:', err); process.exit(1); });
