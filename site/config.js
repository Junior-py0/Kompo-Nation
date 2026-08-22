/* Public browser configuration only. Never place secret keys in this file. */
(() => {
const CONFIG = Object.freeze({
  siteName: "Kompo Nation",
  siteUrl: "https://kompo-nation.pages.dev",
  supabaseUrl: "https://vfifwtqbsdaxsikjpvku.supabase.co",
  supabasePublishableKey: "sb_publishable_AaLevppY9LCW1tRIPoEjSw_SGgy_SDQ",
  currency: "ZAR",
  locale: "en-ZA",
  fallbackDeliveryCents: 9900,
  functionsBase: "https://vfifwtqbsdaxsikjpvku.supabase.co/functions/v1",
});

const isSupabaseConfigured = () =>
  CONFIG.supabaseUrl.startsWith("https://") &&
  !CONFIG.supabaseUrl.includes("YOUR_PROJECT") &&
  CONFIG.supabasePublishableKey.length > 30 &&
  !CONFIG.supabasePublishableKey.includes("YOUR_SUPABASE");

window.KOMPO_CONFIG = { CONFIG, isSupabaseConfigured };
})();
