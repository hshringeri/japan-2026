// Search text, shared with the Worker.

// Lowercase, strip accents and punctuation so "Shimo-kita" finds "Shimokitazawa"
export const fold = (s) =>
  String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9぀-鿿]+/g, "");
