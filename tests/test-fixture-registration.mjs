import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { chromium } from "playwright";

const backend = new URL(process.env.VAULTWARDEN_BACKEND_URL);
const proxy = https.createServer(
  {
    key: fs.readFileSync(process.env.VAULTWARDEN_TLS_KEY),
    cert: fs.readFileSync(process.env.VAULTWARDEN_TLS_CERT),
  },
  (request, response) => {
    const upstream = http.request(
      {
        hostname: backend.hostname,
        port: backend.port,
        path: request.url,
        method: request.method,
        headers: { ...request.headers, host: `${backend.hostname}:${backend.port}` },
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    upstream.on("error", () => {
      response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  },
);

await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const address = proxy.address();
if (!address || typeof address === "string") {
  throw new Error("Could not start the disposable Vaultwarden TLS proxy");
}

if (process.env.VAULTWARDEN_PROXY_PORT_FILE) {
  fs.writeFileSync(process.env.VAULTWARDEN_PROXY_PORT_FILE, String(address.port));
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  const baseUrl = `https://localhost:${address.port}`;
  await page.goto(`${baseUrl}/#/register`, { waitUntil: "domcontentloaded" });
  await page.locator("input[type=email]").fill(process.env.VAULTWARDEN_TEST_EMAIL);
  await page.locator("input[type=text]").fill("OpenClaw Fixture");
  await page.getByRole("button", { name: /continue/i }).click();
  await page
    .locator('input[formcontrolname="newPassword"]')
    .fill(process.env.VAULTWARDEN_TEST_PASSWORD);
  await page
    .locator('input[formcontrolname="newPasswordConfirm"]')
    .fill(process.env.VAULTWARDEN_TEST_PASSWORD);
  const response = page.waitForResponse((candidate) =>
    candidate.url().includes("/accounts/register/finish"),
  );
  await page.getByRole("button", { name: /create account/i }).click();
  const registrationResponse = await response;
  if (!registrationResponse.ok()) {
    throw new Error(
      `Disposable Vaultwarden registration failed (${registrationResponse.status()})`,
    );
  }
} finally {
  await browser.close();
}

if (process.env.VAULTWARDEN_REGISTRATION_DONE_FILE) {
  fs.writeFileSync(process.env.VAULTWARDEN_REGISTRATION_DONE_FILE, "ok");
}

if (process.env.VAULTWARDEN_KEEP_PROXY === "1") {
  await new Promise((resolve) => {
    const close = () => proxy.close(resolve);
    process.once("SIGTERM", close);
    process.once("SIGINT", close);
  });
} else {
  await new Promise((resolve) => proxy.close(resolve));
}
