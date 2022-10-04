const core = require('@actions/core');
const github = require('@actions/github');
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
  let manifests = await getManifestsFromSpdxFiles(await searchFiles());
  
  let snapshot = new Snapshot({
      name: "spdx-to-dependency-graph-action",
      version: "0.0.1",
      url: "https://github.com/jhutchings1/spdx-to-dependency-graph-action",
  }, 
  github.context,
  {
    correlator:`${github.context.job}`,
    id: github.context.runId.toString()
  });

  manifests?.forEach(manifest => {
    snapshot.addManifest(manifest);
  });

  submitSnapshot(snapshot);
}

function getManifestFromSpdxFile(content, fileName) {
  let manifest = new Manifest(fileName);
  content.packages?.forEach(pkg => {
    let packageName = pkg.packageName;
    let packageVersion = pkg.packageVersion;
    let purl = pkg.purl;

    manifest.addPackage(new Package(packageName, packageVersion, purl));
    snapshot.addManifest(manifest);
  });

  return manifest;
}
function getManifestsFromSpdxFiles(files) {
  let manifests = [];
  files?.forEach(file => {
    fs.readFile(file, (err, content) => {
      manifests.push(getManifestFromSpdxFile(JSON.parse(content), file.name));
    });
  });
  return manifests;
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
