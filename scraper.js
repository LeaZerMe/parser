import puppeteer from "puppeteer";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const PROFILE_URL = process.env.PROFILE_URL || "https://x.com/trumpTruthOnX";
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.ADMIN_ID;
const HEADLESS = (process.env.HEADLESS ?? "true") === "true";

// 🔍 Слова, які треба шукати у постах
const KEYWORDS = ["tarif", "china", "crypto", "#trump", "btc", "xi jinping"];

// 📁 Файл для збереження вже знайдених постів
const SAVED_POSTS_FILE = "posts.json";
let savedPosts = [];

// Завантажуємо попередні пости, якщо файл існує
if (fs.existsSync(SAVED_POSTS_FILE)) {
  try {
    savedPosts = JSON.parse(fs.readFileSync(SAVED_POSTS_FILE, "utf8"));
  } catch {
    savedPosts = [];
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkLatestPosts() {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: HEADLESS,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
    );

    console.log(`🌐 Відкриваємо ${PROFILE_URL}...`);
    await page.goto(PROFILE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    await sleep(5000); // даємо X час завантажитись

    // Отримуємо список постів (текст + дата)
    const posts = await page.evaluate(() => {
      const articles = Array.from(document.querySelectorAll("article"));
      return articles.map((article) => {
        const textEl = article.querySelector("div[lang]");
        const dateEl = article.querySelector("time");
        return {
          text: textEl?.innerText?.trim() || "",
          date: dateEl?.getAttribute("datetime") || null,
        };
      }).filter(p => p.text);
    });

    if (!posts.length) {
      console.log("⚠️ Не знайдено постів. Можливо, потрібен логін.");
      return;
    }

    let newFound = 0;

    for (const post of posts) {
      const { text, date } = post;
      const id = text.slice(0, 100); // унікальний ключ для збереження

      // Якщо цей пост вже збережено — пропускаємо
      if (savedPosts.some((p) => p.id === id)) continue;

      // Якщо містить потрібні слова
      const hasKeyword = KEYWORDS.some((word) =>
        text.toLowerCase().includes(word.toLowerCase())
      );

      if (hasKeyword) {
        console.log("🆕 Знайдено новий пост:");
        console.log(`📅 ${date}`);
        console.log(text);
        console.log("──────────────────────────────");

        // Надсилаємо в Telegram
        if (BOT_TOKEN && CHAT_ID) {
          await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: `🐦 Новий пост із ключовим словом:\n\n📅 ${date}\n\n${text}`,
          });
        }
      }

      // Зберігаємо пост у список
      savedPosts.push({ id, text, date });
      newFound++;
    }

    if (newFound > 0) {
      fs.writeFileSync(SAVED_POSTS_FILE, JSON.stringify(savedPosts, null, 2), "utf8");
      console.log(`💾 Збережено ${newFound} нових постів.`);
    } else {
      console.log("⏳ Нових постів або ключових слів не знайдено.");
    }
  } catch (err) {
    console.error("❌ Помилка Puppeteer:", err.message);
  } finally {
    if (browser) await browser.close();
  }
}

console.log(`🔍 Починаємо моніторинг: ${PROFILE_URL}`);
await checkLatestPosts(); // перший запуск
setInterval(checkLatestPosts, 60 * 1000); // кожну хвилину
