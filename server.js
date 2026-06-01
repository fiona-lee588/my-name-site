require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// ============================================================
// 环境配置（全部从 .env 读取，禁止硬编码）
// ============================================================
const IS_PROD     = process.env.NODE_ENV === 'production';
const DOMAIN      = process.env.DOMAIN   || (IS_PROD ? 'https://mychinesename.co' : `http://localhost:${port}`);
const CORS_ORIGIN = process.env.CORS_ORIGIN || (IS_PROD ? 'https://mychinesename.co' : '*');
const LOG_LEVEL   = process.env.LOG_LEVEL || (IS_PROD ? 'error' : 'debug');

// 仅在非正式环境输出启动日志
const log = (...args) => { if(!IS_PROD) console.log(...args); };
const logError = (...args) => { console.error(...args); };

log("DeepSeek密钥：", !!process.env.DEEPSEEK_API_KEY);
log("Anthropic密钥：", !!process.env.ANTHROPIC_API_KEY);
log("PayPal模式：", process.env.PAYPAL_MODE || 'sandbox');
log("网站域名：", DOMAIN);

// ============================================================
// CORS 配置
// ============================================================
app.use(cors({ origin: CORS_ORIGIN, methods: ["GET","POST","OPTIONS"], allowedHeaders: ["Content-Type","X-User-Id","X-Package"] }));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.header('Access-Control-Allow-Headers', "Content-Type, X-User-Id, X-Package");
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    next();
});
app.use(express.json());

// ============================================================
// 安全中间件：IP 限流 + 频率限制
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
        logError(`[RateLimit] IP ${ip} blocked for 10min (exceeded ${RATE_LIMIT_MAX} req/min)`);
        return res.status(429).json({ error: 'Too many requests, please try again later.' });
    }

    next();
}

// 通用请求日志（仅非正式环境）
app.use((req, res, next) => {
    if(!IS_PROD) {
        const ip = getClientIp(req);
        log(`[${new Date().toISOString()}] ${req.method} ${req.path} from ${ip}`);
    }
    next();
});

// ============================================================
// PayPal 配置（从 .env 读取）
// ============================================================
const PAYPAL = {
    email: process.env.PAYPAL_EMAIL || '',
    mode:  process.env.PAYPAL_MODE  || 'sandbox',
    get verifyUrl() {
        return this.mode === 'live'
            ? 'https://ipnpb.paypal.com/cgi-bin/websrc'
            : 'https://ipnpb.sandbox.paypal.com/cgi-bin/websrc';
    },
    get baseUrl() {
        return this.mode === 'live' ? 'https://api.paypal.com' : 'https://api.sandbox.paypal.com';
    }
};

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
    log(`✅ 用户 ${userId} 套餐解锁: ${pkg} | quota=${ent.quota}`);
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
// PayPal 支付请求
// --------------------------------------------------------
app.post('/api/paypal-order', (req, res) => {
    const { package: pkg } = req.body;
    if(!PACKAGE_ENTITLEMENTS[pkg]) return res.status(400).json({ error: 'Unknown package' });

    const amounts = { basic:'9.9', premium:'19.9', ultimate:'29.9' };
    const amount = amounts[pkg];
    const returnUrl  = encodeURIComponent(`${DOMAIN}/payment-success.html?pkg=${pkg}`);
    const cancelUrl  = encodeURIComponent(`${DOMAIN}/payment-cancel.html`);
    const notifyUrl  = encodeURIComponent(`${DOMAIN}/api/paypal-ipn`);

    // PayPal 按钮链接（无需ClientID，适合个人认证账户）
    const paypalUrl = `https://www.paypal.com/cgi-bin/websrc` +
        `?cmd=_xclick` +
        `&business=${encodeURIComponent(PAYPAL.email)}` +
        `&item_name=MyChineseName_${pkg.toUpperCase()}` +
        `&amount=${amount}&currency=USD` +
        `&return=${returnUrl}&cancel_return=${cancelUrl}&notify_url=${notifyUrl}` +
        `&custom=${getUserId(req)}`;

    log(`💰 [PayPal] 订单: ${pkg} $${amount} from ${getUserId(req)}`);
    res.json({ paypalUrl });
});

// --------------------------------------------------------
// PayPal IPN（官方异步通知 + 三层安全校验）
// --------------------------------------------------------
app.post('/api/paypal-ipn', express.urlencoded({ extended: false }), async (req, res) => {
    const ipn = req.body;
    log(`📨 [PayPal IPN] 收到: ${JSON.stringify(ipn).substring(0,150)}`);

    if(!ipn.txn_id || !ipn.payment_status) {
        appendPaymentLog({ err: 'Missing required fields', ipn: JSON.stringify(ipn).substring(0,200) });
        return res.status(400).send('Missing required fields');
    }

    if(ipn.payment_status !== 'Completed') {
        appendPaymentLog({ status: ipn.payment_status, txn: ipn.txn_id, err: 'Payment not completed' });
        return res.send('ok');
    }

    // 解析套餐
    const pkgKey = (ipn.item_name || '').toUpperCase().replace(/MYCHINESENAME_/i, '');
    const pkg = ({'BASIC':'basic','PREMIUM':'premium','ULTIMATE':'ultimate'}[pkgKey]) || 'basic';
    const userId = ipn.custom || getUserId(req);

    // === 三层安全校验 ===
    // ① 收款邮箱校验
    if(PAYPAL.email && ipn.receiver_email && ipn.receiver_email.toLowerCase() !== PAYPAL.email.toLowerCase()) {
        appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: `Receiver email mismatch: expected=${PAYPAL.email}, got=${ipn.receiver_email}` });
        logError(`❌ [IPN] 收款邮箱校验失败: ${ipn.receiver_email}`);
        return res.send('ok');
    }

    // ② 币种校验（仅支持USD）
    if(ipn.mc_currency !== 'USD') {
        appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: `Currency not USD: got=${ipn.mc_currency}` });
        logError(`❌ [IPN] 币种校验失败: ${ipn.mc_currency}`);
        return res.send('ok');
    }

    // ③ 金额校验
    const expected = { basic:'9.90', premium:'19.90', ultimate:'29.90' };
    if(ipn.mc_gross !== expected[pkg]) {
        appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: `Amount mismatch: expected=${expected[pkg]}, got=${ipn.mc_gross}` });
        logError(`❌ [IPN] 金额校验失败: ${pkg} expected=${expected[pkg]} got=${ipn.mc_gross}`);
        return res.send('ok');
    }

    // 通过全部校验，解锁套餐
    try {
        unlockPackage(userId, pkg, ipn.txn_id);
        appendPaymentLog({ status: ipn.payment_status, txn: ipn.txn_id, userId, pkg, success: true });
        log(`✅ [IPN] 套餐解锁: ${pkg} -> ${userId}`);
    } catch(err) {
        appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: err.message });
        logError(`❌ [IPN] 解锁异常: ${err.message}`);
    }

    res.send('ok');
});

// --------------------------------------------------------
// PayPal 同步回调
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
    log(`✅ [Checkout] 用户 ${userId} 套餐 ${pkg} 已标记 (txn: ${transactionId})`);
    res.json({ success: true });
});

// --------------------------------------------------------
// 异常订单日志查询
// --------------------------------------------------------
app.get('/admin-payment-log', (req, res) => {
    fs.readFile(PAYMENT_LOG_FILE, 'utf8', (err, data) => {
        if(err) return res.send('暂无支付日志');
        const logs = JSON.parse(data);
        const html = `<html><head><meta charset="UTF-8"><title>Payment Logs</title></head><body>
        <h2 style="padding:20px">💳 支付日志 <a href="/">← 返回首页</a></h2>
        <table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%">
        <tr style="background:#8c2318;color:#fff"><th>时间</th><th>Txn</th><th>套餐</th><th>用户</th><th>状态</th><th>备注</th></tr>
        ${logs.map(l => `<tr style="background:${l.success?'#f0fff0':'#fff0f0'}">
        <td>${l._ts||''}</td><td>${l.txn||''}</td><td>${l.pkg||''}</td><td>${l.userId||''}</td><td>${l.status||''}</td><td>${l.err||(l.success?'✅成功':'❌失败')}</td>
        </tr>`).join('')}</table></body></html>`;
        res.send(html);
    });
});

// ============================================================
// 起名API（DeepSeek 主接口 + Claude 备用，自动重试）
// 受 rateLimitMiddleware 保护
// ============================================================
app.post('/api/generate-name', rateLimitMiddleware, async (req, res) => {
    const { englishName, englishSurname, gender, birthYear, birthMonth, birthDay, birthTime, style, meaning } = req.body;
    const userId = getUserId(req);
    const status = getUserStatus(userId);

    // 免费用户扣配额
    if(status.package === 'free' || !status.package) {
        if(!useQuota(userId)) {
            return res.status(402).json({ error: 'quota exhausted', showPaywall: true });
        }
    }

    const prompt = `你是专业国风中文起名大师，为海外用户起名，严格遵守以下规则：
1. 姓氏：根据英文姓氏"${englishSurname}"，匹配中国百家姓对应中文姓氏
2. 名字：单字或双字，取自《诗经》《楚辞》《论语》《易经》等古典典籍
3. 五行：${status.wuxingLevel === 'full' ? '完整八字五行解析' : '极简一句话：生辰八字XX，喜用神为XX，宜用XX五行'}
4. ${status.culturalDepth ? '诗经/楚辞完整典故溯源' : '仅输出基础古籍出处一句话，无完整典故、无证书'}
5. 英文翻译：每一句中文直接放在中文正下方
6. 用户偏好：${meaning || '无特殊要求'}
输出格式：
【完整中文姓名】：姓+名
【对应百家姓姓氏】：XXX
【五行喜用】：极简一句话
【诗经/典籍出处】：原文+出处（仅一句话）
【寓意解读】：中文（仅一句话）
（对应英文翻译，放在中文正下方）`;

    const deepseek = { url:'https://api.deepseek.com/v1/chat/completions', model: "deepseek-chat", key:process.env.DEEPSEEK_API_KEY };
    const anthropic = { url:'https://api.anthropic.com/v1/messages', model:'claude-sonnet-4-20250514', key:process.env.ANTHROPIC_API_KEY };

    async function callAI(provider, retryCount = 0) {
        const MAX_RETRIES = 2;
        if(retryCount > MAX_RETRIES) throw new Error('Max retries exceeded');
        const body = provider === 'deepseek'
            ? { model: deepseek.model, messages:[{role:'user',content:prompt}], temperature:0.7 }
            : { model: anthropic.model, max_tokens:600, messages:[{role:'user',content:prompt}] };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        try {
            const resp = await fetch(provider === 'deepseek' ? deepseek.url : anthropic.url, {
                method:'POST', signal:controller.signal,
                headers: provider === 'deepseek'
                    ? {'Content-Type':'application/json','Authorization':`Bearer ${deepseek.key}`}
                    : {'Content-Type':'application/json','x-api-key':anthropic.key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
                body: JSON.stringify(body)
            });
            clearTimeout(timeout);
            const data = await resp.json();
            if(!resp.ok) {
                logError(`${provider} error ${resp.status}:`, JSON.stringify(data).substring(0,100));
                if(retryCount === 0) return callAI(provider === 'deepseek' ? 'anthropic' : 'deepseek', 1);
                throw new Error(data.error?.message || `HTTP ${resp.status}`);
            }
            return provider === 'deepseek' ? data.choices[0].message.content : data.content[0].text;
        } catch(err) {
            clearTimeout(timeout);
            logError(`[${provider}] error:`, err.message);
            if(retryCount < MAX_RETRIES) return callAI(provider === 'deepseek' ? 'anthropic' : 'deepseek', retryCount + 1);
            throw err;
        }
    }

    try {
        log(`===【AI起名请求】 user=${userId}===`);
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
    const { name, email, message } = req.body;
    const time = new Date().toLocaleString();
    const content = `【留言时间】${time}\n姓名：${name}\n邮箱：${email}\n留言：${message}\n----------------------------------------\n`;
    fs.appendFile('messages.txt', content, err => {
        res.send(err ? "留言提交失败" : "留言提交成功，感谢反馈！");
    });
});

app.get('/admin-messages', (req, res) => {
    fs.readFile('messages.txt', 'utf8', (err, data) => {
        if(err) res.send("暂无留言");
        else res.send(`<pre style="padding:20px;white-space:pre-wrap;font-size:14px">${data}</pre>`);
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
        ? `<radialGradient id="${gradId}" cx="50%" cy="50%" r="60%"><stop offset="0%" stop-color="${b.colors[0]}"/><stop offset="100%" stop-color="${b.colors[1]}"/></radialGradient>`
        : `<linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${b.colors[0]}"/><stop offset="100%" stop-color="${b.colors[1]}"/></linearGradient>`;
    const svg = `<svg width="1080" height="1080" xmlns="http://www.w3.org/2000/svg">
    <defs>${bgDef}<filter id="ink"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="4" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="3"/></filter></defs>
    <rect width="1080" height="1080" fill="url(#${gradId})"/>
    <rect x="40" y="40" width="1000" height="1000" fill="none" stroke="#8c2318" stroke-width="3" rx="15"/>
    <rect x="55" y="55" width="970" height="970" fill="none" stroke="#c9a96e" stroke-width="1.5" rx="10"/>
    <text x="540" y="540" font-size="220" text-anchor="middle" fill="#1a1a1a" font-family="${font}" filter="url(#ink)" letter-spacing="12">${name}</text>
    <text x="540" y="900" font-size="28" text-anchor="middle" fill="#8c2318" font-family="ZCOOLKuaiLe, KaiTi, serif">mychinesename.co</text>
</svg>`;
    res.type('image/svg+xml').send(svg);
});

// ============================================================
// 启动
// ============================================================
	app.use(express.static(path.join(__dirname, "./")));

// ============================================================
// CORS 跨域配置（允许 Netlify 前端访问）
// ============================================================
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Id, X-Package');
    next();
});

app.listen(port, () => {
    console.log(`网站运行在 ${DOMAIN}`);
    console.log(`后台留言：http://localhost:${port}/admin-messages`);
    console.log(`后台支付日志：http://localhost:${port}/admin-payment-log`);
    if(PAYPAL.email) console.log(`💳 PayPal收款：${PAYPAL.email} (${PAYPAL.mode})`);
    else console.warn('⚠️ 请在 .env 配置 PAYPAL_EMAIL');
    if(IS_PROD) console.log('🔒 正式环境：调试日志已关闭，限流严格（5次/分钟）');
});