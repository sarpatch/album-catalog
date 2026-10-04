// Ajetaan ennen tyylien piirtoa: asettaa edellisen käynnistyksen teeman heti,
// jottei näytölle välähdä väärää väriä.
(function () {
  try {
    var vars = JSON.parse(localStorage.getItem('themeCache') || 'null');
    if (!vars) return;
    var root = document.documentElement;
    for (var k in vars) root.style.setProperty(k, vars[k]);
  } catch (e) { /* ei välimuistia */ }
})();
