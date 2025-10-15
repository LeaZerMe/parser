import axios from "axios";
import Database from "better-sqlite3";
import dotenv from "dotenv";
dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const db = new Database("crypto.db");

// імпорт або копія функцій createCoinTable, saveCoinData, тощо

async function monitorCoins() {
  try {
    console.log("⏳ Перевірка цін...");

    const topUrl =
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=30&price_change_percentage=1h,24h";
    const { data: topCoins } = await axios.get(topUrl);

    const userCoins = db.prepare("SELECT DISTINCT coin FROM user_coins").all();
    const userCoinNames = userCoins.map(c => c.coin.toLowerCase());

    const allCoinIds = [...new Set([...topCoins.map(c => c.id), ...userCoinNames])];

    const { data } = await axios.get(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${allCoinIds.join(",")}&price_change_percentage=1h,24h`
    );

    let messageHeaderSent = false;

    for (const coin of data) {
      const cleanSymbol = coin.id.replace(/[^a-zA-Z0-9_]/g, "");

      const now = {
        price: coin.current_price,
        change_1h: coin.price_change_percentage_1h_in_currency,
        change_24h: coin.price_change_percentage_24h_in_currency,
        ts: Date.now(),
      };

      const pastRecords = db.prepare(
        `SELECT price, ts FROM ${cleanSymbol} WHERE ts >= ? ORDER BY ts DESC LIMIT 5`
      ).all(Date.now() - 5 * 60 * 1000);

      if (pastRecords.length === 0) continue;

      let maxChange = 0;
      let pastMax = null;

      for (const past of pastRecords) {
        const change = ((now.price - past.price) / past.price) * 100;
        if (Math.abs(change) > Math.abs(maxChange)) {
          maxChange = change;
          pastMax = past;
        }
      }

      if (pastMax && Math.abs(maxChange) >= process.env.PRICE_CHANGE_THRESHOLD) {
        if (!messageHeaderSent) {
          await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: ADMIN_ID,
            text: "📊 <b>PRICE CHANGE</b>",
            parse_mode: "HTML",
          });
          messageHeaderSent = true;
        }

        const minutesAgo = Math.round((now.ts - pastMax.ts) / 60000);

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          chat_id: ADMIN_ID,
          text:
            `🚨 <b>${coin.name}</b> (${coin.symbol.toUpperCase()})\n` +
            `📉 Стара ціна: $${pastMax.price}\n` +
            `📈 Поточна ціна: $${now.price}\n` +
            `⏱ Зміна: ${maxChange.toFixed(2)}% за ${minutesAgo} хв.`,
          parse_mode: "HTML",
        });
      }
    }

    console.log("✅ Моніторинг завершено");
  } catch (err) {
    console.error("❌ Помилка моніторингу:", err.message);
  }
}

await monitorCoins();
