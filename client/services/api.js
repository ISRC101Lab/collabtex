import { safeStorage as localStorage } from "../utils/storage.js";

export async function api(path, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs || 12000);
  const controller = new AbortController();
  const signals = [];
  if (opts.signal) signals.push(opts.signal);
  const onAbort = () => controller.abort();
  for (const s of signals) {
    if (s && typeof s.addEventListener === "function") s.addEventListener("abort", onAbort);
  }
  const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  const headers = new Headers(
    opts.headers || (opts.body instanceof FormData ? {} : { "Content-Type": "application/json" })
  );
  const token = localStorage.getItem("ct_session_token") || "";
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  try {
    const url = typeof path === "string" ? path : String(path || "");
    const res = await fetch(path, {
      ...opts,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await res.json() : await res.text();
    if (!res.ok) {
      if (res.status === 401) localStorage.removeItem("ct_session_token");
      const err = new Error(data && data.error ? data.error : `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    if (url.includes("/api/me") && data && data.authenticated && data.token) {
      localStorage.setItem("ct_session_token", data.token);
    }
    return data;
  } catch (e) {
    if (e && e.name === "AbortError") {
      const err = new Error("Request timeout");
      err.status = 0;
      throw err;
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    for (const s of signals) {
      if (s && typeof s.removeEventListener === "function") s.removeEventListener("abort", onAbort);
    }
  }
}
