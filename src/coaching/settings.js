const api=globalThis.browser ?? globalThis.chrome;
const KEY='zen-chess-groq-key';
let value='', epoch=0;
const listeners=new Set();
export async function initializeSettings() {
  if(api?.runtime?.id && api.storage?.local) {
    await api.storage.local.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'});
    const stored=await api.storage.local.get(KEY);
    value=stored[KEY] || localStorage.getItem(KEY) || '';
    if(value && !stored[KEY]) await api.storage.local.set({[KEY]:value});
    localStorage.removeItem(KEY);
    api.storage.onChanged.addListener((changes,area)=>{
      if(area==='local' && changes[KEY] && value!==(changes[KEY].newValue || '')) {
        value=changes[KEY].newValue || '';epoch++;listeners.forEach(fn=>fn());
      }
    });
  } else {
    value=globalThis.localStorage?.getItem(KEY) || '';
    globalThis.addEventListener?.('storage',event=>{
      if(event.key===KEY){value=event.newValue || '';epoch++;listeners.forEach(fn=>fn());}
    });
  }
}
export function getApiKey(){return value;}
export function credentialRevision(){return epoch;}
export function onCredentialsChanged(fn){listeners.add(fn);}
export async function setApiKey(key) {
  value=String(key || '').trim();epoch++;listeners.forEach(fn=>fn());
  if(api?.runtime?.id && api.storage?.local) {
    if(value) await api.storage.local.set({[KEY]:value});else await api.storage.local.remove(KEY);
    localStorage.removeItem(KEY);
  } else {
    if(value) localStorage.setItem(KEY,value);else localStorage.removeItem(KEY);
  }
}
export async function quotaScope() {
  const bytes=new TextEncoder().encode(value);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}
