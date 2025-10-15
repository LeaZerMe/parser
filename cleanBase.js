import sqlite3 from "sqlite3";

const db = new sqlite3.Database("crypto.db", (err) => {
  if (err) return console.error("❌ Помилка відкриття бази:", err.message);
  console.log("✅ Підключено до бази даних");
});

db.serialize(() => {
  db.all(`SELECT name FROM sqlite_master WHERE type='table'`, async (err, rows) => {
    if (err) {
      console.error("❌ Помилка отримання таблиць:", err.message);
      return;
    }

    const tables = rows.map(r => r.name).filter(name => name !== "user_coins");

    if (tables.length === 0) {
      console.log("ℹ️ Немає таблиць для видалення.");
      db.close();
      return;
    }

    console.log(`🗑️ Знайдено ${tables.length} таблиць для видалення...`);

    // Використовуємо проміси для послідовності
    for (const table of tables) {
      await new Promise((resolve) => {
        db.run(`DROP TABLE IF EXISTS ${table}`, (err) => {
          if (err) {
            console.error(`❌ Помилка при видаленні ${table}:`, err.message);
          } else {
            console.log(`✅ Видалено таблицю: ${table}`);
          }
          resolve();
        });
      });
    }

    console.log("✅ Усі таблиці, крім 'user_coins', успішно видалено.");

    db.close((err) => {
      if (err) console.error("❌ Помилка при закритті бази:", err.message);
      else console.log("🔒 Базу даних закрито без помилок.");
    });
  });
});
