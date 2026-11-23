const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "tintory.html");
const address = "http://127.0.0.1:4173";
const server = http.createServer((request, response) => {
  if (request.url !== "/" && request.url !== "/tintory.html") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(htmlPath).pipe(response);
});

server.listen(4173, "127.0.0.1", () => {
  console.log(`Tintory preview: ${address}`);
});

server.on("error", async error => {
  if (error.code !== "EADDRINUSE") throw error;
  try {
    const response = await fetch(address);
    if (response.ok && (await response.text()).includes('data-tintory-ui="1"')) {
      console.log(`틴토리 미리보기가 이미 실행 중입니다: ${address}`);
      return;
    }
  } catch (_) {}
  console.error(`4173 포트를 다른 프로그램이 사용 중입니다. ${address}을 확인해 주세요.`);
  process.exitCode = 1;
});
