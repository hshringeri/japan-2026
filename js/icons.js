// One plain icon per kind for the map pins, drawn white on the kind's colour like Google Maps.
// Paths are Material Icons (Apache 2.0) where one fits; the hot spring and torii are drawn here.
const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

const KIND_ICON = {
  shop: svg(`<path d="M18 6h-2c0-2.21-1.79-4-4-4S8 3.79 8 6H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-8 4c0 .55-.45 1-1 1s-1-.45-1-1V8h2v2zm2-6c1.1 0 2 .9 2 2h-4c0-1.1.9-2 2-2zm4 6c0 .55-.45 1-1 1s-1-.45-1-1V8h2v2z"/>`),
  eat: svg(`<path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/>`),
  drink: svg(`<path d="M21 5V3H3v2l8 9v5H6v2h12v-2h-5v-5l8-9zM7.43 7 5.66 5h12.69l-1.78 2H7.43z"/>`),
  music: svg(`<path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>`),
  play: svg(`<path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>`),
  unwind: svg(`<path d="M3 14h18a9 6.5 0 0 1-18 0z"/><path d="M7.5 11.5c-1.2-1.4 1.2-2.6 0-4s1.2-2.6 0-4M12 11.5c-1.2-1.4 1.2-2.6 0-4s1.2-2.6 0-4M16.5 11.5c-1.2-1.4 1.2-2.6 0-4s1.2-2.6 0-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  cars: svg(`<path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>`),
};

// Categories whose kind's icon would mislead: temples sit under Unwind with the hot springs
const CATEGORY_ICON = {
  "Hidden Temples & Shrines": svg(`<path d="M2 3.5h20l-1 3H3zM4.5 9h15v2.2h-15zM6 6.5h2.6V21H6zm9.4 0H18V21h-2.6z"/>`),
};

export const placeIcon = (p) => CATEGORY_ICON[p.categories[0]] || KIND_ICON[p.kind] || KIND_ICON.shop;
