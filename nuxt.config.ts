// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  nitro: {
    preset: 'node-server',
  },
  devServer: {
    host: '0.0.0.0',
    port: 3000,
  },
  app: {
    head: {
      title: 'Aplikasi Cleansing Data',
      htmlAttrs: { lang: 'id' },
    },
  },
  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    clickhouseUrl: '',
    clickhouseUser: '',
    clickhousePassword: '',
    elasticsearchUrl: '',
    elasticsearchUser: '',
    elasticsearchPassword: '',
    pythonBin: '',
  },
})