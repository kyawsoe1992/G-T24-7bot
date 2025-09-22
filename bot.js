const { Telegraf, Markup } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const admin = require('firebase-admin');
const cron = require('node-cron');
const express = require('express');
const app = express();

require('dotenv').config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FIREBASE_SERVICE_ACCOUNT = require('./serviceAccountKey.json');
const FIRESTORE_APP_ID = process.env.FIRESTORE_APP_ID || 'default-app-id';
const ADMIN_USER_ID = process.env.ADMIN_USER_ID;
const COMMUNITY_GROUP_ID = process.env.COMMUNITY_GROUP_ID;

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(FIREBASE_SERVICE_ACCOUNT)
    });
}
const db = admin.firestore();

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-latest' });

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const userStates = new Map();
const CHALLENGE_TYPES = [
    { id: 'reading', label: '📖 စာဖတ်ခြင်း' },
    { id: 'meditation', label: '🧘 တရားထိုင်ခြင်း' },
    { id: 'exercise', label: '💪 ကိုယ်လက်လှုပ်ရှားမှု' },
    { id: 'learning', label: '📚 အသစ်သင်ယူခြင်း' },
    { id: 'healthy_eating', label: '🥗 ကျန်းမာရေးနှင့်ညီညွတ်သောစားသောက်မှု' }
];

const MESSAGES = {
    WELCOME: 'မင်္ဂလာပါ၊ G-T24/7 Bot ကနေ ကြိုဆိုပါတယ်။ သင်ကိုယ်တိုင် တိုးတက်ဖို့အတွက် စိန်ခေါ်မှုတွေကို လက်ခံနိုင်ပါပြီ။',
    MAIN_MENU: 'အောက်ကရွေးချယ်စရာတွေထဲက တစ်ခုကို ရွေးနိုင်ပါတယ်:',
    CHOOSE_CHALLENGE: 'သင် ဘယ်စိန်ခေါ်မှုကို စတင်ချင်ပါသလဲ?',
    START_CHALLENGE_PROMPT: 'စိန်ခေါ်မှု အသေးစိတ်ကို ထည့်သွင်းပေးပါ။ ဥပမာ- "၁၅ မိနစ်စာအုပ်ဖတ်ခြင်း"',
    SET_MONTHLY_GOAL: 'ဒီလအတွက် သင့်ရည်မှန်းချက်ကို ရေးပေးပါ။',
    CHALLENGE_ADDED: (challenge) => `ကောင်းပါပြီ၊ ${challenge} အတွက် စိန်ခေါ်မှုကို မှတ်တမ်းတင်ပြီးပါပြီ။`,
    GOAL_SET: 'သင့်ရဲ့ ရည်မှန်းချက်ကို မှတ်တမ်းတင်ပြီးပါပြီ။ နေ့စဉ်စိန်ခေါ်မှုတွေ လုပ်ဆောင်ပြီး ဒီရည်မှန်းချက်ကို အရောက်သွားနိုင်ပါစေ။',
    INVALID_INPUT: 'ထည့်သွင်းမှု မှားနေပါတယ်။ စာသားဖြင့်သာ ထည့်ပေးပါ။',
    NO_PENDING_CHALLENGE: 'စောင့်ဆိုင်းနေတဲ့ စိန်ခေါ်မှု မရှိသေးပါဘူး။',
    POINTS_UPDATED: 'မှတ်တမ်းတင်မှုအတွက် Point တွေ ပေါင်းပေးလိုက်ပါပြီ။ သင့် Point အသစ်ကတော့ %s ဖြစ်ပါတယ်။',
    GENERIC_ERROR: 'တစ်ခုခု မှားယွင်းနေပါတယ်။ ကျေးဇူးပြု၍ ပြန်လည်ကြိုးစားပေးပါ။',
    NO_USER: 'သင့်ရဲ့ user profile ကို ရှာမတွေ့ပါဘူး။ /start command ကို ပြန်နှိပ်ပြီး စတင်နိုင်ပါတယ်။',
    ANNOUNCING_WINNER: 'ဒီလအတွက် စိန်ခေါ်မှုများရဲ့ ဆုရှင်ကို ကြေညာပါပြီ။',
    NO_WINNER: 'ဒီလအတွက် အောင်မြင်သူ မရှိသေးပါဘူး။'
};

const getUserId = (ctx) => String(ctx.from.id);

const sendMainMenu = (ctx) => {
    const keyboard = Markup.keyboard([
        ['➕ စိန်ခေါ်မှု ရွေးချယ်ရန်', '🏆 အဆင့်သတ်မှတ်ချက် ကြည့်ရန်'],
        ['🎯 ရည်မှန်းချက်သတ်မှတ်ရန်', '📊 ကိုယ့်မှတ်တမ်းကြည့်ရန်']
    ]).resize();
    ctx.reply(MESSAGES.MAIN_MENU, keyboard);
};

// --- Bot Command Handlers ---
bot.start(async (ctx) => {
    const userId = getUserId(ctx);
    const chatId = String(ctx.chat.id);

    if (chatId === userId) {
        userStates.delete(userId);
        const userRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users/${userId}/profile`).doc('data');
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            await userRef.set({
                telegramId: userId,
                firstName: ctx.from.first_name,
                lastName: ctx.from.last_name || '',
                username: ctx.from.username || '',
                totalPoints: 0,
                createdAt: new Date()
            });
        }
        ctx.reply(MESSAGES.WELCOME);
        sendMainMenu(ctx);
    } else {
        ctx.reply('မင်္ဂလာပါ၊ ကျွန်တော့်ရဲ့ Self-Improvement Bot ကနေ ကြိုဆိုပါတယ်။ ကျွန်တော့်ကို သုံးဖို့အတွက် ဒီမှာ ဆက်သွယ်နိုင်ပါတယ်: @G-T24-7bot');
    }
});

bot.hears('➕ စိန်ခေါ်မှု ရွေးချယ်ရန်', (ctx) => {
    const chatId = String(ctx.chat.id);
    const userId = getUserId(ctx);
    if (chatId === userId) {
        const challengeButtons = CHALLENGE_TYPES.map(c => Markup.button.callback(c.label, `challenge_${c.id}`));
        const keyboard = Markup.inlineKeyboard(challengeButtons, { columns: 1 });
        ctx.reply(MESSAGES.CHOOSE_CHALLENGE, keyboard);
    }
});

bot.action(/challenge_(.+)/, async (ctx) => {
    const userId = getUserId(ctx);
    const challengeType = ctx.match[1];
    userStates.set(userId, {
        currentChallenge: challengeType,
        step: 1
    });
    ctx.reply(MESSAGES.START_CHALLENGE_PROMPT);
    ctx.answerCbQuery();
});

bot.hears('🎯 ရည်မှန်းချက်သတ်မှတ်ရန်', (ctx) => {
    const chatId = String(ctx.chat.id);
    const userId = getUserId(ctx);
    if (chatId === userId) {
        userStates.set(userId, {
            currentChallenge: 'set_monthly_goal',
            step: 1,
        });
        ctx.reply(MESSAGES.QUESTIONS.SET_MONTHLY_GOAL);
    }
});

bot.hears('🏆 အဆင့်သတ်မှတ်ချက် ကြည့်ရန်', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const userId = getUserId(ctx);
    if (chatId === userId) {
        const usersRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users`);
        const snapshot = await usersRef.get();
        let leaderboard = [];
        snapshot.forEach(doc => {
            const userData = doc.data();
            leaderboard.push({
                name: userData.firstName,
                points: userData.totalPoints || 0
            });
        });

        leaderboard.sort((a, b) => b.points - a.points);
        let message = '🏆 အဆင့်သတ်မှတ်ချက်:\n\n';
        leaderboard.forEach((user, index) => {
            message += `${index + 1}. ${user.name}: ${user.points} points\n`;
        });
        ctx.reply(message);
    }
});

bot.hears('📊 ကိုယ့်မှတ်တမ်းကြည့်ရန်', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const userId = getUserId(ctx);
    if (chatId === userId) {
        const userRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users/${userId}/profile`).doc('data');
        const userDoc = await userRef.get();
        if (userDoc.exists) {
            const userData = userDoc.data();
            let message = `📊 သင့်ရဲ့မှတ်တမ်း:\n\n`;
            message += `စုစုပေါင်းမှတ်တမ်းများ: ${userData.totalPoints} points\n`;
            ctx.reply(message);
        } else {
            ctx.reply(MESSAGES.NO_USER);
        }
    }
});

bot.on('text', async (ctx) => {
    const userId = getUserId(ctx);
    const state = userStates.get(userId);

    if (!state) {
        sendMainMenu(ctx);
        return;
    }

    try {
        if (state.currentChallenge === 'set_monthly_goal') {
            const goal = ctx.message.text;
            const userRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users/${userId}/profile`).doc('data');
            await userRef.update({ monthlyGoal: goal });
            ctx.reply(MESSAGES.GOAL_SET);
            userStates.delete(userId);
        } else {
            const challenge = ctx.message.text;
            const pointsToAdd = 1; // Default points for any challenge
            
            const userRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users/${userId}/profile`).doc('data');
            const challengeRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users/${userId}/challenges`).doc();
            
            await db.runTransaction(async (t) => {
                const userDoc = await t.get(userRef);
                const currentPoints = userDoc.data()?.totalPoints || 0;
                const newPoints = currentPoints + pointsToAdd;
                
                t.update(userRef, { totalPoints: newPoints });
                t.set(challengeRef, {
                    type: state.currentChallenge,
                    description: challenge,
                    points: pointsToAdd,
                    date: new Date()
                });

                ctx.reply(MESSAGES.CHALLENGE_ADDED(challenge));
                ctx.reply(`မှတ်တမ်းတင်မှုအတွက် Point တွေ ပေါင်းပေးလိုက်ပါပြီ။ သင့် Point အသစ်ကတော့ ${newPoints} ဖြစ်ပါတယ်။`);
            });
            userStates.delete(userId);
        }
    } catch (err) {
        console.error('Error in text handler:', err);
        ctx.reply(MESSAGES.GENERIC_ERROR);
        userStates.delete(userId);
    }
});

// Admin command to get group ID
bot.command('id', (ctx) => {
    const userId = getUserId(ctx);
    if (userId === ADMIN_USER_ID) {
        ctx.reply(`Group ID: ${ctx.chat.id}`);
    }
});

// --- Scheduled Tasks ---
const announceMonthlyWinner = async () => {
    const leaderboardRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users`);
    const snapshot = await leaderboardRef.orderBy('totalPoints', 'desc').limit(1).get();

    if (!snapshot.empty) {
        const winnerDoc = snapshot.docs[0];
        const winnerData = winnerDoc.data();
        const winnerName = winnerData.firstName;
        const winnerPoints = winnerData.totalPoints;
        const message = `${MESSAGES.ANNOUNCING_WINNER}\n\n🏆 ${winnerName} ကတော့ ${winnerPoints} points ဖြင့် ဒီလရဲ့ အောင်မြင်သူ ဖြစ်ပါတယ်!`;
        bot.telegram.sendMessage(COMMUNITY_GROUP_ID, message);

        // Reset points for the next month
        const usersRef = db.collection(`artifacts/${FIRESTORE_APP_ID}/users`);
        const usersSnapshot = await usersRef.get();
        const batch = db.batch();
        usersSnapshot.forEach(doc => {
            batch.update(doc.ref, { totalPoints: 0 });
        });
        await batch.commit();
    } else {
        bot.telegram.sendMessage(COMMUNITY_GROUP_ID, MESSAGES.NO_WINNER);
    }
};

const sendDailyReminder = () => {
    const reminderMessage = 'နေ့စဉ်စိန်ခေါ်မှုတွေ လုပ်ပြီး Point တွေစုဖို့ မမေ့ပါနဲ့နော်။ /start ကိုနှိပ်ပြီး စတင်နိုင်ပါတယ်။';
    bot.telegram.sendMessage(COMMUNITY_GROUP_ID, reminderMessage);
};

cron.schedule('0 0 1 * *', announceMonthlyWinner, {
    scheduled: true,
    timezone: "Asia/Yangon"
});

cron.schedule('0 9,12,19 * * *', sendDailyReminder, {
    scheduled: true,
    timezone: "Asia/Yangon"
});

// --- Server Setup ---
app.use(express.json());
app.use(bot.webhookCallback(`/${process.env.SECRET_PATH}`));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

bot.catch((err, ctx) => {
    console.error(`Error for ${ctx.updateType}`, err);
    ctx.reply(MESSAGES.GENERIC_ERROR);
});
