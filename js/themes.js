// ─────────────────────────────────────────────────────────────────────────────
//  TEEMAT
//  Uuden teeman lisääminen: kopioi yksi alla olevista olioista listaan ja muuta
//  arvoja. Pakollisia ovat vain id, name, scheme ja colors.bg/text/accent –
//  muut sävyt (pinnat, reunat, himmeä teksti) lasketaan niistä automaattisesti.
//
//    scheme : 'light' | 'dark'   – selaimen lomake-elementtien värimaailma
//    colors : bg (tausta), text (teksti), accent (korostus)
//             valinnaiset: surface (kortit), danger, ok
//    font   : 'sans' | 'serif' | 'rounded' | 'condensed' | 'mono'  (otsikot)
//    radius : kulmien pyöristys, esim. '4px' tai '18px'
// ─────────────────────────────────────────────────────────────────────────────

export const THEMES = [
  {
    id: 'vaalea', name: 'Vaalea', scheme: 'light',
    colors: { bg: '#f6f5f2', surface: '#ffffff', text: '#1d1c1a', accent: '#c2410c' },
    font: 'sans', radius: '12px',
  },
  {
    id: 'tumma', name: 'Tumma', scheme: 'dark',
    colors: { bg: '#141414', surface: '#1e1e1e', text: '#ece9e4', accent: '#f59e0b' },
    font: 'sans', radius: '12px',
  },
  {
    id: 'vinyyli', name: 'Vinyyli', scheme: 'dark',
    colors: { bg: '#0b0b0c', surface: '#17171a', text: '#f2f2f2', accent: '#e11d48' },
    font: 'condensed', radius: '999px',
  },
  {
    id: 'retro', name: 'Retro 70s', scheme: 'light',
    colors: { bg: '#f1e4c8', surface: '#f8efdc', text: '#3a2614', accent: '#c4541a' },
    font: 'serif', radius: '18px',
  },
  {
    id: 'jazz', name: 'Jazzklubi', scheme: 'dark',
    colors: { bg: '#0d1b2a', surface: '#13263a', text: '#e0e8f0', accent: '#38bdf8' },
    font: 'condensed', radius: '4px',
  },
  {
    id: 'metsa', name: 'Metsä', scheme: 'light',
    colors: { bg: '#eef1ea', surface: '#fbfcf9', text: '#1f2a1c', accent: '#3f7d3a' },
    font: 'rounded', radius: '16px',
  },
  {
    id: 'kontrasti', name: 'Korkea kontrasti', scheme: 'dark',
    colors: { bg: '#000000', surface: '#000000', text: '#ffffff', accent: '#ffe600' },
    font: 'sans', radius: '6px',
  },
];

export const AUTO_THEME = { id: 'auto', name: 'Automaattinen (järjestelmä)' };
export const CUSTOM_ID = 'oma';

const FONTS = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif',
  condensed: '"Bahnschrift", "Arial Narrow", "Roboto Condensed", "Helvetica Neue", sans-serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace',
};
export const FONT_NAMES = { sans: 'Selkeä', serif: 'Klassinen', rounded: 'Pyöreä', condensed: 'Kapea', mono: 'Konekirjoitus' };

function luminance(hex) {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Valitsee korostusvärin päälle luettavan tekstivärin. */
export function contrastText(hex) {
  return luminance(hex) > 0.4 ? '#111111' : '#ffffff';
}

export function customTheme(settings) {
  const c = settings.customTheme || {};
  return {
    id: CUSTOM_ID, name: 'Oma teema', scheme: c.scheme || 'light',
    colors: { bg: c.bg || '#faf7f2', text: c.text || '#1d1c1a', accent: c.accent || '#7c3aed' },
    font: c.font || 'sans', radius: c.radius || '12px',
  };
}

export function resolveTheme(settings, prefersDark) {
  const id = settings.theme || 'auto';
  if (id === CUSTOM_ID) return customTheme(settings);
  if (id === 'auto') return THEMES.find((t) => t.id === (prefersDark ? 'tumma' : 'vaalea'));
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

/** Teeman CSS-muuttujat. Puuttuvat sävyt johdetaan taustasta ja tekstistä. */
export function themeVars(t) {
  const { bg, text, accent } = t.colors;
  const mix = (p) => `color-mix(in srgb, ${text} ${p}%, ${bg})`;
  return {
    '--bg': bg,
    '--text': text,
    '--accent': accent,
    '--on-accent': contrastText(accent),
    '--surface': t.colors.surface || mix(3),
    '--surface-2': mix(8),
    '--border': mix(16),
    '--muted': mix(62),
    '--danger': t.colors.danger || (t.scheme === 'dark' ? '#f87171' : '#b91c1c'),
    '--ok': t.colors.ok || (t.scheme === 'dark' ? '#4ade80' : '#15803d'),
    '--radius': t.radius || '12px',
    '--font-display': FONTS[t.font] || FONTS.sans,
    'color-scheme': t.scheme,
  };
}

export function applyTheme(t) {
  const vars = themeVars(t);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.theme = t.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.colors.bg);
  // Välimuisti, jotta seuraava käynnistys piirtyy heti oikeilla väreillä
  try { localStorage.setItem('themeCache', JSON.stringify(vars)); } catch { /* */ }
}
