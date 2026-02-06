export function registerAuthSystemRoutes(deps) {
  const {
    app,
    dataDir,
    session,
    jsonError,
    loadUsers,
    authenticate,
    signSession,
    setSessionCookie,
    clearSessionCookie,
    getSessionFromReq,
    getTokenFromReq,
    setUsersDb,
  } = deps;

  app.post("/api/login", async (req, res) => {
    const body = req.body || {};
    const username = body.username;
    const password = body.password;
    if (!username || !password) return jsonError(res, 400, "missing username/password");

    const latestUsers = await loadUsers(dataDir);
    setUsersDb(latestUsers);
    const user = await authenticate(latestUsers, username, password);
    if (!user) return jsonError(res, 401, "bad credentials");

    const token = signSession(session.secret, {
      username: user.username,
      isAdmin: !!user.isAdmin,
      exp: Date.now() + 7 * 24 * 3600 * 1000,
    });

    setSessionCookie(res, session.cookieName, token);
    res.json({ ok: true, username: user.username, isAdmin: !!user.isAdmin, token });
  });

  app.post("/api/logout", async (_req, res) => {
    clearSessionCookie(res, session.cookieName);
    res.json({ ok: true });
  });

  app.get("/api/me", async (req, res) => {
    const sess = getSessionFromReq(req, session);
    if (!sess || !sess.username) return res.json({ authenticated: false });
    const token = getTokenFromReq(req, session);
    res.json({ authenticated: true, username: sess.username, isAdmin: !!sess.isAdmin, token });
  });

  app.get("/api/ping", (req, res) => {
    res.json({
      ok: true,
      time: new Date().toISOString(),
      host: req.headers.host || "",
      forwardedHost: req.headers["x-forwarded-host"] || "",
      forwardedProto: req.headers["x-forwarded-proto"] || "",
      remote: req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "",
    });
  });
}
