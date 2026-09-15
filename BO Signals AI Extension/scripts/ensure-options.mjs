import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const optionsDir = path.resolve(root, "options");
const indexPath = path.join(optionsDir, "index.html");

const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Настройки — BO Signals AI</title>
  <link rel=\"stylesheet\" href=\"styles.css\">
</head>
<body>
  <main class=\"container\">\n    <header class=\"row space-between center\">\n      <h1>Настройки</h1>\n      <a href=\"../popup/index.html\" class=\"icon-btn\" title=\"В попап\" aria-label=\"В попап\">↩</a>\n    </header>\n    <section class=\"card\">\n      <div class=\"row gap\">\n        <label class=\"field\">\n          <span class=\"label\">Таймфрейм</span>\n          <select id=\"tf\">\n            <option value=\"1m\">1m</option>\n            <option value=\"5m\">5m</option>\n            <option value=\"15m\">15m</option>\n            <option value=\"30m\">30m</option>\n            <option value=\"1h\">1h</option>\n          </select>\n        </label>\n        <label class=\"field\">\n          <span class=\"label\">Интервал, мин</span>\n          <input type=\"number\" id=\"interval\" min=\"1\" step=\"1\" placeholder=\"5\">\n        </label>\n      </div>\n      <div class=\"row gap\">\n        <label class=\"field row center gap\">\n          <input type=\"checkbox\" id=\"soundEnabled\">\n          <span>Звук уведомлений</span>\n        </label>\n        <label class=\"field\">\n          <span class=\"label\">Тип звука</span>\n          <select id=\"soundChoice\">\n            <option value=\"beep1\">Beep 1</option>\n            <option value=\"beep2\">Beep 2</option>\n            <option value=\"ding\">Ding</option>\n          </select>\n        </label>\n        <button id=\"soundTest\" class=\"btn secondary\" type=\"button\">Тест</button>\n      </div>\n      <div class=\"row end\">\n        <button id=\"save\" class=\"btn primary\" type=\"button\">Сохранить</button>\n      </div>\n    </section>\n  </main>
  <script src=\"options.js\" type=\"module\"></script>
</body>
</html>`;

if (!fs.existsSync(optionsDir)) {
  fs.mkdirSync(optionsDir, { recursive: true });
}

if (!fs.existsSync(indexPath)) {
  fs.writeFileSync(indexPath, html, "utf8");
  console.log("Created", path.relative(root, indexPath));
} else {
  console.log("Exists", path.relative(root, indexPath));
}















