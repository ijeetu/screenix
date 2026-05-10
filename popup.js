const STORAGE_KEY = "screenix-settings";

const state = {
  mode: "visible",
  format: "png",
  quality: 0.92,
  filename: ""
};

const elements = {
  shell: document.querySelector(".shell"),
  modeButtons: Array.from(document.querySelectorAll("[data-mode]")),
  formatButtons: Array.from(document.querySelectorAll("[data-format]")),
  captureButton: document.getElementById("captureButton"),
  status: document.getElementById("status"),
  qualityPanel: document.getElementById("qualityPanel"),
  qualityRange: document.getElementById("qualityRange"),
  quality: document.getElementById("quality"),
  qualityLabel: document.getElementById("qualityLabel"),
  qualityHint: document.getElementById("qualityHint"),
  filename: document.getElementById("filename")
};

initialize().catch((error) => {
  setStatus(error.message || "Failed to initialize the popup.", "error");
});

async function initialize() {
  const saved = await chrome.storage.local.get(STORAGE_KEY);
  if (saved?.[STORAGE_KEY]) {
    Object.assign(state, saved[STORAGE_KEY]);
  }

  syncInputs();
  bindEvents();
  bindAutoSize();
  render();
  adjustPopupSize();
}

function bindEvents() {
  for (const button of elements.modeButtons) {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      persist();
      render();
    });
  }

  for (const button of elements.formatButtons) {
    button.addEventListener("click", () => {
      state.format = button.dataset.format;
      persist();
      render();
    });
  }

  elements.quality.addEventListener("input", () => {
    state.quality = Number(elements.quality.value) / 100;
    persist();
    render();
  });

  elements.filename.addEventListener("input", () => {
    state.filename = elements.filename.value;
    persist();
  });

  elements.captureButton.addEventListener("click", startCapture);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "CAPTURE_PROGRESS") {
      return;
    }

    setStatus(message.label, message.state === "error" ? "error" : message.state === "done" ? "success" : "");
  });
}

function syncInputs() {
  elements.quality.value = String(Math.round(state.quality * 100));
  elements.filename.value = state.filename;
}

function render() {
  for (const button of elements.modeButtons) {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-checked", String(active));
  }

  for (const button of elements.formatButtons) {
    const active = button.dataset.format === state.format;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-checked", String(active));
  }

  const qualityPercent = Math.round(state.quality * 100);
  elements.quality.value = String(qualityPercent);

  const qualityDisabled = state.format === "png";
  document.body.dataset.qualityVisible = String(!qualityDisabled);
  elements.qualityPanel.classList.toggle("is-disabled", qualityDisabled);
  elements.qualityRange.classList.toggle("is-hidden", qualityDisabled);
  elements.quality.disabled = qualityDisabled;
  elements.qualityHint.classList.toggle("is-muted", qualityDisabled);
  elements.qualityLabel.textContent = qualityDisabled ? "Auto" : `${qualityPercent}%`;
  elements.qualityHint.textContent = qualityDisabled
    ? "PNG stays lossless."
    : state.format === "pdf"
      ? "Used for PDF image quality."
      : "Higher means better image quality.";

  adjustPopupSize();
}

async function persist() {
  await chrome.storage.local.set({
    [STORAGE_KEY]: state
  });
}

async function startCapture() {
  elements.captureButton.disabled = true;
  setStatus("Capturing…", "");

  try {
    await persist();

    const response = await chrome.runtime.sendMessage({
      type: "START_CAPTURE",
      payload: {
        mode: state.mode,
        format: state.format,
        quality: state.quality,
        filename: state.filename
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Capture failed.");
    }

    setStatus(`Saved: ${response.filename}`, "success");
  } catch (error) {
    setStatus(error.message || "Capture failed.", "error");
  } finally {
    elements.captureButton.disabled = false;
  }
}

function setStatus(message, tone) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", tone === "error");
  elements.status.classList.toggle("is-success", tone === "success");
  adjustPopupSize();
}

function bindAutoSize() {
  const observer = new ResizeObserver(() => adjustPopupSize());
  observer.observe(elements.shell);

  window.addEventListener("load", adjustPopupSize, { once: true });

  if (document.fonts?.ready) {
    document.fonts.ready.then(() => adjustPopupSize()).catch(() => undefined);
  }

  for (const image of document.images) {
    if (image.complete) {
      continue;
    }

    image.addEventListener("load", adjustPopupSize, { once: true });
    image.addEventListener("error", adjustPopupSize, { once: true });
  }
}

function adjustPopupSize() {
  requestAnimationFrame(() => {
    const shellRect = elements.shell.getBoundingClientRect();
    const height = Math.ceil(shellRect.height);
    document.documentElement.style.height = `${height}px`;
    document.body.style.height = `${height}px`;
    document.body.style.overflow = "hidden";
  });
}
