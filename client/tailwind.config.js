/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        base: {
          950: "#0a0b0f",
          900: "#111319",
          850: "#161922",
          800: "#1c2029",
          700: "#282e3a",
          600: "#3a4152",
        },
      },
    },
  },
  plugins: [],
};
