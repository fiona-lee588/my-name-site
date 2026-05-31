#!/usr/bin/env node
/**
 * PayPal IPN 模拟测试脚本
 * 直接在终端运行: node test-paypal-ipn.js
 *
 * 模拟三种支付场景 + 三种异常场景，共6个测试用例
 * 自动校验：套餐匹配、权限写入、异常拦截
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const PAYPAL_EMAIL = process.env.PAYPAL_EMAIL || 'your_paypal@email.com';

const USER_STATE_FILE = path.join(__dirname, 'user-state.json');
const PAYMENT_LOG_FILE = path.join(__dirname, 'payment-log.json');

// 测试用户ID
const TEST_USER = 'test_user_simulate';

// 颜色输出
const green = (m) => `\x1b[32m${m}\x1b[0m`;
const red   = (m) => `\x1b[31m${m}\x1b[0m`;
const yellow= (m) => `\x1b[33m${m}\x1b[0m`;
const cyan  = (m) => `\x1b[36m${m}\x1b[0m`;
const bold  = (m) => `\x1b[1m${m}\x1b[0m`;

// 清除旧状态和日志
function cleanup() {
    if(fs.existsSync(USER_STATE_FILE)) {
        const state = JSON.parse(fs.readFileSync(USER_STATE_FILE, 'utf8'));
        delete state[TEST_USER];
        fs.writeFileSync(USER_STATE_FILE, JSON.stringify(state, null, 2));
    }
    if(fs.existsSync(PAYMENT_LOG_FILE)) {
        fs.writeFileSync(PAYMENT_LOG_FILE, '[]');
    }
    console.log(cyan('🧹 已清理旧状态和日志\n'));
}

// 读取当前用户状态
function getUserState() {
    try {
        const state = JSON.parse(fs.readFileSync(USER_STATE_FILE, 'utf8'));
        return state[TEST_USER] || null;
    } catch { return null; }
}

// 读取支付日志
function getPaymentLogs() {
    try {
        return JSON.parse(fs.readFileSync(PAYMENT_LOG_FILE, 'utf8'));
    } catch { return []; }
}

// 打印分隔线
function divider(title) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(bold(` ${title}`));
    console.log('='.repeat(60));
}

// 打印结果行
function resultRow(label, passed, detail) {
    const icon = passed ? green('✅ PASS') : red('❌ FAIL');
    console.log(`  ${icon}  ${label}`);
    if(detail) console.log(`       └─ ${detail}`);
}

// 打印失败原因
function failReason(msg) {
    console.log(`       └─ ${red('失败原因')}: ${msg}`);
}

// 核心：发送 IPN 请求（PayPal IPN 固定为 application/x-www-form-urlencoded）
async function sendIPN(ipnPayload) {
    try {
        const params = new URLSearchParams();
        for(const [k,v] of Object.entries(ipnPayload)) params.append(k, String(v));
        const res = await axios.post(`${BASE_URL}/api/paypal-ipn`, params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            maxRedirects: 0
        });
        return res;
    } catch(err) {
        return err.response || { status: err.response?.status || 500 };
    }
}

// ============================================================
// 测试用例1：正确的 $9.9 Basic 支付
// ============================================================
async function test_basic_success() {
    divider('测试1：$9.9 Basic 支付（正确支付）');
    cleanup();

    const txn = 'SIM_BASIC_' + Date.now();
    const payload = {
        txn_id: txn,
        payment_status: 'Completed',
        mc_gross: '9.90',
        mc_currency: 'USD',
        receiver_email: PAYPAL_EMAIL,
        item_name: 'MyChineseName_BASIC',
        custom: TEST_USER
    };

    console.log(cyan(`  发送IPN: ${JSON.stringify(payload)}`));
    await sendIPN(payload);

    const state = getUserState();
    const logs = getPaymentLogs();
    const logEntry = logs.find(l => l.txn === txn);

    console.log(`\n  ${bold('校验结果:')}`);
    resultRow('交易记录已写入日志', !!logEntry, `txn=${txn}`);
    resultRow('套餐为 basic', state?.package === 'basic', `实际=${state?.package}`);
    resultRow('配额为 3', state?.quota === 3, `实际=${state?.quota}`);
    resultRow('五行等级为 basic', state?.wuxingLevel === 'basic', `实际=${state?.wuxingLevel}`);
    resultRow('无典故深度权限', state?.culturalDepth === false, `实际=${state?.culturalDepth}`);
    resultRow('无证书权限', state?.certificate === false, `实际=${state?.certificate}`);
    resultRow('支付日志success=true', logEntry?.success === true, `实际=${logEntry?.success}`);

    const allPass = state?.package === 'basic' && state?.quota === 3 && logEntry?.success === true;
    console.log(`\n  ${bold('总结:')} ${allPass ? green('全部通过') : red('存在失败项')}`);
    return allPass;
}

// ============================================================
// 测试用例2：正确的 $19.9 Premium 支付
// ============================================================
async function test_premium_success() {
    divider('测试2：$19.9 Premium 支付（正确支付）');
    cleanup();

    const txn = 'SIM_PREMIUM_' + Date.now();
    const payload = {
        txn_id: txn,
        payment_status: 'Completed',
        mc_gross: '19.90',
        mc_currency: 'USD',
        receiver_email: PAYPAL_EMAIL,
        item_name: 'MyChineseName_PREMIUM',
        custom: TEST_USER
    };

    console.log(cyan(`  发送IPN: ${JSON.stringify(payload)}`));
    await sendIPN(payload);

    const state = getUserState();
    const logs = getPaymentLogs();
    const logEntry = logs.find(l => l.txn === txn);

    console.log(`\n  ${bold('校验结果:')}`);
    resultRow('套餐为 premium', state?.package === 'premium', `实际=${state?.package}`);
    resultRow('配额为 5', state?.quota === 5, `实际=${state?.quota}`);
    resultRow('五行等级为 full', state?.wuxingLevel === 'full', `实际=${state?.wuxingLevel}`);
    resultRow('有典故深度权限', state?.culturalDepth === true, `实际=${state?.culturalDepth}`);
    resultRow('有证书权限', state?.certificate === true, `实际=${state?.certificate}`);
    resultRow('有1次头像生成权限', state?.avatarGeneration === 1, `实际=${state?.avatarGeneration}`);
    resultRow('支付日志success=true', logEntry?.success === true, `实际=${logEntry?.success}`);

    const allPass = state?.package === 'premium' && state?.quota === 5 && logEntry?.success === true;
    console.log(`\n  ${bold('总结:')} ${allPass ? green('全部通过') : red('存在失败项')}`);
    return allPass;
}

// ============================================================
// 测试用例3：正确的 $29.9 Ultimate 支付
// ============================================================
async function test_ultimate_success() {
    divider('测试3：$29.9 Ultimate 支付（正确支付）');
    cleanup();

    const txn = 'SIM_ULTIMATE_' + Date.now();
    const payload = {
        txn_id: txn,
        payment_status: 'Completed',
        mc_gross: '29.90',
        mc_currency: 'USD',
        receiver_email: PAYPAL_EMAIL,
        item_name: 'MyChineseName_ULTIMATE',
        custom: TEST_USER
    };

    console.log(cyan(`  发送IPN: ${JSON.stringify(payload)}`));
    await sendIPN(payload);

    const state = getUserState();
    const logs = getPaymentLogs();
    const logEntry = logs.find(l => l.txn === txn);

    console.log(`\n  ${bold('校验结果:')}`);
    resultRow('套餐为 ultimate', state?.package === 'ultimate', `实际=${state?.package}`);
    resultRow('配额为 9999', state?.quota === 9999, `实际=${state?.quota}`);
    resultRow('五行等级为 full', state?.wuxingLevel === 'full', `实际=${state?.wuxingLevel}`);
    resultRow('有典故深度权限', state?.culturalDepth === true, `实际=${state?.culturalDepth}`);
    resultRow('有证书权限', state?.certificate === true, `实际=${state?.certificate}`);
    resultRow('头像生成次数不限', state?.avatarGeneration === 999, `实际=${state?.avatarGeneration}`);
    resultRow('支付日志success=true', logEntry?.success === true, `实际=${logEntry?.success}`);

    const allPass = state?.package === 'ultimate' && state?.quota === 9999 && logEntry?.success === true;
    console.log(`\n  ${bold('总结:')} ${allPass ? green('全部通过') : red('存在失败项')}`);
    return allPass;
}

// ============================================================
// 测试用例4：金额不匹配 → 应拦截并不发放权限
// ============================================================
async function test_amount_mismatch() {
    divider('测试4：金额不匹配 $9.9 → $1.00（应拦截）');
    cleanup();

    const txn = 'SIM_AMT_MISMATCH_' + Date.now();
    const payload = {
        txn_id: txn,
        payment_status: 'Completed',
        mc_gross: '1.00',      // 篡改金额
        mc_currency: 'USD',
        receiver_email: PAYPAL_EMAIL,
        item_name: 'MyChineseName_BASIC',
        custom: TEST_USER
    };

    console.log(cyan(`  发送IPN（mc_gross=1.00）: ${JSON.stringify(payload)}`));
    await sendIPN(payload);

    const state = getUserState();
    const logs = getPaymentLogs();
    const logEntry = logs.find(l => l.txn === txn);

    console.log(`\n  ${bold('校验结果:')}`);
    resultRow('用户状态未变化（无package写入）', state === null || state?.package === undefined, `实际=${state?.package}`);
    resultRow('日志中有金额不匹配记录', !!logEntry && logEntry.err.includes('Amount mismatch'), `err=${logEntry?.err}`);
    if(logEntry?.err) failReason(logEntry.err);
    if(!logEntry) failReason('日志中无记录，拦截可能失效');

    const blocked = (state === null || state?.package === undefined) && logEntry?.err?.includes('Amount mismatch');
    console.log(`\n  ${bold('总结:')} ${blocked ? green('✅ 拦截成功，权限未发放') : red('❌ 拦截失败，权限已发放或日志缺失')}`);
    return blocked;
}

// ============================================================
// 测试用例5：币种非USD → 应拦截并不发放权限
// ============================================================
async function test_currency_not_usd() {
    divider('测试5：币种为 EUR 非 USD（应拦截）');
    cleanup();

    const txn = 'SIM_CURR_ERR_' + Date.now();
    const payload = {
        txn_id: txn,
        payment_status: 'Completed',
        mc_gross: '9.90',
        mc_currency: 'EUR',    // 非法币种
        receiver_email: PAYPAL_EMAIL,
        item_name: 'MyChineseName_BASIC',
        custom: TEST_USER
    };

    console.log(cyan(`  发送IPN（mc_currency=EUR）: ${JSON.stringify(payload)}`));
    await sendIPN(payload);

    const state = getUserState();
    const logs = getPaymentLogs();
    const logEntry = logs.find(l => l.txn === txn);

    console.log(`\n  ${bold('校验结果:')}`);
    resultRow('用户状态未被写入套餐', state === null || state?.package === undefined, `实际=${state?.package}`);
    resultRow('日志中有币种错误记录', !!logEntry && logEntry.err?.includes('Currency not USD'), `err=${logEntry?.err}`);
    if(logEntry?.err) failReason(logEntry.err);
    if(!logEntry) failReason('日志中无记录，拦截可能失效');

    const blocked = (state === null || state?.package === undefined) && logEntry?.err?.includes('Currency not USD');
    console.log(`\n  ${bold('总结:')} ${blocked ? green('✅ 拦截成功，权限未发放') : red('❌ 拦截失败，权限已发放或日志缺失')}`);
    return blocked;
}

// ============================================================
// 测试用例6：收款邮箱不匹配 → 应拦截并不发放权限
// ============================================================
async function test_receiver_email_mismatch() {
    divider('测试6：收款邮箱不匹配（应拦截）');
    cleanup();

    const txn = 'SIM_EMAIL_ERR_' + Date.now();
    const payload = {
        txn_id: txn,
        payment_status: 'Completed',
        mc_gross: '9.90',
        mc_currency: 'USD',
        receiver_email: 'hacker@fake.com', // 伪造邮箱
        item_name: 'MyChineseName_BASIC',
        custom: TEST_USER
    };

    console.log(cyan(`  发送IPN（receiver_email=hacker@fake.com）: ${JSON.stringify(payload)}`));
    console.log(yellow(`  期望收款邮箱: ${PAYPAL_EMAIL}`));
    await sendIPN(payload);

    const state = getUserState();
    const logs = getPaymentLogs();
    const logEntry = logs.find(l => l.txn === txn);

    console.log(`\n  ${bold('校验结果:')}`);
    resultRow('用户状态未被写入套餐', state === null || state?.package === undefined, `实际=${state?.package}`);
    resultRow('日志中有邮箱不匹配记录', !!logEntry && logEntry.err?.includes('Receiver email mismatch'), `err=${logEntry?.err}`);
    if(logEntry?.err) failReason(logEntry.err);
    if(!logEntry) failReason('日志中无记录，拦截可能失效');

    const blocked = (state === null || state?.package === undefined) && logEntry?.err?.includes('Receiver email mismatch');
    console.log(`\n  ${bold('总结:')} ${blocked ? green('✅ 拦截成功，权限未发放') : red('❌ 拦截失败，权限已发放或日志缺失')}`);
    return blocked;
}

// ============================================================
// 主执行流程
// ============================================================
async function main() {
    console.log(bold(`\n${'#'.repeat(60)}`));
    console.log(bold(' #  PayPal IPN 安全校验测试'));
    console.log(bold(` #  目标服务器: ${BASE_URL}`));
    console.log(bold(` #  PayPal收款邮箱: ${PAYPAL_EMAIL}`));
    console.log(bold('#'.repeat(60)));

    // 检查服务器连通性
    try {
        await axios.get(`${BASE_URL}/api/pricing`, { timeout: 3000 });
        console.log(green(`\n✅ 服务器连通性检查通过: ${BASE_URL}`));
    } catch(err) {
        console.error(red(`\n❌ 服务器连接失败: ${BASE_URL}`));
        console.error(red('请先启动服务器: node server.js'));
        process.exit(1);
    }

    const results = [];

    results.push(await test_basic_success());
    results.push(await test_premium_success());
    results.push(await test_ultimate_success());
    results.push(await test_amount_mismatch());
    results.push(await test_currency_not_usd());
    results.push(await test_receiver_email_mismatch());

    divider('全部测试结果汇总');
    const labels = ['$9.9 Basic', '$19.9 Premium', '$29.9 Ultimate', '金额不匹配拦截', '币种EUR拦截', '邮箱不匹配拦截'];
    let allPassed = true;
    results.forEach((passed, i) => {
        const icon = passed ? green('✅') : red('❌');
        console.log(`  ${icon} ${labels[i]}`);
        if(!passed) allPassed = false;
    });

    console.log(`\n${'='.repeat(60)}`);
    if(allPassed) {
        console.log(bold(green(`\n🎉 全部 6 项测试通过！安全校验逻辑正常。\n`)));
    } else {
        console.log(bold(red(`\n⚠️  存在 ${results.filter(r=>!r).length} 项测试失败，请检查上输出。\n`)));
    }
    console.log('='.repeat(60));

    // 恢复初始状态
    cleanup();

    process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
    console.error(red('测试脚本异常退出:'), err.message);
    process.exit(1);
});