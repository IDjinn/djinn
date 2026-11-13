const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const toolchain = require("./toolchain");

function readProject(dir) {
  const file = path.join(dir, "djinn.proj");
  if (!fs.existsSync(file)) {
    return undefined;
  }
  const text = fs.readFileSync(file, "utf8");
  const pick = (key) => {
    const match = new RegExp(`^\\s*${key}:\\s*"([^"]*)"`, "m").exec(text);
    return match ? match[1] : undefined;
  };
  return {
    dir,
    name: pick("project"),
    outputFile: pick("file"),
    outputDirectory: pick("directory"),
    libraryMode: /library-mode:\s*true/.test(text),
    usesStdLib: /libs:\s*\[[^\]]*'std'/.test(text),
  };
}

function sourcesOf(directory) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "build" || entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".djinn")) {
        found.push(full);
      }
    }
  };
  walk(directory);
  return found.sort();
}

function describe(target, options) {
  const settings = toolchain.settings();
  const isDirectory = fs.statSync(target).isDirectory();
  const project = isDirectory ? readProject(target) : undefined;
  const root = isDirectory ? target : path.dirname(target);
  const name = project && project.name ? project.name : path.basename(target, ".djinn");
  const outputDirectory = project && project.outputDirectory ? path.resolve(root, project.outputDirectory) : path.join(root, "build");
  const outputFile = project && project.outputFile ? project.outputFile : name;
  const program = path.join(outputDirectory, toolchain.exe(outputFile));
  return { settings, isDirectory, project, root, name, outputDirectory, program };
}

function arguments_(target, options) {
  const info = options.info;
  const plan = describe(target, options);
  const compiler = toolchain.compiler(info);
  if (!compiler) {
    throw new Error("djinnc was not found. Set djinn.compilerPath.");
  }
  const args = [];
  const std = toolchain.stdDir(info);
  const runtime = toolchain.runtimeDir(info);
  const runtimeLib = toolchain.runtimeLib();
  const debugLibDir = path.join(toolchain.libDir() || "", "debug");
  const libDir = options.debug && fs.existsSync(path.join(debugLibDir, "std.djlib")) ? debugLibDir : toolchain.libDir();

  if (plan.isDirectory) {
    args.push(target, "-o", plan.program);
    if (libDir && fs.existsSync(path.join(libDir, "std.djlib"))) {
      args.push("--lib-dir", libDir);
    } else if (std) {
      args.push("--std", "--std-dir", std);
    }
  } else {
    args.push(target, "-o", plan.program);
    if (std) {
      args.push("--std", "--std-dir", std);
    }
  }
  if (runtime) {
    args.push("--runtime-dir", runtime);
  }
  if (runtimeLib) {
    args.push("--runtime-lib", runtimeLib);
  }
  if (process.platform === "win32") {
    args.push("--lld");
  }
  if (options.mode === "check") {
    args.push("--check");
  } else if (options.mode === "run") {
    args.push("--run");
  }
  if (options.mode !== "check") {
    if (plan.settings.get("build.debugInfo") || options.debug) {
      args.push("-g");
    }
    const level = options.debug ? plan.settings.get("debug.optimization") || "O0" : plan.settings.get("build.optimization") || "O2";
    args.push(`-${level}`);
  }
  return { compiler, args, plan };
}

function quote(value) {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function commandLine(target, options) {
  const { compiler, args } = arguments_(target, options);
  return [quote(compiler), ...args.map(quote)].join(" ");
}

function ensureOutputDirectory(target, options) {
  const { plan } = arguments_(target, options);
  fs.mkdirSync(plan.outputDirectory, { recursive: true });
  return plan;
}

function run(target, options, onOutput) {
  const plan = ensureOutputDirectory(target, options);
  const { compiler, args } = arguments_(target, options);
  return new Promise((resolve, reject) => {
    const child = cp.spawn(compiler, args, { env: toolchain.environment(), cwd: plan.root });
    let text = "";
    const collect = (chunk) => {
      const value = chunk.toString();
      text += value;
      if (onOutput) {
        onOutput(value);
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve({ plan, text }) : reject(new Error(text.split("\n").filter((line) => line.includes("error")).slice(0, 5).join("\n") || `djinnc exited with ${code}`))));
  });
}

module.exports = { readProject, sourcesOf, describe, commandLine, ensureOutputDirectory, run, quote };
