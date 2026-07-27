const { chromium, expect } = require('playwright');

// List of all 13 websites
const WEBSITES = [
      'https://takipcitime.com/login',
      'https://takipfun.net/3f8c4b124cc1121f1d9aa1ab65ac5141222c880f',
      'https://www.takipcivar.net/3f8c4b124cc1121f1d9aa1ab65ac5141222c880f',
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
    'https://takipcizen.com/login'   ,
     'https://takipcikrali.com/login'   ,
      'https://takipcitime.com/login'


];

// --- Configuration ---
const USERNAME = 'yogu5166';
const PASSWORD = 'y@70164';

// --- Main Automation Function ---
async function automateWebsite(siteUrl) {
    console.log(`\n🚀 Starting automation for: ${siteUrl}`);
    
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    page.setDefaultTimeout(60000); // 60 seconds
    
    try {
        // --- 1. Login ---
        console.log(`Navigating to ${siteUrl}...`);
        await page.goto(siteUrl);

        console.log('Waiting for login form to be visible...');
        
        // Try different possible username selectors
        const usernameSelectors = ['#username', 'input[name="username"]', 'input[type="text"]', 'input[placeholder*="username" i]', 'input[placeholder*="email" i]'];
        let usernameFieldFound = false;
        
        for (const selector of usernameSelectors) {
            try {
                await page.waitForSelector(selector, { state: 'visible', timeout: 5000 });
                await page.fill(selector, USERNAME);
                usernameFieldFound = true;
                console.log(`✅ Username field found with selector: ${selector}`);
                break;
            } catch (error) {
                continue;
            }
        }
        
        if (!usernameFieldFound) {
            throw new Error('Could not find username field on this website');
        }

        // Try different possible password selectors
        const passwordSelectors = ['input[name="password"]', 'input[type="password"]', 'input[placeholder*="password" i]'];
        let passwordFieldFound = false;
        
        for (const selector of passwordSelectors) {
            try {
                await page.waitForSelector(selector, { state: 'visible', timeout: 5000 });
                await page.fill(selector, PASSWORD);
                passwordFieldFound = true;
                console.log(`✅ Password field found with selector: ${selector}`);
                break;
            } catch (error) {
                continue;
            }
        }
        
        if (!passwordFieldFound) {
            throw new Error('Could not find password field on this website');
        }

        console.log('Clicking login button...');
        // Try different login button selectors
        const loginButtonSelectors = ['#login_insta', 'button[type="submit"]', 'input[type="submit"]', 'button:has-text("Login")', 'button:has-text("Giriş")'];
        let loginButtonFound = false;
        
        for (const selector of loginButtonSelectors) {
            try {
                await page.click(selector);
                loginButtonFound = true;
                console.log(`✅ Login button clicked with selector: ${selector}`);
                break;
            } catch (error) {
                continue;
            }
        }
        
        if (!loginButtonFound) {
            throw new Error('Could not find login button on this website');
        }

        // Wait for login to complete - try different possible success indicators
        try {
            await page.waitForURL('**/tools**', { timeout: 10000 });
        } catch (error) {
            try {
                await page.waitForURL('**/member**', { timeout: 10000 });
            } catch (error) {
                try {
                    await page.waitForURL('**/dashboard**', { timeout: 10000 });
                } catch (error) {
                    console.log('⚠️ Could not detect specific post-login URL, continuing anyway...');
                }
            }
        }
        
        console.log('✅ Successfully logged in.');

        // --- 3. Close the Popup ---
        console.log('Checking for the popup modal...');
        try {
            const closeButtonSelectors = ['button.close', '.modal-close', '[aria-label="close"]', '.btn-close'];
            for (const selector of closeButtonSelectors) {
                try {
                    await page.click(selector, { timeout: 2000 });
                    console.log(`✅ Popup closed with selector: ${selector}`);
                    break;
                } catch (error) {
                    continue;
                }
            }
        } catch (error) {
            console.log('ℹ️ No popup found or could not close it, continuing...');
        }

        // --- 4. Send Likes ---
        console.log('Navigating to send-like page...');
        try {
            await page.click('a[href="/tools/send-like"]', { timeout: 10000 });
        } catch (error) {
            console.log('❌ Could not find send-like link, skipping likes...');
        }

        try {
            await page.fill('input[name="mediaUrl"]', 'https://www.instagram.com/reel/DPqdITcCPLF/?igsh=MWR1ZzR6bGJjbWJxaw==');
            await page.click('button:has-text("Gönderiyi Bul")');
            await page.waitForTimeout(5000);
            await page.fill('input[name="adet"]', '5000');
            await page.click('#formBegeniSubmitButton');
            console.log('✅ Likes sent successfully');
            await page.waitForTimeout(5000);
        } catch (error) {
            console.log('❌ Failed to send likes:', error.message);
        }

        // --- 5. Send Followers ---
        console.log('Navigating to send-follower page...');
        try {
            await page.click('a[href="/tools/send-follower"]', { timeout: 10000 });
        } catch (error) {
            console.log('❌ Could not find send-follower link, skipping followers...');
        }

        try {
            await page.fill('input[name="username"]', 'dadaji_furniture_vadodara');
            await page.click('button:has-text("Kullanıcıyı Bul")');
            await page.waitForTimeout(5000);
            await page.fill('input[name="adet"]', '49999');
            await page.click('#formTakipSubmitButton');
            console.log('✅ Followers sent successfully');
            await page.waitForTimeout(5000);
        } catch (error) {
            console.log('❌ Failed to send followers:', error.message);
        }

        console.log(`✅ Completed automation for: ${siteUrl}`);

    } catch (error) {
        console.error(`❌ An error occurred during automation for ${siteUrl}:`, error.message);
        await page.screenshot({ path: `error_${siteUrl.replace(/[^a-zA-Z0-9]/g, '_')}.png` });
    } finally {
        console.log('Closing browser...');
        await browser.close();
    }
}

// --- Main execution function ---
async function main() {
    console.log('🚀 Starting automation script for all 13 websites...');
    
    for (const website of WEBSITES) {
        try {
            await automateWebsite(website);
            
            // Add a small delay between websites to avoid being blocked
            await new Promise(resolve => setTimeout(resolve, 3000));
            
        } catch (error) {
            console.error(`❌ Failed to process ${website}:`, error.message);
            continue; // Continue with next website even if one fails
        }
    }
    
    console.log('🎉 Completed automation for all websites!');
}

// Run the main function
main();