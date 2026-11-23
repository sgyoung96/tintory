// Tintory for Scriptable. Keep this file free of API keys and personal records.
const HOLIDAY_API = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";
const KEY_NAME = "tintory.holidayApiKey";
const DATA_FILE = "tintory-data.json";
const DEFAULT_THEMES = [
  { id: "daily", name: "일상", color: "#e88dab" },
  { id: "work", name: "업무", color: "#7d9bd5" },
  { id: "health", name: "건강", color: "#7eb99b" },
];

function emptyData() {
  return { version: 1, themes: DEFAULT_THEMES.map(x => ({ ...x })), entries: [], holidays: {}, holidaySync: {} };
}

function pad(n) { return String(n).padStart(2, "0"); }
function monthKey(year, month) { return `${year}-${pad(month)}`; }
function dateKey(year, month, day) { return `${monthKey(year, month)}-${pad(day)}`; }

function parseHolidayXml(xml) {
  const tag = (body, name) => {
    const match = body.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"));
    return match ? match[1].trim() : "";
  };
  const decode = value => value.replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, code) =>
      String.fromCodePoint(code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code)));
  const code = tag(xml, "resultCode");
  if (code && code !== "00") throw new Error(`공휴일 API 오류: ${code} ${tag(xml, "resultMsg")}`);
  if (!/<response[\s>]/i.test(xml)) throw new Error("공휴일 API 응답 형식을 확인할 수 없습니다.");
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match => ({
    date: tag(match[1], "locdate"),
    name: decode(tag(match[1], "dateName")),
    isHoliday: tag(match[1], "isHoliday") === "Y",
  })).filter(item => /^\d{8}$/.test(item.date) && item.name && item.isHoliday);
  return { items, totalCount: Number(tag(xml, "totalCount") || 0) };
}

function normalizeKey(raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("API 키가 비어 있습니다.");
  try { return encodeURIComponent(decodeURIComponent(trimmed)); }
  catch (_) { return encodeURIComponent(trimmed); }
}

function applyHolidays(data, year, month, items, syncedAt) {
  const key = monthKey(year, month);
  const prefix = `${year}${pad(month)}`;
  const holidays = {};
  for (const item of items) {
    if (!item.date.startsWith(prefix)) continue;
    const day = `${key}-${item.date.slice(6)}`;
    if (!holidays[day]) holidays[day] = [];
    if (!holidays[day].includes(item.name)) holidays[day].push(item.name);
  }
  data.holidays[key] = holidays;
  data.holidaySync[key] = syncedAt;
  return data;
}

async function fetchHolidays(year, month, encodedKey, makeRequest) {
  const result = [];
  let page = 1;
  while (true) {
    const url = `${HOLIDAY_API}?ServiceKey=${encodedKey}&solYear=${year}&solMonth=${pad(month)}&numOfRows=100&pageNo=${page}`;
    const request = makeRequest(url);
    request.timeoutInterval = 20;
    const xml = await request.loadString();
    if (request.response && request.response.statusCode !== 200) {
      throw new Error(`공휴일 API HTTP ${request.response.statusCode}`);
    }
    const parsed = parseHolidayXml(xml);
    result.push(...parsed.items);
    if (page * 100 >= parsed.totalCount || parsed.totalCount === 0) break;
    page++;
  }
  return result;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { emptyData, parseHolidayXml, normalizeKey, applyHolidays, fetchHolidays, monthKey, dateKey };
}

if (typeof FileManager !== "undefined") {
  await runTintory();
}

async function runTintory() {
  const fm = FileManager.local();
  const folder = fm.joinPath(fm.documentsDirectory(), "Tintory");
  if (!fm.fileExists(folder)) fm.createDirectory(folder, true);
  const file = fm.joinPath(folder, DATA_FILE);
  let data = fm.fileExists(file) ? JSON.parse(fm.readString(file)) : emptyData();
  data.themes = data.themes || DEFAULT_THEMES.map(x => ({ ...x }));
  data.entries = data.entries || [];
  data.holidays = data.holidays || {};
  data.holidaySync = data.holidaySync || {};
  const save = () => fm.writeString(file, JSON.stringify(data, null, 2));
  if (!fm.fileExists(file)) save();

  const today = new Date();
  const state = { year: today.getFullYear(), month: today.getMonth() + 1, date: null, filter: "all", screen: "month" };
  const table = new UITable();
  table.showSeparators = false;

  async function message(title, body) {
    const alert = new Alert();
    alert.title = title;
    alert.message = body;
    alert.addAction("확인");
    await alert.presentAlert();
  }

  async function askKey() {
    const alert = new Alert();
    alert.title = "공휴일 API 키";
    alert.message = "공공데이터포털 한국천문연구원 특일 정보 서비스키를 입력하세요. 키는 아이폰 Keychain에만 저장됩니다.";
    alert.addSecureTextField("서비스키", "");
    alert.addAction("저장");
    alert.addCancelAction("취소");
    if (await alert.presentAlert() < 0) return false;
    const key = alert.textFieldValue(0).trim();
    if (!key) return false;
    Keychain.set(KEY_NAME, key);
    return true;
  }

  async function syncHolidays(force) {
    const key = monthKey(state.year, state.month);
    const last = data.holidaySync[key] ? Date.parse(data.holidaySync[key]) : 0;
    if (!force && Date.now() - last < 24 * 60 * 60 * 1000) return;
    if (!Keychain.contains(KEY_NAME)) {
      if (!force) return;
      if (!await askKey()) return;
    }
    try {
      const items = await fetchHolidays(state.year, state.month, normalizeKey(Keychain.get(KEY_NAME)), url => new Request(url));
      applyHolidays(data, state.year, state.month, items, new Date().toISOString());
      save();
      if (force) await message("동기화 완료", `${state.year}년 ${state.month}월 공휴일 ${items.length}건을 확인했습니다.`);
    } catch (error) {
      if (force) await message("동기화 실패", `${error.message}\n저장된 공휴일은 유지됩니다.`);
    }
  }

  function actionRow(label, action, subtitle = "") {
    const row = new UITableRow();
    row.height = 48;
    row.dismissOnSelect = false;
    row.addText(label, subtitle);
    row.onSelect = async () => { await action(); render(); };
    table.addRow(row);
    return row;
  }

  function header(label) {
    const row = new UITableRow();
    row.isHeader = true;
    row.addText(label);
    table.addRow(row);
  }

  function render() {
    table.removeAllRows();
    if (state.screen === "date") renderDate();
    else renderMonth();
    table.reload();
  }

  function renderMonth() {
    header(`틴토리 · ${state.year}년 ${state.month}월`);
    const controls = new UITableRow();
    for (const [label, delta] of [["‹ 이전", -1], ["오늘", 0], ["다음 ›", 1]]) {
      const cell = controls.addButton(label);
      cell.onTap = async () => {
        if (delta === 0) { state.year = today.getFullYear(); state.month = today.getMonth() + 1; }
        else {
          const next = new Date(state.year, state.month - 1 + delta, 1);
          state.year = next.getFullYear(); state.month = next.getMonth() + 1;
        }
        await syncHolidays(false); render();
      };
    }
    table.addRow(controls);
    const filters = new UITableRow();
    for (const theme of [{ id: "all", name: "전체" }, ...data.themes]) {
      const cell = filters.addButton(state.filter === theme.id ? `● ${theme.name}` : theme.name);
      if (theme.color) cell.titleColor = new Color(theme.color);
      cell.onTap = () => { state.filter = theme.id; render(); };
    }
    table.addRow(filters);
    const weekdays = new UITableRow();
    weekdays.isHeader = true;
    for (const day of ["일", "월", "화", "수", "목", "금", "토"]) weekdays.addText(day).centerAligned();
    table.addRow(weekdays);

    const firstWeekday = new Date(state.year, state.month - 1, 1).getDay();
    const days = new Date(state.year, state.month, 0).getDate();
    for (let week = 0; week < Math.ceil((firstWeekday + days) / 7); week++) {
      const row = new UITableRow();
      row.height = 60;
      for (let column = 0; column < 7; column++) {
        const day = week * 7 + column - firstWeekday + 1;
        if (day < 1 || day > days) { row.addText(" "); continue; }
        const date = dateKey(state.year, state.month, day);
        const entries = data.entries.filter(e => e.date === date && (state.filter === "all" || e.themeId === state.filter));
        const holidays = (data.holidays[monthKey(state.year, state.month)] || {})[date] || [];
        const marker = `${holidays.length ? "🔴" : ""}${entries.length ? "•" : ""}`;
        const cell = row.addButton(`${day}${marker}`);
        if (holidays.length) cell.titleColor = Color.red();
        else if (entries.length) {
          const theme = data.themes.find(t => t.id === entries[0].themeId);
          if (theme) cell.titleColor = new Color(theme.color);
        }
        cell.onTap = () => { state.date = date; state.screen = "date"; render(); };
      }
      table.addRow(row);
    }
    actionRow("공휴일 동기화", () => syncHolidays(true), "현재 월의 대한민국 공휴일을 새로 가져옵니다.");
    actionRow("공휴일 API 키 변경", async () => {
      if (await askKey()) await syncHolidays(true);
    });
    actionRow("테마 관리", manageThemes);
    const key = monthKey(state.year, state.month);
    if (data.holidaySync[key]) actionRow(`마지막 동기화: ${data.holidaySync[key].slice(0, 10)}`, async () => {});
    else actionRow("공휴일 데이터 없음", async () => {}, "API 키를 등록하고 동기화해 주세요.");
  }

  function renderDate() {
    const date = state.date;
    header(`틴토리 · ${date}`);
    actionRow("‹ 달력으로", async () => { state.screen = "month"; });
    const holidays = (data.holidays[date.slice(0, 7)] || {})[date] || [];
    for (const name of holidays) actionRow(`🔴 ${name}`, async () => {}, "공휴일");
    const entries = data.entries.filter(e => e.date === date && (state.filter === "all" || e.themeId === state.filter));
    for (const entry of entries) {
      const theme = data.themes.find(x => x.id === entry.themeId);
      const row = actionRow(`${entry.kind === "diary" ? "✎" : "◷"} ${entry.title}`, () => editEntry(entry), `${theme ? theme.name : ""} · ${entry.kind === "diary" ? "일기" : "일정"}`);
      if (theme) row.backgroundColor = new Color(theme.color, 0.18);
    }
    actionRow("+ 일정 추가", () => addEntry("event"));
    actionRow("+ 일기 쓰기", () => addEntry("diary"));
  }

  async function selectTheme() {
    const alert = new Alert();
    alert.title = "테마 선택";
    data.themes.forEach(t => alert.addAction(t.name));
    alert.addCancelAction("취소");
    const index = await alert.presentSheet();
    return index >= 0 ? data.themes[index] : null;
  }

  async function addEntry(kind) {
    const theme = await selectTheme();
    if (!theme) return;
    const alert = new Alert();
    alert.title = kind === "diary" ? "일기 쓰기" : "일정 추가";
    alert.addTextField("제목", "");
    alert.addTextField(kind === "diary" ? "내용" : "시간 또는 메모", "");
    alert.addAction("저장");
    alert.addCancelAction("취소");
    if (await alert.presentAlert() < 0) return;
    const title = alert.textFieldValue(0).trim();
    if (!title) { await message("저장 실패", "제목을 입력해 주세요."); return; }
    data.entries.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, date: state.date,
      kind, themeId: theme.id, title, body: alert.textFieldValue(1).trim() });
    save();
  }

  async function editEntry(entry) {
    const alert = new Alert();
    alert.title = entry.kind === "diary" ? "일기" : "일정";
    alert.addTextField("제목", entry.title);
    alert.addTextField("내용", entry.body || "");
    alert.addAction("수정 저장");
    alert.addDestructiveAction("삭제");
    alert.addCancelAction("취소");
    const result = await alert.presentAlert();
    if (result === 0) {
      const title = alert.textFieldValue(0).trim();
      if (!title) { await message("저장 실패", "제목을 입력해 주세요."); return; }
      entry.title = title; entry.body = alert.textFieldValue(1).trim(); save();
    } else if (result === 1) {
      const confirm = new Alert();
      confirm.title = "기록 삭제";
      confirm.message = `“${entry.title}”을 삭제할까요?`;
      confirm.addDestructiveAction("삭제"); confirm.addCancelAction("취소");
      if (await confirm.presentAlert() === 0) {
        data.entries = data.entries.filter(e => e.id !== entry.id); save();
      }
    }
  }

  async function manageThemes() {
    const alert = new Alert();
    alert.title = "테마 관리";
    data.themes.forEach(t => alert.addAction(t.name));
    alert.addAction("+ 새 테마"); alert.addCancelAction("취소");
    const choice = await alert.presentSheet();
    if (choice < 0) return;
    const previous = data.themes[choice];
    const form = new Alert();
    form.title = previous ? "테마 수정" : "새 테마";
    form.addTextField("이름", previous ? previous.name : "");
    form.addTextField("색상 (#RRGGBB)", previous ? previous.color : "#a98bd6");
    form.addAction("저장"); form.addCancelAction("취소");
    if (await form.presentAlert() < 0) return;
    const name = form.textFieldValue(0).trim();
    const color = form.textFieldValue(1).trim();
    if (!name || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      await message("저장 실패", "이름과 #RRGGBB 형식의 색상을 입력해 주세요."); return;
    }
    if (previous) { previous.name = name; previous.color = color; }
    else data.themes.push({ id: `${Date.now()}`, name, color });
    save();
  }

  await syncHolidays(false);
  render();
  await table.present(true);
  Script.complete();
}
