export async function api(path, opts = {}) {
  const headers = new Headers(
    opts.headers || (opts.body instanceof FormData ? {} : { "Content-Type": "application/json" })
  );
  const token = localStorage.getItem("ct_session_token") || "";
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(path, {
    ...opts,
    headers,
    credentials: "same-origin",
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
  return data;
}
