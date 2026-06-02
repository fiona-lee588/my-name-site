require('dotenv').config();
// My Chinese Name - 中文起名服务后端 API，支持 DeepSeek 单引擎起名

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
// 环境配置（全部从 .env 读取，禁止硬编码）
// ============================================================
const IS_PROD     = process.env.NODE_ENV === 'production';
const DOMAIN      = process.env.DOMAIN   || (IS_PROD ? 'https://mychinesename.co' : `你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`);
const CORS_ORIGIN = process.env.CORS_ORIGIN || (IS_PROD ? 'https://mychinesename.co' : '*');
const LOG_LEVEL   = process.env.LOG_LEVEL || (IS_PROD ? 'error' : 'debug');

// 仅在非正式环境输出启动日志
const log = (...args) => { if(!IS_PROD) console.log(...args); };
const logError = (...args) => { console.error(...args); };

log("DeepSeek密钥：", !!process.env.DEEPSEEK_API_KEY);
log("PayPal模式：", process.env.PAYPAL_MODE || 'sandbox');
log("PayPal_CLIENT_ID：", !!process.env.PAYPAL_CLIENT_ID);
log("PayPal_CLIENT_SECRET：", !!process.env.PAYPAL_CLIENT_SECRET);
log("网站域名：", DOMAIN);

// ============================================================
// CORS 配置
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
// API 全局限流（/api 路径，60秒内最多60次）
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
// 安全中间件：IP 限流 + 频率限制（精细化）
// ============================================================

// IP 请求计数（内存中简单计数，生产环境建议用 Redis）
const ipCounts = new Map();          // IP -> { count, resetAt }
const ipBlocked = new Map();          // IP -> unblockAt

// 起名API专属限流：每个IP每分钟最多 N 次
const RATE_LIMIT_WINDOW_MS = 60 * 1000;  // 1分钟窗口
const RATE_LIMIT_MAX = IS_PROD ? 5 : 20;   // 每窗口最大请求数（正式环境5次，开发环境20次）

// 清理过期记录的定时器（每5分钟清理一次）
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

    // 被临时拦截的IP
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

    // 超过阈值则临时封禁10分钟
    if(record.count > RATE_LIMIT_MAX) {
        ipBlocked.set(ip, now + 10 * 60 * 1000);
        ipCounts.delete(ip);
        logError(`你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`);
        return res.status(429).json({ error: 'Too many requests, please try again later.' });
    }

    next();
}

// 通用请求日志（仅非正式环境）
app.use((req, res, next) => {
    if(!IS_PROD) {
        const ip = getClientIp(req);
        log(`你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`);
    }
    next();
});

// ============================================================
// PayPal 配置（从 .env 读取）
// ============================================================
// PayPal REST API 配置（从 .env 读取，live/sandbox 自动切换）
// ============================================================
paypal.configure({
    mode: process.env.PAYPAL_MODE || 'sandbox',
    client_id: process.env.PAYPAL_CLIENT_ID,
    client_secret: process.env.PAYPAL_CLIENT_SECRET
});

// ============================================================
// 套餐权益表（全部从后端读取，前端禁止硬编码）
// ============================================================
const PACKAGE_ENTITLEMENTS = {
    basic:    { quota: 3,    wuxingLevel: 'basic', culturalDepth: false, certificate: false, avatarGeneration: 0,  regeneration: 1  },
    premium:  { quota: 5,    wuxingLevel: 'full',  culturalDepth: true,  certificate: true,  avatarGeneration: 1,  regeneration: 999 },
    ultimate: { quota: 9999, wuxingLevel: 'full',  culturalDepth: true,  certificate: true,  avatarGeneration: 999, regeneration: 999 }
};

// ============================================================
// 文件路径
// ============================================================
const USER_STATE_FILE = path.join(__dirname, 'user-state.json');
const PAYMENT_LOG_FILE = path.join(__dirname, 'payment-log.json');

// ============================================================
// 状态读写
// ============================================================
function readUserState(){
    try {
        if(!fs.existsSync(USER_STATE_FILE)) return {};
        return JSON.parse(fs.readFileSync(USER_STATE_FILE, 'utf8'));
    } catch { return {}; }
}

// ============================================================
// 输入清洗（过滤非ASCII可见字符 \x20-\x7E）
// ============================================================
function cleanStr(str){
    if(typeof str !== 'string') return str;
    return str.replace(/[^\x20-\x7E]/g, '').trim();
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
// 用户ID + 解锁
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
    log(`你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`);
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
// API路由
// ============================================================

app.get('/api/quota', (req, res) => {
    res.json(getUserStatus(getUserId(req)));
});

app.get('/api/pricing', (req, res) => {
    res.json({
        packages: {
            basic:    { price: 9.9,  originalPrice: 19.9, label: '基础版 Basic',     badge: '限时特惠'  },
            premium:  { price: 19.9, originalPrice: 39.9, label: '尊享版 Premium',    badge: '最受欢迎'  },
            ultimate: { price: 29.9, originalPrice: 59.9, label: '至尊VIP Ultimate', badge: '终极特惠'  }
        }
    });
});

app.post('/api/share-reward', (req, res) => {
    res.json(addShareReward(getUserId(req)));
});

// --------------------------------------------------------
// PayPal 支付请求（REST API 正式版）
// --------------------------------------------------------
app.post('/api/paypal-order', (req, res) => {
    const pkg = cleanStr(req.body.package) || cleanStr(req.body.pkg);
    if(!pkg || !PACKAGE_ENTITLEMENTS[pkg]) return res.status(400).json({ error: 'Unknown package' });

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
// PayPal IPN（官方异步通知 + 三层安全校验）
// --------------------------------------------------------
app.post('/api/paypal-ipn', express.urlencoded({ extended: false }), async (req, res) => {
    const ipn = req.body;
    log(`你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`);

    if(!ipn.txn_id || !ipn.payment_status) {
        appendPaymentLog({ err: 'Missing required fields', ipn: JSON.stringify(ipn).substring(0,200) });
        return res.status(400).send('Missing required fields');
    }

    if(ipn.payment_status !== 'Completed') {
        appendPaymentLog({ status: ipn.payment_status, txn: ipn.txn_id, err: 'Payment not completed' });
        return res.send('ok');
    }

    // 解析套餐（REST API 通过 custom 字段传递）
    const pkg = ipn.custom || 'basic';
    const userId = ipn.custom || getUserId(req);

    // === 三层安全校验（IPN 异步通知校验，email 从 .env 读取）===
    const paypalEmail = process.env.PAYPAL_EMAIL || '';
    if(paypalEmail && ipn.receiver_email && ipn.receiver_email.toLowerCase() !== paypalEmail.toLowerCase()) {
        appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: `你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析` });
        logError(`你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`);
        return res.send('ok');
    }

    // ② 币种校验（仅支持USD）
    if(ipn.mc_currency !== 'USD') {
        appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: `你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析` });
        logError(`你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`);
        return res.send('ok');
    }

    // ③ 金额校验
    const expected = { basic:'9.90', premium:'19.90', ultimate:'29.90' };
    if(ipn.mc_gross !== expected[pkg]) {
        appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: `你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析` });
        logError(`你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`);
        return res.send('ok');
    }

    // 通过全部校验，解锁套餐
    try {
        unlockPackage(userId, pkg, ipn.txn_id);
        appendPaymentLog({ status: ipn.payment_status, txn: ipn.txn_id, userId, pkg, success: true });
        log(`你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`);
    } catch(err) {
        appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: err.message });
        logError(`你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`);
    }

    res.send('ok');
});

// --------------------------------------------------------
// PayPal 同步回调
// --------------------------------------------------------
app.post('/api/paypal-checkout', (req, res) => {
    const transactionId = cleanStr(req.body.transactionId);
    const pkg = cleanStr(req.body.package) || cleanStr(req.body.pkg);
    const reqUserId = cleanStr(req.body.userId);
    if(!transactionId) return res.status(400).json({ success: false });
    const userId = reqUserId || getUserId(req);
    const state = readUserState();
    const user = state[userId] || { quota: 2, package: 'free' };
    user.package = pkg || user.package;
    user.transactionId = transactionId;
    user.quota = PACKAGE_ENTITLEMENTS[pkg]?.quota || 9999;
    writeUserState(state);
    log(`你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`);
    res.json({ success: true });
});

// --------------------------------------------------------
// 异常订单日志查询
// --------------------------------------------------------
app.get('/admin-payment-log', (req, res) => {
    fs.readFile(PAYMENT_LOG_FILE, 'utf8', (err, data) => {
        if(err) return res.send('暂无支付日志');
        const logs = JSON.parse(data);
        const html = `你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析` + logs.map(l => `<tr style="background:${l.success?'#f0fff0':'#fff0f0'}">
        <td>${l._ts||''}</td><td>${l.txn||''}</td><td>${l.pkg||''}</td><td>${l.userId||''}</td><td>${l.status||''}</td><td>${l.err||(l.success?'✅成功':'❌失败')}</td>
        </tr>`).join('');
        res.send(html);
    });
});

// ============================================================
// 起名API（DeepSeek 唯一接口）
// 受 rateLimitMiddleware 保护
// ============================================================
app.post('/api/generate-name', rateLimitMiddleware, async (req, res) => {
    const { englishName, englishSurname, gender, birthYear, birthMonth, birthDay, birthTime, style, meaning } = req.body;
    // 兼容前端旧字段名 givenName→englishName, surname→englishSurname
    const givenName = cleanStr(req.body.givenName) || cleanStr(englishName);
    const surname = cleanStr(req.body.surname) || cleanStr(englishSurname);
    // 兼容 birthDate 拆解为 birthYear/Month/Day
    const bd = cleanStr(req.body.birthDate) || '';
    const by = cleanStr(req.body.birthYear) || (bd.match(/^(\d{4})/)?.[1]) || cleanStr(birthYear);
    const bm = cleanStr(req.body.birthMonth) || (bd.match(/[-/](\d{1,2})/)?.[1]) || cleanStr(birthMonth);
    const bd2 = cleanStr(req.body.birthDay) || (bd.match(/[-/](\d{1,2})[-/](\d{1,2})/)?.[2]) || cleanStr(birthDay);
    const finalEnglishName = givenName;
    const finalEnglishSurname = surname;
    const finalGender = cleanStr(gender);
    const finalStyle = cleanStr(style);
    const finalMeaning = cleanStr(meaning);

    // 基础输入校验
    if (!finalEnglishName || !finalEnglishSurname) {
        return res.status(400).json({ error: 'englishName and englishSurname are required' });
    }
    if (typeof finalEnglishName !== 'string' || typeof finalEnglishSurname !== 'string' ||
        finalEnglishName.length > 50 || finalEnglishSurname.length > 50) {
        return res.status(400).json({ error: 'Invalid name length' });
    }
    // 兼容gender格式：自动识别中文"男"/"女"，忽略后续英文
    if (finalGender && !finalGender.includes('男') && !finalGender.includes('女')) {
        return res.status(400).json({ error: 'gender must contain 男 or 女' });
    }

    const userId = getUserId(req);
    const status = getUserStatus(userId);

    // 免费用户扣配额
    if(status.package === 'free' || !status.package) {
        if(!useQuota(userId)) {
            return res.status(402).json({ error: 'quota exhausted', showPaywall: true });
        }
    }

    const prompt = `你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`;

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
                logError(`你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`, JSON.stringify(data).substring(0,100));
                if(retryCount < MAX_RETRIES) return callAI(retryCount + 1);
                throw new Error(data.error?.message || `你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`);
            }
            return data.choices[0].message.content;
        } catch(err) {
            clearTimeout(timeout);
            logError(`你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`, err.message);
            if(retryCount < MAX_RETRIES) return callAI(retryCount + 1);
            throw err;
        }
    }

    try {
        log(`你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`);
        const result = await callAI('deepseek');
        res.send(result);
    } catch(err) {
        logError('===【AI起名全部失败】===', err.message);
        res.status(500).json({ error: '生成失败，请稍后重试', message: err.message });
    }
});

// ============================================================
// 留言板
// ============================================================
app.post('/api/submit-message', (req, res) => {
    const name = cleanStr(req.body.name) || 'anonymous';
    const email = cleanStr(req.body.email) || '';
    const message = cleanStr(req.body.message) || '';
    const time = new Date().toLocaleString();
    const content = `[${time}] ${name}(${email}): ${message}\n`;
    fs.appendFile('messages.txt', content, err => {
        res.send(err ? "留言提交失败" : "留言提交成功，感谢反馈！");
    });
});

app.get('/admin-messages', (req, res) => {
    fs.readFile('messages.txt', 'utf8', (err, data) => {
        if(err) res.send("暂无留言");
        else res.send(`你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`);
    });
});

// ============================================================
// 页面路由
// ============================================================
app.get('/brand-intro',      (req, res) => res.sendFile(path.join(__dirname, 'brand-intro.html')));
app.get('/contact-us',        (req, res) => res.sendFile(path.join(__dirname, 'contact-us.html')));
app.get('/terms',             (req, res) => res.sendFile(path.join(__dirname, 'terms.html')));
app.get('/privacy',           (req, res) => res.sendFile(path.join(__dirname, 'privacy.html')));
app.get('/faq',               (req, res) => res.sendFile(path.join(__dirname, 'faq.html')));
app.get('/payment-guide',     (req, res) => res.sendFile(path.join(__dirname, 'payment-guide.html')));

// ============================================================
// 书法头像（后端渲染兜底）
// ============================================================
app.get('/api/avatar-svg', (req, res) => {
    const name = (req.query.name || '李明').replace(/[^一-龥]/g, '').substring(0, 6);
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
        ? `你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`
        : `你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`;
    const svg = `你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`;
    res.type('image/svg+xml').send(svg);
});

// ============================================================
// 错误处理中间件（正式环境屏蔽报错栈）
// ============================================================
app.use((err, req, res, next) => {
    if (!IS_PROD) {
        console.error(err.stack);
    }
    res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// 静态文件服务（favicon.ico 等）
// ============================================================
app.use(express.static(path.join(__dirname, "./")));

// ============================================================
// 404 全局处理（静态文件之后）
// ============================================================
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// ============================================================
// 启动
// ============================================================
app.listen(port, () => {
    console.log(`你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`);
    if(IS_PROD) console.log('🔒 正式环境：调试日志已关闭，限流严格（5次/分钟）');
});