const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("./Tintory.js"), "utf8");
const sandbox = { module: { exports: {} } };
vm.runInNewContext(source.replace("await runTintory();", "runTintory();"), sandbox);
const { emptyData, parseHolidayXml, normalizeKey, applyHolidays, fetchHolidays } = sandbox.module.exports;

const xml = `<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE</resultMsg></header><body><items><item><dateName>설날</dateName><isHoliday>Y</isHoliday><locdate>20270101</locdate></item><item><dateName>기념일</dateName><isHoliday>N</isHoliday><locdate>20270102</locdate></item></items><numOfRows>100</numOfRows><totalCount>2</totalCount></body></response>`;

test("공휴일만 파싱하고 월별 캐시에 반영한다", () => {
  const parsed = parseHolidayXml(xml);
  assert.equal(JSON.stringify(parsed.items), JSON.stringify([{ date: "20270101", name: "설날", isHoliday: true }]));
  const data = emptyData();
  applyHolidays(data, 2027, 1, parsed.items, "2026-11-23T00:00:00Z");
  assert.equal(JSON.stringify(data.holidays["2027-01"]["2027-01-01"]), JSON.stringify(["설날"]));
  applyHolidays(data, 2027, 1, [], "2026-11-24T00:00:00Z");
  assert.equal(JSON.stringify(data.holidays["2027-01"]), "{}");
});

test("인코딩된 키를 이중 인코딩하지 않는다", () => {
  assert.equal(normalizeKey("abc%2Bdef%2Fghi%3D"), "abc%2Bdef%2Fghi%3D");
  assert.equal(normalizeKey("abc+def/ghi="), "abc%2Bdef%2Fghi%3D");
});

test("API 실패 응답은 동기화 성공으로 처리하지 않는다", () => {
  assert.throws(() => parseHolidayXml("<response><header><resultCode>30</resultCode><resultMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</resultMsg></header></response>"), /30/);
});

test("API 요청에서 해당 월과 인코딩된 키를 사용한다", async () => {
  let requestedUrl = "";
  const items = await fetchHolidays(2027, 1, "abc%2Bdef", url => {
    requestedUrl = url;
    return { response: { statusCode: 200 }, loadString: async () => xml };
  });
  assert.match(requestedUrl, /ServiceKey=abc%2Bdef/);
  assert.match(requestedUrl, /solYear=2027&solMonth=01/);
  assert.equal(items.length, 1);
});
