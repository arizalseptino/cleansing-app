// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  app: {
    head: {
      title: 'Aplikasi Cleansing Data',
      htmlAttrs: { lang: 'id' },
    },
  },
  css: ['~/assets/css/main.css'],
})