const BLOB_STORE_DB_NAME = "sxtension-shot-pro-db";
const BLOB_STORE_NAME = "downloads";

function openBlobStoreDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BLOB_STORE_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BLOB_STORE_NAME)) {
        db.createObjectStore(BLOB_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open blob store."));
  });
}

async function putBlobInStore(key, blob) {
  const db = await openBlobStoreDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(BLOB_STORE_NAME, "readwrite");
    transaction.objectStore(BLOB_STORE_NAME).put(blob, key);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("Failed to write blob to store."));
    };
  });
}

async function getBlobFromStore(key) {
  const db = await openBlobStoreDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(BLOB_STORE_NAME, "readonly");
    const request = transaction.objectStore(BLOB_STORE_NAME).get(key);
    request.onsuccess = () => {
      db.close();
      resolve(request.result || null);
    };
    request.onerror = () => {
      db.close();
      reject(request.error || new Error("Failed to read blob from store."));
    };
  });
}

async function deleteBlobFromStore(key) {
  const db = await openBlobStoreDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(BLOB_STORE_NAME, "readwrite");
    transaction.objectStore(BLOB_STORE_NAME).delete(key);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("Failed to delete blob from store."));
    };
  });
}
