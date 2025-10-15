import { Telegraf, Markup, session } from "telegraf";
import axios from "axios";
import Database from "better-sqlite3";
import dotenv from "dotenv";
dotenv.config();


// 1️⃣ Ініціалізація
const bot = new Telegraf(process.env.BOT_TOKEN);

// 🧠 Session middleware
bot.use(session({
    defaultSession: () => ({
        mode: null,
    }),
}));

// 🧱 Підключення бази
const db = new Database("crypto.db");

// 2️⃣ Таблиця користувача з монетами
db.prepare(`
  CREATE TABLE IF NOT EXISTS user_coins (
    user_id INTEGER,
    coin TEXT,
    PRIMARY KEY (user_id, coin)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS sent_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coin TEXT,
    message TEXT,
    timestamp INTEGER
  )
`).run();

// 3️⃣ Функція створення таблиці монети
function createCoinTable(symbol) {
    const cleanSymbol = symbol.replace(/[^a-zA-Z0-9_]/g, "");
    db.prepare(`
    CREATE TABLE IF NOT EXISTS ${cleanSymbol} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      price REAL,
      change_1h REAL,
      change_24h REAL,
      ts INTEGER
    )
  `).run();
}

// 4️⃣ Отримання даних по монеті
async function getCoinData(userInput) {
    const name = userInput.trim().toLowerCase();
    const { data: list } = await axios.get("https://api.coingecko.com/api/v3/coins/list");

    const coinInfo = list.find(
        (c) =>
            c.id.toLowerCase() === name ||
            c.symbol.toLowerCase() === name ||
            c.name.toLowerCase() === name
    );

    if (!coinInfo) throw new Error("Монета не знайдена");

    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${coinInfo.id}&price_change_percentage=1h,24h`;
    const { data } = await axios.get(url);
    const c = data[0];
    if (!c) throw new Error("Монету не знайдено");

    return {
        name: c.name,
        symbol: c.symbol.toLowerCase(),
        price: c.current_price,
        change_1h: c.price_change_percentage_1h_in_currency,
        change_24h: c.price_change_percentage_24h,
    };
}

// 5️⃣ Збереження у базу
function saveCoinData(symbol, data) {
    const cleanSymbol = symbol.replace(/[^a-zA-Z0-9_]/g, "");
    createCoinTable(cleanSymbol);
    db.prepare(
        `INSERT INTO ${cleanSymbol} (price, change_1h, change_24h, ts)
     VALUES (?, ?, ?, ?)`
    ).run(
        data.price,
        data.change_1h,
        data.change_24h,
        Date.now()
    );
}

// 6️⃣ Головне меню
const mainMenu = Markup.inlineKeyboard([
    [Markup.button.callback("📊 Топ-10 монет", "top10")],
    [Markup.button.callback("➕ Додати монету", "add_coin")],
    [Markup.button.callback("📋 Мої монети", "my_coins")],
]);

// 7️⃣ /start
bot.start((ctx) => {
    ctx.session.mode = null;
    ctx.reply("👋 Привіт! Обери дію нижче:", mainMenu);
});

// 8️⃣ Показати топ-10
bot.action("top10", async (ctx) => {
    await ctx.answerCbQuery();
    const url =
        "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&price_change_percentage=1h,24h";
    const { data } = await axios.get(url);
    let msg = "💎 <b>Топ-10 монет</b>\n\n";
    data.forEach((c, i) => {
        msg += `${i + 1}. <b>${c.name}</b> (${c.symbol.toUpperCase()})\n`;
        msg += `💰 Ціна: $${c.current_price}\n`;
        msg += `⏱ 1h: ${c.price_change_percentage_1h_in_currency?.toFixed(2)}%\n`;
        msg += `📆 24h: ${c.price_change_percentage_24h?.toFixed(2)}%\n\n`;
    });
    ctx.reply(msg, { parse_mode: "HTML" });
});

// 9️⃣ Додати монету
bot.action("add_coin", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.mode = "add_coin";
    ctx.reply("Введи назву монети (наприклад: bitcoin):");
});

// 🔟 Обробка тексту (додавання монети)
bot.on("text", async (ctx) => {
    if (ctx.session.mode === "add_coin") {
        const coin = ctx.message.text.trim().toLowerCase();
        try {
            const data = await getCoinData(coin);
            saveCoinData(coin, data);

            db.prepare(
                "INSERT OR IGNORE INTO user_coins (user_id, coin) VALUES (?, ?)"
            ).run(ctx.from.id, coin);

            ctx.reply(
                `✅ Монету <b>${coin.toUpperCase()}</b> додано до вашого списку.`,
                { parse_mode: "HTML", ...mainMenu }
            );
        } catch (e) {
            ctx.reply("⚠️ Монету не знайдено. Спробуй ще раз.");
        }
        ctx.session.mode = null;
    }
});

// 1️⃣1️⃣ Мої монети
bot.action("my_coins", async (ctx) => {
    await ctx.answerCbQuery();
    const coins = db
        .prepare("SELECT coin FROM user_coins WHERE user_id = ?")
        .all(ctx.from.id);

    if (coins.length === 0) {
        return ctx.reply("У тебе ще немає монет 😿", mainMenu);
    }

    const buttons = coins.map((c) => [
        Markup.button.callback(c.coin.toUpperCase(), `coin_${c.coin}`),
    ]);
    ctx.reply("📋 Твої монети:", Markup.inlineKeyboard(buttons));
});

// 1️⃣2️⃣ Показати метрики по монеті
bot.action(/coin_(.+)/, async (ctx) => {
    const coin = ctx.match[1];
    await ctx.answerCbQuery();
    try {
        const data = await getCoinData(coin);
        saveCoinData(coin, data);
        const msg =
            `💰 <b>${data.name}</b> (${data.symbol.toUpperCase()})\n` +
            `Ціна: $${data.price}\n` +
            `⏱ 1h: ${data.change_1h?.toFixed(2)}%\n` +
            `📆 24h: ${data.change_24h?.toFixed(2)}%`;
        ctx.reply(msg, { parse_mode: "HTML" });
    } catch {
        ctx.reply("⚠️ Не вдалося отримати дані.");
    }
});

// bot.launch();
console.log("🚀 Бот запущено!");

// 🧠 Перевірка, чи можна відправити повідомлення
function canSendMessage(coin) {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const count = db
    .prepare(
      "SELECT COUNT(*) AS total FROM sent_messages WHERE coin = ? AND timestamp >= ?"
    )
    .get(coin, oneHourAgo).total;
  return count < 3; // максимум 3 за годину
}

// 💾 Збереження повідомлення
function saveMessage(coin, message) {
  db.prepare(
    "INSERT INTO sent_messages (coin, message, timestamp) VALUES (?, ?, ?)"
  ).run(coin, message, Date.now());
}

// 🧹 Видалення старих записів (старших за 24 год)
function cleanupOldMessages() {
  db.prepare(
    "DELETE FROM sent_messages WHERE timestamp < ?"
  ).run(Date.now() - 24 * 60 * 60 * 1000);
}

// 🔁 Функція моніторингу змін цін
async function monitorCoins() {
  try {
    console.log("⏳ Перевірка цін...");

    // 1️⃣ Отримуємо топ-30 монет (з % змін)
    const topUrl =
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=30&price_change_percentage=1h,24h";
    const { data: topCoins } = await axios.get(topUrl);

    // 2️⃣ Отримуємо всі монети користувачів
    const userCoins = db.prepare("SELECT DISTINCT coin FROM user_coins").all();
    const userCoinNames = userCoins.map((c) => c.coin.toLowerCase());

    // 3️⃣ Об’єднуємо унікальні монети
    const allCoinIds = [
      ...new Set([...topCoins.map((c) => c.id), ...userCoinNames]),
    ];

    // 4️⃣ Отримуємо дані по всіх монетах
    const { data } = await axios.get(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${allCoinIds.join(
        ","
      )}&price_change_percentage=1h,24h`
    );

    let messageHeaderSent = false;

    // 5️⃣ Перевіряємо кожну монету
    for (const coin of data) {
      const cleanSymbol = coin.id.replace(/[^a-zA-Z0-9_]/g, "");
      createCoinTable(cleanSymbol);

      // Поточні дані
      const now = {
        price: coin.current_price,
        change_1h: coin.price_change_percentage_1h_in_currency,
        change_24h: coin.price_change_percentage_24h_in_currency,
        ts: Date.now(),
      };

      saveCoinData(cleanSymbol, now);

      // 6️⃣ Беремо останні 5 записів за 5 хв
      const pastRecords = db
        .prepare(
          `SELECT price, ts 
           FROM ${cleanSymbol} 
           WHERE ts >= ? 
           ORDER BY ts DESC 
           LIMIT 5`
        )
        .all(Date.now() - 5 * 60 * 1000);

      if (pastRecords.length === 0) continue;

      // 7️⃣ Шукаємо найбільшу зміну
      let maxChange = 0;
      let pastMax = null;

      for (const past of pastRecords) {
        const change = ((now.price - past.price) / past.price) * 100;
        if (Math.abs(change) > Math.abs(maxChange)) {
          maxChange = change;
          pastMax = past;
        }
      }

      // 8️⃣ Якщо зміна перевищує поріг — надсилаємо
      if (
        pastMax &&
        (Math.abs(maxChange) >= process.env.PRICE_CHANGE_THRESHOLD ||
          Math.abs(now.change_1h) >= process.env.PRICE_CHANGE_THRESHOLD)
      ) {
        const userId = process.env.ADMIN_ID;

        // 🚫 Ліміт 3 повідомлення/год
        if (!canSendMessage(coin.id)) {
          console.log(`⏸ Пропущено ${coin.id} — ліміт 3 повідомлення/год.`);
          continue;
        }

        if (!messageHeaderSent) {
          await bot.telegram.sendMessage(userId, "📊 <b>PRICE CHANGE</b>", {
            parse_mode: "HTML",
          });
          messageHeaderSent = true;
        }

        const minutesAgo = Math.round((now.ts - pastMax.ts) / 60000);
        const msgText =
          `🚨 <b>${coin.name}</b> (${coin.symbol.toUpperCase()})\n` +
          `📉 Стара ціна: $${pastMax.price}\n` +
          `📈 Поточна ціна: $${now.price}\n` +
          `⏱ Зміна: ${maxChange.toFixed(2)}% за ${minutesAgo} хв.\n` +
          `⏳ 1h: ${now.change_1h?.toFixed(2)}%\n` +
          `📆 24h: ${now.change_24h?.toFixed(2)}%`;

        await bot.telegram.sendMessage(userId, msgText, { parse_mode: "HTML" });

        // 💾 Зберігаємо в базу
        saveMessage(coin.id, msgText);
      }
    }

    cleanupOldMessages();
    console.log("✅ Моніторинг завершено");
  } catch (err) {
    console.error("❌ Помилка моніторингу:", err.message);
  }
}

// 🕒 Запуск кожну хвилину
setInterval(monitorCoins, 60 * 1000);

// 🚀 Перший запуск при старті
monitorCoins();
