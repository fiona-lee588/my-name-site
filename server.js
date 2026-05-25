const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const app = express();
const port = 3000;

// 跨域、静态资源、解析JSON
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    next();
});
app.use(express.json());
app.use(express.static('./'));

// DeepSeek密钥（替换为你的sk-xxx）
const DEEPSEEK_KEY = "sk-d878acfa22a84823a24d1f854cd58187";
const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

// 起名接口（严格格式：百家姓、极简五行、单/双字名、英文内嵌）
app.post('/api/getChineseName', async (req, res) => {
    try {
        const { gender, englishName, englishSurname, birthYear, birthMonth, birthDay, birthTime, style, meaning } = req.body;
        const prompt = `
你是专业国风中文起名大师，为海外用户起名，严格遵守以下规则：
1. 姓氏：根据英文姓氏${englishSurname}，匹配中国百家姓对应中文姓氏，格式：【对应百家姓姓氏】：XX（出自百家姓XX条目）
2. 名字：单字或双字，取自《诗经》《楚辞》《论语》等古典典籍
3. 五行：只输出极简一句话，格式：【五行喜用】：生辰八字XX，喜用神为XX，宜用XX五行，禁止长篇拆解
4. 必须保留：【诗经/典籍出处】【寓意解读】
5. 英文翻译：每一句中文直接放在中文正下方，不要单独一栏英文
6. 输出简洁精炼，不要啰嗦
输出格式严格：
【完整中文姓名】：姓+名（1-2字）
【对应百家姓姓氏】：XXX
【五行喜用】：极简一句话八字+喜用神
【诗经/典籍出处】：原文+出处
【寓意解读】：中文
（对应英文翻译，放在中文正下方）
        `;

        const response = await axios.post(DEEPSEEK_URL, {
            model: "deepseek-chat",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7
        }, {
            headers: { Authorization: `Bearer ${DEEPSEEK_KEY}`, "Content-Type": "application/json" }
        });

        res.send(response.data.choices[0].message.content);
    } catch (err) {
        console.error(err);
        res.send("生成失败，请稍后重试 | Generation failed, please try again later");
    }
});

// ========== 新增：留言板接口 ==========
// 接收用户留言并保存到本地文件
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
    // 保存到messages.txt，你直接打开就能看
    fs.appendFile('messages.txt', content, (err) => {
        if (err) {
            res.send("留言提交失败 | Message submit failed");
        } else {
            res.send("留言提交成功，感谢反馈！| Message sent successfully, thank you!");
        }
    });
});

// 查看所有留言（仅你后台访问：localhost:3000/admin-messages）
app.get('/admin-messages', (req, res) => {
    fs.readFile('messages.txt', 'utf8', (err, data) => {
        if (err) res.send("暂无留言 | No messages yet");
        else res.send(`<pre style="padding:20px;white-space:pre-wrap;font-size:14px">${data}</pre>`);
    });
});

// ========== 底部页面路由（完整中英文子页面） ==========
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