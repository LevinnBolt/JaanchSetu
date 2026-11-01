// Brand colours come from CSS variables (see src/index.css) so the theme can be switched at runtime.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: v('brand'), 50: v('brand-50'), 100: v('brand-100'), 700: v('brand-700'), 800: v('brand-800'), 900: v('brand-900') },
        paper: v('paper'),
        gold: { DEFAULT: v('gold'), 600: v('gold-600'), 100: v('gold-100') },
      },
      fontFamily: { sans: ['"Public Sans"', '"Noto Sans Devanagari"', '"Noto Sans Tamil"', '"Nirmala UI"', 'system-ui', 'sans-serif'] },
      boxShadow: { card: '0 1px 2px rgb(var(--brand) / .07), 0 2px 6px rgb(var(--brand) / .05)', pop: '0 10px 30px rgb(var(--brand) / .2)' },
      keyframes: {
        fadeUp: { '0%': { opacity: 0, transform: 'translateY(6px)' }, '100%': { opacity: 1, transform: 'none' } },
        slideIn: { '0%': { opacity: 0, transform: 'translateX(16px)' }, '100%': { opacity: 1, transform: 'none' } },
      },
      animation: { fadeUp: 'fadeUp .25s ease-out both', slideIn: 'slideIn .25s ease-out both' },
    },
  },
};
