import * as core from '@actions/core';
import { context } from '@actions/github';

import * as toolkit from '@github/dependency-submission-toolkit';
import * as lib from './lib/index.js';

const VERSION = "0.3.0";

async function run() {
  let manifests = lib.getManifestsFromSpdxFiles(lib.searchFiles());
  const submissionContext = lib.getSubmissionContext(context);

  const correlator = core.getInput('correlator');
  let snapshot = new toolkit.Snapshot({
    name: "spdx-to-dependency-graph-action",
    version: VERSION,
    url: "https://github.com/advanced-security/spdx-dependency-submission-action",
  },
    submissionContext,
    {
      correlator: correlator,
      id: context.runId.toString()
    });

  manifests?.forEach(manifest => {
    snapshot.addManifest(manifest);
  });

  toolkit.submitSnapshot(snapshot, submissionContext);
}

run();