// The child process that hosts Path of Building's engine: loads the LuaJIT that ships with the
// user's PoB (lua51.dll), boots PoB headless (HeadlessWrapper.lua, MIT) and our driver
// (vendor/pob/exilehub.lua). Requests come on stdin, replies go to stdout, one JSON line each:
//   {"type":"init","pobDir","wrapperPath","driverPath"} -> EH:{"type":"ready"} | EH:{"type":"error","error"}
//   {"type":"suggest","req":{...}}                      -> EH:{"type":"result","json":"..."}
use crate::pob::REPLY_PREFIX;
use libloading::Library;
use serde_json::{json, Value};
use std::{
    ffi::{c_char, c_int, c_void, CStr, CString},
    io::{BufRead, Write},
    path::Path,
};

const LUA_GLOBALSINDEX: c_int = -10002; // LuaJIT / Lua 5.1
type LuaState = *mut c_void;

struct Lua {
    _lib: Library,
    l: LuaState,
    loadstring: unsafe extern "C" fn(LuaState, *const c_char) -> c_int,
    pcall: unsafe extern "C" fn(LuaState, c_int, c_int, c_int) -> c_int,
    tolstring: unsafe extern "C" fn(LuaState, c_int, *mut usize) -> *const c_char,
    getfield: unsafe extern "C" fn(LuaState, c_int, *const c_char),
    pushstring: unsafe extern "C" fn(LuaState, *const c_char),
    settop: unsafe extern "C" fn(LuaState, c_int),
}

fn lua_path(p: &str) -> String {
    p.replace('\\', "/")
}
/// a JSON string literal is a valid Lua string literal
fn lit(s: &str) -> String {
    serde_json::to_string(s).unwrap()
}

impl Lua {
    fn boot(pob_dir: &str, wrapper: &str, driver: &str) -> Result<Lua, String> {
        // PoB loads Launch.lua, Modules/, Data/ relative to its folder
        std::env::set_current_dir(pob_dir).map_err(|e| e.to_string())?;
        unsafe {
            let lib = Library::new(Path::new(pob_dir).join("lua51.dll")).map_err(|e| e.to_string())?;
            macro_rules! sym {
                ($name:literal) => {
                    *lib.get(concat!($name, "\0").as_bytes()).map_err(|e| e.to_string())?
                };
            }
            let newstate: unsafe extern "C" fn() -> LuaState = sym!("luaL_newstate");
            let openlibs: unsafe extern "C" fn(LuaState) = sym!("luaL_openlibs");
            let lua = Lua {
                l: newstate(),
                loadstring: sym!("luaL_loadstring"),
                pcall: sym!("lua_pcall"),
                tolstring: sym!("lua_tolstring"),
                getfield: sym!("lua_getfield"),
                pushstring: sym!("lua_pushstring"),
                settop: sym!("lua_settop"),
                _lib: lib,
            };
            if lua.l.is_null() {
                return Err("luaL_newstate failed".into());
            }
            openlibs(lua.l);
            let dir = lua_path(pob_dir);
            let boot = format!(
                r#"
                package.path = {} .. package.path
                package.cpath = {} .. package.cpath
                arg = {{}}
                print = function() end -- stdout is our reply channel
                io.read = function() return "" end -- the wrapper waits for a key on startup errors: never block
                dofile({})
                if not build then error("Path of Building did not start (startup prompt)") end
                dofile({})
                "#,
                lit(&format!("{dir}/?.lua;{dir}/lua/?.lua;{dir}/lua/?/init.lua;")),
                lit(&format!("{dir}/?.dll;")),
                lit(&lua_path(wrapper)),
                lit(&lua_path(driver)),
            );
            let code = CString::new(boot).map_err(|e| e.to_string())?;
            let mut rc = (lua.loadstring)(lua.l, code.as_ptr());
            if rc == 0 {
                rc = (lua.pcall)(lua.l, 0, 0, 0);
            }
            if rc != 0 {
                let err = lua.top_string().unwrap_or_else(|| "unknown Lua error".into());
                (lua.settop)(lua.l, 0);
                return Err(err);
            }
            Ok(lua)
        }
    }

    unsafe fn top_string(&self) -> Option<String> {
        let p = (self.tolstring)(self.l, -1, std::ptr::null_mut());
        (!p.is_null()).then(|| CStr::from_ptr(p).to_string_lossy().into_owned())
    }

    /// ehSuggest(request) -> JSON text
    fn suggest(&self, req: &str) -> String {
        unsafe {
            let name = CString::new("ehSuggest").unwrap();
            (self.getfield)(self.l, LUA_GLOBALSINDEX, name.as_ptr());
            let arg = CString::new(req).unwrap_or_default();
            (self.pushstring)(self.l, arg.as_ptr());
            let rc = (self.pcall)(self.l, 1, 1, 0);
            let out = self.top_string().unwrap_or_default();
            (self.settop)(self.l, 0);
            if rc == 0 {
                out
            } else {
                json!({ "ok": false, "error": if out.is_empty() { "Lua error".into() } else { out } }).to_string()
            }
        }
    }
}

pub fn run() {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    let mut lua: Option<Lua> = None;
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
        let s = |k: &str| msg[k].as_str().unwrap_or("").to_owned();
        let reply = match msg["type"].as_str() {
            Some("init") => match Lua::boot(&s("pobDir"), &s("wrapperPath"), &s("driverPath")) {
                Ok(l) => {
                    lua = Some(l);
                    json!({ "type": "ready" })
                }
                Err(e) => json!({ "type": "error", "error": e }),
            },
            Some("suggest") => match &lua {
                Some(l) => json!({ "type": "result", "json": l.suggest(&msg["req"].to_string()) }),
                None => json!({ "type": "error", "error": "engine not initialised" }),
            },
            _ => continue,
        };
        if writeln!(out, "{REPLY_PREFIX}{reply}").and_then(|_| out.flush()).is_err() {
            break;
        }
    }
}
