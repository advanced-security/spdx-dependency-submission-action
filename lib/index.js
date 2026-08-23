import * as core from '@actions/core';
import { execFileSync } from 'child_process';
import fs from 'fs';
import { globSync } from 'glob';
import { getOctokit } from '@actions/github';
import { retry } from '@octokit/plugin-retry';
import { RequestError } from '@octokit/request-error';
import * as toolkit from '@github/dependency-submission-toolkit';

// TEST: harmless comment to leave dist/ intentionally stale, validating the check-dist neutral (yellow) path. Will be reverted.

/**
 * HTTP status codes that should not be retried when submitting a snapshot.
 *
 * The default list used by @octokit/plugin-retry is 400, 401, 403, 404, 422, and 451.
 * We have observed transient "An error occurred while processing your request. Please
 * try again later." errors (as well as authentication hiccups) from the dependency
 * submission API, so we remove 401, 403, and 404 from the default list to ensure they
 * are retried too. We also include 410 as non-retriable, which mirrors the approach
 * used by github/codeql-action.
 */
const DO_NOT_RETRY_STATUSES = [400, 410, 422, 451];

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

    const rootDependencies = new Set();
    const nonRootDependencies = new Set();
    for (const relationship of document.relationships ?? []) {
        if (relationship.relationshipType !== "DEPENDS_ON") {
            continue;
        }

        const dependencies = relationship.spdxElementId === "SPDXRef-RootPackage"
            ? rootDependencies
            : nonRootDependencies;
        dependencies.add(relationship.relatedSpdxElement);
    }

    document.packages?.forEach(pkg => {
        let packageName = pkg.name;
        // versionInfo is the field defined by the SPDX 2.2/2.3 spec for a package's version
        // (see https://spdx.github.io/spdx-spec/v2.3/package-information/#77-version-information-field).
        // packageVersion isn't a real SPDX field, but is kept as a fallback in case some existing
        // generator relies on it.
        let packageVersion = pkg.versionInfo ?? pkg.packageVersion;
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

            const isDirectDependency =
                rootDependencies.has(pkg.SPDXID) ||
                !nonRootDependencies.has(pkg.SPDXID);
            if (isDirectDependency) {
                manifest.addDirectDependency(new toolkit.Package(purl));
            } else {
                manifest.addIndirectDependency(new toolkit.Package(purl));
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
 * Builds a GitHub context for a target repository submission.
 * Clears the workflow event name so the toolkit uses the target SHA instead of a pull request payload SHA.
 *
 * @param {Object} defaultContext - The GitHub Actions workflow context.
 * @param {string} workingDirectory - The checked-out target repository directory.
 * @returns {Object} The workflow context or a context for the target repository.
 */
function getSubmissionContext(defaultContext, workingDirectory = process.cwd()) {
    const repo = core.getInput('repo');
    if (!repo) {
        return defaultContext;
    }

    const owner = core.getInput('owner') || defaultContext.repo.owner;
    const repoSha = core.getInput('repoSha');
    const repoRef = core.getInput('repoRef');
    if ((!repoSha || !repoRef) && !isRepositoryCheckout(owner, repo, workingDirectory)) {
        const missingInputs = [
            !repoSha && "'repoSha'",
            !repoRef && "'repoRef'"
        ].filter(Boolean).join(' and ');
        throw new Error(`The repoPath directory is not a checkout of '${owner}/${repo}'. Provide ${missingInputs} explicitly or set 'repoPath' to a checkout of '${owner}/${repo}'.`);
    }

    return {
        ...defaultContext,
        eventName: '',
        repo: {
            owner,
            repo
        },
        sha: repoSha || getGitValue(['rev-parse', 'HEAD'], 'repoSha', workingDirectory),
        ref: repoRef || getGitRef(workingDirectory)
    };
}

function runGit(args, workingDirectory) {
    return execFileSync('git', args, {
        cwd: workingDirectory,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
}

function isRepositoryCheckout(owner, repo, workingDirectory) {
    try {
        const remote = runGit(['remote', 'get-url', 'origin'], workingDirectory)
            .replace(/\/+$/, '')
            .replace(/\.git$/i, '');
        const repository = remote.match(/[:/]([^/:]+)\/([^/]+)$/);
        return repository?.[1].toLowerCase() === owner.toLowerCase()
            && repository?.[2].toLowerCase() === repo.toLowerCase();
    } catch {
        return false;
    }
}

function getGitRef(workingDirectory) {
    if (isDetachedHead(workingDirectory)) {
        throw new Error("Unable to auto-detect 'repoRef' from a detached HEAD. Provide the 'repoRef' input.");
    }

    return getGitValue(['symbolic-ref', 'HEAD'], 'repoRef', workingDirectory);
}

function isDetachedHead(workingDirectory) {
    try {
        return runGit(['rev-parse', '--abbrev-ref', 'HEAD'], workingDirectory) === 'HEAD';
    } catch {
        return false;
    }
}

function getGitValue(args, input, workingDirectory) {
    try {
        const value = runGit(args, workingDirectory);
        if (value) {
            return value;
        }
    } catch {
        // Report the actionable input error below.
    }

    throw new Error(`Unable to auto-detect '${input}' from the checked-out repository. Provide the '${input}' input.`);
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

    // If there's no "@" in the purl, treat the last encoded @ in the main package path as the version separator.
    if (purl != null && purl != undefined && !purl?.includes("@")) {
        const purlMainPartEnd = purl.search(/[?#]/);
        const searchEnd = purlMainPartEnd < 0 ? purl.length : purlMainPartEnd;
        const searchStart = purl.lastIndexOf("/", searchEnd - 1) + 1;
        const index = purl.lastIndexOf("%40", searchEnd - 1);
        if (index >= searchStart) {
            purl = purl.substring(0, index) + "@" + purl.substring(index + 3);
        }
    }

    // packageurl-js expects colons in a version to be unescaped.
    const purlMainPartEnd = purl.search(/[?#]/);
    const searchEnd = purlMainPartEnd < 0 ? purl.length : purlMainPartEnd;
    const searchStart = purl.lastIndexOf("/", searchEnd - 1) + 1;
    const versionStart = purl.lastIndexOf("@", searchEnd - 1);
    if (versionStart >= searchStart) {
        let versionEnd = purl.slice(versionStart + 1).search(/[?#]/);
        versionEnd = versionEnd < 0 ? purl.length : versionStart + 1 + versionEnd;
        purl = purl.slice(0, versionStart + 1)
            + purl.slice(versionStart + 1, versionEnd).replaceAll(/%3A/gi, ":")
            + purl.slice(versionEnd);
    }
    return purl;
}

/**
 * Submits a dependency graph snapshot to the GitHub API.
 * This mirrors the behavior of `@github/dependency-submission-toolkit`'s `submitSnapshot`,
 * but uses an Octokit client configured with automatic retries (exponential backoff) so
 * that transient failures, such as "An error occurred while processing your request.
 * Please try again later.", are retried instead of immediately failing the workflow.
 *
 * @param {Object} snapshot - The snapshot object to submit, as constructed via `toolkit.Snapshot`.
 * @param {Object} context - The GitHub Actions context, used to determine the target repository.
 * @returns {Promise<void>} Resolves when the snapshot has been submitted successfully.
 */
async function submitSnapshot(snapshot, context) {
    core.setOutput('snapshot', JSON.stringify(snapshot));
    core.notice("Submitting snapshot...");
    core.notice(snapshot.prettyJSON());

    const repo = context.repo;
    const token = core.getInput('token') || await core.getIDToken();
    const octokit = getOctokit(token, {
        retry: {
            doNotRetry: DO_NOT_RETRY_STATUSES
        }
    }, retry);

    try {
        const response = await octokit.request("POST /repos/{owner}/{repo}/dependency-graph/snapshots", {
            headers: {
                accept: "application/vnd.github.foo-bar-preview+json"
            },
            owner: repo.owner,
            repo: repo.repo,
            ...snapshot
        });

        const result = response.data.result;
        if (result === "SUCCESS" || result === "ACCEPTED") {
            core.notice(`Snapshot successfully created at ${response.data.created_at.toString()}`);
        } else {
            core.error(`Snapshot creation failed with result: "${result}: ${response.data.message}"`);
        }
    } catch (error) {
        if (error instanceof RequestError) {
            core.error(`HTTP Status ${error.status} for request ${error.request.method} ${error.request.url}`);
            if (error.response) {
                core.error(`Response body:\n${JSON.stringify(error.response.data, undefined, 2)}`);
            }
        }
        if (error instanceof Error) {
            core.error(error.message);
            if (error.stack) {
                core.error(error.stack);
            }
        }
        throw new Error(`Failed to submit snapshot: ${error}`, { cause: error });
    }
}

// Exports
export {
    getManifestFromSpdxFile,
    getManifestsFromSpdxFiles,
    searchFiles,
    getSubmissionContext,
    replaceVersionEscape,
    submitSnapshot
}
