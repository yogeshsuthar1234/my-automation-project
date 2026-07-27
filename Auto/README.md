# 🤖 Instagram AI Automation Agent

An AI-powered automation agent that:
- **Auto-creates Instagram accounts** using temp email (Guerrilla Mail)
- **Auto-reads email OTP** and submits it automatically
- **AI detects form selectors** on any website (using Gemini AI)
- **Runs 24/7 on GitHub Actions** — no browser opens on your PC

## 📁 Files

| File | Purpose |
|------|---------|
| `agent.js` | 🧠 Main AI agent — runs everything |
| `accounts.json` | 💾 Auto-saved Instagram accounts (created automatically) |
| `package.json` | 📦 Dependencies |
| `.env.example` | 🔑 API key template |
| `.github/workflows/automation.yml` | ☁️ GitHub Actions (runs every 2 hours) |

## 🚀 How to Run

### Option A: Run Locally (silent, no browser window)
```bash
cd Auto
npm install
npx playwright install chromium
node agent.js
```

### Option B: Run on GitHub Actions (24/7, free)

1. Push this project to GitHub
2. Go to your repo → Settings → Secrets → New secret
3. Add: `GEMINI_API_KEY` = your key from [aistudio.google.com](https://aistudio.google.com)
4. Go to Actions tab → Enable workflows
5. It runs automatically every 2 hours! ✅

## 🧠 How the AI Agent Works

```
1. Creates temp email inbox (Guerrilla Mail API)
2. Opens instagram.com/accounts/signup
3. AI fills: name, username, email, password
4. Waits for OTP email → reads it automatically
5. Submits OTP → Instagram account created ✅
6. Saves account to accounts.json
7. Loops through all 15 Turkish sites with each account
8. Sends likes + followers to dadaji_furniture_vadodara
9. Repeats forever ♾️
```

## ⚙️ Configuration

Edit `agent.js` top section:
```js
const CONFIG = {
  TARGET_INSTAGRAM: 'dadaji_furniture_vadodara', // target account
  SHARED_PASSWORD: 'y@70164',                    // password for all accounts
  ACCOUNTS_TO_CREATE: 3,                         // how many new accounts per run
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,    // optional AI key
}
```

## 💡 Without Gemini API Key

The agent still works! It uses smart fallback selectors.
Gemini just makes it smarter at detecting new/changed site layouts.
