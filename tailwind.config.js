/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'IBM Plex Mono', 'Courier New', 'monospace'],
        'mono-data': ['IBM Plex Mono', 'Courier New', 'monospace'],
      },
      colors: {
        'ttd-bg': '#0a0a0a',
        'ttd-surface': '#111111',
        'ttd-elevated': '#1a1a1a',
        'ttd-card': '#141414',
        'ttd-border': '#2a2a2a',
        'ttd-border-bright': '#3a3a3a',
        'ttd-green': '#00ff88',
        'ttd-cyan': '#00ccff',
        'ttd-amber': '#ffaa00',
        'ttd-red': '#ff4444',
        'ttd-purple': '#aa88ff',
        'ttd-text': '#e8e8e8',
        'ttd-muted': '#666666',
        'ttd-dim': '#444444',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease forwards',
        'slide-left': 'slideInLeft 0.25s ease forwards',
        'pulse-green': 'pulse-green 2s ease-in-out infinite',
        'blink': 'blink 1s step-end infinite',
        'glitch': 'glitch 0.3s ease',
        'scanline': 'scanline 8s linear infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideInLeft: {
          from: { opacity: '0', transform: 'translateX(-16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        glitch: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-2px)' },
          '40%': { transform: 'translateX(2px)' },
          '60%': { transform: 'translateX(-1px)' },
          '80%': { transform: 'translateX(1px)' },
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
      },
    },
  },
  plugins: [],
};