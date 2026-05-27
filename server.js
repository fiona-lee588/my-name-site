const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const app = express();
const port = 3000;

// CORS 跨域预检配置
const cors = require('cors');
app.use(cors({
  origin: "https://mychinesename.co",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));
// 处理浏览器跨域预检 OPTIONS 请求
app.options('*', cors());

// 跨域、静态资源、解析JSON
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', 'https://mychinesename.co');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-User-Id, X-Package');
    next();
});
app.use(express.json());
app.use(express.static('./'));

// DeepSeek密钥
const DEEPSEEK_KEY = "sk-d878acfa22a84823a24d1f854cd58187";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

// 内部测试密码
const TEST_CODE = 'Test2026';

// 用户状态文件路径
const USER_STATE_FILE = path.join(__dirname, 'user-state.json');

// 读写用户状态
function readUserState(){
    try {
        if(!fs.existsSync(USER_STATE_FILE)) return {};
        const data = fs.readFileSync(USER_STATE_FILE, 'utf8');
        return JSON.parse(data);
    } catch { return {}; }
}
function writeUserState(state){
    fs.writeFileSync(USER_STATE_FILE, JSON.stringify(state, null, 2));
}

// 获取或创建用户ID（基于IP简单识别）
function getUserId(req){
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const userId = req.headers['x-user-id'] || ('user_' + ip.replace(/\./g, '_'));
    return userId;
}

// 免费次数扣减（返回是否成功）
function useQuota(userId){
    const state = readUserState();
    const user = state[userId] || { quota: 2, package: 'free' };
    if(user.quota <= 0) return false;
    user.quota -= 1;
    state[userId] = user;
    writeUserState(state);
    return true;
}

// 分享奖励（增加1次免费次数）
function addShareReward(userId){
    const state = readUserState();
    const user = state[userId] || { quota: 2, package: 'free' };
    user.quota = (user.quota || 0) + 1;
    state[userId] = user;
    writeUserState(state);
    return { success: true, quota: user.quota };
}

// 查询用户状态
function getUserStatus(userId){
    const state = readUserState();
    return state[userId] || { quota: 2, package: 'free' };
}

// 分享奖励接口
app.post('/api/share-reward', (req, res) => {
    const userId = getUserId(req);
    const result = addShareReward(userId);
    res.json(result);
});

// 测试码解锁接口
app.post('/api/test-unlock', (req, res) => {
    const { code } = req.body;
    if(code === TEST_CODE){
        const userId = getUserId(req);
        const state = readUserState();
        const user = state[userId] || { quota: 2, package: 'free' };
        user.quota = 9999; // 无限次
        user.package = 'test';
        state[userId] = user;
        writeUserState(state);
        res.json({ success: true, message: '测试模式解锁成功 | Test mode unlocked' });
    } else {
        res.status(403).json({ success: false, message: '测试码错误 | Incorrect test code' });
    }
});

// 查询当前用户免费次数
app.get('/api/quota', (req, res) => {
    const userId = getUserId(req);
    const status = getUserStatus(userId);
    res.json({ quota: status.quota, package: status.package });
});

// 起名接口（含免费次数校验）
app.post('/api/getChineseName', async (req, res) => {
    const userId = getUserId(req);
    const state = readUserState();
    const userStatus = state[userId] || { quota: 2, package: 'free' };

    // 测试模式全局跳过次数检查
    if(userStatus.package !== 'test'){
        // 免费用户次数耗尽
        if(userStatus.quota <= 0 && userStatus.package === 'free'){
            return res.status(403).json({
                error: '免费次数已用完 | No free attempts left',
                message: '您的免费起名次数已用完，分享给好友可额外获得1次免费机会，或升级付费套餐解锁更多次数与AI书法头像生成 | Your free name attempts are exhausted. Share with friends to get 1 more free try, or upgrade to a paid plan for more attempts and AI calligraphy avatar generation.'
            });
        }
        // 扣减免费次数
        if(userStatus.package === 'free'){
            if(!useQuota(userId)){
                return res.status(403).json({
                    error: '免费次数已用完 | No free attempts left',
                    message: '您的免费起名次数已用完 | Your free name attempts are exhausted.'
                });
            }
        }
    }

    try {
        const { gender, englishName, englishSurname, birthYear, birthMonth, birthDay, birthTime, style, meaning } = req.body;
        // 测试模式用 'test' package 区分
        const userPackage = userStatus.package === 'test' ? 'test' : (req.headers['x-package'] || userStatus.package || 'free');

        let prompt = '';
        if (userPackage === 'basic') {
            // 基础版：3组名字，基础五行，1次重生成，无深度典故
            prompt = `
你是专业国风中文起名大师，为海外用户起名，严格遵守以下规则：
1. 姓氏：根据英文姓氏${englishSurname}，匹配中国百家姓对应中文姓氏，格式：【对应百家姓姓氏】：XX（出自百家姓XX条目）
2. 名字：单字或双字，取自《诗经》《楚辞》《论语》等古典典籍
3. 五行：只输出极简一句话，格式：【五行喜用】：生辰八字XX，喜用神为XX，宜用XX五行，禁止长篇拆解
4. 仅输出基础古籍出处一句话，无完整典故、无证书
5. 英文翻译：每一句中文直接放在中文正下方，不要单独一栏英文
6. 输出3组姓名，每组包含完整中文姓名、百家姓、五行喜用、诗经出处、寓意解读
7. 输出简洁精炼，不要啰嗦
输出格式严格：
【完整中文姓名】：姓+名（1-2字）
【对应百家姓姓氏】：XXX
【五行喜用】：极简一句话八字+喜用神
【诗经/典籍出处】：原文+出处（仅一句话）
【寓意解读】：中文（仅一句话）
（对应英文翻译，放在中文正下方）
---分隔---
（重复以上格式输出3组）
            `;
        } else if (userPackage === 'premium') {
            // 尊享版：5组名字，完整八字+诗经楚辞溯源，生成高清证书，解锁1次高清头像
            prompt = `
你是专业国风中文起名大师，为海外用户起名，严格遵守以下规则：
1. 姓氏：根据英文姓氏${englishSurname}，匹配中国百家姓对应中文姓氏，格式：【对应百家姓姓氏】：XX（出自百家姓XX条目）
2. 名字：单字或双字，取自《诗经》《楚辞》《论语》等古典典籍
3. 五行：输出完整八字+诗经楚辞溯源
4. 输出5组姓名，每组包含完整中文姓名、百家姓、五行喜用、诗经/楚辞完整典故出处、寓意解读
5. 英文翻译：每一句中文直接放在中文正下方，不要单独一栏英文
6. 可生成高清起名证书（含姓名、五行、典故）
输出格式严格：
【完整中文姓名】：姓+名（1-2字）
【对应百家姓姓氏】：XXX
【五行喜用】：完整八字+喜用神+宜用五行
【诗经/楚辞典故溯源】：完整原文+出处+典故解读
【寓意解读】：中文
（对应英文翻译，放在中文正下方）
---分隔---
（重复以上格式输出5组）
【起名证书】：可下载高清版本（含姓名、出处、寓意）
            `;
        } else if (userPackage === 'ultimate') {
            // VIP版：不限次数，深度定制，永久保存，无限高清头像
            prompt = `
你是专业国风中文起名大师，为海外VIP用户起名，严格遵守以下规则：
1. 姓氏：根据英文姓氏${englishSurname}，匹配中国百家姓对应中文姓氏，格式：【对应百家姓姓氏】：XX（出自百家姓XX条目）
2. 名字：单字或双字，接受用户个性化需求做深度定制
3. 五行：输出完整八字+诗经楚辞+易经吉卦完整溯源
4. 不限次数生成，永久保存姓名档案，无限次高清头像
5. 英文翻译：每一句中文直接放在中文正下方，不要单独一栏英文
输出格式严格：
【完整中文姓名】：姓+名（1-2字）
【对应百家姓姓氏】：XXX
【五行喜用】：完整八字+喜用神+宜用五行
【诗经/楚辞/易经典故溯源】：完整原文+出处+典故解读
【寓意解读】：中文
【姓名档案】：永久保存，含完整典故、证书、高清头像链接
（对应英文翻译，放在中文正下方）
---分隔---
（不限次数输出，满足用户个性化需求）
            `;
        } else {
            // 免费用户：仅基础古籍一句话出处，无完整典故、无证书、无头像、无重生成
            prompt = `
你是专业国风中文起名大师，为海外用户起名，严格遵守以下规则：
1. 姓氏：根据英文姓氏${englishSurname}，匹配中国百家姓对应中文姓氏，格式：【对应百家姓姓氏】：XX（出自百家姓XX条目）
2. 名字：单字或双字，取自《诗经》《楚辞》《论语》等古典典籍
3. 五行：只输出极简一句话，格式：【五行喜用】：生辰八字XX，喜用神为XX，宜用XX五行，禁止长篇拆解
4. 仅输出基础古籍出处一句话，无完整典故、无证书、无头像、无重生成
5. 英文翻译：每一句中文直接放在中文正下方，不要单独一栏英文
6. 输出简洁精炼，不要啰嗦
输出格式严格：
【完整中文姓名】：姓+名（1-2字）
【对应百家姓姓氏】：XXX
【五行喜用】：极简一句话八字+喜用神
【诗经/典籍出处】：原文+出处（仅一句话）
【寓意解读】：中文（仅一句话）
（对应英文翻译，放在中文正下方）
            `;
        }

        const response = await axios.post(DEEPSEEK_URL, {
            model: "deepseek-chat",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7
        }, {
            headers: { Authorization: `Bearer ${DEEPSEEK_KEY}`, "Content-Type": "application/json" }
        });

        res.send(response.data.choices[0].message.content);
    } catch (err) {
        console.error('DeepSeek API error:', err.message);
        res.status(500).json({
            error: '生成失败，请稍后重试 | Generation failed, please try again later',
            message: '抱歉，服务暂时繁忙，请稍后重试 | Sorry, service is temporarily busy, please try again later'
        });
    }
});

// ========== 留言板接口 ==========
app.post('/api/submit-message', (req, res) => {
    const { name, email, message } = req.body;
    const time = new Date().toLocaleString();
    const content = `
【留言时间】${time}
姓名：${name}
邮箱：${email}
留言：${message}
----------------------------------------
`;
    fs.appendFile('messages.txt', content, (err) => {
        if (err) {
            res.send("留言提交失败 | Message submit failed");
        } else {
            res.send("留言提交成功，感谢反馈！| Message sent successfully, thank you!");
        }
    });
});

app.get('/admin-messages', (req, res) => {
    fs.readFile('messages.txt', 'utf8', (err, data) => {
        if (err) res.send("暂无留言 | No messages yet");
        else res.send(`<pre style="padding:20px;white-space:pre-wrap;font-size:14px">${data}</pre>`);
    });
});

// ========== 底部页面路由 ==========
app.get('/brand-intro', (req, res) => res.sendFile(path.join(__dirname, 'brand-intro.html')));
app.get('/contact-us', (req, res) => res.sendFile(path.join(__dirname, 'contact-us.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'privacy.html')));
app.get('/faq', (req, res) => res.sendFile(path.join(__dirname, 'faq.html')));
app.get('/payment-guide', (req, res) => res.sendFile(path.join(__dirname, 'payment-guide.html')));

app.listen(port, () => {
    console.log(`网站运行在 http://localhost:${port}`);
    console.log(`后台查看留言：http://localhost:${port}/admin-messages`);
});