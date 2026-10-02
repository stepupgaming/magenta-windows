use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

const ENGINE_ZIP: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/engine-src.zip"));
const UV_ZIP_URL: &str =
  "https://github.com/astral-sh/uv/releases/download/0.12.10/uv-x86_64-pc-windows-msvc.zip";

static STATUS: Mutex<String> = Mutex::new(String::new());

pub fn set_status(text: &str) {
  let mut slot = STATUS.lock().unwrap_or_else(|err| err.into_inner());
  *slot = text.to_string();
}

pub fn status() -> String {
  STATUS.lock().unwrap_or_else(|err| err.into_inner()).clone()
}

pub fn find_checkout() -> Option<PathBuf> {
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
        return Some(dir);
      }
      if !dir.pop() {
        break;
      }
    }
  }
  None
}

pub fn venv_python(root: &Path) -> PathBuf {
  root
    .join("engine")
    .join(".venv")
    .join("Scripts")
    .join("python.exe")
}

pub fn prepare(
  run: &mut impl FnMut(&Path, &[&str], &Path, &Path) -> Result<(), String>,
) -> Result<PathBuf, String> {
  if let Some(root) = find_checkout() {
    if venv_python(&root).is_file() {
      return Ok(root);
    }
    install_python(&root, run)?;
    fetch_weights(&root, run)?;
    return Ok(root);
  }
  let root = portable_root()?;
  extract_to(&root)?;
  install_python(&root, run)?;
  fetch_weights(&root, run)?;
  Ok(root)
}

fn portable_root() -> Result<PathBuf, String> {
  let base = std::env::var("LOCALAPPDATA").map_err(|_| "LOCALAPPDATA is not set".to_string())?;
  Ok(PathBuf::from(base).join("Magenta").join("app"))
}

pub fn extract_to(root: &Path) -> Result<(), String> {
  std::fs::create_dir_all(root).map_err(|err| err.to_string())?;
  let mut archive =
    zip::ZipArchive::new(io::Cursor::new(ENGINE_ZIP)).map_err(|err| err.to_string())?;
  for index in 0..archive.len() {
    let mut file = archive.by_index(index).map_err(|err| err.to_string())?;
    if file.is_dir() {
      continue;
    }
    let Some(rel) = file.enclosed_name() else {
      continue;
    };
    let dest = root.join(&rel);
    if let Some(parent) = dest.parent() {
      std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let mut out = std::fs::File::create(&dest).map_err(|err| err.to_string())?;
    io::copy(&mut file, &mut out).map_err(|err| err.to_string())?;
  }
  let server = root.join("engine").join("server.py");
  if server.is_file() {
    Ok(())
  } else {
    Err(format!("engine extract missed {}", server.display()))
  }
}

fn install_python(
  root: &Path,
  run: &mut impl FnMut(&Path, &[&str], &Path, &Path) -> Result<(), String>,
) -> Result<(), String> {
  let python = venv_python(root);
  if python.is_file() {
    return Ok(());
  }
  set_status("Installing PyTorch. First launch only.");
  let uv = uv_program()?;
  let engine = root.join("engine");
  let log = engine.join("logs").join("uv-sync.log");
  run(&uv, &["sync"], &engine, &log)?;
  if python.is_file() {
    Ok(())
  } else {
    Err(format!(
      "uv sync did not create {}. Log: {}",
      python.display(),
      log.display()
    ))
  }
}

fn fetch_weights(
  root: &Path,
  run: &mut impl FnMut(&Path, &[&str], &Path, &Path) -> Result<(), String>,
) -> Result<(), String> {
  let script = root.join("scripts").join("release_weights.py");
  if !script.is_file() {
    return Ok(());
  }
  set_status("Downloading the checkpoint. About 10 GB, first launch only.");
  let python = venv_python(root);
  let log = root.join("engine").join("logs").join("weights.log");
  run(
    &python,
    &["scripts/release_weights.py", "ensure"],
    root,
    &log,
  )
}

fn uv_program() -> Result<PathBuf, String> {
  if let Some(found) = find_on_path("uv.exe") {
    return Ok(found);
  }
  let dest_dir = portable_root()?
    .parent()
    .unwrap_or(Path::new("."))
    .to_path_buf();
  std::fs::create_dir_all(&dest_dir).map_err(|err| err.to_string())?;
  let uv_exe = dest_dir.join("uv.exe");
  if uv_exe.is_file() {
    return Ok(uv_exe);
  }
  set_status("Downloading uv.");
  let zip_path = dest_dir.join("uv.zip");
  download(UV_ZIP_URL, &zip_path)?;
  extract_named(&zip_path, "uv.exe", &uv_exe)?;
  let _ = std::fs::remove_file(&zip_path);
  if uv_exe.is_file() {
    Ok(uv_exe)
  } else {
    Err("uv download did not contain uv.exe".to_string())
  }
}

fn find_on_path(name: &str) -> Option<PathBuf> {
  let path = std::env::var_os("PATH")?;
  for dir in std::env::split_paths(&path) {
    let candidate = dir.join(name);
    if candidate.is_file() {
      return Some(candidate);
    }
  }
  None
}

fn download(url: &str, dest: &Path) -> Result<(), String> {
  let agent = ureq::AgentBuilder::new()
    .timeout(Duration::from_secs(180))
    .build();
  let response = agent.get(url).call().map_err(|err| err.to_string())?;
  let mut file = std::fs::File::create(dest).map_err(|err| err.to_string())?;
  let mut reader = response.into_reader();
  let mut buf = [0_u8; 1024 * 256];
  loop {
    let read = reader.read(&mut buf).map_err(|err| err.to_string())?;
    if read == 0 {
      break;
    }
    file
      .write_all(&buf[..read])
      .map_err(|err| err.to_string())?;
  }
  Ok(())
}

fn extract_named(zip_path: &Path, wanted: &str, dest: &Path) -> Result<(), String> {
  let file = std::fs::File::open(zip_path).map_err(|err| err.to_string())?;
  let mut archive = zip::ZipArchive::new(file).map_err(|err| err.to_string())?;
  for index in 0..archive.len() {
    let mut entry = archive.by_index(index).map_err(|err| err.to_string())?;
    let Some(name) = entry.enclosed_name() else {
      continue;
    };
    if name.file_name().and_then(|value| value.to_str()) != Some(wanted) {
      continue;
    }
    let mut out = std::fs::File::create(dest).map_err(|err| err.to_string())?;
    io::copy(&mut entry, &mut out).map_err(|err| err.to_string())?;
    return Ok(());
  }
  Err(format!("{wanted} was not in {}", zip_path.display()))
}

pub fn zip_names() -> Result<Vec<String>, String> {
  let mut archive =
    zip::ZipArchive::new(io::Cursor::new(ENGINE_ZIP)).map_err(|err| err.to_string())?;
  let mut names = Vec::new();
  for index in 0..archive.len() {
    let file = archive.by_index(index).map_err(|err| err.to_string())?;
    names.push(file.name().to_string());
  }
  Ok(names)
}

#[cfg(test)]
mod tests {
  #[test]
  fn embedded_engine_contains_the_server_and_not_the_venv() {
    let names = super::zip_names().expect("zip");
    assert!(names.iter().any(|name| name == "engine/server.py"));
    assert!(names
      .iter()
      .any(|name| name == "scripts/release_weights.py"));
    assert!(names.iter().all(|name| !name.contains(".venv")));
    assert!(names.iter().all(|name| !name.ends_with(".wav")));
    let dir = std::env::temp_dir().join(format!("magenta-engine-zip-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    super::extract_to(&dir).expect("extract");
    assert!(dir.join("engine").join("server.py").is_file());
    assert!(dir.join("scripts").join("release_weights.py").is_file());
    assert!(!dir.join("engine").join(".venv").exists());
    std::fs::remove_dir_all(&dir).expect("cleanup");
  }
}
