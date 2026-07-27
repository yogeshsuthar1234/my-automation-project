/**
 * ðŸ­ bootstrap.js â€” Fresh Account Creator
 *
 * This script ONLY creates Instagram accounts and saves them to accounts.json.
 * Run this FIRST before the main agent.js automation.
 *
 * Usage:
 *   node bootstrap.js          â†’ creates 15 accounts (default)
 *   node bootstrap.js 10       â†’ creates 10 accounts
 *   node bootstrap.js --reset  â†’ clears old accounts first, then creates 15
 */

const { chromium } = require('playwright');
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// â”€â”€â”€ CONFIG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ACCOUNTS_FILE    = path.join(__dirname, 'accounts.json');
const SHARED_PASSWORD  = 'y@70164';
const TARGET_COUNT     = parseInt(process.argv[2]) || 15; // default 15
const RESET_MODE       = process.argv.includes('--reset');
const DELAY_BETWEEN    = 25000; // 25 seconds between account creations
const SCREENSHOT_LEVEL = (process.env.CREATE_SCREENSHOT_LEVEL || 'minimal').toLowerCase(); // minimal | debug | off
const POST_VERIFY_IDLE_MS = parseInt(process.env.POST_VERIFY_IDLE_MS || '300000', 10);
function shouldKeepEmailBrowser() { return process.env.KEEP_EMAIL_BROWSER === 'true'; }

// Visibly open browser on local desktop (headless: false), run headless in GitHub Actions (CI)
const HEADLESS = process.env.HEADLESS !== undefined 
  ? process.env.HEADLESS === 'true' 
  : !!process.env.CI;

// â”€â”€â”€ HELPERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log   = (e, m) => console.log(`${e}  ${m}`);

async function saveShot(page, label) {
  try {
    if (SCREENSHOT_LEVEL === 'off') return;
    const important = /FAILED|ERROR|final_result|timeout|no_otp/i.test(label);
    if (SCREENSHOT_LEVEL === 'minimal' && !important) return;

    const fs = require('fs');
    const path = require('path');
    const screenshotDir = path.join(__dirname, 'screenshots');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    const p = path.join(screenshotDir, `${label}.png`);
    await page.screenshot({ path: p, fullPage: false });
    log('SHOT', `Screenshot saved: screenshots/${label}.png`);
  } catch {}
}

function attachEmailSession(account, emailData) {
  if (!shouldKeepEmailBrowser() || !emailData?._browser) return account;
  Object.defineProperty(account, '_emailSession', {
    value: emailData,
    enumerable: false,
    configurable: true
  });
  return account;
}

async function finishAccount(account, emailData) {
  if (shouldKeepEmailBrowser() && emailData?._browser) return attachEmailSession(account, emailData);
  await closeTempEmailBrowser(emailData);
  return account;
}

function safeDebugLabel(label) {
  return String(label).replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80);
}

function matchOtp(text) {
  if (!text) return null;
  const match =
    text.match(/(\d{6})\s+is\s+your\s+Instagram\s+code/i) ||
    text.match(/Instagram[\s\S]{0,120}?(\d{6})/i) ||
    text.match(/\b(\d{6})\b/);
  return match ? match[1] : null;
}

async function collectFrameEmailDebug(frame) {
  try {
    return await frame.evaluate(() => {
      const selectors = [
        'table',
        'table tr',
        'tbody tr',
        '#refresh',
        '#mainEmail',
        'iframe',
        '[class*="mail" i]',
        '[class*="email" i]',
        '[class*="inbox" i]',
        '[id*="mail" i]',
        '[id*="email" i]',
        '[id*="inbox" i]'
      ];

      const selectorCounts = {};
      for (const selector of selectors) {
        selectorCounts[selector] = document.querySelectorAll(selector).length;
      }

      const bodyText = document.body
        ? (document.body.innerText || document.body.textContent || '')
        : '';

      const textOf = element =>
        (element.innerText || element.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();

      const candidates = Array.from(document.querySelectorAll('body *'))
        .map(element => ({
          tag: element.tagName,
          id: element.id || '',
          className: String(element.className || '').slice(0, 120),
          href: element.getAttribute('href') || '',
          text: textOf(element).slice(0, 400)
        }))
        .filter(item => /\b\d{6}\b|Instagram|confirmation|code|sender|subject|inbox|mail/i.test(item.text))
        .slice(0, 100);

      return {
        url: location.href,
        title: document.title,
        selectorCounts,
        mainEmail: document.querySelector('#mainEmail')?.value || '',
        bodyTextSample: bodyText.slice(0, 2000),
        bodyText,
        candidates
      };
    });
  } catch (err) {
    return { url: frame.url(), error: err.message };
  }
}

async function saveEmailDebug(page, label, options = {}) {
  try {
    const screenshotDir = path.join(__dirname, 'screenshots');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    const base = path.join(screenshotDir, `${safeDebugLabel(label)}_${Date.now()}`);

    const frames = [];
    for (const frame of page.frames()) {
      frames.push(await collectFrameEmailDebug(frame));
    }

    const allText = frames.map(frame => frame.bodyText || '').join('\n');
    const debug = {
      label,
      savedAt: new Date().toISOString(),
      pageUrl: page.url(),
      frameCount: page.frames().length,
      otp: matchOtp(allText),
      frames
    };

    fs.writeFileSync(`${base}.json`, JSON.stringify(debug, null, 2));

    if (options.html !== false) {
      try {
        fs.writeFileSync(`${base}.html`, await page.content());
      } catch (err) {
        fs.writeFileSync(`${base}.html.error.txt`, err.message);
      }
    }

    if (options.screenshot !== false) {
      await page.screenshot({ path: `${base}.png`, fullPage: false }).catch(() => {});
    }

    log('DEBUG', `Email debug saved: ${base}.(png/json/html)`);
    return debug;
  } catch (err) {
    log('WARN', `Could not save email debug: ${err.message}`);
    return null;
  }
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

// â”€â”€â”€ TEMP EMAIL â€” 1secemail.com via Playwright (PRIMARY) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 1secemail.com is browser-only (no REST API). We use Playwright to:
//   1. Open the site â†’ get email address from input#mainEmail
//   2. KEEP the browser page OPEN (stored in emailData._page)
//   3. After Instagram sends OTP â†’ click Refresh â†’ read OTP from inbox rows
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

// â”€â”€ Provider 1: 1secemail.com (Playwright browser â€” KEEP OPEN for OTP) â”€â”€â”€â”€â”€â”€
async function create1secemailInbox() {
  log('ðŸ”', 'Opening 1secemail.com via Playwright...');

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
    log('â³', 'Waiting for 1secemail.com to generate inbox...');
    let email = '';
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      email = await page.$eval('#mainEmail', el => el.value || el.getAttribute('aria-label') || '').catch(() => '');
      if (email && email !== 'Loading' && email.includes('@')) {
        log('ðŸ“§', `1secemail.com inbox ready: ${email}`);
        break;
      }
    }

    // If auto-load failed â†’ try setting custom alias via Change modal
    if (!email || !email.includes('@')) {
      log('âš ï¸', 'Auto-load failed â€” setting custom alias via Change modal...');
      const alias = 'yogu' + Math.floor(Math.random() * 900000 + 100000);

      try {
        await page.click('#change_email_btn', { timeout: 5000 });
        await sleep(700);

        // Fill alias input (try multiple selectors)
        for (const sel of ['input#name_email', 'input[name="name"]', '.modal-body input[type="text"]', '.modal input:not([type="hidden"])']) {
          try {
            await page.waitForSelector(sel, { timeout: 2000 });
            await page.triple_click?.(sel) || await page.click(sel);
            await page.fill(sel, alias);
            log('âœ…', `Alias input filled via ${sel}`);
            break;
          } catch {}
        }

        await page.click('#change_email', { timeout: 5000 });
        await sleep(1200);

        email = await page.$eval('#mainEmail', el => el.value || '').catch(() => '');
        if (!email || !email.includes('@')) {
          // Construct email from known alias
          email = `${alias}@1secemail.com`;
          log('âš ï¸', `Could not confirm email â€” assuming: ${email}`);
        } else {
          log('ðŸ“§', `1secemail.com alias set: ${email}`);
        }
      } catch (err) {
        log('âš ï¸', `Change alias failed: ${err.message}`);
        await browser.close();
        return null;
      }
    }

    if (!email || !email.includes('@')) {
      log('âŒ', '1secemail.com: could not get email address â€” site may be blocking this network');
      await browser.close();
      return null;
    }

    const [login, domain] = email.split('@');
    log('âœ…', `Using 1secemail.com: ${email} (browser kept open for OTP)`);

    // Return with _browser and _page so OTP reader can use the live inbox
    return { email, provider: '1secemail.com', login, domain, _browser: browser, _page: page };

  } catch (err) {
    log('âš ï¸', `1secemail.com Playwright error: ${err.message}`);
    await browser.close();
    return null;
  }
}

// â”€â”€ OTP reader: polls the OPEN 1secemail.com Playwright page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function getOTPFrom1secemail(page, maxWait = 120000) {
  const deadline = Date.now() + maxWait;
  const pollInterval = 2000;
  const refreshInterval = 15000;
  let lastRefreshAt = 0;
  let pollCount = 0;
  log('WAIT', 'Polling 1secemail.com inbox; using site auto-refresh with occasional manual refresh...');

  while (Date.now() < deadline) {
    pollCount++;
    try {
      const now = Date.now();
      if (pollCount === 1 || now - lastRefreshAt >= refreshInterval) {
        await page.click('#refresh', { timeout: 1500 }).catch(() => {});
        lastRefreshAt = now;
        await sleep(800);
      }

      const frames = [];
      for (const frame of page.frames()) {
        frames.push(await collectFrameEmailDebug(frame));
      }

      const allText = frames.map(frame => frame.bodyText || '').join('\n');
      let otp = matchOtp(allText);
      const mainFrame = frames[0] || {};
      const counts = mainFrame.selectorCounts || {};

      log(
        'DEBUG',
        `Inbox poll ${pollCount}: rows=${counts['table tr'] || 0}, mailLike=${counts['[class*="mail" i]'] || 0}, frames=${frames.length}, otpVisible=${Boolean(otp)}`
      );

      if (!otp) {
        try {
          const firstRow = await page.$('table tr:nth-child(2), table tbody tr:first-child');
          if (firstRow) {
            await firstRow.click();
            await sleep(800);
            const emailBody = await page.evaluate(() => {
              const body = document.querySelector('[class*="email-body"], [class*="mail-body"], [id*="email-body"], .card-body, .email-content');
              return body ? (body.innerText || body.textContent || '') : '';
            });
            const fullAfterClick = await page.evaluate(() => document.body.innerText || '');
            otp = matchOtp(`${emailBody}\n${fullAfterClick}`);
          }
        } catch {}
      }

      if (otp) {
        log('OK', `OTP from 1secemail.com: ${otp}`);
        return otp;
      }

      if (pollCount % 5 === 0) {
        log('WAIT', 'OTP not visible yet; continuing auto-refresh polling...');
      }
    } catch (err) {
      log('WARN', `Inbox poll error: ${err.message}`);
    }
    await sleep(pollInterval);
  }

  await saveEmailDebug(page, 'otp_timeout_inbox_final');
  log('FAIL', 'OTP timeout; check timeout screenshot/debug files to see inbox state');
  return null;
}
async function createGuerrillaInbox() {
  try {
    log('MAIL', 'Trying guerrillamail.com first...');
    const data = await httpGet('https://api.guerrillamail.com/ajax.php?f=get_email_address');
    if (data.email_addr) {
      log('ðŸ“§', `Guerrilla inbox: ${data.email_addr}`);
      return { email: data.email_addr, provider: 'guerrilla', sid: data.sid_token };
    }
  } catch (err) {
    log('âš ï¸', `Guerrilla Mail failed: ${err.message}`);
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
        if (match) { log('âœ…', `OTP from Guerrilla: ${match[1]}`); return match[1]; }
      }
    } catch {}
    await sleep(5000);
  }
  return null;
}

async function createTempEmail() {
  const inbox = await createGuerrillaInbox() || await create1secemailInbox();
  if (inbox) log('OK', `Inbox ready: ${inbox.email} [${inbox.provider}]`);
  else log('FAIL', 'All email providers failed!');
  return inbox;
}

// Universal OTP reader
async function getOTPFromEmail(emailData, maxWait = 120000) {
  log('â³', `Waiting for OTP on ${emailData.email} via [${emailData.provider}]...`);
  if (emailData.provider === '1secemail.com' && emailData._page) {
    return await getOTPFrom1secemail(emailData._page, maxWait);
  }
  return await getOTPFromGuerrilla(emailData.sid, maxWait);
}

// â”€â”€ Close email browser after account creation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function closeTempEmailBrowser(emailData) {
  if (emailData?._browser) {
    try { await emailData._browser.close(); } catch {}
  }
}

// â”€â”€â”€ CREATE ONE INSTAGRAM ACCOUNT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function fillFirstVisible(page, value, selectors, label) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout: 4000 });
      await locator.fill(value);
      const actual = await locator.inputValue().catch(() => '');
      if (actual === value || actual.length > 0) {
        log('OK', `${label} filled via ${selector}`);
        return true;
      }
    } catch {}
  }
  log('FAIL', `${label} field not filled`);
  return false;
}

async function readFirstInputValue(page, selectors) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout: 1500 });
      const value = await locator.inputValue();
      if (value) return value;
    } catch {}
  }
  return '';
}

async function fillVisibleInputByIndex(page, css, index, value, label) {
  try {
    const locator = page.locator(`${css}:visible`).nth(index);
    await locator.waitFor({ state: 'visible', timeout: 4000 });
    await locator.fill(value);
    const actual = await locator.inputValue().catch(() => '');
    if (actual === value || actual.length > 0) {
      log('OK', `${label} filled by visible ${css} index ${index}`);
      return true;
    }
  } catch (err) {
    log('WARN', `${label} index fallback failed: ${err.message.slice(0, 80)}`);
  }
  return false;
}

async function readVisibleInputByIndex(page, css, index) {
  try {
    const locator = page.locator(`${css}:visible`).nth(index);
    await locator.waitFor({ state: 'visible', timeout: 1500 });
    return await locator.inputValue();
  } catch {}
  return '';
}

async function clickControlByName(page, name) {
  const attempts = [
    () => page.getByRole('button', { name: new RegExp(`^${name}$`, 'i') }).first().click({ timeout: 2000 }),
    () => page.getByText(new RegExp(`^${name}$`, 'i')).first().click({ timeout: 2000 }),
    () => page.locator('div, span, button').filter({ hasText: new RegExp(`^${name}$`, 'i') }).first().click({ timeout: 2000 })
  ];

  for (const attempt of attempts) {
    try { await attempt(); return true; } catch {}
  }
  return false;
}

async function chooseOpenedOption(page, optionText) {
  const escaped = String(optionText).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  const exact = new RegExp(`^${escaped}$`, 'i');
  const attempts = [
    () => page.getByRole('option', { name: exact }).first().click({ timeout: 2000 }),
    () => page.getByText(exact).first().click({ timeout: 2000 }),
    () => page.locator('div, span, button').filter({ hasText: exact }).first().click({ timeout: 2000 })
  ];

  for (const attempt of attempts) {
    try { await attempt(); return true; } catch {}
  }
  return false;
}

async function selectNativeOption(selectLocator, wantedValues) {
  const options = await selectLocator.locator('option').evaluateAll((nodes, wanted) => {
    const lower = wanted.map(value => String(value).toLowerCase());
    return nodes.map((node, index) => ({
      index,
      value: node.value,
      label: node.textContent.trim()
    })).filter(option =>
      lower.includes(String(option.value).toLowerCase()) ||
      lower.includes(String(option.label).toLowerCase())
    );
  }, wantedValues);

  if (options.length === 0) return false;
  await selectLocator.selectOption({ value: options[0].value }).catch(async () => {
    await selectLocator.selectOption({ label: options[0].label });
  });
  return true;
}

async function selectBirthdayOver18(page) {
  const birthYear = new Date().getFullYear() - 25;
  const monthValues = ['January', 'Jan', '1', '01'];
  const dayValues = ['15'];
  const yearValues = [String(birthYear)];

  const selects = page.locator('select:not([name="locale"])');
  const count = await selects.count().catch(() => 0);
  if (count >= 3) {
    const monthOk = await selectNativeOption(selects.nth(0), monthValues);
    const dayOk = await selectNativeOption(selects.nth(1), dayValues);
    const yearOk = await selectNativeOption(selects.nth(2), yearValues);
    if (monthOk && dayOk && yearOk) {
      log('OK', `Birthday selected: January 15, ${birthYear}`);
      return true;
    }
  }

  const customChoices = [
    { control: 'Month', option: 'January', label: 'birth month' },
    { control: 'Day', option: '15', label: 'birth day' },
    { control: 'Year', option: String(birthYear), label: 'birth year' }
  ];

  let selected = 0;
  for (const choice of customChoices) {
    const opened = await clickControlByName(page, choice.control);
    if (!opened) {
      log('WARN', `${choice.label} control not found`);
      continue;
    }
    await sleep(500);
    const chosen = await chooseOpenedOption(page, choice.option);
    if (chosen) {
      log('OK', `${choice.label} selected: ${choice.option}`);
      selected++;
    } else {
      log('WARN', `${choice.label} option not found: ${choice.option}`);
    }
    await sleep(500);
  }

  if (selected === 3) {
    log('OK', `Birthday selected: January 15, ${birthYear}`);
    return true;
  }

  log('FAIL', 'Birthday selection did not complete');
  return false;
}
async function assertSignupFields(page) {
  const state = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input')).map(input => ({
      name: input.name || '',
      aria: input.getAttribute('aria-label') || '',
      placeholder: input.getAttribute('placeholder') || '',
      type: input.type || '',
      value: input.type === 'password' && input.value ? '[filled]' : (input.value || '')
    }));
    const selects = Array.from(document.querySelectorAll('select')).map(select => ({
      name: select.name || '',
      title: select.getAttribute('title') || '',
      value: select.value || '',
      selected: select.options[select.selectedIndex]?.textContent?.trim() || ''
    }));
    return { inputs, selects };
  });

  log('DEBUG', `Signup inputs: ${JSON.stringify(state.inputs)}`);
  log('DEBUG', `Signup selects: ${JSON.stringify(state.selects)}`);
  return state;
}

async function clickSignupSubmit(page, label) {
  const attempts = [
    () => page.getByRole('button', { name: /^Submit$/i }).click({ timeout: 3000 }),
    () => page.getByRole('button', { name: /^(Continue|Next|Sign up)$/i }).click({ timeout: 3000 }),
    () => page.locator('button').filter({ hasText: /^(Continue|Submit)$/i }).first().click({ timeout: 3000 }),
    () => page.locator('button[type="submit"]').first().click({ timeout: 3000 }),
    () => page.locator('[role="button"]').filter({ hasText: /^(Continue|Submit)$/i }).first().click({ timeout: 3000 }),
    () => page.getByText(/^(Continue|Submit)$/i).click({ timeout: 3000 })
  ];

  for (const attempt of attempts) {
    try {
      await attempt();
      log('OK', `${label} submit clicked`);
      return true;
    } catch {}
  }

  const controls = await page.evaluate(() => Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')).map(el => ({
    tag: el.tagName,
    type: el.getAttribute('type') || '',
    role: el.getAttribute('role') || '',
    text: (el.innerText || el.textContent || el.value || '').replace(/\s+/g, ' ').trim(),
    disabled: el.disabled || el.getAttribute('aria-disabled') || ''
  })));
  log('DEBUG', `Clickable controls before submit: ${JSON.stringify(controls)}`);
  return false;
}
async function createInstagramAccount(index, total) {
  let username = generateUsername();
  const fullName = generateFullName();
  const password = SHARED_PASSWORD;

  log('â”€', `[${index}/${total}] Creating: ${username}`);

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
    await page.locator('input').first().waitFor({ state: 'visible', timeout: 10000 });
    await sleep(500);
    await saveShot(page, `create_${username}_01_loaded`);

    let emailFilled = await fillFirstVisible(page, email, [
      'input[name="emailOrPhone"]',
      'input[name="email"]',
      'input[type="email"]',
      'input[aria-label*="Mobile" i]',
      'input[placeholder*="Mobile" i]',
      'input[aria-label*="email" i]',
      'input[placeholder*="email" i]'
    ], 'Email');
    if (!emailFilled) {
      emailFilled = await fillVisibleInputByIndex(page, 'input[type="text"]', 0, email, 'Email');
    }

    const passwordFilled = await fillFirstVisible(page, password, [
      'input[name="password"]',
      'input[type="password"]',
      'input[aria-label*="Password" i]',
      'input[placeholder*="Password" i]'
    ], 'Password');

    const birthdayFilled = await selectBirthdayOver18(page);

    let nameFilled = await fillFirstVisible(page, fullName, [
      'input[name="fullName"]',
      'input[aria-label*="Full name" i]',
      'input[placeholder*="Full name" i]'
    ], 'Full name');
    if (!nameFilled) {
      nameFilled = await fillVisibleInputByIndex(page, 'input[type="text"]', 1, fullName, 'Full name');
    }

    // Do not type username. Instagram usually generates an available one after email/name.
    await sleep(900);
    let generatedUsername = await readFirstInputValue(page, [
      'input[name="username"]',
      'input[aria-label*="Username" i]',
      'input[placeholder*="Username" i]'
    ]);
    if (!generatedUsername || generatedUsername === fullName) {
      generatedUsername = await readVisibleInputByIndex(page, 'input[type="search"]', 0);
    }
    if (generatedUsername) {
      username = generatedUsername;
      log('OK', `Instagram generated username: ${generatedUsername}`);
    } else {
      log('WARN', `Instagram did not expose a generated username yet; fallback label: ${username}`);
    }

    await assertSignupFields(page);

    if (!emailFilled || !passwordFilled || !birthdayFilled || !nameFilled) {
      log('FAIL', 'Required signup fields were not completed; stopping before submit');
      await saveShot(page, `create_${username}_02_FAILED_missing_signup_fields`);
      await browser.close();
      await closeTempEmailBrowser(emailData);
      return null;
    }

    await sleep(300);
    await saveShot(page, `create_${username}_02_filled`);

    const submitClicked = await clickSignupSubmit(page, 'Signup');
    if (!submitClicked) {
      log('FAIL', 'Signup submit button was not clicked; stopping before OTP wait');
      await saveShot(page, `create_${username}_03_FAILED_submit_not_clicked`);
      await browser.close();
      await closeTempEmailBrowser(emailData);
      return null;
    }
    await Promise.race([
      page.locator('input[name="confirmationCode"], input[aria-label*="code" i], input[maxlength="6"], input[name="code"]').first().waitFor({ state: 'visible', timeout: 6000 }).catch(() => {}),
      sleep(1500)
    ]);
    await saveShot(page, `create_${username}_03_submitted`);

    // Some Instagram variants show birthday on a second page. The new form already handled it above.
    try {
      const hasConfirmationInput = await page.locator('input[name="confirmationCode"], input[aria-label*="code" i], input[maxlength="6"], input[name="code"]').count();
      const hasBirthdaySelects = await page.locator('select').count();
      if (!hasConfirmationInput && hasBirthdaySelects >= 3) {
        const secondBirthdayFilled = await selectBirthdayOver18(page);
        if (secondBirthdayFilled) {
          await clickSignupSubmit(page, 'Second-page birthday');
          await sleep(1000);
          log('OK', 'Second-page birthday submitted');
          await saveShot(page, `create_${username}_03b_birthday_submitted`);
        }
      }
    } catch {}

    // Get OTP â€” uses whichever provider created the inbox
    const otp = await getOTPFromEmail(emailData, 120000);
    emailData._lastOtp = otp || null;
    if (!otp) {
      log('âŒ', `No OTP for ${username} â€” account creation failed`);
      await saveShot(page, `create_${username}_04_FAILED_no_otp`);
      await browser.close();
      await closeTempEmailBrowser(emailData);
      return null;
    }

    // Enter OTP
    for (const sel of ['input[name="confirmationCode"]', 'input[aria-label*="code" i]', 'input[maxlength="6"]', 'input[name="code"]']) {
      try { await page.waitForSelector(sel, { timeout: 5000 }); await page.fill(sel, otp); log('âœ…', `OTP entered`); break; } catch {}
    }
    await sleep(300);
    await saveShot(page, `create_${username}_05_otp_entered`);

    const otpContinueClicked = await clickSignupSubmit(page, 'OTP Continue');
    if (!otpContinueClicked) {
      log('FAIL', 'OTP Continue button was not clicked; account cannot finish');
      await saveShot(page, `create_${username}_06_FAILED_continue_not_clicked`);
      await browser.close();
      await closeTempEmailBrowser(emailData);
      return null;
    }
    await sleep(12000);

    const finalUrl = page.url();
    await saveShot(page, `create_${username}_06_final_result`);
    const success  = finalUrl.includes('instagram.com') && !finalUrl.includes('signup');

    if (POST_VERIFY_IDLE_MS > 0) {
      log('WAIT', `Keeping Instagram page open for ${Math.round(POST_VERIFY_IDLE_MS / 1000)}s after email verification...`);
      await page.bringToFront().catch(() => {});
      await sleep(POST_VERIFY_IDLE_MS);
    }

    await browser.close();

    if (success || !finalUrl.includes('signup')) {
      log('DONE', `Account created! ${username} / ${password} (email: ${email})`);
    } else {
      log('WARN', `Result uncertain for ${username} - saving anyway (URL: ${finalUrl})`);
    }

    return await finishAccount({
      username,
      password,
      email,
      emailLogin: emailData.login || email.split('@')[0],
      emailDomain: emailData.domain || email.split('@')[1],
      emailProvider: emailData.provider,
      emailSid: emailData.sid || null,
      emailLastOtp: emailData._lastOtp || null,
      usageCount: 0,
      status: 'active',
      createdAt: new Date().toISOString(),
      lastUsedAt: null
    }, emailData);

  } catch (err) {
    log('âŒ', `Error creating ${username}: ${err.message}`);
    await saveShot(page, `create_${username}_ERROR_exception`);
    await browser.close().catch(() => {});
    await closeTempEmailBrowser(emailData); // always clean up email browser
    return null;
  }
}

// â”€â”€â”€ MAIN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function main() {
  console.log('\n' + 'â•'.repeat(60));
  console.log(`ðŸ­  INSTAGRAM ACCOUNT BOOTSTRAP`);
  console.log(`    Target: ${TARGET_COUNT} fresh accounts`);
  console.log(`    Reset mode: ${RESET_MODE}`);
  console.log('â•'.repeat(60));

  // Load existing accounts
  let accounts = RESET_MODE ? [] : loadAccounts();
  const existing = accounts.filter(a => a.status === 'active').length;

  if (RESET_MODE) {
    log('ðŸ—‘ï¸', 'Reset mode â€” cleared all existing accounts');
  } else {
    log('ðŸ“‹', `Existing active accounts: ${existing}`);
  }

  const needed = Math.max(0, TARGET_COUNT - existing);
  log('ðŸŽ¯', `Need to create: ${needed} new accounts`);

  if (needed === 0) {
    log('âœ…', `Already have ${existing} active accounts â€” nothing to do!`);
    return;
  }

  let created = 0;
  let failed  = 0;

  for (let i = 1; i <= needed; i++) {
    console.log('\n' + 'â”€'.repeat(50));
    const account = await createInstagramAccount(i, needed);

    if (account) {
      accounts.push(account);
      saveAccounts(accounts);
      created++;
      log('ðŸ’¾', `Saved! Total accounts: ${accounts.filter(a => a.status === 'active').length}`);
    } else {
      failed++;
      log('âš ï¸', `Failed (${failed} fails so far)`);
    }

    // Wait between creations (except after last)
    if (i < needed) {
      log('â³', `Waiting ${DELAY_BETWEEN/1000}s before next account...`);
      await sleep(DELAY_BETWEEN);
    }
  }

  // Final summary
  console.log('\n' + 'â•'.repeat(60));
  console.log(`âœ…  BOOTSTRAP COMPLETE`);
  console.log(`    Created: ${created}  |  Failed: ${failed}  |  Total active: ${accounts.filter(a => a.status === 'active').length}`);
  console.log('â•'.repeat(60));

  // Print all accounts
  console.log('\nðŸ“‹ Account List:');
  accounts.filter(a => a.status === 'active').forEach((a, i) => {
    console.log(`   ${i + 1}. ${a.username} / ${a.password}`);
  });

  process.exit(created > 0 ? 0 : 1);
}

module.exports = { createInstagramAccount };

if (require.main === module) {
  process.on('SIGINT',  () => { log('STOP', 'Stopped.'); process.exit(0); });
  process.on('SIGTERM', () => { log('STOP', 'Terminated.'); process.exit(0); });

  main().catch(err => { console.error('Fatal:', err); process.exit(1); });
}


