/*
 * Server-safe (no "use client"): imported by app/layout.tsx. Sets <html data-theme> from localStorage, falling
 * back to the `theme` cookie, before first paint so there is no light/dark flash.
 */
/** Kept dependency-free and tiny; mirrors readPref/applyPref in ./theme.ts. */
export const themeBootScript = `(function(){try{var d=document.documentElement,t=null;try{t=localStorage.getItem("theme")}catch(e){}if(!/^(light|dark|system)$/.test(t||"")){var m=document.cookie.match(/(?:^|; )theme=(light|dark|system)/);t=m?m[1]:"system"}d.dataset.theme=t}catch(e){}})();`;
