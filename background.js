importScripts("blob-store.js");

const SCROLL_DELAY_MS = 320;
const RENDER_SETTLE_DELAY_MS = 180;
const RESTORE_DELAY_MS = 120;
const MAX_CANVAS_EDGE = 32767;
const MAX_CANVAS_AREA = 268435456;
let offscreenDocumentPromise = null;
const pendingDownloadCleanup = new Map();

console.log("Screenix background worker v1.0.2 loaded");

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "START_CAPTURE") {
    return false;
  }

  handleCapture(message.payload)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      emitProgress("error", error.message || "Capture failed.");
      sendResponse({ ok: false, error: error.message || "Capture failed." });
    });

  return true;
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state?.current) {
    return;
  }

  if (delta.state.current !== "complete" && delta.state.current !== "interrupted") {
    return;
  }

  const downloadKey = pendingDownloadCleanup.get(delta.id);
  if (!downloadKey) {
    return;
  }

  pendingDownloadCleanup.delete(delta.id);
  releaseOffscreenDownload(downloadKey).catch(() => undefined);
});

async function handleCapture(payload) {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  ensureSupportedUrl(tab.url);

  const mode = payload?.mode === "full" ? "full" : "visible";
  const format = normalizeFormat(payload?.format);
  const quality = normalizeQuality(payload?.quality);
  const filenameBase = sanitizeBaseName(payload?.filename) || sanitizeBaseName(tab.title) || "sxtension-shot";

  emitProgress("working", mode === "full" ? "Preparing full page capture…" : "Capturing current screen…");

  const canvas = mode === "full"
    ? await captureFullPage(tab)
    : await captureVisibleTab(tab.windowId);

  emitProgress("working", `Building ${format.toUpperCase()} file…`);
  const blob = await exportCanvas(canvas, format, quality);
  const filename = `${filenameBase}-${timestampSlug()}.${format}`;

  emitProgress("working", "Starting download…");
  await downloadBlob(blob, filename);
  emitProgress("done", "Capture finished.");

  return { filename };
}

async function captureVisibleTab(windowId) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  return canvasFromDataUrl(dataUrl);
}

async function captureFullPage(tab) {
  emitProgress("working", "Measuring the page…");
  await injectPageHelper(tab.id);
  const metrics = await runPageCommand(tab.id, "prepare");

  const horizontalOverlap = metrics.totalWidth > metrics.viewportWidth
    ? Math.min(32, Math.floor(metrics.viewportWidth * 0.08))
    : 0;
  const verticalOverlap = metrics.totalHeight > metrics.viewportHeight
    ? Math.min(120, Math.floor(metrics.viewportHeight * 0.18))
    : 0;

  const xPositions = buildScrollPositions(metrics.totalWidth, metrics.viewportWidth, horizontalOverlap);
  const yPositions = buildScrollPositions(metrics.totalHeight, metrics.viewportHeight, verticalOverlap);
  const totalTiles = xPositions.length * yPositions.length;

  let compositeCanvas;
  let context;
  let scaleX = 1;
  let scaleY = 1;
  let tileIndex = 0;

  try {
    for (const [rowIndex, y] of yPositions.entries()) {
      for (const [columnIndex, x] of xPositions.entries()) {
        tileIndex += 1;
        emitProgress("working", `Tile ${tileIndex}/${totalTiles}…`);

        const position = await runPageCommand(tab.id, "scrollToPosition", { x, y });
        await sleep(SCROLL_DELAY_MS);
        await sleep(RENDER_SETTLE_DELAY_MS);

        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
        const bitmap = await imageBitmapFromDataUrl(dataUrl);

        if (!compositeCanvas) {
          scaleX = bitmap.width / metrics.viewportWidth;
          scaleY = bitmap.height / metrics.viewportHeight;

          const targetWidth = Math.round(metrics.totalWidth * scaleX);
          const targetHeight = Math.round(metrics.totalHeight * scaleY);
          ensureCanvasWithinLimits(targetWidth, targetHeight);

          compositeCanvas = new OffscreenCanvas(targetWidth, targetHeight);
          context = compositeCanvas.getContext("2d", { alpha: false });
          context.imageSmoothingEnabled = true;
        }

        const cropLeftCss = columnIndex === 0 ? 0 : horizontalOverlap;
        const cropTopCss = rowIndex === 0 ? 0 : verticalOverlap;
        const sourceX = Math.round(cropLeftCss * scaleX);
        const sourceY = Math.round(cropTopCss * scaleY);
        const destX = Math.round((position.x + cropLeftCss) * scaleX);
        const destY = Math.round((position.y + cropTopCss) * scaleY);
        const sourceWidth = Math.min(bitmap.width - sourceX, compositeCanvas.width - destX);
        const sourceHeight = Math.min(bitmap.height - sourceY, compositeCanvas.height - destY);

        if (sourceWidth <= 0 || sourceHeight <= 0) {
          if (typeof bitmap.close === "function") {
            bitmap.close();
          }
          continue;
        }

        context.drawImage(
          bitmap,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          destX,
          destY,
          sourceWidth,
          sourceHeight
        );

        if (typeof bitmap.close === "function") {
          bitmap.close();
        }
      }
    }
  } finally {
    await runPageCommand(tab.id, "restore").catch(() => undefined);
    await sleep(RESTORE_DELAY_MS);
  }

  if (!compositeCanvas) {
    throw new Error("Nothing was captured from the page.");
  }

  return compositeCanvas;
}

function buildScrollPositions(totalSize, viewportSize, overlap = 0) {
  if (!Number.isFinite(totalSize) || !Number.isFinite(viewportSize) || viewportSize <= 0) {
    return [0];
  }

  if (totalSize <= viewportSize) {
    return [0];
  }

  const positions = [];
  const maxOffset = totalSize - viewportSize;
  const step = Math.max(1, viewportSize - Math.max(0, overlap));
  for (let offset = 0; offset < totalSize; offset += step) {
    positions.push(Math.min(offset, maxOffset));
  }

  return [...new Set(positions)];
}

async function exportCanvas(canvas, format, quality) {
  if (format === "pdf") {
    return canvasToPdfBlob(canvas, quality);
  }

  const mimeType = format === "jpg" ? "image/jpeg" : `image/${format}`;
  const exportQuality = format === "png" ? undefined : quality;
  return canvas.convertToBlob({
    type: mimeType,
    quality: exportQuality
  });
}

async function canvasToPdfBlob(canvas, quality) {
  emitProgress("working", "Paginating PDF…");

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 24;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  const slicePixelHeight = Math.max(1, Math.floor((canvas.width * contentHeight) / contentWidth));
  const pageSlices = [];

  for (let offsetY = 0; offsetY < canvas.height; offsetY += slicePixelHeight) {
    const currentSliceHeight = Math.min(slicePixelHeight, canvas.height - offsetY);
    const sliceCanvas = new OffscreenCanvas(canvas.width, currentSliceHeight);
    const sliceContext = sliceCanvas.getContext("2d", { alpha: false });
    sliceContext.drawImage(
      canvas,
      0,
      offsetY,
      canvas.width,
      currentSliceHeight,
      0,
      0,
      canvas.width,
      currentSliceHeight
    );

    const sliceBlob = await sliceCanvas.convertToBlob({
      type: "image/jpeg",
      quality
    });

    pageSlices.push({
      bytes: new Uint8Array(await sliceBlob.arrayBuffer()),
      pixelWidth: canvas.width,
      pixelHeight: currentSliceHeight,
      drawWidth: contentWidth,
      drawHeight: (currentSliceHeight * contentWidth) / canvas.width
    });
  }

  return buildPdfFromJpegSlices(pageSlices, { pageWidth, pageHeight, margin });
}

function buildPdfFromJpegSlices(slices, layout) {
  const encoder = new TextEncoder();
  const objects = [];

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";

  const pageObjectNumbers = [];
  let objectNumber = 3;

  for (let index = 0; index < slices.length; index += 1) {
    const slice = slices[index];
    const imageObjectNumber = objectNumber;
    const contentObjectNumber = objectNumber + 1;
    const pageObjectNumber = objectNumber + 2;
    objectNumber += 3;

    const imageHeader =
      `${imageObjectNumber} 0 obj\n` +
      `<< /Type /XObject /Subtype /Image /Width ${slice.pixelWidth} /Height ${slice.pixelHeight} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${slice.bytes.length} >>\nstream\n`;
    const imageFooter = "\nendstream\nendobj\n";
    objects[imageObjectNumber] = [
      encoder.encode(imageHeader),
      slice.bytes,
      encoder.encode(imageFooter)
    ];

    const drawY = layout.pageHeight - layout.margin - slice.drawHeight;
    const contentStream =
      "q\n" +
      `${slice.drawWidth.toFixed(2)} 0 0 ${slice.drawHeight.toFixed(2)} ${layout.margin.toFixed(2)} ${drawY.toFixed(2)} cm\n` +
      `/Im${index + 1} Do\n` +
      "Q";
    objects[contentObjectNumber] =
      `${contentObjectNumber} 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`;

    objects[pageObjectNumber] =
      `${pageObjectNumber} 0 obj\n` +
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${layout.pageWidth} ${layout.pageHeight}] ` +
      `/Resources << /XObject << /Im${index + 1} ${imageObjectNumber} 0 R >> >> ` +
      `/Contents ${contentObjectNumber} 0 R >>\nendobj\n`;

    pageObjectNumbers.push(pageObjectNumber);
  }

  objects[2] =
    `<< /Type /Pages /Count ${pageObjectNumbers.length} /Kids [` +
    `${pageObjectNumbers.map((num) => `${num} 0 R`).join(" ")}` +
    "] >>";

  const parts = [encoder.encode("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n")];
  const offsets = [0];
  let cursor = parts[0].length;

  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = cursor;

    const entry = objects[index];
    if (Array.isArray(entry)) {
      for (const chunk of entry) {
        parts.push(chunk);
        cursor += chunk.length;
      }
      continue;
    }

    const serialized = encoder.encode(
      entry.startsWith(`${index} 0 obj`)
        ? entry
        : `${index} 0 obj\n${entry}\nendobj\n`
    );
    parts.push(serialized);
    cursor += serialized.length;
  }

  const xrefOffset = cursor;
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  const trailer =
    `${xref}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  parts.push(encoder.encode(trailer));

  return new Blob(parts, { type: "application/pdf" });
}

async function downloadBlob(blob, filename) {
  const downloadKey = `download-${timestampSlug()}-${Math.random().toString(36).slice(2, 10)}`;
  await putBlobInStore(downloadKey, blob);
  await ensureOffscreenDocument();

  const prepareResponse = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_PREPARE_DOWNLOAD",
    payload: {
      downloadKey
    }
  });

  if (!prepareResponse?.ok || !prepareResponse?.objectUrl) {
    await deleteBlobFromStore(downloadKey).catch(() => undefined);
    throw new Error(prepareResponse?.error || "Failed to prepare the download.");
  }

  try {
    const downloadId = await chrome.downloads.download({
      url: prepareResponse.objectUrl,
      filename,
      saveAs: false,
      conflictAction: "uniquify"
    });
    pendingDownloadCleanup.set(downloadId, downloadKey);
  } catch (error) {
    await releaseOffscreenDownload(downloadKey);
    throw error;
  }
}

async function injectPageHelper(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["page.js"]
  });
}

async function runPageCommand(tabId, command, payload) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (cmd, data) => {
      if (!window.__SXTENSION_PAGE_CAPTURE__) {
        throw new Error("Capture helper is not available on this page.");
      }

      const method = window.__SXTENSION_PAGE_CAPTURE__[cmd];
      if (typeof method !== "function") {
        throw new Error(`Unknown page capture command: ${cmd}`);
      }

      return method(data);
    },
    args: [command, payload ?? null]
  });

  return result.result;
}

async function canvasFromDataUrl(dataUrl) {
  const bitmap = await imageBitmapFromDataUrl(dataUrl);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(bitmap, 0, 0);

  if (typeof bitmap.close === "function") {
    bitmap.close();
  }

  return canvas;
}

async function imageBitmapFromDataUrl(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

function normalizeFormat(format) {
  return ["png", "jpg", "webp", "pdf"].includes(format) ? format : "png";
}

function normalizeQuality(quality) {
  const numeric = Number(quality);
  if (!Number.isFinite(numeric)) {
    return 0.92;
  }

  return Math.max(0.4, Math.min(1, numeric));
}

function sanitizeBaseName(value) {
  if (!value || typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function timestampSlug() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function ensureSupportedUrl(url) {
  if (!url) {
    throw new Error("The active tab does not have a capturable URL.");
  }

  const parsed = new URL(url);
  if (!["http:", "https:", "file:"].includes(parsed.protocol)) {
    throw new Error("This page cannot be captured. Try a regular website tab instead.");
  }
}

function ensureCanvasWithinLimits(width, height) {
  if (width > MAX_CANVAS_EDGE || height > MAX_CANVAS_EDGE || width * height > MAX_CANVAS_AREA) {
    throw new Error("This page is too large to stitch into one image. Try the current screen mode instead.");
  }
}

function emitProgress(state, label) {
  chrome.runtime.sendMessage({
    type: "CAPTURE_PROGRESS",
    state,
    label
  }).catch(() => undefined);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureOffscreenDocument() {
  const path = "offscreen.html";
  const offscreenUrl = chrome.runtime.getURL(path);

  if ("getContexts" in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });

    if (contexts.length > 0) {
      return;
    }
  }

  if (!offscreenDocumentPromise) {
    offscreenDocumentPromise = chrome.offscreen.createDocument({
      url: path,
      reasons: ["BLOBS"],
      justification: "Generate object URLs and trigger automatic file downloads."
    }).catch((error) => {
      if (!String(error?.message || error).includes("Only a single offscreen document may be created")) {
        throw error;
      }
    }).finally(() => {
      offscreenDocumentPromise = null;
    });
  }

  await offscreenDocumentPromise;
}

async function releaseOffscreenDownload(downloadKey) {
  await chrome.runtime.sendMessage({
    type: "OFFSCREEN_RELEASE_DOWNLOAD",
    payload: {
      downloadKey
    }
  }).catch(() => undefined);
}
