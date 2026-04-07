let cashfreeScriptPromise = null;

const CASHFREE_SDK_URL = "https://sdk.cashfree.com/js/v3/cashfree.js";

export const loadCashfreeSdk = () => {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Cashfree checkout can only load in the browser."));
  }

  if (window.Cashfree) {
    return Promise.resolve(window.Cashfree);
  }

  if (cashfreeScriptPromise) {
    return cashfreeScriptPromise;
  }

  cashfreeScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-cashfree-sdk="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Cashfree), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load Cashfree checkout SDK.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = CASHFREE_SDK_URL;
    script.async = true;
    script.dataset.cashfreeSdk = "true";
    script.onload = () => resolve(window.Cashfree);
    script.onerror = () => reject(new Error("Failed to load Cashfree checkout SDK."));
    document.head.appendChild(script);
  });

  return cashfreeScriptPromise;
};

export const openCashfreeCheckout = async ({ paymentSessionId, environment }) => {
  const factory = await loadCashfreeSdk();
  if (typeof factory !== "function") {
    throw new Error("Cashfree checkout is unavailable right now.");
  }

  const cashfree = factory({
    mode: environment === "production" ? "production" : "sandbox",
  });

  return cashfree.checkout({
    paymentSessionId,
    redirectTarget: "_self",
  });
};
