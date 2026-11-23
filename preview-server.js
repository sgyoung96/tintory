const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const htmlPath = path.join(__dirname, "tintory.html");
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
  console.log("Tintory preview: http://127.0.0.1:4173");
});
