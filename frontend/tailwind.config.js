/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        arabic: ['Cairo', 'Tajawal', 'sans-serif'],
        display: ['Alexandria', 'IBM Plex Sans Arabic', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          900: '#14532d',
        },
        wa: '#25D366', // WhatsApp green
        // The SHIFT operator console (/admin). Ink navy and one gold mark; colour otherwise
        // carries state only. Mirrors the approved design canvas (2026-10-11).
        shift: {
          ink: '#0F1E38',
          ink2: '#1B2D4F',
          body: '#3D4A63',
          muted: '#56627A',
          line: '#E3E7EE',
          line2: '#EEF1F5',
          field: '#D3D9E3',
          canvas: '#F5F6F9',
          hover: '#F8F9FB',
          accent: '#1F6BFF',
          sel: '#E8F0FF',
          selText: '#1F4FC2',
          selLine: '#C9DAFF',
          gold: '#F2B33D',
          navText: '#B8C4D8',
          navMuted: '#8FA0BD',
          danger: '#B42318',
          dangerBg: '#FDECEA',
          dangerLine: '#F1C4BF',
          warn: '#8A4A06',
          warnBg: '#FBF1DE',
          ok: '#15803D',
          okBg: '#E5F4EA',
        },
      },
    },
  },
  plugins: [],
};
