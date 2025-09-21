const { Telegraf, Markup } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const admin = require('firebase-admin');
const cron = require('node-cron');

// Load environment variables from .env file
require('dotenv').config();

// --- Configuration ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Load Firebase service account key from a separate file for security
// Ensure this file is added to .gitignore
const FIREBASE_SERVICE_ACCOUNT = require('./serviceAccountKey.json');

const FIRESTORE_APP_ID = 'self-improvement-gt-bot'; // Use your app ID here
const FIRESTORE_DAILY_STATS_COLLECTION = 'daily_stats';
const FIRESTORE_PROFILE_COLLECTION = 'profile';
const FIRESTORE_BOOKS_COLLECTION = 'books';
const FIRESTORE_MONTHLY_GOALS_COLLECTION = 'monthly_goals';
const FIRESTORE_MOOD_JOURNAL_COLLECTION = 'mood_journal';

// IMPORTANT: Replace this with your own Telegram User ID
const ADMIN_USER_ID = '1435465455'; 
// IMPORTANT: Replace this with your community Telegram Group ID
const COMMUNITY_GROUP_ID = '-2638005100';

// --- Firebase Initialization ---
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(FIREBASE_SERVICE_ACCOUNT)
    });
}
const db = admin.firestore();

// --- Gemini AI Initialization ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-05-20' });

// --- Bot and State Management ---
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const userStates = new Map(); // Store user's current state and data

const MESSAGES = {
    WELCOME: 'မင်္ဂလာပါ၊ ကျွန်တော်ရဲ့ Self-Improvement Bot ကနေ ကြိုဆိုပါတယ်။ သင့်ကိုယ်သင် နေ့စဉ် ပိုမိုကောင်းမွန်အောင် လုပ်ဆောင်နိုင်ဖို့ ကျွန်တော်က ကူညီပေးပါလိမ့်မယ်။',
    MAIN_MENU: 'အောက်က ခလုတ်တွေကို နှိပ်ပြီး စတင်နိုင်ပါတယ်။',
    CHOOSE_CHALLENGE: 'ဒီနေ့အတွက် ဘယ်စိန်ခေါ်မှုကို လုပ်ဆောင်ချင်ပါသလဲ?',
    ACCEPT_CHALLENGE: 'ကောင်းပါပြီ! "{{challenge}}" ကို လက်ခံလိုက်ပါပြီ။',
    QUESTIONS: {
        READING: {
            BOOK: 'ဘာစာအုပ်ဖတ်ခဲ့တာလဲ?',
            BENEFIT: 'အဲ့ဒီစာအုပ်ကနေ ဘာအကျိုးကျေးဇူးရခဲ့လဲ?'
        },
        EXERCISE: {
            TYPE: 'ဘာလေ့ကျင့်ခန်းလုပ်ခဲ့တာလဲ?',
            BENEFIT: 'အဲ့ဒီလေ့ကျင့်ခန်းကနေ ဘာအကျိုးကျေးဇူးရခဲ့လဲ?'
        },
        VIDEO_JOURNAL: {
            REFLECTION: 'ဒီနေ့ ဘယ်အကြောင်းအရာတွေကို ဆွေးနွေးခဲ့လဲ?',
            BENEFIT: 'အဲ့ဒီဗီဒီယိုရိုက်တာကနေ ဘာအကျိုးကျေးဇူးရခဲ့လဲ?'
        },
        ADMIN_ADD_BOOK: {
            TITLE: 'ကျေးဇူးပြု၍ စာအုပ်နာမည်ကို ရိုက်ထည့်ပေးပါ။',
            POINTS: 'ဒီစာအုပ်အတွက် Points ဘယ်လောက်လဲ?',
            URL: 'စာအုပ်ရဲ့ PDF URL လိပ်စာကို ထည့်ပေးပါ။'
        },
        SET_MONTHLY_GOAL: 'ဒီလအတွက် သင်ရဲ့ အဓိကရည်မှန်းချက်ကို ရေးပေးပါ။',
        DAILY_MOOD: 'ဒီနေ့ သင်ရဲ့ စိတ်အခြေအနေက ဘယ်လိုရှိလဲ?',
    },
    DAILY_SUMMARY_TITLE: '*ဒီနေ့အတွက် စုစုပေါင်း မှတ်တမ်း*',
    NO_CHALLENGES_YET: 'ဒီနေ့ ဘယ်စိန်ခေါ်မှုမှ မလုပ်ဆောင်ရသေးပါဘူး။',
    TOTAL_POINTS: 'စုစုပေါင်း Points: {{points}}',
    CHALLENGE_COMPLETE: 'ကောင်းပါပြီ။ ဒီနေ့အတွက် နောက်ထပ် စိန်ခေါ်မှုတွေ လုပ်ချင်သေးလား?',
    POINTS_RECEIVED: 'သင် {{points}} points ရရှိပါပြီ။ စုစုပေါင်း points အသစ်ကတော့ {{totalPoints}} ဖြစ်ပါတယ်။',
    BOOK_REDEEM_TITLE: '*Points တွေနဲ့ စာအုပ်လဲလှယ်မယ်*',
    NOT_ENOUGH_POINTS: 'စာအုပ်လဲလှယ်ဖို့ Points မလုံလောက်သေးပါဘူး။',
    ALREADY_REDEEMED: 'ဒီစာအုပ်ကို လဲလှယ်ပြီးသားပါ။',
    ONE_BOOK_PER_WEEK: 'တစ်ပတ်မှာ စာအုပ်တစ်အုပ်ပဲ လဲလှယ်နိုင်ပါတယ်။',
    ADMIN_ADD_BOOK_SUCCESS: 'စာအုပ်အသစ်ကို Database ထဲသို့ ထည့်သွင်းပြီးပါပြီ။',
    ADMIN_PERMISSION_DENIED: 'သင့်တွင် Admin အခွင့်အရေးမရှိပါ၊ ဤ command ကို အသုံးပြုခွင့်မရှိပါ။',
    GOAL_SET_SUCCESS: 'ကောင်းပါပြီ။ ဒီလရဲ့ ရည်မှန်းချက်ကို မှတ်တမ်းတင်ပြီးပါပြီ။',
    NO_GOAL_SET: 'ဒီလအတွက် ရည်မှန်းချက် မသတ်မှတ်ရသေးပါဘူး။',
    PROGRESS_SUMMARY: '*{{month}} လအတွက် သင်ရဲ့ တိုးတက်မှု*',
    NO_PROGRESS: 'ဒီလမှာ စိန်ခေါ်မှု မလုပ်ဆောင်ရသေးပါဘူး။',
    COMMUNITY_MESSAGE: 'ကျွန်ုပ်တို့ရဲ့ အသိုင်းအဝိုင်းကို ချိတ်ဆက်ပြီး အချင်းချင်းအားပေးဖို့ ဒီ Telegram Group ကို ဝင်နိုင်ပါတယ်: https://t.me/your_community_group',
    LEADERBOARD_TITLE: '*လစဉ် စိန်ခေါ်မှု အောင်မြင်မှု အမြင့်ဆုံးစာရင်း*',
    MOOD_RECORDED: 'ဒီနေ့ သင်ရဲ့ စိတ်အခြေအနေကို မှတ်တမ်းတင်ပြီးပါပြီ။',
    MONTHLY_WINNER_ANNOUNCEMENT: '✨ *လစဉ်ဆုရှင် ကြေညာခြင်း!* ✨\n\nဒီလရဲ့ အောင်မြင်မှု အမြင့်ဆုံးဆုရှင်ကတော့ *{{winnerUsername}}* ပါ။\n\nသူတို့ဟာ ဒီလမှာ {{completionPercentage}}% အောင်မြင်မှု ရရှိပြီး အကောင်းဆုံး ကြိုးစားခဲ့ပါတယ်။\n\n{{winnerUsername}} ကို ဂုဏ်ပြုလိုက်ရအောင်!\n\nဒီလိုပဲ နောက်လမှာလည်း ပိုကောင်းအောင် ကြိုးစားပြီး အကောင်းဆုံးကို ရယူလိုက်ပါ။',
    DAILY_REMINDER_MESSAGE: 'ဒီနေ့အတွက် သင်ရဲ့ စိန်ခေါ်မှုတွေကို လုပ်ဆောင်ပြီးပြီလား? 💪\n\n{{motivation_quote}}\n\n`➕ စိန်ခေါ်မှု ရွေးချယ်ရန်` ကို နှိပ်ပြီး အခုပဲ စတင်လိုက်ပါ။'
};

const CHALLENGE_TYPES = [
    { id: 'reading', label: 'စာဖတ်ခြင်း' },
    { id: 'exercise', label: 'ကိုယ်လက်လေ့ကျင့်ခန်း' },
    { id: 'video-journal', label: 'နေ့စဉ်မှတ်တမ်း ဗီဒီယို' },
];

const getTodayDate = () => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0); // Use UTC to avoid timezone issues
    return d.toISOString().split('T')[0];
};

const getUserId = (ctx) => String(ctx.from.id);

// --- Gemini AI Call Function ---
const getGeminiContent = async (prompt) => {
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error('Gemini API call failed:', error);
        return 'အမှားတစ်ခုခုဖြစ်ပေါ်နေပါသည်။';
    }
};

// --- Bot Actions and Logic ---
const sendMainMenu = (ctx) => {
    const menu = Markup.keyboard([
        ['➕ စိန်ခေါ်မှု ရွေးချယ်ရန်'],
        ['🎯 ရည်မှန်းချက်သတ်မှတ်ရန်'],
        ['📖 နေ့စဉ်မှတ်တမ်း', '📈 လစဉ်တိုးတက်မှု'],
        ['💰 ဆိုင်ကြည့်ရန်', '✨ စိတ်ဓာတ်မြှင့်တင်ရန်'],
        ['😊 စိတ်ခံစားမှု မှတ်တမ်းတင်ရန်', '🫂 အသိုင်းအဝိုင်းဝင်ရန်']
    ]).resize();
    ctx.reply(MESSAGES.MAIN_MENU, menu);
};

bot.start((ctx) => {
    const userId = getUserId(ctx);
    userStates.delete(userId); // Clear any old state
    ctx.reply(MESSAGES.WELCOME);
    sendMainMenu(ctx);
});

// Admin-only command to add a new book
bot.command('addbook', (ctx) => {
    const userId = getUserId(ctx);
    if (userId !== ADMIN_USER_ID) {
        ctx.reply(MESSAGES.ADMIN_PERMISSION_DENIED);
        return;
    }

    userStates.set(userId, {
        currentChallenge: 'admin_add_book',
        step: 1,
        data: {}
    });

    ctx.reply(MESSAGES.QUESTIONS.ADMIN_ADD_BOOK.TITLE);
});

bot.hears('➕ စိန်ခေါ်မှု ရွေးချယ်ရန်', (ctx) => {
    const challengeButtons = CHALLENGE_TYPES.map(c => Markup.button.callback(c.label, `challenge_${c.id}`));
    const keyboard = Markup.inlineKeyboard(challengeButtons, { columns: 1 });
    ctx.reply(MESSAGES.CHOOSE_CHALLENGE, keyboard);
});

bot.hears('🎯 ရည်မှန်းချက်သတ်မှတ်ရန်', (ctx) => {
    const userId = getUserId(ctx);
    userStates.set(userId, {
        currentChallenge: 'set_monthly_goal',
        step: 1,
    });
    ctx.reply(MESSAGES.QUESTIONS.SET_MONTHLY_GOAL);
});

bot.hears('📖 နေ့စဉ်မှတ်တမ်း', async (ctx) => {
    const userId = getUserId(ctx);
    const today = getTodayDate();
    const docRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users/${userId}/${FIRESTORE_DAILY_STATS_COLLECTION}`).doc(today);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
        ctx.reply(MESSAGES.NO_CHALLENGES_YET);
        return;
    }

    const data = docSnap.data();
    let summaryText = MESSAGES.DAILY_SUMMARY_TITLE + '\n\n';

    for (const [key, value] of Object.entries(data.challenges || {})) {
        const challengeType = CHALLENGE_TYPES.find(c => c.id === key);
        summaryText += `*${challengeType.label}*\n`;
        if (key === 'reading') {
            summaryText += `- ဖတ်ခဲ့တဲ့စာအုပ်: ${value.book}\n`;
            summaryText += `- ရခဲ့တဲ့အကျိုးကျေးဇူး: ${value.benefit}\n`;
        } else if (key === 'exercise') {
            summaryText += `- လုပ်ခဲ့တဲ့လေ့ကျင့်ခန်း: ${value.type}\n`;
            summaryText += `- ရခဲ့တဲ့အကျိုးကျေးဇူး: ${value.benefit}\n`;
        } else if (key === 'video-journal') {
            summaryText += `- ဆွေးနွေးခဲ့တဲ့အကြောင်းအရာ: ${value.reflection}\n`;
            summaryText += `- ရခဲ့တဲ့အကျိုးကျေးဇူး: ${value.benefit}\n`;
        }
        summaryText += '\n';
    }

    const userRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users/${userId}/${FIRESTORE_PROFILE_COLLECTION}`).doc('data');
    const userDoc = await userRef.get();
    const totalPoints = userDoc.exists ? userDoc.data().totalPoints || 0 : 0;

    summaryText += `*ဒီနေ့ ရရှိခဲ့တဲ့ စုစုပေါင်း Points:* ${data.points || 0}\n`;
    summaryText += `*စုစုပေါင်း Points:* ${totalPoints}`;
    
    ctx.replyWithMarkdown(summaryText);
});

bot.hears('📈 လစဉ်တိုးတက်မှု', async (ctx) => {
    const userId = getUserId(ctx);
    const today = new Date();
    const currentMonth = today.toISOString().slice(0, 7); // YYYY-MM
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const dayOfMonth = today.getDate();

    const goalsRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users/${userId}/${FIRESTORE_MONTHLY_GOALS_COLLECTION}`);
    const goalDoc = await goalsRef.doc(currentMonth).get();
    
    if (!goalDoc.exists) {
        ctx.reply(MESSAGES.NO_GOAL_SET);
        return;
    }
    
    const goalData = goalDoc.data();
    const dailyStatsRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users/${userId}/${FIRESTORE_DAILY_STATS_COLLECTION}`);
    const q = dailyStatsRef.where('lastUpdated', '>=', new Date(today.getFullYear(), today.getMonth(), 1));
    const statsSnapshot = await q.get();

    const completedDays = statsSnapshot.docs.length;
    const completionPercentage = Math.round((completedDays / dayOfMonth) * 100);

    let progressSummary = MESSAGES.PROGRESS_SUMMARY.replace('{{month}}', today.toLocaleString('default', { month: 'long' })) + '\n\n';
    progressSummary += `*ဒီလအတွက် ရည်မှန်းချက်:* ${goalData.goal}\n`;
    progressSummary += `*ပြီးစီးမှု:* ${completedDays} ရက် / ${dayOfMonth} ရက်\n`;
    progressSummary += `*အောင်မြင်မှု ရာခိုင်နှုန်း:* ${completionPercentage}%\n`;

    ctx.replyWithMarkdown(progressSummary);

    // Save or update public goal data for leaderboard
    const publicGoalRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/public/data/${FIRESTORE_MONTHLY_GOALS_COLLECTION}`).doc(userId + '_' + currentMonth);
    await publicGoalRef.set({
        userId,
        username: ctx.from.username || ctx.from.first_name,
        month: currentMonth,
        completionPercentage,
    }, { merge: true });

});


bot.hears('💰 ဆိုင်ကြည့်ရန်', async (ctx) => {
    const userId = getUserId(ctx);
    const userRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users/${userId}/${FIRESTORE_PROFILE_COLLECTION}`).doc('data');
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};
    
    const booksRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/public/data/${FIRESTORE_BOOKS_COLLECTION}`);
    const booksSnapshot = await booksRef.get();
    const availableBooks = booksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const redeemedBooks = userData.books || [];
    
    let shopText = MESSAGES.BOOK_REDEEM_TITLE + '\n\n';
    const buttons = [];

    availableBooks.forEach(book => {
        const isRedeemed = redeemedBooks.some(b => b.id === book.id);
        const buttonText = isRedeemed ? `✅ ${book.title} (လဲပြီးသား)` : `${book.title} (${book.points} Points)`;
        shopText += `${book.title}: ${book.points} Points\n`;
        buttons.push(Markup.button.callback(buttonText, `redeem_${book.id}`));
    });

    const keyboard = Markup.inlineKeyboard(buttons, { columns: 1 });
    ctx.replyWithMarkdown(shopText, keyboard);
});

bot.hears('✨ စိတ်ဓာတ်မြှင့်တင်ရန်', async (ctx) => {
    const userId = getUserId(ctx);
    const today = getTodayDate();
    const docRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users/${userId}/${FIRESTORE_DAILY_STATS_COLLECTION}`).doc(today);
    const docSnap = await docRef.get();
    const dailyPoints = docSnap.exists ? docSnap.data().points || 0 : 0;
    const completedChallenges = docSnap.exists ? Object.keys(docSnap.data().challenges || {}).length : 0;
    
    const prompt = `You are a self-improvement bot. A user has completed ${completedChallenges} challenges and earned a total of ${dailyPoints} points today. Generate a short, motivational, and personalized Burmese quote that acknowledges their progress and encourages them to continue their effort.`;
    const quote = await getGeminiContent(prompt);
    ctx.replyWithMarkdown(`✨ ${quote}`);
});

bot.hears('😊 စိတ်ခံစားမှု မှတ်တမ်းတင်ရန်', (ctx) => {
    const moodButtons = [
        Markup.button.callback('😄 အရမ်းပျော်တယ်', 'mood_happy'),
        Markup.button.callback('😊 ကောင်းတယ်', 'mood_good'),
        Markup.button.callback('😐 ပုံမှန်ပဲ', 'mood_normal'),
        Markup.button.callback('😔 စိတ်မကောင်းဖြစ်တယ်', 'mood_sad'),
    ];
    const keyboard = Markup.inlineKeyboard(moodButtons, { columns: 2 });
    ctx.reply(MESSAGES.QUESTIONS.DAILY_MOOD, keyboard);
});

bot.hears('🫂 အသိုင်းအဝိုင်းဝင်ရန်', (ctx) => {
    ctx.reply(MESSAGES.COMMUNITY_MESSAGE);
});

bot.action(/challenge_(.+)/, async (ctx) => {
    const challengeId = ctx.match[1];
    const userId = getUserId(ctx);
    const challenge = CHALLENGE_TYPES.find(c => c.id === challengeId);

    // Check if challenge is already completed today
    const today = getTodayDate();
    const dailyRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users/${userId}/${FIRESTORE_DAILY_STATS_COLLECTION}`).doc(today);
    const dailyDoc = await dailyRef.get();
    if (dailyDoc.exists && dailyDoc.data().challenges && dailyDoc.data().challenges[challengeId]) {
        ctx.answerCbQuery('ဒီစိန်ခေါ်မှုကို ဒီနေ့ ပြီးမြောက်ပြီးသားပါ။');
        return;
    }
    
    // Set user state for the conversation
    userStates.set(userId, {
        currentChallenge: challengeId,
        step: 1,
        data: {}
    });

    ctx.answerCbQuery();
    ctx.reply(MESSAGES.ACCEPT_CHALLENGE.replace('{{challenge}}', challenge.label));

    let question;
    if (challengeId === 'reading') question = MESSAGES.QUESTIONS.READING.BOOK;
    if (challengeId === 'exercise') question = MESSAGES.QUESTIONS.EXERCISE.TYPE;
    if (challengeId === 'video-journal') question = MESSAGES.QUESTIONS.VIDEO_JOURNAL.REFLECTION;
    
    ctx.reply(question);
});

bot.action(/redeem_(.+)/, async (ctx) => {
    const bookId = ctx.match[1];
    const userId = getUserId(ctx);
    
    const bookRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/public/data/${FIRESTORE_BOOKS_COLLECTION}`).doc(bookId);
    const bookDoc = await bookRef.get();
    const bookToRedeem = bookDoc.data();
    
    if (!bookToRedeem) {
        ctx.answerCbQuery('စာအုပ်မရှိပါ။');
        return;
    }
    
    const userRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users/${userId}/${FIRESTORE_PROFILE_COLLECTION}`).doc('data');
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};
    const totalPoints = userData.totalPoints || 0;
    const redeemedBooks = userData.books || [];
    const alreadyRedeemed = redeemedBooks.some(b => b.id === bookId);

    if (alreadyRedeemed) {
        ctx.answerCbQuery(MESSAGES.ALREADY_REDEEMED, true);
        return;
    }

    if (totalPoints < bookToRedeem.points) {
        ctx.answerCbQuery(MESSAGES.NOT_ENOUGH_POINTS, true);
        return;
    }

    const newPoints = totalPoints - bookToRedeem.points;
    const updatedRedeemedBooks = [...redeemedBooks, { id: bookId }];

    await userRef.set({ totalPoints: newPoints, books: updatedRedeemedBooks }, { merge: true });
    
    ctx.answerCbQuery();
    ctx.reply('ကောင်းပါပြီ။ စာအုပ်ကို လဲလှယ်ပြီးပါပြီ။');
    ctx.reply(`ဒီစာအုပ်ကို download လုပ်ဖို့ ဒီ link ကို နှိပ်ပါ: ${bookToRedeem.url}`);
});

bot.action(/mood_(.+)/, async (ctx) => {
    const moodType = ctx.match[1];
    const userId = getUserId(ctx);
    const today = getTodayDate();
    
    const moodRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users/${userId}/${FIRESTORE_MOOD_JOURNAL_COLLECTION}`).doc(today);
    await moodRef.set({
        mood: moodType,
        timestamp: new Date()
    }, { merge: true });

    ctx.answerCbQuery();
    ctx.reply(MESSAGES.MOOD_RECORDED);
});


bot.on('text', async (ctx) => {
    const userId = getUserId(ctx);
    if (!userStates.has(userId)) {
        // Not in a conversational flow, just send the main menu
        sendMainMenu(ctx);
        return;
    }

    const state = userStates.get(userId);
    const answer = ctx.message.text.trim();

    if (state.currentChallenge === 'admin_add_book') {
        // Admin conversation flow
        if (state.step === 1) {
            state.data.title = answer;
            state.step = 2;
            ctx.reply(MESSAGES.QUESTIONS.ADMIN_ADD_BOOK.POINTS);
            userStates.set(userId, state);
        } else if (state.step === 2) {
            state.data.points = parseInt(answer);
            state.step = 3;
            ctx.reply(MESSAGES.QUESTIONS.ADMIN_ADD_BOOK.URL);
            userStates.set(userId, state);
        } else if (state.step === 3) {
            state.data.url = answer;
            userStates.delete(userId); // Conversation complete

            // Save book to Firestore
            await db.collection(`artifacts/${FIRESTORE_APP_ID}/public/data/${FIRESTORE_BOOKS_COLLECTION}`).add(state.data);
            
            ctx.reply(MESSAGES.ADMIN_ADD_BOOK_SUCCESS);
            sendMainMenu(ctx);
        }
        return;
    }
    
    if (state.currentChallenge === 'set_monthly_goal') {
        const today = new Date();
        const currentMonth = today.toISOString().slice(0, 7); // YYYY-MM
        const goalRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users/${userId}/${FIRESTORE_MONTHLY_GOALS_COLLECTION}`).doc(currentMonth);
        await goalRef.set({
            goal: answer,
            month: currentMonth,
            timestamp: new Date()
        });

        userStates.delete(userId);
        ctx.reply(MESSAGES.GOAL_SET_SUCCESS);
        sendMainMenu(ctx);
        return;
    }

    // Normal user challenge flow
    const questionKeys = {
        reading: ['book', 'benefit'],
        exercise: ['type', 'benefit'],
        'video-journal': ['reflection', 'benefit']
    };
    const currentKey = questionKeys[state.currentChallenge][state.step - 1];
    state.data[currentKey] = answer;

    if (state.step === 1) {
        userStates.set(userId, { ...state, step: 2 });
        let nextQuestion;
        if (state.currentChallenge === 'reading') nextQuestion = MESSAGES.QUESTIONS.READING.BENEFIT;
        if (state.currentChallenge === 'exercise') nextQuestion = MESSAGES.QUESTIONS.EXERCISE.BENEFIT;
        if (state.currentChallenge === 'video-journal') nextQuestion = MESSAGES.QUESTIONS.VIDEO_JOURNAL.BENEFIT;
        ctx.reply(nextQuestion);
    } else {
        // Conversation is complete
        userStates.delete(userId);

        const today = getTodayDate();
        const dailyRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users/${userId}/${FIRESTORE_DAILY_STATS_COLLECTION}`).doc(today);
        const userRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users/${userId}/${FIRESTORE_PROFILE_COLLECTION}`).doc('data');

        // Add 3 points for completing a challenge
        const CHALLENGE_POINTS = 3;

        await db.runTransaction(async (t) => {
            const dailyDoc = await t.get(dailyRef);
            const userDoc = await t.get(userRef);

            const currentDailyPoints = dailyDoc.data()?.points || 0;
            const newDailyPoints = currentDailyPoints + CHALLENGE_POINTS;
            const completed = dailyDoc.data()?.challenges || {};
            completed[state.currentChallenge] = state.data;
            
            t.set(dailyRef, { points: newDailyPoints, challenges: completed, lastUpdated: new Date() }, { merge: true });

            const currentTotalPoints = userDoc.data()?.totalPoints || 0;
            const newTotalPoints = currentTotalPoints + CHALLENGE_POINTS;
            t.set(userRef, { totalPoints: newTotalPoints }, { merge: true });
            
            // Generate summary and send it back to the user
            let prompt;
            if (state.currentChallenge === 'reading') {
                prompt = `You are a self-improvement bot. A user just completed a reading challenge. They read the book '${state.data.book}' and got the benefit '${state.data.benefit}'. Based on the book's topic and the user's benefit, write a short, personalized motivational summary in Burmese. End with a quote.`;
            } else if (state.currentChallenge === 'exercise') {
                prompt = `You are a self-improvement bot. A user just completed an exercise challenge. They did the exercise '${state.data.type}' and got the benefit '${state.data.benefit}'. Based on the exercise type and the user's benefit, write a short, personalized motivational summary in Burmese. End with a quote.`;
            } else if (state.currentChallenge === 'video-journal') {
                prompt = `You are a self-improvement bot. A user just completed a video journal challenge. They reflected on '${state.data.reflection}' and got the benefit '${state.data.benefit}'. Based on their reflection and benefit, write a short, personalized motivational summary in Burmese. End with a quote.`;
            }
            if (prompt) {
                const summary = await getGeminiContent(prompt);
                ctx.replyWithMarkdown(`✨ ${summary}`);
            }

            ctx.reply(MESSAGES.POINTS_RECEIVED.replace('{{points}}', CHALLENGE_POINTS).replace('{{totalPoints}}', newTotalPoints));
            ctx.reply(MESSAGES.CHALLENGE_COMPLETE);
        });
    }
});

// --- Monthly Winner Announcement Scheduler ---
const announceMonthlyWinner = async () => {
    const today = new Date();
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const currentDay = today.getDate();
    
    // This function only runs on the last day of the month
    if (currentDay !== lastDayOfMonth) {
        return;
    }
    
    const currentMonth = today.toISOString().slice(0, 7); // YYYY-MM
    
    // Get all monthly goal documents for the current month
    const goalsRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/public/data/${FIRESTORE_MONTHLY_GOALS_COLLECTION}`);
    const snapshot = await goalsRef.where('month', '==', currentMonth).orderBy('completionPercentage', 'desc').get();
    
    if (snapshot.empty) {
        await bot.telegram.sendMessage(COMMUNITY_GROUP_ID, 'ဒီလမှာ ဘယ်သူမှ စိန်ခေါ်မှုတွေ မလုပ်ဆောင်ခဲ့သေးပါဘူး။');
        return;
    }
    
    const winnerData = snapshot.docs[0].data();
    
    const announcement = MESSAGES.MONTHLY_WINNER_ANNOUNCEMENT
        .replace('{{winnerUsername}}', winnerData.username)
        .replace('{{completionPercentage}}', winnerData.completionPercentage);
    
    // Announce the winner in the community group
    await bot.telegram.sendMessage(COMMUNITY_GROUP_ID, announcement, { parse_mode: 'Markdown' });
};

// --- Daily Reminder Scheduler ---
const sendDailyReminder = async () => {
    const usersRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users`);
    const usersSnapshot = await usersRef.get();
    
    if (usersSnapshot.empty) {
        console.log('No users to send reminders to.');
        return;
    }

    const motivationPrompt = `You are a self-improvement bot. Generate a very short, positive, and direct Burmese sentence to encourage a user to work on their daily challenges. Keep it under 20 words.`;
    const motivationQuote = await getGeminiContent(motivationPrompt);

    const reminderMessage = MESSAGES.DAILY_REMINDER_MESSAGE.replace('{{motivation_quote}}', motivationQuote);

    usersSnapshot.forEach(async (doc) => {
        const userId = doc.id;
        try {
            await bot.telegram.sendMessage(userId, reminderMessage, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    Markup.button.callback('➕ စိန်ခေါ်မှု လုပ်ဆောင်ရန်', 'show_challenges')
                ])
            });
        } catch (error) {
            console.error(`Failed to send reminder to user ${userId}:`, error.message);
        }
    });
};

// Schedule daily reminders at 9 AM, 12 PM, and 7 PM
cron.schedule('0 9,12,19 * * *', sendDailyReminder);

// Also schedule the monthly winner announcement to run on the last day of every month at midnight
cron.schedule('0 0 L * *', announceMonthlyWinner);

bot.action('show_challenges', (ctx) => {
    const challengeButtons = CHALLENGE_TYPES.map(c => Markup.button.callback(c.label, `challenge_${c.id}`));
    const keyboard = Markup.inlineKeyboard(challengeButtons, { columns: 1 });
    ctx.reply(MESSAGES.CHOOSE_CHALLENGE, keyboard);
});


bot.launch();

console.log('Bot is running...');

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));