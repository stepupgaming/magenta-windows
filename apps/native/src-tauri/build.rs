use std::fs::File;
use std::io::{self, Write};
use std::path::Path;

fn main() {
  let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
  let repo = manifest_dir.join("../../..");
  let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR");
  let zip_path = Path::new(&out_dir).join("engine-src.zip");
  pack(&repo, &zip_path).expect("pack engine source");
  println!("cargo:rerun-if-changed=../../../engine/pyproject.toml");
  println!("cargo:rerun-if-changed=../../../engine/uv.lock");
  println!("cargo:rerun-if-changed=../../../engine/server.py");
  println!("cargo:rerun-if-changed=../../../engine/.python-version");
  println!("cargo:rerun-if-changed=../../../engine/magenta_win");
  println!("cargo:rerun-if-changed=../../../engine/model_code");
  println!("cargo:rerun-if-changed=../../../scripts/release_weights.py");
  tauri_build::build()
}

fn pack(repo: &Path, dest: &Path) -> io::Result<()> {
  let file = File::create(dest)?;
  let mut zip = zip::ZipWriter::new(file);
  let options =
    zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
  pack_tree(&mut zip, &repo.join("engine"), "engine", options)?;
  add_file(
    &mut zip,
    &repo.join("scripts").join("release_weights.py"),
    "scripts/release_weights.py",
    options,
  )?;
  zip.finish()?;
  Ok(())
}

fn pack_tree<W: Write + io::Seek>(
  zip: &mut zip::ZipWriter<W>,
  dir: &Path,
  prefix: &str,
  options: zip::write::SimpleFileOptions,
) -> io::Result<()> {
  for entry in std::fs::read_dir(dir)? {
    let entry = entry?;
    let name = entry.file_name();
    let name = name.to_string_lossy();
    if matches!(
      name.as_ref(),
      ".venv" | "__pycache__" | ".pytest_cache" | "tests" | "outputs" | "logs" | ".git"
    ) {
      continue;
    }
    let path = entry.path();
    let rel = format!("{prefix}/{name}");
    if path.is_dir() {
      pack_tree(zip, &path, &rel, options)?;
      continue;
    }
    if rel.ends_with(".wav") || rel.ends_with(".pyc") || rel.ends_with(".pyo") {
      continue;
    }
    add_file(zip, &path, &rel, options)?;
  }
  Ok(())
}

fn add_file<W: Write + io::Seek>(
  zip: &mut zip::ZipWriter<W>,
  path: &Path,
  name: &str,
  options: zip::write::SimpleFileOptions,
) -> io::Result<()> {
  zip
    .start_file(name.replace('\\', "/"), options)
    .map_err(|err| io::Error::other(err))?;
  let mut file = File::open(path)?;
  io::copy(&mut file, zip)?;
  Ok(())
}
