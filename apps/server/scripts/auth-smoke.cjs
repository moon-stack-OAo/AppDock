/**
 * M0 Auth 冒烟：login → me → session-check(403) → change-password → session-check(200) → refresh → logout
 * 用法（在 apps/server）: node scripts/run-with-env.cjs -- node scripts/auth-smoke.cjs
 */
const http = require("http");
const { URL } = require("url");

const base = process.env.APPDOCK_SMOKE_BASE || "http://127.0.0.1:3080/api/v1";
const username = process.env.APPDOCK_ADMIN_USERNAME || "admin";
const password =
  process.env.APPDOCK_ADMIN_PASSWORD || "change-me-on-first-boot";
const newPassword = "NewPass123!";

let cookieJar = "";

function request(method, path, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + path);
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      Accept: "application/json",
    };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    if (token) headers.Authorization = `Bearer ${token}`;
    if (cookieJar) headers.Cookie = cookieJar;

    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers,
      },
      (res) => {
        const setCookie = res.headers["set-cookie"];
        if (setCookie) {
          for (const c of setCookie) {
            const part = c.split(";")[0];
            const name = part.split("=")[0];
            // 替换同名 cookie
            const map = Object.fromEntries(
              cookieJar
                .split("; ")
                .filter(Boolean)
                .map((x) => x.split("=")),
            );
            const [n, ...rest] = part.split("=");
            map[n] = rest.join("=");
            // clearCookie 可能设为空
            if (map[name] === "" || /Max-Age=0/i.test(c)) {
              delete map[name];
            }
            cookieJar = Object.entries(map)
              .map(([k, v]) => `${k}=${v}`)
              .join("; ");
          }
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch {
            json = data;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  console.log("base=", base);

  const login = await request("POST", "/auth/login", {
    body: { login: username, password },
  });
  console.log("1 login", login.status, JSON.stringify(login.body));
  assert(login.status === 200, "login should 200");
  assert(login.body.accessToken, "accessToken missing");
  assert(login.body.user.mustChangePassword === true, "mustChangePassword");
  assert(cookieJar.includes("refresh_token"), "refresh cookie missing");
  const token = login.body.accessToken;

  const me = await request("GET", "/auth/me", { token });
  console.log("2 me", me.status, JSON.stringify(me.body));
  assert(me.status === 200, "me should 200");

  const sc1 = await request("GET", "/auth/session-check", { token });
  console.log("3 session-check", sc1.status, JSON.stringify(sc1.body));
  assert(sc1.status === 403, "session-check should 403");
  assert(
    sc1.body?.error?.code === "PASSWORD_CHANGE_REQUIRED" ||
      sc1.body?.message?.includes?.("PASSWORD") ||
      JSON.stringify(sc1.body).includes("PASSWORD_CHANGE_REQUIRED"),
    "PASSWORD_CHANGE_REQUIRED",
  );

  const cp = await request("POST", "/auth/change-password", {
    token,
    body: { currentPassword: password, newPassword },
  });
  console.log("4 change-password", cp.status, JSON.stringify(cp.body));
  assert(cp.status === 200, "change-password should 200");
  assert(cp.body.ok === true, "ok");

  const sc2 = await request("GET", "/auth/session-check", { token });
  console.log("5 session-check after", sc2.status, JSON.stringify(sc2.body));
  assert(sc2.status === 200, "session-check should 200 after change");

  const me2 = await request("GET", "/auth/me", { token });
  console.log("6 me after", me2.status, JSON.stringify(me2.body));
  assert(me2.body.mustChangePassword === false, "mustChange cleared");

  const refresh = await request("POST", "/auth/refresh");
  console.log("7 refresh", refresh.status, JSON.stringify(refresh.body));
  assert(refresh.status === 200, "refresh should 200");
  assert(refresh.body.accessToken, "new access");

  const logout = await request("POST", "/auth/logout");
  console.log("8 logout", logout.status, JSON.stringify(logout.body), "cookie=", cookieJar);
  assert(logout.status === 200, "logout 200");

  const refresh2 = await request("POST", "/auth/refresh");
  console.log("9 refresh after logout", refresh2.status, JSON.stringify(refresh2.body));
  assert(refresh2.status === 401, "refresh after logout 401");

  const login2 = await request("POST", "/auth/login", {
    body: { login: username, password: newPassword },
  });
  console.log("10 re-login", login2.status, login2.body?.user?.mustChangePassword);
  assert(login2.status === 200, "re-login 200");
  assert(login2.body.user.mustChangePassword === false, "still false");

  // email login
  const loginEmail = await request("POST", "/auth/login", {
    body: { login: login2.body.user.email, password: newPassword },
  });
  console.log("11 email login", loginEmail.status);
  assert(loginEmail.status === 200, "email login 200");

  console.log("\nALL PASSED");
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
