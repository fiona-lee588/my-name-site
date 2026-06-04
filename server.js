require('dotenv').config();
// My Chinese Name - 涓枃璧峰悕鏈嶅姟鍚庣 API锛屾敮鎸?DeepSeek 鍗曞紩鎿庤捣鍚?
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const paypal = require('paypal-rest-sdk');
const crypto = require('crypto');
const app = express();
app.set('trust proxy', 1);
const port = process.env.PORT || 3000;

// ============================================================
// 鐜閰嶇疆锛堝叏閮ㄤ粠 .env 璇诲彇锛岀姝㈢‖缂栫爜锛?// ============================================================
const IS_PROD     = process.env.NODE_ENV === 'production';
const DOMAIN      = process.env.DOMAIN   || (IS_PROD ? 'https://mychinesename.co' : 'http://localhost:3000');
const CORS_ORIGIN = process.env.CORS_ORIGIN || (IS_PROD ? 'https://mychinesename.co' : '*');
const LOG_LEVEL   = process.env.LOG_LEVEL || (IS_PROD ? 'error' : 'debug');
const OFFICIAL_DOMAIN = (process.env.PUBLIC_SITE_URL || process.env.DOMAIN || 'https://mychinesename.co').replace(/\/+$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_PATH = '/admin-dashboard-2026';
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || ADMIN_PASSWORD || 'local-admin-session';
const SEO_LANDING_PAGES = {
    '/chinese-name-generator': {
        title: 'Chinese Name Generator Inspired by the I Ching and Book of Songs',
        h1: 'Chinese Name Generator',
        intro: 'Get a meaningful Chinese name based on surname matching, birth information, five-elements thinking, and classical Chinese literature.',
        focus: 'Ideal for overseas users who want a culturally respectful Chinese name instead of a random translation.'
    },
    '/chinese-names-for-girls': {
        title: 'Chinese Names for Girls with Meanings and Classical Sources',
        h1: 'Chinese Names for Girls',
        intro: 'Discover elegant Chinese names for girls inspired by the Book of Songs, Chu Ci, and traditional ideas of grace, clarity, and inner strength.',
        focus: 'Each name balances beauty, pronunciation, character meaning, and cultural source.'
    },
    '/chinese-names-for-boys': {
        title: 'Chinese Names for Boys with Meaning, Pinyin, and Cultural Origin',
        h1: 'Chinese Names for Boys',
        intro: 'Find refined Chinese names for boys with pinyin, English explanations, and meanings shaped by I Ching balance and classical imagery.',
        focus: 'Designed for names that sound natural in Chinese and feel confident across cultures.'
    },
    '/i-ching-name-generator': {
        title: 'I Ching Name Generator for Meaningful Chinese Names',
        h1: 'I Ching Name Generator',
        intro: 'Create a Chinese name guided by birth time, yin-yang balance, five elements, and the I Ching idea of timely harmony.',
        focus: 'A name should carry direction, balance, and long-term personal meaning.'
    },
    '/book-of-songs-chinese-names': {
        title: 'Book of Songs Chinese Names with Poetic Meanings',
        h1: 'Book of Songs Chinese Names',
        intro: 'Explore Chinese names inspired by the elegance of the Book of Songs, one of China鈥檚 oldest poetic classics.',
        focus: 'For users who want a name with literary depth, softness, and cultural memory.'
    },
    '/chinese-name-meaning': {
        title: 'Chinese Name Meaning Explained in English',
        h1: 'Chinese Name Meaning',
        intro: 'Understand the surname, given name characters, pinyin, pronunciation, classical source, and overall personality of a Chinese name.',
        focus: 'Every result includes Chinese and English explanations so overseas users can use the name with confidence.'
    },
    '/chinese-name-for-emma': {
        title: 'Chinese Name for Emma: Meaningful Cultural Name Ideas',
        h1: 'Chinese Name for Emma',
        intro: 'Emma often pairs well with graceful, bright, and elegant Chinese name imagery rooted in poetry and balanced character meanings.',
        focus: 'Generate a personalized Chinese name for Emma using surname matching and cultural context.'
    },
    '/chinese-name-for-james': {
        title: 'Chinese Name for James: Pinyin, Meaning, and Cultural Source',
        h1: 'Chinese Name for James',
        intro: 'James can be adapted into a Chinese name that feels dignified, natural, and culturally meaningful rather than purely phonetic.',
        focus: 'Create a personalized Chinese name for James with pinyin and bilingual interpretation.'
    },
    '/chinese-name-for-sophia': {
        title: 'Chinese Name for Sophia: Wisdom, Grace, and Chinese Classics',
        h1: 'Chinese Name for Sophia',
        intro: 'Sophia carries the idea of wisdom, making it ideal for Chinese names with refined, intelligent, and poetic meanings.',
        focus: 'Generate a Chinese name for Sophia inspired by classical sources and five-elements balance.'
    },
    '/chinese-name-for-michael': {
        title: 'Chinese Name for Michael: Meaningful Chinese Name Ideas',
        h1: 'Chinese Name for Michael',
        intro: 'Michael can become a strong yet elegant Chinese name through sound matching, surname selection, and meaningful character choices.',
        focus: 'Generate a personalized Chinese name for Michael with pronunciation, source, and English explanation.'
    }
};

// 浠呭湪闈炴寮忕幆澧冭緭鍑哄惎鍔ㄦ棩蹇?const log = (...args) => { console.log(...args); };
const logError = (...args) => { console.error(...args); };

log("DeepSeek瀵嗛挜锛?, !!process.env.DEEPSEEK_API_KEY);
log("PayPal妯″紡锛?, process.env.PAYPAL_MODE || 'sandbox');
log("PayPal_CLIENT_ID锛?, !!process.env.PAYPAL_CLIENT_ID);
log("PayPal_CLIENT_SECRET锛?, !!process.env.PAYPAL_CLIENT_SECRET);
log("缃戠珯鍩熷悕锛?, DOMAIN);

// ============================================================
// CORS 閰嶇疆
// ============================================================
app.use(cors({
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: true
}));
// helmet() 宸茬Щ闄?CSP
// app.use(helmet());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// ============================================================
// API 鍏ㄥ眬闄愭祦锛?api 璺緞锛?0绉掑唴鏈€澶?0娆★級
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
// 瀹夊叏涓棿浠讹細IP 闄愭祦 + 棰戠巼闄愬埗锛堢簿缁嗗寲锛?// ============================================================

// IP 璇锋眰璁℃暟锛堝唴瀛樹腑绠€鍗曡鏁帮紝鐢熶骇鐜寤鸿鐢?Redis锛?const ipCounts = new Map();          // IP -> { count, resetAt }
const ipBlocked = new Map();          // IP -> unblockAt

// 璧峰悕API涓撳睘闄愭祦锛氭瘡涓狪P姣忓垎閽熸渶澶?N 娆?const RATE_LIMIT_WINDOW_MS = 60 * 1000;  // 1鍒嗛挓绐楀彛
const RATE_LIMIT_MAX = IS_PROD ? 5 : 20;   // 姣忕獥鍙ｆ渶澶ц姹傛暟锛堟寮忕幆澧?娆★紝寮€鍙戠幆澧?0娆★級

// 娓呯悊杩囨湡璁板綍鐨勫畾鏃跺櫒锛堟瘡5鍒嗛挓娓呯悊涓€娆★級
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

    // 琚复鏃舵嫤鎴殑IP
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

    // 瓒呰繃闃堝€煎垯涓存椂灏佺10鍒嗛挓
    if(record.count > RATE_LIMIT_MAX) {
        ipBlocked.set(ip, now + 10 * 60 * 1000);
        ipCounts.delete(ip);
        logError(`浣犳槸闈㈠悜娴峰鐢ㄦ埛鐨勪腑鏂囪捣鍚嶅笀,鏍规嵁鎬у埆,椋庢牸鐢熸垚鍚嶅瓧,杈撳嚭鏍煎紡:涓枃鍚?鎷奸煶+鑻辨枃閲婁箟+瀵撴剰瑙ｆ瀽`);
        return res.status(429).json({ error: 'Too many requests, please try again later.' });
    }

    next();
}

// 閫氱敤璇锋眰鏃ュ織锛堜粎闈炴寮忕幆澧冿級
app.use((req, res, next) => {
    if(!IS_PROD) {
        const ip = getClientIp(req);
        log(`浣犳槸闈㈠悜娴峰鐢ㄦ埛鐨勪腑鏂囪捣鍚嶅笀,鏍规嵁鎬у埆,椋庢牸鐢熸垚鍚嶅瓧,杈撳嚭鏍煎紡:涓枃鍚?鎷奸煶+鑻辨枃閲婁箟+瀵撴剰瑙ｆ瀽`);
    }
    next();
});

// ============================================================
// PayPal 閰嶇疆锛堜粠 .env 璇诲彇锛?// ============================================================
// PayPal REST API 閰嶇疆锛堜粠 .env 璇诲彇锛宭ive/sandbox 鑷姩鍒囨崲锛?// ============================================================
paypal.configure({
    mode: process.env.PAYPAL_MODE || 'sandbox',
    client_id: process.env.PAYPAL_CLIENT_ID,
    client_secret: process.env.PAYPAL_CLIENT_SECRET
});

// ============================================================
// 濂楅鏉冪泭琛紙鍏ㄩ儴浠庡悗绔鍙栵紝鍓嶇绂佹纭紪鐮侊級
// ============================================================
const PACKAGE_ENTITLEMENTS = {
    basic:    { quota: 3,    wuxingLevel: 'basic', culturalDepth: false, certificate: false, avatarGeneration: 0,  regeneration: 1  },
    premium:  { quota: 5,    wuxingLevel: 'full',  culturalDepth: true,  certificate: true,  avatarGeneration: 1,  regeneration: 999 },
    ultimate: { quota: 9999, wuxingLevel: 'full',  culturalDepth: true,  certificate: true,  avatarGeneration: 999, regeneration: 999 }
};

// ============================================================
// 鏂囦欢璺緞
// ============================================================
const USER_STATE_FILE = path.join(__dirname, 'user-state.json');
const PAYMENT_LOG_FILE = path.join(__dirname, 'payment-log.json');
const ANALYTICS_LOG_FILE = path.join(__dirname, 'analytics-log.json');

// ============================================================
// 鐘舵€佽鍐?// ============================================================
function readUserState(){
    try {
        if(!fs.existsSync(USER_STATE_FILE)) return {};
        return JSON.parse(fs.readFileSync(USER_STATE_FILE, 'utf8'));
    } catch { return {}; }
}

// ============================================================
// 杈撳叆娓呮礂锛堜繚鐣欎腑鏂囥€丄SCII鍙瀛楃锛屽幓闄ゆ帶鍒跺瓧绗﹀拰鐗规畩绗﹀彿锛?// ============================================================
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

function readAnalyticsLog(){
    try {
        if(!fs.existsSync(ANALYTICS_LOG_FILE)) return [];
        const data = JSON.parse(fs.readFileSync(ANALYTICS_LOG_FILE, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch { return []; }
}

function writeAnalyticsLog(logs){
    fs.writeFileSync(ANALYTICS_LOG_FILE, JSON.stringify(logs, null, 2));
}

function appendAnalyticsEvent(req, event, meta = {}){
    const allowed = new Set([
        'page_view', 'generate_click', 'generate_success', 'generate_failed',
        'paywall_show', 'buy_click', 'share_click', 'share_reward'
    ]);
    if(!allowed.has(event)) return { ok: false };
    const logs = readAnalyticsLog();
    logs.push({
        event,
        meta,
        userId: getUserId(req),
        ip: getClientIp(req),
        ua: (req.headers['user-agent'] || '').substring(0, 180),
        path: req.headers.referer || req.originalUrl || '',
        _ts: new Date().toISOString()
    });
    if(logs.length > 5000) logs.splice(0, logs.length - 5000);
    writeAnalyticsLog(logs);
    return { ok: true };
}

function dayKey(date){
    return new Date(date).toISOString().slice(0, 10);
}

function summarizeAnalytics(){
    const logs = readAnalyticsLog();
    const today = dayKey(new Date());
    const counts = {};
    const todayCounts = {};
    const daily = {};
    const sevenDays = [];
    for(let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        sevenDays.push(dayKey(d));
    }
    for(const logItem of logs) {
        counts[logItem.event] = (counts[logItem.event] || 0) + 1;
        const d = dayKey(logItem._ts || new Date());
        daily[d] = daily[d] || {};
        daily[d][logItem.event] = (daily[d][logItem.event] || 0) + 1;
        if(d === today) todayCounts[logItem.event] = (todayCounts[logItem.event] || 0) + 1;
    }
    return {
        total: logs.length,
        counts,
        todayCounts,
        recent: logs.slice(-80).reverse(),
        dailyRows: sevenDays.map(d => ({
            date: d,
            page_view: daily[d]?.page_view || 0,
            generate_click: daily[d]?.generate_click || 0,
            generate_success: daily[d]?.generate_success || 0,
            generate_failed: daily[d]?.generate_failed || 0,
            paywall_show: daily[d]?.paywall_show || 0,
            buy_click: daily[d]?.buy_click || 0,
            share_click: daily[d]?.share_click || 0
        }))
    };
}

function htmlEscape(value){
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function adminToken(){
    return crypto
        .createHash('sha256')
        .update(`${ADMIN_SESSION_SECRET}:${ADMIN_PASSWORD}`)
        .digest('hex');
}

function parseCookies(req){
    return Object.fromEntries((req.headers.cookie || '').split(';')
        .map(v => v.trim())
        .filter(Boolean)
        .map(v => {
            const idx = v.indexOf('=');
            return idx === -1 ? [v, ''] : [v.slice(0, idx), decodeURIComponent(v.slice(idx + 1))];
        }));
}

function isAdminAuthed(req){
    return parseCookies(req).admin_auth === adminToken();
}

// ============================================================
// 鐢ㄦ埛ID + 瑙ｉ攣
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
    log(`浣犳槸闈㈠悜娴峰鐢ㄦ埛鐨勪腑鏂囪捣鍚嶅笀,鏍规嵁鎬у埆,椋庢牸鐢熸垚鍚嶅瓧,杈撳嚭鏍煎紡:涓枃鍚?鎷奸煶+鑻辨枃閲婁箟+瀵撴剰瑙ｆ瀽`);
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

function buildFallbackName({ givenName, surname, gender, style, meaning, birthText }){
    const surnameMap = [
        { re:/^(smith|smyth)$/i, cn:'娌?, pinyin:'Shen', reason:'chosen for its soft sh sound and refined literary feeling' },
        { re:/^(johnson|jones|james)$/i, cn:'姹?, pinyin:'Jiang', reason:'chosen for a clear j sound and the image of a broad river' },
        { re:/^(brown|bruno)$/i, cn:'鐧?, pinyin:'Bai', reason:'chosen by contrast for brightness, purity, and an elegant classical surname' },
        { re:/^(miller|miles|mitchell|michael)$/i, cn:'绫?, pinyin:'Mi', reason:'chosen for its close m sound and warm everyday cultural image' },
        { re:/^(davis|thomas|taylor)$/i, cn:'鍞?, pinyin:'Tang', reason:'chosen for its dignified sound and Tang dynasty cultural resonance' },
        { re:/^(wilson|williams|walker)$/i, cn:'榄?, pinyin:'Wei', reason:'chosen for its w sound and noble historical presence' },
        { re:/^(lee|li|lewis)$/i, cn:'鏉?, pinyin:'Li', reason:'chosen for its direct sound match and deep Baijiaxing heritage' },
        { re:/^(martin|moore|morgan)$/i, cn:'绌?, pinyin:'Mu', reason:'chosen for its calm m sound and meaning of sincerity and harmony' }
    ];
    const matched = surnameMap.find(item => item.re.test(surname || '')) || {
        cn:'鏋?, pinyin:'Lin', reason:'chosen for a natural, graceful image that feels accessible across cultures'
    };
    const profile = `${meaning || ''} ${style || ''}`;
    const wantsWisdom = /wisdom|wise|intelligence|learn|knowledge|鑱獆鏅?i.test(profile);
    const wantsPeace = /peace|calm|gentle|grace|serene|瀹墊瀹亅闆?i.test(profile);
    const wantsBright = /bright|success|future|hope|light|prosper|鎴恷鍏墊鏄?i.test(profile);
    const feminine = /female|girl|woman/i.test(gender || '');
    const given = wantsWisdom ? { cn:'鐭ラ煹', pinyin:'Zhi Yun', gloss:'wisdom with poetic rhythm' }
        : wantsBright ? { cn: feminine ? '鏄庤垝' : '鏄庤繙', pinyin: feminine ? 'Ming Shu' : 'Ming Yuan', gloss: feminine ? 'clear light and ease' : 'bright vision and far-reaching promise' }
        : wantsPeace ? { cn: feminine ? '瀹夐泤' : '瀹夊拰', pinyin: feminine ? 'An Ya' : 'An He', gloss: feminine ? 'peaceful elegance' : 'peace and harmony' }
        : { cn: feminine ? '娓呭畞' : '鎬€鐟?, pinyin: feminine ? 'Qing Ning' : 'Huai Jin', gloss: feminine ? 'clarity and serenity' : 'holding inner jade-like virtue' };
    const fullName = `${matched.cn}${given.cn}`;
    const fullPinyin = `${matched.pinyin} ${given.pinyin}`;
    return {
        chineseName: fullName,
        pinyin: fullPinyin,
        pronunciation: fullPinyin,
        meaning: `${fullName} means ${given.gloss}, selected as a culturally meaningful Chinese name rather than a random translation.`,
        sections: [
            {
                titleCn:'濮撴皬瑙ｉ噴',
                titleEn:'Surname Explanation',
                cn:`${matched.cn}濮撲緷鎹嫳鏂囧姘?${surname || 'your surname'} 鐨勮闊冲拰姘旇川鍖归厤鐧惧濮擄紝鍏奸【娴峰鐢ㄦ埛鍙戦煶涓庝腑鏂囧姘忎紶缁熴€俙,
                en:`The surname ${matched.cn} (${matched.pinyin}) is matched from the Hundred Family Surnames because it is ${matched.reason}.`
            },
            {
                titleCn:'鍚嶅瓧瑙ｉ噴',
                titleEn:'Given Name Explanation',
                cn:`${given.cn}鍛煎簲浣犲笇鏈涘憟鐜扮殑${meaning || '缇庡ソ瀵撴剰'}锛屽己璋冨悕瀛楃殑姘旇川銆佸彲璇绘€у拰闀挎湡浣跨敤鎰熴€俙,
                en:`The given name ${given.cn} (${given.pinyin}) expresses ${given.gloss}, aligned with your preferred meaning and style.`
            },
            {
                titleCn:'鍙ょ睄鍑哄',
                titleEn:'Classical Source',
                cn:'鍚嶅瓧鎰忚薄鍙傝€冦€婅瘲缁忋€嬬殑娓╁帤闆呮銆併€婃杈炪€嬬殑娓呮湕蹇楀悜锛屽苟浠ャ€婃槗缁忋€嬮噸瑙嗗钩琛′笌鍙樺寲鐨勬€濇兂浣滄暣浣撳彇鍚戙€?,
                en:'The imagery is inspired by the elegance of the Book of Songs, the aspiration of Chu Ci, and the I Ching idea of balance and timely change.'
            },
            {
                titleCn:'鏁翠綋瀵撴剰',
                titleEn:'Overall Meaning',
                cn:`缁撳悎鍑虹敓淇℃伅${birthText || '涓庝釜浜哄亸濂?}锛岃繖涓悕瀛楀憟鐜板惈钃勩€佸彲淇°€侀€傚悎璺ㄦ枃鍖栧満鏅娇鐢ㄧ殑涓滄柟姘旇川銆俙,
                en:`Considering ${birthText || 'your profile'}, this name feels refined, memorable, and suitable for long-term cross-cultural use.`
            }
        ]
    };
}

function normalizeNameResult(raw){
    const parsed = raw && typeof raw === 'object' ? raw : (extractJsonObject(raw) || {});
    const rawText = typeof raw === 'string' ? raw : JSON.stringify(parsed);
    const chineseName = cleanStr(parsed.chineseName || parsed.name || parsed.fullName || '') ||
        ((rawText || '').match(/銆愬畬鏁翠腑鏂囧鍚嶃€戯細([^\n銆怾+)/)?.[1] || '').replace(/[^\u4e00-\u9fa5]/g, '');
    const pinyin = cleanStr(parsed.pinyin || '') ||
        ((rawText || '').match(/銆愭嫾闊炽€戯細([^\n銆怾+)/)?.[1] || '');
    const meaning = cleanStr(parsed.meaning || parsed.explanation || parsed.description || '') ||
        ((rawText || '').match(/銆愬瘬鎰忚В鏋愩€戯細([\s\S]+)/)?.[1] || '');
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
        pronunciation: cleanStr(parsed.pronunciation || parsed.pronunciationGuide || parsed.pinyin || ''),
        meaning,
        sections,
        raw: rawText || ''
    };
}

function renderSeoLandingPage(pathname, page){
    const canonical = `${OFFICIAL_DOMAIN}${pathname}`;
    const jsonLd = {
        '@context':'https://schema.org',
        '@type':'WebPage',
        name: page.title,
        url: canonical,
        description: page.intro,
        breadcrumb: {
            '@type':'BreadcrumbList',
            itemListElement: [
                {'@type':'ListItem', position:1, name:'Home', item:OFFICIAL_DOMAIN},
                {'@type':'ListItem', position:2, name:page.h1, item:canonical}
            ]
        }
    };
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(page.title)} | My Chinese Name</title>
<meta name="description" content="${htmlEscape(page.intro)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${htmlEscape(page.title)}">
<meta property="og:description" content="${htmlEscape(page.intro)}">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${htmlEscape(page.title)}">
<meta name="twitter:description" content="${htmlEscape(page.intro)}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
body{margin:0;background:#f7f2e9;color:#3f3024;font-family:Georgia,"Times New Roman",serif;line-height:1.7}
.wrap{max-width:960px;margin:0 auto;padding:48px 20px}
.eyebrow{color:#8c2318;font-size:14px;letter-spacing:.08em;text-transform:uppercase}
h1{font-size:clamp(34px,5vw,58px);line-height:1.05;margin:12px 0 18px;color:#8c2318}
.lead{font-size:20px;max-width:760px}
.panel{margin-top:32px;padding:24px;border:1px solid #d8c6b0;background:#fffbf5;border-radius:8px}
.cta{display:inline-block;margin-top:24px;padding:12px 18px;background:#8c2318;color:#fff;text-decoration:none;border-radius:6px}
.han{font-family:KaiTi,STKaiti,serif;color:#9a6a2f}
ul{padding-left:20px}
</style>
</head>
<body><main class="wrap">
<div class="eyebrow">My Chinese Name 路 涓浗浼犵粺鏂囧寲涓枃璧峰悕</div>
<h1>${htmlEscape(page.h1)}</h1>
<p class="lead">${htmlEscape(page.intro)}</p>
<div class="panel">
<p>${htmlEscape(page.focus)}</p>
<ul>
<li>English surname matched to a Chinese surname from the Hundred Family Surnames.</li>
<li>Name characters inspired by the I Ching, Book of Songs, Chu Ci, and five-elements balance.</li>
<li>Each result includes Chinese characters, pinyin, pronunciation guidance, English meaning, and cultural source.</li>
</ul>
<p class="han">鍚嶄互杞介亾锛屽瓧涓湁鍏夈€?/p>
<a class="cta" href="/">Generate My Chinese Name</a>
</div>
</main></body></html>`;
}

// ============================================================
// API璺敱
// ============================================================

app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *
Allow: /
Sitemap: ${OFFICIAL_DOMAIN}/sitemap.xml
`);
});

app.get('/sitemap.xml', (req, res) => {
    const staticPages = ['/', '/brand-intro', '/contact-us', '/faq', '/privacy', '/terms', '/payment-guide'];
    const urls = [...staticPages, ...Object.keys(SEO_LANDING_PAGES)]
        .map(url => `<url><loc>${OFFICIAL_DOMAIN}${url === '/' ? '/' : url}</loc><changefreq>weekly</changefreq><priority>${url === '/' ? '1.0' : '0.8'}</priority></url>`)
        .join('');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});

Object.entries(SEO_LANDING_PAGES).forEach(([pathname, page]) => {
    app.get(pathname, (req, res) => res.send(renderSeoLandingPage(pathname, page)));
});

app.get('/api/quota', (req, res) => {
    res.json(getUserStatus(getUserId(req)));
});

app.get('/api/pricing', (req, res) => {
    res.json({
        packages: {
            basic: {
                price: 9.9,
                originalPrice: 19.9,
                label: 'Basic',
                badge: 'Starter',
                features: [
                    { icon: '鉁?, text: '3 custom Chinese name options' },
                    { icon: '鉁?, text: 'Basic five-elements interpretation' },
                    { icon: '鉁?, text: '1 regeneration if the direction feels wrong' },
                    { icon: '鉁?, text: 'Chinese characters, pinyin, and English meaning' }
                ]
            },
            premium: {
                price: 19.9,
                originalPrice: 39.9,
                label: 'Premium',
                badge: 'Most Popular',
                features: [
                    { icon: '鉁?, text: '5 exclusive Chinese name options' },
                    { icon: '鉁?, text: 'Full birth-time and five-elements interpretation' },
                    { icon: '鉁?, text: 'Book of Songs / Chu Ci source explanation' },
                    { icon: '鉁?, text: 'Downloadable naming certificate' },
                    { icon: '鉁?, text: '1 calligraphy-style name card' }
                ]
            },
            ultimate: {
                price: 29.9,
                originalPrice: 59.9,
                label: 'Ultimate',
                badge: 'Full Service',
                features: [
                    { icon: '鉁?, text: 'Unlimited name generations for your project' },
                    { icon: '鉁?, text: 'In-depth cultural customization' },
                    { icon: '鉁?, text: 'Lifetime name record storage' },
                    { icon: '鉁?, text: 'Priority support for payment or generation issues' }
                ]
            }
        }
    });
});

function renderAdminDashboard(req){
    const analytics = summarizeAnalytics();
    const users = readUserState();
    const payments = readPaymentLog().slice(-80).reverse();
    const card = (label, value, sub = '') => `<div class="card"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
    const eventLabel = {
        page_view: '椤甸潰璁块棶',
        generate_click: '鐐瑰嚮鐢熸垚',
        generate_success: '鐢熸垚鎴愬姛',
        generate_failed: '鐢熸垚澶辫触',
        paywall_show: '浠樿垂寮圭獥',
        buy_click: '璐拱鐐瑰嚮',
        share_click: '鍒嗕韩鐐瑰嚮',
        share_reward: '鍒嗕韩濂栧姳'
    };
    const userRows = Object.entries(users).slice(-120).reverse().map(([id, user]) => `<tr>
        <td>${htmlEscape(id)}</td>
        <td>${htmlEscape(user.package || 'free')}</td>
        <td>${htmlEscape(user.quota ?? 2)}</td>
        <td>${htmlEscape(user.wuxingLevel || '')}</td>
        <td>${htmlEscape(user.transactionId || '')}</td>
        <td>${htmlEscape(user.paidAt || '')}</td>
    </tr>`).join('');
    const dailyRows = analytics.dailyRows.map(row => `<tr>
        <td>${row.date}</td><td>${row.page_view}</td><td>${row.generate_click}</td><td>${row.generate_success}</td>
        <td>${row.generate_failed}</td><td>${row.paywall_show}</td><td>${row.buy_click}</td><td>${row.share_click}</td>
    </tr>`).join('');
    const recentRows = analytics.recent.map(item => `<tr>
        <td>${htmlEscape(item._ts)}</td>
        <td>${htmlEscape(eventLabel[item.event] || item.event)}</td>
        <td>${htmlEscape(item.userId)}</td>
        <td>${htmlEscape(item.ip)}</td>
        <td>${htmlEscape(JSON.stringify(item.meta || {})).substring(0, 220)}</td>
    </tr>`).join('');
    const paymentRows = payments.map(item => `<tr>
        <td>${htmlEscape(item._ts || '')}</td><td>${htmlEscape(item.txn || '')}</td><td>${htmlEscape(item.pkg || '')}</td>
        <td>${htmlEscape(item.userId || '')}</td><td>${htmlEscape(item.status || '')}</td><td>${htmlEscape(item.err || (item.success ? '鎴愬姛' : ''))}</td>
    </tr>`).join('');

    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>杩愯惀鍚庡彴 | My Chinese Name</title>
    <style>
    body{margin:0;background:#f7f2e9;color:#443322;font-family:Arial,"Noto Serif SC",serif}
    .wrap{max-width:1180px;margin:0 auto;padding:26px 18px 60px}
    h1{color:#8c2318;margin:0 0 6px;font-size:28px}.top{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:18px}
    .muted{color:#997755;font-size:13px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}
    .card{background:#fffbf5;border:1px solid #e2d0b8;border-radius:8px;padding:14px;box-shadow:0 2px 10px rgba(139,90,43,.08)}
    .label{font-size:13px;color:#775533}.value{font-size:26px;color:#8c2318;font-weight:bold;margin:5px 0}.sub{font-size:12px;color:#997755}
    section{background:#fffbf5;border:1px solid #e2d0b8;border-radius:8px;padding:16px;margin:16px 0;overflow:auto}
    h2{color:#8c2318;font-size:18px;margin:0 0 12px}table{width:100%;border-collapse:collapse;font-size:13px}
    th,td{border-bottom:1px solid #eadcc9;padding:8px;text-align:left;vertical-align:top}th{color:#8c2318;background:#fff6ea;white-space:nowrap}
    .logout{color:#8c2318;text-decoration:none;border:1px solid #c9a96e;border-radius:6px;padding:7px 12px;background:#fffbf5}
    @media(max-width:800px){.grid{grid-template-columns:repeat(2,1fr)}.top{align-items:flex-start;flex-direction:column}}
    </style></head><body><div class="wrap">
    <div class="top"><div><h1>杩愯惀鍚庡彴</h1><div class="muted">My Chinese Name Analytics Dashboard 路 ${htmlEscape(new Date().toLocaleString())}</div></div><a class="logout" href="${ADMIN_PATH}?logout=1">閫€鍑?/a></div>
    <div class="grid">
      ${card('浠婃棩璁块棶', analytics.todayCounts.page_view || 0, 'page_view today')}
      ${card('鎬昏闂?, analytics.counts.page_view || 0, 'page_view total')}
      ${card('鐢熸垚鎴愬姛', analytics.counts.generate_success || 0, `浠婃棩 ${analytics.todayCounts.generate_success || 0}`)}
      ${card('鐢熸垚澶辫触', analytics.counts.generate_failed || 0, `浠婃棩 ${analytics.todayCounts.generate_failed || 0}`)}
      ${card('鐐瑰嚮鐢熸垚', analytics.counts.generate_click || 0, `浠婃棩 ${analytics.todayCounts.generate_click || 0}`)}
      ${card('浠樿垂寮圭獥', analytics.counts.paywall_show || 0, `浠婃棩 ${analytics.todayCounts.paywall_show || 0}`)}
      ${card('璐拱鐐瑰嚮', analytics.counts.buy_click || 0, `浠婃棩 ${analytics.todayCounts.buy_click || 0}`)}
      ${card('鍒嗕韩鐐瑰嚮', analytics.counts.share_click || 0, `浠婃棩 ${analytics.todayCounts.share_click || 0}`)}
    </div>
    <section><h2>鏈€杩?7 澶╄秼鍔?/h2><table><thead><tr><th>鏃ユ湡</th><th>璁块棶</th><th>鐐瑰嚮鐢熸垚</th><th>鐢熸垚鎴愬姛</th><th>鐢熸垚澶辫触</th><th>浠樿垂寮圭獥</th><th>璐拱鐐瑰嚮</th><th>鍒嗕韩鐐瑰嚮</th></tr></thead><tbody>${dailyRows}</tbody></table></section>
    <section><h2>鏈€杩戜簨浠?/h2><table><thead><tr><th>鏃堕棿</th><th>浜嬩欢</th><th>鐢ㄦ埛</th><th>IP</th><th>淇℃伅</th></tr></thead><tbody>${recentRows || '<tr><td colspan="5">鏆傛棤鏁版嵁</td></tr>'}</tbody></table></section>
    <section><h2>鐢ㄦ埛棰濆害</h2><table><thead><tr><th>鐢ㄦ埛ID/IP</th><th>濂楅</th><th>鍓╀綑棰濆害</th><th>浜旇绛夌骇</th><th>浜ゆ槗鍙?/th><th>鏀粯鏃堕棿</th></tr></thead><tbody>${userRows || '<tr><td colspan="6">鏆傛棤鏁版嵁</td></tr>'}</tbody></table></section>
    <section><h2>鏀粯鏃ュ織</h2><table><thead><tr><th>鏃堕棿</th><th>浜ゆ槗鍙?/th><th>濂楅</th><th>鐢ㄦ埛</th><th>鐘舵€?/th><th>缁撴灉/閿欒</th></tr></thead><tbody>${paymentRows || '<tr><td colspan="6">鏆傛棤鏁版嵁</td></tr>'}</tbody></table></section>
    </div></body></html>`;
}

function renderAdminLogin(error = ''){
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>鍚庡彴鐧诲綍</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f7f2e9;color:#443322;font-family:Arial,"Noto Serif SC",serif}.box{width:min(420px,92vw);background:#fffbf5;border:1px solid #e2d0b8;border-radius:10px;padding:26px;box-shadow:0 8px 28px rgba(139,90,43,.15)}h1{margin:0 0 18px;color:#8c2318;font-size:24px}input{width:100%;padding:12px;border:1px solid #d8c6b0;border-radius:6px;font-size:16px}button{width:100%;margin-top:14px;padding:12px;border:0;border-radius:6px;background:#8c2318;color:#fff;font-size:16px;cursor:pointer}.err{color:#b42a2a;margin:10px 0;font-size:13px}.hint{color:#997755;font-size:13px;line-height:1.6}</style></head><body><form class="box" method="post" action="${ADMIN_PATH}"><h1>杩愯惀鍚庡彴鐧诲綍</h1>${error ? `<div class="err">${htmlEscape(error)}</div>` : ''}<input type="password" name="password" placeholder="璇疯緭鍏ュ悗鍙板瘑鐮? autofocus><button type="submit">鐧诲綍</button><div class="hint">鐢ㄤ簬鏌ョ湅璁块棶鐢ㄩ噺銆佺敓鎴愭鏁般€佺敤鎴烽搴﹀拰鏀粯鏃ュ織銆?/div></form></body></html>`;
}

app.get(ADMIN_PATH, (req, res) => {
    if(req.query.logout) {
        res.setHeader('Set-Cookie', 'admin_auth=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
        return res.redirect(ADMIN_PATH);
    }
    if(!ADMIN_PASSWORD) return res.status(503).send(renderAdminLogin('ADMIN_PASSWORD is not configured on the server.'));
    if(!isAdminAuthed(req)) return res.send(renderAdminLogin());
    res.send(renderAdminDashboard(req));
});

app.post(ADMIN_PATH, (req, res) => {
    if(!ADMIN_PASSWORD) return res.status(503).send(renderAdminLogin('ADMIN_PASSWORD is not configured on the server.'));
    if(String(req.body.password || '') !== ADMIN_PASSWORD) {
        return res.status(401).send(renderAdminLogin('瀵嗙爜涓嶆纭?));
    }
    res.setHeader('Set-Cookie', `admin_auth=${encodeURIComponent(adminToken())}; HttpOnly; Path=/; Max-Age=${60 * 60 * 8}; SameSite=Lax`);
    res.redirect(ADMIN_PATH);
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

app.post('/api/track', (req, res) => {
    const event = cleanStr(req.body.event || '');
    const meta = req.body.meta && typeof req.body.meta === 'object' ? req.body.meta : {};
    res.json(appendAnalyticsEvent(req, event, meta));
});

app.post('/api/share-reward', (req, res) => {
    const result = addShareReward(getUserId(req));
    appendAnalyticsEvent(req, 'share_reward', { quota: result.quota });
    res.json(result);
});

// --------------------------------------------------------
// PayPal 鏀粯璇锋眰锛圧EST API 姝ｅ紡鐗堬級
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
// PayPal IPN锛堝畼鏂瑰紓姝ラ€氱煡 + 涓夊眰瀹夊叏鏍￠獙锛?// --------------------------------------------------------
app.post('/api/paypal-ipn', express.urlencoded({ extended: false }), async (req, res) => {
    const ipn = req.body;
    log(`浣犳槸闈㈠悜娴峰鐢ㄦ埛鐨勪腑鏂囪捣鍚嶅笀,鏍规嵁鎬у埆,椋庢牸鐢熸垚鍚嶅瓧,杈撳嚭鏍煎紡:涓枃鍚?鎷奸煶+鑻辨枃閲婁箟+瀵撴剰瑙ｆ瀽`);

    if(!ipn.txn_id || !ipn.payment_status) {
        appendPaymentLog({ err: 'Missing required fields', ipn: JSON.stringify(ipn).substring(0,200) });
        return res.status(400).send('Missing required fields');
    }

    if(ipn.payment_status !== 'Completed') {
        appendPaymentLog({ status: ipn.payment_status, txn: ipn.txn_id, err: 'Payment not completed' });
        return res.send('ok');
    }

    // 瑙ｆ瀽濂楅锛圧EST API 閫氳繃 custom 瀛楁浼犻€掞級
    const pkg = ipn.custom || 'basic';
    const userId = ipn.custom || getUserId(req);

    // === 涓夊眰瀹夊叏鏍￠獙锛圛PN 寮傛閫氱煡鏍￠獙锛宔mail 浠?.env 璇诲彇锛?==
    const paypalEmail = process.env.PAYPAL_EMAIL || '';
    if(paypalEmail && ipn.receiver_email && ipn.receiver_email.toLowerCase() !== paypalEmail.toLowerCase()) {
        appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: `浣犳槸闈㈠悜娴峰鐢ㄦ埛鐨勪腑鏂囪捣鍚嶅笀,鏍规嵁鎬у埆,椋庢牸鐢熸垚鍚嶅瓧,杈撳嚭鏍煎紡:涓枃鍚?鎷奸煶+鑻辨枃閲婁箟+瀵撴剰瑙ｆ瀽` });
        logError(`浣犳槸闈㈠悜娴峰鐢ㄦ埛鐨勪腑鏂囪捣鍚嶅笀,鏍规嵁鎬у埆,椋庢牸鐢熸垚鍚嶅瓧,杈撳嚭鏍煎紡:涓枃鍚?鎷奸煶+鑻辨枃閲婁箟+瀵撴剰瑙ｆ瀽`);
        return res.send('ok');
    }

    // 鈶?甯佺鏍￠獙锛堜粎鏀寔USD锛?    if(ipn.mc_currency !== 'USD') {
        appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: `浣犳槸闈㈠悜娴峰鐢ㄦ埛鐨勪腑鏂囪捣鍚嶅笀,鏍规嵁鎬у埆,椋庢牸鐢熸垚鍚嶅瓧,杈撳嚭鏍煎紡:涓枃鍚?鎷奸煶+鑻辨枃閲婁箟+瀵撴剰瑙ｆ瀽` });
        logError(`浣犳槸闈㈠悜娴峰鐢ㄦ埛鐨勪腑鏂囪捣鍚嶅笀,鏍规嵁鎬у埆,椋庢牸鐢熸垚鍚嶅瓧,杈撳嚭鏍煎紡:涓枃鍚?鎷奸煶+鑻辨枃閲婁箟+瀵撴剰瑙ｆ瀽`);
        return res.send('ok');
    }

    // 鈶?閲戦鏍￠獙
    const expected = { basic:'9.90', premium:'19.90', ultimate:'29.90' };
    if(ipn.mc_gross !== expected[pkg]) {
        appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: `浣犳槸闈㈠悜娴峰鐢ㄦ埛鐨勪腑鏂囪捣鍚嶅笀,鏍规嵁鎬у埆,椋庢牸鐢熸垚鍚嶅瓧,杈撳嚭鏍煎紡:涓枃鍚?鎷奸煶+鑻辨枃閲婁箟+瀵撴剰瑙ｆ瀽` });
        logError(`浣犳槸闈㈠悜娴峰鐢ㄦ埛鐨勪腑鏂囪捣鍚嶅笀,鏍规嵁鎬у埆,椋庢牸鐢熸垚鍚嶅瓧,杈撳嚭鏍煎紡:涓枃鍚?鎷奸煶+鑻辨枃閲婁箟+瀵撴剰瑙ｆ瀽`);
        return res.send('ok');
    }

    // 閫氳繃鍏ㄩ儴鏍￠獙锛岃В閿佸椁?    try {
        unlockPackage(userId, pkg, ipn.txn_id);
        appendPaymentLog({ status: ipn.payment_status, txn: ipn.txn_id, userId, pkg, success: true });
        log(`浣犳槸闈㈠悜娴峰鐢ㄦ埛鐨勪腑鏂囪捣鍚嶅笀,鏍规嵁鎬у埆,椋庢牸鐢熸垚鍚嶅瓧,杈撳嚭鏍煎紡:涓枃鍚?鎷奸煶+鑻辨枃閲婁箟+瀵撴剰瑙ｆ瀽`);
    } catch(err) {
        appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: err.message });
        logError(`浣犳槸闈㈠悜娴峰鐢ㄦ埛鐨勪腑鏂囪捣鍚嶅笀,鏍规嵁鎬у埆,椋庢牸鐢熸垚鍚嶅瓧,杈撳嚭鏍煎紡:涓枃鍚?鎷奸煶+鑻辨枃閲婁箟+瀵撴剰瑙ｆ瀽`);
    }

    res.send('ok');
});

// --------------------------------------------------------
// PayPal 鍚屾鍥炶皟
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
    log(`浣犳槸闈㈠悜娴峰鐢ㄦ埛鐨勪腑鏂囪捣鍚嶅笀,鏍规嵁鎬у埆,椋庢牸鐢熸垚鍚嶅瓧,杈撳嚭鏍煎紡:涓枃鍚?鎷奸煶+鑻辨枃閲婁箟+瀵撴剰瑙ｆ瀽`);
    res.json({ success: true });
});

// --------------------------------------------------------
// 寮傚父璁㈠崟鏃ュ織鏌ヨ
// --------------------------------------------------------
app.get('/admin-payment-log', (req, res) => {
    fs.readFile(PAYMENT_LOG_FILE, 'utf8', (err, data) => {
        if(err) return res.send('鏆傛棤鏀粯鏃ュ織');
        const logs = JSON.parse(data);
        const html = `浣犳槸闈㈠悜娴峰鐢ㄦ埛鐨勪腑鏂囪捣鍚嶅笀,鏍规嵁鎬у埆,椋庢牸鐢熸垚鍚嶅瓧,杈撳嚭鏍煎紡:涓枃鍚?鎷奸煶+鑻辨枃閲婁箟+瀵撴剰瑙ｆ瀽` + logs.map(l => `<tr style="background:${l.success?'#f0fff0':'#fff0f0'}">
        <td>${l._ts||''}</td><td>${l.txn||''}</td><td>${l.pkg||''}</td><td>${l.userId||''}</td><td>${l.status||''}</td><td>${l.err||(l.success?'鉁呮垚鍔?:'鉂屽け璐?)}</td>
        </tr>`).join('');
        res.send(html);
    });
});

// ============================================================
// 璧峰悕API锛圖eepSeek 鍞竴鎺ュ彛锛?// 鍙?rateLimitMiddleware 淇濇姢
// ============================================================
app.post('/api/generate-name', rateLimitMiddleware, async (req, res) => {
    const { englishName, englishSurname, gender, birthYear, birthMonth, birthDay, birthTime, style, meaning } = req.body;
    // 鍏煎鍓嶇鏃у瓧娈靛悕 givenName鈫抏nglishName, surname鈫抏nglishSurname
    const givenName = cleanStr(req.body.givenName) || cleanStr(englishName);
    const surname = cleanStr(req.body.surname) || cleanStr(englishSurname);
    // 鍏煎 birthDate 鎷嗚В涓?birthYear/Month/Day
    const bd = cleanStr(req.body.birthDate) || '';
    const by = cleanStr(req.body.birthYear) || (bd.match(/^(\d{4})/)?.[1]) || cleanStr(birthYear) || '';
    const bm = cleanStr(req.body.birthMonth) || (bd.match(/[-/](\d{1,2})/)?.[1]) || cleanStr(birthMonth) || '';
    const bd2 = cleanStr(req.body.birthDay) || (bd.match(/[-/](\d{1,2})[-/](\d{1,2})/)?.[2]) || cleanStr(birthDay) || '';
    const finalEnglishName = givenName;
    const finalEnglishSurname = surname;
    const finalGender = cleanStr(gender);
    // 鎬у埆鎻愬彇锛氬師濮嬪€间笉璧癱leanStr锛岀洿鎺ヨ瘑鍒嫳鏂嘙ale/Female/涓€?    const rawGender = gender || '';
    const genderDisplay = rawGender.toLowerCase().includes('female') ? 'Female' :
                        rawGender.toLowerCase().includes('male') ? 'Male' : '涓€?;
    const finalStyle = cleanStr(style);
    const finalMeaning = cleanStr(meaning);

    // 鍩虹杈撳叆鏍￠獙锛坋nglishName/surname 蹇呭～锛宮eaning/style/gender 鍙┖锛?    if (!finalEnglishName || !finalEnglishSurname) {
        return res.status(400).json({ error: 'englishName and englishSurname are required' });
    }
    if (typeof finalEnglishName !== 'string' || typeof finalEnglishSurname !== 'string' ||
        finalEnglishName.length > 50 || finalEnglishSurname.length > 50) {
        return res.status(400).json({ error: 'Invalid name length' });
    }
    // gender 鍙┖锛涜瘑鍒嫳鏂?Male/Female锛屽叾浣欎负涓€?Neutral
    if (rawGender.trim().length > 0) {
        const g = rawGender.toLowerCase();
        if (!g.includes('male') && !g.includes('female')) {
            return res.status(400).json({ error: 'gender must be Male/Female' });
        }
    }
    // meaning/style 鍧囧彲閫夛紝绌哄€间笉鎷︽埅

    const userId = getUserId(req);
    const status = getUserStatus(userId);
    const devTest = isLocalDevTest(req);

    const shouldUseFreeQuota = !devTest && (status.package === 'free' || !status.package);

    // 鍏嶈垂鐢ㄦ埛鍏堟牎楠岄厤棰濓紝鐢熸垚鎴愬姛鍚庡啀鎵ｅ噺锛岄伩鍏岮I澶辫触涔熸秷鑰楁鏁般€?    if(shouldUseFreeQuota) {
        if((status.quota || 0) <= 0) {
            return res.status(402).json({ error: 'quota exhausted', showPaywall: true });
        }
    }

    const birthText = `${by || ''}-${bm || ''}-${bd2 || ''} ${cleanStr(birthTime) || ''}`.trim();
    const prompt = `You are a bilingual Chinese naming specialist for overseas users. Create one meaningful Chinese full name for a client.

Fixed naming rules:
1. Match the client's English surname to a real Chinese surname from the Hundred Family Surnames by sound, tone, temperament, or cultural image.
2. Consider birth year/month/day/time (${birthText || 'not provided'}) through I Ching, yin-yang, five-elements, and traditional time-period symbolism.
3. Select given-name characters inspired by the Book of Songs, Chu Ci, the I Ching, or other Chinese classics.
4. The result must be culturally meaningful, not a random translation or phonetic joke.
5. Explain the surname, given name, classical source, and overall meaning in both Chinese and English.

Client:
English given name: ${finalEnglishName}
English surname: ${finalEnglishSurname}
Gender: ${genderDisplay}
Preferred style: ${finalStyle || 'refined and natural'}
Meaning preference: ${finalMeaning || 'grace, wisdom, harmony'}

Return only valid JSON with this exact shape:
{
  "chineseName": "涓枃濮撳悕",
  "pinyin": "Pinyin with tone-friendly spacing",
  "pronunciation": "Simple English pronunciation guide",
  "meaning": "One-sentence English summary",
  "sections": [
    {"titleCn":"濮撴皬瑙ｉ噴","titleEn":"Surname Explanation","cn":"涓枃璇存槑","en":"English explanation"},
    {"titleCn":"鍚嶅瓧瑙ｉ噴","titleEn":"Given Name Explanation","cn":"涓枃璇存槑","en":"English explanation"},
    {"titleCn":"鍙ょ睄鍑哄","titleEn":"Classical Source","cn":"涓枃璇存槑","en":"English explanation"},
    {"titleCn":"鏁翠綋瀵撴剰","titleEn":"Overall Meaning","cn":"涓枃璇存槑","en":"English explanation"}
  ]
}`;

    const deepseek = { url:'https://api.deepseek.com/v1/chat/completions', model: "deepseek-chat" };

    async function callAI() {
        if(!process.env.DEEPSEEK_API_KEY) {
            throw new Error('DEEPSEEK_API_KEY is not configured');
        }
        const body = {
            model: deepseek.model,
            messages:[
                {role:'system', content:'Return strict JSON only. No markdown fences. No extra commentary.'},
                {role:'user',content:prompt}
            ],
            temperature:0.65,
            response_format:{ type:'json_object' }
        };
        console.log('[DeepSeek] prompt:', prompt.substring(0, 300));
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);
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
        log(`浣犳槸闈㈠悜娴峰鐢ㄦ埛鐨勪腑鏂囪捣鍚嶅笀,鏍规嵁鎬у埆,椋庢牸鐢熸垚鍚嶅瓧,杈撳嚭鏍煎紡:涓枃鍚?鎷奸煶+鑻辨枃閲婁箟+瀵撴剰瑙ｆ瀽`);
        const result = await callAI('deepseek');
        let normalized = normalizeNameResult(result);
        if(!normalized.chineseName) {
            logError('[generate-name] AI response missing chineseName, using safe fallback');
            normalized = normalizeNameResult(buildFallbackName({
                givenName: finalEnglishName,
                surname: finalEnglishSurname,
                gender: genderDisplay,
                style: finalStyle,
                meaning: finalMeaning,
                birthText
            }));
        }
        if(shouldUseFreeQuota && !useQuota(userId)) {
            return res.status(402).json({ error: 'quota exhausted', showPaywall: true });
        }
        res.json({ success: true, devTest, data: normalized });
    } catch(err) {
        logError('[generate-name] AI failed, using safe fallback:', err.message);
        const fallback = normalizeNameResult(buildFallbackName({
            givenName: finalEnglishName,
            surname: finalEnglishSurname,
            gender: genderDisplay,
            style: finalStyle,
            meaning: finalMeaning,
            birthText
        }));
        if(shouldUseFreeQuota && !useQuota(userId)) {
            return res.status(402).json({ error: 'quota exhausted', showPaywall: true });
        }
        res.json({ success: true, devTest, data: fallback, fallback: true });
    }
});

// ============================================================
// 鐣欒█鏉?// ============================================================
app.post('/api/submit-message', (req, res) => {
    const name = cleanStr(req.body.name) || 'anonymous';
    const email = cleanStr(req.body.email) || '';
    const message = cleanStr(req.body.message) || '';
    const time = new Date().toLocaleString();
    const content = `[${time}] ${name}(${email}): ${message}\n`;
    fs.appendFile('messages.txt', content, err => {
        res.send(err ? "鐣欒█鎻愪氦澶辫触" : "鐣欒█鎻愪氦鎴愬姛锛屾劅璋㈠弽棣堬紒");
    });
});

app.get('/admin-messages', (req, res) => {
    fs.readFile('messages.txt', 'utf8', (err, data) => {
        if(err) res.send("鏆傛棤鐣欒█");
        else res.send(`浣犳槸闈㈠悜娴峰鐢ㄦ埛鐨勪腑鏂囪捣鍚嶅笀,鏍规嵁鎬у埆,椋庢牸鐢熸垚鍚嶅瓧,杈撳嚭鏍煎紡:涓枃鍚?鎷奸煶+鑻辨枃閲婁箟+瀵撴剰瑙ｆ瀽`);
    });
});

// ============================================================
// 椤甸潰璺敱
// ============================================================
app.get('/brand-intro',      (req, res) => res.sendFile(path.join(__dirname, 'brand-intro.html')));
app.get('/contact-us',        (req, res) => res.sendFile(path.join(__dirname, 'contact-us.html')));
app.get('/terms',             (req, res) => res.sendFile(path.join(__dirname, 'terms.html')));
app.get('/privacy',           (req, res) => res.sendFile(path.join(__dirname, 'privacy.html')));
app.get('/faq',               (req, res) => res.sendFile(path.join(__dirname, 'faq.html')));
app.get('/payment-guide',     (req, res) => res.sendFile(path.join(__dirname, 'payment-guide.html')));

// ============================================================
// 涔︽硶澶村儚锛堝悗绔覆鏌撳厹搴曪級
// ============================================================
app.get('/api/avatar-svg', (req, res) => {
    const name = (req.query.name || '鏉庢槑').replace(/[^涓€-榫/g, '').substring(0, 6);
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
    <text x="24" y="19" font-size="12" text-anchor="middle" fill="#f8ead2" font-family="STXingkai, KaiTi, serif">闆?/text>
    <text x="24" y="35" font-size="12" text-anchor="middle" fill="#f8ead2" font-family="STXingkai, KaiTi, serif">鍚?/text>
  </g>
</svg>`;
    res.type('image/svg+xml').send(svg);
});

// ============================================================
// 閿欒澶勭悊涓棿浠讹紙姝ｅ紡鐜灞忚斀鎶ラ敊鏍堬級
// ============================================================
app.use((err, req, res, next) => {
    // 鎹曡幏 JSON 瑙ｆ瀽閿欒
    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
        return res.status(400).json({ error: 'Invalid JSON payload' });
    }
    if (!IS_PROD) {
        console.error(err.stack);
    }
    res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// 闈欐€佹枃浠舵湇鍔★紙favicon.ico 绛夛級
// ============================================================
app.use(express.static(path.join(__dirname, "./")));

// ============================================================
// 404 鍏ㄥ眬澶勭悊锛堥潤鎬佹枃浠朵箣鍚庯級
// ============================================================
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// ============================================================
// 鍚姩
// ============================================================
app.listen(port, () => {
    console.log(`浣犳槸闈㈠悜娴峰鐢ㄦ埛鐨勪腑鏂囪捣鍚嶅笀,鏍规嵁鎬у埆,椋庢牸鐢熸垚鍚嶅瓧,杈撳嚭鏍煎紡:涓枃鍚?鎷奸煶+鑻辨枃閲婁箟+瀵撴剰瑙ｆ瀽`);
    console.log(`Server is running on port ${port}`);
});
