/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          900: '#0b0e14',
          800: '#111722',
          700: '#1b2434',
          600: '#26344b'
        },
        trade: {
          green: '#0ecb81',
          red: '#f6465d',
          gold: '#f0b90b',
          blue: '#1e88e5'
        }
      }
    },
  },
  plugins: [],
}
