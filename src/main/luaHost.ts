// Hosts Path of Building's engine in-process: loads the LuaJIT that ships with the user's PoB
// (lua51.dll) through koffi, boots PoB headless and our driver (vendor/pob/exilehub.lua).
// No Electron here: used by the utilityProcess worker and by tests.
import fs from "node:fs";
import path from "node:path";

const LUA_GLOBALSINDEX = -10002; // LuaJIT / Lua 5.1

/** The user's Path of Building Community folder, or null. */
export function findPob(): { dir: string; version: string | null } | null {
  const dirs = [
    path.join(process.env.APPDATA ?? "", "Path of Building Community"),
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Path of Building Community"),
    "C:\\Program Files\\Path of Building Community",
    "C:\\Program Files (x86)\\Path of Building Community",
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(path.join(dir, "lua51.dll")) || !fs.existsSync(path.join(dir, "Launch.lua"))) continue;
    let version: string | null = null;
    try {
      // the registry's DisplayVersion lags behind PoB's self-updates: the manifest is the truth
      const m = /<Version[^>]*number="([\d.]+)"/.exec(fs.readFileSync(path.join(dir, "manifest.xml"), "utf8"));
      version = m?.[1] ?? null;
    } catch {
      /* no manifest */
    }
    return { dir, version };
  }
  return null;
}

const toLua = (p: string) => p.replace(/\\/g, "/");
const lit = (s: string) => JSON.stringify(s); // a JSON string literal is a valid Lua literal for paths

export interface PobLua {
  /** ehSuggest(request) -> JSON text */
  suggest(req: unknown): string;
}

export function createPobLua(pobDir: string, wrapperPath: string, driverPath: string): PobLua {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require("koffi") as typeof import("koffi");
  process.chdir(pobDir); // PoB loads Launch.lua, Modules/, Data/ relative to its folder
  const lib = koffi.load(path.join(pobDir, "lua51.dll"));
  const newstate = lib.func("void* luaL_newstate()");
  const openlibs = lib.func("void luaL_openlibs(void* L)");
  const loadstring = lib.func("int luaL_loadstring(void* L, const char* s)");
  const pcall = lib.func("int lua_pcall(void* L, int nargs, int nresults, int errfunc)");
  const tolstring = lib.func("const char* lua_tolstring(void* L, int idx, void* len)");
  const getfield = lib.func("void lua_getfield(void* L, int idx, const char* k)");
  const pushstring = lib.func("void lua_pushstring(void* L, const char* s)");
  const settop = lib.func("void lua_settop(void* L, int idx)");

  const L = newstate();
  openlibs(L);
  const dir = toLua(pobDir);
  const boot = `
    package.path = ${lit(`${dir}/?.lua;${dir}/lua/?.lua;${dir}/lua/?/init.lua;`)} .. package.path
    package.cpath = ${lit(`${dir}/?.dll;`)} .. package.cpath
    arg = {}
    io.read = function() return "" end -- the wrapper waits for a key on startup errors: never block
    dofile(${lit(toLua(wrapperPath))})
    if not build then error("Path of Building did not start (startup prompt)") end
    dofile(${lit(toLua(driverPath))})
  `;
  let rc = loadstring(L, boot);
  if (rc === 0) rc = pcall(L, 0, 0, 0);
  if (rc !== 0) {
    const err = (tolstring(L, -1, null) as string | null) ?? "unknown Lua error";
    settop(L, 0);
    throw new Error(err);
  }

  return {
    suggest(req: unknown): string {
      getfield(L, LUA_GLOBALSINDEX, "ehSuggest");
      pushstring(L, JSON.stringify(req));
      const code = pcall(L, 1, 1, 0);
      const out = (tolstring(L, -1, null) as string | null) ?? "";
      settop(L, 0);
      return code === 0 ? out : JSON.stringify({ ok: false, error: out || "Lua error" });
    },
  };
}
