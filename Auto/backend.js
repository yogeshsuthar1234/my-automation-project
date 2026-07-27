const express = require('express');
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Store for progress updates
let clients = [];

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start automation endpoint
app.post('/start-automation', async (req, res) => {
    const { username, password, websites } = req.body;

    // Validate input
    if (!username) {
        return res.status(400).json({ error: 'Username is required' });
    }

    // Execute the automation
    executeAutomation(username, password || 'y@70164', websites);

    res.json({ message: 'Automation started' });
});

// Progress updates endpoint (Server-Sent Events)
app.get('/progress', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const clientId = Date.now();
    const newClient = {
        id: clientId,
        res
    };
    clients.push(newClient);

    req.on('close', () => {
        clients = clients.filter(client => client.id !== clientId);
    });
});

// Function to broadcast messages to all clients
function broadcast(message) {
    clients.forEach(client => {
        client.res.write(`data: ${JSON.stringify(message)}\n\n`);
    });
}

// Get latest posts from Instagram
async function getInstagramPosts(targetUsername) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const posts = [];

    try {
        const instagramUrl = `https://www.instagram.com/dadaji_furniture_vadodara/`;
        console.log(`📸 Getting posts from: ${instagramUrl}`);
        
        await page.goto(instagramUrl, { timeout: 60000 });
        await page.waitForSelector('article a', { timeout: 60000 });

        // Scroll to load more posts
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
        console.log(`✅ Found ${posts.length} posts:`, posts);

    } catch (error) {
        console.error('❌ Error getting Instagram posts:', error);
    } finally {
        await browser.close();
    }

    return posts;
}

// Main automation function
async function executeAutomation(username, password, websites) {
    let completed = 0;
    const total = websites.length;
    
    try {
        // Step 1: Get Instagram posts
        broadcast({ type: 'info', message: 'Finding latest Instagram posts...' });
        const posts = await getInstagramPosts(username);
        
        if (posts.length === 0) {
            broadcast({ type: 'error', message: 'No posts found on Instagram profile' });
            return;
        }

        broadcast({ 
            type: 'posts_found', 
            message: `Found ${posts.length} posts`,
            posts: posts 
        });

        // Step 2: Process each website with all posts in loop
        let currentPostIndex = 0;
        
        for (let i = 0; i < websites.length; i++) {
            const website = websites[i];
            const currentPost = posts[currentPostIndex];
            
            // Update progress
            broadcast({
                type: 'progress',
                completed: completed,
                total: total,
                currentWebsite: {
                    url: website,
                    status: 'running',
                    currentPost: currentPost
                }
            });

            try {
                await automateWebsite(website, username, password, currentPost);
                completed++;
                
                broadcast({
                    type: 'progress',
                    completed: completed,
                    total: total,
                    currentWebsite: {
                        url: website,
                        status: 'completed',
                        currentPost: currentPost
                    }
                });

                console.log(`✅ Completed: ${website} with post: ${currentPost}`);

            } catch (error) {
                completed++;
                console.error(`❌ Failed: ${website} - ${error.message}`);
                
                broadcast({
                    type: 'progress',
                    completed: completed,
                    total: total,
                    currentWebsite: {
                        url: website,
                        status: 'failed',
                        error: error.message
                    }
                });
            }

            // Move to next post (cycle through posts)
            currentPostIndex = (currentPostIndex + 1) % posts.length;
            
            // Delay between websites
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // Final completion
        broadcast({
            type: 'complete',
            total: total,
            completed: completed,
            message: `Automation completed! Processed ${completed}/${total} websites.`
        });

    } catch (error) {
        console.error('❌ Automation failed:', error);
        broadcast({
            type: 'error',
            message: `Automation failed: ${error.message}`
        });
    }
}

// Automate individual website
async function automateWebsite(siteUrl, username, password, postLink) {
    const browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);

    try {
        console.log(`🚀 Processing: ${siteUrl}`);
        await page.goto(siteUrl);

        // Login
        console.log('🔐 Logging in...');
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

        console.log(`✅ Completed: ${siteUrl}`);

    } catch (error) {
        console.error(`❌ Failed: ${siteUrl} - ${error.message}`);
        throw error;
    } finally {
        await browser.close();
    }
}

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📱 Open this URL in your browser to access the automation tool`);
});