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
const DOMAIN      = process.env.DOMAIN   || (IS_PROD ? 'https://mychinesename.co' : 'http://localhost:3000');
const CORS_ORIGIN = process.env.CORS_ORIGIN || (IS_PROD ? 'https://mychinesename.co' : '*');
const LOG_LEVEL   = process.env.LOG_LEVEL || (IS_PROD ? 'error' : 'debug');

// 仅在非正式环境输出启动日志
const log = (...args) => { console.log(...args); };
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
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: true
}));
// helmet() 已移除 CSP
// app.use(helmet());
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
// 输入清洗（保留中文、ASCII可见字符，去除控制字符和特殊符号）
// ============================================================
function cleanStr(str){
    if(typeof str !== 'string') return str;
    return str.replace(/[\x00-\x1F\x7F]/g, '').trim();
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
    state[userId] = user;
    writeUserState(state);
    return true;
}

function addShareReward(userId){
    const state = readUserState();
    const user = state[userId] || { quota: 2 };
    user.quota = (user.quota || 0) + 1;
    state[userId] = user;
    writeUserState(state);
    return { success: true, quota: user.quota };
}

function isLocalDevTest(req){
    const host = (req.hostname || '').toLowerCase();
    const hostHeader = (req.get('host') || '').toLowerCase();
    const isLocalHost = host === 'localhost'
        || host === '127.0.0.1'
        || host === '::1'
        || hostHeader.startsWith('localhost:')
        || hostHeader.startsWith('127.0.0.1:')
        || hostHeader.startsWith('[::1]:');
    return isLocalHost && String(req.headers['x-dev-test']).toLowerCase() === 'true';
}

function extractJsonObject(text){
    if(!text || typeof text !== 'string') return null;
    const cleaned = text.trim()
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/i, '')
        .trim();
    try { return JSON.parse(cleaned); } catch {}

    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if(start === -1 || end === -1 || end <= start) return null;
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

function normalizeNameResult(raw){
    const parsed = extractJsonObject(raw) || {};
    const chineseName = cleanStr(parsed.chineseName || parsed.name || parsed.fullName || '') ||
        ((raw || '').match(/【完整中文姓名】：([^\n【]+)/)?.[1] || '').replace(/[^\u4e00-\u9fa5]/g, '');
    const pinyin = cleanStr(parsed.pinyin || '') ||
        ((raw || '').match(/【拼音】：([^\n【]+)/)?.[1] || '');
    const meaning = cleanStr(parsed.meaning || parsed.explanation || parsed.description || '') ||
        ((raw || '').match(/【寓意解析】：([\s\S]+)/)?.[1] || '');
    const sections = Array.isArray(parsed.sections)
        ? parsed.sections.map(section => ({
            titleCn: cleanStr(section.titleCn || section.title || ''),
            titleEn: cleanStr(section.titleEn || ''),
            cn: cleanStr(section.cn || section.chinese || ''),
            en: cleanStr(section.en || section.english || '')
        })).filter(section => section.titleCn || section.cn || section.en)
        : [];

    return {
        chineseName,
        pinyin,
        meaning,
        sections,
        raw: raw || ''
    };
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
            basic: {
                price: 9.9,
                originalPrice: 19.9,
                label: '基础版 Basic',
                badge: '限时特惠',
                features: [
                    { icon: '✅', text: '3组定制姓名 | 3 Sets of Custom Names' },
                    { icon: '✅', text: '基础五行解析 | Basic Five-Element Analysis' },
                    { icon: '✅', text: '不满意可重生成1次 | 1 Regeneration if Unsatisfied' },
                    { icon: '❌', text: '无完整典故深度溯源 | No Full In-depth Cultural Allusion Analysis' }
                ]
            },
            premium: {
                price: 19.9,
                originalPrice: 39.9,
                label: '尊享版 Premium',
                badge: '最受欢迎',
                features: [
                    { icon: '✅', text: '5组专属姓名 | 5 Sets of Exclusive Names' },
                    { icon: '✅', text: '完整八字五行解析 | Full Eight-Character & Five-Element Analysis' },
                    { icon: '✅', text: '诗经/楚辞完整典故溯源 | Full Source Trace from Book of Songs & Chu Ci' },
                    { icon: '✅', text: '高清可下载起名证书 | HD Downloadable Naming Certificate' },
                    { icon: '✅', text: '单次AI书法头像生成 | 1 AI Calligraphy Avatar Generation' }
                ]
            },
            ultimate: {
                price: 29.9,
                originalPrice: 59.9,
                label: '至尊VIP Ultimate',
                badge: '终极特惠',
                features: [
                    { icon: '✅', text: '不限次数起名生成 | Unlimited Name Generations' },
                    { icon: '✅', text: '一对一深度文化定制 | 1-on-1 In-depth Cultural Customization' },
                    { icon: '✅', text: '终身姓名档案保存 | Lifetime Name Record Storage' },
                    { icon: '⚠️', text: '仅限本人IP/设备使用 | For personal IP & device only' }
                ]
            }
        }
    });
});

app.get('/api/dev-test-status', (req, res) => {
    res.json({
        nodeEnv: process.env.NODE_ENV || '',
        isProd: IS_PROD,
        host: req.hostname || '',
        hostHeader: req.get('host') || '',
        xDevTest: req.headers['x-dev-test'] || '',
        devTest: isLocalDevTest(req)
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
    state[userId] = user;
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
    const by = cleanStr(req.body.birthYear) || (bd.match(/^(\d{4})/)?.[1]) || cleanStr(birthYear) || '';
    const bm = cleanStr(req.body.birthMonth) || (bd.match(/[-/](\d{1,2})/)?.[1]) || cleanStr(birthMonth) || '';
    const bd2 = cleanStr(req.body.birthDay) || (bd.match(/[-/](\d{1,2})[-/](\d{1,2})/)?.[2]) || cleanStr(birthDay) || '';
    const finalEnglishName = givenName;
    const finalEnglishSurname = surname;
    const finalGender = cleanStr(gender);
    // 性别提取：原始值不走cleanStr，直接识别英文Male/Female/中性
    const rawGender = gender || '';
    const genderDisplay = rawGender.toLowerCase().includes('female') ? 'Female' :
                        rawGender.toLowerCase().includes('male') ? 'Male' : '中性';
    const finalStyle = cleanStr(style);
    const finalMeaning = cleanStr(meaning);

    // 基础输入校验（englishName/surname 必填，meaning/style/gender 可空）
    if (!finalEnglishName || !finalEnglishSurname) {
        return res.status(400).json({ error: 'englishName and englishSurname are required' });
    }
    if (typeof finalEnglishName !== 'string' || typeof finalEnglishSurname !== 'string' ||
        finalEnglishName.length > 50 || finalEnglishSurname.length > 50) {
        return res.status(400).json({ error: 'Invalid name length' });
    }
    // gender 可空；识别英文 Male/Female，其余为中性 Neutral
    if (rawGender.trim().length > 0) {
        const g = rawGender.toLowerCase();
        if (!g.includes('male') && !g.includes('female')) {
            return res.status(400).json({ error: 'gender must be Male/Female' });
        }
    }
    // meaning/style 均可选，空值不拦截

    const userId = getUserId(req);
    const status = getUserStatus(userId);
    const devTest = isLocalDevTest(req);

    const shouldUseFreeQuota = !devTest && (status.package === 'free' || !status.package);

    // 免费用户先校验配额，生成成功后再扣减，避免AI失败也消耗次数。
    if(shouldUseFreeQuota) {
        if((status.quota || 0) <= 0) {
            return res.status(402).json({ error: 'quota exhausted', showPaywall: true });
        }
    }

    const prompt = `你是面向海外用户的中文起名师。起名规则固定不变，必须严格遵守：
1. 依据客户英文姓氏音译，在百家姓中匹配一个读音、气质或文化意象最贴近的中文姓氏；
2. 结合客户出生年月日时辰（${by||''}-${bm||''}-${bd2||''} ${cleanStr(birthTime)||''}）进行易经命理、阴阳五行、时辰气韵推演；
3. 从《诗经》《楚辞》《易经》及其他中国古籍中甄选名字用字；
4. 每个名字必须配套中文释义和英文释义，说明姓氏音译依据、命理取向、古籍出处与整体寓意；
5. 解释必须按固定结构输出：姓氏解释、名字解释、古籍出处、整体寓意，每一项都必须包含中文和英文。

客户信息：英文姓名 ${finalEnglishName} ${finalEnglishSurname}，性别 ${genderDisplay}，名字风格 ${finalStyle||'无'}，寓意偏好 ${finalMeaning||'无'}。
请生成一个适合海外用户长期使用的中文姓名。只返回JSON，不要Markdown代码块，不要额外说明。JSON格式:{"chineseName":"中文姓名","pinyin":"拼音","meaning":"简短总述","sections":[{"titleCn":"姓氏解释","titleEn":"Surname Explanation","cn":"中文说明","en":"English explanation"},{"titleCn":"名字解释","titleEn":"Given Name Explanation","cn":"中文说明","en":"English explanation"},{"titleCn":"古籍出处","titleEn":"Classical Source","cn":"中文说明","en":"English explanation"},{"titleCn":"整体寓意","titleEn":"Overall Meaning","cn":"中文说明","en":"English explanation"}]}`;

    const deepseek = { url:'https://api.deepseek.com/v1/chat/completions', model: "deepseek-chat" };

    async function callAI() {
        const body = { model: deepseek.model, messages:[{role:'user',content:prompt}], temperature:0.7 };
        console.log('[DeepSeek] prompt:', prompt.substring(0, 300));
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const resp = await fetch(deepseek.url, {
                method:'POST', signal:controller.signal,
                headers: {'Content-Type':'application/json','Authorization':`Bearer ${process.env.DEEPSEEK_API_KEY}`},
                body: JSON.stringify(body)
            });
            clearTimeout(timeout);
            let data;
            try { data = await resp.json(); } catch {
                const raw = await resp.text().catch(() => '');
                const jsonMatch = raw.match(/\{[^}]+\}/);
                try { data = jsonMatch ? JSON.parse(jsonMatch[0]) : { ok:false, error:'JSON parse failed', raw }; }
                catch { data = { ok:false, error:'JSON parse failed', raw }; }
            }
            console.log('[DeepSeek] status:', resp.status, '| data.ok:', data.ok);
            if(!resp.ok || !data.choices?.[0]?.message?.content) {
                const errMsg = data.error?.message || data.error || 'API error';
                console.error('[DeepSeek] error:', errMsg);
                throw new Error(errMsg);
            }
            const result = data.choices[0].message.content;
            console.log('[DeepSeek] result:', result.substring(0, 200));
            return result;
        } catch(err) {
            clearTimeout(timeout);
            console.error('[DeepSeek] exception:', err.message);
            throw err;
        }
    }

    try {
        log(`你是面向海外用户的中文起名师,根据性别,风格生成名字,输出格式:中文名+拼音+英文释义+寓意解析`);
        const result = await callAI('deepseek');
        const normalized = normalizeNameResult(result);
        if(!normalized.chineseName) {
            return res.status(502).json({ success: false, error: 'AI response missing chineseName', raw: result });
        }
        if(shouldUseFreeQuota && !useQuota(userId)) {
            return res.status(402).json({ error: 'quota exhausted', showPaywall: true });
        }
        res.json({ success: true, devTest, data: normalized });
    } catch(err) {
        logError('===【AI起名全部失败】===', err.message);
        res.status(502).json({ success: false, error: 'Generation failed, please try again' });
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
        "Ma Shan Zheng, STXingkai, FZShuTi, STFangsong, KaiTi, cursive",
        "STXingkai, Ma Shan Zheng, FZShuTi, KaiTi, cursive",
        "FZShuTi, Ma Shan Zheng, STXingkai, KaiTi, cursive",
        "HanziPen SC, Xingkai SC, Ma Shan Zheng, KaiTi, cursive"
    ];
    const font = fonts[Math.floor(Math.random() * fonts.length)];
    const gradId = 'bg' + Date.now();
    const paperId = 'paper' + Date.now();
    const brushId = 'brush' + Date.now();
    const titleSize = Math.max(64, Math.min(100, 116 - name.length * 7));
    const svg = `<svg width="400" height="400" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fffaf0"/>
      <stop offset="48%" stop-color="#f5ead6"/>
      <stop offset="100%" stop-color="#dfc8a2"/>
    </linearGradient>
    <filter id="softBlur"><feGaussianBlur stdDeviation="12"/></filter>
    <filter id="${paperId}">
      <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="8"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="table" tableValues="0 0.12"/></feComponentTransfer>
    </filter>
    <filter id="${brushId}">
      <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="3" seed="5" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.9" xChannelSelector="R" yChannelSelector="G"/>
      <feGaussianBlur stdDeviation="0.18"/>
    </filter>
  </defs>
  <rect width="400" height="400" fill="url(#${gradId})"/>
  <g opacity="0.18" filter="url(#softBlur)">
    <ellipse cx="106" cy="96" rx="108" ry="64" fill="#66735f"/>
    <ellipse cx="292" cy="280" rx="126" ry="78" fill="#806a54"/>
    <ellipse cx="206" cy="194" rx="158" ry="92" fill="#b1a182"/>
  </g>
  <g fill="none" stroke="#c9a96e" stroke-width="0.9" opacity="0.18" stroke-linecap="round">
    <path d="M24 108c38-28 86-20 110 12c31-18 72-2 82 28"/>
    <path d="M210 86c42-34 92-22 120 13c28-14 58-2 70 24"/>
    <path d="M46 304c42-38 112-34 136 12c34-16 76 0 92 33"/>
  </g>
  <path d="M0 306c74-70 128-26 190-86c42-42 76-54 120-7c34 36 58 31 90 8v180H0z" fill="#3f4c44" opacity="0.10"/>
  <rect width="400" height="400" filter="url(#${paperId})" opacity="0.75"/>
  <rect x="24" y="24" width="352" height="352" fill="none" stroke="#9b2a1f" stroke-width="1.15" opacity="0.72" rx="18"/>
  <rect x="38" y="38" width="324" height="324" fill="none" stroke="#d6b982" stroke-width="0.7" opacity="0.55"/>
  <g font-family="${font}" text-anchor="middle" dominant-baseline="middle" letter-spacing="7">
    <text x="201" y="207" font-size="${titleSize}" fill="#1b1712" opacity="0.16" filter="url(#softBlur)">${name}</text>
    <text x="198.5" y="204" font-size="${titleSize}" fill="#0d0b09" opacity="0.30">${name}</text>
    <text x="200" y="204" font-size="${titleSize}" fill="#050403" filter="url(#${brushId})">${name}</text>
  </g>
  <text x="200" y="318" font-size="12" text-anchor="middle" fill="#8c2318" font-family="Georgia, 'Times New Roman', serif" letter-spacing="1.2">mychinesename.co</text>
  <g transform="translate(310 292)">
    <rect width="48" height="48" fill="#9d2419" opacity="0.92" rx="3"/>
    <text x="24" y="19" font-size="12" text-anchor="middle" fill="#f8ead2" font-family="STXingkai, KaiTi, serif">雅</text>
    <text x="24" y="35" font-size="12" text-anchor="middle" fill="#f8ead2" font-family="STXingkai, KaiTi, serif">名</text>
  </g>
</svg>`;
    res.type('image/svg+xml').send(svg);
});

// ============================================================
// 错误处理中间件（正式环境屏蔽报错栈）
// ============================================================
app.use((err, req, res, next) => {
    // 捕获 JSON 解析错误
    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
        return res.status(400).json({ error: 'Invalid JSON payload' });
    }
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
    console.log(`Server is running on port ${port}`);
});
