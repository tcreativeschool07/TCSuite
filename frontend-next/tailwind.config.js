/** @type {import('tailwindcss').Config} */
// Every color maps to a CSS variable defined in app/globals.css.
// No raw hex values in components — tokens only.
module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{js,jsx}', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        surface: {
          DEFAULT: 'var(--surface)',
          sunken: 'var(--surface-sunken)',
        },
        edge: 'var(--edge)',
        rule: 'var(--rule)',
        ink: {
          DEFAULT: 'var(--ink)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          strong: 'var(--accent-strong)',
          tint: 'var(--accent-tint)',
        },
        'on-accent': 'var(--on-accent)',
        focus: 'var(--focus)',
        ok: { DEFAULT: 'var(--ok)', tint: 'var(--ok-tint)' },
        warn: { DEFAULT: 'var(--warn)', tint: 'var(--warn-tint)' },
        danger: { DEFAULT: 'var(--danger)', tint: 'var(--danger-tint)' },
        info: { DEFAULT: 'var(--info)', tint: 'var(--info-tint)' },
        neutral: { DEFAULT: 'var(--neutral)', tint: 'var(--neutral-tint)' },
      },
      fontFamily: {
        ui: ['var(--font-ui)', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'Times New Roman', 'serif'],
      },
      boxShadow: {
        overlay: 'var(--shadow-overlay)',
      },
      borderRadius: {
        control: '6px',
        panel: '10px',
      },
      maxWidth: {
        content: '1200px',
      },
      transitionDuration: {
        120: '120ms',
        240: '240ms',
      },
    },
  },
  plugins: [],
}
