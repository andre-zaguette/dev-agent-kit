/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.html'],
  theme: {
    extend: {
      colors: { primary: '#4F46E5', surface: '#FFFFFF', muted: '#64748B', border: '#E2E8F0', ink: '#0F172A' },
      borderRadius: { md: '12px' }
    }
  }
};
