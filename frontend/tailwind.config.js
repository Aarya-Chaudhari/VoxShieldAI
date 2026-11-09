/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        panel: '#0f172a',
        ink: '#e2e8f0',
        accent: '#22c55e',
        amber: '#f59e0b',
        danger: '#ef4444',
        slate: '#111827',
      },
    },
  },
  plugins: [],
};
