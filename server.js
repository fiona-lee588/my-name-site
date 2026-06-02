require('dotenv').config();
// My Chinese Name - API DeepSeek 

const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const paypal = require('paypal-rest-sdk');
const app = express();
app.set('trust proxy', 1);
const port = process.env.PORT || 3000;

// ============================================================
// .env 
// ============================================================
const IS_PROD = process.env.NODE_ENV === 'production';
const DOMAIN = process.env.DOMAIN || (IS_PROD ? 'https://mychinesename.co' : ` , , , : + + + `);
const CORS_ORIGIN = process.env.CORS_ORIGIN || (IS_PROD ? 'https://mychinesename.co' : '*');
const LOG_LEVEL = process.env.LOG_LEVEL || (IS_PROD ? 'error' : 'debug');

// 
const log = (...args) => { if(!IS_PROD) console.log(...args); };
const logError = (...args) => { console.error(...args); };

log("DeepSeek ", !!process.env.DEEPSEEK_API_KEY);
log("PayPal ", process.env.PAYPAL_MODE || 'sandbox');
log("PayPal_CLIENT_ID ", !!process.env.PAYPAL_CLIENT_ID);
log("PayPal_CLIENT_SECRET ", !!process.env.PAYPAL_CLIENT_SECRET);
log(" ", DOMAIN);

// ============================================================
// CORS 
// ============================================================
app.use(cors({
 origin: process.env.CORS_ORIGIN,
 methods: ['GET', 'POST', 'OPTIONS'],
 allowedHeaders: ['Content-Type'],
 credentials: true
}));
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

// ============================================================
// API /api 60 60 
// ============================================================
const apiLimiter = rateLimit({
 windowMs: 60 * 1000,
 max: 60,
 standardHeaders: true,
 legacyHeaders: false,
 message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', apiLimiter);

// ============================================================
// IP + 
// ============================================================

// IP Redis 
const ipCounts = new Map(); // IP -> { count, resetAt }
const ipBlocked = new Map(); // IP -> unblockAt

// API IP N 
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 
const RATE_LIMIT_MAX = IS_PROD ? 5 : 20; // 5 20 

// 5 
setInterval(() => {
 const now = Date.now();
 for(const [ip, data] of ipCounts) {
 if(data.resetAt <= now) ipCounts.delete(ip);
 }
 for(const [ip, until] of ipBlocked) {
 if(until <= now) ipBlocked.delete(ip);
 }
}, 5 * 60 * 1000);

function getClientIp(req) {
 return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
 .split(',')[0].trim();
}

function rateLimitMiddleware(req, res, next) {
 const ip = getClientIp(req);
 const now = Date.now();

 // IP
 if(ipBlocked.has(ip) && ipBlocked.get(ip) > now) {
 return res.status(429).json({ error: 'Too many requests, please try again later.' });
 }

 const record = ipCounts.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
 record.count++;
 if(record.resetAt <= now) {
 record.count = 1;
 record.resetAt = now + RATE_LIMIT_WINDOW_MS;
 }
 ipCounts.set(ip, record);

 // 10 
 if(record.count > RATE_LIMIT_MAX) {
 ipBlocked.set(ip, now + 10 * 60 * 1000);
 ipCounts.delete(ip);
 logError(` , , , : + + + `);
 return res.status(429).json({ error: 'Too many requests, please try again later.' });
 }

 next();
}

// 
app.use((req, res, next) => {
 if(!IS_PROD) {
 const ip = getClientIp(req);
 log(` , , , : + + + `);
 }
 next();
});

// ============================================================
// PayPal .env 
// ============================================================
// PayPal REST API .env live/sandbox 
// ============================================================
paypal.configure({
 mode: process.env.PAYPAL_MODE || 'sandbox',
 client_id: process.env.PAYPAL_CLIENT_ID,
 client_secret: process.env.PAYPAL_CLIENT_SECRET
});

// ============================================================
// 
// ============================================================
const PACKAGE_ENTITLEMENTS = {
 basic: { quota: 3, wuxingLevel: 'basic', culturalDepth: false, certificate: false, avatarGeneration: 0, regeneration: 1 },
 premium: { quota: 5, wuxingLevel: 'full', culturalDepth: true, certificate: true, avatarGeneration: 1, regeneration: 999 },
 ultimate: { quota: 9999, wuxingLevel: 'full', culturalDepth: true, certificate: true, avatarGeneration: 999, regeneration: 999 }
};

// ============================================================
// 
// ============================================================
const USER_STATE_FILE = path.join(__dirname, 'user-state.json');
const PAYMENT_LOG_FILE = path.join(__dirname, 'payment-log.json');

// ============================================================
// 
// ============================================================
function readUserState(){
 try {
 if(!fs.existsSync(USER_STATE_FILE)) return {};
 return JSON.parse(fs.readFileSync(USER_STATE_FILE, 'utf8'));
 } catch { return {}; }
}
function writeUserState(state){
 fs.writeFileSync(USER_STATE_FILE, JSON.stringify(state, null, 2));
}

function readPaymentLog(){
 try {
 if(!fs.existsSync(PAYMENT_LOG_FILE)) return [];
 return JSON.parse(fs.readFileSync(PAYMENT_LOG_FILE, 'utf8'));
 } catch { return []; }
}
function writePaymentLog(logs){ fs.writeFileSync(PAYMENT_LOG_FILE, JSON.stringify(logs, null, 2)); }
function appendPaymentLog(entry){
 const logs = readPaymentLog();
 logs.push({ ...entry, _ts: new Date().toISOString() });
 if(logs.length > 500) logs.splice(0, logs.length - 500);
 writePaymentLog(logs);
}

// ============================================================
// ID + 
// ============================================================
function getUserId(req){
 return req.headers['x-user-id']
 || (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function unlockPackage(userId, pkg, transactionId){
 const ent = PACKAGE_ENTITLEMENTS[pkg];
 if(!ent) return false;
 const state = readUserState();
 const user = state[userId] || { quota: 2, package: 'free' };
 Object.assign(user, {
 package: pkg, quota: ent.quota, wuxingLevel: ent.wuxingLevel,
 culturalDepth: ent.culturalDepth, certificate: ent.certificate,
 avatarGeneration: ent.avatarGeneration,
 transactionId: transactionId || '', paidAt: new Date().toISOString()
 });
 state[userId] = user;
 writeUserState(state);
 log(` , , , : + + + `);
 return true;
}

function getUserStatus(userId){
 const state = readUserState();
 const user = state[userId] || { quota: 2, package: 'free' };
 return { quota: user.quota ?? 2, package: user.package || 'free', wuxingLevel: user.wuxingLevel || 'basic' };
}

function useQuota(userId){
 const state = readUserState();
 const user = state[userId] || { quota: 2 };
 if(user.quota <= 0) return false;
 user.quota--;
 writeUserState(state);
 return true;
}

function addShareReward(userId){
 const state = readUserState();
 const user = state[userId] || { quota: 2 };
 user.quota = (user.quota || 0) + 1;
 writeUserState(state);
 return { success: true, quota: user.quota };
}

// ============================================================
// API 
// ============================================================

app.get('/api/quota', (req, res) => {
 res.json(getUserStatus(getUserId(req)));
});

app.get('/api/pricing', (req, res) => {
 res.json({
 packages: {
 basic: { price: 9.9, originalPrice: 19.9, label: ' Basic', badge: ' ' },
 premium: { price: 19.9, originalPrice: 39.9, label: ' Premium', badge: ' ' },
 ultimate: { price: 29.9, originalPrice: 59.9, label: ' VIP Ultimate', badge: ' ' }
 }
 });
});

app.post('/api/share-reward', (req, res) => {
 res.json(addShareReward(getUserId(req)));
});

// --------------------------------------------------------
// PayPal REST API 
// --------------------------------------------------------
app.post('/api/paypal-order', (req, res) => {
 const { package: pkg } = req.body;
 if(!PACKAGE_ENTITLEMENTS[pkg]) return res.status(400).json({ error: 'Unknown package' });

 const amounts = { basic:'9.9', premium:'19.9', ultimate:'29.9' };
 const pkgNames = { basic:'Basic Plan', premium:'Premium Plan', ultimate:'Ultimate VIP' };
 const amount = amounts[pkg];
 const domain = process.env.DOMAIN || 'http://localhost:3000';

 const payment = {
 intent: 'sale',
 payer: { payment_method: 'paypal' },
 redirect_urls: {
 return_url: `${domain}/payment-success.html?package=${pkg}`,
 cancel_url: `${domain}/payment-cancel.html`
 },
 transactions: [{
 amount: { total: amount, currency: 'USD' },
 description: `MyChineseName - ${pkgNames[pkg]} ($ ${amount})`,
 custom: pkg
 }]
 };

 paypal.payment.create(payment, (error, result) => {
 if(error) {
 logError('PayPal payment create error:', error.message);
 return res.status(500).json({ error: 'Payment creation failed', detail: error.message });
 }
 const approvalUrl = result.links.find(l => l.rel === 'approval_url');
 if(!approvalUrl) return res.status(500).json({ error: 'No approval URL' });
 res.json({ paypalUrl: approvalUrl.href });
 });
});

// --------------------------------------------------------
// PayPal IPN + 
// --------------------------------------------------------
app.post('/api/paypal-ipn', express.urlencoded({ extended: false }), async (req, res) => {
 const ipn = req.body;
 log(` , , , : + + + `);

 if(!ipn.txn_id || !ipn.payment_status) {
 appendPaymentLog({ err: 'Missing required fields', ipn: JSON.stringify(ipn).substring(0,200) });
 return res.status(400).send('Missing required fields');
 }

 if(ipn.payment_status !== 'Completed') {
 appendPaymentLog({ status: ipn.payment_status, txn: ipn.txn_id, err: 'Payment not completed' });
 return res.send('ok');
 }

 // REST API custom 
 const pkg = ipn.custom || 'basic';
 const userId = ipn.custom || getUserId(req);

 // === IPN email .env ===
 const paypalEmail = process.env.PAYPAL_EMAIL || '';
 if(paypalEmail && ipn.receiver_email && ipn.receiver_email.toLowerCase() !== paypalEmail.toLowerCase()) {
 appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: ` , , , : + + + ` });
 logError(` , , , : + + + `);
 return res.send('ok');
 }

 // USD 
 if(ipn.mc_currency !== 'USD') {
 appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: ` , , , : + + + ` });
 logError(` , , , : + + + `);
 return res.send('ok');
 }

 // 
 const expected = { basic:'9.90', premium:'19.90', ultimate:'29.90' };
 if(ipn.mc_gross !== expected[pkg]) {
 appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: ` , , , : + + + ` });
 logError(` , , , : + + + `);
 return res.send('ok');
 }

 // 
 try {
 unlockPackage(userId, pkg, ipn.txn_id);
 appendPaymentLog({ status: ipn.payment_status, txn: ipn.txn_id, userId, pkg, success: true });
 log(` , , , : + + + `);
 } catch(err) {
 appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: err.message });
 logError(` , , , : + + + `);
 }

 res.send('ok');
});

// --------------------------------------------------------
// PayPal 
// --------------------------------------------------------
app.post('/api/paypal-checkout', (req, res) => {
 const { transactionId, pkg, userId: reqUserId } = req.body;
 if(!transactionId) return res.status(400).json({ success: false });
 const userId = reqUserId || getUserId(req);
 const state = readUserState();
 const user = state[userId] || { quota: 2, package: 'free' };
 user.package = pkg || user.package;
 user.transactionId = transactionId;
 user.quota = PACKAGE_ENTITLEMENTS[pkg]?.quota || 9999;
 writeUserState(state);
 log(` , , , : + + + `);
 res.json({ success: true });
});

// --------------------------------------------------------
// 
// --------------------------------------------------------
app.get('/admin-payment-log', (req, res) => {
 fs.readFile(PAYMENT_LOG_FILE, 'utf8', (err, data) => {
 if(err) return res.send(' ');
 const logs = JSON.parse(data);
 const html = ` , , , : + + + ` + logs.map(l => `<tr style="background:${l.success?'#f0fff0':'#fff0f0'}">
 <td>${l._ts||''}</td><td>${l.txn||''}</td><td>${l.pkg||''}</td><td>${l.userId||''}</td><td>${l.status||''}</td><td>${l.err||(l.success?' ':' ')}</td>
 </tr>`).join('');
 res.send(html);
 });
});

// ============================================================
// API DeepSeek 
// rateLimitMiddleware 
// ============================================================
app.post('/api/generate-name', rateLimitMiddleware, async (req, res) => {
 const { englishName, englishSurname, gender, birthYear, birthMonth, birthDay, birthTime, style, meaning } = req.body;
 // givenName englishName, surname englishSurname
 const givenName = req.body.givenName || englishName;
 const surname = req.body.surname || englishSurname;
 // birthDate birthYear/Month/Day
 const bd = req.body.birthDate || '';
 const by = req.body.birthYear || (bd.match(/^(\d{4})/)?.[1]) || birthYear;
 const bm = req.body.birthMonth || (bd.match(/[-/](\d{1,2})/)?.[1]) || birthMonth;
 const bd2 = req.body.birthDay || (bd.match(/[-/](\d{1,2})[-/](\d{1,2})/)?.[2]) || birthDay;
 const finalEnglishName = givenName;
 const finalEnglishSurname = surname;

 // 
 if (!finalEnglishName || !finalEnglishSurname) {
 return res.status(400).json({ error: 'englishName and englishSurname are required' });
 }
 if (typeof finalEnglishName !== 'string' || typeof finalEnglishSurname !== 'string' ||
 finalEnglishName.length > 50 || finalEnglishSurname.length > 50) {
 return res.status(400).json({ error: 'Invalid name length' });
 }
 // gender " "/" " 
 if (gender && typeof gender === 'string') {
 if (!gender.includes(' ') && !gender.includes(' ')) {
 return res.status(400).json({ error: 'gender must contain or ' });
 }
 }

 const userId = getUserId(req);
 const status = getUserStatus(userId);

 // 
 if(status.package === 'free' || !status.package) {
 if(!useQuota(userId)) {
 return res.status(402).json({ error: 'quota exhausted', showPaywall: true });
 }
 }

 const prompt = ` , , , : + + + `;

 const deepseek = { url:'https://api.deepseek.com/v1/chat/completions', model: "deepseek-chat" };

 async function callAI(retryCount = 0) {
 const MAX_RETRIES = 2;
 if(retryCount > MAX_RETRIES) throw new Error('Max retries exceeded');
 const body = { model: deepseek.model, messages:[{role:'user',content:prompt}], temperature:0.7 };
 const controller = new AbortController();
 const timeout = setTimeout(() => controller.abort(), 12000);
 try {
 const resp = await fetch(deepseek.url, {
 method:'POST', signal:controller.signal,
 headers: {'Content-Type':'application/json','Authorization':`Bearer ${process.env.DEEPSEEK_API_KEY}`},
 body: JSON.stringify(body)
 });
 clearTimeout(timeout);
 const data = await resp.json();
 if(!resp.ok) {
 logError(` , , , : + + + `, JSON.stringify(data).substring(0,100));
 if(retryCount < MAX_RETRIES) return callAI(retryCount + 1);
 throw new Error(data.error?.message || ` , , , : + + + `);
 }
 return data.choices[0].message.content;
 } catch(err) {
 clearTimeout(timeout);
 logError(` , , , : + + + `, err.message);
 if(retryCount < MAX_RETRIES) return callAI(retryCount + 1);
 throw err;
 }
 }

 try {
 log(` , , , : + + + `);
 const result = await callAI('deepseek');
 res.send(result);
 } catch(err) {
 logError('=== AI ===', err.message);
 res.status(500).json({ error: ' ', message: err.message });
 }
});

// ============================================================
// 
// ============================================================
app.post('/api/submit-message', (req, res) => {
 const { name, email, message } = req.body;
 const time = new Date().toLocaleString();
 const content = ` , , , : + + + `;
 fs.appendFile('messages.txt', content, err => {
 res.send(err ? " " : " ");
 });
});

app.get('/admin-messages', (req, res) => {
 fs.readFile('messages.txt', 'utf8', (err, data) => {
 if(err) res.send(" ");
 else res.send(` , , , : + + + `);
 });
});

// ============================================================
// 
// ============================================================
app.get('/brand-intro', (req, res) => res.sendFile(path.join(__dirname, 'brand-intro.html')));
app.get('/contact-us', (req, res) => res.sendFile(path.join(__dirname, 'contact-us.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'privacy.html')));
app.get('/faq', (req, res) => res.sendFile(path.join(__dirname, 'faq.html')));
app.get('/payment-guide', (req, res) => res.sendFile(path.join(__dirname, 'payment-guide.html')));

// ============================================================
// 
// ============================================================
app.get('/api/avatar-svg', (req, res) => {
 const name = (req.query.name || ' ').replace(/[^ - ]/g, '').substring(0, 6);
 const fonts = [
 "ZCOOLKuaiLe, Ma Shan Zheng, STKaiti, KaiTi, serif",
 "Noto Serif SC, HanYiJianJian, STZhongsong, KaiTi, serif",
 "HanYiJianJian, STKaiti, KaiTi, serif",
 "cwTeXMing, ZCOOLKuaiLe, KaiTi, serif"
 ];
 const bg = [{type:'solid',colors:['#fdf6e9','#e8d5b0']},{type:'paper',colors:['#f5f0e6','#d4c4a8']},{type:'inkwash',colors:['#f0ebe0','#c8b896']},{type:'cloud',colors:['#f7f2e3','#e0d2b0']},{type:'window',colors:['#f5ede0','#d9c9a8']}];
 const font = fonts[Math.floor(Math.random() * fonts.length)];
 const b = bg[Math.floor(Math.random() * bg.length)];
 const gradId = 'bg' + Date.now();
 const bgDef = b.type === 'solid'
 ? ` , , , : + + + `
 : ` , , , : + + + `;
 const svg = ` , , , : + + + `;
 res.type('image/svg+xml').send(svg);
});

// ============================================================
// 
// ============================================================
app.use((err, req, res, next) => {
 if (!IS_PROD) {
 console.error(err.stack);
 }
 res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// favicon.ico 
// ============================================================
app.use(express.static(path.join(__dirname, "./")));

// ============================================================
// 404 
// ============================================================
app.use((req, res) => {
 res.status(404).json({ error: 'Not found' });
});

// ============================================================
// 
// ============================================================
app.listen(port, () => {
 console.log(` , , , : + + + `);
 if(IS_PROD) console.log(' 5 / ');
});