// Resolve a write only after its transaction commits; abort partial bulk writes.
export async function openLibrary(legacy=[]) {
  if(typeof indexedDB==='undefined')return null;
  const db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open('booru-pocket',2);
    let blocked=false;
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains('posts'))db.createObjectStore('posts',{keyPath:'key'});
      if(!db.objectStoreNames.contains('sessions'))db.createObjectStore('sessions',{keyPath:'key'});
      if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta');
      if(!db.objectStoreNames.contains('seen'))db.createObjectStore('seen',{keyPath:'key'});
    };
    request.onsuccess=()=>{if(blocked)request.result.close();else resolve(request.result);};
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>{blocked=true;reject(new Error('Закройте другие вкладки приложения и повторите.'));};
  });
  db.onversionchange=()=>db.close();
  function write(stores,work){
    return new Promise((resolve,reject)=>{
      let transaction;
      try{transaction=db.transaction(stores,'readwrite');work(transaction);}
      catch(error){try{transaction?.abort();}catch{}reject(error);return;}
      transaction.oncomplete=()=>resolve();
      transaction.onabort=()=>reject(transaction.error||new Error('Запись отменена'));
      transaction.onerror=()=>{};
    });
  }
  function read(store,key){
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction(store),objectStore=transaction.objectStore(store);
      const request=key===undefined?objectStore.getAll():objectStore.get(key);
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
  }
  try{
    if(!await read('meta','migrated'))await write(['posts','meta'],transaction=>{
      for(const [index,post]of legacy.entries())transaction.objectStore('posts').put({...post,savedAt:post.savedAt||Date.now()-index});
      transaction.objectStore('meta').put(true,'migrated');
    });
  }catch(error){db.close();throw error;}
  return {
    seen:async()=>{
      const entries=(await read('seen')).sort((a,b)=>a.at-b.at),old=entries.slice(0,-5000);
      if(old.length)await write(['seen'],transaction=>{for(const entry of old)transaction.objectStore('seen').delete(entry.key);});
      return entries.slice(-5000);
    },
    markSeen:(entry,remove)=>write(['seen'],transaction=>{const store=transaction.objectStore('seen');if(remove)store.delete(remove);store.put(entry);}),
    clearSeen:()=>write(['seen'],transaction=>transaction.objectStore('seen').clear()),
    posts:()=>read('posts'),
    sessions:()=>read('sessions'),
    favorite:(post,remove)=>write(['posts'],transaction=>{
      const store=transaction.objectStore('posts');
      if(remove)store.delete(post.key);else store.put(post);
    }),
    replacePosts:posts=>write(['posts'],transaction=>{
      const store=transaction.objectStore('posts');store.clear();
      for(const post of posts)store.put(post);
    }),
    saveSession:(session,keep)=>write(['sessions'],transaction=>{
      const store=transaction.objectStore('sessions');store.put(session);
      const request=store.getAllKeys();
      request.onsuccess=()=>{for(const key of request.result)if(!keep.includes(key))store.delete(key);};
    }),
    clearSessions:()=>write(['sessions'],transaction=>transaction.objectStore('sessions').clear()),
    close:()=>db.close()
  };
}
