use serde::Serialize;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

#[derive(Serialize)]
struct GreetResponse {
  message_key: String,
  name: String,
  source: String,
}

struct EngineHold {
  child: Option<Child>,
  #[cfg(windows)]
  job: Option<winjob::OwnedJob>,
}

impl Drop for EngineHold {
  fn drop(&mut self) {
    stop_engine(self);
  }
}

struct EngineState {
  hold: Mutex<EngineHold>,
}

fn stop_engine(hold: &mut EngineHold) {
  #[cfg(windows)]
  {
    // Dropping the job terminates every process in it, including the
    // uv interpreter the venv launcher spawned.
    hold.job.take();
  }
  if let Some(mut child) = hold.child.take() {
    let _ = child.kill();
    let _ = child.wait();
  }
}

fn project_root() -> PathBuf {
  let mut starts = Vec::new();
  if let Ok(current) = std::env::current_dir() {
    starts.push(current);
  }
  if let Ok(exe) = std::env::current_exe() {
    if let Some(parent) = exe.parent() {
      starts.push(parent.to_path_buf());
    }
  }
  for start in starts {
    let mut dir = start;
    for _ in 0..8 {
      if dir.join("engine").join("server.py").is_file() {
        return dir;
      }
      if !dir.pop() {
        break;
      }
    }
  }
  std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn python_for(root: &Path) -> PathBuf {
  let local = root
    .join("engine")
    .join(".venv")
    .join("Scripts")
    .join("python.exe");
  local
}

fn engine_up() -> bool {
  TcpStream::connect_timeout(
    &"127.0.0.1:8765".parse().expect("port"),
    Duration::from_millis(200),
  )
  .is_ok()
}

fn spawn_engine(root: &Path, windows_flags: u32) -> Result<Child, String> {
  let python = python_for(root);
  if !python.is_file() {
    return Err(format!(
      "Magenta Python is missing. Run uv sync in {}",
      root.join("engine").display()
    ));
  }
  let server = root.join("engine").join("server.py");
  let log_dir = root.join("engine").join("logs");
  std::fs::create_dir_all(&log_dir).map_err(|err| err.to_string())?;
  let log_path = log_dir.join("server.log");
  let log = std::fs::File::create(&log_path).map_err(|err| err.to_string())?;
  let err_log = log.try_clone().map_err(|err| err.to_string())?;
  let mut command = Command::new(&python);
  command
    .arg(&server)
    .current_dir(root.join("engine"))
    .env_remove("PYTHONPATH")
    .env_remove("VIRTUAL_ENV")
    .stdin(Stdio::null())
    .stdout(Stdio::from(log))
    .stderr(Stdio::from(err_log));
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    command.creation_flags(winjob::CREATE_NO_WINDOW | windows_flags);
  }
  #[cfg(not(windows))]
  let _ = windows_flags;
  command
    .spawn()
    .map_err(|err| format!("failed to start {}: {err}", python.display()))
}

#[tauri::command]
fn greet(name: &str) -> GreetResponse {
  GreetResponse {
    message_key: "successGreeting".to_string(),
    name: name.to_string(),
    source: "Tauri".to_string(),
  }
}

#[tauri::command]
fn engine_status() -> bool {
  engine_up()
}

#[cfg(windows)]
mod winjob {
  use std::ffi::c_void;
  use std::os::windows::io::AsRawHandle;
  use std::path::Path;
  use std::process::Child;

  use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, INVALID_HANDLE_VALUE};
  use windows_sys::Win32::NetworkManagement::IpHelper::{
    GetExtendedTcpTable, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
  };
  use windows_sys::Win32::Networking::WinSock::AF_INET;
  use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
  };
  use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
  };
  pub use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;
  use windows_sys::Win32::System::Threading::{
    OpenProcess, CREATE_BREAKAWAY_FROM_JOB, CREATE_SUSPENDED, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_SET_QUOTA, PROCESS_TERMINATE,
  };

  use super::spawn_engine;

  const PROCESS_COMMAND_LINE: i32 = 60;

  #[link(name = "ntdll")]
  extern "system" {
    fn NtQueryInformationProcess(
      process: HANDLE,
      class: i32,
      info: *mut c_void,
      len: u32,
      ret_len: *mut u32,
    ) -> i32;
    fn NtResumeProcess(process: HANDLE) -> i32;
  }

  #[repr(C)]
  struct UnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *const u16,
  }

  pub struct OwnedJob {
    handle: isize,
  }

  impl OwnedJob {
    pub fn create() -> Result<Self, String> {
      unsafe {
        let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if handle.is_null() {
          return Err(format!("CreateJobObjectW {}", GetLastError()));
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let ok = SetInformationJobObject(
          handle,
          JobObjectExtendedLimitInformation,
          &info as *const _ as *const c_void,
          std::mem::size_of_val(&info) as u32,
        );
        if ok == 0 {
          let err = GetLastError();
          CloseHandle(handle);
          return Err(format!("SetInformationJobObject {err}"));
        }
        Ok(Self {
          handle: handle as isize,
        })
      }
    }

    fn raw(&self) -> HANDLE {
      self.handle as HANDLE
    }

    pub fn assign(&self, process: HANDLE) -> bool {
      unsafe { AssignProcessToJobObject(self.raw(), process) != 0 }
    }

    fn assign_pid(&self, pid: u32) -> bool {
      unsafe {
        let handle = OpenProcess(
          PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
          0,
          pid,
        );
        if handle.is_null() {
          eprintln!("magenta engine: OpenProcess {pid} {}", GetLastError());
          return false;
        }
        let ok = AssignProcessToJobObject(self.raw(), handle);
        if ok == 0 {
          eprintln!("magenta engine: assign {pid} {}", GetLastError());
        }
        CloseHandle(handle);
        ok != 0
      }
    }

    fn assign_tree(&self, root: u32) -> bool {
      let rows = process_parents();
      let mut ok = true;
      for pid in descendants(root, &rows) {
        if !self.assign_pid(pid) {
          ok = false;
        }
      }
      ok
    }
  }

  impl Drop for OwnedJob {
    fn drop(&mut self) {
      if self.handle == 0 {
        return;
      }
      unsafe {
        TerminateJobObject(self.raw(), 1);
        CloseHandle(self.raw());
      }
      self.handle = 0;
    }
  }

  fn resume_process(process: HANDLE) -> bool {
    unsafe { NtResumeProcess(process) >= 0 }
  }

  pub fn start_engine(root: &Path, job: &OwnedJob) -> Result<Child, String> {
    let mut child = spawn_engine(root, CREATE_SUSPENDED)?;
    if !job.assign(child.as_raw_handle()) {
      let err = unsafe { GetLastError() };
      eprintln!("magenta engine: job assign failed ({err}), retrying breakaway");
      let _ = child.kill();
      let _ = child.wait();
      child = spawn_engine(root, CREATE_SUSPENDED | CREATE_BREAKAWAY_FROM_JOB)?;
      if !job.assign(child.as_raw_handle()) {
        let err = unsafe { GetLastError() };
        if !resume_process(child.as_raw_handle()) {
          let _ = child.kill();
          return Err(format!("NtResumeProcess after failed assign {err}"));
        }
        eprintln!("magenta engine: engine is not in a kill-on-close job ({err})");
        return Ok(child);
      }
    }
    if !resume_process(child.as_raw_handle()) {
      let err = unsafe { GetLastError() };
      let _ = child.kill();
      let _ = child.wait();
      return Err(format!("NtResumeProcess {err}"));
    }
    Ok(child)
  }

  pub fn adopt_listener(job: &OwnedJob) {
    let Some(pid) = listener_pid(8765) else {
      eprintln!("magenta engine: port 8765 is open but has no listener pid");
      return;
    };
    let rows = process_parents();
    let Some(root) = engine_root(pid, &rows) else {
      eprintln!("magenta engine: port 8765 is not this repo's server, leaving it");
      return;
    };
    if !job.assign_tree(root) {
      eprintln!("magenta engine: failed to adopt the running server into the job");
    }
  }

  fn listener_pid(port: u16) -> Option<u32> {
    unsafe {
      let mut size = 0u32;
      let _ = GetExtendedTcpTable(
        std::ptr::null_mut(),
        &mut size,
        0,
        AF_INET as u32,
        TCP_TABLE_OWNER_PID_LISTENER,
        0,
      );
      if size == 0 {
        return None;
      }
      let mut buf = vec![0u32; size.div_ceil(4) as usize];
      let code = GetExtendedTcpTable(
        buf.as_mut_ptr().cast(),
        &mut size,
        0,
        AF_INET as u32,
        TCP_TABLE_OWNER_PID_LISTENER,
        0,
      );
      if code != 0 {
        return None;
      }
      let table = &*(buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID);
      let count = table.dwNumEntries as usize;
      if count == 0 {
        return None;
      }
      let rows = std::slice::from_raw_parts(table.table.as_ptr(), count);
      rows.iter().find_map(|row| {
        let local = u16::from_be((row.dwLocalPort & 0xFFFF) as u16);
        (local == port).then_some(row.dwOwningPid)
      })
    }
  }

  fn process_parents() -> Vec<(u32, u32)> {
    unsafe {
      let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
      if snap.is_null() || snap == INVALID_HANDLE_VALUE {
        return Vec::new();
      }
      let mut entry: PROCESSENTRY32W = std::mem::zeroed();
      entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
      let mut rows = Vec::new();
      if Process32FirstW(snap, &mut entry) != 0 {
        loop {
          rows.push((entry.th32ProcessID, entry.th32ParentProcessID));
          entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
          if Process32NextW(snap, &mut entry) == 0 {
            break;
          }
        }
      }
      CloseHandle(snap);
      rows
    }
  }

  fn descendants(root: u32, rows: &[(u32, u32)]) -> Vec<u32> {
    let mut out = vec![root];
    let mut index = 0;
    while index < out.len() {
      let parent = out[index];
      for (pid, ppid) in rows {
        if *ppid == parent && !out.contains(pid) {
          out.push(*pid);
        }
      }
      index += 1;
    }
    out
  }

  fn engine_root(pid: u32, rows: &[(u32, u32)]) -> Option<u32> {
    if !command_is_engine(pid) {
      return None;
    }
    let mut current = pid;
    for _ in 0..8 {
      let parent = rows
        .iter()
        .find(|(id, _)| *id == current)
        .map(|(_, parent)| *parent)?;
      if parent == 0 || parent == current || !command_is_engine(parent) {
        break;
      }
      current = parent;
    }
    Some(current)
  }

  fn command_is_engine(pid: u32) -> bool {
    let Some(line) = command_line(pid) else {
      return false;
    };
    let line = line.to_ascii_lowercase();
    let ours = line.contains("magenta-2-windows") || line.contains("magenta-windows");
    ours && line.contains("server.py")
  }

  fn command_line(pid: u32) -> Option<String> {
    unsafe {
      let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
      if handle.is_null() {
        return None;
      }
      let mut buf = vec![0u64; 4_096];
      let mut needed = 0u32;
      let status = NtQueryInformationProcess(
        handle,
        PROCESS_COMMAND_LINE,
        buf.as_mut_ptr().cast(),
        (buf.len() * std::mem::size_of::<u64>()) as u32,
        &mut needed,
      );
      CloseHandle(handle);
      if status < 0 {
        return None;
      }
      let text = &*(buf.as_ptr() as *const UnicodeString);
      if text.buffer.is_null() || text.length < 2 {
        return None;
      }
      let words = std::slice::from_raw_parts(text.buffer, (text.length as usize) / 2);
      Some(String::from_utf16_lossy(words))
    }
  }

  #[cfg(test)]
  pub fn parents_for_test() -> Vec<(u32, u32)> {
    process_parents()
  }

  #[cfg(test)]
  pub fn descendants_for_test(root: u32, rows: &[(u32, u32)]) -> Vec<u32> {
    descendants(root, rows)
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      let mut hold = EngineHold {
        child: None,
        #[cfg(windows)]
        job: match winjob::OwnedJob::create() {
          Ok(job) => Some(job),
          Err(err) => {
            eprintln!("magenta engine: {err}");
            None
          }
        },
      };
      let root = project_root();
      if engine_up() {
        #[cfg(windows)]
        if let Some(job) = hold.job.as_ref() {
          winjob::adopt_listener(job);
        }
      } else {
        #[cfg(windows)]
        match hold.job.as_ref() {
          Some(job) => match winjob::start_engine(&root, job) {
            Ok(child) => hold.child = Some(child),
            Err(err) => eprintln!("magenta engine: {err}"),
          },
          None => match spawn_engine(&root, 0) {
            Ok(child) => hold.child = Some(child),
            Err(err) => eprintln!("magenta engine: {err}"),
          },
        }
        #[cfg(not(windows))]
        match spawn_engine(&root, 0) {
          Ok(child) => hold.child = Some(child),
          Err(err) => eprintln!("magenta engine: {err}"),
        }
      }
      app.manage(EngineState {
        hold: Mutex::new(hold),
      });
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![greet, engine_status])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if matches!(
        event,
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
      ) {
        if let Some(state) = app.try_state::<EngineState>() {
          let mut hold = state.hold.lock().unwrap_or_else(|err| err.into_inner());
          stop_engine(&mut hold);
        }
      }
    });
}

#[cfg(all(test, windows))]
mod tests {
  use super::winjob::{descendants_for_test, parents_for_test, OwnedJob};
  use super::{project_root, python_for};
  use std::os::windows::io::AsRawHandle;
  use std::os::windows::process::CommandExt;
  use std::process::{Command, Stdio};
  use std::time::{Duration, Instant};
  use windows_sys::Win32::System::Threading::{CREATE_NO_WINDOW, CREATE_SUSPENDED};

  #[test]
  fn dropping_the_job_kills_the_python_tree() {
    let python = python_for(&project_root());
    let job = OwnedJob::create().expect("job");
    let mut command = Command::new(&python);
    command
      .arg("-c")
      .arg("import time; time.sleep(120)")
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .creation_flags(CREATE_NO_WINDOW | CREATE_SUSPENDED);
    let mut child = command.spawn().expect("spawn");
    let pid = child.id();
    let assigned = job.assign(child.as_raw_handle());
    if !assigned {
      let _ = child.kill();
      let _ = child.wait();
      panic!("assign failed");
    }
    let resumed = unsafe { resume_for_test(child.as_raw_handle()) };
    if !resumed {
      let _ = child.kill();
      let _ = child.wait();
      panic!("resume failed");
    }
    let started = Instant::now();
    let mut kids = vec![pid];
    while started.elapsed() < Duration::from_secs(3) {
      let found = descendants_for_test(pid, &parents_for_test());
      if found.len() > 1 {
        kids = found;
        break;
      }
      std::thread::sleep(Duration::from_millis(50));
    }
    assert!(
      kids.len() > 1,
      "venv python did not spawn the uv interpreter"
    );
    drop(job);
    let _ = child.wait();
    std::thread::sleep(Duration::from_millis(400));
    let alive = parents_for_test();
    for pid in kids {
      assert!(
        !alive.iter().any(|(id, _)| *id == pid),
        "pid {pid} survived the job"
      );
    }
  }

  #[link(name = "ntdll")]
  extern "system" {
    fn NtResumeProcess(process: *mut core::ffi::c_void) -> i32;
  }

  unsafe fn resume_for_test(process: *mut core::ffi::c_void) -> bool {
    unsafe { NtResumeProcess(process) >= 0 }
  }
}
