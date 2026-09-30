// Runs before the page is painted so the server-rendered SEO fallback never
// flashes in front of the interactive storefront for JavaScript visitors.
document.documentElement.classList.add("has-js");
