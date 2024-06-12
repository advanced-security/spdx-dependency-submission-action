const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const glob = require('glob');

const toolkit = require('@github/dependency-submission-toolkit');
const lib = require('./lib');

async function run() {
  let manifests = lib.getManifestsFromSpdxFiles(lib.searchFiles());
  
  let snapshot = new toolkit.Snapshot({
      name: "spdx-to-dependency-graph-action",
      version: "0.1.1",
      url: "https://github.com/advanced-security/spdx-dependency-submission-action",
  }, 
  github.context,
  {
    correlator:`${github.context.job}`,
    id: github.context.runId.toString()
  });

  manifests?.forEach(manifest => {
    snapshot.addManifest(manifest);
  });

  toolkit.submitSnapshot(snapshot);
}

run();