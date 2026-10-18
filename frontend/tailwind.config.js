/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        cad: {
          bg: 'var(--cad-bg)',
          bgSub: 'var(--cad-bg-sub)',
          viewport: 'var(--cad-viewport)',
          panel: 'var(--cad-panel)',
          panelElevated: 'var(--cad-panel-elevated)',
          border: 'var(--cad-border)',
          borderSubtle: 'var(--cad-border-subtle)',
          textPrimary: 'var(--cad-text-primary)',
          textSecondary: 'var(--cad-text-secondary)',
          textMuted: 'var(--cad-text-muted)',
          accent: 'var(--cad-accent)',
          accentHover: 'var(--cad-accent-hover)',
          success: 'var(--cad-success)',
          warning: 'var(--cad-warning)',
          error: 'var(--cad-error)',
          grid: 'var(--cad-grid)',
          inputBg: 'var(--cad-input-bg)',
          inputBorder: 'var(--cad-input-border)',
          sliderTrack: 'var(--cad-slider-track)',
        },
        industrial: {
          50: '#f4f6f8',
          100: '#e7ebf0',
          200: '#cfd7e2',
          300: '#a7b8cd',
          400: '#7994b3',
          500: '#58769a',
          600: '#445d7d',
          700: '#384b66',
          800: '#263346',
          900: '#1b2432',
          950: '#0f141c',
        },
        navy: {
          500: '#1e293b',
          800: '#111e2e',
          900: '#0a121e',
          950: '#050a12',
        },
        steel: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        accent: {
          blue: 'var(--cad-accent)',
          blueHover: 'var(--cad-accent-hover)',
          orange: 'var(--cad-warning)',
        },
        alutec: {
          blue: '#1A4784',
          blueHover: '#13396B',
          black: '#2F2C27',
          dark: '#1A1816',
          lightBg: '#F5F7FA',
        }
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
