let opening;
export function openStore() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  if (!opening) opening = new Promise(resolve => {
    const request=indexedDB.open('scr-coach-v1',1);
    request.onupgradeneeded=()=>{
      request.result.createObjectStore('explanations',{keyPath:'key'});
      request.result.createObjectStore('quota');
    };
    request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();opening=null;};resolve(request.result);};
    request.onerror=request.onblocked=()=>{opening=null;resolve(null);};
  });
  return opening;
}
export async function transaction(store, mutate) {
  const db=await openStore();
  if(!db) throw new Error('Persistent coaching storage is unavailable. Local feedback remains available.');
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,'readwrite');
    let value;
    tx.oncomplete=()=>resolve(value);
    tx.onerror=tx.onabort=()=>reject(tx.error || new Error('Coaching storage failed'));
    try { mutate(tx.objectStore(store), result=>{value=result;}); } catch(error) {tx.abort();reject(error);}
  });
}
