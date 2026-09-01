/* Disconnected catalogue used until config.js points at the alpha database. */
(() => {
const LOCAL_STORES = [
  { id: "10000000-0000-4000-8000-000000000001", slug: "barax", name: "BARAX", description: "A fearless independent label translating Limpopo street energy into limited garments built to be seen.", shortDescription: "Street statements from Limpopo", mark: "BX", accent: "sand", salesCount: 0, featuredOverride: null, isPlatformOwned: false },
  { id: "10000000-0000-4000-8000-000000000002", slug: "kaychero-w", name: "KAYCHERO W", description: "Sound, motion and fearless style expressed through heavyweight essentials and short-run drops.", shortDescription: "Sound, motion and fearless style", mark: "KW", accent: "mist", salesCount: 0, featuredOverride: null, isPlatformOwned: false },
  { id: "10000000-0000-4000-8000-000000000003", slug: "le-26", name: "LE 26", description: "Small releases, distinctive graphics and pieces carrying the pulse of a growing movement.", shortDescription: "Limited pieces. Loud identity.", mark: "26", accent: "stone", salesCount: 0, featuredOverride: null, isPlatformOwned: false },
  { id: "10000000-0000-4000-8000-000000000004", slug: "kompo-nation", name: "Kompo Nation", description: "The house collection: clean essentials designed to carry the nation everywhere it goes.", shortDescription: "The house collection", mark: "KN", accent: "sage", salesCount: 0, featuredOverride: true, isPlatformOwned: true },
  { id: "10000000-0000-4000-8000-000000000005", slug: "northern-static", name: "Northern Static", description: "Experimental streetwear made for loud rooms, night drives and northern summers.", shortDescription: "Experimental northern streetwear", mark: "NS", accent: "mist", salesCount: 0, featuredOverride: null, isPlatformOwned: false },
  { id: "10000000-0000-4000-8000-000000000006", slug: "moya-form", name: "Moya Form", description: "Relaxed garments shaped by rhythm, movement and everyday life in Limpopo.", shortDescription: "Made to move with you", mark: "MF", accent: "sand", salesCount: 0, featuredOverride: null, isPlatformOwned: false },
];

const LOCAL_PRODUCTS = [];

const rankProducts = (products) => [...products]
  .filter((product) => product.status === "active" && product.stock > 0)
  .sort((a, b) => ((b.salesCount * 5) + Math.min(b.stock, 20) * 2 + (b.isRare && b.stock <= 12 ? 30 : 0)) - ((a.salesCount * 5) + Math.min(a.stock, 20) * 2 + (a.isRare && a.stock <= 12 ? 30 : 0)));

const rankStores = (stores) => [...stores]
  .filter((store) => store.status !== "suspended" && store.featuredOverride !== false)
  .sort((a, b) => Number(Boolean(b.featuredOverride)) - Number(Boolean(a.featuredOverride)) || b.salesCount - a.salesCount);

window.KOMPO_CATALOG = { LOCAL_STORES, LOCAL_PRODUCTS, rankProducts, rankStores };
})();
