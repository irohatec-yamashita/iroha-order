(() => {
  const requestedLanguage = new URLSearchParams(window.location.search).get("lang");
  const lang = requestedLanguage === "en" ? "en" : "ja";
  const strings = window.I18N[lang];

  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    if (strings[key]) element.textContent = strings[key];
  });
  document.title = strings.appName;
})();
