// The Render deploy, checked the way Render will actually run it.
//
// Every other suite runs from a full checkout, where every file is always
// present - so none of them noticed that render.yaml's `rootDir: server` meant
// the deployed instance held nothing BUT server/. Render leaves everything
// outside a service's rootDir out of both the build and the running instance,
// and the server hosts the game's files from the folder above its own, so the
// live site answered every request - the page, the scripts, every sprite -
// with a 404.
//
// So this reads render.yaml, works out which folder Render would deploy, and
// checks that everything the page needs lives inside it. Then it boots the
// server with the configured start command and fetches each of those files.
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");

let failures = 0;
function check(label, ok, extra) { if (!ok) failures++; console.log(label.padEnd(50), ok ? "PASS" : "FAIL " + (extra || "")); }

// Just enough YAML for render.yaml's flat `key: value` service fields.
function renderField(yaml, key) {
  const match = new RegExp("^\\s*" + key + ":\\s*(.+?)\\s*$", "m").exec(yaml);
  return match ? match[1].replace(/^["']|["']$/g, "") : null;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function freePort() {
  return new Promise(function (resolve, reject) {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", function () {
      const port = probe.address().port;
      probe.close(function () { resolve(port); });
    });
  });
}

function fetchStatus(port, urlPath) {
  return new Promise(function (resolve) {
    http.get({ host: "127.0.0.1", port: port, path: urlPath }, function (res) {
      res.resume();
      resolve(res.statusCode);
    }).on("error", function () { resolve(0); });
  });
}

async function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fetchStatus(port, "/") !== 0) {
      return true;
    }
    await new Promise(function (r) { setTimeout(r, 100); });
  }
  return false;
}

(async function main() {
  const yaml = fs.readFileSync(path.join(ROOT, "render.yaml"), "utf8");
  const rootDir = renderField(yaml, "rootDir");
  const buildCommand = renderField(yaml, "buildCommand") || "";
  const startCommand = renderField(yaml, "startCommand") || "";
  const deployRoot = path.resolve(ROOT, rootDir || ".");
  console.log("render deploys: " + (path.relative(ROOT, deployRoot) || "(repo root)"));

  // server.js serves the folder above its own - see CLIENT_ROOT there.
  const clientRoot = path.resolve(ROOT, "server", "..");
  check("the game's files are inside the deployed folder", isInside(deployRoot, clientRoot),
    "rootDir " + rootDir + " leaves them out");

  // Everything index.html loads from this origin, rather than from a CDN.
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const assets = [];
  html.replace(/\b(?:src|href)="([^"]+)"/g, function (_, ref) {
    if (!/^(?:[a-z]+:)?\/\//i.test(ref) && !ref.startsWith("#")) {
      assets.push(ref.replace(/^\.\//, ""));
    }
  });
  //the link-preview image, whose address the server fills in as it sends
  html.replace(/content="%ORIGIN%\/([^"]+)"/g, function (_, file) { assets.push(file); });
  //the sprites are loaded from sketch.js rather than from the page
  const sketch = fs.readFileSync(path.join(ROOT, "sketch.js"), "utf8");
  sketch.replace(/load(?:Image|Animation)\(([^)]*)\)/g, function (_, args) {
    args.replace(/"([^"]+\.png)"/g, function (__, file) { assets.push(file); });
  });
  const uniqueAssets = Array.from(new Set(assets));
  const missing = uniqueAssets.filter(function (file) {
    const full = path.join(clientRoot, file);
    return !isInside(deployRoot, full) || !fs.existsSync(full);
  });
  check("every file the page loads ships with the deploy", missing.length === 0, missing.join(", "));

  // ws is the relay's one dependency and lives in server/package.json, so it
  // has to be installed where server.js will look for it.
  const installsServerDeps = rootDir === "server"
    ? /\bnpm (?:ci|install)\b/.test(buildCommand)
    : /\bnpm (?:ci|install)\b.*--prefix server\b|\bcd server\b.*\bnpm (?:ci|install)\b/.test(buildCommand);
  check("the build installs the relay's dependencies", installsServerDeps, buildCommand);

  // Resolve the start command to the node invocation it runs.
  let nodeArgs = null;
  if (/^npm (?:run )?start$/.test(startCommand)) {
    const pkg = JSON.parse(fs.readFileSync(path.join(deployRoot, "package.json"), "utf8"));
    const script = (pkg.scripts && pkg.scripts.start) || "";
    const match = /^node\s+(\S+)$/.exec(script);
    nodeArgs = match ? [match[1]] : null;
  } else {
    const match = /^node\s+(\S+)$/.exec(startCommand);
    nodeArgs = match ? [match[1]] : null;
  }
  check("the start command runs the relay", nodeArgs !== null &&
    fs.existsSync(path.join(deployRoot, nodeArgs[0])), startCommand);
  if (nodeArgs === null) {
    console.log("");
    console.log(failures + " FAILED");
    process.exit(1);
  }

  // Boot it exactly as configured, from the folder Render would run it in.
  const port = await freePort();
  const server = spawn(process.execPath, nodeArgs, {
    cwd: deployRoot,
    env: Object.assign({}, process.env, { PORT: String(port) }),
    stdio: "ignore",
  });
  try {
    check("the server comes up from the deployed folder", await waitForServer(port, 8000));
    check("the page itself is served", await fetchStatus(port, "/") === 200);
    const failed = [];
    for (const file of uniqueAssets) {
      const status = await fetchStatus(port, "/" + file);
      if (status !== 200) {
        failed.push(file + " " + status);
      }
    }
    check("every asset is served (" + uniqueAssets.length + " files)", failed.length === 0, failed.join(", "));
  } finally {
    server.kill();
  }

  console.log("");
  console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
  process.exit(failures === 0 ? 0 : 1);
})().catch(function (e) { console.log("ERROR: " + e.message); process.exit(1); });
