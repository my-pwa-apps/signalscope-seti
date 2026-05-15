import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'InterVariable',
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif'
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'monospace'
        ]
      },
      colors: {
        space: {
          950: '#05070f',
          900: '#080c1a',
          850: '#0b1020',
          800: '#101736',
          700: '#1a2350',
          600: '#26306b',
          500: '#3a4791'
        },
        signal: {
          cyan: '#5ee0ff',
          violet: '#8b5cf6',
          rose: '#f472b6',
          amber: '#fbbf24',
          mint: '#34d399'
        }
      },
      boxShadow: {
        glow: '0 0 30px -8px rgba(94,224,255,0.45)',
        'glow-violet': '0 0 30px -8px rgba(139,92,246,0.55)'
      },
      backgroundImage: {
        'grid-faint':
          'linear-gradient(rgba(94,224,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(94,224,255,0.05) 1px, transparent 1px)',
        'radial-fade':
          'radial-gradient(ellipse at top, rgba(58,71,145,0.35), transparent 60%)'
      },
      keyframes: {
        scanline: {
          '0%': { transform: 'translateY(0%)' },
          '100%': { transform: 'translateY(100%)' }
        },
        pulseGlow: {
          '0%,100%': { opacity: '0.7' },
          '50%': { opacity: '1' }
        },
        floatY: {
          '0%,100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' }
        }
      },
      animation: {
        scanline: 'scanline 4s linear infinite',
        pulseGlow: 'pulseGlow 2.4s ease-in-out infinite',
        floatY: 'floatY 6s ease-in-out infinite'
      }
    }
  },
  plugins: []
} satisfies Config;
