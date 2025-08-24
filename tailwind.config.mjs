/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'Apple Color Emoji', 'Segoe UI Emoji'],
        display: ['"Spline Sans"', 'Inter', 'ui-sans-serif', 'system-ui']
      },
      colors: {
        brand: {
          50:  '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8', // indigo-400
          500: '#6366f1', // indigo-500
          600: '#7c3aed', // violet-600-ish mix
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95'
        }
      },
      borderRadius: {
        'xl': '1rem',
        '2xl': '1.25rem',
        '3xl': '1.75rem'
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,255,255,0.08), 0 10px 40px rgba(99,102,241,0.25)'
      },
      backgroundImage: {
        'radial-fade': 'radial-gradient(1200px 600px at 10% -10%, rgba(99,102,241,0.25), transparent 60%)',
        'radial-fade-2': 'radial-gradient(1000px 500px at 90% 0%, rgba(139,92,246,0.2), transparent 60%)'
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' }
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        }
      },
      animation: {
        float: 'float 8s ease-in-out infinite'
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography')
  ],
  safelist: [
    'from-brand-400', 'to-brand-600',
    'from-indigo-400', 'to-violet-400',
    'bg-gradient-to-r', 'bg-gradient-to-br'
  ]
};