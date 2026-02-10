import * as core from '@actions/core';
import fs from 'fs';
import { globSync } from 'glob';
import * as toolkit from '@github/dependency-submission-toolkit';

/**
 * Extracts and constructs a manifest object from an SPDX document for a given file.
 * This function processes an SPDX document, iterating over its packages to construct a manifest.
 * It handles package information, including name, version, and package URLs (purls), and categorizes packages as direct or indirect dependencies based on their relationships.
 * Special handling is applied to package URLs to work around encoding issues, using the `replaceVersionEscape` function.
 *
 * @param {Object} document - The SPDX document object containing package and relationship data.
 * @param {string} fileName - The name of the file from which the SPDX document was extracted.
 * @returns {Object} A manifest object containing the processed package data, including direct and indirect dependencies.
 */
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

        try {
            // Working around weird encoding issues from an SBOM generator
            // Find the last instance of %40 and replace it with @
            purl = replaceVersionEscape(purl);

            let relationships = document.relationships?.find(rel => rel.relatedSpdxElement == pkg.SPDXID && rel.relationshipType == "DEPENDS_ON" && rel.spdxElementId != "SPDXRef-RootPackage");
            if (relationships != null && relationships.length > 0) {
                manifest.addIndirectDependency(new toolkit.Package(purl));
            } else {
                manifest.addDirectDependency(new toolkit.Package(purl));
            }
        }
        catch (error) {
            core.warning(`Error processing package "${packageName}@${packageVersion}" in ${fileName}`);
            core.warning(error);
        }
    });
    return manifest;
}

/**
 * Extracts manifest data from SPDX files.
 * Iterates over an array of SPDX file paths, reads each file, parses its JSON content, and then extracts the manifest data using `getManifestFromSpdxFile`.
 * Each manifest is collected and returned in an array.
 *
 * @param {string[]} files - An array of file paths pointing to SPDX files.
 * @returns {Object[]} An array of manifest objects extracted from the SPDX files.
 */
function getManifestsFromSpdxFiles(files) {
    core.debug(`Processing ${files.length} files`);
    let manifests = [];
    files?.forEach(file => {
        core.debug(`Processing ${file}`);
        manifests.push(getManifestFromSpdxFile(JSON.parse(fs.readFileSync(file)), file));
    });
    return manifests;
}

/**
 * Searches for files matching a specified pattern within a given file path.
 * Utilizes the `glob` module to perform the search, returning an array of matching file paths.
 *
 * @returns {string[]} An array of strings representing the paths of files that match the given pattern within the specified path.
 */
function searchFiles() {
    let filePath = core.getInput('filePath');
    let filePattern = core.getInput('filePattern');

    return globSync(`${filePath}/${filePattern}`, {});
}

/**
 * Escapes certain characters in a package URL (purl) to work around issues with some tools not escaping namespaces correctly.
 * Specifically, it replaces "@" with "%40" and "^" with "%5E". If an "@" is already present in the purl, it assumes no further action is needed.
 * If a "%40" is present in the purl without an "@", it converts the last occurrence of "%40" back to "@".
 * 
 * @param {string} purl - The package URL to be processed.
 * @returns {string} The processed package URL with the necessary characters escaped or unescaped.
 */
function replaceVersionEscape(purl) {
    // Some tools are failing to escape the namespace, so we will escape it to work around that
    // @ -> %40
    // ^ -> %5E
    purl = purl.replace("/@", "/%40").replaceAll("^", "%5E");

    //If there's an "@" in the purl, then we don't need to do anything.
    if (purl != null && purl != undefined && !purl?.includes("@")) {
        let index = purl.lastIndexOf("%40");
        if (index > 0) {
            purl = purl.substring(0, index) + "@" + purl.substring(index + 3);
        }
    }
    return purl;
}

// Exports
export {
    getManifestFromSpdxFile,
    getManifestsFromSpdxFiles,
    searchFiles,
    replaceVersionEscape
}
