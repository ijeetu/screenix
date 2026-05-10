const objectUrlMap = new Map();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OFFSCREEN_PREPARE_DOWNLOAD") {
    prepareDownloadObjectUrl(message.payload)
      .then((objectUrl) => sendResponse({ ok: true, objectUrl }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Offscreen download failed." }));

    return true;
  }

  if (message?.type === "OFFSCREEN_RELEASE_DOWNLOAD") {
    releaseDownloadObjectUrl(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Failed to clean up offscreen download." }));

    return true;
  }

  return false;
});

async function prepareDownloadObjectUrl(payload) {
  const blob = await getBlobFromStore(payload.downloadKey);
  if (!blob) {
    throw new Error("Download data is missing.");
  }

  const objectUrl = URL.createObjectURL(blob);
  objectUrlMap.set(payload.downloadKey, objectUrl);
  return objectUrl;
}

async function releaseDownloadObjectUrl(payload) {
  const objectUrl = objectUrlMap.get(payload.downloadKey);
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrlMap.delete(payload.downloadKey);
  }

  await deleteBlobFromStore(payload.downloadKey).catch(() => undefined);
}
