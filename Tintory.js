// Tintory WebView launcher. Paste this file into a Scriptable script named Tintory.
async function main() {
const UI_URL = "https://raw.githubusercontent.com/sgyoung96/tintory/main/tintory.html";
const API_URL = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";
const KEY_NAME = "tintory.holidayApiKey";
const DEFAULT_DATA = {
  version: 1,
  themes: [
    { id: "daily", name: "일상", color: "#e88dab" },
    { id: "work", name: "업무", color: "#7d9bd5" },
    { id: "health", name: "건강", color: "#7eb99b" }
  ],
  entries: [], holidays: {}, holidaySync: {}
};

const fm = FileManager.local();
const folder = fm.joinPath(fm.documentsDirectory(), "Tintory");
if (!fm.fileExists(folder)) fm.createDirectory(folder, true);
const dataPath = fm.joinPath(folder, "tintory-data.json");
const uiPath = fm.joinPath(folder, "tintory.html");
let data = fm.fileExists(dataPath) ? JSON.parse(fm.readString(dataPath)) : DEFAULT_DATA;
data.themes = data.themes || DEFAULT_DATA.themes;
data.entries = data.entries || [];
data.holidays = data.holidays || {};
data.holidaySync = data.holidaySync || {};
function save() { fm.writeString(dataPath, JSON.stringify(data, null, 2)); }
if (!fm.fileExists(dataPath)) save();

async function notice(title, text) {
  const box = new Alert();
  box.title = title; box.message = text; box.addAction("확인");
  await box.presentAlert();
}
async function askKey() {
  const box = new Alert();
  box.title = "공휴일 API 키";
  box.message = "공공데이터포털 특일 정보 서비스키를 입력하세요. 아이폰 Keychain에만 저장됩니다.";
  box.addSecureTextField("서비스키", "");
  box.addAction("저장"); box.addCancelAction("취소");
  if (await box.presentAlert() < 0) return false;
  const key = box.textFieldValue(0).trim();
  if (!key) return false;
  Keychain.set(KEY_NAME, key);
  return true;
}
function encodedKey(raw) {
  try { return encodeURIComponent(decodeURIComponent(raw.trim())); }
  catch (_) { return encodeURIComponent(raw.trim()); }
}
function xmlTag(xml, tag) {
  const match = xml.match(new RegExp("<" + tag + ">([\\s\\S]*?)</" + tag + ">", "i"));
  return match ? match[1].trim() : "";
}
function decodeXml(value) {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
async function fetchHolidays(year, month) {
  const result = [];
  let page = 1;
  while (true) {
    const url = API_URL + "?ServiceKey=" + encodedKey(Keychain.get(KEY_NAME)) +
      "&solYear=" + year + "&solMonth=" + String(month).padStart(2, "0") +
      "&numOfRows=100&pageNo=" + page;
    const request = new Request(url);
    request.timeoutInterval = 20;
    const xml = await request.loadString();
    if (request.response && request.response.statusCode !== 200) throw new Error("공휴일 API HTTP " + request.response.statusCode);
    const code = xmlTag(xml, "resultCode");
    if (code && code !== "00") throw new Error("공휴일 API 오류: " + code + " " + xmlTag(xml, "resultMsg"));
    if (!/<response[\s>]/i.test(xml)) throw new Error("공휴일 API 응답 형식이 올바르지 않습니다.");
    const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi));
    for (const match of items) {
      const body = match[1];
      if (xmlTag(body, "isHoliday") === "Y") {
        result.push({ date: xmlTag(body, "locdate"), name: decodeXml(xmlTag(body, "dateName")) });
      }
    }
    const total = Number(xmlTag(xml, "totalCount") || 0);
    if (!total || page * 100 >= total) break;
    page++;
  }
  return result;
}
async function syncMonth(year, month, force) {
  if (!Number.isInteger(year) || year < 1900 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("날짜가 올바르지 않습니다.");
  }
  const key = year + "-" + String(month).padStart(2, "0");
  const last = data.holidaySync[key] ? Date.parse(data.holidaySync[key]) : 0;
  if (!force && Date.now() - last < 86400000) return { data: data, message: "" };
  if (!Keychain.contains(KEY_NAME)) {
    if (!force) return { data: data, message: "" };
    if (!await askKey()) return { data: data, message: "키 입력을 취소했습니다." };
  }
  const items = await fetchHolidays(year, month);
  const holidays = {};
  for (const item of items) {
    if (!/^\d{8}$/.test(item.date) || !item.date.startsWith(key.replace("-", "")) || !item.name) continue;
    const date = key + "-" + item.date.slice(6);
    if (!holidays[date]) holidays[date] = [];
    if (!holidays[date].includes(item.name)) holidays[date].push(item.name);
  }
  data.holidays[key] = holidays;
  data.holidaySync[key] = new Date().toISOString();
  save();
  return { data: data, message: "공휴일 " + items.length + "건을 확인했습니다." };
}
async function updateUi() {
  const request = new Request(UI_URL + "?v=" + Date.now());
  request.timeoutInterval = 10;
  const html = await request.loadString();
  if (request.response && request.response.statusCode !== 200) throw new Error("화면 다운로드 HTTP " + request.response.statusCode);
  if (!html.includes('data-tintory-ui="1"') || !html.includes("<!--TINTORY_BOOTSTRAP-->")) {
    throw new Error("화면 파일 형식이 올바르지 않습니다.");
  }
  fm.writeString(uiPath, html);
}

try { await updateUi(); }
catch (error) {
  if (!fm.fileExists(uiPath)) {
    await notice("첫 화면을 받을 수 없어요", "인터넷 연결을 확인하고 다시 실행해 주세요.\n" + error.message);
    Script.complete();
    return;
  }
}

const payload = JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
const bootstrap = "<script>window.__TINTORY_BOOTSTRAP__=" + payload + ";window.__TINTORY_NATIVE__=true;<" + "/script>";
const html = fm.readString(uiPath).replace("<!--TINTORY_BOOTSTRAP-->", bootstrap);
const view = new WebView();
await view.loadHTML(html);
let dismissed = false;
const closed = view.present(true).then(() => { dismissed = true; return { closed: true }; });
while (!dismissed) {
  let event;
  try {
    event = await Promise.race([view.evaluateJavaScript("window.TintoryBridge.wait(completion)", true), closed]);
  } catch (_) { break; }
  if (!event || event.closed || dismissed) break;
  let reply;
  try {
    if (event.action === "save") {
      const next = event.payload.data;
      if (!next || !Array.isArray(next.themes) || !Array.isArray(next.entries)) throw new Error("저장 데이터가 올바르지 않습니다.");
      data = { ...data, themes: next.themes, entries: next.entries };
      save();
      reply = { data: data };
    } else if (event.action === "sync") {
      reply = await syncMonth(event.payload.year, event.payload.month, !!event.payload.force);
    } else if (event.action === "setKey") {
      reply = { message: await askKey() ? "API 키를 저장했습니다." : "키 입력을 취소했습니다." };
    } else if (event.action === "update") {
      await updateUi();
      reply = { message: "새 화면을 저장했습니다. 틴토리를 다시 열면 적용됩니다." };
    } else {
      throw new Error("알 수 없는 요청입니다.");
    }
    reply.ok = true;
  } catch (error) {
    reply = { ok: false, message: error.message };
  }
  try {
    const encoded = JSON.stringify({ id: event.id, ...reply }).replace(/</g, "\\u003c");
    await view.evaluateJavaScript("window.TintoryBridge.resolve(" + encoded + ")", false);
  } catch (_) { break; }
}
await closed;
Script.complete();
}
await main();
