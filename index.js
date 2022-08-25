const core = require('@actions/core');
const fs = require('fs');
const glob = require('glob');

import {
  PackageCache,
  BuildTarget,
  Package,
  Snapshot,
  submitSnapshot
} from '@github/dependency-submission-toolkit'

async function run() {
  let spdxFiles = await parseFiles(await searchFiles());
  
  let snapshot = new Snapshot({
    detector: new Detector({
      name: "spdx-to-dependency-graph-action",
      version: "0.0.1",
      url: "https://github.com/jhutchings1/spdx-to-dependency-graph-action",
    })
  });

  spdxFiles.forEach(spdxFile => {
    let manifest = new Manifest(spdxFile.name);
    spdxFile.packages.forEach(pkg => {
      let packageName = pkg.packageName;
      let packageVersion = pkg.packageVersion;
      let purl = pkg.purl;

      manifest.addPackage(new Package(packageName, packageVersion, purl));
      snapshot.addManifest(manifest);
    });
  });

  submitSnapshot(snapshot);
}

async function parseFiles(files) {
  let spdxFiles = [];
  files.forEach(file => {
    fs.readFile(file, (err, content) => {
      spdxFiles.push(parseSPDXFile(JSON.parse(content)));
    });
  });
  return spdxFiles;
}

async function searchFiles() {
  let filePath = core.getInput('filePath');
  let filePattern = core.getInput('filePattern');

  glob(`${filePath}/${filePattern}`, {}, (err, files) => {
    if (err) {
      core.error(err);
    } else {
      return files;
    }
  });
}

run();
