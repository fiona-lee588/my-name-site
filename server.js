require('dotenv').config();
// My Chinese Name - \u4e2d\u6587\u8d77\u540d\u670d\u52a1\u540e\u7aef API\uff0c\u652f\u6301 DeepSeek \u5355\u5f15\u64ce\u8d77\u540d

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
// \u73af\u5883\u914d\u7f6e\uff08\u5168\u90e8\u4ece .env \u8bfb\u53d6\uff0c\u7981\u6b62\u786c\u7f16\u7801\uff09
// ============================================================
const IS_PROD     = process.env.NODE_ENV === 'production';
const DOMAIN      = process.env.DOMAIN   || (IS_PROD ? 'https://mychinesename.co' : 'http://localhost:3000');
const CORS_ORIGIN = process.env.CORS_ORIGIN || (IS_PROD ? 'https://mychinesename.co' : '*');
const LOG_LEVEL   = process.env.LOG_LEVEL || (IS_PROD ? 'error' : 'debug');
const OFFICIAL_DOMAIN = (process.env.PUBLIC_SITE_URL || process.env.DOMAIN || 'https://mychinesename.co').replace(/\/+$/, '');
const SHARE_DOMAIN = (process.env.SHARE_DOMAIN || OFFICIAL_DOMAIN).replace(/\/+$/, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_PATH = '/admin-dashboard-2026';
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || ADMIN_PASSWORD || 'local-admin-session';
function normalizeSecret(value){
    return String(value || '')
        .trim()
        .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');
}
const DEEPSEEK_API_KEY = normalizeSecret(process.env.DEEPSEEK_API_KEY);
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
        intro: 'Explore Chinese names inspired by the elegance of the Book of Songs, one of China\u2019s oldest poetic classics.',
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
    },
    '/how-to-choose-a-chinese-name': {
        title: 'How to Choose a Chinese Name That Sounds Natural',
        h1: 'How to Choose a Chinese Name',
        intro: 'A useful Chinese name should sound natural, use real surname conventions, carry positive meaning, and feel respectful in Chinese culture.',
        focus: 'This guide explains the difference between a random translation and a name that Chinese speakers can recognize as thoughtful.',
        sections: [
            ['Start with a real Chinese surname', 'A good name usually begins with a surname from Chinese naming tradition. Sound matching can help, but the surname should still feel real and usable.'],
            ['Choose characters for meaning and tone', 'The given name should balance pronunciation, written form, personality, and long-term use instead of simply copying an English sound.'],
            ['Check the whole name aloud', 'A name may look beautiful but sound awkward. Pinyin, rhythm, and the connection between surname and given name all matter.']
        ],
        questions: [
            ['Can I translate my English name directly?', 'Sometimes, but direct translation often sounds like a nickname rather than a real Chinese name.'],
            ['Should foreigners use Chinese surnames?', 'Yes, if the goal is a complete Chinese name. The surname makes the name feel culturally complete.']
        ]
    },
    '/chinese-name-by-birthday': {
        title: 'Chinese Name by Birthday and Five Elements',
        h1: 'Chinese Name by Birthday',
        intro: 'Use birth year, month, day, and time as cultural context for a Chinese name with five-elements imagery and balanced meaning.',
        focus: 'Birth information should influence the name direction, not merely appear in the explanation after the name is chosen.',
        sections: [
            ['Birth information as cultural context', 'Traditional naming often considers season, time, balance, and symbolic elements when selecting characters.'],
            ['Five-elements imagery', 'Wood, fire, earth, metal, and water can suggest different name qualities such as growth, clarity, steadiness, refinement, or wisdom.'],
            ['A modern, respectful approach', 'For overseas users, birthday analysis should guide the name gently while keeping the final name natural and easy to use.']
        ],
        questions: [
            ['Do I need exact birth time?', 'Exact time helps, but year, month, and day can still provide useful cultural imagery.'],
            ['Is this fortune telling?', 'No. The site uses traditional symbolism as naming context, not as a prediction of fate.']
        ]
    },
    '/chinese-surname-matching': {
        title: 'Chinese Surname Matching for English Last Names',
        h1: 'Chinese Surname Matching',
        intro: 'Match an English last name to a real Chinese surname by sound, temperament, cultural image, and ease of pronunciation.',
        focus: 'A complete Chinese name needs a surname that feels natural before the given-name characters can work well.',
        sections: [
            ['Sound is only one signal', 'Smith may become Shen, Wilson may become Wei, and Lee may become Li, but sound is only part of the decision.'],
            ['Cultural image matters', 'Some surnames carry historical, poetic, or visual associations that can strengthen the whole name.'],
            ['Avoid joke translations', 'A surname should never make the full name feel like a pun, meme, or accidental phrase.']
        ],
        questions: [
            ['Can I keep my English surname?', 'You can, but a Chinese full name normally uses a Chinese surname form.'],
            ['What if my last name has no close Chinese sound?', 'Then the best match may come from temperament, first letter, or cultural image.']
        ]
    },
    '/chinese-name-for-tattoo': {
        title: 'Chinese Name for Tattoo: Meaning, Characters, and Safety',
        h1: 'Chinese Name for Tattoo',
        intro: 'Before using Chinese characters in a tattoo, check the meaning, pronunciation, cultural tone, and whether the full name sounds natural.',
        focus: 'A tattoo name needs extra care because the characters become permanent and highly visible.',
        sections: [
            ['Use real name characters', 'Avoid random single characters or machine translations that may look decorative but sound strange to native speakers.'],
            ['Check visual balance', 'Characters should look good together in calligraphy while still forming a real name.'],
            ['Understand the full meaning', 'Every character should have a positive role in the whole name, not just a pretty isolated meaning.']
        ],
        questions: [
            ['Can I tattoo only the given name?', 'Yes, but a full Chinese name often feels more complete and personal.'],
            ['Should I verify the name first?', 'Yes. Always check meaning, pronunciation, and cultural tone before tattooing.']
        ]
    },
    '/chinese-name-for-business': {
        title: 'Chinese Name for Business, Networking, and Social Profiles',
        h1: 'Chinese Name for Business',
        intro: 'Create a Chinese name suitable for professional introductions, networking, creator profiles, language learning, and cross-cultural communication.',
        focus: 'A business-friendly Chinese name should sound confident, respectful, and easy for Chinese speakers to remember.',
        sections: [
            ['Professional tone', 'The name should avoid childish, overly romantic, or overly dramatic characters if it will appear in business contexts.'],
            ['Easy introduction', 'Good pinyin and a simple pronunciation guide help overseas users introduce themselves confidently.'],
            ['Memorable cultural story', 'A short explanation from classics or character meaning can become a natural conversation starter.']
        ],
        questions: [
            ['Can I use the name on LinkedIn?', 'Yes, if the name feels natural and the explanation matches your professional identity.'],
            ['Should business names be gendered?', 'They can be, but many professional Chinese names work well with a balanced, neutral tone.']
        ]
    },
    '/chinese-name-for-instagram': {
        title: 'Chinese Name for Instagram, TikTok, and Social Media',
        h1: 'Chinese Name for Social Media',
        intro: 'Get a Chinese name that works as a cultural identity signal, profile story, and shareable name card for social platforms.',
        focus: 'For social media, the name should be memorable, visually attractive, and easy to explain in one sentence.',
        sections: [
            ['Identity first', 'The strongest social names feel like a new cultural identity, not a decorative translation.'],
            ['Shareable visuals', 'A calligraphy-style name card can make the name easier to post, save, and discuss.'],
            ['Conversation value', 'The best names come with a short story: surname match, character meaning, and classical image.']
        ],
        questions: [
            ['Can I use it as a username?', 'You can use the Chinese characters in your bio or display name, and pinyin in your username if needed.'],
            ['What makes people comment?', 'A visible name card plus a clear cultural explanation gives viewers something specific to react to.']
        ]
    },
    '/chinese-calligraphy-name-card': {
        title: 'Chinese Calligraphy Name Card for Sharing',
        h1: 'Chinese Calligraphy Name Card',
        intro: 'Turn a generated Chinese name into a brush-style visual card designed for saving, posting, and sharing with friends.',
        focus: 'The share card gives the name a visual identity so it can travel on social platforms, not just stay as plain text.',
        sections: [
            ['Designed for cultural keepsakes', 'A calligraphy card makes the name feel ceremonial, personal, and easier to remember.'],
            ['Better social previews', 'A clear image preview can help shared links look intentional on X, Facebook, LinkedIn, and messaging apps.'],
            ['Name plus story', 'The card should connect to the written explanation, pinyin, and meaning so the image is not empty decoration.']
        ],
        questions: [
            ['Can I save the card?', 'Yes. The site provides a PNG-style name card for saving and social sharing.'],
            ['Why use calligraphy?', 'Calligraphy gives the name a recognizably Chinese visual texture and makes the result feel more complete.']
        ]
    },
    '/chinese-name-pronunciation': {
        title: 'Chinese Name Pronunciation and Pinyin Guide',
        h1: 'Chinese Name Pronunciation',
        intro: 'Understand how to read a Chinese name with pinyin, simple pronunciation guidance, and a clearer sense of name rhythm.',
        focus: 'A meaningful Chinese name should be pronounceable for the user and still sound natural to Chinese speakers.',
        sections: [
            ['Pinyin is the bridge', 'Pinyin helps overseas users read Chinese names, but the characters and meaning still define the name.'],
            ['Rhythm matters', 'A full name should flow from surname to given name without awkward pauses or harsh sound collisions.'],
            ['Use the name confidently', 'A short pronunciation guide makes it easier to introduce the name in class, work, or social settings.']
        ],
        questions: [
            ['Is pinyin the same as the name?', 'No. Pinyin is the pronunciation guide; the Chinese characters are the actual written name.'],
            ['Do tones matter?', 'Yes, but for beginners a simple guide can help before learning exact Mandarin tones.']
        ]
    },
    '/chinese-name-for-olivia': {
        title: 'Chinese Name for Olivia with Meaning and Pinyin',
        h1: 'Chinese Name for Olivia',
        intro: 'Olivia often fits Chinese name imagery connected with grace, brightness, renewal, and elegant confidence.',
        focus: 'Generate a personalized Chinese name for Olivia using surname matching, birthday context, and cultural meaning.'
    },
    '/chinese-name-for-daniel': {
        title: 'Chinese Name for Daniel with Meaning and Cultural Source',
        h1: 'Chinese Name for Daniel',
        intro: 'Daniel can become a Chinese name with calm strength, integrity, intelligence, and a professional tone.',
        focus: 'Create a personalized Chinese name for Daniel with pinyin, meaning, and a shareable calligraphy card.'
    },
    '/chinese-name-for-emily': {
        title: 'Chinese Name for Emily: Elegant Chinese Name Ideas',
        h1: 'Chinese Name for Emily',
        intro: 'Emily pairs naturally with Chinese name ideas of refinement, kindness, literary grace, and clear personal presence.',
        focus: 'Generate a Chinese name for Emily that feels natural in Chinese while still reflecting the original personality.'
    },
    '/chinese-name-for-alex': {
        title: 'Chinese Name for Alex: Balanced and Natural Ideas',
        h1: 'Chinese Name for Alex',
        intro: 'Alex works well with balanced Chinese names that can feel confident, adaptable, and gender-neutral when needed.',
        focus: 'Create a Chinese name for Alex with surname matching, character meaning, and pronunciation guidance.'
    },
    '/chinese-name-for-david': {
        title: 'Chinese Name for David with Pinyin and Meaning',
        h1: 'Chinese Name for David',
        intro: 'David can be adapted into a Chinese name with steady character, sincerity, and a clear professional sound.',
        focus: 'Generate a Chinese name for David that avoids random translation and includes a cultural explanation.'
    },
    '/chinese-name-for-isabella': {
        title: 'Chinese Name for Isabella: Graceful Name Ideas',
        h1: 'Chinese Name for Isabella',
        intro: 'Isabella often matches elegant Chinese name imagery around beauty, dignity, softness, and inner brightness.',
        focus: 'Create a personalized Chinese name for Isabella with pinyin, character meaning, and classical inspiration.'
    },
    '/chinese-name-examples': {
        title: 'Chinese Name Examples with Meanings, Pinyin, and Cultural Notes',
        h1: 'Chinese Name Examples',
        intro: 'Browse meaningful Chinese name examples for foreigners, with pinyin, English meaning, and the cultural feeling behind each name.',
        focus: 'Examples help users understand what a natural Chinese name looks like before generating their own personalized name.',
        examples: [
            ['顾若英', 'Gu Ruo Ying', 'A graceful, confident name with a bright and heroic feeling.'],
            ['魏思娴', 'Wei Si Xian', 'Thoughtful, refined, and elegant; suitable for a gentle but intelligent personality.'],
            ['唐明远', 'Tang Ming Yuan', 'Bright vision and long-term promise, with a dignified surname.'],
            ['沈知韵', 'Shen Zhi Yun', 'Wisdom with poetic rhythm, carrying a literary and calm temperament.'],
            ['莫安澜', 'Mo An Lan', 'Peaceful and steady, like calm water with quiet strength.']
        ],
        sections: [
            ['What makes a good example?', 'A good Chinese name should be readable, culturally natural, positive in meaning, and easy to explain in English.'],
            ['Why examples matter', 'Foreign users often need to see real-looking names before they trust a generator or choose a name for personal use.'],
            ['From example to personal name', 'The best result still depends on surname, birthday, style, and personality, so examples are a starting point rather than final answers.']
        ],
        questions: [
            ['Can I use one of these examples directly?', 'You can, but a personalized name based on your own surname and profile is usually better.'],
            ['Are these random translations?', 'No. These examples follow Chinese naming style with surname, given-name rhythm, and positive meaning.']
        ]
    },
    '/english-to-chinese-name-examples': {
        title: 'English to Chinese Name Examples That Sound Natural',
        h1: 'English to Chinese Name Examples',
        intro: 'See how English names can become natural Chinese names without looking like machine translations or phonetic jokes.',
        focus: 'The goal is not to copy every sound. A good Chinese name carries identity, meaning, and a story.',
        examples: [
            ['Olivia Garcia', '顾若英', 'Graceful confidence with a surname chosen for sound and temperament.'],
            ['Emily Wilson', '魏思娴', 'A refined name with thoughtful and elegant qualities.'],
            ['Daniel Morgan', '莫安澜', 'Calm integrity and long-term steadiness.'],
            ['James Taylor', '唐和光', 'Gentle light and balanced presence.'],
            ['Sophia Miller', '米知韵', 'Wisdom, poetry, and a warm surname match.']
        ],
        sections: [
            ['Surname comes first', 'Chinese full names place the surname first, so the English last name usually guides the Chinese surname match.'],
            ['Given name carries personality', 'The given-name characters should express temperament, hopes, and cultural imagery rather than simply copying sound.'],
            ['A shareable identity', 'A good English-to-Chinese name should be easy to introduce and interesting enough to become a conversation starter.']
        ],
        questions: [
            ['Is English to Chinese naming the same as translation?', 'No. Translation changes words; naming creates a culturally usable identity.'],
            ['Can the same English name have different Chinese names?', 'Yes. Birthday, surname, gender, style, and preferred meaning can lead to different results.']
        ]
    },
    '/book-of-songs-name-examples': {
        title: 'Book of Songs Chinese Name Examples',
        h1: 'Book of Songs Name Examples',
        intro: 'Explore Chinese name ideas inspired by the elegance, restraint, and poetic imagery of the Book of Songs.',
        focus: 'Book of Songs style names often feel gentle, literary, refined, and culturally memorable.',
        examples: [
            ['清扬', 'Qing Yang', 'Clear and uplifting, inspired by bright and graceful imagery.'],
            ['思齐', 'Si Qi', 'To think toward virtue and self-cultivation.'],
            ['嘉言', 'Jia Yan', 'Beautiful speech and trustworthy character.'],
            ['静姝', 'Jing Shu', 'Quiet beauty and gentle dignity.'],
            ['怀瑾', 'Huai Jin', 'Holding jade-like virtue within.']
        ],
        sections: [
            ['Poetry as naming material', 'Classical poetry offers images of light, jade, water, virtue, and graceful conduct that work well in names.'],
            ['Use carefully', 'A poetic phrase should become a natural name, not a copied line that feels too heavy or obscure.'],
            ['For overseas users', 'The explanation matters. Pinyin and English meaning help the user carry the name with confidence.']
        ],
        questions: [
            ['Are Book of Songs names only for girls?', 'No. Some feel feminine, but many poetic ideas work for boys or gender-neutral names.'],
            ['Can I request a poetic style?', 'Yes. Choose a refined, literary, or graceful style when generating your name.']
        ]
    },
    '/chinese-names-for-foreigners': {
        title: 'Chinese Names for Foreigners: Meaningful, Natural, and Usable',
        h1: 'Chinese Names for Foreigners',
        intro: 'Foreigners often need Chinese names for language learning, travel, business, social media, art, or personal identity.',
        focus: 'A good name for a foreigner should be respectful, pronounceable, culturally natural, and easy to explain.',
        sections: [
            ['Avoid joke names', 'Do not choose characters only because they sound similar to English. The name should not become a pun or awkward phrase.'],
            ['Balance identity and culture', 'The name should still feel like you while fitting Chinese surname and given-name conventions.'],
            ['Use it in real life', 'A usable name includes Chinese characters, pinyin, pronunciation guidance, and a short meaning story.']
        ],
        questions: [
            ['Do foreigners need Chinese names?', 'Not always, but a Chinese name is useful for Mandarin learning, cross-cultural introductions, and identity building.'],
            ['Should the name sound like my English name?', 'It can, but meaning and cultural fit are more important than exact sound matching.']
        ]
    },
    '/best-chinese-names-for-girls': {
        title: 'Best Chinese Names for Girls with Elegant Meanings',
        h1: 'Best Chinese Names for Girls',
        intro: 'Elegant Chinese names for girls often carry images of clarity, grace, wisdom, brightness, and quiet confidence.',
        focus: 'The best girl names are beautiful without being shallow, poetic without being difficult, and natural enough for real use.',
        examples: [
            ['安雅', 'An Ya', 'Peaceful elegance.'],
            ['明舒', 'Ming Shu', 'Clear light and ease.'],
            ['若英', 'Ruo Ying', 'Gentle grace with heroic spirit.'],
            ['宁舒', 'Ning Shu', 'Serenity and comfort.'],
            ['思娴', 'Si Xian', 'Thoughtful and refined.']
        ],
        questions: [
            ['What makes a Chinese girl name elegant?', 'Balanced sound, positive meaning, graceful characters, and natural usage.'],
            ['Can a girl name also sound strong?', 'Yes. Many beautiful names combine softness with confidence or independence.']
        ]
    },
    '/best-chinese-names-for-boys': {
        title: 'Best Chinese Names for Boys with Strong Meanings',
        h1: 'Best Chinese Names for Boys',
        intro: 'Chinese names for boys often express integrity, clear ambition, steadiness, brightness, and inner strength.',
        focus: 'A strong name should feel dignified and natural, not exaggerated or overly dramatic.',
        examples: [
            ['明远', 'Ming Yuan', 'Bright vision and far-reaching promise.'],
            ['志行', 'Zhi Xing', 'Ambition carried into action.'],
            ['承峰', 'Cheng Feng', 'Responsibility and rising aspiration.'],
            ['景辰', 'Jing Chen', 'Morning light and noble presence.'],
            ['安澜', 'An Lan', 'Calm water and steady character.']
        ],
        questions: [
            ['Should boy names be very powerful?', 'Not always. Refined strength often feels more natural than aggressive wording.'],
            ['Can a boy name be literary?', 'Yes. Many classic male names use poetry, virtue, and landscape imagery.']
        ]
    },
    '/chinese-name-by-personality': {
        title: 'Chinese Name by Personality and Meaning',
        h1: 'Chinese Name by Personality',
        intro: 'Choose a Chinese name that reflects personality traits such as wisdom, calmness, courage, elegance, creativity, or ambition.',
        focus: 'Personality gives the name a social story, making it easier to explain and remember.',
        sections: [
            ['Wisdom names', 'Names with 知, 思, 明, or 文 can suggest learning, insight, and clarity.'],
            ['Calm names', 'Names with 安, 宁, 和, or 澜 can suggest peace, steadiness, and emotional balance.'],
            ['Courage names', 'Names with 志, 行, 峰, or 立 can suggest ambition, action, and confidence.']
        ],
        questions: [
            ['Can personality change the final name?', 'Yes. The same English name can lead to a different Chinese name if the desired personality changes.'],
            ['Is this better than a random generator?', 'Yes. Personality-based naming gives the result a story and a reason.']
        ]
    }
};

// Startup logging.
const log = (...args) => { console.log(...args); };
const logError = (...args) => { console.error(...args); };

log("DeepSeek key configured:", !!DEEPSEEK_API_KEY);
log("PayPal mode:", process.env.PAYPAL_MODE || 'sandbox');
log("PayPal client id configured:", !!process.env.PAYPAL_CLIENT_ID);
log("PayPal client secret configured:", !!process.env.PAYPAL_CLIENT_SECRET);
log("Site domain:", DOMAIN);

// ============================================================
// CORS \u914d\u7f6e
// ============================================================
const ALLOWED_ORIGINS = new Set([
    'https://mychinesename.co',
    'https://www.mychinesename.co',
    'https://mychinesename-api.onrender.com',
    CORS_ORIGIN
].filter(Boolean));

app.use(cors({
    origin(origin, callback){
        if(!origin || CORS_ORIGIN === '*' || ALLOWED_ORIGINS.has(origin)) return callback(null, true);
        return callback(null, false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-user-id', 'x-dev-test'],
    credentials: true
}));
app.use((req, res, next) => {
    res.charset = 'utf-8';
    next();
});
// helmet() \u5df2\u79fb\u9664 CSP
// app.use(helmet());
app.use(express.json({ limit: '768kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// ============================================================
// API \u5168\u5c40\u9650\u6d41\uff08/api \u8def\u5f84\uff0c60\u79d2\u5185\u6700\u591a60\u6b21\uff09
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
// \u5b89\u5168\u4e2d\u95f4\u4ef6\uff1aIP \u9650\u6d41 + \u9891\u7387\u9650\u5236\uff08\u7cbe\u7ec6\u5316\uff09
// ============================================================

// IP \u8bf7\u6c42\u8ba1\u6570\uff08\u5185\u5b58\u4e2d\u7b80\u5355\u8ba1\u6570\uff0c\u751f\u4ea7\u73af\u5883\u5efa\u8bae\u7528 Redis\uff09
const ipCounts = new Map();          // IP -> { count, resetAt }
const ipBlocked = new Map();          // IP -> unblockAt

// \u8d77\u540dAPI\u4e13\u5c5e\u9650\u6d41\uff1a\u6bcf\u4e2aIP\u6bcf\u5206\u949f\u6700\u591a N \u6b21
const RATE_LIMIT_WINDOW_MS = 60 * 1000;  // 1\u5206\u949f\u7a97\u53e3
const RATE_LIMIT_MAX = IS_PROD ? 5 : 20;   // \u6bcf\u7a97\u53e3\u6700\u5927\u8bf7\u6c42\u6570\uff08\u6b63\u5f0f\u73af\u58835\u6b21\uff0c\u5f00\u53d1\u73af\u588320\u6b21\uff09

// \u6e05\u7406\u8fc7\u671f\u8bb0\u5f55\u7684\u5b9a\u65f6\u5668\uff08\u6bcf5\u5206\u949f\u6e05\u7406\u4e00\u6b21\uff09
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

    // \u88ab\u4e34\u65f6\u62e6\u622a\u7684IP
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

    // \u8d85\u8fc7\u9608\u503c\u5219\u4e34\u65f6\u5c01\u798110\u5206\u949f
    if(record.count > RATE_LIMIT_MAX) {
        ipBlocked.set(ip, now + 10 * 60 * 1000);
        ipCounts.delete(ip);
        logError('[rate-limit] request blocked');
        return res.status(429).json({ error: 'Too many requests, please try again later.' });
    }

    next();
}

// \u901a\u7528\u8bf7\u6c42\u65e5\u5fd7\uff08\u4ec5\u975e\u6b63\u5f0f\u73af\u5883\uff09
app.use((req, res, next) => {
    if(!IS_PROD) {
        const ip = getClientIp(req);
        log('[app] request processed');
    }
    next();
});

// ============================================================
// PayPal \u914d\u7f6e\uff08\u4ece .env \u8bfb\u53d6\uff09
// ============================================================
// PayPal REST API \u914d\u7f6e\uff08\u4ece .env \u8bfb\u53d6\uff0clive/sandbox \u81ea\u52a8\u5207\u6362\uff09
// ============================================================
paypal.configure({
    mode: process.env.PAYPAL_MODE || 'sandbox',
    client_id: process.env.PAYPAL_CLIENT_ID,
    client_secret: process.env.PAYPAL_CLIENT_SECRET
});

// ============================================================
// \u5957\u9910\u6743\u76ca\u8868\uff08\u5168\u90e8\u4ece\u540e\u7aef\u8bfb\u53d6\uff0c\u524d\u7aef\u7981\u6b62\u786c\u7f16\u7801\uff09
// ============================================================
const PACKAGE_ENTITLEMENTS = {
    basic:    { quota: 3,    wuxingLevel: 'basic', culturalDepth: false, certificate: false, avatarGeneration: 0,  regeneration: 1  },
    premium:  { quota: 5,    wuxingLevel: 'full',  culturalDepth: true,  certificate: true,  avatarGeneration: 1,  regeneration: 999 },
    ultimate: { quota: 9999, wuxingLevel: 'full',  culturalDepth: true,  certificate: true,  avatarGeneration: 999, regeneration: 999 }
};

// ============================================================
// \u6587\u4ef6\u8def\u5f84
// ============================================================
const DATA_DIR = process.env.DATA_DIR || __dirname;
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch(err) { logError('[data-dir] failed to create:', err.message); }
const USER_STATE_FILE = path.join(DATA_DIR, 'user-state.json');
const PAYMENT_LOG_FILE = path.join(DATA_DIR, 'payment-log.json');
const ANALYTICS_LOG_FILE = path.join(DATA_DIR, 'analytics-log.json');
const SHARE_CARD_FILE = path.join(DATA_DIR, 'share-cards.json');
const PAYPAL_ORDER_FILE = path.join(DATA_DIR, 'paypal-orders.json');
const CONTACT_MESSAGES_FILE = path.join(DATA_DIR, 'contact-messages.json');

// ============================================================
// \u72b6\u6001\u8bfb\u5199
// ============================================================
function readUserState(){
    try {
        if(!fs.existsSync(USER_STATE_FILE)) return {};
        return JSON.parse(fs.readFileSync(USER_STATE_FILE, 'utf8'));
    } catch { return {}; }
}

// ============================================================
// \u8f93\u5165\u6e05\u6d17\uff08\u4fdd\u7559\u4e2d\u6587\u3001ASCII\u53ef\u89c1\u5b57\u7b26\uff0c\u53bb\u9664\u63a7\u5236\u5b57\u7b26\u548c\u7279\u6b8a\u7b26\u53f7\uff09
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

function readPayPalOrders(){
    try {
        if(!fs.existsSync(PAYPAL_ORDER_FILE)) return {};
        return JSON.parse(fs.readFileSync(PAYPAL_ORDER_FILE, 'utf8'));
    } catch { return {}; }
}

function writePayPalOrders(orders){
    fs.writeFileSync(PAYPAL_ORDER_FILE, JSON.stringify(orders, null, 2));
}

function savePayPalOrder(paymentId, order){
    if(!paymentId) return;
    const orders = readPayPalOrders();
    orders[paymentId] = { ...order, createdAt: new Date().toISOString() };
    writePayPalOrders(orders);
}

function parsePayPalCustom(custom){
    const value = cleanStr(custom || '');
    if(!value) return {};
    try {
        const parsed = JSON.parse(value);
        return { pkg: cleanStr(parsed.pkg), userId: cleanStr(parsed.userId) };
    } catch {}
    const parts = value.split('|');
    if(parts.length >= 2) return { pkg: cleanStr(parts[0]), userId: cleanStr(parts.slice(1).join('|')) };
    return { pkg: value };
}
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

function readContactMessages(){
    try {
        if(!fs.existsSync(CONTACT_MESSAGES_FILE)) return [];
        const data = JSON.parse(fs.readFileSync(CONTACT_MESSAGES_FILE, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch { return []; }
}

function writeContactMessages(messages){
    fs.writeFileSync(CONTACT_MESSAGES_FILE, JSON.stringify(messages, null, 2));
}

function appendContactMessage(entry){
    const messages = readContactMessages();
    messages.push({ ...entry, _ts: new Date().toISOString() });
    if(messages.length > 500) messages.splice(0, messages.length - 500);
    writeContactMessages(messages);
}

function appendAnalyticsEvent(req, event, meta = {}){
    const allowed = new Set([
        'page_view', 'generate_click', 'generate_success', 'generate_failed',
        'paywall_show', 'buy_click', 'share_click', 'share_reward', 'share_card_created', 'share_card_failed'
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

const TRACKING_PIXEL = Buffer.from(
    'R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==',
    'base64'
);

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

function readShareCards(){
    try {
        if(!fs.existsSync(SHARE_CARD_FILE)) return {};
        return JSON.parse(fs.readFileSync(SHARE_CARD_FILE, 'utf8'));
    } catch { return {}; }
}

function writeShareCards(cards){
    fs.writeFileSync(SHARE_CARD_FILE, JSON.stringify(cards, null, 2));
}

function cleanShareSvg(svg){
    const text = String(svg || '').trim();
    if(!text || text.length > 160000) return '';
    if(!/^<svg[\s>]/i.test(text) || !/<\/svg>$/i.test(text)) return '';
    if(/<script|onload=|onerror=|javascript:/i.test(text)) return '';
    return text;
}

function cleanPngDataUrl(value, maxLength = 2600000){
    const text = String(value || '').trim();
    const match = text.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if(!match || match[1].length > maxLength) return '';
    return match[1];
}

function createShareId(){
    return crypto.randomBytes(8).toString('hex');
}

function renderSharePage(id, card){
    const canonical = `${SHARE_DOMAIN}/share/${id}`;
    const hasPng = !!(card.previewPng || card.png);
    const imageUrl = hasPng ? `${SHARE_DOMAIN}/share-card/${id}.png` : `${SHARE_DOMAIN}/share-card/${id}.svg`;
    const name = card.name || 'My Chinese Name';
    const title = `${name} - Meaningful Chinese Name Card`;
    const desc = card.summary || 'A meaningful Chinese name inspired by the I Ching, Book of Songs, and classical Chinese culture.';
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${htmlEscape(title)}</title>
<meta name="description" content="${htmlEscape(desc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${htmlEscape(title)}">
<meta property="og:description" content="${htmlEscape(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${imageUrl}">
<meta property="og:image:secure_url" content="${imageUrl}">
<meta property="og:image:type" content="${hasPng ? 'image/png' : 'image/svg+xml'}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${htmlEscape(title)}">
<meta name="twitter:description" content="${htmlEscape(desc)}">
<meta name="twitter:image" content="${imageUrl}">
<meta name="twitter:image:alt" content="${htmlEscape(name)} calligraphy name card">
<style>
body{margin:0;background:#f7f2e9;color:#3f3024;font-family:Georgia,"Times New Roman",serif;line-height:1.65}
.wrap{max-width:900px;margin:0 auto;padding:36px 18px;text-align:center}
.card{max-width:min(560px,92vw);margin:0 auto 22px}
.card svg{width:100%;height:auto;display:block}
h1{margin:10px 0;color:#8c2318;font-size:clamp(32px,6vw,56px)}
.pinyin{color:#775533;font-size:18px}
.summary{max-width:680px;margin:18px auto;font-size:18px}
.cta{display:inline-block;margin-top:12px;padding:12px 18px;border-radius:6px;background:#8c2318;color:#fff;text-decoration:none}
</style>
</head>
<body><main class="wrap">
<div class="card">${card.svg}</div>
<h1>${htmlEscape(name)}</h1>
${card.pinyin ? `<div class="pinyin">${htmlEscape(card.pinyin)}</div>` : ''}
<p class="summary">${htmlEscape(desc)}</p>
<a class="cta" href="${OFFICIAL_DOMAIN}/">Create Your Chinese Name</a>
</main></body></html>`;
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
// \u7528\u6237ID + \u89e3\u9501
// ============================================================
function getUserId(req){
    const headerUserId = cleanStr(req.headers['x-user-id'] || '');
    if(/^[A-Za-z0-9_-]{12,80}$/.test(headerUserId)) return headerUserId;
    return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
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
    log('[app] request processed');
    return true;
}

function getUserStatus(userId){
    const state = readUserState();
    const user = state[userId] || { quota: 2, package: 'free' };
    return {
        quota: user.quota ?? 2,
        package: user.package || 'free',
        wuxingLevel: user.wuxingLevel || 'basic',
        shareRewardClaimed: !!user.shareRewardClaimed
    };
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
    const user = state[userId] || { quota: 2, package: 'free' };
    if(user.shareRewardClaimed) {
        return { success: true, alreadyClaimed: true, quota: user.quota ?? 2, package: user.package || 'free' };
    }
    if((user.package || 'free') !== 'free') {
        user.shareRewardClaimed = true;
        state[userId] = user;
        writeUserState(state);
        return { success: true, alreadyClaimed: true, quota: user.quota ?? 0, package: user.package || 'free' };
    }
    user.quota = Math.min((user.quota ?? 2) + 1, 3);
    user.package = 'free';
    user.shareRewardClaimed = true;
    state[userId] = user;
    writeUserState(state);
    return { success: true, rewardAdded: true, quota: user.quota, package: user.package };
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

function seededHash(text){
    const input = String(text || 'fallback');
    let hash = 2166136261;
    for(let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function pickSeeded(list, seed, offset = 0){
    if(!Array.isArray(list) || list.length === 0) return null;
    const n = Math.abs((seed + Math.imul(offset + 1, 2654435761)) >>> 0);
    return list[n % list.length];
}

function birthElement(birthText){
    const month = Number((String(birthText || '').match(/^\d{0,4}-?(\d{1,2})/) || [])[1]);
    if([2, 3, 4].includes(month)) return { key:'wood', cn:'木', en:'wood', hint:'growth, kindness, and renewal' };
    if([5, 6, 7].includes(month)) return { key:'fire', cn:'火', en:'fire', hint:'warmth, clarity, and confidence' };
    if([8, 9, 10].includes(month)) return { key:'metal', cn:'金', en:'metal', hint:'focus, integrity, and refinement' };
    if([11, 12, 1].includes(month)) return { key:'water', cn:'水', en:'water', hint:'wisdom, adaptability, and depth' };
    return { key:'earth', cn:'土', en:'earth', hint:'steadiness, trust, and balance' };
}

function buildFallbackName({ givenName, surname, gender, style, meaning, birthText }){
    const seed = seededHash(`${givenName}|${surname}|${gender}|${style}|${meaning}|${birthText}`);
    const element = birthElement(birthText);
    const surnameMap = [
        { re:/^(smith|smyth)$/i, cn:'\u6c88', pinyin:'Shen', reason:'chosen for its soft sh sound and refined literary feeling' },
        { re:/^(johnson|jones|james)$/i, cn:'\u6c5f', pinyin:'Jiang', reason:'chosen for a clear j sound and the image of a broad river' },
        { re:/^(brown|bruno)$/i, cn:'\u767d', pinyin:'Bai', reason:'chosen by contrast for brightness, purity, and an elegant classical surname' },
        { re:/^(miller|miles|mitchell|michael)$/i, cn:'\u7c73', pinyin:'Mi', reason:'chosen for its close m sound and warm everyday cultural image' },
        { re:/^(davis|thomas|taylor)$/i, cn:'\u5510', pinyin:'Tang', reason:'chosen for its dignified sound and Tang dynasty cultural resonance' },
        { re:/^(wilson|williams|walker)$/i, cn:'\u9b4f', pinyin:'Wei', reason:'chosen for its w sound and noble historical presence' },
        { re:/^(lee|li|lewis)$/i, cn:'\u674e', pinyin:'Li', reason:'chosen for its direct sound match and deep Baijiaxing heritage' },
        { re:/^(martin|moore|morgan)$/i, cn:'\u7a46', pinyin:'Mu', reason:'chosen for its calm m sound and meaning of sincerity and harmony' }
    ];
    const surnamePools = {
        a:[{cn:'\u5b89', pinyin:'An', reason:'chosen for its open a sound and peaceful cultural meaning'}],
        b:[{cn:'\u767d', pinyin:'Bai', reason:'chosen for its bright, clean image and close b sound'}],
        c:[{cn:'\u66f9', pinyin:'Cao', reason:'chosen for a grounded c sound and classical surname presence'}, {cn:'\u9648', pinyin:'Chen', reason:'chosen for a familiar Chinese surname with a clear ch sound'}],
        d:[{cn:'\u675c', pinyin:'Du', reason:'chosen for a concise d sound and literary elegance'}],
        e:[{cn:'\u6613', pinyin:'Yi', reason:'chosen for its link to change, balance, and the I Ching'}],
        f:[{cn:'\u65b9', pinyin:'Fang', reason:'chosen for its f sound and sense of upright character'}],
        g:[{cn:'\u9ad8', pinyin:'Gao', reason:'chosen for its g sound and image of aspiration'}, {cn:'\u987e', pinyin:'Gu', reason:'chosen for its refined sound and thoughtful temperament'}],
        h:[{cn:'\u4f55', pinyin:'He', reason:'chosen for its soft h sound and well-known surname tradition'}],
        i:[{cn:'\u5c39', pinyin:'Yin', reason:'chosen for its graceful vowel opening and classical surname feel'}],
        j:[{cn:'\u6c5f', pinyin:'Jiang', reason:'chosen for a clear j sound and the image of a broad river'}],
        k:[{cn:'\u5eb7', pinyin:'Kang', reason:'chosen for its k sound and meaning of well-being'}],
        l:[{cn:'\u674e', pinyin:'Li', reason:'chosen for its l sound and deep Hundred Family Surnames heritage'}, {cn:'\u6797', pinyin:'Lin', reason:'chosen for its l sound and natural, graceful image'}],
        m:[{cn:'\u7c73', pinyin:'Mi', reason:'chosen for its m sound and warm everyday cultural image'}, {cn:'\u7a46', pinyin:'Mu', reason:'chosen for sincerity, calmness, and harmony'}],
        n:[{cn:'\u5b81', pinyin:'Ning', reason:'chosen for its n sound and peaceful meaning'}],
        o:[{cn:'\u6b27', pinyin:'Ou', reason:'chosen for its close o sound and established surname usage'}],
        p:[{cn:'\u6f58', pinyin:'Pan', reason:'chosen for its p sound and elegant surname tradition'}],
        q:[{cn:'\u79e6', pinyin:'Qin', reason:'chosen for its crisp sound and strong historical resonance'}],
        r:[{cn:'\u4efb', pinyin:'Ren', reason:'chosen for its r sound and sense of responsibility'}],
        s:[{cn:'\u6c88', pinyin:'Shen', reason:'chosen for its soft sh sound and refined literary feeling'}, {cn:'\u82cf', pinyin:'Su', reason:'chosen for a smooth s sound and poetic lightness'}],
        t:[{cn:'\u5510', pinyin:'Tang', reason:'chosen for its dignified sound and Tang dynasty cultural resonance'}],
        u:[{cn:'\u4e8e', pinyin:'Yu', reason:'chosen for its clear vowel sound and classic surname form'}],
        v:[{cn:'\u65b9', pinyin:'Fang', reason:'chosen for a close v/f sound and upright cultural image'}],
        w:[{cn:'\u9b4f', pinyin:'Wei', reason:'chosen for its w sound and noble historical presence'}],
        x:[{cn:'\u8c22', pinyin:'Xie', reason:'chosen for its distinctive x sound and established surname tradition'}],
        y:[{cn:'\u53f6', pinyin:'Ye', reason:'chosen for its y sound and leaf imagery of renewal'}],
        z:[{cn:'\u5468', pinyin:'Zhou', reason:'chosen for its z/zh sound and deep cultural continuity'}]
    };
    const firstLetter = (String(surname || givenName || '').trim().match(/[a-z]/i)?.[0] || '').toLowerCase();
    const fallbackSurnames = [
        {cn:'\u6797', pinyin:'Lin', reason:'chosen for a natural, graceful image that feels accessible across cultures'},
        {cn:'\u6c88', pinyin:'Shen', reason:'chosen for literary refinement and a gentle sound'},
        {cn:'\u6c5f', pinyin:'Jiang', reason:'chosen for river imagery, openness, and memorable pronunciation'},
        {cn:'\u5510', pinyin:'Tang', reason:'chosen for Tang dynasty resonance and dignified sound'},
        {cn:'\u4f55', pinyin:'He', reason:'chosen for a soft sound and familiar Chinese surname tradition'},
        {cn:'\u82cf', pinyin:'Su', reason:'chosen for poetic lightness and cross-cultural ease'},
        {cn:'\u5468', pinyin:'Zhou', reason:'chosen for deep cultural continuity and a strong surname profile'},
        {cn:'\u79e6', pinyin:'Qin', reason:'chosen for historical depth and concise pronunciation'}
    ];
    const matched = surnameMap.find(item => item.re.test(surname || ''))
        || pickSeeded(surnamePools[firstLetter] || fallbackSurnames, seed, 1)
        || fallbackSurnames[0];
    const profile = `${meaning || ''} ${style || ''}`;
    const wantsWisdom = /wisdom|wise|intelligence|learn|knowledge|\u806a|\u667a/i.test(profile);
    const wantsPeace = /peace|calm|gentle|grace|serene|\u5b89|\u5b81|\u96c5/i.test(profile);
    const wantsBright = /bright|success|future|hope|light|prosper|\u6210|\u5149|\u660e/i.test(profile);
    const wantsCourage = /courage|brave|strong|bold|confident|leader|power|\u52c7|\u5f3a|\u4fe1/i.test(profile);
    const feminine = /female|girl|woman/i.test(gender || '');
    const neutralNames = [
        { cn:'\u6000\u747e', pinyin:'Huai Jin', gloss:'holding jade-like inner virtue' },
        { cn:'\u4e91\u821f', pinyin:'Yun Zhou', gloss:'a steady boat under open clouds' },
        { cn:'\u666f\u884c', pinyin:'Jing Xing', gloss:'upright conduct and admired character' },
        { cn:'\u6e05\u548c', pinyin:'Qing He', gloss:'clarity with gentle harmony' }
    ];
    const categories = {
        wisdom:[
            { cn:'\u77e5\u97f5', pinyin:'Zhi Yun', gloss:'wisdom with poetic rhythm' },
            { cn:'\u601d\u8861', pinyin:'Si Heng', gloss:'thoughtful balance and clear judgment' },
            { cn:'\u95fb\u6e05', pinyin:'Wen Qing', gloss:'cultivated insight and clarity' },
            { cn:'\u4e66\u5b81', pinyin:'Shu Ning', gloss:'learning with inner calm' }
        ],
        bright:feminine ? [
            { cn:'\u660e\u8212', pinyin:'Ming Shu', gloss:'clear light and ease' },
            { cn:'\u6653\u7136', pinyin:'Xiao Ran', gloss:'dawn-like brightness and natural confidence' },
            { cn:'\u7167\u5b81', pinyin:'Zhao Ning', gloss:'warm light with quiet steadiness' },
            { cn:'\u660e\u73a5', pinyin:'Ming Yue', gloss:'bright grace like fine jade' }
        ] : [
            { cn:'\u660e\u8fdc', pinyin:'Ming Yuan', gloss:'bright vision and far-reaching promise' },
            { cn:'\u666f\u8fb0', pinyin:'Jing Chen', gloss:'morning light and noble aspiration' },
            { cn:'\u662d\u884c', pinyin:'Zhao Xing', gloss:'clear purpose and visible integrity' },
            { cn:'\u6717\u8d8a', pinyin:'Lang Yue', gloss:'open brightness and the will to rise' }
        ],
        peace:feminine ? [
            { cn:'\u5b89\u96c5', pinyin:'An Ya', gloss:'peaceful elegance' },
            { cn:'\u5b81\u8212', pinyin:'Ning Shu', gloss:'serenity and ease' },
            { cn:'\u9759\u8a00', pinyin:'Jing Yan', gloss:'quiet poise and trustworthy speech' },
            { cn:'\u548c\u94c3', pinyin:'He Ling', gloss:'harmony with a clear, graceful sound' }
        ] : [
            { cn:'\u5b89\u548c', pinyin:'An He', gloss:'peace and harmony' },
            { cn:'\u5b81\u8fdc', pinyin:'Ning Yuan', gloss:'calm strength with long vision' },
            { cn:'\u548c\u5149', pinyin:'He Guang', gloss:'gentle light and balanced presence' },
            { cn:'\u5b9a\u7136', pinyin:'Ding Ran', gloss:'steadiness and natural composure' }
        ],
        courage:feminine ? [
            { cn:'\u82e5\u82f1', pinyin:'Ruo Ying', gloss:'soft grace with heroic spirit' },
            { cn:'\u661f\u8a00', pinyin:'Xing Yan', gloss:'clear voice and star-like confidence' },
            { cn:'\u7acb\u5b81', pinyin:'Li Ning', gloss:'independence with composed strength' },
            { cn:'\u8c28\u7476', pinyin:'Jin Yao', gloss:'disciplined virtue and precious brightness' }
        ] : [
            { cn:'\u5fd7\u884c', pinyin:'Zhi Xing', gloss:'ambition carried into action' },
            { cn:'\u627f\u5cf0', pinyin:'Cheng Feng', gloss:'bearing responsibility and rising like a peak' },
            { cn:'\u7acb\u8f69', pinyin:'Li Xuan', gloss:'upright confidence and broad presence' },
            { cn:'\u656c\u7136', pinyin:'Jing Ran', gloss:'respectful strength and natural dignity' }
        ],
        element:{
            wood:[
                { cn:'\u82e5\u6797', pinyin:'Ruo Lin', gloss:'renewal and gentle growth' },
                { cn:'\u9752\u884c', pinyin:'Qing Xing', gloss:'fresh vitality and forward movement' }
            ],
            fire:[
                { cn:'\u660e\u70c1', pinyin:'Ming Shuo', gloss:'bright warmth and confident clarity' },
                { cn:'\u666f\u7136', pinyin:'Jing Ran', gloss:'radiant presence and natural ease' }
            ],
            metal:[
                { cn:'\u94ed\u8fdc', pinyin:'Ming Yuan', gloss:'memorable integrity and long vision' },
                { cn:'\u9526\u884c', pinyin:'Jin Xing', gloss:'refined promise carried into action' }
            ],
            water:[
                { cn:'\u6e05\u6e90', pinyin:'Qing Yuan', gloss:'clear depth and original insight' },
                { cn:'\u6c90\u8a00', pinyin:'Mu Yan', gloss:'gentle depth and sincere expression' }
            ],
            earth:[
                { cn:'\u5b89\u57ce', pinyin:'An Cheng', gloss:'stable trust and protective strength' },
                { cn:'\u539a\u7136', pinyin:'Hou Ran', gloss:'generosity, steadiness, and natural poise' }
            ]
        }
    };
    const pool = wantsWisdom ? categories.wisdom
        : wantsCourage ? categories.courage
        : wantsBright ? categories.bright
        : wantsPeace ? categories.peace
        : (categories.element[element.key] || neutralNames).concat(neutralNames);
    const given = pickSeeded(pool, seed, 2) || neutralNames[0];
    const fullName = `${matched.cn}${given.cn}`;
    const fullPinyin = `${matched.pinyin} ${given.pinyin}`;
    return {
        chineseName: fullName,
        pinyin: fullPinyin,
        pronunciation: fullPinyin,
        meaning: `${fullName} means ${given.gloss}, selected as a culturally meaningful Chinese name rather than a random translation. The backup engine also considered the birth-period ${element.en} image of ${element.hint}.`,
        sections: [
            {
                titleCn:'\u59d3\u6c0f\u89e3\u91ca',
                titleEn:'Surname Explanation',
                cn:`${matched.cn}\u59d3\u4f9d\u636e\u82f1\u6587\u59d3\u6c0f ${surname || 'your surname'} \u7684\u8bfb\u97f3\u548c\u6c14\u8d28\u5339\u914d\u767e\u5bb6\u59d3\uff0c\u517c\u987e\u6d77\u5916\u7528\u6237\u53d1\u97f3\u4e0e\u4e2d\u6587\u59d3\u6c0f\u4f20\u7edf\u3002`,
                en:`The surname ${matched.cn} (${matched.pinyin}) is matched from the Hundred Family Surnames because it is ${matched.reason}.`
            },
            {
                titleCn:'\u540d\u5b57\u89e3\u91ca',
                titleEn:'Given Name Explanation',
                cn:`${given.cn}\u547c\u5e94\u4f60\u5e0c\u671b\u5448\u73b0\u7684${meaning || '\u7f8e\u597d\u5bd3\u610f'}\uff0c\u5f3a\u8c03\u540d\u5b57\u7684\u6c14\u8d28\u3001\u53ef\u8bfb\u6027\u548c\u957f\u671f\u4f7f\u7528\u611f\u3002`,
                en:`The given name ${given.cn} (${given.pinyin}) expresses ${given.gloss}, aligned with your preferred meaning and style.`
            },
            {
                titleCn:'\u53e4\u7c4d\u51fa\u5904',
                titleEn:'Classical Source',
                cn:'\u540d\u5b57\u610f\u8c61\u53c2\u8003\u300a\u8bd7\u7ecf\u300b\u7684\u6e29\u539a\u96c5\u6b63\u3001\u300a\u695a\u8f9e\u300b\u7684\u6e05\u6717\u5fd7\u5411\uff0c\u5e76\u4ee5\u300a\u6613\u7ecf\u300b\u91cd\u89c6\u5e73\u8861\u4e0e\u53d8\u5316\u7684\u601d\u60f3\u4f5c\u6574\u4f53\u53d6\u5411\u3002',
                en:'The imagery is inspired by the elegance of the Book of Songs, the aspiration of Chu Ci, and the I Ching idea of balance and timely change.'
            },
            {
                titleCn:'\u6574\u4f53\u5bd3\u610f',
                titleEn:'Overall Meaning',
                cn:`\u7ed3\u5408\u51fa\u751f\u4fe1\u606f${birthText || '\u4e0e\u4e2a\u4eba\u504f\u597d'}\uff0c\u53c2\u8003\u4e94\u884c\u4e2d\u201c${element.cn}\u201d\u7684\u610f\u8c61\uff0c\u8fd9\u4e2a\u540d\u5b57\u5448\u73b0\u542b\u84c4\u3001\u53ef\u4fe1\u3001\u9002\u5408\u8de8\u6587\u5316\u573a\u666f\u4f7f\u7528\u7684\u4e1c\u65b9\u6c14\u8d28\u3002`,
                en:`Considering ${birthText || 'your profile'} and the five-elements image of ${element.en}, this name feels refined, memorable, and suitable for long-term cross-cultural use.`
            }
        ],
        source: 'fallback',
        fallbackSeed: seed
    };
}

function normalizeNameResult(raw){
    const parsed = raw && typeof raw === 'object' ? raw : (extractJsonObject(raw) || {});
    const rawText = typeof raw === 'string' ? raw : JSON.stringify(parsed);
    const chineseName = cleanStr(parsed.chineseName || parsed.name || parsed.fullName || '') ||
        ((rawText || '').match(/\u3010\u5b8c\u6574\u4e2d\u6587\u59d3\u540d\u3011\uff1a([^\n\u3010]+)/)?.[1] || '').replace(/[^\u4e00-\u9fa5]/g, '');
    const pinyin = cleanStr(parsed.pinyin || '') ||
        ((rawText || '').match(/\u3010\u62fc\u97f3\u3011\uff1a([^\n\u3010]+)/)?.[1] || '');
    const meaning = cleanStr(parsed.meaning || parsed.explanation || parsed.description || '') ||
        ((rawText || '').match(/\u3010\u5bd3\u610f\u89e3\u6790\u3011\uff1a([\s\S]+)/)?.[1] || '');
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
        raw: rawText || '',
        source: cleanStr(parsed.source || ''),
        fallbackSeed: parsed.fallbackSeed || ''
    };
}

function renderSeoLandingPage(pathname, page){
    const canonical = `${OFFICIAL_DOMAIN}${pathname}`;
    const relatedLinks = Object.entries(SEO_LANDING_PAGES)
        .filter(([url]) => url !== pathname)
        .slice(0, 8)
        .map(([url, item]) => `<a href="${url}">${htmlEscape(item.h1)}</a>`)
        .join('');
    const sectionHtml = Array.isArray(page.sections) && page.sections.length
        ? `<div class="panel grid">${page.sections.map(section => `<section><h2>${htmlEscape(section[0] || '')}</h2><p>${htmlEscape(section[1] || '')}</p></section>`).join('')}</div>`
        : '';
    const questionHtml = Array.isArray(page.questions) && page.questions.length
        ? `<div class="panel"><h2>Common Questions</h2>${page.questions.map(item => `<details><summary>${htmlEscape(item[0] || '')}</summary><p>${htmlEscape(item[1] || '')}</p></details>`).join('')}</div>`
        : '';
    const exampleHtml = Array.isArray(page.examples) && page.examples.length
        ? `<div class="panel"><h2>Name Examples</h2><table class="examples"><tbody>${page.examples.map(row => `<tr>${row.map(cell => `<td>${htmlEscape(cell || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
        : '';
    const faqJsonLd = Array.isArray(page.questions) && page.questions.length ? {
        '@context':'https://schema.org',
        '@type':'FAQPage',
        mainEntity: page.questions.map(item => ({
            '@type':'Question',
            name: item[0],
            acceptedAnswer: { '@type':'Answer', text: item[1] }
        }))
    } : null;
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
    const structuredData = faqJsonLd ? [jsonLd, faqJsonLd] : jsonLd;
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
<script type="application/ld+json">${JSON.stringify(structuredData)}</script>
<style>
body{margin:0;background:#f7f2e9;color:#3f3024;font-family:Georgia,"Times New Roman",serif;line-height:1.7}
.wrap{max-width:960px;margin:0 auto;padding:48px 20px}
.eyebrow{color:#8c2318;font-size:14px;letter-spacing:.08em;text-transform:uppercase}
h1{font-size:clamp(34px,5vw,58px);line-height:1.05;margin:12px 0 18px;color:#8c2318}
h2{font-size:24px;color:#8c2318;margin:0 0 8px}
.lead{font-size:20px;max-width:760px}
.panel{margin-top:32px;padding:24px;border:1px solid #d8c6b0;background:#fffbf5;border-radius:8px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.grid section{border-left:3px solid #d4af37;padding-left:14px}
.links{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:14px}
.links a{color:#8c2318;text-decoration:none;border-bottom:1px solid #d8c6b0;padding-bottom:4px}
details{border-top:1px solid #eadbc8;padding:12px 0}
summary{cursor:pointer;color:#5f3428;font-weight:700}
table.examples{width:100%;border-collapse:collapse;margin-top:12px}
.examples td{border-bottom:1px solid #eadbc8;padding:12px 10px;vertical-align:top}
.examples td:first-child{font-size:22px;color:#8c2318;font-family:KaiTi,STKaiti,serif;white-space:nowrap}
.examples td:nth-child(2){color:#7a563d;white-space:nowrap}
.cta{display:inline-block;margin-top:24px;padding:12px 18px;background:#8c2318;color:#fff;text-decoration:none;border-radius:6px}
.han{font-family:KaiTi,STKaiti,serif;color:#9a6a2f}
ul{padding-left:20px}
@media(max-width:760px){.grid,.links{grid-template-columns:1fr}.wrap{padding:34px 16px}}
</style>
</head>
<body><main class="wrap">
<div class="eyebrow">My Chinese Name \u00b7 \u4e2d\u56fd\u4f20\u7edf\u6587\u5316\u4e2d\u6587\u8d77\u540d</div>
<h1>${htmlEscape(page.h1)}</h1>
<p class="lead">${htmlEscape(page.intro)}</p>
<div class="panel">
<p>${htmlEscape(page.focus)}</p>
<ul>
<li>English surname matched to a Chinese surname from the Hundred Family Surnames.</li>
<li>Name characters inspired by the I Ching, Book of Songs, Chu Ci, and five-elements balance.</li>
<li>Each result includes Chinese characters, pinyin, pronunciation guidance, English meaning, and cultural source.</li>
</ul>
<p class="han">\u540d\u4ee5\u8f7d\u9053\uff0c\u5b57\u4e2d\u6709\u5149\u3002</p>
<a class="cta" href="/">Generate My Chinese Name</a>
</div>
${exampleHtml}
${sectionHtml}
${questionHtml}
<div class="panel"><h2>Explore More Naming Guides</h2><div class="links">${relatedLinks}</div></div>
</main></body></html>`;
}

// ============================================================
// API\u8def\u7531
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

app.post('/api/share-card', (req, res) => {
    const svg = cleanShareSvg(req.body?.svg);
    const previewPng = cleanPngDataUrl(req.body?.previewPng);
    const squarePng = cleanPngDataUrl(req.body?.squarePng);
    const name = cleanStr(req.body?.name || '').slice(0, 24);
    const pinyin = cleanStr(req.body?.pinyin || '').slice(0, 80);
    const summary = cleanStr(req.body?.summary || '').slice(0, 280);
    if(!svg || !name || !previewPng || !squarePng) {
        appendAnalyticsEvent(req, 'share_card_failed', {
            hasSvg: !!svg,
            hasName: !!name,
            hasPreviewPng: !!previewPng,
            hasSquarePng: !!squarePng
        });
        return res.status(400).json({ success: false, error: 'Invalid share card images' });
    }

    const cards = readShareCards();
    const id = createShareId();
    cards[id] = {
        name,
        pinyin,
        summary,
        svg,
        previewPng,
        squarePng,
        createdAt: new Date().toISOString(),
        userId: getUserId(req)
    };
    writeShareCards(cards);
    appendAnalyticsEvent(req, 'share_card_created', { id });
    res.json({
        success: true,
        id,
        url: `${SHARE_DOMAIN}/share/${id}`,
        imageUrl: `${SHARE_DOMAIN}/share-card/${id}.png`,
        squareImageUrl: `${SHARE_DOMAIN}/share-card/${id}-square.png`
    });
});

app.get('/share-card/:id.svg', (req, res) => {
    const id = String(req.params.id || '').replace(/[^a-f0-9]/g, '');
    const card = readShareCards()[id];
    if(!card) return res.status(404).send('Not found');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('image/svg+xml').send(card.svg);
});

app.get('/share-card/:id.png', (req, res) => {
    const id = String(req.params.id || '').replace(/[^a-f0-9]/g, '');
    const card = readShareCards()[id];
    const png = card?.previewPng || card?.png;
    if(!card || !png) return res.status(404).send('Not found');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('image/png').send(Buffer.from(png, 'base64'));
});

app.get('/share-card/:id-square.png', (req, res) => {
    const id = String(req.params.id || '').replace(/[^a-f0-9]/g, '');
    const card = readShareCards()[id];
    const png = card?.squarePng || card?.png;
    if(!card || !png) return res.status(404).send('Not found');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('image/png').send(Buffer.from(png, 'base64'));
});

app.get('/share/:id', (req, res) => {
    const id = String(req.params.id || '').replace(/[^a-f0-9]/g, '');
    const card = readShareCards()[id];
    if(!card) return res.redirect('/');
    res.send(renderSharePage(id, card));
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
                    { icon: '\u2705', text: '3 custom Chinese name options' },
                    { icon: '\u2705', text: 'Basic five-elements interpretation' },
                    { icon: '\u2705', text: '1 regeneration if the direction feels wrong' },
                    { icon: '\u2705', text: 'Chinese characters, pinyin, and English meaning' }
                ]
            },
            premium: {
                price: 19.9,
                originalPrice: 39.9,
                label: 'Premium',
                badge: 'Most Popular',
                features: [
                    { icon: '\u2705', text: '5 exclusive Chinese name options' },
                    { icon: '\u2705', text: 'Full birth-time and five-elements interpretation' },
                    { icon: '\u2705', text: 'Book of Songs / Chu Ci source explanation' },
                    { icon: '\u2705', text: 'Downloadable naming certificate' },
                    { icon: '\u2705', text: '1 calligraphy-style name card' }
                ]
            },
            ultimate: {
                price: 29.9,
                originalPrice: 59.9,
                label: 'Ultimate',
                badge: 'Full Service',
                features: [
                    { icon: '\u2705', text: 'Unlimited name generations for your project' },
                    { icon: '\u2705', text: 'In-depth cultural customization' },
                    { icon: '\u2705', text: 'Lifetime name record storage' },
                    { icon: '\u2705', text: 'Priority support for payment or generation issues' }
                ]
            }
        }
    });
});

function renderAdminDashboard(req){
    const analytics = summarizeAnalytics();
    const users = readUserState();
    const payments = readPaymentLog().slice(-80).reverse();
    const contactMessages = readContactMessages().slice(-80).reverse();
    const analyticsFileExists = fs.existsSync(ANALYTICS_LOG_FILE);
    const analyticsFileSize = analyticsFileExists ? fs.statSync(ANALYTICS_LOG_FILE).size : 0;
    const latestPageView = analytics.recent.find(item => item.event === 'page_view');
    const card = (label, value, sub = '') => `<div class="card"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
    const eventLabel = {
        page_view: '\u9875\u9762\u8bbf\u95ee',
        generate_click: '\u70b9\u51fb\u751f\u6210',
        generate_success: '\u751f\u6210\u6210\u529f',
        generate_failed: '\u751f\u6210\u5931\u8d25',
        paywall_show: '\u4ed8\u8d39\u5f39\u7a97',
        buy_click: '\u8d2d\u4e70\u70b9\u51fb',
        share_click: '\u5206\u4eab\u70b9\u51fb',
        share_reward: '\u5206\u4eab\u5956\u52b1',
        share_card_created: '\u5206\u4eab\u9875\u751f\u6210',
        share_card_failed: '\u5206\u4eab\u9875\u751f\u6210\u5931\u8d25'
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
        <td>${htmlEscape(item.userId || '')}</td><td>${htmlEscape(item.status || '')}</td><td>${htmlEscape(item.err || (item.success ? '\u6210\u529f' : ''))}</td>
    </tr>`).join('');
    const contactRows = contactMessages.map(item => `<tr>
        <td>${htmlEscape(item._ts || '')}</td>
        <td>${htmlEscape(item.name || '')}</td>
        <td>${htmlEscape(item.email || '')}</td>
        <td>${htmlEscape(item.ip || '')}</td>
        <td>${htmlEscape(item.message || '')}</td>
    </tr>`).join('');

    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>\u8fd0\u8425\u540e\u53f0 | My Chinese Name</title>
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
    <div class="top"><div><h1>\u8fd0\u8425\u540e\u53f0</h1><div class="muted">My Chinese Name Analytics Dashboard \u00b7 ${htmlEscape(new Date().toLocaleString())}</div></div><a class="logout" href="${ADMIN_PATH}?logout=1">\u9000\u51fa</a></div>
    <div class="grid">
      ${card('\u4eca\u65e5\u8bbf\u95ee', analytics.todayCounts.page_view || 0, 'page_view today')}
      ${card('\u603b\u8bbf\u95ee', analytics.counts.page_view || 0, 'page_view total')}
      ${card('\u751f\u6210\u6210\u529f', analytics.counts.generate_success || 0, `\u4eca\u65e5 ${analytics.todayCounts.generate_success || 0}`)}
      ${card('\u751f\u6210\u5931\u8d25', analytics.counts.generate_failed || 0, `\u4eca\u65e5 ${analytics.todayCounts.generate_failed || 0}`)}
      ${card('\u70b9\u51fb\u751f\u6210', analytics.counts.generate_click || 0, `\u4eca\u65e5 ${analytics.todayCounts.generate_click || 0}`)}
      ${card('\u4ed8\u8d39\u5f39\u7a97', analytics.counts.paywall_show || 0, `\u4eca\u65e5 ${analytics.todayCounts.paywall_show || 0}`)}
      ${card('\u8d2d\u4e70\u70b9\u51fb', analytics.counts.buy_click || 0, `\u4eca\u65e5 ${analytics.todayCounts.buy_click || 0}`)}
      ${card('\u5206\u4eab\u70b9\u51fb', analytics.counts.share_click || 0, `\u4eca\u65e5 ${analytics.todayCounts.share_click || 0}`)}
    </div>
    <section><h2>\u7edf\u8ba1\u8bca\u65ad</h2><div class="muted">analytics-log.json: ${analyticsFileExists ? '\u5df2\u5b58\u5728' : '\u4e0d\u5b58\u5728'} \u00b7 ${analyticsFileSize} bytes \u00b7 total events ${analytics.total || 0} \u00b7 latest page_view ${htmlEscape(latestPageView?._ts || '\u6682\u65e0')}<br>DATA_DIR: ${htmlEscape(DATA_DIR)} \u00b7 ${process.env.DATA_DIR ? '\u5df2\u914d\u7f6e\u6301\u4e45\u5316\u76ee\u5f55' : '\u672a\u914d\u7f6e\uff0c\u90e8\u7f72\u540e\u53ef\u80fd\u5f52\u96f6'}</div></section>
    <section><h2>\u6700\u8fd1 7 \u5929\u8d8b\u52bf</h2><table><thead><tr><th>\u65e5\u671f</th><th>\u8bbf\u95ee</th><th>\u70b9\u51fb\u751f\u6210</th><th>\u751f\u6210\u6210\u529f</th><th>\u751f\u6210\u5931\u8d25</th><th>\u4ed8\u8d39\u5f39\u7a97</th><th>\u8d2d\u4e70\u70b9\u51fb</th><th>\u5206\u4eab\u70b9\u51fb</th></tr></thead><tbody>${dailyRows}</tbody></table></section>
    <section><h2>\u6700\u8fd1\u4e8b\u4ef6</h2><table><thead><tr><th>\u65f6\u95f4</th><th>\u4e8b\u4ef6</th><th>\u7528\u6237</th><th>IP</th><th>\u4fe1\u606f</th></tr></thead><tbody>${recentRows || '<tr><td colspan="5">\u6682\u65e0\u6570\u636e</td></tr>'}</tbody></table></section>
    <section><h2>\u8054\u7cfb\u6211\u4eec\u7559\u8a00</h2><table><thead><tr><th>\u65f6\u95f4</th><th>\u59d3\u540d</th><th>\u90ae\u7bb1</th><th>IP</th><th>\u7559\u8a00\u5185\u5bb9</th></tr></thead><tbody>${contactRows || '<tr><td colspan="5">\u6682\u65e0\u7559\u8a00</td></tr>'}</tbody></table></section>
    <section><h2>\u7528\u6237\u989d\u5ea6</h2><table><thead><tr><th>\u7528\u6237ID/IP</th><th>\u5957\u9910</th><th>\u5269\u4f59\u989d\u5ea6</th><th>\u4e94\u884c\u7b49\u7ea7</th><th>\u4ea4\u6613\u53f7</th><th>\u652f\u4ed8\u65f6\u95f4</th></tr></thead><tbody>${userRows || '<tr><td colspan="6">\u6682\u65e0\u6570\u636e</td></tr>'}</tbody></table></section>
    <section><h2>\u652f\u4ed8\u65e5\u5fd7</h2><table><thead><tr><th>\u65f6\u95f4</th><th>\u4ea4\u6613\u53f7</th><th>\u5957\u9910</th><th>\u7528\u6237</th><th>\u72b6\u6001</th><th>\u7ed3\u679c/\u9519\u8bef</th></tr></thead><tbody>${paymentRows || '<tr><td colspan="6">\u6682\u65e0\u6570\u636e</td></tr>'}</tbody></table></section>
    </div></body></html>`;
}

function renderAdminLogin(error = ''){
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>\u540e\u53f0\u767b\u5f55</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f7f2e9;color:#443322;font-family:Arial,"Noto Serif SC",serif}.box{width:min(420px,92vw);background:#fffbf5;border:1px solid #e2d0b8;border-radius:10px;padding:26px;box-shadow:0 8px 28px rgba(139,90,43,.15)}h1{margin:0 0 18px;color:#8c2318;font-size:24px}input{width:100%;padding:12px;border:1px solid #d8c6b0;border-radius:6px;font-size:16px}button{width:100%;margin-top:14px;padding:12px;border:0;border-radius:6px;background:#8c2318;color:#fff;font-size:16px;cursor:pointer}.err{color:#b42a2a;margin:10px 0;font-size:13px}.hint{color:#997755;font-size:13px;line-height:1.6}</style></head><body><form class="box" method="post" action="${ADMIN_PATH}"><h1>\u8fd0\u8425\u540e\u53f0\u767b\u5f55</h1>${error ? `<div class="err">${htmlEscape(error)}</div>` : ''}<input type="password" name="password" placeholder="\u8bf7\u8f93\u5165\u540e\u53f0\u5bc6\u7801" autofocus><button type="submit">\u767b\u5f55</button><div class="hint">\u7528\u4e8e\u67e5\u770b\u8bbf\u95ee\u7528\u91cf\u3001\u751f\u6210\u6b21\u6570\u3001\u7528\u6237\u989d\u5ea6\u548c\u652f\u4ed8\u65e5\u5fd7\u3002</div></form></body></html>`;
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
        return res.status(401).send(renderAdminLogin('\u5bc6\u7801\u4e0d\u6b63\u786e'));
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

async function probeNameEngine(){
    if(!DEEPSEEK_API_KEY) {
        return { configured: false, ok: false, error: 'DEEPSEEK_API_KEY is not configured' };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: 'Return JSON only.' },
                    { role: 'user', content: 'Return {"ok":true}.' }
                ],
                max_tokens: 20,
                temperature: 0,
                response_format: { type: 'json_object' }
            })
        });
        clearTimeout(timeout);
        const body = await resp.json().catch(() => ({}));
        return {
            configured: true,
            ok: resp.ok && !!body.choices?.[0]?.message?.content,
            status: resp.status,
            error: resp.ok ? '' : (body.error?.message || body.error || 'DeepSeek probe failed')
        };
    } catch(err) {
        clearTimeout(timeout);
        return { configured: true, ok: false, error: err.message || 'DeepSeek probe failed' };
    }
}

app.get('/api/admin/name-engine-status', async (req, res) => {
    if(!isAdminAuthed(req)) return res.status(401).json({ error: 'admin auth required' });
    const probe = req.query.probe === '1';
    const status = {
        nodeEnv: process.env.NODE_ENV || '',
        deepseekKeyConfigured: !!DEEPSEEK_API_KEY,
        deepseekKeyLooksValid: /^sk-[A-Za-z0-9_-]{20,}$/.test(DEEPSEEK_API_KEY),
        deepseekKeyWasNormalized: DEEPSEEK_API_KEY !== String(process.env.DEEPSEEK_API_KEY || '').trim()
    };
    if(probe) status.probe = await probeNameEngine();
    res.json(status);
});

app.post('/api/track', (req, res) => {
    const event = cleanStr(req.body.event || '');
    const meta = req.body.meta && typeof req.body.meta === 'object' ? req.body.meta : {};
    res.json(appendAnalyticsEvent(req, event, meta));
});

app.get('/api/track-pixel.gif', (req, res) => {
    const event = cleanStr(req.query.event || 'page_view');
    const meta = {
        path: cleanStr(req.query.path || ''),
        uid: cleanStr(req.query.uid || '').slice(0, 80),
        source: 'pixel'
    };
    appendAnalyticsEvent(req, event, meta);
    res.set({
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
    });
    res.end(TRACKING_PIXEL);
});

app.post('/api/share-reward', (req, res) => {
    if(req.body?.hasCard !== true) {
        return res.status(400).json({ success: false, error: 'Share reward requires a generated name card' });
    }
    const result = addShareReward(getUserId(req));
    appendAnalyticsEvent(req, 'share_reward', { quota: result.quota, alreadyClaimed: !!result.alreadyClaimed, rewardAdded: !!result.rewardAdded });
    res.json(result);
});

// --------------------------------------------------------
// PayPal \u652f\u4ed8\u8bf7\u6c42\uff08REST API \u6b63\u5f0f\u7248\uff09
// --------------------------------------------------------
app.post('/api/paypal-order', (req, res) => {
    const pkg = cleanStr(req.body.package) || cleanStr(req.body.pkg);
    if(!pkg || !PACKAGE_ENTITLEMENTS[pkg]) return res.status(400).json({ error: 'Unknown package' });

    const amounts = { basic:'9.9', premium:'19.9', ultimate:'29.9' };
    const pkgNames = { basic:'Basic Plan', premium:'Premium Plan', ultimate:'Ultimate VIP' };
    const amount = amounts[pkg];
    const domain = process.env.DOMAIN || 'http://localhost:3000';
    const userId = getUserId(req);
    const custom = `${pkg}|${userId}`;

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
            custom
        }]
    };

    paypal.payment.create(payment, (error, result) => {
        if(error) {
            logError('PayPal payment create error:', error.message);
            return res.status(500).json({ error: 'Payment creation failed', detail: error.message });
        }
        const approvalUrl = result.links.find(l => l.rel === 'approval_url');
        if(!approvalUrl) return res.status(500).json({ error: 'No approval URL' });
        savePayPalOrder(result.id, { pkg, userId, amount, currency: 'USD', status: 'created' });
        appendPaymentLog({ status: 'created', txn: result.id, userId, pkg });
        res.json({ paypalUrl: approvalUrl.href, paymentId: result.id });
    });
});

// --------------------------------------------------------
// PayPal IPN\uff08\u5b98\u65b9\u5f02\u6b65\u901a\u77e5 + \u4e09\u5c42\u5b89\u5168\u6821\u9a8c\uff09
// --------------------------------------------------------
app.post('/api/paypal-ipn', express.urlencoded({ extended: false }), async (req, res) => {
    const ipn = req.body;
    log('[app] request processed');

    if(!ipn.txn_id || !ipn.payment_status) {
        appendPaymentLog({ err: 'Missing required fields', ipn: JSON.stringify(ipn).substring(0,200) });
        return res.status(400).send('Missing required fields');
    }

    if(ipn.payment_status !== 'Completed') {
        appendPaymentLog({ status: ipn.payment_status, txn: ipn.txn_id, err: 'Payment not completed' });
        return res.send('ok');
    }

    // \u89e3\u6790\u5957\u9910\u548c\u7528\u6237ID\uff08REST API \u901a\u8fc7 custom \u5b57\u6bb5\u4f20\u9012\uff09
    const custom = parsePayPalCustom(ipn.custom);
    const orders = readPayPalOrders();
    const pendingOrder = orders[ipn.parent_txn_id] || orders[ipn.txn_id] || {};
    const pkg = custom.pkg || pendingOrder.pkg || 'basic';
    const userId = custom.userId || pendingOrder.userId || getUserId(req);

    // === \u4e09\u5c42\u5b89\u5168\u6821\u9a8c\uff08IPN \u5f02\u6b65\u901a\u77e5\u6821\u9a8c\uff0cemail \u4ece .env \u8bfb\u53d6\uff09===
    const paypalEmail = process.env.PAYPAL_EMAIL || '';
    if(paypalEmail && ipn.receiver_email && ipn.receiver_email.toLowerCase() !== paypalEmail.toLowerCase()) {
        appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: `\u4f60\u662f\u9762\u5411\u6d77\u5916\u7528\u6237\u7684\u4e2d\u6587\u8d77\u540d\u5e08,\u6839\u636e\u6027\u522b,\u98ce\u683c\u751f\u6210\u540d\u5b57,\u8f93\u51fa\u683c\u5f0f:\u4e2d\u6587\u540d+\u62fc\u97f3+\u82f1\u6587\u91ca\u4e49+\u5bd3\u610f\u89e3\u6790` });
        logError('[rate-limit] request blocked');
        return res.send('ok');
    }

    // \u2461 \u5e01\u79cd\u6821\u9a8c\uff08\u4ec5\u652f\u6301USD\uff09
    if(ipn.mc_currency !== 'USD') {
        appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: `\u4f60\u662f\u9762\u5411\u6d77\u5916\u7528\u6237\u7684\u4e2d\u6587\u8d77\u540d\u5e08,\u6839\u636e\u6027\u522b,\u98ce\u683c\u751f\u6210\u540d\u5b57,\u8f93\u51fa\u683c\u5f0f:\u4e2d\u6587\u540d+\u62fc\u97f3+\u82f1\u6587\u91ca\u4e49+\u5bd3\u610f\u89e3\u6790` });
        logError('[rate-limit] request blocked');
        return res.send('ok');
    }

    // \u2462 \u91d1\u989d\u6821\u9a8c
    const expected = { basic:'9.90', premium:'19.90', ultimate:'29.90' };
    if(ipn.mc_gross !== expected[pkg]) {
        appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: `\u4f60\u662f\u9762\u5411\u6d77\u5916\u7528\u6237\u7684\u4e2d\u6587\u8d77\u540d\u5e08,\u6839\u636e\u6027\u522b,\u98ce\u683c\u751f\u6210\u540d\u5b57,\u8f93\u51fa\u683c\u5f0f:\u4e2d\u6587\u540d+\u62fc\u97f3+\u82f1\u6587\u91ca\u4e49+\u5bd3\u610f\u89e3\u6790` });
        logError('[rate-limit] request blocked');
        return res.send('ok');
    }

    // \u901a\u8fc7\u5168\u90e8\u6821\u9a8c\uff0c\u89e3\u9501\u5957\u9910
    try {
        unlockPackage(userId, pkg, ipn.txn_id);
        appendPaymentLog({ status: ipn.payment_status, txn: ipn.txn_id, userId, pkg, success: true });
        log('[app] request processed');
    } catch(err) {
        appendPaymentLog({ txn: ipn.txn_id, userId, pkg, err: err.message });
        logError('[rate-limit] request blocked');
    }

    res.send('ok');
});

// --------------------------------------------------------
// PayPal \u540c\u6b65\u56de\u8c03
// --------------------------------------------------------
app.post('/api/paypal-checkout', (req, res) => {
    const transactionId = cleanStr(req.body.transactionId);
    const payerId = cleanStr(req.body.payerId || req.body.PayerID);
    const pkg = cleanStr(req.body.package) || cleanStr(req.body.pkg);
    const reqUserId = cleanStr(req.body.userId);
    if(!transactionId) return res.status(400).json({ success: false });
    const orders = readPayPalOrders();
    const pendingOrder = orders[transactionId] || {};
    const finalPkg = pkg || pendingOrder.pkg;
    const userId = reqUserId || pendingOrder.userId || getUserId(req);
    if(!finalPkg || !PACKAGE_ENTITLEMENTS[finalPkg]) {
        appendPaymentLog({ txn: transactionId, userId, pkg: finalPkg || '', err: 'Unknown package on checkout' });
        return res.status(400).json({ success: false, error: 'Unknown package' });
    }

    const finishUnlock = (verifiedTransactionId, source) => {
        unlockPackage(userId, finalPkg, verifiedTransactionId || transactionId);
        orders[transactionId] = {
            ...pendingOrder,
            pkg: finalPkg,
            userId,
            status: 'completed',
            source,
            completedAt: new Date().toISOString()
        };
        writePayPalOrders(orders);
        appendPaymentLog({ status: 'completed', txn: verifiedTransactionId || transactionId, userId, pkg: finalPkg, source, success: true });
        log('[app] request processed');
        res.json({ success: true });
    };

    if(!payerId) {
        appendPaymentLog({ txn: transactionId, userId, pkg: finalPkg, err: 'Missing PayerID on checkout return' });
        return res.status(400).json({ success: false, error: 'Missing PayerID' });
    }

    paypal.payment.execute(transactionId, { payer_id: payerId }, (error, payment) => {
        if(error) {
            const message = error.response?.message || error.message || 'PayPal execute failed';
            appendPaymentLog({ txn: transactionId, userId, pkg: finalPkg, err: message });
            return res.status(400).json({ success: false, error: message });
        }
        const txn = payment.transactions?.[0] || {};
        const sale = txn.related_resources?.[0]?.sale || {};
        const paypalCustom = parsePayPalCustom(txn.custom);
        const verifiedPkg = paypalCustom.pkg || finalPkg;
        const amount = String(txn.amount?.total || '');
        const currency = String(txn.amount?.currency || '');
        const expected = { basic:'9.90', premium:'19.90', ultimate:'29.90' };
        if(verifiedPkg !== finalPkg || currency !== 'USD' || Number(amount).toFixed(2) !== expected[finalPkg]) {
            appendPaymentLog({ txn: transactionId, userId, pkg: finalPkg, err: 'PayPal amount/package verification failed' });
            return res.status(400).json({ success: false, error: 'Payment verification failed' });
        }
        finishUnlock(sale.id || payment.id || transactionId, 'paypal_execute');
    });
});

// --------------------------------------------------------
// \u5f02\u5e38\u8ba2\u5355\u65e5\u5fd7\u67e5\u8be2
// --------------------------------------------------------
app.get('/admin-payment-log', (req, res) => {
    fs.readFile(PAYMENT_LOG_FILE, 'utf8', (err, data) => {
        if(err) return res.send('\u6682\u65e0\u652f\u4ed8\u65e5\u5fd7');
        const logs = JSON.parse(data);
        const html = `\u4f60\u662f\u9762\u5411\u6d77\u5916\u7528\u6237\u7684\u4e2d\u6587\u8d77\u540d\u5e08,\u6839\u636e\u6027\u522b,\u98ce\u683c\u751f\u6210\u540d\u5b57,\u8f93\u51fa\u683c\u5f0f:\u4e2d\u6587\u540d+\u62fc\u97f3+\u82f1\u6587\u91ca\u4e49+\u5bd3\u610f\u89e3\u6790` + logs.map(l => `<tr style="background:${l.success?'#f0fff0':'#fff0f0'}">
        <td>${l._ts||''}</td><td>${l.txn||''}</td><td>${l.pkg||''}</td><td>${l.userId||''}</td><td>${l.status||''}</td><td>${l.err||(l.success?'\u2705\u6210\u529f':'\u274c\u5931\u8d25')}</td>
        </tr>`).join('');
        res.send(html);
    });
});

// ============================================================
// \u8d77\u540dAPI\uff08DeepSeek \u552f\u4e00\u63a5\u53e3\uff09
// \u53d7 rateLimitMiddleware \u4fdd\u62a4
// ============================================================
app.post('/api/generate-name', rateLimitMiddleware, async (req, res) => {
    const { englishName, englishSurname, gender, birthYear, birthMonth, birthDay, birthTime, style, meaning } = req.body;
    // \u517c\u5bb9\u524d\u7aef\u65e7\u5b57\u6bb5\u540d givenName\u2192englishName, surname\u2192englishSurname
    const givenName = cleanStr(req.body.givenName) || cleanStr(englishName);
    const surname = cleanStr(req.body.surname) || cleanStr(englishSurname);
    // \u517c\u5bb9 birthDate \u62c6\u89e3\u4e3a birthYear/Month/Day
    const bd = cleanStr(req.body.birthDate) || '';
    const by = cleanStr(req.body.birthYear) || (bd.match(/^(\d{4})/)?.[1]) || cleanStr(birthYear) || '';
    const bm = cleanStr(req.body.birthMonth) || (bd.match(/[-/](\d{1,2})/)?.[1]) || cleanStr(birthMonth) || '';
    const bd2 = cleanStr(req.body.birthDay) || (bd.match(/[-/](\d{1,2})[-/](\d{1,2})/)?.[2]) || cleanStr(birthDay) || '';
    const finalEnglishName = givenName;
    const finalEnglishSurname = surname;
    const finalGender = cleanStr(gender);
    // \u6027\u522b\u63d0\u53d6\uff1a\u539f\u59cb\u503c\u4e0d\u8d70cleanStr\uff0c\u76f4\u63a5\u8bc6\u522b\u82f1\u6587Male/Female/\u4e2d\u6027
    const rawGender = gender || '';
    const genderDisplay = rawGender.toLowerCase().includes('female') ? 'Female' :
                        rawGender.toLowerCase().includes('male') ? 'Male' : '\u4e2d\u6027';
    const finalStyle = cleanStr(style);
    const finalMeaning = cleanStr(meaning);

    // \u57fa\u7840\u8f93\u5165\u6821\u9a8c\uff08englishName/surname \u5fc5\u586b\uff0cmeaning/style/gender \u53ef\u7a7a\uff09
    if (!finalEnglishName || !finalEnglishSurname) {
        return res.status(400).json({ error: 'englishName and englishSurname are required' });
    }
    if (typeof finalEnglishName !== 'string' || typeof finalEnglishSurname !== 'string' ||
        finalEnglishName.length > 50 || finalEnglishSurname.length > 50) {
        return res.status(400).json({ error: 'Invalid name length' });
    }
    // gender \u53ef\u7a7a\uff1b\u8bc6\u522b\u82f1\u6587 Male/Female\uff0c\u5176\u4f59\u4e3a\u4e2d\u6027 Neutral
    if (rawGender.trim().length > 0) {
        const g = rawGender.toLowerCase();
        if (!g.includes('male') && !g.includes('female')) {
            return res.status(400).json({ error: 'gender must be Male/Female' });
        }
    }
    // meaning/style \u5747\u53ef\u9009\uff0c\u7a7a\u503c\u4e0d\u62e6\u622a

    const userId = getUserId(req);
    const status = getUserStatus(userId);
    const devTest = isLocalDevTest(req);

    const quotaLimited = !devTest && status.package !== 'ultimate';

    // Quota-limited users are checked before generation, then charged only after a successful result.
    if(quotaLimited) {
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
  "chineseName": "\u4e2d\u6587\u59d3\u540d",
  "pinyin": "Pinyin with tone-friendly spacing",
  "pronunciation": "Simple English pronunciation guide",
  "meaning": "One-sentence English summary",
  "sections": [
    {"titleCn":"\u59d3\u6c0f\u89e3\u91ca","titleEn":"Surname Explanation","cn":"\u4e2d\u6587\u8bf4\u660e","en":"English explanation"},
    {"titleCn":"\u540d\u5b57\u89e3\u91ca","titleEn":"Given Name Explanation","cn":"\u4e2d\u6587\u8bf4\u660e","en":"English explanation"},
    {"titleCn":"\u53e4\u7c4d\u51fa\u5904","titleEn":"Classical Source","cn":"\u4e2d\u6587\u8bf4\u660e","en":"English explanation"},
    {"titleCn":"\u6574\u4f53\u5bd3\u610f","titleEn":"Overall Meaning","cn":"\u4e2d\u6587\u8bf4\u660e","en":"English explanation"}
  ]
}`;

    const deepseek = { url:'https://api.deepseek.com/v1/chat/completions', model: "deepseek-chat" };

    async function callAI() {
        if(!DEEPSEEK_API_KEY) {
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
                headers: {'Content-Type':'application/json','Authorization':`Bearer ${DEEPSEEK_API_KEY}`},
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
        log('[app] request processed');
        const result = await callAI('deepseek');
        let normalized = normalizeNameResult(result);
        let usedFallback = false;
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
            usedFallback = true;
        }
        if(quotaLimited && !usedFallback && !useQuota(userId)) {
            return res.status(402).json({ error: 'quota exhausted', showPaywall: true });
        }
        res.json({ success: true, devTest, data: normalized, fallback: usedFallback, quotaCharged: !usedFallback });
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
        res.json({ success: true, devTest, data: fallback, fallback: true, quotaCharged: false });
    }
});

// ============================================================
// \u7559\u8a00\u677f
// ============================================================
app.post('/api/submit-message', (req, res) => {
    const name = cleanStr(req.body.name) || 'anonymous';
    const email = cleanStr(req.body.email) || '';
    const message = cleanStr(req.body.message) || '';
    const time = new Date().toLocaleString();
    const content = `[${time}] ${name}(${email}): ${message}\n`;
    try {
        appendContactMessage({
            name,
            email,
            message,
            ip: getClientIp(req),
            ua: (req.headers['user-agent'] || '').substring(0, 180),
            path: req.headers.referer || '/contact-us'
        });
    } catch(err) {
        logError('[contact-message] failed to save structured message:', err.message);
    }
    fs.appendFile('messages.txt', content, err => {
        res.send(err ? "\u7559\u8a00\u63d0\u4ea4\u5931\u8d25" : "\u7559\u8a00\u63d0\u4ea4\u6210\u529f\uff0c\u611f\u8c22\u53cd\u9988\uff01");
    });
});

app.get('/admin-messages', (req, res) => {
    if(!isAdminAuthed(req)) return res.redirect(ADMIN_PATH);
    const rows = readContactMessages().slice(-120).reverse().map(item =>
        `[${item._ts || ''}] ${item.name || ''} (${item.email || ''}) ${item.message || ''}`
    ).join('\n');
    res.type('text/plain').send(rows || "\u6682\u65e0\u7559\u8a00");
});

// ============================================================
// \u9875\u9762\u8def\u7531
// ============================================================
app.get('/brand-intro',      (req, res) => res.sendFile(path.join(__dirname, 'brand-intro.html')));
app.get('/contact-us',        (req, res) => res.sendFile(path.join(__dirname, 'contact-us.html')));
app.get('/terms',             (req, res) => res.sendFile(path.join(__dirname, 'terms.html')));
app.get('/privacy',           (req, res) => res.sendFile(path.join(__dirname, 'privacy.html')));
app.get('/faq',               (req, res) => res.sendFile(path.join(__dirname, 'faq.html')));
app.get('/payment-guide',     (req, res) => res.sendFile(path.join(__dirname, 'payment-guide.html')));
app.get('/googlee0af6ad701bdcf22.html', (req, res) => {
    res.type('text/plain').send('google-site-verification: googlee0af6ad701bdcf22.html');
});

// ============================================================
// \u4e66\u6cd5\u5934\u50cf\uff08\u540e\u7aef\u6e32\u67d3\u515c\u5e95\uff09
// ============================================================
app.get('/api/avatar-svg', (req, res) => {
    const name = (req.query.name || '\u674e\u660e').replace(/[^\u4e00-\u9fa5]/g, '').substring(0, 6);
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
    <text x="24" y="19" font-size="12" text-anchor="middle" fill="#f8ead2" font-family="STXingkai, KaiTi, serif">\u96c5</text>
    <text x="24" y="35" font-size="12" text-anchor="middle" fill="#f8ead2" font-family="STXingkai, KaiTi, serif">\u540d</text>
  </g>
</svg>`;
    res.type('image/svg+xml').send(svg);
});

// ============================================================
// \u9519\u8bef\u5904\u7406\u4e2d\u95f4\u4ef6\uff08\u6b63\u5f0f\u73af\u5883\u5c4f\u853d\u62a5\u9519\u6808\uff09
// ============================================================
app.use((err, req, res, next) => {
    // \u6355\u83b7 JSON \u89e3\u6790\u9519\u8bef
    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
        return res.status(400).json({ error: 'Invalid JSON payload' });
    }
    if (!IS_PROD) {
        console.error(err.stack);
    }
    res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// \u9759\u6001\u6587\u4ef6\u670d\u52a1\uff08favicon.ico \u7b49\uff09
// ============================================================
app.use(express.static(path.join(__dirname, "./")));

// ============================================================
// 404 \u5168\u5c40\u5904\u7406\uff08\u9759\u6001\u6587\u4ef6\u4e4b\u540e\uff09
// ============================================================
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// ============================================================
// \u542f\u52a8
// ============================================================
app.listen(port, () => {
    console.log('[app] request processed');
    console.log(`Server is running on port ${port}`);
});
