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

// Visibly open browser on local desktop (headless: false), run headless in GitHub Actions (CI)
const HEADLESS = process.env.HEADLESS !== undefined 
  ? process.env.HEADLESS === 'true' 
  : !!process.env.CI;

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log   = (e, m) => console.log(`${e}  ${m}`);

async function saveShot(page, label) {
  try {
    const fs = require('fs');
    const path = require('path');
    const screenshotDir = path.join(__dirname, 'screenshots');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    const p = path.join(screenshotDir, `${label}.png`);
    await page.screenshot({ path: p, fullPage: true });
    log('📸', `Screenshot saved: screenshots/${label}.png`);
  } catch {}
}

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
  const stamp  = Date.now().toString().slice(-6);
  const rnd    = Math.floor(Math.random() * 90 + 10);
  return `${prefix}_${stamp}${rnd}`;
}

function generateFullName() {
  const first = ['Raj','Priya','Amit','Neha','Vikas','Pooja','Rohan','Simran','Arjun','Meera','Dev','Ananya'];
  const last  = ['Sharma','Patel','Kumar','Singh','Verma','Gupta','Shah','Joshi','Nair','Reddy','Mehta','Iyer'];
  return `${first[Math.floor(Math.random() * first.length)]} ${last[Math.floor(Math.random() * last.length)]}`;
}

// ─── TEMP EMAIL — 1secemail.com via Playwright (PRIMARY) ─────────────────────
// 1secemail.com is browser-only (no REST API). We use Playwright to:
//   1. Open the site → get email address from input#mainEmail
//   2. KEEP the browser page OPEN (stored in emailData._page)
//   3. After Instagram sends OTP → click Refresh → read OTP from inbox rows
//   4. Close the browser after OTP is received

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    }).on('error', reject);
  });
}

// ── Provider 1: 1secemail.com (Playwright browser — KEEP OPEN for OTP) ──────
async function create1secemailInbox() {
  log('🔍', 'Opening 1secemail.com via Playwright...');

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  try {
    await page.goto('https://www.1secemail.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait up to 15s for email to auto-load into input#mainEmail
    log('⏳', 'Waiting for 1secemail.com to generate inbox...');
    let email = '';
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      email = await page.$eval('#mainEmail', el => el.value || el.getAttribute('aria-label') || '').catch(() => '');
      if (email && email !== 'Loading' && email.includes('@')) {
        log('📧', `1secemail.com inbox ready: ${email}`);
        break;
      }
    }

    // If auto-load failed → try setting custom alias via Change modal
    if (!email || !email.includes('@')) {
      log('⚠️', 'Auto-load failed — setting custom alias via Change modal...');
      const alias = 'yogu' + Math.floor(Math.random() * 900000 + 100000);

      try {
        await page.click('#change_email_btn', { timeout: 5000 });
        await sleep(1500);

        // Fill alias input (try multiple selectors)
        for (const sel of ['input#name_email', 'input[name="name"]', '.modal-body input[type="text"]', '.modal input:not([type="hidden"])']) {
          try {
            await page.waitForSelector(sel, { timeout: 2000 });
            await page.triple_click?.(sel) || await page.click(sel);
            await page.fill(sel, alias);
            log('✅', `Alias input filled via ${sel}`);
            break;
          } catch {}
        }

        await page.click('#change_email', { timeout: 5000 });
        await sleep(3000);

        email = await page.$eval('#mainEmail', el => el.value || '').catch(() => '');
        if (!email || !email.includes('@')) {
          // Construct email from known alias
          email = `${alias}@1secemail.com`;
          log('⚠️', `Could not confirm email — assuming: ${email}`);
        } else {
          log('📧', `1secemail.com alias set: ${email}`);
        }
      } catch (err) {
        log('⚠️', `Change alias failed: ${err.message}`);
        await browser.close();
        return null;
      }
    }

    if (!email || !email.includes('@')) {
      log('❌', '1secemail.com: could not get email address — site may be blocking this network');
      await browser.close();
      return null;
    }

    const [login, domain] = email.split('@');
    log('✅', `Using 1secemail.com: ${email} (browser kept open for OTP)`);

    // Return with _browser and _page so OTP reader can use the live inbox
    return { email, provider: '1secemail.com', login, domain, _browser: browser, _page: page };

  } catch (err) {
    log('⚠️', `1secemail.com Playwright error: ${err.message}`);
    await browser.close();
    return null;
  }
}

// ── OTP reader: polls the OPEN 1secemail.com Playwright page ─────────────────
async function getOTPFrom1secemail(page, maxWait = 120000) {
  const deadline = Date.now() + maxWait;
  log('⏳', 'Polling 1secemail.com inbox (Playwright) for Instagram OTP...');

  while (Date.now() < deadline) {
    try {
      // Click Refresh to fetch latest emails
      await page.click('#refresh', { timeout: 5000 }).catch(() => {});
      await sleep(5000); // Give AJAX time to load emails

      // ── FIX: Inbox emails are AJAX-loaded and NOT in body.innerText
      // Read each table cell directly using page.evaluate on specific elements
      const tableData = await page.evaluate(() => {
        // Try all possible inbox containers
        const rows = Array.from(document.querySelectorAll('table tr, .email-item, [class*="inbox"] tr, [id*="inbox"] tr'));
        return rows.map(row => row.innerText || row.textContent || '').join('\n');
      });

      // Also grab the full body text as backup
      const bodyText = await page.evaluate(() => document.body.innerText || '');

      // Combine both — search in table cells first, then full body
      const searchText = tableData + '\n' + bodyText;

      // Log the TABLE data specifically (not body marketing text)
      log('🔍', `Table data: ${tableData.slice(0, 300).replace(/\n/g, ' | ')}`);

      // Match OTP from Instagram subject: "415098 is your Instagram code"
      let match = searchText.match(/(\d{6})\s+is\s+your\s+Instagram\s+code/i)
               || searchText.match(/Instagram\s+code[:\s]+(\d{6})/i)
               || tableData.match(/\b(\d{6})\b/); // any 6-digit in table rows

      // Also try clicking the first email row if visible
      if (!match) {
        try {
          const firstRow = await page.$('table tr:nth-child(2), table tbody tr:first-child');
          if (firstRow) {
            log('📬', 'Clicking first inbox row...');
            await firstRow.click();
            await sleep(2500);
            // After clicking, read the email body area
            const emailBody = await page.evaluate(() => {
              const body = document.querySelector('[class*="email-body"], [class*="mail-body"], [id*="email-body"], .card-body, .email-content');
              return body ? (body.innerText || body.textContent || '') : '';
            });
            const fullAfterClick = await page.evaluate(() => document.body.innerText || '');
            log('🔍', `After click text: ${fullAfterClick.slice(0, 300).replace(/\n/g, ' | ')}`);
            match = emailBody.match(/(\d{6})\s+is\s+your\s+Instagram\s+code/i)
                 || emailBody.match(/\b(\d{6})\b/)
                 || fullAfterClick.match(/(\d{6})\s+is\s+your\s+Instagram\s+code/i);
          }
        } catch {}
      }

      if (match) {
        log('✅', `OTP from 1secemail.com: ${match[1]}`);
        return match[1];
      }

      log('⏳', 'OTP not yet in inbox — waiting...');

    } catch (err) {
      log('⚠️', `Inbox poll error: ${err.message}`);
    }
    await sleep(5000);
  }


  // ── Save screenshot before giving up — helps debug WHY it failed
  try {
    const fs = require('fs');
    const screenshotDir = require('path').join(__dirname, 'screenshots');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = require('path').join(screenshotDir, `otp_timeout_inbox_${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    log('📸', `Timeout screenshot saved: ${screenshotPath}`);
  } catch (e) {
    log('⚠️', `Could not save timeout screenshot: ${e.message}`);
  }

  log('❌', 'OTP timeout — check timeout screenshot to see what inbox looked like');
  return null;
}

// ── Fallback: Guerrilla Mail (REST API) ───────────────────────────────────────
async function createGuerrillaInbox() {
  try {
    log('🔍', 'Fallback: trying guerrillamail.com...');
    const data = await httpGet('https://api.guerrillamail.com/ajax.php?f=get_email_address');
    if (data.email_addr) {
      log('📧', `Guerrilla inbox: ${data.email_addr}`);
      return { email: data.email_addr, provider: 'guerrilla', sid: data.sid_token };
    }
  } catch (err) {
    log('⚠️', `Guerrilla Mail failed: ${err.message}`);
  }
  return null;
}

async function getOTPFromGuerrilla(sid, maxWait = 120000) {
  const deadline = Date.now() + maxWait;
  while (Date.now() < deadline) {
    try {
      const data = await httpGet(`https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=${sid}`);
      for (const mail of (data.list || [])) {
        const full = await httpGet(`https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${mail.mail_id}&sid_token=${sid}`);
        const body = (full.mail_body || '') + (full.mail_excerpt || '');
        const match = body.match(/\b(\d{6})\b/);
        if (match) { log('✅', `OTP from Guerrilla: ${match[1]}`); return match[1]; }
      }
    } catch {}
    await sleep(5000);
  }
  return null;
}

// ── Create inbox (try 1secemail first, fallback to Guerrilla) ─────────────────
async function createTempEmail() {
  const inbox = await create1secemailInbox() || await createGuerrillaInbox();
  if (inbox) log('✅', `Inbox ready: ${inbox.email} [${inbox.provider}]`);
  else log('❌', 'All email providers failed!');
  return inbox;
}

// ── Universal OTP reader ───────────────────────────────────────────────────────
async function getOTPFromEmail(emailData, maxWait = 120000) {
  log('⏳', `Waiting for OTP on ${emailData.email} via [${emailData.provider}]...`);
  if (emailData.provider === '1secemail.com' && emailData._page) {
    return await getOTPFrom1secemail(emailData._page, maxWait);
  }
  return await getOTPFromGuerrilla(emailData.sid, maxWait);
}

// ── Close email browser after account creation ────────────────────────────────
async function closeTempEmailBrowser(emailData) {
  if (emailData?._browser) {
    try { await emailData._browser.close(); } catch {}
  }
}

// ─── CREATE ONE INSTAGRAM ACCOUNT ────────────────────────────────────────────
async function createInstagramAccount(index, total) {
  const username = generateUsername();
  const fullName = generateFullName();
  const password = SHARED_PASSWORD;

  log('─', `[${index}/${total}] Creating: ${username}`);

  const emailData = await createTempEmail();
  if (!emailData) return null;
  const { email } = emailData;

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  try {
    await page.goto('https://www.instagram.com/accounts/emailsignup/', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await sleep(3000);
    await saveShot(page, `create_${username}_01_loaded`);

    // Fill email
    for (const sel of ['input[aria-label*="Mobile" i]', 'input[placeholder*="Mobile" i]', 'input[name="emailOrPhone"]', 'input[name="email"]', 'input[type="email"]']) {
      try { await page.waitForSelector(sel, { timeout: 3000 }); await page.fill(sel, email); log('✅', `Email → ${sel}`); break; } catch {}
    }
    // Fill password
    for (const sel of ['input[aria-label*="Password" i]', 'input[placeholder*="Password" i]', 'input[name="password"]', 'input[type="password"]']) {
      try { await page.waitForSelector(sel, { timeout: 3000 }); await page.fill(sel, password); log('✅', `Pass  → ${sel}`); break; } catch {}
    }

    // Fill birthday if selects exist on this page
    try {
      const selects = await page.$$('select');
      if (selects.length >= 3) {
        await selects[0].selectOption({ index: 6 });  // July
        await selects[1].selectOption({ index: 15 }); // 15
        await selects[2].selectOption({ value: '1995' }).catch(() => selects[2].selectOption({ index: 25 })); // 1995
        log('✅', 'Birthday selects filled');
      }
    } catch {}

    // Fill full name
    for (const sel of ['input[aria-label*="Full name" i]', 'input[placeholder*="Full name" i]', 'input[name="fullName"]']) {
      try { await page.waitForSelector(sel, { timeout: 3000 }); await page.fill(sel, fullName); log('✅', `Name  → ${sel}`); break; } catch {}
    }
    // Fill username
    for (const sel of ['input[aria-label*="Username" i]', 'input[placeholder*="Username" i]', 'input[name="username"]']) {
      try { await page.waitForSelector(sel, { timeout: 3000 }); await page.fill(sel, username); log('✅', `User  → ${sel}`); break; } catch {}
    }

    await sleep(1000);
    await saveShot(page, `create_${username}_02_filled`);

    // Click Submit
    for (const sel of ['button[type="submit"]', 'button:has-text("Submit")', 'button:has-text("Next")', 'button:has-text("Sign up")']) {
      try { await page.click(sel); log('✅', `Submit clicked`); break; } catch {}
    }
    await sleep(4000);
    await saveShot(page, `create_${username}_03_submitted`);
    await saveShot(page, `create_${username}_03_submitted`);

    // Birthday page
    try {
      if (await page.isVisible('select[title*="Month"]', { timeout: 3000 })) {
        await page.selectOption('select[title*="Month"]', '6');
        await page.selectOption('select[title*="Day"]',   '15');
        await page.selectOption('select[title*="Year"]',  '1995');
        await page.click('button[type="submit"]');
        await sleep(2000);
        log('✅', 'Birthday filled');
        await saveShot(page, `create_${username}_03b_birthday_submitted`);
      }
    } catch {}

    // Get OTP — uses whichever provider created the inbox
    const otp = await getOTPFromEmail(emailData, 120000);
    if (!otp) {
      log('❌', `No OTP for ${username} — account creation failed`);
      await saveShot(page, `create_${username}_04_FAILED_no_otp`);
      await browser.close();
      return null;
    }

    // Enter OTP
    for (const sel of ['input[name="confirmationCode"]', 'input[aria-label*="code" i]', 'input[maxlength="6"]', 'input[name="code"]']) {
      try { await page.waitForSelector(sel, { timeout: 5000 }); await page.fill(sel, otp); log('✅', `OTP entered`); break; } catch {}
    }
    await sleep(1000);
    await saveShot(page, `create_${username}_05_otp_entered`);

    try { await page.click('button[type="submit"]'); await sleep(5000); } catch {}

    const finalUrl = page.url();
    await saveShot(page, `create_${username}_06_final_result`);
    const success  = finalUrl.includes('instagram.com') && !finalUrl.includes('signup');

    await browser.close();
    await closeTempEmailBrowser(emailData); // close 1secemail.com browser

    if (success || !finalUrl.includes('signup')) {
      log('🎉', `Account created! ${username} / ${password} (email: ${email})`);
      return {
        username,
        password,
        email,
        emailLogin: emailData.login || email.split('@')[0], // alias for reopening inbox
        emailDomain: emailData.domain || email.split('@')[1],
        usageCount: 0,
        status: 'active',
        createdAt: new Date().toISOString(),
        lastUsedAt: null
      };
    } else {
      log('⚠️', `Result uncertain for ${username} — saving anyway (URL: ${finalUrl})`);
      return {
        username, password, email,
        emailLogin: emailData.login || email.split('@')[0],
        emailDomain: emailData.domain || email.split('@')[1],
        usageCount: 0, status: 'active',
        createdAt: new Date().toISOString(), lastUsedAt: null
      };
    }

  } catch (err) {
    log('❌', `Error creating ${username}: ${err.message}`);
    await saveShot(page, `create_${username}_ERROR_exception`);
    await browser.close().catch(() => {});
    await closeTempEmailBrowser(emailData); // always clean up email browser
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
