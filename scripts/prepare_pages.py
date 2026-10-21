"""Prepare the self-contained Pages build and its corresponding source."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile
import shutil

root = Path(__file__).resolve().parents[1]
output = root / "dist-offline"
if not (output / "index.html").is_file():
    raise SystemExit("Run npm run build:offline first")

(output / ".nojekyll").write_text("")
shutil.copy2(root / "LICENSE", output / "LICENSE")
with ZipFile(output / "corresponding-source.zip", "w", ZIP_DEFLATED) as archive:
    for name in ["README.md", "LICENSE", "package.json", "package-lock.json",
                 "index.html", "vite.config.js", "playwright.config.js", ".gitignore", ".npmrc"]:
        archive.write(root / name, "source/" + name)
    for folder in ["src", "test", "docs", "scripts", ".github"]:
        for path in sorted((root / folder).rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts:
                archive.write(path, "source/" + path.relative_to(root).as_posix())
    for path in sorted((root / "node_modules").rglob("*")):
        if path.is_file() and path.name.lower().startswith(("license", "licence", "ofl")):
            archive.write(path, "third-party-licenses/" + path.relative_to(root / "node_modules").as_posix())

print("Pages build: index.html, .nojekyll, LICENSE and corresponding-source.zip")
