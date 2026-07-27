const { chromium } = require('playwright');

// Username array - add as many as you want
const USERNAMES = [
    //'yogu11110',
    'yogu55551',
    'yogu.55551',
    'yogu3443',
    'madhosh901',
   // 'yogu11122',
    'yogu5_4827',
    'yogu54827', 
    'yogu_54827',
    'yogu.54827',
    'yogu99990',
    'yogu.5969',
    'yogu59697',
    'yogu_59697',
    'yogu5.4827'
    // Add more usernames here...
];

// Constant password
const PASSWORD = 'y@70164';

// Websites to automate

// List of all 13 websites
const WEBSITES = [
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
    'https://takipcizen.com/login'   ,
     'https://takipcikrali.com/login'   ,
      'https://takipcitime.net/login',


];

async function getInstagramPosts(targetUsername) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const posts = [];

    const DEFAULT_POSTS = [
        'https://www.instagram.com/reel/DVtNdQUE7ZV/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==',
        'https://www.instagram.com/p/Da7LhtLE7Dx/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==',
        'https://www.instagram.com/reel/DaqLI21Ie6P/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==',
        'https://www.instagram.com/p/DYMiiUoiFJ5/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==',
        'https://www.instagram.com/reel/DWUHJRBiJdx/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==',
        'https://www.instagram.com/reel/DVBX2SdEwws/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==',
        'https://www.instagram.com/reel/DWg9XR5DWT3/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA=='
    ];

    try {
        const instagramUrl = `https://www.instagram.com/${targetUsername}/`;
        console.log(`📸 Getting posts for ${targetUsername}: ${instagramUrl}`);

        await page.goto(instagramUrl, { timeout: 1000 });
        await page.waitForSelector('article a', { timeout: 1000 });

        let postLinks = new Set();
        const MAX_POSTS = 7;

        while (postLinks.size < MAX_POSTS) {
            const links = await page.$$eval('article a', anchors =>
                anchors.map(a => a.href).filter(href => href.includes('/p/') || href.includes('/reel/'))
            );
            links.forEach(link => postLinks.add(link));

            if (postLinks.size >= MAX_POSTS) break;

            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            await page.waitForTimeout(1000);
        }

        posts.push(...Array.from(postLinks).slice(0, MAX_POSTS));
        console.log(`✅ Found ${posts.length} posts for ${targetUsername}`);
    } catch (error) {
        console.error(`❌ Error getting Instagram posts for ${targetUsername}:`, error.message);
        posts.push(...DEFAULT_POSTS);
        console.log(`⚠️ Using default post links instead`);
    } finally {
        await browser.close();
    }

    return posts;
}


// Automate individual website
async function automateWebsite(siteUrl, username, password, postLink) {
    const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
    page.setDefaultTimeout(60000);

    try {
        console.log(`🚀 Processing: ${siteUrl} for user ${username}`);
        await page.goto(siteUrl);

        // Login
        console.log(`🔐 Logging in as ${username}...`);
        const usernameSelectors = ['#username', 'input[name="username"]', 'input[type="text"]'];
        const passwordSelectors = ['input[name="password"]', 'input[type="password"]'];
        
        // Try username fields
        for (const selector of usernameSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 5000 });
                await page.fill(selector, username);
                break;
            } catch (error) {
                continue;
            }
        }

        // Try password fields
        for (const selector of passwordSelectors) {
            try {
                await page.waitForSelector(selector, { timeout: 5000 });
                await page.fill(selector, password);
                break;
            } catch (error) {
                continue;
            }
        }

        // Login button
        const loginButtons = ['#login_insta', 'button[type="submit"]'];
        for (const selector of loginButtons) {
            try {
                await page.click(selector);
                break;
            } catch (error) {
                continue;
            }
        }

        // Wait for login
        await page.waitForTimeout(5000);

        // Close popup if exists
        try {
            await page.click('button.close', { timeout: 2000 });
        } catch (error) {
            // Popup not found, continue
        }

        // Send likes
        console.log('❤️ Sending likes...');
        try {
            await page.click('a[href="/tools/send-like"]', { timeout: 10000 });
            await page.fill('input[name="mediaUrl"]', postLink);
            await page.click('button:has-text("Gönderiyi Bul")');
            await page.waitForTimeout(3000);
            await page.fill('input[name="adet"]', '5000');
            await page.click('#formBegeniSubmitButton');
            await page.waitForTimeout(3000);
        } catch (error) {
            console.log('❌ Likes failed:', error.message);
        }

        // Send followers
        console.log('👥 Sending followers...');
        try {
            await page.click('a[href="/tools/send-follower"]', { timeout: 10000 });
            await page.fill('input[name="username"]', 'dadaji_furniture_vadodara');
            await page.click('button:has-text("Kullanıcıyı Bul")');
            await page.waitForTimeout(3000);
            await page.fill('input[name="adet"]', '49999');
            await page.click('#formTakipSubmitButton');
            await page.waitForTimeout(3000);
        } catch (error) {
            console.log('❌ Followers failed:', error.message);
        }


//         console.log('💬 Sending comments...');
// try {
//     // Navigate to the comment tool page
//     await page.click('a[href="/tools/send-comment"]', { timeout: 10000 });

//     // Fill in the Instagram post URL
//     await page.fill('input[name="mediaUrl"]', postLink);
//     await page.click('button:has-text("Gönderiyi Bul")');
//     await page.waitForTimeout(3000);

//     // Fill in multiple comment inputs
//     const comments = [
//         'Contact me',
//         'Mobile Number ?',
//         '🔥🔥🔥🔥 #dadajipvcfurniture',
//         '👌👌👌 #pvc_furniture',
//         '🔥'
//     ];

//      const commentInputs = await page.locator('input[name="yorum[]"]').elementHandles();

//     for (let i = 0; i < comments.length && i < commentInputs.length; i++) {
//         await commentInputs[i].fill(comments[i]);
//     }


//     // Submit the comment form
//     await page.click('#formYorumSubmitButton');
//     await page.waitForTimeout(30000);
// } catch (error) {
//     console.log('❌ Comments failed:', error.message);
// }

        console.log(`✅ Completed: ${siteUrl} for user ${username}`);

    } catch (error) {
        console.error(`❌ Failed: ${siteUrl} for user ${username} - ${error.message}`);
        throw error;
    } finally {
        await browser.close();
    }
}

// Process one username across all websites
async function processUsername(username) {
    console.log(`\n🎯 STARTING PROCESS FOR USERNAME: ${username}`);
    console.log('=' .repeat(50));
    
    try {
        // Step 1: Get Instagram posts
        const posts = await getInstagramPosts(username);
        
        if (posts.length === 0) {
            console.log(`❌ No posts found for ${username}, skipping...`);
            return;
        }

        console.log(`📸 Using ${posts.length} posts for automation`);

        // Step 2: Process each website with posts in rotation
        let completed = 0;
        const total = WEBSITES.length;
        let currentPostIndex = 0;
        
        for (let i = 0; i < WEBSITES.length; i++) {
            const website = WEBSITES[i];
            const currentPost = posts[currentPostIndex];
            
            console.log(`\n🌐 Processing website ${i+1}/${total}: ${website}`);
            console.log(`📝 Using post: ${currentPost}`);

            try {
                await automateWebsite(website, username, PASSWORD, currentPost);
                completed++;
                console.log(`✅ Progress: ${completed}/${total} websites completed`);

            } catch (error) {
                completed++;
                console.error(`❌ Failed: ${website} - ${error.message}`);
            }

            // Move to next post (cycle through posts)
            currentPostIndex = (currentPostIndex + 1) % posts.length;
            
            // Delay between websites
            console.log('⏳ Waiting 3 seconds before next website...');
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        console.log(`\n🎉 COMPLETED: Processed ${completed}/${total} websites for ${username}`);

    } catch (error) {
        console.error(`💥 CRITICAL ERROR for ${username}:`, error.message);
    }
}

// Main infinite loop function
async function startInfiniteLoop() {
    console.log('♾️ STARTING INFINITE LOOP AUTOMATION');
    console.log(`👥 Total usernames: ${USERNAMES.length}`);
    console.log(`🌐 Total websites: ${WEBSITES.length}`);
    console.log('=' .repeat(50));
    
    let cycleCount = 0;
    
    // Infinite loop
    while (true) {
        cycleCount++;
        console.log(`\n🔄 CYCLE ${cycleCount} STARTING...`);
        console.log('=' .repeat(50));
        
        for (let i = 0; i < USERNAMES.length; i++) {
            const username = USERNAMES[i];
            console.log(`\n👤 Processing username ${i+1}/${USERNAMES.length}: ${username}`);
            
            await processUsername(username);
            
            // Delay between usernames (except after the last one)
            if (i < USERNAMES.length - 1) {
                console.log('\n⏳ Waiting 5 seconds before next username...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        console.log(`\n✅ COMPLETED CYCLE ${cycleCount}`);
        console.log('🔄 Restarting from first username...');
        console.log('=' .repeat(50));
        
        // Longer delay between cycles
        console.log('⏳ Waiting 10 seconds before next cycle...');
        await new Promise(resolve => setTimeout(resolve, 10000));
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Received shutdown signal. Stopping automation...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received termination signal. Stopping automation...');
    process.exit(0);
});

// Start the infinite loop
startInfiniteLoop().catch(console.error);