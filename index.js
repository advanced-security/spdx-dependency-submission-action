const core = require('@actions/core');
const github = require('@actions/github');
const fs = require('fs');
const glob = require('glob');

const toolkit = require('@github/dependency-submission-toolkit');

async function run() {
  let manifests = getManifestsFromSpdxFiles(searchFiles());
  
  let snapshot = new toolkit.Snapshot({
      name: "spdx-to-dependency-graph-action",
      version: "0.0.1",
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

function getManifestFromSpdxFile(document, fileName) {
  core.debug(`getManifestFromSpdxFile processing ${fileName}`);

  let manifest = new toolkit.Manifest(document.name, fileName);

  core.debug(`Processing ${document.packages?.length} packages`);

  document.packages?.forEach(pkg => {
    let packageName = pkg.name;
    let packageVersion = pkg.packageVersion;
    let referenceLocator = pkg.externalRefs?.find(ref => ref.referenceCategory === "PACKAGE-MANAGER" && ref.referenceType === "purl")?.referenceLocator;
    let genericPurl = `pkg:generic/${packageName}@${packageVersion}`;
    // SPDX 2.3 defines a purl field 
    let purl;
    if (pkg.purl != undefined) {
      purl = pkg.purl;
    } else if (referenceLocator != undefined) {
      purl = referenceLocator;
    } else {
      purl = genericPurl;
    }  

    // Working around weird encoding issues from an SBOM generator
    // Find the last instance of %40 and replace it with @
    purl = replaceVersionEscape(purl);  

    let relationships = document.relationships?.find(rel => rel.relatedSpdxElement == pkg.SPDXID && rel.relationshipType == "DEPENDS_ON" && rel.spdxElementId != "SPDXRef-RootPackage");
    if (relationships != null && relationships.length > 0) {
      manifest.addIndirectDependency(new toolkit.Package(purl));
    } else {
      manifest.addDirectDependency(new toolkit.Package(purl));
    }
  });
  return manifest;
}

function getManifestsFromSpdxFiles(files) {
  core.debug(`Processing ${files.length} files`);
  let manifests = [];
  files?.forEach(file => {
    core.debug(`Processing ${file}`);
    manifests.push(getManifestFromSpdxFile(JSON.parse(fs.readFileSync(file)), file));
  });
  return manifests;
}

function searchFiles() {
  let filePath = core.getInput('filePath');
  let filePattern = core.getInput('filePattern');

  return glob.sync(`${filePath}/${filePattern}`, {});
}

// Fixes issues with an escaped version string
function replaceVersionEscape(purl) {
  // Some tools are failing to escape the namespace, so we will escape it to work around that
  // @ -> %40
  // ^ -> %5E
  purl = purl.replace("/@", "/%40").replace("^", "%5E");

  //If there's an "@" in the purl, then we don't need to do anything.
  if (purl != null && purl != undefined && !purl?.includes("@")) {
    let index = purl.lastIndexOf("%40");
    if (index > 0) {
      purl = purl.substring(0, index) + "@" + purl.substring(index + 3);
    }
  }
  return purl;
}

run();
