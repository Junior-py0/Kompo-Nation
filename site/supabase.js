(() => {
const { CONFIG, isSupabaseConfigured } = window.KOMPO_CONFIG;
const createClient = window.supabase?.createClient;

const supabase = isSupabaseConfigured() && createClient
  ? createClient(CONFIG.supabaseUrl, CONFIG.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

const hasKompoMembership = async (userId) => {
  const { data, error } = await supabase
    .from("app_memberships")
    .select("user_id")
    .eq("user_id", userId)
    .eq("app_id", "kompo")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
};

const getSession = async () => {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) return null;
  if (await hasKompoMembership(data.session.user.id)) return data.session;
  await supabase.auth.signOut({ scope: "local" });
  return null;
};

const signIn = async (email, password) => {
  if (!supabase) throw new Error("Connect Supabase in config.js before signing in.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (data.session && !(await hasKompoMembership(data.user.id))) {
    await supabase.auth.signOut({ scope: "local" });
    throw new Error("This email is not registered with Kompo Nation. Create a Kompo Nation account with a different email or use the correct store login.");
  }
  return data;
};

// SUPABASE_SIGNUP_TERMS_V1
const signUp = async ({
  email,
  password,
  fullName,
  phone,
  termsVersion,
  termsAcceptedAt
}) => {

  if (!supabase) {
    throw new Error(
      "Kompo Nation account services are unavailable."
    );
  }


  if (
    termsVersion !== "1.0"
    || !termsAcceptedAt
  ) {
    throw new Error(
      "Terms acceptance is required before creating an account."
    );
  }


  const {
    data,
    error
  } =
    await supabase.auth.signUp({
      email,
      password,

      options: {
        emailRedirectTo:
          location.protocol === "http:" || location.protocol === "https:"
            ? `${location.origin}/login`
            : undefined,
        data: {
          app_id: "kompo",
          full_name:
            fullName,

          phone,

          terms_version:
            termsVersion,

          terms_accepted:
            true,

          terms_accepted_at:
            termsAcceptedAt
        }
      }
    });


  if (error) throw error;

  return data;
};

const signOut = async () => {
  if (supabase) await supabase.auth.signOut();
};

function catalogueFromRows(storeRows = [], productPayload = [], mediaRows = []) {
  const productRows = Array.isArray(productPayload) ? productPayload : [];
  const mediaByProduct = new Map();

  (mediaRows || []).forEach((row) => {
    if (!row.public_url) return;
    const items = mediaByProduct.get(row.product_id) || [];
    items.push({
      id: row.id,
      url: row.public_url,
      alt: row.alt_text || "",
      sortOrder: Number(row.sort_order || 0),
    });
    mediaByProduct.set(row.product_id, items);
  });

  return {
    stores: (storeRows || []).map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.business_name,
      description: row.description,
      shortDescription: row.short_description,
      mark: row.mark,
      accent: row.accent,
      status: row.status,
      salesCount: Number(row.sales_count),
      featuredOverride: row.featured_override,
      isPlatformOwned: row.is_platform_owned,
    })),

    products: productRows.map((row) => {
      const images = mediaByProduct.get(row.id) || [];
      const variants = (row.variants || []).map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        size: variant.size,
        colour: variant.colour,
        priceCents: Number(variant.price_cents),
        stock: Number(variant.stock),
        active: variant.active !== false,
      }));

      const activeVariants = variants.filter((variant) => variant.active);
      const inStockVariants = activeVariants.filter((variant) => variant.stock > 0);

      return {
        id: row.id,
        vendorId: row.vendor_id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        priceCents: inStockVariants.length
          ? Math.min(...inStockVariants.map((variant) => variant.priceCents))
          : activeVariants.length
            ? Math.min(...activeVariants.map((variant) => variant.priceCents))
            : 0,
        category: row.category,
        tone: row.tone,
        stock: activeVariants.reduce((sum, variant) => sum + variant.stock, 0),
        salesCount: Number(row.sales_count),
        isRare: row.is_rare,
        isCustomizable: row.is_customizable === true,
        status: row.status,
        sizes: [...new Set(activeVariants.map((variant) => variant.size))],
        colours: [...new Set(activeVariants.map((variant) => variant.colour))],
        sku: activeVariants[0]?.sku || "",
        imageUrl: images[0]?.url || row.image_url || "",
        images,
        variants,
      };
    }).filter((product) => product.variants.some((variant) => variant.active)),
  };
}

async function loadRemoteCatalogue() {
  if (!supabase) return null;

  const bootstrap = document.querySelector("#kompo-bootstrap-catalogue");
  if (bootstrap) {
    try {
      const source = bootstrap.content?.textContent || bootstrap.textContent || "";
      const payload = JSON.parse(source);
      return catalogueFromRows(payload.stores, payload.products, payload.media);
    } catch (error) {
      console.warn("The fast catalogue snapshot could not be read; refreshing it.", error);
    }
  }

  const [
    { data: storeRows, error: storeError },
    { data: productPayload, error: productError },
    { data: mediaRows, error: mediaError },
  ] = await Promise.all([
    supabase
      .from("vendors")
      .select("id,slug,business_name,description,short_description,mark,accent,status,sales_count,featured_override,is_platform_owned")
      .eq("status", "active")
      .is("retired_at", null),
    supabase.rpc("get_storefront_products"),
    supabase
      .from("product_media")
      .select("id,product_id,public_url,alt_text,sort_order,created_at")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (storeError || productError || mediaError) {
    throw storeError || productError || mediaError;
  }

  return catalogueFromRows(storeRows, productPayload, mediaRows);
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
