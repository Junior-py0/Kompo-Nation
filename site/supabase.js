(() => {
const { CONFIG, isSupabaseConfigured } = window.KOMPO_CONFIG;
const createClient = window.supabase?.createClient;

const supabase = isSupabaseConfigured() && createClient
  ? createClient(CONFIG.supabaseUrl, CONFIG.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

const getSession = async () => {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
};

const signIn = async (email, password) => {
  if (!supabase) throw new Error("Connect Supabase in config.js before signing in.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
};

const signUp = async ({ email, password, fullName, phone }) => {
  if (!supabase) throw new Error("Connect Supabase in config.js before creating accounts.");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, phone } },
  });
  if (error) throw error;
  return data;
};

const signOut = async () => {
  if (supabase) await supabase.auth.signOut();
};

async function loadRemoteCatalogue() {
  if (!supabase) return null;
  const [{ data: storeRows, error: storeError }, { data: productRows, error: productError }] = await Promise.all([
    supabase.from("vendors").select("id,slug,business_name,description,short_description,mark,accent,status,sales_count,featured_override,is_platform_owned").eq("status", "active"),
    supabase.from("product_catalog").select("*").eq("status", "active").gt("stock", 0),
  ]);
  if (storeError || productError) throw storeError || productError;
  return {
    stores: storeRows.map((row) => ({ id: row.id, slug: row.slug, name: row.business_name, description: row.description, shortDescription: row.short_description, mark: row.mark, accent: row.accent, status: row.status, salesCount: Number(row.sales_count), featuredOverride: row.featured_override, isPlatformOwned: row.is_platform_owned })),
    products: productRows.map((row) => ({ id: row.id, vendorId: row.vendor_id, slug: row.slug, name: row.name, description: row.description, priceCents: Number(row.price_cents), category: row.category, tone: row.tone, stock: Number(row.stock), salesCount: Number(row.sales_count), isRare: row.is_rare, status: row.status, sizes: row.sizes || [], colours: row.colours || [], sku: row.sku, imageUrl: row.image_url })),
  };
}

async function loadWishlist(userId) {
  if (!supabase || !userId) return [];
  const { data, error } = await supabase.from("wishlist_items").select("product_id,wishlists!inner(customer_id)").eq("wishlists.customer_id", userId);
  if (error) throw error;
  return data.map((row) => row.product_id);
}

async function toggleRemoteWishlist(productId) {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("toggle_wishlist", { p_product_id: productId });
  if (error) throw error;
  return Boolean(data);
}

async function authHeader() {
  const session = await getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

window.KOMPO_SUPABASE = {
  supabase,
  getSession,
  signIn,
  signUp,
  signOut,
  loadRemoteCatalogue,
  loadWishlist,
  toggleRemoteWishlist,
  authHeader,
};
})();
