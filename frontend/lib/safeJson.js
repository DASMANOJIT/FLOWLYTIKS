export async function safeReadJson(res) {
  try {
    const ct = String(res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
      return await res.json().catch(() => ({}));
    }
    const text = await res.text().catch(() => "");
    const normalized = /<!doctype html|<html|^internal server error$/i.test(String(text || "").trim())
      ? "Request failed. Please try again."
      : text;
    return { success: res.ok, message: normalized, error: normalized };
  } catch {
    return {};
  }
}
