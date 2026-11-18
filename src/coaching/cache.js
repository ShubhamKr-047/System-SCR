import { transaction } from './storage.js';
const memory=new Map();
const MAX_ENTRIES=120;
export const explanationCache={
  async get(key) {
    if(memory.has(key)) {const value=memory.get(key);memory.delete(key);memory.set(key,value);return value;}
    try {
      return await transaction('explanations',(store,done)=>{
        const r=store.get(key);
        r.onsuccess=()=>{if(r.result){store.put({...r.result,touched:Date.now()});done(r.result.value);}};
      });
    } catch { return null; }
  },
  async set(key,value) {
    memory.delete(key);memory.set(key,value);
    if(memory.size>MAX_ENTRIES) memory.delete(memory.keys().next().value);
    try {
      await transaction('explanations',(store)=>{
        store.put({key,value,touched:Date.now()});
        const r=store.getAll();
        r.onsuccess=()=>r.result.sort((a,b)=>b.touched-a.touched).slice(MAX_ENTRIES).forEach(old=>store.delete(old.key));
      });
    } catch { /* A full disk must not discard an otherwise valid answer. */ }
  },
  async clear() {
    memory.clear();
    try {await transaction('explanations',store=>store.clear());} catch { /* memory-only mode */ }
  }
};
