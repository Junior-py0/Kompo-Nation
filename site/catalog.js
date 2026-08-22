/* Disconnected catalogue used until config.js points at the alpha database. */
(() => {
const LOCAL_STORES = [
  { id: "10000000-0000-4000-8000-000000000001", slug: "barax", name: "BARAX", description: "A fearless independent label translating Limpopo street energy into limited garments built to be seen.", shortDescription: "Street statements from Limpopo", mark: "BX", accent: "sand", salesCount: 184, featuredOverride: null, isPlatformOwned: false },
  { id: "10000000-0000-4000-8000-000000000002", slug: "kaychero-w", name: "KAYCHERO W", description: "Sound, motion and fearless style expressed through heavyweight essentials and short-run drops.", shortDescription: "Sound, motion and fearless style", mark: "KW", accent: "mist", salesCount: 162, featuredOverride: null, isPlatformOwned: false },
  { id: "10000000-0000-4000-8000-000000000003", slug: "le-26", name: "LE 26", description: "Small releases, distinctive graphics and pieces carrying the pulse of a growing movement.", shortDescription: "Limited pieces. Loud identity.", mark: "26", accent: "stone", salesCount: 141, featuredOverride: null, isPlatformOwned: false },
  { id: "10000000-0000-4000-8000-000000000004", slug: "kompo-nation", name: "Kompo Nation", description: "The house collection: clean essentials designed to carry the nation everywhere it goes.", shortDescription: "The house collection", mark: "KN", accent: "sage", salesCount: 119, featuredOverride: true, isPlatformOwned: true },
  { id: "10000000-0000-4000-8000-000000000005", slug: "northern-static", name: "Northern Static", description: "Experimental streetwear made for loud rooms, night drives and northern summers.", shortDescription: "Experimental northern streetwear", mark: "NS", accent: "mist", salesCount: 76, featuredOverride: null, isPlatformOwned: false },
  { id: "10000000-0000-4000-8000-000000000006", slug: "moya-form", name: "Moya Form", description: "Relaxed garments shaped by rhythm, movement and everyday life in Limpopo.", shortDescription: "Made to move with you", mark: "MF", accent: "sand", salesCount: 58, featuredOverride: null, isPlatformOwned: false },
];

const LOCAL_PRODUCTS = [
  { id: "20000000-0000-4000-8000-000000000001", vendorId: LOCAL_STORES[3].id, slug: "night-signal-tee", name: "Night Signal Tee", description: "A structured heavyweight cotton tee with an original signal graphic and relaxed unisex fit.", priceCents: 48000, category: "T-shirts", tone: "sage", stock: 28, salesCount: 96, isRare: false, status: "active", sizes: ["S","M","L","XL","2XL"], colours: ["Black","Bone"], sku: "KN-NST-001" },
  { id: "20000000-0000-4000-8000-000000000002", vendorId: LOCAL_STORES[0].id, slug: "movement-heavyweight", name: "Movement Heavyweight", description: "Dense premium cotton, a boxy silhouette and a clean front mark built for daily rotation.", priceCents: 76000, category: "T-shirts", tone: "sand", stock: 16, salesCount: 121, isRare: true, status: "active", sizes: ["S","M","L","XL"], colours: ["Bone","Black"], sku: "BX-MHV-014" },
  { id: "20000000-0000-4000-8000-000000000003", vendorId: LOCAL_STORES[2].id, slug: "northern-pulse-cap", name: "Northern Pulse Cap", description: "A six-panel cap with embroidered pulse detail, adjustable back and curved brim.", priceCents: 34000, category: "Accessories", tone: "mist", stock: 6, salesCount: 88, isRare: true, status: "active", sizes: ["One size"], colours: ["Black","Stone"], sku: "LE-PUL-026" },
  { id: "20000000-0000-4000-8000-000000000004", vendorId: LOCAL_STORES[1].id, slug: "after-dark-hoodie", name: "After Dark Hoodie", description: "Warm brushed fleece, deep hood and minimal chest artwork for late nights and early sets.", priceCents: 92000, category: "Hoodies", tone: "stone", stock: 19, salesCount: 104, isRare: false, status: "active", sizes: ["S","M","L","XL","2XL"], colours: ["Black"], sku: "KC-ADH-008" },
  { id: "20000000-0000-4000-8000-000000000005", vendorId: LOCAL_STORES[0].id, slug: "barax-line-jacket", name: "Line Jacket", description: "A lightweight black layer with contrast piping and a compact fold-away hood.", priceCents: 118000, category: "Jackets", tone: "mist", stock: 11, salesCount: 74, isRare: true, status: "active", sizes: ["S","M","L","XL"], colours: ["Black"], sku: "BX-LJ-019" },
  { id: "20000000-0000-4000-8000-000000000006", vendorId: LOCAL_STORES[3].id, slug: "nation-crest-sweat", name: "Nation Crest Sweat", description: "A soft crewneck with tonal crest embroidery and a generous relaxed cut.", priceCents: 78000, category: "Sweatshirts", tone: "sand", stock: 32, salesCount: 67, isRare: false, status: "active", sizes: ["XS","S","M","L","XL"], colours: ["Bone","Black"], sku: "KN-NCS-007" },
  { id: "20000000-0000-4000-8000-000000000007", vendorId: LOCAL_STORES[4].id, slug: "static-cargo", name: "Static Cargo", description: "Straight-leg utility trousers with articulated knees and secure side pockets.", priceCents: 89000, category: "Bottoms", tone: "sage", stock: 14, salesCount: 43, isRare: false, status: "active", sizes: ["28","30","32","34","36"], colours: ["Charcoal"], sku: "NS-SCG-004" },
  { id: "20000000-0000-4000-8000-000000000008", vendorId: LOCAL_STORES[5].id, slug: "moya-canvas-tote", name: "Moya Canvas Tote", description: "A reinforced cotton carry-all with long handles and a subtle woven label.", priceCents: 29000, category: "Accessories", tone: "sand", stock: 44, salesCount: 39, isRare: false, status: "active", sizes: ["One size"], colours: ["Natural"], sku: "MF-TOT-003" },
];

const rankProducts = (products) => [...products]
  .filter((product) => product.status === "active" && product.stock > 0)
  .sort((a, b) => ((b.salesCount * 5) + Math.min(b.stock, 20) * 2 + (b.isRare && b.stock <= 12 ? 30 : 0)) - ((a.salesCount * 5) + Math.min(a.stock, 20) * 2 + (a.isRare && a.stock <= 12 ? 30 : 0)));

const rankStores = (stores) => [...stores]
  .filter((store) => store.status !== "suspended" && store.featuredOverride !== false)
  .sort((a, b) => Number(Boolean(b.featuredOverride)) - Number(Boolean(a.featuredOverride)) || b.salesCount - a.salesCount);

window.KOMPO_CATALOG = { LOCAL_STORES, LOCAL_PRODUCTS, rankProducts, rankStores };
})();
