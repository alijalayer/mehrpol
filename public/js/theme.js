// Light / dark theme. Loaded as a plain script in <head> so the right colours apply before
// the first paint. The choice ('auto' follows the phone or computer) is remembered per device.
(function () {
  var KEY = 'mehrpol-theme';
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  var BAR = { light: '#fbf8f3', dark: '#0e1621' };

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : 'auto';
    } catch (e) {
      return 'auto';
    }
  }

  function resolved(choice) {
    return choice === 'auto' ? (media.matches ? 'dark' : 'light') : choice;
  }

  function apply() {
    var theme = resolved(stored());
    document.documentElement.dataset.theme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', BAR[theme]);
    // Android app: light status-bar icons on dark, dark icons on light.
    try {
      var bars = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SystemBars;
      if (bars) bars.setStyle({ style: theme === 'dark' ? 'DARK' : 'LIGHT' });
    } catch (e) {}
    document.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
  }

  window.mehrpolTheme = {
    choice: stored,
    current: function () { return resolved(stored()); },
    set: function (choice) {
      try {
        if (choice === 'auto') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, choice);
      } catch (e) {}
      apply();
    },
    toggle: function () {
      this.set(resolved(stored()) === 'dark' ? 'light' : 'dark');
    },
  };

  media.addEventListener('change', function () {
    if (stored() === 'auto') apply();
  });
  apply();
})();
