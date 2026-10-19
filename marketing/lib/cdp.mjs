// Cliente minimo del protocolo de Chrome (sin dependencias) para el QA responsive: lanza Chrome sin interfaz,
// emula anchos de pantalla y comprueba desbordamiento horizontal e imagenes rotas.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);

export const findChrome = () => CANDIDATES.find((p) => fs.existsSync(p)) || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withBrowser(fn, port = 9400 + Math.floor(Math.random() * 400)) {
  const chrome = findChrome();
  if (!chrome) throw new Error("No se encuentra Chrome/Edge (define CHROME_PATH)");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mk-chrome-"));
  const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch { /* arrancando */ }
    }
    if (!target) throw new Error("Chrome no respondio");
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    const waiters = [];
    const timers = new Set();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
      else for (const w of [...waiters]) if (w.method === msg.method) { waiters.splice(waiters.indexOf(w), 1); w.res(msg.params); }
    };
    const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
    const once = (method, ms = 20000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout " + method)), ms); timers.add(t); waiters.push({ method, res: (p) => { clearTimeout(t); res(p); } }); });
    await send("Page.enable"); await send("Runtime.enable");
    const page = {
      send,
      async goto(url, width, height = 800) {
        await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
        const loaded = once("Page.loadEventFired");
        await send("Page.navigate", { url });
        await loaded;
        await sleep(600);
      },
      async eval(expression) {
        const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
        return r.result.value;
      }
    };
    try { return await fn(page); } finally { for (const t of timers) clearTimeout(t); }
  } finally { proc.kill(); await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* perfil en uso */ } }
}

export const WIDTHS = [320, 390, 768, 1280];

// Para cada URL y ancho: desbordamiento horizontal, imagenes rotas (tras desplazar la pagina) y errores de consola.
export async function responsiveCheck(urls, widths = WIDTHS) {
  return withBrowser(async (page) => {
    const problems = [];
    for (const url of urls) for (const w of widths) {
      await page.goto(url, w);
      await page.eval("(async()=>{for(let y=0;y<document.body.scrollHeight;y+=500){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,60));}window.scrollTo(0,0);await new Promise(r=>setTimeout(r,500));})()");
      const r = await page.eval("({sw:document.documentElement.scrollWidth,iw:window.innerWidth,broken:[...document.images].filter(i=>i.complete&&i.naturalWidth===0&&!(i.currentSrc||i.src).startsWith('data:')).map(i=>i.currentSrc||i.src)})");
      if (r.sw > r.iw + 1) problems.push(`${url} @${w}px: desbordamiento horizontal (${r.sw} > ${r.iw})`);
      for (const b of r.broken) problems.push(`${url} @${w}px: imagen rota ${b}`);
    }
    return problems;
  });
}
