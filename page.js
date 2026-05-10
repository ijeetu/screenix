(function bootstrapPageCapture() {
  if (window.__SXTENSION_PAGE_CAPTURE__) {
    return;
  }

  const HIDDEN_ATTR = "data-sxtension-hidden-for-capture";
  const STYLE_ATTR = "data-sxtension-style-snapshot";
  const ROOT_STYLE_ATTR = "data-sxtension-root-style-snapshot";
  const BODY_STYLE_ATTR = "data-sxtension-body-style-snapshot";

  function getScrollRoot() {
    return document.scrollingElement || document.documentElement;
  }

  function snapshotStyle(node, attrName) {
    const inlineStyle = node.getAttribute("style");
    node.setAttribute(attrName, inlineStyle === null ? "__NULL__" : inlineStyle);
  }

  function restoreStyle(node, attrName) {
    const snapshot = node.getAttribute(attrName);
    if (snapshot === null) {
      return;
    }

    if (snapshot === "__NULL__") {
      node.removeAttribute("style");
    } else {
      node.setAttribute("style", snapshot);
    }

    node.removeAttribute(attrName);
  }

  function shouldHideElement(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    if (!node.offsetParent && getComputedStyle(node).position !== "fixed") {
      return false;
    }

    const style = getComputedStyle(node);
    const position = style.position;
    if (position !== "fixed" && position !== "sticky") {
      return false;
    }

    const rect = node.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 24) {
      return false;
    }

    if (rect.height >= window.innerHeight * 0.92) {
      return false;
    }

    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) {
      return false;
    }

    return true;
  }

  function getPageMetrics() {
    const root = document.documentElement;
    const body = document.body;
    const totalWidth = Math.max(
      root.scrollWidth,
      root.clientWidth,
      body ? body.scrollWidth : 0,
      body ? body.clientWidth : 0
    );
    const totalHeight = Math.max(
      root.scrollHeight,
      root.clientHeight,
      body ? body.scrollHeight : 0,
      body ? body.clientHeight : 0
    );

    return {
      totalWidth,
      totalHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      originalX: window.scrollX,
      originalY: window.scrollY
    };
  }

  window.__SXTENSION_PAGE_CAPTURE__ = {
    prepare() {
      const root = getScrollRoot();
      snapshotStyle(root, ROOT_STYLE_ATTR);
      root.style.setProperty("scroll-behavior", "auto", "important");

      if (document.body) {
        snapshotStyle(document.body, BODY_STYLE_ATTR);
        document.body.style.setProperty("scroll-behavior", "auto", "important");
      }

      const hiddenNodes = [];
      const nodes = document.querySelectorAll("body *");
      for (const node of nodes) {
        if (!shouldHideElement(node)) {
          continue;
        }

        snapshotStyle(node, STYLE_ATTR);
        node.style.setProperty("visibility", "hidden", "important");
        node.style.setProperty("opacity", "0", "important");
        node.style.setProperty("pointer-events", "none", "important");
        node.setAttribute(HIDDEN_ATTR, "true");
        hiddenNodes.push(node);
      }

      window.__SXTENSION_PAGE_CAPTURE_STATE__ = {
        hiddenCount: hiddenNodes.length,
        originalX: window.scrollX,
        originalY: window.scrollY
      };

      return {
        ...getPageMetrics(),
        hiddenCount: hiddenNodes.length
      };
    },

    scrollToPosition(position) {
      window.scrollTo({
        left: position.x,
        top: position.y,
        behavior: "auto"
      });

      return {
        x: window.scrollX,
        y: window.scrollY
      };
    },

    restore() {
      const hiddenNodes = document.querySelectorAll(`[${HIDDEN_ATTR}]`);
      for (const node of hiddenNodes) {
        restoreStyle(node, STYLE_ATTR);
        node.removeAttribute(HIDDEN_ATTR);
      }

      const root = getScrollRoot();
      restoreStyle(root, ROOT_STYLE_ATTR);
      if (document.body) {
        restoreStyle(document.body, BODY_STYLE_ATTR);
      }

      const state = window.__SXTENSION_PAGE_CAPTURE_STATE__;
      if (state) {
        window.scrollTo({
          left: state.originalX || 0,
          top: state.originalY || 0,
          behavior: "auto"
        });
      }

      delete window.__SXTENSION_PAGE_CAPTURE_STATE__;

      return true;
    }
  };
})();
